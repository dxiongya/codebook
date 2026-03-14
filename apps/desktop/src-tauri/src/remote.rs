use crate::claude::ClaudeManager;
use crate::db::Database;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::UdpSocket;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Listener};
use tokio::net::TcpListener;
use tokio::sync::mpsc::{self, UnboundedSender};
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::Message;

// ---------------------------------------------------------------------------
// Remote server state
// ---------------------------------------------------------------------------

pub struct RemoteServer {
    port: u16,
    clients: Arc<Mutex<HashMap<String, UnboundedSender<Message>>>>,
    running: Arc<Mutex<bool>>,
    shutdown_tx: Arc<Mutex<Option<mpsc::Sender<()>>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteInfo {
    pub port: u16,
    pub ips: Vec<String>,
    pub client_count: usize,
    pub running: bool,
}

// ---------------------------------------------------------------------------
// JSON protocol types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct ClientRequest {
    action: String,
    project_id: Option<String>,
    session_id: Option<String>,
    message: Option<String>,
    model: Option<String>,
    name: Option<String>,
}

impl RemoteServer {
    pub fn new(port: u16) -> Self {
        Self {
            port,
            clients: Arc::new(Mutex::new(HashMap::new())),
            running: Arc::new(Mutex::new(false)),
            shutdown_tx: Arc::new(Mutex::new(None)),
        }
    }

    /// Start the WebSocket server in a background task.
    pub async fn start(
        &self,
        db: Arc<Database>,
        claude: Arc<ClaudeManager>,
        app: AppHandle,
    ) -> Result<(), String> {
        // Prevent double-start
        {
            let mut running = self.running.lock().await;
            if *running {
                return Err("Remote server is already running".to_string());
            }
            *running = true;
        }

        let addr = format!("0.0.0.0:{}", self.port);
        let listener = TcpListener::bind(&addr)
            .await
            .map_err(|e| format!("Failed to bind to {}: {}", addr, e))?;

        eprintln!("[remote] WebSocket server listening on {}", addr);

        let clients = self.clients.clone();
        let running = self.running.clone();

        // Shutdown channel
        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
        {
            let mut tx_guard = self.shutdown_tx.lock().await;
            *tx_guard = Some(shutdown_tx);
        }

        // Set up a global listener for claude-event to broadcast to mobile clients
        let broadcast_clients = self.clients.clone();
        let _event_listener = app.listen("claude-event", move |event| {
            let clients = broadcast_clients.clone();
            let payload = event.payload().to_string();

            // Parse the event and wrap it for mobile
            let mobile_msg = if let Ok(evt) = serde_json::from_str::<serde_json::Value>(&payload) {
                serde_json::json!({
                    "type": "claude_event",
                    "data": evt
                })
            } else {
                serde_json::json!({
                    "type": "claude_event",
                    "data": payload
                })
            };

            let msg_str = serde_json::to_string(&mobile_msg).unwrap_or_default();

            // Spawn a task to broadcast since the listener callback is sync
            tokio::spawn(async move {
                let clients_guard = clients.lock().await;
                for (_id, tx) in clients_guard.iter() {
                    let _ = tx.send(Message::Text(msg_str.clone().into()));
                }
            });
        });

        // Main accept loop
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    accept_result = listener.accept() => {
                        match accept_result {
                            Ok((stream, peer_addr)) => {
                                eprintln!("[remote] New connection from {}", peer_addr);

                                let ws_stream = match tokio_tungstenite::accept_async(stream).await {
                                    Ok(ws) => ws,
                                    Err(e) => {
                                        eprintln!("[remote] WebSocket handshake failed: {}", e);
                                        continue;
                                    }
                                };

                                let client_id = uuid::Uuid::new_v4().to_string();
                                let (ws_sender, mut ws_receiver) = ws_stream.split();

                                // Per-client channel for outgoing messages
                                let (tx, mut rx) = mpsc::unbounded_channel::<Message>();

                                // Store client
                                {
                                    let mut c = clients.lock().await;
                                    c.insert(client_id.clone(), tx.clone());
                                }

                                // Send connected message
                                let connected_msg = serde_json::json!({
                                    "type": "connected",
                                    "client_id": client_id
                                });
                                let _ = tx.send(Message::Text(
                                    serde_json::to_string(&connected_msg).unwrap_or_default().into(),
                                ));

                                // Task: forward outgoing channel messages to the WebSocket
                                let clients_for_write = clients.clone();
                                let cid_write = client_id.clone();
                                let mut ws_sender = ws_sender;
                                tokio::spawn(async move {
                                    while let Some(msg) = rx.recv().await {
                                        if ws_sender.send(msg).await.is_err() {
                                            break;
                                        }
                                    }
                                    // Close the sink
                                    let _ = ws_sender.close().await;
                                    let mut c = clients_for_write.lock().await;
                                    c.remove(&cid_write);
                                    eprintln!("[remote] Write task ended for {}", cid_write);
                                });

                                // Task: read incoming messages from the WebSocket
                                let clients_for_read = clients.clone();
                                let db_clone = db.clone();
                                let claude_clone = claude.clone();
                                let app_clone = app.clone();
                                let cid_read = client_id.clone();
                                let tx_for_read = tx.clone();

                                tokio::spawn(async move {
                                    while let Some(msg_result) = ws_receiver.next().await {
                                        match msg_result {
                                            Ok(Message::Text(text)) => {
                                                handle_client_message(
                                                    &cid_read,
                                                    &text,
                                                    &tx_for_read,
                                                    &db_clone,
                                                    &claude_clone,
                                                    &app_clone,
                                                )
                                                .await;
                                            }
                                            Ok(Message::Close(_)) => {
                                                eprintln!("[remote] Client {} disconnected", cid_read);
                                                break;
                                            }
                                            Ok(Message::Ping(data)) => {
                                                let _ = tx_for_read.send(Message::Pong(data));
                                            }
                                            Err(e) => {
                                                eprintln!("[remote] Read error from {}: {}", cid_read, e);
                                                break;
                                            }
                                            _ => {}
                                        }
                                    }
                                    // Clean up on disconnect
                                    let mut c = clients_for_read.lock().await;
                                    c.remove(&cid_read);
                                    eprintln!("[remote] Client {} removed", cid_read);
                                });
                            }
                            Err(e) => {
                                eprintln!("[remote] Accept error: {}", e);
                            }
                        }
                    }
                    _ = shutdown_rx.recv() => {
                        eprintln!("[remote] Shutting down WebSocket server");
                        break;
                    }
                }
            }

            // Mark as not running
            let mut r = running.lock().await;
            *r = false;

            // Disconnect all clients
            let mut c = clients.lock().await;
            c.clear();
        });

        Ok(())
    }

    /// Stop the server.
    pub async fn stop(&self) -> Result<(), String> {
        let tx = {
            let mut guard = self.shutdown_tx.lock().await;
            guard.take()
        };
        if let Some(tx) = tx {
            let _ = tx.send(()).await;
            // Mark as not running immediately
            let mut r = self.running.lock().await;
            *r = false;
            Ok(())
        } else {
            Err("Remote server is not running".to_string())
        }
    }

    /// Broadcast a claude event to all connected mobile clients.
    pub async fn broadcast_claude_event(&self, event: serde_json::Value) {
        let msg = serde_json::json!({
            "type": "claude_event",
            "data": event
        });
        let msg_str = serde_json::to_string(&msg).unwrap_or_default();
        let clients = self.clients.lock().await;
        for (_id, tx) in clients.iter() {
            let _ = tx.send(Message::Text(msg_str.clone().into()));
        }
    }

    /// Get connected client count.
    pub async fn client_count(&self) -> usize {
        self.clients.lock().await.len()
    }

    /// Check if the server is running.
    pub async fn is_running(&self) -> bool {
        *self.running.lock().await
    }

    /// Get local IP addresses for display on the UI.
    pub fn get_local_ips() -> Vec<String> {
        let mut ips = Vec::new();
        if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
            if socket.connect("8.8.8.8:80").is_ok() {
                if let Ok(addr) = socket.local_addr() {
                    ips.push(addr.ip().to_string());
                }
            }
        }
        ips
    }

    /// Get the port.
    pub fn port(&self) -> u16 {
        self.port
    }
}

// ---------------------------------------------------------------------------
// Handle an incoming JSON message from a mobile client
// ---------------------------------------------------------------------------

async fn handle_client_message(
    client_id: &str,
    text: &str,
    tx: &UnboundedSender<Message>,
    db: &Arc<Database>,
    claude: &Arc<ClaudeManager>,
    app: &AppHandle,
) {
    let req: ClientRequest = match serde_json::from_str(text) {
        Ok(r) => r,
        Err(e) => {
            let _ = send_error(tx, &format!("Invalid JSON: {}", e));
            return;
        }
    };

    match req.action.as_str() {
        "list_projects" => {
            match db.list_projects() {
                Ok(projects) => {
                    let resp = serde_json::json!({
                        "type": "projects",
                        "data": projects
                    });
                    let _ = tx.send(Message::Text(serde_json::to_string(&resp).unwrap_or_default().into()));
                }
                Err(e) => {
                    let _ = send_error(tx, &format!("Failed to list projects: {}", e));
                }
            }
        }

        "list_sessions" => {
            let project_id = match &req.project_id {
                Some(id) => id,
                None => {
                    let _ = send_error(tx, "Missing project_id");
                    return;
                }
            };
            match db.list_sessions(project_id) {
                Ok(sessions) => {
                    let resp = serde_json::json!({
                        "type": "sessions",
                        "data": sessions
                    });
                    let _ = tx.send(Message::Text(serde_json::to_string(&resp).unwrap_or_default().into()));
                }
                Err(e) => {
                    let _ = send_error(tx, &format!("Failed to list sessions: {}", e));
                }
            }
        }

        "get_messages" => {
            let session_id = match &req.session_id {
                Some(id) => id,
                None => {
                    let _ = send_error(tx, "Missing session_id");
                    return;
                }
            };
            match db.get_messages(session_id) {
                Ok(messages) => {
                    let resp = serde_json::json!({
                        "type": "messages",
                        "data": messages
                    });
                    let _ = tx.send(Message::Text(serde_json::to_string(&resp).unwrap_or_default().into()));
                }
                Err(e) => {
                    let _ = send_error(tx, &format!("Failed to get messages: {}", e));
                }
            }
        }

        "create_session" => {
            let project_id = match &req.project_id {
                Some(id) => id,
                None => {
                    let _ = send_error(tx, "Missing project_id");
                    return;
                }
            };
            let name = req.name.as_deref().unwrap_or("Mobile Session");
            match db.create_session(project_id, name) {
                Ok(session) => {
                    let resp = serde_json::json!({
                        "type": "session_created",
                        "data": session
                    });
                    let _ = tx.send(Message::Text(serde_json::to_string(&resp).unwrap_or_default().into()));
                }
                Err(e) => {
                    let _ = send_error(tx, &format!("Failed to create session: {}", e));
                }
            }
        }

        "send_message" => {
            let session_id = match &req.session_id {
                Some(id) => id.clone(),
                None => {
                    let _ = send_error(tx, "Missing session_id");
                    return;
                }
            };
            let message = match &req.message {
                Some(m) => m.clone(),
                None => {
                    let _ = send_error(tx, "Missing message");
                    return;
                }
            };
            let model = req.model.clone().unwrap_or_else(|| "sonnet".to_string());

            // Save the user message to DB
            if let Err(e) = db.save_message(&session_id, "user", &message, Some(&model), None, None) {
                let _ = send_error(tx, &format!("Failed to save message: {}", e));
                return;
            }

            // Look up session info (claude_session_id, project_id)
            let (claude_session_id, project_id) = {
                let conn = db.conn.lock().unwrap();
                let mut stmt = match conn
                    .prepare("SELECT claude_session_id, project_id FROM sessions WHERE id = ?1")
                {
                    Ok(s) => s,
                    Err(e) => {
                        let _ = send_error(tx, &format!("DB error: {}", e));
                        return;
                    }
                };
                let mut rows = match stmt.query(rusqlite::params![session_id]) {
                    Ok(r) => r,
                    Err(e) => {
                        let _ = send_error(tx, &format!("DB error: {}", e));
                        return;
                    }
                };
                match rows.next() {
                    Ok(Some(row)) => {
                        let csid: Option<String> = row.get(0).unwrap_or(None);
                        let pid: String = row.get(1).unwrap_or_default();
                        (csid, pid)
                    }
                    _ => {
                        let _ = send_error(tx, "Session not found");
                        return;
                    }
                }
            };

            // Look up project path
            let project_path = {
                let conn = db.conn.lock().unwrap();
                let mut stmt = match conn.prepare("SELECT path FROM projects WHERE id = ?1") {
                    Ok(s) => s,
                    Err(e) => {
                        let _ = send_error(tx, &format!("DB error: {}", e));
                        return;
                    }
                };
                let mut rows = match stmt.query(rusqlite::params![project_id]) {
                    Ok(r) => r,
                    Err(e) => {
                        let _ = send_error(tx, &format!("DB error: {}", e));
                        return;
                    }
                };
                match rows.next() {
                    Ok(Some(row)) => {
                        let p: String = row.get(0).unwrap_or_default();
                        p
                    }
                    _ => {
                        let _ = send_error(tx, "Project not found");
                        return;
                    }
                }
            };

            // Get reference dirs
            let ref_dirs: Vec<String> = db
                .list_references(&project_id)
                .unwrap_or_default()
                .iter()
                .map(|r| r.path.clone())
                .collect();

            // Enhance message for first message (no claude_session_id yet)
            let refs = db.list_references(&project_id).unwrap_or_default();
            let enhanced_message = if !ref_dirs.is_empty() && claude_session_id.is_none() {
                let ref_context: Vec<String> = refs
                    .iter()
                    .map(|r| {
                        let label = r.label.as_deref().unwrap_or("reference");
                        format!("- {} ({})", r.path, label)
                    })
                    .collect();
                format!(
                    "[Reference projects are available via --add-dir. You can read their code with Read/Glob/Grep tools for patterns and implementation reference:]\n{}\n\n{}",
                    ref_context.join("\n"),
                    message
                )
            } else {
                message
            };

            // Spawn Claude
            let spawn_result = claude
                .spawn(
                    session_id.clone(),
                    enhanced_message,
                    model,
                    claude_session_id,
                    ref_dirs,
                    project_path,
                    app.clone(),
                )
                .await;

            if let Err(e) = spawn_result {
                let _ = send_error(tx, &format!("Failed to spawn Claude: {}", e));
            }
            // Claude events will be broadcast via the global claude-event listener
        }

        "stop" => {
            let session_id = match &req.session_id {
                Some(id) => id,
                None => {
                    let _ = send_error(tx, "Missing session_id");
                    return;
                }
            };
            if let Err(e) = claude.stop(session_id).await {
                let _ = send_error(tx, &format!("Failed to stop: {}", e));
            }
        }

        _ => {
            let _ = send_error(tx, &format!("Unknown action: {}", req.action));
        }
    }
}

fn send_error(tx: &UnboundedSender<Message>, message: &str) -> Result<(), ()> {
    let resp = serde_json::json!({
        "type": "error",
        "message": message
    });
    tx.send(Message::Text(serde_json::to_string(&resp).unwrap_or_default().into()))
        .map_err(|_| ())
}

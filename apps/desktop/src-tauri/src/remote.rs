use crate::claude::ClaudeManager;
use crate::db::Database;
use futures_util::{SinkExt, StreamExt};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::net::UdpSocket;
use std::sync::Arc;
use std::time::Instant;
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
    active_pin: Arc<Mutex<Option<(String, Instant)>>>,          // (pin, expires_at)
    authenticated_clients: Arc<Mutex<HashSet<String>>>,          // client_ids
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteInfo {
    pub port: u16,
    pub ips: Vec<String>,
    pub client_count: usize,
    pub running: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TailscaleStatus {
    pub online: bool,
    pub ip: Option<String>,
    pub hostname: Option<String>,
    pub device_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionInfo {
    pub lan_ips: Vec<String>,
    pub port: u16,
    pub tailscale_ip: Option<String>,
    pub tailscale_online: bool,
}

// ---------------------------------------------------------------------------
// Tailscale detection
// ---------------------------------------------------------------------------

pub fn get_tailscale_status_sync() -> TailscaleStatus {
    let output = std::process::Command::new("tailscale")
        .args(["status", "--json"])
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let json_str = String::from_utf8_lossy(&out.stdout);
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&json_str) {
                // Check BackendState for online status
                let backend_state = parsed
                    .get("BackendState")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let online = backend_state == "Running";

                // Get self node info
                let self_node = parsed.get("Self");
                let ip = self_node
                    .and_then(|s| s.get("TailscaleIPs"))
                    .and_then(|ips| ips.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let hostname = self_node
                    .and_then(|s| s.get("HostName"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let device_name = self_node
                    .and_then(|s| s.get("DNSName"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim_end_matches('.').to_string());

                TailscaleStatus {
                    online,
                    ip,
                    hostname,
                    device_name,
                }
            } else {
                TailscaleStatus { online: false, ip: None, hostname: None, device_name: None }
            }
        }
        _ => TailscaleStatus { online: false, ip: None, hostname: None, device_name: None },
    }
}

// ---------------------------------------------------------------------------
// PIN generation
// ---------------------------------------------------------------------------

const PIN_LENGTH: usize = 6;
const PIN_EXPIRY_SECS: u64 = 300; // 5 minutes

fn generate_random_pin() -> String {
    let mut rng = rand::rng();
    let chars: Vec<char> = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".chars().collect();
    (0..PIN_LENGTH)
        .map(|_| chars[rng.random_range(0..chars.len())])
        .collect()
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
    pin: Option<String>,
}

impl RemoteServer {
    pub fn new(port: u16) -> Self {
        Self {
            port,
            clients: Arc::new(Mutex::new(HashMap::new())),
            running: Arc::new(Mutex::new(false)),
            shutdown_tx: Arc::new(Mutex::new(None)),
            active_pin: Arc::new(Mutex::new(None)),
            authenticated_clients: Arc::new(Mutex::new(HashSet::new())),
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
        let active_pin = self.active_pin.clone();
        let authenticated_clients = self.authenticated_clients.clone();

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
                                let pin_for_read = active_pin.clone();
                                let auth_for_read = authenticated_clients.clone();

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
                                                    &pin_for_read,
                                                    &auth_for_read,
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
                                    // Remove from authenticated set too
                                    let mut auth = auth_for_read.lock().await;
                                    auth.remove(&cid_read);
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

    /// Generate a new PIN and store it with expiry.
    pub async fn generate_pin(&self) -> String {
        let pin = generate_random_pin();
        let expires_at = Instant::now() + std::time::Duration::from_secs(PIN_EXPIRY_SECS);
        let mut guard = self.active_pin.lock().await;
        *guard = Some((pin.clone(), expires_at));
        pin
    }

    /// Get the active PIN if it hasn't expired.
    pub async fn get_active_pin(&self) -> Option<String> {
        let guard = self.active_pin.lock().await;
        match &*guard {
            Some((pin, expires_at)) if Instant::now() < *expires_at => Some(pin.clone()),
            _ => None,
        }
    }

    /// Get remaining seconds on the active PIN.
    pub async fn get_pin_remaining_secs(&self) -> Option<u64> {
        let guard = self.active_pin.lock().await;
        match &*guard {
            Some((_pin, expires_at)) if Instant::now() < *expires_at => {
                Some((*expires_at - Instant::now()).as_secs())
            }
            _ => None,
        }
    }

    /// Verify a PIN and authenticate a client.
    pub async fn authenticate_client(&self, client_id: &str, pin: &str) -> bool {
        let pin_guard = self.active_pin.lock().await;
        match &*pin_guard {
            Some((active_pin, expires_at)) if Instant::now() < *expires_at => {
                if pin.eq_ignore_ascii_case(active_pin) {
                    drop(pin_guard);
                    let mut clients = self.authenticated_clients.lock().await;
                    clients.insert(client_id.to_string());
                    true
                } else {
                    false
                }
            }
            _ => false,
        }
    }

    /// Check if a client is authenticated.
    pub async fn is_client_authenticated(&self, client_id: &str) -> bool {
        let clients = self.authenticated_clients.lock().await;
        clients.contains(client_id)
    }

    /// Remove a client from authenticated set (on disconnect).
    pub async fn remove_authenticated_client(&self, client_id: &str) {
        let mut clients = self.authenticated_clients.lock().await;
        clients.remove(client_id);
    }

    /// Get connection info combining LAN and Tailscale.
    pub fn get_connection_info(&self) -> ConnectionInfo {
        let ts = get_tailscale_status_sync();
        ConnectionInfo {
            lan_ips: Self::get_local_ips(),
            port: self.port,
            tailscale_ip: if ts.online { ts.ip } else { None },
            tailscale_online: ts.online,
        }
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
    active_pin: &Arc<Mutex<Option<(String, Instant)>>>,
    authenticated_clients: &Arc<Mutex<HashSet<String>>>,
) {
    let req: ClientRequest = match serde_json::from_str(text) {
        Ok(r) => r,
        Err(e) => {
            let _ = send_error(tx, &format!("Invalid JSON: {}", e));
            return;
        }
    };

    // Handle authenticate action (always allowed)
    if req.action == "authenticate" {
        let pin = match &req.pin {
            Some(p) => p.clone(),
            None => {
                let _ = send_error(tx, "Missing pin field");
                return;
            }
        };
        // Verify PIN
        let authenticated = {
            let pin_guard = active_pin.lock().await;
            match &*pin_guard {
                Some((active, expires_at)) if Instant::now() < *expires_at => {
                    pin.eq_ignore_ascii_case(active)
                }
                _ => false,
            }
        };
        if authenticated {
            let mut clients = authenticated_clients.lock().await;
            clients.insert(client_id.to_string());
            let resp = serde_json::json!({
                "type": "authenticated",
                "success": true
            });
            let _ = tx.send(Message::Text(serde_json::to_string(&resp).unwrap_or_default().into()));
        } else {
            let resp = serde_json::json!({
                "type": "authenticated",
                "success": false,
                "message": "Invalid or expired PIN"
            });
            let _ = tx.send(Message::Text(serde_json::to_string(&resp).unwrap_or_default().into()));
        }
        return;
    }

    // For all other actions, require authentication
    {
        let clients = authenticated_clients.lock().await;
        if !clients.contains(client_id) {
            let resp = serde_json::json!({
                "type": "error",
                "message": "Not authenticated. Send an 'authenticate' action with a valid PIN first."
            });
            let _ = tx.send(Message::Text(serde_json::to_string(&resp).unwrap_or_default().into()));
            return;
        }
    }

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

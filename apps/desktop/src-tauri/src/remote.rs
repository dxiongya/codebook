use crate::claude::ClaudeManager;
use crate::db::Database;
use crate::hub::auth::AuthManager;
use crate::hub::protocol::{HubRequest, HubResponse};
use crate::hub::router::HubRouter;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::UdpSocket;
use std::sync::Arc;
use tauri::{AppHandle, Listener};
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
    auth: Arc<AuthManager>,
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
                let backend_state = parsed
                    .get("BackendState")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let online = backend_state == "Running";

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

                TailscaleStatus { online, ip, hostname, device_name }
            } else {
                TailscaleStatus { online: false, ip: None, hostname: None, device_name: None }
            }
        }
        _ => TailscaleStatus { online: false, ip: None, hostname: None, device_name: None },
    }
}

// ---------------------------------------------------------------------------
// RemoteServer impl
// ---------------------------------------------------------------------------

impl RemoteServer {
    pub fn new(port: u16) -> Self {
        Self {
            port,
            clients: Arc::new(Mutex::new(HashMap::new())),
            running: Arc::new(Mutex::new(false)),
            shutdown_tx: Arc::new(Mutex::new(None)),
            auth: Arc::new(AuthManager::new()),
        }
    }

    /// Start the WebSocket server in a background task.
    pub async fn start(
        &self,
        db: Arc<Database>,
        claude: Arc<ClaudeManager>,
        app: AppHandle,
    ) -> Result<(), String> {
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
        let auth = self.auth.clone();

        // Build the router (shared across all client connections)
        let router = Arc::new(HubRouter::new(db, claude, auth.clone(), app.clone()));

        // Shutdown channel
        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
        {
            let mut tx_guard = self.shutdown_tx.lock().await;
            *tx_guard = Some(shutdown_tx);
        }

        // Broadcast claude events to all connected clients
        let broadcast_clients = self.clients.clone();
        let _event_listener = app.listen("claude-event", move |event| {
            let clients = broadcast_clients.clone();
            let payload = event.payload().to_string();

            let hub_event = if let Ok(evt) = serde_json::from_str::<serde_json::Value>(&payload) {
                serde_json::json!({ "type": "claude_event", "data": evt })
            } else {
                serde_json::json!({ "type": "claude_event", "data": payload })
            };

            let msg_str = serde_json::to_string(&hub_event).unwrap_or_default();
            tokio::spawn(async move {
                let clients_guard = clients.lock().await;
                for (_id, tx) in clients_guard.iter() {
                    let _ = tx.send(Message::Text(msg_str.clone().into()));
                }
            });
        });

        // Broadcast session-message events (user messages from desktop) to mobile clients
        let broadcast_clients2 = self.clients.clone();
        let _msg_listener = app.listen("session-message", move |event| {
            let clients = broadcast_clients2.clone();
            let payload = event.payload().to_string();

            let hub_event = if let Ok(evt) = serde_json::from_str::<serde_json::Value>(&payload) {
                serde_json::json!({ "type": "session_message", "data": evt })
            } else {
                serde_json::json!({ "type": "session_message", "data": payload })
            };

            let msg_str = serde_json::to_string(&hub_event).unwrap_or_default();
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
                                let (tx, mut rx) = mpsc::unbounded_channel::<Message>();

                                {
                                    let mut c = clients.lock().await;
                                    c.insert(client_id.clone(), tx.clone());
                                }

                                // Send connected message
                                let _ = tx.send(Message::Text(
                                    serde_json::to_string(&serde_json::json!({
                                        "type": "connected",
                                        "client_id": client_id
                                    }))
                                    .unwrap_or_default()
                                    .into(),
                                ));

                                // Write task: forward channel → WebSocket
                                let clients_for_write = clients.clone();
                                let cid_write = client_id.clone();
                                let mut ws_sender = ws_sender;
                                tokio::spawn(async move {
                                    while let Some(msg) = rx.recv().await {
                                        if ws_sender.send(msg).await.is_err() {
                                            break;
                                        }
                                    }
                                    let _ = ws_sender.close().await;
                                    clients_for_write.lock().await.remove(&cid_write);
                                    eprintln!("[remote] Write task ended for {}", cid_write);
                                });

                                // Read task: WebSocket → HubRouter
                                let clients_for_read = clients.clone();
                                let router_clone = router.clone();
                                let auth_clone = auth.clone();
                                let cid_read = client_id.clone();
                                let tx_for_read = tx.clone();

                                tokio::spawn(async move {
                                    while let Some(msg_result) = ws_receiver.next().await {
                                        match msg_result {
                                            Ok(Message::Text(text)) => {
                                                handle_message(
                                                    &cid_read,
                                                    &text,
                                                    &tx_for_read,
                                                    &router_clone,
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
                                    clients_for_read.lock().await.remove(&cid_read);
                                    auth_clone.remove_client(&cid_read).await;
                                    eprintln!("[remote] Client {} removed", cid_read);
                                });
                            }
                            Err(e) => eprintln!("[remote] Accept error: {}", e),
                        }
                    }
                    _ = shutdown_rx.recv() => {
                        eprintln!("[remote] Shutting down WebSocket server");
                        break;
                    }
                }
            }

            *running.lock().await = false;
            clients.lock().await.clear();
        });

        Ok(())
    }

    /// Stop the server.
    pub async fn stop(&self) -> Result<(), String> {
        let tx = self.shutdown_tx.lock().await.take();
        if let Some(tx) = tx {
            let _ = tx.send(()).await;
            *self.running.lock().await = false;
            Ok(())
        } else {
            Err("Remote server is not running".to_string())
        }
    }

    /// Broadcast a claude event to all connected clients.
    pub async fn broadcast_claude_event(&self, event: serde_json::Value) {
        let msg_str = serde_json::to_string(&serde_json::json!({
            "type": "claude_event",
            "data": event
        }))
        .unwrap_or_default();
        let clients = self.clients.lock().await;
        for (_id, tx) in clients.iter() {
            let _ = tx.send(Message::Text(msg_str.clone().into()));
        }
    }

    pub async fn client_count(&self) -> usize {
        self.clients.lock().await.len()
    }

    pub async fn is_running(&self) -> bool {
        *self.running.lock().await
    }

    pub fn get_local_ips() -> Vec<String> {
        // Use ifaddrs to enumerate real LAN interfaces, filtering out
        // loopback, link-local (169.254.x.x), and virtual interfaces
        // (OrbStack, Docker, etc.) that start with 198.18.x.x
        let mut ips = Vec::new();

        // Parse `ifconfig -l` style via `getifaddrs` syscall substitute:
        // Use the `hostname -I` equivalent on macOS via `ifconfig`
        if let Ok(output) = std::process::Command::new("ifconfig").output() {
            let text = String::from_utf8_lossy(&output.stdout);
            let mut current_iface = String::new();
            for line in text.lines() {
                let line = line.trim();
                // Interface name line
                if !line.starts_with(' ') && !line.starts_with('\t') && line.contains(':') {
                    current_iface = line.split(':').next().unwrap_or("").to_string();
                }
                // Skip virtual/container interfaces
                let skip = current_iface.starts_with("lo")
                    || current_iface.starts_with("utun")
                    || current_iface.starts_with("bridge")
                    || current_iface.starts_with("vboxnet")
                    || current_iface.starts_with("vmnet")
                    || current_iface.starts_with("docker")
                    || current_iface.starts_with("orb");
                if skip {
                    continue;
                }
                // Extract IPv4 address
                if line.starts_with("inet ") && !line.starts_with("inet6") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if let Some(ip_str) = parts.get(1) {
                        if let Ok(ip) = ip_str.parse::<std::net::Ipv4Addr>() {
                            let octets = ip.octets();
                            // Only real private ranges: 10.x, 172.16-31.x, 192.168.x
                            let is_private = octets[0] == 10
                                || (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31)
                                || (octets[0] == 192 && octets[1] == 168);
                            if is_private {
                                ips.push(ip.to_string());
                            }
                        }
                    }
                }
            }
        }

        // Fallback: UDP socket trick if nothing found
        if ips.is_empty() {
            if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
                if socket.connect("8.8.8.8:80").is_ok() {
                    if let Ok(addr) = socket.local_addr() {
                        ips.push(addr.ip().to_string());
                    }
                }
            }
        }

        ips
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    /// Generate a new PIN via AuthManager.
    pub async fn generate_pin(&self) -> String {
        self.auth.generate_pin().await
    }

    /// Get the active PIN if not expired.
    pub async fn get_active_pin(&self) -> Option<String> {
        self.auth.get_active_pin().await
    }

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
// Handle an incoming message from a client via HubRouter
// ---------------------------------------------------------------------------

async fn handle_message(
    client_id: &str,
    text: &str,
    tx: &UnboundedSender<Message>,
    router: &Arc<HubRouter>,
) {
    let req: HubRequest = match serde_json::from_str(text) {
        Ok(r) => r,
        Err(e) => {
            let resp = HubResponse::error("", &format!("Invalid JSON: {}", e));
            let _ = tx.send(Message::Text(
                serde_json::to_string(&resp).unwrap_or_default().into(),
            ));
            return;
        }
    };

    let resp = router.handle(client_id, req).await;
    let _ = tx.send(Message::Text(
        serde_json::to_string(&resp).unwrap_or_default().into(),
    ));
}

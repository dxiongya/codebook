use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

// ---------------------------------------------------------------------------
// Event payload sent to the frontend via `claude-event`
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeEvent {
    pub session_id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub data: serde_json::Value,
}

// ---------------------------------------------------------------------------
// Manager that tracks running Claude CLI processes
// ---------------------------------------------------------------------------

pub struct ClaudeManager {
    /// Map of internal session id -> child process handle
    processes: Arc<Mutex<HashMap<String, Child>>>,
    /// Accumulated streaming blocks per session (for when user switches away and back)
    buffers: Arc<Mutex<HashMap<String, Vec<serde_json::Value>>>>,
}

impl ClaudeManager {
    pub fn new() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
            buffers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Spawn the `claude` CLI for a chat message.
    ///
    /// * `session_id`        – internal DB session id (used as key for process tracking)
    /// * `message`           – the user prompt
    /// * `model`             – model name to pass via `--model`
    /// * `claude_session_id` – optional previous Claude session id for `--resume`
    /// * `reference_dirs`    – extra directories to pass via `--add-dir`
    /// * `project_path`      – working directory for the child process
    /// * `app`               – Tauri app handle used to emit events
    pub async fn spawn(
        &self,
        session_id: String,
        message: String,
        model: String,
        claude_session_id: Option<String>,
        reference_dirs: Vec<String>,
        project_path: String,
        app: AppHandle,
    ) -> Result<(), String> {
        let mut cmd = Command::new("claude");

        // Core args
        cmd.arg("-p")
            .arg(&message)
            .arg("--output-format")
            .arg("stream-json")
            .arg("--verbose")
            .arg("--dangerously-skip-permissions")
            .arg("--model")
            .arg(&model);

        // Resume existing conversation
        if let Some(ref sid) = claude_session_id {
            cmd.arg("--resume").arg(sid);
        }

        // Reference directories
        for dir in &reference_dirs {
            cmd.arg("--add-dir").arg(dir);
        }

        // CRITICAL: stdin must be null, not piped
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .current_dir(&project_path);

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn claude CLI: {e}"))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture stdout".to_string())?;

        // Store the child so we can kill it later
        {
            let mut procs = self.processes.lock().await;
            procs.insert(session_id.clone(), child);
        }

        // Initialize the buffer for this session
        {
            let mut bufs = self.buffers.lock().await;
            bufs.insert(session_id.clone(), Vec::new());
        }

        let processes = self.processes.clone();
        let buffers = self.buffers.clone();
        let sid = session_id.clone();

        // Spawn a background task that reads stdout line-by-line
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            // Track how many content blocks we've already sent per message ID
            // so we only forward NEW blocks (Claude CLI resends full content each time)
            let mut sent_block_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

            while let Ok(Some(line)) = lines.next_line().await {
                if line.trim().is_empty() {
                    continue;
                }

                let parsed: serde_json::Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                let event = match parsed.get("type").and_then(|t| t.as_str()) {
                    Some("system") => {
                        let subtype = parsed
                            .get("subtype")
                            .and_then(|s| s.as_str())
                            .unwrap_or("");
                        if subtype == "init" {
                            Some(ClaudeEvent {
                                session_id: sid.clone(),
                                event_type: "system_init".to_string(),
                                data: parsed.clone(),
                            })
                        } else {
                            Some(ClaudeEvent {
                                session_id: sid.clone(),
                                event_type: format!("system_{subtype}"),
                                data: parsed.clone(),
                            })
                        }
                    }
                    Some("assistant") => {
                        // Extract content blocks from message.content
                        let full_content = parsed
                            .get("message")
                            .and_then(|m| m.get("content"))
                            .cloned()
                            .unwrap_or(serde_json::Value::Array(vec![]));

                        let msg_id = parsed
                            .get("message")
                            .and_then(|m| m.get("id"))
                            .and_then(|id| id.as_str())
                            .unwrap_or("")
                            .to_string();

                        // Calculate new blocks only (CLI sends full content each time)
                        let all_blocks = full_content.as_array().cloned().unwrap_or_default();
                        let prev_count = sent_block_counts.get(&msg_id).copied().unwrap_or(0);
                        let new_blocks: Vec<serde_json::Value> = all_blocks[prev_count..].to_vec();
                        sent_block_counts.insert(msg_id, all_blocks.len());

                        if new_blocks.is_empty() {
                            // No new blocks — skip this event
                            None
                        } else {
                            // Store only new blocks in the per-session buffer
                            {
                                let mut bufs = buffers.lock().await;
                                if let Some(buf) = bufs.get_mut(&sid) {
                                    buf.push(serde_json::Value::Array(new_blocks.clone()));
                                }
                            }

                            let mut data = serde_json::Map::new();
                            data.insert("content".to_string(), serde_json::Value::Array(new_blocks));
                            if let Some(msg) = parsed.get("message") {
                                data.insert("message".to_string(), msg.clone());
                            }

                            Some(ClaudeEvent {
                                session_id: sid.clone(),
                                event_type: "assistant".to_string(),
                                data: serde_json::Value::Object(data),
                            })
                        }
                    }
                    Some("result") => {
                        // Clear the buffer for this session (streaming is done)
                        {
                            let mut bufs = buffers.lock().await;
                            bufs.remove(&sid);
                        }
                        Some(ClaudeEvent {
                            session_id: sid.clone(),
                            event_type: "result".to_string(),
                            data: parsed.clone(),
                        })
                    }
                    Some("content_block_delta") | Some("content_block_start") | Some("content_block_stop") => {
                        Some(ClaudeEvent {
                            session_id: sid.clone(),
                            event_type: parsed["type"].as_str().unwrap_or("unknown").to_string(),
                            data: parsed.clone(),
                        })
                    }
                    _ => {
                        // Forward unknown types as-is
                        Some(ClaudeEvent {
                            session_id: sid.clone(),
                            event_type: parsed
                                .get("type")
                                .and_then(|t| t.as_str())
                                .unwrap_or("unknown")
                                .to_string(),
                            data: parsed.clone(),
                        })
                    }
                };

                if let Some(evt) = event {
                    let _ = app.emit("claude-event", &evt);
                }
            }

            // Process finished – clean up
            {
                let mut bufs = buffers.lock().await;
                bufs.remove(&sid);
            }
            let mut procs = processes.lock().await;
            procs.remove(&sid);

            // Emit a process-done event so the frontend knows streaming ended
            let _ = app.emit("claude-event", &ClaudeEvent {
                session_id: sid.clone(),
                event_type: "process_done".to_string(),
                data: serde_json::Value::Null,
            });
        });

        Ok(())
    }

    /// Kill a running Claude process for the given session.
    pub async fn stop(&self, session_id: &str) -> Result<(), String> {
        let mut procs = self.processes.lock().await;
        if let Some(mut child) = procs.remove(session_id) {
            child
                .kill()
                .await
                .map_err(|e| format!("Failed to kill process: {e}"))?;
            Ok(())
        } else {
            Err("No running process for this session".to_string())
        }
    }

    /// Get the accumulated streaming buffer for a session.
    pub async fn get_buffer(&self, session_id: &str) -> Vec<serde_json::Value> {
        let bufs = self.buffers.lock().await;
        bufs.get(session_id).cloned().unwrap_or_default()
    }

    /// Check if a Claude process is currently running for the given session.
    pub async fn is_running(&self, session_id: &str) -> bool {
        let procs = self.processes.lock().await;
        procs.contains_key(session_id)
    }

    /// Clear the streaming buffer for a session.
    pub async fn clear_buffer(&self, session_id: &str) {
        let mut bufs = self.buffers.lock().await;
        bufs.remove(session_id);
    }

    /// Kill all running Claude processes (called on app exit).
    pub fn kill_all_sync(&self) {
        // Use try_lock since this is called from a sync context during shutdown
        if let Ok(mut procs) = self.processes.try_lock() {
            for (sid, mut child) in procs.drain() {
                eprintln!("[codebook] Killing Claude process for session {sid}");
                // Use start_kill() which is non-async
                let _ = child.start_kill();
            }
        }
    }
}

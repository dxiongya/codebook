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
}

impl ClaudeManager {
    pub fn new() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
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

        let processes = self.processes.clone();
        let sid = session_id.clone();

        // Spawn a background task that reads stdout line-by-line
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

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
                        let content = parsed
                            .get("message")
                            .and_then(|m| m.get("content"))
                            .cloned()
                            .unwrap_or(serde_json::Value::Array(vec![]));

                        let mut data = serde_json::Map::new();
                        data.insert("content".to_string(), content);
                        // Forward the full message for any extra fields
                        if let Some(msg) = parsed.get("message") {
                            data.insert("message".to_string(), msg.clone());
                        }

                        Some(ClaudeEvent {
                            session_id: sid.clone(),
                            event_type: "assistant".to_string(),
                            data: serde_json::Value::Object(data),
                        })
                    }
                    Some("result") => Some(ClaudeEvent {
                        session_id: sid.clone(),
                        event_type: "result".to_string(),
                        data: parsed.clone(),
                    }),
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
            let mut procs = processes.lock().await;
            procs.remove(&sid);
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

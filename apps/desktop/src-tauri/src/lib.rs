mod claude;
mod db;
mod git;
mod hub;
mod remote;

use claude::ClaudeManager;
use db::{Checkpoint, Database, Message, Project, ReferenceDir, Session};
use remote::{ConnectionInfo, RemoteInfo, RemoteServer, TailscaleStatus};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

// ---------------------------------------------------------------------------
// App state wrappers
// ---------------------------------------------------------------------------

struct DbState(Arc<Database>);
struct ClaudeState(Arc<ClaudeManager>);
struct RemoteState(Arc<RemoteServer>);

// ---------------------------------------------------------------------------
// Tauri commands – Projects
// ---------------------------------------------------------------------------

#[tauri::command]
fn create_project(db: State<DbState>, name: String, path: String) -> Result<Project, String> {
    db.0.create_project(&name, &path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_projects(db: State<DbState>) -> Result<Vec<Project>, String> {
    db.0.list_projects().map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_project(db: State<DbState>, id: String) -> Result<(), String> {
    db.0.delete_project(&id).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Tauri commands – Sessions
// ---------------------------------------------------------------------------

#[tauri::command]
fn create_session(
    db: State<DbState>,
    project_id: String,
    name: String,
) -> Result<Session, String> {
    db.0.create_session(&project_id, &name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_sessions(db: State<DbState>, project_id: String) -> Result<Vec<Session>, String> {
    db.0.list_sessions(&project_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_session(db: State<DbState>, id: String) -> Result<(), String> {
    db.0.delete_session(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_session(db: State<DbState>, id: String, name: String) -> Result<(), String> {
    let conn = db.0.conn.lock().unwrap();
    conn.execute(
        "UPDATE sessions SET name = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![name, chrono::Utc::now().to_rfc3339(), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands – Messages
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_messages(db: State<DbState>, session_id: String, limit: Option<u32>, before: Option<String>) -> Result<Vec<Message>, String> {
    db.0.get_messages_paginated(&session_id, limit, before.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn save_message(
    db: State<DbState>,
    session_id: String,
    role: String,
    content: String,
    model: Option<String>,
    cost: Option<f64>,
    duration_ms: Option<i64>,
) -> Result<Message, String> {
    db.0.save_message(
        &session_id,
        &role,
        &content,
        model.as_deref(),
        cost,
        duration_ms,
    )
    .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Tauri commands – Reference dirs
// ---------------------------------------------------------------------------

#[tauri::command]
fn add_reference(
    db: State<DbState>,
    project_id: String,
    path: String,
    label: Option<String>,
) -> Result<ReferenceDir, String> {
    db.0.add_reference(&project_id, &path, label.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_references(
    db: State<DbState>,
    project_id: String,
) -> Result<Vec<ReferenceDir>, String> {
    db.0.list_references(&project_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_reference(db: State<DbState>, id: String) -> Result<(), String> {
    db.0.remove_reference(&id).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Tauri commands – Settings
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_setting(db: State<DbState>, key: String) -> Result<Option<String>, String> {
    db.0.get_setting(&key).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_setting(db: State<DbState>, key: String, value: String) -> Result<(), String> {
    db.0.set_setting(&key, &value).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Tauri commands – Checkpoints
// ---------------------------------------------------------------------------

#[tauri::command]
fn save_checkpoint(
    db: State<DbState>,
    session_id: String,
    message_id: String,
    git_commit_hash: Option<String>,
    git_diff_summary: Option<String>,
    project_path: String,
) -> Result<Checkpoint, String> {
    db.0.save_checkpoint(
        &session_id,
        &message_id,
        git_commit_hash.as_deref(),
        git_diff_summary.as_deref(),
        &project_path,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_checkpoints(db: State<DbState>, session_id: String) -> Result<Vec<Checkpoint>, String> {
    db.0.get_checkpoints(&session_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn rollback_to_checkpoint(project_path: String, commit_hash: String) -> Result<(), String> {
    // First stash any uncommitted changes
    let stash_output = std::process::Command::new("git")
        .args(["-C", &project_path, "stash"])
        .output()
        .map_err(|e| format!("Failed to run git stash: {}", e))?;

    if !stash_output.status.success() {
        let stderr = String::from_utf8_lossy(&stash_output.stderr);
        return Err(format!("git stash failed: {}", stderr));
    }

    // Then checkout the target commit
    let checkout_output = std::process::Command::new("git")
        .args(["-C", &project_path, "checkout", &commit_hash])
        .output()
        .map_err(|e| format!("Failed to run git checkout: {}", e))?;

    if !checkout_output.status.success() {
        let stderr = String::from_utf8_lossy(&checkout_output.stderr);
        return Err(format!("git checkout failed: {}", stderr));
    }

    Ok(())
}

#[derive(serde::Serialize)]
struct ClaudeCliConfig {
    plugins: Vec<serde_json::Value>,
    skills: Vec<String>,
    mcp_servers: serde_json::Value,
    settings: serde_json::Value,
}

#[tauri::command]
fn get_claude_cli_config() -> Result<ClaudeCliConfig, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let claude_dir = home.join(".claude");

    // Read installed plugins
    let plugins_path = claude_dir.join("plugins/installed_plugins.json");
    let plugins = if plugins_path.exists() {
        let content = std::fs::read_to_string(&plugins_path).unwrap_or_default();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap_or_default();
        if let Some(obj) = parsed.get("plugins").and_then(|p| p.as_object()) {
            obj.iter().map(|(name, entries)| {
                let version = entries.as_array()
                    .and_then(|arr| arr.first())
                    .and_then(|e| e.get("version"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown");
                let scope = entries.as_array()
                    .and_then(|arr| arr.first())
                    .and_then(|e| e.get("scope"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("user");
                serde_json::json!({ "name": name, "version": version, "scope": scope })
            }).collect()
        } else {
            vec![]
        }
    } else {
        vec![]
    };

    // Read skills (directories under ~/.claude/skills/)
    let skills_dir = claude_dir.join("skills");
    let skills = if skills_dir.exists() {
        std::fs::read_dir(&skills_dir)
            .map(|rd| {
                rd.filter_map(|e| e.ok())
                    .filter(|e| e.path().is_dir())
                    .map(|e| e.file_name().to_string_lossy().to_string())
                    .collect()
            })
            .unwrap_or_default()
    } else {
        vec![]
    };

    // Read settings.json (contains MCP servers, permissions, etc)
    let settings_path = claude_dir.join("settings.json");
    let settings: serde_json::Value = if settings_path.exists() {
        let content = std::fs::read_to_string(&settings_path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        serde_json::Value::Object(serde_json::Map::new())
    };

    let mcp_servers = settings.get("mcpServers").cloned()
        .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));

    Ok(ClaudeCliConfig {
        plugins,
        skills,
        mcp_servers,
        settings,
    })
}

#[derive(serde::Serialize)]
struct GitSnapshot {
    commit_hash: String,
    diff_summary: String,
}

#[tauri::command]
fn get_git_snapshot(project_path: String) -> Result<GitSnapshot, String> {
    // Get current commit hash
    let hash_output = std::process::Command::new("git")
        .args(["-C", &project_path, "rev-parse", "HEAD"])
        .output()
        .map_err(|e| format!("Failed to run git rev-parse: {}", e))?;

    let commit_hash = if hash_output.status.success() {
        String::from_utf8_lossy(&hash_output.stdout).trim().to_string()
    } else {
        String::new()
    };

    // Get diff summary
    let diff_output = std::process::Command::new("git")
        .args(["-C", &project_path, "diff", "--stat"])
        .output()
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    let diff_summary = if diff_output.status.success() {
        String::from_utf8_lossy(&diff_output.stdout).trim().to_string()
    } else {
        String::new()
    };

    Ok(GitSnapshot {
        commit_hash,
        diff_summary,
    })
}

/// Generate a commit message using Claude CLI based on staged changes
#[tauri::command]
async fn generate_commit_message(project_path: String, files: Option<Vec<String>>) -> Result<String, String> {
    // Get the diff content for context
    let diff_output = std::process::Command::new("git")
        .args(["-C", &project_path, "diff", "--staged"])
        .output()
        .or_else(|_| {
            // If nothing staged, get unstaged diff
            std::process::Command::new("git")
                .args(["-C", &project_path, "diff"])
                .output()
        })
        .map_err(|e| format!("Failed to get diff: {}", e))?;

    let diff = String::from_utf8_lossy(&diff_output.stdout);

    // Truncate diff if too long (keep first 3000 chars)
    let diff_context = if diff.len() > 3000 {
        format!("{}...\n[truncated, {} total chars]", &diff[..3000], diff.len())
    } else {
        diff.to_string()
    };

    if diff_context.trim().is_empty() {
        return Err("No changes to generate commit message for".to_string());
    }

    // Get diff stat for summary
    let stat_output = std::process::Command::new("git")
        .args(["-C", &project_path, "diff", "--stat"])
        .output()
        .map_err(|e| format!("Failed to get diff stat: {}", e))?;
    let stat = String::from_utf8_lossy(&stat_output.stdout);

    let prompt = format!(
        "Generate a concise git commit message for these changes. Use conventional commits format (feat/fix/refactor/docs/chore). One line summary, optionally followed by a blank line and bullet points for details. Be specific about what changed. Output ONLY the commit message, nothing else.\n\nDiff stat:\n{}\n\nDiff:\n{}",
        stat.trim(),
        diff_context
    );

    let output = std::process::Command::new("claude")
        .args(["-p", &prompt, "--max-tokens", "200", "--model", "haiku"])
        .current_dir(&project_path)
        .output()
        .map_err(|e| format!("Failed to run claude: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Claude failed: {}", stderr));
    }

    let msg = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(msg)
}

// ---------------------------------------------------------------------------
// Tauri commands – Import CLI sessions
// ---------------------------------------------------------------------------

#[tauri::command]
fn import_cli_sessions(
    db: State<DbState>,
    project_path: String,
    project_id: String,
) -> Result<Vec<Session>, String> {
    // Find ~/.claude/history.jsonl
    let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
    let history_path = home.join(".claude").join("history.jsonl");

    if !history_path.exists() {
        return Ok(vec![]);
    }

    let content =
        std::fs::read_to_string(&history_path).map_err(|e| format!("Failed to read history.jsonl: {e}"))?;

    // Parse each line from history.jsonl to find sessions for this project
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct HistoryEntry {
        display: Option<String>,
        #[serde(default)]
        timestamp: Option<i64>,
        project: Option<String>,
        session_id: Option<String>,
    }

    // Collect matching session IDs and their first display text from history.jsonl
    let mut session_info: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let entry: HistoryEntry = match serde_json::from_str(line) {
            Ok(e) => e,
            Err(_) => continue,
        };
        // Filter: project must match
        let proj = match &entry.project {
            Some(p) => p.clone(),
            None => continue,
        };
        if proj != project_path {
            continue;
        }
        let sid = match &entry.session_id {
            Some(s) => s.clone(),
            None => continue,
        };
        // Only store the first display text per session (for the session name)
        if !session_info.contains_key(&sid) {
            let display = entry.display.unwrap_or_else(|| "CLI Session".to_string());
            session_info.insert(sid, display);
        }
    }

    if session_info.is_empty() {
        return Ok(vec![]);
    }

    // Check which claude_session_ids are already imported
    let existing: std::collections::HashSet<String> = {
        let conn = db.0.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT claude_session_id FROM sessions WHERE project_id = ?1 AND claude_session_id IS NOT NULL")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![project_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };

    // Build the path to the conversation JSONL files:
    // ~/.claude/projects/<encoded-project-path>/<session-id>.jsonl
    // The project path is encoded by replacing '/' with '-'
    let claude_projects_dir = home.join(".claude").join("projects");
    let encoded_project = project_path.replace('/', "-");

    let mut imported: Vec<Session> = Vec::new();

    for (claude_sid, first_display) in &session_info {
        // Skip if already imported
        if existing.contains(claude_sid) {
            continue;
        }

        // Session name = first display text truncated to 30 chars
        let name: String = if first_display.len() > 30 {
            format!("{}...", &first_display[..30])
        } else {
            first_display.to_string()
        };

        // Create session in DB
        let now = chrono::Utc::now().to_rfc3339();
        let session_id = uuid::Uuid::new_v4().to_string();
        {
            let conn = db.0.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO sessions (id, project_id, name, claude_session_id, model, total_cost, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, NULL, NULL, ?5, ?6)",
                rusqlite::params![session_id, project_id, name, claude_sid, now, now],
            )
            .map_err(|e| e.to_string())?;
        }

        // Try to read the conversation JSONL file for full messages (user + assistant)
        let conversation_path = claude_projects_dir
            .join(&encoded_project)
            .join(format!("{}.jsonl", claude_sid));

        if conversation_path.exists() {
            // Read conversation file and import both user and assistant messages
            if let Ok(conv_content) = std::fs::read_to_string(&conversation_path) {
                // Conversation entry structure from Claude CLI JSONL
                #[derive(serde::Deserialize)]
                struct ConvEntry {
                    #[serde(rename = "type")]
                    entry_type: Option<String>,
                    message: Option<ConvMessage>,
                    timestamp: Option<serde_json::Value>,
                }

                #[derive(serde::Deserialize)]
                struct ConvMessage {
                    role: Option<String>,
                    content: Option<serde_json::Value>,
                }

                // Parsed message ready for DB insertion
                struct ParsedMsg {
                    role: String,
                    content: String,
                    timestamp: i64,
                }

                let mut messages: Vec<ParsedMsg> = Vec::new();
                let mut msg_index: i64 = 0;

                for conv_line in conv_content.lines() {
                    let conv_line = conv_line.trim();
                    if conv_line.is_empty() {
                        continue;
                    }
                    let entry: ConvEntry = match serde_json::from_str(conv_line) {
                        Ok(e) => e,
                        Err(_) => continue,
                    };

                    // Only process user and assistant message types
                    let entry_type = match &entry.entry_type {
                        Some(t) => t.clone(),
                        None => continue,
                    };
                    if entry_type != "user" && entry_type != "assistant" {
                        continue;
                    }

                    let msg = match entry.message {
                        Some(m) => m,
                        None => continue,
                    };

                    let role = match &msg.role {
                        Some(r) => r.clone(),
                        None => continue,
                    };
                    if role != "user" && role != "assistant" {
                        continue;
                    }

                    let content_val = match msg.content {
                        Some(c) => c,
                        None => continue,
                    };

                    // Extract timestamp for ordering (use numeric ms or index as fallback)
                    let ts = match &entry.timestamp {
                        Some(serde_json::Value::Number(n)) => {
                            n.as_i64().unwrap_or(msg_index)
                        }
                        Some(serde_json::Value::String(s)) => {
                            chrono::DateTime::parse_from_rfc3339(s)
                                .map(|dt| dt.timestamp_millis())
                                .unwrap_or(msg_index)
                        }
                        _ => msg_index,
                    };
                    msg_index += 1;

                    // Build the content string based on role
                    let content_str = match role.as_str() {
                        "user" => {
                            // For user messages: extract text from content
                            match &content_val {
                                serde_json::Value::String(s) => s.clone(),
                                serde_json::Value::Array(arr) => {
                                    let texts: Vec<String> = arr
                                        .iter()
                                        .filter_map(|block| {
                                            if let Some(obj) = block.as_object() {
                                                if obj.get("type").and_then(|t| t.as_str()) == Some("text") {
                                                    return obj.get("text").and_then(|t| t.as_str()).map(|s| s.to_string());
                                                }
                                            }
                                            None
                                        })
                                        .collect();
                                    if texts.is_empty() {
                                        continue;
                                    }
                                    texts.join("\n")
                                }
                                _ => continue,
                            }
                        }
                        "assistant" => {
                            // For assistant messages: serialize the full content blocks as JSON
                            // This preserves thinking, tool_use, text blocks etc.
                            serde_json::to_string(&content_val).unwrap_or_default()
                        }
                        _ => continue,
                    };

                    if content_str.is_empty() {
                        continue;
                    }

                    messages.push(ParsedMsg {
                        role,
                        content: content_str,
                        timestamp: ts,
                    });
                }

                // Sort by timestamp to maintain chronological order
                messages.sort_by_key(|m| m.timestamp);

                // Save all messages in order
                for msg in &messages {
                    let _ = db.0.save_message(
                        &session_id,
                        &msg.role,
                        &msg.content,
                        None,
                        None,
                        None,
                    );
                }
            }
        } else {
            // Fallback: no conversation file found, save the display text as user message
            let _ = db.0.save_message(&session_id, "user", first_display, None, None, None);
        }

        imported.push(Session {
            id: session_id.clone(),
            project_id: project_id.clone(),
            name: name.clone(),
            claude_session_id: Some(claude_sid.clone()),
            model: None,
            total_cost: None,
            cli_type: Some("claude".to_string()),
            created_at: now.clone(),
            updated_at: now,
        });
    }

    Ok(imported)
}

// ---------------------------------------------------------------------------
// Tauri commands – CLI session sync
// ---------------------------------------------------------------------------

/// Incrementally sync a CLI session's conversation file with the DB.
/// Returns the number of new messages imported.
#[tauri::command]
fn sync_cli_session(
    db: State<DbState>,
    session_id: String,
    project_path: String,
) -> Result<u32, String> {
    // Look up the claude_session_id
    let claude_sid = {
        let conn = db.0.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT claude_session_id FROM sessions WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query(rusqlite::params![session_id]).map_err(|e| e.to_string())?;
        match rows.next().map_err(|e| e.to_string())? {
            Some(row) => row.get::<_, Option<String>>(0).unwrap_or(None),
            None => None,
        }
    };

    let claude_sid = match claude_sid {
        Some(s) if !s.is_empty() => s,
        _ => return Ok(0), // Not a CLI session
    };

    // Build conversation file path
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let encoded_project = project_path.replace('/', "-");
    let conv_path = home.join(".claude").join("projects").join(&encoded_project).join(format!("{}.jsonl", claude_sid));

    if !conv_path.exists() {
        return Ok(0);
    }

    // Get existing message count and last timestamp
    let existing_count: u32 = {
        let conn = db.0.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT COUNT(*) FROM messages WHERE session_id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_row(rusqlite::params![session_id], |row| row.get(0))
            .unwrap_or(0)
    };

    // Parse all messages from conversation file
    let conv_content = std::fs::read_to_string(&conv_path)
        .map_err(|e| format!("Failed to read conversation file: {}", e))?;

    #[derive(serde::Deserialize)]
    struct ConvEntry {
        #[serde(rename = "type")]
        entry_type: Option<String>,
        message: Option<ConvMessage>,
        timestamp: Option<serde_json::Value>,
    }

    #[derive(serde::Deserialize)]
    struct ConvMessage {
        role: Option<String>,
        content: Option<serde_json::Value>,
    }

    struct ParsedMsg {
        role: String,
        content: String,
        timestamp: i64,
    }

    let mut all_messages: Vec<ParsedMsg> = Vec::new();
    let mut msg_index: i64 = 0;

    for line in conv_content.lines() {
        let line = line.trim();
        if line.is_empty() { continue; }
        let entry: ConvEntry = match serde_json::from_str(line) {
            Ok(e) => e,
            Err(_) => continue,
        };
        let entry_type = match &entry.entry_type {
            Some(t) => t.clone(),
            None => continue,
        };
        if entry_type != "user" && entry_type != "assistant" { continue; }
        let msg = match entry.message { Some(m) => m, None => continue };
        let role = match &msg.role { Some(r) => r.clone(), None => continue };
        if role != "user" && role != "assistant" { continue; }
        let content_val = match msg.content { Some(c) => c, None => continue };

        let ts = match &entry.timestamp {
            Some(serde_json::Value::Number(n)) => n.as_i64().unwrap_or(msg_index),
            Some(serde_json::Value::String(s)) => {
                chrono::DateTime::parse_from_rfc3339(s)
                    .map(|dt| dt.timestamp_millis())
                    .unwrap_or(msg_index)
            }
            _ => msg_index,
        };
        msg_index += 1;

        let content_str = match role.as_str() {
            "user" => match &content_val {
                serde_json::Value::String(s) => s.clone(),
                serde_json::Value::Array(arr) => {
                    let texts: Vec<String> = arr.iter().filter_map(|block| {
                        block.as_object().and_then(|obj| {
                            if obj.get("type").and_then(|t| t.as_str()) == Some("text") {
                                obj.get("text").and_then(|t| t.as_str()).map(|s| s.to_string())
                            } else { None }
                        })
                    }).collect();
                    if texts.is_empty() { continue; }
                    texts.join("\n")
                }
                _ => continue,
            },
            "assistant" => serde_json::to_string(&content_val).unwrap_or_default(),
            _ => continue,
        };

        if content_str.is_empty() { continue; }
        all_messages.push(ParsedMsg { role, content: content_str, timestamp: ts });
    }

    all_messages.sort_by_key(|m| m.timestamp);

    // Only import messages beyond what we already have
    let new_count = all_messages.len() as u32;
    if new_count <= existing_count {
        return Ok(0); // No new messages
    }

    let to_import = &all_messages[existing_count as usize..];
    for msg in to_import {
        let _ = db.0.save_message(&session_id, &msg.role, &msg.content, None, None, None);
    }

    Ok(to_import.len() as u32)
}

// ---------------------------------------------------------------------------
// Tauri commands – Chat (async, interacts with Claude CLI)
// ---------------------------------------------------------------------------

#[tauri::command]
async fn send_chat_message(
    app: AppHandle,
    db: State<'_, DbState>,
    claude: State<'_, ClaudeState>,
    session_id: String,
    message: String,
    model: Option<String>,
) -> Result<(), String> {
    // Look up session info (claude_session_id, project_id) in one query
    let (claude_session_id, project_id): (Option<String>, String) = {
        let conn = db.0.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT claude_session_id, project_id FROM sessions WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query(rusqlite::params![session_id])
            .map_err(|e| e.to_string())?;
        match rows.next().map_err(|e| e.to_string())? {
            Some(row) => (
                row.get(0).map_err(|e| e.to_string())?,
                row.get(1).map_err(|e| e.to_string())?,
            ),
            None => return Err("Session not found".to_string()),
        }
    };

    // Look up project path
    let project_path: String = {
        let conn = db.0.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT path FROM projects WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query(rusqlite::params![project_id])
            .map_err(|e| e.to_string())?;
        match rows.next().map_err(|e| e.to_string())? {
            Some(row) => row.get(0).map_err(|e| e.to_string())?,
            None => return Err("Project not found".to_string()),
        }
    };

    // Get reference dirs
    let refs = db
        .0
        .list_references(&project_id)
        .map_err(|e| e.to_string())?;
    let ref_dirs: Vec<String> = refs.iter().map(|r| r.path.clone()).collect();

    // Enhance message with reference project context (first message only)
    let enhanced_message = if !ref_dirs.is_empty() && claude_session_id.is_none() {
        let ref_context: Vec<String> = refs
            .iter()
            .map(|r| {
                let label = r.label.as_deref().unwrap_or("reference");
                format!("- {} ({})", r.path, label)
            })
            .collect();
        format!(
            "[IMPORTANT: The following are READ-ONLY reference projects. You may read their code for patterns and inspiration, but NEVER write/edit files in these directories. All new code must be written in the current working directory ONLY.]\n\nReference projects:\n{}\n\n{}",
            ref_context.join("\n"),
            message
        )
    } else {
        message
    };

    let model = model.unwrap_or_else(|| "sonnet".to_string());

    claude
        .0
        .spawn(
            session_id,
            enhanced_message,
            model,
            claude_session_id,
            ref_dirs,
            project_path,
            app,
        )
        .await
}

#[tauri::command]
async fn stop_chat(claude: State<'_, ClaudeState>, session_id: String) -> Result<(), String> {
    claude.0.stop(&session_id).await
}

#[tauri::command]
fn update_session_claude_id(
    db: State<DbState>,
    session_id: String,
    claude_session_id: String,
) -> Result<(), String> {
    let conn = db.0.conn.lock().unwrap();
    conn.execute(
        "UPDATE sessions SET claude_session_id = ?1 WHERE id = ?2",
        rusqlite::params![claude_session_id, session_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn is_session_streaming(
    claude: State<'_, ClaudeState>,
    session_id: String,
) -> Result<bool, String> {
    Ok(claude.0.is_running(&session_id).await)
}

#[tauri::command]
async fn get_streaming_buffer(
    claude: State<'_, ClaudeState>,
    session_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    Ok(claude.0.get_buffer(&session_id).await)
}

// ---------------------------------------------------------------------------
// Tauri commands – File explorer
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    child_count: Option<u32>,
}

#[tauri::command]
fn list_dir(dir_path: String) -> Result<Vec<FileEntry>, String> {
    let path = std::path::Path::new(&dir_path);
    if !path.is_dir() {
        return Err("Not a directory".to_string());
    }
    let mut entries: Vec<FileEntry> = Vec::new();
    let rd = std::fs::read_dir(path).map_err(|e| e.to_string())?;
    for entry in rd {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" || name == "target" || name == "__pycache__" || name == "dist" || name == "build" || name == ".git" {
            continue;
        }
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        let is_dir = meta.is_dir();
        // For directories, count visible children
        let child_count = if is_dir {
            let count = std::fs::read_dir(entry.path())
                .map(|rd| {
                    rd.filter_map(|e| e.ok())
                        .filter(|e| {
                            let n = e.file_name().to_string_lossy().to_string();
                            !n.starts_with('.') && n != "node_modules" && n != "target" && n != "__pycache__" && n != "dist" && n != "build"
                        })
                        .count() as u32
                })
                .unwrap_or(0);
            Some(count)
        } else {
            None
        };
        entries.push(FileEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir,
            size: meta.len(),
            child_count,
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[derive(serde::Serialize)]
struct FileContent {
    path: String,
    content: String,
    language: String,
    size: u64,
}

#[tauri::command]
fn read_file_content(file_path: String) -> Result<FileContent, String> {
    let path = std::path::Path::new(&file_path);
    if !path.is_file() {
        return Err("Not a file".to_string());
    }
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    // Don't read files > 2MB
    if meta.len() > 2 * 1024 * 1024 {
        return Err("File too large (>2MB)".to_string());
    }
    let content = std::fs::read_to_string(path).map_err(|_| "Binary or unreadable file".to_string())?;
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let language = git::detect_language_pub(ext).to_string();
    Ok(FileContent {
        path: file_path,
        content,
        language,
        size: meta.len(),
    })
}

// ---------------------------------------------------------------------------
// Tauri commands – Git
// ---------------------------------------------------------------------------

#[tauri::command]
fn git_status(project_path: String) -> Result<Vec<git::FileChange>, String> {
    git::git_status(&project_path)
}

#[tauri::command]
fn git_diff_file(project_path: String, file_path: String) -> Result<git::DiffResult, String> {
    git::git_diff_file(&project_path, &file_path)
}

#[tauri::command]
fn git_commit(project_path: String, message: String, files: Option<Vec<String>>) -> Result<git::GitCommitResult, String> {
    git::git_commit(&project_path, &message, files)
}

#[tauri::command]
fn git_push(project_path: String) -> Result<(), String> {
    git::git_push(&project_path)
}

#[tauri::command]
fn git_pull(project_path: String) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .args(["-C", &project_path, "pull"])
        .output()
        .map_err(|e| format!("Failed to run git pull: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git pull failed: {}", stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
fn git_branch(project_path: String) -> Result<String, String> {
    git::git_branch(&project_path)
}

#[tauri::command]
fn git_list_branches(project_path: String) -> Result<Vec<String>, String> {
    git::git_list_branches(&project_path)
}

#[tauri::command]
fn git_checkout(project_path: String, branch: String) -> Result<String, String> {
    git::git_checkout(&project_path, &branch)
}

#[tauri::command]
fn discover_git_repos(project_path: String) -> Vec<git::GitRepo> {
    git::discover_git_repos(&project_path)
}

// ---------------------------------------------------------------------------
// Tauri commands – Remote access
// ---------------------------------------------------------------------------

#[tauri::command]
async fn get_remote_info(remote: State<'_, RemoteState>) -> Result<RemoteInfo, String> {
    Ok(RemoteInfo {
        port: remote.0.port(),
        ips: RemoteServer::get_local_ips(),
        client_count: remote.0.client_count().await,
        running: remote.0.is_running().await,
    })
}

#[tauri::command]
async fn start_remote_server(
    app: AppHandle,
    db: State<'_, DbState>,
    claude: State<'_, ClaudeState>,
    remote: State<'_, RemoteState>,
) -> Result<(), String> {
    remote
        .0
        .start(db.0.clone(), claude.0.clone(), app)
        .await
}

#[tauri::command]
async fn stop_remote_server(remote: State<'_, RemoteState>) -> Result<(), String> {
    remote.0.stop().await
}

#[tauri::command]
fn get_tailscale_status() -> TailscaleStatus {
    remote::get_tailscale_status_sync()
}

#[tauri::command]
fn get_connection_info(remote: State<'_, RemoteState>) -> ConnectionInfo {
    remote.0.get_connection_info()
}

#[tauri::command]
async fn generate_pin(remote: State<'_, RemoteState>) -> Result<String, String> {
    Ok(remote.0.generate_pin().await)
}

#[tauri::command]
async fn get_active_pin(remote: State<'_, RemoteState>) -> Result<Option<String>, String> {
    Ok(remote.0.get_active_pin().await)
}

// ---------------------------------------------------------------------------
// Tauri commands – Open in terminal
// ---------------------------------------------------------------------------

#[tauri::command]
fn open_in_terminal(path: String, terminal: Option<String>) -> Result<(), String> {
    // Use user's preferred terminal, fall back to system default
    let app = terminal.unwrap_or_else(|| {
        // Try to detect default terminal: iTerm2 > Warp > Kitty > Alacritty > Terminal
        let candidates = [
            "/Applications/iTerm.app",
            "/Applications/Warp.app",
            "/Applications/kitty.app",
            "/Applications/Alacritty.app",
        ];
        for c in &candidates {
            if std::path::Path::new(c).exists() {
                return c.to_string();
            }
        }
        "Terminal".to_string()
    });

    std::process::Command::new("open")
        .args(["-a", &app, &path])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands – Paste image
// ---------------------------------------------------------------------------

#[tauri::command]
fn save_pasted_image(base64_data: String, project_path: String) -> Result<String, String> {
    let img_dir = std::path::Path::new(&project_path).join(".codebook-images");
    std::fs::create_dir_all(&img_dir).map_err(|e| e.to_string())?;

    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S").to_string();
    let filename = format!("paste_{}.png", timestamp);
    let file_path = img_dir.join(&filename);

    // Decode base64
    use std::io::Write;
    let bytes = base64_decode(&base64_data).map_err(|e| format!("base64 decode error: {}", e))?;
    let mut file = std::fs::File::create(&file_path).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;

    Ok(file_path.to_string_lossy().to_string())
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    // Simple base64 decoder
    let input = input.trim();
    let input = if let Some(pos) = input.find(",") { &input[pos + 1..] } else { input };
    let chars: Vec<u8> = input.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    let lookup = |c: u8| -> Result<u8, String> {
        match c {
            b'A'..=b'Z' => Ok(c - b'A'),
            b'a'..=b'z' => Ok(c - b'a' + 26),
            b'0'..=b'9' => Ok(c - b'0' + 52),
            b'+' => Ok(62),
            b'/' => Ok(63),
            b'=' => Ok(0),
            _ => Err(format!("invalid base64 char: {}", c as char)),
        }
    };
    let mut result = Vec::new();
    for chunk in chars.chunks(4) {
        if chunk.len() < 4 { break; }
        let a = lookup(chunk[0])?;
        let b = lookup(chunk[1])?;
        let c = lookup(chunk[2])?;
        let d = lookup(chunk[3])?;
        result.push((a << 2) | (b >> 4));
        if chunk[2] != b'=' { result.push((b << 4) | (c >> 2)); }
        if chunk[3] != b'=' { result.push((c << 6) | d); }
    }
    Ok(result)
}

// ---------------------------------------------------------------------------
// Tauri commands – Project-level Claude config
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
struct ProjectClaudeConfig {
    settings_json: Option<serde_json::Value>,
    settings_local_json: Option<serde_json::Value>,
    claude_md: Option<String>,
    has_claude_dir: bool,
}

#[tauri::command]
fn get_project_claude_config(project_path: String) -> Result<ProjectClaudeConfig, String> {
    let path = std::path::Path::new(&project_path);
    let claude_dir = path.join(".claude");
    let has_claude_dir = claude_dir.exists();

    // Read .claude/settings.json
    let settings_path = claude_dir.join("settings.json");
    let settings_json = if settings_path.exists() {
        let content = std::fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        Some(serde_json::from_str(&content).unwrap_or_default())
    } else {
        None
    };

    // Read .claude/settings.local.json
    let local_path = claude_dir.join("settings.local.json");
    let settings_local_json = if local_path.exists() {
        let content = std::fs::read_to_string(&local_path).map_err(|e| e.to_string())?;
        Some(serde_json::from_str(&content).unwrap_or_default())
    } else {
        None
    };

    // Read CLAUDE.md
    let claude_md_path = path.join("CLAUDE.md");
    let claude_md = if claude_md_path.exists() {
        Some(std::fs::read_to_string(&claude_md_path).map_err(|e| e.to_string())?)
    } else {
        None
    };

    Ok(ProjectClaudeConfig {
        settings_json,
        settings_local_json,
        claude_md,
        has_claude_dir,
    })
}

#[tauri::command]
fn save_project_claude_config(
    project_path: String,
    file_type: String,
    content: String,
) -> Result<(), String> {
    let path = std::path::Path::new(&project_path);
    let claude_dir = path.join(".claude");

    // Create .claude dir if needed
    std::fs::create_dir_all(&claude_dir).map_err(|e| e.to_string())?;

    let file_path = match file_type.as_str() {
        "settings" => claude_dir.join("settings.json"),
        "local" => claude_dir.join("settings.local.json"),
        "claude_md" => path.join("CLAUDE.md"),
        _ => return Err("Invalid file type".to_string()),
    };

    std::fs::write(&file_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands – Global settings (read/write ~/.claude/settings.json)
// ---------------------------------------------------------------------------

#[tauri::command]
fn read_global_settings() -> Result<String, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let settings_path = home.join(".claude").join("settings.json");
    if settings_path.exists() {
        std::fs::read_to_string(&settings_path).map_err(|e| e.to_string())
    } else {
        Ok("{}".to_string())
    }
}

#[tauri::command]
fn save_global_settings(content: String) -> Result<(), String> {
    // Validate JSON before writing
    serde_json::from_str::<serde_json::Value>(&content)
        .map_err(|e| format!("Invalid JSON: {}", e))?;

    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let claude_dir = home.join(".claude");
    std::fs::create_dir_all(&claude_dir).map_err(|e| e.to_string())?;
    let settings_path = claude_dir.join("settings.json");
    std::fs::write(&settings_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// App entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Resolve the app data directory for the SQLite DB
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app data directory");

            // Create the directory if it doesn't exist
            std::fs::create_dir_all(&app_data_dir)
                .expect("Failed to create app data directory");

            let db_path = app_data_dir.join("codebook.db");
            let db_path_str = db_path
                .to_str()
                .expect("Invalid DB path")
                .to_string();

            let database =
                Database::init(&db_path_str).expect("Failed to initialize database");

            let db = Arc::new(database);
            let claude = Arc::new(ClaudeManager::new());
            let remote = Arc::new(RemoteServer::new(19876));

            app.manage(DbState(db.clone()));
            app.manage(ClaudeState(claude.clone()));
            app.manage(RemoteState(remote.clone()));

            // Auto-start the remote server in the background
            let app_handle = app.handle().clone();
            let db_for_remote = db.clone();
            let claude_for_remote = claude.clone();
            let remote_for_start = remote.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = remote_for_start
                    .start(db_for_remote, claude_for_remote, app_handle)
                    .await
                {
                    eprintln!("[remote] Failed to auto-start remote server: {}", e);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Projects
            create_project,
            list_projects,
            delete_project,
            // Sessions
            create_session,
            list_sessions,
            delete_session,
            rename_session,
            // Messages
            get_messages,
            save_message,
            // References
            add_reference,
            list_references,
            remove_reference,
            // Settings
            get_setting,
            set_setting,
            // Chat
            send_chat_message,
            stop_chat,
            update_session_claude_id,
            is_session_streaming,
            get_streaming_buffer,
            // CLI import + sync
            import_cli_sessions,
            sync_cli_session,
            generate_commit_message,
            // File explorer
            list_dir,
            read_file_content,
            // Open in terminal
            open_in_terminal,
            // Paste image
            save_pasted_image,
            // Claude CLI config
            get_claude_cli_config,
            // Global settings (read/write ~/.claude/settings.json)
            read_global_settings,
            save_global_settings,
            // Project-level Claude config
            get_project_claude_config,
            save_project_claude_config,
            // Checkpoints
            save_checkpoint,
            get_checkpoints,
            rollback_to_checkpoint,
            get_git_snapshot,
            // Git
            git_status,
            git_diff_file,
            git_commit,
            git_push,
            git_pull,
            git_branch,
            git_list_branches,
            git_checkout,
            discover_git_repos,
            // Remote access
            get_remote_info,
            start_remote_server,
            stop_remote_server,
            get_tailscale_status,
            get_connection_info,
            generate_pin,
            get_active_pin,
        ])
        .on_window_event(|window, event| {
            // Kill all Claude processes when the main window is about to close
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(claude) = window.app_handle().try_state::<ClaudeState>() {
                    claude.0.kill_all_sync();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

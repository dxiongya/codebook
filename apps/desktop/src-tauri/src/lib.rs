mod claude;
mod db;
mod git;
mod remote;

use claude::ClaudeManager;
use db::{Checkpoint, Database, Message, Project, ReferenceDir, Session};
use remote::{RemoteInfo, RemoteServer};
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

// ---------------------------------------------------------------------------
// Tauri commands – Messages
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_messages(db: State<DbState>, session_id: String) -> Result<Vec<Message>, String> {
    db.0.get_messages(&session_id)
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

    // Parse each line and filter by project_path
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct HistoryEntry {
        display: Option<String>,
        #[serde(default)]
        timestamp: Option<i64>,
        project: Option<String>,
        session_id: Option<String>,
    }

    // Collect matching entries grouped by sessionId
    let mut session_map: std::collections::HashMap<String, Vec<HistoryEntry>> =
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
        session_map.entry(sid).or_default().push(entry);
    }

    if session_map.is_empty() {
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

    let mut imported: Vec<Session> = Vec::new();

    for (claude_sid, mut entries) in session_map {
        // Skip if already imported
        if existing.contains(&claude_sid) {
            continue;
        }

        // Sort entries by timestamp
        entries.sort_by_key(|e| e.timestamp.unwrap_or(0));

        // Session name = first message truncated to 30 chars
        let first_display = entries
            .first()
            .and_then(|e| e.display.as_deref())
            .unwrap_or("CLI Session");
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

        // Save each user message
        for entry in &entries {
            if let Some(display) = &entry.display {
                let _ = db.0.save_message(&session_id, "user", display, None, None, None);
            }
        }

        imported.push(Session {
            id: session_id,
            project_id: project_id.clone(),
            name,
            claude_session_id: Some(claude_sid),
            model: None,
            total_cost: None,
            created_at: now.clone(),
            updated_at: now,
        });
    }

    Ok(imported)
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
            "[Reference projects are available via --add-dir. You can read their code with Read/Glob/Grep tools for patterns and implementation reference:]\n{}\n\n{}",
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
fn git_commit(project_path: String, message: String) -> Result<git::GitCommitResult, String> {
    git::git_commit(&project_path, &message)
}

#[tauri::command]
fn git_push(project_path: String) -> Result<(), String> {
    git::git_push(&project_path)
}

#[tauri::command]
fn git_branch(project_path: String) -> Result<String, String> {
    git::git_branch(&project_path)
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
            is_session_streaming,
            get_streaming_buffer,
            // CLI import
            import_cli_sessions,
            // File explorer
            list_dir,
            read_file_content,
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
            git_branch,
            // Remote access
            get_remote_info,
            start_remote_server,
            stop_remote_server,
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

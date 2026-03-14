mod claude;
mod db;
mod git;

use claude::ClaudeManager;
use db::{Database, Message, Project, ReferenceDir, Session};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

// ---------------------------------------------------------------------------
// App state wrappers
// ---------------------------------------------------------------------------

struct DbState(Arc<Database>);
struct ClaudeState(Arc<ClaudeManager>);

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

            app.manage(DbState(Arc::new(database)));
            app.manage(ClaudeState(Arc::new(ClaudeManager::new())));

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
            // File explorer
            list_dir,
            read_file_content,
            // Git
            git_status,
            git_diff_file,
            git_commit,
            git_push,
            git_branch,
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

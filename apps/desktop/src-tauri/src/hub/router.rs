use std::sync::Arc;
use tauri::{AppHandle, Emitter};

use super::auth::AuthManager;
use super::protocol::{actions, HubRequest, HubResponse};
use crate::claude::ClaudeManager;
use crate::db::Database;

// ---------------------------------------------------------------------------
// Hub Router — maps action strings to core layer functions
// ---------------------------------------------------------------------------

pub struct HubRouter {
    pub db: Arc<Database>,
    pub claude: Arc<ClaudeManager>,
    pub auth: Arc<AuthManager>,
    pub app: AppHandle,
}

impl HubRouter {
    pub fn new(
        db: Arc<Database>,
        claude: Arc<ClaudeManager>,
        auth: Arc<AuthManager>,
        app: AppHandle,
    ) -> Self {
        Self { db, claude, auth, app }
    }

    /// Route a request to the appropriate handler
    pub async fn handle(&self, client_id: &str, req: HubRequest) -> HubResponse {
        // Auth.pin doesn't require a token
        if req.action == actions::AUTH_PIN {
            return self.handle_auth_pin(client_id, &req).await;
        }

        // System.ping doesn't require auth
        if req.action == actions::SYSTEM_PING {
            return HubResponse::ok(&req.request_id, serde_json::json!({ "pong": true }));
        }

        // All other actions require a valid token
        match &req.token {
            Some(token) => {
                if let Err(e) = self.auth.verify_token(token).await {
                    return HubResponse::error(&req.request_id, &format!("Unauthorized: {}", e));
                }
            }
            None => {
                return HubResponse::error(&req.request_id, "Unauthorized: token required");
            }
        }

        // Route to handler
        match req.action.as_str() {
            actions::AUTH_STATUS => self.handle_auth_status(client_id, &req).await,

            // Projects
            actions::PROJECTS_LIST => self.handle_projects_list(&req).await,
            actions::PROJECTS_CREATE => self.handle_projects_create(&req).await,
            actions::PROJECTS_DELETE => self.handle_projects_delete(&req).await,

            // Sessions
            actions::SESSIONS_LIST => self.handle_sessions_list(&req).await,
            actions::SESSIONS_CREATE => self.handle_sessions_create(&req).await,
            actions::SESSIONS_DELETE => self.handle_sessions_delete(&req).await,
            actions::SESSIONS_RENAME => self.handle_sessions_rename(&req).await,

            // Chat
            actions::CHAT_MESSAGES => self.handle_chat_messages(&req).await,
            actions::CHAT_SEND => self.handle_chat_send(&req).await,
            actions::CHAT_STOP => self.handle_chat_stop(&req).await,

            // Git
            actions::GIT_STATUS => self.handle_git_status(&req).await,
            actions::GIT_BRANCH => self.handle_git_branch(&req).await,
            actions::GIT_BRANCHES => self.handle_git_branches(&req).await,
            actions::GIT_CHECKOUT => self.handle_git_checkout(&req).await,
            actions::GIT_DIFF => self.handle_git_diff(&req).await,
            actions::GIT_COMMIT => self.handle_git_commit(&req).await,
            actions::GIT_PUSH => self.handle_git_push(&req).await,

            // Files
            actions::FILES_LIST => self.handle_files_list(&req).await,
            actions::FILES_READ => self.handle_files_read(&req).await,

            // Subscriptions (no-op for now — events broadcast to all)
            actions::SUBSCRIBE | actions::UNSUBSCRIBE => {
                HubResponse::ok(&req.request_id, serde_json::json!({ "ok": true }))
            }

            // System
            actions::SYSTEM_INFO => self.handle_system_info(&req).await,

            _ => HubResponse::error(&req.request_id, &format!("Unknown action: {}", req.action)),
        }
    }

    // -----------------------------------------------------------------------
    // Auth handlers
    // -----------------------------------------------------------------------

    async fn handle_auth_pin(&self, client_id: &str, req: &HubRequest) -> HubResponse {
        let pin = req.payload.get("pin").and_then(|v| v.as_str()).unwrap_or("");
        match self.auth.verify_pin(client_id, pin).await {
            Ok(token) => HubResponse::ok(&req.request_id, serde_json::json!({
                "authenticated": true,
                "token": token,
            })),
            Err(e) => HubResponse::error(&req.request_id, &e.to_string()),
        }
    }

    async fn handle_auth_status(&self, _client_id: &str, req: &HubRequest) -> HubResponse {
        HubResponse::ok(&req.request_id, serde_json::json!({ "authenticated": true }))
    }

    // -----------------------------------------------------------------------
    // Project handlers
    // -----------------------------------------------------------------------

    async fn handle_projects_list(&self, req: &HubRequest) -> HubResponse {
        match self.db.list_projects() {
            Ok(projects) => HubResponse::ok(&req.request_id, serde_json::to_value(&projects).unwrap()),
            Err(e) => HubResponse::error(&req.request_id, &e.to_string()),
        }
    }

    async fn handle_projects_create(&self, req: &HubRequest) -> HubResponse {
        let name = match req.payload.get("name").and_then(|v| v.as_str()) {
            Some(n) => n,
            None => return HubResponse::error(&req.request_id, "name required"),
        };
        let path = match req.payload.get("path").and_then(|v| v.as_str()) {
            Some(p) => p,
            None => return HubResponse::error(&req.request_id, "path required"),
        };
        match self.db.create_project(name, path) {
            Ok(project) => HubResponse::ok(&req.request_id, serde_json::to_value(&project).unwrap()),
            Err(e) => HubResponse::error(&req.request_id, &e.to_string()),
        }
    }

    async fn handle_projects_delete(&self, req: &HubRequest) -> HubResponse {
        let id = match req.payload.get("id").and_then(|v| v.as_str()) {
            Some(i) => i,
            None => return HubResponse::error(&req.request_id, "id required"),
        };
        match self.db.delete_project(id) {
            Ok(_) => HubResponse::ok(&req.request_id, serde_json::json!({ "deleted": true })),
            Err(e) => HubResponse::error(&req.request_id, &e.to_string()),
        }
    }

    // -----------------------------------------------------------------------
    // Session handlers
    // -----------------------------------------------------------------------

    async fn handle_sessions_list(&self, req: &HubRequest) -> HubResponse {
        let project_id = req.payload.get("project_id").and_then(|v| v.as_str()).unwrap_or("");
        if project_id.is_empty() {
            return HubResponse::error(&req.request_id, "project_id required");
        }
        match self.db.list_sessions(project_id) {
            Ok(sessions) => HubResponse::ok(&req.request_id, serde_json::to_value(&sessions).unwrap()),
            Err(e) => HubResponse::error(&req.request_id, &e.to_string()),
        }
    }

    async fn handle_sessions_create(&self, req: &HubRequest) -> HubResponse {
        let project_id = match req.payload.get("project_id").and_then(|v| v.as_str()) {
            Some(id) => id,
            None => return HubResponse::error(&req.request_id, "project_id required"),
        };
        let name = req.payload.get("name").and_then(|v| v.as_str()).unwrap_or("New Session");
        match self.db.create_session(project_id, name) {
            Ok(session) => HubResponse::ok(&req.request_id, serde_json::to_value(&session).unwrap()),
            Err(e) => HubResponse::error(&req.request_id, &e.to_string()),
        }
    }

    async fn handle_sessions_delete(&self, req: &HubRequest) -> HubResponse {
        let id = match req.payload.get("id").and_then(|v| v.as_str()) {
            Some(i) => i,
            None => return HubResponse::error(&req.request_id, "id required"),
        };
        match self.db.delete_session(id) {
            Ok(_) => HubResponse::ok(&req.request_id, serde_json::json!({ "deleted": true })),
            Err(e) => HubResponse::error(&req.request_id, &e.to_string()),
        }
    }

    async fn handle_sessions_rename(&self, req: &HubRequest) -> HubResponse {
        let id = match req.payload.get("id").and_then(|v| v.as_str()) {
            Some(i) => i,
            None => return HubResponse::error(&req.request_id, "id required"),
        };
        let name = match req.payload.get("name").and_then(|v| v.as_str()) {
            Some(n) => n,
            None => return HubResponse::error(&req.request_id, "name required"),
        };
        let conn = self.db.conn.lock().unwrap();
        match conn.execute(
            "UPDATE sessions SET name = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![name, chrono::Utc::now().to_rfc3339(), id],
        ) {
            Ok(_) => HubResponse::ok(&req.request_id, serde_json::json!({ "renamed": true })),
            Err(e) => HubResponse::error(&req.request_id, &e.to_string()),
        }
    }

    // -----------------------------------------------------------------------
    // Chat handlers
    // -----------------------------------------------------------------------

    async fn handle_chat_messages(&self, req: &HubRequest) -> HubResponse {
        let session_id = req.payload.get("session_id").and_then(|v| v.as_str()).unwrap_or("");
        if session_id.is_empty() {
            return HubResponse::error(&req.request_id, "session_id required");
        }
        let limit = req.payload.get("limit").and_then(|v| v.as_u64()).map(|v| v as u32);
        let before = req.payload.get("before").and_then(|v| v.as_str());
        match self.db.get_messages_paginated(session_id, limit, before) {
            Ok(messages) => HubResponse::ok(&req.request_id, serde_json::to_value(&messages).unwrap()),
            Err(e) => HubResponse::error(&req.request_id, &e.to_string()),
        }
    }

    async fn handle_chat_send(&self, req: &HubRequest) -> HubResponse {
        let session_id = match req.payload.get("session_id").and_then(|v| v.as_str()) {
            Some(id) => id.to_string(),
            None => return HubResponse::error(&req.request_id, "session_id required"),
        };
        let message = match req.payload.get("message").and_then(|v| v.as_str()) {
            Some(m) => m.to_string(),
            None => return HubResponse::error(&req.request_id, "message required"),
        };
        let model = req.payload.get("model")
            .and_then(|v| v.as_str())
            .unwrap_or("sonnet")
            .to_string();

        // Save user message
        let saved_msg = match self.db.save_message(&session_id, "user", &message, Some(&model), None, None) {
            Ok(msg) => msg,
            Err(e) => return HubResponse::error(&req.request_id, &format!("Failed to save message: {}", e)),
        };

        // Notify desktop UI about the new user message (so it syncs in real-time)
        let _ = self.app.emit("session-message", serde_json::json!({
            "session_id": session_id,
            "message": {
                "id": saved_msg.id,
                "session_id": saved_msg.session_id,
                "role": "user",
                "content": message,
                "model": model,
                "created_at": saved_msg.created_at,
            }
        }));

        // Look up session
        let (claude_session_id, project_id) = {
            let conn = self.db.conn.lock().unwrap();
            let mut stmt = match conn.prepare(
                "SELECT claude_session_id, project_id FROM sessions WHERE id = ?1",
            ) {
                Ok(s) => s,
                Err(e) => return HubResponse::error(&req.request_id, &e.to_string()),
            };
            let mut rows = match stmt.query(rusqlite::params![session_id]) {
                Ok(r) => r,
                Err(e) => return HubResponse::error(&req.request_id, &e.to_string()),
            };
            match rows.next() {
                Ok(Some(row)) => {
                    let csid: Option<String> = row.get(0).unwrap_or(None);
                    let pid: String = row.get(1).unwrap_or_default();
                    (csid, pid)
                }
                _ => return HubResponse::error(&req.request_id, "Session not found"),
            }
        };

        // Look up project path
        let project_path = {
            let conn = self.db.conn.lock().unwrap();
            let mut stmt = match conn.prepare("SELECT path FROM projects WHERE id = ?1") {
                Ok(s) => s,
                Err(e) => return HubResponse::error(&req.request_id, &e.to_string()),
            };
            let mut rows = match stmt.query(rusqlite::params![project_id]) {
                Ok(r) => r,
                Err(e) => return HubResponse::error(&req.request_id, &e.to_string()),
            };
            match rows.next() {
                Ok(Some(row)) => row.get::<_, String>(0).unwrap_or_default(),
                _ => return HubResponse::error(&req.request_id, "Project not found"),
            }
        };

        // Get reference dirs
        let refs = self.db.list_references(&project_id).unwrap_or_default();
        let ref_dirs: Vec<String> = refs.iter().map(|r| r.path.clone()).collect();

        // Enhance message with reference context on first message
        let enhanced = if !ref_dirs.is_empty() && claude_session_id.is_none() {
            let ctx: Vec<String> = refs.iter().map(|r| {
                let label = r.label.as_deref().unwrap_or("reference");
                format!("- {} ({})", r.path, label)
            }).collect();
            format!(
                "[Reference projects available via --add-dir. Read-only for patterns:]\n{}\n\n{}",
                ctx.join("\n"),
                message
            )
        } else {
            message
        };

        // Create git checkpoint before spawning Claude (same as desktop flow)
        {
            let hash = std::process::Command::new("git")
                .args(["-C", &project_path, "rev-parse", "--short", "HEAD"])
                .output()
                .ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .unwrap_or_default();
            let diff = std::process::Command::new("git")
                .args(["-C", &project_path, "diff", "--stat"])
                .output()
                .ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .unwrap_or_default();
            let _ = self.db.save_checkpoint(
                &session_id,
                &saved_msg.id,
                if hash.is_empty() { None } else { Some(&hash) },
                if diff.is_empty() { None } else { Some(&diff) },
                &project_path,
            );
        }

        match self.claude.spawn(
            session_id,
            enhanced,
            model,
            claude_session_id,
            ref_dirs,
            project_path,
            self.app.clone(),
        ).await {
            Ok(_) => HubResponse::ok(&req.request_id, serde_json::json!({ "started": true })),
            Err(e) => HubResponse::error(&req.request_id, &format!("Failed to spawn: {}", e)),
        }
    }

    async fn handle_chat_stop(&self, req: &HubRequest) -> HubResponse {
        let session_id = match req.payload.get("session_id").and_then(|v| v.as_str()) {
            Some(id) => id,
            None => return HubResponse::error(&req.request_id, "session_id required"),
        };
        match self.claude.stop(session_id).await {
            Ok(_) => HubResponse::ok(&req.request_id, serde_json::json!({ "stopped": true })),
            Err(e) => HubResponse::error(&req.request_id, &e.to_string()),
        }
    }

    // -----------------------------------------------------------------------
    // Git handlers
    // -----------------------------------------------------------------------

    async fn handle_git_status(&self, req: &HubRequest) -> HubResponse {
        let path = req.payload.get("path").and_then(|v| v.as_str()).unwrap_or("");
        if path.is_empty() {
            return HubResponse::error(&req.request_id, "path required");
        }
        let branch = crate::git::git_branch(path).unwrap_or_default();
        match crate::git::git_status(path) {
            Ok(changes) => HubResponse::ok(&req.request_id, serde_json::json!({
                "branch": branch,
                "files": changes,
            })),
            Err(e) => HubResponse::error(&req.request_id, &e.to_string()),
        }
    }

    async fn handle_git_branch(&self, req: &HubRequest) -> HubResponse {
        let path = req.payload.get("path").and_then(|v| v.as_str()).unwrap_or("");
        match crate::git::git_branch(path) {
            Ok(branch) => HubResponse::ok(&req.request_id, serde_json::json!({ "branch": branch })),
            Err(e) => HubResponse::error(&req.request_id, &e.to_string()),
        }
    }

    async fn handle_git_branches(&self, req: &HubRequest) -> HubResponse {
        let path = req.payload.get("path").and_then(|v| v.as_str()).unwrap_or("");
        match crate::git::git_list_branches(path) {
            Ok(branches) => HubResponse::ok(&req.request_id, serde_json::to_value(&branches).unwrap()),
            Err(e) => HubResponse::error(&req.request_id, &e.to_string()),
        }
    }

    async fn handle_git_checkout(&self, req: &HubRequest) -> HubResponse {
        let path = req.payload.get("path").and_then(|v| v.as_str()).unwrap_or("");
        let branch = match req.payload.get("branch").and_then(|v| v.as_str()) {
            Some(b) => b,
            None => return HubResponse::error(&req.request_id, "branch required"),
        };
        match crate::git::git_checkout(path, branch) {
            Ok(msg) => HubResponse::ok(&req.request_id, serde_json::json!({ "message": msg })),
            Err(e) => HubResponse::error(&req.request_id, &e.to_string()),
        }
    }

    async fn handle_git_diff(&self, req: &HubRequest) -> HubResponse {
        let path = req.payload.get("path").and_then(|v| v.as_str()).unwrap_or("");
        let file = match req.payload.get("file").and_then(|v| v.as_str()) {
            Some(f) => f,
            None => return HubResponse::error(&req.request_id, "file required"),
        };
        match crate::git::git_diff_file(path, file) {
            Ok(diff) => HubResponse::ok(&req.request_id, serde_json::to_value(&diff).unwrap()),
            Err(e) => HubResponse::error(&req.request_id, &e.to_string()),
        }
    }

    async fn handle_git_commit(&self, req: &HubRequest) -> HubResponse {
        let path = req.payload.get("path").and_then(|v| v.as_str()).unwrap_or("");
        let message = match req.payload.get("message").and_then(|v| v.as_str()) {
            Some(m) => m,
            None => return HubResponse::error(&req.request_id, "message required"),
        };
        match crate::git::git_commit(path, message) {
            Ok(result) => HubResponse::ok(&req.request_id, serde_json::to_value(&result).unwrap()),
            Err(e) => HubResponse::error(&req.request_id, &e.to_string()),
        }
    }

    async fn handle_git_push(&self, req: &HubRequest) -> HubResponse {
        let path = req.payload.get("path").and_then(|v| v.as_str()).unwrap_or("");
        match crate::git::git_push(path) {
            Ok(_) => HubResponse::ok(&req.request_id, serde_json::json!({ "pushed": true })),
            Err(e) => HubResponse::error(&req.request_id, &e.to_string()),
        }
    }

    // -----------------------------------------------------------------------
    // File handlers
    // -----------------------------------------------------------------------

    async fn handle_files_list(&self, req: &HubRequest) -> HubResponse {
        let path = req.payload.get("path").and_then(|v| v.as_str()).unwrap_or("");
        if path.is_empty() {
            return HubResponse::error(&req.request_id, "path required");
        }
        match std::fs::read_dir(path) {
            Ok(entries) => {
                let mut files: Vec<serde_json::Value> = Vec::new();
                for entry in entries.flatten() {
                    let meta = entry.metadata().ok();
                    let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
                    let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
                    files.push(serde_json::json!({
                        "name": entry.file_name().to_string_lossy(),
                        "is_dir": is_dir,
                        "size": size,
                    }));
                }
                files.sort_by(|a, b| {
                    let a_dir = a["is_dir"].as_bool().unwrap_or(false);
                    let b_dir = b["is_dir"].as_bool().unwrap_or(false);
                    b_dir.cmp(&a_dir).then_with(|| {
                        a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or(""))
                    })
                });
                HubResponse::ok(&req.request_id, serde_json::to_value(&files).unwrap())
            }
            Err(e) => HubResponse::error(&req.request_id, &e.to_string()),
        }
    }

    async fn handle_files_read(&self, req: &HubRequest) -> HubResponse {
        let path = req.payload.get("path").and_then(|v| v.as_str()).unwrap_or("");
        if path.is_empty() {
            return HubResponse::error(&req.request_id, "path required");
        }
        match std::fs::read_to_string(path) {
            Ok(content) => HubResponse::ok(&req.request_id, serde_json::json!({
                "content": content,
                "path": path,
            })),
            Err(e) => HubResponse::error(&req.request_id, &e.to_string()),
        }
    }

    // -----------------------------------------------------------------------
    // System handlers
    // -----------------------------------------------------------------------

    async fn handle_system_info(&self, req: &HubRequest) -> HubResponse {
        HubResponse::ok(&req.request_id, serde_json::json!({
            "version": "0.1.0",
            "app": "codebook",
        }))
    }
}

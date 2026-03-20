use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Hub Protocol — unified message format for all external clients (mobile, etc.)
// ---------------------------------------------------------------------------

/// Client → Hub request
#[derive(Debug, Clone, Deserialize)]
pub struct HubRequest {
    /// Unique request ID for correlation
    pub request_id: String,
    /// Action in namespace.method format: "auth.pin", "projects.list", "chat.send"
    pub action: String,
    /// JWT token (None for auth.pin action)
    pub token: Option<String>,
    /// Action-specific payload
    #[serde(default)]
    pub payload: serde_json::Value,
}

/// Hub → Client response
#[derive(Debug, Clone, Serialize)]
pub struct HubResponse {
    /// Matches the request_id from HubRequest
    pub request_id: String,
    /// "ok" or "error"
    pub status: String,
    /// Response data (varies by action)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    /// Error message (only when status = "error")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Hub → Client push event (streaming, git changes, etc.)
#[derive(Debug, Clone, Serialize)]
pub struct HubEvent {
    /// Event type: "claude.streaming", "claude.result", "git.changed", "session.updated"
    pub event: String,
    /// Which session this event belongs to (empty for global events)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// Event payload
    pub data: serde_json::Value,
    /// Sequence number for ordering
    pub seq: u64,
}

// ---------------------------------------------------------------------------
// Helper constructors
// ---------------------------------------------------------------------------

impl HubResponse {
    pub fn ok(request_id: &str, data: serde_json::Value) -> Self {
        Self {
            request_id: request_id.to_string(),
            status: "ok".to_string(),
            data: Some(data),
            message: None,
        }
    }

    pub fn error(request_id: &str, msg: &str) -> Self {
        Self {
            request_id: request_id.to_string(),
            status: "error".to_string(),
            data: None,
            message: Some(msg.to_string()),
        }
    }
}

// ---------------------------------------------------------------------------
// Action namespace constants
// ---------------------------------------------------------------------------

pub mod actions {
    // Auth
    pub const AUTH_PIN: &str = "auth.pin";
    pub const AUTH_STATUS: &str = "auth.status";

    // Projects
    pub const PROJECTS_LIST: &str = "projects.list";
    pub const PROJECTS_CREATE: &str = "projects.create";
    pub const PROJECTS_DELETE: &str = "projects.delete";

    // Sessions
    pub const SESSIONS_LIST: &str = "sessions.list";
    pub const SESSIONS_CREATE: &str = "sessions.create";
    pub const SESSIONS_DELETE: &str = "sessions.delete";
    pub const SESSIONS_RENAME: &str = "sessions.rename";

    // Chat
    pub const CHAT_SEND: &str = "chat.send";
    pub const CHAT_STOP: &str = "chat.stop";
    pub const CHAT_MESSAGES: &str = "chat.messages";

    // Git
    pub const GIT_STATUS: &str = "git.status";
    pub const GIT_BRANCH: &str = "git.branch";
    pub const GIT_BRANCHES: &str = "git.branches";
    pub const GIT_CHECKOUT: &str = "git.checkout";
    pub const GIT_DIFF: &str = "git.diff";
    pub const GIT_COMMIT: &str = "git.commit";
    pub const GIT_PUSH: &str = "git.push";

    // Files
    pub const FILES_LIST: &str = "files.list";
    pub const FILES_READ: &str = "files.read";

    // Subscriptions
    pub const SUBSCRIBE: &str = "subscribe";
    pub const UNSUBSCRIBE: &str = "unsubscribe";

    // System
    pub const SYSTEM_INFO: &str = "system.info";
    pub const SYSTEM_PING: &str = "system.ping";
}

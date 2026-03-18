use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

// ---------------------------------------------------------------------------
// Data models
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    pub id: String,
    pub session_id: String,
    pub message_id: String,
    pub git_commit_hash: Option<String>,
    pub git_diff_summary: Option<String>,
    pub project_path: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub claude_session_id: Option<String>,
    pub model: Option<String>,
    pub total_cost: Option<f64>,
    pub cli_type: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String, // JSON string containing array of content blocks
    pub model: Option<String>,
    pub cost: Option<f64>,
    pub duration_ms: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReferenceDir {
    pub id: String,
    pub project_id: String,
    pub path: String,
    pub label: Option<String>,
}

// ---------------------------------------------------------------------------
// Database wrapper
// ---------------------------------------------------------------------------

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    /// Open (or create) the SQLite database at `path` and run migrations.
    pub fn init(path: &str) -> SqlResult<Self> {
        let conn = Connection::open(path)?;

        // Enable WAL mode for better concurrent read performance
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;

        let db = Self {
            conn: Mutex::new(conn),
        };
        db.create_tables()?;
        Ok(db)
    }

    fn create_tables(&self) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS projects (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                path        TEXT NOT NULL,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id                TEXT PRIMARY KEY,
                project_id        TEXT NOT NULL,
                name              TEXT NOT NULL,
                claude_session_id TEXT,
                model             TEXT,
                total_cost        REAL,
                cli_type          TEXT NOT NULL DEFAULT 'claude',
                created_at        TEXT NOT NULL,
                updated_at        TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS messages (
                id          TEXT PRIMARY KEY,
                session_id  TEXT NOT NULL,
                role        TEXT NOT NULL,
                content     TEXT NOT NULL,
                model       TEXT,
                cost        REAL,
                duration_ms INTEGER,
                created_at  TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS reference_dirs (
                id          TEXT PRIMARY KEY,
                project_id  TEXT NOT NULL,
                path        TEXT NOT NULL,
                label       TEXT,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS checkpoints (
                id              TEXT PRIMARY KEY,
                session_id      TEXT NOT NULL,
                message_id      TEXT NOT NULL,
                git_commit_hash TEXT,
                git_diff_summary TEXT,
                project_path    TEXT NOT NULL,
                created_at      TEXT NOT NULL
            );
            ",
        )?;

        // Migration: add cli_type column for existing databases
        let has_cli_type: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name='cli_type'")?
            .query_row([], |row| row.get::<_, i64>(0))
            .map(|count| count > 0)
            .unwrap_or(false);
        if !has_cli_type {
            conn.execute_batch(
                "ALTER TABLE sessions ADD COLUMN cli_type TEXT NOT NULL DEFAULT 'claude';",
            )?;
        }

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Projects
    // -----------------------------------------------------------------------

    pub fn create_project(&self, name: &str, path: &str) -> SqlResult<Project> {
        let now = chrono::Utc::now().to_rfc3339();
        let id = uuid::Uuid::new_v4().to_string();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, name, path, now, now],
        )?;
        Ok(Project {
            id,
            name: name.to_string(),
            path: path.to_string(),
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn list_projects(&self) -> SqlResult<Vec<Project>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT id, name, path, created_at, updated_at FROM projects ORDER BY updated_at DESC")?;
        let rows = stmt.query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?;
        rows.collect()
    }

    pub fn delete_project(&self, id: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE project_id = ?1)", params![id])?;
        conn.execute("DELETE FROM sessions WHERE project_id = ?1", params![id])?;
        conn.execute("DELETE FROM reference_dirs WHERE project_id = ?1", params![id])?;
        conn.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Sessions
    // -----------------------------------------------------------------------

    pub fn create_session(&self, project_id: &str, name: &str) -> SqlResult<Session> {
        let now = chrono::Utc::now().to_rfc3339();
        let id = uuid::Uuid::new_v4().to_string();
        let cli_type = "claude";
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO sessions (id, project_id, name, claude_session_id, model, total_cost, cli_type, created_at, updated_at) VALUES (?1, ?2, ?3, NULL, NULL, NULL, ?4, ?5, ?6)",
            params![id, project_id, name, cli_type, now, now],
        )?;
        Ok(Session {
            id,
            project_id: project_id.to_string(),
            name: name.to_string(),
            claude_session_id: None,
            model: None,
            total_cost: None,
            cli_type: Some(cli_type.to_string()),
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn list_sessions(&self, project_id: &str) -> SqlResult<Vec<Session>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, name, claude_session_id, model, total_cost, cli_type, created_at, updated_at FROM sessions WHERE project_id = ?1 ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map(params![project_id], |row| {
            Ok(Session {
                id: row.get(0)?,
                project_id: row.get(1)?,
                name: row.get(2)?,
                claude_session_id: row.get(3)?,
                model: row.get(4)?,
                total_cost: row.get(5)?,
                cli_type: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?;
        rows.collect()
    }

    pub fn update_session_claude_id(&self, id: &str, claude_session_id: &str) -> SqlResult<()> {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE sessions SET claude_session_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![claude_session_id, now, id],
        )?;
        Ok(())
    }

    pub fn update_session_model(&self, id: &str, model: &str) -> SqlResult<()> {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE sessions SET model = ?1, updated_at = ?2 WHERE id = ?3",
            params![model, now, id],
        )?;
        Ok(())
    }

    pub fn update_session_cost(&self, id: &str, cost: f64) -> SqlResult<()> {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE sessions SET total_cost = ?1, updated_at = ?2 WHERE id = ?3",
            params![cost, now, id],
        )?;
        Ok(())
    }

    pub fn delete_session(&self, id: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM messages WHERE session_id = ?1",
            params![id],
        )?;
        conn.execute("DELETE FROM sessions WHERE id = ?1", params![id])?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Messages
    // -----------------------------------------------------------------------

    pub fn save_message(
        &self,
        session_id: &str,
        role: &str,
        content: &str,
        model: Option<&str>,
        cost: Option<f64>,
        duration_ms: Option<i64>,
    ) -> SqlResult<Message> {
        let now = chrono::Utc::now().to_rfc3339();
        let id = uuid::Uuid::new_v4().to_string();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, model, cost, duration_ms, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![id, session_id, role, content, model, cost, duration_ms, now],
        )?;
        Ok(Message {
            id,
            session_id: session_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            model: model.map(String::from),
            cost,
            duration_ms,
            created_at: now,
        })
    }

    pub fn get_messages(&self, session_id: &str) -> SqlResult<Vec<Message>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, session_id, role, content, model, cost, duration_ms, created_at FROM messages WHERE session_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![session_id], |row| {
            Ok(Message {
                id: row.get(0)?,
                session_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                model: row.get(4)?,
                cost: row.get(5)?,
                duration_ms: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?;
        rows.collect()
    }

    // -----------------------------------------------------------------------
    // Reference dirs
    // -----------------------------------------------------------------------

    pub fn add_reference(&self, project_id: &str, path: &str, label: Option<&str>) -> SqlResult<ReferenceDir> {
        let id = uuid::Uuid::new_v4().to_string();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO reference_dirs (id, project_id, path, label) VALUES (?1, ?2, ?3, ?4)",
            params![id, project_id, path, label],
        )?;
        Ok(ReferenceDir {
            id,
            project_id: project_id.to_string(),
            path: path.to_string(),
            label: label.map(String::from),
        })
    }

    pub fn list_references(&self, project_id: &str) -> SqlResult<Vec<ReferenceDir>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, path, label FROM reference_dirs WHERE project_id = ?1 ORDER BY path ASC",
        )?;
        let rows = stmt.query_map(params![project_id], |row| {
            Ok(ReferenceDir {
                id: row.get(0)?,
                project_id: row.get(1)?,
                path: row.get(2)?,
                label: row.get(3)?,
            })
        })?;
        rows.collect()
    }

    pub fn remove_reference(&self, id: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM reference_dirs WHERE id = ?1", params![id])?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Settings
    // -----------------------------------------------------------------------

    pub fn get_setting(&self, key: &str) -> SqlResult<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query_map(params![key], |row| row.get::<_, String>(0))?;
        match rows.next() {
            Some(val) => Ok(Some(val?)),
            None => Ok(None),
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Checkpoints
    // -----------------------------------------------------------------------

    pub fn save_checkpoint(
        &self,
        session_id: &str,
        message_id: &str,
        git_commit_hash: Option<&str>,
        git_diff_summary: Option<&str>,
        project_path: &str,
    ) -> SqlResult<Checkpoint> {
        let now = chrono::Utc::now().to_rfc3339();
        let id = uuid::Uuid::new_v4().to_string();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO checkpoints (id, session_id, message_id, git_commit_hash, git_diff_summary, project_path, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, session_id, message_id, git_commit_hash, git_diff_summary, project_path, now],
        )?;
        Ok(Checkpoint {
            id,
            session_id: session_id.to_string(),
            message_id: message_id.to_string(),
            git_commit_hash: git_commit_hash.map(String::from),
            git_diff_summary: git_diff_summary.map(String::from),
            project_path: project_path.to_string(),
            created_at: now,
        })
    }

    pub fn get_checkpoints(&self, session_id: &str) -> SqlResult<Vec<Checkpoint>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, session_id, message_id, git_commit_hash, git_diff_summary, project_path, created_at FROM checkpoints WHERE session_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![session_id], |row| {
            Ok(Checkpoint {
                id: row.get(0)?,
                session_id: row.get(1)?,
                message_id: row.get(2)?,
                git_commit_hash: row.get(3)?,
                git_diff_summary: row.get(4)?,
                project_path: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?;
        rows.collect()
    }
}

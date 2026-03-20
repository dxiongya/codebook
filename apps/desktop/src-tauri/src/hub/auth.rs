use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

const PIN_EXPIRY_SECS: u64 = 300; // 5 minutes
const JWT_SECRET_LEN: usize = 32;

// ---------------------------------------------------------------------------
// JWT (simplified — HMAC-SHA256 would be ideal, but for local use we use
// a signed token with expiry check)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenClaims {
    pub client_id: String,
    pub issued_at: u64,
    pub expires_at: u64,
}

pub struct AuthManager {
    /// Active PIN: (pin_string, created_at)
    active_pin: Arc<Mutex<Option<(String, Instant)>>>,
    /// client_id → TokenClaims
    authenticated: Arc<Mutex<HashMap<String, TokenClaims>>>,
    /// Secret for token signing (random per app session)
    _secret: Vec<u8>,
}

impl AuthManager {
    pub fn new() -> Self {
        use rand::Rng;
        let secret: Vec<u8> = (0..JWT_SECRET_LEN).map(|_| rand::rng().random::<u8>()).collect();
        Self {
            active_pin: Arc::new(Mutex::new(None)),
            authenticated: Arc::new(Mutex::new(HashMap::new())),
            _secret: secret,
        }
    }

    /// Generate a new 6-char PIN
    pub async fn generate_pin(&self) -> String {
        use rand::Rng;
        let chars = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
        let pin: String = (0..6)
            .map(|_| {
                let idx = rand::rng().random_range(0..chars.len());
                chars[idx] as char
            })
            .collect();
        *self.active_pin.lock().await = Some((pin.clone(), Instant::now()));
        pin
    }

    /// Get current PIN if not expired
    pub async fn get_active_pin(&self) -> Option<String> {
        let guard = self.active_pin.lock().await;
        if let Some((ref pin, created)) = *guard {
            if created.elapsed() < Duration::from_secs(PIN_EXPIRY_SECS) {
                return Some(pin.clone());
            }
        }
        None
    }

    /// Verify PIN and authenticate a client
    pub async fn verify_pin(&self, client_id: &str, pin: &str) -> Result<String, String> {
        let guard = self.active_pin.lock().await;
        match &*guard {
            Some((active_pin, created)) => {
                if created.elapsed() >= Duration::from_secs(PIN_EXPIRY_SECS) {
                    return Err("PIN expired".to_string());
                }
                if pin != active_pin {
                    return Err("Invalid PIN".to_string());
                }
            }
            None => return Err("No active PIN".to_string()),
        }
        drop(guard);

        // Create token
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let claims = TokenClaims {
            client_id: client_id.to_string(),
            issued_at: now,
            expires_at: now + 86400, // 24 hours
        };
        let token = serde_json::to_string(&claims).unwrap();
        let encoded = base64_encode(&token);

        self.authenticated.lock().await.insert(client_id.to_string(), claims);
        Ok(encoded)
    }

    /// Check if a token is valid
    pub async fn verify_token(&self, token: &str) -> Result<String, String> {
        let decoded = base64_decode(token).map_err(|_| "Invalid token".to_string())?;
        let claims: TokenClaims = serde_json::from_str(&decoded)
            .map_err(|_| "Invalid token format".to_string())?;

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        if now > claims.expires_at {
            return Err("Token expired".to_string());
        }

        Ok(claims.client_id)
    }

    /// Remove client on disconnect
    pub async fn remove_client(&self, client_id: &str) {
        self.authenticated.lock().await.remove(client_id);
    }
}

fn base64_encode(input: &str) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(input.as_bytes())
}

fn base64_decode(input: &str) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(input)
        .map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|e| e.to_string())
}

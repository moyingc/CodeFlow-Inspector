use serde::Serialize;
use std::fs;
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{AppHandle, Manager};

const DATABASE_FILE: &str = "codeflow.sqlite3";

pub const ALLOWED_KNOWLEDGE_HOSTS: [&str; 5] = [
    "storage.googleapis.com",
    "api.osv.dev",
    "services.nvd.nist.gov",
    "cwe.mitre.org",
    "www.cisa.gov",
];

#[derive(Clone)]
pub struct NetworkPolicyState {
    enabled: Arc<AtomicBool>,
}

#[derive(Debug, Clone)]
pub struct NetworkPermit {
    enabled: Arc<AtomicBool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkPolicyReport {
    pub enabled: bool,
    pub public_egress_enabled: bool,
    pub private_network_allowed: bool,
    pub bridging_allowed: bool,
    pub private_scopes: Vec<String>,
    pub mode: String,
    pub scope: String,
    pub allowed_hosts: Vec<String>,
    pub inbound_listener: bool,
    pub session_only: bool,
    pub evidence: Vec<String>,
}

impl Default for NetworkPolicyState {
    fn default() -> Self {
        Self {
            enabled: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl NetworkPolicyState {
    pub fn report(&self) -> NetworkPolicyReport {
        let enabled = self.enabled.load(Ordering::SeqCst);
        NetworkPolicyReport {
            enabled,
            public_egress_enabled: enabled,
            private_network_allowed: true,
            bridging_allowed: false,
            private_scopes: vec![
                "127.0.0.0/8".to_string(),
                "10.0.0.0/8".to_string(),
                "172.16.0.0/12".to_string(),
                "192.168.0.0/16".to_string(),
                "169.254.0.0/16".to_string(),
                "::1/128".to_string(),
                "fc00::/7".to_string(),
                "fe80::/10".to_string(),
            ],
            mode: if enabled { "official-sources-only" } else { "public-network-locked" }.to_string(),
            scope: if enabled {
                "Private/local IPC remains isolated from the public route; only the signed knowledge importer may contact exact official HTTPS hosts."
            } else {
                "Public IP egress is denied. Loopback and private-network IPC remain local and cannot inherit, proxy or bridge public access."
            }
            .to_string(),
            allowed_hosts: ALLOWED_KNOWLEDGE_HOSTS.iter().map(ToString::to_string).collect(),
            inbound_listener: false,
            session_only: true,
            evidence: vec![
                "Network permission resets to off every time the desktop process starts.".to_string(),
                "The WebView production CSP denies all connect-src requests.".to_string(),
                "Controlled project execution and LSP processes never inherit knowledge-download permission.".to_string(),
                "Private routes and the public knowledge route use separate permits; forwarding and proxy bridging are not provided.".to_string(),
                "The desktop application does not bind an inbound TCP or UDP listener.".to_string(),
            ],
        }
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::SeqCst);
    }

    pub fn permit(&self) -> Result<NetworkPermit, String> {
        if !self.enabled.load(Ordering::SeqCst) {
            return Err(
                "network lock is closed; enable the official-source switch for this session first"
                    .to_string(),
            );
        }
        Ok(NetworkPermit {
            enabled: Arc::clone(&self.enabled),
        })
    }

    pub fn require_private_endpoint(&self, host: &str) -> Result<IpAddr, String> {
        let address = host
            .parse::<IpAddr>()
            .map_err(|_| "private IPC requires a literal IP address; hostnames are rejected to prevent DNS rebinding".to_string())?;
        let allowed = match address {
            IpAddr::V4(value) => value.is_loopback() || value.is_private() || value.is_link_local(),
            IpAddr::V6(value) => value.is_loopback() || value.is_unique_local() || value.is_unicast_link_local(),
        };
        if !allowed {
            return Err(format!("public or non-private address {address} was rejected by the private IPC gate"));
        }
        Ok(address)
    }
}

impl NetworkPermit {
    pub fn require_enabled(&self) -> Result<(), String> {
        if self.enabled.load(Ordering::SeqCst) {
            Ok(())
        } else {
            Err("network permission was revoked before the knowledge import completed".to_string())
        }
    }

    pub fn require_url(&self, url: &str) -> Result<(), String> {
        self.require_enabled()?;
        let parsed = url::Url::parse(url)
            .map_err(|error| format!("invalid knowledge source URL: {error}"))?;
        let host = parsed.host_str().unwrap_or_default();
        if parsed.scheme() != "https" || !ALLOWED_KNOWLEDGE_HOSTS.contains(&host) {
            return Err(format!(
                "network policy rejected non-official destination {host}"
            ));
        }
        if parsed.username() != "" || parsed.password().is_some() || parsed.port().is_some() {
            return Err(
                "network policy rejected credentials or a custom port in an official-source URL"
                    .to_string(),
            );
        }
        Ok(())
    }
}

pub fn set_policy(
    app: &AppHandle,
    state: &NetworkPolicyState,
    enabled: bool,
) -> Result<NetworkPolicyReport, String> {
    if enabled {
        append_event(app, true)?;
        state.set_enabled(true);
    } else {
        // Revocation is fail-safe: close the gate even if the audit database is unavailable.
        state.set_enabled(false);
        append_event(app, false)?;
    }
    Ok(state.report())
}

fn append_event(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let path = database_path(app)?;
    let conn = rusqlite::Connection::open(path)
        .map_err(|error| format!("failed to open network-policy audit database: {error}"))?;
    ensure_schema(&conn)?;
    let at = crate::now_ms();
    conn.execute(
        "INSERT INTO network_policy_events (id, enabled, scope, actor, created_at)
         VALUES (?1, ?2, 'official-knowledge-sources-session-only', 'local-user', ?3)",
        rusqlite::params![
            format!("network-policy-{at}-{}", i64::from(enabled)),
            i64::from(enabled),
            at as i64
        ],
    )
    .map_err(|error| format!("failed to append network-policy audit event: {error}"))?;
    Ok(())
}

pub(crate) fn ensure_schema(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS network_policy_events (
           id TEXT PRIMARY KEY,
           enabled INTEGER NOT NULL,
           scope TEXT NOT NULL,
           actor TEXT NOT NULL,
           created_at INTEGER NOT NULL
         );
         CREATE TRIGGER IF NOT EXISTS network_policy_events_no_update
         BEFORE UPDATE ON network_policy_events BEGIN SELECT RAISE(ABORT, 'network policy events are immutable'); END;
         CREATE TRIGGER IF NOT EXISTS network_policy_events_no_delete
         BEFORE DELETE ON network_policy_events BEGIN SELECT RAISE(ABORT, 'network policy events are immutable'); END;",
    )
    .map_err(|error| format!("failed to initialize network-policy schema: {error}"))
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve network-policy database directory: {error}"))?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("failed to create network-policy database directory: {error}"))?;
    Ok(directory.join(DATABASE_FILE))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn policy_is_off_by_default_and_only_allows_exact_https_hosts() {
        let state = NetworkPolicyState::default();
        assert!(!state.report().enabled);
        assert!(state.permit().is_err());
        state.set_enabled(true);
        let permit = state.permit().expect("create session permit");
        assert!(permit
            .require_url("https://api.osv.dev/v1/vulns/GHSA-test")
            .is_ok());
        assert!(permit
            .require_url("http://api.osv.dev/v1/vulns/GHSA-test")
            .is_err());
        assert!(permit
            .require_url("https://api.osv.dev.attacker.invalid/")
            .is_err());
        assert!(permit.require_url("https://user@api.osv.dev/").is_err());
        state.set_enabled(false);
        assert!(permit.require_enabled().is_err());
        assert!(state.require_private_endpoint("127.0.0.1").is_ok());
        assert!(state.require_private_endpoint("192.168.10.4").is_ok());
        assert!(state.require_private_endpoint("fd00::1").is_ok());
        assert!(state.require_private_endpoint("8.8.8.8").is_err());
        assert!(state.require_private_endpoint("example.com").is_err());
    }

    #[test]
    fn policy_audit_is_immutable() {
        let conn = rusqlite::Connection::open_in_memory().expect("open sqlite");
        ensure_schema(&conn).expect("create network schema");
        conn.execute(
            "INSERT INTO network_policy_events (id, enabled, scope, actor, created_at)
             VALUES ('event-1', 1, 'fixture', 'test', 1)",
            [],
        )
        .expect("insert event");
        assert!(conn
            .execute("DELETE FROM network_policy_events", [])
            .is_err());
    }
}

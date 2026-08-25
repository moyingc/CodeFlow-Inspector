use chrono::{Duration as ChronoDuration, SecondsFormat, Utc};
use quick_xml::events::Event;
use quick_xml::Reader;
use reqwest::blocking::Client;
use rusqlite::{params, Connection, OptionalExtension};
use semver::Version;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use zip::ZipArchive;

use crate::network_policy::NetworkPermit;

const DATABASE_FILE: &str = "codeflow.sqlite3";
const ACTIVE_STATE_ID: &str = "active-knowledge-pack";
const SIGNING_ALGORITHM: &str = "HMAC-SHA256-local-integrity-v1";
const MAX_ARTIFACT_BYTES: usize = 80 * 1024 * 1024;

#[derive(Debug, Clone, Copy)]
struct SourcePolicy {
    id: &'static str,
    name: &'static str,
    source_kind: &'static str,
    base_url: &'static str,
    license_id: &'static str,
    attribution: &'static str,
    commercial_allowed: bool,
    redistribution_allowed: bool,
    notice: &'static str,
}

const SOURCES: [SourcePolicy; 4] = [
    SourcePolicy {
        id: "osv",
        name: "OSV.dev",
        source_kind: "vulnerability",
        base_url: "https://storage.googleapis.com/osv-vulnerabilities/modified_id.csv",
        license_id: "MIXED-PER-RECORD",
        attribution: "OSV.dev and each authoritative advisory source",
        commercial_allowed: true,
        redistribution_allowed: false,
        notice: "OSV is an aggregator; every normalized record retains its source license.",
    },
    SourcePolicy {
        id: "nvd",
        name: "NIST National Vulnerability Database",
        source_kind: "vulnerability",
        base_url: "https://services.nvd.nist.gov/rest/json/cves/2.0",
        license_id: "NIST-PUBLIC-DOMAIN",
        attribution: "National Institute of Standards and Technology",
        commercial_allowed: true,
        redistribution_allowed: true,
        notice:
            "This product uses data from the NVD API but is not endorsed or certified by the NVD.",
    },
    SourcePolicy {
        id: "cwe",
        name: "MITRE CWE",
        source_kind: "weakness",
        base_url: "https://cwe.mitre.org/data/xml/cwec_latest.xml.zip",
        license_id: "MITRE-CWE-TERMS",
        attribution:
            "Copyright The MITRE Corporation. CWE is a trademark of The MITRE Corporation.",
        commercial_allowed: true,
        redistribution_allowed: true,
        notice: "Use is subject to the MITRE CWE Terms of Use and required copyright designation.",
    },
    SourcePolicy {
        id: "kev",
        name: "CISA Known Exploited Vulnerabilities",
        source_kind: "exploitation-priority",
        base_url:
            "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
        license_id: "CISA-USE-NOTICE",
        attribution: "Cybersecurity and Infrastructure Security Agency",
        commercial_allowed: true,
        redistribution_allowed: false,
        notice: "KEV is used as prioritization evidence and does not prove project exploitability.",
    },
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgePackImportRequest {
    pub sources: Vec<String>,
    pub max_records_per_source: usize,
    pub nvd_lookback_days: i64,
    pub auto_activate: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSourceStatus {
    pub id: String,
    pub name: String,
    pub license_id: String,
    pub commercial_allowed: bool,
    pub redistribution_allowed: bool,
    pub last_checked_at: u128,
    pub last_status: String,
    pub record_count: usize,
    pub evidence: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgePackSummary {
    pub id: String,
    pub version: String,
    pub status: String,
    pub source_count: usize,
    pub record_count: usize,
    pub quarantined_count: usize,
    pub validation_score: f64,
    pub content_hash: String,
    pub signature: String,
    pub signature_valid: bool,
    pub created_at: u128,
    pub activated_at: Option<u128>,
    pub evidence: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgePackStatusReport {
    pub status: String,
    pub database_path: String,
    pub active_pack_id: Option<String>,
    pub previous_pack_id: Option<String>,
    pub source_count: usize,
    pub pack_count: usize,
    pub active_record_count: usize,
    pub quarantined_record_count: usize,
    pub event_count: usize,
    pub knowledge_maturity: usize,
    pub sources: Vec<KnowledgeSourceStatus>,
    pub packs: Vec<KnowledgePackSummary>,
    pub legal_notices: Vec<String>,
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDependencyInput {
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub version_constraint: String,
    pub ecosystem: String,
    pub source_file: String,
    #[serde(default = "default_dependency_resolution")]
    pub resolution: String,
    #[serde(default)]
    pub exact: bool,
}

fn default_dependency_resolution() -> String {
    "manifest".to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectKnowledgeMatch {
    pub dependency_name: String,
    pub dependency_version: String,
    pub source_file: String,
    pub advisory_id: String,
    pub source_id: String,
    pub severity: String,
    pub title: String,
    pub cwe_ids: Vec<String>,
    pub affected_range: String,
    pub match_status: String,
    pub confidence: usize,
    pub kev_priority: bool,
    pub evidence: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectKnowledgeMatchReport {
    pub status: String,
    pub active_pack_id: Option<String>,
    pub dependency_count: usize,
    pub confirmed_count: usize,
    pub review_count: usize,
    pub matches: Vec<ProjectKnowledgeMatch>,
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupplementalKnowledgeImportRequest {
    pub bundle_json: String,
    pub artifact_hash: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SupplementalKnowledgeBundle {
    source_name: String,
    source_url: String,
    license_id: String,
    version: String,
    published_at: String,
    records: Vec<SupplementalKnowledgeRecord>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SupplementalKnowledgeRecord {
    id: String,
    kind: String,
    title: String,
    evidence: String,
    observed_at: String,
    payload: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupplementalKnowledgeReport {
    pub bundle_id: String,
    pub status: String,
    pub record_count: usize,
    pub content_hash: String,
    pub signature: String,
    pub evidence: Vec<String>,
}

#[derive(Debug)]
struct DownloadedArtifact {
    source: SourcePolicy,
    source_url: String,
    content_type: String,
    etag: String,
    payload: Vec<u8>,
    fetched_at: u128,
}

#[derive(Debug, Clone, Serialize)]
struct NormalizedRecord {
    id: String,
    source_id: String,
    external_id: String,
    record_kind: String,
    ecosystem: String,
    package_name: String,
    affected_range: String,
    severity: String,
    cwe_ids: Vec<String>,
    title: String,
    summary: String,
    references: Vec<String>,
    modified_at: String,
    license_id: String,
    attribution: String,
    commercial_allowed: bool,
    redistribution_allowed: bool,
    status: String,
    quarantine_reason: String,
    normalized: Value,
    record_hash: String,
}

pub async fn import_pack(
    app: AppHandle,
    request: KnowledgePackImportRequest,
    permit: NetworkPermit,
) -> Result<KnowledgePackStatusReport, String> {
    tauri::async_runtime::spawn_blocking(move || import_pack_sync(&app, request, permit))
        .await
        .map_err(|error| format!("knowledge pack import worker failed: {error}"))?
}

pub fn status(app: &AppHandle) -> Result<KnowledgePackStatusReport, String> {
    with_database(app, |conn, path| build_status(conn, app, &path))
}

pub fn activate(app: &AppHandle, pack_id: &str) -> Result<KnowledgePackStatusReport, String> {
    with_database(app, |conn, path| {
        activate_pack(conn, app, pack_id, "activate")?;
        build_status(conn, app, &path)
    })
}

pub fn rollback(app: &AppHandle) -> Result<KnowledgePackStatusReport, String> {
    with_database(app, |conn, path| {
        let (active, previous) = active_state(conn)?;
        let target = previous
            .ok_or_else(|| "no previous knowledge pack is available for rollback".to_string())?;
        let current = active.ok_or_else(|| "no active knowledge pack exists".to_string())?;
        verify_pack_integrity(conn, app, &target)?;
        let now = now_ms();
        let tx = conn
            .transaction()
            .map_err(|error| format!("failed to begin knowledge rollback: {error}"))?;
        tx.execute(
            "UPDATE knowledge_pack_versions SET status = 'rolled_back' WHERE id = ?1",
            params![current],
        )
        .map_err(|error| format!("failed to retire current knowledge pack: {error}"))?;
        tx.execute(
            "UPDATE knowledge_pack_versions SET status = 'active', activated_at = ?2 WHERE id = ?1",
            params![target, now as i64],
        )
        .map_err(|error| format!("failed to reactivate previous knowledge pack: {error}"))?;
        tx.execute(
            "INSERT OR REPLACE INTO knowledge_pack_state
             (id, active_pack_id, previous_pack_id, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![ACTIVE_STATE_ID, target, current, now as i64],
        )
        .map_err(|error| format!("failed to update knowledge rollback state: {error}"))?;
        insert_event(
            &tx,
            &target,
            "rollback",
            "superseded",
            "active",
            "local-user",
            "signature verified; previous pack restored",
            now,
        )?;
        tx.commit()
            .map_err(|error| format!("failed to commit knowledge rollback: {error}"))?;
        build_status(conn, app, &path)
    })
}

pub fn import_supplemental_bundle(
    app: &AppHandle,
    request: SupplementalKnowledgeImportRequest,
) -> Result<SupplementalKnowledgeReport, String> {
    if request.bundle_json.is_empty() || request.bundle_json.len() > 20 * 1024 * 1024 {
        return Err("supplemental knowledge bundle must be between 1 byte and 20MB".to_string());
    }
    let artifact_hash = sha256_hex(request.bundle_json.as_bytes());
    if artifact_hash != request.artifact_hash.to_ascii_lowercase() {
        return Err("supplemental knowledge artifact SHA-256 mismatch".to_string());
    }
    let bundle: SupplementalKnowledgeBundle = serde_json::from_str(&request.bundle_json)
        .map_err(|error| format!("supplemental knowledge JSON is invalid: {error}"))?;
    validate_supplemental_bundle(&bundle)?;
    let canonical =
        canonical_json(&serde_json::to_value(&bundle).map_err(|error| error.to_string())?);
    let content_hash = sha256_hex(canonical.as_bytes());
    let signature = sign_hash(app, &content_hash)?;
    let bundle_id = format!("supplemental-{}", &content_hash[..24]);
    with_database(app, |conn, _| {
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT OR REPLACE INTO supplemental_knowledge_bundles
             (id, source_name, source_url, license_id, version, published_at, artifact_hash,
              manifest_json, content_hash, signature, status, record_count, created_at, activated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'staged', ?11, ?12, NULL)",
            params![bundle_id, bundle.source_name, bundle.source_url, bundle.license_id, bundle.version,
                bundle.published_at, artifact_hash, canonical, content_hash, signature,
                bundle.records.len() as i64, now_ms() as i64],
        ).map_err(|error| format!("failed to stage supplemental bundle: {error}"))?;
        tx.execute(
            "DELETE FROM supplemental_knowledge_records WHERE bundle_id = ?1",
            params![bundle_id],
        )
        .map_err(|error| error.to_string())?;
        for record in &bundle.records {
            let normalized =
                canonical_json(&serde_json::to_value(record).map_err(|error| error.to_string())?);
            let record_hash = sha256_hex(normalized.as_bytes());
            tx.execute(
                "INSERT INTO supplemental_knowledge_records
                 (id, bundle_id, record_kind, title, evidence, observed_at, payload_json, record_hash, status)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'quarantined')",
                params![format!("{}:{}", bundle_id, record.id), bundle_id, record.kind, record.title,
                    record.evidence, record.observed_at, canonical_json(&record.payload), record_hash],
            ).map_err(|error| format!("failed to stage supplemental record {}: {error}", record.id))?;
        }
        tx.commit().map_err(|error| error.to_string())?;
        Ok(())
    })?;
    Ok(SupplementalKnowledgeReport {
        bundle_id,
        status: "staged".to_string(),
        record_count: bundle.records.len(),
        content_hash,
        signature,
        evidence: vec![
            "Artifact SHA-256, HTTPS provenance, license, timestamps and kind-specific fields passed.".to_string(),
            "Records remain quarantined until the local activation step replays hashes and signature.".to_string(),
        ],
    })
}

pub fn activate_supplemental_bundle(
    app: &AppHandle,
    bundle_id: &str,
) -> Result<SupplementalKnowledgeReport, String> {
    with_database(app, |conn, _| {
        let (manifest, content_hash, signature, record_count) = conn.query_row(
            "SELECT manifest_json, content_hash, signature, record_count FROM supplemental_knowledge_bundles WHERE id = ?1",
            params![bundle_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, usize>(3)?)),
        ).optional().map_err(|error| error.to_string())?.ok_or_else(|| "supplemental bundle not found".to_string())?;
        if sha256_hex(manifest.as_bytes()) != content_hash
            || sign_hash(app, &content_hash)? != signature
        {
            return Err(
                "supplemental bundle integrity or signature verification failed".to_string(),
            );
        }
        let bundle: SupplementalKnowledgeBundle =
            serde_json::from_str(&manifest).map_err(|error| error.to_string())?;
        validate_supplemental_bundle(&bundle)?;
        if bundle.records.len() != record_count {
            return Err("supplemental bundle record count changed after staging".to_string());
        }
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        for record in &bundle.records {
            let normalized =
                canonical_json(&serde_json::to_value(record).map_err(|error| error.to_string())?);
            let expected_hash = sha256_hex(normalized.as_bytes());
            let stored_hash: String = tx.query_row(
                "SELECT record_hash FROM supplemental_knowledge_records WHERE id = ?1 AND bundle_id = ?2",
                params![format!("{}:{}", bundle_id, record.id), bundle_id], |row| row.get(0),
            ).map_err(|error| format!("supplemental record replay failed: {error}"))?;
            if stored_hash != expected_hash {
                return Err(format!("supplemental record {} hash mismatch", record.id));
            }
        }
        tx.execute(
            "UPDATE supplemental_knowledge_records SET status='active' WHERE bundle_id=?1",
            params![bundle_id],
        )
        .map_err(|error| error.to_string())?;
        tx.execute("UPDATE supplemental_knowledge_bundles SET status='active', activated_at=?2 WHERE id=?1", params![bundle_id, now_ms() as i64]).map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
        Ok(SupplementalKnowledgeReport {
            bundle_id: bundle_id.to_string(),
            status: "active".to_string(),
            record_count,
            content_hash,
            signature,
            evidence: vec![
                "Local signature and every normalized record hash replayed successfully."
                    .to_string(),
            ],
        })
    })
}

fn validate_supplemental_bundle(bundle: &SupplementalKnowledgeBundle) -> Result<(), String> {
    if !bundle.source_url.starts_with("https://")
        || bundle.source_name.trim().is_empty()
        || bundle.license_id.trim().is_empty()
        || bundle.version.trim().is_empty()
    {
        return Err(
            "supplemental bundle requires HTTPS source, source name, license and version"
                .to_string(),
        );
    }
    chrono::DateTime::parse_from_rfc3339(&bundle.published_at)
        .map_err(|_| "supplemental bundle publishedAt must be RFC3339".to_string())?;
    if bundle.records.is_empty() || bundle.records.len() > 5_000 {
        return Err("supplemental bundle accepts 1..5000 records".to_string());
    }
    let mut ids = BTreeSet::new();
    for record in &bundle.records {
        if !ids.insert(record.id.as_str())
            || record.id.trim().is_empty()
            || record.title.trim().is_empty()
            || record.evidence.trim().is_empty()
            || !record.payload.is_object()
        {
            return Err(format!(
                "supplemental record {} is incomplete or duplicated",
                record.id
            ));
        }
        chrono::DateTime::parse_from_rfc3339(&record.observed_at).map_err(|_| {
            format!(
                "supplemental record {} observedAt must be RFC3339",
                record.id
            )
        })?;
        let required: &[&str] = match record.kind.as_str() {
            "sdk" => &["ecosystem", "package", "version"],
            "fault" => &["language", "failureMode", "reproduction"],
            "benchmark" => &["algorithm", "inputScale", "metrics"],
            "hardware" => &["component", "datasheet", "safeBounds"],
            "repair" => &["ruleId", "beforeHash", "afterHash", "validation"],
            _ => {
                return Err(format!(
                    "unsupported supplemental record kind: {}",
                    record.kind
                ))
            }
        };
        if required
            .iter()
            .any(|field| record.payload.get(*field).is_none())
        {
            return Err(format!(
                "supplemental record {} lacks required {} fields",
                record.id, record.kind
            ));
        }
    }
    Ok(())
}

pub fn match_project_dependencies(
    app: &AppHandle,
    dependencies: Vec<ProjectDependencyInput>,
) -> Result<ProjectKnowledgeMatchReport, String> {
    with_database(app, |conn, _| {
        let (active_pack_id, _) = active_state(conn)?;
        if let Some(pack_id) = active_pack_id.as_deref() {
            verify_pack_integrity(conn, app, pack_id)?;
        }
        match_dependencies(conn, dependencies)
    })
}

fn match_dependencies(
    conn: &Connection,
    dependencies: Vec<ProjectDependencyInput>,
) -> Result<ProjectKnowledgeMatchReport, String> {
    let (active_pack_id, _) = active_state(conn)?;
    let Some(pack_id) = active_pack_id else {
        return Ok(ProjectKnowledgeMatchReport {
            status: "no-active-pack".to_string(),
            active_pack_id: None,
            dependency_count: dependencies.len().min(500),
            confirmed_count: 0,
            review_count: 0,
            matches: Vec::new(),
            evidence: vec![
                "Activate a signed knowledge pack before dependency matching.".to_string(),
            ],
        });
    };
    let dependencies = dependencies
        .into_iter()
        .filter(|dependency| !dependency.name.trim().is_empty())
        .take(500)
        .collect::<Vec<_>>();
    let kev_ids = active_external_ids(conn, &pack_id, "kev")?;
    let mut matches = Vec::new();
    for dependency in &dependencies {
        let ecosystem = normalized_dependency_ecosystem(&dependency.ecosystem);
        let mut statement = conn
            .prepare(
                "SELECT source_id, external_id, severity, title, cwe_ids, affected_range, normalized_json
                 FROM knowledge_records
                 WHERE pack_id = ?1 AND status = 'accepted' AND record_kind = 'vulnerability'
                   AND lower(package_name) = lower(?2)
                   AND (source_id = 'nvd' OR lower(ecosystem) = lower(?3))
                 ORDER BY source_id, external_id LIMIT 100",
            )
            .map_err(|error| format!("failed to prepare dependency knowledge match: {error}"))?;
        let rows = statement
            .query_map(params![pack_id, dependency.name.trim(), ecosystem], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                ))
            })
            .map_err(|error| format!("failed to query dependency knowledge match: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("failed to collect dependency knowledge match: {error}"))?;
        for (source_id, advisory_id, severity, title, cwe_json, affected_range, normalized_json) in
            rows
        {
            let normalized = serde_json::from_str::<Value>(&normalized_json).unwrap_or(Value::Null);
            let version_match = if dependency.exact {
                dependency_version_match(&source_id, &dependency.version, &normalized)
            } else {
                VersionMatch::Unknown
            };
            if version_match == VersionMatch::NotAffected {
                continue;
            }
            let confirmed = version_match == VersionMatch::Affected;
            matches.push(ProjectKnowledgeMatch {
                dependency_name: dependency.name.clone(),
                dependency_version: dependency.version.clone(),
                source_file: dependency.source_file.clone(),
                advisory_id: advisory_id.clone(),
                source_id,
                severity,
                title,
                cwe_ids: serde_json::from_str(&cwe_json).unwrap_or_default(),
                affected_range,
                match_status: if confirmed { "confirmed" } else { "review" }.to_string(),
                confidence: if confirmed { 96 } else if dependency.exact { 68 } else { 54 },
                kev_priority: kev_ids.contains(&advisory_id),
                evidence: if confirmed {
                    format!(
                        "Exact {} version {} from {} falls inside the normalized affected window.",
                        dependency.resolution, dependency.version, dependency.source_file
                    )
                } else if !dependency.exact {
                    format!(
                        "Package matched, but {} contains the unresolved constraint {}; a lockfile version is required before confirmation.",
                        dependency.source_file,
                        if dependency.version_constraint.is_empty() { &dependency.version } else { &dependency.version_constraint }
                    )
                } else {
                    "Package matched, but the source did not provide a machine-verifiable version window.".to_string()
                },
            });
        }
    }
    matches.sort_by(|left, right| {
        right
            .kev_priority
            .cmp(&left.kev_priority)
            .then_with(|| right.confidence.cmp(&left.confidence))
            .then_with(|| left.dependency_name.cmp(&right.dependency_name))
    });
    matches.truncate(500);
    let confirmed_count = matches
        .iter()
        .filter(|item| item.match_status == "confirmed")
        .count();
    let review_count = matches.len().saturating_sub(confirmed_count);
    Ok(ProjectKnowledgeMatchReport {
        status: if matches.is_empty() { "clear" } else { "matched" }.to_string(),
        active_pack_id: Some(pack_id),
        dependency_count: dependencies.len(),
        confirmed_count,
        review_count,
        matches,
        evidence: vec![
            "The active pack signature is reverified before exact package and ecosystem matching begins.".to_string(),
            "KEV raises priority only after a CVE match; it never proves exploitability by itself.".to_string(),
            "Unparseable or absent version windows remain review items rather than confirmed vulnerabilities.".to_string(),
            "Manifest ranges never become confirmed matches unless a lockfile or exact pin resolves the installed version.".to_string(),
        ],
    })
}

fn normalized_dependency_ecosystem(value: &str) -> &str {
    let value = value.trim();
    if value.eq_ignore_ascii_case("pypi") || value.eq_ignore_ascii_case("python") {
        "PyPI"
    } else if value.eq_ignore_ascii_case("npm")
        || value.eq_ignore_ascii_case("javascript")
        || value.eq_ignore_ascii_case("typescript")
    {
        "npm"
    } else if value.eq_ignore_ascii_case("crates.io")
        || value.eq_ignore_ascii_case("cargo")
        || value.eq_ignore_ascii_case("rust")
    {
        "crates.io"
    } else if value.eq_ignore_ascii_case("go") || value.eq_ignore_ascii_case("golang") {
        "Go"
    } else if value.eq_ignore_ascii_case("maven") || value.eq_ignore_ascii_case("java") {
        "Maven"
    } else {
        value
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VersionMatch {
    Affected,
    NotAffected,
    Unknown,
}

fn dependency_version_match(source_id: &str, version: &str, normalized: &Value) -> VersionMatch {
    let version = version.trim().trim_start_matches(['v', '=']);
    let Ok(current) = Version::parse(version) else {
        return VersionMatch::Unknown;
    };
    if source_id == "osv" {
        let affected = normalized.get("affected").unwrap_or(&Value::Null);
        if affected
            .get("versions")
            .and_then(Value::as_array)
            .is_some_and(|versions| {
                versions
                    .iter()
                    .filter_map(Value::as_str)
                    .any(|item| item.trim_start_matches('v') == version)
            })
        {
            return VersionMatch::Affected;
        }
        let mut saw_window = false;
        for range in affected
            .get("ranges")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let mut introduced = None;
            let mut fixed = None;
            let mut last_affected = None;
            for event in range
                .get("events")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                introduced = event
                    .get("introduced")
                    .and_then(Value::as_str)
                    .and_then(parse_advisory_version)
                    .or(introduced);
                fixed = event
                    .get("fixed")
                    .and_then(Value::as_str)
                    .and_then(parse_advisory_version)
                    .or(fixed);
                last_affected = event
                    .get("last_affected")
                    .and_then(Value::as_str)
                    .and_then(parse_advisory_version)
                    .or(last_affected);
            }
            if introduced.is_some() || fixed.is_some() || last_affected.is_some() {
                saw_window = true;
                let after_start = introduced.as_ref().is_none_or(|start| current >= *start);
                let before_end = fixed.as_ref().is_none_or(|end| current < *end);
                let before_last = last_affected.as_ref().is_none_or(|end| current <= *end);
                if after_start && before_end && before_last {
                    return VersionMatch::Affected;
                }
            }
        }
        return if saw_window {
            VersionMatch::NotAffected
        } else {
            VersionMatch::Unknown
        };
    }
    if source_id == "nvd" {
        let cpes = normalized
            .get("cpes")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if cpes.is_empty() {
            return VersionMatch::Unknown;
        }
        let mut saw_version = false;
        for cpe in cpes.iter().filter_map(Value::as_str) {
            let cpe_version = cpe.split(':').nth(5).unwrap_or("*");
            if cpe_version == "*" || cpe_version == "-" {
                return VersionMatch::Unknown;
            }
            if let Some(candidate) = parse_advisory_version(cpe_version) {
                saw_version = true;
                if current == candidate {
                    return VersionMatch::Affected;
                }
            }
        }
        return if saw_version {
            VersionMatch::NotAffected
        } else {
            VersionMatch::Unknown
        };
    }
    VersionMatch::Unknown
}

fn parse_advisory_version(value: &str) -> Option<Version> {
    if value == "0" {
        return Some(Version::new(0, 0, 0));
    }
    Version::parse(value.trim_start_matches('v')).ok()
}

fn active_external_ids(
    conn: &Connection,
    pack_id: &str,
    source_id: &str,
) -> Result<BTreeSet<String>, String> {
    let mut statement = conn
        .prepare("SELECT external_id FROM knowledge_records WHERE pack_id = ?1 AND source_id = ?2 AND status = 'accepted'")
        .map_err(|error| format!("failed to prepare active knowledge IDs: {error}"))?;
    let ids = statement
        .query_map(params![pack_id, source_id], |row| row.get::<_, String>(0))
        .map_err(|error| format!("failed to query active knowledge IDs: {error}"))?
        .collect::<Result<BTreeSet<_>, _>>()
        .map_err(|error| format!("failed to collect active knowledge IDs: {error}"))?;
    Ok(ids)
}

fn import_pack_sync(
    app: &AppHandle,
    request: KnowledgePackImportRequest,
    permit: NetworkPermit,
) -> Result<KnowledgePackStatusReport, String> {
    permit.require_enabled()?;
    let selected = selected_sources(&request.sources)?;
    if selected.len() != SOURCES.len() {
        return Err(
            "phase-one knowledge packs must include OSV, NVD, CWE and KEV together".to_string(),
        );
    }
    let max_records = request.max_records_per_source.clamp(10, 2_000);
    let lookback_days = request.nvd_lookback_days.clamp(1, 120);
    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("CodeFlow-Inspector/0.1 local-knowledge-pack-updater")
        .build()
        .map_err(|error| format!("failed to create knowledge source client: {error}"))?;

    let mut artifacts = Vec::new();
    for source in selected {
        artifacts.push(download_source(
            &client,
            source,
            max_records,
            lookback_days,
            &permit,
        )?);
    }
    permit.require_enabled()?;
    let mut records = Vec::new();
    for artifact in &artifacts {
        records.extend(normalize_artifact(artifact, max_records)?);
    }
    if records.is_empty() {
        return Err("official sources returned no normalizable knowledge records".to_string());
    }

    with_database(app, |conn, path| {
        let created_at = now_ms();
        let pack_id = format!("knowledge-pack-{created_at}");
        let version = Utc::now().format("phase1-%Y.%m.%d-%H%M%S").to_string();
        let parent_pack_id = active_state(conn)?.0;
        let accepted_count = records
            .iter()
            .filter(|record| record.status == "accepted")
            .count();
        let quarantined_count = records.len().saturating_sub(accepted_count);
        let source_counts =
            records
                .iter()
                .fold(BTreeMap::<String, usize>::new(), |mut counts, record| {
                    *counts.entry(record.source_id.clone()).or_default() += 1;
                    counts
                });
        let replay = validate_normalized_records(&records);
        let license_pass = records
            .iter()
            .filter(|record| record.status == "accepted")
            .all(|record| record.commercial_allowed && record.license_id != "UNKNOWN");
        let schema_pass = accepted_count > 0 && replay.invalid_count == 0;
        let sources_pass = artifacts.len() == SOURCES.len()
            && SOURCES
                .iter()
                .all(|source| source_counts.get(source.id).copied().unwrap_or(0) > 0);
        let validation_score = (if sources_pass { 25.0 } else { 0.0 })
            + (if schema_pass { 25.0 } else { 0.0 })
            + (if license_pass { 20.0 } else { 0.0 })
            + (if replay.passed { 20.0 } else { 0.0 })
            + if accepted_count >= 20 { 10.0 } else { 5.0 };
        let pack_status = if validation_score >= 90.0 {
            "signed"
        } else {
            "quarantined"
        };
        let manifest = json!({
            "schemaVersion": 1,
            "packId": pack_id,
            "version": version,
            "createdAt": created_at,
            "parentPackId": parent_pack_id,
            "sources": artifacts.iter().map(|artifact| json!({
                "id": artifact.source.id,
                "url": artifact.source_url,
                "sha256": sha256_hex(&artifact.payload),
                "etag": artifact.etag,
                "license": artifact.source.license_id,
                "attribution": artifact.source.attribution,
            })).collect::<Vec<_>>(),
            "recordCount": records.len(),
            "acceptedCount": accepted_count,
            "quarantinedCount": quarantined_count,
            "validationScore": validation_score,
            "signingAlgorithm": SIGNING_ALGORITHM,
        });
        let manifest_json = canonical_json(&manifest);

        let tx = conn
            .transaction()
            .map_err(|error| format!("failed to begin knowledge staging transaction: {error}"))?;
        tx.execute(
            "INSERT INTO knowledge_pack_versions
             (id, version, parent_pack_id, status, manifest_json, content_hash, signature,
              signature_algorithm, key_id, source_count, record_count, quarantined_count,
              validation_score, created_at, activated_at, evidence)
             VALUES (?1, ?2, ?3, 'staging', ?4, '', '', ?5, 'local-integrity-key-v1', ?6, ?7, ?8, ?9, ?10, NULL, ?11)",
            params![
                pack_id,
                version,
                parent_pack_id,
                manifest_json,
                SIGNING_ALGORITHM,
                artifacts.len() as i64,
                records.len() as i64,
                quarantined_count as i64,
                validation_score,
                created_at as i64,
                "official sources downloaded into isolated staging tables"
            ],
        )
        .map_err(|error| format!("failed to create staged knowledge pack: {error}"))?;

        for artifact in &artifacts {
            insert_artifact(&tx, &pack_id, artifact)?;
            update_source_status(
                &tx,
                artifact,
                source_counts.get(artifact.source.id).copied().unwrap_or(0),
                "imported",
            )?;
        }
        for record in &records {
            insert_record(&tx, &pack_id, record, created_at)?;
        }
        insert_event(
            &tx,
            &pack_id,
            "download",
            "none",
            "staging",
            "official-adapters",
            "four source artifacts archived with SHA-256",
            created_at,
        )?;
        tx.commit().map_err(|error| {
            format!("failed to commit isolated knowledge staging data: {error}")
        })?;

        let content_hash = compute_pack_hash(conn, &pack_id, &manifest_json)?;
        let signature = sign_hash(app, &content_hash)?;
        conn.execute(
            "UPDATE knowledge_pack_versions
             SET status = ?2, content_hash = ?3, signature = ?4, evidence = ?5
             WHERE id = ?1",
            params![
                pack_id,
                pack_status,
                content_hash,
                signature,
                format!("schema={schema_pass}; license={license_pass}; replay={}; sources={sources_pass}", replay.passed)
            ],
        )
        .map_err(|error| format!("failed to seal knowledge pack: {error}"))?;
        conn.execute(
            "INSERT INTO knowledge_validation_runs
             (id, pack_id, schema_pass, license_pass, replay_pass, signature_pass,
              source_count, record_count, rejected_count, score, evidence, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                format!("validation-{pack_id}"),
                pack_id,
                i64::from(schema_pass),
                i64::from(license_pass),
                i64::from(replay.passed),
                artifacts.len() as i64,
                records.len() as i64,
                quarantined_count as i64,
                validation_score,
                replay.evidence.join("; "),
                now_ms() as i64
            ],
        )
        .map_err(|error| format!("failed to archive knowledge validation: {error}"))?;
        append_event(
            conn,
            &pack_id,
            "seal",
            "staging",
            pack_status,
            "local-integrity-signer",
            "manifest, raw artifacts and normalized records sealed",
            now_ms(),
        )?;

        if request.auto_activate && pack_status == "signed" {
            activate_pack(conn, app, &pack_id, "auto-activate")?;
        }
        build_status(conn, app, &path)
    })
}

fn selected_sources(ids: &[String]) -> Result<Vec<SourcePolicy>, String> {
    if ids.is_empty() {
        return Ok(SOURCES.to_vec());
    }
    let selected = ids
        .iter()
        .map(|id| id.to_ascii_lowercase())
        .collect::<BTreeSet<_>>();
    let unknown = selected
        .iter()
        .filter(|id| !SOURCES.iter().any(|source| source.id == id.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    if !unknown.is_empty() {
        return Err(format!("unknown knowledge sources: {}", unknown.join(", ")));
    }
    Ok(SOURCES
        .iter()
        .copied()
        .filter(|source| selected.contains(source.id))
        .collect())
}

fn download_source(
    client: &Client,
    source: SourcePolicy,
    max_records: usize,
    lookback_days: i64,
    permit: &NetworkPermit,
) -> Result<DownloadedArtifact, String> {
    permit.require_url(source.base_url)?;
    match source.id {
        "osv" => download_osv(client, source, max_records, permit),
        "nvd" => download_nvd(client, source, max_records, lookback_days, permit),
        _ => download_url(client, source, source.base_url, permit),
    }
}

fn download_url(
    client: &Client,
    source: SourcePolicy,
    url: &str,
    permit: &NetworkPermit,
) -> Result<DownloadedArtifact, String> {
    permit.require_url(url)?;
    let mut response = client
        .get(url)
        .send()
        .map_err(|error| format!("{} download failed: {error}", source.name))?;
    if !response.status().is_success() {
        return Err(format!(
            "{} returned HTTP {}",
            source.name,
            response.status()
        ));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let etag = response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let payload = read_bounded_response(&mut response, MAX_ARTIFACT_BYTES, source.name)?;
    if payload.is_empty() || payload.len() > MAX_ARTIFACT_BYTES {
        return Err(format!(
            "{} artifact size {} is outside the allowed range",
            source.name,
            payload.len()
        ));
    }
    Ok(DownloadedArtifact {
        source,
        source_url: url.to_string(),
        content_type,
        etag,
        payload,
        fetched_at: now_ms(),
    })
}

fn download_nvd(
    client: &Client,
    source: SourcePolicy,
    max_records: usize,
    lookback_days: i64,
    permit: &NetworkPermit,
) -> Result<DownloadedArtifact, String> {
    permit.require_url(source.base_url)?;
    let end = Utc::now();
    let start = end - ChronoDuration::days(lookback_days);
    let response = client
        .get(source.base_url)
        .query(&[
            (
                "lastModStartDate",
                start.to_rfc3339_opts(SecondsFormat::Millis, true),
            ),
            (
                "lastModEndDate",
                end.to_rfc3339_opts(SecondsFormat::Millis, true),
            ),
            ("resultsPerPage", max_records.min(2_000).to_string()),
        ])
        .send()
        .map_err(|error| format!("NVD download failed: {error}"))?;
    let final_url = response.url().to_string();
    permit.require_url(&final_url)?;
    artifact_from_response(source, final_url, response)
}

fn download_osv(
    client: &Client,
    source: SourcePolicy,
    max_records: usize,
    permit: &NetworkPermit,
) -> Result<DownloadedArtifact, String> {
    permit.require_url(source.base_url)?;
    let mut index = client
        .get(source.base_url)
        .send()
        .map_err(|error| format!("OSV modified index download failed: {error}"))?;
    if !index.status().is_success() {
        return Err(format!(
            "OSV modified index returned HTTP {}",
            index.status()
        ));
    }
    let csv = String::from_utf8(read_bounded_response(
        &mut index,
        8 * 1024 * 1024,
        source.name,
    )?)
    .map_err(|error| format!("OSV modified index was not UTF-8: {error}"))?;
    let ids = csv
        .lines()
        .filter_map(|line| line.split_once(',').map(|(_, path)| path.trim()))
        .filter_map(|path| path.rsplit('/').next())
        .map(|id| id.trim_end_matches(".json"))
        .filter(|id| !id.is_empty())
        .take(max_records)
        .collect::<Vec<_>>();
    if ids.is_empty() {
        return Err("OSV modified index did not contain advisory IDs".to_string());
    }
    let mut values = Vec::new();
    for id in ids {
        let url = format!("https://api.osv.dev/v1/vulns/{id}");
        permit.require_url(&url)?;
        let mut response = client
            .get(&url)
            .send()
            .map_err(|error| format!("OSV advisory {id} download failed: {error}"))?;
        if !response.status().is_success() {
            continue;
        }
        let bytes = read_bounded_response(&mut response, 4 * 1024 * 1024, source.name)?;
        let value = serde_json::from_slice::<Value>(&bytes)
            .map_err(|error| format!("OSV advisory {id} JSON failed: {error}"))?;
        values.push(value);
    }
    if values.is_empty() {
        return Err("OSV returned no advisory records".to_string());
    }
    Ok(DownloadedArtifact {
        source,
        source_url: source.base_url.to_string(),
        content_type: "application/json".to_string(),
        etag: String::new(),
        payload: serde_json::to_vec(&values)
            .map_err(|error| format!("OSV archive encoding failed: {error}"))?,
        fetched_at: now_ms(),
    })
}

fn artifact_from_response(
    source: SourcePolicy,
    url: String,
    mut response: reqwest::blocking::Response,
) -> Result<DownloadedArtifact, String> {
    if !response.status().is_success() {
        return Err(format!(
            "{} returned HTTP {}",
            source.name,
            response.status()
        ));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/json")
        .to_string();
    let etag = response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let payload = read_bounded_response(&mut response, MAX_ARTIFACT_BYTES, source.name)?;
    if payload.is_empty() || payload.len() > MAX_ARTIFACT_BYTES {
        return Err(format!(
            "{} artifact size {} is outside the allowed range",
            source.name,
            payload.len()
        ));
    }
    Ok(DownloadedArtifact {
        source,
        source_url: url,
        content_type,
        etag,
        payload,
        fetched_at: now_ms(),
    })
}

fn read_bounded_response(
    response: &mut reqwest::blocking::Response,
    limit: usize,
    source_name: &str,
) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(format!(
            "{source_name} response exceeds the configured size limit"
        ));
    }
    let mut payload = Vec::new();
    response
        .take((limit + 1) as u64)
        .read_to_end(&mut payload)
        .map_err(|error| format!("{source_name} response read failed: {error}"))?;
    if payload.is_empty() || payload.len() > limit {
        return Err(format!(
            "{source_name} artifact size {} is outside the allowed range",
            payload.len()
        ));
    }
    Ok(payload)
}

fn normalize_artifact(
    artifact: &DownloadedArtifact,
    max_records: usize,
) -> Result<Vec<NormalizedRecord>, String> {
    match artifact.source.id {
        "osv" => normalize_osv(&artifact.payload, max_records),
        "nvd" => normalize_nvd(&artifact.payload, max_records),
        "cwe" => normalize_cwe(&artifact.payload, max_records.max(2_000)),
        "kev" => normalize_kev(&artifact.payload, max_records.max(2_000)),
        _ => Err(format!("no normalizer for {}", artifact.source.id)),
    }
}

fn normalize_osv(payload: &[u8], max_records: usize) -> Result<Vec<NormalizedRecord>, String> {
    let values: Vec<Value> = serde_json::from_slice(payload)
        .map_err(|error| format!("OSV archive JSON is invalid: {error}"))?;
    let mut records = Vec::new();
    for advisory in values.iter().take(max_records) {
        let external_id = string_at(advisory, "id");
        if external_id.is_empty() {
            continue;
        }
        let affected = advisory
            .get("affected")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let entries = if affected.is_empty() {
            vec![Value::Null]
        } else {
            affected
        };
        for (index, item) in entries.iter().enumerate() {
            let ecosystem = item
                .pointer("/package/ecosystem")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let package_name = item
                .pointer("/package/name")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let (license_id, attribution, commercial, redistribution) =
                osv_record_license(&external_id, ecosystem);
            let status = if license_id == "UNKNOWN" {
                "quarantined"
            } else {
                "accepted"
            };
            let normalized = json!({
                "id": external_id,
                "aliases": advisory.get("aliases").cloned().unwrap_or_else(|| json!([])),
                "affected": item,
                "withdrawn": advisory.get("withdrawn").cloned().unwrap_or(Value::Null),
            });
            records.push(finalize_record(NormalizedRecord {
                id: format!("osv-{external_id}-{index}"),
                source_id: "osv".to_string(),
                external_id: external_id.clone(),
                record_kind: "vulnerability".to_string(),
                ecosystem: ecosystem.to_string(),
                package_name: package_name.to_string(),
                affected_range: compact_json(item.get("ranges")),
                severity: "unknown".to_string(),
                cwe_ids: Vec::new(),
                title: string_at(advisory, "summary"),
                summary: string_at(advisory, "details"),
                references: string_array_objects(advisory.get("references"), "url"),
                modified_at: string_at(advisory, "modified"),
                license_id: license_id.to_string(),
                attribution: attribution.to_string(),
                commercial_allowed: commercial,
                redistribution_allowed: redistribution,
                status: status.to_string(),
                quarantine_reason: if status == "accepted" {
                    String::new()
                } else {
                    "OSV upstream license is not in the phase-one allowlist".to_string()
                },
                normalized,
                record_hash: String::new(),
            }));
        }
    }
    Ok(records)
}

fn normalize_nvd(payload: &[u8], max_records: usize) -> Result<Vec<NormalizedRecord>, String> {
    let root: Value =
        serde_json::from_slice(payload).map_err(|error| format!("NVD JSON is invalid: {error}"))?;
    let vulnerabilities = root
        .get("vulnerabilities")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut records = Vec::new();
    for item in vulnerabilities.iter().take(max_records) {
        let cve = item.get("cve").unwrap_or(item);
        let external_id = string_at(cve, "id");
        if external_id.is_empty() {
            continue;
        }
        let descriptions = localized_description(cve.get("descriptions"));
        let cwe_ids = cve
            .get("weaknesses")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .flat_map(|weakness| {
                weakness
                    .get("description")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
            })
            .filter_map(|entry| entry.get("value").and_then(Value::as_str))
            .filter(|value| value.starts_with("CWE-"))
            .map(ToString::to_string)
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let cpes = collect_nvd_cpes(cve.get("configurations"));
        let package_name = cpes
            .first()
            .and_then(|value| value.split(':').nth(4))
            .unwrap_or_default();
        let severity = nvd_severity(cve);
        let normalized = json!({
            "id": external_id,
            "cweIds": cwe_ids,
            "cpes": cpes,
            "metrics": cve.get("metrics").cloned().unwrap_or_else(|| json!({})),
            "status": cve.get("vulnStatus").cloned().unwrap_or(Value::Null),
        });
        records.push(finalize_record(NormalizedRecord {
            id: format!("nvd-{external_id}"),
            source_id: "nvd".to_string(),
            external_id: external_id.clone(),
            record_kind: "vulnerability".to_string(),
            ecosystem: "CPE".to_string(),
            package_name: package_name.to_string(),
            affected_range: cpes.join(" | "),
            severity,
            cwe_ids,
            title: external_id,
            summary: descriptions,
            references: string_array_objects(cve.get("references"), "url"),
            modified_at: string_at(cve, "lastModified"),
            license_id: "NIST-PUBLIC-DOMAIN".to_string(),
            attribution: "National Institute of Standards and Technology".to_string(),
            commercial_allowed: true,
            redistribution_allowed: true,
            status: "accepted".to_string(),
            quarantine_reason: String::new(),
            normalized,
            record_hash: String::new(),
        }));
    }
    Ok(records)
}

fn normalize_kev(payload: &[u8], max_records: usize) -> Result<Vec<NormalizedRecord>, String> {
    let root: Value = serde_json::from_slice(payload)
        .map_err(|error| format!("CISA KEV JSON is invalid: {error}"))?;
    let values = root
        .get("vulnerabilities")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut records = Vec::new();
    for item in values.iter().take(max_records) {
        let external_id = string_at(item, "cveID");
        if external_id.is_empty() {
            continue;
        }
        let normalized = json!({
            "cveId": external_id,
            "vendor": string_at(item, "vendorProject"),
            "product": string_at(item, "product"),
            "dateAdded": string_at(item, "dateAdded"),
            "dueDate": string_at(item, "dueDate"),
            "requiredAction": string_at(item, "requiredAction"),
            "knownRansomwareCampaignUse": string_at(item, "knownRansomwareCampaignUse"),
        });
        records.push(finalize_record(NormalizedRecord {
            id: format!("kev-{external_id}"),
            source_id: "kev".to_string(),
            external_id: external_id.clone(),
            record_kind: "exploitation-priority".to_string(),
            ecosystem: string_at(item, "vendorProject"),
            package_name: string_at(item, "product"),
            affected_range: String::new(),
            severity: "high-priority".to_string(),
            cwe_ids: Vec::new(),
            title: string_at(item, "vulnerabilityName"),
            summary: string_at(item, "shortDescription"),
            references: Vec::new(),
            modified_at: string_at(item, "dateAdded"),
            license_id: "CISA-USE-NOTICE".to_string(),
            attribution: "Cybersecurity and Infrastructure Security Agency".to_string(),
            commercial_allowed: true,
            redistribution_allowed: false,
            status: "accepted".to_string(),
            quarantine_reason: String::new(),
            normalized,
            record_hash: String::new(),
        }));
    }
    Ok(records)
}

fn normalize_cwe(payload: &[u8], max_records: usize) -> Result<Vec<NormalizedRecord>, String> {
    let mut archive = ZipArchive::new(Cursor::new(payload))
        .map_err(|error| format!("MITRE CWE ZIP is invalid: {error}"))?;
    let mut xml = String::new();
    let mut found = false;
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|error| format!("CWE ZIP entry failed: {error}"))?;
        if file.name().to_ascii_lowercase().ends_with(".xml") {
            file.read_to_string(&mut xml)
                .map_err(|error| format!("CWE XML read failed: {error}"))?;
            found = true;
            break;
        }
    }
    if !found {
        return Err("MITRE CWE ZIP did not contain XML".to_string());
    }
    normalize_cwe_xml(&xml, max_records)
}

fn normalize_cwe_xml(xml: &str, max_records: usize) -> Result<Vec<NormalizedRecord>, String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut records = Vec::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) | Ok(Event::Empty(event))
                if event.local_name().as_ref() == b"Weakness" =>
            {
                let mut id = String::new();
                let mut name = String::new();
                let mut abstraction = String::new();
                for attribute in event.attributes().flatten() {
                    let key = attribute.key.local_name();
                    let value = attribute
                        .decode_and_unescape_value(reader.decoder())
                        .map(|value| value.into_owned())
                        .unwrap_or_default();
                    match key.as_ref() {
                        b"ID" => id = value,
                        b"Name" => name = value,
                        b"Abstraction" => abstraction = value,
                        _ => {}
                    }
                }
                if !id.is_empty() {
                    let external_id = format!("CWE-{id}");
                    let normalized =
                        json!({ "id": external_id, "name": name, "abstraction": abstraction });
                    records.push(finalize_record(NormalizedRecord {
                        id: format!("cwe-{id}"),
                        source_id: "cwe".to_string(),
                        external_id: external_id.clone(),
                        record_kind: "weakness".to_string(),
                        ecosystem: "language-independent".to_string(),
                        package_name: String::new(),
                        affected_range: String::new(),
                        severity: "taxonomy".to_string(),
                        cwe_ids: vec![external_id.clone()],
                        title: name,
                        summary: format!("MITRE weakness taxonomy entry; abstraction={abstraction}"),
                        references: vec![format!("https://cwe.mitre.org/data/definitions/{id}.html")],
                        modified_at: String::new(),
                        license_id: "MITRE-CWE-TERMS".to_string(),
                        attribution: "Copyright The MITRE Corporation. CWE is a trademark of The MITRE Corporation.".to_string(),
                        commercial_allowed: true,
                        redistribution_allowed: true,
                        status: "accepted".to_string(),
                        quarantine_reason: String::new(),
                        normalized,
                        record_hash: String::new(),
                    }));
                    if records.len() >= max_records {
                        break;
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(error) => return Err(format!("MITRE CWE XML parse failed: {error}")),
            _ => {}
        }
    }
    Ok(records)
}

fn finalize_record(mut record: NormalizedRecord) -> NormalizedRecord {
    let hash_input = canonical_json(&json!({
        "source": record.source_id,
        "externalId": record.external_id,
        "kind": record.record_kind,
        "ecosystem": record.ecosystem,
        "package": record.package_name,
        "range": record.affected_range,
        "license": record.license_id,
        "normalized": record.normalized,
    }));
    record.record_hash = sha256_hex(hash_input.as_bytes());
    record
}

struct ReplayValidation {
    passed: bool,
    invalid_count: usize,
    evidence: Vec<String>,
}

fn validate_normalized_records(records: &[NormalizedRecord]) -> ReplayValidation {
    let mut invalid = Vec::new();
    let mut source_counts = BTreeMap::<&str, usize>::new();
    let mut unique = BTreeSet::new();
    for record in records {
        *source_counts.entry(&record.source_id).or_default() += 1;
        let id_valid = match record.source_id.as_str() {
            "cwe" => {
                record.external_id.starts_with("CWE-")
                    && record.external_id[4..]
                        .chars()
                        .all(|value| value.is_ascii_digit())
            }
            "nvd" | "kev" => valid_cve_id(&record.external_id),
            "osv" => !record.external_id.trim().is_empty(),
            _ => false,
        };
        let unique_key = record.id.clone();
        if !id_valid
            || record.title.trim().is_empty()
            || record.record_hash.len() != 64
            || !unique.insert(unique_key)
        {
            invalid.push(record.id.clone());
        }
    }
    let all_sources = SOURCES
        .iter()
        .all(|source| source_counts.get(source.id).copied().unwrap_or(0) > 0);
    ReplayValidation {
        passed: invalid.is_empty() && all_sources,
        invalid_count: invalid.len(),
        evidence: vec![
            format!("normalized replay checked {} records", records.len()),
            format!("all four source families present={all_sources}"),
            format!("invalid or duplicate records={}", invalid.len()),
        ],
    }
}

fn activate_pack(
    conn: &mut Connection,
    app: &AppHandle,
    pack_id: &str,
    actor: &str,
) -> Result<(), String> {
    verify_pack_integrity(conn, app, pack_id)?;
    let candidate = conn
        .query_row(
            "SELECT status, validation_score FROM knowledge_pack_versions WHERE id = ?1",
            params![pack_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?)),
        )
        .optional()
        .map_err(|error| format!("failed to read knowledge pack candidate: {error}"))?
        .ok_or_else(|| format!("knowledge pack {pack_id} does not exist"))?;
    if !["signed", "superseded", "rolled_back"].contains(&candidate.0.as_str())
        || candidate.1 < 90.0
    {
        return Err(format!(
            "knowledge pack {pack_id} has not passed the activation gate"
        ));
    }
    let current = active_state(conn)?.0;
    if current.as_deref() == Some(pack_id) {
        return Ok(());
    }
    let now = now_ms();
    let tx = conn
        .transaction()
        .map_err(|error| format!("failed to begin knowledge activation: {error}"))?;
    if let Some(active_id) = current.as_ref() {
        tx.execute(
            "UPDATE knowledge_pack_versions SET status = 'superseded' WHERE id = ?1",
            params![active_id],
        )
        .map_err(|error| format!("failed to supersede active knowledge pack: {error}"))?;
    }
    tx.execute(
        "UPDATE knowledge_pack_versions SET status = 'active', activated_at = ?2 WHERE id = ?1",
        params![pack_id, now as i64],
    )
    .map_err(|error| format!("failed to activate knowledge pack: {error}"))?;
    tx.execute(
        "INSERT OR REPLACE INTO knowledge_pack_state
         (id, active_pack_id, previous_pack_id, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![ACTIVE_STATE_ID, pack_id, current, now as i64],
    )
    .map_err(|error| format!("failed to store active knowledge pack pointer: {error}"))?;
    insert_event(
        &tx,
        pack_id,
        "activate",
        "signed",
        "active",
        actor,
        "signature and validation gate passed",
        now,
    )?;
    tx.commit()
        .map_err(|error| format!("failed to commit knowledge activation: {error}"))?;
    Ok(())
}

fn verify_pack_integrity(conn: &Connection, app: &AppHandle, pack_id: &str) -> Result<(), String> {
    let (manifest, expected_hash, signature) = conn
        .query_row(
            "SELECT manifest_json, content_hash, signature FROM knowledge_pack_versions WHERE id = ?1",
            params![pack_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)),
        )
        .optional()
        .map_err(|error| format!("failed to load knowledge pack integrity fields: {error}"))?
        .ok_or_else(|| format!("knowledge pack {pack_id} does not exist"))?;
    let actual_hash = compute_pack_hash(conn, pack_id, &manifest)?;
    if actual_hash != expected_hash {
        return Err(format!("knowledge pack {pack_id} content hash mismatch"));
    }
    if sign_hash(app, &actual_hash)? != signature {
        return Err(format!("knowledge pack {pack_id} signature mismatch"));
    }
    Ok(())
}

fn build_status(
    conn: &Connection,
    app: &AppHandle,
    path: &Path,
) -> Result<KnowledgePackStatusReport, String> {
    let (active_pack_id, previous_pack_id) = active_state(conn)?;
    let sources = load_source_statuses(conn)?;
    let packs = load_pack_summaries(conn, app)?;
    let active_record_count = active_pack_id
        .as_ref()
        .map(|pack_id| count_records(conn, pack_id, "accepted"))
        .transpose()?
        .unwrap_or(0);
    let quarantined_record_count = active_pack_id
        .as_ref()
        .map(|pack_id| count_records(conn, pack_id, "quarantined"))
        .transpose()?
        .unwrap_or_else(|| {
            packs
                .first()
                .map(|pack| pack.quarantined_count)
                .unwrap_or(0)
        });
    let event_count = count_table(conn, "knowledge_pack_events")?;
    let knowledge_maturity = if let Some(active) = packs
        .iter()
        .find(|pack| Some(&pack.id) == active_pack_id.as_ref())
    {
        if active.signature_valid && active.source_count == 4 && active.validation_score >= 90.0 {
            60
        } else {
            46
        }
    } else {
        38
    };
    Ok(KnowledgePackStatusReport {
        status: if active_pack_id.is_some() {
            "active".to_string()
        } else if packs.is_empty() {
            "empty".to_string()
        } else {
            "staged".to_string()
        },
        database_path: path.to_string_lossy().to_string(),
        active_pack_id,
        previous_pack_id,
        source_count: sources.len(),
        pack_count: packs.len(),
        active_record_count,
        quarantined_record_count,
        event_count,
        knowledge_maturity,
        sources,
        packs,
        legal_notices: SOURCES
            .iter()
            .map(|source| source.notice.to_string())
            .collect(),
        evidence: vec![
            "raw official artifacts are immutable and retained with SHA-256".to_string(),
            "only signed packs scoring at least 90 can become active".to_string(),
            "unknown OSV record licenses remain quarantined".to_string(),
            "activation and rollback use SQLite transactions and append-only events".to_string(),
        ],
    })
}

fn load_source_statuses(conn: &Connection) -> Result<Vec<KnowledgeSourceStatus>, String> {
    let mut statement = conn
        .prepare(
            "SELECT id, name, license_id, commercial_allowed, redistribution_allowed,
                    last_checked_at, last_status, record_count, evidence
             FROM knowledge_sources ORDER BY id",
        )
        .map_err(|error| format!("failed to prepare knowledge source status: {error}"))?;
    let statuses = statement
        .query_map([], |row| {
            Ok(KnowledgeSourceStatus {
                id: row.get(0)?,
                name: row.get(1)?,
                license_id: row.get(2)?,
                commercial_allowed: row.get::<_, i64>(3)? != 0,
                redistribution_allowed: row.get::<_, i64>(4)? != 0,
                last_checked_at: row.get::<_, i64>(5)?.max(0) as u128,
                last_status: row.get(6)?,
                record_count: row.get::<_, i64>(7)?.max(0) as usize,
                evidence: row.get(8)?,
            })
        })
        .map_err(|error| format!("failed to read knowledge source status: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to collect knowledge source status: {error}"))?;
    Ok(statuses)
}

fn load_pack_summaries(
    conn: &Connection,
    app: &AppHandle,
) -> Result<Vec<KnowledgePackSummary>, String> {
    let mut statement = conn
        .prepare(
            "SELECT id, version, status, source_count, record_count, quarantined_count,
                    validation_score, content_hash, signature, created_at, activated_at, evidence
             FROM knowledge_pack_versions ORDER BY created_at DESC LIMIT 20",
        )
        .map_err(|error| format!("failed to prepare knowledge pack summaries: {error}"))?;
    let mut packs = statement
        .query_map([], |row| {
            let content_hash: String = row.get(7)?;
            let signature: String = row.get(8)?;
            Ok(KnowledgePackSummary {
                id: row.get(0)?,
                version: row.get(1)?,
                status: row.get(2)?,
                source_count: row.get::<_, i64>(3)?.max(0) as usize,
                record_count: row.get::<_, i64>(4)?.max(0) as usize,
                quarantined_count: row.get::<_, i64>(5)?.max(0) as usize,
                validation_score: row.get(6)?,
                signature_valid: false,
                content_hash,
                signature,
                created_at: row.get::<_, i64>(9)?.max(0) as u128,
                activated_at: row
                    .get::<_, Option<i64>>(10)?
                    .map(|value| value.max(0) as u128),
                evidence: row.get(11)?,
            })
        })
        .map_err(|error| format!("failed to read knowledge pack summaries: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to collect knowledge pack summaries: {error}"))?;
    for pack in &mut packs {
        pack.signature_valid = verify_pack_integrity(conn, app, &pack.id).is_ok();
    }
    Ok(packs)
}

fn insert_artifact(
    tx: &rusqlite::Transaction<'_>,
    pack_id: &str,
    artifact: &DownloadedArtifact,
) -> Result<(), String> {
    let artifact_id = format!("artifact-{pack_id}-{}", artifact.source.id);
    tx.execute(
        "INSERT INTO knowledge_raw_artifacts
         (id, pack_id, source_id, source_url, fetched_at, content_type, etag, sha256,
          byte_count, payload, license_id, validation_status, error)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'archived', '')",
        params![
            artifact_id,
            pack_id,
            artifact.source.id,
            artifact.source_url,
            artifact.fetched_at as i64,
            artifact.content_type,
            artifact.etag,
            sha256_hex(&artifact.payload),
            artifact.payload.len() as i64,
            artifact.payload,
            artifact.source.license_id,
        ],
    )
    .map_err(|error| {
        format!(
            "failed to archive {} artifact: {error}",
            artifact.source.name
        )
    })?;
    Ok(())
}

fn insert_record(
    tx: &rusqlite::Transaction<'_>,
    pack_id: &str,
    record: &NormalizedRecord,
    created_at: u128,
) -> Result<(), String> {
    tx.execute(
        "INSERT INTO knowledge_records
         (id, pack_id, source_id, external_id, record_kind, ecosystem, package_name,
          affected_range, severity, cwe_ids, title, summary, references_json, modified_at,
          normalized_json, license_id, attribution, commercial_allowed, redistribution_allowed,
          record_hash, status, quarantine_reason, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                 ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)",
        params![
            format!("{pack_id}:{}", record.id),
            pack_id,
            record.source_id,
            record.external_id,
            record.record_kind,
            record.ecosystem,
            record.package_name,
            record.affected_range,
            record.severity,
            canonical_json(&json!(record.cwe_ids)),
            record.title,
            record.summary,
            canonical_json(&json!(record.references)),
            record.modified_at,
            canonical_json(&record.normalized),
            record.license_id,
            record.attribution,
            i64::from(record.commercial_allowed),
            i64::from(record.redistribution_allowed),
            record.record_hash,
            record.status,
            record.quarantine_reason,
            created_at as i64,
        ],
    )
    .map_err(|error| {
        format!(
            "failed to stage knowledge record {}: {error}",
            record.external_id
        )
    })?;
    Ok(())
}

fn update_source_status(
    tx: &rusqlite::Transaction<'_>,
    artifact: &DownloadedArtifact,
    record_count: usize,
    status: &str,
) -> Result<(), String> {
    tx.execute(
        "UPDATE knowledge_sources
         SET last_checked_at = ?2, last_status = ?3, record_count = ?4,
             etag = ?5, evidence = ?6 WHERE id = ?1",
        params![
            artifact.source.id,
            artifact.fetched_at as i64,
            status,
            record_count as i64,
            artifact.etag,
            format!(
                "{} bytes archived; sha256={}",
                artifact.payload.len(),
                sha256_hex(&artifact.payload)
            ),
        ],
    )
    .map_err(|error| {
        format!(
            "failed to update knowledge source {}: {error}",
            artifact.source.id
        )
    })?;
    Ok(())
}

fn compute_pack_hash(
    conn: &Connection,
    pack_id: &str,
    manifest_json: &str,
) -> Result<String, String> {
    let mut hashes = Vec::new();
    for (table, column) in [
        ("knowledge_raw_artifacts", "sha256"),
        ("knowledge_records", "record_hash"),
    ] {
        let sql = format!("SELECT {column} FROM {table} WHERE pack_id = ?1 ORDER BY {column}");
        let mut statement = conn
            .prepare(&sql)
            .map_err(|error| format!("failed to prepare pack hash query: {error}"))?;
        let values = statement
            .query_map(params![pack_id], |row| row.get::<_, String>(0))
            .map_err(|error| format!("failed to read pack hashes: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("failed to collect pack hashes: {error}"))?;
        hashes.extend(values);
    }
    hashes.sort();
    Ok(sha256_hex(
        format!("{manifest_json}\n{}", hashes.join("\n")).as_bytes(),
    ))
}

fn sign_hash(app: &AppHandle, hash: &str) -> Result<String, String> {
    let key = load_or_create_signing_key(app)?;
    Ok(hmac_sha256_hex(&key, hash.as_bytes()))
}

fn load_or_create_signing_key(app: &AppHandle) -> Result<Vec<u8>, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve knowledge signing directory: {error}"))?
        .join("knowledge-packs");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("failed to create knowledge signing directory: {error}"))?;
    let path = directory.join("local-integrity.key");
    if path.exists() {
        let key = fs::read(&path)
            .map_err(|error| format!("failed to read knowledge signing key: {error}"))?;
        if key.len() == 32 {
            return Ok(key);
        }
        return Err("knowledge signing key has an invalid length".to_string());
    }
    let mut key = vec![0_u8; 32];
    getrandom::fill(&mut key)
        .map_err(|error| format!("failed to generate knowledge signing key: {error}"))?;
    fs::write(&path, &key)
        .map_err(|error| format!("failed to store knowledge signing key: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("failed to protect knowledge signing key: {error}"))?;
    }
    Ok(key)
}

fn hmac_sha256_hex(key: &[u8], message: &[u8]) -> String {
    let mut block = [0_u8; 64];
    if key.len() > block.len() {
        let digest = Sha256::digest(key);
        block[..digest.len()].copy_from_slice(&digest);
    } else {
        block[..key.len()].copy_from_slice(key);
    }
    let mut inner_pad = [0x36_u8; 64];
    let mut outer_pad = [0x5c_u8; 64];
    for index in 0..64 {
        inner_pad[index] ^= block[index];
        outer_pad[index] ^= block[index];
    }
    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(message);
    let inner_digest = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner_digest);
    hex(&outer.finalize())
}

fn with_database<T>(
    app: &AppHandle,
    action: impl FnOnce(&mut Connection, PathBuf) -> Result<T, String>,
) -> Result<T, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve knowledge database directory: {error}"))?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("failed to create knowledge database directory: {error}"))?;
    let path = directory.join(DATABASE_FILE);
    let mut conn = Connection::open(&path)
        .map_err(|error| format!("failed to open knowledge database: {error}"))?;
    ensure_schema(&conn)?;
    seed_sources(&conn)?;
    action(&mut conn, path)
}

pub(crate) fn ensure_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(KNOWLEDGE_PACK_SCHEMA)
        .map_err(|error| format!("failed to initialize knowledge pack schema: {error}"))
}

fn seed_sources(conn: &Connection) -> Result<(), String> {
    for source in SOURCES {
        conn.execute(
            "INSERT OR IGNORE INTO knowledge_sources
             (id, name, source_kind, base_url, license_id, attribution,
              commercial_allowed, redistribution_allowed, notice_text,
              status, last_checked_at, last_status, record_count, etag, evidence)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'enabled', 0, 'never', 0, '', 'official source registered')",
            params![
                source.id,
                source.name,
                source.source_kind,
                source.base_url,
                source.license_id,
                source.attribution,
                i64::from(source.commercial_allowed),
                i64::from(source.redistribution_allowed),
                source.notice,
            ],
        )
        .map_err(|error| format!("failed to register knowledge source {}: {error}", source.id))?;
    }
    Ok(())
}

fn active_state(conn: &Connection) -> Result<(Option<String>, Option<String>), String> {
    conn.query_row(
        "SELECT active_pack_id, previous_pack_id FROM knowledge_pack_state WHERE id = ?1",
        params![ACTIVE_STATE_ID],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .map(|value| value.unwrap_or((None, None)))
    .map_err(|error| format!("failed to load active knowledge state: {error}"))
}

fn count_records(conn: &Connection, pack_id: &str, status: &str) -> Result<usize, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM knowledge_records WHERE pack_id = ?1 AND status = ?2",
        params![pack_id, status],
        |row| row.get::<_, i64>(0),
    )
    .map(|value| value.max(0) as usize)
    .map_err(|error| format!("failed to count knowledge records: {error}"))
}

fn count_table(conn: &Connection, table: &str) -> Result<usize, String> {
    let allowed = ["knowledge_pack_events"];
    if !allowed.contains(&table) {
        return Err("unsupported knowledge count table".to_string());
    }
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
        row.get::<_, i64>(0)
    })
    .map(|value| value.max(0) as usize)
    .map_err(|error| format!("failed to count {table}: {error}"))
}

fn append_event(
    conn: &Connection,
    pack_id: &str,
    kind: &str,
    from_status: &str,
    to_status: &str,
    actor: &str,
    evidence: &str,
    created_at: u128,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO knowledge_pack_events
         (id, pack_id, event_kind, from_status, to_status, actor, evidence, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            format!("event-{pack_id}-{created_at}-{kind}"),
            pack_id,
            kind,
            from_status,
            to_status,
            actor,
            evidence,
            created_at as i64
        ],
    )
    .map_err(|error| format!("failed to append knowledge event: {error}"))?;
    Ok(())
}

fn insert_event(
    tx: &rusqlite::Transaction<'_>,
    pack_id: &str,
    kind: &str,
    from_status: &str,
    to_status: &str,
    actor: &str,
    evidence: &str,
    created_at: u128,
) -> Result<(), String> {
    tx.execute(
        "INSERT INTO knowledge_pack_events
         (id, pack_id, event_kind, from_status, to_status, actor, evidence, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            format!("event-{pack_id}-{created_at}-{kind}"),
            pack_id,
            kind,
            from_status,
            to_status,
            actor,
            evidence,
            created_at as i64
        ],
    )
    .map_err(|error| format!("failed to append knowledge event: {error}"))?;
    Ok(())
}

fn string_at(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn localized_description(value: Option<&Value>) -> String {
    let entries = value.and_then(Value::as_array).cloned().unwrap_or_default();
    entries
        .iter()
        .find(|entry| entry.get("lang").and_then(Value::as_str) == Some("en"))
        .or_else(|| entries.first())
        .and_then(|entry| entry.get("value"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn string_array_objects(value: Option<&Value>, key: &str) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get(key).and_then(Value::as_str))
        .map(ToString::to_string)
        .take(20)
        .collect()
}

fn collect_nvd_cpes(configurations: Option<&Value>) -> Vec<String> {
    let mut output = BTreeSet::new();
    if let Some(configurations) = configurations.and_then(Value::as_array) {
        for configuration in configurations {
            collect_cpes_recursive(configuration, &mut output);
        }
    }
    output.into_iter().take(30).collect()
}

fn collect_cpes_recursive(value: &Value, output: &mut BTreeSet<String>) {
    if let Some(matches) = value.get("cpeMatch").and_then(Value::as_array) {
        for item in matches {
            if item
                .get("vulnerable")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                if let Some(criteria) = item.get("criteria").and_then(Value::as_str) {
                    output.insert(criteria.to_string());
                }
            }
        }
    }
    if let Some(nodes) = value.get("nodes").and_then(Value::as_array) {
        for node in nodes {
            collect_cpes_recursive(node, output);
        }
    }
}

fn nvd_severity(cve: &Value) -> String {
    for key in [
        "cvssMetricV40",
        "cvssMetricV31",
        "cvssMetricV30",
        "cvssMetricV2",
    ] {
        if let Some(value) = cve
            .pointer(&format!("/metrics/{key}/0/cvssData/baseSeverity"))
            .and_then(Value::as_str)
        {
            return value.to_ascii_lowercase();
        }
        if let Some(value) = cve
            .pointer(&format!("/metrics/{key}/0/baseSeverity"))
            .and_then(Value::as_str)
        {
            return value.to_ascii_lowercase();
        }
    }
    "unknown".to_string()
}

fn osv_record_license(id: &str, ecosystem: &str) -> (&'static str, &'static str, bool, bool) {
    if id.starts_with("GHSA-")
        || id.starts_with("PYSEC-")
        || id.starts_with("GO-")
        || id.starts_with("PSF-")
    {
        return (
            "CC-BY-4.0",
            "Authoritative advisory source via OSV.dev",
            true,
            true,
        );
    }
    if id.starts_with("RUSTSEC-") || id.starts_with("GSD-") {
        return (
            "CC0-1.0",
            "Authoritative advisory source via OSV.dev",
            true,
            true,
        );
    }
    if ecosystem.starts_with("Ubuntu") {
        return (
            "CC-BY-SA-4.0",
            "Ubuntu security advisories via OSV.dev",
            true,
            true,
        );
    }
    (
        "UNKNOWN",
        "OSV upstream source requires license review",
        false,
        false,
    )
}

fn valid_cve_id(value: &str) -> bool {
    let parts = value.split('-').collect::<Vec<_>>();
    parts.len() == 3
        && parts[0] == "CVE"
        && parts[1].len() == 4
        && parts[1].chars().all(|item| item.is_ascii_digit())
        && parts[2].len() >= 4
        && parts[2].chars().all(|item| item.is_ascii_digit())
}

fn compact_json(value: Option<&Value>) -> String {
    value.map(canonical_json).unwrap_or_default()
}

fn canonical_json(value: &Value) -> String {
    match value {
        Value::Object(map) => {
            let mut entries = map.iter().collect::<Vec<_>>();
            entries.sort_by(|a, b| a.0.cmp(b.0));
            format!(
                "{{{}}}",
                entries
                    .into_iter()
                    .map(|(key, value)| format!(
                        "{}:{}",
                        serde_json::to_string(key).unwrap_or_default(),
                        canonical_json(value)
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
        Value::Array(values) => format!(
            "[{}]",
            values
                .iter()
                .map(canonical_json)
                .collect::<Vec<_>>()
                .join(",")
        ),
        _ => serde_json::to_string(value).unwrap_or_else(|_| "null".to_string()),
    }
}

fn sha256_hex(value: &[u8]) -> String {
    hex(&Sha256::digest(value))
}

fn hex(value: &[u8]) -> String {
    value.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

const KNOWLEDGE_PACK_SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS knowledge_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  base_url TEXT NOT NULL,
  license_id TEXT NOT NULL,
  attribution TEXT NOT NULL,
  commercial_allowed INTEGER NOT NULL,
  redistribution_allowed INTEGER NOT NULL,
  notice_text TEXT NOT NULL,
  status TEXT NOT NULL,
  last_checked_at INTEGER NOT NULL,
  last_status TEXT NOT NULL,
  record_count INTEGER NOT NULL,
  etag TEXT NOT NULL,
  evidence TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS knowledge_pack_versions (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  parent_pack_id TEXT,
  status TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  signature TEXT NOT NULL,
  signature_algorithm TEXT NOT NULL,
  key_id TEXT NOT NULL,
  source_count INTEGER NOT NULL,
  record_count INTEGER NOT NULL,
  quarantined_count INTEGER NOT NULL,
  validation_score REAL NOT NULL,
  created_at INTEGER NOT NULL,
  activated_at INTEGER,
  evidence TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS knowledge_raw_artifacts (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  etag TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_count INTEGER NOT NULL,
  payload BLOB NOT NULL,
  license_id TEXT NOT NULL,
  validation_status TEXT NOT NULL,
  error TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS knowledge_records (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  record_kind TEXT NOT NULL,
  ecosystem TEXT NOT NULL,
  package_name TEXT NOT NULL,
  affected_range TEXT NOT NULL,
  severity TEXT NOT NULL,
  cwe_ids TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  references_json TEXT NOT NULL,
  modified_at TEXT NOT NULL,
  normalized_json TEXT NOT NULL,
  license_id TEXT NOT NULL,
  attribution TEXT NOT NULL,
  commercial_allowed INTEGER NOT NULL,
  redistribution_allowed INTEGER NOT NULL,
  record_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  quarantine_reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS knowledge_validation_runs (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL,
  schema_pass INTEGER NOT NULL,
  license_pass INTEGER NOT NULL,
  replay_pass INTEGER NOT NULL,
  signature_pass INTEGER NOT NULL,
  source_count INTEGER NOT NULL,
  record_count INTEGER NOT NULL,
  rejected_count INTEGER NOT NULL,
  score REAL NOT NULL,
  evidence TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS knowledge_pack_state (
  id TEXT PRIMARY KEY,
  active_pack_id TEXT,
  previous_pack_id TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS knowledge_pack_events (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  actor TEXT NOT NULL,
  evidence TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS knowledge_pack_versions_status_idx ON knowledge_pack_versions(status, created_at);
CREATE TABLE IF NOT EXISTS supplemental_knowledge_bundles (
  id TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  license_id TEXT NOT NULL,
  version TEXT NOT NULL,
  published_at TEXT NOT NULL,
  artifact_hash TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  signature TEXT NOT NULL,
  status TEXT NOT NULL,
  record_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  activated_at INTEGER
);
CREATE TABLE IF NOT EXISTS supplemental_knowledge_records (
  id TEXT PRIMARY KEY,
  bundle_id TEXT NOT NULL,
  record_kind TEXT NOT NULL,
  title TEXT NOT NULL,
  evidence TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  record_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  FOREIGN KEY(bundle_id) REFERENCES supplemental_knowledge_bundles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS supplemental_knowledge_records_bundle_idx ON supplemental_knowledge_records(bundle_id, status);
CREATE INDEX IF NOT EXISTS supplemental_knowledge_records_kind_idx ON supplemental_knowledge_records(record_kind, status);
CREATE INDEX IF NOT EXISTS knowledge_raw_artifacts_pack_idx ON knowledge_raw_artifacts(pack_id, source_id);
CREATE INDEX IF NOT EXISTS knowledge_records_pack_idx ON knowledge_records(pack_id, status, source_id);
CREATE INDEX IF NOT EXISTS knowledge_records_external_idx ON knowledge_records(external_id, ecosystem, package_name);
CREATE INDEX IF NOT EXISTS knowledge_validation_runs_pack_idx ON knowledge_validation_runs(pack_id, created_at);
CREATE INDEX IF NOT EXISTS knowledge_pack_events_pack_idx ON knowledge_pack_events(pack_id, created_at);
CREATE TRIGGER IF NOT EXISTS knowledge_pack_events_no_update
BEFORE UPDATE ON knowledge_pack_events BEGIN SELECT RAISE(ABORT, 'knowledge pack events are immutable'); END;
CREATE TRIGGER IF NOT EXISTS knowledge_pack_events_no_delete
BEFORE DELETE ON knowledge_pack_events BEGIN SELECT RAISE(ABORT, 'knowledge pack events are immutable'); END;
CREATE TRIGGER IF NOT EXISTS knowledge_raw_artifacts_no_update
BEFORE UPDATE ON knowledge_raw_artifacts BEGIN SELECT RAISE(ABORT, 'knowledge raw artifacts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS knowledge_raw_artifacts_no_delete
BEFORE DELETE ON knowledge_raw_artifacts BEGIN SELECT RAISE(ABORT, 'knowledge raw artifacts are immutable'); END;
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supplemental_knowledge_requires_provenance_and_kind_specific_evidence() {
        let valid = SupplementalKnowledgeBundle {
            source_name: "Verified benchmark lab".to_string(),
            source_url: "https://example.org/evidence/2026-08".to_string(),
            license_id: "CC-BY-4.0".to_string(),
            version: "2026.08".to_string(),
            published_at: "2026-08-09T12:00:00Z".to_string(),
            records: vec![SupplementalKnowledgeRecord {
                id: "bench-1".to_string(),
                kind: "benchmark".to_string(),
                title: "stable sort".to_string(),
                evidence: "30 isolated repetitions".to_string(),
                observed_at: "2026-08-09T11:00:00Z".to_string(),
                payload: json!({"algorithm":"stable-sort","inputScale":100000,"metrics":{"p95Ms":20.4}}),
            }],
        };
        assert!(validate_supplemental_bundle(&valid).is_ok());
        let mut invalid = valid.clone();
        invalid.records[0].payload = json!({"algorithm":"stable-sort"});
        assert!(validate_supplemental_bundle(&invalid).is_err());
        invalid = valid;
        invalid.license_id.clear();
        assert!(validate_supplemental_bundle(&invalid).is_err());
    }

    #[test]
    fn normalizers_and_license_gate_keep_unknown_osv_sources_quarantined() {
        let payload = serde_json::to_vec(&vec![json!({
            "id": "UNKNOWN-2026-1",
            "summary": "fixture",
            "details": "fixture details",
            "modified": "2026-01-01T00:00:00Z",
            "affected": [{"package": {"ecosystem": "Custom", "name": "demo"}, "ranges": []}]
        })])
        .expect("encode OSV fixture");
        let records = normalize_osv(&payload, 10).expect("normalize OSV fixture");
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].status, "quarantined");
        assert_eq!(records[0].license_id, "UNKNOWN");
    }

    #[test]
    fn normalized_replay_requires_all_four_source_families() {
        let mut records = vec![fixture_record(
            "osv",
            "GHSA-aaaa-bbbb-cccc",
            "vulnerability",
        )];
        assert!(!validate_normalized_records(&records).passed);
        records.push(fixture_record("nvd", "CVE-2026-1234", "vulnerability"));
        records.push(fixture_record(
            "kev",
            "CVE-2026-5678",
            "exploitation-priority",
        ));
        records.push(fixture_record("cwe", "CWE-79", "weakness"));
        assert!(validate_normalized_records(&records).passed);
    }

    #[test]
    fn hmac_signature_changes_when_pack_hash_changes() {
        let key = [7_u8; 32];
        let first = hmac_sha256_hex(&key, b"pack-a");
        let second = hmac_sha256_hex(&key, b"pack-b");
        assert_eq!(first.len(), 64);
        assert_ne!(first, second);
    }

    #[test]
    fn immutable_archive_and_event_triggers_reject_mutation() {
        let conn = Connection::open_in_memory().expect("open sqlite");
        ensure_schema(&conn).expect("create knowledge schema");
        conn.execute(
            "INSERT INTO knowledge_pack_events
             (id, pack_id, event_kind, from_status, to_status, actor, evidence, created_at)
             VALUES ('event-1', 'pack-1', 'stage', 'none', 'staging', 'test', 'fixture', 1)",
            [],
        )
        .expect("insert event");
        assert!(conn
            .execute(
                "UPDATE knowledge_pack_events SET evidence = 'changed' WHERE id = 'event-1'",
                []
            )
            .is_err());
        assert!(conn
            .execute("DELETE FROM knowledge_pack_events WHERE id = 'event-1'", [])
            .is_err());
    }

    #[test]
    fn nvd_kev_and_cwe_adapters_extract_stable_ids() {
        let nvd = serde_json::to_vec(&json!({"vulnerabilities": [{"cve": {
            "id": "CVE-2026-1234", "published": "2026-01-01", "lastModified": "2026-01-02",
            "descriptions": [{"lang": "en", "value": "fixture vulnerability"}],
            "weaknesses": [{"description": [{"lang": "en", "value": "CWE-79"}]}],
            "references": [{"url": "https://example.invalid/CVE-2026-1234"}]
        }}]}))
        .expect("encode NVD fixture");
        assert_eq!(
            normalize_nvd(&nvd, 10).expect("normalize NVD")[0].external_id,
            "CVE-2026-1234"
        );

        let kev = serde_json::to_vec(&json!({"vulnerabilities": [{
            "cveID": "CVE-2026-5678", "vendorProject": "Fixture", "product": "Demo",
            "vulnerabilityName": "fixture exploited issue", "shortDescription": "fixture",
            "dateAdded": "2026-01-03", "dueDate": "2026-01-24", "requiredAction": "Update"
        }]}))
        .expect("encode KEV fixture");
        assert_eq!(
            normalize_kev(&kev, 10).expect("normalize KEV")[0].external_id,
            "CVE-2026-5678"
        );

        let cwe = r#"<Weakness_Catalog><Weaknesses><Weakness ID="79" Name="Cross-site Scripting" Abstraction="Base"><Description>Improper neutralization.</Description></Weakness></Weaknesses></Weakness_Catalog>"#;
        assert_eq!(
            normalize_cwe_xml(cwe, 10).expect("normalize CWE")[0].external_id,
            "CWE-79"
        );
    }

    #[test]
    fn dependency_version_matching_distinguishes_confirmed_clear_and_unknown() {
        let osv = json!({"affected": {"ranges": [{"type": "SEMVER", "events": [
            {"introduced": "1.0.0"}, {"fixed": "2.0.0"}
        ]}]}});
        assert_eq!(
            dependency_version_match("osv", "1.5.0", &osv),
            VersionMatch::Affected
        );
        assert_eq!(
            dependency_version_match("osv", "2.0.0", &osv),
            VersionMatch::NotAffected
        );
        assert_eq!(
            dependency_version_match("osv", "workspace:*", &osv),
            VersionMatch::Unknown
        );

        let nvd = json!({"cpes": ["cpe:2.3:a:vendor:demo:3.2.1:*:*:*:*:*:*:*"]});
        assert_eq!(
            dependency_version_match("nvd", "3.2.1", &nvd),
            VersionMatch::Affected
        );
        assert_eq!(
            dependency_version_match("nvd", "3.2.2", &nvd),
            VersionMatch::NotAffected
        );
    }

    #[test]
    #[ignore = "downloads the four official phase-one sources"]
    fn official_source_adapters_live_smoke() {
        let policy = crate::network_policy::NetworkPolicyState::default();
        policy.set_enabled(true);
        let permit = policy.permit().expect("create network permit");
        let client = Client::builder()
            .timeout(Duration::from_secs(180))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("CodeFlow-Inspector/0.1 knowledge-pack-smoke-test")
            .build()
            .expect("build HTTP client");
        for source in SOURCES {
            let artifact = download_source(&client, source, 10, 30, &permit)
                .unwrap_or_else(|error| panic!("{} download failed: {error}", source.id));
            let records = normalize_artifact(&artifact, 10)
                .unwrap_or_else(|error| panic!("{} normalization failed: {error}", source.id));
            assert!(!records.is_empty(), "{} returned no records", source.id);
        }
    }

    fn fixture_record(source: &str, external_id: &str, kind: &str) -> NormalizedRecord {
        finalize_record(NormalizedRecord {
            id: format!("{source}-{external_id}"),
            source_id: source.to_string(),
            external_id: external_id.to_string(),
            record_kind: kind.to_string(),
            ecosystem: "fixture".to_string(),
            package_name: "fixture".to_string(),
            affected_range: "fixture".to_string(),
            severity: "medium".to_string(),
            cwe_ids: Vec::new(),
            title: "fixture".to_string(),
            summary: "fixture".to_string(),
            references: Vec::new(),
            modified_at: "2026-01-01".to_string(),
            license_id: "CC0-1.0".to_string(),
            attribution: "fixture".to_string(),
            commercial_allowed: true,
            redistribution_allowed: true,
            status: "accepted".to_string(),
            quarantine_reason: String::new(),
            normalized: json!({"fixture": true}),
            record_hash: String::new(),
        })
    }
}

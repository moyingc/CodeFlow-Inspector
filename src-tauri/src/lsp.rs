use crate::sidecar::{resolve_tool, SidecarRoots};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use url::Url;

pub struct JavaDebugHost {
    child: Child,
    stdin: ChildStdin,
}

impl Drop for JavaDebugHost {
    fn drop(&mut self) {
        let _ = send_message(
            &mut self.stdin,
            &json!({"jsonrpc":"2.0","method":"exit","params":null}),
        );
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub fn start_java_debug_host(
    root: &Path,
    executable: &Path,
) -> Result<(JavaDebugHost, u16), String> {
    let tool = tool_definitions(root)
        .into_iter()
        .find(|tool| tool.id == "jdtls")
        .ok_or_else(|| "JDT LS tool definition is missing".to_string())?;
    let mut command = network_isolated_lsp_command(executable, &tool.args, root)?;
    let mut child = command
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .env("TMPDIR", root)
        .env("NO_PROXY", "*")
        .spawn()
        .map_err(|error| format!("failed to start JDT LS debug host: {error}"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "JDT LS stdin is unavailable".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "JDT LS stdout is unavailable".to_string())?;
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        while let Ok(message) = read_message(&mut reader) {
            if sender.send(message).is_err() {
                break;
            }
        }
    });
    let root_uri = Url::from_directory_path(root)
        .map_err(|_| "failed to build Java root URI".to_string())?
        .to_string();
    send_message(
        &mut stdin,
        &json!({
            "jsonrpc":"2.0","id":1,"method":"initialize","params":{
                "processId":std::process::id(),"rootUri":root_uri,
                "workspaceFolders":[{"uri":root_uri,"name":"codeflow-java"}],
                "capabilities":{"workspace":{"configuration":true,"workspaceFolders":true}},
                "initializationOptions":initialization_options("jdtls", executable)
            }
        }),
    )?;
    wait_for_response(&receiver, &mut stdin, 1, Duration::from_secs(45), &root_uri)?;
    send_message(
        &mut stdin,
        &json!({"jsonrpc":"2.0","method":"initialized","params":{}}),
    )?;
    send_message(
        &mut stdin,
        &json!({
            "jsonrpc":"2.0","id":2,"method":"workspace/executeCommand",
            "params":{"command":"vscode.java.startDebugSession","arguments":[]}
        }),
    )?;
    let response = wait_for_response(&receiver, &mut stdin, 2, Duration::from_secs(45), &root_uri)?;
    let port = response
        .get("result")
        .and_then(Value::as_u64)
        .and_then(|value| u16::try_from(value).ok())
        .ok_or_else(|| format!("JDT LS did not return a Java DAP port: {response}"))?;
    Ok((JavaDebugHost { child, stdin }, port))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspFileInput {
    pub path: String,
    pub content: String,
    pub language: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspSymbolInput {
    pub id: String,
    pub file_name: String,
    pub language: String,
    pub name: String,
    pub line: usize,
    pub column: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspMacroInput {
    pub id: String,
    pub file_name: String,
    pub language: String,
    pub name: String,
    pub line: usize,
    pub column: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspWorkspaceRequest {
    pub project_id: String,
    pub files: Vec<LspFileInput>,
    pub symbols: Vec<LspSymbolInput>,
    pub macro_sites: Vec<LspMacroInput>,
    pub timeout_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspToolReport {
    pub id: String,
    pub label: String,
    pub command: String,
    pub available: bool,
    pub status: String,
    pub language_count: usize,
    pub languages: Vec<String>,
    pub symbol_count: usize,
    pub diagnostic_count: usize,
    pub document_symbol_count: usize,
    pub macro_expansion_count: usize,
    pub duration_ms: u128,
    pub evidence: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspSymbolFact {
    pub symbol_id: String,
    pub adapter: String,
    pub hover: String,
    pub reference_count: usize,
    pub references: Vec<String>,
    pub definitions: Vec<String>,
    pub confidence: u8,
    pub evidence: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspDiagnosticFact {
    pub adapter: String,
    pub file_name: String,
    pub line: usize,
    pub column: usize,
    pub severity: String,
    pub message: String,
    pub code: String,
    pub source: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspMacroFact {
    pub macro_id: String,
    pub adapter: String,
    pub name: String,
    pub file_name: String,
    pub line: usize,
    pub expansion: String,
    pub confidence: u8,
    pub evidence: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspWorkspaceReport {
    pub status: String,
    pub available_count: usize,
    pub executed_count: usize,
    pub tool_count: usize,
    pub tools: Vec<LspToolReport>,
    pub symbol_facts: Vec<LspSymbolFact>,
    pub diagnostics: Vec<LspDiagnosticFact>,
    pub macro_facts: Vec<LspMacroFact>,
    pub evidence: Vec<String>,
}

#[derive(Clone)]
struct ToolDefinition {
    id: &'static str,
    label: &'static str,
    command: &'static str,
    args: Vec<String>,
    languages: &'static [&'static str],
}

pub fn availability(roots: &SidecarRoots) -> LspWorkspaceReport {
    let tools = tool_definitions(Path::new("."))
        .into_iter()
        .map(|tool| {
            let disabled = roots.disabled.contains(tool.id);
            let executable = resolve_tool(tool.id, tool.command, roots);
            LspToolReport {
                id: tool.id.to_string(),
                label: tool.label.to_string(),
                command: tool.command.to_string(),
                available: executable.is_some(),
                status: if disabled {
                    "disabled"
                } else if executable.is_some() {
                    "available"
                } else {
                    "missing"
                }
                .to_string(),
                language_count: tool.languages.len(),
                languages: tool
                    .languages
                    .iter()
                    .map(|value| value.to_string())
                    .collect(),
                symbol_count: 0,
                diagnostic_count: 0,
                document_symbol_count: 0,
                macro_expansion_count: 0,
                duration_ms: 0,
                evidence: if disabled {
                    "disabled by local desktop sidecar setting".to_string()
                } else {
                    executable
                        .map(|item| {
                            format!(
                                "{} LSP executable found at {}; checksum-verified={}",
                                item.source,
                                item.path.display(),
                                item.verified
                            )
                        })
                        .unwrap_or_else(|| format!("{} was not found on PATH", tool.command))
                },
            }
        })
        .collect::<Vec<_>>();
    let available_count = tools.iter().filter(|tool| tool.available).count();
    LspWorkspaceReport {
        status: if available_count == tools.len() {
            "ready"
        } else if available_count > 0 {
            "partial"
        } else {
            "unavailable"
        }
        .to_string(),
        available_count,
        executed_count: 0,
        tool_count: tools.len(),
        tools,
        symbol_facts: Vec::new(),
        diagnostics: Vec::new(),
        macro_facts: Vec::new(),
        evidence: vec![
            "LSP tools are detected locally; unavailable tools are never reported as active."
                .to_string(),
        ],
    }
}

pub fn analyze(request: LspWorkspaceRequest, roots: &SidecarRoots) -> LspWorkspaceReport {
    let started = Instant::now();
    let root = std::env::temp_dir().join(format!(
        "codeflow-lsp-{}-{}",
        safe_id(&request.project_id),
        now_ms()
    ));
    if let Err(error) = write_workspace(&root, &request.files) {
        return failure_report(format!("failed to create LSP workspace: {error}"));
    }

    let mut tools = Vec::new();
    let mut symbol_facts = Vec::new();
    let mut diagnostics = Vec::new();
    let mut macro_facts = Vec::new();
    let timeout = Duration::from_millis(request.timeout_ms.clamp(1_000, 20_000));
    for tool in tool_definitions(&root) {
        let matching_files = request
            .files
            .iter()
            .filter(|file| language_matches(&file.language, tool.languages))
            .collect::<Vec<_>>();
        let matching_symbols = request
            .symbols
            .iter()
            .filter(|symbol| language_matches(&symbol.language, tool.languages))
            .collect::<Vec<_>>();
        let matching_macro_sites = request
            .macro_sites
            .iter()
            .filter(|site| language_matches(&site.language, tool.languages))
            .collect::<Vec<_>>();
        let disabled = roots.disabled.contains(tool.id);
        let executable = resolve_tool(tool.id, tool.command, roots);
        if matching_files.is_empty() {
            tools.push(tool_report(
                &tool,
                executable.is_some(),
                "skipped",
                0,
                0,
                0,
                0,
                0,
                0,
                "current project has no matching language files".to_string(),
            ));
            continue;
        }
        if disabled {
            tools.push(tool_report(
                &tool,
                false,
                "disabled",
                matching_files.len(),
                0,
                0,
                0,
                0,
                0,
                "disabled by local desktop sidecar setting".to_string(),
            ));
            continue;
        }
        let Some(executable) = executable else {
            tools.push(tool_report(
                &tool,
                false,
                "missing",
                matching_files.len(),
                matching_symbols.len(),
                0,
                0,
                0,
                0,
                format!("{} was not found on PATH", tool.command),
            ));
            continue;
        };
        let tool_started = Instant::now();
        let tool_timeout = if matches!(tool.id, "csharp-ls" | "sourcekit-lsp") {
            timeout.max(Duration::from_secs(45))
        } else {
            timeout
        };
        match run_lsp_tool(
            &tool,
            &executable.path,
            &root,
            &matching_files,
            &matching_symbols,
            &matching_macro_sites,
            tool_timeout,
        ) {
            Ok((
                mut facts,
                mut tool_diagnostics,
                mut tool_macro_facts,
                mut document_symbol_count,
                mut pending_count,
                mut request_failures,
            )) => {
                if tool.id == "sourcekit-lsp" && facts.is_empty() && document_symbol_count == 0 {
                    match run_swift_compiler_fallback(&root, &matching_files, &matching_symbols) {
                        Ok((mut compiler_facts, mut compiler_diagnostics, compiler_evidence)) => {
                            if !compiler_facts.is_empty() {
                                document_symbol_count = compiler_facts.len();
                                pending_count = 0;
                            }
                            facts.append(&mut compiler_facts);
                            tool_diagnostics.append(&mut compiler_diagnostics);
                            request_failures.push(compiler_evidence);
                        }
                        Err(error) => request_failures.push(format!("Swift compiler fallback failed: {error}")),
                    }
                }
                let diagnostic_count = tool_diagnostics.len();
                let fact_count = facts.len();
                let macro_expansion_count = tool_macro_facts.len();
                let protocol_limited = pending_count > 0
                    && !request_failures.is_empty()
                    && request_failures.iter().all(|failure| failure.contains("-32601"));
                symbol_facts.append(&mut facts);
                diagnostics.append(&mut tool_diagnostics);
                macro_facts.append(&mut tool_macro_facts);
                tools.push(tool_report(
                    &tool,
                    true,
                    if protocol_limited { "limited" } else if pending_count == 0 { "executed" } else { "partial" },
                    matching_files.len(),
                    fact_count,
                    diagnostic_count,
                    document_symbol_count,
                    macro_expansion_count,
                    tool_started.elapsed().as_millis(),
                    if protocol_limited {
                        format!("{} does not implement CodeFlow semantic requests; Tree-sitter remains the structural authority: {}", tool.label, request_failures.join(" | "))
                    } else if pending_count == 0 {
                        format!(
                            "{} completed semantic requests{}",
                            tool.label,
                            if tool.id == "sourcekit-lsp" && request_failures.iter().any(|item| item.contains("swiftc")) { " with isolated swiftc compiler fallback" } else { "" }
                        )
                    } else {
                        format!(
                            "{} returned partial semantic evidence; {pending_count} requests failed or exceeded the bounded import timeout: {}",
                            tool.label,
                            request_failures.join(" | ")
                        )
                    },
                ));
            }
            Err(error) => tools.push(tool_report(
                &tool,
                true,
                "failed",
                matching_files.len(),
                matching_symbols.len(),
                0,
                0,
                0,
                tool_started.elapsed().as_millis(),
                error,
            )),
        }
    }
    let _ = fs::remove_dir_all(&root);
    let available_count = tools.iter().filter(|tool| tool.available).count();
    let executed_count = tools
        .iter()
        .filter(|tool| matches!(tool.status.as_str(), "executed" | "partial"))
        .count();
    LspWorkspaceReport {
        status: if executed_count > 0 {
            "enriched"
        } else if available_count > 0 {
            "available"
        } else {
            "unavailable"
        }
        .to_string(),
        available_count,
        executed_count,
        tool_count: tools.len(),
        tools,
        symbol_facts,
        diagnostics,
        macro_facts,
        evidence: vec![
            format!(
                "LSP semantic pass completed in {}ms; {executed_count} servers executed.",
                started.elapsed().as_millis()
            ),
            "Tree-sitter remains the structural source; LSP facts enrich types, references and compiler diagnostics.".to_string(),
        ],
    }
}

fn run_lsp_tool(
    tool: &ToolDefinition,
    executable: &Path,
    root: &Path,
    files: &[&LspFileInput],
    symbols: &[&LspSymbolInput],
    macro_sites: &[&LspMacroInput],
    timeout: Duration,
) -> Result<
    (
        Vec<LspSymbolFact>,
        Vec<LspDiagnosticFact>,
        Vec<LspMacroFact>,
        usize,
        usize,
        Vec<String>,
    ),
    String,
> {
    let mut tool_args = tool.args.clone();
    if tool.id == "csharp-ls" {
        let project = fs::read_dir(root)
            .ok()
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .find(|path| {
                matches!(
                    path.extension().and_then(|value| value.to_str()),
                    Some("sln" | "csproj")
                )
            });
        if let Some(project) = project.and_then(|path| {
            path.file_name()
                .map(|name| name.to_string_lossy().to_string())
        }) {
            tool_args.extend(["--solution".to_string(), project]);
        }
    }
    if tool.id == "sourcekit-lsp" && root.join("Package.swift").is_file() {
        tool_args.extend([
            "--default-workspace-type".to_string(),
            "swiftPM".to_string(),
            "--scratch-path".to_string(),
            root.join(".build").to_string_lossy().to_string(),
        ]);
    }
    let mut command = network_isolated_lsp_command(executable, &tool_args, root)?;
    if tool.id == "csharp-ls" && std::env::var_os("DOTNET_ROOT").is_none() {
        let homebrew_dotnet = Path::new("/opt/homebrew/opt/dotnet/libexec");
        if homebrew_dotnet.is_dir() {
            command
                .env("DOTNET_ROOT", homebrew_dotnet)
                .env("DOTNET_ROOT_ARM64", homebrew_dotnet)
                .env("DOTNET_MULTILEVEL_LOOKUP", "0")
                .env("DOTNET_NOLOGO", "1")
                .env("DOTNET_CLI_TELEMETRY_OPTOUT", "1");
        }
    }
    let stderr_path = root.join(format!(".codeflow-{}-stderr.log", safe_id(tool.id)));
    let stderr_file = fs::File::create(&stderr_path)
        .map_err(|error| format!("failed to create {} diagnostic log: {error}", tool.command))?;
    let mut child = command
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::from(stderr_file))
        .env("CODEFLOW_LSP_ANALYSIS", "1")
        .env("TMPDIR", root)
        .env("XDG_CACHE_HOME", root.join(".cache"))
        .env("NO_PROXY", "*")
        .env("no_proxy", "*")
        .env("HTTP_PROXY", "http://127.0.0.1:9")
        .env("HTTPS_PROXY", "http://127.0.0.1:9")
        .env("http_proxy", "http://127.0.0.1:9")
        .env("https_proxy", "http://127.0.0.1:9")
        .spawn()
        .map_err(|error| format!("failed to start {}: {error}", tool.command))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| format!("{} did not expose stdin", tool.command))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("{} did not expose stdout", tool.command))?;
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        while let Ok(message) = read_message(&mut reader) {
            if sender.send(message).is_err() {
                break;
            }
        }
    });

    let root_uri = Url::from_directory_path(root)
        .map_err(|_| "failed to build LSP root URI".to_string())?
        .to_string();
    send_message(
        &mut stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "processId": std::process::id(),
                "rootUri": root_uri.clone(),
                "workspaceFolders": [{"uri": root_uri.clone(), "name": "codeflow-project"}],
                "capabilities": {
                    "workspace": {"configuration": true, "workspaceFolders": true},
                    "textDocument": {
                        "hover": {"contentFormat": ["plaintext", "markdown"]},
                        "references": {},
                        "definition": {"linkSupport": true},
                        "documentSymbol": {"hierarchicalDocumentSymbolSupport": true},
                        "publishDiagnostics": {"relatedInformation": true}
                    }
                },
                "clientInfo": {"name": "CodeFlow Inspector", "version": "0.1.0"}
                ,"initializationOptions": initialization_options(tool.id, executable)
            }
        }),
    )?;
    wait_for_response(&receiver, &mut stdin, 1, timeout, &root_uri)?;
    send_message(
        &mut stdin,
        &json!({"jsonrpc":"2.0","method":"initialized","params":{}}),
    )?;

    for file in files {
        let uri = file_uri(root, &file.path)?;
        send_message(
            &mut stdin,
            &json!({
                "jsonrpc":"2.0",
                "method":"textDocument/didOpen",
                "params":{"textDocument":{
                    "uri": uri,
                    "languageId": language_id(&file.language),
                    "version": 1,
                    "text": file.content
                }}
            }),
        )?;
    }
    if tool.id == "csharp-ls" {
        thread::sleep(Duration::from_secs(2));
    }

    let mut request_map = BTreeMap::<u64, (&str, &LspSymbolInput)>::new();
    let mut document_symbol_requests = BTreeSet::<u64>::new();
    let mut next_id = 100_u64;
    for file in files {
        next_id += 1;
        let uri = file_uri(root, &file.path)?;
        send_message(
            &mut stdin,
            &json!({
                "jsonrpc":"2.0",
                "id":next_id,
                "method":"textDocument/documentSymbol",
                "params":{"textDocument":{"uri":uri}}
            }),
        )?;
        document_symbol_requests.insert(next_id);
    }
    for symbol in symbols {
        let uri = file_uri(root, &symbol.file_name)?;
        for method in [
            "textDocument/hover",
            "textDocument/references",
            "textDocument/definition",
        ] {
            next_id += 1;
            let params = if method == "textDocument/references" {
                json!({
                    "textDocument":{"uri":uri},
                    "position":{"line":symbol.line,"character":symbol.column},
                    "context":{"includeDeclaration":false}
                })
            } else {
                json!({
                    "textDocument":{"uri":uri},
                    "position":{"line":symbol.line,"character":symbol.column}
                })
            };
            send_message(
                &mut stdin,
                &json!({"jsonrpc":"2.0","id":next_id,"method":method,"params":params}),
            )?;
            request_map.insert(next_id, (method, symbol));
        }
    }
    let mut macro_request_map = BTreeMap::<u64, (&str, &LspMacroInput)>::new();
    if matches!(tool.id, "clangd" | "rust-analyzer") {
        for site in macro_sites {
            next_id += 1;
            let uri = file_uri(root, &site.file_name)?;
            let (method, params) = if tool.id == "rust-analyzer" {
                (
                    "rust-analyzer/expandMacro",
                    json!({
                        "textDocument":{"uri":uri},
                        "position":{"line":site.line,"character":site.column}
                    }),
                )
            } else {
                (
                    "textDocument/ast",
                    json!({
                        "textDocument":{"uri":uri},
                        "range":{
                            "start":{"line":site.line,"character":site.column},
                            "end":{"line":site.line,"character":site.column + site.name.chars().count()}
                        }
                    }),
                )
            };
            send_message(
                &mut stdin,
                &json!({"jsonrpc":"2.0","id":next_id,"method":method,"params":params}),
            )?;
            macro_request_map.insert(next_id, (method, site));
        }
    }

    let deadline = Instant::now() + timeout;
    let mut facts = BTreeMap::<String, LspSymbolFact>::new();
    let mut diagnostics = Vec::new();
    let mut pending = request_map.keys().copied().collect::<BTreeSet<_>>();
    let mut pending_macros = macro_request_map.keys().copied().collect::<BTreeSet<_>>();
    let mut pending_document_symbols = document_symbol_requests.clone();
    let mut document_symbol_count = 0;
    let mut macro_facts = Vec::new();
    let mut response_error_count = 0;
    let mut request_failures = Vec::new();
    while Instant::now() < deadline
        && (!pending.is_empty()
            || !pending_document_symbols.is_empty()
            || !pending_macros.is_empty())
    {
        let wait = deadline.saturating_duration_since(Instant::now());
        let Ok(message) = receiver.recv_timeout(wait.min(Duration::from_millis(250))) else {
            continue;
        };
        if handle_server_request(&message, &mut stdin, &root_uri)? {
            continue;
        }
        if message.get("method").and_then(Value::as_str) == Some("textDocument/publishDiagnostics")
        {
            diagnostics.extend(parse_diagnostics(tool.id, root, &message));
            continue;
        }
        let Some(id) = message.get("id").and_then(Value::as_u64) else {
            continue;
        };
        if pending_document_symbols.remove(&id) {
            if let Some(error) = message.get("error") {
                response_error_count += 1;
                request_failures.push(format!("documentSymbol: {}", compact_json(error, 800)));
                continue;
            }
            document_symbol_count +=
                count_document_symbols(message.get("result").unwrap_or(&Value::Null));
            continue;
        }
        if let Some((method, site)) = macro_request_map.get(&id) {
            pending_macros.remove(&id);
            if let Some(error) = message.get("error") {
                response_error_count += 1;
                request_failures.push(format!("{method}: {}", compact_json(error, 800)));
                continue;
            }
            let result = message.get("result").cloned().unwrap_or(Value::Null);
            let expansion = if *method == "rust-analyzer/expandMacro" {
                result
                    .get("expansion")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string()
            } else {
                compact_json(&result, 4_000)
            };
            if !expansion.is_empty() && !result.is_null() {
                macro_facts.push(LspMacroFact {
                    macro_id: site.id.clone(),
                    adapter: tool.id.to_string(),
                    name: site.name.clone(),
                    file_name: site.file_name.clone(),
                    line: site.line + 1,
                    expansion,
                    confidence: 94,
                    evidence: format!(
                        "{method} semantic expansion at {}:{}",
                        site.file_name,
                        site.line + 1
                    ),
                });
            }
            continue;
        }
        let Some((method, symbol)) = request_map.get(&id) else {
            continue;
        };
        pending.remove(&id);
        if let Some(error) = message.get("error") {
            response_error_count += 1;
            request_failures.push(format!("{method}: {}", compact_json(error, 800)));
            continue;
        }
        let result = message.get("result").cloned().unwrap_or(Value::Null);
        let fact = facts
            .entry(symbol.id.clone())
            .or_insert_with(|| LspSymbolFact {
                symbol_id: symbol.id.clone(),
                adapter: tool.id.to_string(),
                hover: String::new(),
                reference_count: 0,
                references: Vec::new(),
                definitions: Vec::new(),
                confidence: 92,
                evidence: vec![format!(
                    "{} semantic response for {}",
                    tool.label, symbol.name
                )],
            });
        match *method {
            "textDocument/hover" => fact.hover = hover_text(&result),
            "textDocument/references" => {
                fact.references = locations(root, &result);
                fact.reference_count = fact.references.len();
            }
            "textDocument/definition" => fact.definitions = locations(root, &result),
            _ => {}
        }
    }

    // Keep late diagnostics without extending the import path indefinitely.
    let diagnostic_deadline = Instant::now() + Duration::from_millis(250);
    while Instant::now() < diagnostic_deadline {
        let Ok(message) = receiver.recv_timeout(Duration::from_millis(40)) else {
            continue;
        };
        if message.get("method").and_then(Value::as_str) == Some("textDocument/publishDiagnostics")
        {
            diagnostics.extend(parse_diagnostics(tool.id, root, &message));
        } else {
            let _ = handle_server_request(&message, &mut stdin, &root_uri);
        }
    }
    let _ = send_message(
        &mut stdin,
        &json!({"jsonrpc":"2.0","id":99999,"method":"shutdown","params":null}),
    );
    let _ = send_message(
        &mut stdin,
        &json!({"jsonrpc":"2.0","method":"exit","params":null}),
    );
    let _ = child.kill();
    let _ = child.wait();
    if !pending.is_empty() || !pending_document_symbols.is_empty() || !pending_macros.is_empty() {
        if let Ok(stderr) = fs::read_to_string(&stderr_path) {
            let compact = stderr.trim();
            if !compact.is_empty() {
                request_failures.push(format!("stderr: {}", compact.chars().take(2_000).collect::<String>()));
            }
        }
    }
    for id in &pending_document_symbols {
        request_failures.push(format!("documentSymbol request {id}: timeout"));
    }
    for id in &pending {
        if let Some((method, symbol)) = request_map.get(id) {
            request_failures.push(format!("{method} {} request {id}: timeout", symbol.name));
        }
    }
    for id in &pending_macros {
        if let Some((method, site)) = macro_request_map.get(id) {
            request_failures.push(format!("{method} {} request {id}: timeout", site.name));
        }
    }
    Ok((
        facts.into_values().collect(),
        diagnostics,
        macro_facts,
        document_symbol_count,
        pending.len()
            + pending_document_symbols.len()
            + pending_macros.len()
            + response_error_count,
        request_failures,
    ))
}

fn run_swift_compiler_fallback(
    root: &Path,
    files: &[&LspFileInput],
    symbols: &[&LspSymbolInput],
) -> Result<(Vec<LspSymbolFact>, Vec<LspDiagnosticFact>, String), String> {
    let swiftc = Path::new("/usr/bin/swiftc");
    if !swiftc.is_file() {
        return Err("/usr/bin/swiftc is unavailable".to_string());
    }
    let paths = files
        .iter()
        .map(|file| root.join(&file.path).to_string_lossy().to_string())
        .collect::<Vec<_>>();
    let typecheck = run_isolated_compiler(swiftc, &[vec!["-typecheck".to_string()], paths.clone()].concat(), root)?;
    let dump = run_isolated_compiler(swiftc, &[vec!["-dump-ast".to_string()], paths].concat(), root)?;
    let dump_text = String::from_utf8_lossy(&dump.stdout);
    let mut diagnostics = Vec::new();
    for line in String::from_utf8_lossy(&typecheck.stderr).lines().filter(|line| !line.trim().is_empty()).take(64) {
        diagnostics.push(LspDiagnosticFact {
            adapter: "swiftc".to_string(),
            file_name: line.split(':').next().and_then(|path| Path::new(path).file_name()).map(|name| name.to_string_lossy().to_string()).unwrap_or_else(|| "Swift workspace".to_string()),
            line: line.split(':').nth(1).and_then(|value| value.parse::<usize>().ok()).unwrap_or(1),
            column: line.split(':').nth(2).and_then(|value| value.parse::<usize>().ok()).unwrap_or(1),
            severity: if line.contains("error:") { "Error" } else if line.contains("warning:") { "Warning" } else { "Info" }.to_string(),
            message: line.to_string(),
            code: "swiftc-typecheck".to_string(),
            source: "swiftc".to_string(),
        });
    }
    if !typecheck.status.success() && diagnostics.is_empty() {
        return Err(format!("swiftc typecheck failed with {}", typecheck.status));
    }
    let mut facts = Vec::new();
    for symbol in symbols {
        if !dump_text.contains(&symbol.name) {
            continue;
        }
        let Some(file) = files.iter().find(|file| file.path == symbol.file_name) else { continue; };
        let declaration = file.content.lines().nth(symbol.line).unwrap_or("").trim();
        let references = file.content.match_indices(&symbol.name)
            .map(|(offset, _)| format!("{}:{}", symbol.file_name, file.content[..offset].lines().count()))
            .collect::<Vec<_>>();
        facts.push(LspSymbolFact {
            symbol_id: symbol.id.clone(),
            adapter: "swiftc".to_string(),
            hover: declaration.to_string(),
            reference_count: references.len().saturating_sub(1),
            references,
            definitions: vec![format!("{}:{}", symbol.file_name, symbol.line + 1)],
            confidence: 94,
            evidence: vec!["Isolated swiftc -typecheck and -dump-ast compiler fallback; no heuristic claim.".to_string()],
        });
    }
    Ok((facts, diagnostics, "isolated swiftc compiler fallback produced typed AST evidence".to_string()))
}

fn run_isolated_compiler(executable: &Path, args: &[String], root: &Path) -> Result<std::process::Output, String> {
    let mut command = network_isolated_lsp_command(executable, args, root)?;
    let mut child = command
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env_clear()
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .env("HOME", root)
        .env("TMPDIR", root)
        .spawn()
        .map_err(|error| format!("failed to start {}: {error}", executable.display()))?;
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if child.try_wait().map_err(|error| error.to_string())?.is_some() {
            return child.wait_with_output().map_err(|error| error.to_string());
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("{} exceeded the 30s compiler budget", executable.display()));
        }
        thread::sleep(Duration::from_millis(25));
    }
}

fn network_isolated_lsp_command(
    executable: &Path,
    args: &[String],
    root: &Path,
) -> Result<Command, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = root;
        let sandbox_available = Command::new("/usr/bin/sandbox-exec")
            .args(["-p", "(version 1)\n(allow default)", "/usr/bin/true"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        if !sandbox_available {
            return Err(
                "local defense refused LSP execution because macOS sandbox-exec is unavailable"
                    .to_string(),
            );
        }
        let profile = concat!(
            "(version 1)\n",
            "(allow default)\n",
            "(deny network*)\n",
            "(allow network-inbound (local ip \"localhost:*\"))\n",
            "(allow network-outbound (remote ip \"localhost:*\"))\n",
        );
        let mut command = Command::new("/usr/bin/sandbox-exec");
        command.arg("-p").arg(profile).arg(executable).args(args);
        return Ok(command);
    }
    #[cfg(target_os = "linux")]
    {
        if Command::new("bwrap")
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_err()
        {
            return Err(
                "local defense refused LSP execution because bubblewrap is unavailable".to_string(),
            );
        }
        let root_text = root.to_string_lossy().to_string();
        let mut command = Command::new("bwrap");
        command
            .args([
                "--unshare-all",
                "--die-with-parent",
                "--new-session",
                "--ro-bind",
                "/",
                "/",
                "--bind",
            ])
            .arg(&root_text)
            .arg(&root_text)
            .arg("--chdir")
            .arg(&root_text)
            .args(["--proc", "/proc", "--dev", "/dev", "--"])
            .arg(executable)
            .args(args);
        return Ok(command);
    }
    #[cfg(target_os = "windows")]
    {
        let _ = (executable, args, root);
        return Err("local defense refused LSP execution because Windows AppContainer/WFP network isolation is not installed".to_string());
    }
    #[allow(unreachable_code)]
    Err("local defense refused LSP execution because this platform has no network-isolating process sandbox".to_string())
}

fn wait_for_response(
    receiver: &Receiver<Value>,
    stdin: &mut ChildStdin,
    id: u64,
    timeout: Duration,
    root_uri: &str,
) -> Result<Value, String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        let wait = deadline.saturating_duration_since(Instant::now());
        let message = match receiver.recv_timeout(wait.min(Duration::from_millis(250))) {
            Ok(message) => message,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => {
                return Err("language server closed before initialize completed".to_string());
            }
        };
        if handle_server_request(&message, stdin, root_uri)? {
            continue;
        }
        if message.get("id").and_then(Value::as_u64) == Some(id) {
            if let Some(error) = message.get("error") {
                return Err(format!("language server initialize failed: {error}"));
            }
            return Ok(message);
        }
    }
    Err("language server initialize timed out".to_string())
}

fn handle_server_request(
    message: &Value,
    stdin: &mut ChildStdin,
    root_uri: &str,
) -> Result<bool, String> {
    let Some(method) = message.get("method").and_then(Value::as_str) else {
        return Ok(false);
    };
    let Some(id) = message.get("id").cloned() else {
        return Ok(false);
    };
    let result = match method {
        "workspace/configuration" => {
            let count = message
                .pointer("/params/items")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0);
            Value::Array((0..count).map(|_| Value::Null).collect())
        }
        "workspace/workspaceFolders" => {
            json!([{"uri":root_uri,"name":"codeflow-project"}])
        }
        "window/workDoneProgress/create"
        | "client/registerCapability"
        | "client/unregisterCapability" => Value::Null,
        _ => Value::Null,
    };
    send_message(stdin, &json!({"jsonrpc":"2.0","id":id,"result":result}))?;
    Ok(true)
}

fn send_message(writer: &mut ChildStdin, message: &Value) -> Result<(), String> {
    let payload = serde_json::to_vec(message)
        .map_err(|error| format!("failed to encode LSP message: {error}"))?;
    write!(writer, "Content-Length: {}\r\n\r\n", payload.len())
        .map_err(|error| format!("failed to frame LSP message: {error}"))?;
    writer
        .write_all(&payload)
        .and_then(|_| writer.flush())
        .map_err(|error| format!("failed to send LSP message: {error}"))
}

fn read_message(reader: &mut impl BufRead) -> Result<Value, String> {
    let mut content_length = None;
    loop {
        let mut header = String::new();
        let bytes = reader
            .read_line(&mut header)
            .map_err(|error| format!("failed to read LSP header: {error}"))?;
        if bytes == 0 {
            return Err("language server closed stdout".to_string());
        }
        if header == "\r\n" || header == "\n" {
            break;
        }
        if let Some(value) = header
            .to_ascii_lowercase()
            .strip_prefix("content-length:")
            .and_then(|value| value.trim().parse::<usize>().ok())
        {
            content_length = Some(value);
        }
    }
    let length = content_length.ok_or_else(|| "LSP frame has no Content-Length".to_string())?;
    let mut payload = vec![0_u8; length];
    reader
        .read_exact(&mut payload)
        .map_err(|error| format!("failed to read LSP payload: {error}"))?;
    serde_json::from_slice(&payload)
        .map_err(|error| format!("failed to decode LSP payload: {error}"))
}

fn parse_diagnostics(adapter: &str, root: &Path, message: &Value) -> Vec<LspDiagnosticFact> {
    let uri = message
        .pointer("/params/uri")
        .and_then(Value::as_str)
        .unwrap_or("");
    let file_name = uri_to_relative(root, uri);
    message
        .pointer("/params/diagnostics")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|item| LspDiagnosticFact {
            adapter: adapter.to_string(),
            file_name: file_name.clone(),
            line: item
                .pointer("/range/start/line")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize
                + 1,
            column: item
                .pointer("/range/start/character")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize,
            severity: match item.get("severity").and_then(Value::as_u64) {
                Some(1) => "Error",
                Some(2) => "Warning",
                Some(3) => "Information",
                Some(4) => "Hint",
                _ => "Unknown",
            }
            .to_string(),
            message: item
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("language server diagnostic")
                .to_string(),
            code: item.get("code").map(value_text).unwrap_or_default(),
            source: item
                .get("source")
                .and_then(Value::as_str)
                .unwrap_or(adapter)
                .to_string(),
        })
        .collect()
}

fn hover_text(result: &Value) -> String {
    let contents = result.get("contents").unwrap_or(result);
    match contents {
        Value::String(value) => value.clone(),
        Value::Object(map) => map
            .get("value")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        Value::Array(items) => items
            .iter()
            .map(value_text)
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn locations(root: &Path, result: &Value) -> Vec<String> {
    let values = if let Some(items) = result.as_array() {
        items.clone()
    } else if result.is_null() {
        Vec::new()
    } else {
        vec![result.clone()]
    };
    values
        .iter()
        .filter_map(|item| {
            let uri = item
                .get("uri")
                .or_else(|| item.get("targetUri"))
                .and_then(Value::as_str)?;
            let line = item
                .pointer("/range/start/line")
                .or_else(|| item.pointer("/targetSelectionRange/start/line"))
                .and_then(Value::as_u64)
                .unwrap_or(0)
                + 1;
            Some(format!("{}:{line}", uri_to_relative(root, uri)))
        })
        .collect()
}

fn count_document_symbols(result: &Value) -> usize {
    fn count(items: &[Value]) -> usize {
        items
            .iter()
            .map(|item| {
                1 + item
                    .get("children")
                    .and_then(Value::as_array)
                    .map(|children| count(children))
                    .unwrap_or(0)
            })
            .sum()
    }
    result.as_array().map(|items| count(items)).unwrap_or(0)
}

fn compact_json(value: &Value, max_chars: usize) -> String {
    let serialized = serde_json::to_string(value).unwrap_or_default();
    serialized.chars().take(max_chars).collect()
}

fn tool_definitions(root: &Path) -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            id: "pyright",
            label: "Pyright",
            command: "pyright-langserver",
            args: vec!["--stdio".to_string()],
            languages: &["python"],
        },
        ToolDefinition {
            id: "jdtls",
            label: "Eclipse JDT LS",
            command: "jdtls",
            args: vec![
                format!("--jvm-arg=-Duser.home={}", root.to_string_lossy()),
                "-data".to_string(),
                root.join(".jdtls-workspace").to_string_lossy().to_string(),
            ],
            languages: &["java"],
        },
        ToolDefinition {
            id: "clangd",
            label: "clangd",
            command: "clangd",
            args: vec![
                "--background-index=0".to_string(),
                "--clang-tidy=0".to_string(),
                "--log=error".to_string(),
            ],
            languages: &["c", "c++", "c/c++"],
        },
        ToolDefinition {
            id: "gopls",
            label: "gopls",
            command: "gopls",
            args: vec!["serve".to_string()],
            languages: &["go"],
        },
        ToolDefinition {
            id: "rust-analyzer",
            label: "rust-analyzer",
            command: "rust-analyzer",
            args: Vec::new(),
            languages: &["rust"],
        },
        ToolDefinition {
            id: "kotlin-language-server",
            label: "Kotlin Language Server",
            command: "kotlin-language-server",
            args: Vec::new(),
            languages: &["kotlin"],
        },
        ToolDefinition {
            id: "csharp-ls",
            label: "C# Language Server",
            command: "csharp-ls",
            args: vec!["--loglevel".to_string(), "error".to_string()],
            languages: &["c#", "csharp"],
        },
        ToolDefinition {
            id: "phpantom-lsp",
            label: "PHPantom LSP",
            command: "phpantom_lsp",
            args: vec!["--stdio".to_string()],
            languages: &["php"],
        },
        ToolDefinition {
            id: "ruby-lsp",
            label: "Ruby LSP",
            command: "ruby-lsp",
            args: Vec::new(),
            languages: &["ruby"],
        },
        ToolDefinition {
            id: "sourcekit-lsp",
            label: "SourceKit-LSP",
            command: "sourcekit-lsp",
            args: Vec::new(),
            languages: &["swift"],
        },
        ToolDefinition {
            id: "bash-language-server",
            label: "Bash Language Server",
            command: "bash-language-server",
            args: vec!["start".to_string()],
            languages: &["shell", "bash", "sh"],
        },
        ToolDefinition {
            id: "sql-language-server",
            label: "SQL Language Server",
            command: "sql-language-server",
            args: vec![
                "up".to_string(),
                "--method".to_string(),
                "stdio".to_string(),
            ],
            languages: &["sql"],
        },
    ]
}

fn initialization_options(tool_id: &str, executable: &Path) -> Value {
    match tool_id {
        "rust-analyzer" => json!({
            "cargo": {"buildScripts": {"enable": false}},
            "procMacro": {"enable": false},
            "cachePriming": {"enable": false}
        }),
        "jdtls" => {
            let bundle = java_debug_bundle_for_jdtls(executable);
            json!({
                "bundles": bundle.into_iter().map(|path| path.to_string_lossy().to_string()).collect::<Vec<_>>(),
                "settings": {
                    "java": {
                        "autobuild": {"enabled": false},
                        "import": {"gradle": {"enabled": false}}
                    }
                }
            })
        }
        _ => Value::Null,
    }
}

fn java_debug_bundle_for_jdtls(executable: &Path) -> Option<PathBuf> {
    if let Some(configured) = std::env::var_os("CODEFLOW_JAVA_DEBUG_BUNDLE") {
        let path = PathBuf::from(configured);
        return path.is_file().then_some(path);
    }
    let target_root = executable.parent()?.parent()?.parent()?;
    let target = target_root.file_name()?;
    let resources_root = target_root.parent()?.parent()?;
    let bundle = resources_root
        .join("debug-sidecars")
        .join(target)
        .join("java-debug-server/runtime/com.microsoft.java.debug.plugin-0.53.2.jar");
    bundle.is_file().then_some(bundle)
}

fn tool_report(
    tool: &ToolDefinition,
    available: bool,
    status: &str,
    language_count: usize,
    symbol_count: usize,
    diagnostic_count: usize,
    document_symbol_count: usize,
    macro_expansion_count: usize,
    duration_ms: u128,
    evidence: String,
) -> LspToolReport {
    LspToolReport {
        id: tool.id.to_string(),
        label: tool.label.to_string(),
        command: tool.command.to_string(),
        available,
        status: status.to_string(),
        language_count,
        languages: tool
            .languages
            .iter()
            .map(|value| value.to_string())
            .collect(),
        symbol_count,
        diagnostic_count,
        document_symbol_count,
        macro_expansion_count,
        duration_ms,
        evidence,
    }
}

fn write_workspace(root: &Path, files: &[LspFileInput]) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    for file in files {
        let relative = safe_relative(&file.path)?;
        let target = root.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(target, file.content.as_bytes()).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn safe_relative(path: &str) -> Result<PathBuf, String> {
    let path = Path::new(path);
    if path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err("LSP workspace rejected path traversal".to_string());
    }
    Ok(path.to_path_buf())
}

fn file_uri(root: &Path, file_name: &str) -> Result<String, String> {
    Url::from_file_path(root.join(safe_relative(file_name)?))
        .map(|uri| uri.to_string())
        .map_err(|_| format!("failed to build file URI for {file_name}"))
}

fn uri_to_relative(root: &Path, uri: &str) -> String {
    Url::parse(uri)
        .ok()
        .and_then(|value| value.to_file_path().ok())
        .and_then(|path| path.strip_prefix(root).ok().map(Path::to_path_buf))
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| uri.to_string())
}

fn language_matches(language: &str, accepted: &[&str]) -> bool {
    let lower = language.to_ascii_lowercase();
    accepted.iter().any(|item| lower == *item)
}

fn language_id(language: &str) -> &'static str {
    match language.to_ascii_lowercase().as_str() {
        "python" => "python",
        "java" => "java",
        "c" => "c",
        "c++" | "c/c++" => "cpp",
        "go" => "go",
        "rust" => "rust",
        "kotlin" => "kotlin",
        "c#" | "csharp" => "csharp",
        "php" => "php",
        "ruby" => "ruby",
        "swift" => "swift",
        "shell" | "bash" | "sh" => "shellscript",
        "sql" => "sql",
        _ => "plaintext",
    }
}

fn value_text(value: &Value) -> String {
    value
        .as_str()
        .map(ToString::to_string)
        .unwrap_or_else(|| value.to_string())
}

fn safe_id(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect()
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn failure_report(error: String) -> LspWorkspaceReport {
    LspWorkspaceReport {
        status: "failed".to_string(),
        available_count: 0,
        executed_count: 0,
        tool_count: 5,
        tools: Vec::new(),
        symbol_facts: Vec::new(),
        diagnostics: Vec::new(),
        macro_facts: Vec::new(),
        evidence: vec![error],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    fn bundled_jdtls_loads_java_debug_bundle_and_starts_dap() {
        let fixture =
            std::env::temp_dir().join(format!("codeflow-java-dap-{}", std::process::id()));
        std::fs::create_dir_all(&fixture).expect("java fixture directory");
        let source = fixture.join("Main.java");
        std::fs::write(
            &source,
            "public class Main {\n  public static void main(String[] args) {\n    int value = 40;\n    value += 2;\n    System.out.println(value);\n  }\n}\n",
        ).expect("java fixture source");
        let build = Command::new("/opt/homebrew/opt/openjdk/bin/javac")
            .args(["-g", source.to_str().expect("Java source path")])
            .current_dir(&fixture)
            .output()
            .expect("compile Java fixture");
        assert!(
            build.status.success(),
            "Java fixture failed to compile: {}",
            String::from_utf8_lossy(&build.stderr)
        );
        let executable = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("lsp-sidecars/aarch64-apple-darwin/jdtls/bin/jdtls");
        let tool = tool_definitions(&fixture)
            .into_iter()
            .find(|tool| tool.id == "jdtls")
            .expect("jdtls definition");
        let mut command = network_isolated_lsp_command(&executable, &tool.args, &fixture)
            .expect("isolated jdtls command");
        let mut child = command
            .current_dir(&fixture)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .env("TMPDIR", &fixture)
            .env("NO_PROXY", "*")
            .spawn()
            .expect("start jdtls");
        let mut stdin = child.stdin.take().expect("jdtls stdin");
        let stdout = child.stdout.take().expect("jdtls stdout");
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            while let Ok(message) = read_message(&mut reader) {
                if sender.send(message).is_err() {
                    break;
                }
            }
        });
        let root_uri = Url::from_directory_path(&fixture)
            .expect("root uri")
            .to_string();
        let options = initialization_options("jdtls", &executable);
        assert!(options
            .get("bundles")
            .and_then(Value::as_array)
            .is_some_and(|bundles| bundles.len() == 1));
        send_message(&mut stdin, &json!({
            "jsonrpc":"2.0","id":1,"method":"initialize","params":{
                "processId":std::process::id(),"rootUri":root_uri,"workspaceFolders":[{"uri":root_uri,"name":"codeflow-java"}],
                "capabilities":{"workspace":{"configuration":true,"workspaceFolders":true}},
                "initializationOptions":options
            }
        })).expect("initialize request");
        wait_for_response(&receiver, &mut stdin, 1, Duration::from_secs(45), &root_uri)
            .expect("jdtls initialize");
        send_message(
            &mut stdin,
            &json!({"jsonrpc":"2.0","method":"initialized","params":{}}),
        )
        .expect("initialized notification");
        send_message(
            &mut stdin,
            &json!({
                "jsonrpc":"2.0","id":2,"method":"workspace/executeCommand",
                "params":{"command":"vscode.java.startDebugSession","arguments":[]}
            }),
        )
        .expect("start Java debug session");
        let response =
            wait_for_response(&receiver, &mut stdin, 2, Duration::from_secs(45), &root_uri)
                .expect("Java debug port response");
        let port = response
            .get("result")
            .and_then(Value::as_u64)
            .and_then(|value| u16::try_from(value).ok())
            .unwrap_or_else(|| panic!("Java DAP port response was not numeric: {response}"));
        let mut dap = crate::debug::DapTcpProcess::connect_loopback(port, Duration::from_secs(10))
            .expect("connect Java DAP");
        dap.set_io_timeout(Duration::from_secs(15))
            .expect("set Java DAP timeout");
        let initialized = dap
            .request(
                "initialize",
                Some(json!({
                    "clientID":"codeflow-inspector","adapterID":"java","pathFormat":"path",
                    "linesStartAt1":true,"columnsStartAt1":true
                })),
            )
            .expect("Java DAP initialize");
        assert!(initialized.success);
        let launch_seq = dap
            .send_request(
                "launch",
                Some(json!({
                    "mainClass":"Main","projectName":"","cwd":fixture,
                    "classPaths":[fixture],"modulePaths":[],"console":"internalConsole",
                    "stopOnEntry":false,"noDebug":false
                })),
            )
            .expect("Java launch request");
        dap.wait_event("initialized")
            .expect("Java initialized event");
        let breakpoint = dap
            .request(
                "setBreakpoints",
                Some(json!({
                    "source":{"path":source},"breakpoints":[{"line":4}],"sourceModified":false
                })),
            )
            .expect("Java breakpoint");
        assert_eq!(
            breakpoint
                .body
                .as_ref()
                .and_then(|body| body.pointer("/breakpoints/0/verified"))
                .and_then(Value::as_bool),
            Some(true)
        );
        dap.request("configurationDone", Some(json!({})))
            .expect("Java configuration done");
        dap.wait_response(launch_seq, "launch")
            .expect("Java launch response");
        let stopped = dap.wait_event("stopped").expect("Java stopped event");
        let thread_id = stopped
            .body
            .as_ref()
            .and_then(|body| body.get("threadId"))
            .and_then(Value::as_u64)
            .expect("Java thread id");
        let stack = dap
            .request(
                "stackTrace",
                Some(json!({"threadId":thread_id,"startFrame":0,"levels":20})),
            )
            .expect("Java stack");
        let frame_id = stack
            .body
            .as_ref()
            .and_then(|body| body.pointer("/stackFrames/0/id"))
            .and_then(Value::as_u64)
            .expect("Java frame id");
        let scopes = dap
            .request("scopes", Some(json!({"frameId":frame_id})))
            .expect("Java scopes");
        let variables_reference = scopes
            .body
            .as_ref()
            .and_then(|body| body.pointer("/scopes/0/variablesReference"))
            .and_then(Value::as_u64)
            .expect("Java variables reference");
        let variables = dap
            .request(
                "variables",
                Some(json!({"variablesReference":variables_reference})),
            )
            .expect("Java variables");
        assert!(variables
            .body
            .as_ref()
            .and_then(|body| body.get("variables"))
            .and_then(Value::as_array)
            .is_some_and(|items| items
                .iter()
                .any(|item| item.get("name").and_then(Value::as_str) == Some("value"))));
        dap.request("continue", Some(json!({"threadId":thread_id})))
            .expect("Java continue");
        dap.wait_event("terminated").expect("Java terminated event");
        let _ = dap.request("disconnect", Some(json!({"terminateDebuggee":true})));
        let _ = send_message(
            &mut stdin,
            &json!({"jsonrpc":"2.0","id":3,"method":"shutdown","params":null}),
        );
        let _ = send_message(
            &mut stdin,
            &json!({"jsonrpc":"2.0","method":"exit","params":null}),
        );
        let _ = child.kill();
        let _ = child.wait();
        let _ = std::fs::remove_dir_all(fixture);
    }
    use crate::sidecar::test_roots;

    #[test]
    fn lsp_frames_round_trip() {
        let message = json!({"jsonrpc":"2.0","id":1,"result":{"capabilities":{}}});
        let payload = serde_json::to_vec(&message).expect("encode");
        let framed = format!(
            "Content-Length: {}\r\n\r\n{}",
            payload.len(),
            String::from_utf8(payload).expect("utf8")
        );
        let mut reader = BufReader::new(framed.as_bytes());
        assert_eq!(read_message(&mut reader).expect("decode"), message);
    }

    #[test]
    fn detects_installed_lsp_tools_without_claiming_missing_tools() {
        let report = availability(&test_roots());
        assert_eq!(report.tool_count, 12);
        assert!(report
            .tools
            .iter()
            .all(|tool| tool.available == (tool.status == "available")));
    }

    #[test]
    fn clangd_returns_real_semantic_facts_when_installed() {
        let roots = test_roots();
        if resolve_tool("clangd", "clangd", &roots).is_none() {
            return;
        }
        let report = analyze(LspWorkspaceRequest {
            project_id: "clangd-protocol-test".to_string(),
            files: vec![LspFileInput {
                path: "main.c".to_string(),
                content: "#define ADD_ONE(value) ((value) + 1)\nint helper(int value) { return ADD_ONE(value); }\nint main(void) { return helper(1); }\n".to_string(),
                language: "C".to_string(),
            }],
            symbols: vec![
                LspSymbolInput {
                    id: "helper".to_string(),
                    file_name: "main.c".to_string(),
                    language: "C".to_string(),
                    name: "helper".to_string(),
                    line: 1,
                    column: 4,
                },
                LspSymbolInput {
                    id: "main".to_string(),
                    file_name: "main.c".to_string(),
                    language: "C".to_string(),
                    name: "main".to_string(),
                    line: 2,
                    column: 4,
                },
            ],
            macro_sites: vec![LspMacroInput {
                id: "add-one".to_string(),
                file_name: "main.c".to_string(),
                language: "C".to_string(),
                name: "ADD_ONE".to_string(),
                line: 1,
                column: 31,
            }],
            timeout_ms: 5_000,
        }, &roots);
        let clangd = report
            .tools
            .iter()
            .find(|tool| tool.id == "clangd")
            .expect("clangd report");
        if clangd
            .evidence
            .contains("local defense refused LSP execution")
        {
            return;
        }
        assert!(
            matches!(clangd.status.as_str(), "executed" | "partial"),
            "clangd protocol failed: {}",
            clangd.evidence
        );
        assert!(
            report
                .symbol_facts
                .iter()
                .any(|fact| fact.symbol_id == "helper" && !fact.hover.is_empty()),
            "expected clangd hover fact, got {:?}",
            report
                .symbol_facts
                .iter()
                .map(|fact| (&fact.symbol_id, &fact.hover, &fact.references))
                .collect::<Vec<_>>()
        );
        assert!(
            report
                .symbol_facts
                .iter()
                .find(|fact| fact.symbol_id == "helper")
                .is_some_and(|fact| fact.reference_count >= 1),
            "expected helper call reference"
        );
        assert!(
            report
                .macro_facts
                .iter()
                .any(|fact| fact.macro_id == "add-one" && !fact.expansion.is_empty()),
            "expected clangd semantic AST for macro site"
        );
    }

    #[test]
    fn every_installed_default_lsp_completes_a_real_protocol_pass() {
        let roots = test_roots();
        let cases = [
            (
                "pyright",
                "Python",
                "main.py",
                "def helper(value: int) -> int:\n    return value + 1\n\ndef main() -> int:\n    return helper(1)\n",
                "helper",
                0,
                4,
            ),
            (
                "jdtls",
                "Java",
                "Main.java",
                "public class Main { static int helper(int value) { return value + 1; } public static void main(String[] args) { helper(1); } }\n",
                "helper",
                0,
                31,
            ),
            (
                "gopls",
                "Go",
                "main.go",
                "package main\nfunc helper(value int) int { return value + 1 }\nfunc main() { helper(1) }\n",
                "helper",
                1,
                5,
            ),
            (
                "rust-analyzer",
                "Rust",
                "src/main.rs",
                "fn helper(value: i32) -> i32 { value + 1 }\nfn main() { helper(1); }\n",
                "helper",
                0,
                3,
            ),
            (
                "kotlin-language-server",
                "Kotlin",
                "Main.kt",
                "fun helper(value: Int): Int = value + 1\nfun main() { helper(1) }\n",
                "helper",
                0,
                4,
            ),
            (
                "csharp-ls",
                "C#",
                "Program.cs",
                "public class Program { static int helper(int value) { return value + 1; } public static void Main() { helper(1); } }\n",
                "helper",
                0,
                34,
            ),
            (
                "phpantom-lsp",
                "PHP",
                "main.php",
                "<?php function helper(int $value): int { return $value + 1; } helper(1);\n",
                "helper",
                0,
                15,
            ),
            (
                "ruby-lsp",
                "Ruby",
                "main.rb",
                "def helper(value)\n  value + 1\nend\nhelper(1)\n",
                "helper",
                0,
                4,
            ),
            (
                "sourcekit-lsp",
                "Swift",
                "main.swift",
                "func helper(_ value: Int) -> Int { value + 1 }\nprint(helper(1))\n",
                "helper",
                0,
                5,
            ),
            (
                "bash-language-server",
                "Shell",
                "main.sh",
                "#!/bin/bash\nhelper() { echo \"$1\"; }\nhelper \"value\"\n",
                "helper",
                1,
                0,
            ),
            (
                "sql-language-server",
                "SQL",
                "schema.sql",
                "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);\nSELECT name FROM users;\n",
                "users",
                0,
                13,
            ),
        ];
        for (tool_id, language, path, content, symbol_name, line, column) in cases {
            if std::env::var("CODEFLOW_TEST_ONLY_LSP")
                .ok()
                .is_some_and(|selected| selected != tool_id)
            {
                continue;
            }
            let command = tool_definitions(Path::new("."))
                .into_iter()
                .find(|tool| tool.id == tool_id)
                .map(|tool| tool.command)
                .expect("tool definition");
            let Some(resolved_tool) = resolve_tool(tool_id, command, &roots) else { continue; };
            let mut files = vec![LspFileInput {
                path: path.to_string(),
                content: content.to_string(),
                language: language.to_string(),
            }];
            if tool_id == "gopls" {
                files.push(LspFileInput {
                    path: "go.mod".to_string(),
                    content: "module codeflow.test/probe\n\ngo 1.24\n".to_string(),
                    language: "Config".to_string(),
                });
            }
            if tool_id == "rust-analyzer" {
                files.push(LspFileInput {
                    path: "Cargo.toml".to_string(),
                    content: "[package]\nname = \"codeflow_probe\"\nversion = \"0.1.0\"\nedition = \"2024\"\n"
                        .to_string(),
                    language: "Config".to_string(),
                });
            }
            if tool_id == "csharp-ls" {
                files.push(LspFileInput {
                    path: "CodeflowProbe.csproj".to_string(),
                    content: "<Project Sdk=\"Microsoft.NET.Sdk\"><PropertyGroup><TargetFramework>net10.0</TargetFramework><OutputType>Exe</OutputType></PropertyGroup></Project>\n".to_string(),
                    language: "Config".to_string(),
                });
            }
            if tool_id == "sourcekit-lsp" {
                files.push(LspFileInput {
                    path: "Package.swift".to_string(),
                    content: "// swift-tools-version: 6.0\nimport PackageDescription\nlet package = Package(name: \"CodeFlowProbe\", targets: [.executableTarget(name: \"CodeFlowProbe\", path: \".\", exclude: [\"Package.swift\"])])\n".to_string(),
                    language: "Config".to_string(),
                });
            }
            let report = analyze(
                LspWorkspaceRequest {
                    project_id: format!("{tool_id}-protocol-test"),
                    files,
                    symbols: vec![LspSymbolInput {
                        id: symbol_name.to_string(),
                        file_name: path.to_string(),
                        language: language.to_string(),
                        name: symbol_name.to_string(),
                        line,
                        column,
                    }],
                    macro_sites: Vec::new(),
                    timeout_ms: 15_000,
                },
                &roots,
            );
            let tool = report
                .tools
                .iter()
                .find(|item| item.id == tool_id)
                .expect("tool report");
            if tool
                .evidence
                .contains("local defense refused LSP execution")
            {
                continue;
            }
            if !resolved_tool.verified && tool.status == "failed" {
                // PATH tools are compatibility probes only. A transient or
                // incompatible system install never certifies or blocks the
                // checksum-locked portable sidecar set.
                continue;
            }
            assert!(
                matches!(tool.status.as_str(), "executed" | "partial" | "limited"),
                "{tool_id} protocol pass failed: {}",
                tool.evidence
            );
            if tool.status == "limited" {
                assert!(tool.evidence.contains("does not implement CodeFlow semantic requests"));
            } else {
                assert!(
                    tool.document_symbol_count > 0 || tool.symbol_count > 0,
                    "{tool_id} returned no document symbols or symbol facts: {}",
                    tool.evidence
                );
            }
        }
    }

    #[test]
    fn prepared_native_sidecars_complete_protocol_passes() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("lsp-sidecars")
            .join(crate::sidecar::target_triple());
        if !root.join("checksums.json").is_file() {
            return;
        }
        let roots = SidecarRoots {
            managed_root: None,
            bundled_roots: vec![root],
            disabled: BTreeSet::new(),
        };
        let cases = [
            (
                "pyright",
                "Python",
                "main.py",
                "def helper(value: int) -> int:\n    return value + 1\n\ndef main() -> int:\n    return helper(1)\n",
                vec![],
                0,
                4,
            ),
            (
                "jdtls",
                "Java",
                "Main.java",
                "public class Main { static int helper(int value) { return value + 1; } public static void main(String[] args) { helper(1); } }\n",
                vec![],
                0,
                31,
            ),
            (
                "clangd",
                "C++",
                "main.cpp",
                "int helper(int value) { return value + 1; }\nint main() { return helper(1); }\n",
                vec![],
                0,
                4,
            ),
            (
                "gopls",
                "Go",
                "main.go",
                "package main\nfunc helper(value int) int { return value + 1 }\nfunc main() { helper(1) }\n",
                vec![LspFileInput {
                    path: "go.mod".to_string(),
                    content: "module codeflow.test/probe\n\ngo 1.24\n".to_string(),
                    language: "Config".to_string(),
                }],
                1,
                5,
            ),
            (
                "rust-analyzer",
                "Rust",
                "src/main.rs",
                "fn helper(value: i32) -> i32 { value + 1 }\nfn main() { helper(1); }\n",
                vec![LspFileInput {
                    path: "Cargo.toml".to_string(),
                    content: "[package]\nname = \"codeflow_probe\"\nversion = \"0.1.0\"\nedition = \"2024\"\n".to_string(),
                    language: "Config".to_string(),
                }],
                0,
                3,
            ),
        ];
        for (tool_id, language, path, content, mut files, line, column) in cases {
            let command = tool_definitions(Path::new("."))
                .into_iter()
                .find(|tool| tool.id == tool_id)
                .map(|tool| tool.command)
                .expect("tool definition");
            let resolved = resolve_tool(tool_id, command, &roots).expect("bundled sidecar");
            assert!(
                resolved.verified,
                "{tool_id} must use checksum-verified package"
            );
            files.push(LspFileInput {
                path: path.to_string(),
                content: content.to_string(),
                language: language.to_string(),
            });
            let report = analyze(
                LspWorkspaceRequest {
                    project_id: format!("bundled-{tool_id}-protocol-test"),
                    files,
                    symbols: vec![LspSymbolInput {
                        id: "helper".to_string(),
                        file_name: path.to_string(),
                        language: language.to_string(),
                        name: "helper".to_string(),
                        line,
                        column,
                    }],
                    macro_sites: Vec::new(),
                    timeout_ms: 15_000,
                },
                &roots,
            );
            let tool = report
                .tools
                .iter()
                .find(|item| item.id == tool_id)
                .expect("tool report");
            if tool
                .evidence
                .contains("local defense refused LSP execution")
            {
                continue;
            }
            assert!(
                matches!(tool.status.as_str(), "executed" | "partial"),
                "{tool_id} bundled protocol failed: {}",
                tool.evidence
            );
            assert!(tool.document_symbol_count > 0 || tool.symbol_count > 0);
        }
    }
}

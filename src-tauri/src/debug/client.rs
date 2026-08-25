use super::dap_protocol::{encode_message, DapDecoder, DapMessage, DapRequest, DapResponse};
use serde_json::Value;
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct DapProcessConfig {
    pub command: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub controlled_path: String,
}

pub struct DapProcess {
    child: Child,
    stdin: ChildStdin,
    messages: Receiver<Result<DapMessage, String>>,
    pending: VecDeque<DapMessage>,
    next_sequence: u64,
}

pub struct DapTcpProcess {
    child: Option<Child>,
    stream: TcpStream,
    port: u16,
    decoder: DapDecoder,
    pending: VecDeque<DapMessage>,
    next_sequence: u64,
}

impl DapProcess {
    pub fn spawn(config: &DapProcessConfig) -> Result<Self, String> {
        let mut child = Command::new(&config.command)
            .args(&config.args)
            .current_dir(&config.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .env_clear()
            .env("PATH", &config.controlled_path)
            .env("LANG", "C.UTF-8")
            .env("LC_ALL", "C.UTF-8")
            .env("HOME", &config.cwd)
            .env("TMPDIR", &config.cwd)
            .env("NO_PROXY", "*")
            .env("HTTP_PROXY", "http://127.0.0.1:9")
            .env("HTTPS_PROXY", "http://127.0.0.1:9")
            .spawn()
            .map_err(|error| format!("failed to start DAP adapter: {error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "DAP adapter stdin was unavailable".to_string())?;
        let mut stdout = child
            .stdout
            .take()
            .ok_or_else(|| "DAP adapter stdout was unavailable".to_string())?;
        let (sender, messages) = mpsc::channel();
        thread::spawn(move || {
            let mut decoder = DapDecoder::new();
            let mut chunk = [0_u8; 16 * 1024];
            loop {
                match stdout.read(&mut chunk) {
                    Ok(0) => {
                        let _ = sender.send(Err("DAP adapter closed its output".to_string()));
                        break;
                    }
                    Ok(count) => match decoder.push(&chunk[..count]) {
                        Ok(decoded) => {
                            for message in decoded {
                                if sender.send(Ok(message)).is_err() {
                                    return;
                                }
                            }
                        }
                        Err(error) => {
                            let _ = sender.send(Err(error.to_string()));
                            break;
                        }
                    },
                    Err(error) => {
                        let _ =
                            sender.send(Err(format!("failed to read DAP adapter output: {error}")));
                        break;
                    }
                }
            }
        });
        Ok(Self {
            child,
            stdin,
            messages,
            pending: VecDeque::new(),
            next_sequence: 1,
        })
    }

    pub fn request(
        &mut self,
        command: &str,
        arguments: Option<Value>,
        timeout: Duration,
    ) -> Result<DapResponse, String> {
        let request_sequence = self.send_request(command, arguments)?;
        self.wait_response(request_sequence, command, timeout)
    }

    pub fn send_request(&mut self, command: &str, arguments: Option<Value>) -> Result<u64, String> {
        let request_sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.saturating_add(1);
        let request = DapMessage::Request(DapRequest {
            seq: request_sequence,
            command: command.to_string(),
            arguments,
        });
        let frame = encode_message(&request).map_err(|error| error.to_string())?;
        self.stdin
            .write_all(&frame)
            .and_then(|_| self.stdin.flush())
            .map_err(|error| format!("failed to write DAP request {command}: {error}"))?;
        Ok(request_sequence)
    }

    pub fn wait_response(
        &mut self,
        request_sequence: u64,
        command: &str,
        timeout: Duration,
    ) -> Result<DapResponse, String> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(response) = self.take_response(request_sequence) {
                return validate_response(response, command);
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(format!("DAP request {command} timed out"));
            }
            match self.messages.recv_timeout(remaining) {
                Ok(Ok(message)) => self.pending.push_back(message),
                Ok(Err(error)) => return Err(error),
                Err(RecvTimeoutError::Timeout) => {
                    return Err(format!("DAP request {command} timed out"))
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Err("DAP adapter message channel closed".to_string())
                }
            }
        }
    }

    pub fn wait_event(
        &mut self,
        event_name: &str,
        timeout: Duration,
    ) -> Result<super::DapEvent, String> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(index) = self.pending.iter().position(
                |message| matches!(message, DapMessage::Event(event) if event.event == event_name),
            ) {
                if let Some(DapMessage::Event(event)) = self.pending.remove(index) {
                    return Ok(event);
                }
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(format!(
                    "DAP event {event_name} timed out; pending={:?}",
                    self.pending
                ));
            }
            match self.messages.recv_timeout(remaining) {
                Ok(Ok(message)) => self.pending.push_back(message),
                Ok(Err(error)) => return Err(error),
                Err(RecvTimeoutError::Timeout) => {
                    return Err(format!(
                        "DAP event {event_name} timed out; pending={:?}",
                        self.pending
                    ))
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Err("DAP adapter message channel closed".to_string())
                }
            }
        }
    }

    pub fn wait_event_any(
        &mut self,
        event_names: &[&str],
        timeout: Duration,
    ) -> Result<super::DapEvent, String> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(index) = self.pending.iter().position(|message| matches!(message, DapMessage::Event(event) if event_names.contains(&event.event.as_str()))) {
                if let Some(DapMessage::Event(event)) = self.pending.remove(index) { return Ok(event); }
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(format!("DAP events {event_names:?} timed out"));
            }
            match self.messages.recv_timeout(remaining) {
                Ok(Ok(message)) => self.pending.push_back(message),
                Ok(Err(error)) => return Err(error),
                Err(RecvTimeoutError::Timeout) => {
                    return Err(format!("DAP events {event_names:?} timed out"))
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Err("DAP adapter message channel closed".to_string())
                }
            }
        }
    }

    pub fn drain_events(&mut self) -> Vec<DapMessage> {
        while let Ok(message) = self.messages.try_recv() {
            match message {
                Ok(message) => self.pending.push_back(message),
                Err(error) => self.pending.push_back(DapMessage::Event(super::DapEvent {
                    seq: self.next_sequence,
                    event: "codeflowAdapterError".to_string(),
                    body: Some(Value::String(error)),
                    statistics: None,
                })),
            }
        }
        self.pending.drain(..).collect()
    }

    pub fn terminate(&mut self) -> Result<(), String> {
        match self.child.try_wait() {
            Ok(Some(_)) => Ok(()),
            Ok(None) => self
                .child
                .kill()
                .map_err(|error| format!("failed to terminate DAP adapter: {error}")),
            Err(error) => Err(format!("failed to inspect DAP adapter: {error}")),
        }
    }

    fn take_response(&mut self, request_sequence: u64) -> Option<DapResponse> {
        let index = self.pending.iter().position(|message| {
            matches!(message, DapMessage::Response(response) if response.request_seq == request_sequence)
        })?;
        match self.pending.remove(index) {
            Some(DapMessage::Response(response)) => Some(response),
            _ => None,
        }
    }
}

impl DapTcpProcess {
    pub fn spawn_loopback(config: &DapProcessConfig, timeout: Duration) -> Result<Self, String> {
        let mut child = Command::new(&config.command)
            .args(&config.args)
            .current_dir(&config.cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .env_clear()
            .env("PATH", &config.controlled_path)
            .env("LANG", "C.UTF-8")
            .env("HOME", &config.cwd)
            .env("NO_PROXY", "*")
            .spawn()
            .map_err(|error| format!("failed to start TCP DAP adapter: {error}"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "TCP DAP adapter stdout was unavailable".to_string())?;
        let mut reader = BufReader::new(stdout);
        let mut port_line = String::new();
        reader
            .read_line(&mut port_line)
            .map_err(|error| format!("failed to read TCP DAP port: {error}"))?;
        let port_text = port_line
            .trim()
            .rsplit_once(':')
            .map(|(_, port)| port)
            .unwrap_or(port_line.trim());
        let port = port_text
            .parse::<u16>()
            .map_err(|_| format!("TCP DAP adapter returned invalid port: {port_line:?}"))?;
        let address = SocketAddrV4::new(Ipv4Addr::LOCALHOST, port);
        let stream = TcpStream::connect_timeout(&address.into(), timeout)
            .map_err(|error| format!("failed to connect to loopback DAP adapter: {error}"))?;
        stream
            .set_read_timeout(Some(timeout))
            .map_err(|error| error.to_string())?;
        stream
            .set_write_timeout(Some(timeout))
            .map_err(|error| error.to_string())?;
        Ok(Self {
            child: Some(child),
            stream,
            port,
            decoder: DapDecoder::new(),
            pending: VecDeque::new(),
            next_sequence: 1,
        })
    }

    pub fn request(
        &mut self,
        command: &str,
        arguments: Option<Value>,
    ) -> Result<DapResponse, String> {
        let request_sequence = self.send_request(command, arguments)?;
        self.wait_response(request_sequence, command)
    }

    pub fn connect_loopback(port: u16, timeout: Duration) -> Result<Self, String> {
        let address = SocketAddrV4::new(Ipv4Addr::LOCALHOST, port);
        let stream = TcpStream::connect_timeout(&address.into(), timeout)
            .map_err(|error| format!("failed to connect to loopback DAP server: {error}"))?;
        stream
            .set_read_timeout(Some(timeout))
            .map_err(|error| error.to_string())?;
        stream
            .set_write_timeout(Some(timeout))
            .map_err(|error| error.to_string())?;
        Ok(Self {
            child: None,
            stream,
            port,
            decoder: DapDecoder::new(),
            pending: VecDeque::new(),
            next_sequence: 1,
        })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn set_io_timeout(&self, timeout: Duration) -> Result<(), String> {
        self.stream
            .set_read_timeout(Some(timeout))
            .and_then(|_| self.stream.set_write_timeout(Some(timeout)))
            .map_err(|error| format!("failed to set internal DAP IPC timeout: {error}"))
    }

    pub fn wait_request(&mut self, command: &str) -> Result<DapRequest, String> {
        let mut chunk = [0_u8; 16 * 1024];
        loop {
            if let Some(index) = self.pending.iter().position(|message| matches!(message, DapMessage::Request(request) if request.command == command)) {
                if let Some(DapMessage::Request(request)) = self.pending.remove(index) {
                    return Ok(request);
                }
            }
            let count = self.stream.read(&mut chunk).map_err(|error| {
                format!(
                    "failed to read internal DAP reverse request: {error}; pending={:?}",
                    self.pending
                )
            })?;
            if count == 0 {
                return Err("internal DAP adapter closed before reverse request".to_string());
            }
            self.pending.extend(
                self.decoder
                    .push(&chunk[..count])
                    .map_err(|error| error.to_string())?,
            );
        }
    }

    pub fn respond_to_request(
        &mut self,
        request: &DapRequest,
        success: bool,
        body: Option<Value>,
    ) -> Result<(), String> {
        let response_sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.saturating_add(1);
        let frame = encode_message(&DapMessage::Response(DapResponse {
            seq: response_sequence,
            request_seq: request.seq,
            success,
            command: request.command.clone(),
            message: None,
            body,
        }))
        .map_err(|error| error.to_string())?;
        self.stream
            .write_all(&frame)
            .and_then(|_| self.stream.flush())
            .map_err(|error| format!("failed to answer internal DAP reverse request: {error}"))
    }

    pub fn send_request(&mut self, command: &str, arguments: Option<Value>) -> Result<u64, String> {
        let request_sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.saturating_add(1);
        let frame = encode_message(&DapMessage::Request(DapRequest {
            seq: request_sequence,
            command: command.to_string(),
            arguments,
        }))
        .map_err(|error| error.to_string())?;
        self.stream
            .write_all(&frame)
            .and_then(|_| self.stream.flush())
            .map_err(|error| format!("failed to write loopback DAP request: {error}"))?;
        Ok(request_sequence)
    }

    pub fn wait_response(
        &mut self,
        request_sequence: u64,
        command: &str,
    ) -> Result<DapResponse, String> {
        let mut chunk = [0_u8; 16 * 1024];
        loop {
            if let Some(index) = self.pending.iter().position(|message| matches!(message, DapMessage::Response(response) if response.request_seq == request_sequence)) {
                if let Some(DapMessage::Response(response)) = self.pending.remove(index) {
                    return validate_response(response, command);
                }
            }
            let count = self
                .stream
                .read(&mut chunk)
                .map_err(|error| format!("failed to read loopback DAP response: {error}"))?;
            if count == 0 {
                return Err("loopback DAP adapter closed the connection".to_string());
            }
            self.pending.extend(
                self.decoder
                    .push(&chunk[..count])
                    .map_err(|error| error.to_string())?,
            );
        }
    }

    pub fn wait_event(&mut self, event_name: &str) -> Result<super::DapEvent, String> {
        let mut chunk = [0_u8; 16 * 1024];
        loop {
            if let Some(index) = self.pending.iter().position(
                |message| matches!(message, DapMessage::Event(event) if event.event == event_name),
            ) {
                if let Some(DapMessage::Event(event)) = self.pending.remove(index) {
                    return Ok(event);
                }
            }
            let count = self.stream.read(&mut chunk).map_err(|error| {
                format!(
                    "failed to read loopback DAP event: {error}; pending={:?}",
                    self.pending
                )
            })?;
            if count == 0 {
                return Err("loopback DAP server closed the connection".to_string());
            }
            self.pending.extend(
                self.decoder
                    .push(&chunk[..count])
                    .map_err(|error| error.to_string())?,
            );
        }
    }

    pub fn wait_event_any(&mut self, event_names: &[&str]) -> Result<super::DapEvent, String> {
        let mut chunk = [0_u8; 16 * 1024];
        loop {
            if let Some(index) = self.pending.iter().position(|message| matches!(message, DapMessage::Event(event) if event_names.contains(&event.event.as_str()))) {
                if let Some(DapMessage::Event(event)) = self.pending.remove(index) { return Ok(event); }
            }
            let count = self
                .stream
                .read(&mut chunk)
                .map_err(|error| format!("failed to read internal DAP event: {error}"))?;
            if count == 0 {
                return Err("internal DAP adapter closed the connection".to_string());
            }
            self.pending.extend(
                self.decoder
                    .push(&chunk[..count])
                    .map_err(|error| error.to_string())?,
            );
        }
    }
}

impl Drop for DapTcpProcess {
    fn drop(&mut self) {
        if let Some(child) = &mut self.child {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for DapProcess {
    fn drop(&mut self) {
        let _ = self.terminate();
        let _ = self.child.wait();
    }
}

fn validate_response(response: DapResponse, command: &str) -> Result<DapResponse, String> {
    if response.command != command {
        return Err(format!(
            "DAP response command mismatch: expected {command}, received {}",
            response.command
        ));
    }
    if response.success {
        Ok(response)
    } else {
        Err(response
            .message
            .unwrap_or_else(|| format!("DAP adapter rejected {command}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    fn python_311() -> PathBuf {
        let mut candidates = Vec::new();
        if let Ok(path) = std::env::var("CODEFLOW_PYTHON_PATH") {
            candidates.push(PathBuf::from(path));
        }
        if let Ok(home) = std::env::var("HOME") {
            candidates.push(PathBuf::from(home).join(".pyenv/shims/python3"));
        }
        candidates.push(PathBuf::from("python3.11"));
        candidates.push(PathBuf::from("python3"));

        candidates
            .into_iter()
            .find(|candidate| {
                Command::new(candidate)
                    .args([
                        "-c",
                        "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')",
                    ])
                    .output()
                    .is_ok_and(|output| {
                        output.status.success()
                            && String::from_utf8_lossy(&output.stdout).trim() == "3.11"
                    })
            })
            .expect("a Python 3.11 interpreter compatible with the locked debugpy wheel")
    }

    #[test]
    fn rejects_unsuccessful_adapter_responses() {
        let result = validate_response(
            DapResponse {
                seq: 2,
                request_seq: 1,
                success: false,
                command: "launch".to_string(),
                message: Some("invalid program".to_string()),
                body: None,
            },
            "launch",
        );
        assert_eq!(result.unwrap_err(), "invalid program");
    }

    #[test]
    fn rejects_response_for_a_different_command() {
        let result = validate_response(
            DapResponse {
                seq: 2,
                request_seq: 1,
                success: true,
                command: "attach".to_string(),
                message: None,
                body: None,
            },
            "launch",
        );
        assert!(result.unwrap_err().contains("command mismatch"));
    }

    #[test]
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    fn managed_debugpy_replays_breakpoint_stack_scope_and_variables() {
        let fixture = std::env::temp_dir().join(format!("codeflow-debugpy-{}", std::process::id()));
        std::fs::create_dir_all(&fixture).expect("fixture directory");
        let program = fixture.join("main.py");
        std::fs::write(&program, "value = 40\nvalue = value + 2\nprint(value)\n")
            .expect("fixture source");
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("debug-sidecars/aarch64-apple-darwin/debugpy");
        let python = python_311();
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("reserve debugpy port");
        let port = listener.local_addr().expect("debugpy address").port();
        drop(listener);
        let mut debuggee = Command::new(&python)
            .args([
                "-m",
                "debugpy",
                "--listen",
                &format!("127.0.0.1:{port}"),
                "--wait-for-client",
                program.to_str().expect("program path"),
            ])
            .current_dir(&fixture)
            .env("PYTHONPATH", root.join("runtime"))
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .expect("start debugpy debuggee");
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut process = loop {
            if let Ok(process) = DapTcpProcess::connect_loopback(port, Duration::from_millis(250)) {
                break process;
            }
            if let Some(status) = debuggee.try_wait().expect("inspect debuggee") {
                let mut stderr = String::new();
                if let Some(mut pipe) = debuggee.stderr.take() {
                    let _ = pipe.read_to_string(&mut stderr);
                }
                panic!("debugpy debuggee exited before DAP connection: {status}; {stderr}");
            }
            if Instant::now() >= deadline {
                panic!("debugpy DAP listener did not become ready");
            }
            thread::sleep(Duration::from_millis(100));
        };
        process
            .set_io_timeout(Duration::from_secs(10))
            .expect("set replay timeout");
        process
            .request(
                "initialize",
                Some(json!({
                    "clientID":"codeflow-inspector","adapterID":"debugpy","pathFormat":"path",
                    "linesStartAt1":true,"columnsStartAt1":true
                })),
            )
            .expect("initialize");
        let launch_seq = process.send_request("attach", Some(json!({
            "justMyCode":false, "request":"attach", "type":"debugpy", "name":"CodeFlow managed replay"
        }))).expect("attach request");
        process
            .wait_event("initialized")
            .expect("initialized event");
        let breakpoint = process
            .request(
                "setBreakpoints",
                Some(json!({
                    "source":{"path":program}, "breakpoints":[{"line":2}], "sourceModified":false
                })),
            )
            .expect("set breakpoint");
        assert_eq!(
            breakpoint
                .body
                .as_ref()
                .and_then(|body| body.pointer("/breakpoints/0/verified"))
                .and_then(Value::as_bool),
            Some(true),
            "debugpy rejected the source breakpoint: {:?}",
            breakpoint.body
        );
        process
            .request("configurationDone", Some(json!({})))
            .expect("configuration done");
        process
            .wait_response(launch_seq, "attach")
            .expect("attach response");
        let stopped = process.wait_event("stopped").expect("stopped event");
        let thread_id = stopped
            .body
            .as_ref()
            .and_then(|body| body.get("threadId"))
            .and_then(Value::as_u64)
            .expect("thread id");
        let threads = process.request("threads", None).expect("threads");
        assert!(threads
            .body
            .as_ref()
            .and_then(|body| body.get("threads"))
            .and_then(Value::as_array)
            .is_some_and(|items| !items.is_empty()));
        let stack = process
            .request(
                "stackTrace",
                Some(json!({"threadId":thread_id,"startFrame":0,"levels":20})),
            )
            .expect("stack trace");
        let frame_id = stack
            .body
            .as_ref()
            .and_then(|body| body.pointer("/stackFrames/0/id"))
            .and_then(Value::as_u64)
            .expect("frame id");
        let scopes = process
            .request("scopes", Some(json!({"frameId":frame_id})))
            .expect("scopes");
        let variables_reference = scopes
            .body
            .as_ref()
            .and_then(|body| body.pointer("/scopes/0/variablesReference"))
            .and_then(Value::as_u64)
            .expect("variables reference");
        let variables = process
            .request(
                "variables",
                Some(json!({"variablesReference":variables_reference})),
            )
            .expect("variables");
        assert!(variables
            .body
            .as_ref()
            .and_then(|body| body.get("variables"))
            .and_then(Value::as_array)
            .is_some_and(|items| items
                .iter()
                .any(|item| item.get("name").and_then(Value::as_str) == Some("value"))));
        process
            .request("continue", Some(json!({"threadId":thread_id})))
            .expect("continue");
        process.wait_event("terminated").expect("terminated event");
        let _ = process.request("disconnect", Some(json!({"terminateDebuggee":true})));
        let _ = debuggee.kill();
        let _ = debuggee.wait();
        let _ = std::fs::remove_dir_all(fixture);
    }

    #[test]
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    fn managed_lldb_completes_a_real_dap_initialize() {
        let command = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("debug-sidecars/aarch64-apple-darwin/lldb-dap/bin/lldb-dap");
        let mut process = DapProcess::spawn(&DapProcessConfig {
            command,
            args: vec![],
            cwd: std::env::temp_dir(),
            controlled_path: std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin".to_string()),
        })
        .expect("start managed lldb-dap adapter");
        let response = process
            .request(
                "initialize",
                Some(json!({
                    "clientID": "codeflow-inspector",
                    "adapterID": "lldb-dap",
                    "pathFormat": "path",
                    "linesStartAt1": true,
                    "columnsStartAt1": true
                })),
                Duration::from_secs(10),
            )
            .expect("lldb initialize response");
        assert!(response.success);
        let _ = process.request(
            "disconnect",
            Some(json!({ "terminateDebuggee": true })),
            Duration::from_secs(5),
        );
    }

    #[test]
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    fn managed_lldb_replays_compiled_breakpoint_stack_scope_and_variables() {
        let fixture = std::env::temp_dir().join(format!("codeflow-lldb-{}", std::process::id()));
        std::fs::create_dir_all(&fixture).expect("fixture directory");
        let source = fixture.join("main.c");
        let program = fixture.join("main");
        std::fs::write(&source, "#include <stdio.h>\nint main(void) {\n  int value = 40;\n  value += 2;\n  printf(\"%d\\n\", value);\n  return 0;\n}\n").expect("fixture source");
        let build = Command::new("/usr/bin/cc")
            .args([
                "-g",
                "-O0",
                source.to_str().expect("source path"),
                "-o",
                program.to_str().expect("program path"),
            ])
            .output()
            .expect("compile C fixture");
        assert!(
            build.status.success(),
            "C fixture failed to compile: {}",
            String::from_utf8_lossy(&build.stderr)
        );
        let command = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("debug-sidecars/aarch64-apple-darwin/lldb-dap/bin/lldb-dap");
        let mut process = DapProcess::spawn(&DapProcessConfig {
            command,
            args: vec![],
            cwd: fixture.clone(),
            controlled_path: std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin".to_string()),
        })
        .expect("start managed lldb-dap adapter");
        process
            .request(
                "initialize",
                Some(json!({
                    "clientID":"codeflow-inspector","adapterID":"lldb-dap","pathFormat":"path",
                    "linesStartAt1":true,"columnsStartAt1":true
                })),
                Duration::from_secs(10),
            )
            .expect("initialize");
        let launch_seq = process
            .send_request(
                "launch",
                Some(json!({
                    "program":program,"cwd":fixture,"args":[],"stopOnEntry":false
                })),
            )
            .expect("launch request");
        process
            .wait_event("initialized", Duration::from_secs(10))
            .expect("initialized event");
        let breakpoint = process
            .request(
                "setBreakpoints",
                Some(json!({
                    "source":{"path":source},"breakpoints":[{"line":4}],"sourceModified":false
                })),
                Duration::from_secs(10),
            )
            .expect("set breakpoint");
        let initially_verified = breakpoint
            .body
            .as_ref()
            .and_then(|body| body.pointer("/breakpoints/0/verified"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        process
            .request(
                "configurationDone",
                Some(json!({})),
                Duration::from_secs(10),
            )
            .expect("configuration done");
        process
            .wait_response(launch_seq, "launch", Duration::from_secs(10))
            .expect("launch response");
        let stopped = process
            .wait_event("stopped", Duration::from_secs(10))
            .expect("stopped event");
        if !initially_verified {
            assert_eq!(
                stopped
                    .body
                    .as_ref()
                    .and_then(|body| body.get("reason"))
                    .and_then(Value::as_str),
                Some("breakpoint"),
                "LLDB never resolved the pending source breakpoint"
            );
        }
        let thread_id = stopped
            .body
            .as_ref()
            .and_then(|body| body.get("threadId"))
            .and_then(Value::as_u64)
            .expect("thread id");
        let stack = process
            .request(
                "stackTrace",
                Some(json!({"threadId":thread_id,"startFrame":0,"levels":20})),
                Duration::from_secs(10),
            )
            .expect("stack trace");
        let frame_id = stack
            .body
            .as_ref()
            .and_then(|body| body.pointer("/stackFrames/0/id"))
            .and_then(Value::as_u64)
            .expect("frame id");
        let scopes = process
            .request(
                "scopes",
                Some(json!({"frameId":frame_id})),
                Duration::from_secs(10),
            )
            .expect("scopes");
        let variables_reference = scopes
            .body
            .as_ref()
            .and_then(|body| body.pointer("/scopes/0/variablesReference"))
            .and_then(Value::as_u64)
            .expect("variables reference");
        let variables = process
            .request(
                "variables",
                Some(json!({"variablesReference":variables_reference})),
                Duration::from_secs(10),
            )
            .expect("variables");
        assert!(variables
            .body
            .as_ref()
            .and_then(|body| body.get("variables"))
            .and_then(Value::as_array)
            .is_some_and(|items| items
                .iter()
                .any(|item| item.get("name").and_then(Value::as_str) == Some("value"))));
        process
            .request(
                "continue",
                Some(json!({"threadId":thread_id})),
                Duration::from_secs(10),
            )
            .expect("continue");
        process
            .wait_event("exited", Duration::from_secs(10))
            .expect("exited event");
        let _ = process.request(
            "disconnect",
            Some(json!({"terminateDebuggee":true})),
            Duration::from_secs(5),
        );
        let _ = std::fs::remove_dir_all(fixture);
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    fn replay_native_language(
        label: &str,
        source_name: &str,
        source_text: &str,
        compiler: &str,
        compiler_args: &[&str],
        breakpoint_line: usize,
    ) {
        let fixture = std::env::temp_dir().join(format!("codeflow-{label}-{}", std::process::id()));
        std::fs::create_dir_all(&fixture).expect("fixture directory");
        let source = fixture.join(source_name);
        let program = fixture.join("main");
        std::fs::write(&source, source_text).expect("fixture source");
        let mut command = Command::new(compiler);
        command.args(compiler_args).arg(&source);
        if label == "rust" {
            command.args(["-o", program.to_str().expect("program path")]);
        } else {
            command.args(["-o", program.to_str().expect("program path")]);
        }
        let build = command.output().expect("compile native fixture");
        assert!(
            build.status.success(),
            "{label} fixture failed to compile: {}",
            String::from_utf8_lossy(&build.stderr)
        );
        let adapter = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("debug-sidecars/aarch64-apple-darwin/lldb-dap/bin/lldb-dap");
        let mut dap = DapProcess::spawn(&DapProcessConfig {
            command: adapter,
            args: vec![],
            cwd: fixture.clone(),
            controlled_path: std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin".to_string()),
        })
        .expect("start managed lldb-dap");
        dap.request(
            "initialize",
            Some(json!({"clientID":"codeflow-inspector","adapterID":"lldb-dap","pathFormat":"path","linesStartAt1":true,"columnsStartAt1":true})),
            Duration::from_secs(10),
        )
        .expect("initialize");
        let launch = dap
            .send_request(
                "launch",
                Some(json!({"program":program,"cwd":fixture,"args":[],"stopOnEntry":false})),
            )
            .expect("launch");
        dap.wait_event("initialized", Duration::from_secs(10))
            .expect("initialized");
        let breakpoint = dap
            .request(
                "setBreakpoints",
                Some(json!({"source":{"path":source},"breakpoints":[{"line":breakpoint_line}]})),
                Duration::from_secs(10),
            )
            .expect("set breakpoint");
        let initially_verified = breakpoint
            .body
            .as_ref()
            .and_then(|body| body.pointer("/breakpoints/0/verified"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        dap.request(
            "configurationDone",
            Some(json!({})),
            Duration::from_secs(10),
        )
        .expect("configuration done");
        dap.wait_response(launch, "launch", Duration::from_secs(10))
            .expect("launch response");
        let stopped = dap
            .wait_event("stopped", Duration::from_secs(10))
            .expect("stopped");
        if !initially_verified {
            assert_eq!(
                stopped
                    .body
                    .as_ref()
                    .and_then(|body| body.get("reason"))
                    .and_then(Value::as_str),
                Some("breakpoint"),
                "{label} pending breakpoint never resolved"
            );
        }
        let thread_id = stopped
            .body
            .as_ref()
            .and_then(|body| body.get("threadId"))
            .and_then(Value::as_u64)
            .expect("thread id");
        let stack = dap
            .request(
                "stackTrace",
                Some(json!({"threadId":thread_id,"levels":20})),
                Duration::from_secs(10),
            )
            .expect("stack");
        let frame_id = stack
            .body
            .as_ref()
            .and_then(|body| body.pointer("/stackFrames/0/id"))
            .and_then(Value::as_u64)
            .expect("frame id");
        let scopes = dap
            .request(
                "scopes",
                Some(json!({"frameId":frame_id})),
                Duration::from_secs(10),
            )
            .expect("scopes");
        let reference = scopes
            .body
            .as_ref()
            .and_then(|body| body.pointer("/scopes/0/variablesReference"))
            .and_then(Value::as_u64)
            .expect("variables reference");
        let variables = dap
            .request(
                "variables",
                Some(json!({"variablesReference":reference})),
                Duration::from_secs(10),
            )
            .expect("variables");
        assert!(
            variables
                .body
                .as_ref()
                .and_then(|body| body.get("variables"))
                .and_then(Value::as_array)
                .is_some_and(|items| !items.is_empty()),
            "{label} returned no variables"
        );
        dap.request(
            "continue",
            Some(json!({"threadId":thread_id})),
            Duration::from_secs(10),
        )
        .expect("continue");
        dap.wait_event_any(&["exited", "terminated"], Duration::from_secs(10))
            .expect("target exit");
        let _ = dap.request(
            "disconnect",
            Some(json!({"terminateDebuggee":true})),
            Duration::from_secs(5),
        );
        let _ = std::fs::remove_dir_all(fixture);
    }

    #[test]
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    fn managed_lldb_replays_rust_and_cpp_language_targets() {
        replay_native_language(
            "rust",
            "main.rs",
            "fn main() {\n  let mut value: i32 = 40;\n  value += 2;\n  println!(\"{}\", value);\n}\n",
            "/opt/homebrew/bin/rustc",
            &["-g", "-C", "opt-level=0"],
            3,
        );
        replay_native_language(
            "cpp",
            "main.cpp",
            "#include <iostream>\nint main() {\n  int value = 40;\n  value += 2;\n  std::cout << value << \"\\n\";\n  return 0;\n}\n",
            "/usr/bin/c++",
            &["-g", "-O0", "-std=c++17"],
            4,
        );
    }

    #[test]
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    fn managed_node_completes_a_real_loopback_dap_initialize() {
        let command = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("debug-sidecars/aarch64-apple-darwin/vscode-js-debug/bin/vscode-js-debug");
        let mut process = DapTcpProcess::spawn_loopback(
            &DapProcessConfig {
                command,
                args: vec!["0".to_string(), "127.0.0.1".to_string()],
                cwd: std::env::temp_dir(),
                controlled_path: std::env::var("PATH")
                    .unwrap_or_else(|_| "/usr/bin:/bin".to_string()),
            },
            Duration::from_secs(10),
        )
        .expect("start managed node DAP server");
        let response = process
            .request(
                "initialize",
                Some(json!({
                    "clientID": "codeflow-inspector",
                    "adapterID": "pwa-node",
                    "pathFormat": "path",
                    "linesStartAt1": true,
                    "columnsStartAt1": true
                })),
            )
            .expect("node initialize response");
        assert!(response.success);
        let _ = process.request("disconnect", Some(json!({ "terminateDebuggee": true })));
    }

    #[test]
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    fn managed_node_replays_breakpoint_stack_scope_and_variables() {
        let fixture = std::env::temp_dir().join(format!("codeflow-node-{}", std::process::id()));
        std::fs::create_dir_all(&fixture).expect("fixture directory");
        let program = fixture.join("main.js");
        std::fs::write(
            &program,
            "const value = 40;\nconst result = value + 2;\nconsole.log(result);\n",
        )
        .expect("fixture source");
        let command = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("debug-sidecars/aarch64-apple-darwin/vscode-js-debug/bin/vscode-js-debug");
        let mut process = DapTcpProcess::spawn_loopback(
            &DapProcessConfig {
                command,
                args: vec!["0".to_string(), "127.0.0.1".to_string()],
                cwd: fixture.clone(),
                controlled_path: std::env::var("PATH")
                    .unwrap_or_else(|_| "/usr/bin:/bin".to_string()),
            },
            Duration::from_secs(10),
        )
        .expect("start managed Node DAP server");
        process
            .set_io_timeout(Duration::from_secs(15))
            .expect("set replay timeout");
        process
            .request(
                "initialize",
                Some(json!({
                    "clientID":"codeflow-inspector","adapterID":"pwa-node","pathFormat":"path",
                    "linesStartAt1":true,"columnsStartAt1":true,"supportsVariableType":true
                })),
            )
            .expect("initialize");
        let launch_seq = process.send_request("launch", Some(json!({
            "type":"pwa-node","request":"launch","name":"CodeFlow managed replay",
            "program":program,"cwd":fixture,"console":"internalConsole","skipFiles":["<node_internals>/**"],
            "autoAttachChildProcesses":false
        }))).expect("launch request");
        process
            .wait_event("initialized")
            .expect("initialized event");
        process
            .request("configurationDone", Some(json!({})))
            .expect("configuration done");
        process
            .wait_response(launch_seq, "launch")
            .expect("launch response");
        let reverse = process
            .wait_request("startDebugging")
            .expect("target session request");
        let mut target_configuration = reverse
            .arguments
            .as_ref()
            .and_then(|arguments| arguments.get("configuration"))
            .cloned()
            .expect("target configuration");
        target_configuration
            .as_object_mut()
            .expect("target configuration object")
            .insert("request".to_string(), Value::String("launch".to_string()));
        let mut target = DapTcpProcess::connect_loopback(process.port(), Duration::from_secs(10))
            .expect("connect target DAP session");
        target
            .set_io_timeout(Duration::from_secs(15))
            .expect("set target timeout");
        target
            .request(
                "initialize",
                Some(json!({
                    "clientID":"codeflow-inspector","adapterID":"pwa-node","pathFormat":"path",
                    "linesStartAt1":true,"columnsStartAt1":true,"supportsVariableType":true
                })),
            )
            .expect("target initialize");
        let target_launch_seq = target
            .send_request("launch", Some(target_configuration))
            .expect("target launch request");
        target
            .wait_event("initialized")
            .expect("target initialized event");
        let breakpoint = target
            .request(
                "setBreakpoints",
                Some(json!({
                    "source":{"path":program},"breakpoints":[{"line":2}],"sourceModified":false
                })),
            )
            .expect("set target breakpoint");
        let initially_verified = breakpoint
            .body
            .as_ref()
            .and_then(|body| body.pointer("/breakpoints/0/verified"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        process
            .respond_to_request(&reverse, true, None)
            .expect("acknowledge target session");
        target
            .request("configurationDone", Some(json!({})))
            .expect("target configuration done");
        target
            .wait_response(target_launch_seq, "launch")
            .expect("target launch response");
        let stopped = target.wait_event("stopped").expect("stopped event");
        if !initially_verified {
            assert_eq!(
                stopped
                    .body
                    .as_ref()
                    .and_then(|body| body.get("reason"))
                    .and_then(Value::as_str),
                Some("breakpoint")
            );
        }
        let thread_id = stopped
            .body
            .as_ref()
            .and_then(|body| body.get("threadId"))
            .and_then(Value::as_u64)
            .expect("thread id");
        let stack = target
            .request(
                "stackTrace",
                Some(json!({"threadId":thread_id,"startFrame":0,"levels":20})),
            )
            .expect("stack trace");
        let frame_id = stack
            .body
            .as_ref()
            .and_then(|body| body.pointer("/stackFrames/0/id"))
            .and_then(Value::as_u64)
            .expect("frame id");
        let scopes = target
            .request("scopes", Some(json!({"frameId":frame_id})))
            .expect("scopes");
        let variables_reference = scopes
            .body
            .as_ref()
            .and_then(|body| body.pointer("/scopes/0/variablesReference"))
            .and_then(Value::as_u64)
            .expect("variables reference");
        let variables = target
            .request(
                "variables",
                Some(json!({"variablesReference":variables_reference})),
            )
            .expect("variables");
        assert!(variables
            .body
            .as_ref()
            .and_then(|body| body.get("variables"))
            .and_then(Value::as_array)
            .is_some_and(|items| items
                .iter()
                .any(|item| item.get("name").and_then(Value::as_str) == Some("value"))));
        target
            .request("continue", Some(json!({"threadId":thread_id})))
            .expect("continue");
        target.wait_event("terminated").expect("terminated event");
        let _ = target.request("disconnect", Some(json!({"terminateDebuggee":true})));
        let _ = process.request("disconnect", Some(json!({"terminateDebuggee":true})));
        let _ = std::fs::remove_dir_all(fixture);
    }
}

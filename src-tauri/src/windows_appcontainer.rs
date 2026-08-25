use serde::{Deserialize, Serialize};
use std::ffi::OsStr;
use std::fs;
use std::mem::{size_of, zeroed};
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, LocalFree, WAIT_FAILED};
use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
use windows_sys::Win32::Security::Isolation::{
    CreateAppContainerProfile, DeriveAppContainerSidFromAppContainerName,
};
use windows_sys::Win32::Security::{FreeSid, PSID, SECURITY_CAPABILITIES};
use windows_sys::Win32::System::Console::{
    GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE,
};
use windows_sys::Win32::System::Threading::{
    CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess,
    InitializeProcThreadAttributeList, UpdateProcThreadAttribute, WaitForSingleObject,
    EXTENDED_STARTUPINFO_PRESENT, INFINITE, PROCESS_INFORMATION,
    PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, STARTF_USESTDHANDLES, STARTUPINFOEXW,
};

const HELPER_FLAG: &str = "--codeflow-appcontainer-run";
const SELF_TEST_FLAG: &str = "--codeflow-appcontainer-self-test";
const NETWORK_PROBE_FLAG: &str = "--codeflow-appcontainer-network-probe";
const PROFILE_NAME: &str = "CodeFlowInspector.ControlledRuntime";

#[derive(Debug, Serialize, Deserialize)]
struct LaunchPayload {
    command: String,
    args: Vec<String>,
    cwd: PathBuf,
}

pub fn prepare_launch(
    command: &str,
    args: &[String],
    cwd: &Path,
    controlled_path: &str,
) -> Result<(String, Vec<String>), String> {
    let sid = ensure_profile()?;
    grant_project_access(cwd, &sid)?;
    let payload_path = cwd.join(".codeflow-appcontainer-launch.json");
    let (command, args) = resolve_command(command, args, cwd, controlled_path)?;
    let payload = LaunchPayload {
        command,
        args,
        cwd: cwd.to_path_buf(),
    };
    fs::write(
        &payload_path,
        serde_json::to_vec(&payload)
            .map_err(|error| format!("failed to serialize AppContainer launch: {error}"))?,
    )
    .map_err(|error| format!("failed to write AppContainer launch payload: {error}"))?;
    let helper = std::env::current_exe()
        .map_err(|error| format!("failed to locate desktop executable: {error}"))?;
    Ok((
        helper.to_string_lossy().to_string(),
        vec![
            HELPER_FLAG.to_string(),
            payload_path.to_string_lossy().to_string(),
        ],
    ))
}

fn resolve_command(
    command: &str,
    args: &[String],
    cwd: &Path,
    controlled_path: &str,
) -> Result<(String, Vec<String>), String> {
    let allowed_directories =
        std::env::split_paths(OsStr::new(controlled_path)).collect::<Vec<_>>();
    let path = Path::new(command);
    let resolved = if path.components().count() > 1 {
        path.to_path_buf()
    } else {
        let output = Command::new("where.exe")
            .arg(command)
            .stdin(Stdio::null())
            .output()
            .map_err(|error| format!("failed to resolve controlled command {command}: {error}"))?;
        if !output.status.success() {
            return Err(format!("controlled command {command} is not installed"));
        }
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .filter(|candidate| !candidate.is_empty())
            .map(PathBuf::from)
            .find(|candidate| {
                candidate.is_file()
                    && candidate.parent().is_some_and(|parent| {
                        allowed_directories
                            .iter()
                            .any(|allowed| parent == allowed || parent.starts_with(allowed))
                    })
            })
            .ok_or_else(|| format!("controlled command {command} has no executable path"))?
    };
    if !resolved.is_file() {
        return Err(format!(
            "controlled command {} is not a file",
            resolved.display()
        ));
    }
    let resolved = fs::canonicalize(&resolved).unwrap_or(resolved);
    let allowed = resolved.starts_with(cwd)
        || resolved.parent().is_some_and(|parent| {
            allowed_directories
                .iter()
                .any(|directory| parent == directory || parent.starts_with(directory))
        });
    if !allowed {
        return Err(format!(
            "controlled command {} is outside the runtime allowlist",
            resolved.display()
        ));
    }
    let is_batch = resolved
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| {
            value.eq_ignore_ascii_case("cmd") || value.eq_ignore_ascii_case("bat")
        });
    if is_batch {
        let mut wrapped = vec!["/D".to_string(), "/S".to_string(), "/C".to_string()];
        wrapped.push(resolved.to_string_lossy().to_string());
        wrapped.extend(args.iter().cloned());
        Ok((r"C:\Windows\System32\cmd.exe".to_string(), wrapped))
    } else {
        Ok((resolved.to_string_lossy().to_string(), args.to_vec()))
    }
}

pub fn helper_exit_code() -> Option<i32> {
    let mut args = std::env::args_os();
    let _executable = args.next();
    let mode = args.next()?;
    if mode == OsStr::new(NETWORK_PROBE_FLAG) {
        return Some(
            match std::net::TcpStream::connect_timeout(
                &"1.1.1.1:80".parse().expect("fixed probe address"),
                Duration::from_secs(2),
            ) {
                Ok(_) => 42,
                Err(_) => 0,
            },
        );
    }
    let result = if mode == OsStr::new(SELF_TEST_FLAG) {
        appcontainer_self_test()
    } else if mode == OsStr::new(HELPER_FLAG) {
        args.next()
            .ok_or_else(|| "missing AppContainer launch payload".to_string())
            .and_then(|path| run_payload(Path::new(&path)))
    } else {
        return None;
    };
    Some(match result {
        Ok(code) => code,
        Err(error) => {
            eprintln!("CodeFlow Windows sandbox refused launch: {error}");
            126
        }
    })
}

fn appcontainer_self_test() -> Result<i32, String> {
    let root = std::env::temp_dir().join(format!(
        "codeflow-appcontainer-certification-{}",
        std::process::id()
    ));
    fs::create_dir_all(&root)
        .map_err(|error| format!("failed to create AppContainer self-test copy: {error}"))?;
    let source = std::env::current_exe()
        .map_err(|error| format!("failed to locate self-test executable: {error}"))?;
    let target = root.join("codeflow-network-probe.exe");
    fs::copy(&source, &target)
        .map_err(|error| format!("failed to stage AppContainer network probe: {error}"))?;
    let sid = ensure_profile()?;
    grant_project_access(&root, &sid)?;
    let result = create_appcontainer_process(
        &LaunchPayload {
            command: target.to_string_lossy().to_string(),
            args: vec![NETWORK_PROBE_FLAG.to_string()],
            cwd: root.clone(),
        },
        sid.raw(),
    );
    let _ = fs::remove_dir_all(root);
    match result? {
        0 => Ok(0),
        42 => Err("AppContainer network probe reached an external address".to_string()),
        code => Err(format!("AppContainer network probe exited with {code}")),
    }
}

fn run_payload(path: &Path) -> Result<i32, String> {
    let payload: LaunchPayload = serde_json::from_slice(
        &fs::read(path).map_err(|error| format!("failed to read launch payload: {error}"))?,
    )
    .map_err(|error| format!("invalid launch payload: {error}"))?;
    let sid = ensure_profile()?;
    create_appcontainer_process(&payload, sid.raw())
}

struct OwnedSid(PSID);

impl OwnedSid {
    fn raw(&self) -> PSID {
        self.0
    }
}

impl Drop for OwnedSid {
    fn drop(&mut self) {
        unsafe {
            FreeSid(self.0);
        }
    }
}

fn ensure_profile() -> Result<OwnedSid, String> {
    let name = wide(PROFILE_NAME);
    let display = wide("CodeFlow controlled runtime");
    let description = wide("Network-isolated local code analysis runtime");
    let mut sid: PSID = std::ptr::null_mut();
    let created = unsafe {
        CreateAppContainerProfile(
            name.as_ptr(),
            display.as_ptr(),
            description.as_ptr(),
            std::ptr::null(),
            0,
            &mut sid,
        )
    };
    if created >= 0 && !sid.is_null() {
        return Ok(OwnedSid(sid));
    }
    sid = std::ptr::null_mut();
    let derived = unsafe { DeriveAppContainerSidFromAppContainerName(name.as_ptr(), &mut sid) };
    if derived < 0 || sid.is_null() {
        return Err(format!(
            "unable to create or derive the CodeFlow AppContainer profile (HRESULT 0x{:08X})",
            derived as u32
        ));
    }
    Ok(OwnedSid(sid))
}

fn grant_project_access(root: &Path, sid: &OwnedSid) -> Result<(), String> {
    let sid_text = sid_string(sid.raw())?;
    let grant = format!("*{sid_text}:(OI)(CI)F");
    let status = Command::new("icacls.exe")
        .arg(root)
        .args(["/grant:r", &grant, "/T", "/C", "/Q"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| format!("failed to start icacls for the temporary copy: {error}"))?;
    if !status.success() {
        return Err(format!(
            "icacls could not grant AppContainer access to the temporary copy ({status})"
        ));
    }
    Ok(())
}

fn sid_string(sid: PSID) -> Result<String, String> {
    let mut text = std::ptr::null_mut();
    if unsafe { ConvertSidToStringSidW(sid, &mut text) } == 0 || text.is_null() {
        return Err(format!(
            "failed to render AppContainer SID (Win32 {})",
            unsafe { GetLastError() }
        ));
    }
    let length = unsafe {
        let mut length = 0;
        while *text.add(length) != 0 {
            length += 1;
        }
        length
    };
    let value = String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(text, length) });
    unsafe {
        LocalFree(text as _);
    }
    Ok(value)
}

fn create_appcontainer_process(payload: &LaunchPayload, sid: PSID) -> Result<i32, String> {
    unsafe {
        let mut attribute_bytes = 0usize;
        InitializeProcThreadAttributeList(std::ptr::null_mut(), 1, 0, &mut attribute_bytes);
        if attribute_bytes == 0 {
            return Err(format!(
                "failed to size process attribute list (Win32 {})",
                GetLastError()
            ));
        }
        let mut storage = vec![0u8; attribute_bytes];
        let attribute_list = storage.as_mut_ptr() as _;
        if InitializeProcThreadAttributeList(attribute_list, 1, 0, &mut attribute_bytes) == 0 {
            return Err(format!(
                "failed to initialize process attributes (Win32 {})",
                GetLastError()
            ));
        }
        let security = SECURITY_CAPABILITIES {
            AppContainerSid: sid,
            Capabilities: std::ptr::null_mut(),
            CapabilityCount: 0,
            Reserved: 0,
        };
        if UpdateProcThreadAttribute(
            attribute_list,
            0,
            PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES as usize,
            &security as *const _ as _,
            size_of::<SECURITY_CAPABILITIES>(),
            std::ptr::null_mut(),
            std::ptr::null(),
        ) == 0
        {
            DeleteProcThreadAttributeList(attribute_list);
            return Err(format!(
                "failed to apply AppContainer security capabilities (Win32 {})",
                GetLastError()
            ));
        }
        let mut startup: STARTUPINFOEXW = zeroed();
        startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
        startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        startup.StartupInfo.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
        startup.StartupInfo.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
        startup.StartupInfo.hStdError = GetStdHandle(STD_ERROR_HANDLE);
        startup.lpAttributeList = attribute_list;

        let mut command_line = wide(&windows_command_line(&payload.command, &payload.args));
        let cwd = wide(&payload.cwd.to_string_lossy());
        let mut process: PROCESS_INFORMATION = zeroed();
        let created = CreateProcessW(
            std::ptr::null(),
            command_line.as_mut_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
            EXTENDED_STARTUPINFO_PRESENT,
            std::ptr::null(),
            cwd.as_ptr(),
            &startup.StartupInfo,
            &mut process,
        );
        DeleteProcThreadAttributeList(attribute_list);
        if created == 0 {
            return Err(format!(
                "CreateProcessW rejected the AppContainer target (Win32 {})",
                GetLastError()
            ));
        }
        CloseHandle(process.hThread);
        let wait = WaitForSingleObject(process.hProcess, INFINITE);
        if wait == WAIT_FAILED {
            let error = GetLastError();
            CloseHandle(process.hProcess);
            return Err(format!("failed waiting for sandbox target (Win32 {error})"));
        }
        let mut exit_code = 126u32;
        if GetExitCodeProcess(process.hProcess, &mut exit_code) == 0 {
            let error = GetLastError();
            CloseHandle(process.hProcess);
            return Err(format!(
                "failed reading sandbox target exit code (Win32 {error})"
            ));
        }
        CloseHandle(process.hProcess);
        Ok(exit_code as i32)
    }
}

fn windows_command_line(command: &str, args: &[String]) -> String {
    std::iter::once(command)
        .chain(args.iter().map(String::as_str))
        .map(quote_windows_argument)
        .collect::<Vec<_>>()
        .join(" ")
}

fn quote_windows_argument(value: &str) -> String {
    if !value.is_empty()
        && !value
            .chars()
            .any(|character| character.is_whitespace() || character == '"')
    {
        return value.to_string();
    }
    let mut result = String::from("\"");
    let mut slashes = 0usize;
    for character in value.chars() {
        if character == '\\' {
            slashes += 1;
        } else if character == '"' {
            result.push_str(&"\\".repeat(slashes.saturating_mul(2).saturating_add(1)));
            result.push('"');
            slashes = 0;
        } else {
            result.push_str(&"\\".repeat(slashes));
            slashes = 0;
            result.push(character);
        }
    }
    result.push_str(&"\\".repeat(slashes.saturating_mul(2)));
    result.push('"');
    result
}

fn wide(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(Some(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_arguments_preserve_spaces_quotes_and_trailing_slashes() {
        assert_eq!(quote_windows_argument("plain"), "plain");
        assert_eq!(quote_windows_argument("two words"), "\"two words\"");
        assert_eq!(quote_windows_argument("a\\\"b"), "\"a\\\\\\\"b\"");
        assert_eq!(
            quote_windows_argument("C:\\temp path\\"),
            "\"C:\\temp path\\\\\""
        );
    }
}

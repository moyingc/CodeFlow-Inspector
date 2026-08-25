fn main() {
    #[cfg(target_os = "macos")]
    std::panic::set_hook(Box::new(|info| {
        use std::io::Write;
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(std::env::temp_dir().join("codeflow-startup-panic.log"))
        {
            let _ = writeln!(file, "{info}\n{:?}", std::backtrace::Backtrace::force_capture());
        }
    }));

    #[cfg(target_os = "windows")]
    if let Some(exit_code) = codeflow_inspector_lib::windows_appcontainer_helper_exit_code() {
        std::process::exit(exit_code);
    }
    codeflow_inspector_lib::run();
}

use std::fs;
use std::sync::Mutex;

#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
use tauri::Emitter;
use tauri::Manager;

#[derive(Default)]
struct OpenedFiles(Mutex<Vec<String>>);

#[tauri::command]
fn platform_ping() -> &'static str {
    "ori-studio"
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(path, contents).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_binary_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    fs::write(path, bytes).map_err(|error| error.to_string())
}

#[tauri::command]
fn take_opened_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let state = app.state::<OpenedFiles>();
    let mut opened_files = state
        .0
        .lock()
        .map_err(|_| "opened files state is unavailable".to_string())?;
    Ok(opened_files.drain(..).collect())
}

#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android", test))]
fn opened_osf_paths(urls: Vec<tauri::Url>) -> Vec<String> {
    urls.into_iter()
        .filter_map(|url| url.to_file_path().ok())
        .filter(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("osf"))
        })
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
fn handle_opened_event(app: &tauri::AppHandle, event: tauri::RunEvent) {
    if let tauri::RunEvent::Opened { urls } = event {
        let paths = opened_osf_paths(urls);
        if paths.is_empty() {
            return;
        }
        if let Ok(mut opened_files) = app.state::<OpenedFiles>().0.lock() {
            opened_files.extend(paths.clone());
        }
        let _ = app.emit("opened-files", paths);
    }
}

#[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
fn handle_opened_event(_app: &tauri::AppHandle, _event: tauri::RunEvent) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(OpenedFiles::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            platform_ping,
            read_text_file,
            read_binary_file,
            write_text_file,
            write_binary_file,
            take_opened_files
        ])
        .build(tauri::generate_context!())
        .expect("error while building Ori Studio")
        .run(handle_opened_event);
}

#[cfg(test)]
mod tests {
    use super::opened_osf_paths;

    #[test]
    fn filters_opened_urls_to_osf_file_paths() {
        let osf = tauri::Url::from_file_path("/tmp/design.osf").expect("osf url");
        let upper = tauri::Url::from_file_path("/tmp/upper.OSF").expect("upper osf url");
        let fold = tauri::Url::from_file_path("/tmp/design.fold").expect("fold url");
        let web = tauri::Url::parse("https://example.com/design.osf").expect("web url");

        let paths = opened_osf_paths(vec![osf, upper, fold, web]);

        assert_eq!(paths, vec!["/tmp/design.osf", "/tmp/upper.OSF"]);
    }
}

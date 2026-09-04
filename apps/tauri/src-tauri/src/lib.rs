use std::fs;
use std::sync::Mutex;

// Used by the macOS/mobile `RunEvent::Opened` path and by the argv path that
// serves Windows and Linux, so every target we build reaches one of them.
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_window_state::StateFlags;

#[cfg(any(
    not(any(target_os = "macos", target_os = "ios", target_os = "android")),
    test
))]
use std::path::{Path, PathBuf};

mod cp_detect;
mod cp_engine;
mod updater;

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

/// The `.osf` paths in a process argument list, resolved against `cwd`.
///
/// Only macOS and mobile deliver a double-clicked document through
/// `RunEvent::Opened`. Windows and Linux pass it as a command-line argument
/// instead — to the first launch through `std::env::args`, and to a launch that
/// finds the app already running through the single-instance plugin's callback.
/// Without this the `.osf` association registered by the bundler is inert on
/// both platforms: the app starts, and opens nothing.
///
/// `args` must already have the executable path removed.
#[cfg(any(
    not(any(target_os = "macos", target_os = "ios", target_os = "android")),
    test
))]
fn argv_osf_paths<I, S>(args: I, cwd: &Path) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter()
        // A leading dash is a switch, not a document. Both Tauri and the webview
        // accept command-line flags, so `--enable-something.osf` must not open a
        // file that does not exist.
        .filter(|arg| !arg.as_ref().starts_with('-'))
        .map(|arg| {
            let path = PathBuf::from(arg.as_ref());
            if path.is_absolute() {
                path
            } else {
                // A file manager passes an absolute path, but a shell launch from
                // the document's own directory does not, and the single-instance
                // callback reports the *second* process's cwd for exactly this.
                cwd.join(path)
            }
        })
        .filter(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("osf"))
        })
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

/// Records `.osf` paths for the frontend and tells it they arrived.
///
/// Both halves are required: `take_opened_files` drains this state on mount, for
/// paths that arrived before the webview existed, and the event covers the
/// already-running case. The frontend hook listens for one and polls the other.
#[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
fn queue_opened_files(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    if let Ok(mut opened_files) = app.state::<OpenedFiles>().0.lock() {
        opened_files.extend(paths.clone());
    }
    let _ = app.emit("opened-files", paths);
}

/// The size to correct a restored window to, or `None` if it needs no correcting.
///
/// `tauri-plugin-window-state` persists a **physical** size and replays it with
/// `set_size`, which does not consult the window's configured minimum — so the
/// constraint that stops a user dragging the window too small does nothing to
/// stop the plugin reopening it too small.
///
/// The reachable case is a scale-factor change rather than a stale state file: a
/// size saved on a 1x display reopens at half the logical size on a 2x one, so
/// docking and undocking a laptop is enough to produce it. Verified by seeding a
/// 400x300 state file, which reopened at 200x150 against a 900x640 minimum.
fn clamped_to_min(
    restored: (f64, f64),
    min_width: Option<f64>,
    min_height: Option<f64>,
) -> Option<(f64, f64)> {
    let min_width = min_width.unwrap_or(0.0);
    let min_height = min_height.unwrap_or(0.0);
    if restored.0 >= min_width && restored.1 >= min_height {
        return None;
    }
    Some((restored.0.max(min_width), restored.1.max(min_height)))
}

/// Puts a window back to at least its configured minimum after something resizes
/// it below one.
///
/// Driven by `Resized` rather than run once after startup, because the size the
/// state plugin restores is not readable when it is applied: `set_size` reaches
/// the platform window asynchronously, so an immediate `inner_size()` — whether
/// from the app's `setup` hook or from a plugin hook ordered behind the
/// restore — still answers with the *pre*-restore size, finds nothing to correct,
/// and the window shrinks a moment later. The event carries the new size
/// directly, so it cannot be read too early.
///
/// This does not fight the user: the platform enforces the minimum during a
/// drag-resize, so a sub-minimum `Resized` only ever comes from a programmatic
/// `set_size`. Correcting one emits a further `Resized` at the corrected size,
/// which passes the check and stops.
fn clamp_window_to_min<R: tauri::Runtime>(
    window: &tauri::Window<R>,
    size: tauri::PhysicalSize<u32>,
) {
    let (min_width, min_height) = window
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == window.label())
        .map_or((None, None), |config| (config.min_width, config.min_height));
    let Ok(scale) = window.scale_factor() else {
        return;
    };
    let size = size.to_logical::<f64>(scale);
    if let Some((width, height)) = clamped_to_min((size.width, size.height), min_width, min_height)
    {
        let _ = window.set_size(tauri::LogicalSize::new(width, height));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    // Registered before every other plugin, per the plugin's contract: a second
    // launch hands its arguments to the running app and exits from inside this
    // init, so anything set up ahead of it would be set up twice.
    //
    // macOS is excluded because the OS already enforces one instance per .app
    // bundle and routes the document through `RunEvent::Opened`. Without this,
    // double-clicking a second `.osf` on Windows or Linux starts a second copy of
    // Ori Studio, and the two then race over `tauri-plugin-window-state`'s single
    // state file.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
            let paths = argv_osf_paths(argv.iter().skip(1), Path::new(&cwd));
            queue_opened_files(app, paths);
        }));
    }

    // Desktop only: replacing the running application has no meaning on mobile,
    // and neither plugin builds for those targets.
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    builder
        .manage(OpenedFiles::default())
        .manage(cp_engine::new_state())
        // Separate state, not a field on the engine: a fold holds the engine
        // mutex for its whole duration, so the cancel flag has to live somewhere
        // the stop command can reach without waiting for it.
        .manage(cp_engine::new_cancel_state())
        .manage(cp_detect::new_state())
        .plugin(tauri_plugin_dialog::init())
        // Reopen the window where and how it was left. Narrowed from the
        // plugin's default of every flag: `FULLSCREEN` would relaunch into
        // fullscreen after a session that merely ended there, and `VISIBLE` /
        // `DECORATIONS` restore chrome state this app never varies.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .build(),
        )
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Resized(size) = event {
                clamp_window_to_min(window, *size);
            }
        })
        .setup(|_app| {
            // The first launch's document, on the platforms that deliver it as an
            // argument. Queued rather than opened directly: the webview does not
            // exist yet, so the frontend drains this through `take_opened_files`
            // when it mounts.
            #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
            {
                let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
                let paths = argv_osf_paths(std::env::args().skip(1), &cwd);
                queue_opened_files(_app.handle(), paths);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            platform_ping,
            read_text_file,
            read_binary_file,
            write_text_file,
            write_binary_file,
            take_opened_files,
            updater::update_environment,
            // CP engine — keep in lockstep with cp_engine::NATIVE_CP_COMMAND_NAMES.
            cp_engine::cp_operation_descriptors,
            cp_engine::cp_load_cp,
            cp_engine::cp_load_fold,
            cp_engine::cp_load_fold_file,
            cp_engine::cp_load_ori,
            cp_engine::cp_load_orh,
            cp_engine::cp_load_document,
            cp_engine::cp_restore_document,
            cp_engine::cp_document_snapshot,
            cp_engine::cp_document_geometry,
            cp_engine::cp_restore_from_compact,
            cp_engine::cp_document_summary,
            cp_engine::cp_free_document,
            cp_engine::cp_execute_command,
            cp_detect::cp_detect_model_dir,
            cp_detect::cp_detect_model_list,
            cp_detect::cp_detect_model_path,
            cp_detect::cp_detect_model_store,
            cp_detect::cp_detect_model_remove,
            cp_detect::cp_detect_native_inference_available,
            cp_detect::cp_detect_recognize,
            cp_detect::cp_detect_solve_exact,
            cp_detect::cp_detect_solve_exact_to_fold,
            cp_detect::cp_detect_solve_cancel,
            cp_detect::cp_detect_exact_solve_input_from_fold,
            cp_engine::cp_preview_command,
            cp_engine::cp_insert_line_segments,
            cp_engine::cp_deselect_all,
            cp_engine::cp_import_add,
            cp_engine::cp_replace_line_segments,
            cp_engine::cp_export_cp,
            cp_engine::cp_export_fold,
            cp_engine::cp_export_fold_file,
            cp_engine::cp_export_ori,
            cp_engine::cp_export_orh,
            cp_engine::cp_export_share,
            cp_engine::cp_load_share,
            cp_engine::cp_set_texts,
            cp_engine::cp_place_circles,
            cp_engine::cp_folded_figure_fold,
            cp_engine::cp_folded_figure_fold_selected,
            cp_engine::cp_folded_figure_snapshot,
            cp_engine::cp_folded_figure_render_snapshot,
            cp_engine::cp_folded_figure_set_model,
            cp_engine::cp_folded_figure_duplicate,
            cp_engine::cp_folded_figure_fold_another,
            cp_engine::cp_folded_figure_fold_to_case,
            cp_engine::cp_folded_figure_fold_3d,
            cp_engine::cp_folded_figure_3d_fold_another,
            cp_engine::cp_folded_figure_3d_duplicate,
            cp_engine::cp_free_folded_figure,
            // Deliberately *not* in NATIVE_CP_COMMAND_NAMES: it maps to no
            // CpSession operation and never takes the engine mutex, which is the
            // only reason it can answer while a fold is running.
            cp_engine::cp_fold_cancel,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Ori Studio")
        .run(handle_opened_event);
}

#[cfg(test)]
mod tests {
    use super::{argv_osf_paths, clamped_to_min, opened_osf_paths};
    use std::path::Path;

    #[test]
    fn leaves_a_restored_size_at_or_above_the_minimum_alone() {
        assert_eq!(
            clamped_to_min((1400.0, 900.0), Some(900.0), Some(640.0)),
            None
        );
        assert_eq!(
            clamped_to_min((900.0, 640.0), Some(900.0), Some(640.0)),
            None
        );
    }

    #[test]
    fn raises_a_restored_size_that_undershoots_either_axis() {
        // The scale-change case: saved at 1x, reopened at 2x.
        assert_eq!(
            clamped_to_min((450.0, 320.0), Some(900.0), Some(640.0)),
            Some((900.0, 640.0))
        );
        // One axis short must not shrink the other.
        assert_eq!(
            clamped_to_min((1400.0, 320.0), Some(900.0), Some(640.0)),
            Some((1400.0, 640.0))
        );
    }

    #[test]
    fn treats_an_unconfigured_minimum_as_no_constraint() {
        assert_eq!(clamped_to_min((120.0, 80.0), None, None), None);
        assert_eq!(
            clamped_to_min((120.0, 80.0), None, Some(640.0)),
            Some((120.0, 640.0))
        );
    }

    #[test]
    fn filters_opened_urls_to_osf_file_paths() {
        let osf = tauri::Url::from_file_path("/tmp/design.osf").expect("osf url");
        let upper = tauri::Url::from_file_path("/tmp/upper.OSF").expect("upper osf url");
        let fold = tauri::Url::from_file_path("/tmp/design.fold").expect("fold url");
        let web = tauri::Url::parse("https://example.com/design.osf").expect("web url");

        let paths = opened_osf_paths(vec![osf, upper, fold, web]);

        assert_eq!(paths, vec!["/tmp/design.osf", "/tmp/upper.OSF"]);
    }

    #[test]
    fn filters_argv_to_osf_paths() {
        let cwd = Path::new("/work");

        let paths = argv_osf_paths(
            ["/tmp/design.osf", "/tmp/upper.OSF", "/tmp/design.fold"],
            cwd,
        );

        assert_eq!(paths, vec!["/tmp/design.osf", "/tmp/upper.OSF"]);
    }

    #[test]
    fn resolves_a_relative_argv_path_against_the_cwd() {
        // A shell launch from the document's own directory, and the
        // single-instance callback, both produce this.
        let paths = argv_osf_paths(["design.osf"], Path::new("/work/designs"));

        assert_eq!(paths, vec!["/work/designs/design.osf"]);
    }

    #[test]
    fn ignores_switches_that_look_like_documents() {
        let paths = argv_osf_paths(
            ["--enable-features=Thing.osf", "-v", "/tmp/real.osf"],
            Path::new("/work"),
        );

        assert_eq!(paths, vec!["/tmp/real.osf"]);
    }

    #[test]
    fn yields_nothing_for_a_plain_launch() {
        assert!(argv_osf_paths(Vec::<String>::new(), Path::new("/work")).is_empty());
        assert!(argv_osf_paths(["--some-flag"], Path::new("/work")).is_empty());
    }
}

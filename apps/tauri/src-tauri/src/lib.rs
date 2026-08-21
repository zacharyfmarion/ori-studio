use std::borrow::Cow;
use std::fs;
use std::path::Path;
use std::sync::Mutex;

#[cfg(any(
    not(any(target_os = "macos", target_os = "ios", target_os = "android")),
    test
))]
use std::path::PathBuf;

// Used by the macOS/mobile `RunEvent::Opened` path and by the argv path that
// serves Windows and Linux, so every target we build reaches one of them.
use tauri::Emitter;
use tauri::Manager;
// `tauri-plugin-window-state` is a desktop-only dependency: on mobile its body
// is cfg'd away to an empty crate, so this import is what would fail. See the
// dependency comment in Cargo.toml.
#[cfg(desktop)]
use tauri_plugin_window_state::StateFlags;

mod cp_engine;
mod updater;

/// One document the OS has asked the app to open.
///
/// Two fields because the platforms deliver two different things and the
/// difference is not cosmetic. Windows and Linux pass a command-line argument, so
/// a path is all there ever was. macOS and iOS pass a URL — and on iOS that URL
/// carries a **security scope**, which is a property of the URL itself and not of
/// the bytes of the path inside it. Reducing it to a path, which is what
/// `to_file_path()` does, is what leaves the app holding a location under a
/// container it has no standing permission to read; the open then fails as
/// though the file were missing.
///
/// So the URL is preserved as delivered, and `path` is derived from it rather
/// than the other way round.
///
/// Exactly one field may be absent at a time, and which one says how the
/// document arrived: `url` is `None` on the argv platforms, and `path` is `None`
/// for a URL with no filesystem path. The derivation only ever runs one way —
/// `path` from `url`, never `url` from `path` — so `url` means the same thing
/// everywhere: what the OS actually handed over, or nothing. A `file://` string
/// assembled from an argv path would look identical to one and carry no scope.
///
/// Reading *through* the scope (`startAccessingSecurityScopedResource`) is the
/// other half of this and is not implemented: it belongs with the rest of the iOS
/// file layer, alongside the document picker and bookmark persistence.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
struct OpenedFile {
    url: Option<String>,
    path: Option<String>,
}

#[derive(Default)]
struct OpenedFiles(Mutex<Vec<OpenedFile>>);

#[tauri::command]
fn platform_ping() -> &'static str {
    "ori-studio"
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| error.to_string())
}

/// Read a file's bytes, over the raw IPC channel rather than as JSON.
///
/// The return type is what does that. A `Vec<u8>` is serialized as a JSON array
/// of decimal numbers — `[137,80,78,71,…]` — which costs **3.6x the file's size**
/// on a PNG and 3.1x on an `.osf` (measured on this repo's fixtures; the ceiling
/// is 4x, at `"255,"` per byte). `ipc::Response` sends the bytes as an
/// `application/octet-stream` body instead, so the wire carries the file and
/// nothing else, and neither side builds a multi-megabyte intermediate string.
#[tauri::command]
fn read_binary_file(path: String) -> Result<tauri::ipc::Response, String> {
    fs::read(path)
        .map(tauri::ipc::Response::new)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(path, contents).map_err(|error| error.to_string())
}

/// The destination of a raw-body write, from the request's `path` header.
///
/// A header value is ASCII, and a path is not — `~/Documents/折り紙.png` is a
/// perfectly ordinary one. So the JS side sends `encodeURIComponent(path)` and
/// this undoes it. Percent-decoding is also what makes the transport lossless
/// for the characters that *are* ASCII but not header-safe: a newline in a
/// filename would otherwise truncate the header.
fn path_header(headers: &tauri::http::HeaderMap) -> Result<String, String> {
    let encoded = headers
        .get("path")
        .ok_or_else(|| "write_binary_file: no path header".to_string())?;
    percent_encoding::percent_decode(encoded.as_bytes())
        .decode_utf8()
        .map(|path| path.into_owned())
        .map_err(|_| "write_binary_file: path is not valid UTF-8".to_string())
}

/// The bytes of a write, from whichever shape the IPC channel delivered them in.
///
/// **Both arms are reachable, and the JSON one is not a legacy path.** Tauri picks
/// its transport at runtime: the custom-protocol IPC sends a `Uint8Array` payload
/// as an `application/octet-stream` body, but if that `fetch` ever fails — a CSP
/// rejection, or a webview that blocks the `ipc://` scheme — `ipc-protocol.js`
/// latches `customProtocolIpcFailed` for the rest of the session and falls back to
/// `window.ipc.postMessage`. That path `JSON.stringify`s the whole message, and its
/// replacer turns a `Uint8Array` into an array of numbers. So the same call that
/// arrives as `Raw` on one launch arrives as `Json(Array)` on the next.
///
/// Rejecting the JSON arm would make every binary save fail for the rest of that
/// session with an error about invoke bodies — on a path that worked before the
/// transport changed, since the old `{ path, bytes }` shape was JSON either way.
/// The read side already carries the mirror of this (`ArrayBuffer | number[]` in
/// `fileService.ts`); this is the same fallback from the other direction, and it
/// is why `tauri-plugin-fs`'s `write_file` matches on both.
fn write_body_bytes(body: &tauri::ipc::InvokeBody) -> Result<Cow<'_, [u8]>, String> {
    match body {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(Cow::Borrowed(bytes)),
        tauri::ipc::InvokeBody::Json(serde_json::Value::Array(values)) => values
            .iter()
            .map(|value| {
                // Anything that is not a byte means the payload was never a
                // `Uint8Array`, so truncating it to one would write a corrupt
                // file rather than report a wrong call.
                value
                    .as_u64()
                    .filter(|byte| *byte <= u8::MAX as u64)
                    .map(|byte| byte as u8)
                    .ok_or_else(|| "write_binary_file: body is not a byte array".to_string())
            })
            .collect::<Result<Vec<u8>, String>>()
            .map(Cow::Owned),
        _ => Err("write_binary_file: expected a raw or byte-array body".to_string()),
    }
}

/// Write bytes to a file, over the raw IPC channel rather than as JSON.
///
/// The mirror of {@link read_binary_file}, and shaped by the same constraint from
/// the other direction: a raw request body *is* the argument list, so there is
/// nowhere in it for a second argument to live. The path travels as a header
/// instead. This is the same arrangement `tauri-plugin-fs` uses for `write_file`.
#[tauri::command]
fn write_binary_file(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let path = path_header(request.headers())?;
    let bytes = write_body_bytes(request.body())?;
    fs::write(path, bytes).map_err(|error| error.to_string())
}

#[tauri::command]
fn take_opened_files(app: tauri::AppHandle) -> Result<Vec<OpenedFile>, String> {
    let state = app.state::<OpenedFiles>();
    let mut opened_files = state
        .0
        .lock()
        .map_err(|_| "opened files state is unavailable".to_string())?;
    Ok(opened_files.drain(..).collect())
}

/// Whether a name ends in `.osf`, case-insensitively.
fn is_osf_name(name: &Path) -> bool {
    name.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("osf"))
}

/// The `.osf` documents in a batch of `RunEvent::Opened` URLs.
///
/// Filtered on the URL's own last path segment rather than on a resolved
/// filesystem path, so a URL this process cannot turn into a path is still
/// recognised as the document it is. See {@link OpenedFile} for why the URL is
/// kept rather than collapsed to a path.
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android", test))]
fn opened_osf_files(urls: Vec<tauri::Url>) -> Vec<OpenedFile> {
    urls.into_iter()
        .filter(|url| {
            url.path_segments()
                .and_then(|mut segments| segments.next_back())
                .is_some_and(|segment| is_osf_name(Path::new(segment)))
        })
        // A non-`file://` URL that happens to end in `.osf` is not a document
        // this app can open — `https://example.com/design.osf` is a download, not
        // a file — so it is dropped here rather than handed on with no path.
        .filter(|url| url.scheme() == "file")
        .map(|url| OpenedFile {
            path: url
                .to_file_path()
                .ok()
                .map(|path| path.to_string_lossy().into_owned()),
            url: Some(url.into()),
        })
        .collect()
}

#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
fn handle_opened_event(app: &tauri::AppHandle, event: tauri::RunEvent) {
    if let tauri::RunEvent::Opened { urls } = event {
        let files = opened_osf_files(urls);
        if files.is_empty() {
            return;
        }
        if let Ok(mut opened_files) = app.state::<OpenedFiles>().0.lock() {
            opened_files.extend(files.clone());
        }
        let _ = app.emit("opened-files", files);
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
        .filter(|path| is_osf_name(path))
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

/// Records `.osf` paths for the frontend and tells it they arrived.
///
/// Both halves are required: `take_opened_files` drains this state on mount, for
/// paths that arrived before the webview existed, and the event covers the
/// already-running case. The frontend hook listens for one and polls the other.
///
/// `url` is left empty rather than reconstructed from the path — see
/// {@link OpenedFile}. The OS said "path" here, and saying so is more useful than
/// a `file://` string nothing delivered.
#[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
fn queue_opened_files(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    let files: Vec<OpenedFile> = paths
        .into_iter()
        .map(|path| OpenedFile {
            url: None,
            path: Some(path),
        })
        .collect();
    if let Ok(mut opened_files) = app.state::<OpenedFiles>().0.lock() {
        opened_files.extend(files.clone());
    }
    let _ = app.emit("opened-files", files);
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
#[cfg(desktop)]
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
///
/// That reasoning is desktop-only, which is why the whole thing is — see the
/// registration site. On mobile the window *is* the screen and a sub-minimum
/// `Resized` is the OS stating a fact, not a mistake to correct.
#[cfg(desktop)]
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

    // Window management, both halves desktop-only for the same reason: a mobile
    // window *is* the screen, so neither its size nor its position is the app's
    // to choose. `tauri-plugin-window-state` says as much itself by cfg'ing its
    // body away on iOS and Android.
    //
    // `clamp_window_to_min` has no such guard of its own, and left on it is the
    // more damaging of the two. iPadOS fires `Resized` on every rotation and
    // every Split View transition, most of them below the 900x640 minimum
    // `tauri.conf.json` declares for the desktop window — and the handler answers
    // a sub-minimum size by calling `set_size`, so it would spend the whole
    // session arguing with the window manager over a size the app cannot have.
    #[cfg(desktop)]
    {
        builder = builder
            // Reopen the window where and how it was left. Narrowed from the
            // plugin's default of every flag: `FULLSCREEN` would relaunch into
            // fullscreen after a session that merely ended there, and `VISIBLE` /
            // `DECORATIONS` restore chrome state this app never varies.
            .plugin(
                tauri_plugin_window_state::Builder::default()
                    .with_state_flags(
                        StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED,
                    )
                    .build(),
            )
            .on_window_event(|window, event| {
                if let tauri::WindowEvent::Resized(size) = event {
                    clamp_window_to_min(window, *size);
                }
            });
    }

    builder
        .manage(OpenedFiles::default())
        .manage(cp_engine::new_state())
        // Separate state, not a field on the engine: a fold holds the engine
        // mutex for its whole duration, so the cancel flag has to live somewhere
        // the stop command can reach without waiting for it.
        .manage(cp_engine::new_cancel_state())
        .plugin(tauri_plugin_dialog::init())
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
    use super::{
        OpenedFile, argv_osf_paths, clamped_to_min, opened_osf_files, path_header, write_body_bytes,
    };
    use std::path::Path;

    fn opened(url: &str, path: &str) -> OpenedFile {
        OpenedFile {
            url: Some(url.to_string()),
            path: Some(path.to_string()),
        }
    }

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
    fn filters_opened_urls_to_osf_file_documents() {
        let osf = tauri::Url::from_file_path("/tmp/design.osf").expect("osf url");
        let upper = tauri::Url::from_file_path("/tmp/upper.OSF").expect("upper osf url");
        let fold = tauri::Url::from_file_path("/tmp/design.fold").expect("fold url");
        let web = tauri::Url::parse("https://example.com/design.osf").expect("web url");

        let files = opened_osf_files(vec![osf, upper, fold, web]);

        assert_eq!(
            files,
            vec![
                opened("file:///tmp/design.osf", "/tmp/design.osf"),
                opened("file:///tmp/upper.OSF", "/tmp/upper.OSF"),
            ]
        );
    }

    /// The whole point of {@link OpenedFile}: an `.osf` opened on iPadOS arrives
    /// as a `file://` URL under the app's shared container, and it is the URL —
    /// not the path inside it — that carries the security scope. Collapsing it to
    /// a path is what made the open fail as if the file were missing.
    #[test]
    fn keeps_the_url_an_ios_open_delivers() {
        let container = "file:///private/var/mobile/Containers/Shared/AppGroup/\
                         2F1E9C1A-0000-4000-8000-000000000000/File%20Provider%20Storage/design.osf";
        let url = tauri::Url::parse(container).expect("container url");

        let files = opened_osf_files(vec![url]);

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].url.as_deref(), Some(container));
        // Still derived, so nothing downstream had to change to keep working —
        // it is just no longer the *only* thing that survives.
        assert_eq!(
            files[0].path.as_deref(),
            Some(
                "/private/var/mobile/Containers/Shared/AppGroup/\
                 2F1E9C1A-0000-4000-8000-000000000000/File Provider Storage/design.osf"
            )
        );
    }

    /// A URL a browser could fetch is not a document this app can open, and it
    /// has no path — so it must not reach the frontend as an entry with neither.
    #[test]
    fn drops_a_non_file_url_that_ends_in_osf() {
        let web = tauri::Url::parse("https://example.com/design.osf").expect("web url");

        assert!(opened_osf_files(vec![web]).is_empty());
    }

    fn header_map(value: &str) -> tauri::http::HeaderMap {
        let mut headers = tauri::http::HeaderMap::new();
        headers.insert("path", value.parse().expect("header value"));
        headers
    }

    #[test]
    fn decodes_a_percent_encoded_write_path() {
        // What `encodeURIComponent` produces. A header value is ASCII, so a path
        // with a space, a non-Latin script or an emoji only survives the trip
        // encoded — and arrives as mojibake, or truncated, if nothing decodes it.
        assert_eq!(
            path_header(&header_map("/tmp/My%20Design.png")).as_deref(),
            Ok("/tmp/My Design.png")
        );
        assert_eq!(
            path_header(&header_map(
                "/tmp/%E6%8A%98%E3%82%8A%E7%B4%99/%E9%B6%B4.png"
            ))
            .as_deref(),
            Ok("/tmp/折り紙/鶴.png")
        );
        // An ASCII path is unchanged by the round trip, so the common case pays
        // nothing for the above.
        assert_eq!(
            path_header(&header_map("/tmp/design.png")).as_deref(),
            Ok("/tmp/design.png")
        );
    }

    /// The transport the custom-protocol IPC uses when it works.
    #[test]
    fn takes_the_bytes_of_a_raw_write_body() {
        let body = tauri::ipc::InvokeBody::Raw(vec![137, 80, 78, 71]);

        assert_eq!(
            write_body_bytes(&body).as_deref(),
            Ok(&[137, 80, 78, 71][..])
        );
    }

    /// The transport it uses when the custom protocol has failed once. Same
    /// call, same file, different shape on the wire — so a write that only
    /// understood `Raw` would fail for the rest of that session, on a path that
    /// worked before the raw-body change.
    #[test]
    fn takes_the_bytes_of_a_json_array_write_body() {
        let body = tauri::ipc::InvokeBody::Json(serde_json::json!([137, 80, 78, 71]));

        assert_eq!(
            write_body_bytes(&body).as_deref(),
            Ok(&[137, 80, 78, 71][..])
        );
    }

    /// Stricter than `tauri-plugin-fs`, which `flat_map`s non-bytes away and
    /// writes what is left. A body that is not a byte array was never a
    /// `Uint8Array`, and silently writing a shortened file is worse than saying
    /// so.
    #[test]
    fn refuses_a_json_body_that_is_not_bytes() {
        assert!(
            write_body_bytes(&tauri::ipc::InvokeBody::Json(serde_json::json!([1, 256]))).is_err()
        );
        assert!(write_body_bytes(&tauri::ipc::InvokeBody::Json(serde_json::json!(["a"]))).is_err());
        assert!(
            write_body_bytes(&tauri::ipc::InvokeBody::Json(
                serde_json::json!({ "bytes": [1] })
            ))
            .is_err()
        );
    }

    #[test]
    fn refuses_a_write_with_no_path_header() {
        // The raw body carries the bytes and nothing else, so a missing header
        // leaves no destination at all. Failing here beats writing somewhere.
        assert!(path_header(&tauri::http::HeaderMap::new()).is_err());
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

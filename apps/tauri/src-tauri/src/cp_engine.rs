//! Native crease-pattern (CP) engine commands — the desktop counterpart to the
//! `oristudio-cp-wasm` browser bridge. Both bridges are thin marshaling layers
//! over the same [`CpSession`]; on desktop it lives in Tauri managed state and
//! is reached via `invoke`, avoiding the wasm runtime penalty.
//!
//! Every command is `async` and runs the engine work on a blocking thread
//! (`spawn_blocking`), so a multi-second fold never blocks the UI/main thread —
//! matching how the browser runs the engine in a Web Worker. The `CpSession` is
//! serialized behind a `Mutex` (the engine is effectively single-threaded, like
//! the worker); the `Arc` lets each command move a handle onto its worker thread.
//!
//! See `implementation-plans/desktop-native-cp-engine-migration.md`. The command
//! set is kept in lockstep with the shared manifest
//! [`oristudio_cp::session::CP_ENGINE_COMMANDS`] by the parity test at the bottom.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use oristudio_cp::CreasePatternDocument;
use oristudio_cp::cancel::{CancelHandle, CancelSource, RunId};
use oristudio_cp::folding::{
    DisplayStyle, EstimationOrder, FoldedFigureModel, FoldedFigureRenderOptions,
    FoldedFigureRenderSnapshot, FoldedFigureSnapshot,
};
use oristudio_cp::geometry::LineSegment;
use oristudio_cp::geometry_transport::CompactGeometry;
use oristudio_cp::session::{
    CpSession, DocumentSummary, EngineError, Fold3dFoldResult, Fold3dStepResult,
    FoldedFigureBatchResult, FoldedFigureResult, OperationInfo,
};
use oristudio_cp::{CommandPreview, CommandResult, CreasePatternCommandPayload, OperationId};
use tauri::State;

/// Managed engine state — one [`CpSession`] behind a `Mutex`, shared via `Arc` so
/// each command can move a handle onto its `spawn_blocking` worker thread.
pub type CpEngine = Arc<Mutex<CpSession>>;

pub fn new_state() -> CpEngine {
    Arc::new(Mutex::new(CpSession::new()))
}

/// Which fold the user has asked to stop, or 0 for none.
///
/// Managed **beside** the engine rather than inside it, and that separation is
/// the whole design: [`run`] holds the `CpSession` mutex for a fold's entire
/// duration, so a cancel that touched the session would queue behind the fold it
/// is trying to stop and arrive only once the stop was pointless.
#[derive(Default)]
pub struct FoldCancel(AtomicU32);

impl CancelSource for FoldCancel {
    fn cancelled_run(&self) -> u32 {
        self.0.load(Ordering::Relaxed)
    }
}

/// Managed cancel state — shared via `Arc` so a fold can carry a reader onto its
/// `spawn_blocking` thread while the command that writes it stays on the main one.
pub type FoldCancelState = Arc<FoldCancel>;

pub fn new_cancel_state() -> FoldCancelState {
    FoldCancelState::default()
}

/// Stop the named fold.
///
/// **Synchronous on purpose**, so Tauri answers it inline instead of routing it
/// through `spawn_blocking` — a queued async command would sit behind the ~40 CP
/// commands already parked on `engine.lock()` for the fold's duration. It is also
/// the reason this command is absent from
/// [`CP_ENGINE_COMMANDS`](oristudio_cp::session::CP_ENGINE_COMMANDS): it maps to
/// no `CpSession` operation and deliberately never takes the lock.
///
/// `store`, not `fetch_max`: the kernel matches the run id exactly, so stopping
/// the visible fold cannot collaterally kill a lower-numbered background one.
#[tauri::command]
pub fn cp_fold_cancel(state: State<'_, FoldCancelState>, run_id: u32) {
    state.0.store(run_id, Ordering::Relaxed);
}

/// Run engine work off the UI thread: clone the `Arc`, then lock and run the
/// closure on a blocking thread. The main thread stays free while the work runs.
async fn run<T, F>(state: State<'_, CpEngine>, f: F) -> Result<T, EngineError>
where
    F: FnOnce(&mut CpSession) -> Result<T, EngineError> + Send + 'static,
    T: Send + 'static,
{
    let engine = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = engine
            .lock()
            .map_err(|_| EngineError::new("engine_poisoned", "CP engine state is unavailable"))?;
        f(&mut session)
    })
    .await
    .map_err(|_| EngineError::new("engine_task", "CP engine task did not complete"))?
}

/// [`run`] with a cancel binding installed on the blocking thread.
///
/// Every fold command uses this and none uses [`run`] — the test at the bottom of
/// this file enforces that, because a fold left on `run` compiles, passes every
/// check, and silently ignores Stop forever.
///
/// The binding is installed inside the closure, i.e. on the thread that actually
/// folds, and covers the rayon regions the kernel enters from there (its
/// `flat_map_conditions` bridge re-installs it per worker item). A `run_id` of 0
/// binds nothing, which is what an uncancellable background fold passes.
async fn run_cancellable<T, F>(
    state: State<'_, CpEngine>,
    cancel: State<'_, FoldCancelState>,
    run_id: u32,
    f: F,
) -> Result<T, EngineError>
where
    F: FnOnce(&mut CpSession) -> Result<T, EngineError> + Send + 'static,
    T: Send + 'static,
{
    let engine = Arc::clone(state.inner());
    let source: Arc<dyn CancelSource> = Arc::clone(cancel.inner()) as Arc<dyn CancelSource>;
    tauri::async_runtime::spawn_blocking(move || {
        let _bound = oristudio_cp::cancel::bind(
            RunId::new(run_id).map(|run_id| CancelHandle::new(source, run_id)),
        );
        let mut session = engine
            .lock()
            .map_err(|_| EngineError::new("engine_poisoned", "CP engine state is unavailable"))?;
        f(&mut session)
    })
    .await
    .map_err(|_| EngineError::new("engine_task", "CP engine task did not complete"))?
}

// --- operation catalog ------------------------------------------------------

#[tauri::command]
pub async fn cp_operation_descriptors(
    state: State<'_, CpEngine>,
) -> Result<Vec<OperationInfo>, EngineError> {
    run(state, |session| Ok(session.operation_descriptors())).await
}

// --- document loading / construction ----------------------------------------

#[tauri::command]
pub async fn cp_load_cp(
    text: String,
    title: String,
    state: State<'_, CpEngine>,
) -> Result<u32, EngineError> {
    run(state, move |session| session.load_cp(&text, &title)).await
}

#[tauri::command]
pub async fn cp_load_fold(
    text: String,
    title: String,
    state: State<'_, CpEngine>,
) -> Result<u32, EngineError> {
    run(state, move |session| session.load_fold(&text, &title)).await
}

#[tauri::command]
pub async fn cp_load_fold_file(
    text: String,
    state: State<'_, CpEngine>,
) -> Result<u32, EngineError> {
    run(state, move |session| session.load_fold_file(&text)).await
}

#[tauri::command]
pub async fn cp_load_ori(
    text: String,
    accept_unknown_version: bool,
    state: State<'_, CpEngine>,
) -> Result<u32, EngineError> {
    run(state, move |session| {
        session.load_ori(&text, accept_unknown_version)
    })
    .await
}

#[tauri::command]
pub async fn cp_load_orh(text: String, state: State<'_, CpEngine>) -> Result<u32, EngineError> {
    run(state, move |session| session.load_orh(&text)).await
}

#[tauri::command]
pub async fn cp_load_document(
    document: CreasePatternDocument,
    state: State<'_, CpEngine>,
) -> Result<u32, EngineError> {
    run(state, move |session| Ok(session.load_document(document))).await
}

// --- document lifecycle / read ----------------------------------------------

#[tauri::command]
pub async fn cp_restore_document(
    handle: u32,
    document: CreasePatternDocument,
    state: State<'_, CpEngine>,
) -> Result<(), EngineError> {
    run(state, move |session| {
        session.restore_document(handle, document)
    })
    .await
}

#[tauri::command]
pub async fn cp_document_snapshot(
    handle: u32,
    state: State<'_, CpEngine>,
) -> Result<CreasePatternDocument, EngineError> {
    run(state, move |session| session.document_snapshot(handle)).await
}

/// Returns the compact geometry as a single binary buffer (via `tauri::ipc::Response`,
/// so the frontend receives one `ArrayBuffer`) rather than JSON — this is the hot
/// per-selection/edit render path. The native client decodes it straight into
/// typed arrays. See `CompactGeometry::to_bytes`.
#[tauri::command]
pub async fn cp_document_geometry(
    handle: u32,
    state: State<'_, CpEngine>,
) -> Result<tauri::ipc::Response, EngineError> {
    let bytes = run(state, move |session| {
        session
            .document_geometry(handle)?
            .to_bytes()
            .map_err(|error| EngineError::new("geometry_encode", error))
    })
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn cp_restore_from_compact(
    handle: u32,
    geometry: CompactGeometry,
    state: State<'_, CpEngine>,
) -> Result<(), EngineError> {
    run(state, move |session| {
        session.restore_from_compact(handle, &geometry)
    })
    .await
}

#[tauri::command]
pub async fn cp_document_summary(
    handle: u32,
    state: State<'_, CpEngine>,
) -> Result<DocumentSummary, EngineError> {
    run(state, move |session| session.document_summary(handle)).await
}

#[tauri::command]
pub async fn cp_free_document(handle: u32, state: State<'_, CpEngine>) -> Result<(), EngineError> {
    run(state, move |session| session.free_document(handle)).await
}

// --- editing commands -------------------------------------------------------

#[tauri::command]
pub async fn cp_execute_command(
    handle: u32,
    operation: OperationId,
    payload: CreasePatternCommandPayload,
    state: State<'_, CpEngine>,
) -> Result<CommandResult, EngineError> {
    run(state, move |session| {
        session.execute_command(handle, operation, payload)
    })
    .await
}

#[tauri::command]
pub async fn cp_preview_command(
    handle: u32,
    operation: OperationId,
    payload: CreasePatternCommandPayload,
    state: State<'_, CpEngine>,
) -> Result<CommandPreview, EngineError> {
    run(state, move |session| {
        session.preview_command(handle, operation, payload)
    })
    .await
}

#[tauri::command]
pub async fn cp_insert_line_segments(
    handle: u32,
    segments: Vec<LineSegment>,
    state: State<'_, CpEngine>,
) -> Result<u32, EngineError> {
    run(state, move |session| {
        session.insert_line_segments(handle, &segments)
    })
    .await
}

#[tauri::command]
pub async fn cp_deselect_all(handle: u32, state: State<'_, CpEngine>) -> Result<u32, EngineError> {
    run(state, move |session| session.deselect_all(handle)).await
}

#[tauri::command]
pub async fn cp_import_add(
    handle: u32,
    imported_handle: u32,
    state: State<'_, CpEngine>,
) -> Result<u32, EngineError> {
    run(state, move |session| {
        session.import_add(handle, imported_handle)
    })
    .await
}

#[tauri::command]
pub async fn cp_replace_line_segments(
    handle: u32,
    line_ids: Vec<usize>,
    segments: Vec<LineSegment>,
    state: State<'_, CpEngine>,
) -> Result<u32, EngineError> {
    run(state, move |session| {
        session.replace_line_segments(handle, &line_ids, &segments)
    })
    .await
}

// --- export -----------------------------------------------------------------

#[tauri::command]
pub async fn cp_export_cp(handle: u32, state: State<'_, CpEngine>) -> Result<String, EngineError> {
    run(state, move |session| session.export_cp(handle)).await
}

#[tauri::command]
pub async fn cp_export_fold(
    handle: u32,
    state: State<'_, CpEngine>,
) -> Result<String, EngineError> {
    run(state, move |session| session.export_fold(handle)).await
}

/// `folded_handles` names the 3D folded figures to write as `foldedForm`
/// frames. Empty is the ordinary case and means "the pattern only".
#[tauri::command]
pub async fn cp_export_fold_file(
    handle: u32,
    folded_handles: Vec<u32>,
    state: State<'_, CpEngine>,
) -> Result<String, EngineError> {
    run(state, move |session| {
        session.export_fold_file(handle, &folded_handles)
    })
    .await
}

#[tauri::command]
pub async fn cp_export_ori(handle: u32, state: State<'_, CpEngine>) -> Result<String, EngineError> {
    run(state, move |session| session.export_ori(handle)).await
}

#[tauri::command]
pub async fn cp_export_orh(handle: u32, state: State<'_, CpEngine>) -> Result<String, EngineError> {
    run(state, move |session| session.export_orh(handle)).await
}

/// Encode a document as a base64url share payload for a URL fragment.
///
/// Desktop can *produce* a link even though it cannot open one: the frontend
/// runs under `createMemoryRouter`, so there is no URL to read back.
#[tauri::command]
pub async fn cp_export_share(
    handle: u32,
    state: State<'_, CpEngine>,
) -> Result<String, EngineError> {
    run(state, move |session| session.export_share(handle)).await
}

#[tauri::command]
pub async fn cp_load_share(
    payload: String,
    state: State<'_, CpEngine>,
) -> Result<u32, EngineError> {
    run(state, move |session| session.load_share(&payload)).await
}

#[tauri::command]
pub async fn cp_set_texts(
    handle: u32,
    coords: Vec<f64>,
    texts: Vec<String>,
    state: State<'_, CpEngine>,
) -> Result<(), EngineError> {
    run(state, move |session| {
        session.set_texts(handle, &coords, texts)
    })
    .await
}

#[tauri::command]
pub async fn cp_place_circles(
    handle: u32,
    source_bounds: Vec<f64>,
    coords: Vec<f64>,
    radii: Vec<f64>,
    state: State<'_, CpEngine>,
) -> Result<(), EngineError> {
    run(state, move |session| {
        session.place_circles(handle, &source_bounds, &coords, &radii)
    })
    .await
}

// --- folding ----------------------------------------------------------------
//
// Every command that runs a *search* takes a `run_id` and goes through
// [`run_cancellable`]; the duplicate commands below stay on [`run`], because they
// copy an existing figure rather than fold one. A `run_id` of 0 means "not
// cancellable", which is what every caller passed before this parameter existed.

#[tauri::command]
pub async fn cp_folded_figure_fold(
    document_handle: u32,
    starting_face_id: i32,
    order: EstimationOrder,
    model: Option<FoldedFigureModel>,
    run_id: u32,
    state: State<'_, CpEngine>,
    cancel: State<'_, FoldCancelState>,
) -> Result<FoldedFigureResult, EngineError> {
    run_cancellable(state, cancel, run_id, move |session| {
        session.folded_figure_fold(
            document_handle,
            starting_face_id,
            order,
            model.unwrap_or_default(),
        )
    })
    .await
}

// A command's parameter list *is* its IPC signature, and the last two are
// injected by Tauri rather than sent by the caller — grouping them into a struct
// to satisfy the lint would change the wire shape the frontend calls with.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn cp_folded_figure_fold_selected(
    document_handle: u32,
    selected_line_ids: Vec<usize>,
    starting_face_id: i32,
    order: EstimationOrder,
    model: Option<FoldedFigureModel>,
    run_id: u32,
    state: State<'_, CpEngine>,
    cancel: State<'_, FoldCancelState>,
) -> Result<FoldedFigureResult, EngineError> {
    run_cancellable(state, cancel, run_id, move |session| {
        session.folded_figure_fold_selected(
            document_handle,
            &selected_line_ids,
            starting_face_id,
            order,
            model.unwrap_or_default(),
        )
    })
    .await
}

#[tauri::command]
pub async fn cp_folded_figure_snapshot(
    handle: u32,
    state: State<'_, CpEngine>,
) -> Result<FoldedFigureSnapshot, EngineError> {
    run(state, move |session| session.folded_figure_snapshot(handle)).await
}

#[tauri::command]
pub async fn cp_folded_figure_render_snapshot(
    handle: u32,
    display_style: Option<DisplayStyle>,
    options: Option<FoldedFigureRenderOptions>,
    state: State<'_, CpEngine>,
) -> Result<Option<FoldedFigureRenderSnapshot>, EngineError> {
    run(state, move |session| {
        session.folded_figure_render_snapshot(handle, display_style, options.unwrap_or_default())
    })
    .await
}

#[tauri::command]
pub async fn cp_folded_figure_set_model(
    handle: u32,
    model: FoldedFigureModel,
    state: State<'_, CpEngine>,
) -> Result<FoldedFigureSnapshot, EngineError> {
    run(state, move |session| {
        session.folded_figure_set_model(handle, model)
    })
    .await
}

#[tauri::command]
pub async fn cp_folded_figure_duplicate(
    handle: u32,
    state: State<'_, CpEngine>,
) -> Result<FoldedFigureResult, EngineError> {
    run(state, move |session| {
        session.folded_figure_duplicate(handle)
    })
    .await
}

#[tauri::command]
pub async fn cp_folded_figure_fold_another(
    handle: u32,
    run_id: u32,
    state: State<'_, CpEngine>,
    cancel: State<'_, FoldCancelState>,
) -> Result<FoldedFigureSnapshot, EngineError> {
    run_cancellable(state, cancel, run_id, move |session| {
        session.folded_figure_fold_another(handle)
    })
    .await
}

#[tauri::command]
pub async fn cp_folded_figure_fold_to_case(
    handle: u32,
    objective: u32,
    initial_order: EstimationOrder,
    run_id: u32,
    state: State<'_, CpEngine>,
    cancel: State<'_, FoldCancelState>,
) -> Result<FoldedFigureBatchResult, EngineError> {
    run_cancellable(state, cancel, run_id, move |session| {
        session.folded_figure_fold_to_case(handle, objective as usize, initial_order)
    })
    .await
}

#[tauri::command]
pub async fn cp_folded_figure_fold_3d(
    document_handle: u32,
    selected_line_ids: Vec<usize>,
    starting_face_id: i32,
    model: Option<FoldedFigureModel>,
    run_id: u32,
    state: State<'_, CpEngine>,
    cancel: State<'_, FoldCancelState>,
) -> Result<Fold3dFoldResult, EngineError> {
    run_cancellable(state, cancel, run_id, move |session| {
        session.folded_figure_fold_3d(
            document_handle,
            &selected_line_ids,
            starting_face_id,
            model.unwrap_or_default(),
        )
    })
    .await
}

#[tauri::command]
pub async fn cp_folded_figure_3d_fold_another(
    handle: u32,
    run_id: u32,
    state: State<'_, CpEngine>,
    cancel: State<'_, FoldCancelState>,
) -> Result<Fold3dStepResult, EngineError> {
    run_cancellable(state, cancel, run_id, move |session| {
        session.folded_figure_3d_fold_another(handle)
    })
    .await
}

#[tauri::command]
pub async fn cp_folded_figure_3d_duplicate(
    handle: u32,
    state: State<'_, CpEngine>,
) -> Result<Fold3dFoldResult, EngineError> {
    run(state, move |session| {
        session.folded_figure_3d_duplicate(handle)
    })
    .await
}

#[tauri::command]
pub async fn cp_free_folded_figure(
    handle: u32,
    state: State<'_, CpEngine>,
) -> Result<(), EngineError> {
    run(state, move |session| session.free_folded_figure(handle)).await
}

/// The native command names (in shared-manifest order), mirroring the
/// `generate_handler!` registration in `lib.rs`. Each name is `cp_` + the
/// corresponding [`CP_ENGINE_COMMANDS`](oristudio_cp::session::CP_ENGINE_COMMANDS)
/// entry; the parity test asserts they stay in lockstep. Test-only — the real
/// registration is the explicit `generate_handler!` list.
#[cfg(test)]
const NATIVE_CP_COMMAND_NAMES: &[&str] = &[
    "cp_operation_descriptors",
    "cp_load_cp",
    "cp_load_fold",
    "cp_load_fold_file",
    "cp_load_ori",
    "cp_load_orh",
    "cp_load_document",
    "cp_restore_document",
    "cp_document_snapshot",
    "cp_document_geometry",
    "cp_restore_from_compact",
    "cp_document_summary",
    "cp_free_document",
    "cp_execute_command",
    "cp_preview_command",
    "cp_insert_line_segments",
    "cp_deselect_all",
    "cp_import_add",
    "cp_replace_line_segments",
    "cp_export_cp",
    "cp_export_fold",
    "cp_export_fold_file",
    "cp_export_ori",
    "cp_export_orh",
    "cp_export_share",
    "cp_load_share",
    "cp_set_texts",
    "cp_place_circles",
    "cp_folded_figure_fold",
    "cp_folded_figure_fold_selected",
    "cp_folded_figure_snapshot",
    "cp_folded_figure_render_snapshot",
    "cp_folded_figure_set_model",
    "cp_folded_figure_duplicate",
    "cp_folded_figure_fold_another",
    "cp_folded_figure_fold_to_case",
    "cp_folded_figure_fold_3d",
    "cp_folded_figure_3d_fold_another",
    "cp_folded_figure_3d_duplicate",
    "cp_free_folded_figure",
];

/// The six commands that run a layer-ordering search, and so must be
/// cancellable. Named here rather than inferred, because [`run_cancellable`] can
/// be written and never called: that compiles, passes every check in the repo,
/// and leaves desktop Stop silently doing nothing forever.
#[cfg(test)]
const CANCELLABLE_FOLD_COMMANDS: &[&str] = &[
    "cp_folded_figure_fold",
    "cp_folded_figure_fold_selected",
    "cp_folded_figure_fold_another",
    "cp_folded_figure_fold_to_case",
    "cp_folded_figure_fold_3d",
    "cp_folded_figure_3d_fold_another",
];

#[cfg(test)]
mod tests {
    use super::{
        CANCELLABLE_FOLD_COMMANDS, FoldCancel, NATIVE_CP_COMMAND_NAMES, new_cancel_state, new_state,
    };
    use oristudio_cp::cancel::CancelSource;
    use oristudio_cp::session::CP_ENGINE_COMMANDS;
    use std::sync::atomic::Ordering;

    const SQUARE_CP: &str =
        "2 0.0 0.0 1.0 0.0\n2 1.0 0.0 1.0 1.0\n2 1.0 1.0 0.0 1.0\n2 0.0 1.0 0.0 0.0\n";

    /// Parity: every native command is `cp_` + a shared-manifest entry, in the
    /// same order, and nothing is added or dropped on one side only.
    #[test]
    fn native_commands_match_the_shared_manifest() {
        let stripped: Vec<&str> = NATIVE_CP_COMMAND_NAMES
            .iter()
            .map(|name| name.strip_prefix("cp_").expect("cp_ prefix"))
            .collect();
        assert_eq!(
            stripped, CP_ENGINE_COMMANDS,
            "native Tauri command set drifted from oristudio_cp::session::CP_ENGINE_COMMANDS"
        );
    }

    /// `cp_fold_cancel` is the one native CP command deliberately outside the
    /// shared manifest, and this states it so a future reader does not "fix" the
    /// omission. The manifest documents itself as the list of commands that map
    /// to a `CpSession` operation and take the engine mutex; cancel's entire
    /// design point is that it does neither, and it has no wasm twin — the web
    /// transport is an `Atomics.store` into shared memory, not a command.
    #[test]
    fn the_cancel_command_is_deliberately_outside_the_manifest() {
        assert!(
            !CP_ENGINE_COMMANDS.contains(&"fold_cancel"),
            "cp_fold_cancel maps to no CpSession operation and must not enter the manifest"
        );
        assert!(!NATIVE_CP_COMMAND_NAMES.contains(&"cp_fold_cancel"));
    }

    /// Every fold command must reach the engine through `run_cancellable`, never
    /// through `run` — nothing else forces it, and a fold left on `run` ignores
    /// Stop while every check stays green.
    #[test]
    fn every_fold_command_binds_a_cancel_token() {
        let source = include_str!("cp_engine.rs");
        for command in CANCELLABLE_FOLD_COMMANDS {
            let signature = format!("pub async fn {command}(");
            let start = source
                .find(&signature)
                .unwrap_or_else(|| panic!("{command} is not defined in this file"));
            let body = &source[start..];
            let body = &body[..body.find("\n#[tauri::command]").unwrap_or(body.len())];
            assert!(
                body.contains("run_cancellable(state, cancel, run_id,"),
                "{command} does not bind a run id — desktop Stop cannot reach it"
            );
            assert!(
                !body.contains("    run(state"),
                "{command} still calls run(), which holds the engine mutex uncancellably"
            );
        }
    }

    /// The cancel flag is an exact id, never a watermark: a Stop on one run must
    /// leave every other live run alone, including a lower-numbered background
    /// one. `store` is what makes that true; `fetch_max` would not.
    #[test]
    fn the_cancel_state_records_the_exact_run() {
        let state = new_cancel_state();
        assert_eq!(state.cancelled_run(), 0, "nothing is cancelled at rest");

        state.0.store(7, Ordering::Relaxed);
        assert_eq!(state.cancelled_run(), 7);

        // A later Stop replaces the earlier one rather than accumulating.
        state.0.store(3, Ordering::Relaxed);
        assert_eq!(state.cancelled_run(), 3);

        assert_eq!(FoldCancel::default().cancelled_run(), 0);
    }

    /// A command actually round-trips through the managed session state.
    #[test]
    fn load_and_summary_through_state() {
        let state = new_state();
        let handle = {
            let mut session = state.lock().unwrap();
            session.load_cp(SQUARE_CP, "square").expect("load cp")
        };
        let summary = state
            .lock()
            .unwrap()
            .document_summary(handle)
            .expect("summary");
        assert_eq!(summary.line_segments, 4);
        assert_eq!(summary.title.as_deref(), Some("square"));
    }
}

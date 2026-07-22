//! Native crease-pattern (CP) engine commands — the desktop counterpart to the
//! `oristudio-cp-wasm` browser bridge. Both bridges are thin marshaling layers
//! over the same [`CpSession`]; on desktop it lives in Tauri managed state and
//! is reached via `invoke`, avoiding the wasm runtime penalty.
//!
//! See `implementation-plans/desktop-native-cp-engine-migration.md`. The command
//! set is kept in lockstep with the shared manifest
//! [`oristudio_cp::session::CP_ENGINE_COMMANDS`] by the parity test at the bottom
//! of this file.

use std::sync::Mutex;

use oristudio_cp::CreasePatternDocument;
use oristudio_cp::folding::{
    DisplayStyle, EstimationOrder, FoldedFigureModel, FoldedFigureRenderOptions,
    FoldedFigureRenderSnapshot, FoldedFigureSnapshot,
};
use oristudio_cp::geometry::LineSegment;
use oristudio_cp::geometry_transport::CompactGeometry;
use oristudio_cp::session::{
    CpSession, DocumentSummary, EngineError, FoldedFigureBatchResult, FoldedFigureResult,
    OperationInfo,
};
use oristudio_cp::{CommandPreview, CommandResult, CreasePatternCommandPayload, OperationId};
use tauri::State;

/// Managed engine state — one [`CpSession`] behind a `Mutex` (Tauri may dispatch
/// commands from a pool thread).
pub type CpEngine = Mutex<CpSession>;

pub fn new_state() -> CpEngine {
    Mutex::new(CpSession::new())
}

fn locked<T>(
    state: &State<'_, CpEngine>,
    f: impl FnOnce(&mut CpSession) -> Result<T, EngineError>,
) -> Result<T, EngineError> {
    let mut session = state
        .lock()
        .map_err(|_| EngineError::new("engine_poisoned", "CP engine state is unavailable"))?;
    f(&mut session)
}

// --- operation catalog ------------------------------------------------------

#[tauri::command]
pub fn cp_operation_descriptors(
    state: State<'_, CpEngine>,
) -> Result<Vec<OperationInfo>, EngineError> {
    locked(&state, |session| Ok(session.operation_descriptors()))
}

// --- document loading / construction ----------------------------------------

#[tauri::command]
pub fn cp_load_cp(
    text: String,
    title: String,
    state: State<'_, CpEngine>,
) -> Result<u32, EngineError> {
    locked(&state, |session| session.load_cp(&text, &title))
}

#[tauri::command]
pub fn cp_load_fold(
    text: String,
    title: String,
    state: State<'_, CpEngine>,
) -> Result<u32, EngineError> {
    locked(&state, |session| session.load_fold(&text, &title))
}

#[tauri::command]
pub fn cp_load_fold_file(text: String, state: State<'_, CpEngine>) -> Result<u32, EngineError> {
    locked(&state, |session| session.load_fold_file(&text))
}

#[tauri::command]
pub fn cp_load_ori(
    text: String,
    accept_unknown_version: bool,
    state: State<'_, CpEngine>,
) -> Result<u32, EngineError> {
    locked(&state, |session| {
        session.load_ori(&text, accept_unknown_version)
    })
}

#[tauri::command]
pub fn cp_load_orh(text: String, state: State<'_, CpEngine>) -> Result<u32, EngineError> {
    locked(&state, |session| session.load_orh(&text))
}

#[tauri::command]
pub fn cp_load_document(
    document: CreasePatternDocument,
    state: State<'_, CpEngine>,
) -> Result<u32, EngineError> {
    locked(&state, |session| Ok(session.load_document(document)))
}

// --- document lifecycle / read ----------------------------------------------

#[tauri::command]
pub fn cp_restore_document(
    handle: u32,
    document: CreasePatternDocument,
    state: State<'_, CpEngine>,
) -> Result<(), EngineError> {
    locked(&state, |session| session.restore_document(handle, document))
}

#[tauri::command]
pub fn cp_document_snapshot(
    handle: u32,
    state: State<'_, CpEngine>,
) -> Result<CreasePatternDocument, EngineError> {
    locked(&state, |session| session.document_snapshot(handle))
}

#[tauri::command]
pub fn cp_document_geometry(
    handle: u32,
    state: State<'_, CpEngine>,
) -> Result<CompactGeometry, EngineError> {
    locked(&state, |session| session.document_geometry(handle))
}

#[tauri::command]
pub fn cp_restore_from_compact(
    handle: u32,
    geometry: CompactGeometry,
    state: State<'_, CpEngine>,
) -> Result<(), EngineError> {
    locked(&state, |session| {
        session.restore_from_compact(handle, &geometry)
    })
}

#[tauri::command]
pub fn cp_document_summary(
    handle: u32,
    state: State<'_, CpEngine>,
) -> Result<DocumentSummary, EngineError> {
    locked(&state, |session| session.document_summary(handle))
}

#[tauri::command]
pub fn cp_free_document(handle: u32, state: State<'_, CpEngine>) -> Result<(), EngineError> {
    locked(&state, |session| session.free_document(handle))
}

// --- editing commands -------------------------------------------------------

#[tauri::command]
pub fn cp_execute_command(
    handle: u32,
    operation: OperationId,
    payload: CreasePatternCommandPayload,
    state: State<'_, CpEngine>,
) -> Result<CommandResult, EngineError> {
    locked(&state, |session| {
        session.execute_command(handle, operation, payload)
    })
}

#[tauri::command]
pub fn cp_preview_command(
    handle: u32,
    operation: OperationId,
    payload: CreasePatternCommandPayload,
    state: State<'_, CpEngine>,
) -> Result<CommandPreview, EngineError> {
    locked(&state, |session| {
        session.preview_command(handle, operation, payload)
    })
}

#[tauri::command]
pub fn cp_insert_line_segments(
    handle: u32,
    segments: Vec<LineSegment>,
    state: State<'_, CpEngine>,
) -> Result<u32, EngineError> {
    locked(&state, |session| {
        session.insert_line_segments(handle, &segments)
    })
}

#[tauri::command]
pub fn cp_deselect_all(handle: u32, state: State<'_, CpEngine>) -> Result<u32, EngineError> {
    locked(&state, |session| session.deselect_all(handle))
}

#[tauri::command]
pub fn cp_import_add(
    handle: u32,
    imported_handle: u32,
    state: State<'_, CpEngine>,
) -> Result<u32, EngineError> {
    locked(&state, |session| {
        session.import_add(handle, imported_handle)
    })
}

#[tauri::command]
pub fn cp_replace_line_segments(
    handle: u32,
    line_ids: Vec<usize>,
    segments: Vec<LineSegment>,
    state: State<'_, CpEngine>,
) -> Result<u32, EngineError> {
    locked(&state, |session| {
        session.replace_line_segments(handle, &line_ids, &segments)
    })
}

// --- export -----------------------------------------------------------------

#[tauri::command]
pub fn cp_export_cp(handle: u32, state: State<'_, CpEngine>) -> Result<String, EngineError> {
    locked(&state, |session| session.export_cp(handle))
}

#[tauri::command]
pub fn cp_export_fold(handle: u32, state: State<'_, CpEngine>) -> Result<String, EngineError> {
    locked(&state, |session| session.export_fold(handle))
}

#[tauri::command]
pub fn cp_export_fold_file(handle: u32, state: State<'_, CpEngine>) -> Result<String, EngineError> {
    locked(&state, |session| session.export_fold_file(handle))
}

#[tauri::command]
pub fn cp_export_ori(handle: u32, state: State<'_, CpEngine>) -> Result<String, EngineError> {
    locked(&state, |session| session.export_ori(handle))
}

#[tauri::command]
pub fn cp_export_orh(handle: u32, state: State<'_, CpEngine>) -> Result<String, EngineError> {
    locked(&state, |session| session.export_orh(handle))
}

// --- folding ----------------------------------------------------------------

#[tauri::command]
pub fn cp_folded_figure_fold(
    document_handle: u32,
    starting_face_id: i32,
    order: EstimationOrder,
    model: FoldedFigureModel,
    state: State<'_, CpEngine>,
) -> Result<FoldedFigureResult, EngineError> {
    locked(&state, |session| {
        session.folded_figure_fold(document_handle, starting_face_id, order, model)
    })
}

#[tauri::command]
pub fn cp_folded_figure_fold_selected(
    document_handle: u32,
    selected_line_ids: Vec<usize>,
    starting_face_id: i32,
    order: EstimationOrder,
    model: FoldedFigureModel,
    state: State<'_, CpEngine>,
) -> Result<FoldedFigureResult, EngineError> {
    locked(&state, |session| {
        session.folded_figure_fold_selected(
            document_handle,
            &selected_line_ids,
            starting_face_id,
            order,
            model,
        )
    })
}

#[tauri::command]
pub fn cp_folded_figure_snapshot(
    handle: u32,
    state: State<'_, CpEngine>,
) -> Result<FoldedFigureSnapshot, EngineError> {
    locked(&state, |session| session.folded_figure_snapshot(handle))
}

#[tauri::command]
pub fn cp_folded_figure_render_snapshot(
    handle: u32,
    display_style: Option<DisplayStyle>,
    options: FoldedFigureRenderOptions,
    state: State<'_, CpEngine>,
) -> Result<Option<FoldedFigureRenderSnapshot>, EngineError> {
    locked(&state, |session| {
        session.folded_figure_render_snapshot(handle, display_style, options)
    })
}

#[tauri::command]
pub fn cp_folded_figure_set_model(
    handle: u32,
    model: FoldedFigureModel,
    state: State<'_, CpEngine>,
) -> Result<FoldedFigureSnapshot, EngineError> {
    locked(&state, |session| {
        session.folded_figure_set_model(handle, model)
    })
}

#[tauri::command]
pub fn cp_folded_figure_duplicate(
    handle: u32,
    state: State<'_, CpEngine>,
) -> Result<FoldedFigureResult, EngineError> {
    locked(&state, |session| session.folded_figure_duplicate(handle))
}

#[tauri::command]
pub fn cp_folded_figure_fold_another(
    handle: u32,
    state: State<'_, CpEngine>,
) -> Result<FoldedFigureSnapshot, EngineError> {
    locked(&state, |session| session.folded_figure_fold_another(handle))
}

#[tauri::command]
pub fn cp_folded_figure_fold_to_case(
    handle: u32,
    objective: u32,
    initial_order: EstimationOrder,
    state: State<'_, CpEngine>,
) -> Result<FoldedFigureBatchResult, EngineError> {
    locked(&state, |session| {
        session.folded_figure_fold_to_case(handle, objective as usize, initial_order)
    })
}

#[tauri::command]
pub fn cp_free_folded_figure(handle: u32, state: State<'_, CpEngine>) -> Result<(), EngineError> {
    locked(&state, |session| session.free_folded_figure(handle))
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
    "cp_folded_figure_fold",
    "cp_folded_figure_fold_selected",
    "cp_folded_figure_snapshot",
    "cp_folded_figure_render_snapshot",
    "cp_folded_figure_set_model",
    "cp_folded_figure_duplicate",
    "cp_folded_figure_fold_another",
    "cp_folded_figure_fold_to_case",
    "cp_free_folded_figure",
];

#[cfg(test)]
mod tests {
    use super::{NATIVE_CP_COMMAND_NAMES, new_state};
    use oristudio_cp::session::CP_ENGINE_COMMANDS;

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

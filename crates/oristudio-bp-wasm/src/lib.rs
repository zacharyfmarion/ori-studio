//! `wasm-bindgen` wrapper around `oristudio-bp`.

use oristudio_bp::engine::{BpProjectSession, BpSession};
use oristudio_bp::io::cp::{
    CpExportOptions, CpFormat, project_crease_pattern_snapshot, project_graphics_snapshot,
};
use oristudio_bp::optimizer::{
    LayoutMode, OptimizerOptionsBase, OptimizerRequest, OptimizerResult, OptimizerSolveReport,
    check_optimizer_result, create_optimizer_request, solve, solve_report, solve_with_progress,
    validate_optimizer_packing, write_to_template,
};
use oristudio_bp::{BpError, GridType, Point, Project, io, port_descriptors};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use wasm_bindgen::prelude::*;

thread_local! {
    static SESSIONS: RefCell<Vec<Option<BpProjectSession>>> = const { RefCell::new(Vec::new()) };
}

#[derive(Serialize)]
struct JsErrorEnvelope {
    code: &'static str,
    message: String,
}

#[derive(Serialize)]
struct ProjectSummary {
    version: String,
    title: String,
    mode: String,
    layout_flaps: usize,
    layout_stretches: usize,
    tree_nodes: usize,
    tree_edges: usize,
}

#[derive(Serialize)]
struct PackingValidationReport {
    valid: bool,
    errors: Vec<PackingValidationError>,
}

#[derive(Serialize)]
struct PackingValidationError {
    message: String,
}

#[derive(Serialize)]
struct WorkspaceProject {
    filename: String,
    handle: u32,
    project: Project,
    summary: ProjectSummary,
}

#[derive(Serialize)]
struct OpenedProject {
    handle: u32,
    project: Project,
    summary: ProjectSummary,
}

#[derive(Serialize)]
struct HistoryNavigationProject {
    project: Project,
    selection: Vec<String>,
}

#[derive(Deserialize)]
struct WorkspaceExportProject {
    filename: String,
    handle: u32,
}

#[wasm_bindgen]
pub fn bp_port_descriptors() -> Result<JsValue, JsValue> {
    to_js_value(&port_descriptors())
}

#[wasm_bindgen]
pub fn bp_new_sample_project() -> Result<u32, JsValue> {
    store_project(Project::sample())
}

#[wasm_bindgen]
pub fn bp_load_project(text: &str) -> Result<u32, JsValue> {
    let project = io::bps::load_project_str(text).map_err(to_js_bp_error)?;
    store_project(project)
}

#[wasm_bindgen]
pub fn bp_import_treemaker(title: &str, text: &str) -> Result<u32, JsValue> {
    let project = io::treemaker_import::tree_maker(title, text).map_err(to_js_bp_error)?;
    store_project(project)
}

#[wasm_bindgen]
pub fn bp_load_workspace(bytes: &[u8]) -> Result<JsValue, JsValue> {
    let entries = io::bpz::read_workspace_project_entries(bytes).map_err(to_js_bp_error)?;
    let mut handles = Vec::new();
    let mut projects = Vec::new();

    for (filename, project) in entries {
        let handle = match store_project(project.clone()) {
            Ok(handle) => handle,
            Err(error) => {
                free_handles(&handles);
                return Err(error);
            }
        };
        handles.push(handle);
        projects.push(WorkspaceProject {
            filename,
            handle,
            summary: summary_for_project(&project),
            project,
        });
    }

    to_js_value(&projects).inspect_err(|_| free_handles(&handles))
}

#[wasm_bindgen]
pub fn bp_project_snapshot(handle: u32) -> Result<JsValue, JsValue> {
    with_session(handle, |session| to_js_value(&session.project_for_export()))
}

#[wasm_bindgen]
pub fn bp_project_summary(handle: u32) -> Result<JsValue, JsValue> {
    with_project(handle, |project| to_js_value(&summary_for_project(project)))
}

#[wasm_bindgen]
pub fn bp_project_tree_data(handle: u32) -> Result<JsValue, JsValue> {
    with_session(handle, |session| {
        let tree = session.tree_data().map_err(to_js_bp_error)?;
        to_js_value(&tree)
    })
}

#[wasm_bindgen]
pub fn bp_project_layout_snapshot(handle: u32) -> Result<JsValue, JsValue> {
    with_session(handle, |session| {
        let snapshot = project_graphics_snapshot(session.project()).map_err(to_js_bp_error)?;
        to_js_value(&snapshot)
    })
}

#[wasm_bindgen]
pub fn bp_project_crease_pattern_snapshot(
    handle: u32,
    reorient: bool,
    use_auxiliary: bool,
) -> Result<JsValue, JsValue> {
    with_project(handle, |project| {
        let snapshot = project_crease_pattern_snapshot(
            project,
            CpExportOptions {
                format: CpFormat::Cp,
                reorient,
                use_auxiliary,
                ..CpExportOptions::default()
            },
        )
        .map_err(to_js_bp_error)?;
        to_js_value(&snapshot)
    })
}

#[wasm_bindgen]
pub fn bp_project_packing_validation(handle: u32) -> Result<JsValue, JsValue> {
    with_project(handle, |project| {
        to_js_value(&packing_validation_report(project))
    })
}

#[wasm_bindgen]
pub fn bp_undo_project(handle: u32) -> Result<JsValue, JsValue> {
    with_session_mut(handle, |session| {
        let selection = session.undo().map_err(to_js_bp_error)?;
        to_js_value(&HistoryNavigationProject {
            project: session.project_for_export(),
            selection,
        })
    })
}

#[wasm_bindgen]
pub fn bp_redo_project(handle: u32) -> Result<JsValue, JsValue> {
    with_session_mut(handle, |session| {
        let selection = session.redo().map_err(to_js_bp_error)?;
        to_js_value(&HistoryNavigationProject {
            project: session.project_for_export(),
            selection,
        })
    })
}

#[wasm_bindgen]
pub fn bp_notify_project_saved(handle: u32) -> Result<(), JsValue> {
    with_session_mut(handle, |session| {
        session.notify_save();
        Ok(())
    })
}

#[wasm_bindgen]
pub fn bp_move_tree_vertex(
    handle: u32,
    id: u32,
    x: f64,
    y: f64,
    dragging: bool,
) -> Result<JsValue, JsValue> {
    with_session_mut(handle, |session| {
        session
            .move_vertex(id, Point { x, y }, dragging)
            .map_err(to_js_bp_error)?;
        to_js_value(&session.project_for_export())
    })
}

#[wasm_bindgen]
pub fn bp_rename_tree_vertex(handle: u32, id: u32, name: &str) -> Result<JsValue, JsValue> {
    with_session_mut(handle, |session| {
        session
            .rename_vertex(id, name.to_string())
            .map_err(to_js_bp_error)?;
        to_js_value(&session.project_for_export())
    })
}

#[wasm_bindgen]
pub fn bp_update_tree_edge_length(
    handle: u32,
    n1: u32,
    n2: u32,
    length: f64,
    dragging: bool,
) -> Result<JsValue, JsValue> {
    with_session_mut(handle, |session| {
        session
            .update_edge_length(n1, n2, length, dragging)
            .map_err(to_js_bp_error)?;
        to_js_value(&session.project_for_export())
    })
}

#[wasm_bindgen]
pub fn bp_add_tree_leaf(handle: u32, at: u32, length: f64) -> Result<JsValue, JsValue> {
    with_session_mut(handle, |session| {
        session.add_leaf(at, length).map_err(to_js_bp_error)?;
        to_js_value(&session.project_for_export())
    })
}

/// Delete a batch of leaves in one round, as BP Studio's `$delete(vertices)`
/// does. The batch matters: `remove_leaf` simulates the whole round before
/// touching the tree, so the cascade (a parent that becomes a leaf once its
/// child goes) and the `MIN_VERTICES` floor are decided across every id at
/// once, rather than once per call.
#[wasm_bindgen]
pub fn bp_delete_tree_leaves(handle: u32, ids: JsValue) -> Result<JsValue, JsValue> {
    let ids = from_js_value::<Vec<u32>>(ids)?;
    with_session_mut(handle, |session| {
        session.remove_leaf(ids).map_err(to_js_bp_error)?;
        to_js_value(&session.project_for_export())
    })
}

#[wasm_bindgen]
pub fn bp_join_tree_vertex(handle: u32, id: u32) -> Result<JsValue, JsValue> {
    with_session_mut(handle, |session| {
        session.join_vertex(id).map_err(to_js_bp_error)?;
        to_js_value(&session.project_for_export())
    })
}

#[wasm_bindgen]
pub fn bp_split_tree_edge(handle: u32, n1: u32, n2: u32) -> Result<JsValue, JsValue> {
    with_session_mut(handle, |session| {
        session.split_edge(n1, n2).map_err(to_js_bp_error)?;
        to_js_value(&session.project_for_export())
    })
}

#[wasm_bindgen]
pub fn bp_merge_tree_edge(handle: u32, n1: u32, n2: u32) -> Result<JsValue, JsValue> {
    with_session_mut(handle, |session| {
        session.merge_edge(n1, n2).map_err(to_js_bp_error)?;
        to_js_value(&session.project_for_export())
    })
}

#[wasm_bindgen]
pub fn bp_move_layout_flap(
    handle: u32,
    id: u32,
    x: f64,
    y: f64,
    dragging: bool,
) -> Result<JsValue, JsValue> {
    with_session_mut(handle, |session| {
        session
            .move_flap(id, Point { x, y }, dragging)
            .map_err(to_js_bp_error)?;
        to_js_value(&session.project_for_export())
    })
}

#[wasm_bindgen]
pub fn bp_move_layout_flaps(
    handle: u32,
    ids: JsValue,
    x: f64,
    y: f64,
    dragging: bool,
) -> Result<JsValue, JsValue> {
    let ids = from_js_value::<Vec<u32>>(ids)?;
    with_session_mut(handle, |session| {
        session
            .move_flaps(&ids, Point { x, y }, dragging)
            .map_err(to_js_bp_error)?;
        to_js_value(&session.project_for_export())
    })
}

#[wasm_bindgen]
pub fn bp_resize_layout_flap(
    handle: u32,
    id: u32,
    width: f64,
    height: f64,
) -> Result<JsValue, JsValue> {
    with_session_mut(handle, |session| {
        session
            .resize_flap(id, width, height)
            .map_err(to_js_bp_error)?;
        to_js_value(&session.project_for_export())
    })
}

#[wasm_bindgen]
pub fn bp_subdivide_layout_sheet(handle: u32) -> Result<JsValue, JsValue> {
    with_session_mut(handle, |session| {
        session.subdivide_layout_sheet().map_err(to_js_bp_error)?;
        to_js_value(&session.project_for_export())
    })
}

#[wasm_bindgen]
pub fn bp_unsubdivide_layout_sheet(handle: u32) -> Result<JsValue, JsValue> {
    with_session_mut(handle, |session| {
        session.unsubdivide_layout_sheet().map_err(to_js_bp_error)?;
        to_js_value(&session.project_for_export())
    })
}

#[wasm_bindgen]
pub fn bp_rotate_layout_sheet(handle: u32, clockwise: bool) -> Result<JsValue, JsValue> {
    with_session_mut(handle, |session| {
        session
            .rotate_layout_sheet(clockwise)
            .map_err(to_js_bp_error)?;
        to_js_value(&session.project_for_export())
    })
}

#[wasm_bindgen]
pub fn bp_flip_layout_sheet(handle: u32, horizontal: bool) -> Result<JsValue, JsValue> {
    with_session_mut(handle, |session| {
        session
            .flip_layout_sheet(horizontal)
            .map_err(to_js_bp_error)?;
        to_js_value(&session.project_for_export())
    })
}

#[wasm_bindgen]
/// Resize the layout sheet. A `null`/`undefined` dimension keeps whatever the
/// session's sheet has now, so a caller editing one dimension never has to
/// restate the other from a snapshot that may already be stale.
pub fn bp_update_layout_sheet(
    handle: u32,
    grid_type: &str,
    width: Option<f64>,
    height: Option<f64>,
) -> Result<JsValue, JsValue> {
    let grid_type = parse_grid_type(grid_type)?;
    with_session_mut(handle, |session| {
        session
            .update_layout_sheet(grid_type, width, height)
            .map_err(to_js_bp_error)?;
        to_js_value(&session.project_for_export())
    })
}

#[wasm_bindgen]
pub fn bp_complete_stretch(handle: u32, id: &str) -> Result<JsValue, JsValue> {
    with_session_mut(handle, |session| {
        session.complete_stretch(id).map_err(to_js_bp_error)?;
        to_js_value(&session.project_for_export())
    })
}

#[wasm_bindgen]
pub fn bp_switch_stretch_config(handle: u32, id: &str, delta: i32) -> Result<JsValue, JsValue> {
    with_session_mut(handle, |session| {
        session
            .switch_stretch_config(id, delta as isize)
            .map_err(to_js_bp_error)?;
        to_js_value(&session.project_for_export())
    })
}

#[wasm_bindgen]
pub fn bp_switch_stretch_pattern(handle: u32, id: &str, delta: i32) -> Result<JsValue, JsValue> {
    with_session_mut(handle, |session| {
        session
            .switch_stretch_pattern(id, delta as isize)
            .map_err(to_js_bp_error)?;
        to_js_value(&session.project_for_export())
    })
}

#[wasm_bindgen]
pub fn bp_move_device(
    handle: u32,
    id: &str,
    device_index: usize,
    x: f64,
    y: f64,
    dragging: bool,
) -> Result<JsValue, JsValue> {
    with_session_mut(handle, |session| {
        session
            .move_device(id, device_index, Point { x, y }, dragging)
            .map_err(to_js_bp_error)?;
        to_js_value(&session.project_for_export())
    })
}

#[wasm_bindgen]
pub fn bp_export_bps(handle: u32) -> Result<String, JsValue> {
    with_session(handle, |session| {
        io::bps::save_project_string(&session.project_for_export()).map_err(to_js_bp_error)
    })
}

#[wasm_bindgen]
pub fn bp_export_workspace(projects: JsValue) -> Result<Vec<u8>, JsValue> {
    let projects = from_js_value::<Vec<WorkspaceExportProject>>(projects)?;
    let mut entries = Vec::with_capacity(projects.len());
    for project in projects {
        entries.push((project.filename, clone_project(project.handle)?));
    }
    io::bpz::write_workspace_project_entries(&entries).map_err(to_js_bp_error)
}

#[wasm_bindgen]
pub fn bp_export_cp(
    handle: u32,
    reorient: bool,
    use_auxiliary: bool,
    cp_scale: f64,
) -> Result<String, JsValue> {
    with_project(handle, |project| {
        io::cp::export_project(
            project,
            CpExportOptions {
                format: CpFormat::Cp,
                reorient,
                use_auxiliary,
                cp_scale,
            },
        )
        .map_err(to_js_bp_error)
    })
}

#[wasm_bindgen]
pub fn bp_export_fold(handle: u32, reorient: bool, use_auxiliary: bool) -> Result<String, JsValue> {
    with_project(handle, |project| {
        io::cp::export_project(
            project,
            CpExportOptions {
                format: CpFormat::Fold,
                reorient,
                use_auxiliary,
                ..CpExportOptions::default()
            },
        )
        .map_err(to_js_bp_error)
    })
}

#[wasm_bindgen]
pub fn bp_optimizer_request(
    handle: u32,
    layout: &str,
    use_bh: bool,
    random: usize,
    use_dimension: bool,
    // Entropy for the coincident-flap jitter. Upstream reads `Math.random()`
    // inline; the caller passes it in so this crate stays deterministic given
    // its inputs.
    jitter_seed: u32,
) -> Result<JsValue, JsValue> {
    with_project(handle, |project| {
        let layout = parse_layout_mode(layout)?;
        let (session, _) = BpSession::from_design(&project.design).map_err(to_js_bp_error)?;
        let hierarchies = session
            .get_hierarchy(layout == LayoutMode::Random, use_dimension)
            .map_err(to_js_bp_error)?;
        let request = create_optimizer_request(
            project,
            hierarchies,
            OptimizerOptionsBase {
                layout,
                use_bh,
                random,
            },
            use_dimension,
            jitter_seed,
        )
        .map_err(to_js_bp_error)?;
        to_js_value(&request)
    })
}

#[wasm_bindgen]
pub fn bp_check_optimizer_result(result: JsValue) -> Result<(), JsValue> {
    let result = from_js_value::<OptimizerResult>(result)?;
    check_optimizer_result(&result).map_err(to_js_bp_error)
}

#[wasm_bindgen]
pub fn bp_validate_optimizer_packing(request: JsValue, result: JsValue) -> Result<(), JsValue> {
    let request = from_js_value::<OptimizerRequest>(request)?;
    let result = from_js_value::<OptimizerResult>(result)?;
    validate_optimizer_packing(&request, &result).map_err(to_js_bp_error)
}

#[wasm_bindgen]
pub fn bp_optimizer_template(
    handle: u32,
    request: JsValue,
    result: JsValue,
) -> Result<JsValue, JsValue> {
    let request = from_js_value::<OptimizerRequest>(request)?;
    let result = from_js_value::<OptimizerResult>(result)?;
    with_project(handle, |project| {
        let next = write_to_template(project, &request, &result).map_err(to_js_bp_error)?;
        to_js_value(&next)
    })
}

#[wasm_bindgen]
pub fn bp_replace_with_optimizer_template(
    handle: u32,
    request: JsValue,
    result: JsValue,
) -> Result<JsValue, JsValue> {
    let request = from_js_value::<OptimizerRequest>(request)?;
    let result = from_js_value::<OptimizerResult>(result)?;
    with_session_mut(handle, |session| {
        let next =
            write_to_template(session.project(), &request, &result).map_err(to_js_bp_error)?;
        session
            .apply_optimizer_layout(next.design.layout.sheet, next.design.layout.flaps)
            .map_err(to_js_bp_error)?;
        to_js_value(&session.project_for_export())
    })
}

#[wasm_bindgen]
pub fn bp_open_optimizer_template(
    handle: u32,
    request: JsValue,
    result: JsValue,
) -> Result<JsValue, JsValue> {
    let request = from_js_value::<OptimizerRequest>(request)?;
    let result = from_js_value::<OptimizerResult>(result)?;
    let project = with_project(handle, |project| {
        write_to_template(project, &request, &result).map_err(to_js_bp_error)
    })?;
    let handle = store_project(project.clone())?;
    to_js_value(&OpenedProject {
        handle,
        summary: summary_for_project(&project),
        project,
    })
    .inspect_err(|_| {
        let _ = bp_free_project(handle);
    })
}

#[wasm_bindgen]
pub fn bp_optimizer_solve(request: JsValue, seed: Option<f64>) -> Result<JsValue, JsValue> {
    let request = from_js_value::<OptimizerRequest>(request)?;
    let seed = parse_seed(seed)?;
    let result = solve(&request, seed).map_err(to_js_bp_error)?;
    to_js_value(&result)
}

#[wasm_bindgen]
pub fn bp_optimizer_solve_report(request: JsValue, seed: Option<f64>) -> Result<JsValue, JsValue> {
    let request = from_js_value::<OptimizerRequest>(request)?;
    let seed = parse_seed(seed)?;
    let report = solve_report(&request, seed).map_err(to_js_bp_error)?;
    to_js_value(&report)
}

#[wasm_bindgen]
pub fn bp_optimizer_solve_report_with_progress(
    request: JsValue,
    seed: Option<f64>,
    on_event: js_sys::Function,
) -> Result<JsValue, JsValue> {
    let request = from_js_value::<OptimizerRequest>(request)?;
    let seed = parse_seed(seed)?;
    let mut events = Vec::new();
    let mut callback_error: Option<JsValue> = None;
    let this = JsValue::NULL;
    let result = solve_with_progress(
        &request,
        seed,
        || false,
        |event| {
            if callback_error.is_none() {
                match to_js_value(&event)
                    .and_then(|value| on_event.call1(&this, &value).map(|_| ()))
                {
                    Ok(()) => {}
                    Err(error) => callback_error = Some(error),
                }
            }
            events.push(event);
        },
    )
    .map_err(to_js_bp_error)?;
    if let Some(error) = callback_error {
        return Err(error);
    }
    to_js_value(&OptimizerSolveReport { result, events })
}

#[wasm_bindgen]
pub fn bp_free_project(handle: u32) -> Result<(), JsValue> {
    SESSIONS.with(|sessions| {
        let mut sessions = sessions.borrow_mut();
        let slot = sessions
            .get_mut(handle as usize)
            .ok_or_else(|| js_error("invalid_handle", "invalid BpSession handle"))?;
        *slot = None;
        Ok(())
    })
}

fn store_project(project: Project) -> Result<u32, JsValue> {
    let session = BpProjectSession::new(project).map_err(to_js_bp_error)?;
    SESSIONS.with(|sessions| {
        let mut sessions = sessions.borrow_mut();
        if let Some((index, slot)) = sessions
            .iter_mut()
            .enumerate()
            .find(|(_, slot)| slot.is_none())
        {
            *slot = Some(session);
            Ok(index as u32)
        } else {
            sessions.push(Some(session));
            Ok((sessions.len() - 1) as u32)
        }
    })
}

fn with_project<T>(
    handle: u32,
    f: impl FnOnce(&Project) -> Result<T, JsValue>,
) -> Result<T, JsValue> {
    with_session(handle, |session| f(session.project()))
}

fn with_session<T>(
    handle: u32,
    f: impl FnOnce(&BpProjectSession) -> Result<T, JsValue>,
) -> Result<T, JsValue> {
    SESSIONS.with(|sessions| {
        let sessions = sessions.borrow();
        let session = sessions
            .get(handle as usize)
            .and_then(Option::as_ref)
            .ok_or_else(|| js_error("invalid_handle", "invalid BpSession handle"))?;
        f(session)
    })
}

fn with_session_mut<T>(
    handle: u32,
    f: impl FnOnce(&mut BpProjectSession) -> Result<T, JsValue>,
) -> Result<T, JsValue> {
    SESSIONS.with(|sessions| {
        let mut sessions = sessions.borrow_mut();
        let session = sessions
            .get_mut(handle as usize)
            .and_then(Option::as_mut)
            .ok_or_else(|| js_error("invalid_handle", "invalid BpSession handle"))?;
        f(session)
    })
}

fn clone_project(handle: u32) -> Result<Project, JsValue> {
    with_session(handle, |session| Ok(session.project_for_export()))
}

fn free_handles(handles: &[u32]) {
    for handle in handles {
        let _ = bp_free_project(*handle);
    }
}

fn summary_for_project(project: &Project) -> ProjectSummary {
    ProjectSummary {
        version: project.version.clone(),
        title: project.design.title.clone(),
        mode: match project.design.mode {
            oristudio_bp::DesignMode::Layout => "layout".to_string(),
            oristudio_bp::DesignMode::Tree => "tree".to_string(),
        },
        layout_flaps: project.design.layout.flaps.len(),
        layout_stretches: project.design.layout.stretches.len(),
        tree_nodes: project.design.tree.nodes.len(),
        tree_edges: project.design.tree.edges.len(),
    }
}

fn to_js_value<T: Serialize + ?Sized>(value: &T) -> Result<JsValue, JsValue> {
    serde_wasm_bindgen::to_value(value).map_err(to_js_value_error)
}

fn from_js_value<T>(value: JsValue) -> Result<T, JsValue>
where
    T: serde::de::DeserializeOwned,
{
    serde_wasm_bindgen::from_value(value).map_err(to_js_value_error)
}

fn to_js_bp_error(error: oristudio_bp::BpError) -> JsValue {
    let code = match &error {
        BpError::UnsupportedOperation { .. } => "unsupported_operation",
        BpError::UpstreamGap { .. } => "upstream_gap",
        BpError::InvalidInput(_) => "invalid_input",
        BpError::IncompatibleProject(_) => "incompatible_project",
        BpError::OptimizationFailed(_) => "optimization_failed",
        BpError::OptimizationCancelled => "optimization_cancelled",
        BpError::OracleMismatch(_) => "oracle_mismatch",
        BpError::Json(_) => "json_error",
        BpError::Io(_) => "io_error",
        BpError::Zip(_) => "zip_error",
    };
    js_error(code, error.to_string())
}

fn to_js_value_error(error: serde_wasm_bindgen::Error) -> JsValue {
    js_error("value_error", error.to_string())
}

fn packing_validation_report(project: &Project) -> PackingValidationReport {
    match validate_project_packing(project) {
        Ok(()) => PackingValidationReport {
            valid: true,
            errors: Vec::new(),
        },
        Err(error) => PackingValidationReport {
            valid: false,
            errors: vec![PackingValidationError {
                message: error.to_string(),
            }],
        },
    }
}

fn validate_project_packing(project: &Project) -> oristudio_bp::BpResult<()> {
    let (session, _) = BpSession::from_design(&project.design)?;
    let hierarchies = session.get_hierarchy(true, true)?;
    let request = create_optimizer_request(
        project,
        hierarchies,
        OptimizerOptionsBase {
            layout: LayoutMode::Random,
            use_bh: false,
            random: 0,
        },
        true,
        // Random mode builds no initial vector, so the jitter never runs here.
        0,
    )?;
    let result = OptimizerResult {
        width: project.design.layout.sheet.width,
        height: project.design.layout.sheet.height,
        flaps: project
            .design
            .layout
            .flaps
            .iter()
            .map(|flap| oristudio_bp::optimizer::FlapResult {
                id: flap.id,
                x: flap.x,
                y: flap.y,
            })
            .collect(),
    };
    validate_optimizer_packing(&request, &result)
}

fn parse_layout_mode(layout: &str) -> Result<LayoutMode, JsValue> {
    match layout {
        "view" => Ok(LayoutMode::View),
        "random" => Ok(LayoutMode::Random),
        _ => Err(js_error(
            "invalid_input",
            format!("unknown optimizer layout mode: {layout}"),
        )),
    }
}

fn parse_grid_type(grid_type: &str) -> Result<GridType, JsValue> {
    match grid_type {
        "rect" | "rectangular" => Ok(GridType::Rectangular),
        "diag" | "diagonal" => Ok(GridType::Diagonal),
        _ => Err(js_error(
            "invalid_input",
            format!("unknown BP grid type: {grid_type}"),
        )),
    }
}

fn parse_seed(seed: Option<f64>) -> Result<Option<u64>, JsValue> {
    let Some(seed) = seed else {
        return Ok(None);
    };
    if !seed.is_finite() || seed < 0.0 || seed.fract() != 0.0 || seed > u64::MAX as f64 {
        return Err(js_error(
            "invalid_input",
            format!("optimizer seed must be an unsigned integer: {seed}"),
        ));
    }
    Ok(Some(seed as u64))
}

fn js_error(code: &'static str, message: impl Into<String>) -> JsValue {
    serde_wasm_bindgen::to_value(&JsErrorEnvelope {
        code,
        message: message.into(),
    })
    .unwrap_or_else(|_| JsValue::from_str(code))
}

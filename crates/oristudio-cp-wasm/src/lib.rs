//! `wasm-bindgen` wrapper around `oristudio-cp`.
//!
//! The wasm API stores editable crease-pattern documents behind integer
//! handles so the web worker can keep command calls cheap and explicit.

use oristudio_cp::folding::{
    DisplayStyle, EstimationOrder, FoldedFigureModel, FoldedFigureRenderOptions,
    FoldedFigureSnapshot, FoldingEstimateError, FoldingEstimateSession, fold_another,
    folded_figure_render_snapshot_from_session, folded_figure_snapshot_from_session,
    folding_estimate_to_case,
};
use oristudio_cp::{
    CommandError, CreasePatternCommand, CreasePatternCommandPayload, CreasePatternDocument,
    OperationCategory, OperationDescriptor, OperationId, OperationStatus, execute_command, io,
    operation_descriptors, preview_command,
};
use serde::Serialize;
use std::cell::RefCell;
use wasm_bindgen::prelude::*;

thread_local! {
    static DOCUMENTS: RefCell<Vec<Option<CreasePatternDocument>>> = const { RefCell::new(Vec::new()) };
    static FOLDED_FIGURES: RefCell<Vec<Option<WasmFoldedFigure>>> = const { RefCell::new(Vec::new()) };
}

#[derive(Serialize)]
struct JsErrorEnvelope {
    code: &'static str,
    message: String,
}

#[derive(Serialize)]
struct JsOperationDescriptor {
    id: OperationId,
    upstream: &'static str,
    target: &'static str,
    category: OperationCategory,
    stage: u8,
    status: OperationStatus,
}

impl From<&'static OperationDescriptor> for JsOperationDescriptor {
    fn from(descriptor: &'static OperationDescriptor) -> Self {
        Self {
            id: descriptor.id,
            upstream: descriptor.upstream,
            target: descriptor.target,
            category: descriptor.category,
            stage: descriptor.stage,
            status: descriptor.status,
        }
    }
}

#[derive(Serialize)]
struct DocumentSummary {
    title: Option<String>,
    line_segments: usize,
    circles: usize,
    points: usize,
    aux_line_segments: usize,
    texts: usize,
    can_save_as_cp: bool,
    is_empty: bool,
}

struct WasmFoldedFigure {
    session: FoldingEstimateSession,
    model: FoldedFigureModel,
}

#[derive(Serialize)]
struct JsFoldedFigureResult {
    handle: u32,
    snapshot: FoldedFigureSnapshot,
}

#[derive(Serialize)]
struct JsFoldedFigureBatchResult {
    snapshot: FoldedFigureSnapshot,
    discovered_case_numbers: Vec<usize>,
}

#[wasm_bindgen]
pub fn cp_operation_descriptors() -> Result<JsValue, JsValue> {
    let descriptors = operation_descriptors()
        .iter()
        .map(JsOperationDescriptor::from)
        .collect::<Vec<_>>();
    to_js_value(&descriptors)
}

#[wasm_bindgen]
pub fn load_cp(text: &str, title: &str) -> Result<u32, JsValue> {
    let model = io::cp::import_cp_str(text).map_err(to_js_io_error)?;
    store_document(CreasePatternDocument {
        title: title_from_js(title),
        crease_pattern: model,
        operation_frame: Default::default(),
        metadata: Default::default(),
    })
}

#[wasm_bindgen]
pub fn load_fold(text: &str, title: &str) -> Result<u32, JsValue> {
    let model = io::fold::import_fold_json(text).map_err(to_js_io_error)?;
    store_document(CreasePatternDocument {
        title: title_from_js(title),
        crease_pattern: model,
        operation_frame: Default::default(),
        metadata: Default::default(),
    })
}

#[wasm_bindgen]
pub fn load_fold_file(text: &str) -> Result<u32, JsValue> {
    let document = io::fold::import_fold_file_document_json(text).map_err(to_js_io_error)?;
    store_document(document)
}

#[wasm_bindgen]
pub fn load_ori(text: &str, accept_unknown_version: bool) -> Result<u32, JsValue> {
    let document = io::ori::import_ori_json_with_unknown_version(text, accept_unknown_version)
        .map_err(to_js_io_error)?;
    store_document(document)
}

#[wasm_bindgen]
pub fn load_orh(text: &str) -> Result<u32, JsValue> {
    let document = io::orh::import_orh_str(text).map_err(to_js_io_error)?;
    store_document(document)
}

#[wasm_bindgen]
pub fn load_document(document: JsValue) -> Result<u32, JsValue> {
    let document: CreasePatternDocument =
        serde_wasm_bindgen::from_value(document).map_err(to_js_value_error)?;
    store_document(document)
}

/// Replace the document behind an existing handle in place.
///
/// Unlike [`load_document`], which allocates a fresh handle, this mutates the
/// document already stored at `handle`. Undo/redo and whole-document edits use
/// this so the handle stays stable (mirroring Oriedita's in-place
/// `foldLineSet.setSave` restore), which keeps the editor's viewport from being
/// treated as a brand-new document load.
#[wasm_bindgen]
pub fn restore_document(handle: u32, document: JsValue) -> Result<(), JsValue> {
    let document: CreasePatternDocument =
        serde_wasm_bindgen::from_value(document).map_err(to_js_value_error)?;
    with_document_mut(handle, |slot| {
        *slot = document;
        Ok(())
    })
}

#[wasm_bindgen]
pub fn document_snapshot(handle: u32) -> Result<JsValue, JsValue> {
    with_document(handle, to_js_value)
}

#[wasm_bindgen]
pub fn document_summary(handle: u32) -> Result<JsValue, JsValue> {
    with_document(handle, |document| {
        let model = &document.crease_pattern;
        to_js_value(&DocumentSummary {
            title: document.title.clone(),
            line_segments: model.line_segments.len(),
            circles: model.circles.len(),
            points: model.points.len(),
            aux_line_segments: model.aux_line_segments.len(),
            texts: model.texts.len(),
            can_save_as_cp: model.can_save_as_cp(),
            is_empty: model.is_empty(),
        })
    })
}

#[wasm_bindgen]
pub fn execute_cp_command(
    handle: u32,
    operation: JsValue,
    payload: JsValue,
) -> Result<JsValue, JsValue> {
    let operation: OperationId =
        serde_wasm_bindgen::from_value(operation).map_err(to_js_value_error)?;
    let payload: CreasePatternCommandPayload =
        serde_wasm_bindgen::from_value(payload).map_err(to_js_value_error)?;
    with_document_mut(handle, |document| {
        let result = execute_command(
            document,
            CreasePatternCommand::new(operation).with_payload(payload),
        )
        .map_err(to_js_command_error)?;
        to_js_value(&result)
    })
}

#[wasm_bindgen]
pub fn preview_cp_command(
    handle: u32,
    operation: JsValue,
    payload: JsValue,
) -> Result<JsValue, JsValue> {
    let operation: OperationId =
        serde_wasm_bindgen::from_value(operation).map_err(to_js_value_error)?;
    let payload: CreasePatternCommandPayload =
        serde_wasm_bindgen::from_value(payload).map_err(to_js_value_error)?;
    with_document(handle, |document| {
        let result = preview_command(
            document,
            CreasePatternCommand::new(operation).with_payload(payload),
        )
        .map_err(to_js_command_error)?;
        to_js_value(&result)
    })
}

#[wasm_bindgen]
pub fn insert_line_segments(handle: u32, segments: JsValue) -> Result<u32, JsValue> {
    let segments: Vec<oristudio_cp::geometry::LineSegment> =
        serde_wasm_bindgen::from_value(segments).map_err(to_js_value_error)?;
    with_document_mut(handle, |document| {
        let changed = oristudio_cp::operations::transform::insert_line_segments(
            &mut document.crease_pattern,
            &segments,
            true,
        );
        Ok(changed as u32)
    })
}

/// Clear the document's selection flags. A non-command mutation (no undo entry):
/// the frontend selection is authoritative, and a UI deselect (Escape / click-off)
/// must clear the kernel too, or a later select/deselect re-derives the stale set.
#[wasm_bindgen]
pub fn deselect_all(handle: u32) -> Result<u32, JsValue> {
    with_document_mut(handle, |document| {
        let changed = oristudio_cp::operations::selection::unselect_all(&mut document.crease_pattern);
        Ok(changed as u32)
    })
}

/// Oriedita import (add): merge the document behind `imported_handle` into the
/// document behind `handle`, mirroring `setSave_for_reading_tuika`. The imported
/// pattern is shifted to sit beside the existing one and divided against it.
/// Returns the resulting line-segment count.
#[wasm_bindgen]
pub fn import_add(handle: u32, imported_handle: u32) -> Result<u32, JsValue> {
    let imported_pattern = with_document(imported_handle, |document| {
        Ok(document.crease_pattern.clone())
    })?;
    with_document_mut(handle, |document| {
        oristudio_cp::operations::arrangement::import_add(
            &mut document.crease_pattern,
            &imported_pattern,
        );
        Ok(document.crease_pattern.line_segments.len() as u32)
    })
}

#[wasm_bindgen]
pub fn replace_line_segments(
    handle: u32,
    line_ids: JsValue,
    segments: JsValue,
) -> Result<u32, JsValue> {
    let line_ids: Vec<usize> =
        serde_wasm_bindgen::from_value(line_ids).map_err(to_js_value_error)?;
    let segments: Vec<oristudio_cp::geometry::LineSegment> =
        serde_wasm_bindgen::from_value(segments).map_err(to_js_value_error)?;
    with_document_mut(handle, |document| {
        let indices = resolved_line_indices(&document.crease_pattern, &line_ids)?;
        let changed = oristudio_cp::operations::transform::replace_line_segments(
            &mut document.crease_pattern,
            &indices,
            &segments,
        );
        Ok(changed as u32)
    })
}

#[wasm_bindgen]
pub fn export_cp(handle: u32) -> Result<String, JsValue> {
    with_document(handle, |document| {
        Ok(io::cp::export_cp_string(&document.crease_pattern))
    })
}

#[wasm_bindgen]
pub fn export_fold(handle: u32) -> Result<String, JsValue> {
    with_document(handle, |document| {
        io::fold::export_fold_json(&document.crease_pattern, document.title.clone())
            .map_err(to_js_io_error)
    })
}

#[wasm_bindgen]
pub fn export_fold_file(handle: u32) -> Result<String, JsValue> {
    with_document(handle, |document| {
        io::fold::export_fold_file_document_json(document).map_err(to_js_io_error)
    })
}

#[wasm_bindgen]
pub fn export_ori(handle: u32) -> Result<String, JsValue> {
    with_document(handle, |document| {
        io::ori::export_ori_json(document).map_err(to_js_io_error)
    })
}

#[wasm_bindgen]
pub fn export_orh(handle: u32) -> Result<String, JsValue> {
    with_document(handle, |document| Ok(io::orh::export_orh_string(document)))
}

#[wasm_bindgen]
pub fn folded_figure_fold(
    document_handle: u32,
    starting_face_id: i32,
    order: JsValue,
    model: JsValue,
) -> Result<JsValue, JsValue> {
    let order: EstimationOrder =
        serde_wasm_bindgen::from_value(order).map_err(to_js_value_error)?;
    let model = folded_figure_model_from_js(model)?;
    with_document(document_handle, |document| {
        let mut session =
            FoldingEstimateSession::new(&document.crease_pattern.line_segments, starting_face_id);
        session
            .folding_estimated(order)
            .map_err(to_js_folding_error)?;
        let snapshot = folded_figure_snapshot_from_session(&session, model.clone());
        let handle = store_folded_figure(WasmFoldedFigure { session, model })?;
        to_js_value(&JsFoldedFigureResult { handle, snapshot })
    })
}

#[wasm_bindgen]
pub fn folded_figure_fold_selected(
    document_handle: u32,
    selected_line_ids: JsValue,
    starting_face_id: i32,
    order: JsValue,
    model: JsValue,
) -> Result<JsValue, JsValue> {
    let selected_line_ids: Vec<usize> =
        serde_wasm_bindgen::from_value(selected_line_ids).map_err(to_js_value_error)?;
    let order: EstimationOrder =
        serde_wasm_bindgen::from_value(order).map_err(to_js_value_error)?;
    let model = folded_figure_model_from_js(model)?;
    with_document(document_handle, |document| {
        let selected_segments =
            selected_folding_segments(&document.crease_pattern.line_segments, &selected_line_ids);
        let segments = if selected_segments.is_empty() {
            document.crease_pattern.line_segments.as_slice()
        } else {
            selected_segments.as_slice()
        };
        let mut session = FoldingEstimateSession::new(segments, starting_face_id);
        session
            .folding_estimated(order)
            .map_err(to_js_folding_error)?;
        let snapshot = folded_figure_snapshot_from_session(&session, model.clone());
        let handle = store_folded_figure(WasmFoldedFigure { session, model })?;
        to_js_value(&JsFoldedFigureResult { handle, snapshot })
    })
}

#[wasm_bindgen]
pub fn folded_figure_snapshot(handle: u32) -> Result<JsValue, JsValue> {
    with_folded_figure(handle, |folded| {
        to_js_value(&folded_figure_snapshot_from_session(
            &folded.session,
            folded.model.clone(),
        ))
    })
}

#[wasm_bindgen]
pub fn folded_figure_render_snapshot(
    handle: u32,
    display_style: JsValue,
    options: JsValue,
) -> Result<JsValue, JsValue> {
    let display_style: Option<DisplayStyle> =
        if display_style.is_undefined() || display_style.is_null() {
            None
        } else {
            Some(serde_wasm_bindgen::from_value(display_style).map_err(to_js_value_error)?)
        };
    let options = folded_figure_render_options_from_js(options)?;
    with_folded_figure(handle, |folded| {
        let display_style = display_style.unwrap_or(folded.session.estimate().display_style);
        let snapshot = folded_figure_render_snapshot_from_session(
            &folded.session,
            display_style,
            folded.model.clone(),
            options,
        )
        .map_err(to_js_folding_error)?;
        to_js_value(&snapshot)
    })
}

#[wasm_bindgen]
pub fn folded_figure_set_model(handle: u32, model: JsValue) -> Result<JsValue, JsValue> {
    let model = folded_figure_model_from_js(model)?;
    with_folded_figure_mut(handle, |folded| {
        folded.model = model;
        to_js_value(&folded_figure_snapshot_from_session(
            &folded.session,
            folded.model.clone(),
        ))
    })
}

#[wasm_bindgen]
pub fn folded_figure_duplicate(handle: u32) -> Result<JsValue, JsValue> {
    let duplicate = with_folded_figure(handle, |folded| {
        Ok(WasmFoldedFigure {
            session: folded.session.clone(),
            model: folded.model.clone(),
        })
    })?;
    let snapshot = folded_figure_snapshot_from_session(&duplicate.session, duplicate.model.clone());
    let handle = store_folded_figure(duplicate)?;
    to_js_value(&JsFoldedFigureResult { handle, snapshot })
}

#[wasm_bindgen]
pub fn folded_figure_fold_another(handle: u32) -> Result<JsValue, JsValue> {
    with_folded_figure_mut(handle, |folded| {
        fold_another(&mut folded.session).map_err(to_js_folding_error)?;
        to_js_value(&folded_figure_snapshot_from_session(
            &folded.session,
            folded.model.clone(),
        ))
    })
}

#[wasm_bindgen]
pub fn folded_figure_fold_to_case(
    handle: u32,
    objective: u32,
    initial_order: JsValue,
) -> Result<JsValue, JsValue> {
    let initial_order: EstimationOrder =
        serde_wasm_bindgen::from_value(initial_order).map_err(to_js_value_error)?;
    with_folded_figure_mut(handle, |folded| {
        let batch =
            folding_estimate_to_case(&mut folded.session, objective as usize, initial_order)
                .map_err(to_js_folding_error)?;
        let snapshot = folded_figure_snapshot_from_session(&folded.session, folded.model.clone());
        to_js_value(&JsFoldedFigureBatchResult {
            snapshot,
            discovered_case_numbers: batch.discovered_case_numbers,
        })
    })
}

#[wasm_bindgen]
pub fn free_folded_figure(handle: u32) -> Result<(), JsValue> {
    FOLDED_FIGURES.with(|folded_figures| {
        let mut folded_figures = folded_figures.borrow_mut();
        let slot = folded_figures
            .get_mut(handle as usize)
            .ok_or_else(|| js_error("invalid_handle", "invalid folded figure handle"))?;
        *slot = None;
        Ok(())
    })
}

#[wasm_bindgen]
pub fn free_document(handle: u32) -> Result<(), JsValue> {
    DOCUMENTS.with(|documents| {
        let mut documents = documents.borrow_mut();
        let slot = documents
            .get_mut(handle as usize)
            .ok_or_else(|| js_error("invalid_handle", "invalid CreasePatternDocument handle"))?;
        *slot = None;
        Ok(())
    })
}

fn selected_folding_segments(
    segments: &[oristudio_cp::geometry::LineSegment],
    selected_line_ids: &[usize],
) -> Vec<oristudio_cp::geometry::LineSegment> {
    if selected_line_ids.is_empty() {
        return Vec::new();
    }

    segments
        .iter()
        .enumerate()
        .filter(|(index, segment)| {
            segment.color.is_folding_line() && selected_line_ids.contains(&(index + 1))
        })
        .map(|(_, segment)| segment.clone())
        .collect()
}

fn folded_figure_model_from_js(model: JsValue) -> Result<FoldedFigureModel, JsValue> {
    if model.is_undefined() || model.is_null() {
        Ok(FoldedFigureModel::default())
    } else {
        serde_wasm_bindgen::from_value(model).map_err(to_js_value_error)
    }
}

fn folded_figure_render_options_from_js(
    options: JsValue,
) -> Result<FoldedFigureRenderOptions, JsValue> {
    if options.is_undefined() || options.is_null() {
        Ok(FoldedFigureRenderOptions::default())
    } else {
        serde_wasm_bindgen::from_value(options).map_err(to_js_value_error)
    }
}

fn store_document(document: CreasePatternDocument) -> Result<u32, JsValue> {
    DOCUMENTS.with(|documents| {
        let mut documents = documents.borrow_mut();
        if let Some((index, slot)) = documents
            .iter_mut()
            .enumerate()
            .find(|(_, slot)| slot.is_none())
        {
            *slot = Some(document);
            Ok(index as u32)
        } else {
            documents.push(Some(document));
            Ok((documents.len() - 1) as u32)
        }
    })
}

fn store_folded_figure(folded_figure: WasmFoldedFigure) -> Result<u32, JsValue> {
    FOLDED_FIGURES.with(|folded_figures| {
        let mut folded_figures = folded_figures.borrow_mut();
        if let Some((index, slot)) = folded_figures
            .iter_mut()
            .enumerate()
            .find(|(_, slot)| slot.is_none())
        {
            *slot = Some(folded_figure);
            Ok(index as u32)
        } else {
            folded_figures.push(Some(folded_figure));
            Ok((folded_figures.len() - 1) as u32)
        }
    })
}

fn with_document<T>(
    handle: u32,
    f: impl FnOnce(&CreasePatternDocument) -> Result<T, JsValue>,
) -> Result<T, JsValue> {
    DOCUMENTS.with(|documents| {
        let documents = documents.borrow();
        let document = documents
            .get(handle as usize)
            .and_then(Option::as_ref)
            .ok_or_else(|| js_error("invalid_handle", "invalid CreasePatternDocument handle"))?;
        f(document)
    })
}

fn with_document_mut<T>(
    handle: u32,
    f: impl FnOnce(&mut CreasePatternDocument) -> Result<T, JsValue>,
) -> Result<T, JsValue> {
    DOCUMENTS.with(|documents| {
        let mut documents = documents.borrow_mut();
        let document = documents
            .get_mut(handle as usize)
            .and_then(Option::as_mut)
            .ok_or_else(|| js_error("invalid_handle", "invalid CreasePatternDocument handle"))?;
        f(document)
    })
}

fn with_folded_figure<T>(
    handle: u32,
    f: impl FnOnce(&WasmFoldedFigure) -> Result<T, JsValue>,
) -> Result<T, JsValue> {
    FOLDED_FIGURES.with(|folded_figures| {
        let folded_figures = folded_figures.borrow();
        let folded_figure = folded_figures
            .get(handle as usize)
            .and_then(Option::as_ref)
            .ok_or_else(|| js_error("invalid_handle", "invalid folded figure handle"))?;
        f(folded_figure)
    })
}

fn with_folded_figure_mut<T>(
    handle: u32,
    f: impl FnOnce(&mut WasmFoldedFigure) -> Result<T, JsValue>,
) -> Result<T, JsValue> {
    FOLDED_FIGURES.with(|folded_figures| {
        let mut folded_figures = folded_figures.borrow_mut();
        let folded_figure = folded_figures
            .get_mut(handle as usize)
            .and_then(Option::as_mut)
            .ok_or_else(|| js_error("invalid_handle", "invalid folded figure handle"))?;
        f(folded_figure)
    })
}

fn resolved_line_indices(
    model: &oristudio_cp::CreasePatternModel,
    line_ids: &[usize],
) -> Result<Vec<usize>, JsValue> {
    if line_ids.is_empty() {
        return Err(js_error(
            "invalid_input",
            "at least one line id is required",
        ));
    }
    let mut indices = Vec::with_capacity(line_ids.len());
    for id in line_ids {
        let Some(index) = id.checked_sub(1) else {
            return Err(js_error("invalid_input", "line ids are one-based"));
        };
        if index >= model.line_segments.len() {
            return Err(js_error("invalid_input", "line id is out of range"));
        }
        indices.push(index);
    }
    indices.sort_unstable();
    indices.dedup();
    Ok(indices)
}

fn title_from_js(title: &str) -> Option<String> {
    let title = title.trim();
    if title.is_empty() {
        None
    } else {
        Some(title.to_owned())
    }
}

fn to_js_command_error(error: CommandError) -> JsValue {
    let code = match error {
        CommandError::UnsupportedOperation { .. } => "unsupported_operation",
        CommandError::NotImplemented { .. } => "not_implemented",
        CommandError::InvalidInput { .. } => "invalid_input",
    };
    js_error(code, error.to_string())
}

fn to_js_io_error(error: io::IoError) -> JsValue {
    js_error("invalid_input", error.to_string())
}

fn to_js_folding_error(error: FoldingEstimateError) -> JsValue {
    js_error("folding_error", format!("{error:?}"))
}

fn to_js_value_error(error: impl std::fmt::Display) -> JsValue {
    js_error("js_value", error.to_string())
}

fn to_js_value(value: &impl Serialize) -> Result<JsValue, JsValue> {
    let serializer = serde_wasm_bindgen::Serializer::json_compatible();
    value.serialize(&serializer).map_err(to_js_value_error)
}

fn js_error(code: &'static str, message: impl Into<String>) -> JsValue {
    serde_wasm_bindgen::to_value(&JsErrorEnvelope {
        code,
        message: message.into(),
    })
    .unwrap_or_else(|_| JsValue::from_str("failed to serialize wasm error"))
}

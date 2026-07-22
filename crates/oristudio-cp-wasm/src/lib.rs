//! `wasm-bindgen` wrapper around `oristudio-cp`.
//!
//! This is a thin marshaling layer: it (de)serializes `JsValue`s at the edge and
//! delegates all engine work to a `thread_local` [`CpSession`], the shared,
//! UI-agnostic session store. The desktop (Tauri) bridge owns the same
//! `CpSession` behind managed state, so the two stay in lockstep by construction.
//! See `implementation-plans/desktop-native-cp-engine-migration.md`.

use js_sys::{Float64Array, Int32Array, Object, Reflect, Uint8Array};
use oristudio_cp::folding::{
    DisplayStyle, EstimationOrder, FoldedFigureModel, FoldedFigureRenderOptions,
};
use oristudio_cp::geometry::LineSegment;
use oristudio_cp::geometry_transport::CompactGeometry;
use oristudio_cp::session::{CpSession, EngineError};
use oristudio_cp::{CreasePatternCommandPayload, CreasePatternDocument, OperationId};
use serde::Serialize;
use serde::de::DeserializeOwned;
use std::cell::RefCell;
use wasm_bindgen::JsCast;
use wasm_bindgen::prelude::*;

thread_local! {
    static SESSION: RefCell<CpSession> = RefCell::new(CpSession::new());
}

fn with_session<T>(f: impl FnOnce(&CpSession) -> Result<T, EngineError>) -> Result<T, JsValue> {
    SESSION.with(|session| f(&session.borrow()).map_err(engine_error_to_js))
}

fn with_session_mut<T>(
    f: impl FnOnce(&mut CpSession) -> Result<T, EngineError>,
) -> Result<T, JsValue> {
    SESSION.with(|session| f(&mut session.borrow_mut()).map_err(engine_error_to_js))
}

// --- operation catalog ------------------------------------------------------

#[wasm_bindgen]
pub fn cp_operation_descriptors() -> Result<JsValue, JsValue> {
    let descriptors = with_session(|session| Ok(session.operation_descriptors()))?;
    to_js_value(&descriptors)
}

// --- document loading / construction ----------------------------------------

#[wasm_bindgen]
pub fn load_cp(text: &str, title: &str) -> Result<u32, JsValue> {
    with_session_mut(|session| session.load_cp(text, title))
}

#[wasm_bindgen]
pub fn load_fold(text: &str, title: &str) -> Result<u32, JsValue> {
    with_session_mut(|session| session.load_fold(text, title))
}

#[wasm_bindgen]
pub fn load_fold_file(text: &str) -> Result<u32, JsValue> {
    with_session_mut(|session| session.load_fold_file(text))
}

#[wasm_bindgen]
pub fn load_ori(text: &str, accept_unknown_version: bool) -> Result<u32, JsValue> {
    with_session_mut(|session| session.load_ori(text, accept_unknown_version))
}

#[wasm_bindgen]
pub fn load_orh(text: &str) -> Result<u32, JsValue> {
    with_session_mut(|session| session.load_orh(text))
}

#[wasm_bindgen]
pub fn load_document(document: JsValue) -> Result<u32, JsValue> {
    let document: CreasePatternDocument = from_js(document)?;
    with_session_mut(|session| Ok(session.load_document(document)))
}

// --- document lifecycle / read ----------------------------------------------

/// Replace the document behind an existing handle in place (undo/redo,
/// whole-document edits); keeps the handle stable, unlike [`load_document`].
#[wasm_bindgen]
pub fn restore_document(handle: u32, document: JsValue) -> Result<(), JsValue> {
    let document: CreasePatternDocument = from_js(document)?;
    with_session_mut(|session| session.restore_document(handle, document))
}

#[wasm_bindgen]
pub fn document_snapshot(handle: u32) -> Result<JsValue, JsValue> {
    let document = with_session(|session| session.document_snapshot(handle))?;
    to_js_value(&document)
}

/// Compact, transfer-friendly geometry for the hot render/interaction path. The
/// bulk-geometry fields become typed arrays (each backed by its own transferable
/// `ArrayBuffer`) so the worker can `transfer` rather than structured-clone.
#[wasm_bindgen]
pub fn document_geometry(handle: u32) -> Result<JsValue, JsValue> {
    let compact = with_session(|session| session.document_geometry(handle))?;
    compact_to_js(&compact)
}

/// Restore a document in place from the compact geometry produced by
/// [`document_geometry`] (undo/redo). Keeps the handle stable.
#[wasm_bindgen]
pub fn restore_from_compact(handle: u32, value: JsValue) -> Result<(), JsValue> {
    let compact = compact_from_js(&value)?;
    with_session_mut(|session| session.restore_from_compact(handle, &compact))
}

#[wasm_bindgen]
pub fn document_summary(handle: u32) -> Result<JsValue, JsValue> {
    let summary = with_session(|session| session.document_summary(handle))?;
    to_js_value(&summary)
}

#[wasm_bindgen]
pub fn free_document(handle: u32) -> Result<(), JsValue> {
    with_session_mut(|session| session.free_document(handle))
}

// --- editing commands -------------------------------------------------------

#[wasm_bindgen]
pub fn execute_cp_command(
    handle: u32,
    operation: JsValue,
    payload: JsValue,
) -> Result<JsValue, JsValue> {
    let operation: OperationId = from_js(operation)?;
    let payload: CreasePatternCommandPayload = from_js(payload)?;
    let result = with_session_mut(|session| session.execute_command(handle, operation, payload))?;
    to_js_value(&result)
}

#[wasm_bindgen]
pub fn preview_cp_command(
    handle: u32,
    operation: JsValue,
    payload: JsValue,
) -> Result<JsValue, JsValue> {
    let operation: OperationId = from_js(operation)?;
    let payload: CreasePatternCommandPayload = from_js(payload)?;
    let result = with_session(|session| session.preview_command(handle, operation, payload))?;
    to_js_value(&result)
}

#[wasm_bindgen]
pub fn insert_line_segments(handle: u32, segments: JsValue) -> Result<u32, JsValue> {
    let segments: Vec<LineSegment> = from_js(segments)?;
    with_session_mut(|session| session.insert_line_segments(handle, &segments))
}

/// Clear the document's selection flags (a non-command mutation with no undo
/// entry) so a UI deselect keeps the kernel selection in sync.
#[wasm_bindgen]
pub fn deselect_all(handle: u32) -> Result<u32, JsValue> {
    with_session_mut(|session| session.deselect_all(handle))
}

/// Oriedita import (add): merge the document behind `imported_handle` into the
/// document behind `handle`. Returns the resulting line-segment count.
#[wasm_bindgen]
pub fn import_add(handle: u32, imported_handle: u32) -> Result<u32, JsValue> {
    with_session_mut(|session| session.import_add(handle, imported_handle))
}

#[wasm_bindgen]
pub fn replace_line_segments(
    handle: u32,
    line_ids: JsValue,
    segments: JsValue,
) -> Result<u32, JsValue> {
    let line_ids: Vec<usize> = from_js(line_ids)?;
    let segments: Vec<LineSegment> = from_js(segments)?;
    with_session_mut(|session| session.replace_line_segments(handle, &line_ids, &segments))
}

// --- export -----------------------------------------------------------------

#[wasm_bindgen]
pub fn export_cp(handle: u32) -> Result<String, JsValue> {
    with_session(|session| session.export_cp(handle))
}

#[wasm_bindgen]
pub fn export_fold(handle: u32) -> Result<String, JsValue> {
    with_session(|session| session.export_fold(handle))
}

#[wasm_bindgen]
pub fn export_fold_file(handle: u32) -> Result<String, JsValue> {
    with_session(|session| session.export_fold_file(handle))
}

#[wasm_bindgen]
pub fn export_ori(handle: u32) -> Result<String, JsValue> {
    with_session(|session| session.export_ori(handle))
}

#[wasm_bindgen]
pub fn export_orh(handle: u32) -> Result<String, JsValue> {
    with_session(|session| session.export_orh(handle))
}

/// Replace the kernel document's text elements wholesale. See
/// [`CpSession::set_texts`] for the rich-text/interchange split this serves.
#[wasm_bindgen]
pub fn set_texts(handle: u32, coords: Vec<f64>, texts: Vec<String>) -> Result<(), JsValue> {
    with_session_mut(|session| session.set_texts(handle, &coords, texts))
}

// --- folding ----------------------------------------------------------------

#[wasm_bindgen]
pub fn folded_figure_fold(
    document_handle: u32,
    starting_face_id: i32,
    order: JsValue,
    model: JsValue,
) -> Result<JsValue, JsValue> {
    let order: EstimationOrder = from_js(order)?;
    let model = folded_figure_model_from_js(model)?;
    let result = with_session_mut(|session| {
        session.folded_figure_fold(document_handle, starting_face_id, order, model)
    })?;
    to_js_value(&result)
}

#[wasm_bindgen]
pub fn folded_figure_fold_selected(
    document_handle: u32,
    selected_line_ids: JsValue,
    starting_face_id: i32,
    order: JsValue,
    model: JsValue,
) -> Result<JsValue, JsValue> {
    let selected_line_ids: Vec<usize> = from_js(selected_line_ids)?;
    let order: EstimationOrder = from_js(order)?;
    let model = folded_figure_model_from_js(model)?;
    let result = with_session_mut(|session| {
        session.folded_figure_fold_selected(
            document_handle,
            &selected_line_ids,
            starting_face_id,
            order,
            model,
        )
    })?;
    to_js_value(&result)
}

#[wasm_bindgen]
pub fn folded_figure_snapshot(handle: u32) -> Result<JsValue, JsValue> {
    let snapshot = with_session(|session| session.folded_figure_snapshot(handle))?;
    to_js_value(&snapshot)
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
            Some(from_js(display_style)?)
        };
    let options = folded_figure_render_options_from_js(options)?;
    let snapshot = with_session(|session| {
        session.folded_figure_render_snapshot(handle, display_style, options)
    })?;
    to_js_value(&snapshot)
}

#[wasm_bindgen]
pub fn folded_figure_set_model(handle: u32, model: JsValue) -> Result<JsValue, JsValue> {
    let model = folded_figure_model_from_js(model)?;
    let snapshot = with_session_mut(|session| session.folded_figure_set_model(handle, model))?;
    to_js_value(&snapshot)
}

#[wasm_bindgen]
pub fn folded_figure_duplicate(handle: u32) -> Result<JsValue, JsValue> {
    let result = with_session_mut(|session| session.folded_figure_duplicate(handle))?;
    to_js_value(&result)
}

#[wasm_bindgen]
pub fn folded_figure_fold_another(handle: u32) -> Result<JsValue, JsValue> {
    let snapshot = with_session_mut(|session| session.folded_figure_fold_another(handle))?;
    to_js_value(&snapshot)
}

#[wasm_bindgen]
pub fn folded_figure_fold_to_case(
    handle: u32,
    objective: u32,
    initial_order: JsValue,
) -> Result<JsValue, JsValue> {
    let initial_order: EstimationOrder = from_js(initial_order)?;
    let result = with_session_mut(|session| {
        session.folded_figure_fold_to_case(handle, objective as usize, initial_order)
    })?;
    to_js_value(&result)
}

#[wasm_bindgen]
pub fn free_folded_figure(handle: u32) -> Result<(), JsValue> {
    with_session_mut(|session| session.free_folded_figure(handle))
}

// --- marshaling helpers -----------------------------------------------------

fn from_js<T: DeserializeOwned>(value: JsValue) -> Result<T, JsValue> {
    serde_wasm_bindgen::from_value(value).map_err(to_js_value_error)
}

fn folded_figure_model_from_js(model: JsValue) -> Result<FoldedFigureModel, JsValue> {
    if model.is_undefined() || model.is_null() {
        Ok(FoldedFigureModel::default())
    } else {
        from_js(model)
    }
}

fn folded_figure_render_options_from_js(
    options: JsValue,
) -> Result<FoldedFigureRenderOptions, JsValue> {
    if options.is_undefined() || options.is_null() {
        Ok(FoldedFigureRenderOptions::default())
    } else {
        from_js(options)
    }
}

fn engine_error_to_js(error: EngineError) -> JsValue {
    serde_wasm_bindgen::to_value(&error).unwrap_or_else(|_| JsValue::from_str(&error.message))
}

fn js_error(code: &'static str, message: impl Into<String>) -> JsValue {
    engine_error_to_js(EngineError::new(code, message))
}

fn to_js_value_error(error: impl std::fmt::Display) -> JsValue {
    js_error("js_value", error.to_string())
}

fn to_js_value(value: &impl Serialize) -> Result<JsValue, JsValue> {
    let serializer = serde_wasm_bindgen::Serializer::json_compatible();
    value.serialize(&serializer).map_err(to_js_value_error)
}

fn set_f64_array(target: &Object, key: &str, data: &[f64]) -> Result<(), JsValue> {
    let array = Float64Array::from(data);
    Reflect::set(target, &JsValue::from_str(key), array.as_ref()).map(|_| ())
}

fn set_i32_array(target: &Object, key: &str, data: &[i32]) -> Result<(), JsValue> {
    let array = Int32Array::from(data);
    Reflect::set(target, &JsValue::from_str(key), array.as_ref()).map(|_| ())
}

fn set_u8_array(target: &Object, key: &str, data: &[u8]) -> Result<(), JsValue> {
    let array = Uint8Array::from(data);
    Reflect::set(target, &JsValue::from_str(key), array.as_ref()).map(|_| ())
}

fn compact_to_js(compact: &CompactGeometry) -> Result<JsValue, JsValue> {
    let object = Object::new();
    set_f64_array(&object, "segEndpoints", &compact.seg_endpoints)?;
    set_i32_array(&object, "segAttr", &compact.seg_attr)?;
    set_u8_array(&object, "segCustomColor", &compact.seg_custom_color)?;
    set_f64_array(&object, "auxEndpoints", &compact.aux_endpoints)?;
    set_i32_array(&object, "auxAttr", &compact.aux_attr)?;
    set_u8_array(&object, "auxCustomColor", &compact.aux_custom_color)?;
    set_f64_array(&object, "pointCoords", &compact.point_coords)?;
    set_f64_array(&object, "circleData", &compact.circle_data)?;
    set_i32_array(&object, "circleAttr", &compact.circle_attr)?;
    set_u8_array(&object, "circleCustomColor", &compact.circle_custom_color)?;
    Reflect::set(
        &object,
        &JsValue::from_str("tail"),
        &to_js_value(&compact.tail)?,
    )?;
    Ok(object.into())
}

fn get_f64_array(value: &JsValue, key: &str) -> Result<Vec<f64>, JsValue> {
    Reflect::get(value, &JsValue::from_str(key))?
        .dyn_into::<Float64Array>()
        .map(|array| array.to_vec())
        .map_err(|_| js_error("invalid_input", format!("`{key}` must be a Float64Array")))
}

fn get_i32_array(value: &JsValue, key: &str) -> Result<Vec<i32>, JsValue> {
    Reflect::get(value, &JsValue::from_str(key))?
        .dyn_into::<Int32Array>()
        .map(|array| array.to_vec())
        .map_err(|_| js_error("invalid_input", format!("`{key}` must be an Int32Array")))
}

fn get_u8_array(value: &JsValue, key: &str) -> Result<Vec<u8>, JsValue> {
    Reflect::get(value, &JsValue::from_str(key))?
        .dyn_into::<Uint8Array>()
        .map(|array| array.to_vec())
        .map_err(|_| js_error("invalid_input", format!("`{key}` must be a Uint8Array")))
}

fn compact_from_js(value: &JsValue) -> Result<CompactGeometry, JsValue> {
    let tail = serde_wasm_bindgen::from_value(Reflect::get(value, &JsValue::from_str("tail"))?)
        .map_err(to_js_value_error)?;
    Ok(CompactGeometry {
        seg_endpoints: get_f64_array(value, "segEndpoints")?,
        seg_attr: get_i32_array(value, "segAttr")?,
        seg_custom_color: get_u8_array(value, "segCustomColor")?,
        aux_endpoints: get_f64_array(value, "auxEndpoints")?,
        aux_attr: get_i32_array(value, "auxAttr")?,
        aux_custom_color: get_u8_array(value, "auxCustomColor")?,
        point_coords: get_f64_array(value, "pointCoords")?,
        circle_data: get_f64_array(value, "circleData")?,
        circle_attr: get_i32_array(value, "circleAttr")?,
        circle_custom_color: get_u8_array(value, "circleCustomColor")?,
        tail,
    })
}

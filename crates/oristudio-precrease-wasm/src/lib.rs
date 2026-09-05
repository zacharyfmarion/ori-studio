//! `wasm-bindgen` wrapper around `oristudio-precrease`.
//!
//! Stateless: every export takes plain numbers or JSON-shaped values and
//! returns `json_compatible` JSON (plain objects and arrays, no `Map`s).
//! Errors are `{ code, message }` envelopes like the other bridges.
//!
//! ```ts
//! // The shapes below mirror the serde types in `oristudio-precrease`.
//! export interface Frame {
//!   origin: [number, number]; x_axis: [number, number]; y_axis: [number, number];
//!   width: number; height: number;
//! }
//! export interface SheetAnalysis {
//!   components: Component[]; unassigned_segments: number[]; warnings: Warning[];
//!   segment_count: number; tol: number; snap_radius: number;
//! }
//! /** Frames, merged lines and exactness for every sheet in a crease pattern. */
//! export function sheet_frames(
//!   segments: Float64Array,          // [x1, y1, x2, y2, …] in Oriedita model space
//!   colors: Int32Array,              // one Oriedita colour code per segment
//!   paper_fallback?: Float64Array,   // [x0, y0, x1, y1]; used when there are no border creases
//! ): SheetAnalysis;
//! /** Model point → ReferenceFinder rectangle point for one component's `frame`. */
//! export function model_to_rf(frame: Frame, x: number, y: number): Float64Array; // [x, y]
//! /** ReferenceFinder rectangle point → model point. */
//! export function rf_to_model(frame: Frame, x: number, y: number): Float64Array; // [x, y]
//! /** `{ tol, snap_radius }` — the crate's tolerance constants. */
//! export function precrease_tolerances(): { tol: number; snap_radius: number };
//! ```

use std::sync::Once;

use oristudio_precrease::{Frame, PrecreaseError, SNAP_RADIUS, TOL, analyze};
use serde::Serialize;
use wasm_bindgen::prelude::*;

static PANIC_HOOK: Once = Once::new();

#[derive(Serialize)]
struct JsErrorEnvelope {
    code: &'static str,
    message: String,
}

#[derive(Serialize)]
struct Tolerances {
    tol: f64,
    snap_radius: f64,
}

/// The crate's tolerance constants, so the TypeScript side never restates them.
#[wasm_bindgen]
pub fn precrease_tolerances() -> Result<JsValue, JsValue> {
    install_panic_hook();
    to_js_value(&Tolerances {
        tol: TOL,
        snap_radius: SNAP_RADIUS,
    })
}

/// Sheet frames, per-component merged lines and exactness for a crease
/// pattern given as flat model-space segments and Oriedita colour codes.
#[wasm_bindgen]
pub fn sheet_frames(
    segments: &[f64],
    colors: &[i32],
    paper_fallback: Option<Box<[f64]>>,
) -> Result<JsValue, JsValue> {
    install_panic_hook();
    let fallback = match paper_fallback {
        None => None,
        Some(values) => {
            let rect: [f64; 4] = values.as_ref().try_into().map_err(|_| {
                js_error(
                    "invalid_input",
                    format!(
                        "paper_fallback must have 4 values [x0, y0, x1, y1], got {}",
                        values.len()
                    ),
                )
            })?;
            Some(rect)
        }
    };
    let analysis = analyze(segments, colors, fallback).map_err(to_js_precrease_error)?;
    to_js_value(&analysis)
}

/// Map a model-space point into a component's ReferenceFinder rectangle.
#[wasm_bindgen]
pub fn model_to_rf(frame: JsValue, x: f64, y: f64) -> Result<Vec<f64>, JsValue> {
    install_panic_hook();
    let frame = parse_frame(frame)?;
    let p = parse_point(x, y)?;
    Ok(frame.model_to_rf(p).to_vec())
}

/// Map a ReferenceFinder rectangle point back into model space.
#[wasm_bindgen]
pub fn rf_to_model(frame: JsValue, x: f64, y: f64) -> Result<Vec<f64>, JsValue> {
    install_panic_hook();
    let frame = parse_frame(frame)?;
    let p = parse_point(x, y)?;
    Ok(frame.rf_to_model(p).to_vec())
}

fn parse_frame(frame: JsValue) -> Result<Frame, JsValue> {
    let frame: Frame = serde_wasm_bindgen::from_value(frame)
        .map_err(|error| js_error("invalid_frame", error.to_string()))?;
    let values = [
        frame.origin[0],
        frame.origin[1],
        frame.x_axis[0],
        frame.x_axis[1],
        frame.width,
        frame.height,
    ];
    if values.iter().any(|v| !v.is_finite()) {
        return Err(js_error(
            "invalid_frame",
            "frame fields must be finite numbers".to_string(),
        ));
    }
    // Rebuild through the constructor so a hand-edited y_axis or an
    // unnormalised x_axis cannot produce a non-rigid map.
    Frame::new(frame.origin, frame.x_axis, frame.width, frame.height).map_err(to_js_precrease_error)
}

fn parse_point(x: f64, y: f64) -> Result<[f64; 2], JsValue> {
    if !x.is_finite() || !y.is_finite() {
        return Err(js_error(
            "invalid_input",
            format!("point coordinates must be finite numbers: ({x}, {y})"),
        ));
    }
    Ok([x, y])
}

fn install_panic_hook() {
    PANIC_HOOK.call_once(console_error_panic_hook::set_once);
}

fn to_js_precrease_error(error: PrecreaseError) -> JsValue {
    let code = match error {
        PrecreaseError::MalformedSegments { .. }
        | PrecreaseError::ColorCountMismatch { .. }
        | PrecreaseError::NonFiniteCoordinate { .. }
        | PrecreaseError::InvalidPaperFallback => "invalid_input",
        PrecreaseError::NoSheet => "no_sheet",
        PrecreaseError::DegenerateFrame { .. } => "invalid_frame",
        PrecreaseError::NoFrame { .. } => "refused_sheet",
    };
    js_error(code, error.to_string())
}

fn to_js_value(value: &impl Serialize) -> Result<JsValue, JsValue> {
    let serializer = serde_wasm_bindgen::Serializer::json_compatible();
    value
        .serialize(&serializer)
        .map_err(|error| js_error("js_value", error.to_string()))
}

fn js_error(code: &'static str, message: String) -> JsValue {
    let fallback = message.clone();
    to_js_value(&JsErrorEnvelope { code, message })
        .unwrap_or_else(|_| JsValue::from_str(fallback.as_str()))
}

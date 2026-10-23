//! `wasm-bindgen` wrapper around `oristudio-fold`, the Fold workspace's engine
//! (plan D1, Phase 4a).
//!
//! Coarse calls over states held by handle ([`bridge`]): one call per step, the
//! state never crosses the boundary, and every sheet anchor a stored step names
//! is resolved here ([`resolve`]). Inputs are the Fold document's own shapes;
//! outputs are the engine's serde types, `json_compatible` (plain objects and
//! arrays, no `Map`s), in a `status` envelope ([`wire`]). A refusal is a value,
//! `{ status: 'refused', refusal: { code, … }, fixes, faces, vertices }`, with
//! stable codes and never a sentence; only a caller's mistake (malformed
//! input, a handle this engine does not hold) throws, as the `{ code, message }`
//! envelope every bridge uses.
//!
//! ```ts
//! // `apps/web/src/fold/engine/foldEngineWire.ts` holds these shapes in full.
//! export function fold_engine_version(): number;   // FOLD_ENGINE_VERSION
//! export class FoldEngine {
//!   constructor();
//!   free(): void;
//!   /** The flat sheet: `{ status: 'ok', state, summary }` or a refusal. */
//!   sheet(paper: FoldPaper): Outcome<{ state: number; summary: Summary }>;
//!   /** One step: a new handle, a plain fold's report (null for any other
//!    *  step), a compound fold's report tagged by its family, and a summary.
//!    *  `choices` may be undefined. The parent stays held. */
//!   apply(state: number, op: FoldOp, choices?: FoldChoices): Outcome<{
//!     state: number; report: FoldReport | null; compound?: CompoundStepReport; summary: Summary;
//!   }>;
//!   summary(state: number): Summary;
//!   /** The keys of the state's `fs1` fingerprint, in no order. */
//!   canonical_keys(state: number): string[];
//!   /** The pinch length a partial precrease's tool offers on the sheet. */
//!   default_pinch_length(state: number): number;
//!   /** Let states go; how many were held. */
//!   release(states: Uint32Array): number;
//!   clear(): void;
//!   /** How many states are held. */
//!   live(): number;
//!
//!   // Queries on a handle (plan D12, D14). `choices` carries an axiom
//!   // op's root, as `apply`'s does.
//!   /** What a fold along a line would move, without folding (tier 2). */
//!   analyse(state: number, op: FoldOp, choices?: FoldChoices): Outcome<{ analysis: FoldAnalysis }>;
//!   /** That fold's picture on `state`, before it lands. */
//!   action(state: number, op: FoldOp, choices?: FoldChoices): Outcome<{ action: FoldActionGeometry }>;
//!   /** The moving sets a depth seed at the sheet point `at` can pick. */
//!   depth_choices(state: number, op: FoldOp, choices: FoldChoices | undefined, at: Point):
//!     Outcome<{ choices: DepthChoice[] }>;
//!   /** The layers along a model line on one side of it, with their joins. */
//!   cross_section(state: number, line: Line, side: Side): Outcome<{ section: Section }>;
//!   /** An axiom line's folds here: root number, line, who moves. */
//!   axiom_candidates(state: number, line: AxiomLine): Outcome<{ candidates: AxiomCandidate[] }>;
//!   /** The step that landed `state`, while its parent is held: its summary
//!    *  (null for a sheet) and its picture (null for a sheet, turn, rotate
//!    *  or import). An import's summary is its pattern's, needing no parent. */
//!   step_summary(state: number): Outcome<{ summary: StepSummary | null }>;
//!   step_action(state: number): Outcome<{ action: FoldActionGeometry | null }>;
//!   scene(state: number): FoldScene;
//!   /** Landmarks with provenance and visibility; marks are sheet points. */
//!   landmarks(state: number, marks: Point[]): Landmarks;
//!   /** The face seen at a model-frame point, and the sheet point there. */
//!   top_visible_at(state: number, at: Point): { face: number; sheet: Point } | null;
//! }
//! ```
//!
//! With `oristudio-fold`'s `kernel` feature (plan D1): Import CP, Start from
//! Edit's folded figure, Send to Edit and the FOLD export are [`io`]'s, on
//! `FoldEngine` beside these calls, and a stored `cp-jump` op is applied like
//! any other step. `README.md` records the size that costs.
//!
//! A precrease with an `extent` — a segment or a pinch of its line — creases
//! that stretch only and lands crease marks ([`partial`]); `apply`,
//! `analyse` and `action` answer it, and the scene, the landmarks, the
//! summaries and the `fs1` keys carry its marks.
//!
//! Compound folds (plan D4) are steps like any other — `apply`, a step's
//! summary and picture — through one seam ([`compound`]): one held state,
//! one report on `apply`'s answer (`compound`, tagged by family), one
//! choice/refusal path, and one question before a step lands
//! (`compound_analysis`), whatever the family. Each family is a module of its
//! own: the reverse folds ([`ops_reverse`]); the crimp and the tuck
//! ([`ops_crimp_tuck`]), whose folds, which land, ask for an opening or land
//! every order to choose from, are calls of their own; the vertex folds
//! ([`ops_squash_family`]), whose pending choices `FoldEngine` holds; and
//! the sinks ([`ops_sinks`]), whose orders a sink tool counts and picks.

pub mod bridge;
pub mod canonical;
pub mod compound;
pub mod io;
pub mod joins;
pub mod order_selection;
pub mod partial;
pub mod resolve;
pub mod wire;
// Compound folds, one module per family (`compound`).
pub mod ops_crimp_tuck;
pub mod ops_reverse;
pub mod ops_sinks;
pub mod ops_squash_family;

use std::sync::Once;

use oristudio_fold::{FOLD_ENGINE_VERSION, Side};
use oristudio_geometry::Line;
use serde::Serialize;
use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::*;

use crate::bridge::Bridge;
use crate::wire::{BridgeError, Choices, LineInput, Op, Paper, Point};

static PANIC_HOOK: Once = Once::new();

#[derive(Serialize)]
struct JsErrorEnvelope {
    code: &'static str,
    message: String,
}

/// The engine's behaviour version (`FOLD_ENGINE_VERSION`), stored beside
/// every cached state.
#[wasm_bindgen]
pub fn fold_engine_version() -> u32 {
    FOLD_ENGINE_VERSION
}

/// Every landed state a worker holds, by handle. See the TypeScript sketch at
/// the top of this file.
#[wasm_bindgen]
pub struct FoldEngine {
    inner: Bridge,
    /// Imported crease patterns waiting for an order to be picked (`io`).
    imports: io::Imports,
    /// Vertex folds waiting for an order to be picked
    /// (`ops_squash_family`).
    vertex: ops_squash_family::Pending,
}

impl Default for FoldEngine {
    fn default() -> FoldEngine {
        FoldEngine::new()
    }
}

#[wasm_bindgen]
impl FoldEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> FoldEngine {
        PANIC_HOOK.call_once(console_error_panic_hook::set_once);
        FoldEngine {
            inner: Bridge::new(),
            imports: io::Imports::new(),
            vertex: ops_squash_family::Pending::new(),
        }
    }

    /// The flat sheet a sequence starts from.
    pub fn sheet(&mut self, paper: JsValue) -> Result<JsValue, JsValue> {
        let paper: Paper = parse("paper", paper)?;
        to_js_value(&self.inner.sheet(&paper))
    }

    /// One step from `state`; `choices` may be `undefined` or `null`.
    pub fn apply(&mut self, state: u32, op: JsValue, choices: JsValue) -> Result<JsValue, JsValue> {
        let op: Op = parse("op", op)?;
        let choices = parse_choices(choices)?;
        to_js_value(
            &self
                .inner
                .apply(state, &op, &choices)
                .map_err(bridge_error)?,
        )
    }

    /// A history-based return, with retained physical creases.
    pub fn return_to(
        &mut self,
        current: u32,
        target: u32,
        history: Vec<u32>,
    ) -> Result<JsValue, JsValue> {
        to_js_value(
            &self
                .inner
                .return_to(current, target, &history)
                .map_err(bridge_error)?,
        )
    }

    pub fn summary(&self, state: u32) -> Result<JsValue, JsValue> {
        to_js_value(&self.inner.summary(state).map_err(bridge_error)?)
    }

    /// The keys of the state's `fs1` fingerprint, in no order.
    pub fn canonical_keys(&self, state: u32) -> Result<Vec<String>, JsValue> {
        self.inner.canonical_keys(state).map_err(bridge_error)
    }

    /// The pinch length the tools offer on the state's sheet.
    pub fn default_pinch_length(&self, state: u32) -> Result<f64, JsValue> {
        self.inner.default_pinch_length(state).map_err(bridge_error)
    }

    /// Let states go; how many were held.
    pub fn release(&mut self, states: &[u32]) -> u32 {
        let released = states.iter().filter(|&&s| self.inner.release(s)).count();
        u32::try_from(released).unwrap_or(u32::MAX)
    }

    /// Let every state go, every import and every pending choice.
    pub fn clear(&mut self) {
        self.inner.clear();
        self.imports.clear();
        self.vertex.clear();
    }

    /// How many states are held.
    pub fn live(&self) -> u32 {
        u32::try_from(self.inner.len()).unwrap_or(u32::MAX)
    }

    // --- Queries on a handle (plan D12, D14) -------------------------------

    /// What a fold along a line would move, without folding.
    pub fn analyse(&self, state: u32, op: JsValue, choices: JsValue) -> Result<JsValue, JsValue> {
        let op: Op = parse("op", op)?;
        let choices = parse_choices(choices)?;
        to_js_value(
            &self
                .inner
                .analyse(state, &op, &choices)
                .map_err(bridge_error)?,
        )
    }

    /// The picture of the fold the op would make, before it lands.
    pub fn action(&self, state: u32, op: JsValue, choices: JsValue) -> Result<JsValue, JsValue> {
        let op: Op = parse("op", op)?;
        let choices = parse_choices(choices)?;
        to_js_value(
            &self
                .inner
                .action(state, &op, &choices)
                .map_err(bridge_error)?,
        )
    }

    /// The moving sets a depth seed at the sheet point `at` can pick.
    pub fn depth_choices(
        &self,
        state: u32,
        op: JsValue,
        choices: JsValue,
        at: JsValue,
    ) -> Result<JsValue, JsValue> {
        let op: Op = parse("op", op)?;
        let choices = parse_choices(choices)?;
        let at: Point = parse("at", at)?;
        to_js_value(
            &self
                .inner
                .depth_choices(state, &op, &choices, at)
                .map_err(bridge_error)?,
        )
    }

    /// The layers along a model line on one side of it, with their joins.
    pub fn cross_section(
        &self,
        state: u32,
        line: JsValue,
        side: JsValue,
    ) -> Result<JsValue, JsValue> {
        let line: Line = parse("line", line)?;
        let side: Side = parse("side", side)?;
        to_js_value(
            &self
                .inner
                .cross_section(state, &line, side)
                .map_err(bridge_error)?,
        )
    }

    /// An axiom line's folds here, for the candidate chooser.
    pub fn axiom_candidates(&self, state: u32, line: JsValue) -> Result<JsValue, JsValue> {
        let line: LineInput = parse("line", line)?;
        to_js_value(
            &self
                .inner
                .axiom_candidates(state, &line)
                .map_err(bridge_error)?,
        )
    }

    /// The summary of the step that landed `state`.
    pub fn step_summary(&self, state: u32) -> Result<JsValue, JsValue> {
        to_js_value(&self.inner.step_summary(state).map_err(bridge_error)?)
    }

    /// The picture of the step that landed `state`.
    pub fn step_action(&self, state: u32) -> Result<JsValue, JsValue> {
        to_js_value(&self.inner.step_action(state).map_err(bridge_error)?)
    }

    pub fn scene(&self, state: u32) -> Result<JsValue, JsValue> {
        to_js_value(&self.inner.scene(state).map_err(bridge_error)?)
    }

    /// Landmarks with provenance and visibility; `marks` are sheet points.
    pub fn landmarks(&self, state: u32, marks: JsValue) -> Result<JsValue, JsValue> {
        let marks: Vec<Point> = parse("marks", marks)?;
        to_js_value(&self.inner.landmarks(state, &marks).map_err(bridge_error)?)
    }

    /// The face seen at a model-frame point, and the sheet point there.
    pub fn top_visible_at(&self, state: u32, at: JsValue) -> Result<JsValue, JsValue> {
        let at: Point = parse("at", at)?;
        to_js_value(&self.inner.top_visible_at(state, at).map_err(bridge_error)?)
    }
}

fn parse<T: DeserializeOwned>(name: &str, value: JsValue) -> Result<T, JsValue> {
    serde_wasm_bindgen::from_value(value)
        .map_err(|error| js_error("invalid_input", format!("{name}: {error}")))
}

/// A step's choices, or none: `undefined` and `null` are none.
fn parse_choices(choices: JsValue) -> Result<Choices, JsValue> {
    if choices.is_undefined() || choices.is_null() {
        Ok(Choices::default())
    } else {
        parse("choices", choices)
    }
}

fn bridge_error(error: BridgeError) -> JsValue {
    js_error(error.code(), error.to_string())
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

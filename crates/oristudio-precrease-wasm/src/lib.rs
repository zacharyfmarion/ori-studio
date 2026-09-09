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
//!
//! /**
//!  * The planner over one component, held across worker chunks.
//!  *
//!  * Lines cross this boundary as canonical `[nx, ny, d]` triples **in the
//!  * planner unit frame** — the same frame `sheet_frames` reports and the
//!  * frame ReferenceFinder is queried in — so TypeScript never does geometry.
//!  * Every method that takes a typed array validates its length and rejects
//!  * NaN and infinity: a wrongly typed typed-array argument otherwise traps
//!  * opaquely ("memory access out of bounds").
//!  */
//! export class PrecreasePlanner {
//!   /** `component` is a `Component.id` from `sheet_frames`. `opts_json` is
//!    *  `""` for defaults or `{point_cap?, max_depth?, depth3_threshold?,
//!    *  max_candidates?, stuck_budget_ms?, total_budget_ms?}`. The exactness
//!    *  policy is applied here: an exact component is planned as is, a
//!    *  snappable one on its snapped copy (see `info().exactness`), an
//!    *  off-lattice one gets the closure only, and a refused sheet gives a
//!    *  handle whose status is `refused_sheet` and whose methods are no-ops. */
//!   constructor(segments: Float64Array, colors: Int32Array,
//!               paper_fallback: Float64Array | undefined, component: number,
//!               opts_json: string);
//!   free(): void;
//!   /** Status, sheet, target counts and what the exactness policy did. */
//!   info(): PlannerInfo;
//!   /** Resumable: call again to continue. `budget_ms <= 0` is unbounded. */
//!   close(budget_ms: number): { folded: number; remaining: number;
//!                               exhausted: boolean; fixpoint: boolean;
//!                               budget_hit: boolean };
//!   /** What to do next, by the rules in `oristudio_precrease::drive` — the
//!    *  one copy of them, so a driver's loop cannot drift from this crate's.
//!    *  The caller reports what it just did and the facts only it knows. */
//!   next_action(driver: DriverState): PlanAction;
//!   /** Seven numbers per remaining CP line: `nx, ny, d` then two in-frame
//!    *  points `ax, ay, bx, by` (its in-paper segment), for a ReferenceFinder
//!    *  line query. Same order as `line_keys()`. */
//!   remaining(): Float64Array;
//!   /** One decimal `u64` key per remaining line, as a string — a cache key
//!    *  that survives `JSON.stringify`, which a BigInt does not. */
//!   line_keys(): string[];
//!   /** Forward-first search from the current state; applies the auxiliary
//!    *  set it chooses and re-closes. `null` when it finds nothing. */
//!   stuck_search(depth: number, budget_ms: number): StuckSummary | null;
//!   /** One entry per `[nx, ny, d]` triple: `0` when the line is not
//!    *  constructible from the current state, else `1 + the number of CP
//!    *  lines folding it alone would unlock`. Nothing is folded. */
//!   score(lines: Float64Array): Uint32Array;
//!   /** Fold supplied lines in order, each only if the current state
//!    *  constructs it, then re-close. `tags`: 0 cp, 1 aux, 2 rf_aux. */
//!   fold(lines: Float64Array, tags: Uint8Array, budget_ms: number): FoldOutcome[];
//!   /** The whole plan: steps, groups, totals, findings, diagnostics. */
//!   sequence(landmarks_first: boolean): Sequence;
//!   /** Everything known about one `[nx, ny, d]` line. */
//!   explain(line: Float64Array): Explanation;
//!   /** `[nx, ny, d]` triples → four numbers per line, two points on it in
//!    *  the ReferenceFinder rectangle (a line query's input). */
//!   to_rf(lines: Float64Array): Float64Array;
//!   /** Four numbers per line (two points) → `[nx, ny, d]` triples. */
//!   from_rf(points: Float64Array): Float64Array;
//! }
//! ```

use std::sync::Once;

use oristudio_precrease::clock::default_clock;
use oristudio_precrease::closure::FoldOutcome;
use oristudio_precrease::drive::DriverState;
use oristudio_precrease::planner::{Planner, PlannerOptions};
use oristudio_precrease::sequence::{ExactnessSummary, Status};
use oristudio_precrease::state::LineTag;
use oristudio_precrease::{Frame, Line, PrecreaseError, SNAP_RADIUS, Sheet, TOL, analyze};
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
    let fallback = parse_paper_fallback(paper_fallback)?;
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

/// What `PrecreasePlanner::info` reports.
#[derive(Serialize)]
struct PlannerInfo {
    component: u32,
    status: Status,
    sheet: Option<Sheet>,
    exactness: Option<ExactnessSummary>,
    /// The sheet was refused (non-rectangular outline); nothing else applies.
    refused: bool,
    /// Off-lattice: the closure runs but the stuck search never does, and
    /// remaining lines are reported as findings rather than folded.
    off_lattice: bool,
    /// Distinct CP lines the planner is trying to construct.
    targets: usize,
    /// Targets coinciding with the sheet outline: free, never folded.
    free_targets: usize,
    remaining: usize,
    point_cap: usize,
}

/// One `close` call.
#[derive(Serialize)]
struct CloseReport {
    folded: usize,
    remaining: usize,
    /// The closure reached its fixpoint without hitting the deadline.
    exhausted: bool,
    fixpoint: bool,
    budget_hit: bool,
}

/// The planner over one component of a crease pattern, held across worker
/// chunks. See the TypeScript sketch at the top of this file.
#[wasm_bindgen]
pub struct PrecreasePlanner {
    inner: Planner,
}

#[wasm_bindgen]
impl PrecreasePlanner {
    /// Analyse `segments` / `colors`, take component `component`, and apply
    /// the exactness policy. A refused sheet yields a handle whose `info()`
    /// says so and whose other methods are no-ops.
    #[wasm_bindgen(constructor)]
    pub fn new(
        segments: &[f64],
        colors: &[i32],
        paper_fallback: Option<Box<[f64]>>,
        component: u32,
        opts_json: &str,
    ) -> Result<PrecreasePlanner, JsValue> {
        install_panic_hook();
        let fallback = parse_paper_fallback(paper_fallback)?;
        let analysis = analyze(segments, colors, fallback).map_err(to_js_precrease_error)?;
        let found = analysis
            .components
            .iter()
            .find(|c| c.id == component)
            .ok_or_else(|| {
                to_js_precrease_error(PrecreaseError::NoSuchComponent {
                    id: component,
                    count: analysis.components.len(),
                })
            })?;
        let mut opts = PlannerOptions::from_json(opts_json).map_err(to_js_precrease_error)?;
        opts.clock = default_clock();
        Ok(PrecreasePlanner {
            inner: Planner::new(found, opts),
        })
    }

    /// Status, sheet, target counts and what the exactness policy did.
    pub fn info(&self) -> Result<JsValue, JsValue> {
        let (targets, free_targets, remaining) = match self.inner.closure_ref() {
            Some(c) => (
                c.targets().len(),
                c.free_targets().len(),
                c.remaining().len(),
            ),
            None => (0, 0, 0),
        };
        let sequence = self.inner.sequence(false);
        to_js_value(&PlannerInfo {
            component: self.inner.component_id(),
            status: self.inner.status(),
            sheet: self.inner.sheet().copied(),
            exactness: sequence.exactness,
            refused: self.inner.status() == Status::RefusedSheet,
            off_lattice: self.inner.is_off_lattice(),
            targets,
            free_targets,
            remaining,
            point_cap: self.inner.options().point_cap,
        })
    }

    /// Run the closure for at most `budget_ms` (0 or less: unbounded).
    /// Resumable — a call that stops on its deadline keeps every fact.
    pub fn close(&mut self, budget_ms: f64) -> Result<JsValue, JsValue> {
        let budget = finite_budget(budget_ms, "budget_ms")?;
        let outcome = self.inner.close(budget).map_err(to_js_precrease_error)?;
        to_js_value(&CloseReport {
            folded: outcome.folded,
            remaining: outcome.remaining,
            exhausted: outcome.fixpoint && !outcome.budget_hit,
            fixpoint: outcome.fixpoint,
            budget_hit: outcome.budget_hit,
        })
    }

    /// What to do next, by the rules in `oristudio_precrease::drive`.
    ///
    /// The driver passes what it just did and the facts only it knows —
    /// whether it is out of time, whether the caller asked it to stop, whether
    /// it can reach ReferenceFinder and how many times it has. It gets back one
    /// of `close`, `stuck_search`, `ask_reference_finder` or `stop`.
    ///
    /// The point of routing the loop through here is that the rules exist once.
    /// They used to be written both in this crate and in the browser's own
    /// loop, and the two drifted until the same pattern could stop for
    /// different reasons depending on which ran it.
    pub fn next_action(&self, driver: JsValue) -> Result<JsValue, JsValue> {
        let driver: DriverState = serde_wasm_bindgen::from_value(driver)
            .map_err(|e| JsValue::from_str(&format!("invalid driver state: {e}")))?;
        to_js_value(&self.inner.next_action(driver))
    }

    /// Seven numbers per remaining CP line: `nx, ny, d` then its in-paper
    /// segment `ax, ay, bx, by`, all in the planner unit frame.
    pub fn remaining(&self) -> Vec<f64> {
        let mut out = Vec::new();
        for line in self.inner.remaining() {
            out.extend_from_slice(&[line.line.n[0], line.line.n[1], line.line.d]);
            out.extend_from_slice(&line.segment[0]);
            out.extend_from_slice(&line.segment[1]);
        }
        out
    }

    /// One decimal `u64` key per remaining line, in `remaining()`'s order.
    /// Strings, not BigInts: these are cache keys, and `JSON.stringify`
    /// throws on a BigInt.
    pub fn line_keys(&self) -> Vec<String> {
        self.inner
            .line_keys()
            .into_iter()
            .map(|key| key.to_string())
            .collect()
    }

    /// The forward-first search from the current (stuck) state, applying the
    /// auxiliary set it chooses. `null` when it finds nothing.
    pub fn stuck_search(&mut self, depth: u32, budget_ms: f64) -> Result<JsValue, JsValue> {
        let budget = finite_budget(budget_ms, "budget_ms")?;
        let depth = depth.clamp(1, 3) as u8;
        match self
            .inner
            .stuck_search(depth, budget)
            .map_err(to_js_precrease_error)?
        {
            Some(summary) => to_js_value(&summary),
            None => Ok(JsValue::NULL),
        }
    }

    /// Score `[nx, ny, d]` triples against the current state without folding
    /// anything: `0` for "not constructible from here", else `1 + unlocks`.
    pub fn score(&self, lines: &[f64]) -> Result<Box<[u32]>, JsValue> {
        let lines = parse_lines(lines)?;
        let scored = self
            .inner
            .score(&lines, 0.0)
            .map_err(to_js_precrease_error)?;
        Ok(scored
            .into_iter()
            .map(|unlocks| match unlocks {
                None => 0,
                Some(n) => u32::try_from(n).unwrap_or(u32::MAX - 1).saturating_add(1),
            })
            .collect())
    }

    /// Fold supplied lines in order — each only if the current state
    /// constructs it — then re-close. `tags`: 0 cp, 1 aux, 2 rf_aux.
    pub fn fold(&mut self, lines: &[f64], tags: &[u8], budget_ms: f64) -> Result<JsValue, JsValue> {
        let budget = finite_budget(budget_ms, "budget_ms")?;
        let parsed = parse_lines(lines)?;
        if tags.len() != parsed.len() {
            return Err(to_js_precrease_error(PrecreaseError::TagCountMismatch {
                lines: parsed.len(),
                tags: tags.len(),
            }));
        }
        let mut parsed_tags = Vec::with_capacity(tags.len());
        for (index, &tag) in tags.iter().enumerate() {
            parsed_tags.push(
                LineTag::from_code(tag).ok_or_else(|| {
                    to_js_precrease_error(PrecreaseError::InvalidTag { index, tag })
                })?,
            );
        }
        let outcomes: Vec<FoldOutcome> = self
            .inner
            .fold(&parsed, &parsed_tags, budget)
            .map_err(to_js_precrease_error)?;
        to_js_value(&outcomes)
    }

    /// The plan in its wire shape.
    pub fn sequence(&self, landmarks_first: bool) -> Result<JsValue, JsValue> {
        to_js_value(&self.inner.sequence(landmarks_first))
    }

    /// Everything known about one `[nx, ny, d]` line.
    pub fn explain(&self, line: &[f64]) -> Result<JsValue, JsValue> {
        let lines = parse_lines(line)?;
        let [line] = lines.as_slice() else {
            return Err(js_error(
                "invalid_input",
                format!("explain takes one [nx, ny, d] triple, got {}", line.len()),
            ));
        };
        to_js_value(&self.inner.explain(line))
    }

    /// `[nx, ny, d]` triples → four numbers per line, two points on it in the
    /// ReferenceFinder rectangle. A line that misses the sheet contributes
    /// four `NaN`s so the output stays parallel to the input.
    pub fn to_rf(&self, lines: &[f64]) -> Result<Vec<f64>, JsValue> {
        let lines = parse_lines(lines)?;
        let mut out = Vec::with_capacity(lines.len() * 4);
        for line in &lines {
            match self.inner.line_to_rf(line) {
                Some([a, b]) => {
                    out.extend_from_slice(&a);
                    out.extend_from_slice(&b);
                }
                None => out.extend_from_slice(&[f64::NAN; 4]),
            }
        }
        Ok(out)
    }

    /// Four numbers per line (two points in the ReferenceFinder rectangle) →
    /// canonical `[nx, ny, d]` triples. A degenerate pair is refused.
    pub fn from_rf(&self, points: &[f64]) -> Result<Vec<f64>, JsValue> {
        if !points.len().is_multiple_of(4) {
            return Err(js_error(
                "invalid_input",
                format!(
                    "from_rf takes [x1, y1, x2, y2, …] quadruples; got {} values",
                    points.len()
                ),
            ));
        }
        let mut out = Vec::with_capacity(points.len() / 4 * 3);
        for (index, quad) in points.chunks_exact(4).enumerate() {
            if quad.iter().any(|v| !v.is_finite()) {
                return Err(to_js_precrease_error(PrecreaseError::MalformedLine {
                    index,
                    reason: "point coordinates must be finite",
                }));
            }
            let line = self
                .inner
                .line_from_rf([quad[0], quad[1]], [quad[2], quad[3]])
                .ok_or_else(|| {
                    to_js_precrease_error(PrecreaseError::MalformedLine {
                        index,
                        reason: "the two points coincide",
                    })
                })?;
            out.extend_from_slice(&[line.n[0], line.n[1], line.d]);
        }
        Ok(out)
    }
}

fn parse_paper_fallback(paper_fallback: Option<Box<[f64]>>) -> Result<Option<[f64; 4]>, JsValue> {
    match paper_fallback {
        None => Ok(None),
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
            Ok(Some(rect))
        }
    }
}

/// `[nx, ny, d]` triples, validated: finite, and a normal long enough to
/// name a direction. A wrongly typed typed-array argument reaches Rust as
/// garbage, so this is the boundary that has to notice.
fn parse_lines(values: &[f64]) -> Result<Vec<Line>, JsValue> {
    if !values.len().is_multiple_of(3) {
        return Err(to_js_precrease_error(PrecreaseError::MalformedLines {
            len: values.len(),
        }));
    }
    let mut out = Vec::with_capacity(values.len() / 3);
    for (index, triple) in values.chunks_exact(3).enumerate() {
        if triple.iter().any(|v| !v.is_finite()) {
            return Err(to_js_precrease_error(PrecreaseError::MalformedLine {
                index,
                reason: "nx, ny and d must be finite",
            }));
        }
        let line = Line::new([triple[0], triple[1]], triple[2]).ok_or_else(|| {
            to_js_precrease_error(PrecreaseError::MalformedLine {
                index,
                reason: "the normal is zero",
            })
        })?;
        out.push(line);
    }
    Ok(out)
}

/// A millisecond budget: finite, and never negative. Zero means unbounded.
fn finite_budget(value: f64, name: &'static str) -> Result<f64, JsValue> {
    if !value.is_finite() {
        return Err(js_error(
            "invalid_input",
            format!("{name} must be a finite number of milliseconds, got {value}"),
        ));
    }
    Ok(value.max(0.0))
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
        PrecreaseError::MalformedLine { .. }
        | PrecreaseError::MalformedLines { .. }
        | PrecreaseError::InvalidTag { .. }
        | PrecreaseError::TagCountMismatch { .. }
        | PrecreaseError::NoSuchComponent { .. }
        | PrecreaseError::InvalidOptions { .. } => "invalid_input",
        PrecreaseError::NoSheet => "no_sheet",
        PrecreaseError::DegenerateFrame { .. } => "invalid_frame",
        PrecreaseError::NoFrame { .. } | PrecreaseError::RefusedSheet => "refused_sheet",
        PrecreaseError::PointCap { .. } => "point_cap",
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

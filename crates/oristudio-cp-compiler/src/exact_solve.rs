//! Full exact geometric solve for selected crease-pattern topology.
//!
//! This stage treats the selected graph as topology and solves for nearby
//! coordinates that better satisfy geometric/origami constraints. It does not
//! add or remove creases; topology selection belongs to the previous phase.

use crate::candidate_graph::{
    BoundaryReconstructionPolicy, CandidateCreaseBoundaryRole, CandidateVertex,
};
use crate::{
    AssignmentLabel, BoundaryModel, BoundarySide, CandidateCreaseSpan, CandidateCreaseSpanKind,
    CandidateGraphProvenance, CandidateSourceAdapter, CandidateVertexKind,
    CandidateVertexMovementPolicy, CostModel, ExactSolveInput, ExactSolvedGraph,
    ExactSolvedGraphStatus, Point2,
};
use levenberg_marquardt::{LeastSquaresProblem, LevenbergMarquardt};
use nalgebra::{DMatrix, Dyn, OMatrix, OVector, storage::Owned};
use nalgebra_sparse::factorization::CscCholesky;
use nalgebra_sparse::{CooMatrix, CscMatrix};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::borrow::Cow;
use std::cell::Cell;
use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;
#[cfg(not(target_arch = "wasm32"))]
use std::time::Instant;

const SCHEMA: &str = "oristudio/cp-compiler/exact-solved-graph-v1";
/// The single source of truth for the exact-solve wall-clock budget, shared by
/// the product decode path, the inspector, and the benchmark. Raised 10 -> 25s
/// after a threshold sweep showed many medium CPs reach correct topology but need
/// >3-10s to converge; individual surfaces may still override it.
pub const DEFAULT_EXACT_SOLVE_TIMEOUT_SECONDS: f64 = 25.0;
const TAU: f64 = std::f64::consts::TAU;

/// Linear-algebra backend for the LM step. The dense path factors `JᵀJ`
/// densely (O(params³) per iteration); the sparse path exploits the graph-local
/// sparsity of the constraint system for a ~1.7× (larger at high param counts)
/// speedup. Sparse is the default after parity + perf were verified against the
/// dense baseline (native pack: 0 accept regressions, +2 recoveries / 563,
/// exact-solve stage 72.9s → 42.7s); `Dense` remains selectable for A/B.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LinearSolver {
    Dense,
    #[default]
    Sparse,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ExactSolveOptions {
    pub patience: usize,
    pub ftol: f64,
    pub xtol: f64,
    pub gtol: f64,
    pub finite_difference_epsilon: f64,
    pub movement_sigma: f64,
    pub boundary_movement_sigma: f64,
    pub carrier_angle_sigma_radians: f64,
    pub carrier_rho_sigma: f64,
    pub carrier_incidence_sigma: f64,
    pub kawasaki_sigma_radians: f64,
    pub max_vertex_movement: f64,
    pub solved_kawasaki_epsilon_degrees: f64,
    pub solved_carrier_epsilon: f64,
    pub degenerate_edge_epsilon: f64,
    pub crossing_epsilon: f64,
    /// Wall-clock budget for the full exact solve in seconds. The solver checks
    /// the deadline between residual/Jacobian evaluations and returns a failed
    /// exact graph when the budget is exhausted. Negative values disable the
    /// timeout; zero times out immediately.
    #[serde(default = "default_timeout_seconds")]
    pub timeout_seconds: f64,
    /// Linear-algebra backend for the LM step (dense vs sparse). Defaults to
    /// sparse (verified parity + ~1.7× faster); `Dense` is selectable for A/B.
    #[serde(default)]
    pub linear_solver: LinearSolver,
    /// Run a second LM pass after an accepted solve, re-anchored to the
    /// stage-1 solution with tightened theorem sigmas. The stage-1 priors
    /// anchor to the noisy detected positions, so the first pass equilibrates
    /// near ~3e-3 degrees Kawasaki — above the flat-folder's measured ~1e-4
    /// relative-precision tolerance. Re-anchoring removes that floor.
    #[serde(default = "default_polish")]
    pub polish: bool,
    #[serde(default = "default_polish_kawasaki_sigma_radians")]
    pub polish_kawasaki_sigma_radians: f64,
    #[serde(default = "default_polish_carrier_incidence_sigma")]
    pub polish_carrier_incidence_sigma: f64,
    /// Maximum re-anchored polish rounds; each round tightens the remaining
    /// theorem residuals by roughly the prior/theorem sigma ratio.
    #[serde(default = "default_polish_rounds")]
    pub polish_rounds: usize,
    /// Stop polishing once the max Kawasaki residual is below this (degrees).
    #[serde(default = "default_polish_target_kawasaki_degrees")]
    pub polish_target_kawasaki_degrees: f64,
    /// Whether to look for the angle family a designed pattern is drawn in and
    /// pin its creases to it once the solve has converged. See
    /// [`AngleFamilyMode`].
    #[serde(default)]
    pub angle_family: AngleFamilyMode,
    /// How far from a lattice angle a carrier may sit and still be read as on
    /// it — both for deciding whether a family is present at all and for
    /// deciding which carriers are pinned. Radians. A pinned round refused at
    /// this width is retried at half of it, [`ANGLE_FAMILY_RETRY_HALVINGS`]
    /// times.
    #[serde(default = "default_angle_family_snap_tolerance_radians")]
    pub angle_family_snap_tolerance_radians: f64,
    /// Fraction of fold carriers that must sit within tolerance of a candidate
    /// lattice before the family is believed.
    #[serde(default = "default_angle_family_min_fraction")]
    pub angle_family_min_fraction: f64,
}

/// Designed crease patterns are quantized: their creases lie on a small set of
/// exact angles — 45° families, 22.5° families, occasionally 15° — and every
/// tie between two sectors at a vertex comes from that. Measured on hand-drawn
/// ground truth, between 37% and 100% of interior vertices have their smallest
/// sector *exactly* tied, and Big-Little-Big is vacuous at a tie.
///
/// Kawasaki alone cannot recover such a pattern. At degree 4 it is one equation
/// on four angles, leaving three free directions, and the optimizer spends them
/// on whatever the movement priors prefer — which is the noisy detected geometry,
/// not the lattice. So it breaks the ties by hundredths of a degree and turns
/// legal vertices into violations while staying Kawasaki-exact.
///
/// Nor can a *weighted* pull toward the lattice fix that: Big-Little-Big at a
/// near-tie is decided by the sign of the tie-break, not its size, so shrinking
/// the break from 0.02° to 0.002° only re-flips the coins (measured: a soft
/// lattice residual at every sigma from 0.1° to 2° left the clean corpus at the
/// same Big-Little-Big count it started with). The tie has to be exact, within
/// the checker's 1e-6°, and only a *pinned* direction gives that.
///
/// `Auto` therefore ends the polish stage with one more round: infer the family
/// (see [`infer_angle_family`]), set every on-lattice carrier's direction to its
/// exact lattice angle, freeze it there, and re-solve everything else. With the
/// directions pinned, incidence is linear and the solve lands vertices on those
/// lines to machine precision, so every sector angle is an exact lattice
/// difference — Kawasaki exact and every designed tie exact. The round is kept
/// only if it costs nothing: the acceptance gate, the Kawasaki bar, and the
/// checker's own angle and Big-Little-Big counts must all hold or improve, and
/// a refused round is retried with a tighter tolerance before giving up. A
/// carrier that is not near the lattice (a box-pleat diagonal at `atan 2`, a
/// freehand crease) is never pinned, and a pattern with no family is left
/// entirely alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AngleFamilyMode {
    #[default]
    Auto,
    Off,
}

fn default_angle_family_snap_tolerance_radians() -> f64 {
    1.5_f64.to_radians()
}

const fn default_angle_family_min_fraction() -> f64 {
    0.5
}

/// How many times a refused pinned round halves its tolerance and tries again.
/// 1.5° → 0.75° → 0.375°: a refusal means some pinned carrier was never on the
/// lattice, and the ones furthest from it are the suspects.
const ANGLE_FAMILY_RETRY_HALVINGS: usize = 2;

/// How many times a pinned attempt re-anchors its priors to its own result and
/// solves again before it is judged. The first solve stops with Kawasaki a few
/// millionths of a degree over the bar: the vertices it moved onto the pinned
/// lines charge movement energy, next to which those residuals are invisible
/// to the stopping test. Re-anchoring zeroes that charge, and the residuals
/// are all that is left to minimise — the same trick the polish rounds use.
const PINNED_REANCHOR_ROUNDS: usize = 3;

/// What the pinned round leaves on the clock for the analysis and report that
/// follow it. A round that runs out of its own allowance is refused; it must
/// never turn an accepted solve into one that timed out.
const PINNED_ROUND_RESERVE_SECONDS: f64 = 0.5;

/// Alternating sum a fully-pinned fan may have and still count as satisfying
/// Kawasaki on the lattice. Exact multiples of the step sum to zero up to
/// floating-point rounding, ~1e-15 radians.
const LATTICE_KAWASAKI_TOLERANCE: f64 = 1e-9;

/// The lattice steps a designed pattern is likely drawn on, coarsest first: the
/// square families (45° box pleating, 22.5°) and the hexagonal ones (30° hex
/// pleating, 15°). The family chosen is the one most of the carriers sit on
/// (see [`infer_angle_family`]); a tie goes to the coarser step, since a 45°
/// design fits every one of these and pins to the same angles under each.
///
/// Not finer than 15°. A finer candidate is a trap: with detection noise wide
/// enough that a real 22.5° pattern misses the bar, an 11.25° lattice will
/// "explain" the stragglers by accident and be chosen instead — measured on
/// close_but_not_good_enough.osf, which is a 22.5° design and was read as
/// 11.25°, snapping carriers to angles it does not have. 15° is the same
/// distance from the 22.5° family's odd multiples (7.5°) as 11.25° is from
/// nothing, and a 22.5° design fits it only at its multiples of 45°, so the
/// fraction test keeps them apart: measured, 22.5° designs read as 22.5°.
const ANGLE_FAMILY_STEPS_DEGREES: [f64; 4] = [45.0, 30.0, 22.5, 15.0];

/// Signed distance from `theta` to the nearest multiple of `step`, in
/// `(-step/2, step/2]`. A carrier's theta is its normal's angle, and every
/// candidate step divides 90°, so a lattice on directions is the same lattice
/// on normals.
fn lattice_offset(theta: f64, step: f64) -> f64 {
    theta - (theta / step).round() * step
}

/// The lattice most of the carriers sit within `tolerance` of — the largest
/// such fraction, at least `min_fraction`, ties to the coarser step — or `None`
/// when no candidate reaches the bar. Freehand geometry lands within 1.5° of a
/// 15° lattice about 20% of the time and of a 22.5° one about 13%, both well
/// under the bar. Returned in **degrees**, as written in
/// [`ANGLE_FAMILY_STEPS_DEGREES`], so a report says `15` and not
/// `14.999999999999998`; the lattice arithmetic takes radians.
fn infer_angle_family(thetas: &[f64], tolerance: f64, min_fraction: f64) -> Option<f64> {
    if thetas.is_empty() {
        return None;
    }
    let mut best: Option<(f64, usize)> = None;
    for step_degrees in ANGLE_FAMILY_STEPS_DEGREES {
        let step = step_degrees.to_radians();
        let on_lattice = thetas
            .iter()
            .filter(|theta| lattice_offset(**theta, step).abs() <= tolerance)
            .count();
        if (on_lattice as f64) < min_fraction * thetas.len() as f64 {
            continue;
        }
        if best.is_none_or(|(_, count)| on_lattice > count) {
            best = Some((step_degrees, on_lattice));
        }
    }
    best.map(|(step_degrees, _)| step_degrees)
}

const fn default_polish() -> bool {
    true
}

const fn default_timeout_seconds() -> f64 {
    DEFAULT_EXACT_SOLVE_TIMEOUT_SECONDS
}

fn default_polish_kawasaki_sigma_radians() -> f64 {
    0.001_f64.to_radians()
}

const fn default_polish_carrier_incidence_sigma() -> f64 {
    1e-7
}

const fn default_polish_rounds() -> usize {
    6
}

const fn default_polish_target_kawasaki_degrees() -> f64 {
    1e-6
}

impl Default for ExactSolveOptions {
    fn default() -> Self {
        Self {
            patience: 40,
            ftol: 1e-10,
            xtol: 1e-10,
            gtol: 1e-10,
            finite_difference_epsilon: 1e-6,
            // Position-prior sigmas tightened 0.012/0.004 -> 0.003/0.001 and the
            // movement budget 0.050 -> 0.010 after a native-pack replay sweep
            // (2026-07-04): the loose priors let LM drift vertices 2-5px off the
            // detected positions to buy negligible theorem-residual improvements,
            // converging to a nearby valid-but-wrong CP. Tightened:
            // solve-recovered 94 -> 121 / 563, accepted-but-wrong 46 -> 17, zero
            // recovery regressions. 0.003 beat 0.002/0.004 and both flanking
            // boundary sigmas; the budget change only rejects two large-drift
            // wrong solutions (movement caps stay far above real recoveries).
            movement_sigma: 0.003,
            boundary_movement_sigma: 0.001,
            carrier_angle_sigma_radians: 2.0_f64.to_radians(),
            carrier_rho_sigma: 0.010,
            carrier_incidence_sigma: 0.0008,
            kawasaki_sigma_radians: 0.10_f64.to_radians(),
            max_vertex_movement: 0.010,
            // The editor's check (`Epsilon::FLAT`) is 1e-6 degrees. This was
            // 1e-3 — a thousand times looser — so "solved" and "no markers"
            // were different claims. `classify_status` also consults the
            // checker directly now; this stays as the solver's own reading.
            solved_kawasaki_epsilon_degrees: 1e-6,
            solved_carrier_epsilon: 5e-4,
            degenerate_edge_epsilon: COLLAPSED_SPAN_LENGTH,
            crossing_epsilon: 1e-7,
            timeout_seconds: default_timeout_seconds(),
            linear_solver: LinearSolver::Sparse,
            polish: default_polish(),
            angle_family: AngleFamilyMode::default(),
            angle_family_snap_tolerance_radians: default_angle_family_snap_tolerance_radians(),
            angle_family_min_fraction: default_angle_family_min_fraction(),
            polish_kawasaki_sigma_radians: default_polish_kawasaki_sigma_radians(),
            polish_carrier_incidence_sigma: default_polish_carrier_incidence_sigma(),
            polish_rounds: default_polish_rounds(),
            polish_target_kawasaki_degrees: default_polish_target_kawasaki_degrees(),
        }
    }
}

/// [`ExactSolveOptions`] plus the set of vertices exempt from the
/// `max_vertex_movement` budget.
///
/// The exemption is what lets a user-authored repair through: the movement
/// budget is measured from the *input* coordinates, so a vertex the user
/// deliberately dragged reads as a large drift and rejects the whole solve
/// (`movement_budget_exceeded`), even though every other vertex is well inside
/// the cap. Exempting that one vertex leaves the cap in force everywhere else,
/// which is the point — the budget's job is to catch LM wandering off toward a
/// nearby valid-but-wrong CP, and a blanket raise gives that up globally.
///
/// The set lives here rather than in [`ExactSolveOptions`] because
/// `ExactSolveOptions` is `Copy` and is moved out of shared references across
/// the workspace (e.g. `solve_exact(&input, args.options)` inside a `par_iter`
/// closure in the replay binary); a heap-allocated field would break those
/// call sites. `#[serde(flatten)]` keeps the JSON shape a superset of the
/// options object, so a serialized `ExactSolveOptions` deserializes into this
/// type unchanged and gains one optional `exempt_vertex_ids` key.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct ExactSolveOptionsWithExemptions {
    #[serde(flatten)]
    pub options: ExactSolveOptions,
    /// Vertex ids excluded from the `max_vertex_movement` maximum. Empty by
    /// default, in which case the budget behaves exactly as it always has.
    #[serde(default)]
    pub exempt_vertex_ids: BTreeSet<usize>,
}

impl From<ExactSolveOptions> for ExactSolveOptionsWithExemptions {
    fn from(options: ExactSolveOptions) -> Self {
        Self {
            options,
            exempt_vertex_ids: BTreeSet::new(),
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct ExactSolveDeadline {
    timeout_seconds: f64,
    #[cfg(not(target_arch = "wasm32"))]
    started_at: Instant,
    #[cfg(target_arch = "wasm32")]
    started_at_ms: f64,
}

impl ExactSolveDeadline {
    fn start(timeout_seconds: f64) -> Self {
        Self {
            timeout_seconds,
            #[cfg(not(target_arch = "wasm32"))]
            started_at: Instant::now(),
            #[cfg(target_arch = "wasm32")]
            started_at_ms: js_sys::Date::now(),
        }
    }

    fn elapsed_seconds(&self) -> f64 {
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.started_at.elapsed().as_secs_f64()
        }
        #[cfg(target_arch = "wasm32")]
        {
            (js_sys::Date::now() - self.started_at_ms) / 1000.0
        }
    }

    fn expired(&self) -> bool {
        self.timeout_seconds.is_finite()
            && self.timeout_seconds >= 0.0
            && self.elapsed_seconds() >= self.timeout_seconds
    }
}

pub fn solve_exact(input: &ExactSolveInput, options: ExactSolveOptions) -> ExactSolvedGraph {
    let normalized = normalized_input(input);
    let mut solved = solve_exact_inner(&normalized, options, Rc::new(BTreeSet::new()));
    place_dissolved_vertices(&normalized, input, &mut solved.vertices_exact);
    report_dissolved_movement(&normalized, input, &mut solved);
    restore_original_edges(input, &mut solved);
    solved
}

/// [`solve_exact`] with a per-vertex movement-budget exemption set; see
/// [`ExactSolveOptionsWithExemptions`]. With an empty exemption set this is
/// [`solve_exact`].
pub fn solve_exact_with_exemptions(
    input: &ExactSolveInput,
    options: &ExactSolveOptionsWithExemptions,
) -> ExactSolvedGraph {
    let normalized = normalized_input(input);
    let mut solved = solve_exact_inner(
        &normalized,
        options.options,
        Rc::new(options.exempt_vertex_ids.clone()),
    );
    place_dissolved_vertices(&normalized, input, &mut solved.vertices_exact);
    report_dissolved_movement(&normalized, input, &mut solved);
    restore_original_edges(input, &mut solved);
    solved
}

/// Tell the movement report about the vertices [`place_dissolved_vertices`] just
/// moved.
///
/// The report is built inside the solve, from the graph the solve ran on — which
/// is the *normalized* one, where a dissolved degree-2 vertex belongs to no span
/// and therefore never moves. Straightening it onto the solved crease happens
/// after that, so without this the report undercounts: 55 vertices claimed
/// against 76 actually moved on `mid-solve_4`, and that count is what a caller
/// shows the user to justify accepting the answer.
///
/// Only additive. `before` is the coordinate the caller handed in and `after` is
/// what `vertices_exact` now holds, so no existing entry changes and the
/// acceptance decision — long since taken — cannot move.
fn report_dissolved_movement(
    normalized: &ExactSolveInput,
    original: &ExactSolveInput,
    solved: &mut ExactSolvedGraph,
) {
    let dissolved: Vec<usize> = normalized
        .selected_spans
        .iter()
        .flat_map(|span| span.collapsed_vertex_ids.iter().copied())
        .collect();
    if dissolved.is_empty() {
        return;
    }
    let Some(report) = solved.movement_report.as_object_mut() else {
        return;
    };
    let mut added = Vec::new();
    let mut max_added = 0.0_f64;
    for id in dissolved {
        let (Some(was), Some(now)) = (original.vertices.get(id), solved.vertices_exact.get(id))
        else {
            continue;
        };
        let movement = distance(was.point, *now);
        if movement <= 1e-10 {
            continue;
        }
        max_added = max_added.max(movement);
        added.push(json!({
            "vertex_id": was.id,
            "before": was.point,
            "after": now,
            "movement": round6(movement),
            "movement_policy": was.movement_policy,
            "boundary_side": was.boundary_side,
            "support": round6(was.support),
        }));
    }
    if added.is_empty() {
        return;
    }
    for key in ["moved_vertices", "attempted_moved_vertices"] {
        if let Some(Value::Array(list)) = report.get_mut(key) {
            list.extend(added.iter().cloned());
        }
    }
    for key in ["max_vertex_movement", "attempted_max_vertex_movement"] {
        if let Some(slot) = report.get_mut(key) {
            let current = slot.as_f64().unwrap_or(0.0);
            if max_added > current {
                *slot = json!(round6(max_added));
            }
        }
    }
}

/// Read an input the way the compiler means it, before anything else looks at it.
///
/// Today that is one normalisation — dissolving collinear degree-2 vertices, see
/// [`merge_collinear_degree_two_spans`] — and it is applied here rather than at
/// either call site so that the topology report and the solve can never disagree
/// about what the graph is. A gate that routes the user to Review & Fix over a
/// vertex the solve would have merged anyway is the failure this placement
/// prevents.
fn normalized_input(input: &ExactSolveInput) -> Cow<'_, ExactSolveInput> {
    let mut owned = input.clone();
    if merge_collinear_degree_two_spans(&mut owned) > 0 {
        Cow::Owned(owned)
    } else {
        Cow::Borrowed(input)
    }
}

/// Put every dissolved vertex back onto the crease it was dissolved into.
///
/// Merging a collinear split takes the vertex out of the constraint system,
/// which is the point — but it also takes it out of the *answer*, and that half
/// would be a regression. `solvedRegionSegments` moves the crease ends the solver
/// moved, so a dissolved vertex left at its input position while both its
/// neighbours move does not merely stay kinked, it gets *more* kinked. The
/// solver used to straighten these itself, through shared-carrier incidence —
/// `shared_carrier_incidence_straightens_noisy_split_vertex` is the test that
/// proves it — and that outcome has to survive.
///
/// So it is reconstructed rather than optimised: each dissolved vertex keeps its
/// parameter along the original chord and is placed at that parameter along the
/// solved one. Exactly on the line, which is better than the trust-region nudge
/// it used to get, and free.
/// Report the answer against the graph the caller passed, not the one solved.
///
/// Merging is an internal normalisation, so it must not change the shape of the
/// result: `edges_exact` is paired with `input.selected_spans` by index
/// downstream — `export_exact_solved_to_fold_document` refuses on a count
/// mismatch, which is how this was caught — and every original span's endpoints
/// are valid now that the dissolved vertices sit back on their creases.
fn restore_original_edges(original: &ExactSolveInput, solved: &mut ExactSolvedGraph) {
    solved.edges_exact = original
        .selected_spans
        .iter()
        .map(|span| span.vertices)
        .collect();
}

fn place_dissolved_vertices(
    normalized: &ExactSolveInput,
    original: &ExactSolveInput,
    points: &mut [Point2],
) {
    for span in &normalized.selected_spans {
        if span.collapsed_vertex_ids.is_empty() {
            continue;
        }
        let [a, b] = span.vertices;
        let (Some(&solved_a), Some(&solved_b)) = (points.get(a), points.get(b)) else {
            continue;
        };
        let (Some(from), Some(to)) = (original.vertices.get(a), original.vertices.get(b)) else {
            continue;
        };
        let (dx, dy) = (to.point.x - from.point.x, to.point.y - from.point.y);
        let chord = dx * dx + dy * dy;
        if chord <= 0.0 {
            continue;
        }
        for &id in &span.collapsed_vertex_ids {
            let (Some(was), Some(slot)) = (original.vertices.get(id), points.get_mut(id)) else {
                continue;
            };
            // Parameter along the original chord, clamped so a vertex that sat
            // slightly past an end does not fly off the solved crease.
            let t = (((was.point.x - from.point.x) * dx + (was.point.y - from.point.y) * dy)
                / chord)
                .clamp(0.0, 1.0);
            *slot = Point2::new(
                solved_a.x + t * (solved_b.x - solved_a.x),
                solved_a.y + t * (solved_b.y - solved_a.y),
            );
        }
    }
}

fn solve_exact_inner(
    input: &ExactSolveInput,
    options: ExactSolveOptions,
    exempt_vertex_ids: Rc<BTreeSet<usize>>,
) -> ExactSolvedGraph {
    let deadline = ExactSolveDeadline::start(options.timeout_seconds);
    let validation = validate_input(input);
    if !validation.is_empty() {
        return failed_graph(
            input,
            input.vertices.iter().map(|vertex| vertex.point).collect(),
            json!({
                "status": "not_run",
                "blockers": validation,
            }),
            json!({
                "status": "failed",
                "blockers": validation,
            }),
        );
    }

    let model = SolveModel::new(input, options, deadline, exempt_vertex_ids);
    let initial_params = model.initial_params.clone();
    let before_points = model.points_from_params(&initial_params);
    let before = analyze_graph(input, &before_points, &model, &initial_params, options);
    let (initial_residuals, initial_breakdown) = model.residuals_with_breakdown(&initial_params);
    let initial_objective = residual_energy(&initial_residuals);
    let preflight_rejection_reasons = exact_solve_preflight_rejection_reasons(&before);
    if !preflight_rejection_reasons.is_empty() {
        let counters = SolveCounterSnapshot::default();
        let movement_report = movement_report(
            input,
            &before_points,
            &before_points,
            &before_points,
            initial_objective,
            initial_objective,
            initial_objective,
            0,
            "preflight_blocked",
            options,
            false,
            &preflight_rejection_reasons,
            &model,
            &initial_breakdown,
            &initial_breakdown,
            &initial_breakdown,
            &counters,
            &PolishOutcome::not_run("preflight_blocked"),
        );
        let theorem_residual_report = theorem_report(
            &before,
            &before,
            &before,
            "preflight_blocked",
            false,
            &preflight_rejection_reasons,
        );
        return ExactSolvedGraph {
            schema: SCHEMA.to_owned(),
            vertices_exact: before_points,
            edges_exact: input
                .selected_spans
                .iter()
                .map(|span| span.vertices)
                .collect(),
            merged_vertices: Vec::new(),
            movement_report,
            theorem_residual_report,
            status: ExactSolvedGraphStatus::Failed,
        };
    }

    let (final_params, termination, evaluations, objective, counters) = if initial_params.is_empty()
    {
        (
            initial_params.clone(),
            "no_parameters".to_owned(),
            0usize,
            initial_objective,
            SolveCounterSnapshot::default(),
        )
    } else if initial_residuals.is_empty() {
        (
            initial_params.clone(),
            "no_residuals".to_owned(),
            0usize,
            initial_objective,
            SolveCounterSnapshot::default(),
        )
    } else {
        run_lm_minimize(&model, &initial_params, options)
    };

    // Polish: the stage-1 priors anchor to noisy detected positions, so LM
    // equilibrates near ~3e-3 degrees Kawasaki — above the flat-folder's
    // ~1e-4 precision tolerance. Re-anchor the priors to the accepted stage-1
    // solution and re-solve with tightened theorem sigmas. Runs only when the
    // stage-1 candidate would be accepted, so failure paths are untouched.
    let mut polish_outcome = PolishOutcome::default();
    let no_merges = BTreeSet::new();
    let (final_params, termination, evaluations, objective, polish_adopted, merged_span_ids) = 'polish: {
        if !options.polish {
            polish_outcome.stop_reason = "disabled";
            break 'polish (
                final_params,
                termination,
                evaluations,
                objective,
                false,
                no_merges,
            );
        }
        if final_params.is_empty() {
            polish_outcome.stop_reason = "no_parameters";
            break 'polish (
                final_params,
                termination,
                evaluations,
                objective,
                false,
                no_merges,
            );
        }
        if model.timeout_reached() {
            polish_outcome.stop_reason = "timed_out";
            break 'polish (
                final_params,
                termination,
                evaluations,
                objective,
                false,
                no_merges,
            );
        }
        let stage1_points = model.points_from_params(&final_params);
        let stage1_after = analyze_graph(input, &stage1_points, &model, &final_params, options);
        let stage1_status = classify_status(&before, &stage1_after, options);
        let stage1_accepted = exact_solution_rejection_reasons(
            &before,
            &stage1_after,
            stage1_status,
            initial_objective,
            objective,
            options,
        )
        .is_empty();
        if !stage1_accepted {
            polish_outcome.stop_reason = "stage1_rejected";
            break 'polish (
                final_params,
                termination,
                evaluations,
                objective,
                false,
                no_merges,
            );
        }
        let mut current_params = final_params.clone();
        let mut current_kawasaki = stage1_after.max_kawasaki_residual_degrees;
        let mut current_after = stage1_after;
        let mut polish_evaluations = 0usize;
        let mut rounds_adopted = 0usize;
        polish_outcome.stop_reason = "max_rounds";
        polish_outcome.kawasaki_before_degrees = Some(current_kawasaki);
        polish_outcome.kawasaki_after_degrees = Some(current_kawasaki);
        for _round in 0..options.polish_rounds {
            if model.timeout_reached() {
                polish_outcome.stop_reason = "timed_out";
                break;
            }
            if current_kawasaki <= options.polish_target_kawasaki_degrees {
                polish_outcome.stop_reason = "target_reached";
                break;
            }
            polish_outcome.rounds_attempted += 1;
            let polish_model = model.reanchored_for_polish(&current_params);
            let polish_start_energy = residual_energy(&polish_model.residuals_for(&current_params));
            let (polished_params, _polish_termination, polish_round_evaluations, _obj, _counters) =
                run_lm_minimize(&polish_model, &current_params, options);
            let polish_final_energy =
                residual_energy(&polish_model.residuals_for(&polished_params));
            let polished_points = model.points_from_params(&polished_params);
            let polished_after =
                analyze_graph(input, &polished_points, &model, &polished_params, options);
            let polished_status = classify_status(&before, &polished_after, options);
            // Judge the polish candidate's objective progress in the POLISH
            // model's units: the original objective anchors to the noisy
            // detected positions, which is exactly the equilibrium the polish
            // exists to escape; under it any successful polish looks "worse"
            // by construction. Geometric sanity (movement budget from the
            // original points, odd/degenerate/crossing/boundary
            // non-regression) still uses the original before/after analyses.
            let polish_rejections = exact_solution_rejection_reasons(
                &before,
                &polished_after,
                polished_status,
                polish_start_energy,
                polish_final_energy,
                options,
            );
            let kawasaki_improved =
                polished_after.max_kawasaki_residual_degrees <= current_kawasaki;
            let improved = polish_rejections.is_empty() && kawasaki_improved;
            if !improved {
                // Reporting only: record what this round would have reached and
                // why it was thrown away, so a silently-refused polish is
                // legible in `movement_report`. See [`PolishOutcome`].
                polish_outcome.stop_reason = "round_refused";
                polish_outcome.refused_round = Some(PolishRefusal {
                    kawasaki_degrees: polished_after.max_kawasaki_residual_degrees,
                    kawasaki_regressed: !kawasaki_improved,
                    rejection_reasons: polish_rejections,
                });
                break;
            }
            current_params = polished_params;
            current_kawasaki = polished_after.max_kawasaki_residual_degrees;
            current_after = polished_after;
            polish_evaluations += polish_round_evaluations;
            rounds_adopted += 1;
            polish_outcome.rounds_adopted = rounds_adopted;
            polish_outcome.kawasaki_after_degrees = Some(current_kawasaki);
        }
        // Last: pin the pattern to its angle family, if it has one. Runs after
        // the rounds, not as one of them, because a candidate that reached the
        // Kawasaki target straight out of stage 1 skips the loop entirely, and
        // that is exactly the clean designed pattern the pin is for.
        let mut pinned_adopted = false;
        let mut merged_span_ids = BTreeSet::new();
        if let Some(round) = pin_to_angle_family(
            &model,
            input,
            &before,
            &current_params,
            &current_after,
            options,
        ) {
            if let Some(adoption) = round.adopted {
                current_params = adoption.params;
                current_kawasaki = adoption.after.max_kawasaki_residual_degrees;
                current_after = adoption.after;
                polish_evaluations += adoption.evaluations;
                merged_span_ids = adoption.merged_span_ids;
                polish_outcome.kawasaki_after_degrees = Some(current_kawasaki);
                pinned_adopted = true;
            }
            polish_outcome.pinned_family = Some(round.outcome);
        }
        let _ = &current_after;
        if rounds_adopted == 0 && !pinned_adopted {
            break 'polish (
                final_params,
                termination,
                evaluations,
                objective,
                false,
                merged_span_ids,
            );
        }
        let polished_objective = residual_energy(&model.residuals_for(&current_params));
        let pinned = if pinned_adopted { ",pinned" } else { "" };
        (
            current_params,
            format!("{termination}+polish(rounds={rounds_adopted}{pinned})"),
            evaluations + polish_evaluations,
            polished_objective,
            true,
            merged_span_ids,
        )
    };
    // From here the answer is judged and described as the editor will hold it.
    let model = model.with_merged_spans(&merged_span_ids);

    let candidate_points = model.placed_points(&final_params);
    let candidate_after = analyze_graph(input, &candidate_points, &model, &final_params, options);
    let candidate_status = classify_status(&before, &candidate_after, options);
    let timed_out = model.timeout_reached();
    let termination = if timed_out {
        timeout_termination(&termination, options)
    } else {
        termination
    };
    // A polish-adopted candidate already passed the full acceptance gate (in
    // polish-model objective units); re-judging it against the original noisy
    // anchors would re-reject every successful polish.
    let rejection_reasons = if timed_out {
        vec![timeout_rejection_reason(options)]
    } else if polish_adopted {
        Vec::new()
    } else {
        exact_solution_rejection_reasons(
            &before,
            &candidate_after,
            candidate_status,
            initial_objective,
            objective,
            options,
        )
    };
    let accepted = !timed_out && rejection_reasons.is_empty();
    let (vertices_exact, after, accepted_objective, status) = if accepted {
        (
            candidate_points.clone(),
            candidate_after.clone(),
            objective,
            candidate_status,
        )
    } else {
        (
            before_points.clone(),
            before.clone(),
            initial_objective,
            ExactSolvedGraphStatus::Failed,
        )
    };
    let (_, accepted_breakdown) = if accepted {
        model.residuals_with_breakdown(&final_params)
    } else {
        (initial_residuals.clone(), initial_breakdown)
    };
    let (_, candidate_breakdown) = if timed_out {
        (initial_residuals.clone(), initial_breakdown)
    } else {
        model.residuals_with_breakdown(&final_params)
    };
    let movement_report = movement_report(
        input,
        &before_points,
        &vertices_exact,
        &candidate_points,
        initial_objective,
        accepted_objective,
        objective,
        evaluations,
        &termination,
        options,
        accepted,
        &rejection_reasons,
        &model,
        &initial_breakdown,
        &accepted_breakdown,
        &candidate_breakdown,
        &counters,
        &polish_outcome,
    );
    let theorem_residual_report = theorem_report(
        &before,
        &after,
        &candidate_after,
        &termination,
        accepted,
        &rejection_reasons,
    );

    ExactSolvedGraph {
        schema: SCHEMA.to_owned(),
        vertices_exact,
        edges_exact: input
            .selected_spans
            .iter()
            .map(|span| span.vertices)
            .collect(),
        merged_vertices: model.merged_vertex_pairs(),
        movement_report,
        theorem_residual_report,
        status,
    }
}

#[derive(Debug, Clone)]
struct SolveModel {
    vertex_params: Vec<VertexParameterization>,
    carrier_groups: Vec<CarrierGroup>,
    /// Parameters the optimizer must not move, by index; empty means none. A
    /// frozen parameter still shapes every residual it appears in, it just gets
    /// no Jacobian column. See [`SolveModel::pinned_to_angle_family`].
    frozen_params: Vec<bool>,
    /// Spans the pinned round collapsed to a point and the solve adopted as
    /// merges: their two endpoints are one vertex. See [`analyze_graph`].
    merged_span_ids: BTreeSet<usize>,
    /// Per vertex, the vertex that stands for it once merges are applied — its
    /// own id outside any merge. Empty when there are no merges. See
    /// [`merged_vertex_representatives`].
    merged_representative: Vec<usize>,
    span_to_carrier_group: BTreeMap<usize, usize>,
    initial_params: OVector<f64, Dyn>,
    selected_spans: Vec<CandidateCreaseSpan>,
    vertices: Vec<CandidateVertex>,
    cost_model: CostModel,
    options: ExactSolveOptions,
    deadline: ExactSolveDeadline,
    timed_out: Rc<Cell<bool>>,
    provenance: CandidateGraphProvenance,
    /// Vertices excluded from the `max_vertex_movement` maximum; see
    /// [`ExactSolveOptionsWithExemptions`]. Shared rather than cloned so the
    /// per-round polish copies of this model stay free.
    exempt_vertex_ids: Rc<BTreeSet<usize>>,
}

impl SolveModel {
    fn new(
        input: &ExactSolveInput,
        options: ExactSolveOptions,
        deadline: ExactSolveDeadline,
        exempt_vertex_ids: Rc<BTreeSet<usize>>,
    ) -> Self {
        let mut params = Vec::new();
        let polygon = is_polygon_boundary(input);
        let corner_points = if polygon {
            polygon_corner_points(input)
        } else {
            corner_points(&input.boundary)
        };
        let side_segments = if polygon {
            polygon_side_segments(input)
        } else {
            BTreeMap::new()
        };
        let corner_ids = input
            .boundary
            .corners
            .iter()
            .copied()
            .collect::<BTreeSet<_>>();
        let mut vertex_params = Vec::with_capacity(input.vertices.len());
        for vertex in &input.vertices {
            if let Some(point) = corner_points.get(&vertex.id).copied() {
                vertex_params.push(VertexParameterization::Fixed { point });
                continue;
            }
            if vertex.movement_policy == CandidateVertexMovementPolicy::Locked
                || corner_ids.contains(&vertex.id)
            {
                vertex_params.push(VertexParameterization::Fixed {
                    point: vertex.point,
                });
                continue;
            }
            if let Some(&(origin, vector)) = side_segments.get(&vertex.id) {
                let index = params.len();
                params.push(segment_param(vertex.point, origin, vector));
                vertex_params.push(VertexParameterization::PolyBoundary {
                    index,
                    origin,
                    vector,
                });
            } else if let Some(side) = vertex.boundary_side {
                let index = params.len();
                params.push(side_coord(side, vertex.point));
                vertex_params.push(VertexParameterization::Boundary { index, side });
            } else {
                let x_index = params.len();
                params.push(vertex.point.x);
                let y_index = params.len();
                params.push(vertex.point.y);
                vertex_params.push(VertexParameterization::Free { x_index, y_index });
            }
        }

        let mut group_by_key = BTreeMap::<CarrierGroupKey, usize>::new();
        let mut carrier_groups = Vec::new();
        let mut span_to_carrier_group = BTreeMap::new();
        for (span_index, span) in input.selected_spans.iter().enumerate() {
            if span.assignment_label() == AssignmentLabel::Boundary
                || span.kind == CandidateCreaseSpanKind::BorderSpan
            {
                continue;
            }
            let key = CarrierGroupKey::from_span(span);
            let group_index = if let Some(index) = group_by_key.get(&key).copied() {
                index
            } else {
                let theta_index = params.len();
                let theta = span.carrier.normal.y.atan2(span.carrier.normal.x);
                params.push(theta);
                let rho_index = params.len();
                params.push(span.carrier.rho);
                let index = carrier_groups.len();
                carrier_groups.push(CarrierGroup {
                    span_indices: Vec::new(),
                    theta_index,
                    rho_index,
                    initial_theta: theta,
                    initial_rho: span.carrier.rho,
                    pinned_step: None,
                });
                group_by_key.insert(key, index);
                index
            };
            carrier_groups[group_index].span_indices.push(span_index);
            span_to_carrier_group.insert(span.id, group_index);
        }

        Self {
            vertex_params,
            carrier_groups,
            frozen_params: Vec::new(),
            merged_span_ids: BTreeSet::new(),
            merged_representative: Vec::new(),
            span_to_carrier_group,
            initial_params: OVector::<f64, Dyn>::from_vec(params),
            selected_spans: input.selected_spans.clone(),
            vertices: input.vertices.clone(),
            cost_model: input.cost_model.clone(),
            options,
            deadline,
            timed_out: Rc::new(Cell::new(false)),
            provenance: input.provenance.clone(),
            exempt_vertex_ids,
        }
    }

    fn timeout_reached(&self) -> bool {
        if self.timed_out.get() {
            return true;
        }
        if self.deadline.expired() {
            self.timed_out.set(true);
            return true;
        }
        false
    }

    fn points_from_params(&self, params: &OVector<f64, Dyn>) -> Vec<Point2> {
        let points: Vec<Point2> = self
            .vertex_params
            .iter()
            .map(|param| match *param {
                VertexParameterization::Fixed { point } => point,
                VertexParameterization::Boundary { index, side } => side_point(side, params[index]),
                VertexParameterization::PolyBoundary {
                    index,
                    origin,
                    vector,
                } => Point2::new(
                    origin.x + params[index] * vector.x,
                    origin.y + params[index] * vector.y,
                ),
                VertexParameterization::Free { x_index, y_index } => Point2::new(
                    params[x_index].clamp(-0.25, 1.25),
                    params[y_index].clamp(-0.25, 1.25),
                ),
            })
            .collect();
        points
    }

    /// The points the answer places: [`Self::points_from_params`] with every
    /// merged pair at one point. The optimizer holds the two within ~1e-12 of
    /// each other, and the answer makes that exact, because the editor and the
    /// checker both group creases at a point by an epsilon and a pair that
    /// straddled it would be two half-fans.
    fn placed_points(&self, params: &OVector<f64, Dyn>) -> Vec<Point2> {
        let mut points = self.points_from_params(params);
        for (vertex, &representative) in self.merged_representative.iter().enumerate() {
            if representative != vertex {
                points[vertex] = points[representative];
            }
        }
        points
    }

    /// A copy of this model whose movement/carrier priors anchor to the given
    /// solved parameters instead of the original detected positions, with the
    /// polish-stage theorem sigmas. Parameter layout is identical, so solved
    /// params from this model evaluate directly in the original model.
    fn reanchored_for_polish(&self, solved: &OVector<f64, Dyn>) -> Self {
        let mut polished = self.clone();
        let solved_points = self.points_from_params(solved);
        for (vertex, point) in polished.vertices.iter_mut().zip(&solved_points) {
            vertex.point = *point;
        }
        for group in &mut polished.carrier_groups {
            group.initial_theta = solved[group.theta_index];
            group.initial_rho = solved[group.rho_index];
        }
        polished.initial_params = solved.clone();
        polished.options.kawasaki_sigma_radians = self.options.polish_kawasaki_sigma_radians;
        polished.options.carrier_incidence_sigma = self.options.polish_carrier_incidence_sigma;
        polished
    }

    /// The polish model for a pinned round: re-anchored to `solved` like
    /// [`Self::reanchored_for_polish`], with every carrier within `tolerance`
    /// of the `step` lattice set to its exact lattice angle and frozen there —
    /// less the ones [`Self::peel_inconsistent_pins`] lets go. Returns the
    /// model, the parameters to start from (`solved` with those directions
    /// snapped) and how many carriers were let go, or `None` when no carrier is
    /// both on the lattice and off it by enough to be worth moving.
    fn pinned_to_angle_family(
        &self,
        solved: &OVector<f64, Dyn>,
        step: f64,
        tolerance: f64,
    ) -> Option<(Self, OVector<f64, Dyn>, usize)> {
        let mut pin: Vec<bool> = self
            .carrier_groups
            .iter()
            .map(|group| lattice_offset(solved[group.theta_index], step).abs() <= tolerance)
            .collect();
        let peeled = self.peel_inconsistent_pins(solved, step, &mut pin);
        let mut pinned = self.reanchored_for_polish(solved);
        pinned.frozen_params = vec![false; solved.len()];
        let mut start = solved.clone();
        let mut moved = 0usize;
        for (group, &pin_this) in pinned.carrier_groups.iter_mut().zip(&pin) {
            if !pin_this {
                continue;
            }
            let theta = solved[group.theta_index];
            let offset = lattice_offset(theta, step);
            let snapped = theta - offset;
            group.pinned_step = Some(step);
            group.initial_theta = snapped;
            start[group.theta_index] = snapped;
            pinned.frozen_params[group.theta_index] = true;
            if offset.abs() > 1e-12 {
                moved += 1;
            }
        }
        if moved == 0 {
            return None;
        }
        pinned.initial_params = start.clone();
        Some((pinned, start, peeled))
    }

    /// Let go, before any optimising, of what the lattice itself says cannot be
    /// pinned. At a vertex whose every carrier is pinned, the sector angles are
    /// fixed by the lattice alone, so Kawasaki there is arithmetic: if the
    /// snapped directions fail it, no optimizer will pass it, and one of those
    /// carriers was never on the lattice. The one furthest from it is let go and
    /// the check repeats until every fully-pinned vertex passes. Returns how
    /// many carriers were let go. Measured on pegasus-attempt at 1.5°: the
    /// optimizer spent three seconds finding a 0.59° Kawasaki failure this
    /// finds in microseconds.
    fn peel_inconsistent_pins(
        &self,
        solved: &OVector<f64, Dyn>,
        step: f64,
        pin: &mut [bool],
    ) -> usize {
        use std::f64::consts::{FRAC_PI_2, PI};
        let points = self.points_from_params(solved);
        let boundary = boundary_vertex_ids(&self.selected_spans);
        let mut incident: Vec<Vec<usize>> = vec![Vec::new(); self.vertices.len()];
        for (index, span) in self.selected_spans.iter().enumerate() {
            if !is_fold_span(span) || self.merged_span_ids.contains(&span.id) {
                continue;
            }
            for vertex in span.vertices {
                if let Some(list) = incident.get_mut(vertex) {
                    list.push(index);
                }
            }
        }
        let mut peeled = 0usize;
        loop {
            let mut let_go: Option<usize> = None;
            for vertex in &self.vertices {
                if !is_interior_fold_vertex(vertex, &boundary) {
                    continue;
                }
                let spans = &incident[vertex.id];
                if spans.len() < 4 || !spans.len().is_multiple_of(2) {
                    continue;
                }
                let mut rays = Vec::with_capacity(spans.len());
                let mut furthest: Option<(usize, f64)> = None;
                let mut fully_pinned = true;
                for &span_index in spans {
                    let span = &self.selected_spans[span_index];
                    let Some(&group_index) = self.span_to_carrier_group.get(&span.id) else {
                        fully_pinned = false;
                        break;
                    };
                    if !pin[group_index] {
                        fully_pinned = false;
                        break;
                    }
                    let theta = solved[self.carrier_groups[group_index].theta_index];
                    let offset = lattice_offset(theta, step);
                    let [a, b] = span.vertices;
                    let (from, to) = if a == vertex.id { (a, b) } else { (b, a) };
                    let current = angle_radians(points[from], points[to]);
                    // The pinned line's direction, in the sense this ray runs.
                    let direction = theta - offset + FRAC_PI_2;
                    let ray = if angle_delta(direction, current).abs() <= FRAC_PI_2 {
                        direction
                    } else {
                        direction + PI
                    };
                    rays.push(ray.rem_euclid(TAU));
                    if furthest.is_none_or(|(_, worst)| offset.abs() > worst) {
                        furthest = Some((group_index, offset.abs()));
                    }
                }
                if !fully_pinned {
                    continue;
                }
                rays.sort_by(f64::total_cmp);
                let mut alternating = 0.0;
                for (k, ray) in rays.iter().enumerate() {
                    let sector = (rays[(k + 1) % rays.len()] - ray).rem_euclid(TAU);
                    alternating += if k % 2 == 0 { sector } else { -sector };
                }
                if alternating.abs() > LATTICE_KAWASAKI_TOLERANCE {
                    let_go = furthest.map(|(group_index, _)| group_index);
                    break;
                }
            }
            match let_go {
                Some(group_index) => {
                    pin[group_index] = false;
                    peeled += 1;
                }
                None => return peeled,
            }
        }
    }

    /// A copy on its own clock: `seconds` from now, with a timeout flag that is
    /// its own. The shared flag would turn a round that ran out of its
    /// allowance into a solve that timed out.
    fn with_own_budget(&self, seconds: f64) -> Self {
        let mut own = self.clone();
        own.deadline = ExactSolveDeadline::start(seconds);
        own.timed_out = Rc::new(Cell::new(false));
        own
    }

    /// Seconds left on this model's clock, or `None` when it has no deadline.
    fn remaining_seconds(&self) -> Option<f64> {
        let deadline = &self.deadline;
        (deadline.timeout_seconds.is_finite() && deadline.timeout_seconds >= 0.0)
            .then(|| deadline.timeout_seconds - deadline.elapsed_seconds())
    }

    /// This model with `span_ids` read as merges. See [`analyze_graph`].
    fn with_merged_spans(&self, span_ids: &BTreeSet<usize>) -> Self {
        let mut merged = self.clone();
        merged.merged_span_ids.extend(span_ids.iter().copied());
        merged.merged_representative = if merged.merged_span_ids.is_empty() {
            Vec::new()
        } else {
            merged_vertex_representatives(
                self.vertices.len(),
                &self.selected_spans,
                &merged.merged_span_ids,
                &boundary_vertex_ids(&self.selected_spans),
            )
        };
        merged
    }

    /// The vertex that stands for `vertex` once merges are applied.
    fn representative_of(&self, vertex: usize) -> usize {
        self.merged_representative
            .get(vertex)
            .copied()
            .unwrap_or(vertex)
    }

    /// The spans read as merges, in span order.
    fn merged_spans(&self) -> impl Iterator<Item = &CandidateCreaseSpan> {
        self.selected_spans
            .iter()
            .filter(|span| self.merged_span_ids.contains(&span.id))
    }

    /// The merged spans as vertex pairs, for the answer and its report.
    fn merged_vertex_pairs(&self) -> Vec<[usize; 2]> {
        self.merged_spans().map(|span| span.vertices).collect()
    }

    fn residuals_for(&self, params: &OVector<f64, Dyn>) -> Vec<f64> {
        self.residuals_with_breakdown(params).0
    }

    fn residuals_with_breakdown(
        &self,
        params: &OVector<f64, Dyn>,
    ) -> (Vec<f64>, ResidualBreakdown) {
        let points = self.points_from_params(params);
        let mut residuals = Vec::new();
        let mut breakdown = ResidualBreakdown::default();
        let source_weight = if self.provenance.source_adapter == CandidateSourceAdapter::Legacy {
            1.0
        } else {
            0.85
        };

        for (vertex, param) in self.vertices.iter().zip(&self.vertex_params) {
            match *param {
                VertexParameterization::Fixed { .. } => {}
                VertexParameterization::Boundary { index, .. } => {
                    let original = vertex
                        .boundary_side
                        .map_or(vertex.point.x, |side| side_coord(side, vertex.point));
                    let weight = movement_weight(vertex.support, source_weight);
                    push_residual(
                        &mut residuals,
                        &mut breakdown,
                        ResidualFamily::BoundaryMovement,
                        weight * (params[index] - original) / self.options.boundary_movement_sigma,
                    );
                }
                VertexParameterization::PolyBoundary {
                    index,
                    origin,
                    vector,
                } => {
                    let original = segment_param(vertex.point, origin, vector);
                    let weight = movement_weight(vertex.support, source_weight);
                    push_residual(
                        &mut residuals,
                        &mut breakdown,
                        ResidualFamily::BoundaryMovement,
                        weight * (params[index] - original) / self.options.boundary_movement_sigma,
                    );
                }
                VertexParameterization::Free { x_index, y_index } => {
                    let sigma = movement_sigma(&self.cost_model, self.options, vertex.support);
                    let weight = movement_weight(vertex.support, source_weight);
                    push_residual(
                        &mut residuals,
                        &mut breakdown,
                        ResidualFamily::Movement,
                        weight * (params[x_index] - vertex.point.x) / sigma,
                    );
                    push_residual(
                        &mut residuals,
                        &mut breakdown,
                        ResidualFamily::Movement,
                        weight * (params[y_index] - vertex.point.y) / sigma,
                    );
                }
            }
        }

        for group in &self.carrier_groups {
            let theta = params[group.theta_index];
            let rho = params[group.rho_index];
            push_residual(
                &mut residuals,
                &mut breakdown,
                ResidualFamily::CarrierPrior,
                angle_delta(theta, group.initial_theta) / self.options.carrier_angle_sigma_radians,
            );
            push_residual(
                &mut residuals,
                &mut breakdown,
                ResidualFamily::CarrierPrior,
                (rho - group.initial_rho) / self.options.carrier_rho_sigma,
            );
            let normal = Point2::new(theta.cos(), theta.sin());
            for span_index in &group.span_indices {
                let span = &self.selected_spans[*span_index];
                if self.merged_span_ids.contains(&span.id) {
                    continue;
                }
                for vertex_id in span.vertices {
                    let point = points[vertex_id];
                    push_residual(
                        &mut residuals,
                        &mut breakdown,
                        ResidualFamily::CarrierIncidence,
                        (normal.x * point.x + normal.y * point.y - rho)
                            / self.options.carrier_incidence_sigma,
                    );
                }
            }
        }

        // A merged pair is one vertex: hold its members together as hard as a
        // vertex is held to its carrier. See [`analyze_graph`].
        for span in self.merged_spans() {
            let [a, b] = span.vertices;
            for (pa, pb) in [(points[a].x, points[b].x), (points[a].y, points[b].y)] {
                push_residual(
                    &mut residuals,
                    &mut breakdown,
                    ResidualFamily::Coincidence,
                    (pa - pb) / self.options.carrier_incidence_sigma,
                );
            }
        }

        for residual in kawasaki_residuals(
            &points,
            &self.vertices,
            &self.selected_spans,
            &self.merged_span_ids,
            &self.merged_representative,
        ) {
            push_residual(
                &mut residuals,
                &mut breakdown,
                ResidualFamily::Kawasaki,
                residual / self.options.kawasaki_sigma_radians,
            );
        }

        (residuals, breakdown)
    }

    fn analytic_jacobian(&self, params: &OVector<f64, Dyn>) -> OMatrix<f64, Dyn, Dyn> {
        let points = self.points_from_params(params);
        let kawasaki_entries = kawasaki_residual_entries(
            &points,
            &self.vertices,
            &self.selected_spans,
            &self.merged_span_ids,
            &self.merged_representative,
        );
        let rows = self.analytic_residual_count(kawasaki_entries.len());
        let cols = params.len();
        let mut matrix = OMatrix::<f64, Dyn, Dyn>::zeros(rows, cols);
        if rows == 0 || cols == 0 {
            return matrix;
        }
        self.emit_jacobian(params, &points, &kawasaki_entries, &mut |r, c, v| {
            matrix[(r, c)] += v;
        });
        matrix
    }

    /// Emit every nonzero Jacobian entry as `(row, col, value)` through `add`.
    /// This is the single source of the derivative math, shared by the dense
    /// path (`analytic_jacobian`) and the sparse normal-equations builder. A
    /// given `(row, col)` may be emitted more than once, so the sink must sum
    /// (the dense path uses `+=`); this preserves the original accumulation.
    fn emit_jacobian(
        &self,
        params: &OVector<f64, Dyn>,
        points: &[Point2],
        kawasaki_entries: &[KawasakiResidualEntry],
        add: &mut dyn FnMut(usize, usize, f64),
    ) {
        // A frozen parameter gets no column. Its gradient entry is then zero
        // and its damped-step row is decoupled, so the step leaves it exactly
        // where it is — on the sparse path (`solve_lm_step` floors the damping
        // diagonal) and on the dense one (MINPACK scales a zero column by 1).
        let frozen = &self.frozen_params;
        let mut masked = |row: usize, col: usize, value: f64| {
            if !frozen.get(col).copied().unwrap_or(false) {
                add(row, col, value);
            }
        };
        let add: &mut dyn FnMut(usize, usize, f64) = &mut masked;
        let source_weight = if self.provenance.source_adapter == CandidateSourceAdapter::Legacy {
            1.0
        } else {
            0.85
        };
        let mut row = 0usize;

        for (vertex, param) in self.vertices.iter().zip(&self.vertex_params) {
            match *param {
                VertexParameterization::Fixed { .. } => {}
                VertexParameterization::Boundary { index, .. } => {
                    let weight = movement_weight(vertex.support, source_weight);
                    add(row, index, weight / self.options.boundary_movement_sigma);
                    row += 1;
                }
                VertexParameterization::PolyBoundary { index, .. } => {
                    let weight = movement_weight(vertex.support, source_weight);
                    add(row, index, weight / self.options.boundary_movement_sigma);
                    row += 1;
                }
                VertexParameterization::Free { x_index, y_index } => {
                    let sigma = movement_sigma(&self.cost_model, self.options, vertex.support);
                    let weight = movement_weight(vertex.support, source_weight);
                    add(row, x_index, weight / sigma);
                    row += 1;
                    add(row, y_index, weight / sigma);
                    row += 1;
                }
            }
        }

        for group in &self.carrier_groups {
            let theta = params[group.theta_index];
            let normal = Point2::new(theta.cos(), theta.sin());
            add(
                row,
                group.theta_index,
                1.0 / self.options.carrier_angle_sigma_radians,
            );
            row += 1;
            add(row, group.rho_index, 1.0 / self.options.carrier_rho_sigma);
            row += 1;

            for span_index in &group.span_indices {
                let span = &self.selected_spans[*span_index];
                if self.merged_span_ids.contains(&span.id) {
                    continue;
                }
                for vertex_id in span.vertices {
                    let point = points[vertex_id];
                    let scale = 1.0 / self.options.carrier_incidence_sigma;
                    add(
                        row,
                        group.theta_index,
                        (-theta.sin() * point.x + theta.cos() * point.y) * scale,
                    );
                    add(row, group.rho_index, -scale);
                    self.add_point_derivative(
                        add,
                        row,
                        vertex_id,
                        normal.x * scale,
                        normal.y * scale,
                        params,
                    );
                    row += 1;
                }
            }
        }

        for span in self.merged_spans() {
            let [a, b] = span.vertices;
            let scale = 1.0 / self.options.carrier_incidence_sigma;
            self.add_point_derivative(add, row, a, scale, 0.0, params);
            self.add_point_derivative(add, row, b, -scale, 0.0, params);
            row += 1;
            self.add_point_derivative(add, row, a, 0.0, scale, params);
            self.add_point_derivative(add, row, b, 0.0, -scale, params);
            row += 1;
        }

        for entry in kawasaki_entries {
            for (index, ray) in entry.rays.iter().enumerate() {
                let angle_weight = if index % 2 == 0 { -2.0 } else { 2.0 };
                let scale = angle_weight / self.options.kawasaki_sigma_radians;
                self.add_angle_derivative(
                    add,
                    row,
                    ray.origin_vertex_id,
                    ray.target_vertex_id,
                    scale,
                    points,
                    params,
                );
            }
            row += 1;
        }
    }

    fn analytic_residual_count(&self, kawasaki_residual_count: usize) -> usize {
        let vertex_residuals = self
            .vertex_params
            .iter()
            .map(|param| match param {
                VertexParameterization::Fixed { .. } => 0,
                VertexParameterization::Boundary { .. } => 1,
                VertexParameterization::PolyBoundary { .. } => 1,
                VertexParameterization::Free { .. } => 2,
            })
            .sum::<usize>();
        let carrier_residuals = self
            .carrier_groups
            .iter()
            .map(|group| {
                let incident_spans = group
                    .span_indices
                    .iter()
                    .filter(|index| {
                        !self
                            .merged_span_ids
                            .contains(&self.selected_spans[**index].id)
                    })
                    .count();
                2 + incident_spans * 2
            })
            .sum::<usize>();
        let coincidence_residuals = self.merged_spans().count() * 2;
        vertex_residuals + carrier_residuals + coincidence_residuals + kawasaki_residual_count
    }

    #[allow(clippy::too_many_arguments)]
    fn add_angle_derivative(
        &self,
        add: &mut dyn FnMut(usize, usize, f64),
        row: usize,
        origin_id: usize,
        target_id: usize,
        scale: f64,
        points: &[Point2],
        params: &OVector<f64, Dyn>,
    ) {
        let origin = points[origin_id];
        let target = points[target_id];
        let dx = target.x - origin.x;
        let dy = target.y - origin.y;
        let radius_squared = dx * dx + dy * dy;
        if radius_squared <= 1e-12 {
            return;
        }

        self.add_point_derivative(
            add,
            row,
            origin_id,
            scale * dy / radius_squared,
            scale * -dx / radius_squared,
            params,
        );
        self.add_point_derivative(
            add,
            row,
            target_id,
            scale * -dy / radius_squared,
            scale * dx / radius_squared,
            params,
        );
    }

    fn add_point_derivative(
        &self,
        add: &mut dyn FnMut(usize, usize, f64),
        row: usize,
        vertex_id: usize,
        dx: f64,
        dy: f64,
        params: &OVector<f64, Dyn>,
    ) {
        match self.vertex_params[vertex_id] {
            VertexParameterization::Fixed { .. } => {}
            VertexParameterization::Boundary { index, side } => {
                add(
                    row,
                    index,
                    match side {
                        BoundarySide::Top | BoundarySide::Bottom => dx,
                        BoundarySide::Right | BoundarySide::Left => dy,
                    },
                );
            }
            VertexParameterization::PolyBoundary { index, vector, .. } => {
                // point = origin + t·vector, so d(point)/dt = vector.
                add(row, index, dx * vector.x + dy * vector.y);
            }
            VertexParameterization::Free { x_index, y_index } => {
                if params[x_index] > -0.25 && params[x_index] < 1.25 {
                    add(row, x_index, dx);
                }
                if params[y_index] > -0.25 && params[y_index] < 1.25 {
                    add(row, y_index, dy);
                }
            }
        }
    }

    /// Assemble the Gauss-Newton normal-equations pieces at `params`: the upper
    /// triangle of `JᵀJ`, its diagonal, and the gradient `Jᵀr`. The Jacobian is
    /// only produced implicitly (row-outer-products), never materialized dense.
    fn build_normal_equations(&self, params: &OVector<f64, Dyn>, residuals: &[f64]) -> GaussNewton {
        let n = params.len();
        let points = self.points_from_params(params);
        let kawasaki_entries = kawasaki_residual_entries(
            &points,
            &self.vertices,
            &self.selected_spans,
            &self.merged_span_ids,
            &self.merged_representative,
        );

        // Jacobian entries, row-monotonic (emit order).
        let mut flat: Vec<(usize, usize, f64)> = Vec::new();
        self.emit_jacobian(params, &points, &kawasaki_entries, &mut |r, c, v| {
            flat.push((r, c, v))
        });

        // gradient = Jᵀr.
        let mut gradient = vec![0.0; n];
        for &(r, c, v) in &flat {
            gradient[c] += v * residuals[r];
        }
        let gradient_norm = gradient.iter().fold(0.0_f64, |m, g| m.max(g.abs()));

        // JᵀJ upper triangle via per-row outer products. Duplicate (row, col)
        // emissions are summed first so each row contributes once per column.
        let mut jtj_map: BTreeMap<(usize, usize), f64> = BTreeMap::new();
        let mut diagonal = vec![0.0; n];
        let mut i = 0;
        while i < flat.len() {
            let row = flat[i].0;
            let mut cols: BTreeMap<usize, f64> = BTreeMap::new();
            while i < flat.len() && flat[i].0 == row {
                *cols.entry(flat[i].1).or_insert(0.0) += flat[i].2;
                i += 1;
            }
            let entries: Vec<(usize, f64)> = cols.into_iter().collect();
            for a in 0..entries.len() {
                let (ca, va) = entries[a];
                diagonal[ca] += va * va;
                for &(cb, vb) in entries.iter().skip(a) {
                    *jtj_map.entry((ca, cb)).or_insert(0.0) += va * vb;
                }
            }
        }
        let jtj = jtj_map
            .into_iter()
            .map(|((i, j), v)| (i, j, v))
            .collect::<Vec<_>>();
        GaussNewton {
            jtj,
            diagonal,
            gradient,
            gradient_norm,
        }
    }

    /// Solve the damped LM step `(JᵀJ + lambda·diag(JᵀJ)) δ = -Jᵀr` via sparse
    /// Cholesky. Returns `None` if the (damped) system is not positive definite,
    /// signalling the caller to increase damping.
    fn solve_lm_step(&self, gn: &GaussNewton, lambda: f64, n: usize) -> Option<OVector<f64, Dyn>> {
        let mut rows = Vec::with_capacity(gn.jtj.len() * 2 + n);
        let mut cols = Vec::with_capacity(gn.jtj.len() * 2 + n);
        let mut vals = Vec::with_capacity(gn.jtj.len() * 2 + n);
        for &(i, j, v) in &gn.jtj {
            rows.push(i);
            cols.push(j);
            vals.push(v);
            if i != j {
                rows.push(j);
                cols.push(i);
                vals.push(v);
            }
        }
        for k in 0..n {
            rows.push(k);
            cols.push(k);
            vals.push(lambda * gn.diagonal[k].max(1e-12));
        }
        let coo = CooMatrix::try_from_triplets(n, n, rows, cols, vals).ok()?;
        let csc = CscMatrix::from(&coo);
        let chol = CscCholesky::factor(&csc).ok()?;
        let rhs = DMatrix::from_fn(n, 1, |i, _| -gn.gradient[i]);
        let sol = chol.solve(&rhs);
        Some(OVector::<f64, Dyn>::from_iterator(
            n,
            (0..n).map(|i| sol[(i, 0)]),
        ))
    }

    /// Sparse Levenberg-Marquardt minimize. Mirrors the dense crate's role
    /// (returns final params, a termination string, evaluation count, final
    /// objective, and solve counters) but factors the sparse normal equations
    /// each iteration instead of a dense `JᵀJ`. Uses the standard Nielsen
    /// damping update; the golden parity gate verifies the accepted solution
    /// matches the dense path.
    fn minimize_sparse(
        &self,
        initial: &OVector<f64, Dyn>,
    ) -> (OVector<f64, Dyn>, String, usize, f64, SolveCounterSnapshot) {
        let n = initial.len();
        let mut params = initial.clone();
        let mut residuals = self.residuals_for(&params);
        let mut residual_calls = 1usize;
        let mut jacobian_calls = 0usize;
        let mut cost = residual_energy(&residuals);

        let snapshot = |residual_calls: usize, jacobian_calls: usize| SolveCounterSnapshot {
            residual_calls,
            jacobian_calls,
            finite_difference_columns: 0,
            residual_vector_evaluations: residual_calls,
        };

        if n == 0 || residuals.is_empty() {
            return (
                params,
                "sparse_no_op".to_owned(),
                residual_calls,
                cost,
                snapshot(residual_calls, jacobian_calls),
            );
        }

        let mut lambda = -1.0_f64; // sentinel: initialize from the first JᵀJ diagonal
        let mut nu = 2.0_f64;
        let mut stall = 0usize;
        const MAX_OUTER: usize = 200;
        let mut termination = "sparse_max_iterations".to_owned();

        'outer: for _iter in 0..MAX_OUTER {
            if self.timeout_reached() {
                termination = "sparse_timeout".to_owned();
                break;
            }
            let gn = self.build_normal_equations(&params, &residuals);
            jacobian_calls += 1;
            if gn.gradient_norm <= self.options.gtol {
                termination = "sparse_gtol".to_owned();
                break;
            }
            if lambda < 0.0 {
                // Damping is applied with Marquardt per-column scaling
                // (`lambda·diag[k]`), so `lambda` is a dimensionless multiplier
                // and starts small (near pure Gauss-Newton). Scaling it by
                // max diag(JᵀJ) would over-damp catastrophically here, because
                // the tiny carrier/Kawasaki sigmas (especially in polish) span a
                // huge diagonal dynamic range.
                lambda = 1e-3;
            }

            loop {
                if self.timeout_reached() {
                    termination = "sparse_timeout".to_owned();
                    break 'outer;
                }
                let Some(delta) = self.solve_lm_step(&gn, lambda, n) else {
                    lambda *= nu;
                    nu *= 2.0;
                    stall += 1;
                    if stall > self.options.patience {
                        termination = "sparse_stalled".to_owned();
                        break 'outer;
                    }
                    continue;
                };

                let delta_norm = delta.norm();
                if delta_norm <= self.options.xtol * (params.norm() + self.options.xtol) {
                    termination = "sparse_xtol".to_owned();
                    break 'outer;
                }

                let trial = &params + &delta;
                let trial_residuals = self.residuals_for(&trial);
                residual_calls += 1;
                let trial_cost = residual_energy(&trial_residuals);

                // Predicted reduction of 0.5‖r‖²: 0.5·(lambda·Σ diag·δ² − δ·g).
                let mut predicted = 0.0;
                for k in 0..n {
                    predicted += lambda * gn.diagonal[k] * delta[k] * delta[k];
                    predicted -= delta[k] * gn.gradient[k];
                }
                predicted *= 0.5;
                let actual = cost - trial_cost;
                let rho = if predicted > 0.0 {
                    actual / predicted
                } else {
                    -1.0
                };

                if rho > 0.0 {
                    let improvement = cost - trial_cost;
                    params = trial;
                    residuals = trial_residuals;
                    cost = trial_cost;
                    let factor = 1.0 - (2.0 * rho - 1.0).powi(3);
                    lambda *= factor.max(1.0 / 3.0);
                    nu = 2.0;
                    stall = 0;
                    if improvement.abs() <= self.options.ftol * cost.max(1e-30) {
                        termination = "sparse_ftol".to_owned();
                        break 'outer;
                    }
                    continue 'outer;
                } else {
                    lambda *= nu;
                    nu *= 2.0;
                    stall += 1;
                    if stall > self.options.patience {
                        termination = "sparse_stalled".to_owned();
                        break 'outer;
                    }
                }
            }
        }

        (
            params,
            termination,
            residual_calls,
            cost,
            snapshot(residual_calls, jacobian_calls),
        )
    }
}

/// Gauss-Newton normal-equations pieces at a fixed parameter point. `jtj` holds
/// only the upper triangle (`i <= j`); the full symmetric matrix is expanded
/// when the damped system is assembled for factorization.
struct GaussNewton {
    jtj: Vec<(usize, usize, f64)>,
    diagonal: Vec<f64>,
    gradient: Vec<f64>,
    gradient_norm: f64,
}

/// Run one LM minimize with the configured linear-solver backend, returning the
/// fields `solve_exact` needs (params, termination, evaluations, objective,
/// counters). Dense uses the `levenberg-marquardt` crate; sparse uses the
/// in-crate sparse-Cholesky LM.
fn run_lm_minimize(
    model: &SolveModel,
    initial: &OVector<f64, Dyn>,
    options: ExactSolveOptions,
) -> (OVector<f64, Dyn>, String, usize, f64, SolveCounterSnapshot) {
    match options.linear_solver {
        LinearSolver::Dense => {
            let counters = Rc::new(SolveCounters::default());
            let solver = ExactLeastSquaresProblem {
                model: model.clone(),
                params: initial.clone(),
                counters: counters.clone(),
            };
            let lm = LevenbergMarquardt::new()
                .with_patience(options.patience)
                .with_ftol(options.ftol)
                .with_xtol(options.xtol)
                .with_gtol(options.gtol);
            let (solved, report) = lm.minimize(solver);
            (
                solved.params,
                format!("{:?}", report.termination),
                report.number_of_evaluations,
                report.objective_function,
                counters.snapshot(),
            )
        }
        LinearSolver::Sparse => model.minimize_sparse(initial),
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq)]
struct ResidualBreakdown {
    movement_count: usize,
    movement_energy: f64,
    boundary_movement_count: usize,
    boundary_movement_energy: f64,
    carrier_prior_count: usize,
    carrier_prior_energy: f64,
    carrier_incidence_count: usize,
    carrier_incidence_energy: f64,
    kawasaki_count: usize,
    kawasaki_energy: f64,
    coincidence_count: usize,
    coincidence_energy: f64,
}

impl ResidualBreakdown {
    fn count(self) -> usize {
        self.movement_count
            + self.boundary_movement_count
            + self.carrier_prior_count
            + self.carrier_incidence_count
            + self.kawasaki_count
    }

    fn energy(self) -> f64 {
        self.movement_energy
            + self.boundary_movement_energy
            + self.carrier_prior_energy
            + self.carrier_incidence_energy
            + self.kawasaki_energy
            + self.coincidence_energy
    }

    fn record(&mut self, family: ResidualFamily, residual: f64) {
        let energy = 0.5 * residual * residual;
        match family {
            ResidualFamily::Movement => {
                self.movement_count += 1;
                self.movement_energy += energy;
            }
            ResidualFamily::BoundaryMovement => {
                self.boundary_movement_count += 1;
                self.boundary_movement_energy += energy;
            }
            ResidualFamily::CarrierPrior => {
                self.carrier_prior_count += 1;
                self.carrier_prior_energy += energy;
            }
            ResidualFamily::CarrierIncidence => {
                self.carrier_incidence_count += 1;
                self.carrier_incidence_energy += energy;
            }
            ResidualFamily::Kawasaki => {
                self.kawasaki_count += 1;
                self.kawasaki_energy += energy;
            }
            ResidualFamily::Coincidence => {
                self.coincidence_count += 1;
                self.coincidence_energy += energy;
            }
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum ResidualFamily {
    Movement,
    BoundaryMovement,
    CarrierPrior,
    CarrierIncidence,
    Kawasaki,
    Coincidence,
}

fn push_residual(
    residuals: &mut Vec<f64>,
    breakdown: &mut ResidualBreakdown,
    family: ResidualFamily,
    residual: f64,
) {
    residuals.push(residual);
    breakdown.record(family, residual);
}

#[derive(Debug, Clone)]
enum VertexParameterization {
    Fixed {
        point: Point2,
    },
    Boundary {
        index: usize,
        side: BoundarySide,
    },
    /// A boundary vertex on an arbitrary (non-axis-aligned) polygon side. The
    /// single parameter is the position `t` along the segment `origin + t·vector`.
    PolyBoundary {
        index: usize,
        origin: Point2,
        vector: Point2,
    },
    Free {
        x_index: usize,
        y_index: usize,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum CarrierGroupKey {
    Source(usize),
    Geometry(i64, i64),
    Span(usize),
}

impl CarrierGroupKey {
    fn from_span(span: &CandidateCreaseSpan) -> Self {
        if let Some(id) = span.source_carrier_ids.first().copied() {
            return Self::Source(id);
        }
        if matches!(
            span.kind,
            CandidateCreaseSpanKind::ObservedCarrierSpan
                | CandidateCreaseSpanKind::NormalizedPassThroughSpan
                | CandidateCreaseSpanKind::SharedCarrierSpan
        ) {
            let theta = span.carrier.normal.y.atan2(span.carrier.normal.x);
            let angle_bin = (theta / 0.01).round() as i64;
            let rho_bin = (span.carrier.rho / 0.0025).round() as i64;
            return Self::Geometry(angle_bin, rho_bin);
        }
        Self::Span(span.id)
    }
}

#[derive(Debug, Clone)]
struct CarrierGroup {
    span_indices: Vec<usize>,
    theta_index: usize,
    rho_index: usize,
    initial_theta: f64,
    initial_rho: f64,
    /// The lattice step this carrier's direction is pinned to, in a pinned
    /// polish round. See [`AngleFamilyMode`] and [`SolveModel::pinned_to_angle_family`].
    pinned_step: Option<f64>,
}

#[derive(Debug, Clone)]
struct ExactLeastSquaresProblem {
    model: SolveModel,
    params: OVector<f64, Dyn>,
    counters: Rc<SolveCounters>,
}

#[derive(Debug, Default)]
struct SolveCounters {
    residual_calls: Cell<usize>,
    jacobian_calls: Cell<usize>,
    finite_difference_columns: Cell<usize>,
    residual_vector_evaluations: Cell<usize>,
}

impl SolveCounters {
    fn snapshot(&self) -> SolveCounterSnapshot {
        SolveCounterSnapshot {
            residual_calls: self.residual_calls.get(),
            jacobian_calls: self.jacobian_calls.get(),
            finite_difference_columns: self.finite_difference_columns.get(),
            residual_vector_evaluations: self.residual_vector_evaluations.get(),
        }
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Serialize)]
struct SolveCounterSnapshot {
    residual_calls: usize,
    jacobian_calls: usize,
    finite_difference_columns: usize,
    residual_vector_evaluations: usize,
}

impl LeastSquaresProblem<f64, Dyn, Dyn> for ExactLeastSquaresProblem {
    type ParameterStorage = Owned<f64, Dyn>;
    type ResidualStorage = Owned<f64, Dyn>;
    type JacobianStorage = Owned<f64, Dyn, Dyn>;

    fn set_params(&mut self, params: &OVector<f64, Dyn>) {
        self.params.copy_from(params);
    }

    fn params(&self) -> OVector<f64, Dyn> {
        self.params.clone()
    }

    fn residuals(&self) -> Option<OVector<f64, Dyn>> {
        if self.model.timeout_reached() {
            return None;
        }
        self.counters
            .residual_calls
            .set(self.counters.residual_calls.get() + 1);
        self.counters
            .residual_vector_evaluations
            .set(self.counters.residual_vector_evaluations.get() + 1);
        Some(OVector::<f64, Dyn>::from_vec(
            self.model.residuals_for(&self.params),
        ))
    }

    fn jacobian(&self) -> Option<OMatrix<f64, Dyn, Dyn>> {
        if self.model.timeout_reached() {
            return None;
        }
        self.counters
            .jacobian_calls
            .set(self.counters.jacobian_calls.get() + 1);
        Some(self.model.analytic_jacobian(&self.params))
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
struct GraphAnalysis {
    eligible_vertices: usize,
    /// What the editor's own checker says about this geometry — `None` when the
    /// graph could not be handed to it. See [`camv_violation_counts`].
    camv: Option<CamvCounts>,
    odd_degree_vertices: Vec<usize>,
    degree_two_vertices: Vec<usize>,
    maekawa_failures: Vec<usize>,
    boundary_span_ids: Vec<usize>,
    paper_boundary_span_ids: Vec<usize>,
    cut_boundary_span_ids: Vec<usize>,
    boundary_vertices: Vec<usize>,
    vertex_diagnostics: Vec<VertexAnalysis>,
    max_kawasaki_residual_degrees: f64,
    max_carrier_residual: f64,
    max_vertex_movement: f64,
    /// `max_vertex_movement` restricted to the vertices the caller did *not*
    /// exempt — the value the movement budget is actually enforced against.
    /// Equal to `max_vertex_movement` whenever the exemption set is empty,
    /// which is every automatic solve. Not reported: `analysis_json` keeps
    /// publishing the unrestricted maximum.
    #[serde(skip)]
    max_budgeted_vertex_movement: f64,
    mean_vertex_movement: f64,
    degenerate_edges: Vec<[usize; 2]>,
    unmodeled_crossings: Vec<[usize; 2]>,
    boundary_failures: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
struct VertexAnalysis {
    vertex_id: usize,
    degree: usize,
    mountain_count: usize,
    valley_count: usize,
    unknown_count: usize,
    kawasaki_residual_degrees: Option<f64>,
    maekawa_residual: Option<usize>,
}

/// Which vertex each vertex *is*, once the model's merged spans are read as
/// merges: a vertex in no merge is its own; the members of a merge share one
/// representative. A boundary member wins the role so the merged fan is judged
/// the way the editor judges a boundary vertex — not by Kawasaki at all — and
/// otherwise the lowest id does.
fn merged_vertex_representatives(
    count: usize,
    spans: &[CandidateCreaseSpan],
    merged_span_ids: &BTreeSet<usize>,
    boundary_vertex_ids: &BTreeSet<usize>,
) -> Vec<usize> {
    let mut representative: Vec<usize> = (0..count).collect();
    if merged_span_ids.is_empty() {
        return representative;
    }
    let mut parent: Vec<usize> = (0..count).collect();
    fn find(parent: &mut [usize], mut v: usize) -> usize {
        while parent[v] != v {
            parent[v] = parent[parent[v]];
            v = parent[v];
        }
        v
    }
    for span in spans {
        if !merged_span_ids.contains(&span.id) {
            continue;
        }
        let [a, b] = span.vertices;
        if a >= count || b >= count {
            continue;
        }
        let (ra, rb) = (find(&mut parent, a), find(&mut parent, b));
        if ra != rb {
            parent[ra.max(rb)] = ra.min(rb);
        }
    }
    let rank = |id: usize| (usize::from(!boundary_vertex_ids.contains(&id)), id);
    let mut chosen: BTreeMap<usize, usize> = BTreeMap::new();
    for v in 0..count {
        let root = find(&mut parent, v);
        chosen
            .entry(root)
            .and_modify(|best| {
                if rank(v) < rank(*best) {
                    *best = v;
                }
            })
            .or_insert(v);
    }
    for (v, slot) in representative.iter_mut().enumerate() {
        *slot = chosen[&find(&mut parent, v)];
    }
    representative
}

fn analyze_graph(
    input: &ExactSolveInput,
    points: &[Point2],
    model: &SolveModel,
    params: &OVector<f64, Dyn>,
    options: ExactSolveOptions,
) -> GraphAnalysis {
    let mut incident = vec![Vec::<IncidentRay>::new(); input.vertices.len()];
    let boundary_span_ids = boundary_span_ids(&input.selected_spans);
    let paper_boundary_span_ids = paper_boundary_span_ids(&input.selected_spans);
    let cut_boundary_span_ids = cut_boundary_span_ids(&input.selected_spans);
    let boundary_vertex_ids = boundary_vertex_ids(&input.selected_spans);
    // A merged span is the one place this fan deliberately differs from the
    // optimizer's (`kawasaki_residual_entries`): the solve keeps the stub as a
    // crease whose direction its carrier still pins, while the answer the
    // editor will hold has its two coincident ends as one vertex and the stub
    // gone. The verdict is on the answer.
    for span in &input.selected_spans {
        if !is_fold_span(span) || model.merged_span_ids.contains(&span.id) {
            continue;
        }
        let [a, b] = span.vertices;
        if a >= points.len() || b >= points.len() {
            continue;
        }
        incident[model.representative_of(a)].push(IncidentRay {
            origin_vertex_id: a,
            target_vertex_id: b,
            angle: angle_radians(points[a], points[b]),
            assignment: span.assignment_label(),
        });
        incident[model.representative_of(b)].push(IncidentRay {
            origin_vertex_id: b,
            target_vertex_id: a,
            angle: angle_radians(points[b], points[a]),
            assignment: span.assignment_label(),
        });
    }

    let mut eligible_vertices = 0;
    let mut odd_degree_vertices = Vec::new();
    let mut degree_two_vertices = Vec::new();
    let mut maekawa_failures = Vec::new();
    let mut vertex_diagnostics = Vec::new();
    let mut max_kawasaki_residual_degrees = 0.0_f64;
    for vertex in &input.vertices {
        if !is_interior_fold_vertex(vertex, &boundary_vertex_ids) {
            continue;
        }
        let mut rays = incident[vertex.id].clone();
        rays.sort_by(|left, right| left.angle.total_cmp(&right.angle));
        let degree = rays.len();
        if degree == 0 {
            continue;
        }
        if degree == 2 {
            degree_two_vertices.push(vertex.id);
        }
        if degree % 2 == 1 {
            odd_degree_vertices.push(vertex.id);
        }
        let kawasaki = if degree >= 4 && degree.is_multiple_of(2) {
            eligible_vertices += 1;
            let residual = signed_kawasaki_residual_radians(&rays).abs().to_degrees();
            max_kawasaki_residual_degrees = max_kawasaki_residual_degrees.max(residual);
            Some(residual)
        } else {
            None
        };
        let mountain_count = rays
            .iter()
            .filter(|ray| ray.assignment == AssignmentLabel::Mountain)
            .count();
        let valley_count = rays
            .iter()
            .filter(|ray| ray.assignment == AssignmentLabel::Valley)
            .count();
        let unknown_count = rays
            .iter()
            .filter(|ray| ray.assignment == AssignmentLabel::Unknown)
            .count();
        let maekawa = if degree > 0 && unknown_count == 0 {
            let residual = mountain_count.abs_diff(valley_count).abs_diff(2);
            if residual > 0 {
                maekawa_failures.push(vertex.id);
            }
            Some(residual)
        } else {
            None
        };
        vertex_diagnostics.push(VertexAnalysis {
            vertex_id: vertex.id,
            degree,
            mountain_count,
            valley_count,
            unknown_count,
            kawasaki_residual_degrees: kawasaki,
            maekawa_residual: maekawa,
        });
    }

    let mut max_carrier_residual = 0.0_f64;
    for (span_id, group_index) in &model.span_to_carrier_group {
        let Some(span) = input.selected_spans.iter().find(|span| span.id == *span_id) else {
            continue;
        };
        let group = &model.carrier_groups[*group_index];
        let theta = params[group.theta_index];
        let rho = params[group.rho_index];
        let normal = Point2::new(theta.cos(), theta.sin());
        for vertex_id in span.vertices {
            let point = points[vertex_id];
            max_carrier_residual =
                max_carrier_residual.max((normal.x * point.x + normal.y * point.y - rho).abs());
        }
    }

    let movement = input
        .vertices
        .iter()
        .zip(points)
        .map(|(vertex, point)| distance(vertex.point, *point))
        .collect::<Vec<_>>();
    let max_vertex_movement = movement.iter().copied().fold(0.0_f64, f64::max);
    let max_budgeted_vertex_movement = if model.exempt_vertex_ids.is_empty() {
        max_vertex_movement
    } else {
        input
            .vertices
            .iter()
            .zip(&movement)
            .filter(|(vertex, _)| !model.exempt_vertex_ids.contains(&vertex.id))
            .map(|(_, moved)| *moved)
            .fold(0.0_f64, f64::max)
    };
    let mean_vertex_movement = if movement.is_empty() {
        0.0
    } else {
        movement.iter().sum::<f64>() / movement.len() as f64
    };
    let merged_edges: Vec<[usize; 2]> = input
        .selected_spans
        .iter()
        .filter(|span| model.merged_span_ids.contains(&span.id))
        .map(|span| span.vertices)
        .collect();

    GraphAnalysis {
        eligible_vertices,
        camv: camv_violation_counts(points, &input.selected_spans),
        odd_degree_vertices,
        degree_two_vertices,
        maekawa_failures,
        boundary_span_ids,
        paper_boundary_span_ids,
        cut_boundary_span_ids,
        boundary_vertices: boundary_vertex_ids.iter().copied().collect(),
        vertex_diagnostics,
        max_kawasaki_residual_degrees,
        max_carrier_residual,
        max_vertex_movement,
        max_budgeted_vertex_movement,
        mean_vertex_movement,
        degenerate_edges: degenerate_edges(input, points, options)
            .into_iter()
            .filter(|edge| !merged_edges.contains(edge))
            .collect(),
        unmodeled_crossings: unmodeled_crossings(input, points, options),
        boundary_failures: boundary_failures(input, points),
    }
}

const TOPOLOGY_DIAGNOSTICS_SCHEMA: &str = "oristudio/cp-compiler/topology-diagnostics-v1";

/// Pre-solve topology findings for a candidate graph, split by whether the
/// finding is a property of the *graph* or of its current *coordinates*.
///
/// The split is the point of this type. An unsolved candidate's Kawasaki
/// residuals sit orders of magnitude above the flat-fold epsilon at nearly
/// every interior vertex — that is what the solve is *for* — so the
/// angle-dependent findings say nothing about whether the topology is right and
/// make a useless repair worklist. The combinatorial findings survive moving
/// the drawing around, and are what a user can act on.
///
/// Four of the six combinatorial fields (`odd_degree_vertices`,
/// `degenerate_edges`, `unmodeled_crossings`, `boundary_failures`) are the gates
/// `exact_solution_rejection_reasons` refuses on, so they double as "would the
/// solver even accept this?". Maekawa is deliberately not one of those gates.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct TopologyDiagnostics {
    pub schema: String,
    /// Non-empty when the input is malformed enough that no analysis ran (a
    /// span or corner referencing a missing vertex, or a vertex whose `id` is
    /// not a valid index into `vertices`). Every other field is empty then.
    pub blockers: Vec<String>,
    pub combinatorial: CombinatorialTopologyFindings,
    pub angle_dependent: AngleDependentTopologyFindings,
    /// Per-vertex detail for the interior fold vertices the checks apply to,
    /// in `vertices` order.
    pub vertices: Vec<TopologyVertexDiagnostic>,
}

/// Findings that depend on the graph, not on where its vertices sit. Stable
/// under a small change of coordinates, so they can be surfaced as a worklist
/// while the user is still moving things.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct CombinatorialTopologyFindings {
    /// Interior vertices with an odd number of incident folds — no flat-foldable
    /// assignment exists. The highest-volume repair signal by a wide margin.
    pub odd_degree_vertices: Vec<usize>,
    /// Interior vertices with exactly two incident folds. Not an error on its
    /// own; the repair is to dissolve the vertex and rejoin its two edges,
    /// never to delete it.
    pub degree_two_vertices: Vec<usize>,
    /// Interior vertices where `|M - V| != 2` over a fully-assigned fan.
    pub maekawa_failures: Vec<usize>,
    /// Spans shorter than the degenerate-edge epsilon, as **vertex id pairs**.
    /// One of these blocks the whole solve at preflight.
    pub degenerate_edges: Vec<[usize; 2]>,
    /// Pairs of non-boundary spans that cross without sharing a vertex, as
    /// **span id pairs** (not vertex ids, unlike `degenerate_edges`). The
    /// repair is to insert a vertex at the crossing.
    pub unmodeled_crossings: Vec<[usize; 2]>,
    /// Vertices whose boundary parameter has left its paper edge.
    pub boundary_failures: Vec<usize>,
}

/// Findings that are a property of the current coordinates. On an unsolved
/// candidate these are large by construction and say nothing about whether the
/// topology is right.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct AngleDependentTopologyFindings {
    pub max_kawasaki_residual_degrees: f64,
    pub max_carrier_residual: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TopologyVertexDiagnostic {
    pub vertex_id: usize,
    pub degree: usize,
    pub mountain_count: usize,
    pub valley_count: usize,
    pub unknown_count: usize,
    /// `None` unless the fan has an even degree of at least four, where
    /// Kawasaki applies.
    pub kawasaki_residual_degrees: Option<f64>,
    /// `None` while any incident crease is unassigned.
    pub maekawa_residual: Option<usize>,
}

/// Analyze a candidate graph's topology without solving it.
///
/// Pure in `input`: it builds the same internal model and initial coordinates
/// `solve_exact` would, and runs the same analysis pass that produces the
/// solver's `before` report — so a finding here is the finding the solver will
/// see. It never solves and never panics on malformed input (see
/// [`TopologyDiagnostics::blockers`]). Measured 21 us at 36 spans to 171 us at
/// 230 spans, release, native — cheap enough to run on every edit.
pub fn analyze_candidate_topology(input: &ExactSolveInput) -> TopologyDiagnostics {
    // Blockers first, and *then* normalise. A malformed graph — a vertex id that
    // is not its own index, a span referencing a vertex that does not exist — is
    // refused, not quietly repaired, and the normalisation below indexes by id
    // so it must not run on one.
    let blockers = topology_analysis_blockers(input);
    if !blockers.is_empty() {
        return TopologyDiagnostics {
            schema: TOPOLOGY_DIAGNOSTICS_SCHEMA.to_owned(),
            blockers,
            ..TopologyDiagnostics::default()
        };
    }
    let input = &normalized_input(input);
    let options = ExactSolveOptions::default();
    let model = SolveModel::new(
        input,
        options,
        ExactSolveDeadline::start(-1.0),
        Rc::new(BTreeSet::new()),
    );
    let params = model.initial_params.clone();
    let points = model.points_from_params(&params);
    let analysis = analyze_graph(input, &points, &model, &params, options);
    TopologyDiagnostics {
        schema: TOPOLOGY_DIAGNOSTICS_SCHEMA.to_owned(),
        blockers,
        combinatorial: CombinatorialTopologyFindings {
            odd_degree_vertices: analysis.odd_degree_vertices,
            degree_two_vertices: analysis.degree_two_vertices,
            maekawa_failures: analysis.maekawa_failures,
            degenerate_edges: analysis.degenerate_edges,
            unmodeled_crossings: analysis.unmodeled_crossings,
            boundary_failures: analysis.boundary_failures,
        },
        angle_dependent: AngleDependentTopologyFindings {
            max_kawasaki_residual_degrees: analysis.max_kawasaki_residual_degrees,
            max_carrier_residual: analysis.max_carrier_residual,
        },
        vertices: analysis
            .vertex_diagnostics
            .into_iter()
            .map(|vertex| TopologyVertexDiagnostic {
                vertex_id: vertex.vertex_id,
                degree: vertex.degree,
                mountain_count: vertex.mountain_count,
                valley_count: vertex.valley_count,
                unknown_count: vertex.unknown_count,
                kawasaki_residual_degrees: vertex.kawasaki_residual_degrees,
                maekawa_residual: vertex.maekawa_residual,
            })
            .collect(),
    }
}

/// `validate_input` plus the `id == index` invariant that `analyze_graph`
/// indexes by. `solve_exact` gets the invariant for free from its callers;
/// a hand-edited graph arriving through the public analysis does not, and
/// indexing by an out-of-range `id` would panic.
fn topology_analysis_blockers(input: &ExactSolveInput) -> Vec<String> {
    let mut blockers = validate_input(input);
    for (index, vertex) in input.vertices.iter().enumerate() {
        if vertex.id >= input.vertices.len() {
            blockers.push(format!(
                "vertex at index {index} has out-of-range id {}",
                vertex.id
            ));
        }
    }
    blockers.sort();
    blockers.dedup();
    blockers
}

#[derive(Debug, Clone)]
struct IncidentRay {
    /// The vertex the ray actually starts at — its own position parameters —
    /// which is the fan's vertex except for a ray folded into a merged fan.
    origin_vertex_id: usize,
    target_vertex_id: usize,
    angle: f64,
    assignment: AssignmentLabel,
}

#[derive(Debug, Clone)]
struct KawasakiResidualEntry {
    rays: Vec<IncidentRay>,
}

fn kawasaki_residuals(
    points: &[Point2],
    vertices: &[CandidateVertex],
    spans: &[CandidateCreaseSpan],
    merged_span_ids: &BTreeSet<usize>,
    representative: &[usize],
) -> Vec<f64> {
    kawasaki_residual_entries(points, vertices, spans, merged_span_ids, representative)
        .iter()
        .map(|entry| signed_kawasaki_residual_radians(&entry.rays))
        .collect()
}

fn kawasaki_residual_entries(
    points: &[Point2],
    vertices: &[CandidateVertex],
    spans: &[CandidateCreaseSpan],
    merged_span_ids: &BTreeSet<usize>,
    representative: &[usize],
) -> Vec<KawasakiResidualEntry> {
    let mut incident = vec![Vec::<IncidentRay>::new(); vertices.len()];
    let boundary_vertices = boundary_vertex_ids(spans);
    let fan_of = |vertex: usize| representative.get(vertex).copied().unwrap_or(vertex);
    for span in spans {
        // The same fan the analysis builds, and it has to be: this one is what
        // the optimizer minimizes, and a residual over a different set of rays
        // than the report describes is two answers to one question. Merges
        // included: a merged pair is one fan here too, with the stub out of it.
        if !is_fold_span(span) || merged_span_ids.contains(&span.id) {
            continue;
        }
        let [a, b] = span.vertices;
        if a >= points.len() || b >= points.len() {
            continue;
        }
        incident[fan_of(a)].push(IncidentRay {
            origin_vertex_id: a,
            target_vertex_id: b,
            angle: angle_radians(points[a], points[b]),
            assignment: span.assignment_label(),
        });
        incident[fan_of(b)].push(IncidentRay {
            origin_vertex_id: b,
            target_vertex_id: a,
            angle: angle_radians(points[b], points[a]),
            assignment: span.assignment_label(),
        });
    }
    vertices
        .iter()
        .filter(|vertex| is_interior_fold_vertex(vertex, &boundary_vertices))
        .filter_map(|vertex| {
            let mut rays = incident[vertex.id].clone();
            rays.sort_by(|left, right| left.angle.total_cmp(&right.angle));
            if rays.len() >= 4 && rays.len().is_multiple_of(2) {
                Some(KawasakiResidualEntry { rays })
            } else {
                None
            }
        })
        .collect()
}

fn signed_kawasaki_residual_radians(rays: &[IncidentRay]) -> f64 {
    let mut odd_sum = 0.0;
    let mut even_sum = 0.0;
    for index in 0..rays.len() {
        let next = (index + 1) % rays.len();
        let sector = (rays[next].angle - rays[index].angle).rem_euclid(TAU);
        if index % 2 == 0 {
            odd_sum += sector;
        } else {
            even_sum += sector;
        }
    }
    odd_sum - even_sum
}

fn validate_input(input: &ExactSolveInput) -> Vec<String> {
    let mut blockers = Vec::new();
    for span in &input.selected_spans {
        for vertex_id in span.vertices {
            if vertex_id >= input.vertices.len() {
                blockers.push(format!(
                    "selected span {} references missing vertex {}",
                    span.id, vertex_id
                ));
            }
        }
    }
    for corner in input.boundary.corners {
        if corner >= input.vertices.len() {
            blockers.push(format!(
                "boundary references missing corner vertex {corner}"
            ));
        }
    }
    blockers.sort();
    blockers.dedup();
    blockers
}

/// The editor's foldability verdict on a solved geometry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CamvCounts {
    /// Kawasaki (`FlatFoldabilityRule::Angles`) violations.
    pub angle_violations: usize,
    /// Everything else the check reports — Big-Little-Big and its kin.
    pub big_little_big_violations: usize,
}

/// Run the editor's own CAMV checker on solver geometry.
///
/// This is deliberately the *checker* and not a re-derivation of it. The
/// solver's Kawasaki residual and the checker's angle rule agree on a clean
/// pattern, but Big-Little-Big is a crimp reduction over the whole fan
/// (`oristudio-cp/src/checks.rs`), and a second implementation of it here would
/// be a second answer to the question "will markers appear?". So the geometry
/// is handed to the checker the way an import would hand it — as a FOLD on the
/// ±200 sheet — and the counts come back from the same code that draws them.
///
/// `None` when the graph could not be built into a document at all.
pub fn camv_violation_counts(
    points: &[Point2],
    spans: &[CandidateCreaseSpan],
) -> Option<CamvCounts> {
    use oristudio_cp::checks::{FlatFoldabilityRule, check_camv_task};

    if points.is_empty() {
        return None;
    }
    // Only spans with length: the editor drops a zero-length crease when the
    // answer is written (`insert_line_segments`), and its two coincident ends
    // become one vertex, so that is the pattern the check has to run on. The
    // checker builds each fan from the segments touching a point, and a stub
    // would otherwise add a ray of no direction to the merged vertex.
    let spans: Vec<&CandidateCreaseSpan> = spans
        .iter()
        .filter(|span| {
            let [a, b] = span.vertices;
            match (points.get(a), points.get(b)) {
                (Some(a), Some(b)) => distance(*a, *b) > COLLAPSED_SPAN_LENGTH,
                _ => true,
            }
        })
        .collect();
    // Unit square -> the editor's ±200 sheet. The import normalizes to that
    // sheet anyway; landing there already keeps its rescale a near-identity.
    let mut fold = treemaker_fold::FoldDocument::new(
        points
            .iter()
            .map(|p| vec![p.x * 400.0 - 200.0, p.y * 400.0 - 200.0])
            .collect(),
        spans.iter().map(|span| span.vertices).collect(),
    );
    fold.edges_assignment = spans
        .iter()
        .map(|span| crate::fold_export::fold_assignment(span.assignment_label()))
        .collect();
    fold.edges_fold_angle = vec![None; spans.len()];
    let model = oristudio_cp::io::fold::import_fold_document(&fold).ok()?;
    let violations = check_camv_task(&model).violations;
    let angle_violations = violations
        .iter()
        .filter(|v| matches!(v.rule, FlatFoldabilityRule::Angles))
        .count();
    Some(CamvCounts {
        angle_violations,
        big_little_big_violations: violations.len() - angle_violations,
    })
}

/// A span the pinned round has shrunk to no more than this — a tenth of a pixel
/// at the detector's scale — is a collapse in progress: see the second pass in
/// [`pin_to_angle_family`] for why the first pass stops short of a point.
const COLLAPSE_CANDIDATE_LENGTH: f64 = 1e-4;

/// A span no longer than this has collapsed to a point. The editor's own bar
/// for dropping a crease on write is far coarser, so anything under this is
/// gone the moment the answer lands; it is also the default
/// `degenerate_edge_epsilon`, and the two have to agree for a collapse the
/// solve sanctions as a merge to be the same collapse the editor performs.
const COLLAPSED_SPAN_LENGTH: f64 = 1e-6;

fn classify_status(
    before: &GraphAnalysis,
    after: &GraphAnalysis,
    options: ExactSolveOptions,
) -> ExactSolvedGraphStatus {
    if !after.degenerate_edges.is_empty()
        || !after.unmodeled_crossings.is_empty()
        || !after.boundary_failures.is_empty()
        || after.max_budgeted_vertex_movement > options.max_vertex_movement
    {
        return ExactSolvedGraphStatus::Failed;
    }
    // `Solved` is a promise that the editor's foldability check will pass, so it
    // is made on the same terms the check uses. Kawasaki and odd degree were
    // always here; Maekawa was computed and never consulted, and Big-Little-Big
    // was not computed at all — so a pattern could be called solved with a
    // canvas full of markers. Measured before this: 0 angle violations and 28
    // Big-Little-Big on a `Solved` close_but_not_good_enough.osf.
    let topology_clean = after.odd_degree_vertices.is_empty() && after.maekawa_failures.is_empty();
    let checker_clean = after
        .camv
        .is_some_and(|camv| camv.angle_violations == 0 && camv.big_little_big_violations == 0);
    if topology_clean
        && checker_clean
        && after.max_kawasaki_residual_degrees <= options.solved_kawasaki_epsilon_degrees
        && after.max_carrier_residual <= options.solved_carrier_epsilon
    {
        return ExactSolvedGraphStatus::Solved;
    }
    // Angles that were already at the bar are not a failure to improve them.
    // With Maekawa and Big-Little-Big in the verdict above, a pattern can be
    // Kawasaki-exact and still not `Solved`; solving it moves nothing, and
    // "nothing moved" used to fall through to `Failed`. That is `Ambiguous`: the
    // geometry is as good as angles can make it, and what remains is not angles.
    //
    // Only over a fan Kawasaki actually judged: an odd-degree vertex is skipped
    // by the Kawasaki pass, so its residual reads as zero without meaning it.
    let at_the_bar = after.odd_degree_vertices.is_empty()
        && after.max_kawasaki_residual_degrees <= options.solved_kawasaki_epsilon_degrees
        && after.max_carrier_residual <= options.solved_carrier_epsilon;
    if after.odd_degree_vertices.len() <= before.odd_degree_vertices.len()
        && (at_the_bar
            || after.max_kawasaki_residual_degrees < before.max_kawasaki_residual_degrees
            || after.max_carrier_residual < before.max_carrier_residual)
    {
        ExactSolvedGraphStatus::Ambiguous
    } else {
        ExactSolvedGraphStatus::Failed
    }
}

/// What the polish stage did, for reporting only.
///
/// A refused polish used to be invisible: the only trace was the *absence* of a
/// `+polish(rounds=N)` suffix on the termination string, and the rejection
/// reasons computed for the refused round were dropped on the floor. On a real
/// detected pattern those reasons are the whole story — e.g. a round that would
/// have taken Kawasaki from 7.5e-3 deg to 8e-4 deg, refused with
/// `["candidate_status_failed", "degenerate_edges_worsened",
/// "movement_budget_exceeded"]`, because reaching that residual meant collapsing
/// a close vertex pair into a degenerate edge and blowing the movement budget.
///
/// This struct records that, and nothing else: it never influences which
/// candidate is adopted, accepted, or reported as solved.
///
/// **The gates that produce those reasons are correct — do not loosen them to
/// "let polish through".** Two independent facts say so. First, a round that
/// worsens degenerate edges corrupts the pattern; adopting it trades a
/// foldability error for a geometry error. Second, and decisively: the editor's
/// foldability checker (CAMV) compares its degree-valued angle sums against
/// `Epsilon::FLAT` (`oristudio_cp::geometry::Epsilon`, `FACTOR * 1e-4` = `1e-6`
/// degrees). On the pattern above, the refused polish would have reached `~8e-4`
/// degrees — still ~800x above that bar, so adopting it would have corrupted the
/// pattern *and* cleared none of its 70 violations. A candidate that needs
/// topology repair cannot be polished into foldability; repair it first.
#[derive(Debug, Clone)]
struct PolishOutcome {
    /// Why polishing stopped, or why it never started. One of: `not_run`,
    /// `disabled`, `preflight_blocked`, `no_parameters`, `timed_out`,
    /// `stage1_rejected`, `target_reached`, `round_refused`, `max_rounds`.
    stop_reason: &'static str,
    rounds_attempted: usize,
    rounds_adopted: usize,
    /// Max Kawasaki residual (degrees) of the stage-1 candidate polish started
    /// from. `None` when polish never got far enough to measure it.
    kawasaki_before_degrees: Option<f64>,
    /// Max Kawasaki residual (degrees) after the adopted rounds. Equal to
    /// `kawasaki_before_degrees` when no round was adopted.
    kawasaki_after_degrees: Option<f64>,
    /// The first round that was computed and then refused, if any.
    refused_round: Option<PolishRefusal>,
    /// The pinned round, when the pattern was read as having an angle family.
    /// `None` when it has none, or when polish never got that far.
    pinned_family: Option<PinnedFamilyOutcome>,
}

/// What the pinned round did. See [`AngleFamilyMode`] and [`pin_to_angle_family`].
#[derive(Debug, Clone)]
struct PinnedFamilyOutcome {
    step_degrees: f64,
    /// Carrier groups in the model, so `pinned_carriers` reads as a fraction.
    carriers: usize,
    /// Every attempt, widest tolerance first; the last one is the adopted one
    /// when `adopted` is true.
    attempts: Vec<PinnedAttempt>,
    adopted: bool,
    /// Why the attempts stopped: `adopted`, `refused` (every tolerance tried),
    /// `nothing_to_pin`, or `out_of_time`.
    stop_reason: &'static str,
}

/// One attempt at pinning, and why it was refused if it was.
#[derive(Debug, Clone)]
struct PinnedAttempt {
    tolerance_degrees: f64,
    pinned_carriers: usize,
    /// Carriers within tolerance that [`SolveModel::peel_inconsistent_pins`]
    /// let go before optimising.
    peeled_carriers: usize,
    /// Re-anchored solves adopted after the first; see [`PINNED_REANCHOR_ROUNDS`].
    reanchored_rounds: usize,
    kawasaki_degrees: f64,
    camv: Option<CamvCounts>,
    /// Edges the lattice collapsed to a point that were not degenerate before:
    /// two detected vertices the design has as one. Vertex id pairs, with the
    /// edge's length in the input.
    collapsed_edges: Vec<([usize; 2], f64)>,
    /// The widest gap the optimizer left in a collapsed pair before the answer
    /// closed it; zero when nothing collapsed.
    lm_separation: f64,
    /// How the optimizer stopped (the last pass, when there were two), and how
    /// many residual evaluations both passes cost: a round refused at
    /// `sparse_max_iterations` ran out of budget, not out of room.
    termination: String,
    evaluations: usize,
    /// Interior vertices whose Kawasaki residual is above the solved bar, and
    /// the worst five of them by (vertex id, degrees).
    kawasaki_over_bar: usize,
    worst_kawasaki: Vec<(usize, f64)>,
    seconds: f64,
    /// Reasons from [`exact_solution_rejection_reasons`] followed by those from
    /// [`pinned_round_regressions`]; empty when adopted.
    refusals: Vec<String>,
}

/// A pinned round's result: the report, plus the adopted attempt when one was.
struct PinnedFamilyRound {
    outcome: PinnedFamilyOutcome,
    adopted: Option<PinnedAdoption>,
}

struct PinnedAdoption {
    params: OVector<f64, Dyn>,
    after: GraphAnalysis,
    evaluations: usize,
    /// Spans the round collapsed and the answer therefore reads as merges.
    merged_span_ids: BTreeSet<usize>,
}

/// Pin the pattern to its angle family and judge the result. See
/// [`AngleFamilyMode`] for why, [`SolveModel::pinned_to_angle_family`] for how.
/// `None` when the mode is off, the budget is gone, or no family is present.
fn pin_to_angle_family(
    model: &SolveModel,
    input: &ExactSolveInput,
    before: &GraphAnalysis,
    current_params: &OVector<f64, Dyn>,
    current_after: &GraphAnalysis,
    options: ExactSolveOptions,
) -> Option<PinnedFamilyRound> {
    if options.angle_family == AngleFamilyMode::Off || model.timeout_reached() {
        return None;
    }
    let thetas: Vec<f64> = model
        .carrier_groups
        .iter()
        .map(|group| current_params[group.theta_index])
        .collect();
    let step_degrees = infer_angle_family(
        &thetas,
        options.angle_family_snap_tolerance_radians,
        options.angle_family_min_fraction,
    )?;
    let step = step_degrees.to_radians();
    let mut outcome = PinnedFamilyOutcome {
        step_degrees,
        carriers: model.carrier_groups.len(),
        attempts: Vec::new(),
        adopted: false,
        stop_reason: "refused",
    };
    let mut adopted = None;
    let mut tolerance = options.angle_family_snap_tolerance_radians;
    for _attempt in 0..=ANGLE_FAMILY_RETRY_HALVINGS {
        // The round runs on its own clock, inside what is left of the solve's.
        let budget = model
            .remaining_seconds()
            .map(|seconds| seconds - PINNED_ROUND_RESERVE_SECONDS);
        if budget.is_some_and(|seconds| seconds <= 0.0) {
            outcome.stop_reason = "out_of_time";
            break;
        }
        let Some((pinned_model, start, peeled_carriers)) =
            model.pinned_to_angle_family(current_params, step, tolerance)
        else {
            outcome.stop_reason = "nothing_to_pin";
            break;
        };
        let pinned_model = match budget {
            Some(seconds) => pinned_model.with_own_budget(seconds),
            None => pinned_model,
        };
        let pinned_carriers = pinned_model
            .carrier_groups
            .iter()
            .filter(|group| group.pinned_step.is_some())
            .count();
        let started = model.deadline.elapsed_seconds();
        let (pinned_params, mut termination, mut evaluations, _objective, _counters) =
            run_lm_minimize(&pinned_model, &start, options);
        let raw_points = model.points_from_params(&pinned_params);
        // A span the lattice collapsed is two detected vertices the design has
        // as one: with every direction pinned, its ends meet only where the
        // lines through them are concurrent, and that is the design's vertex.
        // The editor merges them on write, so the round is judged on the
        // merged pattern — and the merge has to pass every check below, which
        // is what separates a design vertex from a stub that must not go.
        let merged_span_ids: BTreeSet<usize> = input
            .selected_spans
            .iter()
            .filter(|span| {
                let [a, b] = span.vertices;
                !model.merged_span_ids.contains(&span.id)
                    && !current_after.degenerate_edges.contains(&[a, b])
                    && a < raw_points.len()
                    && b < raw_points.len()
                    && distance(raw_points[a], raw_points[b]) <= COLLAPSE_CANDIDATE_LENGTH
            })
            .map(|span| span.id)
            .collect();
        // Second pass for a collapse: with the pair held together and the stub
        // out of the fans and off its carrier. The first pass cannot finish the
        // job — a stub's direction, read from two points a hair apart, couples
        // Kawasaki at both ends to their separation, and the optimizer settles
        // a few millionths short of the intersection. This pass solves the
        // merged vertex the round is about to be judged on.
        let (mut judged_model, mut pinned_params) = if merged_span_ids.is_empty() {
            (pinned_model.clone(), pinned_params)
        } else {
            let merged_pinned = pinned_model.with_merged_spans(&merged_span_ids);
            let (params, merged_termination, more, _objective, _counters) =
                run_lm_minimize(&merged_pinned, &pinned_params, options);
            evaluations += more;
            termination = merged_termination;
            (merged_pinned, params)
        };
        let merged_model = model.with_merged_spans(&merged_span_ids);
        let analyze = |params: &OVector<f64, Dyn>| {
            let points = merged_model.placed_points(params);
            analyze_graph(input, &points, &merged_model, params, options)
        };
        let mut pinned_after = analyze(&pinned_params);
        // Then re-anchor and solve again while Kawasaki is over the bar and
        // still improving. See [`PINNED_REANCHOR_ROUNDS`].
        let mut reanchored_rounds = 0usize;
        for _round in 0..PINNED_REANCHOR_ROUNDS {
            if pinned_after.max_kawasaki_residual_degrees <= options.solved_kawasaki_epsilon_degrees
                || judged_model.timeout_reached()
            {
                break;
            }
            let reanchored = judged_model.reanchored_for_polish(&pinned_params);
            let (params, round_termination, more, _objective, _counters) =
                run_lm_minimize(&reanchored, &pinned_params, options);
            evaluations += more;
            let after = analyze(&params);
            if after.max_kawasaki_residual_degrees >= pinned_after.max_kawasaki_residual_degrees {
                break;
            }
            pinned_params = params;
            pinned_after = after;
            judged_model = reanchored;
            termination = round_termination;
            reanchored_rounds += 1;
        }
        // Objective progress is judged from the snapped start, where the pinned
        // directions have just been moved out from under their vertices: that is
        // the problem this round solves, and the only fair "before" for it.
        let start_energy = residual_energy(&judged_model.residuals_for(&start));
        let final_energy = residual_energy(&judged_model.residuals_for(&pinned_params));
        let raw_points = model.points_from_params(&pinned_params);
        // How far apart the optimizer actually left each collapsed pair, before
        // the answer makes them one point: a diagnostic on the round's
        // convergence, and the movement the snap is about to add.
        let lm_separation = merged_model
            .merged_spans()
            .map(|span| distance(raw_points[span.vertices[0]], raw_points[span.vertices[1]]))
            .fold(0.0_f64, f64::max);
        let pinned_status = classify_status(before, &pinned_after, options);
        let mut refusals = exact_solution_rejection_reasons(
            before,
            &pinned_after,
            pinned_status,
            start_energy,
            final_energy,
            options,
        );
        refusals.extend(pinned_round_regressions(
            current_after,
            &pinned_after,
            options,
        ));
        let collapsed_edges = input
            .selected_spans
            .iter()
            .filter(|span| merged_span_ids.contains(&span.id))
            .map(|span| {
                let [a, b] = span.vertices;
                (
                    [a, b],
                    distance(input.vertices[a].point, input.vertices[b].point),
                )
            })
            .collect();
        outcome.attempts.push(PinnedAttempt {
            tolerance_degrees: tolerance.to_degrees(),
            pinned_carriers,
            peeled_carriers,
            reanchored_rounds,
            kawasaki_degrees: pinned_after.max_kawasaki_residual_degrees,
            camv: pinned_after.camv,
            collapsed_edges,
            lm_separation,
            termination,
            evaluations,
            kawasaki_over_bar: pinned_after
                .vertex_diagnostics
                .iter()
                .filter(|vertex| {
                    vertex
                        .kawasaki_residual_degrees
                        .is_some_and(|degrees| degrees > options.solved_kawasaki_epsilon_degrees)
                })
                .count(),
            worst_kawasaki: {
                let mut worst: Vec<(usize, f64)> = pinned_after
                    .vertex_diagnostics
                    .iter()
                    .filter_map(|vertex| {
                        vertex
                            .kawasaki_residual_degrees
                            .map(|degrees| (vertex.vertex_id, degrees))
                    })
                    .collect();
                worst.sort_by(|a, b| b.1.total_cmp(&a.1));
                worst.truncate(5);
                worst
            },
            seconds: model.deadline.elapsed_seconds() - started,
            refusals: refusals.clone(),
        });
        if refusals.is_empty() {
            outcome.adopted = true;
            outcome.stop_reason = "adopted";
            adopted = Some(PinnedAdoption {
                params: pinned_params,
                after: pinned_after,
                evaluations,
                merged_span_ids,
            });
            break;
        }
        tolerance /= 2.0;
    }
    Some(PinnedFamilyRound { outcome, adopted })
}

/// Why a pinned round must not land, over and above the ordinary acceptance
/// gate. The round exists to make designed ties exact; one that reaches them by
/// giving up a Kawasaki vertex, or by creating a Big-Little-Big violation, has
/// pinned a carrier that was never on the lattice, and the answer is to pin
/// fewer, not to keep it.
fn pinned_round_regressions(
    current: &GraphAnalysis,
    pinned: &GraphAnalysis,
    options: ExactSolveOptions,
) -> Vec<String> {
    let mut reasons = Vec::new();
    let kawasaki_bar = current
        .max_kawasaki_residual_degrees
        .max(options.solved_kawasaki_epsilon_degrees);
    if pinned.max_kawasaki_residual_degrees > kawasaki_bar {
        reasons.push("pinned_kawasaki_regressed".to_owned());
    }
    match (current.camv, pinned.camv) {
        (Some(was), Some(now)) => {
            if now.angle_violations > was.angle_violations {
                reasons.push("pinned_angle_violations_increased".to_owned());
            }
            if now.big_little_big_violations > was.big_little_big_violations {
                reasons.push("pinned_big_little_big_increased".to_owned());
            }
        }
        (Some(_), None) => reasons.push("pinned_checker_unavailable".to_owned()),
        (None, _) => {}
    }
    reasons
}

/// A polish round that was computed, judged, and rejected.
#[derive(Debug, Clone)]
struct PolishRefusal {
    /// Max Kawasaki residual (degrees) this round *would* have reached. This is
    /// the number that makes the refusal legible: it is normally much better
    /// than what was kept, which is exactly why the refusal needs explaining.
    kawasaki_degrees: f64,
    /// True when the round was refused only because it made Kawasaki worse, in
    /// which case `rejection_reasons` is empty.
    kawasaki_regressed: bool,
    /// Reasons from [`exact_solution_rejection_reasons`], verbatim.
    rejection_reasons: Vec<String>,
}

impl Default for PolishOutcome {
    fn default() -> Self {
        Self::not_run("not_run")
    }
}

impl PolishOutcome {
    fn not_run(stop_reason: &'static str) -> Self {
        Self {
            stop_reason,
            rounds_attempted: 0,
            rounds_adopted: 0,
            kawasaki_before_degrees: None,
            kawasaki_after_degrees: None,
            refused_round: None,
            pinned_family: None,
        }
    }

    fn ran(&self) -> bool {
        self.rounds_attempted > 0
    }
}

fn polish_report_json(polish: &PolishOutcome, options: ExactSolveOptions) -> Value {
    json!({
        "enabled": options.polish,
        "ran": polish.ran(),
        "stop_reason": polish.stop_reason,
        "rounds_attempted": polish.rounds_attempted,
        "rounds_adopted": polish.rounds_adopted,
        "max_rounds": options.polish_rounds,
        "target_kawasaki_degrees": options.polish_target_kawasaki_degrees,
        "kawasaki_before_degrees": polish.kawasaki_before_degrees.map(round12),
        "kawasaki_after_degrees": polish.kawasaki_after_degrees.map(round12),
        "refused_round": polish.refused_round.as_ref().map(|refusal| {
            json!({
                "kawasaki_degrees": round12(refusal.kawasaki_degrees),
                "kawasaki_regressed": refusal.kawasaki_regressed,
                "rejection_reasons": refusal.rejection_reasons,
            })
        }),
        "pinned_family": polish.pinned_family.as_ref().map(|pinned| {
            json!({
                "step_degrees": pinned.step_degrees,
                "carriers": pinned.carriers,
                "adopted": pinned.adopted,
                "stop_reason": pinned.stop_reason,
                "attempts": pinned
                    .attempts
                    .iter()
                    .map(|attempt| {
                        json!({
                            "tolerance_degrees": attempt.tolerance_degrees,
                            "pinned_carriers": attempt.pinned_carriers,
                            "peeled_carriers": attempt.peeled_carriers,
                            "reanchored_rounds": attempt.reanchored_rounds,
                            "kawasaki_degrees": round12(attempt.kawasaki_degrees),
                            "camv_angle_violations": attempt.camv.map(|camv| camv.angle_violations),
                            "big_little_big_violations": attempt.camv.map(|camv| camv.big_little_big_violations),
                            "collapsed_edges": attempt
                                .collapsed_edges
                                .iter()
                                .map(|(edge, length)| json!({ "vertices": edge, "input_length": round6(*length) }))
                                .collect::<Vec<_>>(),
                            "lm_separation": attempt.lm_separation,
                            "termination": attempt.termination,
                            "evaluations": attempt.evaluations,
                            "kawasaki_over_bar": attempt.kawasaki_over_bar,
                            "worst_kawasaki": attempt
                                .worst_kawasaki
                                .iter()
                                .map(|(vertex, degrees)| json!({ "vertex": vertex, "degrees": round12(*degrees) }))
                                .collect::<Vec<_>>(),
                            "seconds": round6(attempt.seconds),
                            "refusals": attempt.refusals,
                        })
                    })
                    .collect::<Vec<_>>(),
            })
        }),
    })
}

fn exact_solution_rejection_reasons(
    before: &GraphAnalysis,
    after: &GraphAnalysis,
    candidate_status: ExactSolvedGraphStatus,
    initial_objective: f64,
    candidate_objective: f64,
    options: ExactSolveOptions,
) -> Vec<String> {
    let mut reasons = Vec::new();
    if candidate_status == ExactSolvedGraphStatus::Failed {
        reasons.push("candidate_status_failed".to_owned());
    }
    if after.max_budgeted_vertex_movement > options.max_vertex_movement {
        reasons.push("movement_budget_exceeded".to_owned());
    }
    if after.odd_degree_vertices.len() > before.odd_degree_vertices.len() {
        reasons.push("odd_degree_vertices_worsened".to_owned());
    }
    if after.degenerate_edges.len() > before.degenerate_edges.len() {
        reasons.push("degenerate_edges_worsened".to_owned());
    }
    if after.unmodeled_crossings.len() > before.unmodeled_crossings.len() {
        reasons.push("unmodeled_crossings_worsened".to_owned());
    }
    if after.boundary_failures.len() > before.boundary_failures.len() {
        reasons.push("boundary_failures_worsened".to_owned());
    }
    // Only a defect when the optimizer had something to do. An input whose
    // angles already sit at the bar leaves it nothing to improve, and a result
    // short of `Solved` for a reason it does not optimise — Maekawa, Big-Little-
    // Big — must not be thrown away as a failed solve.
    let nothing_to_improve = before.odd_degree_vertices.is_empty()
        && before.max_kawasaki_residual_degrees <= options.solved_kawasaki_epsilon_degrees
        && before.max_carrier_residual <= options.solved_carrier_epsilon;
    if candidate_status != ExactSolvedGraphStatus::Solved
        && !nothing_to_improve
        && candidate_objective + 1e-9 >= initial_objective
    {
        reasons.push("objective_not_improved".to_owned());
    }
    reasons.sort();
    reasons.dedup();
    reasons
}

fn exact_solve_preflight_rejection_reasons(before: &GraphAnalysis) -> Vec<String> {
    let mut reasons = Vec::new();
    if !before.degenerate_edges.is_empty() {
        reasons.push("preflight_degenerate_edges".to_owned());
    }
    if !before.boundary_failures.is_empty() {
        reasons.push("preflight_boundary_failures".to_owned());
    }
    reasons
}

#[allow(clippy::too_many_arguments)]
fn movement_report(
    input: &ExactSolveInput,
    before_points: &[Point2],
    after_points: &[Point2],
    candidate_points: &[Point2],
    initial_objective: f64,
    final_objective: f64,
    candidate_objective: f64,
    evaluations: usize,
    termination: &str,
    options: ExactSolveOptions,
    accepted: bool,
    rejection_reasons: &[String],
    model: &SolveModel,
    initial_breakdown: &ResidualBreakdown,
    accepted_breakdown: &ResidualBreakdown,
    candidate_breakdown: &ResidualBreakdown,
    counters: &SolveCounterSnapshot,
    polish: &PolishOutcome,
) -> Value {
    let moved_vertices = input
        .vertices
        .iter()
        .zip(before_points)
        .zip(after_points)
        .filter_map(|((vertex, before), after)| {
            let movement = distance(*before, *after);
            (movement > 1e-10).then(|| {
                json!({
                    "vertex_id": vertex.id,
                    "before": before,
                    "after": after,
                    "movement": round6(movement),
                    "movement_policy": vertex.movement_policy,
                    "boundary_side": vertex.boundary_side,
                    "support": round6(vertex.support),
                })
            })
        })
        .collect::<Vec<_>>();
    let max_movement = input
        .vertices
        .iter()
        .zip(before_points)
        .zip(after_points)
        .map(|((_, before), after)| distance(*before, *after))
        .fold(0.0_f64, f64::max);
    let attempted_moved_vertices = input
        .vertices
        .iter()
        .zip(before_points)
        .zip(candidate_points)
        .filter_map(|((vertex, before), after)| {
            let movement = distance(*before, *after);
            (movement > 1e-10).then(|| {
                json!({
                    "vertex_id": vertex.id,
                    "before": before,
                    "after": after,
                    "movement": round6(movement),
                    "movement_policy": vertex.movement_policy,
                    "boundary_side": vertex.boundary_side,
                    "support": round6(vertex.support),
                })
            })
        })
        .collect::<Vec<_>>();
    let attempted_max_movement = input
        .vertices
        .iter()
        .zip(before_points)
        .zip(candidate_points)
        .map(|((_, before), after)| distance(*before, *after))
        .fold(0.0_f64, f64::max);
    let merged_vertices = model.merged_vertex_pairs();
    json!({
        "schema": "oristudio/cp-compiler/exact-solve-movement-report-v1",
        // Vertex pairs the answer places at one point: the pinned round found
        // the design has them as a single vertex, and the crease between them
        // is gone once the answer is written. See `pin_to_angle_family`.
        "merged_vertices": merged_vertices,
        "termination": termination,
        "timed_out": model.timed_out.get(),
        "timeout_seconds": options.timeout_seconds,
        "elapsed_seconds": round6(model.deadline.elapsed_seconds()),
        "accepted": accepted,
        "rejection_reasons": rejection_reasons,
        "evaluations": evaluations,
        "initial_objective": round6(initial_objective),
        "final_objective": round6(final_objective),
        "candidate_objective": round6(candidate_objective),
        "max_vertex_movement": round6(max_movement),
        "attempted_max_vertex_movement": round6(attempted_max_movement),
        "max_vertex_movement_budget": options.max_vertex_movement,
        "moved_vertices": moved_vertices,
        "attempted_moved_vertices": attempted_moved_vertices,
        "polish": polish_report_json(polish, options),
        "trace": exact_solve_trace_json(
            input,
            model,
            initial_breakdown,
            accepted_breakdown,
            candidate_breakdown,
            counters,
        ),
    })
}

fn timeout_rejection_reason(options: ExactSolveOptions) -> String {
    format!(
        "exact solve timed out after {:.3}s",
        options.timeout_seconds.max(0.0)
    )
}

fn timeout_termination(previous: &str, options: ExactSolveOptions) -> String {
    format!(
        "timeout({:.3}s; previous={previous})",
        options.timeout_seconds.max(0.0)
    )
}

fn theorem_report(
    before: &GraphAnalysis,
    after: &GraphAnalysis,
    candidate_after: &GraphAnalysis,
    termination: &str,
    accepted: bool,
    rejection_reasons: &[String],
) -> Value {
    json!({
        "schema": "oristudio/cp-compiler/exact-solve-theorem-report-v1",
        "termination": termination,
        "accepted": accepted,
        "rejection_reasons": rejection_reasons,
        "before": analysis_json(before),
        "after": analysis_json(after),
        "candidate_after": analysis_json(candidate_after),
    })
}

fn exact_solve_trace_json(
    input: &ExactSolveInput,
    model: &SolveModel,
    initial_breakdown: &ResidualBreakdown,
    accepted_breakdown: &ResidualBreakdown,
    candidate_breakdown: &ResidualBreakdown,
    counters: &SolveCounterSnapshot,
) -> Value {
    let fixed_vertices = model
        .vertex_params
        .iter()
        .filter(|param| matches!(param, VertexParameterization::Fixed { .. }))
        .count();
    let boundary_vertices = model
        .vertex_params
        .iter()
        .filter(|param| {
            matches!(
                param,
                VertexParameterization::Boundary { .. }
                    | VertexParameterization::PolyBoundary { .. }
            )
        })
        .count();
    let free_vertices = model
        .vertex_params
        .iter()
        .filter(|param| matches!(param, VertexParameterization::Free { .. }))
        .count();
    json!({
        "parameter_count": model.initial_params.len(),
        "residual_count": initial_breakdown.count(),
        "selected_spans": input.selected_spans.len(),
        "vertices": input.vertices.len(),
        "carrier_groups": model.carrier_groups.len(),
        "vertex_parameters": {
            "fixed": fixed_vertices,
            "boundary": boundary_vertices,
            "free": free_vertices,
        },
        "counters": counters,
        "initial_residuals": residual_breakdown_json(initial_breakdown),
        "accepted_residuals": residual_breakdown_json(accepted_breakdown),
        "candidate_residuals": residual_breakdown_json(candidate_breakdown),
    })
}

fn residual_breakdown_json(breakdown: &ResidualBreakdown) -> Value {
    json!({
        "count": breakdown.count(),
        "energy": round6(breakdown.energy()),
        "movement": {
            "count": breakdown.movement_count,
            "energy": round6(breakdown.movement_energy),
        },
        "boundary_movement": {
            "count": breakdown.boundary_movement_count,
            "energy": round6(breakdown.boundary_movement_energy),
        },
        "carrier_prior": {
            "count": breakdown.carrier_prior_count,
            "energy": round6(breakdown.carrier_prior_energy),
        },
        "carrier_incidence": {
            "count": breakdown.carrier_incidence_count,
            "energy": round6(breakdown.carrier_incidence_energy),
        },
        "kawasaki": {
            "count": breakdown.kawasaki_count,
            "energy": round6(breakdown.kawasaki_energy),
        },
        "coincidence": {
            "count": breakdown.coincidence_count,
            "energy": round6(breakdown.coincidence_energy),
        },
    })
}

fn analysis_json(analysis: &GraphAnalysis) -> Value {
    json!({
        "eligible_vertices": analysis.eligible_vertices,
        "odd_degree_vertices": analysis.odd_degree_vertices,
        "degree_two_vertices": analysis.degree_two_vertices,
        "maekawa_failures": analysis.maekawa_failures,
        "boundary_span_ids": analysis.boundary_span_ids,
        "paper_boundary_span_ids": analysis.paper_boundary_span_ids,
        "cut_boundary_span_ids": analysis.cut_boundary_span_ids,
        "boundary_vertices": analysis.boundary_vertices,
        "max_kawasaki_residual_degrees": round6(analysis.max_kawasaki_residual_degrees),
        "camv_angle_violations": analysis.camv.map(|c| c.angle_violations),
        "big_little_big_violations": analysis.camv.map(|c| c.big_little_big_violations),
        "max_carrier_residual": round6(analysis.max_carrier_residual),
        "max_vertex_movement": round6(analysis.max_vertex_movement),
        "mean_vertex_movement": round6(analysis.mean_vertex_movement),
        "degenerate_edges": analysis.degenerate_edges,
        "unmodeled_crossings": analysis.unmodeled_crossings,
        "boundary_failures": analysis.boundary_failures,
        "vertex_diagnostics": analysis.vertex_diagnostics,
    })
}

fn failed_graph(
    input: &ExactSolveInput,
    vertices_exact: Vec<Point2>,
    movement_report: Value,
    theorem_residual_report: Value,
) -> ExactSolvedGraph {
    ExactSolvedGraph {
        schema: SCHEMA.to_owned(),
        vertices_exact,
        edges_exact: input
            .selected_spans
            .iter()
            .map(|span| span.vertices)
            .collect(),
        merged_vertices: Vec::new(),
        movement_report,
        theorem_residual_report,
        status: ExactSolvedGraphStatus::Failed,
    }
}

fn is_interior_fold_vertex(vertex: &CandidateVertex, boundary_vertices: &BTreeSet<usize>) -> bool {
    if boundary_vertices.contains(&vertex.id) {
        return false;
    }
    vertex.boundary_side.is_none()
        && !matches!(
            vertex.kind,
            CandidateVertexKind::Corner | CandidateVertexKind::BoundaryContact
        )
}

/// How far from straight two spans may turn and still count as one crease split
/// in two.
///
/// Read off the data rather than picked. Turn angles at the degree-2 vertices of
/// four saved detections, in degrees from straight:
///
/// ```text
/// 0.51 0.54 0.56 0.64 0.69 0.72 1.42 1.48 1.57 1.60 1.78 1.97 | 11.10 11.19 | 110.03 112.67
/// ```
///
/// A tight cluster under 2° — detector noise on a vertex that should not exist,
/// every one of them with the same assignment on both sides — then a clear gap,
/// then two at 11° and two unambiguous corners. 5° sits in the gap.
///
/// Erring low is the safe direction: refusing to merge leaves a real vertex
/// visible as the defect it is, while merging too eagerly fabricates a straight
/// crease the user never drew.
const DEGREE_TWO_MERGE_TOLERANCE_DEGREES: f64 = 5.0;

/// Dissolve degree-2 vertices whose two creases are one straight line.
///
/// The shipping candidate generator emits a crease crossed by nothing as two
/// spans meeting at a degree-2 vertex — 24 of them on one saved detection, 26 of
/// 30 across the four. That vertex is not information: it is one crease reported
/// twice, and it costs the solve twice.
///
/// The first cost is the carrier. Two collinear spans carry two carrier
/// geometries, and if the binning does not group them the solve is pinned to two
/// nearly-parallel lines that cannot both be satisfied. The second is the
/// **report**: a degree-2 vertex is `degree < 4`, so it is skipped by Kawasaki
/// entirely and never appears in the residual — while the editor's CAMV calls a
/// non-collinear one an `Angles` violation. So the solver silently ignores what
/// the checker flags.
///
/// **Only collinear ones.** A degree-2 vertex whose creases genuinely turn is a
/// corner, and merging it would fabricate geometry the user never drew — it is a
/// real defect and it should stay visible. Upstream draws the same line:
/// `del_v_all` merges only through a `Parallel*` intersection.
///
/// Vertices are **not renumbered**. A merged-away vertex simply stops being
/// referenced, so `vertices_exact` stays index-aligned with `input.vertices` and
/// every caller that maps a solved point back by id keeps working.
pub fn merge_collinear_degree_two_spans(input: &mut ExactSolveInput) -> usize {
    let cos_limit = -(DEGREE_TWO_MERGE_TOLERANCE_DEGREES.to_radians().cos());
    let mut merged = 0usize;
    while let Some((keep, drop, vertex)) = next_collinear_degree_two(input, cos_limit) {
        let removed = input.selected_spans[drop].clone();
        let far = other_end(&removed, vertex);
        let span = &mut input.selected_spans[keep];
        let near = other_end(span, vertex);
        span.vertices = [near, far];
        span.t_interval = [
            span.t_interval[0].min(removed.t_interval[0]),
            span.t_interval[1].max(removed.t_interval[1]),
        ];
        // The weaker half governs: a merged crease is only as well-evidenced as
        // its worse piece, and claiming otherwise would let a merge launder a
        // low-confidence span into a high-confidence one.
        span.presence_probability = span.presence_probability.min(removed.presence_probability);
        span.line_support_min = span.line_support_min.min(removed.line_support_min);
        span.line_support_max = span.line_support_max.max(removed.line_support_max);
        span.line_support_mean = 0.5 * (span.line_support_mean + removed.line_support_mean);
        span.style_support = span.style_support.min(removed.style_support);
        span.non_crease_support = span.non_crease_support.max(removed.non_crease_support);
        span.collapsed_vertex_ids.push(vertex);
        span.collapsed_vertex_ids
            .extend(&removed.collapsed_vertex_ids);
        span.source_edge_ids.extend(&removed.source_edge_ids);
        span.source_atomic_edge_ids
            .extend(&removed.source_atomic_edge_ids);
        span.source_carrier_ids.extend(&removed.source_carrier_ids);
        span.replaced_span_ids.push(removed.id);
        span.replaced_span_ids.extend(&removed.replaced_span_ids);
        span.replaced_atomic_edge_ids
            .extend(&removed.replaced_atomic_edge_ids);
        input.selected_spans.remove(drop);
        merged += 1;
    }
    merged
}

fn other_end(span: &CandidateCreaseSpan, vertex: usize) -> usize {
    if span.vertices[0] == vertex {
        span.vertices[1]
    } else {
        span.vertices[0]
    }
}

/// The next `(keep, drop, vertex)` to merge, or none when the graph is settled.
fn next_collinear_degree_two(
    input: &ExactSolveInput,
    cos_limit: f64,
) -> Option<(usize, usize, usize)> {
    let boundary = boundary_vertex_ids(&input.selected_spans);
    let mut incident: Vec<Vec<usize>> = vec![Vec::new(); input.vertices.len()];
    for (index, span) in input.selected_spans.iter().enumerate() {
        if !is_fold_span(span) {
            continue;
        }
        for id in span.vertices {
            if let Some(slot) = incident.get_mut(id) {
                slot.push(index);
            }
        }
    }
    for vertex in &input.vertices {
        if !is_interior_fold_vertex(vertex, &boundary) {
            continue;
        }
        let [left, right] = match incident[vertex.id][..] {
            [left, right] => [left, right],
            _ => continue,
        };
        let a = &input.selected_spans[left];
        let b = &input.selected_spans[right];
        // Merging across an assignment change would invent a mountain where the
        // user drew a valley, so a colour change is a real vertex.
        if a.assignment_label() != b.assignment_label() {
            continue;
        }
        let here = input.vertices[vertex.id].point;
        let to = |span: &CandidateCreaseSpan| {
            let far = input.vertices[other_end(span, vertex.id)].point;
            let (dx, dy) = (far.x - here.x, far.y - here.y);
            let length = (dx * dx + dy * dy).sqrt();
            (dx / length, dy / length, length)
        };
        let (ax, ay, la) = to(a);
        let (bx, by, lb) = to(b);
        if la <= 0.0 || lb <= 0.0 || !la.is_finite() || !lb.is_finite() {
            continue;
        }
        // The two rays must point opposite ways: straight through, not a corner.
        if ax * bx + ay * by > cos_limit {
            continue;
        }
        return Some((left, right, vertex.id));
    }
    None
}

fn is_boundary_like_span(span: &CandidateCreaseSpan) -> bool {
    span.boundary_role() != CandidateCreaseBoundaryRole::None
}

/// Whether this span is a **fold**, and so belongs in a vertex's fan.
///
/// Boundary spans are excluded because the paper edge is not a crease. `Flat` is
/// excluded for the same reason: FOLD's `F` is an edge whose fold angle is zero,
/// so the paper is continuous across it. Two things follow, and the solver used
/// to get both wrong:
///
/// - **Kawasaki's alternating sum is over folds.** A flat edge splits one sector
///   into two collinear halves, which flips the parity of every sector after it
///   and makes the alternation meaningless.
/// - **The odd-degree test is a count of folds.** Four folds plus one auxiliary
///   line read as degree five, i.e. "cannot fold flat no matter where the
///   vertices sit" — about a vertex that folds perfectly well.
///
/// Maekawa already excluded `Flat` (it counts Mountain and Valley only), so the
/// analysis disagreed with itself; this is the half that was wrong. `Unknown` is
/// the label for *a fold whose direction is undecided* and stays in the fan,
/// which is what keeps it counted in the degree while correctly suppressing
/// Maekawa.
///
/// Two other places already read `Flat` this way — `decode.rs`'s crease count
/// and `compare_exact_solve_benchmark.rs`'s edge walk both group it with
/// `Boundary` and skip — so this makes the compiler agree with its own callers.
/// Oriedita agrees too: `is_folding_line()` is Black0|Red1|Blue2, and
/// `point_line_map` skips Cyan3 outright, so an auxiliary line is not in its
/// foldability graph at all.
///
/// Measured: detection attachments carry **zero** `Flat` spans, so this is a
/// no-op on the shipped path. It matters for a graph rebuilt from a document the
/// user has edited, where an auxiliary crease is an ordinary thing to draw — and
/// for TreeMaker, whose `Flat` spans are all `UNFOLDED_HINGE`, upstream's own
/// name for a crease that does not fold.
fn is_fold_span(span: &CandidateCreaseSpan) -> bool {
    !is_boundary_like_span(span) && span.assignment_label() != AssignmentLabel::Flat
}

fn boundary_span_ids(spans: &[CandidateCreaseSpan]) -> Vec<usize> {
    spans
        .iter()
        .filter(|span| is_boundary_like_span(span))
        .map(|span| span.id)
        .collect()
}

fn paper_boundary_span_ids(spans: &[CandidateCreaseSpan]) -> Vec<usize> {
    spans
        .iter()
        .filter(|span| span.boundary_role() == CandidateCreaseBoundaryRole::PaperBoundary)
        .map(|span| span.id)
        .collect()
}

fn cut_boundary_span_ids(spans: &[CandidateCreaseSpan]) -> Vec<usize> {
    spans
        .iter()
        .filter(|span| span.boundary_role() == CandidateCreaseBoundaryRole::CutBoundary)
        .map(|span| span.id)
        .collect()
}

fn boundary_vertex_ids(spans: &[CandidateCreaseSpan]) -> BTreeSet<usize> {
    spans
        .iter()
        .filter(|span| is_boundary_like_span(span))
        .flat_map(|span| span.vertices)
        .collect()
}

fn corner_points(boundary: &BoundaryModel) -> BTreeMap<usize, Point2> {
    let mut points = BTreeMap::new();
    for (index, vertex_id) in boundary.corners.iter().copied().enumerate() {
        let point = match index {
            0 => Point2::new(0.0, 0.0),
            1 => Point2::new(1.0, 0.0),
            2 => Point2::new(1.0, 1.0),
            3 => Point2::new(0.0, 1.0),
            _ => unreachable!(),
        };
        points.insert(vertex_id, point);
    }
    points
}

fn is_polygon_boundary(input: &ExactSolveInput) -> bool {
    input.boundary.reconstruction_policy == BoundaryReconstructionPolicy::Polygon
}

/// Polygon-policy corners: pinned to their input positions rather than the unit
/// square.
fn polygon_corner_points(input: &ExactSolveInput) -> BTreeMap<usize, Point2> {
    input
        .boundary
        .corners
        .iter()
        .filter_map(|&id| input.vertices.get(id).map(|v| (id, v.point)))
        .collect()
}

/// Polygon-policy side segments keyed by boundary-vertex id: `(origin, vector)`
/// so the vertex slides along `origin + t·vector` between its two corners.
fn polygon_side_segments(input: &ExactSolveInput) -> BTreeMap<usize, (Point2, Point2)> {
    let mut segments = BTreeMap::new();
    for side in &input.boundary.sides {
        let (Some(a), Some(b)) = (
            input.vertices.get(side.corner_vertices[0]),
            input.vertices.get(side.corner_vertices[1]),
        ) else {
            continue;
        };
        let vector = Point2::new(b.point.x - a.point.x, b.point.y - a.point.y);
        for &vertex_id in &side.contact_vertices {
            segments.insert(vertex_id, (a.point, vector));
        }
    }
    segments
}

/// Position `t` of `point` projected onto the segment `origin + t·vector`.
fn segment_param(point: Point2, origin: Point2, vector: Point2) -> f64 {
    let denom = vector.x * vector.x + vector.y * vector.y;
    if denom <= 0.0 {
        return 0.0;
    }
    ((point.x - origin.x) * vector.x + (point.y - origin.y) * vector.y) / denom
}

fn movement_sigma(cost_model: &CostModel, options: ExactSolveOptions, support: f64) -> f64 {
    let support_scale = 1.0 - support.clamp(0.0, 1.0) * 0.35;
    options
        .movement_sigma
        .min(cost_model.sigma_distance_px / 128.0)
        .max(1e-6)
        * support_scale.max(0.35)
}

fn movement_weight(support: f64, source_weight: f64) -> f64 {
    source_weight * (0.75 + support.clamp(0.0, 1.0) * 0.50)
}

fn side_coord(side: BoundarySide, point: Point2) -> f64 {
    match side {
        BoundarySide::Top | BoundarySide::Bottom => point.x,
        BoundarySide::Right | BoundarySide::Left => point.y,
    }
}

fn side_point(side: BoundarySide, coord: f64) -> Point2 {
    match side {
        BoundarySide::Top => Point2::new(coord, 0.0),
        BoundarySide::Right => Point2::new(1.0, coord),
        BoundarySide::Bottom => Point2::new(coord, 1.0),
        BoundarySide::Left => Point2::new(0.0, coord),
    }
}

fn angle_radians(origin: Point2, target: Point2) -> f64 {
    (target.y - origin.y)
        .atan2(target.x - origin.x)
        .rem_euclid(TAU)
}

fn angle_delta(left: f64, right: f64) -> f64 {
    (left - right + std::f64::consts::PI).rem_euclid(TAU) - std::f64::consts::PI
}

fn distance(left: Point2, right: Point2) -> f64 {
    ((left.x - right.x).powi(2) + (left.y - right.y).powi(2)).sqrt()
}

fn residual_energy(residuals: &[f64]) -> f64 {
    0.5 * residuals.iter().map(|value| value * value).sum::<f64>()
}

fn degenerate_edges(
    input: &ExactSolveInput,
    points: &[Point2],
    options: ExactSolveOptions,
) -> Vec<[usize; 2]> {
    input
        .selected_spans
        .iter()
        .filter_map(|span| {
            let [a, b] = span.vertices;
            (distance(points[a], points[b]) <= options.degenerate_edge_epsilon).then_some([a, b])
        })
        .collect()
}

fn unmodeled_crossings(
    input: &ExactSolveInput,
    points: &[Point2],
    options: ExactSolveOptions,
) -> Vec<[usize; 2]> {
    let mut crossings = Vec::new();
    for (left_index, left) in input.selected_spans.iter().enumerate() {
        // Folds only, for the same reason the fan is folds only. An auxiliary
        // line crossing a crease is not a topology error — it is a guide drawn
        // across the pattern, which is what guides are for — so counting it here
        // makes the gate fire on a document the user drew correctly.
        if !is_fold_span(left) {
            continue;
        }
        for right in input.selected_spans.iter().skip(left_index + 1) {
            if !is_fold_span(right) {
                continue;
            }
            if left.vertices.iter().any(|id| right.vertices.contains(id)) {
                continue;
            }
            if segments_cross_strict(
                points[left.vertices[0]],
                points[left.vertices[1]],
                points[right.vertices[0]],
                points[right.vertices[1]],
                options.crossing_epsilon,
            ) {
                crossings.push([left.id, right.id]);
            }
        }
    }
    crossings
}

fn segments_cross_strict(a: Point2, b: Point2, c: Point2, d: Point2, epsilon: f64) -> bool {
    let r = Point2::new(b.x - a.x, b.y - a.y);
    let s = Point2::new(d.x - c.x, d.y - c.y);
    let denominator = cross(r, s);
    if denominator.abs() <= epsilon {
        return false;
    }
    let c_minus_a = Point2::new(c.x - a.x, c.y - a.y);
    let t = cross(c_minus_a, s) / denominator;
    let u = cross(c_minus_a, r) / denominator;
    t > epsilon && t < 1.0 - epsilon && u > epsilon && u < 1.0 - epsilon
}

fn cross(left: Point2, right: Point2) -> f64 {
    left.x * right.y - left.y * right.x
}

fn boundary_failures(input: &ExactSolveInput, points: &[Point2]) -> Vec<usize> {
    let side_segments = if is_polygon_boundary(input) {
        polygon_side_segments(input)
    } else {
        BTreeMap::new()
    };
    input
        .vertices
        .iter()
        .filter_map(|vertex| {
            let point = points[vertex.id];
            let failed = if input.boundary.corners.contains(&vertex.id) {
                false
            } else if let Some(&(origin, vector)) = side_segments.get(&vertex.id) {
                let t = segment_param(point, origin, vector);
                !(-1e-6..=1.0 + 1e-6).contains(&t)
            } else if let Some(side) = vertex.boundary_side {
                let coord = side_coord(side, point);
                !(-1e-6..=1.0 + 1e-6).contains(&coord)
            } else {
                false
            };
            failed.then_some(vertex.id)
        })
        .collect()
}

fn round6(value: f64) -> f64 {
    (value * 1_000_000.0).round() / 1_000_000.0
}

/// Polish-stage Kawasaki residuals live around 1e-3 to 1e-7 degrees, where
/// [`round6`] would quantise the interesting digits (or flatten them to zero).
fn round12(value: f64) -> f64 {
    (value * 1e12).round() / 1e12
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AssignmentCandidate, AssignmentEvidence, AssignmentEvidenceSource,
        CandidateCreaseSourceKind, CandidateSelectionPolicy, Provenance,
        candidate_graph::{
            BoundaryReconstructionPolicy, BoundarySideModel, CandidateCarrierGeometry,
        },
    };

    #[test]
    fn valid_cp_remains_solved_and_stable() {
        // `four_ray_input` is M,V,M,V — a Maekawa failure, as the sibling
        // fixture's own comment says. It only ever passed as "valid" while the
        // verdict ignored Maekawa.
        let input = maekawa_clean_four_ray_input(Point2::new(0.5, 0.5));
        let solved = solve_exact(&input, ExactSolveOptions::default());
        assert_eq!(solved.status, ExactSolvedGraphStatus::Solved);
        assert!(distance(solved.vertices_exact[4], Point2::new(0.5, 0.5)) < 1e-8);
        let after = &solved.theorem_residual_report["after"];
        assert_eq!(after["max_kawasaki_residual_degrees"], 0.0);
    }

    #[test]
    fn noisy_kawasaki_vertex_exactizes_without_changing_topology() {
        let input = four_ray_input(Point2::new(0.53, 0.50));
        let before_model = test_model(&input, ExactSolveOptions::default());
        let before = analyze_graph(
            &input,
            &input
                .vertices
                .iter()
                .map(|vertex| vertex.point)
                .collect::<Vec<_>>(),
            &before_model,
            &before_model.initial_params,
            ExactSolveOptions::default(),
        );
        let solved = solve_exact(&input, ExactSolveOptions::default());
        let after_residual =
            solved.theorem_residual_report["after"]["max_kawasaki_residual_degrees"]
                .as_f64()
                .unwrap();
        assert!(
            after_residual < before.max_kawasaki_residual_degrees,
            "expected exact solve to reduce Kawasaki residual"
        );
        assert!(
            matches!(
                solved.status,
                ExactSolvedGraphStatus::Solved | ExactSolvedGraphStatus::Ambiguous
            ),
            "solver should find a nearby solution or report ambiguity, not hard-fail"
        );
    }

    #[test]
    fn polish_tightens_kawasaki_beyond_stage_one() {
        // Displacement sits inside the position-prior trust region (~0.003
        // sigma / 0.010 budget): the solver is tuned to correct detector-scale
        // noise (a few px), not to chase distant exact configurations.
        let input = four_ray_input(Point2::new(0.505, 0.50));
        let unpolished = solve_exact(
            &input,
            ExactSolveOptions {
                polish: false,
                ..ExactSolveOptions::default()
            },
        );
        let polished = solve_exact(&input, ExactSolveOptions::default());
        let residual = |graph: &ExactSolvedGraph| {
            graph.theorem_residual_report["after"]["max_kawasaki_residual_degrees"]
                .as_f64()
                .unwrap()
        };
        assert!(polished.movement_report["accepted"].as_bool().unwrap());
        assert!(
            residual(&polished) <= residual(&unpolished),
            "polish must not loosen the stage-1 result ({} vs {})",
            residual(&polished),
            residual(&unpolished),
        );
        assert!(
            residual(&polished) < 1e-4,
            "polish should land below the flat-folder precision cliff, got {}",
            residual(&polished),
        );
        assert!(
            polished.movement_report["termination"]
                .as_str()
                .unwrap()
                .contains("polish"),
            "polish stage should be recorded in the termination string"
        );
    }

    /// CAMV's flatness tolerance, the bar the editor's foldability checker
    /// actually applies (`Epsilon::FLAT`, in degrees). Any Kawasaki residual
    /// above this still reads as an "Incorrect angles" violation in the editor.
    const CAMV_FLAT_EPSILON_DEGREES: f64 = 1e-6;

    #[test]
    fn lattice_offset_is_signed_distance_to_nearest_multiple() {
        let step = 22.5_f64.to_radians();
        for (theta_degrees, expected_degrees) in [
            (45.0_f64, 0.0_f64),
            (46.0, 1.0),
            (44.0, -1.0),
            (-22.5, 0.0),
            (170.0, -10.0),
            (0.3, 0.3),
        ] {
            let offset = lattice_offset(theta_degrees.to_radians(), step).to_degrees();
            assert!(
                (offset - expected_degrees).abs() < 1e-9,
                "{theta_degrees}: expected {expected_degrees}, got {offset}"
            );
        }
    }

    #[test]
    fn infer_angle_family_picks_the_lattice_most_carriers_sit_on() {
        let tolerance = 1.5_f64.to_radians();
        let degrees = |list: &[f64]| list.iter().map(|d| d.to_radians()).collect::<Vec<_>>();
        let family = |list: &[f64]| infer_angle_family(&degrees(list), tolerance, 0.5);
        // A 22.5° design, drawn with half a degree of noise. Its odd multiples
        // are 7.5° from the 15° lattice, so that one only fits the 45° subset.
        assert_eq!(family(&[0.4, 22.1, 45.3, 67.9, 90.0, 112.6]), Some(22.5));
        // A 45° design fits every family and reads as the coarsest.
        assert_eq!(family(&[0.0, 45.2, 90.1, 135.0]), Some(45.0));
        // Hex pleating: 30° and 60° everywhere, which the square families miss.
        assert_eq!(family(&[0.2, 29.8, 60.4, 90.0, 120.1, 149.7]), Some(30.0));
        // A hex design that also uses 15° creases reads as 15°, not 30°.
        assert_eq!(
            family(&[0.0, 15.2, 30.1, 45.0, 60.3, 75.0, 90.0, 104.9]),
            Some(15.0)
        );
        // Box-pleat diagonals at atan 2 are on none of them, and with them in
        // the majority there is no family to pin to.
        assert_eq!(family(&[26.57, 63.43, 116.57, 153.43, 0.0, 90.0]), None);
        assert_eq!(infer_angle_family(&[], tolerance, 0.5), None);
    }

    /// The four-ray fan pinned to its family. Its rays run to the fixed
    /// corners, so the only point where all four sit at exactly 45° is the
    /// centre of the square, and the pinned round has to put the vertex there
    /// — not near it — for the four right angles to tie within the checker's
    /// 1e-6°.
    fn assert_pinned_fan_lands_on_the_centre(options: ExactSolveOptions) {
        let input = maekawa_clean_four_ray_input(Point2::new(0.505, 0.50));
        let solved = solve_exact(&input, options);
        let pinned = &solved.movement_report["polish"]["pinned_family"];
        assert_eq!(
            pinned["adopted"],
            serde_json::Value::Bool(true),
            "the fan is a 45° design and must be pinned: {pinned}"
        );
        // A fan of diagonals fits every family and reads as the coarsest.
        assert_eq!(pinned["step_degrees"], serde_json::json!(45.0));
        assert!(
            solved.movement_report["termination"]
                .as_str()
                .unwrap()
                .ends_with(",pinned)"),
            "{}",
            solved.movement_report["termination"]
        );
        assert_eq!(solved.status, ExactSolvedGraphStatus::Solved);
        let centre = solved.vertices_exact[4];
        assert!(
            (centre.x - 0.5).abs() < 1e-9 && (centre.y - 0.5).abs() < 1e-9,
            "pinned directions through fixed corners meet at the centre, got {centre:?}"
        );
        for corner in 0..4 {
            let to = solved.vertices_exact[corner];
            let angle = (to.y - centre.y).atan2(to.x - centre.x).to_degrees();
            let off_lattice = lattice_offset(angle, 45.0);
            assert!(
                off_lattice.abs() < 1e-7,
                "ray to corner {corner} sits {off_lattice} degrees off the lattice"
            );
        }
    }

    #[test]
    fn pinned_round_makes_designed_ties_exact() {
        assert_pinned_fan_lands_on_the_centre(ExactSolveOptions::default());
    }

    #[test]
    fn pinned_round_freezes_directions_on_the_dense_path_too() {
        assert_pinned_fan_lands_on_the_centre(ExactSolveOptions {
            linear_solver: LinearSolver::Dense,
            ..ExactSolveOptions::default()
        });
    }

    #[test]
    fn angle_family_off_never_pins() {
        let input = maekawa_clean_four_ray_input(Point2::new(0.505, 0.50));
        let solved = solve_exact(
            &input,
            ExactSolveOptions {
                angle_family: AngleFamilyMode::Off,
                ..ExactSolveOptions::default()
            },
        );
        assert!(solved.movement_report["polish"]["pinned_family"].is_null());
        assert!(
            !solved.movement_report["termination"]
                .as_str()
                .unwrap()
                .contains("pinned")
        );
    }

    /// A pinned round that would cost a Kawasaki vertex is refused, and the
    /// solve keeps the unpinned answer. The fan's top ray is bent 4° off the
    /// diagonal, which is outside every retry tolerance, so it is never pinned;
    /// pinning the other three then forces Kawasaki at the centre onto a
    /// direction the free ray cannot reach from where its far end is fixed.
    #[test]
    fn pinned_round_is_refused_rather_than_break_kawasaki() {
        let mut input = maekawa_clean_four_ray_input(Point2::new(0.5, 0.5));
        // Move corner 2 (the (1,1) end) off the diagonal so its ray is 4° off
        // 45°; the corner is fixed, so nothing the solve does can put it back.
        let bent = 49.0_f64.to_radians();
        input.vertices[2].point = Point2::new(0.5 + 0.5 * bent.cos(), 0.5 + 0.5 * bent.sin());
        let solved = solve_exact(&input, ExactSolveOptions::default());
        let pinned = &solved.movement_report["polish"]["pinned_family"];
        if pinned.is_null() {
            // Three of six carriers on the lattice is exactly the fraction bar;
            // either reading is fine, as long as nothing was pinned.
            return;
        }
        assert_eq!(
            pinned["adopted"],
            serde_json::Value::Bool(false),
            "{pinned}"
        );
        for attempt in pinned["attempts"].as_array().unwrap() {
            assert!(
                !attempt["refusals"].as_array().unwrap().is_empty(),
                "every attempt must say why it was refused: {attempt}"
            );
        }
    }

    /// The design's centre vertex — eight creases at 45° — detected as two
    /// vertices `a` and `b` a few pixels apart on the horizontal crease through
    /// it, joined by a stub of that crease. Each half is a legal vertex on its
    /// own (degree 6 and degree 4, Kawasaki- and Maekawa-clean, no
    /// Big-Little-Big), so nothing but the lattice says they are one: pinned,
    /// the lines through each are concurrent at the centre, the stub collapses,
    /// and the answer holds one vertex.
    fn split_junction_input() -> (ExactSolveInput, usize, usize, usize) {
        let mut input = base_square_input();
        // Boundary contacts for the horizontal and vertical creases. The base
        // square's Top side is y = 0, corners 0 → 1.
        for (id, point, side) in [
            (4, Point2::new(0.5, 0.0), BoundarySide::Top),
            (5, Point2::new(0.5, 1.0), BoundarySide::Bottom),
            (6, Point2::new(0.0, 0.5), BoundarySide::Left),
            (7, Point2::new(1.0, 0.5), BoundarySide::Right),
        ] {
            input.vertices.push(vertex(
                id,
                point,
                CandidateVertexKind::BoundaryContact,
                CandidateVertexMovementPolicy::Movable,
                Some(side),
            ));
        }
        let a = 8;
        let b = 9;
        input.vertices.push(vertex(
            a,
            Point2::new(0.496, 0.5005),
            CandidateVertexKind::InteriorJunction,
            CandidateVertexMovementPolicy::Movable,
            None,
        ));
        input.vertices.push(vertex(
            b,
            Point2::new(0.504, 0.4995),
            CandidateVertexKind::InteriorJunction,
            CandidateVertexMovementPolicy::Movable,
            None,
        ));
        // Split each of the Top and Bottom border spans at its contact, and the
        // Left and Right ones likewise.
        input.selected_spans.clear();
        let border = [
            (0, 0, 4),
            (1, 4, 1),
            (2, 1, 7),
            (3, 7, 2),
            (4, 3, 5),
            (5, 5, 2),
            (6, 0, 6),
            (7, 6, 3),
        ];
        for (id, p, q) in border {
            input.selected_spans.push(span(
                id,
                p,
                q,
                AssignmentLabel::Boundary,
                id,
                &input.vertices,
            ));
        }
        input.boundary.sides[0].contact_vertices = vec![0, 4, 1];
        input.boundary.sides[1].contact_vertices = vec![1, 7, 2];
        input.boundary.sides[2].contact_vertices = vec![3, 5, 2];
        input.boundary.sides[3].contact_vertices = vec![0, 6, 3];
        input.boundary.generated_border_span_ids = (0..8).collect();
        use AssignmentLabel::{Mountain as M, Valley as V};
        // `a` keeps the left half of the fan plus both verticals; `b` the right
        // half. Maekawa holds on each half with the stub counted, and on the
        // union without it: 5 mountains to 3 valleys.
        let stub = 8;
        let creases = [
            (stub, a, b, M),
            (9, a, 5, M),  // up (the Bottom side is y = 1 — image coordinates)
            (10, a, 3, V), // (0, 1)
            (11, a, 6, M), // left
            (12, a, 0, V), // (0, 0)
            (13, a, 4, M), // down
            (14, b, 2, M), // (1, 1)
            (15, b, 7, V), // right
            (16, b, 1, M), // (1, 0)
        ];
        for (id, p, q, label) in creases {
            input
                .selected_spans
                .push(span(id, p, q, label, id, &input.vertices));
        }
        (input, a, b, stub)
    }

    #[test]
    fn pinned_round_merges_a_split_junction() {
        let (input, a, b, stub) = split_junction_input();
        let solved = solve_exact(&input, ExactSolveOptions::default());
        let pinned = &solved.movement_report["polish"]["pinned_family"];
        assert_eq!(pinned["adopted"], serde_json::Value::Bool(true), "{pinned}");
        assert_eq!(
            solved.merged_vertices,
            vec![[a, b]],
            "the stub's ends are the design's one vertex: {}",
            solved.movement_report["polish"]
        );
        assert_eq!(
            solved.movement_report["merged_vertices"],
            serde_json::json!([[a, b]])
        );
        let (at_a, at_b) = (solved.vertices_exact[a], solved.vertices_exact[b]);
        assert_eq!(at_a, at_b, "a merged pair is one point, exactly");
        assert!(
            (at_a.x - 0.5).abs() < 1e-9 && (at_a.y - 0.5).abs() < 1e-9,
            "the pinned lines are concurrent at the centre, got {at_a:?}"
        );
        assert_eq!(
            solved.status,
            ExactSolvedGraphStatus::Solved,
            "{}",
            solved.movement_report
        );
        // The stub is still listed, index-paired with the input's spans, and is
        // what the editor will drop.
        assert_eq!(solved.edges_exact.len(), input.selected_spans.len());
        assert_eq!(solved.edges_exact[stub], [a, b]);
        // The FOLD the answer exports holds the merged pattern: one vertex
        // fewer, the stub gone, and the checker clean on it.
        let fold = crate::fold_export::export_exact_solved_to_fold_document(&input, &solved)
            .expect("export");
        assert_eq!(fold.edges_vertices.len(), input.selected_spans.len() - 1);
        assert_eq!(fold.vertices_coords.len(), input.vertices.len() - 1);
        assert_eq!(fold.edges_assignment.len(), fold.edges_vertices.len());
        let model = oristudio_cp::io::fold::import_fold_document(&fold).expect("import");
        let violations = oristudio_cp::checks::check_camv_task(&model).violations;
        assert!(violations.is_empty(), "{violations:?}");
    }

    #[test]
    fn split_junction_stays_split_without_the_pin() {
        let (input, a, b, _stub) = split_junction_input();
        let solved = solve_exact(
            &input,
            ExactSolveOptions {
                angle_family: AngleFamilyMode::Off,
                ..ExactSolveOptions::default()
            },
        );
        assert!(solved.merged_vertices.is_empty());
        assert_ne!(solved.vertices_exact[a], solved.vertices_exact[b]);
    }

    #[test]
    fn polish_report_records_adopted_rounds() {
        // Maekawa-clean, so the polish can actually reach `Solved`; the M,V,M,V
        // fan never can, and a round that cannot improve past `Ambiguous` is
        // refused on its objective — which is right, and not what this tests.
        let input = maekawa_clean_four_ray_input(Point2::new(0.505, 0.50));
        let solved = solve_exact(&input, ExactSolveOptions::default());
        let polish = &solved.movement_report["polish"];
        assert!(polish["enabled"].as_bool().unwrap());
        assert!(polish["ran"].as_bool().unwrap());
        assert!(
            polish["rounds_adopted"].as_u64().unwrap() > 0,
            "an adopted polish must report its round count, got {polish}"
        );
        // A round may be refused once progress stalls — on this fixture the
        // polish bottoms out near 2e-5 degrees, and a third round that cannot
        // lower the objective is rightly thrown away. What must never happen is
        // a refusal that *regressed*, or no adopted round at all. (Under the old
        // 1e-3 bar the stalled round counted as `Solved`, which hid the refusal
        // rather than avoiding it.)
        if !polish["refused_round"].is_null() {
            assert_eq!(
                polish["refused_round"]["kawasaki_regressed"],
                serde_json::Value::Bool(false),
                "a refused round must not have made Kawasaki worse: {polish}"
            );
        }
        let before = polish["kawasaki_before_degrees"].as_f64().unwrap();
        let after = polish["kawasaki_after_degrees"].as_f64().unwrap();
        assert!(
            after < before,
            "adopted rounds should tighten Kawasaki ({after} vs {before})"
        );
        assert!(
            solved.movement_report["termination"]
                .as_str()
                .unwrap()
                .contains("polish"),
            "the termination string and the polish report must agree"
        );
    }

    #[test]
    fn polish_report_records_why_a_refused_round_was_refused() {
        // Same fixture as the adopted case, with the movement budget pinned to
        // what stage 1 already spent. Stage 1 still passes (the gate is a strict
        // `>`), but every polish round has to move further to tighten Kawasaki,
        // so the first one is computed and then thrown away.
        let input = four_ray_input(Point2::new(0.505, 0.50));
        let stage1_only = solve_exact(
            &input,
            ExactSolveOptions {
                polish: false,
                ..ExactSolveOptions::default()
            },
        );
        assert!(stage1_only.movement_report["accepted"].as_bool().unwrap());
        // The reported movement is rounded to 6 decimals, so add back more than
        // that rounding can hide to keep stage 1 comfortably inside the budget.
        // A polish round needs orders of magnitude more room than this slack.
        let budget = stage1_only.movement_report["max_vertex_movement"]
            .as_f64()
            .unwrap()
            + 1e-6;

        let solved = solve_exact(
            &input,
            ExactSolveOptions {
                max_vertex_movement: budget,
                ..ExactSolveOptions::default()
            },
        );
        assert!(
            solved.movement_report["accepted"].as_bool().unwrap(),
            "stage 1 must still be accepted, or this fixture is testing the wrong refusal"
        );
        assert!(
            !solved.movement_report["termination"]
                .as_str()
                .unwrap()
                .contains("polish"),
            "no round was adopted, so the termination string carries no polish suffix -- \
             which is exactly why the report has to say more"
        );

        let polish = &solved.movement_report["polish"];
        assert!(polish["ran"].as_bool().unwrap());
        assert_eq!(polish["stop_reason"], "round_refused");
        assert_eq!(polish["rounds_attempted"], 1);
        assert_eq!(polish["rounds_adopted"], 0);
        assert_eq!(
            polish["kawasaki_before_degrees"], polish["kawasaki_after_degrees"],
            "nothing was adopted, so the kept residual is the stage-1 residual"
        );

        let refused = &polish["refused_round"];
        assert!(
            !refused["kawasaki_regressed"].as_bool().unwrap(),
            "this round was refused by the gates, not for making Kawasaki worse"
        );
        let reasons = refused["rejection_reasons"]
            .as_array()
            .unwrap()
            .iter()
            .map(|reason| reason.as_str().unwrap().to_owned())
            .collect::<Vec<_>>();
        assert!(
            reasons.contains(&"movement_budget_exceeded".to_owned()),
            "the refusal reasons must survive into the report, got {reasons:?}"
        );

        let would_have_reached = refused["kawasaki_degrees"].as_f64().unwrap();
        let kept = polish["kawasaki_after_degrees"].as_f64().unwrap();
        assert!(
            would_have_reached < kept,
            "the refused round was better on Kawasaki alone ({would_have_reached} vs {kept}) -- \
             that gap is the thing the report exists to explain"
        );
        // The fact that stops someone "fixing" this by loosening the gate: the
        // refused round is still far above the checker's bar, so adopting it
        // would corrupt geometry and clear no violation. See [`PolishOutcome`].
        assert!(
            would_have_reached > CAMV_FLAT_EPSILON_DEGREES,
            "a refused round that already cleared CAMV would change this argument; \
             got {would_have_reached} vs {CAMV_FLAT_EPSILON_DEGREES}"
        );
    }

    #[test]
    fn odd_degree_topology_fails_structurally() {
        let mut input = four_ray_input(Point2::new(0.5, 0.5));
        input.selected_spans.retain(|span| span.id != 7);
        let solved = solve_exact(&input, ExactSolveOptions::default());
        assert_eq!(solved.status, ExactSolvedGraphStatus::Failed);
        let odd = solved.theorem_residual_report["after"]["odd_degree_vertices"]
            .as_array()
            .unwrap();
        assert_eq!(odd.len(), 1);
        assert_eq!(odd[0].as_u64().unwrap(), 4);
    }

    #[test]
    fn odd_degree_elsewhere_does_not_block_partial_exactization() {
        let mut input = four_ray_input(Point2::new(0.53, 0.50));
        let dangling = input.vertices.len();
        input.vertices.push(vertex(
            dangling,
            Point2::new(0.25, 0.25),
            CandidateVertexKind::InteriorJunction,
            CandidateVertexMovementPolicy::Movable,
            None,
        ));
        input.selected_spans.push(span(
            input.selected_spans.len(),
            dangling,
            0,
            AssignmentLabel::Mountain,
            77,
            &input.vertices,
        ));

        let before_model = test_model(&input, ExactSolveOptions::default());
        let before = analyze_graph(
            &input,
            &input
                .vertices
                .iter()
                .map(|vertex| vertex.point)
                .collect::<Vec<_>>(),
            &before_model,
            &before_model.initial_params,
            ExactSolveOptions::default(),
        );
        assert_eq!(before.odd_degree_vertices, vec![dangling]);

        let solved = solve_exact(&input, ExactSolveOptions::default());
        assert_eq!(solved.status, ExactSolvedGraphStatus::Ambiguous);
        assert!(solved.movement_report["accepted"].as_bool().unwrap());
        assert!(
            solved.theorem_residual_report["after"]["max_kawasaki_residual_degrees"]
                .as_f64()
                .unwrap()
                < before.max_kawasaki_residual_degrees,
            "valid even-degree vertices should still be exactized"
        );
        assert!(
            distance(solved.vertices_exact[4], input.vertices[4].point) > 1e-4,
            "noisy valid vertex should move even though another region has bad topology"
        );
        assert_eq!(
            solved.theorem_residual_report["after"]["odd_degree_vertices"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn theorem_checks_skip_vertices_incident_to_cut_boundary_spans() {
        let mut input = base_square_input();
        let a = input.vertices.len();
        input.vertices.push(vertex(
            a,
            Point2::new(0.20, 0.70),
            CandidateVertexKind::InteriorJunction,
            CandidateVertexMovementPolicy::Movable,
            None,
        ));
        let b = input.vertices.len();
        input.vertices.push(vertex(
            b,
            Point2::new(0.70, 0.80),
            CandidateVertexKind::InteriorJunction,
            CandidateVertexMovementPolicy::Movable,
            None,
        ));
        input.selected_spans.push(span(
            input.selected_spans.len(),
            a,
            b,
            AssignmentLabel::Unknown,
            90,
            &input.vertices,
        ));
        input
            .selected_spans
            .last_mut()
            .expect("cut boundary span")
            .boundary_role = CandidateCreaseBoundaryRole::CutBoundary;
        input.selected_spans.push(span(
            input.selected_spans.len(),
            a,
            0,
            AssignmentLabel::Mountain,
            91,
            &input.vertices,
        ));

        let solved = solve_exact(&input, ExactSolveOptions::default());
        let after = &solved.theorem_residual_report["after"];
        assert_eq!(
            after["odd_degree_vertices"].as_array().unwrap(),
            &Vec::<serde_json::Value>::new()
        );
        let boundary_vertices = after["boundary_vertices"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|value| value.as_u64())
            .collect::<Vec<_>>();
        assert!(boundary_vertices.contains(&(a as u64)));
        assert!(boundary_vertices.contains(&(b as u64)));
    }

    #[test]
    fn boundary_contact_moves_only_along_boundary_side() {
        let mut input = four_ray_input(Point2::new(0.5, 0.5));
        let top_contact_id = input.vertices.len();
        input.vertices.push(vertex(
            top_contact_id,
            Point2::new(0.45, 0.04),
            CandidateVertexKind::BoundaryContact,
            CandidateVertexMovementPolicy::BoundaryOnly,
            Some(BoundarySide::Top),
        ));
        input.selected_spans.push(span(
            input.selected_spans.len(),
            top_contact_id,
            4,
            AssignmentLabel::Mountain,
            42,
            &input.vertices,
        ));
        let solved = solve_exact(&input, ExactSolveOptions::default());
        assert_eq!(solved.vertices_exact[top_contact_id].y, 0.0);
        assert!((0.0..=1.0).contains(&solved.vertices_exact[top_contact_id].x));
    }

    #[test]
    fn shared_carrier_incidence_straightens_noisy_split_vertex() {
        let mut input = base_square_input();
        let a = input.vertices.len();
        input.vertices.push(vertex(
            a,
            Point2::new(0.0, 0.5),
            CandidateVertexKind::BoundaryContact,
            CandidateVertexMovementPolicy::BoundaryOnly,
            Some(BoundarySide::Left),
        ));
        let b = input.vertices.len();
        input.vertices.push(vertex(
            b,
            Point2::new(0.5, 0.515),
            CandidateVertexKind::InteriorJunction,
            CandidateVertexMovementPolicy::Movable,
            None,
        ));
        let c = input.vertices.len();
        input.vertices.push(vertex(
            c,
            Point2::new(1.0, 0.5),
            CandidateVertexKind::BoundaryContact,
            CandidateVertexMovementPolicy::BoundaryOnly,
            Some(BoundarySide::Right),
        ));
        input.selected_spans.push(span_with_carrier(
            input.selected_spans.len(),
            a,
            b,
            AssignmentLabel::Mountain,
            99,
            Point2::new(0.0, 1.0),
            0.5,
            &input.vertices,
        ));
        input.selected_spans.push(span_with_carrier(
            input.selected_spans.len(),
            b,
            c,
            AssignmentLabel::Mountain,
            99,
            Point2::new(0.0, 1.0),
            0.5,
            &input.vertices,
        ));
        // Noise scaled to the position-prior trust region (sigma 0.003): the
        // solver corrects detector-scale offsets, it no longer chases vertices
        // placed far off their detected positions.
        input.vertices[b].point = Point2::new(0.5, 0.504);
        let solved = solve_exact(&input, ExactSolveOptions::default());
        assert!(
            (solved.vertices_exact[b].y - 0.5).abs() < 0.002,
            "middle split vertex should project back toward the shared carrier"
        );
    }

    #[test]
    fn analytic_jacobian_matches_finite_difference_for_kawasaki_vertex() {
        let input = four_ray_input(Point2::new(0.53, 0.48));
        assert_analytic_jacobian_matches_finite_difference(&input);
    }

    #[test]
    fn analytic_jacobian_matches_finite_difference_for_shared_carrier_split() {
        let mut input = base_square_input();
        let a = input.vertices.len();
        input.vertices.push(vertex(
            a,
            Point2::new(0.0, 0.5),
            CandidateVertexKind::BoundaryContact,
            CandidateVertexMovementPolicy::BoundaryOnly,
            Some(BoundarySide::Left),
        ));
        let b = input.vertices.len();
        input.vertices.push(vertex(
            b,
            Point2::new(0.5, 0.515),
            CandidateVertexKind::InteriorJunction,
            CandidateVertexMovementPolicy::Movable,
            None,
        ));
        let c = input.vertices.len();
        input.vertices.push(vertex(
            c,
            Point2::new(1.0, 0.5),
            CandidateVertexKind::BoundaryContact,
            CandidateVertexMovementPolicy::BoundaryOnly,
            Some(BoundarySide::Right),
        ));
        input.selected_spans.push(span_with_carrier(
            input.selected_spans.len(),
            a,
            b,
            AssignmentLabel::Mountain,
            99,
            Point2::new(0.0, 1.0),
            0.5,
            &input.vertices,
        ));
        input.selected_spans.push(span_with_carrier(
            input.selected_spans.len(),
            b,
            c,
            AssignmentLabel::Mountain,
            99,
            Point2::new(0.0, 1.0),
            0.5,
            &input.vertices,
        ));

        assert_analytic_jacobian_matches_finite_difference(&input);
    }

    #[test]
    fn impossible_large_movement_is_reported_failed() {
        let mut input = four_ray_input(Point2::new(0.64, 0.50));
        input.image_size = Some(1024);
        let solved = solve_exact(&input, ExactSolveOptions::default());
        assert_eq!(solved.status, ExactSolvedGraphStatus::Failed);
        assert_eq!(solved.vertices_exact[4], Point2::new(0.64, 0.50));
        assert!(!solved.movement_report["accepted"].as_bool().unwrap());
        assert!(
            solved.movement_report["max_vertex_movement"]
                .as_f64()
                .unwrap()
                <= ExactSolveOptions::default().max_vertex_movement
        );
        assert!(
            solved.movement_report["attempted_max_vertex_movement"]
                .as_f64()
                .unwrap()
                > ExactSolveOptions::default().max_vertex_movement
        );
    }

    /// The `right_small_fork` fixture's raster, used to talk about drift in the
    /// pixels the plan's measurements are quoted in.
    const FORK_IMAGE_SIZE: f64 = 1024.0;
    /// An interior junction of `right_small_fork` whose 27px displacement the
    /// default budget rejects. Verified below in both directions.
    const FORK_MOVED_VERTEX: usize = 1;

    #[test]
    fn empty_exemption_set_reproduces_the_unexempted_solve_exactly() {
        let input = load_fixture_input("right_small_fork");
        let plain = solve_exact(&input, ExactSolveOptions::default());
        let via_exemptions = solve_exact_with_exemptions(
            &input,
            &ExactSolveOptionsWithExemptions::from(ExactSolveOptions::default()),
        );
        assert_eq!(
            plain.vertices_exact, via_exemptions.vertices_exact,
            "an empty exemption set must be the solve that shipped"
        );
        assert_eq!(
            comparable_solve_json(&plain),
            comparable_solve_json(&via_exemptions),
            "the whole report must match too, not just the coordinates"
        );

        // ...and that solve is still the committed golden, so the budget now
        // reading a restricted maximum changed no accepted behavior.
        let golden = load_golden_points("right_small_fork");
        // `Solved`: the fixture is a 22.5° design, and the pinned round makes its
        // designed ties exact — the one Big-Little-Big violation the Kawasaki-only
        // solve left behind is gone with them.
        assert_eq!(plain.status, ExactSolvedGraphStatus::Solved);
        assert!(plain.movement_report["accepted"].as_bool().unwrap_or(false));
        let drift = max_golden_drift_px(&plain.vertices_exact, &golden, 1.0);
        assert!(
            drift < 1e-6,
            "default solve drifted {drift} from the committed golden"
        );
    }

    #[test]
    fn options_json_deserializes_into_the_exemption_wrapper_unchanged() {
        // The wasm solve entry point takes an options object as JSON; the
        // flattened wrapper has to accept exactly what `ExactSolveOptions`
        // serializes today, and default the exemption set to empty.
        let options = ExactSolveOptions::default();
        let json = serde_json::to_string(&options).expect("serialize options");
        let parsed: ExactSolveOptionsWithExemptions =
            serde_json::from_str(&json).expect("parse options as wrapper");
        assert_eq!(parsed.options, options);
        assert!(parsed.exempt_vertex_ids.is_empty());

        let with_exemptions = ExactSolveOptionsWithExemptions {
            options,
            exempt_vertex_ids: BTreeSet::from([3, 11]),
        };
        let round_tripped: ExactSolveOptionsWithExemptions =
            serde_json::from_str(&serde_json::to_string(&with_exemptions).expect("serialize"))
                .expect("parse");
        assert_eq!(round_tripped, with_exemptions);
    }

    #[test]
    fn exempting_a_hand_moved_vertex_admits_a_solve_the_budget_rejects() {
        // ~27px at the fixture's 1024px raster, well past the 0.010 (~10.2px)
        // budget, which is measured from the *input* coordinates — so a
        // deliberate user edit reads exactly like solver drift.
        let displacement = 27.0 / FORK_IMAGE_SIZE;
        let input = load_fixture_input("right_small_fork");
        let golden = load_golden_points("right_small_fork");
        let mut edited = input.clone();
        edited.vertices[FORK_MOVED_VERTEX].point = Point2::new(
            input.vertices[FORK_MOVED_VERTEX].point.x + displacement * 0.6,
            input.vertices[FORK_MOVED_VERTEX].point.y - displacement * 0.8,
        );

        let rejected = solve_exact(&edited, ExactSolveOptions::default());
        assert_eq!(rejected.status, ExactSolvedGraphStatus::Failed);
        assert!(
            rejection_reasons(&rejected).contains(&"movement_budget_exceeded".to_owned()),
            "expected the budget to be the rejection, got {:?}",
            rejection_reasons(&rejected)
        );
        assert_eq!(
            rejected.vertices_exact[FORK_MOVED_VERTEX], edited.vertices[FORK_MOVED_VERTEX].point,
            "a rejected solve hands the user's unsolved edit straight back"
        );

        let accepted = solve_exact_with_exemptions(
            &edited,
            &ExactSolveOptionsWithExemptions {
                options: ExactSolveOptions::default(),
                exempt_vertex_ids: BTreeSet::from([FORK_MOVED_VERTEX]),
            },
        );
        // Exemption is about acceptance, which is asserted next; the verdict is
        // the pinned round's, as in
        // `empty_exemption_set_reproduces_the_unexempted_solve_exactly`.
        assert_eq!(accepted.status, ExactSolvedGraphStatus::Solved);
        assert!(
            accepted.movement_report["accepted"]
                .as_bool()
                .unwrap_or(false)
        );
        // The edited vertex is pulled most of the way back to the golden
        // (measured 7.45px of the 27px injected), and nothing else is dragged
        // far by admitting it (measured 3.94px).
        let moved_drift = distance(
            accepted.vertices_exact[FORK_MOVED_VERTEX],
            golden[FORK_MOVED_VERTEX],
        ) * FORK_IMAGE_SIZE;
        assert!(
            moved_drift < 9.0,
            "exempted vertex landed {moved_drift}px from the golden"
        );
        let others_drift = accepted
            .vertices_exact
            .iter()
            .zip(&golden)
            .enumerate()
            .filter(|(index, _)| *index != FORK_MOVED_VERTEX)
            .map(|(_, (solved, golden))| distance(*solved, *golden) * FORK_IMAGE_SIZE)
            .fold(0.0_f64, f64::max);
        assert!(
            others_drift < 5.0,
            "unexempted vertices drifted {others_drift}px from the golden"
        );
    }

    #[test]
    fn exempting_a_different_vertex_does_not_raise_the_budget() {
        // The exemption removes vertices from the maximum; it must not act as
        // a blanket raise for the vertex that actually broke the budget.
        let displacement = 27.0 / FORK_IMAGE_SIZE;
        let input = load_fixture_input("right_small_fork");
        let mut edited = input.clone();
        edited.vertices[FORK_MOVED_VERTEX].point = Point2::new(
            input.vertices[FORK_MOVED_VERTEX].point.x + displacement * 0.6,
            input.vertices[FORK_MOVED_VERTEX].point.y - displacement * 0.8,
        );

        let bystander = solve_exact_with_exemptions(
            &edited,
            &ExactSolveOptionsWithExemptions {
                options: ExactSolveOptions::default(),
                exempt_vertex_ids: BTreeSet::from([FORK_MOVED_VERTEX + 1]),
            },
        );
        assert_eq!(bystander.status, ExactSolvedGraphStatus::Failed);
        assert!(
            rejection_reasons(&bystander).contains(&"movement_budget_exceeded".to_owned()),
            "exempting an unrelated vertex must leave the budget in force, got {:?}",
            rejection_reasons(&bystander)
        );
    }

    #[test]
    fn topology_analysis_flags_an_odd_degree_vertex() {
        let mut input = maekawa_clean_four_ray_input(Point2::new(0.53, 0.50));
        input.selected_spans.retain(|span| span.id != 7);
        let diagnostics = analyze_candidate_topology(&input);
        assert!(diagnostics.blockers.is_empty());
        assert_eq!(diagnostics.combinatorial.odd_degree_vertices, vec![4]);
        let junction = interior_vertex(&diagnostics, 4);
        assert_eq!(junction.degree, 3);
        // Kawasaki does not apply to an odd fan, so the angle-dependent view
        // of this vertex is silent while the combinatorial one is not.
        assert_eq!(junction.kawasaki_residual_degrees, None);
    }

    #[test]
    fn topology_analysis_flags_a_degree_two_vertex() {
        let mut input = maekawa_clean_four_ray_input(Point2::new(0.53, 0.50));
        input
            .selected_spans
            .retain(|span| span.id != 6 && span.id != 7);
        let diagnostics = analyze_candidate_topology(&input);
        assert!(diagnostics.blockers.is_empty());
        assert_eq!(diagnostics.combinatorial.degree_two_vertices, vec![4]);
        assert!(
            diagnostics.combinatorial.odd_degree_vertices.is_empty(),
            "degree two is even; it must not also read as a parity failure"
        );
        assert_eq!(interior_vertex(&diagnostics, 4).degree, 2);
    }

    #[test]
    fn topology_analysis_flags_a_maekawa_failure() {
        let clean =
            analyze_candidate_topology(&maekawa_clean_four_ray_input(Point2::new(0.53, 0.50)));
        assert!(clean.combinatorial.maekawa_failures.is_empty());
        assert_eq!(interior_vertex(&clean, 4).maekawa_residual, Some(0));

        // M,V,M,V is |M - V| = 0, two away from the required 2.
        let failing = analyze_candidate_topology(&four_ray_input(Point2::new(0.53, 0.50)));
        assert_eq!(failing.combinatorial.maekawa_failures, vec![4]);
        let junction = interior_vertex(&failing, 4);
        assert_eq!(junction.degree, 4);
        assert_eq!(junction.mountain_count, 2);
        assert_eq!(junction.valley_count, 2);
        assert_eq!(junction.unknown_count, 0);
        assert_eq!(junction.maekawa_residual, Some(2));
        assert!(
            failing.combinatorial.odd_degree_vertices.is_empty(),
            "Maekawa must fire on its own, not only alongside a parity failure"
        );
    }

    #[test]
    fn topology_analysis_flags_a_degenerate_edge() {
        let mut input = maekawa_clean_four_ray_input(Point2::new(0.53, 0.50));
        let center = input.vertices[4].point;
        let twin = input.vertices.len();
        input.vertices.push(vertex(
            twin,
            center,
            CandidateVertexKind::InteriorJunction,
            CandidateVertexMovementPolicy::Movable,
            None,
        ));
        let span_id = input.selected_spans.len();
        input.selected_spans.push(span(
            span_id,
            4,
            twin,
            AssignmentLabel::Mountain,
            82,
            &input.vertices,
        ));

        let diagnostics = analyze_candidate_topology(&input);
        assert!(diagnostics.blockers.is_empty());
        // Vertex ids, not span ids.
        assert_eq!(diagnostics.combinatorial.degenerate_edges, vec![[4, twin]]);
    }

    #[test]
    fn topology_analysis_flags_an_unmodeled_crossing() {
        let mut input = base_square_input();
        for point in [
            Point2::new(0.2, 0.2),
            Point2::new(0.8, 0.8),
            Point2::new(0.2, 0.8),
            Point2::new(0.8, 0.2),
        ] {
            let id = input.vertices.len();
            input.vertices.push(vertex(
                id,
                point,
                CandidateVertexKind::InteriorJunction,
                CandidateVertexMovementPolicy::Movable,
                None,
            ));
        }
        let first = input.selected_spans.len();
        input.selected_spans.push(span(
            first,
            4,
            5,
            AssignmentLabel::Mountain,
            80,
            &input.vertices,
        ));
        input.selected_spans.push(span(
            first + 1,
            6,
            7,
            AssignmentLabel::Valley,
            81,
            &input.vertices,
        ));

        let diagnostics = analyze_candidate_topology(&input);
        assert!(diagnostics.blockers.is_empty());
        // Span ids, not vertex ids — the two `[usize; 2]` fields differ.
        assert_eq!(
            diagnostics.combinatorial.unmodeled_crossings,
            vec![[first, first + 1]]
        );
    }

    #[test]
    fn topology_analysis_flags_a_vertex_off_its_paper_edge() {
        let mut input = maekawa_clean_four_ray_input(Point2::new(0.53, 0.50));
        let stray = input.vertices.len();
        input.vertices.push(vertex(
            stray,
            Point2::new(1.2, 0.0),
            CandidateVertexKind::BoundaryContact,
            CandidateVertexMovementPolicy::BoundaryOnly,
            Some(BoundarySide::Top),
        ));
        let span_id = input.selected_spans.len();
        input.selected_spans.push(span(
            span_id,
            stray,
            4,
            AssignmentLabel::Mountain,
            83,
            &input.vertices,
        ));

        let diagnostics = analyze_candidate_topology(&input);
        assert!(diagnostics.blockers.is_empty());
        assert_eq!(diagnostics.combinatorial.boundary_failures, vec![stray]);
    }

    #[test]
    fn topology_analysis_blocks_on_a_span_referencing_a_missing_vertex() {
        let mut input = maekawa_clean_four_ray_input(Point2::new(0.53, 0.50));
        let span_id = input.selected_spans.len();
        input.selected_spans.push(span_with_carrier(
            span_id,
            4,
            99,
            AssignmentLabel::Mountain,
            84,
            Point2::new(0.0, 1.0),
            0.5,
            &input.vertices,
        ));

        let diagnostics = analyze_candidate_topology(&input);
        assert_eq!(diagnostics.blockers.len(), 1);
        assert!(
            diagnostics.blockers[0].contains("missing vertex 99"),
            "unexpected blocker: {}",
            diagnostics.blockers[0]
        );
        assert_eq!(
            diagnostics.combinatorial,
            CombinatorialTopologyFindings::default(),
            "a blocked analysis must report nothing rather than something partial"
        );
    }

    #[test]
    fn topology_analysis_blocks_on_a_vertex_id_that_is_not_its_index() {
        // `analyze_graph` indexes by `vertex.id`; a hand-edited graph that
        // broke the id == index invariant must block, not panic.
        let mut input = maekawa_clean_four_ray_input(Point2::new(0.53, 0.50));
        input.vertices[4].id = 99;
        let diagnostics = analyze_candidate_topology(&input);
        assert!(
            diagnostics
                .blockers
                .iter()
                .any(|blocker| blocker.contains("out-of-range id 99")),
            "unexpected blockers: {:?}",
            diagnostics.blockers
        );
    }

    #[test]
    fn combinatorial_findings_survive_a_small_coordinate_perturbation() {
        let input = defect_laden_input();
        let base = analyze_candidate_topology(&input);
        let moved = analyze_candidate_topology(&perturbed(&input));
        assert!(base.blockers.is_empty() && moved.blockers.is_empty());

        // Every combinatorial category is actually exercised, so the equality
        // below is not vacuous.
        assert!(!base.combinatorial.odd_degree_vertices.is_empty());
        assert!(!base.combinatorial.degree_two_vertices.is_empty());
        assert!(!base.combinatorial.maekawa_failures.is_empty());
        assert!(!base.combinatorial.degenerate_edges.is_empty());
        assert!(!base.combinatorial.unmodeled_crossings.is_empty());
        assert_eq!(
            base.combinatorial, moved.combinatorial,
            "combinatorial findings must not depend on where the drawing sits"
        );

        // The angle-dependent ones are populated, and they do move — which is
        // exactly why they are useless as a repair worklist on a candidate.
        assert!(base.angle_dependent.max_kawasaki_residual_degrees > 0.0);
        assert_ne!(
            base.angle_dependent.max_kawasaki_residual_degrees,
            moved.angle_dependent.max_kawasaki_residual_degrees
        );
        assert_ne!(
            base.angle_dependent.max_carrier_residual,
            moved.angle_dependent.max_carrier_residual
        );
    }

    /// One graph carrying every combinatorial finding at once: a noisy
    /// four-ray junction (Maekawa failure, non-zero Kawasaki), a crossing pair,
    /// a two-segment chain through a degree-two vertex, and a coincident pair.
    fn defect_laden_input() -> ExactSolveInput {
        let mut input = four_ray_input(Point2::new(0.53, 0.50));
        fn push_vertex(input: &mut ExactSolveInput, point: Point2) -> usize {
            let id = input.vertices.len();
            input.vertices.push(vertex(
                id,
                point,
                CandidateVertexKind::InteriorJunction,
                CandidateVertexMovementPolicy::Movable,
                None,
            ));
            id
        }
        let crossing = [
            push_vertex(&mut input, Point2::new(0.2, 0.2)),
            push_vertex(&mut input, Point2::new(0.8, 0.8)),
            push_vertex(&mut input, Point2::new(0.2, 0.8)),
            push_vertex(&mut input, Point2::new(0.8, 0.2)),
        ];
        let chain = [
            push_vertex(&mut input, Point2::new(0.05, 0.30)),
            push_vertex(&mut input, Point2::new(0.10, 0.35)),
            push_vertex(&mut input, Point2::new(0.15, 0.42)),
        ];
        let coincident = Point2::new(0.85, 0.05);
        let twins = [
            push_vertex(&mut input, coincident),
            push_vertex(&mut input, coincident),
        ];
        for (a, b) in [
            (crossing[0], crossing[1]),
            (crossing[2], crossing[3]),
            (chain[0], chain[1]),
            (chain[1], chain[2]),
            (twins[0], twins[1]),
        ] {
            let id = input.selected_spans.len();
            input.selected_spans.push(span(
                id,
                a,
                b,
                AssignmentLabel::Mountain,
                id,
                &input.vertices,
            ));
        }
        input
    }

    /// A small, smooth near-identity displacement of every vertex. It is a
    /// function of the point alone, so coincident vertices stay coincident and
    /// a degenerate edge stays degenerate.
    fn perturbed(input: &ExactSolveInput) -> ExactSolveInput {
        let mut moved = input.clone();
        for vertex in &mut moved.vertices {
            let point = vertex.point;
            vertex.point = Point2::new(
                point.x + 3e-4 * (7.0 * point.y + 0.4).sin(),
                point.y + 3e-4 * (5.0 * point.x + 0.9).cos(),
            );
        }
        moved
    }

    fn interior_vertex(
        diagnostics: &TopologyDiagnostics,
        vertex_id: usize,
    ) -> &TopologyVertexDiagnostic {
        diagnostics
            .vertices
            .iter()
            .find(|vertex| vertex.vertex_id == vertex_id)
            .unwrap_or_else(|| panic!("no diagnostic for vertex {vertex_id}"))
    }

    /// A solve's full report minus the one field that is wall-clock and so
    /// differs between two runs of the same solve.
    fn comparable_solve_json(solved: &ExactSolvedGraph) -> Value {
        let mut value = serde_json::to_value(solved).expect("serialize solve");
        if let Some(report) = value
            .get_mut("movement_report")
            .and_then(Value::as_object_mut)
        {
            report.remove("elapsed_seconds");
            if let Some(attempts) = report
                .get_mut("polish")
                .and_then(|polish| polish.get_mut("pinned_family"))
                .and_then(|pinned| pinned.get_mut("attempts"))
                .and_then(Value::as_array_mut)
            {
                for attempt in attempts.iter_mut().filter_map(Value::as_object_mut) {
                    attempt.remove("seconds");
                }
            }
        }
        value
    }

    fn rejection_reasons(solved: &ExactSolvedGraph) -> Vec<String> {
        solved.movement_report["rejection_reasons"]
            .as_array()
            .map(|reasons| {
                reasons
                    .iter()
                    .filter_map(|reason| reason.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default()
    }

    fn fixture_path(name: &str) -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/exact_solve")
            .join(name)
    }

    fn load_fixture_input(name: &str) -> ExactSolveInput {
        let path = fixture_path(&format!("{name}.json"));
        let bytes = std::fs::read(&path).expect("read fixture");
        serde_json::from_slice(&bytes).expect("parse fixture")
    }

    fn load_golden_points(name: &str) -> Vec<Point2> {
        let path = fixture_path(&format!("{name}.golden.json"));
        let bytes = std::fs::read(&path).expect("read golden");
        let golden: Value = serde_json::from_slice(&bytes).expect("parse golden");
        golden["vertices"]
            .as_array()
            .expect("golden vertices")
            .iter()
            .map(|pair| {
                Point2::new(
                    pair[0].as_f64().unwrap_or(f64::NAN),
                    pair[1].as_f64().unwrap_or(f64::NAN),
                )
            })
            .collect()
    }

    fn max_golden_drift_px(solved: &[Point2], golden: &[Point2], image_size: f64) -> f64 {
        solved
            .iter()
            .zip(golden)
            .map(|(left, right)| distance(*left, *right) * image_size)
            .fold(0.0_f64, f64::max)
    }

    fn four_ray_input(center: Point2) -> ExactSolveInput {
        four_ray_input_with_labels(
            center,
            [
                AssignmentLabel::Mountain,
                AssignmentLabel::Valley,
                AssignmentLabel::Mountain,
                AssignmentLabel::Valley,
            ],
        )
    }

    /// A single interior junction with one ray to each corner, ray `i` carrying
    /// `labels[i]`.
    fn four_ray_input_with_labels(center: Point2, labels: [AssignmentLabel; 4]) -> ExactSolveInput {
        let mut input = base_square_input();
        input.vertices.push(vertex(
            4,
            center,
            CandidateVertexKind::InteriorJunction,
            CandidateVertexMovementPolicy::Movable,
            None,
        ));
        for (corner, label) in labels.into_iter().enumerate() {
            let id = 4 + corner;
            input
                .selected_spans
                .push(span(id, 4, corner, label, id, &input.vertices));
        }
        input
    }

    /// [`four_ray_input_with_labels`] with a Maekawa-satisfying fan. The plain
    /// [`four_ray_input`] fan is M,V,M,V — `|M - V| = 0`, so it is itself a
    /// Maekawa failure and cannot be the baseline for one.
    fn maekawa_clean_four_ray_input(center: Point2) -> ExactSolveInput {
        four_ray_input_with_labels(
            center,
            [
                AssignmentLabel::Mountain,
                AssignmentLabel::Valley,
                AssignmentLabel::Mountain,
                AssignmentLabel::Mountain,
            ],
        )
    }

    /// A vertex with two collinear creases through it, plus their far ends.
    /// `turn_degrees` bends the second away from straight.
    fn degree_two_input(turn_degrees: f64, labels: [AssignmentLabel; 2]) -> ExactSolveInput {
        let mut input = base_square_input();
        let here = Point2::new(0.5, 0.5);
        // Vertex 5 sits due -x of the junction, so its ray is at 180 deg.
        // Straight through is therefore 0 deg, and the turn bends off that.
        let angle = turn_degrees.to_radians();
        for (id, point) in [
            (4, here),
            (5, Point2::new(0.2, 0.5)),
            (
                6,
                Point2::new(0.5 + 0.3 * angle.cos(), 0.5 + 0.3 * angle.sin()),
            ),
        ] {
            input.vertices.push(vertex(
                id,
                point,
                CandidateVertexKind::InteriorJunction,
                CandidateVertexMovementPolicy::Movable,
                None,
            ));
        }
        input
            .selected_spans
            .push(span(8, 4, 5, labels[0], 8, &input.vertices));
        input
            .selected_spans
            .push(span(9, 4, 6, labels[1], 9, &input.vertices));
        input
    }

    const MV: [AssignmentLabel; 2] = [AssignmentLabel::Mountain, AssignmentLabel::Mountain];

    /// One crease reported as two is not information, and it costs the solve
    /// twice: two carrier geometries for one line, and a `degree < 4` vertex the
    /// Kawasaki pass skips while the editor's CAMV flags it.
    #[test]
    fn a_collinear_degree_two_vertex_is_dissolved() {
        // 1.5 deg — inside the sub-2 deg noise cluster the four saved detections
        // put every spurious split in.
        let input = degree_two_input(1.5, MV);
        let topology = analyze_candidate_topology(&input);
        assert!(
            topology.combinatorial.degree_two_vertices.is_empty(),
            "a collinear split should be merged away, got {:?}",
            topology.combinatorial.degree_two_vertices
        );
    }

    /// A dissolved vertex is straightened after the movement report is built, so
    /// the report has to be told — otherwise it undercounts, and callers that
    /// read it as the answer never place the vertex at all.
    ///
    /// That is not hypothetical: placing from `moved_vertices` left every
    /// dissolved vertex at its old, off-line coordinate while both neighbours
    /// moved, and a degree-2 vertex is Kawasaki-clean only when exactly
    /// collinear. Measured on `mid-solve_4`: 48 CAMV angle violations before,
    /// 40 placing from the report, 2 placing from `vertices_exact`.
    #[test]
    fn a_dissolved_vertex_appears_in_the_movement_report() {
        let input = degree_two_input(1.5, MV);
        let solved = solve_exact(&input, ExactSolveOptions::default());

        // It is straightened in the answer...
        let straightened = solved.vertices_exact[4];
        assert!(
            distance(straightened, input.vertices[4].point) > 1e-10,
            "the dissolved vertex should have been placed onto the solved crease"
        );

        // ...and the report says so, at the same coordinate.
        let reported = solved.movement_report["moved_vertices"]
            .as_array()
            .expect("moved_vertices")
            .iter()
            .find(|entry| entry["vertex_id"] == 4)
            .expect("the dissolved vertex must be reported as moved");
        assert_eq!(reported["after"]["x"], json!(straightened.x));
        assert_eq!(reported["after"]["y"], json!(straightened.y));

        // Every vertex that moved is named. This is the invariant a caller needs
        // in order to trust the report at all.
        for (id, vertex) in input.vertices.iter().enumerate() {
            if distance(solved.vertices_exact[id], vertex.point) <= 1e-10 {
                continue;
            }
            assert!(
                solved.movement_report["moved_vertices"]
                    .as_array()
                    .is_some_and(|list| list.iter().any(|e| e["vertex_id"] == id)),
                "vertex {id} moved but is missing from the movement report"
            );
        }
    }

    /// A vertex whose creases genuinely turn is a corner. Merging it would
    /// fabricate a straight crease the user never drew, so it stays — visible as
    /// the defect it is.
    #[test]
    fn a_genuine_corner_is_not_dissolved() {
        let input = degree_two_input(60.0, MV);
        let topology = analyze_candidate_topology(&input);
        assert_eq!(
            topology.combinatorial.degree_two_vertices,
            vec![4],
            "a 60 deg corner is a real vertex"
        );
    }

    /// Merging across an assignment change would invent a mountain where the
    /// user drew a valley.
    #[test]
    fn a_mountain_meeting_a_valley_is_not_dissolved() {
        let input = degree_two_input(0.5, [AssignmentLabel::Mountain, AssignmentLabel::Valley]);
        let topology = analyze_candidate_topology(&input);
        assert_eq!(topology.combinatorial.degree_two_vertices, vec![4]);
    }

    /// The merge must not renumber: `vertices_exact` is index-aligned with
    /// `input.vertices`, and every caller that maps a solved point back by id
    /// depends on that. A dissolved vertex stops being referenced, it does not
    /// disappear.
    #[test]
    fn dissolving_a_vertex_keeps_the_vertex_array_aligned() {
        let input = degree_two_input(1.5, MV);
        let solved = solve_exact(&input, ExactSolveOptions::default());
        assert_eq!(solved.vertices_exact.len(), input.vertices.len());
    }

    /// An auxiliary line is not a fold, and must not be counted as one.
    ///
    /// FOLD's `F` is an edge whose fold angle is zero — the paper is continuous
    /// across it — and the CP kernel round-trips it as `Cyan3`, which CAMV skips
    /// outright. So a vertex with four folds and one auxiliary line through it
    /// has degree four, not five, and folds perfectly well.
    #[test]
    fn an_auxiliary_span_does_not_make_a_vertex_odd_degree() {
        let mut input = four_ray_input(Point2::new(0.5, 0.5));
        // A fifth ray to a new vertex, carrying `Flat`. Before this was fixed it
        // pushed the junction to degree 5 and the pattern read as unfoldable at
        // any coordinates.
        input.vertices.push(vertex(
            5,
            Point2::new(0.5, 0.9),
            CandidateVertexKind::InteriorJunction,
            CandidateVertexMovementPolicy::Movable,
            None,
        ));
        input
            .selected_spans
            .push(span(8, 4, 5, AssignmentLabel::Flat, 8, &input.vertices));

        let topology = analyze_candidate_topology(&input);
        assert!(
            topology.combinatorial.odd_degree_vertices.is_empty(),
            "an auxiliary line must not change a vertex's fold degree, got {:?}",
            topology.combinatorial.odd_degree_vertices
        );
    }

    /// `Unknown` is the opposite case and must stay in the fan: it means a fold
    /// whose direction is undecided, not a non-fold. Keeping it counted is also
    /// what leaves Maekawa correctly suppressed rather than failing.
    #[test]
    fn an_unknown_span_still_counts_as_a_fold() {
        let mut input = four_ray_input(Point2::new(0.5, 0.5));
        input.vertices.push(vertex(
            5,
            Point2::new(0.5, 0.9),
            CandidateVertexKind::InteriorJunction,
            CandidateVertexMovementPolicy::Movable,
            None,
        ));
        input
            .selected_spans
            .push(span(8, 4, 5, AssignmentLabel::Unknown, 8, &input.vertices));

        let topology = analyze_candidate_topology(&input);
        // Vertex 5 is the span's loose far end and is odd at degree 1 either
        // way; vertex 4 is the junction under test, odd only because the
        // undecided fifth fold counts.
        assert!(
            topology.combinatorial.odd_degree_vertices.contains(&4),
            "an undecided fold is still a fold, so five of them is odd degree, got {:?}",
            topology.combinatorial.odd_degree_vertices
        );
    }

    /// An auxiliary line crossing a crease is a guide drawn across the pattern,
    /// which is what guides are for — not a topology error the solve caused.
    #[test]
    fn an_auxiliary_span_crossing_a_crease_is_not_an_unmodeled_crossing() {
        let mut input = four_ray_input(Point2::new(0.5, 0.5));
        // Two loose vertices whose span cuts clean across one of the four rays,
        // sharing no vertex with it.
        for (id, point) in [(5, Point2::new(0.1, 0.4)), (6, Point2::new(0.4, 0.1))] {
            input.vertices.push(vertex(
                id,
                point,
                CandidateVertexKind::InteriorJunction,
                CandidateVertexMovementPolicy::Movable,
                None,
            ));
        }
        let crossing = span(8, 5, 6, AssignmentLabel::Flat, 8, &input.vertices);
        input.selected_spans.push(crossing);

        let topology = analyze_candidate_topology(&input);
        assert!(
            topology.combinatorial.unmodeled_crossings.is_empty(),
            "an auxiliary crossing is not a modelling failure, got {:?}",
            topology.combinatorial.unmodeled_crossings
        );
    }

    fn assert_analytic_jacobian_matches_finite_difference(input: &ExactSolveInput) {
        let model = test_model(input, ExactSolveOptions::default());
        let params = model.initial_params.clone();
        let analytic = model.analytic_jacobian(&params);
        let finite_difference = central_finite_difference_jacobian(&model, &params);
        assert_eq!(analytic.shape(), finite_difference.shape());
        for row in 0..analytic.nrows() {
            for column in 0..analytic.ncols() {
                let left = analytic[(row, column)];
                let right = finite_difference[(row, column)];
                let tolerance = 2e-4_f64.max(right.abs() * 2e-5).max(left.abs() * 2e-5);
                assert!(
                    (left - right).abs() <= tolerance,
                    "jacobian mismatch at row {row}, col {column}: analytic={left}, finite_difference={right}, tolerance={tolerance}"
                );
            }
        }
    }

    #[test]
    fn exact_solve_timeout_returns_failed_graph() {
        let input = four_ray_input(Point2::new(0.53, 0.50));
        let solved = solve_exact(
            &input,
            ExactSolveOptions {
                timeout_seconds: 0.0,
                ..ExactSolveOptions::default()
            },
        );
        assert_eq!(solved.status, ExactSolvedGraphStatus::Failed);
        assert_eq!(solved.vertices_exact[4], Point2::new(0.53, 0.50));
        assert_eq!(solved.movement_report["timed_out"], true);
        assert_eq!(solved.movement_report["accepted"], false);
        assert!(
            solved.movement_report["termination"]
                .as_str()
                .unwrap()
                .contains("timeout")
        );
        assert!(
            solved.movement_report["rejection_reasons"][0]
                .as_str()
                .unwrap()
                .contains("timed out")
        );
    }

    fn test_model(input: &ExactSolveInput, options: ExactSolveOptions) -> SolveModel {
        SolveModel::new(
            input,
            options,
            ExactSolveDeadline::start(-1.0),
            Rc::new(BTreeSet::new()),
        )
    }

    fn central_finite_difference_jacobian(
        model: &SolveModel,
        params: &OVector<f64, Dyn>,
    ) -> OMatrix<f64, Dyn, Dyn> {
        let base = model.residuals_for(params);
        let rows = base.len();
        let cols = params.len();
        let mut matrix = OMatrix::<f64, Dyn, Dyn>::zeros(rows, cols);
        for column in 0..cols {
            let step = model.options.finite_difference_epsilon * params[column].abs().max(1.0);
            let mut plus_params = params.clone();
            let mut minus_params = params.clone();
            plus_params[column] += step;
            minus_params[column] -= step;
            let plus = model.residuals_for(&plus_params);
            let minus = model.residuals_for(&minus_params);
            for row in 0..rows {
                matrix[(row, column)] = (plus[row] - minus[row]) / (2.0 * step);
            }
        }
        matrix
    }

    fn base_square_input() -> ExactSolveInput {
        let vertices = vec![
            vertex(
                0,
                Point2::new(0.0, 0.0),
                CandidateVertexKind::Corner,
                CandidateVertexMovementPolicy::Locked,
                Some(BoundarySide::Top),
            ),
            vertex(
                1,
                Point2::new(1.0, 0.0),
                CandidateVertexKind::Corner,
                CandidateVertexMovementPolicy::Locked,
                Some(BoundarySide::Right),
            ),
            vertex(
                2,
                Point2::new(1.0, 1.0),
                CandidateVertexKind::Corner,
                CandidateVertexMovementPolicy::Locked,
                Some(BoundarySide::Bottom),
            ),
            vertex(
                3,
                Point2::new(0.0, 1.0),
                CandidateVertexKind::Corner,
                CandidateVertexMovementPolicy::Locked,
                Some(BoundarySide::Left),
            ),
        ];
        let mut input = ExactSolveInput {
            schema: "test".to_owned(),
            coordinate_space: "fold_normalized".to_owned(),
            image_size: Some(128),
            vertices,
            selected_spans: Vec::new(),
            boundary: BoundaryModel {
                corners: [0, 1, 2, 3],
                sides: vec![
                    BoundarySideModel {
                        side: BoundarySide::Top,
                        corner_vertices: [0, 1],
                        contact_vertices: vec![0, 1],
                    },
                    BoundarySideModel {
                        side: BoundarySide::Right,
                        corner_vertices: [1, 2],
                        contact_vertices: vec![1, 2],
                    },
                    BoundarySideModel {
                        side: BoundarySide::Bottom,
                        corner_vertices: [3, 2],
                        contact_vertices: vec![3, 2],
                    },
                    BoundarySideModel {
                        side: BoundarySide::Left,
                        corner_vertices: [0, 3],
                        contact_vertices: vec![0, 3],
                    },
                ],
                generated_border_span_ids: vec![0, 1, 2, 3],
                reconstruction_policy: BoundaryReconstructionPolicy::LockedUnitSquareSortedContacts,
            },
            cost_model: CostModel::default(),
            provenance: CandidateGraphProvenance {
                source_adapter: CandidateSourceAdapter::Legacy,
                source_ids: vec!["test".to_owned()],
                notes: Vec::new(),
            },
        };
        for (id, a, b) in [(0, 0, 1), (1, 1, 2), (2, 3, 2), (3, 0, 3)] {
            input.selected_spans.push(span(
                id,
                a,
                b,
                AssignmentLabel::Boundary,
                id,
                &input.vertices,
            ));
        }
        input
    }

    fn vertex(
        id: usize,
        point: Point2,
        kind: CandidateVertexKind,
        movement_policy: CandidateVertexMovementPolicy,
        boundary_side: Option<BoundarySide>,
    ) -> CandidateVertex {
        CandidateVertex {
            id,
            point,
            kind,
            support: 1.0,
            movement_policy,
            boundary_side,
            source_vertex_ids: vec![id],
            source_carrier_ids: Vec::new(),
            source_adapter: CandidateSourceAdapter::Legacy,
            provenance: vec![Provenance::LegacyDecoder],
        }
    }

    fn span(
        id: usize,
        a: usize,
        b: usize,
        label: AssignmentLabel,
        source_carrier_id: usize,
        vertices: &[CandidateVertex],
    ) -> CandidateCreaseSpan {
        let p0 = vertices[a].point;
        let p1 = vertices[b].point;
        let dx = p1.x - p0.x;
        let dy = p1.y - p0.y;
        let length = (dx * dx + dy * dy).sqrt().max(1e-12);
        let normal = Point2::new(-dy / length, dx / length);
        let rho = normal.x * p0.x + normal.y * p0.y;
        span_with_carrier(id, a, b, label, source_carrier_id, normal, rho, vertices)
    }

    #[allow(clippy::too_many_arguments)]
    fn span_with_carrier(
        id: usize,
        a: usize,
        b: usize,
        label: AssignmentLabel,
        source_carrier_id: usize,
        normal: Point2,
        rho: f64,
        _vertices: &[CandidateVertex],
    ) -> CandidateCreaseSpan {
        let kind = if label == AssignmentLabel::Boundary {
            CandidateCreaseSpanKind::BorderSpan
        } else {
            CandidateCreaseSpanKind::AtomicInterval
        };
        CandidateCreaseSpan {
            id,
            kind,
            vertices: [a, b],
            carrier: CandidateCarrierGeometry {
                normal,
                direction: Point2::new(normal.y, -normal.x),
                rho,
            },
            t_interval: [0.0, 1.0],
            assignment_evidence: AssignmentEvidence::from_candidate(
                AssignmentCandidate {
                    label,
                    confidence: 0.95,
                    margin: 0.75,
                },
                AssignmentEvidenceSource::LegacyColor,
            ),
            presence_probability: 0.95,
            line_support_min: 0.95,
            line_support_mean: 0.95,
            line_support_max: 0.95,
            style_support: 0.0,
            non_crease_support: 0.0,
            source_kind: if label == AssignmentLabel::Boundary {
                CandidateCreaseSourceKind::BorderGenerated
            } else {
                CandidateCreaseSourceKind::LegacySelected
            },
            selection_policy: if label == AssignmentLabel::Boundary {
                CandidateSelectionPolicy::Locked
            } else {
                CandidateSelectionPolicy::StrongOptional
            },
            boundary_role: if label == AssignmentLabel::Boundary {
                CandidateCreaseBoundaryRole::PaperBoundary
            } else {
                CandidateCreaseBoundaryRole::None
            },
            source_edge_ids: vec![id],
            source_atomic_edge_ids: vec![id],
            source_carrier_ids: vec![source_carrier_id],
            replaced_span_ids: Vec::new(),
            replaced_atomic_edge_ids: Vec::new(),
            collapsed_vertex_ids: Vec::new(),
            provenance: vec![Provenance::LegacyDecoder],
            reasons: Vec::new(),
        }
    }
}

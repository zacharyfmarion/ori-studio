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
            solved_kawasaki_epsilon_degrees: 1e-3,
            solved_carrier_epsilon: 5e-4,
            degenerate_edge_epsilon: 1e-6,
            crossing_epsilon: 1e-7,
            timeout_seconds: default_timeout_seconds(),
            linear_solver: LinearSolver::Sparse,
            polish: default_polish(),
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
    solve_exact_inner(input, options, Rc::new(BTreeSet::new()))
}

/// [`solve_exact`] with a per-vertex movement-budget exemption set; see
/// [`ExactSolveOptionsWithExemptions`]. With an empty exemption set this is
/// [`solve_exact`].
pub fn solve_exact_with_exemptions(
    input: &ExactSolveInput,
    options: &ExactSolveOptionsWithExemptions,
) -> ExactSolvedGraph {
    solve_exact_inner(
        input,
        options.options,
        Rc::new(options.exempt_vertex_ids.clone()),
    )
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
    let (final_params, termination, evaluations, objective, polish_adopted) = 'polish: {
        if !options.polish {
            polish_outcome.stop_reason = "disabled";
            break 'polish (final_params, termination, evaluations, objective, false);
        }
        if final_params.is_empty() {
            polish_outcome.stop_reason = "no_parameters";
            break 'polish (final_params, termination, evaluations, objective, false);
        }
        if model.timeout_reached() {
            polish_outcome.stop_reason = "timed_out";
            break 'polish (final_params, termination, evaluations, objective, false);
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
            break 'polish (final_params, termination, evaluations, objective, false);
        }
        let mut current_params = final_params.clone();
        let mut current_kawasaki = stage1_after.max_kawasaki_residual_degrees;
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
            polish_evaluations += polish_round_evaluations;
            rounds_adopted += 1;
            polish_outcome.rounds_adopted = rounds_adopted;
            polish_outcome.kawasaki_after_degrees = Some(current_kawasaki);
        }
        if rounds_adopted == 0 {
            break 'polish (final_params, termination, evaluations, objective, false);
        }
        let polished_objective = residual_energy(&model.residuals_for(&current_params));
        (
            current_params,
            format!("{termination}+polish(rounds={rounds_adopted})"),
            evaluations + polish_evaluations,
            polished_objective,
            true,
        )
    };

    let candidate_points = model.points_from_params(&final_params);
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
        movement_report,
        theorem_residual_report,
        status,
    }
}

#[derive(Debug, Clone)]
struct SolveModel {
    vertex_params: Vec<VertexParameterization>,
    carrier_groups: Vec<CarrierGroup>,
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
        self.vertex_params
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
            .collect()
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

        for residual in kawasaki_residuals(&points, &self.vertices, &self.selected_spans) {
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
        let kawasaki_entries =
            kawasaki_residual_entries(&points, &self.vertices, &self.selected_spans);
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

        for entry in kawasaki_entries {
            for (index, ray) in entry.rays.iter().enumerate() {
                let angle_weight = if index % 2 == 0 { -2.0 } else { 2.0 };
                let scale = angle_weight / self.options.kawasaki_sigma_radians;
                self.add_angle_derivative(
                    add,
                    row,
                    entry.vertex_id,
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
            .map(|group| 2 + group.span_indices.len() * 2)
            .sum::<usize>();
        vertex_residuals + carrier_residuals + kawasaki_residual_count
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
        let kawasaki_entries =
            kawasaki_residual_entries(&points, &self.vertices, &self.selected_spans);

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
    for span in &input.selected_spans {
        if !is_fold_span(span) {
            continue;
        }
        let [a, b] = span.vertices;
        if a >= points.len() || b >= points.len() {
            continue;
        }
        incident[a].push(IncidentRay {
            target_vertex_id: b,
            angle: angle_radians(points[a], points[b]),
            assignment: span.assignment_label(),
        });
        incident[b].push(IncidentRay {
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

    GraphAnalysis {
        eligible_vertices,
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
        degenerate_edges: degenerate_edges(input, points, options),
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
    let blockers = topology_analysis_blockers(input);
    if !blockers.is_empty() {
        return TopologyDiagnostics {
            schema: TOPOLOGY_DIAGNOSTICS_SCHEMA.to_owned(),
            blockers,
            ..TopologyDiagnostics::default()
        };
    }
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
    target_vertex_id: usize,
    angle: f64,
    assignment: AssignmentLabel,
}

#[derive(Debug, Clone)]
struct KawasakiResidualEntry {
    vertex_id: usize,
    rays: Vec<IncidentRay>,
}

fn kawasaki_residuals(
    points: &[Point2],
    vertices: &[CandidateVertex],
    spans: &[CandidateCreaseSpan],
) -> Vec<f64> {
    kawasaki_residual_entries(points, vertices, spans)
        .iter()
        .map(|entry| signed_kawasaki_residual_radians(&entry.rays))
        .collect()
}

fn kawasaki_residual_entries(
    points: &[Point2],
    vertices: &[CandidateVertex],
    spans: &[CandidateCreaseSpan],
) -> Vec<KawasakiResidualEntry> {
    let mut incident = vec![Vec::<IncidentRay>::new(); vertices.len()];
    let boundary_vertices = boundary_vertex_ids(spans);
    for span in spans {
        // The same fan the analysis builds, and it has to be: this one is what
        // the optimizer minimizes, and a residual over a different set of rays
        // than the report describes is two answers to one question.
        if !is_fold_span(span) {
            continue;
        }
        let [a, b] = span.vertices;
        if a >= points.len() || b >= points.len() {
            continue;
        }
        incident[a].push(IncidentRay {
            target_vertex_id: b,
            angle: angle_radians(points[a], points[b]),
            assignment: span.assignment_label(),
        });
        incident[b].push(IncidentRay {
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
                Some(KawasakiResidualEntry {
                    vertex_id: vertex.id,
                    rays,
                })
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
    let topology_clean = after.odd_degree_vertices.is_empty();
    if topology_clean
        && after.max_kawasaki_residual_degrees <= options.solved_kawasaki_epsilon_degrees
        && after.max_carrier_residual <= options.solved_carrier_epsilon
    {
        return ExactSolvedGraphStatus::Solved;
    }
    if after.odd_degree_vertices.len() <= before.odd_degree_vertices.len()
        && (after.max_kawasaki_residual_degrees < before.max_kawasaki_residual_degrees
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
    if candidate_status != ExactSolvedGraphStatus::Solved
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
    json!({
        "schema": "oristudio/cp-compiler/exact-solve-movement-report-v1",
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
        let input = four_ray_input(Point2::new(0.5, 0.5));
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
    fn polish_report_records_adopted_rounds() {
        let input = four_ray_input(Point2::new(0.505, 0.50));
        let solved = solve_exact(&input, ExactSolveOptions::default());
        let polish = &solved.movement_report["polish"];
        assert!(polish["enabled"].as_bool().unwrap());
        assert!(polish["ran"].as_bool().unwrap());
        assert!(
            polish["rounds_adopted"].as_u64().unwrap() > 0,
            "an adopted polish must report its round count, got {polish}"
        );
        assert!(polish["refused_round"].is_null());
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

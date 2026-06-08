//! Full exact geometric solve for selected crease-pattern topology.
//!
//! This stage treats the selected graph as topology and solves for nearby
//! coordinates that better satisfy geometric/origami constraints. It does not
//! add or remove creases; topology selection belongs to the previous phase.

use crate::candidate_graph::{CandidateCreaseBoundaryRole, CandidateVertex};
use crate::{
    AssignmentLabel, BoundaryModel, BoundarySide, CandidateCreaseSpan, CandidateCreaseSpanKind,
    CandidateGraphProvenance, CandidateSourceAdapter, CandidateVertexKind,
    CandidateVertexMovementPolicy, CostModel, ExactSolveInput, ExactSolvedGraph,
    ExactSolvedGraphStatus, Point2,
};
use levenberg_marquardt::{LeastSquaresProblem, LevenbergMarquardt};
use nalgebra::{Dyn, OMatrix, OVector, storage::Owned};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::cell::Cell;
use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;

const SCHEMA: &str = "oristudio/cp-compiler/exact-solved-graph-v1";
const TAU: f64 = std::f64::consts::TAU;

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
}

impl Default for ExactSolveOptions {
    fn default() -> Self {
        Self {
            patience: 40,
            ftol: 1e-10,
            xtol: 1e-10,
            gtol: 1e-10,
            finite_difference_epsilon: 1e-6,
            movement_sigma: 0.012,
            boundary_movement_sigma: 0.004,
            carrier_angle_sigma_radians: 2.0_f64.to_radians(),
            carrier_rho_sigma: 0.010,
            carrier_incidence_sigma: 0.0008,
            kawasaki_sigma_radians: 0.10_f64.to_radians(),
            max_vertex_movement: 0.050,
            solved_kawasaki_epsilon_degrees: 1e-3,
            solved_carrier_epsilon: 5e-4,
            degenerate_edge_epsilon: 1e-6,
            crossing_epsilon: 1e-7,
        }
    }
}

pub fn solve_exact(input: &ExactSolveInput, options: ExactSolveOptions) -> ExactSolvedGraph {
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

    let model = SolveModel::new(input, options);
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
    } else {
        if initial_residuals.is_empty() {
            (
                initial_params.clone(),
                "no_residuals".to_owned(),
                0usize,
                initial_objective,
                SolveCounterSnapshot::default(),
            )
        } else {
            let counters = Rc::new(SolveCounters::default());
            let solver = ExactLeastSquaresProblem {
                model: model.clone(),
                params: initial_params.clone(),
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
    };

    let candidate_points = model.points_from_params(&final_params);
    let candidate_after = analyze_graph(input, &candidate_points, &model, &final_params, options);
    let candidate_status = classify_status(&before, &candidate_after, options);
    let rejection_reasons = exact_solution_rejection_reasons(
        &before,
        &candidate_after,
        candidate_status,
        initial_objective,
        objective,
        options,
    );
    let accepted = rejection_reasons.is_empty();
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
    let (_, candidate_breakdown) = model.residuals_with_breakdown(&final_params);
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
    provenance: CandidateGraphProvenance,
}

impl SolveModel {
    fn new(input: &ExactSolveInput, options: ExactSolveOptions) -> Self {
        let mut params = Vec::new();
        let corner_points = corner_points(&input.boundary);
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
            if let Some(side) = vertex.boundary_side {
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
            provenance: input.provenance.clone(),
        }
    }

    fn points_from_params(&self, params: &OVector<f64, Dyn>) -> Vec<Point2> {
        self.vertex_params
            .iter()
            .map(|param| match *param {
                VertexParameterization::Fixed { point } => point,
                VertexParameterization::Boundary { index, side } => side_point(side, params[index]),
                VertexParameterization::Free { x_index, y_index } => Point2::new(
                    params[x_index].clamp(-0.25, 1.25),
                    params[y_index].clamp(-0.25, 1.25),
                ),
            })
            .collect()
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
                    matrix[(row, index)] = weight / self.options.boundary_movement_sigma;
                    row += 1;
                }
                VertexParameterization::Free { x_index, y_index } => {
                    let sigma = movement_sigma(&self.cost_model, self.options, vertex.support);
                    let weight = movement_weight(vertex.support, source_weight);
                    matrix[(row, x_index)] = weight / sigma;
                    row += 1;
                    matrix[(row, y_index)] = weight / sigma;
                    row += 1;
                }
            }
        }

        for group in &self.carrier_groups {
            let theta = params[group.theta_index];
            let normal = Point2::new(theta.cos(), theta.sin());
            matrix[(row, group.theta_index)] = 1.0 / self.options.carrier_angle_sigma_radians;
            row += 1;
            matrix[(row, group.rho_index)] = 1.0 / self.options.carrier_rho_sigma;
            row += 1;

            for span_index in &group.span_indices {
                let span = &self.selected_spans[*span_index];
                for vertex_id in span.vertices {
                    let point = points[vertex_id];
                    let scale = 1.0 / self.options.carrier_incidence_sigma;
                    matrix[(row, group.theta_index)] +=
                        (-theta.sin() * point.x + theta.cos() * point.y) * scale;
                    matrix[(row, group.rho_index)] -= scale;
                    self.add_point_derivative(
                        &mut matrix,
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

        for entry in &kawasaki_entries {
            for (index, ray) in entry.rays.iter().enumerate() {
                let angle_weight = if index % 2 == 0 { -2.0 } else { 2.0 };
                let scale = angle_weight / self.options.kawasaki_sigma_radians;
                self.add_angle_derivative(
                    &mut matrix,
                    row,
                    entry.vertex_id,
                    ray.target_vertex_id,
                    scale,
                    &points,
                    params,
                );
            }
            row += 1;
        }

        matrix
    }

    fn analytic_residual_count(&self, kawasaki_residual_count: usize) -> usize {
        let vertex_residuals = self
            .vertex_params
            .iter()
            .map(|param| match param {
                VertexParameterization::Fixed { .. } => 0,
                VertexParameterization::Boundary { .. } => 1,
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

    fn add_angle_derivative(
        &self,
        matrix: &mut OMatrix<f64, Dyn, Dyn>,
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
            matrix,
            row,
            origin_id,
            scale * dy / radius_squared,
            scale * -dx / radius_squared,
            params,
        );
        self.add_point_derivative(
            matrix,
            row,
            target_id,
            scale * -dy / radius_squared,
            scale * dx / radius_squared,
            params,
        );
    }

    fn add_point_derivative(
        &self,
        matrix: &mut OMatrix<f64, Dyn, Dyn>,
        row: usize,
        vertex_id: usize,
        dx: f64,
        dy: f64,
        params: &OVector<f64, Dyn>,
    ) {
        match self.vertex_params[vertex_id] {
            VertexParameterization::Fixed { .. } => {}
            VertexParameterization::Boundary { index, side } => {
                matrix[(row, index)] += match side {
                    BoundarySide::Top | BoundarySide::Bottom => dx,
                    BoundarySide::Right | BoundarySide::Left => dy,
                };
            }
            VertexParameterization::Free { x_index, y_index } => {
                if params[x_index] > -0.25 && params[x_index] < 1.25 {
                    matrix[(row, x_index)] += dx;
                }
                if params[y_index] > -0.25 && params[y_index] < 1.25 {
                    matrix[(row, y_index)] += dy;
                }
            }
        }
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
    Fixed { point: Point2 },
    Boundary { index: usize, side: BoundarySide },
    Free { x_index: usize, y_index: usize },
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
        if is_boundary_like_span(span) {
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
        let kawasaki = if degree >= 4 && degree % 2 == 0 {
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
        mean_vertex_movement,
        degenerate_edges: degenerate_edges(input, points, options),
        unmodeled_crossings: unmodeled_crossings(input, points, options),
        boundary_failures: boundary_failures(input, points),
    }
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
        if is_boundary_like_span(span) {
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
            if rays.len() >= 4 && rays.len() % 2 == 0 {
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
        || after.max_vertex_movement > options.max_vertex_movement
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
    if after.max_vertex_movement > options.max_vertex_movement {
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
        .filter(|param| matches!(param, VertexParameterization::Boundary { .. }))
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
        if is_boundary_like_span(left) {
            continue;
        }
        for right in input.selected_spans.iter().skip(left_index + 1) {
            if is_boundary_like_span(right) {
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
    input
        .vertices
        .iter()
        .filter_map(|vertex| {
            let point = points[vertex.id];
            let failed = if input.boundary.corners.contains(&vertex.id) {
                false
            } else if vertex.boundary_side.is_some() {
                side_coord(vertex.boundary_side.unwrap(), point) < -1e-6
                    || side_coord(vertex.boundary_side.unwrap(), point) > 1.0 + 1e-6
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
        let before_model = SolveModel::new(&input, ExactSolveOptions::default());
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

        let before_model = SolveModel::new(&input, ExactSolveOptions::default());
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

    fn four_ray_input(center: Point2) -> ExactSolveInput {
        let mut input = base_square_input();
        input.vertices.push(vertex(
            4,
            center,
            CandidateVertexKind::InteriorJunction,
            CandidateVertexMovementPolicy::Movable,
            None,
        ));
        for (id, corner, label) in [
            (4, 0, AssignmentLabel::Mountain),
            (5, 1, AssignmentLabel::Valley),
            (6, 2, AssignmentLabel::Mountain),
            (7, 3, AssignmentLabel::Valley),
        ] {
            input
                .selected_spans
                .push(span(id, 4, corner, label, id, &input.vertices));
        }
        input
    }

    fn assert_analytic_jacobian_matches_finite_difference(input: &ExactSolveInput) {
        let model = SolveModel::new(input, ExactSolveOptions::default());
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

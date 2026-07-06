//! Source-neutral candidate graph IR for the V2 compiler.
//!
//! Phase 6 makes candidate production explicit: legacy-selected graph proposals
//! and compiler-native arrangement proposals both become `CandidateGraph`
//! instances before selection. Downstream stages should consume this IR instead
//! of branching on where a candidate came from.

use crate::arrangement_v2::{
    ArrangementBoundarySide, ArrangementCarrierKind, ArrangementVertexKind, CandidateArrangement,
};
use crate::candidates::{CandidateCarrier as LegacyCarrier, CarrierFamily};
use crate::{
    AssignmentCandidate, AssignmentLabel, CandidateProgram, EdgeSelection, Point2, Provenance,
    VertexKind,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

const SCHEMA: &str = "oristudio/cp-compiler/candidate-graph-v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CandidateSourceAdapter {
    Legacy,
    LegacyLowThreshold,
    ArrangementV2,
    RepairCandidate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CandidateVertexKind {
    Corner,
    BoundaryContact,
    InteriorJunction,
    LineEndpoint,
    CandidateIntersection,
    JunctionCluster,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CandidateVertexMovementPolicy {
    Locked,
    BoundaryOnly,
    Movable,
    MergeCandidate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BoundarySide {
    Top,
    Right,
    Bottom,
    Left,
}

impl BoundarySide {
    pub const fn all() -> [Self; 4] {
        [Self::Top, Self::Right, Self::Bottom, Self::Left]
    }

    fn sort_key(self, point: Point2) -> f64 {
        match self {
            Self::Top | Self::Bottom => point.x,
            Self::Right | Self::Left => point.y,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CandidateVertex {
    pub id: usize,
    pub point: Point2,
    pub kind: CandidateVertexKind,
    pub support: f64,
    pub movement_policy: CandidateVertexMovementPolicy,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub boundary_side: Option<BoundarySide>,
    #[serde(default)]
    pub source_vertex_ids: Vec<usize>,
    #[serde(default)]
    pub source_carrier_ids: Vec<usize>,
    pub source_adapter: CandidateSourceAdapter,
    #[serde(default)]
    pub provenance: Vec<Provenance>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CandidateCarrierGeometry {
    pub normal: Point2,
    pub direction: Point2,
    pub rho: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct AssignmentEvidence {
    pub mountain: f64,
    pub valley: f64,
    pub boundary: f64,
    pub auxiliary: f64,
    pub unknown: f64,
    pub observed_label: AssignmentLabel,
    pub source: AssignmentEvidenceSource,
    pub confidence: f64,
    pub margin: f64,
    /// Assignment label re-derived with ink-weighted sampling (assignment-head
    /// samples weighted by per-pixel line probability, so background pixels
    /// cannot dilute the channel means). Kept SEPARATE from `observed_label`
    /// so selection scoring and local-theorem residuals are untouched; a
    /// post-selection pass may promote it over an Unknown `observed_label`
    /// for the final output.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ink_label: Option<AssignmentLabel>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssignmentEvidenceSource {
    LegacyColor,
    ModelAssignmentHead,
    SpanAggregate,
    Inferred,
    Unknown,
}

impl AssignmentEvidence {
    pub fn from_candidate(
        candidate: AssignmentCandidate,
        source: AssignmentEvidenceSource,
    ) -> Self {
        let confidence = candidate.confidence.clamp(0.0, 1.0);
        let weak = ((1.0 - confidence) / 4.0).max(0.01);
        let mut evidence = Self {
            mountain: weak,
            valley: weak,
            boundary: weak,
            auxiliary: weak,
            unknown: (1.0 - confidence).max(0.05),
            observed_label: candidate.label,
            source,
            confidence,
            margin: candidate.margin.clamp(0.0, 1.0),
            ink_label: None,
        };
        match candidate.label {
            AssignmentLabel::Mountain => evidence.mountain = confidence.max(0.01),
            AssignmentLabel::Valley => evidence.valley = confidence.max(0.01),
            AssignmentLabel::Boundary => evidence.boundary = confidence.max(0.01),
            AssignmentLabel::Flat => evidence.auxiliary = confidence.max(0.01),
            AssignmentLabel::Unknown => evidence.unknown = confidence.max(0.50),
        }
        evidence
    }

    pub fn probability(self, label: AssignmentLabel) -> f64 {
        match label {
            AssignmentLabel::Mountain => self.mountain,
            AssignmentLabel::Valley => self.valley,
            AssignmentLabel::Boundary => self.boundary,
            AssignmentLabel::Flat => self.auxiliary,
            AssignmentLabel::Unknown => self.unknown,
        }
    }

    pub fn cost(self, label: AssignmentLabel, cost_model: &CostModel) -> f64 {
        cost_model.probability_cost(self.probability(label))
    }

    pub fn to_assignment_candidate(self) -> AssignmentCandidate {
        AssignmentCandidate {
            label: self.observed_label,
            confidence: self.confidence,
            margin: self.margin,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CandidateCreaseSourceKind {
    LegacySelected,
    LegacyLowThreshold,
    ArrangementObserved,
    ArrangementShared,
    RepairCandidate,
    BorderGenerated,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CandidateSelectionPolicy {
    Locked,
    StrongOptional,
    Optional,
    WeakOptional,
    Discouraged,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CandidateCreaseSpanKind {
    AtomicInterval,
    ObservedCarrierSpan,
    NormalizedPassThroughSpan,
    SharedCarrierSpan,
    BorderSpan,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum CandidateCreaseBoundaryRole {
    #[default]
    None,
    PaperBoundary,
    CutBoundary,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CandidateCreaseSpan {
    pub id: usize,
    pub kind: CandidateCreaseSpanKind,
    pub vertices: [usize; 2],
    pub carrier: CandidateCarrierGeometry,
    pub t_interval: [f64; 2],
    pub assignment_evidence: AssignmentEvidence,
    pub presence_probability: f64,
    pub line_support_min: f64,
    pub line_support_mean: f64,
    pub line_support_max: f64,
    pub style_support: f64,
    pub non_crease_support: f64,
    pub source_kind: CandidateCreaseSourceKind,
    pub selection_policy: CandidateSelectionPolicy,
    #[serde(default)]
    pub boundary_role: CandidateCreaseBoundaryRole,
    #[serde(default)]
    pub source_edge_ids: Vec<usize>,
    #[serde(default)]
    pub source_atomic_edge_ids: Vec<usize>,
    #[serde(default)]
    pub source_carrier_ids: Vec<usize>,
    #[serde(default)]
    pub replaced_span_ids: Vec<usize>,
    #[serde(default)]
    pub replaced_atomic_edge_ids: Vec<usize>,
    #[serde(default)]
    pub collapsed_vertex_ids: Vec<usize>,
    #[serde(default)]
    pub provenance: Vec<Provenance>,
    #[serde(default)]
    pub reasons: Vec<String>,
}

impl CandidateCreaseSpan {
    pub fn assignment_label(&self) -> AssignmentLabel {
        self.assignment_evidence.observed_label
    }

    pub fn boundary_role(&self) -> CandidateCreaseBoundaryRole {
        if self.boundary_role != CandidateCreaseBoundaryRole::None {
            return self.boundary_role;
        }
        if self.assignment_label() == AssignmentLabel::Boundary
            || self.kind == CandidateCreaseSpanKind::BorderSpan
        {
            CandidateCreaseBoundaryRole::PaperBoundary
        } else {
            CandidateCreaseBoundaryRole::None
        }
    }

    pub fn selection_score(&self, graph: &CandidateGraph) -> f64 {
        let cost_model = &graph.cost_model;
        let presence_cost = cost_model.probability_cost(self.presence_probability);
        let assignment_cost = self.selection_assignment_cost(graph);
        let source_cost = self.selection_source_cost(graph);
        let fragmentation_cost =
            self.collapsed_vertex_ids.len() as f64 * cost_model.fragmentation_cost_weight;
        let continuity_reward = if matches!(
            self.kind,
            CandidateCreaseSpanKind::ObservedCarrierSpan
                | CandidateCreaseSpanKind::NormalizedPassThroughSpan
                | CandidateCreaseSpanKind::SharedCarrierSpan
        ) {
            cost_model.continuity_reward
                * self
                    .replaced_span_ids
                    .len()
                    .max(self.replaced_atomic_edge_ids.len())
                    .max(self.collapsed_vertex_ids.len()) as f64
        } else {
            0.0
        };
        self.line_support_mean - presence_cost - assignment_cost - source_cost - fragmentation_cost
            + continuity_reward
    }

    pub fn selection_source_cost(&self, graph: &CandidateGraph) -> f64 {
        let base = graph.cost_model.source_prior_cost(self.source_kind);
        if self.source_kind == CandidateCreaseSourceKind::LegacyLowThreshold {
            base * (1.0 - self.line_support_mean.clamp(0.0, 1.0))
        } else {
            base
        }
    }

    pub fn selection_assignment_cost(&self, graph: &CandidateGraph) -> f64 {
        if self.assignment_evidence.observed_label == AssignmentLabel::Unknown {
            graph.cost_model.probability_cost(0.95)
        } else {
            self.assignment_evidence
                .cost(self.assignment_evidence.observed_label, &graph.cost_model)
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BoundaryModel {
    pub corners: [usize; 4],
    pub sides: Vec<BoundarySideModel>,
    #[serde(default)]
    pub generated_border_span_ids: Vec<usize>,
    pub reconstruction_policy: BoundaryReconstructionPolicy,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BoundarySideModel {
    pub side: BoundarySide,
    pub corner_vertices: [usize; 2],
    pub contact_vertices: Vec<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BoundaryReconstructionPolicy {
    LockedUnitSquareSortedContacts,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CandidateConflictKind {
    DuplicateSpan,
    SpanReplacesFragments,
    UnsupportedCrossing,
    NearbyVertexAlternative,
    SharedCarrierAlternative,
    BorderGeneratedReplacesDetected,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CandidateConflict {
    pub id: usize,
    pub kind: CandidateConflictKind,
    pub candidate_ids: Vec<usize>,
    pub hard: bool,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CostModel {
    pub probability_epsilon: f64,
    pub sigma_distance_px: f64,
    pub sigma_angle_degrees: f64,
    pub sigma_rho_px: f64,
    pub fragmentation_cost_weight: f64,
    pub continuity_reward: f64,
    pub legacy_selected_prior_cost: f64,
    pub legacy_low_threshold_prior_cost: f64,
    pub arrangement_observed_prior_cost: f64,
    pub arrangement_shared_prior_cost: f64,
    pub repair_candidate_prior_cost: f64,
    pub border_generated_prior_cost: f64,
}

impl Default for CostModel {
    fn default() -> Self {
        Self {
            probability_epsilon: 0.01,
            sigma_distance_px: 6.0,
            sigma_angle_degrees: 2.0,
            sigma_rho_px: 4.0,
            fragmentation_cost_weight: 0.08,
            continuity_reward: 0.42,
            legacy_selected_prior_cost: 0.02,
            legacy_low_threshold_prior_cost: 0.80,
            arrangement_observed_prior_cost: 0.18,
            arrangement_shared_prior_cost: 0.30,
            repair_candidate_prior_cost: 1.20,
            border_generated_prior_cost: -1.00,
        }
    }
}

impl CostModel {
    pub fn probability_cost(&self, probability: f64) -> f64 {
        -probability
            .clamp(self.probability_epsilon, 1.0 - self.probability_epsilon)
            .ln()
    }

    pub fn movement_cost(&self, distance_px: f64) -> f64 {
        (distance_px / self.sigma_distance_px.max(1e-9)).powi(2)
    }

    pub fn angle_cost(&self, angle_degrees: f64) -> f64 {
        (angle_degrees / self.sigma_angle_degrees.max(1e-9)).powi(2)
    }

    pub fn rho_cost(&self, rho_px: f64) -> f64 {
        (rho_px / self.sigma_rho_px.max(1e-9)).powi(2)
    }

    pub fn source_prior_cost(&self, source: CandidateCreaseSourceKind) -> f64 {
        match source {
            CandidateCreaseSourceKind::LegacySelected => self.legacy_selected_prior_cost,
            CandidateCreaseSourceKind::LegacyLowThreshold => self.legacy_low_threshold_prior_cost,
            CandidateCreaseSourceKind::ArrangementObserved => self.arrangement_observed_prior_cost,
            CandidateCreaseSourceKind::ArrangementShared => self.arrangement_shared_prior_cost,
            CandidateCreaseSourceKind::RepairCandidate => self.repair_candidate_prior_cost,
            CandidateCreaseSourceKind::BorderGenerated => self.border_generated_prior_cost,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CandidateGraphProvenance {
    pub source_adapter: CandidateSourceAdapter,
    #[serde(default)]
    pub source_ids: Vec<String>,
    #[serde(default)]
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CandidateGraphReport {
    pub vertices: usize,
    pub crease_candidates: usize,
    pub locked_border_spans: usize,
    pub legacy_selected_spans: usize,
    pub legacy_low_threshold_spans: usize,
    pub arrangement_observed_spans: usize,
    pub arrangement_shared_spans: usize,
    pub conflicts: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CandidateGraph {
    pub schema: String,
    pub coordinate_space: String,
    pub image_size: Option<u32>,
    pub vertices: Vec<CandidateVertex>,
    pub crease_candidates: Vec<CandidateCreaseSpan>,
    pub boundary: BoundaryModel,
    #[serde(default)]
    pub conflicts: Vec<CandidateConflict>,
    #[serde(default)]
    pub alternatives: Vec<CandidateConflict>,
    pub cost_model: CostModel,
    pub provenance: CandidateGraphProvenance,
    pub report: CandidateGraphReport,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LegacyCandidateAdapterOptions {
    pub selected_presence_probability: f64,
    pub weak_presence_probability: f64,
    pub rejected_presence_probability: f64,
    pub border_presence_probability: f64,
    pub duplicate_endpoint_tolerance: f64,
    pub weak_endpoint_snap_tolerance: f64,
    pub weak_boundary_endpoint_snap_tolerance: f64,
    pub weak_carrier_incidence_tolerance: f64,
    pub weak_span_split_tolerance: f64,
    pub weak_min_split_length: f64,
}

impl Default for LegacyCandidateAdapterOptions {
    fn default() -> Self {
        Self {
            selected_presence_probability: 0.94,
            weak_presence_probability: 0.45,
            rejected_presence_probability: 0.06,
            border_presence_probability: 0.99,
            duplicate_endpoint_tolerance: 1e-6,
            weak_endpoint_snap_tolerance: 0.012,
            weak_boundary_endpoint_snap_tolerance: 0.012,
            weak_carrier_incidence_tolerance: 0.006,
            weak_span_split_tolerance: 0.006,
            weak_min_split_length: 0.003,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ArrangementCandidateAdapterOptions {
    pub strong_presence_floor: f64,
    pub weak_presence_floor: f64,
}

impl Default for ArrangementCandidateAdapterOptions {
    fn default() -> Self {
        Self {
            strong_presence_floor: 0.52,
            weak_presence_floor: 0.22,
        }
    }
}

pub struct LegacyCandidateAdapter;

impl LegacyCandidateAdapter {
    pub fn from_program(program: &CandidateProgram) -> CandidateGraph {
        Self::from_programs(program, None, LegacyCandidateAdapterOptions::default())
    }

    pub fn from_programs(
        selected_program: &CandidateProgram,
        low_threshold_program: Option<&CandidateProgram>,
        options: LegacyCandidateAdapterOptions,
    ) -> CandidateGraph {
        let normalization = LegacyUnitSquareNormalization::from_program(selected_program);
        let selected_program = normalize_legacy_program(selected_program, normalization);
        let low_threshold_program =
            low_threshold_program.map(|program| normalize_legacy_program(program, normalization));
        let mut vertices = selected_program
            .vertices
            .iter()
            .map(|vertex| legacy_vertex(vertex, CandidateSourceAdapter::Legacy))
            .collect::<Vec<_>>();
        let corners = ensure_unit_square_corners(&mut vertices, CandidateSourceAdapter::Legacy);
        let mut spans = selected_program
            .edges
            .iter()
            .filter_map(|edge| {
                let carrier = selected_program.carriers.get(edge.carrier_id)?;
                Some(legacy_span(
                    edge,
                    carrier,
                    CandidateCreaseSourceKind::LegacySelected,
                    CandidateSourceAdapter::Legacy,
                    &options,
                ))
            })
            .collect::<Vec<_>>();

        if let Some(weak_program) = low_threshold_program.as_ref() {
            let mut existing_keys = spans
                .iter()
                .map(|span| {
                    span_endpoint_key(
                        &vertices,
                        span.vertices,
                        options.duplicate_endpoint_tolerance,
                    )
                })
                .collect::<BTreeSet<_>>();
            for edge in &weak_program.edges {
                if edge.assignment.label == AssignmentLabel::Boundary {
                    continue;
                }
                let Some(carrier) = weak_program.carriers.get(edge.carrier_id) else {
                    continue;
                };
                let Some(vertices_pair_reasons) =
                    map_weak_vertices(&mut vertices, weak_program, edge, carrier, &options)
                else {
                    continue;
                };
                let split_vertices = weak_span_vertex_sequence(
                    &vertices,
                    vertices_pair_reasons.vertices,
                    carrier,
                    &options,
                );
                let was_split = split_vertices.len() > 2;
                for pair in split_vertices.windows(2) {
                    let vertices_pair = [pair[0], pair[1]];
                    if span_length(&vertices, vertices_pair) <= options.weak_min_split_length {
                        continue;
                    }
                    let key = span_endpoint_key(
                        &vertices,
                        vertices_pair,
                        options.duplicate_endpoint_tolerance,
                    );
                    if existing_keys.contains(&key)
                        || span_has_near_duplicate(
                            &vertices,
                            &spans,
                            vertices_pair,
                            options.duplicate_endpoint_tolerance,
                        )
                    {
                        continue;
                    }
                    let mut span = legacy_span_with_vertices(
                        edge,
                        carrier,
                        vertices_pair,
                        CandidateCreaseSourceKind::LegacyLowThreshold,
                        CandidateSourceAdapter::LegacyLowThreshold,
                        &options,
                    );
                    span.id = spans.len();
                    span.t_interval = span_interval_for_vertices(&vertices, vertices_pair, carrier);
                    span.reasons
                        .push("optional lower-threshold legacy candidate".to_owned());
                    span.reasons.extend(vertices_pair_reasons.reasons.clone());
                    if was_split {
                        span.reasons
                            .push("split weak span at canonical strong junction".to_owned());
                    }
                    existing_keys.insert(key);
                    spans.push(span);
                }
            }
        }

        let corners = prune_unreferenced_low_threshold_vertices(&mut vertices, &mut spans, corners);
        assign_span_ids(&mut spans);
        let mut graph = CandidateGraph {
            schema: SCHEMA.to_owned(),
            coordinate_space: selected_program.coordinate_space.clone(),
            image_size: selected_program.image_size,
            boundary: boundary_model_from_vertices(&vertices, corners, &spans),
            vertices,
            crease_candidates: spans,
            conflicts: Vec::new(),
            alternatives: Vec::new(),
            cost_model: CostModel::default(),
            provenance: CandidateGraphProvenance {
                source_adapter: CandidateSourceAdapter::Legacy,
                source_ids: Vec::new(),
                notes: vec![
                    "legacy-selected graph converted into source-neutral CandidateGraph".to_owned(),
                ],
            },
            report: CandidateGraphReport::empty(),
        };
        graph.conflicts = generate_conflicts(&graph);
        graph.alternatives = graph.conflicts.clone();
        graph.report = CandidateGraphReport::from_graph(&graph);
        graph
    }
}

#[derive(Debug, Clone, Copy)]
struct LegacyUnitSquareNormalization {
    x_min: f64,
    y_min: f64,
    width: f64,
    height: f64,
}

impl LegacyUnitSquareNormalization {
    fn identity() -> Self {
        Self {
            x_min: 0.0,
            y_min: 0.0,
            width: 1.0,
            height: 1.0,
        }
    }

    fn from_program(program: &CandidateProgram) -> Self {
        let mut points = Vec::new();
        for edge in &program.edges {
            if edge.assignment.label != AssignmentLabel::Boundary {
                continue;
            }
            for vertex_id in edge.vertices {
                if let Some(vertex) = program.vertices.get(vertex_id) {
                    points.push(vertex.position);
                }
            }
        }
        if points.len() < 2 {
            points.extend(program.vertices.iter().map(|vertex| vertex.position));
        }
        if points.len() < 2 {
            return Self::identity();
        }
        let x_min = points
            .iter()
            .map(|point| point.x)
            .fold(f64::INFINITY, f64::min);
        let x_max = points
            .iter()
            .map(|point| point.x)
            .fold(f64::NEG_INFINITY, f64::max);
        let y_min = points
            .iter()
            .map(|point| point.y)
            .fold(f64::INFINITY, f64::min);
        let y_max = points
            .iter()
            .map(|point| point.y)
            .fold(f64::NEG_INFINITY, f64::max);
        let width = x_max - x_min;
        let height = y_max - y_min;
        if width <= 1e-9 || height <= 1e-9 {
            return Self::identity();
        }
        Self {
            x_min,
            y_min,
            width,
            height,
        }
    }

    fn normalize_point(self, point: Point2) -> Point2 {
        Point2::new(
            snap_unit((point.x - self.x_min) / self.width),
            snap_unit((point.y - self.y_min) / self.height),
        )
    }
}

fn normalize_legacy_program(
    program: &CandidateProgram,
    normalization: LegacyUnitSquareNormalization,
) -> CandidateProgram {
    let mut normalized = program.clone();
    for vertex in &mut normalized.vertices {
        vertex.position = normalization.normalize_point(vertex.position);
        vertex.kind = legacy_vertex_kind_from_point(vertex.position);
        vertex.boundary_side = legacy_boundary_side_from_point(vertex.position).map(str::to_owned);
    }
    let mut carriers = normalized.carriers.clone();
    for edge in &normalized.edges {
        let Some(p0) = normalized
            .vertices
            .get(edge.vertices[0])
            .map(|vertex| vertex.position)
        else {
            continue;
        };
        let Some(p1) = normalized
            .vertices
            .get(edge.vertices[1])
            .map(|vertex| vertex.position)
        else {
            continue;
        };
        let Some(carrier) = carriers.get_mut(edge.carrier_id) else {
            continue;
        };
        *carrier = normalized_legacy_carrier(carrier, p0, p1, edge.assignment.label);
    }
    normalized.carriers = carriers;
    normalized
}

fn normalized_legacy_carrier(
    carrier: &LegacyCarrier,
    p0: Point2,
    p1: Point2,
    assignment: AssignmentLabel,
) -> LegacyCarrier {
    let dx = p1.x - p0.x;
    let dy = p1.y - p0.y;
    let length = (dx * dx + dy * dy).sqrt().max(1e-12);
    let normal = Point2::new(-dy / length, dx / length);
    let direction = Point2::new(dx / length, dy / length);
    let t0 = p0.x * direction.x + p0.y * direction.y;
    let t1 = p1.x * direction.x + p1.y * direction.y;
    LegacyCarrier {
        id: carrier.id,
        family: legacy_carrier_family(p0, p1, assignment),
        normal,
        rho: normal.x * p0.x + normal.y * p0.y,
        support_interval: [t0.min(t1), t0.max(t1)],
        visual_support: carrier.visual_support,
        dashed_support: carrier.dashed_support,
        non_crease_penalty: carrier.non_crease_penalty,
        source: carrier.source,
        provenance: carrier.provenance.clone(),
    }
}

fn legacy_carrier_family(p0: Point2, p1: Point2, assignment: AssignmentLabel) -> CarrierFamily {
    if assignment == AssignmentLabel::Boundary {
        return CarrierFamily::Border;
    }
    let dx = (p1.x - p0.x).abs();
    let dy = (p1.y - p0.y).abs();
    if dy < 1e-9 {
        CarrierFamily::Horizontal
    } else if dx < 1e-9 {
        CarrierFamily::Vertical
    } else if ((p1.y - p0.y) - (p1.x - p0.x)).abs() < 1e-9 {
        CarrierFamily::DiagonalPositive
    } else if ((p1.y - p0.y) + (p1.x - p0.x)).abs() < 1e-9 {
        CarrierFamily::DiagonalNegative
    } else {
        CarrierFamily::Free
    }
}

fn legacy_vertex_kind_from_point(point: Point2) -> VertexKind {
    let boundary_count = [
        near_unit(point.x, 0.0),
        near_unit(point.x, 1.0),
        near_unit(point.y, 0.0),
        near_unit(point.y, 1.0),
    ]
    .into_iter()
    .filter(|value| *value)
    .count();
    match boundary_count {
        0 => VertexKind::Interior,
        1 => VertexKind::Boundary,
        _ => VertexKind::Corner,
    }
}

fn legacy_boundary_side_from_point(point: Point2) -> Option<&'static str> {
    if near_unit(point.x, 0.0) {
        Some("left")
    } else if near_unit(point.x, 1.0) {
        Some("right")
    } else if near_unit(point.y, 0.0) {
        Some("top")
    } else if near_unit(point.y, 1.0) {
        Some("bottom")
    } else {
        None
    }
}

fn near_unit(value: f64, target: f64) -> bool {
    (value - target).abs() <= 1e-6
}

fn snap_unit(value: f64) -> f64 {
    let clamped = value.clamp(0.0, 1.0);
    if near_unit(clamped, 0.0) {
        0.0
    } else if near_unit(clamped, 1.0) {
        1.0
    } else {
        clamped
    }
}

pub struct ArrangementCandidateAdapter;

impl ArrangementCandidateAdapter {
    pub fn from_arrangement(arrangement: &CandidateArrangement) -> CandidateGraph {
        Self::from_arrangement_with_options(
            arrangement,
            ArrangementCandidateAdapterOptions::default(),
        )
    }

    pub fn from_arrangement_with_options(
        arrangement: &CandidateArrangement,
        options: ArrangementCandidateAdapterOptions,
    ) -> CandidateGraph {
        let mut vertices = arrangement
            .vertices
            .iter()
            .map(|vertex| CandidateVertex {
                id: vertex.id,
                point: vertex.point,
                kind: arrangement_vertex_kind(vertex.kind),
                support: vertex.support.clamp(0.0, 1.0),
                movement_policy: movement_policy_for_arrangement_vertex(vertex.kind),
                boundary_side: vertex.boundary_side.map(boundary_side_from_arrangement),
                source_vertex_ids: vec![vertex.id],
                source_carrier_ids: vertex.carrier_ids.clone(),
                source_adapter: CandidateSourceAdapter::ArrangementV2,
                provenance: vertex.provenance.clone(),
            })
            .collect::<Vec<_>>();
        let corners =
            ensure_unit_square_corners(&mut vertices, CandidateSourceAdapter::ArrangementV2);
        let carriers = arrangement
            .carriers
            .iter()
            .map(|carrier| (carrier.id, carrier))
            .collect::<BTreeMap<_, _>>();
        let mut spans = Vec::new();
        for edge in &arrangement.atomic_edges {
            let Some(carrier) = carriers.get(&edge.carrier_id).copied() else {
                continue;
            };
            let is_shared = carrier.kind == ArrangementCarrierKind::SharedCollinearAlternative;
            let source_kind = if edge.assignment.label == AssignmentLabel::Boundary {
                CandidateCreaseSourceKind::BorderGenerated
            } else if is_shared {
                CandidateCreaseSourceKind::ArrangementShared
            } else {
                CandidateCreaseSourceKind::ArrangementObserved
            };
            let selection_policy = if edge.assignment.label == AssignmentLabel::Boundary {
                CandidateSelectionPolicy::Locked
            } else if edge.line_support >= options.strong_presence_floor {
                CandidateSelectionPolicy::StrongOptional
            } else if edge.line_support >= options.weak_presence_floor {
                CandidateSelectionPolicy::WeakOptional
            } else {
                CandidateSelectionPolicy::Discouraged
            };
            spans.push(CandidateCreaseSpan {
                id: spans.len(),
                kind: if is_shared {
                    CandidateCreaseSpanKind::SharedCarrierSpan
                } else {
                    CandidateCreaseSpanKind::AtomicInterval
                },
                vertices: edge.vertices,
                carrier: CandidateCarrierGeometry {
                    normal: carrier.normal,
                    direction: carrier.direction,
                    rho: carrier.rho,
                },
                t_interval: edge.t_interval,
                assignment_evidence: AssignmentEvidence::from_candidate(
                    edge.assignment,
                    AssignmentEvidenceSource::ModelAssignmentHead,
                ),
                presence_probability: edge.line_support.clamp(0.01, 0.99),
                line_support_min: edge.line_support.clamp(0.0, 1.0),
                line_support_mean: edge.line_support.clamp(0.0, 1.0),
                line_support_max: edge.line_support.clamp(0.0, 1.0),
                style_support: edge.style_support.clamp(0.0, 1.0),
                non_crease_support: 0.0,
                source_kind,
                selection_policy,
                boundary_role: if edge.assignment.label == AssignmentLabel::Boundary {
                    CandidateCreaseBoundaryRole::PaperBoundary
                } else {
                    CandidateCreaseBoundaryRole::None
                },
                source_edge_ids: vec![edge.id],
                source_atomic_edge_ids: vec![edge.id],
                source_carrier_ids: vec![carrier.id],
                replaced_span_ids: Vec::new(),
                replaced_atomic_edge_ids: Vec::new(),
                collapsed_vertex_ids: Vec::new(),
                provenance: edge.provenance.clone(),
                reasons: vec![if is_shared {
                    "arrangement V2 shared carrier candidate".to_owned()
                } else {
                    "arrangement V2 observed atomic interval candidate".to_owned()
                }],
            });
        }

        assign_span_ids(&mut spans);
        let mut graph = CandidateGraph {
            schema: SCHEMA.to_owned(),
            coordinate_space: arrangement.coordinate_space.clone(),
            image_size: Some(arrangement.image_size),
            boundary: boundary_model_from_vertices(&vertices, corners, &spans),
            vertices,
            crease_candidates: spans,
            conflicts: Vec::new(),
            alternatives: Vec::new(),
            cost_model: CostModel::default(),
            provenance: CandidateGraphProvenance {
                source_adapter: CandidateSourceAdapter::ArrangementV2,
                source_ids: Vec::new(),
                notes: vec![
                    "arrangement V2 converted into source-neutral CandidateGraph".to_owned(),
                ],
            },
            report: CandidateGraphReport::empty(),
        };
        graph.conflicts = generate_conflicts(&graph);
        graph.alternatives = graph.conflicts.clone();
        graph.report = CandidateGraphReport::from_graph(&graph);
        graph
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SelectedGraph {
    pub schema: String,
    pub source_candidate_graph_schema: String,
    pub selected_span_ids: Vec<usize>,
    pub selected_vertex_ids: Vec<usize>,
    pub boundary: BoundaryModel,
    #[serde(default)]
    pub fixed_assignment_labels: BTreeMap<usize, AssignmentLabel>,
    #[serde(default)]
    pub rejected_span_ids: Vec<usize>,
    #[serde(default)]
    pub undecided_span_ids: Vec<usize>,
    #[serde(default)]
    pub structural_edit_accounting: Vec<SelectedGraphEdit>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SelectedGraphEdit {
    pub kind: String,
    #[serde(default)]
    pub span_ids: Vec<usize>,
    #[serde(default)]
    pub vertex_ids: Vec<usize>,
    pub reason: String,
}

impl SelectedGraph {
    pub fn from_selected_span_ids(graph: &CandidateGraph, selected_span_ids: Vec<usize>) -> Self {
        let selected = selected_span_ids.iter().copied().collect::<BTreeSet<_>>();
        let mut selected_vertex_ids = selected_span_ids
            .iter()
            .filter_map(|span_id| graph.crease_candidates.get(*span_id))
            .flat_map(|span| span.vertices)
            .collect::<Vec<_>>();
        selected_vertex_ids.sort_unstable();
        selected_vertex_ids.dedup();
        let mut rejected_span_ids = Vec::new();
        let mut undecided_span_ids = Vec::new();
        for span in &graph.crease_candidates {
            if selected.contains(&span.id) {
                continue;
            }
            if span.selection_policy == CandidateSelectionPolicy::Discouraged {
                rejected_span_ids.push(span.id);
            } else {
                undecided_span_ids.push(span.id);
            }
        }
        Self {
            schema: "oristudio/cp-compiler/selected-graph-v1".to_owned(),
            source_candidate_graph_schema: graph.schema.clone(),
            selected_span_ids,
            selected_vertex_ids,
            boundary: graph.boundary.clone(),
            fixed_assignment_labels: BTreeMap::new(),
            rejected_span_ids,
            undecided_span_ids,
            structural_edit_accounting: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExactSolveInput {
    pub schema: String,
    pub coordinate_space: String,
    pub image_size: Option<u32>,
    pub vertices: Vec<CandidateVertex>,
    pub selected_spans: Vec<CandidateCreaseSpan>,
    pub boundary: BoundaryModel,
    pub cost_model: CostModel,
    pub provenance: CandidateGraphProvenance,
}

impl ExactSolveInput {
    pub fn from_candidate_selection(graph: &CandidateGraph, selected: &SelectedGraph) -> Self {
        let selected_ids = selected
            .selected_span_ids
            .iter()
            .copied()
            .collect::<BTreeSet<_>>();
        let mut selected_spans = graph
            .crease_candidates
            .iter()
            .filter(|span| selected_ids.contains(&span.id))
            .cloned()
            .collect::<Vec<_>>();
        apply_fixed_assignment_labels(&mut selected_spans, &selected.fixed_assignment_labels);
        classify_cut_boundary_spans(&graph.vertices, &mut selected_spans);
        Self {
            schema: "oristudio/cp-compiler/exact-solve-input-v1".to_owned(),
            coordinate_space: graph.coordinate_space.clone(),
            image_size: graph.image_size,
            vertices: graph.vertices.clone(),
            selected_spans,
            boundary: selected.boundary.clone(),
            cost_model: graph.cost_model.clone(),
            provenance: graph.provenance.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExactSolvedGraph {
    pub schema: String,
    pub vertices_exact: Vec<Point2>,
    pub edges_exact: Vec<[usize; 2]>,
    pub movement_report: serde_json::Value,
    pub theorem_residual_report: serde_json::Value,
    pub status: ExactSolvedGraphStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExactSolvedGraphStatus {
    Solved,
    Ambiguous,
    Failed,
}

impl CandidateGraphReport {
    fn empty() -> Self {
        Self {
            vertices: 0,
            crease_candidates: 0,
            locked_border_spans: 0,
            legacy_selected_spans: 0,
            legacy_low_threshold_spans: 0,
            arrangement_observed_spans: 0,
            arrangement_shared_spans: 0,
            conflicts: 0,
        }
    }

    fn from_graph(graph: &CandidateGraph) -> Self {
        Self {
            vertices: graph.vertices.len(),
            crease_candidates: graph.crease_candidates.len(),
            locked_border_spans: graph
                .crease_candidates
                .iter()
                .filter(|span| span.selection_policy == CandidateSelectionPolicy::Locked)
                .count(),
            legacy_selected_spans: graph
                .crease_candidates
                .iter()
                .filter(|span| span.source_kind == CandidateCreaseSourceKind::LegacySelected)
                .count(),
            legacy_low_threshold_spans: graph
                .crease_candidates
                .iter()
                .filter(|span| span.source_kind == CandidateCreaseSourceKind::LegacyLowThreshold)
                .count(),
            arrangement_observed_spans: graph
                .crease_candidates
                .iter()
                .filter(|span| span.source_kind == CandidateCreaseSourceKind::ArrangementObserved)
                .count(),
            arrangement_shared_spans: graph
                .crease_candidates
                .iter()
                .filter(|span| span.source_kind == CandidateCreaseSourceKind::ArrangementShared)
                .count(),
            conflicts: graph.conflicts.len(),
        }
    }
}

fn legacy_vertex(
    vertex: &crate::candidates::CandidateVertex,
    source_adapter: CandidateSourceAdapter,
) -> CandidateVertex {
    let boundary_side = vertex
        .boundary_side
        .as_deref()
        .and_then(boundary_side_from_str);
    CandidateVertex {
        id: vertex.id,
        point: vertex.position,
        kind: match vertex.kind {
            VertexKind::Corner => CandidateVertexKind::Corner,
            VertexKind::Boundary => CandidateVertexKind::BoundaryContact,
            VertexKind::Interior => CandidateVertexKind::InteriorJunction,
        },
        support: vertex.support.clamp(0.0, 1.0),
        movement_policy: match vertex.kind {
            VertexKind::Corner => CandidateVertexMovementPolicy::Locked,
            VertexKind::Boundary => CandidateVertexMovementPolicy::BoundaryOnly,
            VertexKind::Interior => CandidateVertexMovementPolicy::Movable,
        },
        boundary_side,
        source_vertex_ids: vec![vertex.id],
        source_carrier_ids: vertex.incident_carriers.clone(),
        source_adapter,
        provenance: vertex.provenance.clone(),
    }
}

fn legacy_span(
    edge: &crate::candidates::CandidateEdge,
    carrier: &crate::candidates::CandidateCarrier,
    source_kind: CandidateCreaseSourceKind,
    source_adapter: CandidateSourceAdapter,
    options: &LegacyCandidateAdapterOptions,
) -> CandidateCreaseSpan {
    legacy_span_with_vertices(
        edge,
        carrier,
        edge.vertices,
        source_kind,
        source_adapter,
        options,
    )
}

fn legacy_span_with_vertices(
    edge: &crate::candidates::CandidateEdge,
    carrier: &crate::candidates::CandidateCarrier,
    vertices: [usize; 2],
    source_kind: CandidateCreaseSourceKind,
    source_adapter: CandidateSourceAdapter,
    options: &LegacyCandidateAdapterOptions,
) -> CandidateCreaseSpan {
    let is_border = edge.assignment.label == AssignmentLabel::Boundary
        || source_kind == CandidateCreaseSourceKind::BorderGenerated;
    let source_kind = if is_border {
        CandidateCreaseSourceKind::BorderGenerated
    } else {
        source_kind
    };
    let selection_policy = if is_border {
        CandidateSelectionPolicy::Locked
    } else {
        match edge.selection {
            EdgeSelection::Selected => CandidateSelectionPolicy::StrongOptional,
            EdgeSelection::Undecided => CandidateSelectionPolicy::WeakOptional,
            EdgeSelection::Rejected => CandidateSelectionPolicy::Discouraged,
        }
    };
    let presence_probability = if is_border {
        options.border_presence_probability
    } else if source_kind == CandidateCreaseSourceKind::LegacyLowThreshold {
        options.weak_presence_probability
    } else {
        match edge.selection {
            EdgeSelection::Selected => options.selected_presence_probability,
            EdgeSelection::Undecided => options.weak_presence_probability,
            EdgeSelection::Rejected => options.rejected_presence_probability,
        }
    };
    let direction = Point2::new(carrier.normal.y, -carrier.normal.x);
    CandidateCreaseSpan {
        id: edge.id,
        kind: if is_border {
            CandidateCreaseSpanKind::BorderSpan
        } else {
            CandidateCreaseSpanKind::AtomicInterval
        },
        vertices,
        carrier: CandidateCarrierGeometry {
            normal: carrier.normal,
            direction,
            rho: carrier.rho,
        },
        t_interval: carrier.support_interval,
        assignment_evidence: AssignmentEvidence::from_candidate(
            edge.assignment,
            if source_adapter == CandidateSourceAdapter::Legacy {
                AssignmentEvidenceSource::LegacyColor
            } else {
                AssignmentEvidenceSource::ModelAssignmentHead
            },
        ),
        presence_probability: presence_probability.clamp(0.01, 0.99),
        line_support_min: edge.line_support.clamp(0.0, 1.0),
        line_support_mean: edge.line_support.clamp(0.0, 1.0),
        line_support_max: edge.line_support.clamp(0.0, 1.0),
        style_support: edge.style_support.clamp(0.0, 1.0),
        non_crease_support: 0.0,
        source_kind,
        selection_policy,
        boundary_role: if is_border {
            CandidateCreaseBoundaryRole::PaperBoundary
        } else {
            CandidateCreaseBoundaryRole::None
        },
        source_edge_ids: vec![edge.id],
        source_atomic_edge_ids: vec![edge.id],
        source_carrier_ids: vec![carrier.id],
        replaced_span_ids: Vec::new(),
        replaced_atomic_edge_ids: Vec::new(),
        collapsed_vertex_ids: Vec::new(),
        provenance: edge.provenance.clone(),
        reasons: vec![
            if source_kind == CandidateCreaseSourceKind::LegacyLowThreshold {
                "legacy lower-threshold optional candidate".to_owned()
            } else {
                "legacy selected graph candidate".to_owned()
            },
        ],
    }
}

#[derive(Debug, Clone)]
struct WeakVertexMapping {
    vertices: [usize; 2],
    reasons: Vec<String>,
}

fn map_weak_vertices(
    vertices: &mut Vec<CandidateVertex>,
    weak_program: &CandidateProgram,
    edge: &crate::candidates::CandidateEdge,
    carrier: &LegacyCarrier,
    options: &LegacyCandidateAdapterOptions,
) -> Option<WeakVertexMapping> {
    let mut mapped = [0usize; 2];
    let mut reasons = Vec::new();
    for (slot, source_vertex_id) in edge.vertices.iter().enumerate() {
        let source = weak_program.vertices.get(*source_vertex_id)?;
        let (vertex_id, reason) = map_weak_vertex(vertices, source, carrier, options);
        mapped[slot] = vertex_id;
        if let Some(reason) = reason {
            reasons.push(reason);
        }
    }
    Some(WeakVertexMapping {
        vertices: mapped,
        reasons,
    })
}

fn map_weak_vertex(
    vertices: &mut Vec<CandidateVertex>,
    source: &crate::candidates::CandidateVertex,
    carrier: &LegacyCarrier,
    options: &LegacyCandidateAdapterOptions,
) -> (usize, Option<String>) {
    let source_side = source
        .boundary_side
        .as_deref()
        .and_then(boundary_side_from_str);
    if let Some(existing) = vertices.iter().position(|vertex| {
        distance(vertex.point, source.position) <= options.duplicate_endpoint_tolerance
            && vertex.boundary_side == source_side
    }) {
        return (existing, None);
    }

    if let Some((existing, _score)) =
        best_weak_endpoint_snap(vertices, source.position, source_side, carrier, options)
    {
        return (
            existing,
            Some(format!(
                "reattached weak endpoint {} to canonical strong vertex {}",
                source.id, existing
            )),
        );
    }

    let mut vertex = legacy_vertex(source, CandidateSourceAdapter::LegacyLowThreshold);
    vertex.id = vertices.len();
    vertices.push(vertex);
    (vertices.len() - 1, None)
}

fn best_weak_endpoint_snap(
    vertices: &[CandidateVertex],
    point: Point2,
    source_side: Option<BoundarySide>,
    carrier: &LegacyCarrier,
    options: &LegacyCandidateAdapterOptions,
) -> Option<(usize, f64)> {
    vertices
        .iter()
        .filter(|vertex| vertex.source_adapter == CandidateSourceAdapter::Legacy)
        .filter_map(|vertex| {
            let distance_to_vertex = distance(vertex.point, point);
            let carrier_incidence = legacy_carrier_incidence(carrier, vertex.point);
            let is_boundary_snap = source_side.is_some() || vertex.boundary_side.is_some();
            if is_boundary_snap {
                if source_side != vertex.boundary_side {
                    return None;
                }
                if distance_to_vertex > options.weak_boundary_endpoint_snap_tolerance {
                    return None;
                }
                let incidence_tolerance = options.weak_carrier_incidence_tolerance * 2.0;
                if carrier_incidence > incidence_tolerance {
                    return None;
                }
                let score = distance_to_vertex / options.weak_boundary_endpoint_snap_tolerance
                    + carrier_incidence / incidence_tolerance.max(1e-9);
                return Some((vertex.id, score));
            }

            if vertex.boundary_side.is_some()
                || matches!(
                    vertex.kind,
                    CandidateVertexKind::Corner | CandidateVertexKind::BoundaryContact
                )
            {
                return None;
            }
            if distance_to_vertex > options.weak_endpoint_snap_tolerance {
                return None;
            }
            if carrier_incidence > options.weak_carrier_incidence_tolerance {
                return None;
            }
            let score = distance_to_vertex / options.weak_endpoint_snap_tolerance
                + carrier_incidence / options.weak_carrier_incidence_tolerance.max(1e-9);
            Some((vertex.id, score))
        })
        .min_by(|(_, left_score), (_, right_score)| {
            left_score
                .partial_cmp(right_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
}

fn weak_span_vertex_sequence(
    vertices: &[CandidateVertex],
    endpoints: [usize; 2],
    carrier: &LegacyCarrier,
    options: &LegacyCandidateAdapterOptions,
) -> Vec<usize> {
    let Some(start) = vertices.get(endpoints[0]).map(|vertex| vertex.point) else {
        return endpoints.to_vec();
    };
    let Some(end) = vertices.get(endpoints[1]).map(|vertex| vertex.point) else {
        return endpoints.to_vec();
    };
    let t0 = legacy_carrier_projection(carrier, start);
    let t1 = legacy_carrier_projection(carrier, end);
    let min_t = t0.min(t1);
    let max_t = t0.max(t1);
    let mut sequence = vec![(t0, endpoints[0]), (t1, endpoints[1])];

    for vertex in vertices {
        if vertex.source_adapter != CandidateSourceAdapter::Legacy {
            continue;
        }
        if endpoints.contains(&vertex.id) {
            continue;
        }
        let t = legacy_carrier_projection(carrier, vertex.point);
        if t <= min_t + options.weak_min_split_length || t >= max_t - options.weak_min_split_length
        {
            continue;
        }
        if legacy_carrier_incidence(carrier, vertex.point) > options.weak_span_split_tolerance {
            continue;
        }
        sequence.push((t, vertex.id));
    }

    sequence.sort_by(|(left_t, _), (right_t, _)| {
        left_t
            .partial_cmp(right_t)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    sequence.dedup_by_key(|(_, vertex_id)| *vertex_id);
    sequence
        .into_iter()
        .map(|(_, vertex_id)| vertex_id)
        .collect()
}

fn legacy_carrier_direction(carrier: &LegacyCarrier) -> Point2 {
    Point2::new(carrier.normal.y, -carrier.normal.x)
}

fn legacy_carrier_projection(carrier: &LegacyCarrier, point: Point2) -> f64 {
    let direction = legacy_carrier_direction(carrier);
    point.x * direction.x + point.y * direction.y
}

fn legacy_carrier_incidence(carrier: &LegacyCarrier, point: Point2) -> f64 {
    (carrier.normal.x * point.x + carrier.normal.y * point.y - carrier.rho).abs()
}

fn span_interval_for_vertices(
    vertices: &[CandidateVertex],
    endpoints: [usize; 2],
    carrier: &LegacyCarrier,
) -> [f64; 2] {
    let t0 = vertices
        .get(endpoints[0])
        .map(|vertex| legacy_carrier_projection(carrier, vertex.point))
        .unwrap_or(carrier.support_interval[0]);
    let t1 = vertices
        .get(endpoints[1])
        .map(|vertex| legacy_carrier_projection(carrier, vertex.point))
        .unwrap_or(carrier.support_interval[1]);
    [t0.min(t1), t0.max(t1)]
}

fn span_length(vertices: &[CandidateVertex], endpoints: [usize; 2]) -> f64 {
    let Some(a) = vertices.get(endpoints[0]).map(|vertex| vertex.point) else {
        return 0.0;
    };
    let Some(b) = vertices.get(endpoints[1]).map(|vertex| vertex.point) else {
        return 0.0;
    };
    distance(a, b)
}

fn ensure_unit_square_corners(
    vertices: &mut Vec<CandidateVertex>,
    source_adapter: CandidateSourceAdapter,
) -> [usize; 4] {
    let corners = [
        (Point2::new(0.0, 0.0), BoundarySide::Top),
        (Point2::new(1.0, 0.0), BoundarySide::Right),
        (Point2::new(1.0, 1.0), BoundarySide::Bottom),
        (Point2::new(0.0, 1.0), BoundarySide::Left),
    ];
    let mut ids = [0usize; 4];
    for (index, (point, side)) in corners.into_iter().enumerate() {
        if let Some(existing) = vertices
            .iter()
            .position(|vertex| distance(vertex.point, point) <= 1e-9)
        {
            ids[index] = existing;
            if let Some(vertex) = vertices.get_mut(existing) {
                vertex.kind = CandidateVertexKind::Corner;
                vertex.movement_policy = CandidateVertexMovementPolicy::Locked;
            }
            continue;
        }
        let id = vertices.len();
        vertices.push(CandidateVertex {
            id,
            point,
            kind: CandidateVertexKind::Corner,
            support: 1.0,
            movement_policy: CandidateVertexMovementPolicy::Locked,
            boundary_side: Some(side),
            source_vertex_ids: Vec::new(),
            source_carrier_ids: Vec::new(),
            source_adapter,
            provenance: vec![Provenance::BorderPrior],
        });
        ids[index] = id;
    }
    for (id, vertex) in vertices.iter_mut().enumerate() {
        vertex.id = id;
    }
    ids
}

fn boundary_model_from_vertices(
    vertices: &[CandidateVertex],
    corners: [usize; 4],
    spans: &[CandidateCreaseSpan],
) -> BoundaryModel {
    let mut sides = Vec::new();
    for (side, corner_vertices) in [
        (BoundarySide::Top, [corners[0], corners[1]]),
        (BoundarySide::Right, [corners[1], corners[2]]),
        (BoundarySide::Bottom, [corners[3], corners[2]]),
        (BoundarySide::Left, [corners[0], corners[3]]),
    ] {
        let mut contact_vertices = vertices
            .iter()
            .filter(|vertex| vertex.boundary_side == Some(side))
            .map(|vertex| vertex.id)
            .collect::<Vec<_>>();
        contact_vertices.sort_by(|left, right| {
            side.sort_key(vertices[*left].point)
                .total_cmp(&side.sort_key(vertices[*right].point))
                .then_with(|| left.cmp(right))
        });
        contact_vertices.dedup();
        sides.push(BoundarySideModel {
            side,
            corner_vertices,
            contact_vertices,
        });
    }
    BoundaryModel {
        corners,
        sides,
        generated_border_span_ids: spans
            .iter()
            .filter(|span| span.source_kind == CandidateCreaseSourceKind::BorderGenerated)
            .map(|span| span.id)
            .collect(),
        reconstruction_policy: BoundaryReconstructionPolicy::LockedUnitSquareSortedContacts,
    }
}

fn generate_conflicts(graph: &CandidateGraph) -> Vec<CandidateConflict> {
    let mut conflicts = Vec::new();
    let mut by_key = BTreeMap::<SpanKey, Vec<usize>>::new();
    for span in &graph.crease_candidates {
        by_key
            .entry(span_endpoint_key(&graph.vertices, span.vertices, 1e-6))
            .or_default()
            .push(span.id);
    }
    for ids in by_key.values().filter(|ids| ids.len() > 1) {
        conflicts.push(CandidateConflict {
            id: conflicts.len(),
            kind: CandidateConflictKind::DuplicateSpan,
            candidate_ids: ids.clone(),
            hard: true,
            reason: "duplicate candidate spans share effective endpoints".to_owned(),
        });
    }
    for span in &graph.crease_candidates {
        if span.replaced_span_ids.is_empty() && span.replaced_atomic_edge_ids.is_empty() {
            continue;
        }
        let mut ids = vec![span.id];
        ids.extend(span.replaced_span_ids.iter().copied());
        ids.extend(span.replaced_atomic_edge_ids.iter().copied());
        ids.sort_unstable();
        ids.dedup();
        if ids.len() > 1 {
            conflicts.push(CandidateConflict {
                id: conflicts.len(),
                kind: CandidateConflictKind::SpanReplacesFragments,
                candidate_ids: ids,
                hard: true,
                reason: "long candidate span replaces fragment chain".to_owned(),
            });
        }
    }
    conflicts
}

fn apply_fixed_assignment_labels(
    spans: &mut [CandidateCreaseSpan],
    fixed_labels: &BTreeMap<usize, AssignmentLabel>,
) {
    for span in spans {
        let Some(label) = fixed_labels.get(&span.id).copied() else {
            continue;
        };
        set_span_assignment_label(span, label, "fixed assignment from selected graph");
    }
}

fn classify_cut_boundary_spans(vertices: &[CandidateVertex], spans: &mut [CandidateCreaseSpan]) {
    if spans.iter().any(is_selected_paper_boundary_span) {
        let cut_span_ids = cut_boundary_span_ids(vertices, spans);
        for span in spans {
            if !cut_span_ids.contains(&span.id) {
                continue;
            }
            set_span_boundary_role(span, CandidateCreaseBoundaryRole::CutBoundary);
            remember_reason(
                span,
                "unknown/flat span on paper-boundary-adjacent cut face",
            );
        }
    } else {
        let exterior_span_ids = exterior_face_span_ids(vertices, spans);
        for span in spans {
            if !exterior_span_ids.contains(&span.id) {
                continue;
            }
            if span.assignment_label() != AssignmentLabel::Unknown {
                continue;
            }
            set_span_assignment_label(
                span,
                AssignmentLabel::Boundary,
                "exterior unassigned span classified as paper boundary",
            );
            set_span_boundary_role(span, CandidateCreaseBoundaryRole::PaperBoundary);
            if !span.provenance.contains(&Provenance::BorderPrior) {
                span.provenance.push(Provenance::BorderPrior);
            }
        }
    }
}

fn is_selected_paper_boundary_span(span: &CandidateCreaseSpan) -> bool {
    span.boundary_role() == CandidateCreaseBoundaryRole::PaperBoundary
}

fn set_span_boundary_role(span: &mut CandidateCreaseSpan, role: CandidateCreaseBoundaryRole) {
    if span.boundary_role == role {
        return;
    }
    span.boundary_role = role;
}

fn is_non_fold_boundary_candidate(span: &CandidateCreaseSpan) -> bool {
    matches!(
        span.assignment_label(),
        AssignmentLabel::Unknown | AssignmentLabel::Flat
    ) && span.boundary_role() == CandidateCreaseBoundaryRole::None
}

fn set_span_assignment_label(span: &mut CandidateCreaseSpan, label: AssignmentLabel, reason: &str) {
    if span.assignment_evidence.observed_label == label {
        return;
    }
    span.assignment_evidence.observed_label = label;
    if label == AssignmentLabel::Boundary {
        let confidence = span
            .assignment_evidence
            .confidence
            .max(span.presence_probability)
            .max(0.85);
        span.assignment_evidence.boundary = span.assignment_evidence.boundary.max(confidence);
        span.assignment_evidence.confidence = span.assignment_evidence.confidence.max(confidence);
        span.assignment_evidence.margin = span.assignment_evidence.margin.max(0.50);
    }
    remember_reason(span, reason);
}

fn remember_reason(span: &mut CandidateCreaseSpan, reason: &str) {
    if !span.reasons.iter().any(|existing| existing == reason) {
        span.reasons.push(reason.to_owned());
    }
}

#[derive(Debug, Clone, Copy)]
struct FaceHalfEdge {
    to: usize,
    span_id: usize,
    angle: f64,
}

#[derive(Debug, Clone)]
struct SpanFace {
    area: f64,
    span_ids: BTreeSet<usize>,
}

fn cut_boundary_span_ids(
    vertices: &[CandidateVertex],
    spans: &[CandidateCreaseSpan],
) -> BTreeSet<usize> {
    let span_by_id = spans
        .iter()
        .map(|span| (span.id, span))
        .collect::<BTreeMap<_, _>>();
    let mut cut_span_ids = BTreeSet::new();
    for face in span_faces(vertices, spans) {
        if face.area <= 1e-9 {
            continue;
        }
        let mut has_paper_boundary = false;
        let mut eligible = true;
        let mut non_fold_ids = Vec::new();
        for span_id in &face.span_ids {
            let Some(span) = span_by_id.get(span_id).copied() else {
                eligible = false;
                break;
            };
            if is_selected_paper_boundary_span(span) {
                has_paper_boundary = true;
            } else if is_non_fold_boundary_candidate(span) {
                non_fold_ids.push(*span_id);
            } else {
                eligible = false;
                break;
            }
        }
        if eligible && has_paper_boundary && !non_fold_ids.is_empty() {
            cut_span_ids.extend(non_fold_ids);
        }
    }
    cut_span_ids
}

fn exterior_face_span_ids(
    vertices: &[CandidateVertex],
    spans: &[CandidateCreaseSpan],
) -> BTreeSet<usize> {
    span_faces(vertices, spans)
        .into_iter()
        .filter(|face| face.area < -1e-9)
        .min_by(|left, right| left.area.total_cmp(&right.area))
        .map(|face| face.span_ids)
        .unwrap_or_default()
}

fn span_faces(vertices: &[CandidateVertex], spans: &[CandidateCreaseSpan]) -> Vec<SpanFace> {
    let mut adjacency = vec![Vec::<FaceHalfEdge>::new(); vertices.len()];
    for span in spans {
        let [a, b] = span.vertices;
        let (Some(vertex_a), Some(vertex_b)) = (vertices.get(a), vertices.get(b)) else {
            continue;
        };
        if distance(vertex_a.point, vertex_b.point) <= 1e-9 {
            continue;
        }
        adjacency[a].push(FaceHalfEdge {
            to: b,
            span_id: span.id,
            angle: face_angle(vertex_a.point, vertex_b.point),
        });
        adjacency[b].push(FaceHalfEdge {
            to: a,
            span_id: span.id,
            angle: face_angle(vertex_b.point, vertex_a.point),
        });
    }
    for outgoing in &mut adjacency {
        outgoing.sort_by(|left, right| {
            left.angle
                .total_cmp(&right.angle)
                .then_with(|| left.to.cmp(&right.to))
                .then_with(|| left.span_id.cmp(&right.span_id))
        });
    }

    let mut visited = BTreeSet::<(usize, usize)>::new();
    let mut faces = Vec::new();
    let max_steps = spans.len().saturating_mul(4).max(8);
    for start_from in 0..adjacency.len() {
        for start_index in 0..adjacency[start_from].len() {
            let start_span_id = adjacency[start_from][start_index].span_id;
            if visited.contains(&(start_from, start_span_id)) {
                continue;
            }
            let mut from = start_from;
            let mut edge_index = start_index;
            let mut area2 = 0.0_f64;
            let mut face_span_ids = BTreeSet::new();
            let mut closed = false;
            for _ in 0..max_steps {
                let edge = adjacency[from][edge_index];
                if !visited.insert((from, edge.span_id)) {
                    break;
                }
                let p0 = vertices[from].point;
                let p1 = vertices[edge.to].point;
                area2 += p0.x * p1.y - p0.y * p1.x;
                face_span_ids.insert(edge.span_id);

                let reverse_from = edge.to;
                let Some(reverse_index) = adjacency[reverse_from].iter().position(|candidate| {
                    candidate.to == from && candidate.span_id == edge.span_id
                }) else {
                    break;
                };
                let outgoing_count = adjacency[reverse_from].len();
                if outgoing_count == 0 {
                    break;
                }
                from = reverse_from;
                edge_index = if reverse_index == 0 {
                    outgoing_count - 1
                } else {
                    reverse_index - 1
                };
                if from == start_from && adjacency[from][edge_index].span_id == start_span_id {
                    closed = true;
                    break;
                }
            }
            if !closed || face_span_ids.is_empty() || area2.abs() <= 1e-9 {
                continue;
            }
            faces.push(SpanFace {
                area: area2 * 0.5,
                span_ids: face_span_ids,
            });
        }
    }
    faces
}

fn face_angle(origin: Point2, target: Point2) -> f64 {
    (target.y - origin.y)
        .atan2(target.x - origin.x)
        .rem_euclid(std::f64::consts::TAU)
}

fn assign_span_ids(spans: &mut [CandidateCreaseSpan]) {
    for (id, span) in spans.iter_mut().enumerate() {
        span.id = id;
    }
}

fn prune_unreferenced_low_threshold_vertices(
    vertices: &mut Vec<CandidateVertex>,
    spans: &mut [CandidateCreaseSpan],
    corners: [usize; 4],
) -> [usize; 4] {
    let referenced_vertices = spans
        .iter()
        .flat_map(|span| span.vertices)
        .collect::<BTreeSet<_>>();
    let mut remap = vec![None; vertices.len()];
    let mut retained = Vec::with_capacity(vertices.len());
    for vertex in vertices.iter().cloned() {
        let keep = vertex.source_adapter != CandidateSourceAdapter::LegacyLowThreshold
            || referenced_vertices.contains(&vertex.id);
        if !keep {
            continue;
        }
        let old_id = vertex.id;
        let mut remapped = vertex;
        remapped.id = retained.len();
        remap[old_id] = Some(remapped.id);
        retained.push(remapped);
    }
    if retained.len() == vertices.len() {
        return corners;
    }
    for span in spans {
        span.vertices = span.vertices.map(|id| {
            remap[id].expect("referenced span endpoint should survive weak-vertex pruning")
        });
    }
    *vertices = retained;
    corners.map(|corner| remap[corner].expect("paper corner should survive weak-vertex pruning"))
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct SpanKey {
    a: (i64, i64),
    b: (i64, i64),
}

fn span_endpoint_key(
    vertices: &[CandidateVertex],
    endpoints: [usize; 2],
    tolerance: f64,
) -> SpanKey {
    let scale = (1.0 / tolerance.max(1e-9)).round();
    let mut points = endpoints.map(|id| {
        let point = vertices
            .get(id)
            .map(|vertex| vertex.point)
            .unwrap_or(Point2::new(0.0, 0.0));
        (
            (point.x * scale).round() as i64,
            (point.y * scale).round() as i64,
        )
    });
    if points[1] < points[0] {
        points.swap(0, 1);
    }
    SpanKey {
        a: points[0],
        b: points[1],
    }
}

fn span_has_near_duplicate(
    vertices: &[CandidateVertex],
    spans: &[CandidateCreaseSpan],
    endpoints: [usize; 2],
    tolerance: f64,
) -> bool {
    let Some(candidate_start) = vertices.get(endpoints[0]).map(|vertex| vertex.point) else {
        return false;
    };
    let Some(candidate_end) = vertices.get(endpoints[1]).map(|vertex| vertex.point) else {
        return false;
    };
    spans.iter().any(|span| {
        let Some(span_start) = vertices.get(span.vertices[0]).map(|vertex| vertex.point) else {
            return false;
        };
        let Some(span_end) = vertices.get(span.vertices[1]).map(|vertex| vertex.point) else {
            return false;
        };
        let same_orientation = distance(candidate_start, span_start) <= tolerance
            && distance(candidate_end, span_end) <= tolerance;
        let reversed_orientation = distance(candidate_start, span_end) <= tolerance
            && distance(candidate_end, span_start) <= tolerance;
        same_orientation || reversed_orientation
    })
}

fn arrangement_vertex_kind(kind: ArrangementVertexKind) -> CandidateVertexKind {
    match kind {
        ArrangementVertexKind::Corner => CandidateVertexKind::Corner,
        ArrangementVertexKind::ObservedJunction => CandidateVertexKind::InteriorJunction,
        ArrangementVertexKind::JunctionCluster => CandidateVertexKind::JunctionCluster,
        ArrangementVertexKind::BoundaryContact => CandidateVertexKind::BoundaryContact,
        ArrangementVertexKind::CarrierIntersection => CandidateVertexKind::CandidateIntersection,
        ArrangementVertexKind::ObservedLineEndpoint => CandidateVertexKind::LineEndpoint,
    }
}

fn movement_policy_for_arrangement_vertex(
    kind: ArrangementVertexKind,
) -> CandidateVertexMovementPolicy {
    match kind {
        ArrangementVertexKind::Corner => CandidateVertexMovementPolicy::Locked,
        ArrangementVertexKind::BoundaryContact => CandidateVertexMovementPolicy::BoundaryOnly,
        ArrangementVertexKind::JunctionCluster => CandidateVertexMovementPolicy::MergeCandidate,
        ArrangementVertexKind::ObservedJunction
        | ArrangementVertexKind::CarrierIntersection
        | ArrangementVertexKind::ObservedLineEndpoint => CandidateVertexMovementPolicy::Movable,
    }
}

fn boundary_side_from_arrangement(side: ArrangementBoundarySide) -> BoundarySide {
    match side {
        ArrangementBoundarySide::Top => BoundarySide::Top,
        ArrangementBoundarySide::Right => BoundarySide::Right,
        ArrangementBoundarySide::Bottom => BoundarySide::Bottom,
        ArrangementBoundarySide::Left => BoundarySide::Left,
    }
}

fn boundary_side_from_str(side: &str) -> Option<BoundarySide> {
    match side {
        "top" => Some(BoundarySide::Top),
        "right" => Some(BoundarySide::Right),
        "bottom" => Some(BoundarySide::Bottom),
        "left" => Some(BoundarySide::Left),
        _ => None,
    }
}

fn distance(a: Point2, b: Point2) -> f64 {
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    (dx * dx + dy * dy).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::EvidenceSource;
    use crate::candidates::{
        CandidateCarrier, CandidateEdge, CandidateVertex as LegacyVertex, CarrierFamily,
    };
    use serde_json::json;

    #[test]
    fn cost_model_clamps_probability_costs() {
        let model = CostModel::default();
        assert_eq!(model.probability_cost(0.0), model.probability_cost(0.01));
        assert_eq!(model.probability_cost(1.0), model.probability_cost(0.99));
        assert!(model.probability_cost(0.9) < model.probability_cost(0.2));
    }

    #[test]
    fn assignment_cost_prefers_observed_label() {
        let model = CostModel::default();
        let evidence = AssignmentEvidence::from_candidate(
            AssignmentCandidate {
                label: AssignmentLabel::Mountain,
                confidence: 0.90,
                margin: 0.80,
            },
            AssignmentEvidenceSource::LegacyColor,
        );
        assert!(
            evidence.cost(AssignmentLabel::Mountain, &model)
                < evidence.cost(AssignmentLabel::Valley, &model)
        );
    }

    #[test]
    fn source_prior_ordering_keeps_legacy_selected_cheaper_than_weak() {
        let model = CostModel::default();
        assert!(
            model.source_prior_cost(CandidateCreaseSourceKind::LegacySelected)
                < model.source_prior_cost(CandidateCreaseSourceKind::LegacyLowThreshold)
        );
        assert!(
            model.source_prior_cost(CandidateCreaseSourceKind::BorderGenerated)
                < model.source_prior_cost(CandidateCreaseSourceKind::LegacySelected)
        );
    }

    #[test]
    fn candidate_graph_serializes_deterministically() {
        let program = square_program();
        let graph = LegacyCandidateAdapter::from_program(&program);
        let encoded = serde_json::to_string(&graph).expect("encode graph");
        let decoded: CandidateGraph = serde_json::from_str(&encoded).expect("decode graph");
        assert_eq!(decoded.schema, graph.schema);
        assert_eq!(decoded.vertices.len(), graph.vertices.len());
        assert_eq!(
            decoded.crease_candidates.len(),
            graph.crease_candidates.len()
        );
        assert_eq!(decoded.boundary.corners, graph.boundary.corners);
        assert_eq!(decoded.report, graph.report);
        assert_eq!(decoded.boundary.corners.len(), 4);
    }

    #[test]
    fn legacy_adapter_preserves_topology_and_assignments() {
        let program = square_program();
        let graph = LegacyCandidateAdapter::from_program(&program);
        assert_eq!(graph.vertices.len(), program.vertices.len());
        assert_eq!(graph.crease_candidates.len(), program.edges.len());
        let labels = graph
            .crease_candidates
            .iter()
            .map(|span| span.assignment_evidence.observed_label)
            .collect::<Vec<_>>();
        assert_eq!(
            labels,
            program
                .edges
                .iter()
                .map(|edge| edge.assignment.label)
                .collect::<Vec<_>>()
        );
        assert_eq!(graph.report.locked_border_spans, 4);
    }

    #[test]
    fn legacy_adapter_normalizes_shrunken_legacy_frame() {
        let mut program = square_program();
        for vertex in &mut program.vertices {
            vertex.position = Point2::new(
                0.03 + vertex.position.x * 0.94,
                0.04 + vertex.position.y * 0.92,
            );
            vertex.kind = VertexKind::Interior;
            vertex.boundary_side = None;
        }
        let graph = LegacyCandidateAdapter::from_program(&program);
        assert_eq!(graph.vertices.len(), program.vertices.len());
        assert_eq!(graph.report.locked_border_spans, 4);
        assert_eq!(
            graph.vertices[graph.boundary.corners[0]].point,
            Point2::new(0.0, 0.0)
        );
        assert_eq!(
            graph.vertices[graph.boundary.corners[1]].point,
            Point2::new(1.0, 0.0)
        );
        assert_eq!(
            graph.vertices[graph.boundary.corners[2]].point,
            Point2::new(1.0, 1.0)
        );
        assert_eq!(
            graph.vertices[graph.boundary.corners[3]].point,
            Point2::new(0.0, 1.0)
        );
        assert_eq!(graph.vertices[4].point, Point2::new(0.5, 0.5));
    }

    #[test]
    fn legacy_adapter_adds_lower_threshold_candidates_without_exporting_duplicates() {
        let selected = square_program();
        let mut weak = selected.clone();
        let a = weak.vertices.len();
        weak.vertices.push(legacy_vertex_raw(
            a,
            Point2::new(0.0, 0.35),
            VertexKind::Boundary,
        ));
        let b = weak.vertices.len();
        weak.vertices.push(legacy_vertex_raw(
            b,
            Point2::new(1.0, 0.35),
            VertexKind::Boundary,
        ));
        weak.carriers.push(carrier_raw(
            weak.carriers.len(),
            Point2::new(0.0, 0.35),
            Point2::new(1.0, 0.35),
            AssignmentLabel::Mountain,
        ));
        weak.edges.push(CandidateEdge {
            id: weak.edges.len(),
            carrier_id: weak.carriers.len() - 1,
            vertices: [a, b],
            assignment: AssignmentCandidate {
                label: AssignmentLabel::Mountain,
                confidence: 0.55,
                margin: 0.10,
            },
            line_support: 0.35,
            style_support: 0.0,
            selection: EdgeSelection::Undecided,
            source: EvidenceSource::ObservedWeak,
            provenance: vec![Provenance::ObservedWeak],
        });
        let graph = LegacyCandidateAdapter::from_programs(
            &selected,
            Some(&weak),
            LegacyCandidateAdapterOptions::default(),
        );
        assert_eq!(graph.report.legacy_selected_spans, selected.edges.len() - 4);
        assert_eq!(graph.report.legacy_low_threshold_spans, 1);
        assert!(graph.crease_candidates.iter().any(|span| span.source_kind
            == CandidateCreaseSourceKind::LegacyLowThreshold
            && span.selection_policy == CandidateSelectionPolicy::WeakOptional));
    }

    #[test]
    fn legacy_adapter_geometrically_dedupes_near_duplicate_lower_threshold_candidates() {
        let selected = square_program();
        let mut weak = selected.clone();
        let near_corner = weak.vertices.len();
        weak.vertices.push(legacy_vertex_raw(
            near_corner,
            Point2::new(0.006, 0.004),
            VertexKind::Interior,
        ));
        weak.carriers.push(carrier_raw(
            weak.carriers.len(),
            Point2::new(0.006, 0.004),
            Point2::new(0.5, 0.5),
            AssignmentLabel::Mountain,
        ));
        weak.edges.push(CandidateEdge {
            id: weak.edges.len(),
            carrier_id: weak.carriers.len() - 1,
            vertices: [near_corner, 4],
            assignment: AssignmentCandidate {
                label: AssignmentLabel::Mountain,
                confidence: 0.55,
                margin: 0.10,
            },
            line_support: 0.35,
            style_support: 0.0,
            selection: EdgeSelection::Selected,
            source: EvidenceSource::ObservedWeak,
            provenance: vec![Provenance::ObservedWeak],
        });

        let graph = LegacyCandidateAdapter::from_programs(
            &selected,
            Some(&weak),
            LegacyCandidateAdapterOptions {
                duplicate_endpoint_tolerance: 0.01,
                ..LegacyCandidateAdapterOptions::default()
            },
        );

        assert_eq!(graph.report.legacy_low_threshold_spans, 0);
        assert!(
            !graph
                .crease_candidates
                .iter()
                .any(|span| { span.source_kind == CandidateCreaseSourceKind::LegacyLowThreshold })
        );
        assert!(
            !graph
                .vertices
                .iter()
                .any(|vertex| vertex.source_adapter == CandidateSourceAdapter::LegacyLowThreshold)
        );
    }

    #[test]
    fn legacy_adapter_reattaches_lower_threshold_endpoint_to_strong_junction() {
        let selected = square_program();
        let mut weak = selected.clone();
        let near_center = weak.vertices.len();
        weak.vertices.push(legacy_vertex_raw(
            near_center,
            Point2::new(0.54, 0.5),
            VertexKind::Interior,
        ));
        let right = weak.vertices.len();
        weak.vertices.push(legacy_vertex_raw(
            right,
            Point2::new(1.0, 0.5),
            VertexKind::Boundary,
        ));
        weak.carriers.push(carrier_raw(
            weak.carriers.len(),
            Point2::new(0.54, 0.5),
            Point2::new(1.0, 0.5),
            AssignmentLabel::Valley,
        ));
        weak.edges.push(CandidateEdge {
            id: weak.edges.len(),
            carrier_id: weak.carriers.len() - 1,
            vertices: [near_center, right],
            assignment: AssignmentCandidate {
                label: AssignmentLabel::Valley,
                confidence: 0.55,
                margin: 0.10,
            },
            line_support: 0.35,
            style_support: 0.0,
            selection: EdgeSelection::Undecided,
            source: EvidenceSource::ObservedWeak,
            provenance: vec![Provenance::ObservedWeak],
        });

        let graph = LegacyCandidateAdapter::from_programs(
            &selected,
            Some(&weak),
            LegacyCandidateAdapterOptions {
                weak_endpoint_snap_tolerance: 0.06,
                weak_carrier_incidence_tolerance: 0.01,
                ..LegacyCandidateAdapterOptions::default()
            },
        );

        let weak_span = graph
            .crease_candidates
            .iter()
            .find(|span| span.source_kind == CandidateCreaseSourceKind::LegacyLowThreshold)
            .expect("weak span");
        assert!(weak_span.vertices.contains(&4));
        assert!(
            weak_span
                .reasons
                .iter()
                .any(|reason| reason.contains("reattached weak endpoint"))
        );
        assert!(!graph.vertices.iter().any(|vertex| {
            vertex.source_adapter == CandidateSourceAdapter::LegacyLowThreshold
                && distance(vertex.point, Point2::new(0.54, 0.5)) <= 1e-9
        }));
    }

    #[test]
    fn legacy_adapter_splits_lower_threshold_span_at_strong_junction() {
        let selected = square_program();
        let mut weak = selected.clone();
        let left = weak.vertices.len();
        weak.vertices.push(legacy_vertex_raw(
            left,
            Point2::new(0.0, 0.5),
            VertexKind::Boundary,
        ));
        let right = weak.vertices.len();
        weak.vertices.push(legacy_vertex_raw(
            right,
            Point2::new(1.0, 0.5),
            VertexKind::Boundary,
        ));
        weak.carriers.push(carrier_raw(
            weak.carriers.len(),
            Point2::new(0.0, 0.5),
            Point2::new(1.0, 0.5),
            AssignmentLabel::Mountain,
        ));
        weak.edges.push(CandidateEdge {
            id: weak.edges.len(),
            carrier_id: weak.carriers.len() - 1,
            vertices: [left, right],
            assignment: AssignmentCandidate {
                label: AssignmentLabel::Mountain,
                confidence: 0.55,
                margin: 0.10,
            },
            line_support: 0.35,
            style_support: 0.0,
            selection: EdgeSelection::Undecided,
            source: EvidenceSource::ObservedWeak,
            provenance: vec![Provenance::ObservedWeak],
        });

        let graph = LegacyCandidateAdapter::from_programs(
            &selected,
            Some(&weak),
            LegacyCandidateAdapterOptions {
                weak_span_split_tolerance: 0.01,
                weak_min_split_length: 0.02,
                ..LegacyCandidateAdapterOptions::default()
            },
        );

        let weak_spans = graph
            .crease_candidates
            .iter()
            .filter(|span| span.source_kind == CandidateCreaseSourceKind::LegacyLowThreshold)
            .collect::<Vec<_>>();
        assert_eq!(weak_spans.len(), 2);
        assert!(weak_spans.iter().all(|span| span.vertices.contains(&4)));
        assert!(weak_spans.iter().all(|span| {
            span.reasons
                .iter()
                .any(|reason| reason.contains("split weak span"))
        }));
    }

    #[test]
    fn legacy_adapter_ignores_lower_threshold_border_fragments() {
        let selected = square_program();
        let mut weak = selected.clone();
        let a = weak.vertices.len();
        weak.vertices.push(legacy_vertex_raw(
            a,
            Point2::new(0.0, 0.5),
            VertexKind::Boundary,
        ));
        let b = weak.vertices.len();
        weak.vertices.push(legacy_vertex_raw(
            b,
            Point2::new(1.0, 0.5),
            VertexKind::Boundary,
        ));
        weak.carriers.push(carrier_raw(
            weak.carriers.len(),
            Point2::new(0.0, 0.5),
            Point2::new(1.0, 0.5),
            AssignmentLabel::Boundary,
        ));
        weak.edges.push(CandidateEdge {
            id: weak.edges.len(),
            carrier_id: weak.carriers.len() - 1,
            vertices: [a, b],
            assignment: AssignmentCandidate {
                label: AssignmentLabel::Boundary,
                confidence: 0.55,
                margin: 0.10,
            },
            line_support: 0.35,
            style_support: 0.0,
            selection: EdgeSelection::Undecided,
            source: EvidenceSource::ObservedWeak,
            provenance: vec![Provenance::ObservedWeak],
        });
        let graph = LegacyCandidateAdapter::from_programs(
            &selected,
            Some(&weak),
            LegacyCandidateAdapterOptions::default(),
        );
        assert_eq!(graph.report.legacy_low_threshold_spans, 0);
        assert_eq!(graph.report.locked_border_spans, 4);
        assert_eq!(graph.crease_candidates.len(), selected.edges.len());
    }

    #[test]
    fn exact_solve_input_is_source_neutral() {
        let graph = LegacyCandidateAdapter::from_program(&square_program());
        let selected = SelectedGraph::from_selected_span_ids(&graph, vec![0, 1, 2, 3]);
        let input = ExactSolveInput::from_candidate_selection(&graph, &selected);
        assert_eq!(input.selected_spans.len(), 4);
        assert_eq!(input.boundary.corners, graph.boundary.corners);
        assert_eq!(
            input.provenance.source_adapter,
            CandidateSourceAdapter::Legacy
        );
    }

    #[test]
    fn exact_solve_input_reclassifies_unassigned_exterior_spans_as_paper_boundary_without_square() {
        let program = unassigned_cut_boundary_program();
        let graph = LegacyCandidateAdapter::from_program(&program);
        let selected = SelectedGraph::from_selected_span_ids(
            &graph,
            graph.crease_candidates.iter().map(|span| span.id).collect(),
        );
        let input = ExactSolveInput::from_candidate_selection(&graph, &selected);

        let boundary_source_edges = input
            .selected_spans
            .iter()
            .filter(|span| span.assignment_label() == AssignmentLabel::Boundary)
            .flat_map(|span| span.source_edge_ids.iter().copied())
            .collect::<BTreeSet<_>>();
        assert_eq!(boundary_source_edges, BTreeSet::from([0, 1, 2, 3]));
        for source_edge in [0, 1, 2, 3] {
            let span = input
                .selected_spans
                .iter()
                .find(|span| span.source_edge_ids == vec![source_edge])
                .expect("exterior source span should exist");
            assert_eq!(
                span.boundary_role(),
                CandidateCreaseBoundaryRole::PaperBoundary
            );
        }

        let interior_diagonal = input
            .selected_spans
            .iter()
            .find(|span| span.source_edge_ids == vec![4])
            .expect("interior unknown diagonal should still exist");
        assert_eq!(
            interior_diagonal.assignment_label(),
            AssignmentLabel::Unknown
        );
        assert!(
            !interior_diagonal
                .reasons
                .iter()
                .any(|reason| reason.contains("cut boundary"))
        );
    }

    #[test]
    fn exact_solve_input_marks_inner_useful_polygon_as_cut_boundary_when_square_exists() {
        let program = square_with_unassigned_exterior_like_program();
        let graph = LegacyCandidateAdapter::from_program(&program);
        let selected = SelectedGraph::from_selected_span_ids(
            &graph,
            graph.crease_candidates.iter().map(|span| span.id).collect(),
        );
        let input = ExactSolveInput::from_candidate_selection(&graph, &selected);

        let boundary_source_edges = input
            .selected_spans
            .iter()
            .filter(|span| span.assignment_label() == AssignmentLabel::Boundary)
            .flat_map(|span| span.source_edge_ids.iter().copied())
            .collect::<BTreeSet<_>>();
        assert_eq!(boundary_source_edges, BTreeSet::from([0, 1, 2, 3]));

        for source_edge in [4, 5, 6, 7] {
            let span = input
                .selected_spans
                .iter()
                .find(|span| span.source_edge_ids == vec![source_edge])
                .expect("unknown cut-like span should still exist");
            assert_eq!(span.assignment_label(), AssignmentLabel::Unknown);
            assert_eq!(
                span.boundary_role(),
                CandidateCreaseBoundaryRole::CutBoundary
            );
            assert!(
                span.reasons
                    .iter()
                    .any(|reason| reason.contains("paper-boundary-adjacent cut face"))
            );
        }
    }

    fn square_program() -> CandidateProgram {
        let vertices = vec![
            legacy_vertex_raw(0, Point2::new(0.0, 0.0), VertexKind::Corner),
            legacy_vertex_raw(1, Point2::new(1.0, 0.0), VertexKind::Corner),
            legacy_vertex_raw(2, Point2::new(1.0, 1.0), VertexKind::Corner),
            legacy_vertex_raw(3, Point2::new(0.0, 1.0), VertexKind::Corner),
            legacy_vertex_raw(4, Point2::new(0.5, 0.5), VertexKind::Interior),
        ];
        let edge_specs = [
            ([0, 1], AssignmentLabel::Boundary),
            ([1, 2], AssignmentLabel::Boundary),
            ([2, 3], AssignmentLabel::Boundary),
            ([3, 0], AssignmentLabel::Boundary),
            ([0, 4], AssignmentLabel::Mountain),
            ([4, 2], AssignmentLabel::Valley),
        ];
        let mut carriers = Vec::new();
        let mut edges = Vec::new();
        for (id, (edge_vertices, label)) in edge_specs.into_iter().enumerate() {
            let p0 = vertices[edge_vertices[0]].position;
            let p1 = vertices[edge_vertices[1]].position;
            carriers.push(carrier_raw(id, p0, p1, label));
            edges.push(CandidateEdge {
                id,
                carrier_id: id,
                vertices: edge_vertices,
                assignment: AssignmentCandidate {
                    label,
                    confidence: 0.95,
                    margin: 0.75,
                },
                line_support: 0.90,
                style_support: 0.0,
                selection: EdgeSelection::Selected,
                source: if label == AssignmentLabel::Boundary {
                    EvidenceSource::Border
                } else {
                    EvidenceSource::Legacy
                },
                provenance: vec![Provenance::LegacyDecoder],
            });
        }
        CandidateProgram {
            coordinate_space: "fold_normalized".to_owned(),
            image_size: Some(128),
            carriers,
            vertices,
            edges,
        }
    }

    fn square_with_unassigned_exterior_like_program() -> CandidateProgram {
        let vertices = vec![
            legacy_vertex_raw(0, Point2::new(0.0, 0.0), VertexKind::Corner),
            legacy_vertex_raw(1, Point2::new(1.0, 0.0), VertexKind::Corner),
            legacy_vertex_raw(2, Point2::new(1.0, 1.0), VertexKind::Corner),
            legacy_vertex_raw(3, Point2::new(0.0, 1.0), VertexKind::Corner),
            legacy_vertex_raw(4, Point2::new(0.25, 0.25), VertexKind::Interior),
            legacy_vertex_raw(5, Point2::new(0.50, 0.18), VertexKind::Interior),
            legacy_vertex_raw(6, Point2::new(0.75, 0.25), VertexKind::Interior),
            legacy_vertex_raw(7, Point2::new(0.50, 0.55), VertexKind::Interior),
        ];
        let edge_specs = [
            ([0, 1], AssignmentLabel::Boundary),
            ([1, 2], AssignmentLabel::Boundary),
            ([2, 3], AssignmentLabel::Boundary),
            ([3, 0], AssignmentLabel::Boundary),
            ([0, 4], AssignmentLabel::Unknown),
            ([4, 5], AssignmentLabel::Unknown),
            ([5, 6], AssignmentLabel::Unknown),
            ([6, 1], AssignmentLabel::Unknown),
            ([4, 7], AssignmentLabel::Mountain),
            ([6, 7], AssignmentLabel::Valley),
        ];
        let mut carriers = Vec::new();
        let mut edges = Vec::new();
        for (id, (edge_vertices, label)) in edge_specs.into_iter().enumerate() {
            let p0 = vertices[edge_vertices[0]].position;
            let p1 = vertices[edge_vertices[1]].position;
            carriers.push(carrier_raw(id, p0, p1, label));
            edges.push(CandidateEdge {
                id,
                carrier_id: id,
                vertices: edge_vertices,
                assignment: AssignmentCandidate {
                    label,
                    confidence: 0.90,
                    margin: 0.60,
                },
                line_support: 0.90,
                style_support: 0.0,
                selection: EdgeSelection::Selected,
                source: if label == AssignmentLabel::Boundary {
                    EvidenceSource::Border
                } else {
                    EvidenceSource::Legacy
                },
                provenance: vec![Provenance::LegacyDecoder],
            });
        }
        CandidateProgram {
            coordinate_space: "fold_normalized".to_owned(),
            image_size: Some(128),
            carriers,
            vertices,
            edges,
        }
    }

    fn unassigned_cut_boundary_program() -> CandidateProgram {
        let vertices = vec![
            legacy_vertex_raw(0, Point2::new(0.10, 0.20), VertexKind::Interior),
            legacy_vertex_raw(1, Point2::new(0.90, 0.10), VertexKind::Interior),
            legacy_vertex_raw(2, Point2::new(0.80, 0.90), VertexKind::Interior),
            legacy_vertex_raw(3, Point2::new(0.20, 0.80), VertexKind::Interior),
        ];
        let edge_specs = [
            ([0, 1], AssignmentLabel::Unknown),
            ([1, 2], AssignmentLabel::Unknown),
            ([2, 3], AssignmentLabel::Unknown),
            ([3, 0], AssignmentLabel::Unknown),
            ([0, 2], AssignmentLabel::Unknown),
        ];
        let mut carriers = Vec::new();
        let mut edges = Vec::new();
        for (id, (edge_vertices, label)) in edge_specs.into_iter().enumerate() {
            let p0 = vertices[edge_vertices[0]].position;
            let p1 = vertices[edge_vertices[1]].position;
            carriers.push(carrier_raw(id, p0, p1, label));
            edges.push(CandidateEdge {
                id,
                carrier_id: id,
                vertices: edge_vertices,
                assignment: AssignmentCandidate {
                    label,
                    confidence: 0.80,
                    margin: 0.50,
                },
                line_support: 0.90,
                style_support: 0.0,
                selection: EdgeSelection::Selected,
                source: EvidenceSource::Legacy,
                provenance: vec![Provenance::LegacyDecoder],
            });
        }
        CandidateProgram {
            coordinate_space: "fold_normalized".to_owned(),
            image_size: Some(128),
            carriers,
            vertices,
            edges,
        }
    }

    fn legacy_vertex_raw(id: usize, position: Point2, kind: VertexKind) -> LegacyVertex {
        LegacyVertex {
            id,
            position,
            kind,
            support: 1.0,
            boundary_side: None,
            incident_carriers: Vec::new(),
            provenance: vec![Provenance::LegacyDecoder],
        }
    }

    fn carrier_raw(id: usize, p0: Point2, p1: Point2, label: AssignmentLabel) -> CandidateCarrier {
        let dx = p1.x - p0.x;
        let dy = p1.y - p0.y;
        let length = (dx * dx + dy * dy).sqrt().max(1e-12);
        let normal = Point2::new(-dy / length, dx / length);
        CandidateCarrier {
            id,
            family: if label == AssignmentLabel::Boundary {
                CarrierFamily::Border
            } else {
                CarrierFamily::Free
            },
            normal,
            rho: normal.x * p0.x + normal.y * p0.y,
            support_interval: [0.0, length],
            visual_support: 1.0,
            dashed_support: 0.0,
            non_crease_penalty: 0.0,
            source: EvidenceSource::Legacy,
            provenance: vec![Provenance::LegacyDecoder],
        }
    }

    #[test]
    fn candidate_graph_can_be_loaded_from_fold_json() {
        let fold = json!({
            "vertices_coords": [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
            "edges_vertices": [[0, 1], [1, 2], [2, 3], [3, 0]],
            "edges_assignment": ["B", "B", "B", "B"]
        });
        let program = CandidateProgram::from_fold_value(&fold).expect("program");
        let graph = LegacyCandidateAdapter::from_program(&program);
        assert_eq!(graph.report.locked_border_spans, 4);
        assert_eq!(graph.boundary.sides.len(), 4);
    }
}

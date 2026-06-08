use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::{EvalAssignment, EvalGraph, EvalPoint};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CandidateCoverageOptions {
    pub vertex_tolerance: f64,
    pub relaxed_vertex_tolerance: f64,
    pub segment_distance_tolerance: f64,
    pub angle_tolerance_degrees: f64,
    pub carrier_distance_tolerance: f64,
    pub min_interval_overlap: f64,
    pub dense_support_threshold: f64,
    pub include_boundary_edges: bool,
}

impl Default for CandidateCoverageOptions {
    fn default() -> Self {
        Self {
            vertex_tolerance: 3.0,
            relaxed_vertex_tolerance: 8.0,
            segment_distance_tolerance: 6.0,
            angle_tolerance_degrees: 3.0,
            carrier_distance_tolerance: 6.0,
            min_interval_overlap: 0.85,
            dense_support_threshold: 0.45,
            include_boundary_edges: false,
        }
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CoverageDenseEvidence {
    pub available: bool,
    pub line_min: f64,
    pub line_mean: f64,
    pub line_max: f64,
    pub line_hit_fraction: f64,
    pub non_crease_mean: f64,
    pub non_crease_max: f64,
}

impl CoverageDenseEvidence {
    pub fn supported(self, threshold: f64) -> bool {
        !self.available || self.line_mean >= threshold || self.line_hit_fraction >= 0.50
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CoverageCandidate {
    pub id: String,
    pub endpoints: [EvalPoint; 2],
    pub assignment: EvalAssignment,
    pub selected: bool,
    pub source_kind: String,
    pub line_support: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CoverageCarrier {
    pub id: String,
    pub endpoints: [EvalPoint; 2],
    pub source_kind: String,
}

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct CoverageCandidateSet {
    pub name: String,
    pub vertices: Vec<EvalPoint>,
    pub carriers: Vec<CoverageCarrier>,
    pub candidates: Vec<CoverageCandidate>,
}

impl CoverageCandidateSet {
    pub fn empty(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            vertices: Vec::new(),
            carriers: Vec::new(),
            candidates: Vec::new(),
        }
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CoverageEndpointAvailability {
    pub a_strict: bool,
    pub b_strict: bool,
    pub both_strict: bool,
    pub a_relaxed: bool,
    pub b_relaxed: bool,
    pub both_relaxed: bool,
    pub nearest_a: Option<f64>,
    pub nearest_b: Option<f64>,
}

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct CoverageEdgeMatch {
    pub single_span: bool,
    pub chain: bool,
    pub overlong: bool,
    pub any: bool,
    pub assignment_match: bool,
    pub best_candidate_id: Option<String>,
    pub best_distance: Option<f64>,
    pub coverage_fraction: f64,
    pub candidate_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoverageRootCause {
    CandidateSelected,
    CandidateSelectedWrongAssignment,
    CandidateAvailableButRejected,
    CandidateChainAvailableButNotSelected,
    CandidateOverlongAvailableButNotSelected,
    LowThresholdFoundButAdapterLost,
    EdgeMissingDespiteAdapterEndpointAndCarrier,
    CarrierMissingFromAdapter,
    EndpointMissingFromAdapter,
    DenseEvidenceMissing,
    BoundarySkipped,
    Unknown,
}

impl Default for CoverageRootCause {
    fn default() -> Self {
        Self::Unknown
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GtEdgeCoverageRecord {
    pub gt_edge_id: usize,
    pub vertices: [usize; 2],
    pub assignment: EvalAssignment,
    pub dense: CoverageDenseEvidence,
    pub high_endpoints: CoverageEndpointAvailability,
    pub low_endpoints: CoverageEndpointAvailability,
    pub adapter_endpoints: CoverageEndpointAvailability,
    pub high_carrier_available: bool,
    pub low_carrier_available: bool,
    pub adapter_carrier_available: bool,
    pub high_match: CoverageEdgeMatch,
    pub low_match: CoverageEdgeMatch,
    pub adapter_match: CoverageEdgeMatch,
    pub selected_match: CoverageEdgeMatch,
    pub root_cause: CoverageRootCause,
}

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct CandidateCoverageSummary {
    pub gt_edges_total: usize,
    pub gt_edges_evaluated: usize,
    pub gt_boundary_edges_skipped: usize,
    pub dense_supported: usize,
    pub high_endpoint_available: usize,
    pub low_endpoint_available: usize,
    pub adapter_endpoint_available: usize,
    pub high_carrier_available: usize,
    pub low_carrier_available: usize,
    pub adapter_carrier_available: usize,
    pub high_single_span: usize,
    pub low_single_span: usize,
    pub adapter_single_span: usize,
    pub adapter_chain: usize,
    pub adapter_overlong: usize,
    pub adapter_any: usize,
    pub selected_single_span: usize,
    pub selected_chain: usize,
    pub selected_any: usize,
    pub selected_assignment_match: usize,
    pub candidate_oracle_recall: f64,
    pub selected_recall: f64,
    pub root_causes: BTreeMap<CoverageRootCause, usize>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CandidateCoverageReport {
    pub options: CandidateCoverageOptions,
    pub summary: CandidateCoverageSummary,
    pub per_gt_edge: Vec<GtEdgeCoverageRecord>,
}

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct CandidateCoverageAggregate {
    pub samples: usize,
    pub summary: CandidateCoverageSummary,
}

impl CandidateCoverageAggregate {
    pub fn add(&mut self, report: &CandidateCoverageReport) {
        self.samples += 1;
        self.summary.gt_edges_total += report.summary.gt_edges_total;
        self.summary.gt_edges_evaluated += report.summary.gt_edges_evaluated;
        self.summary.gt_boundary_edges_skipped += report.summary.gt_boundary_edges_skipped;
        self.summary.dense_supported += report.summary.dense_supported;
        self.summary.high_endpoint_available += report.summary.high_endpoint_available;
        self.summary.low_endpoint_available += report.summary.low_endpoint_available;
        self.summary.adapter_endpoint_available += report.summary.adapter_endpoint_available;
        self.summary.high_carrier_available += report.summary.high_carrier_available;
        self.summary.low_carrier_available += report.summary.low_carrier_available;
        self.summary.adapter_carrier_available += report.summary.adapter_carrier_available;
        self.summary.high_single_span += report.summary.high_single_span;
        self.summary.low_single_span += report.summary.low_single_span;
        self.summary.adapter_single_span += report.summary.adapter_single_span;
        self.summary.adapter_chain += report.summary.adapter_chain;
        self.summary.adapter_overlong += report.summary.adapter_overlong;
        self.summary.adapter_any += report.summary.adapter_any;
        self.summary.selected_single_span += report.summary.selected_single_span;
        self.summary.selected_chain += report.summary.selected_chain;
        self.summary.selected_any += report.summary.selected_any;
        self.summary.selected_assignment_match += report.summary.selected_assignment_match;
        for (cause, count) in &report.summary.root_causes {
            *self.summary.root_causes.entry(*cause).or_default() += count;
        }
        self.finalize();
    }

    pub fn finalize(&mut self) {
        self.summary.candidate_oracle_recall =
            ratio(self.summary.adapter_any, self.summary.gt_edges_evaluated);
        self.summary.selected_recall =
            ratio(self.summary.selected_any, self.summary.gt_edges_evaluated);
    }
}

pub fn candidate_coverage_metrics(
    ground_truth: &EvalGraph,
    dense_evidence: &[CoverageDenseEvidence],
    high: &CoverageCandidateSet,
    low: &CoverageCandidateSet,
    adapter: &CoverageCandidateSet,
    selected: &CoverageCandidateSet,
    options: CandidateCoverageOptions,
) -> CandidateCoverageReport {
    let mut per_gt_edge = Vec::new();
    let mut summary = CandidateCoverageSummary {
        gt_edges_total: ground_truth.edges.len(),
        ..CandidateCoverageSummary::default()
    };

    for (gt_edge_id, edge) in ground_truth.edges.iter().enumerate() {
        if !options.include_boundary_edges && edge.assignment == EvalAssignment::Boundary {
            summary.gt_boundary_edges_skipped += 1;
            continue;
        }
        let Some(gt_segment) = edge_segment(ground_truth, edge.vertices) else {
            continue;
        };
        summary.gt_edges_evaluated += 1;
        let dense = dense_evidence.get(gt_edge_id).copied().unwrap_or_default();
        let high_endpoints = endpoint_availability(high, gt_segment, options);
        let low_endpoints = endpoint_availability(low, gt_segment, options);
        let adapter_endpoints = endpoint_availability(adapter, gt_segment, options);
        let high_carrier_available = carrier_available(high, gt_segment, options);
        let low_carrier_available = carrier_available(low, gt_segment, options);
        let adapter_carrier_available = carrier_available(adapter, gt_segment, options);
        let high_match = edge_match(high, gt_segment, edge.assignment, options);
        let low_match = edge_match(low, gt_segment, edge.assignment, options);
        let adapter_match = edge_match(adapter, gt_segment, edge.assignment, options);
        let selected_match = edge_match(selected, gt_segment, edge.assignment, options);
        let root_cause = classify_root_cause(
            dense,
            adapter_endpoints,
            adapter_carrier_available,
            &low_match,
            &adapter_match,
            &selected_match,
            options,
        );

        summary.dense_supported += usize::from(dense.supported(options.dense_support_threshold));
        summary.high_endpoint_available += usize::from(high_endpoints.both_strict);
        summary.low_endpoint_available += usize::from(low_endpoints.both_strict);
        summary.adapter_endpoint_available += usize::from(adapter_endpoints.both_strict);
        summary.high_carrier_available += usize::from(high_carrier_available);
        summary.low_carrier_available += usize::from(low_carrier_available);
        summary.adapter_carrier_available += usize::from(adapter_carrier_available);
        summary.high_single_span += usize::from(high_match.single_span);
        summary.low_single_span += usize::from(low_match.single_span);
        summary.adapter_single_span += usize::from(adapter_match.single_span);
        summary.adapter_chain += usize::from(adapter_match.chain);
        summary.adapter_overlong += usize::from(adapter_match.overlong);
        summary.adapter_any += usize::from(adapter_match.any);
        summary.selected_single_span += usize::from(selected_match.single_span);
        summary.selected_chain += usize::from(selected_match.chain);
        summary.selected_any += usize::from(selected_match.any);
        summary.selected_assignment_match += usize::from(selected_match.assignment_match);
        *summary.root_causes.entry(root_cause).or_default() += 1;

        per_gt_edge.push(GtEdgeCoverageRecord {
            gt_edge_id,
            vertices: edge.vertices,
            assignment: edge.assignment,
            dense,
            high_endpoints,
            low_endpoints,
            adapter_endpoints,
            high_carrier_available,
            low_carrier_available,
            adapter_carrier_available,
            high_match,
            low_match,
            adapter_match,
            selected_match,
            root_cause,
        });
    }

    summary.candidate_oracle_recall = ratio(summary.adapter_any, summary.gt_edges_evaluated);
    summary.selected_recall = ratio(summary.selected_any, summary.gt_edges_evaluated);
    CandidateCoverageReport {
        options,
        summary,
        per_gt_edge,
    }
}

fn classify_root_cause(
    dense: CoverageDenseEvidence,
    adapter_endpoints: CoverageEndpointAvailability,
    adapter_carrier_available: bool,
    low_match: &CoverageEdgeMatch,
    adapter_match: &CoverageEdgeMatch,
    selected_match: &CoverageEdgeMatch,
    options: CandidateCoverageOptions,
) -> CoverageRootCause {
    if selected_match.any {
        return if selected_match.assignment_match {
            CoverageRootCause::CandidateSelected
        } else {
            CoverageRootCause::CandidateSelectedWrongAssignment
        };
    }
    if adapter_match.single_span {
        return CoverageRootCause::CandidateAvailableButRejected;
    }
    if adapter_match.chain {
        return CoverageRootCause::CandidateChainAvailableButNotSelected;
    }
    if adapter_match.overlong {
        return CoverageRootCause::CandidateOverlongAvailableButNotSelected;
    }
    if low_match.any && !adapter_match.any {
        return CoverageRootCause::LowThresholdFoundButAdapterLost;
    }
    if !dense.supported(options.dense_support_threshold) {
        return CoverageRootCause::DenseEvidenceMissing;
    }
    if !adapter_endpoints.both_relaxed {
        return CoverageRootCause::EndpointMissingFromAdapter;
    }
    if !adapter_carrier_available {
        return CoverageRootCause::CarrierMissingFromAdapter;
    }
    CoverageRootCause::EdgeMissingDespiteAdapterEndpointAndCarrier
}

fn endpoint_availability(
    candidate_set: &CoverageCandidateSet,
    gt_segment: [EvalPoint; 2],
    options: CandidateCoverageOptions,
) -> CoverageEndpointAvailability {
    let nearest_a = nearest_distance(&candidate_set.vertices, gt_segment[0]);
    let nearest_b = nearest_distance(&candidate_set.vertices, gt_segment[1]);
    let a_strict = nearest_a.is_some_and(|distance| distance <= options.vertex_tolerance);
    let b_strict = nearest_b.is_some_and(|distance| distance <= options.vertex_tolerance);
    let a_relaxed = nearest_a.is_some_and(|distance| distance <= options.relaxed_vertex_tolerance);
    let b_relaxed = nearest_b.is_some_and(|distance| distance <= options.relaxed_vertex_tolerance);
    CoverageEndpointAvailability {
        a_strict,
        b_strict,
        both_strict: a_strict && b_strict,
        a_relaxed,
        b_relaxed,
        both_relaxed: a_relaxed && b_relaxed,
        nearest_a,
        nearest_b,
    }
}

fn nearest_distance(points: &[EvalPoint], target: EvalPoint) -> Option<f64> {
    points
        .iter()
        .map(|point| distance(*point, target))
        .min_by(|left, right| left.total_cmp(right))
}

fn carrier_available(
    candidate_set: &CoverageCandidateSet,
    gt_segment: [EvalPoint; 2],
    options: CandidateCoverageOptions,
) -> bool {
    candidate_set
        .carriers
        .iter()
        .any(|carrier| line_like_match(carrier.endpoints, gt_segment, options, true))
}

fn edge_match(
    candidate_set: &CoverageCandidateSet,
    gt_segment: [EvalPoint; 2],
    gt_assignment: EvalAssignment,
    options: CandidateCoverageOptions,
) -> CoverageEdgeMatch {
    let mut best_distance = f64::INFINITY;
    let mut best_candidate_id = None;
    let mut assignment_match = false;
    let mut single_span = false;
    let mut overlong = false;
    let mut candidate_ids = Vec::new();
    let mut intervals = Vec::new();

    for candidate in &candidate_set.candidates {
        let endpoints = candidate.endpoints;
        if !line_like_match(endpoints, gt_segment, options, false) {
            continue;
        }
        let endpoint_distance = symmetric_endpoint_distance(endpoints, gt_segment);
        let overlap = interval_overlap_fraction(endpoints, gt_segment);
        if endpoint_distance < best_distance {
            best_distance = endpoint_distance;
            best_candidate_id = Some(candidate.id.clone());
        }
        if endpoint_distance <= options.vertex_tolerance {
            single_span = true;
            candidate_ids.push(candidate.id.clone());
            if assignment_compatible(candidate.assignment, gt_assignment) {
                assignment_match = true;
            }
        } else if covers_gt_interval(endpoints, gt_segment, options) {
            overlong = true;
            candidate_ids.push(candidate.id.clone());
        } else if overlap > 0.0 {
            intervals.push(projected_interval(endpoints, gt_segment));
            candidate_ids.push(candidate.id.clone());
        }
    }

    candidate_ids.sort();
    candidate_ids.dedup();
    let coverage_fraction = union_coverage_fraction(intervals, segment_length(gt_segment));
    let chain = !single_span && coverage_fraction >= options.min_interval_overlap;
    CoverageEdgeMatch {
        single_span,
        chain,
        overlong: !single_span && overlong,
        any: single_span || chain || overlong,
        assignment_match,
        best_candidate_id,
        best_distance: best_distance.is_finite().then_some(best_distance),
        coverage_fraction,
        candidate_ids,
    }
}

fn edge_segment(graph: &EvalGraph, vertices: [usize; 2]) -> Option<[EvalPoint; 2]> {
    Some([
        *graph.vertices.get(vertices[0])?,
        *graph.vertices.get(vertices[1])?,
    ])
}

fn line_like_match(
    candidate: [EvalPoint; 2],
    gt: [EvalPoint; 2],
    options: CandidateCoverageOptions,
    carrier: bool,
) -> bool {
    if segment_length(candidate) <= 1e-9 || segment_length(gt) <= 1e-9 {
        return false;
    }
    if angle_delta_degrees(candidate, gt) > options.angle_tolerance_degrees {
        return false;
    }
    let distance_tolerance = if carrier {
        options.carrier_distance_tolerance
    } else {
        options.segment_distance_tolerance
    };
    let line_distance =
        point_line_distance(gt[0], candidate).max(point_line_distance(gt[1], candidate));
    if line_distance > distance_tolerance {
        return false;
    }
    interval_overlap_fraction(candidate, gt) >= if carrier { 0.10 } else { 0.01 }
}

fn covers_gt_interval(
    candidate: [EvalPoint; 2],
    gt: [EvalPoint; 2],
    options: CandidateCoverageOptions,
) -> bool {
    let gt_len = segment_length(gt);
    if gt_len <= 1e-9 {
        return false;
    }
    let [min_t, max_t] = projected_interval(candidate, gt);
    min_t <= options.vertex_tolerance && max_t >= gt_len - options.vertex_tolerance
}

fn interval_overlap_fraction(candidate: [EvalPoint; 2], gt: [EvalPoint; 2]) -> f64 {
    let gt_len = segment_length(gt);
    if gt_len <= 1e-9 {
        return 0.0;
    }
    let [mut min_t, mut max_t] = projected_interval(candidate, gt);
    min_t = min_t.clamp(0.0, gt_len);
    max_t = max_t.clamp(0.0, gt_len);
    ((max_t - min_t).max(0.0) / gt_len).clamp(0.0, 1.0)
}

fn projected_interval(candidate: [EvalPoint; 2], gt: [EvalPoint; 2]) -> [f64; 2] {
    let direction = unit_direction(gt);
    let t0 = dot(sub(candidate[0], gt[0]), direction);
    let t1 = dot(sub(candidate[1], gt[0]), direction);
    [t0.min(t1), t0.max(t1)]
}

fn union_coverage_fraction(mut intervals: Vec<[f64; 2]>, gt_len: f64) -> f64 {
    if gt_len <= 1e-9 || intervals.is_empty() {
        return 0.0;
    }
    for interval in &mut intervals {
        interval[0] = interval[0].clamp(0.0, gt_len);
        interval[1] = interval[1].clamp(0.0, gt_len);
    }
    intervals.retain(|interval| interval[1] > interval[0]);
    intervals.sort_by(|left, right| left[0].total_cmp(&right[0]));
    let mut covered = 0.0;
    let mut current: Option<[f64; 2]> = None;
    for interval in intervals {
        match current {
            None => current = Some(interval),
            Some(mut active) if interval[0] <= active[1] => {
                active[1] = active[1].max(interval[1]);
                current = Some(active);
            }
            Some(active) => {
                covered += active[1] - active[0];
                current = Some(interval);
            }
        }
    }
    if let Some(active) = current {
        covered += active[1] - active[0];
    }
    (covered / gt_len).clamp(0.0, 1.0)
}

fn assignment_compatible(candidate: EvalAssignment, gt: EvalAssignment) -> bool {
    candidate == gt || candidate == EvalAssignment::Unknown || gt == EvalAssignment::Unknown
}

fn symmetric_endpoint_distance(left: [EvalPoint; 2], right: [EvalPoint; 2]) -> f64 {
    let same = distance(left[0], right[0]).max(distance(left[1], right[1]));
    let flipped = distance(left[0], right[1]).max(distance(left[1], right[0]));
    same.min(flipped)
}

fn angle_delta_degrees(left: [EvalPoint; 2], right: [EvalPoint; 2]) -> f64 {
    let left_angle = (left[1].y - left[0].y).atan2(left[1].x - left[0].x);
    let right_angle = (right[1].y - right[0].y).atan2(right[1].x - right[0].x);
    let diff = (left_angle - right_angle)
        .abs()
        .rem_euclid(std::f64::consts::PI);
    diff.min(std::f64::consts::PI - diff).to_degrees()
}

fn point_line_distance(point: EvalPoint, line: [EvalPoint; 2]) -> f64 {
    let len = segment_length(line);
    if len <= 1e-9 {
        return distance(point, line[0]);
    }
    let area2 = ((line[1].x - line[0].x) * (line[0].y - point.y)
        - (line[0].x - point.x) * (line[1].y - line[0].y))
        .abs();
    area2 / len
}

fn segment_length(segment: [EvalPoint; 2]) -> f64 {
    distance(segment[0], segment[1])
}

fn unit_direction(segment: [EvalPoint; 2]) -> EvalPoint {
    let len = segment_length(segment).max(1e-12);
    EvalPoint {
        x: (segment[1].x - segment[0].x) / len,
        y: (segment[1].y - segment[0].y) / len,
    }
}

fn sub(left: EvalPoint, right: EvalPoint) -> EvalPoint {
    EvalPoint {
        x: left.x - right.x,
        y: left.y - right.y,
    }
}

fn dot(left: EvalPoint, right: EvalPoint) -> f64 {
    left.x * right.x + left.y * right.y
}

fn distance(left: EvalPoint, right: EvalPoint) -> f64 {
    ((left.x - right.x).powi(2) + (left.y - right.y).powi(2)).sqrt()
}

fn ratio(numerator: usize, denominator: usize) -> f64 {
    if denominator == 0 {
        0.0
    } else {
        numerator as f64 / denominator as f64
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{EvalEdge, EvalGraph};

    fn gt() -> EvalGraph {
        EvalGraph::new(
            vec![EvalPoint::new(0.0, 0.0), EvalPoint::new(10.0, 0.0)],
            vec![EvalEdge::new([0, 1], EvalAssignment::Mountain)],
        )
    }

    fn set(candidates: Vec<CoverageCandidate>) -> CoverageCandidateSet {
        CoverageCandidateSet {
            name: "test".to_owned(),
            vertices: candidates
                .iter()
                .flat_map(|candidate| candidate.endpoints)
                .collect(),
            carriers: candidates
                .iter()
                .map(|candidate| CoverageCarrier {
                    id: candidate.id.clone(),
                    endpoints: candidate.endpoints,
                    source_kind: candidate.source_kind.clone(),
                })
                .collect(),
            candidates,
        }
    }

    fn candidate(id: &str, a: [f64; 2], b: [f64; 2], selected: bool) -> CoverageCandidate {
        CoverageCandidate {
            id: id.to_owned(),
            endpoints: [a.into(), b.into()],
            assignment: EvalAssignment::Mountain,
            selected,
            source_kind: "test".to_owned(),
            line_support: 1.0,
        }
    }

    #[test]
    fn selected_single_span_counts_as_selected() {
        let graph = gt();
        let selected = set(vec![candidate("a", [0.0, 0.0], [10.0, 0.0], true)]);
        let report = candidate_coverage_metrics(
            &graph,
            &[],
            &CoverageCandidateSet::empty("high"),
            &selected,
            &selected,
            &selected,
            CandidateCoverageOptions::default(),
        );
        assert_eq!(report.summary.selected_any, 1);
        assert_eq!(
            report.per_gt_edge[0].root_cause,
            CoverageRootCause::CandidateSelected
        );
    }

    #[test]
    fn fragmented_chain_counts_as_oracle_coverage() {
        let graph = gt();
        let adapter = set(vec![
            candidate("a", [0.0, 0.0], [4.0, 0.0], false),
            candidate("b", [4.0, 0.0], [10.0, 0.0], false),
        ]);
        let report = candidate_coverage_metrics(
            &graph,
            &[],
            &CoverageCandidateSet::empty("high"),
            &adapter,
            &adapter,
            &CoverageCandidateSet::empty("selected"),
            CandidateCoverageOptions::default(),
        );
        assert_eq!(report.summary.adapter_chain, 1);
        assert_eq!(report.summary.adapter_any, 1);
        assert_eq!(
            report.per_gt_edge[0].root_cause,
            CoverageRootCause::CandidateChainAvailableButNotSelected
        );
    }

    #[test]
    fn low_found_adapter_missing_is_attributed() {
        let graph = gt();
        let low = set(vec![candidate("low", [0.0, 0.0], [10.0, 0.0], false)]);
        let report = candidate_coverage_metrics(
            &graph,
            &[],
            &CoverageCandidateSet::empty("high"),
            &low,
            &CoverageCandidateSet::empty("adapter"),
            &CoverageCandidateSet::empty("selected"),
            CandidateCoverageOptions::default(),
        );
        assert_eq!(
            report.per_gt_edge[0].root_cause,
            CoverageRootCause::LowThresholdFoundButAdapterLost
        );
    }
}

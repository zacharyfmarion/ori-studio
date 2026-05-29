//! Compiler V2 dense-output adapter.
//!
//! This module is the Phase 0 cordon for the compiler-native path. It may use
//! public decoder API types at the boundary, but it must not import the old
//! decoder implementation or graph snapshots.

use crate::decode::{DecodeConfig, DecodeError, DenseOutputs};
use crate::evidence_extract::{
    CompilerEvidence, DenseOutputRefs, EvidenceExtractionConfig, EvidenceExtractionError,
    LinePrimitive, PrimitiveSource, extract_compiler_evidence,
};
use oristudio_cp_compiler::{
    AssignmentCandidate, AssignmentLabel, CandidateCarrier, CandidateEdge, CandidateProgram,
    CandidateVertex, CarrierFamily, EdgeSelection, EvidenceSource, Point2, Provenance, VertexKind,
};
use std::time::Instant;

pub(crate) struct CompilerV2Seed {
    pub program: CandidateProgram,
    pub evidence: CompilerEvidence,
}

pub(crate) fn candidate_program_from_dense_outputs_v2(
    outputs: DenseOutputs<'_>,
    config: DecodeConfig,
) -> Result<CompilerV2Seed, DecodeError> {
    let evidence_started = Instant::now();
    let mut evidence = extract_compiler_evidence(
        DenseOutputRefs {
            line_logits: outputs.line_logits,
            junction_logits: outputs.junction_logits,
            assignment_logits: outputs.assignment_logits,
            non_crease_logits: outputs.non_crease_logits,
            line_style_logits: outputs.line_style_logits,
            boundary_contact_logits: outputs.boundary_contact_logits,
        },
        compiler_v2_evidence_config(&config),
    )
    .map_err(evidence_error_to_decode_error)?;
    evidence.report.extraction_seconds = evidence_started.elapsed().as_secs_f64();
    let mut program = program_from_compiler_evidence(&evidence, &config);
    rebuild_incident_carriers(&mut program);
    Ok(CompilerV2Seed { program, evidence })
}

fn compiler_v2_evidence_config(config: &DecodeConfig) -> EvidenceExtractionConfig {
    EvidenceExtractionConfig {
        image_size: config.image_size,
        line_threshold: (config.threshold * 0.55).max(0.10).min(config.threshold),
        strong_line_support: config.min_edge_support,
        min_line_length_px: config.min_edge_length_px,
        edge_sample_step_px: config.edge_sample_step_px,
        assignment_min_confidence: config.assignment_min_confidence,
        hough_vote_threshold: ((config.hough_vote_threshold as f32 * 0.60).round() as u32)
            .max(1)
            .min(config.hough_vote_threshold.max(1)),
        hough_min_segment_length_px: config.hough_min_segment_length_px,
        hough_max_segment_gap_px: config.hough_max_segment_gap_px,
        max_line_primitives: config.max_line_hypotheses.max(360),
        max_junction_primitives: config.max_intersection_lines.max(240),
        max_boundary_contact_primitives: config.max_intersection_lines.max(240),
        primitive_nms_radius_px: config.junction_snap_px.max(2.0),
    }
}

fn evidence_error_to_decode_error(error: EvidenceExtractionError) -> DecodeError {
    match error {
        EvidenceExtractionError::InvalidImageSize(size) => DecodeError::InvalidImageSize(size),
        EvidenceExtractionError::TensorLength {
            name,
            expected,
            actual,
        } => DecodeError::TensorLength {
            name,
            expected,
            actual,
        },
        EvidenceExtractionError::Hough(error) => DecodeError::Hough(error),
    }
}

fn program_from_compiler_evidence(
    evidence: &CompilerEvidence,
    config: &DecodeConfig,
) -> CandidateProgram {
    let mut program = CandidateProgram {
        coordinate_space: "fold_normalized".to_owned(),
        image_size: Some(config.image_size),
        carriers: Vec::new(),
        vertices: Vec::new(),
        edges: Vec::new(),
    };
    for primitive in &evidence.line_primitives {
        push_line_primitive(&mut program, primitive, config);
    }
    program
}

fn push_line_primitive(
    program: &mut CandidateProgram,
    primitive: &LinePrimitive,
    config: &DecodeConfig,
) {
    let start = normalize_point(primitive.p0, config.image_size);
    let end = normalize_point(primitive.p1, config.image_size);
    if distance(start, end) < px_to_unit(config, config.min_edge_length_px) {
        return;
    }
    let a = upsert_point_vertex(program, start, primitive.support, primitive.source, config);
    let b = upsert_point_vertex(program, end, primitive.support, primitive.source, config);
    if a == b || edge_exists(program, a, b, start, end, config) {
        return;
    }
    let label = assignment_from_u8(primitive.assignment.label);
    let source = primitive_evidence_source(primitive);
    let provenance = edge_provenance(source, label);
    let selection = if primitive.source == PrimitiveSource::ObservedStrong {
        EdgeSelection::Selected
    } else {
        EdgeSelection::Undecided
    };
    let carrier_id = next_carrier_id(program);
    let edge_id = next_edge_id(program);
    let normal = line_normal(start, end);
    program.carriers.push(CandidateCarrier {
        id: carrier_id,
        family: carrier_family(start, end, label),
        normal,
        rho: normal.x * start.x + normal.y * start.y,
        support_interval: support_interval(start, end),
        visual_support: f64::from(primitive.support.clamp(0.0, 1.0)),
        dashed_support: f64::from(primitive.style.dashed_or_gapped_support.clamp(0.0, 1.0)),
        non_crease_penalty: 0.0,
        source,
        provenance: provenance.clone(),
    });
    program.edges.push(CandidateEdge {
        id: edge_id,
        carrier_id,
        vertices: [a, b],
        assignment: AssignmentCandidate {
            label,
            confidence: f64::from(primitive.assignment.confidence.clamp(0.0, 1.0)),
            margin: f64::from(primitive.assignment.margin.clamp(0.0, 1.0)),
        },
        line_support: f64::from(primitive.support.clamp(0.0, 1.0)),
        style_support: f64::from(primitive.style.dashed_or_gapped_support.clamp(0.0, 1.0)),
        selection,
        source,
        provenance,
    });
}

fn upsert_point_vertex(
    program: &mut CandidateProgram,
    point: Point2,
    support: f32,
    source: PrimitiveSource,
    config: &DecodeConfig,
) -> usize {
    let tolerance = px_to_unit(config, config.vertex_merge_px + 1.0);
    if let Some(index) = program
        .vertices
        .iter()
        .position(|item| distance(item.position, point) <= tolerance)
    {
        if let Some(vertex) = program.vertices.get_mut(index) {
            vertex.support = vertex.support.max(f64::from(support.clamp(0.0, 1.0)));
        }
        return index;
    }
    let id = program.vertices.len();
    let provenance = match source {
        PrimitiveSource::ObservedStrong => vec![Provenance::ObservedStrong],
        PrimitiveSource::ObservedWeak => vec![Provenance::ObservedWeak],
    };
    program.vertices.push(CandidateVertex {
        id,
        position: point,
        kind: vertex_kind(point, tolerance),
        support: f64::from(support.clamp(0.0, 1.0)),
        boundary_side: boundary_side(point, tolerance).map(str::to_owned),
        incident_carriers: Vec::new(),
        provenance,
    });
    id
}

fn primitive_evidence_source(primitive: &LinePrimitive) -> EvidenceSource {
    if primitive.assignment.label == 2 {
        EvidenceSource::Border
    } else if primitive.source == PrimitiveSource::ObservedStrong {
        EvidenceSource::ObservedStrong
    } else {
        EvidenceSource::ObservedWeak
    }
}

fn edge_exists(
    program: &CandidateProgram,
    start_index: usize,
    end_index: usize,
    start: Point2,
    end: Point2,
    config: &DecodeConfig,
) -> bool {
    let tolerance = px_to_unit(config, config.vertex_merge_px).max(1e-6);
    program.edges.iter().any(|edge| {
        let [a, b] = edge.vertices;
        if (a == start_index && b == end_index) || (a == end_index && b == start_index) {
            return true;
        }
        let Some(edge_start) = program.vertices.get(a).map(|vertex| vertex.position) else {
            return false;
        };
        let Some(edge_end) = program.vertices.get(b).map(|vertex| vertex.position) else {
            return false;
        };
        segments_match(start, end, edge_start, edge_end, tolerance)
    })
}

fn segments_match(
    left_start: Point2,
    left_end: Point2,
    right_start: Point2,
    right_end: Point2,
    tolerance: f64,
) -> bool {
    let forward = distance(left_start, right_start) <= tolerance
        && distance(left_end, right_end) <= tolerance;
    let reverse = distance(left_start, right_end) <= tolerance
        && distance(left_end, right_start) <= tolerance;
    forward || reverse
}

fn edge_provenance(source: EvidenceSource, label: AssignmentLabel) -> Vec<Provenance> {
    if label == AssignmentLabel::Boundary {
        vec![Provenance::BorderPrior]
    } else if source == EvidenceSource::ObservedStrong {
        vec![Provenance::ObservedStrong]
    } else {
        vec![Provenance::ObservedWeak]
    }
}

fn assignment_from_u8(value: u8) -> AssignmentLabel {
    match value {
        0 => AssignmentLabel::Mountain,
        1 => AssignmentLabel::Valley,
        2 => AssignmentLabel::Boundary,
        _ => AssignmentLabel::Unknown,
    }
}

fn carrier_family(start: Point2, end: Point2, assignment: AssignmentLabel) -> CarrierFamily {
    if assignment == AssignmentLabel::Boundary {
        return CarrierFamily::Border;
    }
    let dx = (end.x - start.x).abs();
    let dy = (end.y - start.y).abs();
    if dy <= 1e-6 {
        CarrierFamily::Horizontal
    } else if dx <= 1e-6 {
        CarrierFamily::Vertical
    } else if (dx - dy).abs() <= 1e-3 {
        if (end.x - start.x) * (end.y - start.y) >= 0.0 {
            CarrierFamily::DiagonalPositive
        } else {
            CarrierFamily::DiagonalNegative
        }
    } else {
        CarrierFamily::Free
    }
}

fn vertex_kind(point: Point2, tolerance: f64) -> VertexKind {
    let on_vertical = point.x <= tolerance || (point.x - 1.0).abs() <= tolerance;
    let on_horizontal = point.y <= tolerance || (point.y - 1.0).abs() <= tolerance;
    if on_vertical && on_horizontal {
        VertexKind::Corner
    } else if on_vertical || on_horizontal {
        VertexKind::Boundary
    } else {
        VertexKind::Interior
    }
}

fn boundary_side(point: Point2, tolerance: f64) -> Option<&'static str> {
    if point.y <= tolerance {
        Some("top")
    } else if (point.x - 1.0).abs() <= tolerance {
        Some("right")
    } else if (point.y - 1.0).abs() <= tolerance {
        Some("bottom")
    } else if point.x <= tolerance {
        Some("left")
    } else {
        None
    }
}

fn normalize_point(point: [f32; 2], image_size: u32) -> Point2 {
    let max = f64::from(image_size.saturating_sub(1).max(1));
    Point2::new(
        (f64::from(point[0]) / max).clamp(0.0, 1.0),
        (f64::from(point[1]) / max).clamp(0.0, 1.0),
    )
}

fn line_normal(start: Point2, end: Point2) -> Point2 {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let length = (dx * dx + dy * dy).sqrt().max(1e-12);
    Point2::new(-dy / length, dx / length)
}

fn support_interval(start: Point2, end: Point2) -> [f64; 2] {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let length = (dx * dx + dy * dy).sqrt().max(1e-12);
    let t0 = start.x * dx / length + start.y * dy / length;
    let t1 = end.x * dx / length + end.y * dy / length;
    [t0.min(t1), t0.max(t1)]
}

fn rebuild_incident_carriers(program: &mut CandidateProgram) {
    for vertex in &mut program.vertices {
        vertex.incident_carriers.clear();
    }
    for edge in &program.edges {
        if edge.selection == EdgeSelection::Rejected {
            continue;
        }
        for vertex_index in edge.vertices {
            if let Some(vertex) = program.vertices.get_mut(vertex_index) {
                vertex.incident_carriers.push(edge.carrier_id);
            }
        }
    }
}

fn next_carrier_id(program: &CandidateProgram) -> usize {
    program
        .carriers
        .iter()
        .map(|carrier| carrier.id)
        .max()
        .map(|id| id + 1)
        .unwrap_or(0)
}

fn next_edge_id(program: &CandidateProgram) -> usize {
    program
        .edges
        .iter()
        .map(|edge| edge.id)
        .max()
        .map(|id| id + 1)
        .unwrap_or(0)
}

fn px_to_unit(config: &DecodeConfig, px: f32) -> f64 {
    f64::from(px) / f64::from(config.image_size.saturating_sub(1).max(1))
}

fn distance(left: Point2, right: Point2) -> f64 {
    ((left.x - right.x).powi(2) + (left.y - right.y).powi(2)).sqrt()
}

#[cfg(test)]
mod tests {
    #[test]
    fn v2_adapter_does_not_import_old_decoder_implementation() {
        let source = include_str!("compiler_decode_v2.rs");
        assert!(!source.contains(&format!("crate::{}", "legacy_decode")));
        assert!(!source.contains(&format!("super::{}", "legacy_decode")));
    }
}

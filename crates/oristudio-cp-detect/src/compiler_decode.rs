use crate::legacy_decode::{
    DecodeConfig, DecodeEdgeStageSnapshot, DecodeError, DenseOutputs, StageEdge, StageVertex,
    decode_edge_stage_snapshot_from_maps,
};
use oristudio_cp_compiler::{
    AssignmentCandidate, AssignmentLabel, CandidateCarrier, CandidateEdge, CandidateProgram,
    CandidateVertex, CarrierFamily, EdgeSelection, EvidenceSource, Point2, Provenance, VertexKind,
};

pub(crate) fn candidate_program_from_dense_outputs(
    outputs: DenseOutputs<'_>,
    config: DecodeConfig,
) -> Result<CandidateProgram, DecodeError> {
    let selected = edge_snapshot_from_outputs(outputs, config.clone())?;
    let mut program = program_from_snapshot(&selected, &config, EdgeSelection::Selected);

    let evidence_config = compiler_evidence_config(&config);
    let evidence = edge_snapshot_from_outputs(outputs, evidence_config.clone())?;
    append_snapshot_edges(
        &mut program,
        &evidence,
        &evidence_config,
        EdgeSelection::Undecided,
    );
    rebuild_incident_carriers(&mut program);
    Ok(program)
}

fn edge_snapshot_from_outputs(
    outputs: DenseOutputs<'_>,
    config: DecodeConfig,
) -> Result<DecodeEdgeStageSnapshot, DecodeError> {
    let size = config.image_size as usize;
    if size < 8 {
        return Err(DecodeError::InvalidImageSize(config.image_size));
    }
    let effective = effective_line_prob(outputs, &config);
    let line_mask = hough_mask(&effective, &config);
    let junction_heatmap = sigmoid_map(outputs.junction_logits);
    let boundary_contact_heatmap = sigmoid_map(outputs.boundary_contact_logits);
    let assignment_labels = assignment_labels_from_logits(
        outputs.line_logits,
        outputs.assignment_logits,
        size,
        config.threshold,
    );
    let line_style_prob = line_style_prob_from_logits(outputs.line_style_logits, size);
    decode_edge_stage_snapshot_from_maps(
        &line_mask,
        &effective,
        &junction_heatmap,
        Some(&boundary_contact_heatmap),
        Some(&assignment_labels),
        Some(&line_style_prob),
        config.image_size,
        config,
    )
}

fn program_from_snapshot(
    snapshot: &DecodeEdgeStageSnapshot,
    config: &DecodeConfig,
    selection: EdgeSelection,
) -> CandidateProgram {
    let mut program = CandidateProgram {
        coordinate_space: "fold_normalized".to_owned(),
        image_size: Some(config.image_size),
        carriers: Vec::new(),
        vertices: snapshot
            .vertices_after_drop
            .iter()
            .enumerate()
            .map(|(index, vertex)| candidate_vertex(index, vertex, config))
            .collect(),
        edges: Vec::new(),
    };
    append_stage_edges(
        &mut program,
        &snapshot.vertices_after_drop,
        &snapshot.interior_edges,
        config,
        selection,
    );
    program
}

fn append_snapshot_edges(
    program: &mut CandidateProgram,
    snapshot: &DecodeEdgeStageSnapshot,
    config: &DecodeConfig,
    selection: EdgeSelection,
) {
    let mut local_to_program = Vec::with_capacity(snapshot.vertices_after_drop.len());
    for vertex in &snapshot.vertices_after_drop {
        local_to_program.push(upsert_vertex(program, vertex, config));
    }

    for edge in &snapshot.interior_edges {
        let Some(&a) = local_to_program.get(edge.vertices[0]) else {
            continue;
        };
        let Some(&b) = local_to_program.get(edge.vertices[1]) else {
            continue;
        };
        if a == b {
            continue;
        }
        let Some(start) = program.vertices.get(a).map(|vertex| vertex.position) else {
            continue;
        };
        let Some(end) = program.vertices.get(b).map(|vertex| vertex.position) else {
            continue;
        };
        if edge_exists(program, a, b, start, end, config) {
            continue;
        }
        push_candidate_edge(program, a, b, edge, config, selection);
    }
}

fn append_stage_edges(
    program: &mut CandidateProgram,
    vertices: &[StageVertex],
    edges: &[StageEdge],
    config: &DecodeConfig,
    selection: EdgeSelection,
) {
    for edge in edges {
        let Some(start_vertex) = vertices.get(edge.vertices[0]) else {
            continue;
        };
        let Some(end_vertex) = vertices.get(edge.vertices[1]) else {
            continue;
        };
        let start = normalize_point(start_vertex.point, config.image_size);
        let end = normalize_point(end_vertex.point, config.image_size);
        if distance(start, end) < px_to_unit(config, config.min_edge_length_px) {
            continue;
        }
        push_vertex_if_missing(program, edge.vertices[0], start_vertex, config);
        push_vertex_if_missing(program, edge.vertices[1], end_vertex, config);
        if edge_exists(
            program,
            edge.vertices[0],
            edge.vertices[1],
            start,
            end,
            config,
        ) {
            continue;
        }
        push_candidate_edge(
            program,
            edge.vertices[0],
            edge.vertices[1],
            edge,
            config,
            selection,
        );
    }
}

fn push_vertex_if_missing(
    program: &mut CandidateProgram,
    expected_index: usize,
    vertex: &StageVertex,
    config: &DecodeConfig,
) {
    if expected_index < program.vertices.len() {
        return;
    }
    let point = normalize_point(vertex.point, config.image_size);
    while program.vertices.len() < expected_index {
        let id = program.vertices.len();
        program.vertices.push(CandidateVertex {
            id,
            position: Point2::new(0.0, 0.0),
            kind: VertexKind::Interior,
            support: 0.0,
            boundary_side: None,
            incident_carriers: Vec::new(),
            provenance: vec![Provenance::ObservedWeak],
        });
    }
    program
        .vertices
        .push(candidate_vertex(expected_index, vertex, config));
    if let Some(item) = program.vertices.get_mut(expected_index) {
        item.position = point;
    }
}

fn upsert_vertex(
    program: &mut CandidateProgram,
    vertex: &StageVertex,
    config: &DecodeConfig,
) -> usize {
    let point = normalize_point(vertex.point, config.image_size);
    let tolerance = px_to_unit(config, config.vertex_merge_px + 1.0);
    if let Some(index) = program
        .vertices
        .iter()
        .position(|item| distance(item.position, point) <= tolerance)
    {
        return index;
    }
    let id = program.vertices.len();
    program.vertices.push(candidate_vertex(id, vertex, config));
    id
}

fn candidate_vertex(id: usize, vertex: &StageVertex, config: &DecodeConfig) -> CandidateVertex {
    let position = normalize_point(vertex.point, config.image_size);
    let tolerance = px_to_unit(config, config.vertex_merge_px + 1.0);
    CandidateVertex {
        id,
        position,
        kind: vertex_kind(position, tolerance),
        support: 1.0,
        boundary_side: boundary_side(position, tolerance).map(str::to_owned),
        incident_carriers: Vec::new(),
        provenance: vec![Provenance::ObservedStrong],
    }
}

fn push_candidate_edge(
    program: &mut CandidateProgram,
    a: usize,
    b: usize,
    edge: &StageEdge,
    config: &DecodeConfig,
    selection: EdgeSelection,
) {
    let Some(start) = program.vertices.get(a).map(|vertex| vertex.position) else {
        return;
    };
    let Some(end) = program.vertices.get(b).map(|vertex| vertex.position) else {
        return;
    };
    let label = assignment_from_u8(edge.assignment);
    let source = edge_source(edge, config);
    let provenance = edge_provenance(source, label);
    let carrier_id = next_carrier_id(program);
    let edge_id = next_edge_id(program);
    let normal = line_normal(start, end);
    program.carriers.push(CandidateCarrier {
        id: carrier_id,
        family: carrier_family(start, end, label),
        normal,
        rho: normal.x * start.x + normal.y * start.y,
        support_interval: support_interval(start, end),
        visual_support: f64::from(edge.support.clamp(0.0, 1.0)),
        dashed_support: 0.0,
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
            confidence: f64::from(edge.support.clamp(0.0, 1.0)),
            margin: 0.0,
        },
        line_support: f64::from(edge.support.clamp(0.0, 1.0)),
        style_support: 0.0,
        selection,
        source,
        provenance,
    });
}

fn compiler_evidence_config(config: &DecodeConfig) -> DecodeConfig {
    let mut next = config.clone();
    next.threshold = (config.threshold * 0.55).max(0.10).min(config.threshold);
    next.min_edge_support = (config.min_edge_support * 0.50)
        .max(0.12)
        .min(config.min_edge_support);
    next.hough_vote_threshold = ((config.hough_vote_threshold as f32 * 0.60).round() as u32)
        .max(1)
        .min(config.hough_vote_threshold.max(1));
    next.max_line_hypotheses = config.max_line_hypotheses.max(360);
    next.max_intersection_lines = config.max_intersection_lines.max(240);
    next
}

fn effective_line_prob(outputs: DenseOutputs<'_>, config: &DecodeConfig) -> Vec<f32> {
    if let Some(values) = outputs.line_probability_override {
        return values.iter().map(|value| value.clamp(0.0, 1.0)).collect();
    }
    outputs
        .line_logits
        .iter()
        .zip(outputs.non_crease_logits.iter())
        .map(|(line, non_crease)| {
            let mut prob = sigmoid(*line);
            let non_crease_prob = sigmoid(*non_crease);
            if non_crease_prob >= 0.65 && prob < 0.85 {
                prob *= 0.15;
            }
            if prob < config.threshold * 0.25 {
                0.0
            } else {
                prob
            }
        })
        .collect()
}

fn sigmoid_map(values: &[f32]) -> Vec<f32> {
    values.iter().map(|value| sigmoid(*value)).collect()
}

fn hough_mask(line_prob: &[f32], config: &DecodeConfig) -> Vec<u8> {
    let size = config.image_size as usize;
    let mut mask = vec![0u8; size * size];
    for (idx, score) in line_prob.iter().copied().enumerate() {
        if score >= config.threshold {
            mask[idx] = 255;
        }
    }
    mask
}

fn line_style_prob_from_logits(line_style_logits: &[f32], size: usize) -> Vec<f32> {
    let pixels = size * size;
    let mut prob = vec![0.0; pixels * 4];
    for idx in 0..pixels {
        let mut max_value = f32::NEG_INFINITY;
        for channel in 0..4 {
            max_value = max_value.max(line_style_logits[channel * pixels + idx]);
        }
        let mut denom = 0.0;
        for channel in 0..4 {
            denom += (line_style_logits[channel * pixels + idx] - max_value).exp();
        }
        if denom <= 0.0 {
            continue;
        }
        for channel in 0..4 {
            prob[idx * 4 + channel] =
                (line_style_logits[channel * pixels + idx] - max_value).exp() / denom;
        }
    }
    prob
}

fn assignment_labels_from_logits(
    line_logits: &[f32],
    assignment_logits: &[f32],
    size: usize,
    line_threshold: f32,
) -> Vec<u8> {
    let pixels = size * size;
    let mut labels = vec![0u8; pixels];
    for idx in 0..pixels {
        if sigmoid(line_logits[idx]) < line_threshold {
            continue;
        }
        labels[idx] = argmax_channel(assignment_logits, 4, idx, pixels) as u8 + 1;
    }
    labels
}

fn argmax_channel(values: &[f32], channels: usize, idx: usize, pixels: usize) -> usize {
    let mut best = 0usize;
    let mut best_value = f32::NEG_INFINITY;
    for channel in 0..channels {
        let value = values[channel * pixels + idx];
        if value > best_value {
            best_value = value;
            best = channel;
        }
    }
    best
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

fn edge_source(edge: &StageEdge, config: &DecodeConfig) -> EvidenceSource {
    if edge.assignment == 2 {
        EvidenceSource::Border
    } else if edge.support >= config.min_edge_support {
        EvidenceSource::ObservedStrong
    } else {
        EvidenceSource::ObservedWeak
    }
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

fn sigmoid(value: f32) -> f32 {
    1.0 / (1.0 + (-value).exp())
}

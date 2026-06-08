use crate::{
    AssignmentCandidate, AssignmentLabel, CandidateCarrier, CandidateEdge, CandidateProgram,
    CandidateVertex, CarrierFamily, EdgeSelection, EvidenceSource, Point2, Provenance, VertexKind,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct LockedBorderOptions {
    pub min_edge_length_px: f64,
    pub max_snap_drift_px: f64,
    pub min_selected_edge_support: f64,
}

impl Default for LockedBorderOptions {
    fn default() -> Self {
        Self {
            min_edge_length_px: 3.0,
            max_snap_drift_px: 6.0,
            min_selected_edge_support: 0.35,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LockedBorderProgram {
    pub program: CandidateProgram,
    pub report: LockedBorderReport,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LockedBorderReport {
    pub old_selected_border_edges: usize,
    pub new_border_edges: usize,
    pub boundary_contact_vertices: usize,
    pub inserted_corner_vertices: usize,
    pub removed_frame_edges: usize,
    pub downgraded_off_frame_border_edges: usize,
    pub snap_rejected_for_drift: usize,
    pub max_drift_px: f64,
    pub tolerance_px: f64,
    pub frame: [f64; 4],
    pub reused_existing_clean_border: bool,
    pub reconstructed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Side {
    Top,
    Right,
    Bottom,
    Left,
}

#[derive(Debug, Clone, Copy)]
struct BorderFrame {
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
}

impl BorderFrame {
    fn unit() -> Self {
        Self {
            min_x: 0.0,
            min_y: 0.0,
            max_x: 1.0,
            max_y: 1.0,
        }
    }

    fn width(self) -> f64 {
        (self.max_x - self.min_x).max(1e-9)
    }

    fn height(self) -> f64 {
        (self.max_y - self.min_y).max(1e-9)
    }

    fn side_length(self) -> f64 {
        self.width().max(self.height())
    }

    fn as_array(self) -> [f64; 4] {
        [self.min_x, self.min_y, self.max_x, self.max_y]
    }
}

#[derive(Debug, Default)]
struct SideVertices {
    top: Vec<usize>,
    right: Vec<usize>,
    bottom: Vec<usize>,
    left: Vec<usize>,
}

impl SideVertices {
    fn values(&self) -> [&[usize]; 4] {
        [&self.top, &self.right, &self.bottom, &self.left]
    }
}

fn filter_side_vertices(mut sides: SideVertices, eligible: &[bool]) -> SideVertices {
    sides
        .top
        .retain(|idx| eligible.get(*idx).copied().unwrap_or(false));
    sides
        .right
        .retain(|idx| eligible.get(*idx).copied().unwrap_or(false));
    sides
        .bottom
        .retain(|idx| eligible.get(*idx).copied().unwrap_or(false));
    sides
        .left
        .retain(|idx| eligible.get(*idx).copied().unwrap_or(false));
    sides
}

fn eligible_selected_vertex_mask(program: &CandidateProgram, min_support: f64) -> Vec<bool> {
    let mut eligible = vec![false; program.vertices.len()];
    for vertex in &program.vertices {
        if vertex.kind == VertexKind::Corner
            && let Some(item) = eligible.get_mut(vertex.id)
        {
            *item = true;
        }
    }
    for edge in &program.edges {
        if edge.selection != EdgeSelection::Selected || edge.line_support < min_support {
            continue;
        }
        for vertex in edge.vertices {
            if let Some(item) = eligible.get_mut(vertex) {
                *item = true;
            }
        }
    }
    eligible
}

pub fn lock_square_border(
    program: &CandidateProgram,
    options: LockedBorderOptions,
) -> LockedBorderProgram {
    let frame = infer_border_frame_for_reconstruction(program).unwrap_or_else(BorderFrame::unit);
    let old_selected_border_edges = selected_border_edge_count(program);
    let tolerance_px = border_chain_tolerance_px(frame.side_length() * unit_scale(program));
    let tolerance = px_to_unit(program, tolerance_px);
    if existing_selected_border_is_clean(program, frame, tolerance) {
        return LockedBorderProgram {
            program: program.clone(),
            report: LockedBorderReport {
                old_selected_border_edges,
                new_border_edges: old_selected_border_edges,
                boundary_contact_vertices: selected_boundary_contact_count(
                    program, frame, tolerance,
                ),
                inserted_corner_vertices: 0,
                removed_frame_edges: 0,
                downgraded_off_frame_border_edges: 0,
                snap_rejected_for_drift: 0,
                max_drift_px: 0.0,
                tolerance_px,
                frame: frame.as_array(),
                reused_existing_clean_border: true,
                reconstructed: false,
            },
        };
    }

    let Some((next, stats)) = reconstruct_square_border_chain(program, frame, options, tolerance)
    else {
        return LockedBorderProgram {
            program: program.clone(),
            report: LockedBorderReport {
                old_selected_border_edges,
                new_border_edges: old_selected_border_edges,
                boundary_contact_vertices: selected_boundary_contact_count(
                    program, frame, tolerance,
                ),
                inserted_corner_vertices: 0,
                removed_frame_edges: 0,
                downgraded_off_frame_border_edges: 0,
                snap_rejected_for_drift: 0,
                max_drift_px: 0.0,
                tolerance_px,
                frame: frame.as_array(),
                reused_existing_clean_border: false,
                reconstructed: false,
            },
        };
    };

    LockedBorderProgram {
        report: LockedBorderReport {
            old_selected_border_edges,
            new_border_edges: selected_border_edge_count(&next),
            boundary_contact_vertices: selected_boundary_contact_count(&next, frame, tolerance),
            inserted_corner_vertices: stats.inserted_corner_vertices,
            removed_frame_edges: stats.removed_frame_edges,
            downgraded_off_frame_border_edges: stats.downgraded_off_frame_border_edges,
            snap_rejected_for_drift: stats.snap_rejected_for_drift,
            max_drift_px: stats.max_drift_px,
            tolerance_px,
            frame: frame.as_array(),
            reused_existing_clean_border: false,
            reconstructed: true,
        },
        program: next,
    }
}

#[derive(Debug, Clone, Copy)]
struct ReconstructionStats {
    inserted_corner_vertices: usize,
    removed_frame_edges: usize,
    downgraded_off_frame_border_edges: usize,
    snap_rejected_for_drift: usize,
    max_drift_px: f64,
}

fn reconstruct_square_border_chain(
    program: &CandidateProgram,
    frame: BorderFrame,
    options: LockedBorderOptions,
    tolerance: f64,
) -> Option<(CandidateProgram, ReconstructionStats)> {
    if program.vertices.len() < 4 || program.edges.is_empty() {
        return None;
    }
    let eligible_vertices =
        eligible_selected_vertex_mask(program, options.min_selected_edge_support);
    let snapped_all = snap_vertices_to_frame(program, frame, tolerance);
    let seed_side_vertices = filter_side_vertices(
        side_vertices(&snapped_all, frame, tolerance),
        &eligible_vertices,
    );
    let eligible_sides = seed_side_vertices
        .values()
        .into_iter()
        .filter(|indices| indices.len() >= 2)
        .count();
    if eligible_sides < 3 {
        return None;
    }

    let mut next = program.clone();
    let mut selected = vec![false; next.vertices.len()];
    let mut next_positions: Vec<Point2> =
        next.vertices.iter().map(|vertex| vertex.position).collect();
    let max_snap_drift = px_to_unit(program, options.max_snap_drift_px);
    let mut snap_rejected_for_drift = 0usize;
    for indices in seed_side_vertices.values() {
        for idx in indices {
            let drift = distance(snapped_all[*idx], program.vertices[*idx].position);
            if drift > max_snap_drift {
                snap_rejected_for_drift += 1;
                continue;
            }
            next_positions[*idx] = snapped_all[*idx];
            selected[*idx] = true;
        }
    }

    let mut inserted_corner_vertices = 0usize;
    for (_, corner) in frame_corners(frame) {
        let nearest = next_positions
            .iter()
            .enumerate()
            .map(|(idx, point)| (idx, distance(*point, corner)))
            .min_by(|left, right| left.1.total_cmp(&right.1));
        if let Some((idx, nearest_distance)) = nearest
            && nearest_distance <= max_snap_drift
        {
            next_positions[idx] = corner;
            selected[idx] = true;
            continue;
        }
        let idx = next.vertices.len();
        next.vertices.push(CandidateVertex {
            id: idx,
            position: corner,
            kind: VertexKind::Corner,
            support: 1.0,
            boundary_side: boundary_side(corner, frame, tolerance).map(str::to_owned),
            incident_carriers: Vec::new(),
            provenance: vec![Provenance::BorderPrior],
        });
        next_positions.push(corner);
        selected.push(true);
        inserted_corner_vertices += 1;
    }

    for (idx, position) in next_positions.iter().copied().enumerate() {
        if let Some(vertex) = next.vertices.get_mut(idx) {
            vertex.position = position;
            mark_frame_vertex(vertex, frame, tolerance);
        }
    }

    let selected_by_side = selected_border_vertices_by_side(
        &next_positions,
        &selected,
        frame,
        tolerance,
        px_to_unit(program, options.min_edge_length_px),
    );
    if selected_by_side
        .values()
        .into_iter()
        .any(|indices| indices.len() < 2)
    {
        return None;
    }
    let chain_edges = border_chain_edges_from_sides(&selected_by_side);
    if chain_edges.len() < 4 {
        return None;
    }

    let frame_edge_indices: Vec<usize> = next
        .edges
        .iter()
        .enumerate()
        .filter_map(|(idx, edge)| {
            (edge.selection == EdgeSelection::Selected
                && edge_lies_on_any_frame_side(
                    &next,
                    edge.vertices[0],
                    edge.vertices[1],
                    frame,
                    tolerance,
                ))
            .then_some(idx)
        })
        .collect();
    let existing_b_indices: Vec<usize> = next
        .edges
        .iter()
        .enumerate()
        .filter_map(|(idx, edge)| {
            (edge.selection == EdgeSelection::Selected
                && edge.assignment.label == AssignmentLabel::Boundary)
                .then_some(idx)
        })
        .collect();
    if existing_b_indices.len() >= 4 {
        let frame_b_count = existing_b_indices
            .iter()
            .filter(|idx| frame_edge_indices.contains(idx))
            .count();
        let frame_b_fraction = frame_b_count as f64 / existing_b_indices.len() as f64;
        if frame_b_fraction < 0.60 {
            return None;
        }
        let max_chain_edges = 2.0 * existing_b_indices.len() as f64 + 4.0;
        if chain_edges.len() as f64 > max_chain_edges {
            return None;
        }
    }

    let removed_frame_edges = frame_edge_indices.len();
    for idx in &frame_edge_indices {
        if let Some(edge) = next.edges.get_mut(*idx) {
            edge.selection = EdgeSelection::Rejected;
        }
    }

    let mut downgraded_off_frame_border_edges = 0usize;
    for edge in &mut next.edges {
        if edge.selection != EdgeSelection::Selected
            || edge.assignment.label != AssignmentLabel::Boundary
        {
            continue;
        }
        if edge_lies_on_any_frame_side(
            program,
            edge.vertices[0],
            edge.vertices[1],
            frame,
            tolerance,
        ) {
            continue;
        }
        edge.assignment.label = AssignmentLabel::Unknown;
        edge.assignment.confidence = edge.assignment.confidence.min(0.5);
        edge.assignment.margin = edge.assignment.margin.min(0.0);
        edge.source = EvidenceSource::ObservedWeak;
        if !edge.provenance.contains(&Provenance::BorderPrior) {
            edge.provenance.push(Provenance::BorderPrior);
        }
        downgraded_off_frame_border_edges += 1;
    }

    let max_drift = selected
        .iter()
        .enumerate()
        .filter(|(idx, is_selected)| {
            **is_selected && *idx < program.vertices.len() && *idx < next.vertices.len()
        })
        .map(|(idx, _)| distance(next.vertices[idx].position, program.vertices[idx].position))
        .fold(0.0_f64, f64::max);

    for (a, b) in chain_edges {
        add_border_edge(&mut next, a, b, 0.70);
    }
    reject_zero_length_and_duplicate_edges(&mut next);
    rebuild_incident_carriers(&mut next);

    Some((
        next,
        ReconstructionStats {
            inserted_corner_vertices,
            removed_frame_edges,
            downgraded_off_frame_border_edges,
            snap_rejected_for_drift,
            max_drift_px: max_drift * unit_scale(program),
        },
    ))
}

fn existing_selected_border_is_clean(
    program: &CandidateProgram,
    frame: BorderFrame,
    tolerance: f64,
) -> bool {
    let border_edges: Vec<&CandidateEdge> = program
        .edges
        .iter()
        .filter(|edge| edge.selection == EdgeSelection::Selected && is_border_edge(edge))
        .collect();
    if border_edges.len() < 4 {
        return false;
    }

    let mut border_vertices = Vec::<usize>::new();
    let mut degrees = vec![0usize; program.vertices.len()];
    let mut adjacency = vec![Vec::<usize>::new(); program.vertices.len()];
    for edge in border_edges {
        let [a, b] = edge.vertices;
        if a == b
            || a >= program.vertices.len()
            || b >= program.vertices.len()
            || !edge_lies_on_any_frame_side(program, a, b, frame, tolerance)
        {
            return false;
        }
        degrees[a] += 1;
        degrees[b] += 1;
        adjacency[a].push(b);
        adjacency[b].push(a);
        border_vertices.push(a);
        border_vertices.push(b);
    }
    border_vertices.sort_unstable();
    border_vertices.dedup();
    if border_vertices.len() < 4
        || border_vertices
            .iter()
            .any(|vertex_index| degrees[*vertex_index] != 2)
    {
        return false;
    }
    border_vertices_are_connected(&border_vertices, &adjacency)
}

fn infer_border_frame_for_reconstruction(program: &CandidateProgram) -> Option<BorderFrame> {
    let border_points: Vec<Point2> = program
        .edges
        .iter()
        .filter(|edge| edge.selection == EdgeSelection::Selected && is_border_edge(edge))
        .flat_map(|edge| {
            edge.vertices
                .iter()
                .filter_map(|vertex| program.vertices.get(*vertex).map(|item| item.position))
        })
        .collect();
    if border_points.len() >= 4
        && let Some(frame) = infer_border_frame_from_points(program, &border_points)
    {
        return Some(frame);
    }
    let all_points = program
        .vertices
        .iter()
        .map(|vertex| vertex.position)
        .collect::<Vec<_>>();
    infer_border_frame_from_points(program, &all_points)
}

fn infer_border_frame_from_points(
    program: &CandidateProgram,
    points: &[Point2],
) -> Option<BorderFrame> {
    if points.is_empty() {
        return None;
    }
    let mut min_x = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for point in points {
        min_x = min_x.min(point.x);
        max_x = max_x.max(point.x);
        min_y = min_y.min(point.y);
        max_y = max_y.max(point.y);
    }
    let mut width = max_x - min_x;
    let mut height = max_y - min_y;
    let one_px = px_to_unit(program, 1.0);
    if width <= one_px || height <= one_px {
        return None;
    }
    let max_side = width.max(height);
    let tolerance = px_to_unit(
        program,
        effective_border_tolerance_px(max_side * unit_scale(program)),
    );
    let aspect_delta = (width - height).abs();
    let aspect_limit = (4.0 * tolerance).min(tolerance.max(0.08 * max_side));
    if aspect_delta <= aspect_limit {
        let side = 0.5 * (width + height);
        let center_x = 0.5 * (min_x + max_x);
        let center_y = 0.5 * (min_y + max_y);
        min_x = center_x - 0.5 * side;
        max_x = center_x + 0.5 * side;
        min_y = center_y - 0.5 * side;
        max_y = center_y + 0.5 * side;
        width = max_x - min_x;
        height = max_y - min_y;
    }
    min_x = min_x.clamp(0.0, 1.0);
    max_x = max_x.clamp(0.0, 1.0);
    min_y = min_y.clamp(0.0, 1.0);
    max_y = max_y.clamp(0.0, 1.0);
    if width <= one_px || height <= one_px {
        return None;
    }
    Some(BorderFrame {
        min_x,
        min_y,
        max_x,
        max_y,
    })
}

fn snap_vertices_to_frame(
    program: &CandidateProgram,
    frame: BorderFrame,
    tolerance: f64,
) -> Vec<Point2> {
    program
        .vertices
        .iter()
        .map(|vertex| {
            let point = vertex.position;
            let within_x = frame.min_x - tolerance <= point.x && point.x <= frame.max_x + tolerance;
            let within_y = frame.min_y - tolerance <= point.y && point.y <= frame.max_y + tolerance;
            let mut x = point.x;
            let mut y = point.y;
            let mut x_candidates = Vec::new();
            if within_y && (point.x - frame.min_x).abs() <= tolerance {
                x_candidates.push(((point.x - frame.min_x).abs(), frame.min_x));
            }
            if within_y && (point.x - frame.max_x).abs() <= tolerance {
                x_candidates.push(((point.x - frame.max_x).abs(), frame.max_x));
            }
            let mut y_candidates = Vec::new();
            if within_x && (point.y - frame.min_y).abs() <= tolerance {
                y_candidates.push(((point.y - frame.min_y).abs(), frame.min_y));
            }
            if within_x && (point.y - frame.max_y).abs() <= tolerance {
                y_candidates.push(((point.y - frame.max_y).abs(), frame.max_y));
            }
            if let Some((_, value)) = x_candidates
                .into_iter()
                .min_by(|left, right| left.0.total_cmp(&right.0))
            {
                x = value;
            }
            if let Some((_, value)) = y_candidates
                .into_iter()
                .min_by(|left, right| left.0.total_cmp(&right.0))
            {
                y = value;
            }
            Point2::new(x, y)
        })
        .collect()
}

fn side_vertices(vertices: &[Point2], frame: BorderFrame, tolerance: f64) -> SideVertices {
    let mut sides = SideVertices::default();
    for (idx, vertex) in vertices.iter().enumerate() {
        let within_x = frame.min_x - tolerance <= vertex.x && vertex.x <= frame.max_x + tolerance;
        let within_y = frame.min_y - tolerance <= vertex.y && vertex.y <= frame.max_y + tolerance;
        if within_x && (vertex.y - frame.min_y).abs() <= tolerance {
            sides.top.push(idx);
        }
        if within_y && (vertex.x - frame.max_x).abs() <= tolerance {
            sides.right.push(idx);
        }
        if within_x && (vertex.y - frame.max_y).abs() <= tolerance {
            sides.bottom.push(idx);
        }
        if within_y && (vertex.x - frame.min_x).abs() <= tolerance {
            sides.left.push(idx);
        }
    }
    sides.top.sort_by(|left, right| {
        vertices[*left]
            .x
            .total_cmp(&vertices[*right].x)
            .then_with(|| left.cmp(right))
    });
    sides.bottom.sort_by(|left, right| {
        vertices[*left]
            .x
            .total_cmp(&vertices[*right].x)
            .then_with(|| left.cmp(right))
    });
    sides.left.sort_by(|left, right| {
        vertices[*left]
            .y
            .total_cmp(&vertices[*right].y)
            .then_with(|| left.cmp(right))
    });
    sides.right.sort_by(|left, right| {
        vertices[*left]
            .y
            .total_cmp(&vertices[*right].y)
            .then_with(|| left.cmp(right))
    });
    sides
}

fn selected_border_vertices_by_side(
    vertices: &[Point2],
    selected: &[bool],
    frame: BorderFrame,
    tolerance: f64,
    min_spacing: f64,
) -> SideVertices {
    let sides = side_vertices(vertices, frame, tolerance);
    SideVertices {
        top: unique_selected_side_vertices(&sides.top, vertices, selected, Side::Top, min_spacing),
        right: unique_selected_side_vertices(
            &sides.right,
            vertices,
            selected,
            Side::Right,
            min_spacing,
        ),
        bottom: unique_selected_side_vertices(
            &sides.bottom,
            vertices,
            selected,
            Side::Bottom,
            min_spacing,
        ),
        left: unique_selected_side_vertices(
            &sides.left,
            vertices,
            selected,
            Side::Left,
            min_spacing,
        ),
    }
}

fn unique_selected_side_vertices(
    indices: &[usize],
    vertices: &[Point2],
    selected: &[bool],
    side: Side,
    min_spacing: f64,
) -> Vec<usize> {
    let mut ordered: Vec<usize> = indices
        .iter()
        .copied()
        .filter(|idx| selected.get(*idx).copied().unwrap_or(false))
        .collect();
    ordered.sort_by(|left, right| {
        side_position(vertices[*left], side)
            .total_cmp(&side_position(vertices[*right], side))
            .then_with(|| left.cmp(right))
    });
    let mut unique = Vec::<usize>::new();
    for idx in ordered {
        if let Some(previous) = unique.last() {
            let spacing = (side_position(vertices[idx], side)
                - side_position(vertices[*previous], side))
            .abs();
            if spacing < min_spacing {
                continue;
            }
        }
        unique.push(idx);
    }
    unique
}

fn border_chain_edges_from_sides(sides: &SideVertices) -> Vec<(usize, usize)> {
    let mut edges = Vec::new();
    let mut seen = Vec::<(usize, usize)>::new();
    for indices in [&sides.top, &sides.right, &sides.bottom, &sides.left] {
        for pair in indices.windows(2) {
            let a = pair[0];
            let b = pair[1];
            if a == b {
                continue;
            }
            let key = (a.min(b), a.max(b));
            if seen.contains(&key) {
                continue;
            }
            seen.push(key);
            edges.push((a, b));
        }
    }
    edges
}

fn edge_lies_on_any_frame_side(
    program: &CandidateProgram,
    a: usize,
    b: usize,
    frame: BorderFrame,
    tolerance: f64,
) -> bool {
    let Some(start) = program.vertices.get(a).map(|vertex| vertex.position) else {
        return false;
    };
    let Some(end) = program.vertices.get(b).map(|vertex| vertex.position) else {
        return false;
    };
    [Side::Top, Side::Right, Side::Bottom, Side::Left]
        .iter()
        .any(|side| {
            vertex_on_frame_side(start, frame, *side, tolerance)
                && vertex_on_frame_side(end, frame, *side, tolerance)
        })
}

fn vertex_on_frame_side(point: Point2, frame: BorderFrame, side: Side, tolerance: f64) -> bool {
    match side {
        Side::Top => {
            frame.min_x - tolerance <= point.x
                && point.x <= frame.max_x + tolerance
                && (point.y - frame.min_y).abs() <= tolerance
        }
        Side::Right => {
            frame.min_y - tolerance <= point.y
                && point.y <= frame.max_y + tolerance
                && (point.x - frame.max_x).abs() <= tolerance
        }
        Side::Bottom => {
            frame.min_x - tolerance <= point.x
                && point.x <= frame.max_x + tolerance
                && (point.y - frame.max_y).abs() <= tolerance
        }
        Side::Left => {
            frame.min_y - tolerance <= point.y
                && point.y <= frame.max_y + tolerance
                && (point.x - frame.min_x).abs() <= tolerance
        }
    }
}

fn frame_corners(frame: BorderFrame) -> [(&'static str, Point2); 4] {
    [
        ("top_left", Point2::new(frame.min_x, frame.min_y)),
        ("top_right", Point2::new(frame.max_x, frame.min_y)),
        ("bottom_right", Point2::new(frame.max_x, frame.max_y)),
        ("bottom_left", Point2::new(frame.min_x, frame.max_y)),
    ]
}

fn boundary_side(point: Point2, frame: BorderFrame, tolerance: f64) -> Option<&'static str> {
    if vertex_on_frame_side(point, frame, Side::Top, tolerance) {
        Some("top")
    } else if vertex_on_frame_side(point, frame, Side::Right, tolerance) {
        Some("right")
    } else if vertex_on_frame_side(point, frame, Side::Bottom, tolerance) {
        Some("bottom")
    } else if vertex_on_frame_side(point, frame, Side::Left, tolerance) {
        Some("left")
    } else {
        None
    }
}

fn mark_frame_vertex(vertex: &mut CandidateVertex, frame: BorderFrame, tolerance: f64) {
    let Some(side) = boundary_side(vertex.position, frame, tolerance) else {
        return;
    };
    vertex.boundary_side = Some(side.to_owned());
    vertex.kind = if is_corner(vertex.position, frame, tolerance) {
        VertexKind::Corner
    } else {
        VertexKind::Boundary
    };
    if !vertex.provenance.contains(&Provenance::BorderPrior) {
        vertex.provenance.push(Provenance::BorderPrior);
    }
}

fn is_corner(point: Point2, frame: BorderFrame, tolerance: f64) -> bool {
    ((point.x - frame.min_x).abs() <= tolerance || (point.x - frame.max_x).abs() <= tolerance)
        && ((point.y - frame.min_y).abs() <= tolerance
            || (point.y - frame.max_y).abs() <= tolerance)
}

fn reject_zero_length_and_duplicate_edges(program: &mut CandidateProgram) {
    let one_px = px_to_unit(program, 1.0);
    let mut keep_by_key = Vec::<((usize, usize), usize)>::new();
    let mut reject = vec![false; program.edges.len()];
    for (edge_idx, edge) in program.edges.iter().enumerate() {
        if edge.selection != EdgeSelection::Selected {
            continue;
        }
        let [a, b] = edge.vertices;
        if a == b
            || a >= program.vertices.len()
            || b >= program.vertices.len()
            || distance(program.vertices[a].position, program.vertices[b].position) < one_px
        {
            reject[edge_idx] = true;
            continue;
        }
        let key = (a.min(b), a.max(b));
        if let Some((_, previous)) = keep_by_key
            .iter_mut()
            .find(|(item_key, _)| *item_key == key)
        {
            if edge.line_support > program.edges[*previous].line_support {
                reject[*previous] = true;
                *previous = edge_idx;
            } else {
                reject[edge_idx] = true;
            }
        } else {
            keep_by_key.push((key, edge_idx));
        }
    }
    for (edge, should_reject) in program.edges.iter_mut().zip(reject.into_iter()) {
        if should_reject {
            edge.selection = EdgeSelection::Rejected;
        }
    }
}

fn border_vertices_are_connected(border_vertices: &[usize], adjacency: &[Vec<usize>]) -> bool {
    if border_vertices.is_empty() {
        return false;
    }
    let border: BTreeSet<usize> = border_vertices.iter().copied().collect();
    let mut seen = BTreeSet::new();
    let mut stack = vec![border_vertices[0]];
    seen.insert(border_vertices[0]);
    while let Some(vertex) = stack.pop() {
        for neighbor in &adjacency[vertex] {
            if !border.contains(neighbor) || seen.contains(neighbor) {
                continue;
            }
            seen.insert(*neighbor);
            stack.push(*neighbor);
        }
    }
    seen == border
}

fn selected_border_edge_count(program: &CandidateProgram) -> usize {
    program
        .edges
        .iter()
        .filter(|edge| edge.selection == EdgeSelection::Selected && is_border_edge(edge))
        .count()
}

fn selected_boundary_contact_count(
    program: &CandidateProgram,
    frame: BorderFrame,
    tolerance: f64,
) -> usize {
    let mut vertices: Vec<usize> = program
        .edges
        .iter()
        .filter(|edge| edge.selection == EdgeSelection::Selected && is_border_edge(edge))
        .flat_map(|edge| edge.vertices)
        .filter(|vertex| {
            program
                .vertices
                .get(*vertex)
                .is_some_and(|item| !is_corner(item.position, frame, tolerance))
        })
        .collect();
    vertices.sort_unstable();
    vertices.dedup();
    vertices.len()
}

fn is_border_edge(edge: &CandidateEdge) -> bool {
    edge.assignment.label == AssignmentLabel::Boundary || edge.source == EvidenceSource::Border
}

fn add_border_edge(program: &mut CandidateProgram, a: usize, b: usize, support: f64) {
    let Some(start) = program.vertices.get(a).map(|vertex| vertex.position) else {
        return;
    };
    let Some(end) = program.vertices.get(b).map(|vertex| vertex.position) else {
        return;
    };
    let normal = border_normal(start, end);
    let carrier_id = next_carrier_id(program);
    let edge_id = next_edge_id(program);
    program.carriers.push(CandidateCarrier {
        id: carrier_id,
        family: CarrierFamily::Border,
        normal,
        rho: normal.x * start.x + normal.y * start.y,
        support_interval: support_interval(start, end),
        visual_support: support,
        dashed_support: 0.0,
        non_crease_penalty: 0.0,
        source: EvidenceSource::Border,
        provenance: vec![Provenance::BorderPrior],
    });
    program.edges.push(CandidateEdge {
        id: edge_id,
        carrier_id,
        vertices: [a, b],
        assignment: AssignmentCandidate {
            label: AssignmentLabel::Boundary,
            confidence: 1.0,
            margin: 1.0,
        },
        line_support: support,
        style_support: 0.0,
        selection: EdgeSelection::Selected,
        source: EvidenceSource::Border,
        provenance: vec![Provenance::BorderPrior],
    });
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

fn border_normal(start: Point2, end: Point2) -> Point2 {
    if (start.y - end.y).abs() <= (start.x - end.x).abs() {
        Point2::new(0.0, 1.0)
    } else {
        Point2::new(1.0, 0.0)
    }
}

fn support_interval(start: Point2, end: Point2) -> [f64; 2] {
    if (start.x - end.x).abs() >= (start.y - end.y).abs() {
        [start.x.min(end.x), start.x.max(end.x)]
    } else {
        [start.y.min(end.y), start.y.max(end.y)]
    }
}

fn side_position(vertex: Point2, side: Side) -> f64 {
    match side {
        Side::Top | Side::Bottom => vertex.x,
        Side::Left | Side::Right => vertex.y,
    }
}

fn next_carrier_id(program: &CandidateProgram) -> usize {
    program
        .carriers
        .iter()
        .map(|carrier| carrier.id)
        .max()
        .unwrap_or(0)
        + 1
}

fn next_edge_id(program: &CandidateProgram) -> usize {
    program.edges.iter().map(|edge| edge.id).max().unwrap_or(0) + 1
}

fn unit_scale(program: &CandidateProgram) -> f64 {
    f64::from(program.image_size.unwrap_or(1024).saturating_sub(1).max(1))
}

fn px_to_unit(program: &CandidateProgram, px: f64) -> f64 {
    px / unit_scale(program)
}

fn effective_border_tolerance_px(side_length_px: f64) -> f64 {
    6.0_f64.min((0.02 * side_length_px).max(1.0))
}

fn border_chain_tolerance_px(side_length_px: f64) -> f64 {
    10.0_f64.min((0.01 * side_length_px).max(1.0))
}

fn distance(a: Point2, b: Point2) -> f64 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rebuilds_border_from_corners_and_boundary_contacts() {
        let mut program = CandidateProgram {
            coordinate_space: "fold_normalized".to_owned(),
            image_size: Some(1024),
            vertices: vec![
                vertex(0, 0.0, 0.0, VertexKind::Corner),
                vertex(1, 1.0, 0.0, VertexKind::Corner),
                vertex(2, 1.0, 1.0, VertexKind::Corner),
                vertex(3, 0.0, 1.0, VertexKind::Corner),
                vertex(4, 0.5, 0.002, VertexKind::Boundary),
                vertex(5, 0.5, 0.5, VertexKind::Interior),
            ],
            carriers: Vec::new(),
            edges: Vec::new(),
        };
        program.carriers.push(carrier(0, CarrierFamily::Border));
        program
            .edges
            .push(edge(0, 0, [0, 1], AssignmentLabel::Boundary));
        program.carriers.push(carrier(1, CarrierFamily::Vertical));
        program
            .edges
            .push(edge(1, 1, [4, 5], AssignmentLabel::Mountain));

        let locked = lock_square_border(&program, LockedBorderOptions::default());
        let selected_border_edges = selected_border_edge_count(&locked.program);

        assert_eq!(locked.program.vertices[4].position, Point2::new(0.5, 0.0));
        assert_eq!(selected_border_edges, 5);
        assert_eq!(locked.report.old_selected_border_edges, 1);
        assert_eq!(locked.report.boundary_contact_vertices, 1);
        assert!(locked.report.reconstructed);
    }

    #[test]
    fn clean_existing_border_cycle_is_reused_without_rebuild() {
        let mut program = CandidateProgram {
            coordinate_space: "fold_normalized".to_owned(),
            image_size: Some(1024),
            vertices: vec![
                vertex(0, 0.1, 0.1, VertexKind::Corner),
                vertex(1, 0.9, 0.1, VertexKind::Corner),
                vertex(2, 0.9, 0.9, VertexKind::Corner),
                vertex(3, 0.1, 0.9, VertexKind::Corner),
            ],
            carriers: Vec::new(),
            edges: Vec::new(),
        };
        for (id, pair) in [[0, 1], [1, 2], [2, 3], [3, 0]].into_iter().enumerate() {
            program.carriers.push(carrier(id, CarrierFamily::Border));
            program
                .edges
                .push(edge(id, id, pair, AssignmentLabel::Boundary));
        }

        let locked = lock_square_border(&program, LockedBorderOptions::default());

        assert_eq!(locked.program.edges, program.edges);
        assert_eq!(locked.program.vertices, program.vertices);
        assert!(locked.report.reused_existing_clean_border);
        assert!(!locked.report.reconstructed);
    }

    fn vertex(id: usize, x: f64, y: f64, kind: VertexKind) -> CandidateVertex {
        CandidateVertex {
            id,
            position: Point2::new(x, y),
            kind,
            support: 1.0,
            boundary_side: None,
            incident_carriers: Vec::new(),
            provenance: Vec::new(),
        }
    }

    fn carrier(id: usize, family: CarrierFamily) -> CandidateCarrier {
        CandidateCarrier {
            id,
            family,
            normal: Point2::new(0.0, 1.0),
            rho: 0.0,
            support_interval: [0.0, 1.0],
            visual_support: 1.0,
            dashed_support: 0.0,
            non_crease_penalty: 0.0,
            source: if family == CarrierFamily::Border {
                EvidenceSource::Border
            } else {
                EvidenceSource::Legacy
            },
            provenance: Vec::new(),
        }
    }

    fn edge(
        id: usize,
        carrier_id: usize,
        vertices: [usize; 2],
        assignment: AssignmentLabel,
    ) -> CandidateEdge {
        CandidateEdge {
            id,
            carrier_id,
            vertices,
            assignment: AssignmentCandidate {
                label: assignment,
                confidence: 1.0,
                margin: 1.0,
            },
            line_support: 1.0,
            style_support: 0.0,
            selection: EdgeSelection::Selected,
            source: if assignment == AssignmentLabel::Boundary {
                EvidenceSource::Border
            } else {
                EvidenceSource::Legacy
            },
            provenance: Vec::new(),
        }
    }
}

use crate::{
    AssignmentCandidate, AssignmentLabel, CandidateCarrier, CandidateEdge, CandidateProgram,
    CandidateVertex, CarrierFamily, EdgeSelection, EvidenceSource, Point2, Provenance, VertexKind,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct LockedBorderOptions {
    pub boundary_tolerance: f64,
}

impl Default for LockedBorderOptions {
    fn default() -> Self {
        Self {
            boundary_tolerance: 0.01,
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
    pub frame: [f64; 4],
    pub reused_existing_clean_border: bool,
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

    fn as_array(self) -> [f64; 4] {
        [self.min_x, self.min_y, self.max_x, self.max_y]
    }
}

pub fn lock_square_border(
    program: &CandidateProgram,
    options: LockedBorderOptions,
) -> LockedBorderProgram {
    let mut next = program.clone();
    let frame = infer_border_frame(&next);
    let old_selected_border_edges = next
        .edges
        .iter()
        .filter(|edge| edge.selection == EdgeSelection::Selected && is_border_edge(edge))
        .count();
    if existing_selected_border_is_clean(&next, frame, options.boundary_tolerance.max(1e-9)) {
        return LockedBorderProgram {
            program: next,
            report: LockedBorderReport {
                old_selected_border_edges,
                new_border_edges: old_selected_border_edges,
                boundary_contact_vertices: selected_border_vertex_count(program),
                inserted_corner_vertices: 0,
                frame: frame.as_array(),
                reused_existing_clean_border: true,
            },
        };
    }

    for edge in &mut next.edges {
        if is_border_edge(edge) {
            edge.selection = EdgeSelection::Rejected;
        }
    }

    let tolerance = options.boundary_tolerance.max(1e-9);
    let corners_before = next.vertices.len();
    let top_left = upsert_exact_vertex(
        &mut next,
        Point2::new(frame.min_x, frame.min_y),
        VertexKind::Corner,
        Some("top"),
        tolerance,
    );
    let top_right = upsert_exact_vertex(
        &mut next,
        Point2::new(frame.max_x, frame.min_y),
        VertexKind::Corner,
        Some("top"),
        tolerance,
    );
    let bottom_right = upsert_exact_vertex(
        &mut next,
        Point2::new(frame.max_x, frame.max_y),
        VertexKind::Corner,
        Some("bottom"),
        tolerance,
    );
    let bottom_left = upsert_exact_vertex(
        &mut next,
        Point2::new(frame.min_x, frame.max_y),
        VertexKind::Corner,
        Some("bottom"),
        tolerance,
    );
    let inserted_corner_vertices = next.vertices.len().saturating_sub(corners_before);

    let mut side_vertices: [Vec<(f64, usize)>; 4] = std::array::from_fn(|_| Vec::new());
    add_side_vertex(&mut side_vertices, Side::Top, 0.0, top_left);
    add_side_vertex(&mut side_vertices, Side::Top, 1.0, top_right);
    add_side_vertex(&mut side_vertices, Side::Right, 0.0, top_right);
    add_side_vertex(&mut side_vertices, Side::Right, 1.0, bottom_right);
    add_side_vertex(&mut side_vertices, Side::Bottom, 0.0, bottom_left);
    add_side_vertex(&mut side_vertices, Side::Bottom, 1.0, bottom_right);
    add_side_vertex(&mut side_vertices, Side::Left, 0.0, top_left);
    add_side_vertex(&mut side_vertices, Side::Left, 1.0, bottom_left);

    let mut boundary_contacts = Vec::<usize>::new();
    for edge in next.edges.clone() {
        if !is_border_edge(&edge) {
            continue;
        }
        for vertex_index in edge.vertices {
            snap_boundary_vertex(
                &mut next,
                &mut side_vertices,
                &mut boundary_contacts,
                vertex_index,
                frame,
                tolerance,
            );
        }
    }

    for edge in next.edges.clone() {
        if edge.selection != EdgeSelection::Selected || is_border_edge(&edge) {
            continue;
        }
        for vertex_index in edge.vertices {
            snap_boundary_vertex(
                &mut next,
                &mut side_vertices,
                &mut boundary_contacts,
                vertex_index,
                frame,
                tolerance,
            );
        }
    }

    boundary_contacts.sort_unstable();
    boundary_contacts.dedup();
    for side in [Side::Top, Side::Right, Side::Bottom, Side::Left] {
        dedupe_side_vertices(&mut side_vertices[side_index(side)], tolerance);
    }

    let mut added_edges = 0usize;
    for side in [Side::Top, Side::Right, Side::Bottom, Side::Left] {
        for pair in side_vertices[side_index(side)].windows(2) {
            let a = pair[0].1;
            let b = pair[1].1;
            if a == b {
                continue;
            }
            add_border_edge(&mut next, a, b);
            added_edges += 1;
        }
    }
    rebuild_incident_carriers(&mut next);

    LockedBorderProgram {
        program: next,
        report: LockedBorderReport {
            old_selected_border_edges,
            new_border_edges: added_edges,
            boundary_contact_vertices: boundary_contacts.len(),
            inserted_corner_vertices,
            frame: frame.as_array(),
            reused_existing_clean_border: false,
        },
    }
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

fn selected_border_vertex_count(program: &CandidateProgram) -> usize {
    let mut vertices: Vec<usize> = program
        .edges
        .iter()
        .filter(|edge| edge.selection == EdgeSelection::Selected && is_border_edge(edge))
        .flat_map(|edge| edge.vertices)
        .collect();
    vertices.sort_unstable();
    vertices.dedup();
    vertices.len()
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

fn border_vertices_are_connected(border_vertices: &[usize], adjacency: &[Vec<usize>]) -> bool {
    if border_vertices.is_empty() {
        return false;
    }
    let border: std::collections::BTreeSet<usize> = border_vertices.iter().copied().collect();
    let mut seen = std::collections::BTreeSet::new();
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

fn snap_boundary_vertex(
    program: &mut CandidateProgram,
    side_vertices: &mut [Vec<(f64, usize)>; 4],
    boundary_contacts: &mut Vec<usize>,
    vertex_index: usize,
    frame: BorderFrame,
    tolerance: f64,
) {
    let Some(position) = program
        .vertices
        .get(vertex_index)
        .map(|vertex| vertex.position)
    else {
        return;
    };
    let Some((side, snapped, parameter)) = snap_to_side(position, frame, tolerance) else {
        return;
    };
    let vertex = &mut program.vertices[vertex_index];
    vertex.position = snapped;
    vertex.kind = if is_corner(snapped, frame, tolerance) {
        VertexKind::Corner
    } else {
        VertexKind::Boundary
    };
    vertex.boundary_side = Some(side_name(side).to_owned());
    if !vertex.provenance.contains(&Provenance::BorderPrior) {
        vertex.provenance.push(Provenance::BorderPrior);
    }
    add_side_vertex(side_vertices, side, parameter, vertex_index);
    boundary_contacts.push(vertex_index);
}

fn infer_border_frame(program: &CandidateProgram) -> BorderFrame {
    let mut xs = Vec::<f64>::new();
    let mut ys = Vec::<f64>::new();
    for edge in &program.edges {
        if edge.selection != EdgeSelection::Selected || !is_border_edge(edge) {
            continue;
        }
        for vertex_index in edge.vertices {
            if let Some(vertex) = program.vertices.get(vertex_index) {
                xs.push(vertex.position.x);
                ys.push(vertex.position.y);
            }
        }
    }
    if xs.len() < 2 || ys.len() < 2 {
        return BorderFrame::unit();
    }
    let min_x = xs.iter().copied().fold(f64::INFINITY, f64::min);
    let max_x = xs.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let min_y = ys.iter().copied().fold(f64::INFINITY, f64::min);
    let max_y = ys.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    if !min_x.is_finite()
        || !max_x.is_finite()
        || !min_y.is_finite()
        || !max_y.is_finite()
        || max_x - min_x <= 1e-6
        || max_y - min_y <= 1e-6
    {
        return BorderFrame::unit();
    }
    BorderFrame {
        min_x,
        min_y,
        max_x,
        max_y,
    }
}

fn is_border_edge(edge: &CandidateEdge) -> bool {
    edge.assignment.label == AssignmentLabel::Boundary || edge.source == EvidenceSource::Border
}

fn upsert_exact_vertex(
    program: &mut CandidateProgram,
    point: Point2,
    kind: VertexKind,
    side: Option<&str>,
    tolerance: f64,
) -> usize {
    if let Some(index) = program
        .vertices
        .iter()
        .position(|vertex| distance(vertex.position, point) <= tolerance)
    {
        let vertex = &mut program.vertices[index];
        vertex.position = point;
        vertex.kind = kind;
        vertex.boundary_side = side.map(str::to_owned);
        if !vertex.provenance.contains(&Provenance::BorderPrior) {
            vertex.provenance.push(Provenance::BorderPrior);
        }
        return index;
    }
    let id = program.vertices.len();
    program.vertices.push(CandidateVertex {
        id,
        position: point,
        kind,
        support: 1.0,
        boundary_side: side.map(str::to_owned),
        incident_carriers: Vec::new(),
        provenance: vec![Provenance::BorderPrior],
    });
    id
}

fn add_border_edge(program: &mut CandidateProgram, a: usize, b: usize) {
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
        visual_support: 1.0,
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
        line_support: 1.0,
        style_support: 0.0,
        selection: EdgeSelection::Selected,
        source: EvidenceSource::Border,
        provenance: vec![Provenance::BorderPrior],
    });
}

fn snap_to_side(point: Point2, frame: BorderFrame, tolerance: f64) -> Option<(Side, Point2, f64)> {
    let distances = [
        (Side::Top, (point.y - frame.min_y).abs()),
        (Side::Right, (point.x - frame.max_x).abs()),
        (Side::Bottom, (point.y - frame.max_y).abs()),
        (Side::Left, (point.x - frame.min_x).abs()),
    ];
    let (side, distance) = distances
        .into_iter()
        .min_by(|left, right| left.1.total_cmp(&right.1))?;
    if distance > tolerance {
        return None;
    }
    match side {
        Side::Top => Some((
            side,
            Point2::new(point.x.clamp(frame.min_x, frame.max_x), frame.min_y),
            (point.x - frame.min_x) / frame.width(),
        )),
        Side::Right => Some((
            side,
            Point2::new(frame.max_x, point.y.clamp(frame.min_y, frame.max_y)),
            (point.y - frame.min_y) / frame.height(),
        )),
        Side::Bottom => Some((
            side,
            Point2::new(point.x.clamp(frame.min_x, frame.max_x), frame.max_y),
            (point.x - frame.min_x) / frame.width(),
        )),
        Side::Left => Some((
            side,
            Point2::new(frame.min_x, point.y.clamp(frame.min_y, frame.max_y)),
            (point.y - frame.min_y) / frame.height(),
        )),
    }
}

fn add_side_vertex(
    side_vertices: &mut [Vec<(f64, usize)>; 4],
    side: Side,
    parameter: f64,
    vertex: usize,
) {
    side_vertices[side_index(side)].push((parameter.clamp(0.0, 1.0), vertex));
}

fn dedupe_side_vertices(vertices: &mut Vec<(f64, usize)>, tolerance: f64) {
    vertices.sort_by(|left, right| {
        left.0
            .total_cmp(&right.0)
            .then_with(|| left.1.cmp(&right.1))
    });
    let mut deduped = Vec::<(f64, usize)>::new();
    for (parameter, vertex) in vertices.iter().copied() {
        if deduped
            .last()
            .is_some_and(|(last_parameter, _)| (parameter - *last_parameter).abs() <= tolerance)
        {
            continue;
        }
        deduped.push((parameter, vertex));
    }
    *vertices = deduped;
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
        if ((start.y + end.y) * 0.5) <= 0.5 {
            Point2::new(0.0, 1.0)
        } else {
            Point2::new(0.0, 1.0)
        }
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

fn side_index(side: Side) -> usize {
    match side {
        Side::Top => 0,
        Side::Right => 1,
        Side::Bottom => 2,
        Side::Left => 3,
    }
}

fn side_name(side: Side) -> &'static str {
    match side {
        Side::Top => "top",
        Side::Right => "right",
        Side::Bottom => "bottom",
        Side::Left => "left",
    }
}

fn is_corner(point: Point2, frame: BorderFrame, tolerance: f64) -> bool {
    ((point.x - frame.min_x).abs() <= tolerance || (point.x - frame.max_x).abs() <= tolerance)
        && ((point.y - frame.min_y).abs() <= tolerance
            || (point.y - frame.max_y).abs() <= tolerance)
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
        let selected_border_edges = locked
            .program
            .edges
            .iter()
            .filter(|edge| {
                edge.selection == EdgeSelection::Selected
                    && edge.assignment.label == AssignmentLabel::Boundary
            })
            .count();

        assert_eq!(locked.program.vertices[4].position, Point2::new(0.5, 0.0));
        assert_eq!(selected_border_edges, 5);
        assert_eq!(locked.report.old_selected_border_edges, 1);
        assert_eq!(locked.report.boundary_contact_vertices, 3);
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

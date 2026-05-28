use crate::{
    AssignmentLabel, CandidateProgram, CarrierFamily, EdgeSelection, Point2, Provenance, VertexKind,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CarrierReconcileOptions {
    pub max_angle_degrees: f64,
    pub max_rho_px: f64,
    pub max_vertex_move_px: f64,
    pub max_merge_distance_px: f64,
    pub min_group_edges: usize,
    pub min_edge_length_px: f64,
    pub allow_vertex_merges: bool,
    pub allow_single_carrier_projection: bool,
    pub freeze_boundary_vertices: bool,
}

impl Default for CarrierReconcileOptions {
    fn default() -> Self {
        Self {
            max_angle_degrees: 1.25,
            max_rho_px: 6.0,
            max_vertex_move_px: 5.0,
            max_merge_distance_px: 3.0,
            min_group_edges: 2,
            min_edge_length_px: 4.0,
            allow_vertex_merges: true,
            allow_single_carrier_projection: false,
            freeze_boundary_vertices: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CarrierReconciledProgram {
    pub program: CandidateProgram,
    pub report: CarrierReconcileReport,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CarrierReconcileReport {
    pub eligible_edges: usize,
    pub candidate_groups: usize,
    pub accepted_groups: usize,
    pub vertices_considered: usize,
    pub vertices_moved: usize,
    pub boundary_vertices_frozen: usize,
    pub vertex_merge_candidates: usize,
    pub vertices_merged: usize,
    pub degenerate_edges_rejected: usize,
    pub selected_edges_before: usize,
    pub selected_edges_after: usize,
    pub max_vertex_move: f64,
    pub mean_vertex_move: f64,
}

#[derive(Debug, Clone)]
struct EdgeLine {
    edge_index: usize,
    normal: Point2,
    rho: f64,
    length: f64,
}

#[derive(Debug, Clone)]
struct CarrierGroup {
    members: Vec<usize>,
    normal: Point2,
    rho: f64,
}

pub fn reconcile_carriers(
    program: &CandidateProgram,
    options: CarrierReconcileOptions,
) -> CarrierReconciledProgram {
    let mut next = program.clone();
    let max_rho = px_to_unit(program, options.max_rho_px);
    let max_move = px_to_unit(program, options.max_vertex_move_px);
    let min_length = px_to_unit(program, options.min_edge_length_px);
    let max_merge_distance = px_to_unit(program, options.max_merge_distance_px);
    let selected_edges_before = selected_edge_count(program);
    let eligible = eligible_edge_lines(program, min_length);
    let raw_groups = group_edge_lines(&eligible, options.max_angle_degrees.to_radians(), max_rho);
    let connected_groups = split_groups_by_vertex_connectivity(program, &eligible, &raw_groups);
    let groups = connected_groups
        .into_iter()
        .filter(|group| group.members.len() >= options.min_group_edges)
        .collect::<Vec<_>>();
    let group_lines = groups
        .iter()
        .map(|group| fit_group_line(program, &eligible, group).unwrap_or((group.normal, group.rho)))
        .collect::<Vec<_>>();
    let edge_group = edge_group_map(&eligible, &groups);
    let vertex_groups = vertex_group_map(program, &edge_group);

    let mut movements = Vec::new();
    let mut vertices_considered = 0usize;
    let mut vertices_moved = 0usize;
    let mut boundary_vertices_frozen = 0usize;

    for index in 0..next.vertices.len() {
        let vertex = &next.vertices[index];
        if options.freeze_boundary_vertices && vertex.kind != VertexKind::Interior {
            boundary_vertices_frozen += 1;
            movements.push(0.0);
            continue;
        }
        let Some(group_ids) = vertex_groups.get(&index) else {
            movements.push(0.0);
            continue;
        };
        let group_ids = group_ids.iter().copied().collect::<Vec<_>>();
        if group_ids.is_empty() {
            movements.push(0.0);
            continue;
        }
        vertices_considered += 1;
        let original = vertex.position;
        let Some(projected) = project_vertex_to_groups(original, &group_ids, &group_lines) else {
            movements.push(0.0);
            continue;
        };
        if group_ids.len() == 1 && !options.allow_single_carrier_projection {
            movements.push(0.0);
            continue;
        }
        let movement = distance(original, projected);
        if movement <= max_move && movement > 1e-9 {
            next.vertices[index].position = projected;
            next.vertices[index]
                .provenance
                .push(Provenance::CarrierReconciled);
            vertices_moved += 1;
            movements.push(movement);
        } else {
            movements.push(0.0);
        }
    }

    let mut vertex_merge_candidates = 0usize;
    let mut vertices_merged = 0usize;
    if options.allow_vertex_merges {
        let merge_report = merge_near_reconciled_vertices(
            &mut next,
            &vertex_groups,
            max_merge_distance,
            options.freeze_boundary_vertices,
        );
        vertex_merge_candidates = merge_report.candidates;
        vertices_merged = merge_report.merged;
    }

    let degenerate_edges_rejected = reject_degenerate_selected_edges(&mut next);
    rebuild_carriers_from_edges(&mut next);
    rebuild_incident_carriers(&mut next);

    CarrierReconciledProgram {
        report: CarrierReconcileReport {
            eligible_edges: eligible.len(),
            candidate_groups: groups.len(),
            accepted_groups: group_lines.len(),
            vertices_considered,
            vertices_moved,
            boundary_vertices_frozen,
            vertex_merge_candidates,
            vertices_merged,
            degenerate_edges_rejected,
            selected_edges_before,
            selected_edges_after: selected_edge_count(&next),
            max_vertex_move: movements.iter().copied().fold(0.0, f64::max),
            mean_vertex_move: if vertices_moved == 0 {
                0.0
            } else {
                movements.iter().sum::<f64>() / vertices_moved as f64
            },
        },
        program: next,
    }
}

fn eligible_edge_lines(program: &CandidateProgram, min_length: f64) -> Vec<EdgeLine> {
    let mut lines = Vec::new();
    for (edge_index, edge) in program.edges.iter().enumerate() {
        if edge.selection != EdgeSelection::Selected {
            continue;
        }
        if matches!(
            edge.assignment.label,
            AssignmentLabel::Boundary | AssignmentLabel::Flat
        ) {
            continue;
        }
        let Some(start) = program
            .vertices
            .get(edge.vertices[0])
            .map(|vertex| vertex.position)
        else {
            continue;
        };
        let Some(end) = program
            .vertices
            .get(edge.vertices[1])
            .map(|vertex| vertex.position)
        else {
            continue;
        };
        let length = distance(start, end);
        if length < min_length {
            continue;
        }
        let (normal, rho) = canonical_line(line_normal(start, end), start);
        lines.push(EdgeLine {
            edge_index,
            normal,
            rho,
            length,
        });
    }
    lines
}

fn group_edge_lines(
    lines: &[EdgeLine],
    angle_tolerance: f64,
    rho_tolerance: f64,
) -> Vec<CarrierGroup> {
    let mut groups: Vec<CarrierGroup> = Vec::new();
    for line in lines {
        let mut best: Option<(usize, f64)> = None;
        for (index, group) in groups.iter().enumerate() {
            let angle = normal_angle_distance(line.normal, group.normal);
            let rho = (line.rho - group.rho).abs();
            if angle > angle_tolerance || rho > rho_tolerance {
                continue;
            }
            let score = angle / angle_tolerance.max(1e-12) + rho / rho_tolerance.max(1e-12);
            if best.is_none_or(|(_, best_score)| score < best_score) {
                best = Some((index, score));
            }
        }
        if let Some((index, _)) = best {
            groups[index].members.push(line.edge_index);
            let count = groups[index].members.len() as f64;
            groups[index].normal = normalized(Point2::new(
                groups[index].normal.x * (count - 1.0) / count + line.normal.x / count,
                groups[index].normal.y * (count - 1.0) / count + line.normal.y / count,
            ));
            groups[index].rho = groups[index].rho * (count - 1.0) / count + line.rho / count;
        } else {
            groups.push(CarrierGroup {
                members: vec![line.edge_index],
                normal: line.normal,
                rho: line.rho,
            });
        }
    }
    groups
}

fn split_groups_by_vertex_connectivity(
    program: &CandidateProgram,
    lines: &[EdgeLine],
    groups: &[CarrierGroup],
) -> Vec<CarrierGroup> {
    let line_by_edge = lines
        .iter()
        .map(|line| (line.edge_index, line))
        .collect::<BTreeMap<_, _>>();
    let mut split = Vec::new();
    for group in groups {
        let member_set = group.members.iter().copied().collect::<BTreeSet<_>>();
        let mut vertex_to_edges = BTreeMap::<usize, Vec<usize>>::new();
        for edge_index in &member_set {
            let Some(edge) = program.edges.get(*edge_index) else {
                continue;
            };
            vertex_to_edges
                .entry(edge.vertices[0])
                .or_default()
                .push(*edge_index);
            vertex_to_edges
                .entry(edge.vertices[1])
                .or_default()
                .push(*edge_index);
        }

        let mut visited = BTreeSet::new();
        for edge_index in &member_set {
            if visited.contains(edge_index) {
                continue;
            }
            let mut stack = vec![*edge_index];
            let mut component = Vec::new();
            visited.insert(*edge_index);
            while let Some(current) = stack.pop() {
                component.push(current);
                let Some(edge) = program.edges.get(current) else {
                    continue;
                };
                for vertex in edge.vertices {
                    let Some(neighbors) = vertex_to_edges.get(&vertex) else {
                        continue;
                    };
                    for neighbor in neighbors {
                        if member_set.contains(neighbor) && visited.insert(*neighbor) {
                            stack.push(*neighbor);
                        }
                    }
                }
            }
            if component.is_empty() {
                continue;
            }
            let (normal, rho) =
                average_group_line(&component, &line_by_edge).unwrap_or((group.normal, group.rho));
            split.push(CarrierGroup {
                members: component,
                normal,
                rho,
            });
        }
    }
    split
}

fn average_group_line(
    members: &[usize],
    line_by_edge: &BTreeMap<usize, &EdgeLine>,
) -> Option<(Point2, f64)> {
    let mut normal = Point2::new(0.0, 0.0);
    let mut rho = 0.0;
    let mut weight_sum = 0.0;
    for edge_index in members {
        let line = line_by_edge.get(edge_index)?;
        let weight = line.length.max(1e-6);
        normal.x += line.normal.x * weight;
        normal.y += line.normal.y * weight;
        rho += line.rho * weight;
        weight_sum += weight;
    }
    if weight_sum <= 1e-12 {
        return None;
    }
    normal = normalized(Point2::new(normal.x / weight_sum, normal.y / weight_sum));
    Some((normal, rho / weight_sum))
}

fn fit_group_line(
    program: &CandidateProgram,
    lines: &[EdgeLine],
    group: &CarrierGroup,
) -> Option<(Point2, f64)> {
    let line_by_edge = lines
        .iter()
        .map(|line| (line.edge_index, line))
        .collect::<BTreeMap<_, _>>();
    let mut points = Vec::<(Point2, f64)>::new();
    for edge_index in &group.members {
        let edge = program.edges.get(*edge_index)?;
        let line = line_by_edge.get(edge_index)?;
        let weight = edge.line_support.max(0.1) * line.length.max(1e-6);
        points.push((program.vertices.get(edge.vertices[0])?.position, weight));
        points.push((program.vertices.get(edge.vertices[1])?.position, weight));
    }
    fit_orthogonal_line(&points)
}

fn fit_orthogonal_line(points: &[(Point2, f64)]) -> Option<(Point2, f64)> {
    if points.len() < 2 {
        return None;
    }
    let weight_sum = points.iter().map(|(_, weight)| *weight).sum::<f64>();
    if weight_sum <= 1e-12 {
        return None;
    }
    let cx = points
        .iter()
        .map(|(point, weight)| point.x * *weight)
        .sum::<f64>()
        / weight_sum;
    let cy = points
        .iter()
        .map(|(point, weight)| point.y * *weight)
        .sum::<f64>()
        / weight_sum;
    let mut sxx = 0.0;
    let mut sxy = 0.0;
    let mut syy = 0.0;
    for (point, weight) in points {
        let dx = point.x - cx;
        let dy = point.y - cy;
        sxx += *weight * dx * dx;
        sxy += *weight * dx * dy;
        syy += *weight * dy * dy;
    }
    let theta = 0.5 * (2.0 * sxy).atan2(sxx - syy);
    let direction = Point2::new(theta.cos(), theta.sin());
    let normal = normalized(Point2::new(-direction.y, direction.x));
    Some(canonical_line(normal, Point2::new(cx, cy)))
}

fn edge_group_map(lines: &[EdgeLine], groups: &[CarrierGroup]) -> BTreeMap<usize, usize> {
    let line_edges = lines
        .iter()
        .map(|line| line.edge_index)
        .collect::<BTreeSet<_>>();
    let mut map = BTreeMap::new();
    for (group_index, group) in groups.iter().enumerate() {
        for edge_index in &group.members {
            if line_edges.contains(edge_index) {
                map.insert(*edge_index, group_index);
            }
        }
    }
    map
}

fn vertex_group_map(
    program: &CandidateProgram,
    edge_group: &BTreeMap<usize, usize>,
) -> BTreeMap<usize, BTreeSet<usize>> {
    let mut map = BTreeMap::<usize, BTreeSet<usize>>::new();
    for (edge_index, group_index) in edge_group {
        let Some(edge) = program.edges.get(*edge_index) else {
            continue;
        };
        for vertex in edge.vertices {
            map.entry(vertex).or_default().insert(*group_index);
        }
    }
    map
}

fn project_vertex_to_groups(
    point: Point2,
    group_ids: &[usize],
    group_lines: &[(Point2, f64)],
) -> Option<Point2> {
    let lines = group_ids
        .iter()
        .filter_map(|id| group_lines.get(*id))
        .copied()
        .collect::<Vec<_>>();
    if lines.is_empty() {
        return None;
    }
    if lines.len() == 1 {
        return Some(project_to_line(point, lines[0]));
    }
    solve_lines_least_squares(&lines)
}

#[derive(Debug, Clone, Copy)]
struct MergeReport {
    candidates: usize,
    merged: usize,
}

fn merge_near_reconciled_vertices(
    program: &mut CandidateProgram,
    vertex_groups: &BTreeMap<usize, BTreeSet<usize>>,
    max_distance: f64,
    freeze_boundary_vertices: bool,
) -> MergeReport {
    let mut parent = (0..program.vertices.len()).collect::<Vec<_>>();
    let mut candidates = 0usize;
    let mut merged = 0usize;
    for left in 0..program.vertices.len() {
        if freeze_boundary_vertices && program.vertices[left].kind != VertexKind::Interior {
            continue;
        }
        for right in left + 1..program.vertices.len() {
            if freeze_boundary_vertices && program.vertices[right].kind != VertexKind::Interior {
                continue;
            }
            if selected_edge_between(program, left, right) {
                continue;
            }
            let distance = distance(
                program.vertices[left].position,
                program.vertices[right].position,
            );
            if distance > max_distance {
                continue;
            }
            let left_groups = vertex_groups.get(&left).cloned().unwrap_or_default();
            let right_groups = vertex_groups.get(&right).cloned().unwrap_or_default();
            let union_count = left_groups.union(&right_groups).count();
            let intersects = left_groups.intersection(&right_groups).next().is_some();
            if union_count < 2 || !intersects {
                continue;
            }
            candidates += 1;
            let root_left = find_parent(&mut parent, left);
            let root_right = find_parent(&mut parent, right);
            if root_left != root_right {
                let keep = root_left.min(root_right);
                let drop = root_left.max(root_right);
                parent[drop] = keep;
                merged += 1;
            }
        }
    }
    if merged == 0 {
        return MergeReport { candidates, merged };
    }

    let mut clusters = BTreeMap::<usize, Vec<usize>>::new();
    for index in 0..parent.len() {
        let root = find_parent(&mut parent, index);
        clusters.entry(root).or_default().push(index);
    }
    for (root, members) in &clusters {
        if members.len() <= 1 {
            continue;
        }
        let mut x = 0.0;
        let mut y = 0.0;
        for member in members {
            x += program.vertices[*member].position.x;
            y += program.vertices[*member].position.y;
        }
        let merged_point = Point2::new(x / members.len() as f64, y / members.len() as f64);
        program.vertices[*root].position = merged_point;
        program.vertices[*root]
            .provenance
            .push(Provenance::CarrierReconciled);
        for member in members {
            if member == root {
                continue;
            }
            for edge in &mut program.edges {
                for vertex in &mut edge.vertices {
                    if *vertex == *member {
                        *vertex = *root;
                    }
                }
            }
        }
    }
    MergeReport { candidates, merged }
}

fn selected_edge_between(program: &CandidateProgram, left: usize, right: usize) -> bool {
    program.edges.iter().any(|edge| {
        edge.selection == EdgeSelection::Selected
            && ((edge.vertices[0] == left && edge.vertices[1] == right)
                || (edge.vertices[0] == right && edge.vertices[1] == left))
    })
}

fn find_parent(parent: &mut [usize], index: usize) -> usize {
    if parent[index] != index {
        parent[index] = find_parent(parent, parent[index]);
    }
    parent[index]
}

fn reject_degenerate_selected_edges(program: &mut CandidateProgram) -> usize {
    let mut rejected = 0usize;
    for edge in &mut program.edges {
        if edge.selection != EdgeSelection::Selected {
            continue;
        }
        if edge.vertices[0] == edge.vertices[1] {
            edge.selection = EdgeSelection::Rejected;
            rejected += 1;
            continue;
        }
        let Some(start) = program
            .vertices
            .get(edge.vertices[0])
            .map(|vertex| vertex.position)
        else {
            continue;
        };
        let Some(end) = program
            .vertices
            .get(edge.vertices[1])
            .map(|vertex| vertex.position)
        else {
            continue;
        };
        if distance(start, end) <= 1e-9 {
            edge.selection = EdgeSelection::Rejected;
            rejected += 1;
        }
    }
    rejected
}

fn rebuild_carriers_from_edges(program: &mut CandidateProgram) {
    let edges = program.edges.clone();
    for edge in edges {
        let Some(start) = program
            .vertices
            .get(edge.vertices[0])
            .map(|vertex| vertex.position)
        else {
            continue;
        };
        let Some(end) = program
            .vertices
            .get(edge.vertices[1])
            .map(|vertex| vertex.position)
        else {
            continue;
        };
        if distance(start, end) <= 1e-9 {
            continue;
        }
        let (normal, rho) = canonical_line(line_normal(start, end), start);
        if let Some(carrier) = program
            .carriers
            .iter_mut()
            .find(|carrier| carrier.id == edge.carrier_id)
        {
            carrier.normal = normal;
            carrier.rho = rho;
            carrier.family = carrier_family(start, end, edge.assignment.label);
            carrier.support_interval = support_interval(start, end);
        }
    }
}

fn rebuild_incident_carriers(program: &mut CandidateProgram) {
    for vertex in &mut program.vertices {
        vertex.incident_carriers.clear();
    }
    let mut incident = BTreeMap::<usize, BTreeSet<usize>>::new();
    for edge in &program.edges {
        if edge.selection != EdgeSelection::Selected {
            continue;
        }
        for vertex in edge.vertices {
            incident.entry(vertex).or_default().insert(edge.carrier_id);
        }
    }
    for (index, vertex) in program.vertices.iter_mut().enumerate() {
        vertex.incident_carriers = incident
            .remove(&index)
            .map(|ids| ids.into_iter().collect())
            .unwrap_or_default();
    }
}

fn solve_lines_least_squares(lines: &[(Point2, f64)]) -> Option<Point2> {
    let mut a00 = 0.0;
    let mut a01 = 0.0;
    let mut a11 = 0.0;
    let mut b0 = 0.0;
    let mut b1 = 0.0;
    for (normal, rho) in lines {
        let nx = normal.x;
        let ny = normal.y;
        a00 += nx * nx;
        a01 += nx * ny;
        a11 += ny * ny;
        b0 += nx * *rho;
        b1 += ny * *rho;
    }
    let det = a00 * a11 - a01 * a01;
    if det.abs() < 1e-9 {
        return None;
    }
    Some(Point2::new(
        (b0 * a11 - b1 * a01) / det,
        (a00 * b1 - a01 * b0) / det,
    ))
}

fn project_to_line(point: Point2, line: (Point2, f64)) -> Point2 {
    let (normal, rho) = line;
    let signed_distance = normal.x * point.x + normal.y * point.y - rho;
    Point2::new(
        point.x - signed_distance * normal.x,
        point.y - signed_distance * normal.y,
    )
}

fn canonical_line(normal: Point2, point: Point2) -> (Point2, f64) {
    let mut normal = normalized(normal);
    let mut rho = normal.x * point.x + normal.y * point.y;
    if normal.x < -1e-12 || (normal.x.abs() <= 1e-12 && normal.y < -1e-12) {
        normal.x = -normal.x;
        normal.y = -normal.y;
        rho = -rho;
    }
    (normal, rho)
}

fn normal_angle_distance(left: Point2, right: Point2) -> f64 {
    let dot = (left.x * right.x + left.y * right.y).clamp(-1.0, 1.0);
    dot.acos().min((-dot).acos())
}

fn line_normal(start: Point2, end: Point2) -> Point2 {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let length = (dx * dx + dy * dy).sqrt().max(1e-12);
    Point2::new(-dy / length, dx / length)
}

fn normalized(point: Point2) -> Point2 {
    let length = (point.x * point.x + point.y * point.y).sqrt().max(1e-12);
    Point2::new(point.x / length, point.y / length)
}

fn carrier_family(start: Point2, end: Point2, assignment: AssignmentLabel) -> CarrierFamily {
    if assignment == AssignmentLabel::Boundary {
        return CarrierFamily::Border;
    }
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let epsilon = 1e-6;
    if dy.abs() <= epsilon {
        CarrierFamily::Horizontal
    } else if dx.abs() <= epsilon {
        CarrierFamily::Vertical
    } else if (dx.abs() - dy.abs()).abs() <= epsilon {
        if dx.signum() == dy.signum() {
            CarrierFamily::DiagonalPositive
        } else {
            CarrierFamily::DiagonalNegative
        }
    } else {
        CarrierFamily::Free
    }
}

fn support_interval(start: Point2, end: Point2) -> [f64; 2] {
    if (end.x - start.x).abs() >= (end.y - start.y).abs() {
        [start.x.min(end.x), start.x.max(end.x)]
    } else {
        [start.y.min(end.y), start.y.max(end.y)]
    }
}

fn selected_edge_count(program: &CandidateProgram) -> usize {
    program
        .edges
        .iter()
        .filter(|edge| edge.selection == EdgeSelection::Selected)
        .count()
}

fn unit_scale(program: &CandidateProgram) -> f64 {
    program.image_size.map(f64::from).unwrap_or(1024.0).max(1.0)
}

fn px_to_unit(program: &CandidateProgram, px: f64) -> f64 {
    px / unit_scale(program)
}

fn distance(left: Point2, right: Point2) -> f64 {
    let dx = left.x - right.x;
    let dy = left.y - right.y;
    (dx * dx + dy * dy).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AssignmentCandidate, CandidateEdge, CandidateVertex, EdgeSelection, EvidenceSource,
    };

    #[test]
    fn collinear_segments_project_to_shared_carrier() {
        let mut program = test_program(vec![
            Point2::new(0.1, 0.2),
            Point2::new(0.4, 0.401),
            Point2::new(0.7, 0.598),
        ]);
        program.edges.push(edge(0, [0, 1]));
        program.edges.push(edge(1, [1, 2]));
        rebuild_carriers_from_edges(&mut program);
        rebuild_incident_carriers(&mut program);

        let result = reconcile_carriers(
            &program,
            CarrierReconcileOptions {
                allow_single_carrier_projection: true,
                ..Default::default()
            },
        );

        assert_eq!(result.report.accepted_groups, 1);
        assert!(result.report.vertices_moved > 0);
        let start = result.program.vertices[0].position;
        let middle = result.program.vertices[1].position;
        let end = result.program.vertices[2].position;
        assert!(
            point_line_distance(middle, start, end) < 1e-6,
            "middle vertex should lie on reconciled carrier"
        );
    }

    #[test]
    fn boundary_vertices_are_not_moved() {
        let mut program = test_program(vec![
            Point2::new(0.0, 0.2),
            Point2::new(0.5, 0.501),
            Point2::new(1.0, 0.8),
        ]);
        program.vertices[0].kind = VertexKind::Boundary;
        program.vertices[2].kind = VertexKind::Boundary;
        program.edges.push(edge(0, [0, 1]));
        program.edges.push(edge(1, [1, 2]));
        rebuild_carriers_from_edges(&mut program);
        rebuild_incident_carriers(&mut program);

        let result = reconcile_carriers(&program, Default::default());

        assert_eq!(
            result.program.vertices[0].position,
            program.vertices[0].position
        );
        assert_eq!(
            result.program.vertices[2].position,
            program.vertices[2].position
        );
    }

    #[test]
    fn close_parallel_unconnected_edges_are_not_reconciled_together() {
        let mut program = test_program(vec![
            Point2::new(0.1, 0.2),
            Point2::new(0.4, 0.4),
            Point2::new(0.12, 0.205),
            Point2::new(0.42, 0.405),
        ]);
        program.edges.push(edge(0, [0, 1]));
        program.edges.push(edge(1, [2, 3]));
        rebuild_carriers_from_edges(&mut program);
        rebuild_incident_carriers(&mut program);

        let result = reconcile_carriers(&program, Default::default());

        assert_eq!(result.report.accepted_groups, 0);
        assert_eq!(result.report.vertices_moved, 0);
        assert_eq!(
            result.program.vertices[0].position,
            program.vertices[0].position
        );
        assert_eq!(
            result.program.vertices[2].position,
            program.vertices[2].position
        );
    }

    fn test_program(points: Vec<Point2>) -> CandidateProgram {
        CandidateProgram {
            coordinate_space: "unit_test".to_owned(),
            image_size: Some(1024),
            carriers: Vec::new(),
            vertices: points
                .into_iter()
                .enumerate()
                .map(|(id, position)| CandidateVertex {
                    id,
                    position,
                    kind: VertexKind::Interior,
                    support: 1.0,
                    boundary_side: None,
                    incident_carriers: Vec::new(),
                    provenance: vec![Provenance::ObservedStrong],
                })
                .collect(),
            edges: Vec::new(),
        }
    }

    fn edge(id: usize, vertices: [usize; 2]) -> CandidateEdge {
        CandidateEdge {
            id,
            carrier_id: id,
            vertices,
            assignment: AssignmentCandidate {
                label: AssignmentLabel::Mountain,
                confidence: 1.0,
                margin: 0.0,
            },
            line_support: 1.0,
            style_support: 0.0,
            selection: EdgeSelection::Selected,
            source: EvidenceSource::ObservedStrong,
            provenance: vec![Provenance::ObservedStrong],
        }
    }

    fn point_line_distance(point: Point2, start: Point2, end: Point2) -> f64 {
        let dx = end.x - start.x;
        let dy = end.y - start.y;
        let length = (dx * dx + dy * dy).sqrt();
        ((point.x - start.x) * dy - (point.y - start.y) * dx).abs() / length.max(1e-12)
    }
}

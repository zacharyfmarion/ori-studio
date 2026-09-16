use super::{AuxiliarySegment, Segment, length};
use crate::decode::DecodeError;
use oristudio_cp_compiler::{ExactSolveInput, ExactSolvedGraph};
use serde_json::{Value, json};
use std::collections::{BTreeSet, HashMap};
use treemaker_fold::{Assignment, FoldAngle, FoldDocument};

// This is only arithmetic welding, never a detector-scale proximity merge.
const WELD: f64 = 1e-8;

type Point = [f64; 2];

fn sub(a: Point, b: Point) -> Point {
    [a[0] - b[0], a[1] - b[1]]
}
fn dot(a: Point, b: Point) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}
fn cross(a: Point, b: Point) -> f64 {
    a[0] * b[1] - a[1] * b[0]
}
fn distance(a: Point, b: Point) -> f64 {
    let d = sub(a, b);
    d[0].hypot(d[1])
}
fn lerp(a: Point, b: Point, t: f64) -> Point {
    [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
}
fn point(v: &[f64]) -> Point {
    [v[0], v[1]]
}

fn read_fold(fold_json: &str) -> Result<FoldDocument, DecodeError> {
    let fold: FoldDocument = serde_json::from_str(fold_json)?;
    if fold
        .vertices_coords
        .iter()
        .any(|v| v.len() < 2 || v.iter().any(|c| !c.is_finite()))
        || fold
            .edges_vertices
            .iter()
            .flatten()
            .any(|&v| v >= fold.vertices_coords.len())
    {
        return Err(DecodeError::InvalidPixelEvidence(
            "invalid AUX attachment graph",
        ));
    }
    Ok(fold)
}

/// An AUX endpoint bound to a physical vertex or a point on a physical edge.
/// Binding in recognition coordinates first keeps it attached when the solver
/// moves that geometry. AUX crossings are recomputed on the solved carriers.
#[derive(Clone, Copy)]
struct Anchor {
    vertices: [usize; 2],
    t: f64,
}

fn anchor(p: Point, other: Point, fold: &FoldDocument, radius: f64) -> Option<Anchor> {
    let radius = radius.min(distance(p, other) * 0.5);
    let nearest = fold
        .vertices_coords
        .iter()
        .enumerate()
        .map(|(id, v)| (distance(p, point(v)), id))
        .filter(|(d, id)| {
            let ray = sub(p, other);
            let normal_error = cross(sub(point(&fold.vertices_coords[*id]), other), ray).abs()
                / distance(p, other).max(WELD);
            *d <= radius && normal_error <= radius.min(snap_radius(fold) / 8.0)
        })
        .min_by(|a, b| a.0.total_cmp(&b.0));
    if let Some((_, id)) = nearest {
        return Some(Anchor {
            vertices: [id, id],
            t: 0.0,
        });
    }
    let ray = sub(p, other);
    let mut best: Option<(f64, Anchor)> = None;
    for &vertices in &fold.edges_vertices {
        let a = point(&fold.vertices_coords[vertices[0]]);
        let b = point(&fold.vertices_coords[vertices[1]]);
        let edge = sub(b, a);
        let denom = cross(ray, edge);
        if denom.abs() <= 1e-10 {
            continue;
        }
        let t = cross(sub(a, other), ray) / denom;
        if !(0.0..=1.0).contains(&t) {
            continue;
        }
        let q = lerp(a, b, t);
        let d = distance(p, q);
        if d <= radius && best.as_ref().is_none_or(|(old, _)| d < *old) {
            best = Some((d, Anchor { vertices, t }));
        }
    }
    best.map(|(_, a)| a)
}

fn representative(aliases: &[usize], mut id: usize) -> usize {
    while aliases[id] != id {
        id = aliases[id];
    }
    id
}

fn snap_radius(fold: &FoldDocument) -> f64 {
    let size = fold
        .extra
        .get("cp_detector")
        .and_then(|m| m.get("image_size"))
        .and_then(Value::as_f64)
        .unwrap_or(1024.0);
    (16.0 / (size - 64.0).max(64.0)).min(0.02)
}

fn anchored_segments(
    segments: &[AuxiliarySegment],
    source: &FoldDocument,
    targets: &[Point],
) -> Result<Vec<Segment>, DecodeError> {
    let radius = snap_radius(source);
    let mut lines: Vec<_> = segments.iter().map(|s| s.endpoints).collect();
    if lines.iter().flatten().flatten().any(|v| !v.is_finite()) {
        return Err(DecodeError::InvalidPixelEvidence(
            "nonfinite AUX coordinates",
        ));
    }
    // A colored fold can erase cyan on both sides of its raster footprint.
    // Bridge aligned fragments only when a physical edge actually crosses the
    // gap, rather than joining arbitrary white gaps in construction lines.
    let mut i = 0;
    while i < lines.len() {
        let mut j = i + 1;
        while j < lines.len() {
            if let Some(joined) = bridge_across_crease(lines[i], lines[j], source, radius) {
                lines[i] = joined;
                lines.remove(j);
                j = i + 1;
            } else {
                j += 1;
            }
        }
        i += 1;
    }
    let mut bindings: Vec<_> = lines
        .iter()
        .map(|s| [0, 1].map(|i| anchor(s[i], s[1 - i], source, radius)))
        .collect();
    // References ending on one physical edge can fit a pixel apart. Union the
    // endpoint groups before averaging, so three or more references still get
    // one common point. Parallel hatch endpoints must remain distinct.
    let mut groups: Vec<_> = (0..2 * lines.len()).collect();
    for i in 0..lines.len() {
        for j in 0..i {
            if cross(sub(lines[i][1], lines[i][0]), sub(lines[j][1], lines[j][0])).abs()
                < 0.15 * length(lines[i]) * length(lines[j])
            {
                continue;
            }
            for ei in 0..2 {
                for ej in 0..2 {
                    let (Some(a), Some(b)) = (bindings[i][ei], bindings[j][ej]) else {
                        continue;
                    };
                    if a.vertices != b.vertices {
                        continue;
                    }
                    let length = distance(
                        point(&source.vertices_coords[a.vertices[0]]),
                        point(&source.vertices_coords[a.vertices[1]]),
                    );
                    if (a.t - b.t).abs() * length <= radius / 4.0 {
                        let a = representative(&groups, 2 * i + ei);
                        let b = representative(&groups, 2 * j + ej);
                        groups[a.max(b)] = a.min(b);
                    }
                }
            }
        }
    }
    let mut means: HashMap<usize, (f64, usize)> = HashMap::new();
    for (id, binding) in bindings.iter().flatten().enumerate() {
        if let Some(a) = binding {
            let entry = means.entry(representative(&groups, id)).or_default();
            entry.0 += a.t;
            entry.1 += 1;
        }
    }
    for (id, binding) in bindings.iter_mut().flatten().enumerate() {
        if let Some(a) = binding
            && let Some(&(sum, count)) = means.get(&representative(&groups, id))
        {
            a.t = sum / count as f64;
        }
    }
    let mut anchored: Vec<_> = lines
        .iter()
        .zip(&bindings)
        .map(|(s, bindings)| {
            [0, 1].map(|i| {
                bindings[i].map_or(s[i], |a| {
                    lerp(targets[a.vertices[0]], targets[a.vertices[1]], a.t)
                })
            })
        })
        .collect();
    // Reference-only corners are not vertex-head targets. Recover their shared
    // endpoint from the two carriers, preserving any physical endpoint binding.
    let original = anchored.clone();
    for (i, s) in original.iter().enumerate() {
        for end in 0..2 {
            if bindings[i][end].is_some() {
                continue;
            }
            let mut best: Option<(f64, Point)> = None;
            for (j, other) in original.iter().enumerate() {
                if i == j {
                    continue;
                }
                let da = sub(s[1], s[0]);
                let db = sub(other[1], other[0]);
                let denom = cross(da, db);
                if denom.abs() < 0.15 * length(*s) * length(*other) {
                    continue;
                }
                let t = cross(sub(other[0], s[0]), db) / denom;
                let q = lerp(s[0], s[1], t);
                let u = dot(sub(q, other[0]), db) / dot(db, db);
                let d = distance(q, s[end]);
                let other_extension = (-u).max(u - 1.0).max(0.0) * length(*other);
                if d <= radius.min(length(*s) * 0.5)
                    && other_extension <= radius.min(length(*other) * 0.5)
                    && best.as_ref().is_none_or(|(old, _)| d < *old)
                {
                    best = Some((d, q));
                }
            }
            if let Some((_, q)) = best {
                anchored[i][end] = q;
            }
        }
    }
    Ok(anchored)
}

fn bridge_across_crease(
    a: Segment,
    b: Segment,
    fold: &FoldDocument,
    radius: f64,
) -> Option<Segment> {
    let len = length(a);
    let other_len = length(b);
    if len <= WELD || other_len <= WELD {
        return None;
    }
    let direction = sub(a[1], a[0]);
    let other = sub(b[1], b[0]);
    if cross(direction, other).abs() > 2.0f64.to_radians().sin() * len * other_len {
        return None;
    }
    let tolerance = snap_radius(fold) / 8.0;
    if b.iter()
        .any(|&p| cross(sub(p, a[0]), direction).abs() / len > tolerance)
    {
        return None;
    }
    let mut points: Vec<_> = a
        .into_iter()
        .chain(b)
        .map(|p| (dot(sub(p, a[0]), direction) / len, p))
        .collect();
    points.sort_by(|a, b| a.0.total_cmp(&b.0));
    let gap = [points[1].1, points[2].1];
    if length(gap) > radius * 2.0 {
        return None;
    }
    let overlap = on_segment(a[0], b).is_some()
        || on_segment(a[1], b).is_some()
        || on_segment(b[0], a).is_some()
        || on_segment(b[1], a).is_some();
    let crosses = fold
        .edges_vertices
        .iter()
        .any(|e| !intersections(gap, e.map(|id| point(&fold.vertices_coords[id]))).is_empty());
    if overlap || crosses {
        Some([points[0].1, points[3].1])
    } else {
        None
    }
}

/// Export AUX as part of the drawing graph: weld endpoints and planarize both
/// AUX/crease and AUX/AUX intersections. Physical coordinates and assignments
/// are preserved; their metadata is copied to each resulting sub-edge.
pub fn append_auxiliary(
    fold_json: &str,
    segments: &[AuxiliarySegment],
) -> Result<String, DecodeError> {
    if segments.is_empty() {
        return Ok(fold_json.to_owned());
    }
    let fold = read_fold(fold_json)?;
    let targets: Vec<_> = fold.vertices_coords.iter().map(|v| point(v)).collect();
    let anchored = anchored_segments(segments, &fold, &targets)?;
    planarize(fold, &anchored)
}

/// The physical solver uses a reduced graph. Restore the complete drawing
/// graph at its answer, transporting endpoint bindings through its vertex map.
/// Shared Rust code is used by both the browser and native export bridges.
pub fn append_solved_auxiliary(
    fold_json: &str,
    segments: &[AuxiliarySegment],
    input: &ExactSolveInput,
    solved: &ExactSolvedGraph,
) -> Result<String, DecodeError> {
    if segments.is_empty() {
        return Ok(fold_json.to_owned());
    }
    let source = oristudio_cp_compiler::fold_export::export_candidate_to_fold_document(input)?;
    let ids = source
        .extra
        .get("cp_detector")
        .and_then(|m| m.get("vertex_original_ids"))
        .and_then(Value::as_array)
        .ok_or(DecodeError::InvalidPixelEvidence(
            "missing AUX source vertex map",
        ))?;
    // Match the physical export's canonical representative for merged vertices.
    let mut aliases: Vec<_> = (0..solved.vertices_exact.len()).collect();
    for &[a, b] in &solved.merged_vertices {
        if a < aliases.len() && b < aliases.len() {
            let a = representative(&aliases, a);
            let b = representative(&aliases, b);
            aliases[a.max(b)] = a.min(b);
        }
    }
    let targets: Result<Vec<Point>, DecodeError> = ids
        .iter()
        .map(|id| {
            let id = id.as_u64().and_then(|i| usize::try_from(i).ok()).ok_or(
                DecodeError::InvalidPixelEvidence("invalid AUX source vertex id"),
            )?;
            solved.vertices_exact.get(id).map(|p| [p.x, p.y]).ok_or(
                DecodeError::InvalidPixelEvidence("missing AUX solved vertex"),
            )
        })
        .collect();
    let anchored = anchored_segments(segments, &source, &targets?)?;
    planarize(read_fold(fold_json)?, &anchored)
}

struct VertexIndex {
    cells: HashMap<(i64, i64), Vec<usize>>,
}

impl VertexIndex {
    fn cell(p: Point) -> (i64, i64) {
        ((p[0] / WELD).floor() as i64, (p[1] / WELD).floor() as i64)
    }
    fn new(vertices: &[Vec<f64>]) -> Self {
        let mut index = Self {
            cells: HashMap::new(),
        };
        for (id, v) in vertices.iter().enumerate() {
            index
                .cells
                .entry(Self::cell(point(v)))
                .or_default()
                .push(id);
        }
        index
    }
    fn weld(&mut self, vertices: &mut Vec<Vec<f64>>, p: Point) -> usize {
        let (cx, cy) = Self::cell(p);
        let mut nearest = None;
        for dx in -1..=1 {
            for dy in -1..=1 {
                if let Some(ids) = self
                    .cells
                    .get(&(cx.saturating_add(dx), cy.saturating_add(dy)))
                {
                    for &id in ids {
                        if distance(point(&vertices[id]), p) <= WELD
                            && nearest.is_none_or(|old| id < old)
                        {
                            nearest = Some(id);
                        }
                    }
                }
            }
        }
        if let Some(id) = nearest {
            return id;
        }
        let id = vertices.len();
        vertices.push(p.to_vec());
        self.cells.entry((cx, cy)).or_default().push(id);
        id
    }
}

fn on_segment(p: Point, segment: Segment) -> Option<f64> {
    let d = sub(segment[1], segment[0]);
    let len = length(segment);
    if len <= WELD {
        return None;
    }
    let t = dot(sub(p, segment[0]), d) / (len * len);
    if t >= -WELD / len
        && t <= 1.0 + WELD / len
        && distance(p, lerp(segment[0], segment[1], t)) <= WELD
    {
        Some(t.clamp(0.0, 1.0))
    } else {
        None
    }
}

fn intersections(a: Segment, b: Segment) -> Vec<(f64, f64, Point)> {
    let da = sub(a[1], a[0]);
    let db = sub(b[1], b[0]);
    let denom = cross(da, db);
    if denom.abs() > 1e-10 * length(a) * length(b) {
        let delta = sub(b[0], a[0]);
        let ta = cross(delta, db) / denom;
        let tb = cross(delta, da) / denom;
        if (-1e-9..=1.0 + 1e-9).contains(&ta) && (-1e-9..=1.0 + 1e-9).contains(&tb) {
            return vec![(
                ta.clamp(0.0, 1.0),
                tb.clamp(0.0, 1.0),
                lerp(a[0], a[1], ta.clamp(0.0, 1.0)),
            )];
        }
        return vec![];
    }
    // Collinear overlaps need endpoint cuts too. Duplicate resulting edges
    // are dropped below, preferring the original physical assignment.
    a.into_iter()
        .chain(b)
        .filter_map(|p| Some((on_segment(p, a)?, on_segment(p, b)?, p)))
        .collect()
}

fn planarize(mut fold: FoldDocument, auxiliary: &[Segment]) -> Result<String, DecodeError> {
    let old_edges = fold.edges_vertices.len();
    let old_vertices = fold.vertices_coords.len();
    let mut edges = fold.edges_vertices.clone();
    let mut vertex_index = VertexIndex::new(&fold.vertices_coords);
    for &s in auxiliary {
        if length(s) <= WELD {
            continue;
        }
        edges.push(s.map(|p| vertex_index.weld(&mut fold.vertices_coords, p)));
    }
    let segments: Vec<_> = edges
        .iter()
        .map(|e| e.map(|v| point(&fold.vertices_coords[v])))
        .collect();
    let mut cuts: Vec<Vec<(f64, usize)>> = edges
        .iter()
        .map(|e| vec![(0.0, e[0]), (1.0, e[1])])
        .collect();
    // Do not modify physical/physical topology here. Recognition owns it, and
    // solving has already validated it. Only the added references need cuts.
    for i in old_edges..edges.len() {
        for j in 0..i {
            for (ti, tj, p) in intersections(segments[i], segments[j]) {
                // Raster uncertainty can put a carrier a pixel beside an
                // existing multi-crease vertex. Use that vertex, not a cluster
                // of tiny crossings around it. Never move physical geometry.
                let tolerance = snap_radius(&fold) / 8.0;
                let nearby = if j < old_edges {
                    edges[j]
                        .into_iter()
                        .filter(|&v| distance(point(&fold.vertices_coords[v]), p) <= tolerance)
                        .min_by(|&a, &b| {
                            distance(point(&fold.vertices_coords[a]), p)
                                .total_cmp(&distance(point(&fold.vertices_coords[b]), p))
                        })
                } else {
                    None
                };
                let id = nearby.unwrap_or_else(|| vertex_index.weld(&mut fold.vertices_coords, p));
                let tj = if id == edges[j][0] {
                    0.0
                } else if id == edges[j][1] {
                    1.0
                } else {
                    tj
                };
                cuts[i].push((ti, id));
                cuts[j].push((tj, id));
            }
        }
    }
    let mut origins = Vec::new();
    let mut new_edges = Vec::new();
    let mut seen = BTreeSet::new();
    for (origin, points) in cuts.iter_mut().enumerate() {
        points.sort_by(|a, b| a.0.total_cmp(&b.0));
        points.dedup_by(|a, b| a.1 == b.1);
        for pair in points.windows(2) {
            let e = [pair[0].1, pair[1].1];
            if e[0] == e[1]
                || distance(
                    point(&fold.vertices_coords[e[0]]),
                    point(&fold.vertices_coords[e[1]]),
                ) <= WELD
            {
                continue;
            }
            if seen.insert([e[0].min(e[1]), e[0].max(e[1])]) {
                new_edges.push(e);
                origins.push((origin < old_edges).then_some(origin));
            }
        }
    }
    let assignments: Vec<_> = origins
        .iter()
        .map(|id| id.map_or(Assignment::Flat, |i| fold.assignment_for_edge(i)))
        .collect();
    fold.edges_fold_angle = origins
        .iter()
        .map(|id| {
            id.map_or(FoldAngle::default_for_assignment(Assignment::Flat), |i| {
                fold.fold_angle_for_edge(i)
            })
        })
        .collect();
    fold.edges_assignment = assignments;
    fold.edges_vertices = new_edges;
    // Detector exports carry no faces. Avoid stale derived topology if a
    // caller passes one with faces; downstream face construction uses edges.
    fold.faces_vertices.clear();
    fold.faces_edges.clear();
    fold.edges_faces.clear();
    fold.face_orders.clear();
    if let Some(Value::Object(metadata)) = fold.extra.get_mut("cp_detector") {
        for (key, value) in metadata.iter_mut() {
            if let Value::Array(array) = value {
                if array.len() == old_edges
                    && (key.starts_with("edge_")
                        || key.starts_with("assignment_")
                        || key == "boundary_role")
                {
                    let neutral = match key.as_str() {
                        "edge_source" => json!("auxiliary"),
                        "edge_provenance" => json!([]),
                        "boundary_role" | "edge_boundary_role" => json!("none"),
                        "assignment_confidence" | "assignment_margin" | "edge_support" => {
                            json!(1.0)
                        }
                        _ => Value::Null,
                    };
                    *array = origins
                        .iter()
                        .map(|id| id.map_or_else(|| neutral.clone(), |i| array[i].clone()))
                        .collect();
                } else if array.len() == old_vertices && key.starts_with("vertex_") {
                    array.resize(fold.vertices_coords.len(), Value::Null);
                }
            }
        }
        metadata.insert(
            "auxiliary_segments".into(),
            json!(
                auxiliary
                    .iter()
                    .map(|&endpoints| AuxiliarySegment { endpoints })
                    .collect::<Vec<_>>()
            ),
        );
    }
    Ok(serde_json::to_string(&fold)?)
}

/// A deliberately non-exact preview of a timed-out solve. It must go through
/// the same graph export as accepted geometry: moving only the old physical
/// vertices in a previously split FOLD would kink creases and detach AUX.
pub fn partial_auxiliary_fold(
    segments: &[AuxiliarySegment],
    input: &ExactSolveInput,
    solved: &ExactSolvedGraph,
) -> Result<Option<Value>, DecodeError> {
    if segments.is_empty() || solved.movement_report.get("timed_out") != Some(&json!(true)) {
        return Ok(None);
    }
    let Some(moves) = solved
        .movement_report
        .get("attempted_moved_vertices")
        .and_then(Value::as_array)
    else {
        return Ok(None);
    };
    if moves.is_empty() {
        return Ok(None);
    }
    let mut preview = solved.clone();
    for movement in moves {
        let Some(id) = movement
            .get("vertex_id")
            .and_then(Value::as_u64)
            .and_then(|v| usize::try_from(v).ok())
        else {
            return Ok(None);
        };
        let Some(x) = movement["after"]["x"].as_f64().filter(|v| v.is_finite()) else {
            return Ok(None);
        };
        let Some(y) = movement["after"]["y"].as_f64().filter(|v| v.is_finite()) else {
            return Ok(None);
        };
        let Some(p) = preview.vertices_exact.get_mut(id) else {
            return Ok(None);
        };
        p.x = x;
        p.y = y;
    }
    let physical =
        oristudio_cp_compiler::fold_export::export_exact_solved_to_fold_document(input, &preview)?;
    let fold = append_solved_auxiliary(
        &serde_json::to_string(&physical)?,
        segments,
        input,
        &preview,
    )?;
    Ok(Some(serde_json::from_str(&fold)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use oristudio_cp_compiler::{
        ExactSolveOptions, analyze_candidate_topology, exact_solve_input_from_fold, solve_exact,
    };

    fn square() -> FoldDocument {
        let mut f = FoldDocument::new(
            vec![vec![0., 0.], vec![1., 0.], vec![1., 1.], vec![0., 1.]],
            vec![[0, 1], [1, 2], [2, 3], [3, 0]],
        );
        f.edges_assignment = vec![Assignment::Boundary; 4];
        f
    }
    fn attach(f: &FoldDocument, aux: &[Segment]) -> FoldDocument {
        serde_json::from_str(
            &append_auxiliary(
                &serde_json::to_string(f).unwrap(),
                &aux.iter()
                    .map(|&endpoints| AuxiliarySegment { endpoints })
                    .collect::<Vec<_>>(),
            )
            .unwrap(),
        )
        .unwrap()
    }
    fn vertex(f: &FoldDocument, p: Point) -> usize {
        f.vertices_coords
            .iter()
            .position(|v| distance(point(v), p) < WELD)
            .unwrap()
    }
    fn degree(f: &FoldDocument, id: usize, assignment: Assignment) -> usize {
        f.edges_vertices
            .iter()
            .zip(&f.edges_assignment)
            .filter(|(e, a)| **a == assignment && e.contains(&id))
            .count()
    }
    #[test]
    fn references_split_each_other_and_share_border_vertices() {
        let f = attach(
            &square(),
            &[[[0.003, 0.5], [0.997, 0.5]], [[0.5, 0.003], [0.5, 0.997]]],
        );
        assert_eq!(f.vertices_coords.len(), 9);
        assert_eq!(f.edges_vertices.len(), 12);
        assert_eq!(degree(&f, vertex(&f, [0.5, 0.5]), Assignment::Flat), 4);
        for p in [[0., 0.5], [1., 0.5], [0.5, 0.], [0.5, 1.]] {
            let id = vertex(&f, p);
            assert_eq!(degree(&f, id, Assignment::Boundary), 2);
            assert_eq!(degree(&f, id, Assignment::Flat), 1);
        }
    }
    #[test]
    fn overlapping_aux_never_relabels_or_duplicates_a_physical_edge() {
        let mut source = square();
        source.extra.insert(
            "cp_detector".into(),
            json!({"edge_support":[0.1,0.2,0.3,0.4],"vertex_original_ids":[0,1,2,3]}),
        );
        let f = attach(&source, &[[[0.25, 0.], [0.75, 0.]]]);
        assert_eq!(f.edges_vertices.len(), 6);
        assert!(
            f.edges_assignment
                .iter()
                .all(|&a| a == Assignment::Boundary)
        );
        assert_eq!(
            f.extra["cp_detector"]["edge_support"],
            json!([0.1, 0.1, 0.1, 0.2, 0.3, 0.4])
        );
        assert_eq!(
            f.extra["cp_detector"]["vertex_original_ids"]
                .as_array()
                .unwrap()
                .len(),
            f.vertices_coords.len()
        );
    }
    #[test]
    fn aux_crossings_do_not_create_foldability_defects_or_prevent_degree_two_collapse() {
        let mut f = square();
        f.vertices_coords.extend([vec![0.5, 0.], vec![0.5, 1.]]);
        f.edges_vertices = vec![[0, 4], [4, 1], [1, 2], [2, 5], [5, 3], [3, 0], [4, 5]];
        f.edges_assignment = vec![Assignment::Boundary; 6];
        f.edges_assignment.push(Assignment::Mountain);
        let integrated = attach(&f, &[[[0., 0.4], [1., 0.4]], [[0.5, 0.4], [0.8, 0.7]]]);
        assert_eq!(
            degree(
                &integrated,
                vertex(&integrated, [0.5, 0.4]),
                Assignment::Mountain
            ),
            2
        );
        let (input, _) = exact_solve_input_from_fold(&integrated).unwrap();
        let topology = analyze_candidate_topology(&input);
        assert!(topology.combinatorial.degree_two_vertices.is_empty());
        assert!(topology.combinatorial.odd_degree_vertices.is_empty());
        let solved = solve_exact(&input, ExactSolveOptions::default());
        assert!(matches!(
            solved.status,
            oristudio_cp_compiler::ExactSolvedGraphStatus::Solved
        ));
        let output = oristudio_cp_compiler::fold_export::export_exact_solved_to_fold_document(
            &input, &solved,
        )
        .unwrap();
        assert_eq!(output.edges_vertices.len(), integrated.edges_vertices.len());
        assert_eq!(
            output
                .edges_assignment
                .iter()
                .filter(|&&a| a == Assignment::Flat)
                .count(),
            3
        );
    }
    #[test]
    fn a_reference_corner_on_a_crease_is_one_vertex_not_two_nearby_crossings() {
        let mut f = square();
        f.edges_vertices.push([0, 2]);
        f.edges_assignment.push(Assignment::Mountain);
        let joined = attach(
            &f,
            &[[[0.2, 0.5], [0.499, 0.5]], [[0.502, 0.503], [0.502, 0.8]]],
        );
        let shared: Vec<_> = (0..joined.vertices_coords.len())
            .filter(|&id| {
                degree(&joined, id, Assignment::Mountain) == 2
                    && degree(&joined, id, Assignment::Flat) == 2
            })
            .collect();
        assert_eq!(shared.len(), 1);
    }

    #[test]
    fn multiple_reference_ends_share_one_point_on_a_fold() {
        let mut f = square();
        f.edges_vertices.push([0, 2]);
        f.edges_assignment.push(Assignment::Mountain);
        let joined = attach(
            &f,
            &[
                [[0.2, 0.5], [0.499, 0.5]],
                [[0.502, 0.503], [0.502, 0.8]],
                [[0.499, 0.501], [0.8, 0.2]],
            ],
        );
        let shared: Vec<_> = (0..joined.vertices_coords.len())
            .filter(|&id| {
                degree(&joined, id, Assignment::Mountain) == 2
                    && degree(&joined, id, Assignment::Flat) == 3
            })
            .collect();
        assert_eq!(shared.len(), 1);
    }

    #[test]
    fn partial_preview_rebuilds_auxiliary_crossings_after_physical_vertices_move() {
        let mut f = square();
        f.vertices_coords.extend([vec![0.4, 0.], vec![0.4, 1.]]);
        f.edges_vertices = vec![[0, 4], [4, 1], [1, 2], [2, 5], [5, 3], [3, 0], [4, 5]];
        f.edges_assignment = vec![Assignment::Boundary; 6];
        f.edges_assignment.push(Assignment::Mountain);
        let (input, _) = exact_solve_input_from_fold(&f).unwrap();
        let mut solved = solve_exact(&input, ExactSolveOptions::default());
        solved.status = oristudio_cp_compiler::ExactSolvedGraphStatus::Failed;
        solved.movement_report = json!({"timed_out":true,"attempted_moved_vertices":[
            {"vertex_id":4,"after":{"x":0.45,"y":0.0}},
            {"vertex_id":5,"after":{"x":0.45,"y":1.0}}
        ]});
        let partial = partial_auxiliary_fold(
            &[AuxiliarySegment {
                endpoints: [[0., 0.5], [1., 0.5]],
            }],
            &input,
            &solved,
        )
        .unwrap()
        .unwrap();
        let partial: FoldDocument = serde_json::from_value(partial).unwrap();
        let shared = vertex(&partial, [0.45, 0.5]);
        assert_eq!(degree(&partial, shared, Assignment::Mountain), 2);
        assert_eq!(degree(&partial, shared, Assignment::Flat), 2);
        assert_eq!(
            partial.extra["cp_detector"]["exact_status"],
            json!("failed")
        );
    }

    #[test]
    fn aux_endpoint_bindings_follow_the_solved_physical_vertices() {
        let mut source = square();
        source
            .vertices_coords
            .extend([vec![0.4, 0.], vec![0.4, 1.]]);
        source.edges_vertices = vec![[0, 4], [4, 1], [1, 2], [2, 5], [5, 3], [3, 0], [4, 5]];
        source.edges_assignment = vec![Assignment::Boundary; 6];
        source.edges_assignment.push(Assignment::Mountain);
        let (input, _) = exact_solve_input_from_fold(&source).unwrap();
        let mut solved = solve_exact(&input, ExactSolveOptions::default());
        solved.vertices_exact[4].x = 0.45;
        solved.vertices_exact[5].x = 0.45;
        let physical = oristudio_cp_compiler::fold_export::export_exact_solved_to_fold_document(
            &input, &solved,
        )
        .unwrap();
        let output = append_solved_auxiliary(
            &serde_json::to_string(&physical).unwrap(),
            &[AuxiliarySegment {
                endpoints: [[0.402, 0.003], [0.9, 0.7]],
            }],
            &input,
            &solved,
        )
        .unwrap();
        let output: FoldDocument = serde_json::from_str(&output).unwrap();
        let id = vertex(&output, [0.45, 0.]);
        assert_eq!(degree(&output, id, Assignment::Flat), 1);
        assert_eq!(degree(&output, id, Assignment::Mountain), 1);
    }
}

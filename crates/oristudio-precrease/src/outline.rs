//! Border creases → closed loops → rectangular sheet frames.
//!
//! The border (`Black0`) segments of a crease pattern are chained by shared
//! endpoints into loops. A loop whose corners form a rectangle **in any
//! orientation** yields a [`Frame`]; anything else is refused with a reason
//! the UI can show. Never a bounding box: a canvas can hold several disjoint
//! patterns, and a bounding box would let points on one part "construct"
//! lines on another.
//!
//! Endpoint chaining happens in model space before any frame exists, so its
//! radius is `TOL × canvas side` (the longest side of the border segments'
//! bounding box) — the only scale available at that point. The same radius is
//! the perpendicular deviation [`simplify_corners`] tolerates, so dropping a
//! collinear split vertex is a distance test at the chaining tolerance rather
//! than an angle test that tightens with every extra split. The rectangle
//! tests are then dimensionless (unit directions, side ratios) so they carry
//! `TOL` regardless of the sheet's size.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::frame::Frame;
use crate::pointgrid::PointGrid;
use crate::tol::{SNAP_RADIUS, TOL};

/// Why a border loop did not become a sheet. Vertices are model-space.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RefusalReason {
    /// A closed loop whose corners are not a rectangle (V1 plans rectangles
    /// only; polygon sheets are V1.1). `vertices` are its corners.
    NonRectangular { vertices: Vec<[f64; 2]> },
    /// Border segments that do not close into a loop.
    OpenOutline { vertices: Vec<[f64; 2]> },
    /// A border vertex touched by more than two border segments.
    NonSimpleOutline { vertices: Vec<[f64; 2]> },
    /// Fewer than three corners, or a side shorter than the tolerance.
    DegenerateOutline { vertices: Vec<[f64; 2]> },
}

impl RefusalReason {
    /// The vertices the refusal talks about.
    pub fn vertices(&self) -> &[[f64; 2]] {
        match self {
            RefusalReason::NonRectangular { vertices }
            | RefusalReason::OpenOutline { vertices }
            | RefusalReason::NonSimpleOutline { vertices }
            | RefusalReason::DegenerateOutline { vertices } => vertices,
        }
    }
}

/// A rectangular sheet recovered from a loop, with how far the loop is from
/// an exact rectangle (max of the right-angle cosine defect and the relative
/// opposite-side length defect).
#[derive(Debug, Clone, PartialEq)]
pub struct RectSheet {
    pub frame: Frame,
    pub residual: f64,
}

/// One connected set of border segments.
#[derive(Debug, Clone, PartialEq)]
pub struct BorderLoop {
    /// Loop vertices in order (model space) for a closed loop; the set of
    /// vertices for an open or non-simple one.
    pub vertices: Vec<[f64; 2]>,
    /// Corners after dropping collinear vertices (closed loops only).
    pub corners: Vec<[f64; 2]>,
    /// Border segments in this loop, in the caller's numbering.
    pub border_segment_indices: Vec<u32>,
    pub closed: bool,
    pub sheet: Result<RectSheet, RefusalReason>,
}

/// Everything the chaining found.
#[derive(Debug, Clone, PartialEq)]
pub struct OutlineResult {
    pub loops: Vec<BorderLoop>,
    /// Border segments whose endpoints coincide within the chaining radius.
    pub degenerate_segments: Vec<u32>,
}

struct Edge {
    a: usize,
    b: usize,
    segments: Vec<u32>,
}

/// Chain the border segments `border_indices` of `segments` (model-space
/// `[x1, y1, x2, y2]` each) into loops and frames. `canvas_scale` is the
/// longest side of the border's bounding box in model units.
pub fn detect_border_loops(
    segments: &[[f64; 4]],
    border_indices: &[u32],
    canvas_scale: f64,
) -> OutlineResult {
    let radius = TOL * canvas_scale.max(f64::MIN_POSITIVE);
    let mut grid = PointGrid::new(radius);
    let mut edges: Vec<Edge> = Vec::new();
    let mut pair_to_edge: HashMap<(usize, usize), usize> = HashMap::new();
    let mut degenerate_segments = Vec::new();

    for &gi in border_indices {
        let s = segments[gi as usize];
        let (a, _) = grid.find_or_insert([s[0], s[1]], radius);
        let (b, _) = grid.find_or_insert([s[2], s[3]], radius);
        if a == b {
            degenerate_segments.push(gi);
            continue;
        }
        let key = (a.min(b), a.max(b));
        match pair_to_edge.get(&key) {
            Some(&ei) => edges[ei].segments.push(gi),
            None => {
                pair_to_edge.insert(key, edges.len());
                edges.push(Edge {
                    a,
                    b,
                    segments: vec![gi],
                });
            }
        }
    }

    let vertex_count = grid.len();
    let mut adjacency: Vec<Vec<usize>> = vec![Vec::new(); vertex_count];
    for (ei, e) in edges.iter().enumerate() {
        adjacency[e.a].push(ei);
        adjacency[e.b].push(ei);
    }

    let mut visited = vec![false; vertex_count];
    let mut loops = Vec::new();
    for start in 0..vertex_count {
        if visited[start] || adjacency[start].is_empty() {
            continue;
        }
        // Connected component by DFS.
        let mut stack = vec![start];
        let mut component_vertices = Vec::new();
        let mut component_edges: Vec<usize> = Vec::new();
        let mut edge_seen: HashMap<usize, ()> = HashMap::new();
        visited[start] = true;
        while let Some(v) = stack.pop() {
            component_vertices.push(v);
            for &ei in &adjacency[v] {
                if edge_seen.insert(ei, ()).is_none() {
                    component_edges.push(ei);
                }
                let e = &edges[ei];
                let other = if e.a == v { e.b } else { e.a };
                if !visited[other] {
                    visited[other] = true;
                    stack.push(other);
                }
            }
        }
        component_vertices.sort_unstable();
        component_edges.sort_unstable();
        let mut border_segment_indices: Vec<u32> = component_edges
            .iter()
            .flat_map(|&ei| edges[ei].segments.iter().copied())
            .collect();
        border_segment_indices.sort_unstable();

        let max_degree = component_vertices
            .iter()
            .map(|&v| adjacency[v].len())
            .max()
            .unwrap_or(0);
        let all_two = component_vertices.iter().all(|&v| adjacency[v].len() == 2);
        let positions: Vec<[f64; 2]> = component_vertices.iter().map(|&v| grid.point(v)).collect();

        if !all_two {
            let reason = if max_degree > 2 {
                RefusalReason::NonSimpleOutline {
                    vertices: positions.clone(),
                }
            } else {
                RefusalReason::OpenOutline {
                    vertices: positions.clone(),
                }
            };
            loops.push(BorderLoop {
                vertices: positions,
                corners: Vec::new(),
                border_segment_indices,
                closed: false,
                sheet: Err(reason),
            });
            continue;
        }

        // A connected 2-regular graph is one cycle: walk it.
        let mut ordered = Vec::with_capacity(component_vertices.len());
        let mut current = start;
        let mut previous_edge: Option<usize> = None;
        loop {
            ordered.push(grid.point(current));
            let Some(&next_edge) = adjacency[current]
                .iter()
                .find(|&&ei| Some(ei) != previous_edge)
            else {
                break;
            };
            let e = &edges[next_edge];
            current = if e.a == current { e.b } else { e.a };
            previous_edge = Some(next_edge);
            if current == start || ordered.len() > component_vertices.len() {
                break;
            }
        }
        let corners = simplify_corners(&ordered, radius);
        let sheet = rectangle_frame(&corners, radius);
        loops.push(BorderLoop {
            vertices: ordered,
            corners,
            border_segment_indices,
            closed: true,
            sheet,
        });
    }

    OutlineResult {
        loops,
        degenerate_segments,
    }
}

fn unit(v: [f64; 2]) -> Option<([f64; 2], f64)> {
    let len = (v[0] * v[0] + v[1] * v[1]).sqrt();
    if len > 0.0 {
        Some(([v[0] / len, v[1] / len], len))
    } else {
        None
    }
}

/// Drop every loop vertex that sits within `min_deviation` **model units** of
/// the straight line through its neighbours (border segments are split
/// wherever a crease ends, so an edited outline has many such vertices).
///
/// The test is a distance, not an angle. Comparing the turn angle against
/// `TOL` tolerated a perpendicular deviation of only `TOL · L / 2`, which
/// shrinks as the border is split more finely: on a 400-unit square split six
/// ways per side a vertex 3.34e-5 model units off its own edge — 8e-8 of the
/// sheet, far below the crate's own point tolerance — became a fifth corner,
/// and `rectangle_frame` then refused the sheet outright. `min(|ab|, |bc|) ·
/// sin θ` is within a factor of two of the true perpendicular distance
/// `|ab||bc| sin θ / |ac|`, which is well inside this tolerance.
pub fn simplify_corners(vertices: &[[f64; 2]], min_deviation: f64) -> Vec<[f64; 2]> {
    let n = vertices.len();
    if n < 3 {
        return vertices.to_vec();
    }
    let mut corners = Vec::new();
    for i in 0..n {
        let a = vertices[(i + n - 1) % n];
        let b = vertices[i];
        let c = vertices[(i + 1) % n];
        let (Some((d1, len1)), Some((d2, len2))) = (
            unit([b[0] - a[0], b[1] - a[1]]),
            unit([c[0] - b[0], c[1] - b[1]]),
        ) else {
            continue;
        };
        let cross = d1[0] * d2[1] - d1[1] * d2[0];
        let dot = d1[0] * d2[0] + d1[1] * d2[1];
        // `dot < 0` is a fold-back: the loop doubles over itself, which is a
        // corner however small the turn measures.
        if cross.abs() * len1.min(len2) > min_deviation || dot < 0.0 {
            corners.push(b);
        }
    }
    corners
}

/// Decide whether four corners are a rectangle (any orientation) and build
/// its frame. `min_side` is the chaining radius in model units.
pub fn rectangle_frame(corners: &[[f64; 2]], min_side: f64) -> Result<RectSheet, RefusalReason> {
    if corners.len() < 3 {
        return Err(RefusalReason::DegenerateOutline {
            vertices: corners.to_vec(),
        });
    }
    if corners.len() != 4 {
        return Err(RefusalReason::NonRectangular {
            vertices: corners.to_vec(),
        });
    }
    let mut edges = [[0.0f64; 2]; 4];
    let mut lengths = [0.0f64; 4];
    for i in 0..4 {
        let a = corners[i];
        let b = corners[(i + 1) % 4];
        edges[i] = [b[0] - a[0], b[1] - a[1]];
        lengths[i] = (edges[i][0].powi(2) + edges[i][1].powi(2)).sqrt();
    }
    if lengths.iter().any(|&l| l <= min_side) {
        return Err(RefusalReason::DegenerateOutline {
            vertices: corners.to_vec(),
        });
    }
    let units: Vec<[f64; 2]> = edges
        .iter()
        .zip(lengths.iter())
        .map(|(e, &l)| [e[0] / l, e[1] / l])
        .collect();
    let mut angle_residual = 0.0f64;
    let mut sign = 0.0f64;
    for i in 0..4 {
        let u = units[i];
        let v = units[(i + 1) % 4];
        angle_residual = angle_residual.max((u[0] * v[0] + u[1] * v[1]).abs());
        let cross = u[0] * v[1] - u[1] * v[0];
        if cross.abs() <= TOL || (sign != 0.0 && cross.signum() != sign) {
            // Reflex or straight corner: not a convex quadrilateral.
            return Err(RefusalReason::NonRectangular {
                vertices: corners.to_vec(),
            });
        }
        sign = cross.signum();
    }
    let longer = lengths.iter().copied().fold(0.0, f64::max);
    let side_residual = ((lengths[0] - lengths[2])
        .abs()
        .max((lengths[1] - lengths[3]).abs()))
        / longer;
    let residual = angle_residual.max(side_residual);
    if residual >= SNAP_RADIUS {
        return Err(RefusalReason::NonRectangular {
            vertices: corners.to_vec(),
        });
    }

    // x_axis: the longest edge's direction, rotated by a multiple of 90° to
    // the candidate with the largest model x, ties (a 45° square) broken
    // towards on-screen "up" (smaller model y).
    let longest = (0..4)
        .max_by(|&i, &j| lengths[i].total_cmp(&lengths[j]))
        .unwrap_or(0);
    let e = units[longest];
    let candidates = [e, [-e[0], -e[1]], [-e[1], e[0]], [e[1], -e[0]]];
    let max_x = candidates.iter().map(|c| c[0]).fold(f64::MIN, f64::max);
    let x_axis = candidates
        .iter()
        .filter(|c| c[0] >= max_x - TOL)
        .copied()
        .min_by(|a, b| a[1].total_cmp(&b[1]))
        .unwrap_or(e);
    let y_axis = [x_axis[1], -x_axis[0]];
    let proj = |p: [f64; 2], axis: [f64; 2]| p[0] * axis[0] + p[1] * axis[1];
    let origin = corners
        .iter()
        .copied()
        .min_by(|a, b| {
            (proj(*a, x_axis) + proj(*a, y_axis)).total_cmp(&(proj(*b, x_axis) + proj(*b, y_axis)))
        })
        .unwrap_or(corners[0]);
    let width = corners
        .iter()
        .map(|p| proj([p[0] - origin[0], p[1] - origin[1]], x_axis))
        .fold(0.0, f64::max);
    let height = corners
        .iter()
        .map(|p| proj([p[0] - origin[0], p[1] - origin[1]], y_axis))
        .fold(0.0, f64::max);
    let frame = Frame::new(origin, x_axis, width, height).map_err(|_| {
        RefusalReason::DegenerateOutline {
            vertices: corners.to_vec(),
        }
    })?;
    Ok(RectSheet { frame, residual })
}

/// Even-odd ray casting: is `p` inside the polygon?
pub fn point_in_polygon(p: [f64; 2], polygon: &[[f64; 2]]) -> bool {
    let n = polygon.len();
    if n < 3 {
        return false;
    }
    let mut inside = false;
    for i in 0..n {
        let a = polygon[i];
        let b = polygon[(i + 1) % n];
        if (a[1] > p[1]) != (b[1] > p[1]) {
            let x = a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
            if x > p[0] {
                inside = !inside;
            }
        }
    }
    inside
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square_segments(size: f64, splits: usize) -> Vec<[f64; 4]> {
        // The outline split into `splits` pieces per side, as a real CP is.
        let corners = [[0.0, 0.0], [size, 0.0], [size, size], [0.0, size]];
        let mut out = Vec::new();
        for i in 0..4 {
            let a = corners[i];
            let b = corners[(i + 1) % 4];
            for k in 0..splits {
                let t0 = k as f64 / splits as f64;
                let t1 = (k + 1) as f64 / splits as f64;
                out.push([
                    a[0] + (b[0] - a[0]) * t0,
                    a[1] + (b[1] - a[1]) * t0,
                    a[0] + (b[0] - a[0]) * t1,
                    a[1] + (b[1] - a[1]) * t1,
                ]);
            }
        }
        out
    }

    #[test]
    fn split_square_chains_into_one_rectangle() {
        let segments = square_segments(400.0, 6);
        let indices: Vec<u32> = (0..segments.len() as u32).collect();
        let result = detect_border_loops(&segments, &indices, 400.0);
        assert_eq!(result.loops.len(), 1);
        let l = &result.loops[0];
        assert!(l.closed);
        assert_eq!(l.vertices.len(), 24);
        assert_eq!(l.corners.len(), 4);
        let sheet = l.sheet.as_ref().expect("rectangle");
        assert!(sheet.residual < 1e-15);
        assert_eq!(sheet.frame.origin, [0.0, 400.0]);
        assert_eq!(sheet.frame.x_axis, [1.0, 0.0]);
        assert_eq!(sheet.frame.y_axis, [0.0, -1.0]);
        assert_eq!(l.border_segment_indices.len(), 24);
    }

    /// `square_segments`, with the shared vertex between the first two pieces
    /// of the top side pushed `h` model units off that side.
    fn square_with_a_nudged_border_vertex(size: f64, splits: usize, h: f64) -> Vec<[f64; 4]> {
        let mut segments = square_segments(size, splits);
        let x = size / splits as f64;
        for s in &mut segments {
            for k in [0, 2] {
                if (s[k] - x).abs() < 1e-12 && s[k + 1] == 0.0 {
                    s[k + 1] = h;
                }
            }
        }
        segments
    }

    #[test]
    fn a_border_vertex_a_hair_off_its_edge_is_not_a_corner() {
        // The angle test tolerated only `TOL·L/2` of perpendicular deviation,
        // so with six pieces per side (L = 66.67) a vertex 3.334e-5 model
        // units — 8.3e-8 of the sheet, 7x below Oriedita's own point epsilon —
        // off its edge became a fifth corner and `rectangle_frame` refused
        // the whole sheet. Splitting the border more finely made it worse.
        for splits in [6, 12, 24, 32] {
            for h in [3.334e-5, 1e-4, 1.53e-5] {
                let segments = square_with_a_nudged_border_vertex(400.0, splits, h);
                let indices: Vec<u32> = (0..segments.len() as u32).collect();
                let result = detect_border_loops(&segments, &indices, 400.0);
                let l = &result.loops[0];
                assert_eq!(
                    l.corners.len(),
                    4,
                    "splits {splits}, h {h:e}: corners {:?}",
                    l.corners
                );
                assert!(l.sheet.is_ok(), "splits {splits}, h {h:e}: {:?}", l.sheet);
            }
        }
    }

    #[test]
    fn a_border_vertex_genuinely_off_its_edge_is_still_a_corner() {
        // The rule is a distance at the chaining radius (TOL × canvas = 4e-4
        // model units on a 400 sheet), reached at h ≈ 2e-4 because the turn
        // spans two pieces; a real dent is refused as before.
        for h in [1e-3, 0.1, 4.0] {
            let segments = square_with_a_nudged_border_vertex(400.0, 6, h);
            let indices: Vec<u32> = (0..segments.len() as u32).collect();
            let result = detect_border_loops(&segments, &indices, 400.0);
            let l = &result.loops[0];
            // The dent turns the border twice, so it shows as two corners.
            assert!(l.corners.len() > 4, "h {h:e}: corners {:?}", l.corners);
            assert!(matches!(l.sheet, Err(RefusalReason::NonRectangular { .. })));
        }
    }

    #[test]
    fn a_fold_back_is_a_corner_however_small_the_turn() {
        // Zero turn angle but the loop doubles over itself: `dot < 0` keeps it.
        let spike = [[0.0, 0.0], [100.0, 0.0], [50.0, 0.0], [50.0, 100.0]];
        assert_eq!(simplify_corners(&spike, 1.0).len(), 4);
    }

    #[test]
    fn open_chain_and_t_junction_are_refused() {
        let mut segments = square_segments(100.0, 1);
        segments.pop(); // drop one side: open
        let indices: Vec<u32> = (0..segments.len() as u32).collect();
        let result = detect_border_loops(&segments, &indices, 100.0);
        assert_eq!(result.loops.len(), 1);
        assert!(matches!(
            result.loops[0].sheet,
            Err(RefusalReason::OpenOutline { .. })
        ));

        let mut segments = square_segments(100.0, 1);
        segments.push([50.0, 0.0, 50.0, 100.0]); // a border crease across
        segments.push([0.0, 0.0, 50.0, 0.0]); // duplicates half of a side
        let indices: Vec<u32> = (0..segments.len() as u32).collect();
        let result = detect_border_loops(&segments, &indices, 100.0);
        assert!(
            result
                .loops
                .iter()
                .any(|l| matches!(l.sheet, Err(RefusalReason::NonSimpleOutline { .. })))
        );
    }

    #[test]
    fn parallelogram_is_not_a_rectangle() {
        let corners = [[0.0, 0.0], [100.0, 0.0], [130.0, 50.0], [30.0, 50.0]];
        match rectangle_frame(&corners, 1e-4) {
            Err(RefusalReason::NonRectangular { vertices }) => assert_eq!(vertices.len(), 4),
            other => panic!("expected refusal, got {other:?}"),
        }
    }

    #[test]
    fn slightly_skewed_rectangle_keeps_its_residual() {
        // One corner off by 1e-3 of the side: accepted, residual ≈ 1e-3.
        let corners = [[0.0, 0.0], [400.0, 0.0], [400.4, 400.0], [0.0, 400.0]];
        let sheet = rectangle_frame(&corners, 1e-4).expect("near rectangle");
        assert!(sheet.residual > 5e-4 && sheet.residual < SNAP_RADIUS);
        // Off by 5e-2 of the side: refused.
        let corners = [[0.0, 0.0], [400.0, 0.0], [420.0, 400.0], [0.0, 400.0]];
        assert!(matches!(
            rectangle_frame(&corners, 1e-4),
            Err(RefusalReason::NonRectangular { .. })
        ));
    }

    #[test]
    fn ray_casting_agrees_with_a_square() {
        let square = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];
        assert!(point_in_polygon([0.5, 0.5], &square));
        assert!(!point_in_polygon([1.5, 0.5], &square));
        assert!(!point_in_polygon([0.5, -0.1], &square));
    }
}

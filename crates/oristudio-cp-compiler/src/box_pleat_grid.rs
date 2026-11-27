//! The grid a box-pleated detection is drawn on, and the snap that puts the
//! creases near it exactly on it.
//!
//! A box-pleated design places every vertex on a square grid, or on the
//! half-grid where its diagonals cross, and runs every crease along a grid line
//! or a cell diagonal. A detection of one lands within a pixel or so of that
//! grid at nearly every vertex: close enough to read the grid from, and not
//! close enough to be the design. A crease that should run along a grid line
//! misses it by a fraction of a pixel, which the folder, the checks and the
//! editor's grid snapping all see.
//!
//! [`read_box_pleat_grid`] says whether a detection is box-pleated and on which
//! grid; [`snap_to_box_pleat_grid`] moves every coordinate within
//! [`SNAP_TOLERANCE_PX`] of a grid line onto it and leaves the rest where they
//! are. Neither judges whether the result folds: that is the solver's.
//!
//! Measured on the September recognition archive (526 real patterns from the
//! shipped model, their truths read only to score): the reading admits 92, 82
//! of them on a grid in truth and the rest hybrids that mostly are; the snap
//! puts 51,934 of their vertices exactly where the designer drew them and moves
//! 57 away, and leaves none of the 92 worse off than it found it. On the 58
//! pure box-pleated designs, 2.9% of detected vertices sit exactly on the
//! truth's and 98.0% after the snap, with none moved away.

use crate::Point2;
use crate::candidate_graph::{
    BoundaryReconstructionPolicy, BoundarySide, CandidateCreaseSpanKind,
    CandidateVertexMovementPolicy, ExactSolveInput,
};
use crate::carrier_lines::carrier_from;
use crate::lattice::{dominant_square_lattice, snap_to};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};

/// How far, in detection pixels, a coordinate may sit from a grid line and be
/// put on it. The solver reads its lattice at the same width
/// (`default_lattice_snap_tolerance_px`). Wider buys almost nothing on real
/// detections and costs the hybrids: on the archive, 2.5 px adds 0.1% more
/// exact vertices and moves 97 hybrid vertices away from their truth where
/// 1.5 px moves 41, and a quarter cell 120.
pub const SNAP_TOLERANCE_PX: f64 = 1.5;

/// Share of the pattern's coordinates that must sit within the tolerance of
/// the grid: the solver's partial-lattice proposal reads its grid the same way.
const MIN_COORDINATE_SUPPORT: f64 = 0.95;

/// A coordinate this close to a grid line, in the unit square, is on it: a
/// solve that put it there lands within floating-point noise, a millionth of a
/// pixel, and moving it the rest of the way is not a snap.
const ON_GRID_EPSILON: f64 = 1e-9;

/// A crease is on the box-pleat family when its direction is within this of a
/// multiple of 45°. A detected long crease is within a degree of its truth;
/// 3° and 5° admit the same patterns on the archive.
const FAMILY_TOLERANCE_DEGREES: f64 = 3.0;
/// Only creases at least this long (px) vote: a short one's direction is not
/// known to better than a few degrees.
const MIN_FAMILY_CREASE_PX: f64 = 12.0;
/// Fewer voters than this are not evidence of a family.
const MIN_FAMILY_CREASES: usize = 20;
/// The share of the voters that must be on the family.
///
/// Stricter than the detector's border prior (`grid_prior.rs`, 0.85 at 5°),
/// because a snap changes what the user adds where the prior only licenses a
/// border contact the ink already shows. Coordinates alone are no evidence:
/// a fine enough grid catches 95% of most 22.5° patterns' coordinates too, and
/// 134 of the archive's 435 patterns that are not box-pleated read one. At
/// 0.85 the reading admits patterns the snap hurts (a lizard 23% on any grid,
/// 47 of its 134 vertices moved away); at 0.9 no admitted pattern loses more
/// vertices than it gains, and 0.95 turns away nine box-pleated designs for
/// 39 vertices.
const MIN_FAMILY_FRACTION: f64 = 0.9;

/// The square grid a box-pleated detection sits on.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct BoxPleatGrid {
    /// Cells per paper edge: the coarsest grid that explains the pattern, so
    /// a design on a fine grid with only a few vertices off its coarser half
    /// reads as the coarser one, and those few are left alone.
    pub cells: u32,
    /// Share of the pattern's vertex coordinates within the tolerance of a
    /// grid line.
    pub coordinate_support: f64,
    /// Share of the long creases within [`FAMILY_TOLERANCE_DEGREES`] of a
    /// multiple of 45°.
    pub family_fraction: f64,
    /// How far a coordinate may sit from a grid line and be put on it, in the
    /// unit square: [`SNAP_TOLERANCE_PX`] when the grid is read.
    pub tolerance: f64,
    /// Detection pixels per unit of the paper.
    pub pixels_per_unit: f64,
}

/// A detection with its near-grid coordinates on the grid.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BoxPleatGridSnap {
    pub grid: BoxPleatGrid,
    /// The input with the snapped coordinates written in and the carriers of
    /// the spans they move refit through them.
    pub input: ExactSolveInput,
    /// Every vertex the snap moved, by id, with where it was and where it is.
    pub moved_vertices: Vec<SnappedVertex>,
    /// The pattern's vertices that now sit on a grid point — a boundary
    /// contact by its position along its side — corners left out. What a solve
    /// should hold where it is.
    pub on_grid_vertex_ids: Vec<usize>,
}

/// One vertex the snap moved.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SnappedVertex {
    pub vertex_id: usize,
    pub before: Point2,
    pub after: Point2,
}

/// The box-pleat grid `input` is drawn on, or `None` when it is not
/// box-pleated: too few of its long creases at a multiple of 45°, or no grid
/// that nearly all of its coordinates sit on. Square paper only.
pub fn read_box_pleat_grid(input: &ExactSolveInput) -> Option<BoxPleatGrid> {
    if input.boundary.reconstruction_policy == BoundaryReconstructionPolicy::Polygon {
        return None;
    }
    let pixels = pixels_per_unit(input)?;
    let family_fraction = family_fraction(input, pixels)?;
    if family_fraction < MIN_FAMILY_FRACTION {
        return None;
    }
    let pattern = pattern_vertex_ids(input);
    let coordinates = input
        .vertices
        .iter()
        .filter(|vertex| pattern.contains(&vertex.id))
        .flat_map(|vertex| [vertex.point.x, vertex.point.y])
        .collect::<Vec<_>>();
    let tolerance = SNAP_TOLERANCE_PX / pixels;
    let lattice = dominant_square_lattice(&coordinates, tolerance, MIN_COORDINATE_SUPPORT)?;
    Some(BoxPleatGrid {
        cells: lattice.cells,
        coordinate_support: lattice.support,
        family_fraction,
        tolerance,
        pixels_per_unit: pixels,
    })
}

/// Put every coordinate of `input`'s pattern within `grid.tolerance` of a
/// grid line exactly on it.
///
/// A coordinate at a time, so a crease along a grid line lands on it even
/// where its far end is a hybrid vertex off the grid. A boundary contact moves
/// only along its side; a locked vertex (the corners) never moves. Two vertices
/// the snap would put on one point stay where they were: a junction the
/// detector split in two is the solver's to merge, not this.
pub fn snap_to_box_pleat_grid(input: &ExactSolveInput, grid: &BoxPleatGrid) -> BoxPleatGridSnap {
    let pattern = pattern_vertex_ids(input);
    let snap = |value: f64| {
        let snapped = snap_to(value, grid.cells);
        let offset = (snapped - value).abs();
        if offset > ON_GRID_EPSILON && offset <= grid.tolerance {
            snapped
        } else {
            value
        }
    };
    let mut targets: HashMap<usize, Point2> = HashMap::new();
    for vertex in &input.vertices {
        if !pattern.contains(&vertex.id)
            || vertex.movement_policy == CandidateVertexMovementPolicy::Locked
            || input.boundary.corners.contains(&vertex.id)
        {
            continue;
        }
        let point = vertex.point;
        let target = match (vertex.movement_policy, vertex.boundary_side) {
            (
                CandidateVertexMovementPolicy::BoundaryOnly,
                Some(BoundarySide::Top | BoundarySide::Bottom),
            ) => Point2::new(snap(point.x), point.y),
            (
                CandidateVertexMovementPolicy::BoundaryOnly,
                Some(BoundarySide::Left | BoundarySide::Right),
            ) => Point2::new(point.x, snap(point.y)),
            (CandidateVertexMovementPolicy::BoundaryOnly, None) => continue,
            _ => Point2::new(snap(point.x), snap(point.y)),
        };
        if target != point {
            targets.insert(vertex.id, target);
        }
    }
    drop_collisions(input, &pattern, &mut targets);

    let mut snapped = input.clone();
    let mut moved_vertices = Vec::new();
    for vertex in &mut snapped.vertices {
        if let Some(&after) = targets.get(&vertex.id) {
            moved_vertices.push(SnappedVertex {
                vertex_id: vertex.id,
                before: vertex.point,
                after,
            });
            vertex.point = after;
        }
    }
    let index_of = snapped
        .vertices
        .iter()
        .enumerate()
        .map(|(index, vertex)| (vertex.id, index))
        .collect::<HashMap<_, _>>();
    for span in &mut snapped.selected_spans {
        if !span.vertices.iter().any(|id| targets.contains_key(id)) {
            continue;
        }
        let (Some(&a), Some(&b)) = (
            index_of.get(&span.vertices[0]),
            index_of.get(&span.vertices[1]),
        ) else {
            continue;
        };
        let (carrier, interval) =
            carrier_from(snapped.vertices[a].point, snapped.vertices[b].point);
        span.carrier = carrier;
        span.t_interval = interval;
    }

    let on_grid = |value: f64| (value - snap_to(value, grid.cells)).abs() <= ON_GRID_EPSILON;
    let on_grid_vertex_ids = snapped
        .vertices
        .iter()
        .filter(|vertex| {
            pattern.contains(&vertex.id)
                && vertex.movement_policy != CandidateVertexMovementPolicy::Locked
                && !snapped.boundary.corners.contains(&vertex.id)
        })
        .filter(
            |vertex| match (vertex.movement_policy, vertex.boundary_side) {
                (
                    CandidateVertexMovementPolicy::BoundaryOnly,
                    Some(BoundarySide::Top | BoundarySide::Bottom),
                ) => on_grid(vertex.point.x),
                (
                    CandidateVertexMovementPolicy::BoundaryOnly,
                    Some(BoundarySide::Left | BoundarySide::Right),
                ) => on_grid(vertex.point.y),
                _ => on_grid(vertex.point.x) && on_grid(vertex.point.y),
            },
        )
        .map(|vertex| vertex.id)
        .collect();

    BoxPleatGridSnap {
        grid: *grid,
        input: snapped,
        moved_vertices,
        on_grid_vertex_ids,
    }
}

/// Detection pixels per unit of the paper: the decoder's paper spans
/// `image_size - 64` of them (`junction_carrier_v1.rs`), and a document
/// rebuilt without raster metadata is read at the solver's 1024.
fn pixels_per_unit(input: &ExactSolveInput) -> Option<f64> {
    let pixels = match input.image_size {
        Some(size) => f64::from(size.checked_sub(64)?),
        None => 1024.0,
    };
    (pixels > 0.0).then_some(pixels)
}

/// The vertices the pattern holds: a candidate the selection left without a
/// span sits wherever the head fired and says nothing about the grid.
fn pattern_vertex_ids(input: &ExactSolveInput) -> BTreeSet<usize> {
    input
        .selected_spans
        .iter()
        .flat_map(|span| span.vertices)
        .collect()
}

/// Share of the long creases within [`FAMILY_TOLERANCE_DEGREES`] of a multiple
/// of 45°; `None` when fewer than [`MIN_FAMILY_CREASES`] vote.
fn family_fraction(input: &ExactSolveInput, pixels: f64) -> Option<f64> {
    let points = input
        .vertices
        .iter()
        .map(|vertex| (vertex.id, vertex.point))
        .collect::<HashMap<_, _>>();
    let mut voters = 0usize;
    let mut on_family = 0usize;
    for span in &input.selected_spans {
        if span.kind == CandidateCreaseSpanKind::BorderSpan {
            continue;
        }
        let (Some(a), Some(b)) = (points.get(&span.vertices[0]), points.get(&span.vertices[1]))
        else {
            continue;
        };
        let (dx, dy) = (b.x - a.x, b.y - a.y);
        if (dx * dx + dy * dy).sqrt() * pixels < MIN_FAMILY_CREASE_PX {
            continue;
        }
        let degrees = dy.atan2(dx).to_degrees();
        voters += 1;
        if ((degrees + 22.5).rem_euclid(45.0) - 22.5).abs() <= FAMILY_TOLERANCE_DEGREES {
            on_family += 1;
        }
    }
    (voters >= MIN_FAMILY_CREASES).then(|| on_family as f64 / voters as f64)
}

/// Drop the moves that would put a vertex of the pattern on top of another one
/// it was not already on, until none would. Each round leaves at least one
/// more vertex where it was, so it ends.
fn drop_collisions(
    input: &ExactSolveInput,
    pattern: &BTreeSet<usize>,
    targets: &mut HashMap<usize, Point2>,
) {
    let key = |point: Point2| {
        (
            (point.x * 1e9).round() as i64,
            (point.y * 1e9).round() as i64,
        )
    };
    loop {
        let mut at: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
        for vertex in input
            .vertices
            .iter()
            .filter(|vertex| pattern.contains(&vertex.id))
        {
            let point = targets.get(&vertex.id).copied().unwrap_or(vertex.point);
            at.entry(key(point)).or_default().push(vertex.id);
        }
        let mut dropped = false;
        for ids in at.values().filter(|ids| ids.len() > 1) {
            // Vertices that already coincided (a merged stub) are not the
            // snap's doing; only a move into a shared point is undone.
            let originals = ids
                .iter()
                .filter_map(|id| input.vertices.iter().find(|vertex| vertex.id == *id))
                .map(|vertex| key(vertex.point))
                .collect::<BTreeSet<_>>();
            if originals.len() == 1 {
                continue;
            }
            for id in ids {
                dropped |= targets.remove(id).is_some();
            }
        }
        if !dropped {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::exact_solve_input_from_fold;
    use serde_json::{Value, json};

    /// The rebuilt document's resolution: no raster metadata, so 1024 px.
    const PX: f64 = 1024.0;

    /// A detection of a design on an `n`-grid as a FOLD: every grid line
    /// between neighbouring grid points, and one diagonal in every third cell.
    /// `noise(i)` (px) is added to each coordinate a vertex may move in.
    fn grid_fold(n: usize, noise: impl Fn(usize) -> f64) -> Value {
        // Vertex (i, j) is the grid point (i/n, j/n), numbered row by row.
        let at = |i: usize, j: usize| i * (n + 1) + j;
        let mut coords = Vec::new();
        for i in 0..=n {
            for j in 0..=n {
                let id = at(i, j);
                let (mut x, mut y) = (i as f64 / n as f64, j as f64 / n as f64);
                if i != 0 && i != n {
                    x += noise(2 * id) / PX;
                }
                if j != 0 && j != n {
                    y += noise(2 * id + 1) / PX;
                }
                coords.push(json!([x, y]));
            }
        }
        let mut edges = Vec::new();
        let mut assignments = Vec::new();
        let mut push = |a: usize, b: usize, label: &str| {
            edges.push(json!([a, b]));
            assignments.push(json!(label));
        };
        for i in 0..n {
            for j in 0..=n {
                let border = j == 0 || j == n;
                let label = if border {
                    "B"
                } else if (i + j) % 2 == 0 {
                    "M"
                } else {
                    "V"
                };
                push(at(i, j), at(i + 1, j), label);
                push(at(j, i), at(j, i + 1), label);
            }
        }
        for i in 0..n {
            for j in 0..n {
                if (i + j) % 3 == 0 {
                    push(at(i, j), at(i + 1, j + 1), "V");
                }
            }
        }
        json!({
            "file_spec": 1.1,
            "vertices_coords": coords,
            "edges_vertices": edges,
            "edges_assignment": assignments,
        })
    }

    fn input_of(fold: &Value) -> ExactSolveInput {
        let fold = serde_json::from_value(fold.clone()).expect("fold");
        exact_solve_input_from_fold(&fold).expect("rebuild").0
    }

    fn alternating(px: f64) -> impl Fn(usize) -> f64 {
        move |i| if i % 2 == 0 { px } else { -px }
    }

    fn on_lattice(value: f64, cells: u32) -> bool {
        (value - snap_to(value, cells)).abs() < 1e-12
    }

    #[test]
    fn reads_the_grid_a_noisy_box_pleat_detection_sits_on() {
        let grid =
            read_box_pleat_grid(&input_of(&grid_fold(8, alternating(0.6)))).expect("box-pleated");
        assert_eq!(grid.cells, 8);
        assert_eq!(grid.family_fraction, 1.0);
        assert!((grid.tolerance - SNAP_TOLERANCE_PX / PX).abs() < 1e-15);
    }

    #[test]
    fn the_snap_puts_every_near_grid_coordinate_exactly_on_the_grid() {
        let input = input_of(&grid_fold(8, alternating(0.6)));
        let grid = read_box_pleat_grid(&input).expect("box-pleated");
        let snapped = snap_to_box_pleat_grid(&input, &grid);
        for vertex in &snapped.input.vertices {
            assert!(
                on_lattice(vertex.point.x, 8) && on_lattice(vertex.point.y, 8),
                "{:?}",
                vertex.point
            );
        }
        // Every vertex but the four corners moved, and every one of them is
        // now a grid point the solve can hold.
        assert_eq!(snapped.moved_vertices.len(), input.vertices.len() - 4);
        assert_eq!(snapped.on_grid_vertex_ids.len(), input.vertices.len() - 4);
        // The carriers follow the vertices: every crease is exactly on the
        // box-pleat family now.
        for span in &snapped.input.selected_spans {
            let direction = span.carrier.direction;
            let degrees = direction.y.atan2(direction.x).to_degrees();
            assert!(
                ((degrees + 22.5).rem_euclid(45.0) - 22.5).abs() < 1e-9,
                "{degrees}"
            );
        }
    }

    #[test]
    fn a_boundary_contact_moves_only_along_its_side() {
        let input = input_of(&grid_fold(8, alternating(0.6)));
        let grid = read_box_pleat_grid(&input).expect("box-pleated");
        let snapped = snap_to_box_pleat_grid(&input, &grid);
        let mut contacts = 0;
        for moved in &snapped.moved_vertices {
            let vertex = &input.vertices[moved.vertex_id];
            if vertex.movement_policy != CandidateVertexMovementPolicy::BoundaryOnly {
                continue;
            }
            contacts += 1;
            match vertex.boundary_side.expect("a contact has a side") {
                BoundarySide::Top | BoundarySide::Bottom => {
                    assert_eq!(moved.after.y, moved.before.y)
                }
                BoundarySide::Left | BoundarySide::Right => {
                    assert_eq!(moved.after.x, moved.before.x)
                }
            }
        }
        assert_eq!(contacts, 4 * 7);
    }

    #[test]
    fn a_coordinate_beyond_the_tolerance_stays_where_it_is() {
        // One junction 6 px off its grid line in x: a hybrid's vertex, or a
        // detection the snap cannot vouch for. Its y is near the grid and snaps.
        let off = 2 * 40;
        let input = input_of(&grid_fold(8, |i| {
            if i == off { 6.0 } else { alternating(0.6)(i) }
        }));
        let id = 40;
        assert_eq!(
            input.vertices[id].movement_policy,
            CandidateVertexMovementPolicy::Movable
        );
        let grid = read_box_pleat_grid(&input).expect("box-pleated");
        let snapped = snap_to_box_pleat_grid(&input, &grid);
        let (before, after) = (input.vertices[id].point, snapped.input.vertices[id].point);
        assert_eq!(after.x, before.x);
        assert!(on_lattice(after.y, 8));
        assert!(!snapped.on_grid_vertex_ids.contains(&id));
    }

    #[test]
    fn two_vertices_the_snap_would_put_on_one_point_stay_where_they_were() {
        // A junction the detector split in two, half a pixel either side of
        // one grid point and joined by a one-pixel stub.
        let mut fold = grid_fold(8, |_| 0.0);
        let id = 40;
        let point = fold["vertices_coords"][id].clone();
        let (x, y) = (point[0].as_f64().unwrap(), point[1].as_f64().unwrap());
        fold["vertices_coords"][id] = json!([x - 0.5 / PX, y]);
        let twin = fold["vertices_coords"].as_array().unwrap().len();
        fold["vertices_coords"]
            .as_array_mut()
            .unwrap()
            .push(json!([x + 0.5 / PX, y]));
        fold["edges_vertices"]
            .as_array_mut()
            .unwrap()
            .push(json!([id, twin]));
        fold["edges_assignment"]
            .as_array_mut()
            .unwrap()
            .push(json!("M"));
        let input = input_of(&fold);
        let grid = read_box_pleat_grid(&input).expect("box-pleated");
        let snapped = snap_to_box_pleat_grid(&input, &grid);
        assert_eq!(snapped.input.vertices[id].point, input.vertices[id].point);
        assert_eq!(
            snapped.input.vertices[twin].point,
            input.vertices[twin].point
        );
        assert!(
            snapped
                .moved_vertices
                .iter()
                .all(|moved| moved.vertex_id != id && moved.vertex_id != twin)
        );
    }

    #[test]
    fn a_pattern_off_the_box_pleat_family_reads_no_grid() {
        // The same grid turned 22.5° about the centre, inside the paper.
        let mut fold = grid_fold(8, |_| 0.0);
        let (sin, cos) = 22.5_f64.to_radians().sin_cos();
        for point in fold["vertices_coords"].as_array_mut().unwrap() {
            let (x, y) = (
                point[0].as_f64().unwrap() - 0.5,
                point[1].as_f64().unwrap() - 0.5,
            );
            let interior = x.abs() < 0.5 - 1e-9 && y.abs() < 0.5 - 1e-9;
            if interior {
                *point = json!([
                    0.5 + 0.6 * (x * cos - y * sin),
                    0.5 + 0.6 * (x * sin + y * cos)
                ]);
            }
        }
        // Keep only the border and the edges between interior vertices.
        let coords = fold["vertices_coords"].as_array().unwrap().clone();
        let interior = |v: usize| {
            let (x, y) = (
                coords[v][0].as_f64().unwrap(),
                coords[v][1].as_f64().unwrap(),
            );
            x > 1e-9 && x < 1.0 - 1e-9 && y > 1e-9 && y < 1.0 - 1e-9
        };
        let edges = fold["edges_vertices"].as_array().unwrap().clone();
        let labels = fold["edges_assignment"].as_array().unwrap().clone();
        let (kept_edges, kept_labels): (Vec<_>, Vec<_>) = edges
            .into_iter()
            .zip(labels)
            .filter(|(edge, label)| {
                let (a, b) = (
                    edge[0].as_u64().unwrap() as usize,
                    edge[1].as_u64().unwrap() as usize,
                );
                label == "B" || (interior(a) && interior(b))
            })
            .unzip();
        fold["edges_vertices"] = json!(kept_edges);
        fold["edges_assignment"] = json!(kept_labels);
        assert!(read_box_pleat_grid(&input_of(&fold)).is_none());
    }

    #[test]
    fn too_few_creases_are_no_evidence_of_a_family() {
        assert!(read_box_pleat_grid(&input_of(&grid_fold(2, |_| 0.0))).is_none());
    }
}

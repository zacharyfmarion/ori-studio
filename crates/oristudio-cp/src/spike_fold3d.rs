//! Phase 0 / Spike A measurement harness — **not production code**.
//!
//! Answers "what does the admission gate actually admit, on real files": runs
//! the shipped `dispatched_camv`, then places faces in 3D over the shipped
//! `face_positions` spanning tree and measures the loop gap over the non-tree
//! dual edges plus the minimum parallel-plane separation.
//!
//! The placement here is a *measurement*, deliberately kept out of `src`'s
//! public surface and behind `#[ignore]`. Phase 3's `folding3d::place_faces` is
//! the real one and must be written fresh against `vertex_link_polygon` — its
//! handedness is a decision this file does not make, because every number below
//! is invariant to it (negating every fold angle on a planar unfolded sheet is
//! the mirror state, which has the same loop gaps and the same separations).
//!
//! ```bash
//! ORISTUDIO_SPIKE_DIRS="dir1:dir2" cargo test -p oristudio-cp --lib \
//!     spike_a_admission_scan -- --ignored --nocapture
//! ORISTUDIO_SPIKE_FILE=one.fold cargo test -p oristudio-cp --lib \
//!     spike_a_focus -- --ignored --nocapture
//! cargo test -p oristudio-cp --lib spike_a_annulus -- --ignored --nocapture
//! ```
//!
//! # What it found, 2026-08-07, over 63 `.fold` files
//!
//! - "Reports nothing" is **not** "would fold". `known-good/` is 10 of 10 clean
//!   under `dispatched_camv` and 8 of 10 admissible: `byu solar driven` and the
//!   `ALL-combined` grid that contains it are refused, and nothing in the
//!   product would have said so.
//! - `byu solar driven` carries a **hexagonal hole** — six `B` edges forming a
//!   closed loop inside the sheet. `calculate_faces` fills it, so the six hub
//!   vertices get a `Black0` line and `is_interior_vertex` declines them; the
//!   loop gap there is 1.445 rad while all 90 checked vertices close to
//!   2.575e-12 deg. Delete the filled hole and the annulus gap is 6.283e-4 rad
//!   — exactly the file's 59.994-vs-60 quantisation carried six times round the
//!   hub. Snap the angles to 60 and it falls to 7.912e-14 rad with the CAMV
//!   report bit-identical. Research §2b's T2 annulus, on a curated real file.
//! - On the models that do close, the loop gap is machine precision over up to
//!   2,146 independent dual cycles, so §2b's T1 holds on real authored data.

use crate::checks_spatial::dispatched_camv;
use crate::fold_graph::FoldGraph;
use crate::geometry::{LineColor, Point};
use crate::io::fold::import_fold_document;
use crate::model::{CreasePatternModel, crease_fold_angle, has_non_classic_creases};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use treemaker_fold::FoldDocument;

const CLOSURE_BAR_DEGREES: f64 = 1e-6;

type V3 = [f64; 3];
/// `x -> r * x + t`.
#[derive(Clone, Copy, Debug)]
struct Rigid {
    r: [[f64; 3]; 3],
    t: V3,
}

impl Rigid {
    fn identity() -> Self {
        Self {
            r: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            t: [0.0; 3],
        }
    }

    fn apply(&self, v: V3) -> V3 {
        [
            self.r[0][0] * v[0] + self.r[0][1] * v[1] + self.r[0][2] * v[2] + self.t[0],
            self.r[1][0] * v[0] + self.r[1][1] * v[1] + self.r[1][2] * v[2] + self.t[1],
            self.r[2][0] * v[0] + self.r[2][1] * v[1] + self.r[2][2] * v[2] + self.t[2],
        ]
    }

    /// `self ∘ other`.
    fn compose(&self, other: &Rigid) -> Rigid {
        let mut r = [[0.0; 3]; 3];
        for (i, row) in r.iter_mut().enumerate() {
            for (j, cell) in row.iter_mut().enumerate() {
                *cell = (0..3).map(|k| self.r[i][k] * other.r[k][j]).sum();
            }
        }
        let t = [
            self.r[0][0] * other.t[0] + self.r[0][1] * other.t[1] + self.r[0][2] * other.t[2],
            self.r[1][0] * other.t[0] + self.r[1][1] * other.t[1] + self.r[1][2] * other.t[2],
            self.r[2][0] * other.t[0] + self.r[2][1] * other.t[1] + self.r[2][2] * other.t[2],
        ];
        Rigid {
            r,
            t: [t[0] + self.t[0], t[1] + self.t[1], t[2] + self.t[2]],
        }
    }

    /// Rotation of `angle` about the line through `p0` with unit direction `u`.
    fn about(p0: V3, u: V3, angle: f64) -> Rigid {
        let (s, c) = angle.sin_cos();
        let one = 1.0 - c;
        let r = [
            [
                c + u[0] * u[0] * one,
                u[0] * u[1] * one - u[2] * s,
                u[0] * u[2] * one + u[1] * s,
            ],
            [
                u[1] * u[0] * one + u[2] * s,
                c + u[1] * u[1] * one,
                u[1] * u[2] * one - u[0] * s,
            ],
            [
                u[2] * u[0] * one - u[1] * s,
                u[2] * u[1] * one + u[0] * s,
                c + u[2] * u[2] * one,
            ],
        ];
        let rp = [
            r[0][0] * p0[0] + r[0][1] * p0[1] + r[0][2] * p0[2],
            r[1][0] * p0[0] + r[1][1] * p0[1] + r[1][2] * p0[2],
            r[2][0] * p0[0] + r[2][1] * p0[1] + r[2][2] * p0[2],
        ];
        Rigid {
            r,
            t: [p0[0] - rp[0], p0[1] - rp[1], p0[2] - rp[2]],
        }
    }

    /// Angle in radians between the rotation parts of two rigids.
    ///
    /// Via the Frobenius norm of `A B^T - I`, which is `2*sqrt(2)*|sin(t/2)|`.
    /// The textbook `acos((trace - 1)/2)` cannot be used: `acos` near 1 has a
    /// square-root conditioning floor at `sqrt(2*eps) = 1.5e-8`, and every
    /// closing model in this corpus sits below it, so that form reports a
    /// uniform fake gap of 4e-8 to 9e-8 rad on states that agree to 1e-13.
    fn rotation_angle_to(&self, other: &Rigid) -> f64 {
        let mut sum = 0.0;
        for i in 0..3 {
            for j in 0..3 {
                let cell: f64 = (0..3).map(|k| self.r[i][k] * other.r[j][k]).sum();
                let delta = cell - if i == j { 1.0 } else { 0.0 };
                sum += delta * delta;
            }
        }
        2.0 * ((sum.sqrt() / (2.0 * std::f64::consts::SQRT_2)).clamp(0.0, 1.0)).asin()
    }
}

fn pt3(p: Point) -> V3 {
    [p.x, p.y, 0.0]
}

fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn norm(a: V3) -> f64 {
    dot(a, a).sqrt()
}

fn unit(a: V3) -> V3 {
    let n = norm(a);
    if n == 0.0 {
        a
    } else {
        [a[0] / n, a[1] / n, a[2] / n]
    }
}

/// Faces sharing a directed boundary edge, mirroring `find_adjacent_line`'s rule.
fn adjacency(graph: &FoldGraph) -> Vec<(usize, usize, usize)> {
    let mut edge_line: BTreeMap<(usize, usize), usize> = BTreeMap::new();
    for (index, line) in graph.lines.iter().enumerate() {
        let key = (line.begin.min(line.end), line.begin.max(line.end));
        edge_line.entry(key).or_insert(index);
    }
    let mut owner: BTreeMap<(usize, usize), Vec<usize>> = BTreeMap::new();
    for (face_index, face) in graph.faces.iter().enumerate() {
        for slot in 0..face.len() {
            let a = face[slot];
            let b = face[(slot + 1) % face.len()];
            owner
                .entry((a.min(b), a.max(b)))
                .or_default()
                .push(face_index);
        }
    }
    let mut out = Vec::new();
    for (key, faces) in owner {
        let Some(&line) = edge_line.get(&key) else {
            continue;
        };
        for i in 0..faces.len() {
            for j in (i + 1)..faces.len() {
                if faces[i] != faces[j] {
                    out.push((faces[i], faces[j], line));
                }
            }
        }
    }
    out
}

fn face_centroid(graph: &FoldGraph, face: usize) -> V3 {
    let ring = &graph.faces[face];
    let mut acc = [0.0; 3];
    for &p in ring {
        let v = pt3(graph.points[p]);
        acc = [acc[0] + v[0], acc[1] + v[1], acc[2] + v[2]];
    }
    let n = ring.len() as f64;
    [acc[0] / n, acc[1] / n, acc[2] / n]
}

/// Rotation for `child` about the crease, oriented so `parent` is on the left of
/// the axis in unfolded coordinates. Global sign is a *mirror* of the whole
/// state, so nothing measured here depends on which of the two is chosen.
fn crease_rigid(graph: &FoldGraph, parent: usize, line_index: usize) -> Option<Rigid> {
    let line = graph.lines.get(line_index)?;
    let segment = graph.segments.get(line_index)?;
    let rho = crease_fold_angle(segment)?.to_radians();
    let a = pt3(graph.points[line.begin]);
    let b = pt3(graph.points[line.end]);
    let mut u = unit(sub(b, a));
    if norm(sub(b, a)) == 0.0 {
        return None;
    }
    let to_parent = sub(face_centroid(graph, parent), a);
    if cross(u, to_parent)[2] < 0.0 {
        u = [-u[0], -u[1], -u[2]];
    }
    Some(Rigid::about(a, u, rho))
}

struct Placement {
    transforms: Vec<Option<Rigid>>,
    reached: usize,
    unassigned_creases: usize,
    /// Radians.
    loop_gap_rotation: f64,
    /// Paper units.
    loop_gap_length: f64,
    non_tree_edges: usize,
}

fn place(graph: &FoldGraph) -> Placement {
    let count = graph.faces.len();
    // The walk refuses a disconnected dual graph outright now rather than
    // handing back a partial one it silently leaves unfolded (`FoldGraphError`).
    // A file that trips it measures as nothing placed, which is exactly what the
    // `reached` column reports — and is a truer reading than the partial walk
    // this harness used to consume.
    let Ok(positions) = graph.face_positions(0) else {
        return Placement {
            transforms: vec![None; count],
            reached: 0,
            unassigned_creases: 0,
            loop_gap_rotation: 0.0,
            loop_gap_length: 0.0,
            non_tree_edges: 0,
        };
    };
    let mut transforms: Vec<Option<Rigid>> = vec![None; count];
    let mut unassigned = 0usize;

    // `face_position` is BFS depth + 1, so ascending depth is a valid parent
    // order: every parent is strictly shallower than its child.
    let mut order: Vec<usize> = (0..count)
        .filter(|&f| positions.face_position[f] != 0)
        .collect();
    order.sort_by_key(|&f| positions.face_position[f]);
    if count > 0 {
        transforms[positions.starting_face] = Some(Rigid::identity());
    }
    for face in order {
        if face == positions.starting_face {
            continue;
        }
        let (Some(parent), Some(line)) =
            (positions.next_face[face], positions.associated_line[face])
        else {
            continue;
        };
        let Some(parent_transform) = transforms[parent] else {
            continue;
        };
        match crease_rigid(graph, parent, line) {
            Some(step) => transforms[face] = Some(parent_transform.compose(&step)),
            None => {
                // A border or auxiliary line between two faces: no fold angle,
                // so the child keeps the parent's frame.
                unassigned += 1;
                transforms[face] = Some(parent_transform);
            }
        }
    }

    // Loop gap over the dual edges the spanning tree did not use.
    let mut tree: std::collections::BTreeSet<(usize, usize)> = Default::default();
    for face in 0..count {
        if let Some(parent) = positions.next_face[face] {
            tree.insert((face.min(parent), face.max(parent)));
        }
    }
    let mut seen: std::collections::BTreeSet<(usize, usize)> = Default::default();
    let mut worst_rotation: f64 = 0.0;
    let mut worst_length: f64 = 0.0;
    let mut non_tree = 0usize;
    for (f, g, line) in adjacency(graph) {
        let key = (f.min(g), f.max(g));
        if tree.contains(&key) || !seen.insert(key) {
            continue;
        }
        let (Some(tf), Some(tg)) = (transforms[f], transforms[g]) else {
            continue;
        };
        let Some(step) = crease_rigid(graph, f, line) else {
            continue;
        };
        let predicted = tf.compose(&step);
        non_tree += 1;
        worst_rotation = worst_rotation.max(predicted.rotation_angle_to(&tg));
        for &p in &graph.faces[g] {
            let v = pt3(graph.points[p]);
            worst_length = worst_length.max(norm(sub(predicted.apply(v), tg.apply(v))));
        }
    }

    Placement {
        transforms,
        reached: (0..count)
            .filter(|&f| positions.face_position[f] != 0)
            .count(),
        unassigned_creases: unassigned,
        loop_gap_rotation: worst_rotation,
        loop_gap_length: worst_length,
        non_tree_edges: non_tree,
    }
}

/// Faces every one of whose ring edges is a `Black0` line.
///
/// `calculate_faces` traces every bounded region, so a closed loop of border
/// lines drawn inside the paper comes back as a face — the hole, filled. This
/// finds those, so the loop gap can be re-measured on the annulus the file
/// actually describes.
fn hole_faces(graph: &FoldGraph) -> Vec<usize> {
    let mut edge_line: BTreeMap<(usize, usize), usize> = BTreeMap::new();
    for (index, line) in graph.lines.iter().enumerate() {
        edge_line
            .entry((line.begin.min(line.end), line.begin.max(line.end)))
            .or_insert(index);
    }
    let mut out = Vec::new();
    for (face_index, face) in graph.faces.iter().enumerate() {
        if face.len() < 3 {
            continue;
        }
        let all_border = (0..face.len()).all(|slot| {
            let a = face[slot];
            let b = face[(slot + 1) % face.len()];
            edge_line
                .get(&(a.min(b), a.max(b)))
                .is_some_and(|&line| graph.segments[line].color == LineColor::Black0)
        });
        if all_border {
            out.push(face_index);
        }
    }
    out
}

/// Loop gap over the dual graph with `excluded` faces deleted — the annulus the
/// file describes rather than the disk `calculate_faces` invents.
fn loop_gap_excluding(graph: &FoldGraph, excluded: &[usize]) -> (f64, f64, usize, usize) {
    let excluded: std::collections::BTreeSet<usize> = excluded.iter().copied().collect();
    let mut neighbours: BTreeMap<usize, Vec<(usize, usize)>> = BTreeMap::new();
    for (f, g, line) in adjacency(graph) {
        if excluded.contains(&f) || excluded.contains(&g) {
            continue;
        }
        neighbours.entry(f).or_default().push((g, line));
        neighbours.entry(g).or_default().push((f, line));
    }
    let Some(&root) = neighbours.keys().next() else {
        return (0.0, 0.0, 0, 0);
    };
    let mut transforms: BTreeMap<usize, Rigid> = BTreeMap::new();
    transforms.insert(root, Rigid::identity());
    let mut queue = std::collections::VecDeque::from([root]);
    let mut tree: std::collections::BTreeSet<(usize, usize)> = Default::default();
    while let Some(face) = queue.pop_front() {
        let current = transforms[&face];
        for (child, line) in neighbours.get(&face).cloned().unwrap_or_default() {
            if transforms.contains_key(&child) {
                continue;
            }
            let step = crease_rigid(graph, face, line).unwrap_or(Rigid::identity());
            transforms.insert(child, current.compose(&step));
            tree.insert((face.min(child), face.max(child)));
            queue.push_back(child);
        }
    }
    let mut worst_rotation: f64 = 0.0;
    let mut worst_length: f64 = 0.0;
    let mut non_tree = 0usize;
    let mut seen: std::collections::BTreeSet<(usize, usize)> = Default::default();
    for (f, g, line) in adjacency(graph) {
        if excluded.contains(&f) || excluded.contains(&g) {
            continue;
        }
        let key = (f.min(g), f.max(g));
        if tree.contains(&key) || !seen.insert(key) {
            continue;
        }
        let (Some(&tf), Some(&tg)) = (transforms.get(&f), transforms.get(&g)) else {
            continue;
        };
        let step = crease_rigid(graph, f, line).unwrap_or(Rigid::identity());
        let predicted = tf.compose(&step);
        non_tree += 1;
        worst_rotation = worst_rotation.max(predicted.rotation_angle_to(&tg));
        for &p in &graph.faces[g] {
            let v = pt3(graph.points[p]);
            worst_length = worst_length.max(norm(sub(predicted.apply(v), tg.apply(v))));
        }
    }
    (worst_rotation, worst_length, non_tree, transforms.len())
}

/// One vertex's elementary dual cycle: walk the faces around the vertex and
/// compose the crease rotations. On a disk every dual cycle is a product of
/// these, so this localises a loop gap to the vertex that causes it — which the
/// tree-plus-one-edge measure cannot do.
struct VertexCycle {
    point: Point,
    faces: usize,
    closed: bool,
    residual_radians: f64,
}

fn vertex_cycles(graph: &FoldGraph) -> Vec<VertexCycle> {
    // Undirected edge -> the faces on it, and the line carrying it.
    let mut edge_faces: BTreeMap<(usize, usize), Vec<usize>> = BTreeMap::new();
    let mut edge_line: BTreeMap<(usize, usize), usize> = BTreeMap::new();
    for (index, line) in graph.lines.iter().enumerate() {
        edge_line
            .entry((line.begin.min(line.end), line.begin.max(line.end)))
            .or_insert(index);
    }
    for (face_index, face) in graph.faces.iter().enumerate() {
        for slot in 0..face.len() {
            let a = face[slot];
            let b = face[(slot + 1) % face.len()];
            edge_faces
                .entry((a.min(b), a.max(b)))
                .or_default()
                .push(face_index);
        }
    }

    let mut faces_at: Vec<Vec<usize>> = vec![Vec::new(); graph.points.len()];
    for (face_index, face) in graph.faces.iter().enumerate() {
        for &p in face {
            faces_at[p].push(face_index);
        }
    }

    let mut out = Vec::new();
    for (point_index, faces) in faces_at.iter().enumerate() {
        if faces.len() < 3 {
            continue;
        }
        let start = faces[0];
        let mut current = start;
        let mut previous_edge: Option<(usize, usize)> = None;
        let mut transform = Rigid::identity();
        let mut steps = 0usize;
        let closed = loop {
            // The two ring edges of `current` that touch the vertex.
            let ring = &graph.faces[current];
            let mut incident: Vec<(usize, usize)> = Vec::new();
            for slot in 0..ring.len() {
                let a = ring[slot];
                let b = ring[(slot + 1) % ring.len()];
                if a == point_index || b == point_index {
                    incident.push((a.min(b), a.max(b)));
                }
            }
            incident.sort();
            incident.dedup();
            let Some(next_edge) = incident
                .iter()
                .find(|e| Some(**e) != previous_edge)
                .copied()
            else {
                break false;
            };
            let Some(&line) = edge_line.get(&next_edge) else {
                break false;
            };
            let Some(neighbours) = edge_faces.get(&next_edge) else {
                break false;
            };
            let Some(&next_face) = neighbours.iter().find(|f| **f != current) else {
                // Boundary edge: the vertex sits on the paper rim.
                break false;
            };
            if let Some(step) = crease_rigid(graph, current, line) {
                transform = transform.compose(&step);
            }
            steps += 1;
            previous_edge = Some(next_edge);
            current = next_face;
            if current == start {
                break true;
            }
            if steps > faces.len() + 2 {
                break false;
            }
        };
        out.push(VertexCycle {
            point: graph.points[point_index],
            faces: faces.len(),
            closed,
            residual_radians: transform.rotation_angle_to(&Rigid::identity()),
        });
    }
    out
}

struct Planes {
    /// Minimum strictly-positive offset difference between parallel face planes.
    min_separation: Option<f64>,
    /// Smallest non-zero angle between two face normals, radians.
    min_normal_angle: Option<f64>,
    /// Consecutive offset differences inside one normal class, in decade bins
    /// relative to the paper span: `<1e-12`, `1e-12..1e-9`, `1e-9..1e-6`,
    /// `1e-6..1e-3`, `>=1e-3`. The shape of this is the spectrum-gap question.
    separation_bins: [usize; 5],
    normal_classes: usize,
    distinct_offsets: usize,
}

/// Well-conditioned angle between two unit vectors.
fn vector_angle(a: V3, b: V3) -> f64 {
    norm(cross(a, b)).atan2(dot(a, b))
}

fn planes(graph: &FoldGraph, placement: &Placement, span: f64) -> Planes {
    let mut normals: Vec<(V3, f64)> = Vec::new();
    for (face, transform) in placement.transforms.iter().enumerate() {
        let Some(transform) = transform else { continue };
        let ring: Vec<V3> = graph.faces[face]
            .iter()
            .map(|&p| transform.apply(pt3(graph.points[p])))
            .collect();
        let mut n = [0.0; 3];
        for k in 0..ring.len() {
            let a = ring[k];
            let b = ring[(k + 1) % ring.len()];
            n = [
                n[0] + (a[1] - b[1]) * (a[2] + b[2]),
                n[1] + (a[2] - b[2]) * (a[0] + b[0]),
                n[2] + (a[0] - b[0]) * (a[1] + b[1]),
            ];
        }
        if norm(n) == 0.0 {
            continue;
        }
        let mut n = unit(n);
        // Canonical sign, so a face and its back read as one plane.
        if n[0] < 0.0 || (n[0] == 0.0 && n[1] < 0.0) || (n[0] == 0.0 && n[1] == 0.0 && n[2] < 0.0) {
            n = [-n[0], -n[1], -n[2]];
        }
        let centroid = {
            let mut acc = [0.0; 3];
            for v in &ring {
                acc = [acc[0] + v[0], acc[1] + v[1], acc[2] + v[2]];
            }
            let c = ring.len() as f64;
            [acc[0] / c, acc[1] / c, acc[2] / c]
        };
        normals.push((n, dot(n, centroid)));
    }

    // Greedy normal classes. `ANGLE_TOL` is deliberately far above the 1e-8
    // conditioning floor of the naive form and far below any real design angle;
    // `min_normal_angle` reports how much room that actually leaves.
    const ANGLE_TOL: f64 = 1e-7;
    let mut classes: Vec<(V3, Vec<f64>)> = Vec::new();
    let mut min_angle: Option<f64> = None;
    for (normal, offset) in &normals {
        let mut placed = false;
        for (class_normal, offsets) in classes.iter_mut() {
            let angle = vector_angle(*class_normal, *normal);
            let angle = angle.min(std::f64::consts::PI - angle);
            if angle <= ANGLE_TOL {
                offsets.push(*offset);
                placed = true;
                break;
            }
            min_angle = Some(min_angle.map_or(angle, |m: f64| m.min(angle)));
        }
        if !placed {
            classes.push((*normal, vec![*offset]));
        }
    }

    let mut min_separation: Option<f64> = None;
    let mut bins = [0usize; 5];
    let mut distinct = 0usize;
    for (_, offsets) in classes.iter_mut() {
        offsets.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let mut levels = 1usize;
        for window in offsets.windows(2) {
            let separation = (window[1] - window[0]).abs();
            let relative = separation / span;
            let bin = match relative {
                r if r < 1e-12 => 0,
                r if r < 1e-9 => 1,
                r if r < 1e-6 => 2,
                r if r < 1e-3 => 3,
                _ => 4,
            };
            bins[bin] += 1;
            if bin > 0 {
                levels += 1;
                min_separation =
                    Some(min_separation.map_or(separation, |m: f64| m.min(separation)));
            }
        }
        distinct += levels;
    }

    Planes {
        min_separation,
        min_normal_angle: min_angle,
        separation_bins: bins,
        normal_classes: classes.len(),
        distinct_offsets: distinct,
    }
}

#[allow(dead_code)]
struct Row {
    name: String,
    vertices: usize,
    segments: usize,
    non_classic: usize,
    faces: usize,
    euler_ok: bool,
    reached: usize,
    flat: usize,
    closure: usize,
    self_int: usize,
    indeterminate: usize,
    spatial: usize,
    loop_gap_rotation: f64,
    loop_gap_length: f64,
    non_tree_edges: usize,
    min_separation: Option<f64>,
    min_normal_angle: Option<f64>,
    separation_bins: [usize; 5],
    normal_classes: usize,
    distinct_offsets: usize,
    span: f64,
    unassigned_creases: usize,
    /// Closed elementary dual cycles (a vertex whose face ring closes).
    cycles: usize,
    worst_cycle: f64,
    /// Closed dual cycles at a vertex `dispatched_camv` never reports on,
    /// because `is_interior_vertex` sees a `Black0` line there.
    blind_cycles: usize,
    worst_blind_cycle: f64,
    /// `Black0` segments with a face on both sides.
    interior_borders: usize,
    /// Spatial vertices `is_interior_vertex` declines, so `dispatched_camv`
    /// never reports on them. A zero in the closure column can mean "checked and
    /// closed" or "never looked at"; this separates them.
    spatial_skipped: usize,
    hole_faces: usize,
    /// Loop gap with the filled holes deleted — the annulus the file describes.
    annulus_gap_radians: f64,
}

impl Row {
    /// "Reports nothing", exactly as `fold_corpus_scan` and the product define it.
    fn reports_nothing(&self) -> bool {
        self.flat == 0 && self.closure == 0 && self.self_int == 0
    }

    /// Everything the plan's §2 admission would additionally need.
    fn would_fold(&self) -> bool {
        self.reports_nothing()
            && self.non_classic > 0
            && self.euler_ok
            && self.faces > 0
            && self.reached == self.faces
            && self.indeterminate == 0
            && self.loop_gap_rotation.to_degrees() <= CLOSURE_BAR_DEGREES
    }
}

fn measure(name: &str, path: &Path) -> Result<Row, String> {
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let fold: FoldDocument = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let model = import_fold_document(&fold).map_err(|e| format!("{e:?}"))?;
    Ok(measure_model(name, &model))
}

fn measure_model(name: &str, model: &CreasePatternModel) -> Row {
    let dispatched = dispatched_camv(model);
    let mut closure = 0usize;
    let mut self_int = 0usize;
    let mut indeterminate = 0usize;
    for report in &dispatched.spatial {
        let crossing = report.link.is_some_and(|link| link.self_intersects());
        match report.residual {
            None => indeterminate += 1,
            Some(residual) if residual.to_degrees() <= CLOSURE_BAR_DEGREES => {
                self_int += usize::from(crossing);
            }
            Some(_) => closure += 1,
        }
    }

    let graph = FoldGraph::from_segments(&model.line_segments, true);
    let placement = place(&graph);
    let span = {
        let (mut lo_x, mut hi_x, mut lo_y, mut hi_y) = (
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
        );
        for p in &graph.points {
            lo_x = lo_x.min(p.x);
            hi_x = hi_x.max(p.x);
            lo_y = lo_y.min(p.y);
            hi_y = hi_y.max(p.y);
        }
        (hi_x - lo_x).max(hi_y - lo_y).max(1e-9)
    };
    let plane_stats = planes(&graph, &placement, span);

    let cycles = vertex_cycles(&graph);
    let mut closed_cycles = 0usize;
    let mut worst_cycle: f64 = 0.0;
    let mut blind_cycles = 0usize;
    let mut worst_blind: f64 = 0.0;
    for cycle in cycles.iter().filter(|c| c.closed) {
        closed_cycles += 1;
        worst_cycle = worst_cycle.max(cycle.residual_radians);
        let lines = crate::checks_spatial::incident_lines_at(model, cycle.point);
        if !crate::checks_spatial::is_interior_vertex(&lines) {
            blind_cycles += 1;
            worst_blind = worst_blind.max(cycle.residual_radians);
        }
    }
    let holes = hole_faces(&graph);
    let annulus_gap = if holes.is_empty() {
        placement.loop_gap_rotation
    } else {
        loop_gap_excluding(&graph, &holes).0
    };
    let mut interior_borders = 0usize;
    {
        let mut edge_faces: BTreeMap<(usize, usize), usize> = BTreeMap::new();
        for face in &graph.faces {
            for slot in 0..face.len() {
                let a = face[slot];
                let b = face[(slot + 1) % face.len()];
                *edge_faces.entry((a.min(b), a.max(b))).or_default() += 1;
            }
        }
        for (index, line) in graph.lines.iter().enumerate() {
            if graph.segments[index].color != LineColor::Black0 {
                continue;
            }
            let key = (line.begin.min(line.end), line.begin.max(line.end));
            if edge_faces.get(&key).copied().unwrap_or(0) >= 2 {
                interior_borders += 1;
            }
        }
    }

    Row {
        name: name.to_string(),
        vertices: graph.points.len(),
        segments: model.line_segments.len(),
        non_classic: model
            .line_segments
            .iter()
            .filter(|s| !crate::model::is_classic_crease(s))
            .count(),
        faces: graph.faces.len(),
        euler_ok: graph.include_faces,
        reached: placement.reached,
        flat: dispatched.flat.len(),
        closure,
        self_int,
        indeterminate,
        spatial: dispatched.spatial.len(),
        loop_gap_rotation: placement.loop_gap_rotation,
        loop_gap_length: placement.loop_gap_length,
        non_tree_edges: placement.non_tree_edges,
        min_separation: plane_stats.min_separation,
        min_normal_angle: plane_stats.min_normal_angle,
        separation_bins: plane_stats.separation_bins,
        normal_classes: plane_stats.normal_classes,
        distinct_offsets: plane_stats.distinct_offsets,
        span,
        unassigned_creases: placement.unassigned_creases,
        cycles: closed_cycles,
        worst_cycle,
        blind_cycles,
        worst_blind_cycle: worst_blind,
        interior_borders,
        spatial_skipped: crate::checks::point_line_map(model)
            .into_iter()
            .filter(|(_, lines)| {
                crate::checks_spatial::vertex_regime(lines)
                    == crate::checks_spatial::VertexRegime::Spatial
                    && !crate::checks_spatial::is_interior_vertex(lines)
            })
            .count(),
        hole_faces: holes.len(),
        annulus_gap_radians: annulus_gap,
    }
}

fn collect(dir: &Path) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|e| e == "fold") {
            out.push((
                path.file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into(),
                path,
            ));
        }
    }
    out.sort();
    out
}

#[test]
#[ignore = "measurement harness; needs ORISTUDIO_SPIKE_DIRS"]
fn spike_a_admission_scan() {
    let Ok(dirs) = std::env::var("ORISTUDIO_SPIKE_DIRS") else {
        println!("set ORISTUDIO_SPIKE_DIRS to a colon-separated list of directories");
        return;
    };
    for dir in dirs.split(':').filter(|d| !d.is_empty()) {
        println!("\n=== {dir}");
        println!(
            "{:<32}{:>6}{:>6}{:>6}{:>6}{:>5}{:>6}{:>6}{:>5}{:>6}{:>11}{:>11}{:>6}{:>11}{:>11}  verdict",
            "model",
            "verts",
            "segs",
            "n180",
            "faces",
            "eul",
            "reach",
            "flat",
            "clos",
            "xing",
            "gap(rad)",
            "gap(len)",
            "ntree",
            "minsep",
            "minang",
        );
        let mut fold_count = 0usize;
        let mut total = 0usize;
        let mut reports_nothing = 0usize;
        let mut with_angles = 0usize;
        let mut vacuous = 0usize;
        let mut euler_rejected = 0usize;
        let mut disconnected = 0usize;
        let mut blind = 0usize;
        let mut worst_relative_gap: f64 = 0.0;
        let mut min_relative_separation = f64::INFINITY;
        for (name, path) in collect(Path::new(dir)) {
            total += 1;
            match measure(&name, &path) {
                Err(error) => println!("{name:<32}  FAILED: {error}"),
                Ok(row) => {
                    if row.non_classic > 0 {
                        with_angles += 1;
                    }
                    if row.reports_nothing() {
                        reports_nothing += 1;
                        if row.spatial == 0 && row.non_classic > 0 {
                            vacuous += 1;
                        }
                        if !row.euler_ok || row.faces == 0 {
                            euler_rejected += 1;
                        } else if row.reached != row.faces {
                            disconnected += 1;
                        }
                        if row.blind_cycles > 0 {
                            blind += 1;
                        }
                    }
                    if row.would_fold() {
                        fold_count += 1;
                        worst_relative_gap = worst_relative_gap.max(row.loop_gap_length / row.span);
                        if let Some(separation) = row.min_separation {
                            min_relative_separation =
                                min_relative_separation.min(separation / row.span);
                        }
                    }
                    println!(
                        "{:<32}{:>6}{:>6}{:>6}{:>6}{:>5}{:>6}{:>6}{:>5}{:>6}{:>11.2e}{:>11.2e}{:>6}{:>11}{:>11}  {}{}{}",
                        row.name,
                        row.vertices,
                        row.segments,
                        row.non_classic,
                        row.faces,
                        if row.euler_ok { "y" } else { "N" },
                        row.reached,
                        row.flat,
                        row.closure,
                        row.self_int,
                        row.loop_gap_rotation,
                        row.loop_gap_length,
                        row.non_tree_edges,
                        row.min_separation
                            .map_or("inf".to_string(), |s| format!("{s:.3e}")),
                        row.min_normal_angle
                            .map_or("-".to_string(), |s| format!("{s:.3e}")),
                        if row.would_fold() { "FOLDS" } else { "" },
                        if row.reports_nothing() && !row.would_fold() {
                            "silent-refuse"
                        } else {
                            ""
                        },
                        format_args!(
                            " [span {:.0} planes {} sepbins {:?} cycles {} worst {:.1e} BLIND {} worst {:.1e} intborder {} holes {} annulusgap {:.1e} indet {} camv {}checked/{}skipped]",
                            row.span,
                            row.distinct_offsets,
                            row.separation_bins,
                            row.cycles,
                            row.worst_cycle,
                            row.blind_cycles,
                            row.worst_blind_cycle,
                            row.interior_borders,
                            row.hole_faces,
                            row.annulus_gap_radians,
                            row.indeterminate,
                            row.spatial,
                            row.spatial_skipped
                        ),
                    );
                }
            }
        }
        println!(
            "{total} models; {with_angles} carry a non-classic angle; {reports_nothing} report nothing; {fold_count} would fold in 3D"
        );
        println!(
            "  of the {reports_nothing} that report nothing: {vacuous} had no spatial vertex checked at all, {euler_rejected} lost their faces to the Euler gate, {disconnected} have a disconnected face graph, {blind} have a dual cycle CAMV never looks at"
        );
        println!(
            "  window on the models that fold: worst loop gap {worst_relative_gap:.2e} of span, smallest plane separation {min_relative_separation:.2e} of span => {:.1} decades",
            (min_relative_separation / worst_relative_gap.max(f64::MIN_POSITIVE)).log10()
        );
    }
}

/// Per-non-tree-edge breakdown for one file, with the shared crease and the
/// CAMV standing of each of its endpoints. Answers "which vertices does the
/// admission gate not look at, and does the loop gap open exactly there".
#[test]
#[ignore = "measurement harness; needs ORISTUDIO_SPIKE_FILE"]
fn spike_a_focus() {
    use crate::checks_spatial::{
        VertexRegime, incident_lines_at, is_interior_vertex, vertex_regime,
    };

    let Ok(file) = std::env::var("ORISTUDIO_SPIKE_FILE") else {
        println!("set ORISTUDIO_SPIKE_FILE");
        return;
    };
    let raw = std::fs::read_to_string(&file).expect("read");
    let fold: FoldDocument = serde_json::from_str(&raw).expect("parse");
    let model = import_fold_document(&fold).expect("import");
    let graph = FoldGraph::from_segments(&model.line_segments, true);
    let placement = place(&graph);
    let Ok(positions) = graph.face_positions(0) else {
        println!("{file}: disconnected fold graph, nothing to walk");
        return;
    };

    let mut tree: std::collections::BTreeSet<(usize, usize)> = Default::default();
    for face in 0..graph.faces.len() {
        if let Some(parent) = positions.next_face[face] {
            tree.insert((face.min(parent), face.max(parent)));
        }
    }
    let mut rows: Vec<(f64, f64, usize, usize, usize)> = Vec::new();
    let mut seen: std::collections::BTreeSet<(usize, usize)> = Default::default();
    for (f, g, line) in adjacency(&graph) {
        let key = (f.min(g), f.max(g));
        if tree.contains(&key) || !seen.insert(key) {
            continue;
        }
        let (Some(tf), Some(tg)) = (placement.transforms[f], placement.transforms[g]) else {
            continue;
        };
        let Some(step) = crease_rigid(&graph, f, line) else {
            rows.push((f64::NAN, f64::NAN, line, f, g));
            continue;
        };
        let predicted = tf.compose(&step);
        let mut length: f64 = 0.0;
        for &p in &graph.faces[g] {
            let v = pt3(graph.points[p]);
            length = length.max(norm(sub(predicted.apply(v), tg.apply(v))));
        }
        rows.push((predicted.rotation_angle_to(&tg), length, line, f, g));
    }
    rows.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    println!("{} non-tree dual edges", rows.len());
    let describe = |point: Point| {
        let lines = incident_lines_at(&model, point);
        let interior = is_interior_vertex(&lines);
        let regime = vertex_regime(&lines);
        let borders = lines
            .iter()
            .filter(|l| l.color == LineColor::Black0)
            .count();
        format!(
            "deg {} borders {} interior {} {}",
            lines.len(),
            borders,
            interior,
            if regime == VertexRegime::Spatial {
                "spatial"
            } else {
                "flat"
            }
        )
    };
    for (rotation, length, line, f, g) in rows.iter().take(12) {
        let segment = &graph.segments[*line];
        let graph_line = graph.lines[*line];
        println!(
            "  gap(rad) {rotation:.3e} gap(len) {length:.3e} faces {f}/{g} colour {:?} angle {:?}",
            segment.color,
            crease_fold_angle(segment)
        );
        println!("      begin {}", describe(graph.points[graph_line.begin]));
        println!("      end   {}", describe(graph.points[graph_line.end]));
    }

    let mut skipped = 0usize;
    let mut checked = 0usize;
    for (point, lines) in crate::checks::point_line_map(&model) {
        let _ = point;
        if vertex_regime(&lines) == VertexRegime::Spatial {
            if is_interior_vertex(&lines) {
                checked += 1;
            } else {
                skipped += 1;
            }
        }
    }
    println!(
        "spatial vertices: {checked} checked, {skipped} skipped as non-interior (a Black0 line touches them)"
    );
    let dispatched = dispatched_camv(&model);
    let worst_residual = dispatched
        .spatial
        .iter()
        .filter_map(|report| report.residual)
        .fold(0.0_f64, f64::max);
    println!(
        "camv: {} flat violations, {} spatial reports, worst closure residual {:.3e} deg (bar {CLOSURE_BAR_DEGREES:.0e})",
        dispatched.flat.len(),
        dispatched.spatial.len(),
        worst_residual.to_degrees()
    );

    let mut cycles = vertex_cycles(&graph);
    cycles.sort_by(|a, b| {
        b.residual_radians
            .partial_cmp(&a.residual_radians)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let closed: Vec<&VertexCycle> = cycles.iter().filter(|c| c.closed).collect();
    println!(
        "{} elementary dual cycles (closed face rings); worst residual {:.3e} rad",
        closed.len(),
        closed.first().map_or(0.0, |c| c.residual_radians)
    );
    let holes = hole_faces(&graph);
    let (rotation, length, non_tree, reached) = loop_gap_excluding(&graph, &holes);
    println!(
        "hole faces (every ring edge Black0): {} -> with them deleted: loop gap {rotation:.3e} rad / {length:.3e} len over {non_tree} non-tree edges, {reached} faces reached",
        holes.len()
    );
    for cycle in closed.iter().take(6) {
        let lines = incident_lines_at(&model, cycle.point);
        println!(
            "  ({:.3},{:.3}) faces {} residual {:.3e} rad | camv: {}",
            cycle.point.x,
            cycle.point.y,
            cycle.faces,
            cycle.residual_radians,
            if !is_interior_vertex(&lines) {
                "SKIPPED (non-interior)".to_string()
            } else if vertex_regime(&lines) == VertexRegime::Flat {
                "flat branch".to_string()
            } else {
                format!(
                    "spatial residual {:.3e} rad",
                    crate::checks_spatial::vertex_closure_residual(
                        &crate::checks_spatial::vertex_fan(cycle.point, &lines, false)
                    )
                )
            }
        );
    }
}

/// A paper ring: four radial creases, zero interior vertices. Research §2b T2's
/// counterexample, expressed against the shipped kernel rather than NumPy.
#[test]
#[ignore = "measurement harness"]
fn spike_a_annulus() {
    use crate::geometry::{FoldMagnitude, LineSegment};

    let mut segments = Vec::new();
    let square = |r: f64| {
        [
            Point::new(-r, -r),
            Point::new(r, -r),
            Point::new(r, r),
            Point::new(-r, r),
        ]
    };
    let outer = square(100.0);
    let inner = square(40.0);
    for k in 0..4 {
        segments.push(LineSegment::with_color(
            outer[k],
            outer[(k + 1) % 4],
            LineColor::Black0,
        ));
        segments.push(LineSegment::with_color(
            inner[k],
            inner[(k + 1) % 4],
            LineColor::Black0,
        ));
    }
    for k in 0..4 {
        let mut crease = LineSegment::with_color(inner[k], outer[k], LineColor::Blue2);
        crease.fold_magnitude = FoldMagnitude::from_degrees(90.0);
        segments.push(crease);
    }
    let model = CreasePatternModel {
        line_segments: segments,
        ..CreasePatternModel::default()
    };

    let row = measure_model("annulus_90", &model);
    println!(
        "annulus: verts {} segs {} faces {} euler_ok {} reached {} flat {} closure {} spatial-reports {} interior-borders {} hole-faces {}",
        row.vertices,
        row.segments,
        row.faces,
        row.euler_ok,
        row.reached,
        row.flat,
        row.closure,
        row.spatial,
        row.interior_borders,
        row.hole_faces,
    );
    println!(
        "  hole filled (what the kernel computes): loop gap {:.3e} rad / {:.3e} len over {} non-tree dual edges",
        row.loop_gap_rotation, row.loop_gap_length, row.non_tree_edges,
    );
    println!(
        "  hole deleted (the annulus the drawing describes): loop gap {:.3e} rad",
        row.annulus_gap_radians,
    );
    let graph = FoldGraph::from_segments(&model.line_segments, true);
    for (index, face) in graph.faces.iter().enumerate() {
        let ring: Vec<String> = face
            .iter()
            .map(|&p| format!("({:.0},{:.0})", graph.points[p].x, graph.points[p].y))
            .collect();
        println!("  face {index}: {}", ring.join(" "));
    }
    println!("  has_non_classic {}", has_non_classic_creases(&model));
}

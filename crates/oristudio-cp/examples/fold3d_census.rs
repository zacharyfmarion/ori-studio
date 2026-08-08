//! Spike C — coplanar-overlap census on 3D-placed faces.
//!
//! The 3D-folded-state plan's merge set renders a folded figure **without**
//! layer ordering, and that is only honest when the coplanar-overlap census is
//! usually zero. This measures it on real files.
//!
//! Everything topological comes from the shipped kernel, not from the file:
//! `import_fold_document` builds the `CreasePatternModel` and
//! `export_fold_document` runs `FoldGraph::from_model_for_export`, which is the
//! same `FoldGraph::from_segments(segments, true)` the fold command reaches
//! through `FoldingEstimateSession`. So `faces_vertices` coming back empty here
//! is exactly the Euler gate refusing, on exactly the arrangement `G` would
//! have used.
//!
//! ```bash
//! cargo run -p oristudio-cp --release --example fold3d_census -- <dir-or-file>...
//! ```
//!
//! Flags: `--csv` machine-readable rows; `--sweep` census under a plane-tolerance
//! sweep; `--sign` both placement sign conventions; `--gaps` where a placement
//! stops being path-independent; `--arrangement` what the face walk produced;
//! `--selftest` the polygon-overlap primitive against hand-computable areas.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::path::{Path, PathBuf};

use oristudio_cp::checks_spatial::{
    dispatched_camv, incident_lines_at, vertex_closure_residual, vertex_fan_at,
};
use oristudio_cp::folding::estimate_wireframe_from_segments;
use oristudio_cp::geometry::{LineColor, Point};
use oristudio_cp::io::fold::{export_fold_document, import_fold_document};
use oristudio_cp::model::is_classic_crease;
use treemaker_fold::{Assignment, FoldDocument};

/// Mirrors the private bar in `lib.rs` (`CLOSURE_RESIDUAL_BAR_DEGREES`).
const CLOSURE_BAR_DEGREES: f64 = 1e-6;

// --- linear algebra ---------------------------------------------------------

type Vec3 = [f64; 3];

fn sub(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn add(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

fn scale(a: Vec3, k: f64) -> Vec3 {
    [a[0] * k, a[1] * k, a[2] * k]
}

fn dot(a: Vec3, b: Vec3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross(a: Vec3, b: Vec3) -> Vec3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn norm(a: Vec3) -> f64 {
    dot(a, a).sqrt()
}

fn unit(a: Vec3) -> Vec3 {
    let n = norm(a);
    if n == 0.0 { a } else { scale(a, 1.0 / n) }
}

/// A rigid transform: `x -> rot * x + translation`, columns stored row-major.
#[derive(Clone, Copy, Debug)]
struct Rigid {
    rot: [Vec3; 3],
    translation: Vec3,
}

impl Rigid {
    fn identity() -> Self {
        Self {
            rot: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            translation: [0.0, 0.0, 0.0],
        }
    }

    fn apply(&self, v: Vec3) -> Vec3 {
        add(
            [
                dot(self.rot[0], v),
                dot(self.rot[1], v),
                dot(self.rot[2], v),
            ],
            self.translation,
        )
    }

    fn apply_linear(&self, v: Vec3) -> Vec3 {
        [
            dot(self.rot[0], v),
            dot(self.rot[1], v),
            dot(self.rot[2], v),
        ]
    }

    /// `rotation about (pivot, axis) by angle` composed with `self`.
    fn then_rotate(&self, pivot: Vec3, axis: Vec3, angle: f64) -> Self {
        let r = rotation(unit(axis), angle);
        let mul = |m: &[Vec3; 3], v: Vec3| [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
        let rot = [
            mul(&r, [self.rot[0][0], self.rot[1][0], self.rot[2][0]]),
            mul(&r, [self.rot[0][1], self.rot[1][1], self.rot[2][1]]),
            mul(&r, [self.rot[0][2], self.rot[1][2], self.rot[2][2]]),
        ];
        // `rot` currently holds the columns; transpose back to rows.
        let rot = [
            [rot[0][0], rot[1][0], rot[2][0]],
            [rot[0][1], rot[1][1], rot[2][1]],
            [rot[0][2], rot[1][2], rot[2][2]],
        ];
        let moved = mul(&r, sub(self.translation, pivot));
        Self {
            rot,
            translation: add(moved, pivot),
        }
    }

    /// The inverse rigid motion. Used to re-anchor a placement on a chosen face
    /// without redoing the walk.
    fn inverse(&self) -> Self {
        let rot = [
            [self.rot[0][0], self.rot[1][0], self.rot[2][0]],
            [self.rot[0][1], self.rot[1][1], self.rot[2][1]],
            [self.rot[0][2], self.rot[1][2], self.rot[2][2]],
        ];
        let t = [
            -dot(rot[0], self.translation),
            -dot(rot[1], self.translation),
            -dot(rot[2], self.translation),
        ];
        Self {
            rot,
            translation: t,
        }
    }
}

fn rotation(axis: Vec3, angle: f64) -> [Vec3; 3] {
    let (s, c) = angle.sin_cos();
    let t = 1.0 - c;
    let [x, y, z] = axis;
    [
        [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
        [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
        [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
    ]
}

// --- polygon area, exact for simple (possibly non-convex) polygons ----------

type Pt = (f64, f64);

fn signed_area(poly: &[Pt]) -> f64 {
    let mut sum = 0.0;
    for i in 0..poly.len() {
        let a = poly[i];
        let b = poly[(i + 1) % poly.len()];
        sum += a.0 * b.1 - b.0 * a.1;
    }
    sum / 2.0
}

/// Sutherland-Hodgman clip of `subject` by the CCW convex `clip`.
fn clip_convex(subject: &[Pt], clip: &[Pt]) -> Vec<Pt> {
    let mut out = subject.to_vec();
    for i in 0..clip.len() {
        if out.is_empty() {
            return out;
        }
        let a = clip[i];
        let b = clip[(i + 1) % clip.len()];
        let (ex, ey) = (b.0 - a.0, b.1 - a.1);
        let side = |p: Pt| ex * (p.1 - a.1) - ey * (p.0 - a.0);
        let input = std::mem::take(&mut out);
        let mut previous = input[input.len() - 1];
        let mut previous_side = side(previous);
        for current in input {
            let current_side = side(current);
            if current_side >= 0.0 {
                if previous_side < 0.0 {
                    let t = previous_side / (previous_side - current_side);
                    out.push((
                        previous.0 + t * (current.0 - previous.0),
                        previous.1 + t * (current.1 - previous.1),
                    ));
                }
                out.push(current);
            } else if previous_side >= 0.0 {
                let t = previous_side / (previous_side - current_side);
                out.push((
                    previous.0 + t * (current.0 - previous.0),
                    previous.1 + t * (current.1 - previous.1),
                ));
            }
            previous = current;
            previous_side = current_side;
        }
    }
    out
}

/// Area of `a ∩ b` for two **simple** polygons, exactly.
///
/// Both are decomposed into signed fan triangles about the origin. That
/// decomposition reproduces the polygon as a signed measure whether or not it is
/// convex, so summing `σ_i σ_j · area(T_i ∩ T_j)` over triangle pairs is exact —
/// no ear clipping and no convexity assumption. Every `T_i ∩ T_j` is a
/// convex-convex clip.
fn intersection_area(a: &[Pt], b: &[Pt]) -> f64 {
    let fans = |poly: &[Pt]| -> Vec<(Vec<Pt>, f64)> {
        let mut out = Vec::with_capacity(poly.len());
        for i in 0..poly.len() {
            let p = poly[i];
            let q = poly[(i + 1) % poly.len()];
            let tri = vec![(0.0, 0.0), p, q];
            let area = signed_area(&tri);
            if area.abs() > 0.0 {
                let sign = area.signum();
                let tri = if area < 0.0 {
                    vec![(0.0, 0.0), q, p]
                } else {
                    tri
                };
                out.push((tri, sign));
            }
        }
        out
    };
    let (fa, fb) = (fans(a), fans(b));
    let mut total = 0.0;
    for (ta, sa) in &fa {
        for (tb, sb) in &fb {
            let piece = clip_convex(ta, tb);
            if piece.len() >= 3 {
                total += sa * sb * signed_area(&piece).abs();
            }
        }
    }
    total.abs()
}

// --- the model, as the kernel sees it ---------------------------------------

struct Arrangement {
    points: Vec<Pt>,
    edges: Vec<[usize; 2]>,
    /// Radians, `None` for a non-crease (border, auxiliary).
    fold_angles: Vec<Option<f64>>,
    /// `Black0` — Oriedita's paper border. Interior to the arrangement it is a
    /// **cut**, not a hinge, and the kernel excuses every vertex it touches.
    is_border: Vec<bool>,
    faces: Vec<Vec<usize>>,
    arrangement_ok: bool,
    span: f64,
}

fn arrangement(fold: &FoldDocument) -> Result<Arrangement, String> {
    let model = import_fold_document(fold).map_err(|e| format!("{e:?}"))?;
    let exported = export_fold_document(&model, None);
    let points: Vec<Pt> = exported
        .vertices_coords
        .iter()
        .map(|c| (c[0], c[1]))
        .collect();
    let border_colors: Vec<i64> = exported
        .extra
        .get("oristudio:edges_line_colors")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(serde_json::Value::as_i64).collect())
        .unwrap_or_default();
    let mut is_border = Vec::with_capacity(exported.edges_vertices.len());
    let mut fold_angles = Vec::with_capacity(exported.edges_vertices.len());
    for (index, _) in exported.edges_vertices.iter().enumerate() {
        // A border or auxiliary line is `Flat` and carries angle 0; only M/V
        // creases move paper, and `export_fold_document` writes their signed
        // magnitude straight from `crease_fold_angle`.
        let is_crease = exported
            .edges_assignment
            .get(index)
            .is_some_and(|a| matches!(a, Assignment::Mountain | Assignment::Valley));
        let angle = exported
            .edges_fold_angle
            .get(index)
            .copied()
            .flatten()
            .unwrap_or(0.0);
        fold_angles.push(is_crease.then(|| angle.to_radians()));
        is_border.push(border_colors.get(index).copied() == Some(0));
    }
    let (mut lo, mut hi) = ((f64::MAX, f64::MAX), (f64::MIN, f64::MIN));
    for p in &points {
        lo = (lo.0.min(p.0), lo.1.min(p.1));
        hi = (hi.0.max(p.0), hi.1.max(p.1));
    }
    let span = ((hi.0 - lo.0).max(hi.1 - lo.1)).max(1e-9);
    Ok(Arrangement {
        points,
        edges: exported.edges_vertices.clone(),
        fold_angles,
        is_border,
        faces: exported.faces_vertices.clone(),
        arrangement_ok: !exported.faces_vertices.is_empty(),
        span,
    })
}

/// The dual graph of the arrangement: which faces meet across which edge.
struct Dual {
    /// Face rings, each reoriented CCW in the unfolded sheet so the directed
    /// crease a placement rotates about is well defined.
    oriented: Vec<Vec<usize>>,
    edge_index: BTreeMap<(usize, usize), usize>,
    edge_faces: BTreeMap<usize, Vec<usize>>,
}

fn dual(model: &Arrangement) -> Dual {
    let mut edge_index: BTreeMap<(usize, usize), usize> = BTreeMap::new();
    for (index, edge) in model.edges.iter().enumerate() {
        edge_index.insert((edge[0].min(edge[1]), edge[0].max(edge[1])), index);
    }
    let mut oriented: Vec<Vec<usize>> = Vec::with_capacity(model.faces.len());
    for face in &model.faces {
        let poly: Vec<Pt> = face.iter().map(|&v| model.points[v]).collect();
        let mut face = face.clone();
        if signed_area(&poly) < 0.0 {
            face.reverse();
        }
        oriented.push(face);
    }
    let mut edge_faces: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for (face_index, face) in oriented.iter().enumerate() {
        for i in 0..face.len() {
            let (a, b) = (face[i], face[(i + 1) % face.len()]);
            if let Some(&e) = edge_index.get(&(a.min(b), a.max(b))) {
                edge_faces.entry(e).or_default().push(face_index);
            }
        }
    }
    Dual {
        oriented,
        edge_index,
        edge_faces,
    }
}

/// One BFS step: place `child` given its already-placed `parent` across `edge`.
///
/// The crease is directed as it appears in the **parent's** CCW ring, and the
/// child is rotated by `sign * angle` about it. Directing it from the parent is
/// what makes the step antisymmetric: the same crease appears reversed in the
/// child's ring, so walking back undoes the rotation exactly.
fn step(model: &Arrangement, parent: Rigid, a: usize, b: usize, angle: f64) -> Rigid {
    let pa = model.points[a];
    let pb = model.points[b];
    let pivot = parent.apply([pa.0, pa.1, 0.0]);
    let axis = parent.apply_linear([pb.0 - pa.0, pb.1 - pa.1, 0.0]);
    parent.then_rotate(pivot, axis, angle)
}

struct Placement {
    /// `None` for a face never reached (disconnected, or degenerate).
    transforms: Vec<Option<Rigid>>,
    components: Vec<usize>,
    component_count: usize,
    /// Worst disagreement, in model units, over non-tree dual adjacencies.
    loop_gap: f64,
    unreached: usize,
    tree_edges: BTreeSet<(usize, usize)>,
}

/// Place faces by BFS over the dual graph, composing one rotation per crease.
///
/// `sign` picks between the two conventions. It is a **global mirror**, not a
/// choice with a right answer here: conjugating by `diag(1,1,-1)` sends
/// `R(axis, rho)` to `R(axis, -rho)` for any in-sheet axis, so flipping it
/// reflects the whole placement and leaves every distance — the loop gap and the
/// census both — unchanged. `--sign` shows that empirically.
fn place(model: &Arrangement, graph: &Dual, sign: f64) -> Placement {
    let mut transforms: Vec<Option<Rigid>> = vec![None; graph.oriented.len()];
    let mut components = vec![usize::MAX; graph.oriented.len()];
    let mut tree_edges: BTreeSet<(usize, usize)> = BTreeSet::new();
    let mut component_count = 0usize;

    for seed in 0..graph.oriented.len() {
        if transforms[seed].is_some() {
            continue;
        }
        transforms[seed] = Some(Rigid::identity());
        components[seed] = component_count;
        let mut queue = VecDeque::from([seed]);
        while let Some(face_index) = queue.pop_front() {
            let Some(parent) = transforms[face_index] else {
                continue;
            };
            let face = graph.oriented[face_index].clone();
            for i in 0..face.len() {
                let (a, b) = (face[i], face[(i + 1) % face.len()]);
                let Some(&e) = graph.edge_index.get(&(a.min(b), a.max(b))) else {
                    continue;
                };
                let Some(neighbours) = graph.edge_faces.get(&e) else {
                    continue;
                };
                for &other in neighbours {
                    if other == face_index || transforms[other].is_some() {
                        continue;
                    }
                    let angle = sign * model.fold_angles[e].unwrap_or(0.0);
                    transforms[other] = Some(step(model, parent, a, b, angle));
                    components[other] = component_count;
                    tree_edges.insert((face_index.min(other), face_index.max(other)));
                    queue.push_back(other);
                }
            }
        }
        component_count += 1;
    }

    let mut loop_gap: f64 = 0.0;
    for (gap, _, _, _) in non_tree_gaps(model, graph, &transforms, &tree_edges) {
        loop_gap = loop_gap.max(gap);
    }

    let unreached = transforms.iter().filter(|t| t.is_none()).count();
    Placement {
        transforms,
        components,
        component_count,
        loop_gap,
        unreached,
        tree_edges,
    }
}

/// Every non-tree dual adjacency, with how far the two faces disagree about
/// where the shared crease's endpoints land.
///
/// Zero everywhere is the statement that the placement is path-independent, and
/// on a disk that is an algebraic consequence of per-vertex closure — so a
/// non-zero entry on a document the kernel calls clean is a defect somewhere,
/// in the file or in the checker.
fn non_tree_gaps(
    model: &Arrangement,
    graph: &Dual,
    transforms: &[Option<Rigid>],
    tree_edges: &BTreeSet<(usize, usize)>,
) -> Vec<(f64, usize, usize, usize)> {
    let mut out = Vec::new();
    for (&e, neighbours) in &graph.edge_faces {
        if neighbours.len() < 2 {
            continue;
        }
        let [a, b] = model.edges[e];
        for i in 0..neighbours.len() {
            for j in (i + 1)..neighbours.len() {
                let (f, g) = (neighbours[i], neighbours[j]);
                if tree_edges.contains(&(f.min(g), f.max(g))) {
                    continue;
                }
                let (Some(tf), Some(tg)) = (transforms[f], transforms[g]) else {
                    continue;
                };
                let mut gap: f64 = 0.0;
                for &v in &[a, b] {
                    let p = model.points[v];
                    gap = gap.max(norm(sub(
                        tf.apply([p.0, p.1, 0.0]),
                        tg.apply([p.0, p.1, 0.0]),
                    )));
                }
                out.push((gap, e, f, g));
            }
        }
    }
    out
}

/// Place only the faces around one vertex, so nothing is inherited from
/// elsewhere in the sheet.
///
/// This is what localises a placement failure. A whole-sheet loop gap says only
/// that *some* star failed; the error then propagates outward and the largest
/// whole-sheet number lands nowhere near its cause.
fn local_star_gaps(model: &Arrangement, graph: &Dual, sign: f64) -> Vec<(f64, usize, usize)> {
    let mut out = Vec::new();
    for v in 0..model.points.len() {
        let star: Vec<usize> = (0..graph.oriented.len())
            .filter(|&f| graph.oriented[f].contains(&v))
            .collect();
        let incident: Vec<usize> = model
            .edges
            .iter()
            .enumerate()
            .filter(|(_, e)| e[0] == v || e[1] == v)
            .map(|(i, _)| i)
            .collect();
        // A full fan has one sector per incident edge. Anything else is a
        // boundary vertex or an arrangement the walk disagrees about.
        if star.len() < 3 || incident.len() != star.len() {
            continue;
        }
        let mut local: BTreeMap<usize, Rigid> = BTreeMap::new();
        local.insert(star[0], Rigid::identity());
        let mut queue = VecDeque::from([star[0]]);
        let mut used: BTreeSet<(usize, usize)> = BTreeSet::new();
        while let Some(f) = queue.pop_front() {
            let parent = local[&f];
            let ring = graph.oriented[f].clone();
            for i in 0..ring.len() {
                let (a, b) = (ring[i], ring[(i + 1) % ring.len()]);
                if a != v && b != v {
                    continue;
                }
                let Some(&e) = graph.edge_index.get(&(a.min(b), a.max(b))) else {
                    continue;
                };
                let Some(neighbours) = graph.edge_faces.get(&e) else {
                    continue;
                };
                for &other in neighbours {
                    if other == f || local.contains_key(&other) {
                        continue;
                    }
                    let angle = sign * model.fold_angles[e].unwrap_or(0.0);
                    local.insert(other, step(model, parent, a, b, angle));
                    used.insert((f.min(other), f.max(other)));
                    queue.push_back(other);
                }
            }
        }
        if local.len() != star.len() {
            continue;
        }
        let mut gap: f64 = 0.0;
        for &e in &incident {
            let Some(neighbours) = graph.edge_faces.get(&e) else {
                continue;
            };
            for i in 0..neighbours.len() {
                for j in (i + 1)..neighbours.len() {
                    let (f, g) = (neighbours[i], neighbours[j]);
                    if used.contains(&(f.min(g), f.max(g))) {
                        continue;
                    }
                    let [a, b] = model.edges[e];
                    for &w in &[a, b] {
                        let p = model.points[w];
                        gap = gap.max(norm(sub(
                            local[&f].apply([p.0, p.1, 0.0]),
                            local[&g].apply([p.0, p.1, 0.0]),
                        )));
                    }
                }
            }
        }
        out.push((gap, v, star.len()));
    }
    out.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    out
}

#[derive(Default, Clone, Copy)]
struct Census {
    plane_count: usize,
    patch_count: usize,
    /// Coplanar face pairs overlapping in positive area, within one component.
    overlapping_pairs: usize,
    /// Of those, pairs that are not edge-adjacent in the crease pattern.
    non_adjacent_pairs: usize,
    largest_plane: usize,
    /// Faces that sit in a plane with at least one overlap.
    faces_in_overlap: usize,
}

fn census(model: &Arrangement, placement: &Placement, normal_tol: f64, offset_tol: f64) -> Census {
    // Placed face polygons, in 3D.
    let mut placed: Vec<(usize, Vec<Vec3>, Vec3, f64)> = Vec::new();
    for (index, face) in model.faces.iter().enumerate() {
        let Some(t) = placement.transforms[index] else {
            continue;
        };
        let ring: Vec<Vec3> = face
            .iter()
            .map(|&v| {
                let p = model.points[v];
                t.apply([p.0, p.1, 0.0])
            })
            .collect();
        if ring.len() < 3 {
            continue;
        }
        // Newell's normal: correct for non-convex and near-degenerate rings.
        let mut n = [0.0, 0.0, 0.0];
        for i in 0..ring.len() {
            let p = ring[i];
            let q = ring[(i + 1) % ring.len()];
            n = add(
                n,
                [
                    (p[1] - q[1]) * (p[2] + q[2]),
                    (p[2] - q[2]) * (p[0] + q[0]),
                    (p[0] - q[0]) * (p[1] + q[1]),
                ],
            );
        }
        if norm(n) < 1e-12 * model.span * model.span {
            continue;
        }
        let mut n = unit(n);
        // Canonical orientation so a face folded back on itself lands in the
        // same plane cluster as the face under it.
        let lead = n.iter().position(|c| c.abs() > 1e-9).unwrap_or(0);
        if n[lead] < 0.0 {
            n = scale(n, -1.0);
        }
        let offset = dot(n, ring[0]);
        placed.push((index, ring, n, offset));
    }

    // Cluster into planes, within a placement component (across components the
    // relative placement is undetermined, so a cross-component "overlap" is an
    // artefact of both roots being seeded at the identity).
    let mut clusters: Vec<(usize, Vec3, f64, Vec<usize>)> = Vec::new();
    for (slot, (face_index, _, n, offset)) in placed.iter().enumerate() {
        let component = placement.components[*face_index];
        let found = clusters.iter_mut().find(|(c, cn, co, _)| {
            *c == component
                && dot(*cn, *n) > 1.0 - normal_tol
                && (co - offset).abs() < offset_tol * model.span
        });
        match found {
            Some((_, _, _, members)) => members.push(slot),
            None => clusters.push((component, *n, *offset, vec![slot])),
        }
    }

    let mut out = Census {
        plane_count: clusters.len(),
        largest_plane: clusters.iter().map(|c| c.3.len()).max().unwrap_or(0),
        ..Census::default()
    };

    let mut adjacency: BTreeSet<(usize, usize)> = BTreeSet::new();
    let mut vertex_sets: Vec<BTreeSet<usize>> = Vec::with_capacity(model.faces.len());
    for face in &model.faces {
        vertex_sets.push(face.iter().copied().collect());
    }
    for i in 0..model.faces.len() {
        for j in (i + 1)..model.faces.len() {
            if vertex_sets[i].intersection(&vertex_sets[j]).count() >= 2 {
                adjacency.insert((i, j));
            }
        }
    }

    let mut overlapped_faces: BTreeSet<usize> = BTreeSet::new();
    for (_, normal, _, members) in &clusters {
        // A 2D frame for this plane.
        let seed = if normal[0].abs() < 0.9 {
            [1.0, 0.0, 0.0]
        } else {
            [0.0, 1.0, 0.0]
        };
        let u = unit(cross(*normal, seed));
        let v = cross(*normal, u);
        let project = |p: Vec3| -> Pt { (dot(p, u), dot(p, v)) };
        let polys: Vec<Vec<Pt>> = members
            .iter()
            .map(|&slot| placed[slot].1.iter().map(|&p| project(p)).collect())
            .collect();
        let bounds: Vec<(f64, f64, f64, f64)> = polys
            .iter()
            .map(|poly| {
                let mut b = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
                for p in poly {
                    b = (b.0.min(p.0), b.1.min(p.1), b.2.max(p.0), b.3.max(p.1));
                }
                b
            })
            .collect();
        // A patch is a connected run of edge-adjacent faces inside one plane.
        let mut seen: BTreeSet<usize> = BTreeSet::new();
        for start in 0..members.len() {
            if !seen.insert(start) {
                continue;
            }
            let mut queue = VecDeque::from([start]);
            while let Some(k) = queue.pop_front() {
                for other in 0..members.len() {
                    if seen.contains(&other) {
                        continue;
                    }
                    let (a, b) = (placed[members[k]].0, placed[members[other]].0);
                    if adjacency.contains(&(a.min(b), a.max(b))) {
                        seen.insert(other);
                        queue.push_back(other);
                    }
                }
            }
            out.patch_count += 1;
        }

        let area_bar = 1e-9 * model.span * model.span;
        for i in 0..members.len() {
            for j in (i + 1)..members.len() {
                let (bi, bj) = (bounds[i], bounds[j]);
                if bi.2 < bj.0 || bj.2 < bi.0 || bi.3 < bj.1 || bj.3 < bi.1 {
                    continue;
                }
                if intersection_area(&polys[i], &polys[j]) <= area_bar {
                    continue;
                }
                out.overlapping_pairs += 1;
                let (a, b) = (placed[members[i]].0, placed[members[j]].0);
                if !adjacency.contains(&(a.min(b), a.max(b))) {
                    out.non_adjacent_pairs += 1;
                }
                overlapped_faces.insert(a);
                overlapped_faces.insert(b);
            }
        }
    }
    out.faces_in_overlap = overlapped_faces.len();
    out
}

// --- per-model description --------------------------------------------------

struct Row {
    name: String,
    vertices: usize,
    edges: usize,
    faces: usize,
    arrangement_ok: bool,
    creases: usize,
    full_180: usize,
    non_classic: usize,
    flat_violations: usize,
    closure_failures: usize,
    spatial_vertices: usize,
    interior_cuts: usize,
    all_regime_failures: usize,
    worst_residual: f64,
    admissible: bool,
    components: usize,
    unreached: usize,
    loop_gap: f64,
    census: Census,
    direction_system: &'static str,
}

/// The crease-direction angle system, as the corpus README labels it.
fn direction_system(model: &Arrangement) -> &'static str {
    let worst_residual = |step: f64| -> f64 {
        let mut worst: f64 = 0.0;
        for edge in &model.edges {
            let a = model.points[edge[0]];
            let b = model.points[edge[1]];
            let (dx, dy) = (b.0 - a.0, b.1 - a.1);
            if dx.hypot(dy) < 1e-9 * model.span {
                continue;
            }
            let mut degrees = dy.atan2(dx).to_degrees().rem_euclid(180.0);
            degrees /= step;
            let residual = (degrees - degrees.round()).abs() * step;
            worst = worst.max(residual);
        }
        worst
    };
    for (step, label) in [
        (90.0, "90"),
        (45.0, "45"),
        (22.5, "22.5"),
        (7.5, "7.5"),
        (1.0, "1-deg"),
    ] {
        if worst_residual(step) < 1e-6 {
            return label;
        }
    }
    "free-form"
}

fn measure(path: &Path, sign: f64) -> Result<Row, String> {
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let fold: FoldDocument = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let model = arrangement(&fold)?;

    let cp = import_fold_document(&fold).map_err(|e| format!("{e:?}"))?;
    let dispatched = dispatched_camv(&cp);
    let mut closure_failures = 0usize;
    for report in &dispatched.spatial {
        if report
            .residual
            .is_some_and(|r| r.to_degrees() > CLOSURE_BAR_DEGREES)
        {
            closure_failures += 1;
        }
    }

    // Closure over **every** arrangement vertex, both regimes. `dispatched_camv`
    // sends an all-180 vertex to Oriedita's flat checker, which answers "is a
    // flat folding reachable" and not "does this assignment close in 3D"; the
    // placement needs the latter at every vertex, so measure it directly.
    let mut all_regime_failures = 0usize;
    let mut worst_residual: f64 = 0.0;
    for point in &model.points {
        let at = Point::new(point.0, point.1);
        // Same "interior" test the kernel uses: zero incident border segments
        // (`checks_spatial.rs:642`). A boundary vertex carries no closure
        // constraint, so including one would manufacture a failure.
        if incident_lines_at(&cp, at)
            .iter()
            .any(|line| line.color == LineColor::Black0)
        {
            continue;
        }
        let fan = vertex_fan_at(&cp, at);
        if fan.indeterminate.is_some() || fan.degree() < 3 {
            continue;
        }
        let residual = vertex_closure_residual(&fan).to_degrees();
        worst_residual = worst_residual.max(residual);
        if residual > CLOSURE_BAR_DEGREES {
            all_regime_failures += 1;
        }
    }

    // Interior cuts: a `Black0` border segment with paper on both sides. The
    // kernel's `is_interior_vertex` (`checks_spatial.rs:642`) excuses every
    // vertex touching one, so CAMV returns CLEAN on geometry it never checked —
    // and a placement that welds the cut shut is answering a different question.
    let mut faces_per_edge = vec![0usize; model.edges.len()];
    {
        let mut edge_index: BTreeMap<(usize, usize), usize> = BTreeMap::new();
        for (index, edge) in model.edges.iter().enumerate() {
            edge_index.insert((edge[0].min(edge[1]), edge[0].max(edge[1])), index);
        }
        for face in &model.faces {
            for i in 0..face.len() {
                let (a, b) = (face[i], face[(i + 1) % face.len()]);
                if let Some(&e) = edge_index.get(&(a.min(b), a.max(b))) {
                    faces_per_edge[e] += 1;
                }
            }
        }
    }
    let interior_cuts = (0..model.edges.len())
        .filter(|&e| model.is_border[e] && faces_per_edge[e] >= 2)
        .count();

    let creases = model.fold_angles.iter().filter(|a| a.is_some()).count();
    let full_180 = model
        .fold_angles
        .iter()
        .filter_map(|a| *a)
        .filter(|a| (a.abs() - std::f64::consts::PI).abs() < 1e-9)
        .count();

    let graph = dual(&model);
    let placement = place(&model, &graph, sign);
    let census = census(&model, &placement, 1e-9, 1e-6);

    Ok(Row {
        name: path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into(),
        vertices: model.points.len(),
        edges: model.edges.len(),
        faces: model.faces.len(),
        arrangement_ok: model.arrangement_ok,
        creases,
        full_180,
        non_classic: creases - full_180,
        flat_violations: dispatched.flat.len(),
        closure_failures,
        spatial_vertices: dispatched.spatial.len(),
        interior_cuts,
        all_regime_failures,
        worst_residual,
        admissible: dispatched.flat.is_empty() && closure_failures == 0 && interior_cuts == 0,
        components: placement.component_count,
        unreached: placement.unreached,
        loop_gap: placement.loop_gap,
        census,
        direction_system: direction_system(&model),
    })
}

/// Cross-check the placement against the shipped flat folder.
///
/// On an all-classic document every crease is a half-turn about an in-sheet
/// axis, which restricted to the sheet plane **is** the 2D reflection Oriedita's
/// `fold_movement` applies — so this placement and `estimate_wireframe_from_segments`
/// must produce the same folded points, to rounding. Both consume the same
/// `FoldGraph::from_segments`, so point and face indices line up and the
/// comparison needs no matching step.
///
/// This is the only validation available that measures the placement against
/// code someone else wrote and the oracle tests already pin.
fn flat_check(path: &Path) -> Result<(f64, usize, f64), String> {
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let fold: FoldDocument = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let cp = import_fold_document(&fold).map_err(|e| format!("{e:?}"))?;
    if cp.line_segments.iter().any(|line| !is_classic_crease(line)) {
        return Err("not an all-classic document".into());
    }
    let model = arrangement(&fold)?;
    if !model.arrangement_ok {
        return Err("arrangement refused".into());
    }
    let wire = estimate_wireframe_from_segments(&cp.line_segments, 1)
        .ok_or_else(|| "flat folder declined".to_string())?;
    if wire.points.len() != model.points.len() {
        return Err(format!(
            "point counts differ: {} vs {}",
            wire.points.len(),
            model.points.len()
        ));
    }
    let graph = dual(&model);
    let placement = place(&model, &graph, -1.0);
    let anchor = placement.transforms[wire.starting_face]
        .ok_or_else(|| "starting face unplaced".to_string())?
        .inverse();

    let mut worst: f64 = 0.0;
    let mut worst_z: f64 = 0.0;
    let mut compared = 0usize;
    for (index, face) in graph.oriented.iter().enumerate() {
        let Some(t) = placement.transforms[index] else {
            continue;
        };
        for &v in face {
            let p = model.points[v];
            let mine = anchor.apply(t.apply([p.0, p.1, 0.0]));
            let theirs = wire.points[v];
            if !theirs.x.is_finite() || !theirs.y.is_finite() {
                continue;
            }
            worst = worst.max((mine[0] - theirs.x).hypot(mine[1] - theirs.y));
            worst_z = worst_z.max(mine[2].abs());
            compared += 1;
        }
    }
    Ok((worst, compared, worst_z))
}

/// Check the one primitive the whole census rests on.
///
/// `intersection_area` is the only place a wrong answer would move every number
/// in the report without looking wrong, and the non-convex cases are exactly the
/// ones a fan triangulation gets silently wrong — so they are checked here
/// against areas that can be worked out by hand.
fn selftest() -> bool {
    let unit = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)];
    let mut ok = true;
    let mut check = |label: &str, got: f64, want: f64| {
        let pass = (got - want).abs() < 1e-12;
        ok &= pass;
        println!(
            "  {} {label}: got {got:.12} want {want:.12}",
            if pass { "ok  " } else { "FAIL" }
        );
    };

    check(
        "identical unit squares",
        intersection_area(&unit, &unit),
        1.0,
    );
    check(
        "disjoint squares",
        intersection_area(&unit, &[(2.0, 0.0), (3.0, 0.0), (3.0, 1.0), (2.0, 1.0)]),
        0.0,
    );
    check(
        "edge-adjacent squares (measure zero)",
        intersection_area(&unit, &[(1.0, 0.0), (2.0, 0.0), (2.0, 1.0), (1.0, 1.0)]),
        0.0,
    );
    check(
        "quarter overlap",
        intersection_area(&unit, &[(0.5, 0.5), (1.5, 0.5), (1.5, 1.5), (0.5, 1.5)]),
        0.25,
    );
    // An L: the unit square with its top-right quarter removed, area 3/4.
    let ell = [
        (0.0, 0.0),
        (1.0, 0.0),
        (1.0, 0.5),
        (0.5, 0.5),
        (0.5, 1.0),
        (0.0, 1.0),
    ];
    check(
        "L against the square that contains it",
        intersection_area(&ell, &unit),
        0.75,
    );
    check("L against itself", intersection_area(&ell, &ell), 0.75);
    check(
        "L against the quarter it is missing",
        intersection_area(&ell, &[(0.5, 0.5), (1.0, 0.5), (1.0, 1.0), (0.5, 1.0)]),
        0.0,
    );
    // Clockwise input must give the same area as counter-clockwise.
    let mut reversed = ell;
    reversed.reverse();
    check(
        "L reversed against the square",
        intersection_area(&reversed, &unit),
        0.75,
    );
    // A U, area 3/4 again, whose notch is a hole the clip must not fill in.
    let u_shape = [
        (0.0, 0.0),
        (3.0, 0.0),
        (3.0, 3.0),
        (2.0, 3.0),
        (2.0, 1.0),
        (1.0, 1.0),
        (1.0, 3.0),
        (0.0, 3.0),
    ];
    check(
        "U against its own bounding box",
        intersection_area(&u_shape, &[(0.0, 0.0), (3.0, 0.0), (3.0, 3.0), (0.0, 3.0)]),
        7.0,
    );
    check(
        "U against the bar spanning its notch",
        intersection_area(&u_shape, &[(0.0, 2.0), (3.0, 2.0), (3.0, 2.5), (0.0, 2.5)]),
        1.0,
    );
    // Two side-6 equilateral triangles crossing in a hexagram. Each has area
    // 9*sqrt(3); cut into the side-2 triangular grid that is nine cells, and the
    // inner hexagon is six of them, so the intersection is exactly 6*sqrt(3).
    let s3 = 3.0_f64.sqrt();
    let up = [(-3.0, -s3), (3.0, -s3), (0.0, 2.0 * s3)];
    let down = [(-3.0, s3), (0.0, -2.0 * s3), (3.0, s3)];
    check("hexagram", intersection_area(&up, &down), 6.0 * s3);
    ok
}

fn gather(inputs: &[String]) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for input in inputs {
        let path = PathBuf::from(input);
        if path.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&path) {
                for entry in entries.flatten() {
                    let candidate = entry.path();
                    if candidate.extension().is_some_and(|e| e == "fold") {
                        files.push(candidate);
                    }
                }
            }
        } else if path.extension().is_some_and(|e| e == "fold") {
            files.push(path);
        }
    }
    files.sort();
    files
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let csv = args.iter().any(|a| a == "--csv");
    let sweep = args.iter().any(|a| a == "--sweep");
    let sign_probe = args.iter().any(|a| a == "--sign");
    let inputs: Vec<String> = args
        .iter()
        .filter(|a| !a.starts_with("--"))
        .cloned()
        .collect();
    if args.iter().any(|a| a == "--selftest") {
        println!("intersection_area self-test");
        if !selftest() {
            std::process::exit(1);
        }
        return;
    }

    let files = gather(&inputs);
    if files.is_empty() {
        eprintln!(
            "usage: fold3d_census <dir-or-file>... \
             [--csv] [--sweep] [--sign] [--gaps] [--arrangement] [--selftest]"
        );
        return;
    }

    if args.iter().any(|a| a == "--arrangement") {
        for path in &files {
            let Ok(raw) = std::fs::read_to_string(path) else {
                continue;
            };
            let Ok(fold) = serde_json::from_str::<FoldDocument>(&raw) else {
                continue;
            };
            let Ok(model) = arrangement(&fold) else {
                continue;
            };
            let mut ring_sizes: BTreeMap<usize, usize> = BTreeMap::new();
            let mut open_rings = 0usize;
            let mut edge_index: BTreeMap<(usize, usize), usize> = BTreeMap::new();
            for (index, edge) in model.edges.iter().enumerate() {
                edge_index.insert((edge[0].min(edge[1]), edge[0].max(edge[1])), index);
            }
            let mut incidence: BTreeMap<usize, usize> = BTreeMap::new();
            let mut missing_edges = 0usize;
            for face in &model.faces {
                *ring_sizes.entry(face.len()).or_default() += 1;
                let mut distinct: BTreeSet<usize> = BTreeSet::new();
                for &v in face {
                    distinct.insert(v);
                }
                if distinct.len() != face.len() {
                    open_rings += 1;
                }
                for i in 0..face.len() {
                    let (a, b) = (face[i], face[(i + 1) % face.len()]);
                    match edge_index.get(&(a.min(b), a.max(b))) {
                        Some(&e) => *incidence.entry(e).or_default() += 1,
                        None => missing_edges += 1,
                    }
                }
            }
            let mut fan: BTreeMap<usize, usize> = BTreeMap::new();
            for count in incidence.values() {
                *fan.entry(*count).or_default() += 1;
            }
            let mut total_area = 0.0;
            let mut biggest: f64 = 0.0;
            for face in &model.faces {
                let poly: Vec<Pt> = face.iter().map(|&v| model.points[v]).collect();
                let area = signed_area(&poly).abs();
                total_area += area;
                biggest = biggest.max(area);
            }
            let (mut lo, mut hi) = ((f64::MAX, f64::MAX), (f64::MIN, f64::MIN));
            for p in &model.points {
                lo = (lo.0.min(p.0), lo.1.min(p.1));
                hi = (hi.0.max(p.0), hi.1.max(p.1));
            }
            let bbox = (hi.0 - lo.0) * (hi.1 - lo.1);
            println!(
                "   face area sum {:.1}  bbox {:.1}  ratio {:.3}  biggest face / bbox {:.3}",
                total_area,
                bbox,
                total_area / bbox,
                biggest / bbox
            );
            println!(
                "{:<34} rings {:?} repeated-vertex-rings {} ring-steps-with-no-edge {} \
                 faces-per-edge {:?} edges-with-no-face {}",
                path.file_stem().unwrap_or_default().to_string_lossy(),
                ring_sizes,
                open_rings,
                missing_edges,
                fan,
                model.edges.len() - incidence.len(),
            );
        }
        return;
    }

    if args.iter().any(|a| a == "--flatcheck") {
        println!(
            "{:<40} {:>12} {:>10} {:>12}",
            "model", "max-deviation", "points", "max-|z|"
        );
        let (mut checked, mut agreed) = (0usize, 0usize);
        for path in &files {
            let name = path.file_stem().unwrap_or_default().to_string_lossy();
            match flat_check(path) {
                Ok((worst, points, worst_z)) => {
                    checked += 1;
                    agreed += usize::from(worst < 1e-6);
                    println!("{name:<40} {worst:>12.3e} {points:>10} {worst_z:>12.3e}");
                }
                Err(why) => println!("{name:<40} {why:>12}"),
            }
        }
        println!("\nagreed with the shipped flat folder: {agreed} of {checked}");
        return;
    }

    if args.iter().any(|a| a == "--gaps") {
        for path in &files {
            let Ok(raw) = std::fs::read_to_string(path) else {
                continue;
            };
            let Ok(fold) = serde_json::from_str::<FoldDocument>(&raw) else {
                continue;
            };
            let Ok(model) = arrangement(&fold) else {
                continue;
            };
            let graph = dual(&model);
            let placement = place(&model, &graph, -1.0);
            println!("{}", path.file_stem().unwrap_or_default().to_string_lossy());
            for (gap, v, degree) in local_star_gaps(&model, &graph, -1.0).iter().take(3) {
                println!(
                    "   local star gap {:.3e} at ({:.4},{:.4}) degree {}",
                    gap, model.points[*v].0, model.points[*v].1, degree
                );
            }
            let mut worst =
                non_tree_gaps(&model, &graph, &placement.transforms, &placement.tree_edges);
            worst.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
            for (gap, e, f, g) in worst.iter().take(3) {
                let [a, b] = model.edges[*e];
                println!(
                    "   whole-sheet gap {:.3e} across edge ({:.3},{:.3})-({:.3},{:.3}) angle {:?} faces {f} {g}",
                    gap,
                    model.points[a].0,
                    model.points[a].1,
                    model.points[b].0,
                    model.points[b].1,
                    model.fold_angles[*e].map(f64::to_degrees),
                );
            }
        }
        return;
    }

    if sign_probe {
        println!(
            "{:<34} {:>14} {:>14}",
            "model", "gap(sign=-1)", "gap(sign=+1)"
        );
        for path in &files {
            let minus = measure(path, -1.0).map(|r| r.loop_gap);
            let plus = measure(path, 1.0).map(|r| r.loop_gap);
            let show = |v: &Result<f64, String>| match v {
                Ok(g) => format!("{g:.3e}"),
                Err(_) => "err".into(),
            };
            println!(
                "{:<34} {:>14} {:>14}",
                path.file_stem().unwrap_or_default().to_string_lossy(),
                show(&minus),
                show(&plus)
            );
        }
        return;
    }

    if csv {
        println!(
            "model,vertices,edges,faces,arrangement_ok,creases,full180,non_classic,\
             flat,closure,spatial_verts,interior_cuts,all_regime_fail,worst_residual_deg,admissible,components,unreached,loop_gap,\
             planes,patches,largest_plane,overlap_pairs,non_adjacent_pairs,faces_in_overlap,dir_system"
        );
    } else {
        println!(
            "{:<34} {:>5} {:>5} {:>5} {:>4} {:>6} {:>6} {:>9} {:>8} {:>7} {:>7} {:>8}",
            "model",
            "V",
            "E",
            "F",
            "arr",
            "n180",
            "nfree",
            "loop-gap",
            "planes",
            "pairs",
            "nonadj",
            "verdict"
        );
    }

    let mut rows = Vec::new();
    for path in &files {
        match measure(path, -1.0) {
            Ok(row) => rows.push(row),
            Err(e) => eprintln!("{}: {e}", path.display()),
        }
    }

    for row in &rows {
        if csv {
            println!(
                "{},{},{},{},{},{},{},{},{},{},{},{},{},{:.3e},{},{},{},{:.3e},{},{},{},{},{},{},{}",
                row.name,
                row.vertices,
                row.edges,
                row.faces,
                row.arrangement_ok,
                row.creases,
                row.full_180,
                row.non_classic,
                row.flat_violations,
                row.closure_failures,
                row.spatial_vertices,
                row.interior_cuts,
                row.all_regime_failures,
                row.worst_residual,
                row.admissible,
                row.components,
                row.unreached,
                row.loop_gap,
                row.census.plane_count,
                row.census.patch_count,
                row.census.largest_plane,
                row.census.overlapping_pairs,
                row.census.non_adjacent_pairs,
                row.census.faces_in_overlap,
                row.direction_system,
            );
        } else {
            println!(
                "{:<34} {:>5} {:>5} {:>5} {:>4} {:>6} {:>6} {:>9.2e} {:>8} {:>7} {:>7} {:>8}",
                row.name,
                row.vertices,
                row.edges,
                row.faces,
                if row.arrangement_ok { "ok" } else { "NO" },
                row.full_180,
                row.non_classic,
                row.loop_gap,
                row.census.plane_count,
                row.census.overlapping_pairs,
                row.census.non_adjacent_pairs,
                if row.admissible { "ADMIT" } else { "refuse" },
            );
        }
    }

    if sweep {
        println!("\ntolerance sweep (normal_tol / offset_tol x span) -> overlap pairs");
        for path in &files {
            let Ok(raw) = std::fs::read_to_string(path) else {
                continue;
            };
            let Ok(fold) = serde_json::from_str::<FoldDocument>(&raw) else {
                continue;
            };
            let Ok(model) = arrangement(&fold) else {
                continue;
            };
            let graph = dual(&model);
            let placement = place(&model, &graph, -1.0);
            let mut cells = Vec::new();
            for (nt, ot) in [
                (1e-12, 1e-9),
                (1e-9, 1e-6),
                (1e-6, 1e-4),
                (1e-4, 1e-3),
                (1e-2, 1e-2),
            ] {
                cells.push(format!(
                    "{:>6}",
                    census(&model, &placement, nt, ot).overlapping_pairs
                ));
            }
            println!(
                "{:<34} {}",
                path.file_stem().unwrap_or_default().to_string_lossy(),
                cells.join(" ")
            );
        }
    }

    if !csv {
        let admitted: Vec<&Row> = rows
            .iter()
            .filter(|r| r.admissible && r.arrangement_ok)
            .collect();
        let zero = admitted
            .iter()
            .filter(|r| r.census.overlapping_pairs == 0)
            .count();
        let mut pairs: Vec<usize> = admitted
            .iter()
            .map(|r| r.census.overlapping_pairs)
            .collect();
        pairs.sort_unstable();
        let median = pairs.get(pairs.len() / 2).copied().unwrap_or(0);
        println!(
            "\nadmissible + arranged: {} of {}; census 0 on {}; median {}; max {}",
            admitted.len(),
            rows.len(),
            zero,
            median,
            pairs.last().copied().unwrap_or(0)
        );
        let no_arrangement = rows.iter().filter(|r| !r.arrangement_ok).count();
        println!(
            "arrangement refused (Euler gate): {no_arrangement} of {}",
            rows.len()
        );

        // Every crease at exactly +/-180 folds its two faces into one plane, and
        // two polygons sharing an edge and lying on the same side of it always
        // overlap in positive area. So the count of full folds is a lower bound
        // on the census that needs no placement at all — and the census being
        // zero is equivalent to the document having no full fold in it.
        let breaches: Vec<&&Row> = admitted
            .iter()
            .filter(|r| r.census.overlapping_pairs < r.full_180)
            .collect();
        println!(
            "census >= full-fold count: holds on {} of {} admitted{}",
            admitted.len() - breaches.len(),
            admitted.len(),
            if breaches.is_empty() {
                String::new()
            } else {
                format!(
                    " (breached by {})",
                    breaches
                        .iter()
                        .map(|r| r.name.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            }
        );
        let no_full_fold = admitted.iter().filter(|r| r.full_180 == 0).count();
        println!(
            "admitted with no full fold: {no_full_fold}; of those, census 0 on {}",
            admitted
                .iter()
                .filter(|r| r.full_180 == 0 && r.census.overlapping_pairs == 0)
                .count()
        );
    }
}

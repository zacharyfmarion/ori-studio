//! Rigid placement of an arrangement's faces in 3D.
//!
//! **Ori Studio native — no Oriedita counterpart.** Upstream creases are always
//! a full ±180, so upstream's walk mirrors rather than rotates and there is
//! nothing here to be faithful to. See PORTING.md.
//!
//! The only thing that changes against the flat path is the per-crease
//! transform. Topology — the arrangement, the dual-graph spanning tree, the
//! parent of each face and the crease it folds across — comes from
//! [`FoldGraph`] and [`FoldGraph::face_positions`] unchanged, so a placement
//! and a flat fold of the same document walk the same tree in the same order.
//!
//! # The convention
//!
//! > `M_child = M_parent ∘ Rot_paper(line, rho)`
//!
//! Right-compose. The rotation is taken in **paper** coordinates about the
//! crease line, never in the parent's moved frame. The axis is directed the way
//! the **child** face's own winding traverses that edge. `rho` is the signed
//! FOLD angle from [`crease_fold_angle`] — valley positive, mountain negative —
//! applied directly and never as `pi - rho`.
//!
//! This is [`crate::checks_spatial::vertex_link_polygon`]'s
//! `frame = quat_mul(frame, crease_quat(theta, rho))` lifted from
//! directions-at-a-vertex to rigid motions. It is not a new convention: it is
//! the one the shipped spherical-simplicity check already uses, and placement
//! has to share it or the admission gate certifies states the renderer draws
//! mirrored. The quaternion primitives are imported from that module rather than
//! re-typed, for the same reason.
//!
//! # `FoldGraph` faces are wound the wrong way, by construction
//!
//! [`FoldGraph::should_add_face`] admits a traced face only when
//! `Polygon::calculate_area` is positive, and that function returns the
//! **negated** shoelace — so every face comes back **clockwise** in y-up paper
//! coordinates, the exact mirror of the convention above. Every ring is
//! therefore reversed once, here, before anything reads it, and
//! `foldgraph_rings_are_clockwise_and_the_walk_reverses_them_once` pins both
//! halves. Miss it and every model renders mirrored, with nothing else in the
//! pipeline noticing.

use std::collections::BTreeMap;

use crate::checks_spatial::{
    Quat, Vec3, axis_quat, cross, dot, norm, quat_conj, quat_mul, quat_residual, quat_rotate,
};
use crate::fold_graph::{FoldGraph, FoldGraphError};
use crate::folding3d::{Fold3dPlacementError, Fold3dRefusal};
use crate::geometry::{LineSegment, Point};
use crate::model::crease_fold_angle;

/// A rigid motion `x -> rotation * x + translation`.
///
/// The rotation is a quaternion rather than a matrix so that composing a
/// placement and composing a vertex link are literally the same operation.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rigid {
    pub rotation: Quat,
    pub translation: Vec3,
}

impl Rigid {
    pub const IDENTITY: Self = Self {
        rotation: (1.0, 0.0, 0.0, 0.0),
        translation: [0.0, 0.0, 0.0],
    };

    pub fn apply(&self, v: Vec3) -> Vec3 {
        let r = quat_rotate(self.rotation, v);
        [
            r[0] + self.translation[0],
            r[1] + self.translation[1],
            r[2] + self.translation[2],
        ]
    }

    /// The linear part only — for normals and directions, which do not
    /// translate.
    pub fn apply_direction(&self, v: Vec3) -> Vec3 {
        quat_rotate(self.rotation, v)
    }

    /// `self ∘ other`: `other` applies first.
    pub fn compose(&self, other: &Self) -> Self {
        let t = quat_rotate(self.rotation, other.translation);
        Self {
            rotation: quat_mul(self.rotation, other.rotation),
            translation: [
                t[0] + self.translation[0],
                t[1] + self.translation[1],
                t[2] + self.translation[2],
            ],
        }
    }

    pub fn inverse(&self) -> Self {
        let rotation = quat_conj(self.rotation);
        let t = quat_rotate(rotation, self.translation);
        Self {
            rotation,
            translation: [-t[0], -t[1], -t[2]],
        }
    }

    /// Rotation by `radians` about the line through `pivot` with unit direction
    /// `axis`.
    pub fn about_line(pivot: Vec3, axis: Vec3, radians: f64) -> Self {
        let rotation = axis_quat(axis, radians);
        let moved = quat_rotate(rotation, pivot);
        Self {
            rotation,
            translation: [
                pivot[0] - moved[0],
                pivot[1] - moved[1],
                pivot[2] - moved[2],
            ],
        }
    }

    /// Angle between two rotations, radians over `[0, pi]`.
    ///
    /// Via `2*atan2(|v|, w)` on the relative quaternion, folded into `[0, pi]`
    /// because `q` and `-q` are the same rotation and a placement that differs
    /// by a full turn is not a disagreement.
    ///
    /// **Not** `acos((trace - 1) / 2)`. `acos` near 1 has a square-root
    /// conditioning floor at `sqrt(2*eps) = 1.5e-8`, and every closing model
    /// measured for this feature sits below it — that form reports a uniform
    /// fake gap of 4e-8 to 9e-8 rad on states that agree to 1e-13.
    pub fn rotation_angle_to(&self, other: &Self) -> f64 {
        let relative = quat_mul(self.rotation, quat_conj(other.rotation));
        let residual = quat_residual(relative).abs();
        residual.min(std::f64::consts::TAU - residual)
    }
}

/// Which composition the walk uses.
///
/// Only [`Convention::Correct`] is ever used in production. The faults exist so
/// the convention tests can be shown to be **non-vacuous**: a test that passes
/// under a reversed composition is testing nothing, and three of these four
/// deviate by as little as 1.5e-2 on a shallow fan, which a loose assertion
/// waves through. `ParentAxis` is algebraically identical to `NegatedRho`
/// (`Rot(-d, rho) = Rot(d, -rho)` about the same line) and is kept because the
/// collapse is itself worth pinning.
#[cfg_attr(not(test), allow(dead_code))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Convention {
    Correct,
    NegatedRho,
    LeftCompose,
    ParentAxis,
}

/// How far the placement disagrees with itself.
///
/// Every field is a **residual**, never a verdict: the bar is applied once, in
/// [`crate::folding3d::admit`], so revising it stays a one-constant change.
#[derive(Debug, Clone, PartialEq)]
pub struct LoopGap {
    /// Worst rotation disagreement over the non-tree dual adjacencies, radians.
    pub rotation_radians: f64,
    /// Worst disagreement about where the shared crease's endpoints land, in
    /// paper units. This is the number the fixture corpus records.
    pub offset: f64,
    /// The crease line (an index into the input segments) carrying the worst
    /// disagreement.
    pub worst_edge: Option<usize>,
    /// How many non-tree dual adjacencies the maxima above are taken over —
    /// the first Betti number of the dual graph, and so the number of
    /// independent consistency conditions the placement satisfies.
    ///
    /// Reported because zero means the dual graph is a **tree**, and then the
    /// gap is an exact `0.0` that certifies nothing — the placement has no
    /// self-check at all on that model. A bare zero and a vacuous zero must not
    /// read alike.
    pub non_tree_edges: usize,
    /// Closed elementary per-vertex dual cycles — the face ring around one
    /// vertex, walked and composed.
    ///
    /// On a disk every dual cycle is a product of these, so this localises a
    /// gap to the vertex that causes it, which the tree-plus-one-edge measure
    /// cannot do: the error propagates outward and the largest whole-sheet
    /// number lands nowhere near its cause.
    pub vertex_cycles: usize,
    pub worst_vertex_cycle_radians: f64,
    /// The vertex carrying `worst_vertex_cycle_radians`.
    pub worst_vertex: Option<Point>,
}

/// Two faces meeting across one crease.
///
/// Carried rather than re-derived because every consumer needs it and every
/// re-derivation is a chance to disagree with the walk about what is adjacent to
/// what: the census pairs faces, the renderer draws the shared edge once, and
/// the dihedral round-trip has to reach the **non-tree** joins — the tree ones
/// are exact by construction and checking only those is a tautology.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FaceJoin {
    /// Index into the input segments.
    pub line: usize,
    pub faces: (usize, usize),
    /// Whether the spanning walk used this join to place the second face.
    pub in_tree: bool,
}

/// Faces placed in 3D, and how far the placement disagrees with itself.
///
/// # Single component, by construction
///
/// Every face has a transform derived along one spanning tree rooted at
/// [`Placement3d::starting_face`], and `parent` / `parent_line` are `Some` for
/// every face but that one. This is not an inference from the refusal above it:
/// [`FoldGraph::face_positions`] returns `Ok` only when its `remaining_faces`
/// loop reaches zero, and `line_ends` being private makes [`place_with`] the only
/// construction site in the workspace, so there is no path to a `Placement3d`
/// that some walk did not build. A disconnected fold graph refuses with
/// [`Fold3dRefusal::Disconnected`] before a `Placement3d` exists —
/// `the_refusing_fixtures_refuse_for_the_reason_they_were_chosen_for` is the test
/// that kills the two mutations which would break it.
///
/// What this buys downstream is one thing, and it is a placement-layer
/// guarantee rather than a census-layer premise: a second component would be
/// seeded at the identity, land coincident with the first, and manufacture
/// coplanar overlaps that describe nothing.
#[derive(Debug, Clone, PartialEq)]
pub struct Placement3d {
    /// The arrangement's vertices, in unfolded paper coordinates.
    pub points: Vec<Point>,
    /// Face rings into `points`, **counter-clockwise** in y-up paper
    /// coordinates — reversed once from [`FoldGraph`]'s clockwise rings.
    pub rings: Vec<Vec<usize>>,
    pub face_transforms: Vec<Rigid>,
    /// Per face, its own image of its own ring.
    ///
    /// Deliberately **not** a shared point array. `FoldGraph::folded_points`
    /// sums the per-face images of each vertex and divides; in 2D a mirror maps
    /// the plane to itself, so the residual stays in-plane and is re-absorbed,
    /// but in 3D that same residual becomes out-of-plane displacement and the
    /// averaging is exactly the operation that destroys the evidence. There must
    /// be nowhere to average.
    pub face_points: Vec<Vec<Vec3>>,
    /// Unit normal per face, the image of `+z` under that face's transform. For
    /// a counter-clockwise ring in y-up paper coordinates that is the side the
    /// paper's front faces.
    pub face_normals: Vec<Vec3>,
    /// Index of the face the walk started from; its transform is the identity.
    pub starting_face: usize,
    /// Spanning-tree parent of each face, `None` for the root.
    pub parent: Vec<Option<usize>>,
    /// The crease each face folds across to reach its parent, as an index into
    /// the input segments.
    pub parent_line: Vec<Option<usize>>,
    /// Longer side of the unfolded bounding box. Every relative tolerance is
    /// relative to this.
    pub span: f64,
    /// Every pair of faces that meet across a crease, in edge order.
    pub joins: Vec<FaceJoin>,
    pub loop_gap: LoopGap,
    /// Endpoints of each input segment as vertex indices into `points`.
    ///
    /// Private, which also makes the struct unconstructable outside this module
    /// — a `Placement3d` a caller assembled by hand would be a placement nothing
    /// had walked.
    line_ends: Vec<(usize, usize)>,
    /// The signed crease angle the walk actually rotated by, per input segment,
    /// in **degrees** as [`crease_fold_angle`] reports them.
    ///
    /// Private and read through the two accessors below, because the point of
    /// carrying it is that it is **this** document's angle. The admission gate
    /// snaps every near-flat crease to an exact full fold in its own copy of the
    /// segments, so a consumer that re-read `crease_fold_angle` off the caller's
    /// segments would classify a different document than the one that was placed
    /// — and would do so on precisely the creases the snap exists for.
    ///
    /// Degrees rather than radians because `is_full_fold` has to be an **exact**
    /// test and `180.0_f64.to_radians()` is not bit-identical to
    /// [`std::f64::consts::PI`]. `crease_fold_angle` returns exactly `±180.0` for
    /// a classic crease and for `FoldMagnitude::FULL`, so the degree comparison
    /// is exact and needs no second tolerance window beside the gate's snap.
    fold_angle_degrees: Vec<Option<f64>>,
    /// One face bordering each segment, or `None` for a segment no traced face
    /// borders. Filled from `joins` so it can never name a face the walk does not
    /// agree carries the crease.
    line_face: Vec<Option<usize>>,
}

impl Placement3d {
    /// The signed fold angle the walk rotated `line` by, in radians, or `None`
    /// for a segment that carries no crease.
    ///
    /// `line` is an index into the input segments, which is what
    /// [`FaceJoin::line`] and [`Placement3d::parent_line`] carry.
    pub fn fold_angle_radians(&self, line: usize) -> Option<f64> {
        self.fold_angle_degrees
            .get(line)
            .copied()
            .flatten()
            .map(f64::to_radians)
    }

    /// Whether `line` is a crease at an exact half-turn, in the document the
    /// walk placed.
    ///
    /// The two faces of such a crease are coplanar by construction, which is what
    /// [`crate::folding3d::planes`] seeds its topological classes from and what
    /// makes `census >= full folds` a theorem.
    pub fn is_full_fold(&self, line: usize) -> bool {
        self.fold_angle_degrees
            .get(line)
            .copied()
            .flatten()
            .is_some_and(|degrees| degrees.abs() == 180.0)
    }

    /// How many input segments are creases at an exact half-turn.
    pub fn full_fold_creases(&self) -> usize {
        (0..self.fold_angle_degrees.len())
            .filter(|&line| self.is_full_fold(line))
            .count()
    }

    /// How many input segments the walk was given.
    ///
    /// The domain of every `line` index this type takes or returns.
    pub fn segment_count(&self) -> usize {
        self.fold_angle_degrees.len()
    }

    /// A segment's endpoints as **arrangement vertex indices**, into
    /// [`Placement3d::points`].
    ///
    /// The key a consumer needs to match an input segment against a face's ring
    /// edge, which is how the render model finds the fold angle for the edge it
    /// is about to stroke. [`Placement3d::folded_line_ends`] answers the same
    /// question in world coordinates; this one answers it in the arrangement's
    /// own numbering, and neither is derivable from the other without a
    /// tolerance.
    pub fn line_vertex_ends(&self, line: usize) -> Option<(usize, usize)> {
        self.line_ends.get(line).copied()
    }

    /// Where a crease's two endpoints land, in world coordinates.
    ///
    /// `None` for a segment no traced face borders — it has no placed image at
    /// all. Every face carrying the crease agrees about the answer, because the
    /// rotation about the crease fixes it, so the face is chosen here rather than
    /// by the caller: a caller-supplied face is a way for two consumers to get
    /// two different lines for one crease.
    pub fn folded_line_ends(&self, line: usize) -> Option<(Vec3, Vec3)> {
        let (begin, end) = self.line_ends.get(line).copied()?;
        let face = (*self.line_face.get(line)?)?;
        let transform = self.face_transforms.get(face)?;
        Some((
            transform.apply(point3(*self.points.get(begin)?)),
            transform.apply(point3(*self.points.get(end)?)),
        ))
    }

    /// The dihedral angle across a crease, measured from the two placed faces.
    ///
    /// `atan2` cannot tell `+180` from `-180`, which is itself the precise
    /// statement of why a document of half-turns validates no convention: the
    /// round-trip is blind on exactly the creases Oriedita can represent.
    pub fn measured_dihedral(&self, parent: usize, child: usize, line: usize) -> Option<f64> {
        let (a, b) = self.directed_ring_edge(child, line)?;
        let axis = unit(sub(point3(self.points[b]), point3(self.points[a])));
        let axis = self.face_transforms[child].apply_direction(axis);
        let (np, nc) = (self.face_normals[parent], self.face_normals[child]);
        Some(dot(cross(np, nc), axis).atan2(dot(np, nc)))
    }

    /// The shared crease in world coordinates, directed the way `face`'s own
    /// ring traverses it.
    ///
    /// The direction is what makes "which side of the crease is this face on"
    /// answerable without a containment test: for a counter-clockwise ring with
    /// normal `n`, the face's interior is to the left of the directed edge, so
    /// `cross(n, direction)` points into the face. That is the half-plane the
    /// ordering solver reads as the face's slot around the folded line.
    pub(crate) fn directed_crease(&self, face: usize, line: usize) -> Option<(Vec3, Vec3)> {
        let (a, b) = self.directed_ring_edge(face, line)?;
        let transform = self.face_transforms.get(face)?;
        Some((
            transform.apply(point3(*self.points.get(a)?)),
            transform.apply(point3(*self.points.get(b)?)),
        ))
    }

    /// The shared crease as the given face's own ring traverses it.
    fn directed_ring_edge(&self, face: usize, line: usize) -> Option<(usize, usize)> {
        let ring = self.rings.get(face)?;
        let (begin, end) = self.line_endpoints(line)?;
        for index in 0..ring.len() {
            let a = ring[index];
            let b = ring[(index + 1) % ring.len()];
            if (a == begin && b == end) || (a == end && b == begin) {
                return Some((a, b));
            }
        }
        None
    }

    fn line_endpoints(&self, line: usize) -> Option<(usize, usize)> {
        self.line_ends.get(line).copied()
    }
}

/// Place every face of `graph` in 3D, walking the shipped spanning tree.
///
/// `starting_face_id` is Oriedita's 1-based id, resolved by
/// [`FoldGraph::face_positions`] exactly as the flat path resolves it.
pub(crate) fn place_faces(
    graph: &FoldGraph,
    starting_face_id: i32,
) -> Result<Placement3d, Fold3dPlacementError> {
    place_with(graph, starting_face_id, Convention::Correct)
}

/// Place the faces of a segment set, applying **no** admission gate.
///
/// The result carries raw residuals and no verdict; [`crate::folding3d::admit`]
/// is what decides whether they are small enough to draw.
pub fn place_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
) -> Result<Placement3d, Fold3dPlacementError> {
    let graph = FoldGraph::from_segments(segments, true);
    place_faces(&graph, starting_face_id)
}

pub(crate) fn place_with(
    graph: &FoldGraph,
    starting_face_id: i32,
    convention: Convention,
) -> Result<Placement3d, Fold3dPlacementError> {
    if graph.faces.is_empty() {
        return Err(if graph.include_faces {
            Fold3dRefusal::NoFaces
        } else {
            Fold3dRefusal::FacesUnresolved
        }
        .into());
    }

    // R20: every traced ring is clockwise, so one global reversal puts them all
    // into the convention the walk and the vertex link were validated against.
    let rings: Vec<Vec<usize>> = graph
        .faces
        .iter()
        .map(|face| face.iter().rev().copied().collect())
        .collect();
    let line_ends: Vec<(usize, usize)> = graph
        .lines
        .iter()
        .map(|line| (line.begin, line.end))
        .collect();

    let positions = graph
        .face_positions(starting_face_id)
        .map_err(|error| match error {
            FoldGraphError::DisconnectedFaces { reached, unreached } => {
                Fold3dPlacementError::Refused(Fold3dRefusal::Disconnected { reached, unreached })
            }
            // The whole reason `Fold3dPlacementError` exists: a cancel must not
            // become `Disconnected`, which would tell the user their pattern is
            // in pieces and offer to simulate it.
            FoldGraphError::Cancelled => Fold3dPlacementError::Cancelled,
        })?;

    let mut transforms = vec![Rigid::IDENTITY; rings.len()];
    // `face_position` is BFS depth + 1, so ascending depth is a valid parent
    // order: every parent is strictly shallower than its child, and
    // `face_positions` has already refused a face it could not reach.
    let mut order: Vec<usize> = (0..rings.len()).collect();
    order.sort_by_key(|&face| positions.face_position[face]);

    for face in order {
        if face == positions.starting_face {
            continue;
        }
        let (Some(parent), Some(line)) =
            (positions.next_face[face], positions.associated_line[face])
        else {
            // Unreachable: `face_positions` fills both or refuses. Refusing
            // rather than placing the face unmoved keeps that an invariant
            // instead of a silent unfolded slab.
            //
            // The counts are the real ones rather than `(len - 1, 1)`. If this
            // guard ever goes live it is because `face_positions` was weakened,
            // and the refusal it produces is read for its numbers by everything
            // downstream — a plausible fabricated split is worse than none.
            let unreached = (0..rings.len())
                .filter(|&other| {
                    other != positions.starting_face
                        && (positions.next_face[other].is_none()
                            || positions.associated_line[other].is_none())
                })
                .count();
            return Err(Fold3dRefusal::Disconnected {
                reached: rings.len().saturating_sub(unreached),
                unreached,
            }
            .into());
        };
        let step = crease_step(graph, &rings, &line_ends, face, parent, line, convention)?;
        transforms[face] = match convention {
            Convention::LeftCompose => step.compose(&transforms[parent]),
            _ => transforms[parent].compose(&step),
        };
    }

    let face_points: Vec<Vec<Vec3>> = rings
        .iter()
        .zip(&transforms)
        .map(|(ring, transform)| {
            ring.iter()
                .map(|&p| transform.apply(point3(graph.points[p])))
                .collect()
        })
        .collect();
    let face_normals: Vec<Vec3> = transforms
        .iter()
        .map(|transform| transform.apply_direction([0.0, 0.0, 1.0]))
        .collect();

    // Read off the graph's own segments, which on the admission path are the
    // gate's snapped copy — the document that was actually placed. `segments`
    // and `lines` are built in one loop in `from_segments`, so the index a
    // `FaceJoin` carries addresses both.
    let fold_angle_degrees: Vec<Option<f64>> =
        graph.segments.iter().map(crease_fold_angle).collect();

    let mut placement = Placement3d {
        points: graph.points.clone(),
        rings,
        face_transforms: transforms,
        face_points,
        face_normals,
        starting_face: positions.starting_face,
        parent: positions.next_face.clone(),
        parent_line: positions.associated_line.clone(),
        span: paper_span(&graph.points),
        joins: Vec::new(),
        loop_gap: LoopGap::EMPTY,
        line_ends,
        fold_angle_degrees,
        line_face: Vec::new(),
    };
    placement.joins = face_joins(graph, &placement, &positions);
    let mut line_face = vec![None; placement.fold_angle_degrees.len()];
    for join in &placement.joins {
        if let Some(slot) = line_face.get_mut(join.line) {
            slot.get_or_insert(join.faces.0);
        }
    }
    placement.line_face = line_face;
    placement.loop_gap = measure_loop_gap(graph, &placement, convention)?;
    Ok(placement)
}

/// The rotation that carries `child` off `parent` across `line`.
fn crease_step(
    graph: &FoldGraph,
    rings: &[Vec<usize>],
    line_ends: &[(usize, usize)],
    child: usize,
    parent: usize,
    line: usize,
    convention: Convention,
) -> Result<Rigid, Fold3dPlacementError> {
    let segment = graph.segments.get(line).ok_or(Fold3dPlacementError::from(
        Fold3dRefusal::NonCreaseJoin { line },
    ))?;
    let rho = crease_fold_angle(segment)
        .ok_or(Fold3dPlacementError::from(Fold3dRefusal::NonCreaseJoin {
            line,
        }))?
        .to_radians();
    // The axis is directed the way the *child's* own winding traverses the
    // edge. Taking it from the parent instead is `Rot(-d, rho) = Rot(d, -rho)`,
    // which is the negated-rho fault under another name.
    let owner = match convention {
        Convention::ParentAxis => parent,
        _ => child,
    };
    let (a, b) = directed_edge(&rings[owner], line_ends[line]).ok_or(
        Fold3dPlacementError::from(Fold3dRefusal::NonCreaseJoin { line }),
    )?;
    let (pa, pb) = (point3(graph.points[a]), point3(graph.points[b]));
    let direction = sub(pb, pa);
    if norm(direction) == 0.0 {
        return Err(Fold3dRefusal::NonCreaseJoin { line }.into());
    }
    let rho = match convention {
        Convention::NegatedRho => -rho,
        _ => rho,
    };
    Ok(Rigid::about_line(pa, unit(direction), rho))
}

/// The shared edge as `ring` traverses it, or `None` when this ring does not
/// carry it.
fn directed_edge(ring: &[usize], (begin, end): (usize, usize)) -> Option<(usize, usize)> {
    for index in 0..ring.len() {
        let a = ring[index];
        let b = ring[(index + 1) % ring.len()];
        if (a == begin && b == end) || (a == end && b == begin) {
            return Some((a, b));
        }
    }
    None
}

impl LoopGap {
    const EMPTY: Self = Self {
        rotation_radians: 0.0,
        offset: 0.0,
        worst_edge: None,
        non_tree_edges: 0,
        vertex_cycles: 0,
        worst_vertex_cycle_radians: 0.0,
        worst_vertex: None,
    };
}

/// The faces on each edge of the arrangement, keyed by the undirected vertex
/// pair, with the segment index that carries it.
type DualEdges = BTreeMap<(usize, usize), (usize, Vec<usize>)>;

fn dual_edges(graph: &FoldGraph, rings: &[Vec<usize>]) -> DualEdges {
    let mut line_of: BTreeMap<(usize, usize), usize> = BTreeMap::new();
    for (index, line) in graph.lines.iter().enumerate() {
        line_of
            .entry((line.begin.min(line.end), line.begin.max(line.end)))
            .or_insert(index);
    }
    let mut edges: DualEdges = BTreeMap::new();
    for (face, ring) in rings.iter().enumerate() {
        for index in 0..ring.len() {
            let a = ring[index];
            let b = ring[(index + 1) % ring.len()];
            let key = (a.min(b), a.max(b));
            let Some(&line) = line_of.get(&key) else {
                continue;
            };
            edges.entry(key).or_insert((line, Vec::new())).1.push(face);
        }
    }
    edges
}

/// Every pair of faces that meet across a crease.
///
/// Tree membership is keyed on the **edge**, not on the face pair. Two faces can
/// meet along two separate segments — which is exactly what a crease drawn as
/// two collinear pieces produces — and keying on the pair would drop the second
/// meeting silently, along with the consistency condition it carries.
fn face_joins(
    graph: &FoldGraph,
    placement: &Placement3d,
    positions: &crate::fold_graph::FacePositions,
) -> Vec<FaceJoin> {
    let mut tree: std::collections::BTreeSet<(usize, usize)> = Default::default();
    for line in positions.associated_line.iter().flatten() {
        if let Some(&(begin, end)) = placement.line_ends.get(*line) {
            tree.insert((begin.min(end), begin.max(end)));
        }
    }

    let mut joins = Vec::new();
    for (&key, (line, faces)) in &dual_edges(graph, &placement.rings) {
        for i in 0..faces.len() {
            for j in (i + 1)..faces.len() {
                let (f, g) = (faces[i], faces[j]);
                // A ring that traverses one edge twice meets only itself there,
                // and a face cannot disagree with its own placement.
                if f == g {
                    continue;
                }
                joins.push(FaceJoin {
                    line: *line,
                    faces: (f, g),
                    in_tree: tree.contains(&key),
                });
            }
        }
    }
    joins
}

/// Every residual the placement can be held to, measured once.
///
/// Fails rather than swallowing a non-crease join. Two faces meeting across a
/// segment with no fold angle is the same defect whether the spanning tree
/// happened to use that edge or not, and reporting a `0.0` rotation for it
/// would be the silent-wrong-answer shape this whole feature exists to avoid.
fn measure_loop_gap(
    graph: &FoldGraph,
    placement: &Placement3d,
    convention: Convention,
) -> Result<LoopGap, Fold3dPlacementError> {
    let mut gap = LoopGap::EMPTY;
    for join in &placement.joins {
        if join.in_tree {
            continue;
        }
        let (f, g) = join.faces;
        gap.non_tree_edges += 1;
        // Both faces carry the crease, and a rotation about it fixes it, so how
        // far apart the two put its endpoints *is* the disagreement — no step
        // needs building for this half.
        let (begin, end) = placement.line_ends[join.line];
        let mut offset: f64 = 0.0;
        for vertex in [begin, end] {
            let p = point3(placement.points[vertex]);
            offset = offset.max(norm(sub(
                placement.face_transforms[f].apply(p),
                placement.face_transforms[g].apply(p),
            )));
        }
        let step = crease_step(
            graph,
            &placement.rings,
            &placement.line_ends,
            g,
            f,
            join.line,
            convention,
        )?;
        let predicted = match convention {
            Convention::LeftCompose => step.compose(&placement.face_transforms[f]),
            _ => placement.face_transforms[f].compose(&step),
        };
        let rotation = predicted.rotation_angle_to(&placement.face_transforms[g]);
        if offset > gap.offset || gap.worst_edge.is_none() {
            gap.worst_edge = Some(join.line);
        }
        gap.offset = gap.offset.max(offset);
        gap.rotation_radians = gap.rotation_radians.max(rotation);
    }

    let edges = dual_edges(graph, &placement.rings);
    for cycle in vertex_cycles(graph, placement, &edges, convention)? {
        gap.vertex_cycles += 1;
        if cycle.residual_radians > gap.worst_vertex_cycle_radians || gap.worst_vertex.is_none() {
            gap.worst_vertex = Some(placement.points[cycle.vertex]);
        }
        gap.worst_vertex_cycle_radians = gap.worst_vertex_cycle_radians.max(cycle.residual_radians);
    }
    Ok(gap)
}

struct VertexCycle {
    vertex: usize,
    residual_radians: f64,
}

/// Walk the face ring around each vertex and compose the crease rotations.
///
/// Only rings that close are reported: at a vertex on the paper rim there is no
/// loop to walk, and no closure condition either.
fn vertex_cycles(
    graph: &FoldGraph,
    placement: &Placement3d,
    edges: &DualEdges,
    convention: Convention,
) -> Result<Vec<VertexCycle>, Fold3dPlacementError> {
    let mut faces_at: Vec<Vec<usize>> = vec![Vec::new(); graph.points.len()];
    for (face, ring) in placement.rings.iter().enumerate() {
        for &vertex in ring {
            faces_at[vertex].push(face);
        }
    }

    let mut out = Vec::new();
    for (vertex, faces) in faces_at.iter().enumerate() {
        if faces.len() < 3 {
            continue;
        }
        let start = faces[0];
        let mut current = start;
        let mut previous: Option<(usize, usize)> = None;
        let mut transform = Rigid::IDENTITY;
        let mut steps = 0usize;
        let closed = loop {
            let ring = &placement.rings[current];
            let Some(next) = (0..ring.len())
                .filter_map(|index| {
                    let (a, b) = (ring[index], ring[(index + 1) % ring.len()]);
                    (a == vertex || b == vertex).then_some((a.min(b), a.max(b)))
                })
                .find(|key| Some(*key) != previous)
            else {
                break false;
            };
            let Some((line, on_edge)) = edges.get(&next) else {
                break false;
            };
            let Some(&other) = on_edge.iter().find(|&&face| face != current) else {
                break false; // A boundary edge: the vertex sits on the paper rim.
            };
            let step = crease_step(
                graph,
                &placement.rings,
                &placement.line_ends,
                other,
                current,
                *line,
                convention,
            )?;
            transform = match convention {
                Convention::LeftCompose => step.compose(&transform),
                _ => transform.compose(&step),
            };
            steps += 1;
            previous = Some(next);
            current = other;
            if current == start {
                break true;
            }
            if steps > faces.len() + 2 {
                break false;
            }
        };
        if closed {
            out.push(VertexCycle {
                vertex,
                residual_radians: transform.rotation_angle_to(&Rigid::IDENTITY),
            });
        }
    }
    Ok(out)
}

pub(crate) fn point3(p: Point) -> Vec3 {
    [p.x, p.y, 0.0]
}

pub(crate) fn sub(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

pub(crate) fn unit(a: Vec3) -> Vec3 {
    let n = norm(a);
    if n == 0.0 {
        a
    } else {
        [a[0] / n, a[1] / n, a[2] / n]
    }
}

pub(crate) fn paper_span(points: &[Point]) -> f64 {
    let (mut lo_x, mut hi_x) = (f64::INFINITY, f64::NEG_INFINITY);
    let (mut lo_y, mut hi_y) = (f64::INFINITY, f64::NEG_INFINITY);
    for point in points {
        lo_x = lo_x.min(point.x);
        hi_x = hi_x.max(point.x);
        lo_y = lo_y.min(point.y);
        hi_y = hi_y.max(point.y);
    }
    ((hi_x - lo_x).max(hi_y - lo_y)).max(f64::MIN_POSITIVE)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checks_spatial::{dispatched_camv, vertex_fan_at, vertex_link_polygon};
    use crate::geometry::{FoldMagnitude, LineColor, Polygon, PolygonIntersection};
    use crate::io::fold::import_fold_document;
    use crate::model::CreasePatternModel;
    use std::path::{Path, PathBuf};

    fn border(a: Point, b: Point) -> LineSegment {
        LineSegment::with_color(a, b, LineColor::Black0)
    }

    /// Signed degrees: valley positive, mountain negative, per the FOLD
    /// convention `crease_fold_angle` reads.
    fn crease(a: Point, b: Point, degrees: f64) -> LineSegment {
        let color = if degrees < 0.0 {
            LineColor::Red1
        } else {
            LineColor::Blue2
        };
        let mut segment = LineSegment::with_color(a, b, color);
        segment.fold_magnitude = FoldMagnitude::from_degrees(degrees.abs());
        segment
    }

    /// Standard shoelace, positive for a counter-clockwise ring in y-up.
    fn shoelace(points: &[Point], ring: &[usize]) -> f64 {
        let mut sum = 0.0;
        for index in 0..ring.len() {
            let a = points[ring[index]];
            let b = points[ring[(index + 1) % ring.len()]];
            sum += a.x * b.y - b.x * a.y;
        }
        sum / 2.0
    }

    fn model_at(path: &Path) -> CreasePatternModel {
        let raw = std::fs::read_to_string(path)
            .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
        let document: treemaker_fold::FoldDocument = serde_json::from_str(&raw)
            .unwrap_or_else(|error| panic!("parse {}: {error}", path.display()));
        import_fold_document(&document)
            .unwrap_or_else(|error| panic!("import {}: {error:?}", path.display()))
    }

    fn repo(relative: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join(relative)
    }

    /// R20, both halves. A missed reversal renders every model mirrored and
    /// nothing else in the pipeline notices, so the winding is asserted at its
    /// source and again after the walk.
    #[test]
    fn foldgraph_rings_are_clockwise_and_the_walk_reverses_them_once() {
        let square = [
            Point::new(0.0, 0.0),
            Point::new(1.0, 0.0),
            Point::new(1.0, 1.0),
            Point::new(0.0, 1.0),
        ];
        let mut segments: Vec<LineSegment> = (0..4)
            .map(|k| border(square[k], square[(k + 1) % 4]))
            .collect();
        segments.push(crease(square[0], square[2], 90.0));

        let graph = FoldGraph::from_segments(&segments, true);
        assert_eq!(
            graph.faces.len(),
            2,
            "one diagonal splits the square in two"
        );
        for face in &graph.faces {
            assert!(
                shoelace(&graph.points, face) < 0.0,
                "FoldGraph traced a face wound counter-clockwise: {face:?}"
            );
        }

        let placement = place_faces(&graph, 1).expect("placed");
        for ring in &placement.rings {
            assert!(
                shoelace(&placement.points, ring) > 0.0,
                "the walk left a ring wound clockwise: {ring:?}"
            );
        }
        // The root is unmoved, so a counter-clockwise ring in y-up faces +z.
        let root = placement.face_normals[placement.starting_face];
        assert!(
            (root[2] - 1.0).abs() < 1e-12,
            "root normal {root:?} is not +z"
        );
    }

    /// A fan of creases from the origin out to a rim.
    fn interior_fan(thetas: &[f64], rhos: &[f64]) -> Vec<LineSegment> {
        const RADIUS: f64 = 100.0;
        let tip = |theta: f64| Point::new(RADIUS * theta.cos(), RADIUS * theta.sin());
        let mut segments = Vec::new();
        for (&theta, &rho) in thetas.iter().zip(rhos) {
            segments.push(crease(Point::new(0.0, 0.0), tip(theta), rho));
        }
        for index in 0..thetas.len() {
            segments.push(border(
                tip(thetas[index]),
                tip(thetas[(index + 1) % thetas.len()]),
            ));
        }
        segments
    }

    /// Every crease's folded direction, in the frame `vertex_link_polygon`
    /// works in — the sector *before* the first crease in angular order.
    fn placed_link(placement: &Placement3d, thetas: &[f64]) -> Vec<Vec3> {
        let vertex = placement
            .points
            .iter()
            .position(|p| p.x.hypot(p.y) < 1e-9)
            .expect("the fan vertex is in the arrangement");

        let mut sorted: Vec<f64> = thetas.iter().map(|t| t.sin().atan2(t.cos())).collect();
        sorted.sort_by(|a, b| a.partial_cmp(b).expect("finite"));
        let last = *sorted.last().expect("non-empty");
        let mut sweep = sorted[0] - last;
        if sweep <= 0.0 {
            sweep += std::f64::consts::TAU;
        }
        let middle = last + sweep / 2.0;
        let probe = Point::new(middle.cos(), middle.sin());
        let anchor_face = (0..placement.rings.len())
            .find(|&face| {
                let polygon = Polygon::new(
                    placement.rings[face]
                        .iter()
                        .map(|&p| placement.points[p])
                        .collect(),
                );
                polygon.inside(probe) == PolygonIntersection::Inside
            })
            .expect("the sector before the first crease is a traced face");
        let anchor = placement.face_transforms[anchor_face].inverse();

        sorted
            .iter()
            .map(|&theta| {
                let tip = placement
                    .points
                    .iter()
                    .position(|p| p.x.hypot(p.y) > 1e-9 && (p.y.atan2(p.x) - theta).abs() < 1e-9)
                    .expect("crease tip");
                // Any face carrying the crease agrees about where the crease
                // itself lands, because the rotation about it fixes it.
                let face = (0..placement.rings.len())
                    .find(|&face| directed_edge(&placement.rings[face], (vertex, tip)).is_some())
                    .expect("a face carries the crease");
                let direction = unit(sub(
                    point3(placement.points[tip]),
                    point3(placement.points[vertex]),
                ));
                anchor.apply_direction(placement.face_transforms[face].apply_direction(direction))
            })
            .collect()
    }

    fn worst_link_deviation(convention: Convention, thetas: &[f64], rhos: &[f64]) -> f64 {
        let segments = interior_fan(thetas, rhos);
        let model = CreasePatternModel {
            line_segments: segments.clone(),
            ..CreasePatternModel::default()
        };
        let fan = vertex_fan_at(&model, Point::new(0.0, 0.0));
        assert_eq!(fan.degree(), thetas.len(), "the fan lost a crease");
        let expected = vertex_link_polygon(&fan);

        let graph = FoldGraph::from_segments(&segments, true);
        let placement = place_with(&graph, 1, convention).expect("placed");
        placed_link(&placement, thetas)
            .iter()
            .zip(&expected)
            .map(|(got, want)| norm(sub(*got, *want)))
            .fold(0.0_f64, f64::max)
    }

    const FANS: [(&[f64], &[f64]); 3] = [
        (
            &[0.0, 1.1, 2.46, 3.63, 5.15],
            &[63.0, -112.0, 38.0, -155.0, 84.0],
        ),
        (
            &[0.2, 0.9, 1.9, 2.9, 4.0, 5.3],
            &[-17.0, 141.0, -73.0, 29.0, -166.0, 95.0],
        ),
        // Shallow angles: the row that sets the tolerance.
        (&[0.0, 2.0, 4.0], &[5.0, -11.0, 3.0]),
    ];

    /// The placement and the shipped spherical-simplicity check must share one
    /// frame, or the gate certifies states the renderer draws mirrored.
    ///
    /// Asymmetric fans only, and never 90 degrees: at (90, 90) a sign fault
    /// leaves the obvious probe vertex fixed to 6.7e-16 while moving the rest of
    /// the face by 1.414, and on a symmetric fan the composition orders agree to
    /// 1e-14 with the error hiding completely.
    #[test]
    fn placement_reproduces_the_shipped_vertex_link() {
        for (thetas, rhos) in FANS {
            let deviation = worst_link_deviation(Convention::Correct, thetas, rhos);
            assert!(
                deviation < 1e-12,
                "placement disagrees with vertex_link_polygon by {deviation} on {thetas:?}"
            );
        }
    }

    /// The test above is only worth having if it can fail.
    #[test]
    fn the_vertex_link_comparison_is_not_vacuous() {
        for (thetas, rhos) in FANS {
            for fault in [Convention::NegatedRho, Convention::ParentAxis] {
                let deviation = worst_link_deviation(fault, thetas, rhos);
                assert!(
                    deviation > 1e-2,
                    "{fault:?} deviates by only {deviation} on {thetas:?}"
                );
            }
        }
    }

    /// **A fan cannot test composition order**, and this is the test that says
    /// so rather than leaving it to be rediscovered.
    ///
    /// The dual graph of a degree-3 fan is a triangle, so the shipped BFS
    /// reaches every face in exactly one step from any root and `M_parent ∘ step`
    /// and `step ∘ M_parent` are both `I ∘ step`. The order fault is invisible
    /// there and has to be caught on a chain — see
    /// `the_three_face_chain_comparison_is_not_vacuous`.
    #[test]
    fn a_shallow_fan_cannot_see_a_reversed_composition() {
        let (thetas, rhos) = FANS[2];
        let deviation = worst_link_deviation(Convention::LeftCompose, thetas, rhos);
        assert!(
            deviation < 1e-12,
            "expected the fan to be blind to composition order; it saw {deviation}"
        );
    }

    /// `Rot(-d, rho) = Rot(d, -rho)` about the same line, so taking the axis
    /// from the parent is the negated-angle fault under another name. Worth
    /// pinning: it means the four plausible faults are really two.
    #[test]
    fn the_parent_axis_fault_is_the_negated_angle_fault() {
        for (thetas, rhos) in FANS {
            let negated = worst_link_deviation(Convention::NegatedRho, thetas, rhos);
            let parent = worst_link_deviation(Convention::ParentAxis, thetas, rhos);
            assert!(
                (negated - parent).abs() < 1e-12,
                "expected the two faults to collapse: {negated} vs {parent}"
            );
        }
    }

    /// F0 (0,0)/(1,0)/(0,1), F1 (0,1)/(1,0)/(1,1), F2 (1,1)/(1,0)/(2,0), both
    /// creases at the same angle.
    fn three_face_chain(degrees: f64) -> Vec<LineSegment> {
        let p = Point::new;
        vec![
            border(p(0.0, 0.0), p(1.0, 0.0)),
            border(p(0.0, 0.0), p(0.0, 1.0)),
            border(p(0.0, 1.0), p(1.0, 1.0)),
            border(p(1.0, 1.0), p(2.0, 0.0)),
            border(p(2.0, 0.0), p(1.0, 0.0)),
            crease(p(1.0, 0.0), p(0.0, 1.0), degrees),
            crease(p(1.0, 0.0), p(1.0, 1.0), degrees),
        ]
    }

    /// Every placed vertex of both moved faces, anchored on the unmoved one.
    fn chain_images(convention: Convention, degrees: f64) -> Vec<(Point, Vec3)> {
        let segments = three_face_chain(degrees);
        let graph = FoldGraph::from_segments(&segments, true);
        let placement = place_with(&graph, 1, convention).expect("placed");
        assert_eq!(placement.rings.len(), 3);

        let index = |x: f64, y: f64| {
            placement
                .points
                .iter()
                .position(|q| (q.x - x).abs() < 1e-12 && (q.y - y).abs() < 1e-12)
                .expect("point")
        };
        let root = (0..3)
            .find(|&face| placement.rings[face].contains(&index(0.0, 0.0)))
            .expect("the face at the origin");
        let anchor = placement.face_transforms[root].inverse();

        let mut out = Vec::new();
        for face in 0..3 {
            if face == root {
                continue;
            }
            for (slot, &point) in placement.rings[face].iter().enumerate() {
                out.push((
                    placement.points[point],
                    anchor.apply(placement.face_points[face][slot]),
                ));
            }
        }
        out
    }

    /// Coordinates worked out independently, with Rodrigues matrices rather than
    /// quaternions.
    ///
    /// Never two faces and never 90 degrees: one crease makes every composition
    /// scheme agree, and at 90 a symmetric pair's free vertex is fixed under a
    /// sign fault. The whole face is compared, every vertex — at (90, 90) a sign
    /// fault leaves the obvious free vertex fixed to 6.7e-16 while moving the
    /// rest of the face by 1.414.
    #[test]
    fn the_three_face_chain_lands_where_it_was_computed_to() {
        let want = |paper: Point, degrees: f64| -> Vec3 {
            let hinge = if degrees < 90.0 { 0.75 } else { 0.25 };
            match (paper.x, paper.y) {
                (x, y) if x == 0.0 && y == 1.0 => [0.0, 1.0, 0.0],
                (x, y) if x == 1.0 && y == 0.0 => [1.0, 0.0, 0.0],
                (x, y) if x == 1.0 && y == 1.0 => [hinge, hinge, 0.612372436],
                _ if degrees < 90.0 => [0.844669914, -0.655330086, 0.739198920],
                _ => [0.344669914, -0.155330086, -0.739198920],
            }
        };
        for degrees in [60.0, 120.0] {
            for (paper, got) in chain_images(Convention::Correct, degrees) {
                let deviation = norm(sub(got, want(paper, degrees)));
                assert!(
                    deviation < 1e-9,
                    "{degrees} deg: paper ({}, {}) landed at {got:?}, off by {deviation}",
                    paper.x,
                    paper.y
                );
            }
        }
    }

    /// The chain is where the composition order is visible, so every fault has
    /// to move it — including the one the fan is blind to.
    #[test]
    fn the_three_face_chain_comparison_is_not_vacuous() {
        let correct = chain_images(Convention::Correct, 60.0);
        for fault in [
            Convention::NegatedRho,
            Convention::LeftCompose,
            Convention::ParentAxis,
        ] {
            let deviation = chain_images(fault, 60.0)
                .iter()
                .zip(&correct)
                .map(|((_, got), (_, want))| norm(sub(*got, *want)))
                .fold(0.0_f64, f64::max);
            assert!(
                deviation > 1e-2,
                "{fault:?} moves the chain by only {deviation}"
            );
        }
    }

    /// R22, and the strongest cross-check the placement has.
    ///
    /// A half-turn about an in-sheet axis, restricted to the sheet plane, *is*
    /// Oriedita's 2D reflection — so on an all-classic document the walk must
    /// reproduce `fold_movement` face by face, exactly, with no admissibility
    /// precondition at all.
    ///
    /// It has to be `fold_movement` and not `folded_points`. The latter averages
    /// each vertex over the faces containing it, and on a document whose
    /// placement is not path-independent that average equals no single face's
    /// image. Comparing against it reports a deviation of the same order as the
    /// loop gap — 113.8 against a gap of 178 on `clean-smoke`, 0.102 against
    /// 0.073 on `iguana-split-crease`, 282.8 against 400 on `box_90_unangled` —
    /// which is a fact about those documents and says nothing about the walk.
    /// Two of those three are rows below. The third, `clean-smoke`, cannot be:
    /// it carries six **unassigned** creases, and the flat folder mirrors across
    /// an unassigned segment as readily as across a mountain —
    /// `find_adjacent_line` applies no colour filter. The 3D walk refuses that
    /// join instead, which is asserted by
    /// `an_unassigned_join_is_refused_rather_than_mirrored`.
    #[test]
    fn the_walk_reproduces_the_flat_folder_face_by_face() {
        for name in [
            "tests/fixtures/flat-folder/kabuto.fold",
            "tests/fixtures/folding-sequence/fold/treemaker-triad-base.fold",
            "tests/fixtures/folding-sequence/fold/squash-local.fold",
            "crates/oristudio-cp/resources/default-molecules/bird_base.fold",
            "crates/oristudio-cp/resources/default-molecules/frog_base.fold",
            "tests/fixtures/fold-angle-3d/box_90_unangled.fold",
            "packages/origami-simulator/tests/fixtures/iguana-split-crease.fold",
        ] {
            let model = model_at(&repo(name));
            assert!(
                model
                    .line_segments
                    .iter()
                    .all(crate::model::is_classic_crease),
                "{name} is not an all-classic document"
            );

            let graph = FoldGraph::from_segments(&model.line_segments, true);
            let positions = graph.face_positions(1).expect("connected");
            let placement =
                place_faces(&graph, 1).unwrap_or_else(|error| panic!("{name}: {error}"));
            let anchor = placement.face_transforms[placement.starting_face].inverse();

            let (mut worst, mut worst_z) = (0.0_f64, 0.0_f64);
            for (face, ring) in placement.rings.iter().enumerate() {
                for (slot, &point) in ring.iter().enumerate() {
                    let mine = anchor.apply(placement.face_points[face][slot]);
                    let theirs = graph.fold_movement(point, face, &positions);
                    worst = worst.max((mine[0] - theirs.x).hypot(mine[1] - theirs.y));
                    worst_z = worst_z.max(mine[2].abs());
                }
            }
            assert!(
                worst < 1e-9,
                "{name}: the walk and fold_movement disagree by {worst}"
            );
            assert!(
                worst_z < 1e-9,
                "{name}: a half-turn about an in-sheet axis left the sheet by {worst_z}"
            );
        }
    }

    /// A drawn ring: four radial creases at 90 degrees, and no interior vertex
    /// the closure check will look at.
    fn annulus_90() -> Vec<LineSegment> {
        let square = |r: f64| {
            [
                Point::new(-r, -r),
                Point::new(r, -r),
                Point::new(r, r),
                Point::new(-r, r),
            ]
        };
        let (outer, inner) = (square(100.0), square(40.0));
        let mut segments = Vec::new();
        for k in 0..4 {
            segments.push(border(outer[k], outer[(k + 1) % 4]));
            segments.push(border(inner[k], inner[(k + 1) % 4]));
        }
        for k in 0..4 {
            segments.push(crease(inner[k], outer[k], 90.0));
        }
        segments
    }

    /// Multiply-connected paper, and the reason the walk refuses a non-crease
    /// join instead of stepping over it.
    ///
    /// `calculate_faces` traces every bounded region, so a drawn ring comes back
    /// with its hole **filled** — that half of the old argument is true and
    /// reproduces here. What fails is the inference that per-vertex closure then
    /// covers the loop: `is_interior_vertex` declines every hub vertex for
    /// touching a border, so the check reports clean having examined nothing.
    /// The measurement harness stepped over the border joins with an identity
    /// and measured a 1.571 rad gap on the filled disk; the walk instead refuses
    /// the join, which is a truer answer than a gap measured on geometry the
    /// drawing does not describe.
    #[test]
    fn a_drawn_ring_is_refused_at_the_join_the_closure_check_cannot_see() {
        let segments = annulus_90();
        let model = CreasePatternModel {
            line_segments: segments.clone(),
            ..CreasePatternModel::default()
        };
        let camv = dispatched_camv(&model);
        assert!(
            camv.spatial.is_empty(),
            "the closure check examined {} vertices; it is meant to examine none",
            camv.spatial.len()
        );
        assert_eq!(camv.flat.len(), 0);
        assert_eq!(
            camv.interior_borders.len(),
            4,
            "the inner square's four edges have paper on both sides"
        );

        let graph = FoldGraph::from_segments(&segments, true);
        assert_eq!(graph.faces.len(), 5, "four sectors plus the filled hole");
        assert!(matches!(
            place_faces(&graph, 1),
            Err(Fold3dPlacementError::Refused(
                Fold3dRefusal::NonCreaseJoin { .. }
            ))
        ));
    }

    /// The flat folder mirrors across an **unassigned** segment as readily as
    /// across a mountain: `find_adjacent_line` applies no colour filter, so a
    /// crease nobody assigned still folds the paper 180 degrees. That is
    /// Oriedita's behaviour and stays; in 3D there is no angle to apply and
    /// manufacturing one would be inventing a nearby result.
    ///
    /// `clean-smoke` is the shipped instance — six unassigned creases, and the
    /// flat fold of it is a state the file never described.
    #[test]
    fn an_unassigned_join_is_refused_rather_than_mirrored() {
        let model = model_at(&repo(
            "crates/oristudio-cp-detect/tests/fixtures/cp-detect-oracle/clean-smoke.fold",
        ));
        assert!(
            model
                .line_segments
                .iter()
                .any(|segment| segment.color == LineColor::None),
            "clean-smoke is supposed to carry unassigned creases"
        );
        assert!(matches!(
            place_segments(&model.line_segments, 1),
            Err(Fold3dPlacementError::Refused(
                Fold3dRefusal::NonCreaseJoin { .. }
            ))
        ));
    }

    /// Every dual adjacency carries a crease on a document that places, tree
    /// edge or not — so the loop gap is never a maximum over a step that could
    /// not be built.
    #[test]
    fn a_placement_that_succeeds_has_a_crease_on_every_dual_adjacency() {
        // `penguin_freeform` was the third entry and is now held outside the
        // repository (see `tests/common/mod.rs`). It is not replaced by a
        // corpus-gated load: this is a unit test inside the crate, where the
        // skip machinery the integration tests share is not reachable, and both
        // remaining fixtures carry a non-tree dual graph (3 and 12 independent
        // cycles), so the assertion below still has something to be true of.
        for name in [
            "tests/fixtures/fold-angle-3d/spikes_small.fold",
            "tests/fixtures/fold-angle-3d/box_90.fold",
        ] {
            let model = model_at(&repo(name));
            let placement = place_segments(&model.line_segments, 1)
                .unwrap_or_else(|error| panic!("{name}: {error}"));
            assert!(
                crate::checks_spatial::interior_border_segments(&model).is_empty(),
                "{name} placed, so it can carry no border with paper on both sides"
            );
            assert!(
                placement.loop_gap.non_tree_edges > 0,
                "{name} has a tree dual graph, so its loop gap certifies nothing"
            );
        }
    }
}

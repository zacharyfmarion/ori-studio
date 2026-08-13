//! Generalised (non-flat) vertex checks.
//!
//! Oriedita's [`crate::checks`] answers "can this vertex be folded **flat**".
//! Once a crease can carry any angle in `[-180, 180]`, that is the wrong
//! question at a vertex whose creases are not all full folds — 2D Kawasaki stops
//! being an error and becomes "not flat-foldable", and odd-degree vertices stop
//! being illegal.
//!
//! The right question is the **vertex closure condition** (Wong, *3d Kawasaki's
//! theorem with quaternions*, §2): walking the creases in angular order and
//! composing their rotations must return you to where you started.
//!
//! ```text
//! q_i = [cos(rho_i/2), sin(rho_i/2) cos(theta_i), sin(rho_i/2) sin(theta_i), 0]
//! q_n * ... * q_2 * q_1 = [1, 0, 0, 0]
//! ```
//!
//! This module does **not** replace [`crate::checks`]. That port stays
//! byte-identical and remains the authority for flat patterns; dispatch is per
//! vertex (see [`vertex_regime`]), so the flat regions of a mixed design keep
//! their full Oriedita diagnostics.
//!
//! # The residual must be measured from the identity QUATERNION
//!
//! The reflexive way to write a rotation residual is `2*acos(|w|)`, taking the
//! absolute value because quaternions double-cover `SO(3)` and `q`/`-q` are the
//! same rotation. **That is wrong here, and it fails silently.**
//!
//! At `rho = +/-180` a mountain and a valley are the *same half-turn* in
//! `SO(3)`; the mountain/valley distinction survives only in the quaternion
//! lift. A Maekawa-violating vertex composes to `q = -1`, which `|w|` reports as
//! a perfect zero. Measuring from `+1` is precisely what makes closure subsume
//! Maekawa — which is why the paper writes `[1,0,0,0]` and not `+/-1`.

use std::collections::HashMap;

use crate::checks::point_line_map;
use crate::fold_graph::FoldGraph;
use crate::geometry::{Epsilon, LineColor, LineSegment, Point};
use crate::model::{
    CreasePatternModel, crease_fold_angle, has_non_classic_creases, is_classic_crease,
};

/// Cell size for the through-line spatial hash. Matches the endpoint-clustering
/// epsilon in [`crate::checks`] so the two agree on what "at this point" means.
const CELL: f64 = Epsilon::UNKNOWN_1EN4;

/// Why a vertex cannot be evaluated.
///
/// Both of these produce a residual identical to a real parity failure if
/// evaluated naively, so they must be reported as "cannot tell", never as a
/// violation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Indeterminate {
    /// An incident crease has no assignment. Treating unassigned as `rho = 0`
    /// would fabricate an answer *and* silently drop the crease from the fan,
    /// which lets an odd-degree vertex close for the wrong reason.
    UnassignedCrease,
    /// Another segment passes through this point without ending here, so the
    /// endpoint-clustered fan is missing that segment's two rays. Measured on a
    /// synthetic T-junction: extracted degree 2 instead of 4, and a residual of
    /// 360 degrees indistinguishable from a Maekawa violation.
    UnsplitJunction,
}

/// A vertex and its incident creases, sorted by direction.
///
/// The seam between topology extraction and the closure math. Everything below
/// consumes only this, so swapping the topology source later is a one-file
/// change.
#[derive(Debug, Clone, PartialEq)]
pub struct VertexFan {
    pub point: Point,
    /// `(theta, rho)` in radians, sorted by ascending `theta`.
    pub creases: Vec<(f64, f64)>,
    /// `None` when the fan is fully determined.
    pub indeterminate: Option<Indeterminate>,
}

impl VertexFan {
    pub fn degree(&self) -> usize {
        self.creases.len()
    }
}

/// Which checker owns a vertex.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VertexRegime {
    /// Every incident folding crease is a full +/-180. Oriedita's flat check
    /// applies unchanged, including big-little-big and the Fushimi rules.
    Flat,
    /// At least one incident crease carries an explicit non-180 angle.
    Spatial,
}

/// Per-vertex dispatch — **not** per document.
///
/// Document-level dispatch was the first design and it is wrong: it would throw
/// away the flat diagnostics across an entire document the moment one crease
/// became non-flat. A box with flat-folded flaps is the expected case, and its
/// flat regions genuinely have richer diagnostics available.
pub fn vertex_regime(lines: &[LineSegment]) -> VertexRegime {
    if lines.iter().any(|line| !is_classic_crease(line)) {
        VertexRegime::Spatial
    } else {
        VertexRegime::Flat
    }
}

/// Quaternion `[w, x, y, z]`.
///
/// Public because [`crate::folding3d`] composes rigid motions out of the same
/// primitives and must not re-type them: a second alias is a second convention
/// waiting to disagree with this one.
pub type Quat = (f64, f64, f64, f64);

pub(crate) fn crease_quat(theta: f64, rho: f64) -> Quat {
    let (sin_half, cos_half) = (rho / 2.0).sin_cos();
    (
        cos_half,
        sin_half * theta.cos(),
        sin_half * theta.sin(),
        0.0,
    )
}

/// A rotation of `rho` about an arbitrary unit axis.
///
/// [`crease_quat`] is this with the axis pinned to the sheet plane. The
/// three-angle solve needs the general form, because moving the known runs of
/// creases to one side rotates each unknown's axis *out* of the plane while
/// leaving its angle alone — see [`crate::solve_fold_angles`].
pub(crate) fn axis_quat(axis: Vec3, rho: f64) -> Quat {
    let (sin_half, cos_half) = (rho / 2.0).sin_cos();
    (
        cos_half,
        sin_half * axis[0],
        sin_half * axis[1],
        sin_half * axis[2],
    )
}

pub(crate) fn quat_mul(a: Quat, b: Quat) -> Quat {
    (
        a.0 * b.0 - a.1 * b.1 - a.2 * b.2 - a.3 * b.3,
        a.0 * b.1 + a.1 * b.0 + a.2 * b.3 - a.3 * b.2,
        a.0 * b.2 - a.1 * b.3 + a.2 * b.0 + a.3 * b.1,
        a.0 * b.3 + a.1 * b.2 - a.2 * b.1 + a.3 * b.0,
    )
}

/// `q_n * ... * q_1` for the fan, in angular order.
pub(crate) fn closure_product(creases: &[(f64, f64)]) -> Quat {
    let mut q: Quat = (1.0, 0.0, 0.0, 0.0);
    for &(theta, rho) in creases {
        q = quat_mul(crease_quat(theta, rho), q);
    }
    q
}

/// The inverse of a unit quaternion — its conjugate.
pub(crate) fn quat_conj(q: Quat) -> Quat {
    (q.0, -q.1, -q.2, -q.3)
}

/// Angle from the identity quaternion, in radians over `[0, 2*pi]`.
///
/// See the module docs: `w` is **signed**. `q = -1` must come out at `2*pi`,
/// never `0`, or every Maekawa violation reads as a perfect closure.
pub(crate) fn quat_residual(q: Quat) -> f64 {
    let vector_norm = (q.1 * q.1 + q.2 * q.2 + q.3 * q.3).sqrt();
    2.0 * vector_norm.atan2(q.0)
}

/// Closure residual for a fan, in radians over `[0, 2*pi]`. Zero is a closed
/// vertex.
///
/// Returns the raw residual and never a verdict: the threshold is applied once,
/// late, at the presentation layer, so revising it stays a one-constant change.
pub fn vertex_closure_residual(fan: &VertexFan) -> f64 {
    quat_residual(closure_product(&fan.creases))
}

/// A point on the unit sphere, and the vector type the 3D placement shares.
pub type Vec3 = [f64; 3];

pub(crate) fn quat_rotate(q: Quat, v: Vec3) -> Vec3 {
    let (w, x, y, z) = q;
    let t = [
        2.0 * (y * v[2] - z * v[1]),
        2.0 * (z * v[0] - x * v[2]),
        2.0 * (x * v[1] - y * v[0]),
    ];
    [
        v[0] + w * t[0] + (y * t[2] - z * t[1]),
        v[1] + w * t[1] + (z * t[0] - x * t[2]),
        v[2] + w * t[2] + (x * t[1] - y * t[0]),
    ]
}

pub(crate) fn cross(a: Vec3, b: Vec3) -> Vec3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

pub(crate) fn dot(a: Vec3, b: Vec3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

pub(crate) fn norm(a: Vec3) -> f64 {
    dot(a, a).sqrt()
}

/// The folded vertex link: where each crease pierces a small sphere around the
/// vertex, once the fold angles are applied.
///
/// Intersecting the folded paper with a small sphere centred on the vertex gives
/// a closed spherical polygon. Its corners are these points and its sides are
/// great-circle arcs whose lengths are the planar sector angles — paper does not
/// stretch. The paper is locally embedded exactly when that polygon does not
/// cross itself, which is what [`vertex_link_contacts`] tests.
///
/// # This does not compose the same way as `closure_product`
///
/// The sector frames multiply on the **right** (`R_i = R_{i-1} * q_i`), where
/// [`closure_product`] multiplies on the left to form Wong's `q_n···q_1`. Using
/// the closure chain's partial products here looks right and is wrong: measured
/// on asymmetric fans it puts the arc lengths out by up to 74 degrees, though on
/// a *symmetric* fan both orders agree to 1e-14 and the error hides completely.
///
/// The invariant that catches it — and the reason
/// `vertex_link_preserves_arc_lengths` exists — is that arc lengths must equal
/// the planar sector angles at every fold angle.
pub fn vertex_link_polygon(fan: &VertexFan) -> Vec<Vec3> {
    let mut frame: Quat = (1.0, 0.0, 0.0, 0.0);
    let mut points = Vec::with_capacity(fan.creases.len());
    for &(theta, rho) in &fan.creases {
        // The crease is shared by the sectors either side, so its folded
        // position is fixed by the frame before its own rotation is applied.
        points.push(quat_rotate(frame, [theta.cos(), theta.sin(), 0.0]));
        frame = quat_mul(frame, crease_quat(theta, rho));
    }
    points
}

/// Below this, two great circles count as the same circle and their arcs are
/// touching rather than crossing.
///
/// Measured over 5,146 contacts on fans of degree 5-7 with 0-4 creases pinned
/// flat, transversality is bimodal: 1,520 below 1e-12, **nothing at all between
/// 1e-12 and 1e-6**, and the rest above. Any threshold inside that empty band
/// gives the same answer, so this is a gap, not a tuned constant.
const TRANSVERSE_EPSILON: f64 = 1e-9;

/// What the folded vertex link says about the paper near a vertex.
///
/// Four outcomes, because "not simple" splits into a real failure and two
/// separate questions this check cannot answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkVerdict {
    /// The link is an embedded closed curve: the paper is locally embedded.
    Simple,
    /// Two arcs cross at an angle, away from anywhere layers are stacked, so the
    /// paper passes through itself.
    ///
    /// Carries no count on purpose. An earlier version reported one, nothing
    /// read it, and the number was arc *pairs* that met rather than crossing
    /// points — a figure that promised more precision than it had.
    SelfIntersects,
    /// Somewhere two pieces of paper lie against each other, and nothing else in
    /// the link was found to cross. Whether the stacked pieces collide is decided
    /// by **which layer is on top**, which the link does not carry.
    ///
    /// Not a rare corner: a crease at +/-180 folds a sector flat and produces it
    /// every time, in one of two forms — the creases either side land on the same
    /// direction when the sectors match, and their arcs overlap when they do not.
    /// On a box-pleated model with flat-folded flaps that is typically every
    /// vertex, measured at 52 of 52 on a physically folded test model.
    ///
    /// **This does not suppress a crossing found elsewhere.** Layer ordering can
    /// separate two coincident layers; it cannot un-cross a transverse crossing.
    /// A first attempt at this declined the whole vertex the moment any stacking
    /// appeared, which made the check inert on exactly the designs people build.
    StackedLayers,
    /// A sector wider than 180 degrees, which this construction cannot model.
    ///
    /// The polygon side between two creases is the *minor* great-circle arc, so a
    /// reflex sector is built as its complement — a 240 degree sector becomes a
    /// 120 degree arc going the wrong way round the sphere. Every containment
    /// test in that sector then asks about the wrong region.
    ///
    /// Rare (it needs an interior vertex with every crease inside a half-plane)
    /// and declined rather than fixed, because handling it means testing the
    /// major arc and that wants fixtures this has not got.
    ReflexSector,
}

impl LinkVerdict {
    /// Whether the paper is known to pass through itself.
    ///
    /// `StackedLayers` and `ReflexSector` are **not** self-intersections: they
    /// are the absence of an answer, and must read as "no complaint" everywhere
    /// a verdict is acted on.
    pub fn self_intersects(&self) -> bool {
        matches!(self, Self::SelfIntersects)
    }
}

/// Test the folded vertex link for self-intersection.
///
/// `O(n^2)` in the vertex degree, the same order [`vertex_dof`] already costs on
/// every spatial vertex.
///
/// Adjacent arcs share an endpoint by construction and are skipped; with fewer
/// than four creases there is no non-adjacent pair, so a spherical triangle is
/// rigid but never self-crossing.
///
/// # Stacking narrows the answer, it does not replace it
///
/// Where layers are stacked the link cannot say whether the paper collides, so
/// meetings *at* stacked geometry are set aside. Meetings anywhere else still
/// count: two surfaces crossing at an angle intersect however the stacked layers
/// are ordered.
///
/// The distinction matters more than it sounds. Declining the whole vertex on
/// any sign of stacking — which is what the first version did — silences the
/// check on every box-pleated design with a flat-folded flap, which is most of
/// them.
pub fn vertex_link_verdict(fan: &VertexFan) -> LinkVerdict {
    if has_reflex_sector(fan) {
        return LinkVerdict::ReflexSector;
    }

    let points = vertex_link_polygon(fan);
    let n = points.len();
    if n < 4 {
        return LinkVerdict::Simple;
    }

    let normals: Vec<Vec3> = (0..n)
        .map(|i| cross(points[i], points[(i + 1) % n]))
        .collect();

    // Settled from the geometry rather than inferred from the crossing test. A
    // shared corner sits exactly on an arc endpoint, the worst case for
    // `within_arc`'s exact sign comparison — coincident points differ by ~1e-16
    // and the test falls either way — so the stacked *points* are identified
    // directly and the crossing loop consults that list.
    let stacked_points = stacked_point_set(&points);
    let stacked_arcs = stacked_arc_set(fan);
    let mut stacking = !stacked_points.is_empty()
        || !stacked_arcs.is_empty()
        || has_stacked_layers(fan, &points, &normals);

    for i in 0..n {
        for j in (i + 1)..n {
            if arcs_are_adjacent(i, j, n) {
                continue;
            }
            let (first, second) = (normals[i], normals[j]);
            let (first_norm, second_norm) = (norm(first), norm(second));
            if first_norm < TRANSVERSE_EPSILON || second_norm < TRANSVERSE_EPSILON {
                stacking = true;
                continue;
            }
            // Collinear arcs overlap rather than cross, and normalising their
            // near-zero cross product would be meaningless anyway.
            let axis = cross(first, second);
            let scale = norm(axis);
            if scale / (first_norm * second_norm) < TRANSVERSE_EPSILON {
                stacking = true;
                continue;
            }

            let meeting = [axis[0] / scale, axis[1] / scale, axis[2] / scale];
            let opposite = [-meeting[0], -meeting[1], -meeting[2]];
            for candidate in [meeting, opposite] {
                if !within_arc(candidate, points[i], points[(i + 1) % n], first)
                    || !within_arc(candidate, points[j], points[(j + 1) % n], second)
                {
                    continue;
                }
                // A meeting where layers are stacked is the ambiguous case: it
                // may be two creases pointing the same way, or an arc lying along
                // another, and only the layer order separates them. Anywhere
                // else, a meeting is the paper crossing itself.
                if is_at_stacked_point(candidate, &stacked_points)
                    || stacked_arcs.contains(&i)
                    || stacked_arcs.contains(&j)
                {
                    stacking = true;
                } else {
                    return LinkVerdict::SelfIntersects;
                }
            }
        }
    }

    if stacking {
        LinkVerdict::StackedLayers
    } else {
        LinkVerdict::Simple
    }
}

/// Does any sector span more than half a turn?
///
/// Sectors are the gaps between consecutive creases in angular order, plus the
/// wrap from the last back to the first.
fn has_reflex_sector(fan: &VertexFan) -> bool {
    let n = fan.creases.len();
    if n == 0 {
        return false;
    }
    (0..n).any(|i| {
        let mut sector = fan.creases[(i + 1) % n].0 - fan.creases[i].0;
        if sector <= 0.0 {
            sector += std::f64::consts::TAU;
        }
        sector > std::f64::consts::PI + TRANSVERSE_EPSILON
    })
}

/// Link points that share a direction with another link point.
///
/// Two creases pointing the same way once folded is the signature of the paper
/// between them being folded flat, so these are the directions where layers sit
/// and a meeting cannot be judged.
fn stacked_point_set(points: &[Vec3]) -> Vec<Vec3> {
    let mut stacked = Vec::new();
    for (index, point) in points.iter().enumerate() {
        if points
            .iter()
            .enumerate()
            .any(|(other, candidate)| other != index && coincident(*point, *candidate))
        {
            stacked.push(*point);
        }
    }
    stacked
}

/// Arcs lying against another layer of paper.
///
/// A crease at +/-180 folds the two sectors either side onto each other, so the
/// two arcs meeting at that crease are stacked. When the sectors match this also
/// shows up as coincident corners, which [`stacked_point_set`] catches — but when
/// they do not, the shorter arc simply lies along the longer one and there is no
/// coincident *point* to find. That case is why this exists.
///
/// Only the arcs either side of a folded crease are set aside. Every other pair
/// is still judged, which is the whole point of narrowing rather than declining.
fn stacked_arc_set(fan: &VertexFan) -> Vec<usize> {
    // Storage resolves to 1e-7 degrees and an exact 180 normalises to `None`, so
    // this asks "is this crease classic", not "is it nearly flat".
    const FLAT_EPSILON_DEGREES: f64 = 1e-6;
    let n = fan.creases.len();
    let mut arcs = Vec::new();
    for (index, (_, rho)) in fan.creases.iter().enumerate() {
        if (rho.abs().to_degrees() - 180.0).abs() < FLAT_EPSILON_DEGREES {
            arcs.push((index + n - 1) % n);
            arcs.push(index);
        }
    }
    arcs.sort_unstable();
    arcs.dedup();
    arcs
}

fn coincident(a: Vec3, b: Vec3) -> bool {
    norm([a[0] - b[0], a[1] - b[1], a[2] - b[2]]) < TRANSVERSE_EPSILON
}

fn is_at_stacked_point(candidate: Vec3, stacked: &[Vec3]) -> bool {
    stacked.iter().any(|point| coincident(candidate, *point))
}

/// Is any part of the folded paper lying against another part?
///
/// Three signatures, and the first is the one that matters:
///
/// - **a crease at +/-180** — it folds its two sectors onto each other, full
///   stop. Read straight off the fan, because the geometric consequences below
///   do *not* reliably show it: the two arcs it makes collinear are its own,
///   which are index-adjacent, and adjacent pairs are skipped as legitimately
///   sharing a corner. Measured on six fans with a folded crease and unequal
///   sectors either side, all six slipped past the geometric tests.
/// - **coincident corners** — the creases either side of a folded crease land on
///   the same direction when the sectors either side match. Kept because it also
///   catches stacking that arises without any single crease reaching 180.
/// - **collinear non-adjacent arcs** — two distant sectors sharing a great
///   circle, likewise reachable without a fully folded crease.
///
/// Either way two layers occupy the same place, and which is on top decides
/// whether they collide. The link does not carry that, so the check declines.
fn has_stacked_layers(fan: &VertexFan, points: &[Vec3], normals: &[Vec3]) -> bool {
    // Storage resolves to 1e-7 degrees and an exact 180 normalises to `None`, so
    // this is a test for "is classic", not a tolerance band. A crease at 179.9 is
    // genuinely not folded flat, and Q4 measured the check well conditioned
    // there — widening this would throw away the near-flat range for nothing.
    const FLAT_EPSILON_DEGREES: f64 = 1e-6;
    if fan
        .creases
        .iter()
        .any(|(_, rho)| (rho.abs().to_degrees() - 180.0).abs() < FLAT_EPSILON_DEGREES)
    {
        return true;
    }

    let n = points.len();
    for i in 0..n {
        for j in (i + 1)..n {
            let delta = [
                points[i][0] - points[j][0],
                points[i][1] - points[j][1],
                points[i][2] - points[j][2],
            ];
            if norm(delta) < TRANSVERSE_EPSILON {
                return true;
            }
        }
    }
    for i in 0..n {
        for j in (i + 1)..n {
            if arcs_are_adjacent(i, j, n) {
                continue;
            }
            let (first, second) = (normals[i], normals[j]);
            let (first_norm, second_norm) = (norm(first), norm(second));
            // A degenerate normal is a zero-length arc, not a shallow angle, so
            // this compares a magnitude rather than the ratio below. Both use the
            // same epsilon because both are "indistinguishable from zero".
            if first_norm < TRANSVERSE_EPSILON || second_norm < TRANSVERSE_EPSILON {
                return true;
            }
            if norm(cross(first, second)) / (first_norm * second_norm) < TRANSVERSE_EPSILON {
                return true;
            }
        }
    }
    false
}

/// Do arcs `i` and `j` of an `n`-sided closed polygon share a corner by index?
///
/// One definition, used by both the stacking scan and the crossing loop. They
/// must agree: the crossing loop normalises `n_i x n_j`, and it is only safe to
/// do that because the stacking scan already rejected every collinear pair it
/// will see. Two copies of this condition could drift apart into a division by
/// zero.
fn arcs_are_adjacent(i: usize, j: usize, n: usize) -> bool {
    j == i + 1 || (i == 0 && j == n - 1)
}

/// Is `point` on the minor arc from `a` to `b`, whose great circle has normal
/// `normal`? Assumes `point` is already on that great circle.
fn within_arc(point: Vec3, a: Vec3, b: Vec3, normal: Vec3) -> bool {
    dot(cross(a, point), normal) >= 0.0 && dot(cross(point, b), normal) >= 0.0
}

/// Remaining degrees of freedom, from the **rank of the closure Jacobian**.
///
/// Not `n - 3`. That count assumes the three closure constraints are
/// independent, which fails on degenerate fans — and the most common degenerate
/// fan is a point sitting mid-way along a straight crease, where the constraints
/// collapse to `rho_1 = rho_2` and the true answer is 1, not `2 - 3`. Those are
/// everywhere in a real pattern, so the naive count would be wrong all over it.
pub fn vertex_dof(fan: &VertexFan) -> usize {
    let n = fan.creases.len();
    if n == 0 {
        return 0;
    }
    // Numerical Jacobian of the vector part w.r.t. each rho. `n` is small (a
    // degree-30 vertex is exotic), and finite differences avoid hand-deriving a
    // product rule that would be easy to get subtly wrong.
    const H: f64 = 1e-7;
    let base = closure_product(&fan.creases);
    let mut jacobian: Vec<[f64; 3]> = Vec::with_capacity(n);
    for index in 0..n {
        let mut bumped = fan.creases.clone();
        bumped[index].1 += H;
        let q = closure_product(&bumped);
        jacobian.push([(q.1 - base.1) / H, (q.2 - base.2) / H, (q.3 - base.3) / H]);
    }
    n.saturating_sub(jacobian_rank(&jacobian))
}

/// Rank of the `n x 3` Jacobian by Gaussian elimination with partial pivoting.
pub(crate) fn jacobian_rank(rows: &[[f64; 3]]) -> usize {
    // Scale-relative tolerance: a fan drawn at 1e-3 units and one at 1e3 units
    // describe the same vertex, so an absolute pivot floor would report
    // different ranks for the same geometry.
    let scale = rows
        .iter()
        .flat_map(|row| row.iter())
        .fold(0.0_f64, |acc, value| acc.max(value.abs()));
    if scale == 0.0 {
        return 0;
    }
    let tolerance = scale * 1e-9;

    let mut matrix: Vec<[f64; 3]> = rows.to_vec();
    let mut rank = 0usize;
    for column in 0..3 {
        let Some(pivot) = (rank..matrix.len())
            .max_by(|&a, &b| {
                matrix[a][column]
                    .abs()
                    .partial_cmp(&matrix[b][column].abs())
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .filter(|&row| matrix[row][column].abs() > tolerance)
        else {
            continue;
        };
        matrix.swap(rank, pivot);
        let pivot_value = matrix[rank][column];
        let pivot_row = matrix[rank];
        for row in matrix.iter_mut().skip(rank + 1) {
            let factor = row[column] / pivot_value;
            for (value, pivot) in row.iter_mut().zip(pivot_row.iter()).skip(column) {
                *value -= factor * pivot;
            }
        }
        rank += 1;
    }
    rank
}

/// Whether the paper wraps all the way around this point.
///
/// **The closure condition only applies to interior vertices.** It says that
/// walking the creases in angular order returns you to where you started — but
/// at a point on the paper edge there is no loop to walk, because the paper does
/// not continue past the border. A boundary vertex has no closure constraint at
/// all.
///
/// Border count is the same signal Oriedita uses (`black == 0` gates its
/// interior flat-foldability test), so the two checkers agree on what "interior"
/// means. Anything other than 0 or 2 borders is a malformed boundary, which is
/// Oriedita's `NumberOfFolds` to report — the spatial check stays out of it
/// rather than issuing a second, differently-worded complaint about the same
/// geometry.
pub(crate) fn is_interior_vertex(lines: &[LineSegment]) -> bool {
    lines
        .iter()
        .filter(|line| line.color == LineColor::Black0)
        .count()
        == 0
}

/// Build a fan from a vertex and the segments whose endpoints land on it.
///
/// `through_line` is whether some other segment passes through this point
/// without ending here; see [`Indeterminate::UnsplitJunction`].
pub fn vertex_fan(point: Point, lines: &[LineSegment], through_line: bool) -> VertexFan {
    let mut creases = Vec::new();
    let mut unassigned = false;

    for line in lines {
        if line.color == LineColor::None {
            unassigned = true;
            continue;
        }
        let Some(rho_degrees) = crease_fold_angle(line) else {
            // Borders and auxiliary lines are not creases. A border contributes
            // no rotation, so it is simply absent from the fan.
            continue;
        };
        // Direction *away* from the vertex, which is what theta means.
        let other = if point.distance(line.a) <= point.distance(line.b) {
            line.b
        } else {
            line.a
        };
        let (dx, dy) = (other.x - point.x, other.y - point.y);
        if dx == 0.0 && dy == 0.0 {
            continue;
        }
        creases.push((dy.atan2(dx), rho_degrees.to_radians()));
    }

    creases.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

    let indeterminate = if through_line {
        Some(Indeterminate::UnsplitJunction)
    } else if unassigned {
        Some(Indeterminate::UnassignedCrease)
    } else {
        None
    };

    VertexFan {
        point,
        creases,
        indeterminate,
    }
}

/// Build the fan at one point, without mapping the whole document.
///
/// [`spatial_vertex_reports`] runs over every vertex and pays for
/// [`point_line_map`] once. A tool asks about the single vertex under the
/// cursor, on every pointer move, so it takes this instead: one linear pass, no
/// map, no index.
///
/// # It must agree with `point_line_map` about what "at this point" means
///
/// Same epsilon, same colour filter — deliberately, and the reason is not
/// tidiness. A user reaches for the completion tool *because* a vertex is
/// reporting `Creases do not close`; if the tool clustered differently it could
/// see a different fan than the diagnostic did and disagree about the regime, or
/// about the answer, with nothing on screen to explain why.
pub fn vertex_fan_at(model: &CreasePatternModel, point: Point) -> VertexFan {
    let mut lines = Vec::new();
    let mut through = false;
    for segment in &model.line_segments {
        if segment.color == LineColor::Cyan3 {
            continue;
        }
        if point.distance(segment.a) < CELL || point.distance(segment.b) < CELL {
            lines.push(segment.clone());
        } else if point_on_segment(point, segment) {
            through = true;
        }
    }
    vertex_fan(point, &lines, through)
}

/// [`vertex_fan_at`], plus the document line index each crease came from.
///
/// # Why the fan does not simply carry this
///
/// [`VertexFan`] is the seam between topology extraction and the closure math,
/// and everything downstream consumes only `(theta, rho)`. Solvers that *add* a
/// crease never need to know where the existing ones live — [`crate::solve_spatial`]
/// is written entirely without it. Solving the angles of creases that already
/// exist does need it, because the answer has to be written back to specific
/// segments, and the fan's indices are not the document's: borders and auxiliary
/// lines are dropped, and the survivors are re-sorted by direction.
///
/// So the provenance rides alongside rather than inside, and
/// `fan_sources_align_with_the_fan` pins `fan.creases[k]` to
/// `model.line_segments[sources[k]]`.
pub fn vertex_fan_at_with_sources(
    model: &CreasePatternModel,
    point: Point,
) -> (VertexFan, Vec<usize>) {
    let mut entries: Vec<(usize, f64, f64)> = Vec::new();
    let mut unassigned = false;
    let mut through = false;

    for (index, segment) in model.line_segments.iter().enumerate() {
        if segment.color == LineColor::Cyan3 {
            continue;
        }
        if !(point.distance(segment.a) < CELL || point.distance(segment.b) < CELL) {
            if point_on_segment(point, segment) {
                through = true;
            }
            continue;
        }
        if segment.color == LineColor::None {
            unassigned = true;
            continue;
        }
        let Some(rho_degrees) = crease_fold_angle(segment) else {
            continue;
        };
        let other = if point.distance(segment.a) <= point.distance(segment.b) {
            segment.b
        } else {
            segment.a
        };
        let (dx, dy) = (other.x - point.x, other.y - point.y);
        if dx == 0.0 && dy == 0.0 {
            continue;
        }
        entries.push((index, dy.atan2(dx), rho_degrees.to_radians()));
    }

    // Same comparator as `vertex_fan`, over a stable sort, so a fan built here
    // and one built there put the same crease at the same position.
    entries.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));

    let sources = entries.iter().map(|(index, _, _)| *index).collect();
    let creases = entries
        .iter()
        .map(|(_, theta, rho)| (*theta, *rho))
        .collect();
    let indeterminate = if through {
        Some(Indeterminate::UnsplitJunction)
    } else if unassigned {
        Some(Indeterminate::UnassignedCrease)
    } else {
        None
    };

    (
        VertexFan {
            point,
            creases,
            indeterminate,
        },
        sources,
    )
}

/// The lines [`vertex_fan_at`] would gather, for callers that need the segments
/// themselves rather than the fan — the regime test, principally.
pub fn incident_lines_at(model: &CreasePatternModel, point: Point) -> Vec<LineSegment> {
    model
        .line_segments
        .iter()
        .filter(|segment| {
            segment.color != LineColor::Cyan3
                && (point.distance(segment.a) < CELL || point.distance(segment.b) < CELL)
        })
        .cloned()
        .collect()
}

/// One vertex's spatial verdict.
#[derive(Debug, Clone, PartialEq)]
pub struct SpatialVertexReport {
    pub point: Point,
    /// Radians over `[0, 2*pi]`; `None` when the fan could not be evaluated.
    pub residual: Option<f64>,
    pub degree: usize,
    /// Remaining freedom; `0` means the vertex is rigid at this geometry.
    pub dof: usize,
    /// What the folded link says; `None` when the fan could not be evaluated,
    /// for the same reasons `residual` is `None`.
    pub link: Option<LinkVerdict>,
    pub indeterminate: Option<Indeterminate>,
}

impl SpatialVertexReport {
    /// A degree-1 or rigid degree-3 vertex cannot fold at all: its angles are
    /// forced to zero rather than merely conflicting.
    ///
    /// Worth distinguishing in the UI, because "these angles conflict" invites
    /// the user to adjust them and no adjustment will help. The link of a vertex
    /// is a closed spherical linkage, and a triangle is a rigid truss.
    pub fn is_rigid(&self) -> bool {
        self.indeterminate.is_none() && self.degree > 0 && self.dof == 0
    }
}

/// Run the spatial check over every vertex the flat checker would not own.
///
/// Vertices whose creases are all classic are skipped entirely — they belong to
/// [`crate::checks`], which stays the authority for flat patterns.
///
/// # A classic document must cost nothing
///
/// `CheckCamv` is scheduled after every document mutation, so this sits on the
/// live edit path. Both `point_line_map` and [`ThroughLineIndex::build`] walk
/// every segment, and they ran *before* the per-vertex filter — so a purely flat
/// pattern paid the whole bill to discover it had no spatial vertices at all.
///
/// Measured on a synthetic grid with no non-classic crease anywhere: 4.5ms for
/// Oriedita's `check4` against **234ms** once this ran, a 52x regression on
/// every existing document for no result. The scan below is linear and settles
/// it before any index is built.
pub fn spatial_vertex_reports(model: &CreasePatternModel) -> Vec<SpatialVertexReport> {
    if !has_non_classic_creases(model) {
        return Vec::new();
    }
    let vertices = point_line_map(model);
    let through = ThroughLineIndex::build(model);

    vertices
        .into_iter()
        .filter(|(_, lines)| {
            vertex_regime(lines) == VertexRegime::Spatial && is_interior_vertex(lines)
        })
        .map(|(point, lines)| report_for(point, &lines, &through))
        .collect()
}

fn report_for(
    point: Point,
    lines: &[LineSegment],
    through: &ThroughLineIndex,
) -> SpatialVertexReport {
    let fan = vertex_fan(point, lines, through.passes_through(point));
    let determined = fan.indeterminate.is_none();
    SpatialVertexReport {
        point,
        residual: determined.then(|| vertex_closure_residual(&fan)),
        degree: fan.degree(),
        dof: vertex_dof(&fan),
        link: determined.then(|| vertex_link_verdict(&fan)),
        indeterminate: fan.indeterminate,
    }
}

/// Spatial index for asking "does anything pass *through* here".
///
/// `checks::check2` answers the same question exactly, but pairwise over every
/// segment — `O(E^2)`, which is fine for an on-demand diagnostic and far too slow
/// to run inside a live check on a 52k-segment document.
///
/// # Bucket size is not the same thing as the distance tolerance
///
/// The first version conflated them, and the index barely worked as a result. It
/// bucketed at [`CELL`] (1e-6) while stamping each segment's **bounding box** on
/// a lattice of `extent / 64` — so a 400-unit segment landed in ~65 buckets
/// spaced six million buckets apart, and a query, which looks at one bucket and
/// its eight neighbours, missed it unless the point happened to fall on that
/// lattice.
///
/// Measured: a T-junction part-way along a segment went undetected at every
/// length from 0.01 upward, so the vertex was evaluated with two rays missing
/// and reported a 216-degree closure failure on sound geometry. That is exactly
/// the false positive [`Indeterminate::UnsplitJunction`] exists to prevent.
///
/// So the two roles are now separate:
///
/// - **buckets** are coarse, sized from the model so a segment crosses a bounded
///   number of them;
/// - **the tolerance** stays [`CELL`], applied by `point_on_segment` once a
///   candidate has been found.
///
/// And the segment is rasterised *along its length* rather than over its
/// bounding box, which for a diagonal is the difference between `O(k)` and
/// `O(k^2)` stamps.
struct ThroughLineIndex {
    bucket: f64,
    cells: HashMap<(i64, i64), Vec<LineSegment>>,
}

/// How many buckets the model's longer side is divided into.
///
/// Sets the trade: a segment spanning the whole sheet is stamped into about
/// twice this many buckets, and a query scans the segments in nine of them.
const BUCKETS_ACROSS: f64 = 256.0;

impl ThroughLineIndex {
    fn build(model: &CreasePatternModel) -> Self {
        let bucket = Self::bucket_size(model);
        let mut cells: HashMap<(i64, i64), Vec<LineSegment>> = HashMap::new();
        for segment in &model.line_segments {
            if segment.color == LineColor::Cyan3 {
                continue;
            }
            // Walk the segment, not its bounding box, in steps of half a bucket
            // so no bucket it crosses can be skipped.
            let (dx, dy) = (segment.b.x - segment.a.x, segment.b.y - segment.a.y);
            let length = (dx * dx + dy * dy).sqrt();
            let steps = ((2.0 * length / bucket).ceil() as usize).max(1);
            let mut last = None;
            for step in 0..=steps {
                let t = step as f64 / steps as f64;
                let key = Self::key(
                    bucket,
                    Point::new(segment.a.x + t * dx, segment.a.y + t * dy),
                );
                if last == Some(key) {
                    continue;
                }
                last = Some(key);
                cells.entry(key).or_default().push(segment.clone());
            }
        }
        Self { bucket, cells }
    }

    /// Longer side of the model's bounding box, divided into buckets, and never
    /// finer than the tolerance the query applies.
    fn bucket_size(model: &CreasePatternModel) -> f64 {
        let mut min = Point::new(f64::MAX, f64::MAX);
        let mut max = Point::new(f64::MIN, f64::MIN);
        for segment in &model.line_segments {
            for point in [segment.a, segment.b] {
                min = Point::new(min.x.min(point.x), min.y.min(point.y));
                max = Point::new(max.x.max(point.x), max.y.max(point.y));
            }
        }
        let extent = (max.x - min.x).max(max.y - min.y);
        if !extent.is_finite() || extent <= 0.0 {
            return CELL;
        }
        (extent / BUCKETS_ACROSS).max(CELL)
    }

    fn key(bucket: f64, point: Point) -> (i64, i64) {
        (
            (point.x / bucket).floor() as i64,
            (point.y / bucket).floor() as i64,
        )
    }

    /// True when a segment contains `point` strictly between its endpoints.
    fn passes_through(&self, point: Point) -> bool {
        let cell = Self::key(self.bucket, point);
        for dx in -1..=1 {
            for dy in -1..=1 {
                let Some(segments) = self.cells.get(&(cell.0 + dx, cell.1 + dy)) else {
                    continue;
                };
                for segment in segments {
                    if point.distance(segment.a) <= CELL || point.distance(segment.b) <= CELL {
                        continue; // Ends here; that is an ordinary incident ray.
                    }
                    if point_on_segment(point, segment) {
                        return true;
                    }
                }
            }
        }
        false
    }
}

fn point_on_segment(point: Point, segment: &LineSegment) -> bool {
    let (dx, dy) = (segment.b.x - segment.a.x, segment.b.y - segment.a.y);
    let length_squared = dx * dx + dy * dy;
    if length_squared == 0.0 {
        return false;
    }
    let t = ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) / length_squared;
    if !(0.0..=1.0).contains(&t) {
        return false;
    }
    let closest = Point::new(segment.a.x + t * dx, segment.a.y + t * dy);
    point.distance(closest) <= CELL
}

/// Both halves of the CAMV check, dispatched **per vertex**.
///
/// A vertex whose incident creases are all classic goes to Oriedita's
/// [`crate::checks::find_flat_foldability_violation`] unchanged — including
/// big-little-big and the Fushimi rules, which the spatial check has no
/// equivalent for. Only a vertex touching a non-classic crease takes the
/// closure path.
///
/// This is why the dispatch is per vertex and not per document: a box with
/// flat-folded flaps is the expected shape of a design, and flattening the whole
/// document into one regime would throw away the richer diagnostics everywhere
/// the pattern is still flat.
pub struct DispatchedCamv {
    /// Oriedita violations, from the flat vertices only.
    pub flat: Vec<crate::checks::FlatFoldabilityViolation>,
    /// Closure reports, from the non-flat vertices only.
    pub spatial: Vec<SpatialVertexReport>,
    /// Borders with paper on both sides — the geometry neither branch above
    /// examines. See [`interior_border_segments`].
    ///
    /// Computed only when the document carries a non-classic crease, on the same
    /// argument as `through` below: it is the spatial branch that claims to have
    /// checked something, and on an all-classic document this list is empty by
    /// construction because nothing consults it.
    pub interior_borders: Vec<InteriorBorder>,
}

/// A border segment with paper on **both** sides.
///
/// [`is_interior_vertex`] declines every vertex touching a `Black0` segment,
/// because on a real paper edge there is no loop to walk and therefore no
/// closure condition — which is right, and is the same `black == 0` signal
/// Oriedita gates its own interior test on. It is also unconditional, and a
/// `Black0` segment drawn *inside* the sheet is not a paper edge. Every vertex
/// on such a loop is declined, `dispatched_camv` returns no report for any of
/// them, and the check comes back CLEAN having examined none of it.
///
/// Measured on the corpus's own `known-good/byu solar driven.fold`: a closed
/// hexagon of six `B` edges well inside the sheet, 0 flat violations, 0 closure
/// failures, worst *examined* interior residual 2.6e-12 degrees — and a
/// placement loop gap of 1.445 rad. A programmatically drawn annulus reproduces
/// it exactly: 5 faces, past the Euler gate, **0 spatial vertices examined at
/// all**.
///
/// `import_fold_document` also maps FOLD `C` (cut) to `Black0`, indistinguishable
/// from a paper boundary, so kirigami arrives through this same door.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct InteriorBorder {
    /// Index into the model's `line_segments`.
    pub segment: usize,
    /// Midpoint of the segment, for a diagnostic marker.
    pub point: Point,
}

/// Border segments with paper on both sides.
///
/// **Additive, and deliberately not a change to [`is_interior_vertex`].** That
/// predicate is shared with `solve_fold_angles` and `solve_spatial`, so widening
/// it would change what the solvers accept; and it is a faithful reading of
/// "this vertex has no closure condition" for a real paper edge. What is missing
/// is not a wider predicate but the observation that some of these borders are
/// not edges of the paper at all.
///
/// Answered from the traced arrangement rather than from geometry: a segment on
/// the paper boundary belongs to exactly one traced face, because
/// `FoldGraph::calculate_faces` never traces the unbounded outer face. A segment
/// belonging to two is interior. When the arrangement declines to trace at all
/// (unsplit crossings, so the Euler gate rejects), this reports nothing rather
/// than guessing — the same posture the rest of this module takes toward
/// geometry it cannot read.
/// # Cost
///
/// Tracing the arrangement is the expensive half of this, and `dispatched_camv`
/// reaches it on the 120 ms debounced post-edit path for any document carrying a
/// non-classic crease. Two things keep that affordable and both are exact rather
/// than heuristic: a document with no border segment at all cannot have one with
/// paper on both sides, so it never builds anything; and a caller that has
/// already traced the arrangement passes it in through
/// [`interior_border_segments_in`] instead of paying for a second copy.
pub fn interior_border_segments(model: &CreasePatternModel) -> Vec<InteriorBorder> {
    // Nothing to classify, so nothing to trace. The whole result is a filter on
    // `Black0` lines, which makes this an early-out and not an approximation.
    if !model
        .line_segments
        .iter()
        .any(|segment| segment.color == LineColor::Black0)
    {
        return Vec::new();
    }
    interior_border_segments_in(&FoldGraph::from_segments(&model.line_segments, true))
}

/// [`interior_border_segments`] against an arrangement the caller already has.
pub(crate) fn interior_border_segments_in(graph: &FoldGraph) -> Vec<InteriorBorder> {
    if graph.faces.is_empty() {
        return Vec::new();
    }

    // One pass over the faces, keyed on the undirected vertex pair: the naive
    // `line_face_border` per line is O(lines x faces).
    //
    // Occurrences, where `line_face_border` counted distinct faces. The two
    // differ only for a ring that traverses one edge twice — a slit cut into the
    // sheet — and that shape never reaches here: measured, its arrangement does
    // not trace at all (`include_faces` is false on a square with a slit), and
    // the empty-faces guard above returns first.
    let mut face_count: HashMap<(usize, usize), usize> = HashMap::new();
    for face in &graph.faces {
        for index in 0..face.len() {
            let a = face[index];
            let b = face[(index + 1) % face.len()];
            *face_count.entry((a.min(b), a.max(b))).or_default() += 1;
        }
    }

    graph
        .lines
        .iter()
        .enumerate()
        .filter(|(_, line)| line.color == LineColor::Black0)
        .filter(|(_, line)| {
            let key = (line.begin.min(line.end), line.begin.max(line.end));
            face_count.get(&key).copied().unwrap_or(0) >= 2
        })
        .filter_map(|(index, line)| {
            let a = *graph.points.get(line.begin)?;
            let b = *graph.points.get(line.end)?;
            Some(InteriorBorder {
                segment: index,
                point: Point::new((a.x + b.x) / 2.0, (a.y + b.y) / 2.0),
            })
        })
        .collect()
}

pub fn dispatched_camv(model: &CreasePatternModel) -> DispatchedCamv {
    dispatched_camv_in(model, None)
}

/// [`dispatched_camv`] against an arrangement the caller already has.
///
/// `arrangement` must be the traced arrangement of `model.line_segments`; it is
/// used for nothing but [`interior_border_segments_in`]. The 3D admission gate
/// needs the same arrangement to place faces, and building it twice made `admit`
/// pay for the most expensive thing it does two times over.
pub(crate) fn dispatched_camv_in(
    model: &CreasePatternModel,
    arrangement: Option<&FoldGraph>,
) -> DispatchedCamv {
    let vertices = point_line_map(model);
    // Only the spatial branch consults this, and it walks every segment to
    // build. `Spatial` requires a non-classic crease somewhere, so on a flat
    // document there is nothing to consult it for — and this runs after every
    // edit. Building it unconditionally cost 234ms on a 7,320-segment flat
    // pattern where Oriedita's own check takes 4.5ms.
    let non_classic = has_non_classic_creases(model);
    let through = non_classic.then(|| ThroughLineIndex::build(model));
    let interior_borders = match (non_classic, arrangement) {
        (false, _) => Vec::new(),
        (true, Some(graph)) => interior_border_segments_in(graph),
        (true, None) => interior_border_segments(model),
    };
    let mut flat = Vec::new();
    let mut spatial = Vec::new();

    for (point, lines) in vertices {
        match vertex_regime(&lines) {
            VertexRegime::Flat => {
                if let Some(violation) =
                    crate::checks::find_flat_foldability_violation(point, &lines)
                {
                    flat.push(violation);
                }
            }
            VertexRegime::Spatial => {
                // `Spatial` means an incident crease is non-classic, which is
                // exactly when the index was built, so this never skips a real
                // vertex — it just avoids an unwrap on the invariant.
                if let (true, Some(through)) = (is_interior_vertex(&lines), through.as_ref()) {
                    spatial.push(report_for(point, &lines, through));
                }
            }
        }
    }

    DispatchedCamv {
        flat,
        spatial,
        interior_borders,
    }
}

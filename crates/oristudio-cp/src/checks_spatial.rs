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
use crate::geometry::{Epsilon, LineColor, LineSegment, Point};
use crate::model::{CreasePatternModel, crease_fold_angle, is_classic_crease};

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
    /// applies unchanged, including little-big-little and the Fushimi rules.
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
type Quat = (f64, f64, f64, f64);

fn crease_quat(theta: f64, rho: f64) -> Quat {
    let (sin_half, cos_half) = (rho / 2.0).sin_cos();
    (
        cos_half,
        sin_half * theta.cos(),
        sin_half * theta.sin(),
        0.0,
    )
}

fn quat_mul(a: Quat, b: Quat) -> Quat {
    (
        a.0 * b.0 - a.1 * b.1 - a.2 * b.2 - a.3 * b.3,
        a.0 * b.1 + a.1 * b.0 + a.2 * b.3 - a.3 * b.2,
        a.0 * b.2 - a.1 * b.3 + a.2 * b.0 + a.3 * b.1,
        a.0 * b.3 + a.1 * b.2 - a.2 * b.1 + a.3 * b.0,
    )
}

/// `q_n * ... * q_1` for the fan, in angular order.
fn closure_product(creases: &[(f64, f64)]) -> Quat {
    let mut q: Quat = (1.0, 0.0, 0.0, 0.0);
    for &(theta, rho) in creases {
        q = quat_mul(crease_quat(theta, rho), q);
    }
    q
}

/// Angle from the identity quaternion, in radians over `[0, 2*pi]`.
///
/// See the module docs: `w` is **signed**. `q = -1` must come out at `2*pi`,
/// never `0`, or every Maekawa violation reads as a perfect closure.
fn quat_residual(q: Quat) -> f64 {
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
fn jacobian_rank(rows: &[[f64; 3]]) -> usize {
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
fn is_interior_vertex(lines: &[LineSegment]) -> bool {
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

/// One vertex's spatial verdict.
#[derive(Debug, Clone, PartialEq)]
pub struct SpatialVertexReport {
    pub point: Point,
    /// Radians over `[0, 2*pi]`; `None` when the fan could not be evaluated.
    pub residual: Option<f64>,
    pub degree: usize,
    /// Remaining freedom; `0` means the vertex is rigid at this geometry.
    pub dof: usize,
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
pub fn spatial_vertex_reports(model: &CreasePatternModel) -> Vec<SpatialVertexReport> {
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
    SpatialVertexReport {
        point,
        residual: fan
            .indeterminate
            .is_none()
            .then(|| vertex_closure_residual(&fan)),
        degree: fan.degree(),
        dof: vertex_dof(&fan),
        indeterminate: fan.indeterminate,
    }
}

fn cell_of(point: Point) -> (i64, i64) {
    (
        (point.x / CELL).floor() as i64,
        (point.y / CELL).floor() as i64,
    )
}

/// Spatial hash of segments, for asking "does anything pass *through* here".
///
/// `checks::check2` answers the same question exactly, but pairwise over every
/// segment — `O(E^2)`, which is fine for an on-demand diagnostic and far too slow
/// to run inside a live check on a 52k-segment document.
struct ThroughLineIndex {
    cells: HashMap<(i64, i64), Vec<LineSegment>>,
}

impl ThroughLineIndex {
    fn build(model: &CreasePatternModel) -> Self {
        let mut cells: HashMap<(i64, i64), Vec<LineSegment>> = HashMap::new();
        for segment in &model.line_segments {
            if segment.color == LineColor::Cyan3 {
                continue;
            }
            // Stamp the segment into every cell its bounding box touches, so a
            // point-in-segment query only has to look at its own cell. Long
            // segments are the common case in a CP, so the box is coarsened to a
            // stride that keeps the stamp count bounded.
            let (min_x, max_x) = minmax(segment.a.x, segment.b.x);
            let (min_y, max_y) = minmax(segment.a.y, segment.b.y);
            let stride = ((max_x - min_x).max(max_y - min_y) / 64.0).max(CELL);
            let mut x = min_x;
            while x <= max_x + stride {
                let mut y = min_y;
                while y <= max_y + stride {
                    cells
                        .entry(((x / CELL).floor() as i64, (y / CELL).floor() as i64))
                        .or_default()
                        .push(segment.clone());
                    y += stride;
                }
                x += stride;
            }
        }
        Self { cells }
    }

    /// True when a segment contains `point` strictly between its endpoints.
    fn passes_through(&self, point: Point) -> bool {
        let cell = cell_of(point);
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

fn minmax(a: f64, b: f64) -> (f64, f64) {
    if a <= b { (a, b) } else { (b, a) }
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
/// little-big-little and the Fushimi rules, which the spatial check has no
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
}

pub fn dispatched_camv(model: &CreasePatternModel) -> DispatchedCamv {
    let vertices = point_line_map(model);
    let through = ThroughLineIndex::build(model);
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
                if is_interior_vertex(&lines) {
                    spatial.push(report_for(point, &lines, &through));
                }
            }
        }
    }

    DispatchedCamv { flat, spatial }
}

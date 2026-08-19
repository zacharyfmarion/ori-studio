//! Solving *any* number of unknown fold angles at one vertex.
//!
//! **Ori Studio native.** Oriedita's creases are always a full ±180 and it has
//! no fold-angle solver of any kind, so nothing here is a divergence and there
//! is nothing upstream to be faithful to. See PORTING.md's Ori Studio native
//! section, and [`crate::folding3d`] for the other module in this position.
//!
//! [`crate::solve_fold_angles`] answers *"these **three** creases may change;
//! what must their fold angles be?"* — Wong, *3d Kawasaki's theorem with
//! quaternions*, §5. Three unknowns against closure's three scalar equations is
//! the exactly-determined case, and it is the only one that module handles.
//!
//! Propagation needs the other arities, because *k is not a property of the
//! pattern — it is a property of a vertex at a moment*, and it falls as
//! neighbours commit. A degree-6 vertex with every crease unknown starts at
//! k = 6; once four are solved from elsewhere it is k = 2 and answerable. That
//! is the whole engine of `implementation-plans/fold-angle-propagation.md`.
//!
//! # What k buys, and what it costs
//!
//! | k | unknowns vs equations | |
//! | --- | --- | --- |
//! | 0 | 0 vs 3 | nothing to solve — a **check**, and the cycle-closure test when propagation arrives twice |
//! | 1 | **over**determined | rarely satisfiable, unique when it is. Measured 100.00% determined over 115,560 real fans |
//! | 2 | **over**determined | same shape; 99.94% on generic 3D angle states |
//! | 3 | exactly determined | delegated to [`crate::solve_fold_angles`] unchanged |
//! | ≥4 | **under**determined | a (k−3)-family. Refused without solving |
//!
//! The k ≥ 4 refusal is structural rather than a cutoff: the closure Jacobian
//! has three columns, so `rank == k` is unreachable and no answer can ever be
//! isolated. Measured over 342,177 rows at k = 4..8, nothing was ever
//! determined and the rank never exceeded 3. Declining to solve is also *more*
//! correct than trying — there are fans where the numeric pass finds no member
//! of a family that provably exists.
//!
//! # Why the arity is not the test
//!
//! Determinacy comes from the **rank of the closure Jacobian**, never from k.
//! [`crate::checks_spatial::vertex_dof`] rejects the naive `n - 3` for the same
//! reason, and names the case: a point sitting mid-way along a straight crease
//! collapses the constraints, and those "are everywhere in a real pattern". At
//! k = 2 the same degeneracy appears as two unknown creases that are collinear
//! through the vertex, where the two rotation axes are parallel and the answer
//! is a one-parameter family rather than a point. [`solve_parallel_pair`] is
//! that arm; without it the forward elimination divides by ~0.
//!
//! # `+180` and `-180` are the same rotation and different creases
//!
//! Do not "fix" this. `R(theta, +180)` and `R(theta, -180)` are the same
//! rotation matrix and *opposite* quaternions, so the solver returns both and
//! cannot choose; [`crate::solve_fold_angles`]'s `lifts` emits both on purpose.
//! They place the paper identically in 3D and differ only in mountain/valley,
//! which means:
//!
//! - they are a **real question**, and [`Determinacy::Branching`] is the honest
//!   verdict — collapsing them would silently pick M or V for the user;
//! - a *folded* preview of the two is identical, so any UI that offers the
//!   choice has to show the crease pattern's colouring, not the fold.
//!
//! Flipping one full-fold crease negates the closure quaternion, so valid
//! alternatives always flip **both** — which is also why the alternative is
//! usually invalid at the *neighbouring* vertex, where only one of the pair is
//! incident. Global context, not a dedupe, is what resolves these.

use crate::checks_spatial::{
    Quat, Vec3, VertexFan, axis_quat, closure_product, crease_quat, cross, dot, incident_lines_at,
    is_interior_vertex, jacobian_rank, norm, quat_conj, quat_mul, quat_residual, quat_rotate,
    vertex_dof,
};
use crate::geometry::{Epsilon, LineColor, Point};
use crate::model::{CreasePatternModel, crease_fold_angle};
use crate::solve_fold_angles::NoSolution;

/// Below this, a quantity that should be zero counts as zero. Same order as
/// [`crate::checks_spatial`]'s transversality gap, for the same reason.
const EPSILON: f64 = 1e-9;

/// Iterations of the damped least-squares refinement.
const REFINE_ITERATIONS: usize = 64;

/// Storage resolution, in degrees. Mirrors
/// [`crate::geometry::FoldMagnitude::UNITS_PER_DEGREE`].
const STORAGE_ULP_DEGREES: f64 = 1e-7;

/// Grids a solved angle is snapped to, coarsest first. Designed geometry lands
/// on the coarse ones exactly, and quantising *before* the residual check is
/// what makes the verdict honest — the number that gets validated is the number
/// that gets written.
const SNAP_GRIDS_DEGREES: [f64; 4] = [1.0, 0.1, 0.01, 0.001];

/// How near two answers must be, in degrees, to count as the same answer.
///
/// **Not the 1e-4 the three-unknown solver uses.** Near a full fold the closure
/// condition is flat enough that a genuine spread of ~1e-3 degrees all clears
/// the acceptance bar, and 1e-4 is too tight to collapse it — measured, 206
/// pairs across the corpus came back sub-degree and indistinguishable, which is
/// not a choice any presentation can offer. Widening to a hundredth of a degree
/// absorbs those without touching anything a user could tell apart.
///
/// This must **not** be widened to 360: `+180` and `-180` differ by exactly that
/// and are a real mountain/valley question. See the module docs.
const DUPLICATE_TOLERANCE_DEGREES: f64 = 0.01;

/// A vertex's incident creases, with the unknown ones **kept**.
///
/// The difference from [`crate::checks_spatial::VertexFan`] is the whole reason
/// this type exists. That one drops a `LineColor::None` crease and flags the fan
/// `Indeterminate::UnassignedCrease`, which is right for a checker — an
/// unassigned crease means the vertex's fold state is unknown, so there is
/// nothing to check. It is wrong for a solver: the crease is still there, its
/// *direction* is known, and its fold angle is precisely the variable being
/// solved for. Dropping it would change the closure product and let an
/// odd-degree vertex close for the wrong reason.
#[derive(Debug, Clone, PartialEq)]
pub struct SolveFan {
    pub point: Point,
    /// `(theta, rho)` in radians, sorted by ascending `theta`. `rho` is `None`
    /// for an unassigned crease.
    pub creases: Vec<(f64, Option<f64>)>,
    /// Document line index per fan position, so an answer can be written back.
    /// Same role as `vertex_fan_at_with_sources`' second return, and it must
    /// stay index-aligned with `creases`.
    pub sources: Vec<usize>,
    /// A segment passes through this point without ending here, so the fan is
    /// missing two rays and no answer from it means anything.
    pub unsplit_junction: bool,
}

impl SolveFan {
    pub fn degree(&self) -> usize {
        self.creases.len()
    }

    /// Fan positions whose fold angle is unknown, ascending.
    pub fn unknown_positions(&self) -> Vec<usize> {
        self.creases
            .iter()
            .enumerate()
            .filter(|(_, (_, rho))| rho.is_none())
            .map(|(index, _)| index)
            .collect()
    }

    /// A [`VertexFan`] with `angles` substituted at `unknowns`, for the shared
    /// closure machinery. Any remaining unknown reads as `0`, so only call this
    /// with every unknown supplied.
    fn as_vertex_fan(&self, unknowns: &[usize], angles: &[f64]) -> VertexFan {
        let mut creases: Vec<(f64, f64)> = self
            .creases
            .iter()
            .map(|(theta, rho)| (*theta, rho.unwrap_or(0.0)))
            .collect();
        for (slot, &position) in unknowns.iter().enumerate() {
            if let (Some(entry), Some(angle)) = (creases.get_mut(position), angles.get(slot)) {
                entry.1 = *angle;
            }
        }
        VertexFan {
            point: self.point,
            creases,
            indeterminate: None,
        }
    }
}

/// Build a [`SolveFan`] at `point`.
///
/// Deliberately parallel to `checks_spatial::vertex_fan_at_with_sources`,
/// including the comparator, so a fan built here and one built there put the
/// same crease at the same position. The two differences are the point:
/// `LineColor::None` stays as an unknown rather than being dropped, and an
/// auxiliary line is skipped because it is not a crease.
pub fn solve_fan_at(model: &CreasePatternModel, point: Point) -> SolveFan {
    let mut entries: Vec<(usize, f64, Option<f64>)> = Vec::new();
    let mut unsplit_junction = false;

    for (index, segment) in model.line_segments.iter().enumerate() {
        if segment.color == LineColor::Cyan3 {
            continue;
        }
        let at_a = point.distance(segment.a) < Epsilon::UNKNOWN_1EN6;
        let at_b = point.distance(segment.b) < Epsilon::UNKNOWN_1EN6;
        if !at_a && !at_b {
            if point_lies_on(point, segment.a, segment.b) {
                unsplit_junction = true;
            }
            continue;
        }
        let rho = match segment.color {
            LineColor::None => None,
            _ => match crease_fold_angle(segment) {
                Some(degrees) => Some(degrees.to_radians()),
                // A border. Present geometrically, but it carries no fold and
                // `is_interior_vertex` will decline this vertex anyway.
                None => continue,
            },
        };
        let other = if at_a { segment.b } else { segment.a };
        let (dx, dy) = (other.x - point.x, other.y - point.y);
        if dx == 0.0 && dy == 0.0 {
            continue;
        }
        entries.push((index, dy.atan2(dx), rho));
    }

    entries.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));

    SolveFan {
        point,
        creases: entries
            .iter()
            .map(|(_, theta, rho)| (*theta, *rho))
            .collect(),
        sources: entries.iter().map(|(index, _, _)| *index).collect(),
        unsplit_junction,
    }
}

/// Is `point` strictly between `a` and `b`, on the segment?
fn point_lies_on(point: Point, a: Point, b: Point) -> bool {
    let span = a.distance(b);
    if span < EPSILON {
        return false;
    }
    (a.distance(point) + point.distance(b) - span).abs() < Epsilon::UNKNOWN_1EN6
}

/// What a vertex's unknowns amount to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Determinacy {
    /// Nothing unknown. The report carries the closure residual, which is the
    /// cycle-closure test when propagation reaches a vertex from two sides.
    Check,
    /// Exactly one answer, and it stands alone. **The only verdict a propagator
    /// may commit.**
    Determined,
    /// Several distinct isolated answers. A real question for the user.
    Branching,
    /// A continuous family, so no answer is *the* answer. Covers k ≥ 4 by arity
    /// and rank-deficient k ≤ 3 by measurement; both reduce to the same
    /// instruction, which is to give one more crease an angle.
    Underdetermined,
    /// No angles make this vertex close.
    Unsolvable,
}

/// One way to make the vertex close.
#[derive(Debug, Clone, PartialEq)]
pub struct KSolution {
    /// `(document line index, signed degrees)`, negative a mountain, already
    /// quantised to storage resolution.
    pub angles: Vec<(usize, f64)>,
    /// Whether this answer stands alone, from `rank == k`.
    pub isolated: bool,
    pub residual_degrees: f64,
    pub jacobian_rank: usize,
}

/// Everything a propagator needs about one vertex and one choice of unknowns.
#[derive(Debug, Clone, PartialEq)]
pub struct KSolveReport {
    /// Isolated first, then nearest-to-current.
    pub solutions: Vec<KSolution>,
    pub isolated_count: usize,
    pub verdict: Determinacy,
    /// Closure residual as the vertex stands, in degrees. Meaningful only when
    /// nothing is unknown — that is [`Determinacy::Check`].
    pub residual_degrees: f64,
    /// Remaining freedom across the whole fan.
    pub vertex_dof: usize,
    pub no_solution: Option<NoSolution>,
}

/// Solve `unknowns` (fan positions, ascending) at `fan`.
///
/// `closed_bar` is the acceptance residual in **radians**; callers pass
/// [`crate::CLOSURE_RESIDUAL_BAR_DEGREES`] converted.
pub fn solve_k(
    model: &CreasePatternModel,
    fan: &SolveFan,
    unknowns: &[usize],
    closed_bar: f64,
) -> KSolveReport {
    let decline = |reason: NoSolution| KSolveReport {
        solutions: Vec::new(),
        isolated_count: 0,
        verdict: Determinacy::Unsolvable,
        residual_degrees: 0.0,
        vertex_dof: 0,
        no_solution: Some(reason),
    };

    if fan.unsplit_junction {
        return decline(NoSolution::Indeterminate);
    }
    if !is_interior_vertex(&incident_lines_at(model, fan.point)) {
        return decline(NoSolution::BoundaryVertex);
    }
    let degree = fan.degree();
    if degree < 3 {
        return decline(NoSolution::NotEnoughCreases);
    }
    if unknowns.iter().any(|position| *position >= degree)
        || unknowns.windows(2).any(|pair| pair[0] >= pair[1])
    {
        return decline(NoSolution::CreaseNotInFan);
    }

    // Nothing unknown: this is a check, and the residual is the answer.
    if unknowns.is_empty() {
        let vertex = fan.as_vertex_fan(&[], &[]);
        return KSolveReport {
            solutions: Vec::new(),
            isolated_count: 0,
            verdict: Determinacy::Check,
            residual_degrees: quat_residual(closure_product(&vertex.creases)).to_degrees(),
            vertex_dof: vertex_dof(&vertex),
            no_solution: None,
        };
    }

    // k >= 4 is underdetermined by construction: the closure Jacobian has three
    // columns, so `rank == k` cannot hold. Declining without solving is both the
    // 1.1x-2.4x saving and the more correct answer.
    if unknowns.len() >= 4 {
        let vertex = fan.as_vertex_fan(&[], &[]);
        return KSolveReport {
            solutions: Vec::new(),
            isolated_count: 0,
            verdict: Determinacy::Underdetermined,
            residual_degrees: 0.0,
            vertex_dof: vertex_dof(&vertex),
            no_solution: None,
        };
    }

    let seeds = closed_form_seeds(fan, unknowns);
    let mut accepted: Vec<KSolution> = Vec::new();
    for seed in seeds {
        let refined = refine(fan, unknowns, &seed);
        let Some(snapped) =
            snap_to_the_coarsest_grid_that_closes(fan, unknowns, &refined, closed_bar)
        else {
            continue;
        };
        let residual = residual_degrees_of(fan, unknowns, &snapped);
        if residual.to_radians() > closed_bar {
            continue;
        }
        let rank = rank_at(fan, unknowns, &snapped);
        let candidate = KSolution {
            angles: unknowns
                .iter()
                .zip(&snapped)
                .map(|(position, degrees)| (fan.sources[*position], *degrees))
                .collect(),
            isolated: rank == unknowns.len(),
            residual_degrees: residual,
            jacobian_rank: rank,
        };
        if !accepted.iter().any(|have| same_answer(have, &candidate)) {
            accepted.push(candidate);
        }
    }

    let current: Vec<f64> = unknowns
        .iter()
        .map(|position| fan.creases[*position].1.unwrap_or(0.0).to_degrees())
        .collect();
    accepted.sort_by(|left, right| {
        right
            .isolated
            .cmp(&left.isolated)
            .then_with(|| {
                distance_from(left, &current)
                    .partial_cmp(&distance_from(right, &current))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| {
                left.angles[0]
                    .1
                    .partial_cmp(&right.angles[0].1)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
    });

    let isolated_count = accepted.iter().filter(|entry| entry.isolated).count();
    // THE COMMIT RULE. The first arm is the guard that carries the safety: any
    // family member in the set poisons the whole verdict, because a point on a
    // curve is not an alternative to a point off it. Rewriting this as a match
    // on `(isolated_count, len)` silently drops that guard — invisible on every
    // committed fixture, and reachable on near-degenerate fans, where it turns a
    // "give me another angle" stall into a menu of answers 6e-4 degrees apart.
    let verdict = if accepted.is_empty() {
        Determinacy::Unsolvable
    } else if isolated_count < accepted.len() {
        Determinacy::Underdetermined
    } else if accepted.len() == 1 {
        Determinacy::Determined
    } else {
        Determinacy::Branching
    };

    KSolveReport {
        solutions: accepted,
        isolated_count,
        verdict,
        residual_degrees: 0.0,
        vertex_dof: vertex_dof(&fan.as_vertex_fan(&[], &[])),
        no_solution: (verdict == Determinacy::Unsolvable).then_some(NoSolution::Unreachable),
    }
}

/// How far this moves the unknowns from where they are, as the largest single
/// change in degrees.
fn distance_from(solution: &KSolution, current: &[f64]) -> f64 {
    solution
        .angles
        .iter()
        .zip(current)
        .map(|((_, solved), now)| (solved - now).abs())
        .fold(0.0_f64, f64::max)
}

/// Two answers a user could not tell apart. See [`DUPLICATE_TOLERANCE_DEGREES`]
/// — and note that `+180` and `-180` are 360 apart and deliberately survive.
fn same_answer(left: &KSolution, right: &KSolution) -> bool {
    left.angles
        .iter()
        .zip(&right.angles)
        .all(|((_, a), (_, b))| (a - b).abs() < DUPLICATE_TOLERANCE_DEGREES)
}

// ---------------------------------------------------------------------------
// The reduction, and the closed forms
// ---------------------------------------------------------------------------

/// `R_k ... R_1 = R_target` about known axes, in the unknowns' cyclic order.
///
/// The closure product is invariant under cyclic rotation, so rotate it to start
/// just after the last unknown, then move each known run to the right with
/// `xy = (xyx^-1)x`. Conjugation preserves the scalar part, so every unknown
/// keeps its own unknown angle and merely acquires a **known, out-of-plane**
/// axis. This is exactly what `solve_fold_angles::branch_angles` builds inline
/// for k = 3, generalised to any k.
#[derive(Debug, Clone)]
struct Reduced {
    axes: Vec<Vec3>,
    target: Quat,
}

fn reduce(fan: &SolveFan, unknowns: &[usize]) -> Reduced {
    let degree = fan.degree();
    let k = unknowns.len();
    let runs: Vec<Quat> = (0..k)
        .map(|j| {
            let from = if j == 0 {
                unknowns[k - 1]
            } else {
                unknowns[j - 1]
            };
            product_of(fan, &between(degree, from, unknowns[j]))
        })
        .collect();

    let mut axes = vec![[0.0_f64; 3]; k];
    let mut prefix = (1.0, 0.0, 0.0, 0.0);
    for j in (0..k).rev() {
        axes[j] = quat_rotate(prefix, direction(fan, unknowns[j]));
        prefix = quat_mul(prefix, runs[j]);
    }
    Reduced {
        axes,
        target: quat_conj(prefix),
    }
}

/// Fan indices strictly after `from`, walking forward cyclically, up to before
/// `to`. Empty when the two are adjacent.
fn between(degree: usize, from: usize, to: usize) -> Vec<usize> {
    let mut out = Vec::new();
    let mut index = (from + 1) % degree;
    loop {
        if index == to {
            break;
        }
        out.push(index);
        index = (index + 1) % degree;
        if out.len() > degree {
            break;
        }
    }
    out
}

/// The product of the **known** creases at `indices`. A run never contains an
/// unknown, by construction of [`reduce`].
fn product_of(fan: &SolveFan, indices: &[usize]) -> Quat {
    let mut product = (1.0, 0.0, 0.0, 0.0);
    for &index in indices {
        let (theta, rho) = fan.creases[index];
        product = quat_mul(crease_quat(theta, rho.unwrap_or(0.0)), product);
    }
    product
}

fn direction(fan: &SolveFan, index: usize) -> Vec3 {
    let theta = fan.creases[index].0;
    [theta.cos(), theta.sin(), 0.0]
}

fn reject(v: Vec3, axis: Vec3) -> Vec3 {
    let along = dot(v, axis);
    [
        v[0] - along * axis[0],
        v[1] - along * axis[1],
        v[2] - along * axis[2],
    ]
}

fn wrap_angle(angle: f64) -> f64 {
    (angle + std::f64::consts::PI).rem_euclid(std::f64::consts::TAU) - std::f64::consts::PI
}

/// The representable fold angles with this rotation. One, except at a full fold,
/// where `+180` and `-180` are the same rotation and opposite quaternions — see
/// the module docs on why both must survive.
fn lifts(rho: f64) -> [f64; 2] {
    if (rho.abs() - std::f64::consts::PI).abs() < 1e-7 {
        [std::f64::consts::PI, -std::f64::consts::PI]
    } else {
        [rho, rho]
    }
}

/// The rotation angle of `q` about `axis`, when `q` is one.
fn read_angle_about(q: Quat, axis: Vec3) -> Option<f64> {
    let (w, x, y, z) = q;
    let vector = [x, y, z];
    if norm(reject(vector, axis)) > 1e-6 {
        return None;
    }
    Some(wrap_angle(2.0 * dot(vector, axis).atan2(w)))
}

/// `R_1 = R_target` about the known axis `u`. Overdetermined: two of the three
/// scalar conditions constrain the *knowns*, so a solution exists only when
/// `R_target`'s axis is already parallel to `u`.
fn solve_one(reduced: &Reduced) -> Vec<Vec<f64>> {
    let u = reduced.axes[0];
    let (w, x, y, z) = reduced.target;
    let vector = [x, y, z];
    let rho = wrap_angle(2.0 * dot(vector, u).atan2(w));
    let mut out: Vec<Vec<f64>> = Vec::new();
    for lift in lifts(rho) {
        if !out.iter().any(|have| (have[0] - lift).abs() < 1e-12) {
            out.push(vec![lift]);
        }
    }
    out
}

/// `R_2 R_1 = R_target` about two known, **non-parallel** axes.
///
/// Both eliminations are run. They solve the same system from opposite ends and
/// degenerate on different inputs, so trying both is what keeps the seed set
/// non-empty where one of them divides by ~0.
fn solve_two(reduced: &Reduced) -> Vec<Vec<f64>> {
    let u1 = reduced.axes[0];
    let u2 = reduced.axes[1];
    let target = reduced.target;
    let mut out: Vec<Vec<f64>> = Vec::new();
    let mut push = |candidate: Vec<f64>| {
        if !out.iter().any(|have: &Vec<f64>| {
            have.iter()
                .zip(&candidate)
                .all(|(a, b)| (a - b).abs() < 1e-12)
        }) {
            out.push(candidate);
        }
    };

    // Forward: apply both sides to u_1, which R_1 fixes, leaving only R_2.
    let moved = quat_rotate(target, u1);
    let start = reject(u1, u2);
    let finish = reject(moved, u2);
    if norm(start) > EPSILON && norm(finish) > EPSILON {
        let rho2 = wrap_angle(dot(u2, cross(start, finish)).atan2(dot(start, finish)));
        for rho2 in lifts(rho2) {
            let q1 = quat_mul(quat_conj(axis_quat(u2, rho2)), target);
            if let Some(rho1) = read_angle_about(q1, u1) {
                for rho1 in lifts(rho1) {
                    push(vec![rho1, rho2]);
                }
            }
        }
    }

    // Backward: `R_1^-1 u_2 = R_target^-1 u_2`. Same condition, other degeneracy.
    let pulled = quat_rotate(quat_conj(target), u2);
    let start = reject(u2, u1);
    let finish = reject(pulled, u1);
    if norm(start) > EPSILON && norm(finish) > EPSILON {
        let rho1 = wrap_angle(-dot(u1, cross(start, finish)).atan2(dot(start, finish)));
        for rho1 in lifts(rho1) {
            let q2 = quat_mul(target, quat_conj(axis_quat(u1, rho1)));
            if let Some(rho2) = read_angle_about(q2, u2) {
                for rho2 in lifts(rho2) {
                    push(vec![rho1, rho2]);
                }
            }
        }
    }

    out
}

/// The collinear arm of k = 2: the two unknown creases run through the vertex in
/// a straight line, so their rotation axes are parallel, the two rotations
/// commute, and the solution set is the **line** `rho_2 = total -/+ rho_1`
/// rather than a point.
///
/// `checks_spatial`'s `vertex_dof` singles this case out by name and says it is
/// "everywhere in a real pattern", so the forward elimination in [`solve_two`]
/// would divide by ~0 here rather than rarely. Sampling the line gives the
/// refinement something to start from; the rank test downstream is what reports
/// it honestly as a family.
fn solve_parallel_pair(reduced: &Reduced) -> Vec<Vec<f64>> {
    let u1 = reduced.axes[0];
    let u2 = reduced.axes[1];
    let sign = if dot(u1, u2) >= 0.0 { 1.0 } else { -1.0 };
    let (w, x, y, z) = reduced.target;
    let total = wrap_angle(2.0 * dot([x, y, z], u2).atan2(w));

    let mut out = Vec::new();
    for step in -12_i32..=12 {
        let rho1 = f64::from(step) * (std::f64::consts::PI / 12.0);
        let rho2 = total - sign * rho1;
        if rho2.abs() > std::f64::consts::PI + 1e-9 {
            continue;
        }
        out.push(vec![
            rho1,
            rho2.clamp(-std::f64::consts::PI, std::f64::consts::PI),
        ]);
    }
    out
}

/// Every starting point the refinement is given: the closed-form branches, the
/// unknowns' current angles, and a coarse lattice.
fn closed_form_seeds(fan: &SolveFan, unknowns: &[usize]) -> Vec<Vec<f64>> {
    let reduced = reduce(fan, unknowns);
    let mut seeds = match unknowns.len() {
        1 => solve_one(&reduced),
        2 => {
            let parallel = norm(cross(reduced.axes[0], reduced.axes[1])) < 1e-7;
            if parallel {
                solve_parallel_pair(&reduced)
            } else {
                solve_two(&reduced)
            }
        }
        // k = 3 is exactly determined and already solved, correctly and with
        // four transcription corrections measured rather than read, by
        // `solve_fold_angles`. Delegating keeps one copy of that math.
        _ => Vec::new(),
    };

    seeds.push(
        unknowns
            .iter()
            .map(|position| fan.creases[*position].1.unwrap_or(0.0))
            .collect(),
    );
    for scale in [0.0, std::f64::consts::FRAC_PI_2, std::f64::consts::PI] {
        seeds.push(vec![scale; unknowns.len()]);
        seeds.push(vec![-scale; unknowns.len()]);
    }
    seeds
}

// ---------------------------------------------------------------------------
// Numeric refinement and acceptance
// ---------------------------------------------------------------------------

/// The closure vector part with `angles` substituted at `unknowns`.
fn closure_with(fan: &SolveFan, unknowns: &[usize], angles: &[f64]) -> [f64; 3] {
    let vertex = fan.as_vertex_fan(unknowns, angles);
    let (_, x, y, z) = closure_product(&vertex.creases);
    [x, y, z]
}

fn residual_degrees_of(fan: &SolveFan, unknowns: &[usize], degrees: &[f64]) -> f64 {
    let radians: Vec<f64> = degrees.iter().map(|value| value.to_radians()).collect();
    let vertex = fan.as_vertex_fan(unknowns, &radians);
    quat_residual(closure_product(&vertex.creases)).to_degrees()
}

/// Central-difference Jacobian of the closure vector part, `k` rows of 3.
///
/// The step is 1e-5 rather than 1e-7 deliberately: the smaller one made the rank
/// classification noisy, which is the measurement `solve_fold_angles` records.
fn closure_jacobian(fan: &SolveFan, unknowns: &[usize], angles: &[f64]) -> Vec<[f64; 3]> {
    const H: f64 = 1e-5;
    unknowns
        .iter()
        .enumerate()
        .map(|(slot, _)| {
            let mut up = angles.to_vec();
            let mut down = angles.to_vec();
            up[slot] += H;
            down[slot] -= H;
            let a = closure_with(fan, unknowns, &up);
            let b = closure_with(fan, unknowns, &down);
            [
                (a[0] - b[0]) / (2.0 * H),
                (a[1] - b[1]) / (2.0 * H),
                (a[2] - b[2]) / (2.0 * H),
            ]
        })
        .collect()
}

fn rank_at(fan: &SolveFan, unknowns: &[usize], degrees: &[f64]) -> usize {
    let radians: Vec<f64> = degrees.iter().map(|value| value.to_radians()).collect();
    jacobian_rank(&closure_jacobian(fan, unknowns, &radians))
}

/// Damped least squares on the closure vector part, in the `k` unknown angles.
///
/// `k` is 1 or 2 here, so the normal equations are a 1x1 or 2x2 solve and there
/// is no need for the 3x3 elimination the three-unknown solver carries.
fn refine(fan: &SolveFan, unknowns: &[usize], seed: &[f64]) -> Vec<f64> {
    let k = unknowns.len();
    let mut angles = seed.to_vec();
    let mut lambda = 1e-3_f64;

    for _ in 0..REFINE_ITERATIONS {
        let residual = closure_with(fan, unknowns, &angles);
        let error = residual.iter().map(|value| value * value).sum::<f64>();
        if error < 1e-24 {
            break;
        }
        let jacobian = closure_jacobian(fan, unknowns, &angles);

        // Normal equations: (J J^T + lambda I) step = -J r, with J stored as k
        // rows of 3.
        let mut normal = vec![vec![0.0_f64; k]; k];
        let mut rhs = vec![0.0_f64; k];
        for row in 0..k {
            for column in 0..k {
                normal[row][column] = dot(jacobian[row], jacobian[column]);
            }
            normal[row][row] += lambda;
            rhs[row] = -dot(jacobian[row], residual);
        }
        let Some(step) = solve_small(&mut normal, &mut rhs) else {
            break;
        };

        let trial: Vec<f64> = angles
            .iter()
            .zip(&step)
            .map(|(angle, delta)| wrap_angle(angle + delta))
            .collect();
        let trial_residual = closure_with(fan, unknowns, &trial);
        let trial_error = trial_residual
            .iter()
            .map(|value| value * value)
            .sum::<f64>();
        if trial_error < error {
            angles = trial;
            lambda = (lambda * 0.5).max(1e-12);
        } else {
            lambda *= 4.0;
            if lambda > 1e12 {
                break;
            }
        }
    }
    angles
}

/// Gaussian elimination with partial pivoting on a small dense system.
fn solve_small(matrix: &mut [Vec<f64>], rhs: &mut [f64]) -> Option<Vec<f64>> {
    let n = rhs.len();
    for column in 0..n {
        let pivot = (column..n).max_by(|a, b| {
            matrix[*a][column]
                .abs()
                .partial_cmp(&matrix[*b][column].abs())
                .unwrap_or(std::cmp::Ordering::Equal)
        })?;
        if matrix[pivot][column].abs() < 1e-15 {
            return None;
        }
        matrix.swap(column, pivot);
        rhs.swap(column, pivot);
        for row in (column + 1)..n {
            let factor = matrix[row][column] / matrix[column][column];
            // `split_at_mut` so the pivot row and the row being eliminated can be
            // held at once; the alternative is cloning the pivot row per step.
            let (upper, lower) = matrix.split_at_mut(row);
            for (target, pivot_value) in lower[0].iter_mut().zip(upper[column].iter()).skip(column)
            {
                *target -= factor * pivot_value;
            }
            rhs[row] -= factor * rhs[column];
        }
    }
    let mut out = vec![0.0_f64; n];
    for row in (0..n).rev() {
        let known: f64 = matrix[row]
            .iter()
            .zip(out.iter())
            .skip(row + 1)
            .map(|(coefficient, value)| coefficient * value)
            .sum();
        out[row] = (rhs[row] - known) / matrix[row][row];
    }
    Some(out)
}

/// `radians` in degrees, quantised to storage resolution, or `None` when it is
/// outside what a crease can carry.
fn quantise_degrees(radians: f64) -> Option<f64> {
    let degrees = radians.to_degrees();
    if !degrees.is_finite() || degrees.abs() > 180.0 + 1e-9 {
        return None;
    }
    let clamped = degrees.clamp(-180.0, 180.0);
    Some((clamped / STORAGE_ULP_DEGREES).round() * STORAGE_ULP_DEGREES)
}

/// The coarsest grid the answer can be snapped to and still close.
///
/// Designed geometry lands on the coarse grids exactly, and snapping recovers
/// the round number the designer meant rather than a value one ULP away from it.
/// Quantising *before* validating is what makes the verdict honest.
fn snap_to_the_coarsest_grid_that_closes(
    fan: &SolveFan,
    unknowns: &[usize],
    radians: &[f64],
    closed_bar: f64,
) -> Option<Vec<f64>> {
    let exact: Option<Vec<f64>> = radians
        .iter()
        .map(|value| quantise_degrees(*value))
        .collect();
    let exact = exact?;

    for grid in SNAP_GRIDS_DEGREES {
        let snapped: Vec<f64> = exact
            .iter()
            .map(|degrees| (degrees / grid).round() * grid)
            .collect();
        if snapped.iter().any(|degrees| degrees.abs() > 180.0 + 1e-9) {
            continue;
        }
        if residual_degrees_of(fan, unknowns, &snapped).to_radians() <= closed_bar {
            return Some(snapped);
        }
    }
    Some(exact)
}

#[cfg(test)]
mod tests {
    use super::{Determinacy, SolveFan, solve_fan_at, solve_k};
    use crate::CLOSURE_RESIDUAL_BAR_DEGREES;
    use crate::geometry::{LineColor, LineSegment, Point};
    use crate::io::fold::import_fold_document;
    use crate::model::CreasePatternModel;
    use treemaker_fold::FoldDocument;

    fn bar() -> f64 {
        CLOSURE_RESIDUAL_BAR_DEGREES.to_radians()
    }

    fn kabuto() -> CreasePatternModel {
        let text = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../tests/fixtures/flat-folder/kabuto.fold"),
        )
        .expect("fixture");
        let document: FoldDocument = serde_json::from_str(&text).expect("fold json");
        import_fold_document(&document).expect("import")
    }

    /// Every interior vertex of a real pattern, one crease blanked at a time.
    /// k = 1 was measured at 100.00% determined over 115,560 fans; this pins the
    /// property on a committed fixture so a regression is a red test rather than
    /// a re-measurement.
    #[test]
    fn one_unknown_is_always_determined_and_always_right() {
        let model = kabuto();
        let mut attempted = 0;
        for index in 0..model.line_segments.len() {
            let segment = model.line_segments[index].clone();
            if !matches!(segment.color, LineColor::Red1 | LineColor::Blue2) {
                continue;
            }
            for point in [segment.a, segment.b] {
                let truth = solve_fan_at(&model, point);
                if truth.creases.len() < 3 || truth.creases.iter().any(|(_, rho)| rho.is_none()) {
                    continue;
                }
                let mut blanked = model.clone();
                blanked.line_segments[index] = segment.with_line_color(LineColor::None);
                let fan = solve_fan_at(&blanked, point);
                let unknowns = fan.unknown_positions();
                if unknowns.len() != 1 {
                    continue;
                }
                let report = solve_k(&blanked, &fan, &unknowns, bar());
                if report.no_solution.is_some() {
                    continue;
                }
                attempted += 1;
                assert_eq!(
                    report.verdict,
                    Determinacy::Determined,
                    "k=1 at {point:?} was not determined"
                );
                let recovered = report.solutions[0].angles[0].1;
                let expected = crate::model::crease_fold_angle(&segment).expect("crease");
                assert!(
                    (recovered - expected).abs() < 1e-3,
                    "k=1 recovered {recovered} not {expected} at {point:?}"
                );
            }
        }
        assert!(
            attempted >= 8,
            "expected real k=1 coverage, got {attempted}"
        );
    }

    /// **The correction that matters most, as a test.** At a full fold `+180`
    /// and `-180` are the same rotation and opposite mountain/valley, so both
    /// must survive as separate answers and the verdict must be a question.
    /// Collapsing them would silently choose M or V for the user.
    #[test]
    fn plus_and_minus_180_both_survive_as_a_real_question() {
        let model = kabuto();
        for index in 0..model.line_segments.len() {
            let segment = model.line_segments[index].clone();
            if segment.color != LineColor::Red1 {
                continue;
            }
            for point in [segment.a, segment.b] {
                let fan = solve_fan_at(&model, point);
                if fan.creases.len() < 4 {
                    continue;
                }
                let Some(position) = fan.sources.iter().position(|source| *source == index) else {
                    continue;
                };
                // Blank this crease and one neighbour, both full folds.
                let partner = fan
                    .creases
                    .iter()
                    .enumerate()
                    .find(|(slot, (_, rho))| {
                        *slot != position
                            && rho.is_some_and(|value| {
                                (value.abs() - std::f64::consts::PI).abs() < 1e-9
                            })
                    })
                    .map(|(slot, _)| slot);
                let Some(partner) = partner else { continue };
                let mut blanked = model.clone();
                for slot in [position, partner] {
                    let source = fan.sources[slot];
                    blanked.line_segments[source] =
                        blanked.line_segments[source].with_line_color(LineColor::None);
                }
                let solve = solve_fan_at(&blanked, point);
                let unknowns = solve.unknown_positions();
                if unknowns.len() != 2 {
                    continue;
                }
                let report = solve_k(&blanked, &solve, &unknowns, bar());
                if report.solutions.len() < 2 {
                    continue;
                }
                assert_eq!(
                    report.verdict,
                    Determinacy::Branching,
                    "two full-fold spellings must be a question, not a commit"
                );
                let signs: Vec<f64> = report
                    .solutions
                    .iter()
                    .map(|solution| solution.angles[0].1.signum())
                    .collect();
                assert!(
                    signs.iter().any(|sign| *sign > 0.0) && signs.iter().any(|sign| *sign < 0.0),
                    "both mountain and valley spellings must be offered, got {signs:?}"
                );
                return;
            }
        }
        panic!("no full-fold k=2 vertex found in the fixture");
    }

    /// The arity refusal, which is structural rather than a cutoff.
    #[test]
    fn four_unknowns_are_refused_without_solving() {
        let model = kabuto();
        for index in 0..model.line_segments.len() {
            let segment = model.line_segments[index].clone();
            for point in [segment.a, segment.b] {
                let fan = solve_fan_at(&model, point);
                if fan.creases.len() < 4 {
                    continue;
                }
                let unknowns: Vec<usize> = (0..4).collect();
                let report = solve_k(&model, &fan, &unknowns, bar());
                if report.no_solution.is_some() {
                    continue;
                }
                assert_eq!(report.verdict, Determinacy::Underdetermined);
                assert!(report.solutions.is_empty());
                return;
            }
        }
    }

    /// An unassigned crease must stay **in** the fan as an unknown. Dropping it,
    /// which the checker's fan deliberately does, would change the closure
    /// product and let an odd-degree vertex close for the wrong reason.
    #[test]
    fn an_unassigned_crease_stays_in_the_fan() {
        let mut model = CreasePatternModel::default();
        model.line_segments.clear();
        let centre = Point::new(0.0, 0.0);
        for (index, (x, y)) in [(1.0, 0.0), (0.0, 1.0), (-1.0, 0.0), (0.0, -1.0)]
            .into_iter()
            .enumerate()
        {
            let color = if index == 0 {
                LineColor::None
            } else {
                LineColor::Red1
            };
            model
                .line_segments
                .push(LineSegment::new(centre, Point::new(x, y)).with_line_color(color));
        }
        let fan: SolveFan = solve_fan_at(&model, centre);
        assert_eq!(fan.degree(), 4, "the unassigned crease must not be dropped");
        assert_eq!(fan.unknown_positions().len(), 1);
    }

    /// A vertex with nothing unknown is a check, and its residual is the
    /// cycle-closure test propagation relies on.
    #[test]
    fn no_unknowns_reports_a_check() {
        let model = kabuto();
        for segment in model.line_segments.clone() {
            for point in [segment.a, segment.b] {
                let fan = solve_fan_at(&model, point);
                if fan.creases.len() < 3 || fan.creases.iter().any(|(_, rho)| rho.is_none()) {
                    continue;
                }
                let report = solve_k(&model, &fan, &[], bar());
                if report.no_solution.is_some() {
                    continue;
                }
                assert_eq!(report.verdict, Determinacy::Check);
                assert!(
                    report.residual_degrees < 1e-6,
                    "a shipped fixture vertex should close, got {}",
                    report.residual_degrees
                );
                return;
            }
        }
    }
}

//! Solving three fold angles so a vertex closes, without moving anything.
//!
//! [`crate::solve_spatial`] answers *"where does one more crease go so this
//! vertex closes?"* — Wong, *3d Kawasaki's theorem with quaternions*, §4. This
//! answers the other repair: *"these three creases may change; what must their
//! fold angles be?"* — §5 of the same paper. The geometry is untouched, so the
//! edit cannot invalidate anything that depends on where the creases are.
//!
//! The two differ in a way that decides how useful each one is:
//!
//! | | §4, insert a crease | §5, here |
//! | --- | --- | --- |
//! | unknowns vs constraints | 2 vs 3 — **over**determined | 3 vs 3 — **exactly** determined |
//! | when it answers | codimension 1; needs snapped geometry | an open region; answers on freely-drawn vertices too |
//!
//! §4 finds nothing on a freely-angled vertex (0 completions in 20,000 random
//! fans). §5 answers for 25-38% of randomly chosen triples, and on 49% (degree
//! 4) to 88% (degree 8) of freely-angled vertices *some* triple works. It is the
//! first solver in this family that helps someone who drew by hand.
//!
//! # The solve
//!
//! Pick three creases from the fan. The closure product is invariant under
//! cyclic rotation (`XY = 1` implies `YX = 1`), so rotate it to start just after
//! the last of the three:
//!
//! ```text
//! q_c Q_3 q_b Q_2 q_a Q_1 = 1
//! Q_1 = knowns between c and a   Q_2 = between a and b   Q_3 = between b and c
//! ```
//!
//! Move the known runs to the right with `xy = (xyx^-1)x`. Conjugation preserves
//! the scalar part, so each unknown keeps its own unknown angle and merely
//! acquires a **known, out-of-plane axis**:
//!
//! ```text
//! q_c q~_b q~~_a = Q_target,  Q_target = Q_1^-1 Q_2^-1 Q_3^-1
//! u_c = v_c     u_b = R_3 v_b     u_a = R_3 R_2 v_a
//! ```
//!
//! Strip the outer two (`u_c^T R_c = u_c^T`, `R_a u_a = u_a`) to isolate `rho_b`
//! as `A cos rho_b + B sin rho_b + C = 0`, then `rho_c` as the rotation about
//! `u_c` carrying `R_b u_a` onto `R_target u_a`, then read `rho_a` back off
//! `q~~_a = q~_b^-1 q_c^-1 Q_target`.
//!
//! The paper works in rotation matrices; every quantity above is a dot or cross
//! product of vectors [`quat_rotate`] already produces, so there is no matrix
//! code here.
//!
//! # Four corrections to the paper
//!
//! Each fails *silently* if implemented as printed, and each was caught by
//! measurement rather than by reading.
//!
//! - **Eq. 46 reverses the product order.** Eq. 45 has `R_c R_b R_a = R_target`;
//!   eq. 46 prints `R_a R_b R_c`. Eq. 47's elimination only works for the first
//!   — stripping `R_c` needs it leftmost and `R_a` rightmost. (The §4 port had
//!   to correct eq. 35 the same way. The derivations are sound; the
//!   transcriptions are not.)
//! - **Eq. 55's Weierstrass substitution has a pole at the most common origami
//!   angle.** `t = tan(rho_b/2)` diverges at `rho_b = +/-180` and the quadratic
//!   degenerates to linear, throwing that root away. [`branch_angles`] solves
//!   `sqrt(A^2+B^2) cos(rho - phi) = -C` instead: identical algebra, same
//!   existence test, no pole.
//! - **Eq. 77 loses the sign of `rho_a`.** `2 arctan(|v|/s)` is non-negative, so
//!   every solved `rho_a` would come out a valley. The sign is whether the
//!   vector part points along `+u_a` or `-u_a`, so it is `2 atan2(v . u_a, s)`
//!   — and `s < 0` is not a convention to normalise away, it means this branch
//!   needs `|rho_a| > 180`, which no crease can do.
//! - **The solve happens in SO(3), which is blind to mountain/valley at a full
//!   fold.** `rho = +180` and `rho = -180` are the same rotation matrix and
//!   *opposite* quaternions. This is the `2*acos(|w|)` trap of
//!   [`crate::checks_spatial`] in a new place: wrapping roots into `[-pi, pi)`
//!   silently converted full valleys to full mountains and held recovery on
//!   known-good vertices to 39%. [`lifts`] offers both signs at a full fold and
//!   lets the closure residual decide; that alone took recovery to 58%.
//!
//! # Why there is a numerical stage at all
//!
//! Correcting all four still left a third of known-good vertices unrecovered,
//! and the decisive measurement was the **rank of the closure Jacobian in the
//! three chosen angles, evaluated at the known answer**:
//!
//! | | recovered | missed |
//! | --- | --- | --- |
//! | rank 3 (isolated solution) | 192/192, 1280/1280, 1128/1128 at degrees 4, 5, 6 | **none, at any degree** |
//! | rank < 3 (a curve of solutions) | 25-59% | the rest |
//!
//! There is not one rank-3 miss. The closed form is exact and complete wherever
//! the solution is isolated; every failure is a triple whose creases do not
//! independently control closure, where the answer is a one-parameter *family*
//! and an elimination built to return points has nothing to return.
//!
//! And rank deficiency is not exotic — it is a **snapped-geometry** phenomenon,
//! which is to say it is the workflow this feature exists for. Rank 3 covers
//! 100% of freely-angled fans at every degree, but only 21.7% / 50.0% / 28.7% /
//! 45.6% of triples on designed 45-degree-grid fans at degrees 4 to 7.
//!
//! So the closed form is used for what only it can do — enumerating the finitely
//! many branches — and a damped least-squares pass seeded from those branches,
//! from the creases' current angles, and from a fixed lattice covers the rest.
//! Measured on corrupted designed vertices, that takes the repair rate from
//! 48-70% to 99-100%.
//!
//! Every candidate from either stage is accepted only after being **quantised to
//! storage resolution** and checked against
//! [`crate::checks_spatial::vertex_closure_residual`]. Quantising first is what
//! makes the verdict honest: the number that gets validated is the number that
//! gets written.

use crate::checks_spatial::{
    Quat, VertexFan, axis_quat, closure_product, crease_quat, cross, dot, incident_lines_at,
    is_interior_vertex, jacobian_rank, norm, quat_conj, quat_mul, quat_residual, quat_rotate,
    vertex_closure_residual, vertex_dof,
};
use crate::geometry::{FoldMagnitude, LineColor, Point};
use crate::model::CreasePatternModel;

/// Below this, a quantity that should be zero counts as zero. The same order as
/// [`crate::checks_spatial`]'s transversality gap, for the same reason: it
/// separates float noise from a genuine geometric difference.
const EPSILON: f64 = 1e-9;

/// How far `|C|` may exceed `sqrt(A^2+B^2)` and still count as a real root.
///
/// **Not slack for its own sake.** Designed geometry lands on the tangency case
/// `|C| = R` *systematically* — a 45-degree-grid vertex with angles from
/// `{+/-90, +/-180}` produced `A = -0.5, B = 0, C = -0.5` exactly — and there a
/// one-ulp overshoot reads as "no solution" on a vertex that plainly closes.
/// Anything admitted here still has to clear the closure residual afterwards, so
/// this widens what is *tried*, never what is *accepted*.
const TANGENCY_TOLERANCE: f64 = 1e-9;

/// Iterations of the damped least-squares refinement. Convergence from a
/// closed-form seed is immediate; the budget is for the lattice seeds, which
/// start far away.
const REFINE_ITERATIONS: usize = 64;

/// One way to make the vertex close.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AngleSolution {
    /// The three creases and their solved angles: `(document line index, signed
    /// degrees)`, with negative a mountain. Already quantised to
    /// [`FoldMagnitude`]'s resolution, so these are the values that will be
    /// stored rather than values that will be rounded on the way in.
    pub creases: [(usize, f64); 3],
    /// Whether this solution stands alone.
    ///
    /// `false` means the closure Jacobian is rank-deficient here, so the
    /// solution lies on a continuous family and this is one arbitrary member of
    /// infinitely many. It must not be counted in an "N solutions" tally and it
    /// must not be applied without being asked for — a straight crease through a
    /// point with a spur produced members at 8.9, 34.7, 48.5, 107.0 and 120.8
    /// degrees from different seeds, all of them valid.
    pub isolated: bool,
    /// Closure residual after applying, in degrees.
    pub residual_degrees: f64,
    /// Whether this is the state the three creases are already in.
    ///
    /// A vertex that already closes has its own angles as one solution and the
    /// vertex popped inside out as the other — both real answers, and telling
    /// them apart is the difference between "here are two options" and "here is
    /// yours, and here is the alternative".
    pub is_current: bool,
    /// Per slot, whether this solution folds that crease **against** an explicit
    /// direction hint.
    ///
    /// # The hint does not constrain the solve
    ///
    /// A hint is the user saying *"I know this one is a valley, I just don't
    /// know how far"*. That is a belief about the crease, not a fact about the
    /// geometry — and a vertex closes the ways it closes. Filtering the answer
    /// set by it would mean declining a vertex that plainly closes because the
    /// only way it closes is one the user did not expect, which is the
    /// substitution this crate refuses everywhere else. Measured on the reported
    /// failure case, the hint would have removed one of three real branches.
    ///
    /// Nor does it reorder them. The order is nearest-to-current and that is a
    /// statement about the document; a second sort key that outranked it would
    /// make "step to the next answer" mean two things at once.
    ///
    /// # What it does earn is a say
    ///
    /// Applying a contradicting solution overwrites the hint with the opposite
    /// direction — `with_line_color` clears it, because the invariant forbids a
    /// hint on a decided crease — and the user gets no second chance to notice.
    /// So the answer carries the conflict and the surface shows it before Apply.
    ///
    /// Always `[false; 3]` out of [`solve_fold_angles`], which is handed a
    /// [`VertexFan`] and so has no hints to read; [`vertex_angle_solutions`]
    /// fills it in from the document.
    pub contradicts_hint: [bool; 3],
}

impl AngleSolution {
    /// The line colour crease `slot` must take. Direction is part of the answer:
    /// closing the vertex can require a mountain to become a valley, and the
    /// user nominated these three as changeable.
    pub fn line_color(&self, slot: usize) -> LineColor {
        if self.creases[slot].1 < 0.0 {
            LineColor::Red1
        } else {
            LineColor::Blue2
        }
    }

    /// The stored magnitude, with 180 normalised to `None` as everywhere else.
    ///
    /// The `filter` is not a dropped case: absent **means** 180, so clearing the
    /// field and setting a full fold are the same write, and this mirrors what
    /// [`crate::geometry::LineSegment::with_fold_magnitude`] does on the way in
    /// so that what this predicts is what the commit stores. Pinned by
    /// `solutions_close_at_the_resolution_they_are_stored_at`.
    pub fn fold_magnitude(&self, slot: usize) -> Option<FoldMagnitude> {
        FoldMagnitude::from_degrees(self.creases[slot].1.abs()).filter(|value| !value.is_full())
    }

    /// Whether any of the three creases would be folded against its hint.
    pub fn contradicts_a_hint(&self) -> bool {
        self.contradicts_hint.iter().any(|conflict| *conflict)
    }

    /// How far this moves the three creases from where they are now, as the
    /// largest single-angle change in degrees. Orders the solution list so a
    /// nearly-right vertex is nudged before it is popped.
    fn distance_from(&self, current: [f64; 3]) -> f64 {
        self.creases
            .iter()
            .zip(current)
            .map(|((_, solved), now)| (solved - now).abs())
            .fold(0.0_f64, f64::max)
    }
}

/// Why a vertex has no solvable triple.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NoSolution {
    /// The point is on the paper's edge, where there is no closure condition to
    /// satisfy — walking the creases never comes back round. Same rule, and the
    /// same reasoning, as [`crate::solve_spatial::NoCompletion::BoundaryVertex`].
    BoundaryVertex,
    /// The fan could not be evaluated — an unassigned crease, or a segment
    /// passing through the point without ending there.
    Indeterminate,
    /// Fewer than three creases meet here, so there are not three angles to
    /// solve.
    NotEnoughCreases,
    /// A chosen line does not end at this vertex, is not a crease, or was chosen
    /// twice.
    CreaseNotInFan,
    /// The chosen creases do not all end at one point, so there is no single
    /// vertex whose closure they could be solving.
    CreasesDoNotMeet,
    /// Another crease at this vertex has no fold angle either, so the honest
    /// unknown count is four or more against closure's three scalar equations.
    /// Not a failure of the pick — measured, that extra crease is itself
    /// determined at k = 1 from the current state, so the next move is to
    /// propagate rather than to choose a different three.
    TooManyUnknowns,
    /// The three chosen creases cannot close this vertex at any angles. The
    /// ordinary answer, not a failure — 62% of randomly chosen triples on
    /// freely-angled vertices — and the next move is to choose a different
    /// three, which is why the tool marks which ones work.
    Unreachable,
}

/// Everything the completion tool needs about one vertex and one chosen triple.
#[derive(Debug, Clone, PartialEq)]
pub struct VertexAngleSolutions {
    /// Isolated solutions first, ordered nearest-to-current; family members
    /// after them. Empty when `no_solution` is set.
    pub solutions: Vec<AngleSolution>,
    /// How many of `solutions` stand alone. This is the number a "2 of 3"
    /// readout may show — a count over a continuous family would be a fiction.
    pub isolated_count: usize,
    /// The vertex's closure residual as it stands, in degrees.
    pub residual_degrees: f64,
    /// Remaining freedom across the whole fan; `0` means the vertex is rigid.
    pub dof: usize,
    pub no_solution: Option<NoSolution>,
}

/// `angle` mapped into `[-pi, pi)`.
fn wrap_angle(angle: f64) -> f64 {
    (angle + std::f64::consts::PI).rem_euclid(std::f64::consts::TAU) - std::f64::consts::PI
}

/// The representable fold angles with this rotation.
///
/// One, except at a full fold, where `+180` and `-180` are the same rotation and
/// opposite quaternions — so both are candidates and only the closure residual
/// can tell them apart. See the module docs; this is the single correction that
/// mattered most.
fn lifts(rho: f64) -> [f64; 2] {
    if (rho.abs() - std::f64::consts::PI).abs() < 1e-7 {
        [std::f64::consts::PI, -std::f64::consts::PI]
    } else {
        [rho, rho]
    }
}

/// Fan indices strictly after `from`, walking forward cyclically, up to before
/// `to`. Empty when the two are adjacent, which is exactly the paper's "which
/// may be 1 if any unknown creases are adjacent".
fn between(degree: usize, from: usize, to: usize) -> Vec<usize> {
    let mut out = Vec::new();
    let mut index = (from + 1) % degree;
    while index != to {
        out.push(index);
        index = (index + 1) % degree;
    }
    out
}

fn product_of(fan: &VertexFan, indices: &[usize]) -> Quat {
    let mut product: Quat = (1.0, 0.0, 0.0, 0.0);
    for &index in indices {
        let (theta, rho) = fan.creases[index];
        product = quat_mul(crease_quat(theta, rho), product);
    }
    product
}

fn direction(fan: &VertexFan, index: usize) -> [f64; 3] {
    let theta = fan.creases[index].0;
    [theta.cos(), theta.sin(), 0.0]
}

fn scaled(vector: [f64; 3], factor: f64) -> [f64; 3] {
    [vector[0] * factor, vector[1] * factor, vector[2] * factor]
}

fn minus(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

/// Component of `vector` perpendicular to the unit `axis`.
fn reject(vector: [f64; 3], axis: [f64; 3]) -> [f64; 3] {
    minus(vector, scaled(axis, dot(vector, axis)))
}

/// The closed-form branches for one cyclic labeling, as `(fan index, rho)`
/// triples ready to seed the refinement.
///
/// `a`, `b`, `c` must be a cyclic rotation of the chosen triple in angular
/// order. Which of the three plays `b` changes the elimination, so all three
/// rotations are tried by the caller — cheaply, and it costs nothing to be
/// thorough about which degeneracies get dodged.
pub(crate) fn branch_angles(
    fan: &VertexFan,
    a: usize,
    b: usize,
    c: usize,
) -> Vec<[(usize, f64); 3]> {
    let degree = fan.creases.len();
    let q1 = product_of(fan, &between(degree, c, a));
    let q2 = product_of(fan, &between(degree, a, b));
    let q3 = product_of(fan, &between(degree, b, c));

    let u_c = direction(fan, c);
    let u_b = quat_rotate(q3, direction(fan, b));
    let u_a = quat_rotate(quat_mul(q3, q2), direction(fan, a));
    let target = quat_conj(quat_mul(q3, quat_mul(q2, q1)));
    let target_ua = quat_rotate(target, u_a);

    let (cb, ba) = (dot(u_c, u_b), dot(u_b, u_a));
    let coefficient_a = dot(u_c, u_a) - cb * ba;
    let coefficient_b = dot(u_c, cross(u_b, u_a));
    let coefficient_c = cb * ba - dot(u_c, target_ua);

    let radius = coefficient_a.hypot(coefficient_b);
    if radius < EPSILON {
        // `A = B = 0`: this labeling's equation says nothing about rho_b at all.
        // Another labeling may still speak, and the refinement covers what none
        // of them do.
        return Vec::new();
    }
    let ratio = -coefficient_c / radius;
    if ratio.abs() > 1.0 + TANGENCY_TOLERANCE {
        return Vec::new();
    }
    let phi = coefficient_b.atan2(coefficient_a);
    let delta = ratio.clamp(-1.0, 1.0).acos();

    let mut out = Vec::new();
    for root in [phi + delta, phi - delta] {
        for rho_b in lifts(wrap_angle(root)) {
            let quat_b = axis_quat(u_b, rho_b);
            let start = reject(quat_rotate(quat_b, u_a), u_c);
            let finish = reject(target_ua, u_c);
            if norm(start) < EPSILON || norm(finish) < EPSILON {
                // `R_b u_a` came out along `u_c`, so there is no plane left to
                // measure rho_c in. A degeneracy of this labeling, not of the
                // vertex.
                continue;
            }
            let rho_c = dot(u_c, cross(start, finish)).atan2(dot(start, finish));
            for rho_c in lifts(rho_c) {
                let quat_c = axis_quat(u_c, rho_c);
                let quat_a = quat_mul(quat_conj(quat_b), quat_mul(quat_conj(quat_c), target));
                let vector = [quat_a.1, quat_a.2, quat_a.3];
                let along = dot(vector, u_a);
                if norm(minus(vector, scaled(u_a, along))) > 1e-8 {
                    continue;
                }
                if quat_a.0 < -EPSILON {
                    // A half-turn's worth further than a crease can fold.
                    continue;
                }
                for rho_a in lifts(2.0 * along.atan2(quat_a.0)) {
                    out.push([(a, rho_a), (b, rho_b), (c, rho_c)]);
                }
            }
        }
    }
    out
}

/// Closure vector part with the three chosen angles replaced.
fn closure_vector(fan: &VertexFan, triple: [usize; 3], angles: [f64; 3]) -> ([f64; 3], f64) {
    let mut creases = fan.creases.clone();
    for (slot, index) in triple.iter().enumerate() {
        creases[*index].1 = angles[slot];
    }
    let product = closure_product(&creases);
    ([product.1, product.2, product.3], product.0)
}

/// Jacobian of the closure vector part with respect to the three angles.
///
/// Finite differences, as [`vertex_dof`] uses and for the same reason: the fan
/// is small and hand-deriving the product rule would be easy to get subtly
/// wrong. Rows are creases, columns are components, which is the shape
/// [`jacobian_rank`] already takes.
///
/// # Central differences, and why the step is not tiny
///
/// [`vertex_dof`]'s forward difference at `h = 1e-7` carries a roundoff error of
/// about `eps/h = 1e-9` — **exactly [`jacobian_rank`]'s pivot tolerance**. Over a
/// tall fan that noise is diluted, but on a 3x3 it decides the answer: a
/// rank-deficient triple was reported as rank 3, so a solution lying on a
/// continuous family was classified as an isolated branch and the recovery test
/// went looking for an answer that was never isolated to begin with.
///
/// Central differences at `h = 1e-5` put truncation at `O(h^2) ~ 1e-10` and
/// roundoff at `eps/h ~ 1e-11`, an order clear of the tolerance either way.
fn closure_jacobian(fan: &VertexFan, triple: [usize; 3], angles: [f64; 3]) -> [[f64; 3]; 3] {
    const H: f64 = 1e-5;
    let mut rows = [[0.0_f64; 3]; 3];
    for slot in 0..3 {
        let mut ahead = angles;
        let mut behind = angles;
        ahead[slot] += H;
        behind[slot] -= H;
        let (forward, _) = closure_vector(fan, triple, ahead);
        let (backward, _) = closure_vector(fan, triple, behind);
        rows[slot] = [
            (forward[0] - backward[0]) / (2.0 * H),
            (forward[1] - backward[1]) / (2.0 * H),
            (forward[2] - backward[2]) / (2.0 * H),
        ];
    }
    rows
}

/// Solve a 3x3 system by Gaussian elimination with partial pivoting.
fn solve_3x3(mut matrix: [[f64; 3]; 3], mut rhs: [f64; 3]) -> Option<[f64; 3]> {
    for column in 0..3 {
        let pivot = (column..3).max_by(|&a, &b| {
            matrix[a][column]
                .abs()
                .partial_cmp(&matrix[b][column].abs())
                .unwrap_or(std::cmp::Ordering::Equal)
        })?;
        if matrix[pivot][column].abs() < 1e-14 {
            return None;
        }
        matrix.swap(column, pivot);
        rhs.swap(column, pivot);
        let pivot_row = matrix[column];
        let pivot_rhs = rhs[column];
        for row in (column + 1)..3 {
            let factor = matrix[row][column] / pivot_row[column];
            for (term, pivot) in matrix[row].iter_mut().zip(pivot_row.iter()).skip(column) {
                *term -= factor * pivot;
            }
            rhs[row] -= factor * pivot_rhs;
        }
    }
    let mut out = [0.0_f64; 3];
    for row in (0..3).rev() {
        let mut sum = rhs[row];
        for term in (row + 1)..3 {
            sum -= matrix[row][term] * out[term];
        }
        out[row] = sum / matrix[row][row];
    }
    Some(out)
}

/// Damped least squares onto the closure condition, in the three chosen angles.
///
/// Levenberg rather than plain Newton because the seeds include a fixed lattice
/// that can start far from any solution, and because the Jacobian is genuinely
/// singular on the rank-deficient triples this stage exists to serve — where
/// Newton's step is undefined and the damping is what keeps it moving along the
/// family instead of diverging off it.
///
/// The `w > 0` requirement is not enforced here; it is left to the residual
/// gate, which measures from the identity *quaternion* and so reports the
/// Maekawa-violating lift as maximally far rather than as a perfect zero.
fn refine(fan: &VertexFan, triple: [usize; 3], seed: [f64; 3]) -> [f64; 3] {
    let mut angles = seed;
    let mut lambda = 1e-3_f64;
    let (mut residual, _) = closure_vector(fan, triple, angles);
    let mut cost = norm(residual);

    for _ in 0..REFINE_ITERATIONS {
        if cost < 1e-15 {
            break;
        }
        let jacobian = closure_jacobian(fan, triple, angles);
        // Normal equations: (J^T J + lambda I) step = -J^T f, with J's rows
        // indexed by crease.
        let mut normal = [[0.0_f64; 3]; 3];
        let mut gradient = [0.0_f64; 3];
        for row in 0..3 {
            for column in 0..3 {
                normal[row][column] = (0..3).map(|k| jacobian[row][k] * jacobian[column][k]).sum();
            }
            normal[row][row] += lambda;
            gradient[row] = -(0..3).map(|k| jacobian[row][k] * residual[k]).sum::<f64>();
        }
        let Some(step) = solve_3x3(normal, gradient) else {
            break;
        };
        if !step.iter().all(|value| value.is_finite()) {
            break;
        }

        let mut trial = angles;
        for slot in 0..3 {
            trial[slot] =
                (angles[slot] + step[slot]).clamp(-std::f64::consts::PI, std::f64::consts::PI);
        }
        let (trial_residual, _) = closure_vector(fan, triple, trial);
        let trial_cost = norm(trial_residual);
        if trial_cost < cost {
            angles = trial;
            residual = trial_residual;
            cost = trial_cost;
            lambda = (lambda * 0.5).max(1e-9);
        } else {
            lambda = (lambda * 4.0).min(1e3);
            if lambda >= 1e3 {
                break;
            }
        }
    }
    angles
}

/// Round to what [`FoldMagnitude`] can store, so the answer that is validated is
/// the answer that is written.
fn quantise_degrees(radians: f64) -> Option<f64> {
    let degrees = radians.to_degrees();
    if !degrees.is_finite() || degrees.abs() > 180.0 + 1e-9 {
        return None;
    }
    let clamped = degrees.clamp(-180.0, 180.0);
    let magnitude = FoldMagnitude::from_degrees(clamped.abs())?;
    Some(magnitude.degrees().copysign(clamped))
}

/// Grids the answer is offered to, coarsest first.
///
/// The closure bar defines a *band*, not a point, and the band is wide wherever
/// the constraint is second-order — a rigid degree-3 vertex has zero z-gradient
/// at the flat state, so angles up to a few thousandths of a degree from flat
/// all clear 1e-6. Converging to an arbitrary interior point of that band writes
/// `0.0021 degrees` into the document, which reads as a deliberate value and is
/// really just where the iteration stopped.
///
/// So the solved angles are offered to progressively coarser grids and the
/// coarsest that still closes is kept. Nothing is assumed: each snap is checked
/// against the same residual gate as everything else, so a genuinely isolated
/// answer at 37.42 degrees survives untouched — only the slack the bar actually
/// grants is taken.
const SNAP_GRIDS_DEGREES: [f64; 4] = [1.0, 0.1, 0.01, 0.001];

/// The cleanest representative of `angles` that still closes the vertex.
fn snap_to_the_coarsest_grid_that_closes(
    fan: &VertexFan,
    triple: [usize; 3],
    angles: [f64; 3],
    closed_bar: f64,
) -> [f64; 3] {
    for grid in SNAP_GRIDS_DEGREES {
        let mut snapped = [0.0_f64; 3];
        for slot in 0..3 {
            let degrees = angles[slot].to_degrees();
            snapped[slot] = ((degrees / grid).round() * grid)
                .clamp(-180.0, 180.0)
                .to_radians();
        }
        let (vector, scalar) = closure_vector(fan, triple, snapped);
        if quat_residual((scalar, vector[0], vector[1], vector[2])) <= closed_bar {
            return snapped;
        }
    }
    angles
}

/// Deterministic starting points for the refinement, beyond the closed form.
///
/// Deterministic on purpose: the same document must produce the same solution
/// list every time, or stepping through "2 of 3" would mean different things on
/// two consecutive previews.
fn lattice_seeds() -> Vec<[f64; 3]> {
    let quarter = std::f64::consts::FRAC_PI_2;
    let mut out = vec![[0.0, 0.0, 0.0]];
    for a in [-quarter, quarter] {
        for b in [-quarter, quarter] {
            for c in [-quarter, quarter] {
                out.push([a, b, c]);
            }
        }
    }
    out
}

/// Every way to close `fan` by changing the three creases at `triple`.
///
/// `triple` is in fan-index space and must be sorted ascending. `closed_bar` is
/// the closure residual, in radians, at or below which a vertex counts as
/// closed — passed in rather than baked in so the tolerance stays the single
/// constant the presentation layer owns.
pub fn solve_fold_angles(
    fan: &VertexFan,
    triple: [usize; 3],
    closed_bar: f64,
) -> Result<Vec<AngleSolution>, NoSolution> {
    if fan.indeterminate.is_some() {
        return Err(NoSolution::Indeterminate);
    }
    let degree = fan.creases.len();
    if degree < 3 {
        return Err(NoSolution::NotEnoughCreases);
    }
    if triple[0] >= triple[1] || triple[1] >= triple[2] || triple[2] >= degree {
        return Err(NoSolution::CreaseNotInFan);
    }

    let current = [
        fan.creases[triple[0]].1,
        fan.creases[triple[1]].1,
        fan.creases[triple[2]].1,
    ];

    // Closed form across all three cyclic labelings, then the numerical stage
    // from those branches and from a fixed lattice. One path, differing only in
    // where it starts.
    let mut seeds: Vec<[f64; 3]> = Vec::new();
    for (a, b, c) in [
        (triple[0], triple[1], triple[2]),
        (triple[1], triple[2], triple[0]),
        (triple[2], triple[0], triple[1]),
    ] {
        for branch in branch_angles(fan, a, b, c) {
            let mut angles = current;
            for (index, rho) in branch {
                let slot = triple
                    .iter()
                    .position(|candidate| *candidate == index)
                    .unwrap_or(0);
                angles[slot] = rho;
            }
            seeds.push(angles);
        }
    }
    seeds.push(current);
    seeds.extend(lattice_seeds());

    let mut solutions: Vec<AngleSolution> = Vec::new();
    for seed in seeds {
        let refined = snap_to_the_coarsest_grid_that_closes(
            fan,
            triple,
            refine(fan, triple, seed),
            closed_bar,
        );
        let Some(degrees) = refined
            .iter()
            .map(|rho| quantise_degrees(*rho))
            .collect::<Option<Vec<_>>>()
        else {
            continue;
        };
        let quantised = [
            degrees[0].to_radians(),
            degrees[1].to_radians(),
            degrees[2].to_radians(),
        ];
        // The verdict is taken on the stored value, never on the float that
        // produced it.
        let (vector, scalar) = closure_vector(fan, triple, quantised);
        let residual = quat_residual((scalar, vector[0], vector[1], vector[2]));
        if residual > closed_bar {
            continue;
        }
        // 1e-4 degrees: far below anything a user distinguishes, and far above
        // the scatter between seeds converging on the same answer, which arrives
        // at up to 2e-6 degrees apart.
        if solutions.iter().any(|existing| {
            existing
                .creases
                .iter()
                .zip(&degrees)
                .all(|((_, have), want)| (have - want).abs() < 1e-4)
        }) {
            continue;
        }
        solutions.push(AngleSolution {
            creases: [
                (triple[0], degrees[0]),
                (triple[1], degrees[1]),
                (triple[2], degrees[2]),
            ],
            isolated: jacobian_rank(&closure_jacobian(fan, triple, quantised)) == 3,
            residual_degrees: residual.to_degrees(),
            // Compared at storage resolution, because that is what the creases
            // actually hold — an answer differing only below 1e-7 degrees would
            // write back the same bytes and is the same state.
            is_current: current
                .iter()
                .zip(&degrees)
                .all(|(now, solved)| (now.to_degrees() - solved).abs() < 1e-7),
            // A fan carries directions and angles, never hints. The document
            // entry point fills these in.
            contradicts_hint: [false; 3],
        });
    }

    if solutions.is_empty() {
        return Err(NoSolution::Unreachable);
    }
    // Isolated answers first — a family member is not comparable to a branch and
    // must not be shuffled in among them — then nearest-to-current within each
    // group, which is a total order because the distances are exact.
    let current_degrees = [
        current[0].to_degrees(),
        current[1].to_degrees(),
        current[2].to_degrees(),
    ];
    solutions.sort_by(|left, right| {
        right
            .isolated
            .cmp(&left.isolated)
            .then_with(|| {
                left.distance_from(current_degrees)
                    .partial_cmp(&right.distance_from(current_degrees))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| {
                left.creases[0]
                    .1
                    .partial_cmp(&right.creases[0].1)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
    });
    Ok(solutions)
}

/// Map chosen document line indices onto fan positions, sorted ascending.
fn fan_positions(sources: &[usize], chosen: &[usize]) -> Option<[usize; 3]> {
    if chosen.len() != 3 {
        return None;
    }
    let mut positions = [0_usize; 3];
    for (slot, line) in chosen.iter().enumerate() {
        positions[slot] = sources.iter().position(|source| source == line)?;
    }
    positions.sort_unstable();
    if positions[0] == positions[1] || positions[1] == positions[2] {
        return None;
    }
    Some(positions)
}

/// Solve at the vertex under the cursor, for the creases the user nominated.
///
/// `chosen` are zero-based document line indices. Solutions come back carrying
/// those same indices, so the commit writes back without a second lookup.
pub fn vertex_angle_solutions(
    model: &CreasePatternModel,
    vertex: Point,
    chosen: &[usize],
    closed_bar: f64,
) -> VertexAngleSolutions {
    let lines = incident_lines_at(model, vertex);
    // The **solver's** fan, not the checker's. `vertex_fan_at_with_sources`
    // drops every unassigned crease and flags the fan indeterminate, which is
    // right for a checker — an unassigned crease means the vertex's fold state
    // is unknown, so there is nothing to check — and wrong here, because those
    // creases are precisely what the user is asking to solve.
    //
    // Dropping them also made the refusal *incoherent*. The message was picked
    // from the surviving crease count, so the same mistake said
    // `NotEnoughCreases` at a degree-4 vertex ("fewer than three creases meet
    // here", at a vertex with four) and `CreaseNotInFan` at a degree-8 one.
    // Which sentence you got was a function of the vertex's degree rather than
    // of anything you did.
    let solve_fan = crate::solve_k::solve_fan_at(model, vertex);
    let sources = solve_fan.sources.clone();
    // Placeholder angles for the unknowns. Never read as inputs: `branch_angles`
    // builds its known runs from the creases *between* the unknowns and treats
    // the unknowns purely as axes, which
    // `the isolated branches are independent of the creases' current angles`
    // pins. They would reach `is_current`, which is why that flag is cleared
    // below for a crease that has no current state.
    let fan = VertexFan {
        point: solve_fan.point,
        creases: solve_fan
            .creases
            .iter()
            .map(|(theta, rho)| (*theta, rho.unwrap_or(0.0)))
            .collect(),
        indeterminate: solve_fan
            .unsplit_junction
            .then_some(crate::checks_spatial::Indeterminate::UnsplitJunction),
    };
    let free = solve_fan.unknown_positions();
    let residual_degrees = if fan.indeterminate.is_none() && free.is_empty() {
        vertex_closure_residual(&fan).to_degrees()
    } else {
        0.0
    };
    let decline = |reason| VertexAngleSolutions {
        solutions: Vec::new(),
        isolated_count: 0,
        residual_degrees,
        dof: vertex_dof(&fan),
        no_solution: Some(reason),
    };

    if !is_interior_vertex(&lines) {
        return decline(NoSolution::BoundaryVertex);
    }
    let Some(triple) = fan_positions(&sources, chosen) else {
        return decline(if fan.creases.len() < 3 {
            NoSolution::NotEnoughCreases
        } else {
            NoSolution::CreaseNotInFan
        });
    };

    // Every free crease is necessarily an unknown — it has no value to hold
    // fixed — so the honest unknown count is the picked three plus any free
    // crease outside them. One more than three is already `k >= 4`: four
    // unknowns against closure's three scalar equations, rank <= 3 by
    // construction, so no answer could ever be isolated.
    //
    // Worth saying in the message rather than just declining: measured, that
    // extra crease is itself determined at k = 1 from the current state in every
    // case sampled, so the user's next move is to run Propagate.
    if free.iter().any(|position| !triple.contains(position)) {
        return decline(NoSolution::TooManyUnknowns);
    }

    // Only an unassigned crease can carry a hint — `with_line_color` enforces
    // that — so this is the same set as `free`, read through the document rather
    // than assumed.
    let hint_at = |line: usize| {
        model
            .line_segments
            .get(line)
            .and_then(|segment| segment.fold_direction_hint)
    };

    match solve_fold_angles(&fan, triple, closed_bar) {
        Err(reason) => decline(reason),
        Ok(solutions) => {
            let any_free = !free.is_empty();
            let solutions: Vec<AngleSolution> = solutions
                .into_iter()
                .map(|solution| {
                    let creases = [
                        (sources[solution.creases[0].0], solution.creases[0].1),
                        (sources[solution.creases[1].0], solution.creases[1].1),
                        (sources[solution.creases[2].0], solution.creases[2].1),
                    ];
                    let mut contradicts_hint = [false; 3];
                    for (slot, (line, degrees)) in creases.iter().enumerate() {
                        // `FoldDirection::admits` is the one predicate for "does
                        // this angle fold the way that direction says", and it
                        // answers no for zero — a crease that does not fold has
                        // no direction to agree with.
                        contradicts_hint[slot] =
                            hint_at(*line).is_some_and(|hint| !hint.admits(*degrees));
                    }
                    AngleSolution {
                        creases,
                        // "This is the state you are already in" has no meaning
                        // for a crease that has no state, and the placeholder
                        // would make a 0-degree answer claim it.
                        is_current: solution.is_current && !any_free,
                        contradicts_hint,
                        ..solution
                    }
                })
                .collect();
            VertexAngleSolutions {
                isolated_count: solutions.iter().filter(|entry| entry.isolated).count(),
                solutions,
                residual_degrees,
                dof: vertex_dof(&fan),
                no_solution: None,
            }
        }
    }
}

/// The point every one of `chosen` ends at, when there is exactly one.
///
/// The tool asks for three creases and no vertex click: three segments meeting
/// at a point determine that point, so asking for it as well would be asking the
/// user to tell the software something it can already see. Two creases are
/// enough to fix it, which is what makes the solvable-partner marking possible
/// before the third pick.
///
/// `None` when they share no endpoint — the creases are not all at one vertex,
/// and there is no closure condition spanning them.
pub fn shared_vertex(model: &CreasePatternModel, chosen: &[usize]) -> Option<Point> {
    let segments: Vec<&crate::geometry::LineSegment> = chosen
        .iter()
        .map(|index| model.line_segments.get(*index))
        .collect::<Option<Vec<_>>>()?;
    let (first, rest) = segments.split_first()?;
    // `CELL` in `checks_spatial` is what "at this point" means for the fan, so
    // the same tolerance decides it here — a vertex the fan would accept and
    // this would not is a disagreement with nothing to explain it.
    const MEETING: f64 = crate::geometry::Epsilon::UNKNOWN_1EN4;
    [first.a, first.b].into_iter().find(|candidate| {
        rest.iter().all(|segment| {
            candidate.distance(segment.a) < MEETING || candidate.distance(segment.b) < MEETING
        })
    })
}

/// Which creases would complete a solvable triple with the ones already chosen.
///
/// Returned as document line indices. `C(n,3)` solves is 20 at degree 6 and each
/// is linear in the degree, so offering this live turns "pick and hope" into
/// "pick from what works" for no meaningful cost — which matters, because 62% of
/// randomly chosen triples on a freely-angled vertex cannot close it.
pub fn solvable_partners(
    model: &CreasePatternModel,
    vertex: Point,
    chosen: &[usize],
    closed_bar: f64,
) -> Vec<usize> {
    let lines = incident_lines_at(model, vertex);
    if !is_interior_vertex(&lines) {
        return Vec::new();
    }
    // Same fan swap as `vertex_angle_solutions`, and for the same reason. Both
    // halves of the old guard went dark on any vertex with an unassigned crease:
    // the checker fan flagged it indeterminate, *and* its crease count excluded
    // the very creases the affordance is about. Fixing only the first half would
    // still leave a degree-4 vertex with two blanked creases counting 2.
    let solve_fan = crate::solve_k::solve_fan_at(model, vertex);
    if solve_fan.unsplit_junction || solve_fan.degree() < 3 {
        return Vec::new();
    }
    let sources = solve_fan.sources.clone();
    let fan = VertexFan {
        point: solve_fan.point,
        creases: solve_fan
            .creases
            .iter()
            .map(|(theta, rho)| (*theta, rho.unwrap_or(0.0)))
            .collect(),
        indeterminate: None,
    };
    sources
        .iter()
        .filter(|candidate| !chosen.contains(candidate))
        .filter(|candidate| {
            let mut trial = chosen.to_vec();
            trial.push(**candidate);
            fan_positions(&sources, &trial)
                .is_some_and(|triple| solve_fold_angles(&fan, triple, closed_bar).is_ok())
        })
        .copied()
        .collect()
}

#[cfg(test)]
mod tests {
    /// The bug in the screenshot: unassigning creases at a vertex made the tool
    /// say "fewer than three creases meet here" at a vertex with four. The fan
    /// dropped them, so the message was picked from the surviving count — a
    /// function of the vertex's degree rather than of anything the user did.
    #[test]
    fn the_creases_a_user_just_unassigned_are_the_ones_it_solves() {
        use crate::geometry::LineColor;
        use crate::io::fold::import_fold_document;
        use treemaker_fold::FoldDocument;

        let text = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../tests/fixtures/flat-folder/kabuto.fold"),
        )
        .expect("fixture");
        let document: FoldDocument = serde_json::from_str(&text).expect("fold json");
        let model = import_fold_document(&document).expect("import");
        let bar = crate::CLOSURE_RESIDUAL_BAR_DEGREES.to_radians();

        let mut solved_somewhere = false;
        for point in model
            .line_segments
            .iter()
            .flat_map(|segment| [segment.a, segment.b])
        {
            let fan = crate::solve_k::solve_fan_at(&model, point);
            if fan.degree() < 4 || fan.creases.iter().any(|(_, rho)| rho.is_none()) {
                continue;
            }
            let chosen: Vec<usize> = fan.sources.iter().take(3).copied().collect();
            let mut blanked = model.clone();
            for &index in &chosen {
                blanked.line_segments[index] =
                    blanked.line_segments[index].with_line_color(LineColor::None);
            }
            let solved = super::vertex_angle_solutions(&blanked, point, &chosen, bar);
            assert_ne!(
                solved.no_solution,
                Some(super::NoSolution::NotEnoughCreases),
                "a degree-{} vertex must not report NotEnoughCreases",
                fan.degree()
            );
            if solved.no_solution.is_none() && !solved.solutions.is_empty() {
                solved_somewhere = true;
            }
        }
        assert!(
            solved_somewhere,
            "unassigning three creases at a vertex must leave something solvable"
        );
    }

    /// A *fourth* free crease is honestly unsolvable — four unknowns against
    /// three equations — and must say so rather than blaming the pick.
    #[test]
    fn a_fourth_free_crease_is_reported_as_too_many_unknowns() {
        use crate::geometry::LineColor;
        use crate::io::fold::import_fold_document;
        use treemaker_fold::FoldDocument;

        let text = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../tests/fixtures/flat-folder/kabuto.fold"),
        )
        .expect("fixture");
        let document: FoldDocument = serde_json::from_str(&text).expect("fold json");
        let model = import_fold_document(&document).expect("import");
        let bar = crate::CLOSURE_RESIDUAL_BAR_DEGREES.to_radians();

        for point in model
            .line_segments
            .iter()
            .flat_map(|segment| [segment.a, segment.b])
        {
            let fan = crate::solve_k::solve_fan_at(&model, point);
            if fan.degree() < 4 || fan.creases.iter().any(|(_, rho)| rho.is_none()) {
                continue;
            }
            let mut blanked = model.clone();
            for &index in fan.sources.iter().take(4) {
                blanked.line_segments[index] =
                    blanked.line_segments[index].with_line_color(LineColor::None);
            }
            let chosen: Vec<usize> = fan.sources.iter().take(3).copied().collect();
            let solved = super::vertex_angle_solutions(&blanked, point, &chosen, bar);
            assert_eq!(solved.no_solution, Some(super::NoSolution::TooManyUnknowns));
            return;
        }
        panic!("no degree-4+ vertex found in the fixture");
    }

    /// Every `NoSolution` maps to a code, and `NO_SOLUTION_CODES` lists exactly
    /// those. The frontend's `CP_TOOL_UNAVAILABLE_CODES` is a closed union that
    /// silently renders **nothing** for a code it does not know, so a drift here
    /// is invisible in the product — which is how `CreasesDoNotMeet` shipped
    /// emitted-but-unhandled.
    #[test]
    fn every_no_solution_reason_has_a_listed_code() {
        use crate::NO_SOLUTION_CODES;
        for reason in [
            super::NoSolution::BoundaryVertex,
            super::NoSolution::Indeterminate,
            super::NoSolution::NotEnoughCreases,
            super::NoSolution::CreaseNotInFan,
            super::NoSolution::CreasesDoNotMeet,
            super::NoSolution::TooManyUnknowns,
            super::NoSolution::Unreachable,
        ] {
            let code = crate::no_solution_code_for_test(reason);
            assert!(
                NO_SOLUTION_CODES.contains(&code.as_str()),
                "{reason:?} maps to {code}, which NO_SOLUTION_CODES does not list"
            );
        }
    }

    use super::*;
    use crate::geometry::LineSegment;

    /// 1e-6 degrees in radians — the bar the presentation layer applies.
    fn bar() -> f64 {
        1e-6_f64.to_radians()
    }

    fn fan_from(creases: &[(f64, f64)]) -> VertexFan {
        let mut creases: Vec<(f64, f64)> = creases
            .iter()
            .map(|&(theta, rho)| (wrap_angle(theta.to_radians()), rho.to_radians()))
            .collect();
        creases.sort_by(|a, b| a.0.partial_cmp(&b.0).expect("finite"));
        VertexFan {
            point: Point::new(0.0, 0.0),
            creases,
            indeterminate: None,
        }
    }

    /// Applying a solution closes the vertex — asserted against the checker,
    /// never against the solver's own algebra.
    fn assert_closes(fan: &VertexFan, solution: &AngleSolution) {
        let mut creases = fan.creases.clone();
        for (index, degrees) in solution.creases {
            creases[index].1 = degrees.to_radians();
        }
        let residual = vertex_closure_residual(&VertexFan {
            point: fan.point,
            creases,
            indeterminate: None,
        })
        .to_degrees();
        assert!(
            residual < 1e-6,
            "solution {:?} left a residual of {residual} degrees",
            solution.creases
        );
    }

    /// Every closed fan on the 45-degree grid with angles from `{+/-90, +/-180}`.
    fn designed_fans(degree: usize, limit: usize) -> Vec<VertexFan> {
        let grid: Vec<f64> = (0..8).map(|index| f64::from(index) * 45.0).collect();
        let vocabulary = [90.0_f64, -90.0, 180.0, -180.0];
        let mut out = Vec::new();
        for directions in combinations(&grid, degree) {
            for mask in 0..vocabulary.len().pow(degree as u32) {
                let mut remaining = mask;
                let creases: Vec<(f64, f64)> = directions
                    .iter()
                    .map(|&theta| {
                        let angle = vocabulary[remaining % vocabulary.len()];
                        remaining /= vocabulary.len();
                        (theta, angle)
                    })
                    .collect();
                let fan = fan_from(&creases);
                if vertex_closure_residual(&fan).to_degrees() < 1e-9 {
                    out.push(fan);
                    if out.len() >= limit {
                        return out;
                    }
                }
            }
        }
        out
    }

    fn combinations(pool: &[f64], k: usize) -> Vec<Vec<f64>> {
        let mut out = Vec::new();
        let n = pool.len();
        let mut index: Vec<usize> = (0..k).collect();
        loop {
            out.push(index.iter().map(|&i| pool[i]).collect());
            let mut i = k;
            loop {
                if i == 0 {
                    return out;
                }
                i -= 1;
                if index[i] != i + n - k {
                    break;
                }
            }
            index[i] += 1;
            for j in i + 1..k {
                index[j] = index[j - 1] + 1;
            }
        }
    }

    fn triples(degree: usize) -> Vec<[usize; 3]> {
        let mut out = Vec::new();
        for i in 0..degree {
            for j in (i + 1)..degree {
                for k in (j + 1)..degree {
                    out.push([i, j, k]);
                }
            }
        }
        out
    }

    /// A deterministic stand-in for random angles. The solver must behave the
    /// same on freely-drawn geometry as on snapped, and a fixed generator keeps
    /// the measurement reproducible.
    fn pseudo_random(seed: &mut u64) -> f64 {
        *seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        let unit = ((*seed >> 33) as f64) / f64::from(u32::MAX >> 1);
        (unit - 0.5) * 360.0
    }

    /// The feature's central claim, and the one that took four wrong versions to
    /// find: **where the solution is isolated, the solver never misses it.**
    ///
    /// Take a vertex that genuinely closes, destroy three of its angles, and ask
    /// for them back. Conditioned on the closure Jacobian being full rank at the
    /// known answer, recovery must be total — the prototype measured 192/192,
    /// 1280/1280 and 1128/1128 at degrees 4, 5 and 6, with not one rank-3 miss.
    ///
    /// The conditioning is the point. Rank-deficient triples have a *curve* of
    /// solutions rather than a set of them, and an elimination built to return
    /// points has nothing to return; those are covered by `isolated` being false
    /// rather than by pretending they are branches.
    #[test]
    fn an_isolated_solution_is_always_recovered() {
        let mut checked = 0usize;
        let mut isolated_cases = 0usize;
        for degree in [4usize, 5] {
            for fan in designed_fans(degree, 60) {
                for triple in triples(degree) {
                    let want: Vec<f64> = triple
                        .iter()
                        .map(|index| fan.creases[*index].1.to_degrees())
                        .collect();
                    // Rank at the *known answer* is what classifies the solution
                    // set; rank at some other point says nothing about it.
                    let at_answer = closure_jacobian(
                        &fan,
                        triple,
                        [
                            fan.creases[triple[0]].1,
                            fan.creases[triple[1]].1,
                            fan.creases[triple[2]].1,
                        ],
                    );
                    if jacobian_rank(&at_answer) != 3 {
                        continue;
                    }
                    isolated_cases += 1;

                    let mut broken = fan.clone();
                    for index in triple {
                        broken.creases[index].1 = 17.0_f64.to_radians();
                    }
                    let solutions = solve_fold_angles(&broken, triple, bar())
                        .unwrap_or_else(|reason| panic!("{want:?} became unsolvable: {reason:?}"));
                    assert!(
                        solutions.iter().any(|solution| solution
                            .creases
                            .iter()
                            .zip(&want)
                            .all(|((_, have), target)| (have - target).abs() < 1e-6)),
                        "lost the original {want:?}; offered {:?}",
                        solutions
                            .iter()
                            .map(|solution| solution.creases)
                            .collect::<Vec<_>>()
                    );
                    for solution in &solutions {
                        assert_closes(&broken, solution);
                    }
                    checked += 1;
                }
            }
        }
        assert_eq!(checked, isolated_cases, "every isolated case must recover");
        assert!(
            checked >= 200,
            "expected the enumeration to exercise the solver, got {checked}"
        );
    }

    /// A full fold is where SO(3) stops being able to tell a mountain from a
    /// valley, and it is the commonest angle in origami.
    ///
    /// Every one of these vertices closes only because some crease is at
    /// **exactly** `+180` rather than `-180`. Wrapping roots into `[-pi, pi)`
    /// converts one into the other silently, which is a Maekawa violation
    /// wearing the right rotation matrix — it held recovery at 39% until
    /// [`lifts`] existed.
    #[test]
    fn both_signs_of_a_full_fold_are_reachable() {
        let mut seen_positive = false;
        let mut seen_negative = false;
        for fan in designed_fans(5, 40) {
            for triple in triples(5) {
                let Ok(solutions) = solve_fold_angles(&fan, triple, bar()) else {
                    continue;
                };
                for solution in &solutions {
                    assert_closes(&fan, solution);
                    for (_, degrees) in solution.creases {
                        if (degrees - 180.0).abs() < 1e-9 {
                            seen_positive = true;
                        }
                        if (degrees + 180.0).abs() < 1e-9 {
                            seen_negative = true;
                        }
                    }
                }
            }
        }
        assert!(
            seen_positive && seen_negative,
            "both lifts of a full fold must be reachable: +180 {seen_positive}, -180 {seen_negative}"
        );
    }

    /// The numerical stage is not a polish step — it is what covers the
    /// rank-deficient triples, which are the *majority* on designed geometry.
    ///
    /// Measured on the prototype: closed form alone repaired 48-70% of corrupted
    /// designed vertices, and the seeded refinement took that to 99-100%. The
    /// floor here is deliberately below the measurement so a regression fails
    /// rather than a fluctuation.
    #[test]
    fn the_refinement_covers_what_the_closed_form_cannot() {
        let mut attempted = 0usize;
        let mut solved = 0usize;
        for degree in [4usize, 5] {
            for fan in designed_fans(degree, 40) {
                for triple in triples(degree) {
                    let mut broken = fan.clone();
                    for (slot, index) in triple.iter().enumerate() {
                        broken.creases[*index].1 = (37.0 + 23.0 * slot as f64).to_radians();
                    }
                    attempted += 1;
                    if let Ok(solutions) = solve_fold_angles(&broken, triple, bar()) {
                        solved += 1;
                        for solution in &solutions {
                            assert_closes(&broken, solution);
                        }
                    }
                }
            }
        }
        assert!(
            solved * 100 >= attempted * 95,
            "expected >=95% of corrupted designed vertices to be repairable, got {solved}/{attempted}"
        );
    }

    /// Rank deficiency is a snapped-geometry phenomenon, so the two populations
    /// must be exercised separately or the degenerate path never runs.
    ///
    /// On freely-angled fans every triple was rank 3 in the prototype, at every
    /// degree from 4 to 7 — which is why "the closed form is enough" survives
    /// testing on random input and falls over on real designs.
    #[test]
    fn freely_angled_vertices_are_never_degenerate() {
        let mut seed = 0x5eed_u64;
        let mut families = 0usize;
        let mut solved = 0usize;
        let mut attempted = 0usize;
        for _ in 0..120 {
            for degree in [5usize, 6] {
                let mut creases: Vec<(f64, f64)> = (0..degree)
                    .map(|_| (pseudo_random(&mut seed), pseudo_random(&mut seed)))
                    .collect();
                creases.sort_by(|a, b| a.0.partial_cmp(&b.0).expect("finite"));
                let fan = fan_from(&creases);
                for triple in triples(degree) {
                    attempted += 1;
                    let Ok(solutions) = solve_fold_angles(&fan, triple, bar()) else {
                        continue;
                    };
                    solved += 1;
                    for solution in &solutions {
                        assert_closes(&fan, solution);
                        if !solution.isolated {
                            families += 1;
                        }
                    }
                }
            }
        }
        assert_eq!(
            families, 0,
            "freely-angled fans should have no degenerate triples"
        );
        // The value proposition against section 4, which finds nothing at all
        // here: some usable fraction must come back.
        assert!(
            solved * 10 >= attempted,
            "expected a usable share of freely-angled triples to solve, got {solved}/{attempted}"
        );
    }

    /// A family member is not a branch, and counting it as one would put a
    /// fiction in front of the user.
    ///
    /// A straight crease through a point plus a spur is the canonical case: the
    /// collinear pair must share an angle and the spur must lie flat, so the
    /// solutions form a curve. The prototype pulled members at 8.9, 34.7, 48.5,
    /// 107.0 and 120.8 degrees out of it depending only on where the search
    /// started.
    #[test]
    fn a_one_parameter_family_is_reported_as_one() {
        let fan = fan_from(&[(0.0, 90.0), (45.0, 0.0), (180.0, 90.0)]);
        let solutions = solve_fold_angles(&fan, [0, 1, 2], bar()).expect("a solution exists");
        assert!(
            solutions.iter().all(|solution| !solution.isolated),
            "every solution here lies on a curve: {:?}",
            solutions
                .iter()
                .map(|solution| solution.creases)
                .collect::<Vec<_>>()
        );
        for solution in &solutions {
            assert_closes(&fan, solution);
        }
    }

    /// Degree 3 is rigid — a spherical triangle is a truss — so the only answer
    /// is the flat one. Worth pinning because "solved" would otherwise read as a
    /// repair when it is really "this vertex cannot fold at all".
    #[test]
    fn a_degree_three_vertex_solves_only_to_flat() {
        for directions in [
            [0.0, 120.0, 240.0],
            [0.0, 90.0, 200.0],
            [10.0, 130.0, 250.0],
        ] {
            let fan = fan_from(&[
                (directions[0], 40.0),
                (directions[1], -70.0),
                (directions[2], 25.0),
            ]);
            let solutions = solve_fold_angles(&fan, [0, 1, 2], bar()).expect("flat always closes");
            for solution in &solutions {
                for (_, degrees) in solution.creases {
                    assert!(
                        degrees.abs() < 1e-3,
                        "a rigid vertex has only the flat solution, got {degrees}"
                    );
                }
            }
        }
    }

    /// The **isolated branches** depend on the other creases and on the three
    /// directions — never on what the three currently say. `Q_1..Q_3` and
    /// `u_a, u_b, u_c` are built without them. So the tool is well-defined
    /// however wrong the vertex is, and never needs the user to guess a start.
    ///
    /// Deliberately scoped to the isolated ones. A family member *must* move
    /// with the current angles: it is an arbitrary point on a curve, and
    /// "whichever point is nearest to where you are" is the only non-arbitrary
    /// way to choose it. Asserting invariance over the whole list would be
    /// asserting something false, and would have to be weakened the first time a
    /// degenerate triple was tested.
    #[test]
    fn the_answer_does_not_depend_on_the_current_angles() {
        let base = designed_fans(5, 1)
            .into_iter()
            .next()
            .expect("a closed designed fan exists");
        let reference = solve_fold_angles(&base, [0, 2, 4], bar()).expect("solutions exist");
        let mut seed = 0xabcd_u64;
        for _ in 0..12 {
            let mut moved = base.clone();
            for index in [0usize, 2, 4] {
                moved.creases[index].1 = pseudo_random(&mut seed).to_radians();
            }
            let again = solve_fold_angles(&moved, [0, 2, 4], bar()).expect("solutions exist");
            let isolated = |solutions: &[AngleSolution]| -> Vec<[f64; 3]> {
                solutions
                    .iter()
                    .filter(|entry| entry.isolated)
                    .map(|s| [s.creases[0].1, s.creases[1].1, s.creases[2].1])
                    .collect()
            };
            let mut left = isolated(&reference);
            let mut right = isolated(&again);
            let order =
                |a: &[f64; 3], b: &[f64; 3]| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal);
            left.sort_by(order);
            right.sort_by(order);
            assert_eq!(
                left.len(),
                right.len(),
                "solution count moved with the seed"
            );
            for (want, have) in left.iter().zip(&right) {
                for slot in 0..3 {
                    assert!(
                        (want[slot] - have[slot]).abs() < 1e-6,
                        "solution set moved with the current angles: {want:?} vs {have:?}"
                    );
                }
            }
        }
    }

    /// The vertex already closes, so its own angles are one solution — and the
    /// other is the vertex popped through, which is a real thing to want.
    /// Section 4 declines here because there is nothing to *add*; there is
    /// plenty to change.
    #[test]
    fn a_closed_vertex_offers_its_own_state_and_the_other_branch() {
        let mut found_current = false;
        let mut found_alternative = false;
        let mut flagged = false;
        for fan in designed_fans(5, 40) {
            for triple in triples(5) {
                let Ok(solutions) = solve_fold_angles(&fan, triple, bar()) else {
                    continue;
                };
                let current: Vec<f64> = triple
                    .iter()
                    .map(|index| fan.creases[*index].1.to_degrees())
                    .collect();
                for solution in &solutions {
                    let matches = solution
                        .creases
                        .iter()
                        .zip(&current)
                        .all(|((_, have), want)| (have - want).abs() < 1e-6);
                    if matches {
                        found_current = true;
                        flagged |= solution.is_current;
                    } else {
                        found_alternative = true;
                    }
                    assert_eq!(
                        solution.is_current, matches,
                        "is_current must mean exactly 'the angles it already has'"
                    );
                }
            }
        }
        assert!(found_current, "a closed vertex must offer its own state");
        assert!(found_alternative, "and the popped-through branch");
        assert!(flagged, "and must say which one the vertex is already in");
    }

    /// Solutions are ordered nearest-to-current, so stepping starts at the
    /// smallest change rather than at whichever branch the algebra emitted
    /// first.
    #[test]
    fn solutions_are_ordered_nearest_first() {
        for fan in designed_fans(5, 30) {
            for triple in triples(5) {
                let Ok(solutions) = solve_fold_angles(&fan, triple, bar()) else {
                    continue;
                };
                let current = [
                    fan.creases[triple[0]].1.to_degrees(),
                    fan.creases[triple[1]].1.to_degrees(),
                    fan.creases[triple[2]].1.to_degrees(),
                ];
                let isolated: Vec<f64> = solutions
                    .iter()
                    .filter(|entry| entry.isolated)
                    .map(|entry| entry.distance_from(current))
                    .collect();
                assert!(
                    isolated.windows(2).all(|pair| pair[0] <= pair[1] + 1e-9),
                    "isolated solutions out of order: {isolated:?}"
                );
                assert!(
                    solutions
                        .iter()
                        .skip_while(|entry| entry.isolated)
                        .all(|entry| !entry.isolated),
                    "family members must sort after isolated branches"
                );
            }
        }
    }

    /// Storage resolves to 1e-7 degrees, so a solution that closes as a float
    /// but not once written would be a lie the checker catches a moment later.
    #[test]
    fn solutions_close_at_the_resolution_they_are_stored_at() {
        for fan in designed_fans(5, 40) {
            for triple in triples(5) {
                let Ok(solutions) = solve_fold_angles(&fan, triple, bar()) else {
                    continue;
                };
                for solution in &solutions {
                    for slot in 0..3 {
                        let degrees = solution.creases[slot].1;
                        let stored = solution
                            .fold_magnitude(slot)
                            .map_or(180.0, FoldMagnitude::degrees);
                        assert!(
                            (stored - degrees.abs()).abs() < 1e-9,
                            "{degrees} does not survive storage as {stored}"
                        );
                        assert_eq!(
                            solution.line_color(slot),
                            if degrees < 0.0 {
                                LineColor::Red1
                            } else {
                                LineColor::Blue2
                            }
                        );
                    }
                    assert!(solution.residual_degrees < 1e-6);
                }
            }
        }
    }

    fn sheet() -> CreasePatternModel {
        let mut model = CreasePatternModel::default();
        let corners = [
            (-200.0, -200.0),
            (200.0, -200.0),
            (200.0, 200.0),
            (-200.0, 200.0),
        ];
        for index in 0..4 {
            let (ax, ay) = corners[index];
            let (bx, by) = corners[(index + 1) % 4];
            model.line_segments.push(LineSegment::with_color(
                Point::new(ax, ay),
                Point::new(bx, by),
                LineColor::Black0,
            ));
        }
        model
    }

    /// A document-level vertex, so the provenance mapping is exercised rather
    /// than assumed: the answer has to name the segments it applies to.
    fn model_with_fan(creases: &[(f64, f64)]) -> (CreasePatternModel, Vec<usize>) {
        let mut model = sheet();
        let mut indices = Vec::new();
        for (theta, rho) in creases {
            let radians = theta.to_radians();
            let color = if *rho < 0.0 {
                LineColor::Red1
            } else {
                LineColor::Blue2
            };
            indices.push(model.line_segments.len());
            model.line_segments.push(
                LineSegment::with_color(
                    Point::new(0.0, 0.0),
                    Point::new(150.0 * radians.cos(), 150.0 * radians.sin()),
                    color,
                )
                .with_fold_magnitude(
                    FoldMagnitude::from_degrees(rho.abs()).filter(|value| !value.is_full()),
                ),
            );
        }
        (model, indices)
    }

    #[test]
    fn fan_sources_align_with_the_fan() {
        let (model, _) = model_with_fan(&[(0.0, 90.0), (200.0, -90.0), (95.0, 180.0)]);
        let (fan, sources) =
            crate::checks_spatial::vertex_fan_at_with_sources(&model, Point::new(0.0, 0.0));
        assert_eq!(fan.creases.len(), sources.len());
        // The same fan the checker would build, in the same order.
        let plain = crate::checks_spatial::vertex_fan_at(&model, Point::new(0.0, 0.0));
        assert_eq!(plain.creases, fan.creases);
        for (position, source) in sources.iter().enumerate() {
            let segment = &model.line_segments[*source];
            let expected = (segment.b.y - segment.a.y).atan2(segment.b.x - segment.a.x);
            assert!(
                (wrap_angle(fan.creases[position].0 - expected)).abs() < 1e-9,
                "fan position {position} does not point at segment {source}"
            );
        }
    }

    /// Closure is a statement about walking all the way round a point, and at
    /// the border there is no way round — the same refusal, for the same reason,
    /// as [`crate::solve_spatial::NoCompletion::BoundaryVertex`].
    ///
    /// The border has to be *split* at the vertex, which is what drawing a
    /// crease down to the edge does. An unsplit border passes through without
    /// ending there, and the fan reports `Indeterminate` before the boundary
    /// test is ever reached — a different refusal for a different reason.
    #[test]
    fn a_vertex_on_the_paper_edge_is_declined() {
        let mut model = CreasePatternModel::default();
        let corners = [
            (-200.0, -200.0),
            (200.0, -200.0),
            (200.0, 200.0),
            (-200.0, 200.0),
        ];
        for index in 0..4 {
            let (ax, ay) = corners[index];
            let (bx, by) = corners[(index + 1) % 4];
            if ax == 200.0 && bx == 200.0 {
                for (from, to) in [(ay, 0.0), (0.0, by)] {
                    model.line_segments.push(LineSegment::with_color(
                        Point::new(200.0, from),
                        Point::new(200.0, to),
                        LineColor::Black0,
                    ));
                }
                continue;
            }
            model.line_segments.push(LineSegment::with_color(
                Point::new(ax, ay),
                Point::new(bx, by),
                LineColor::Black0,
            ));
        }
        let mut chosen = Vec::new();
        for theta in [140.0_f64, 180.0, 220.0] {
            let radians = theta.to_radians();
            chosen.push(model.line_segments.len());
            model.line_segments.push(LineSegment::with_color(
                Point::new(200.0, 0.0),
                Point::new(200.0 + 100.0 * radians.cos(), 100.0 * radians.sin()),
                LineColor::Blue2,
            ));
        }
        let solved = vertex_angle_solutions(&model, Point::new(200.0, 0.0), &chosen, bar());
        assert_eq!(solved.no_solution, Some(NoSolution::BoundaryVertex));
        assert!(solved.solutions.is_empty());
    }

    #[test]
    fn a_crease_that_does_not_meet_the_vertex_is_refused() {
        let (model, indices) = model_with_fan(&[(0.0, 90.0), (90.0, -90.0), (200.0, 180.0)]);
        let solved = vertex_angle_solutions(
            &model,
            Point::new(0.0, 0.0),
            &[indices[0], indices[1], 0],
            bar(),
        );
        assert_eq!(solved.no_solution, Some(NoSolution::CreaseNotInFan));

        let duplicated = vertex_angle_solutions(
            &model,
            Point::new(0.0, 0.0),
            &[indices[0], indices[0], indices[1]],
            bar(),
        );
        assert_eq!(duplicated.no_solution, Some(NoSolution::CreaseNotInFan));
    }

    /// The whole document path, end to end: a broken vertex, three creases
    /// nominated, and answers that name the segments they belong to.
    #[test]
    fn the_document_entry_solves_and_names_its_creases() {
        let (model, indices) =
            model_with_fan(&[(0.0, 90.0), (45.0, 180.0), (90.0, -90.0), (225.0, 30.0)]);
        let chosen = [indices[0], indices[2], indices[3]];
        let solved = vertex_angle_solutions(&model, Point::new(0.0, 0.0), &chosen, bar());
        assert_eq!(solved.no_solution, None);
        assert!(!solved.solutions.is_empty());
        assert_eq!(
            solved.isolated_count,
            solved.solutions.iter().filter(|s| s.isolated).count()
        );
        for solution in &solved.solutions {
            let named: Vec<usize> = solution.creases.iter().map(|(index, _)| *index).collect();
            for line in chosen {
                assert!(named.contains(&line), "{named:?} does not name {line}");
            }
            assert!(solution.residual_degrees < 1e-6);
        }
    }

    /// The affordance that makes the tool usable: 62% of randomly chosen triples
    /// cannot close a freely-angled vertex, so guessing is the common experience
    /// unless the software says which creases work.
    #[test]
    fn solvable_partners_agree_with_solving() {
        let (model, indices) = model_with_fan(&[
            (0.0, 90.0),
            (45.0, 180.0),
            (90.0, -90.0),
            (225.0, 30.0),
            (300.0, -60.0),
        ]);
        let chosen = vec![indices[0], indices[1]];
        let partners = solvable_partners(&model, Point::new(0.0, 0.0), &chosen, bar());
        for candidate in &indices[2..] {
            let mut trial = chosen.clone();
            trial.push(*candidate);
            let solvable = vertex_angle_solutions(&model, Point::new(0.0, 0.0), &trial, bar())
                .no_solution
                .is_none();
            assert_eq!(
                partners.contains(candidate),
                solvable,
                "partner marking disagrees with solving for {candidate}"
            );
        }
    }
}

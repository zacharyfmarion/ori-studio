//! Completing a vertex with one more crease — the generalised flat-foldable line.
//!
//! Oriedita's `VERTEX_MAKE_ANGULARLY_FLAT_FOLDABLE_38` answers *"where does one
//! more crease go so this vertex folds flat?"*, by an alternating angle sum over
//! an odd-degree fan. Once a crease can carry any angle that is only half the
//! question: the general one is *"where does it go, and how far does it fold, so
//! this vertex closes?"* — Wong, *3d Kawasaki's theorem with quaternions*, §4.
//!
//! # The solve
//!
//! Inserting a crease into the angular gap after crease `i` splits the closure
//! product in two:
//!
//! ```text
//! Q_L q_new Q_R = 1,   Q_L = q_{n-1}...q_{i+1},   Q_R = q_i...q_0
//! q_new = Q_L^-1 Q_R^-1 = Q_L^-1 Q_tot^-1 Q_L
//! ```
//!
//! **The paper's eq. 35 prints `Q_L^-1 Q_tot Q_L`, dropping the inverse.** Its
//! own derivation one line earlier gives `Q_R^-1 = Q_tot^-1 Q_L`, which is the
//! form implemented here. The difference is not cosmetic: without the inverse a
//! *closed* vertex solves to a half turn rather than to "nothing to add", so the
//! tool would offer a spurious crease on exactly the vertices that need none.
//!
//! Three properties of that expression shape everything below.
//!
//! - **Conjugation preserves the scalar part**, so `w_new = w_tot` in every gap:
//!   the *magnitude* of the new fold is fixed by the fan as a whole and only its
//!   direction varies by gap. `w_tot < 0` therefore rules out every gap at once —
//!   closing would need `|rho| > 180`.
//! - **The problem is overdetermined**: three constraints against two unknowns.
//!   `q_new`'s axis has to lie in the sheet plane, and for *arbitrary* angles it
//!   does not — sampling random real-valued fold angles finds a completion 0
//!   times in 20,000, at every degree from 2 to 11. That statistic is a trap,
//!   and `removing_a_crease_from_a_designed_vertex_recovers_it` exists to say
//!   why: **snapped geometry lands on the solvable set systematically**, because
//!   grid directions and a small angle vocabulary put the quaternion components
//!   in an algebraic ring where the out-of-plane term cancels exactly. On the 45
//!   degree grid with `{+/-90, +/-180}`, removing a crease from a vertex that
//!   closes recovers it **every time**. Nobody draws arbitrary angles; the
//!   measure-zero set is where designed origami lives.
//! - **Each gap admits two readings of the same quaternion.** `(theta, rho)` and
//!   `(theta + pi, -rho)` are the same rotation, so both are offered to the gap
//!   test rather than picking one and hoping.
//!
//! # The flat case is a special case, not a separate one
//!
//! Every classic crease is a pure quaternion in the xy-plane. An odd-degree
//! classic fan therefore has a pure `Q_tot`, so `w_tot = 0` and the solve returns
//! `rho = +/-180` with its axis exactly in the plane — Oriedita's rays, plus the
//! mountain/valley the port leaves to the active colour. An even-degree classic
//! fan has `Q_tot` about the `z` axis, which no gap can put in the plane, so
//! there are no candidates — right, because one more crease would make the degree
//! odd and no odd flat vertex satisfies Maekawa.
//!
//! The solver adds candidates exactly where the port has none to give.
//! `closure_completion_matches_oriedita_on_classic_fans` asserts that against the
//! port's own output.

use crate::checks_spatial::{
    Quat, VertexFan, VertexRegime, closure_product, crease_quat, incident_lines_at,
    is_interior_vertex, quat_conj, quat_mul, quat_residual, quat_rotate, vertex_fan_at,
    vertex_regime,
};
use crate::geometry::{
    Epsilon, FoldMagnitude, LineColor, LineSegment, Point, StraightLine, StraightLineIntersection,
    find_intersection_straight_lines,
};
use crate::model::CreasePatternModel;
use crate::operations::construction::{
    FlatFoldableVertexCandidates, make_vertex_flat_foldable_candidates,
};

/// How far out of the sheet plane `q_new`'s axis may sit and still count as a
/// crease.
///
/// Not a tuned constant: the planarity condition is exact or it is not met at
/// all. A classic fan lands at ~1e-16 by construction (its quaternions never
/// leave the plane), and a fan without a completion misses by an `O(1)` amount.
/// This is the same order as `checks_spatial`'s transversality gap, for the same
/// reason — it separates float noise from a genuine geometric difference.
const PLANAR_EPSILON: f64 = 1e-9;

/// A crease that would close the vertex.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ClosureCompletion {
    /// Direction away from the vertex, in radians.
    pub theta: f64,
    /// Signed fold angle in degrees over `[-180, 180]`. Negative is a mountain.
    pub rho_degrees: f64,
    /// Which angular gap it falls in — the index of the crease it follows.
    pub gap: usize,
}

impl ClosureCompletion {
    /// The line colour this crease must take. The solve determines it; Maekawa
    /// forces it in the flat case, and the port leaves it to the active colour
    /// only because it has no way to know.
    pub fn line_color(&self) -> LineColor {
        if self.rho_degrees < 0.0 {
            LineColor::Red1
        } else {
            LineColor::Blue2
        }
    }

    /// The stored magnitude, with 180 normalised to `None` as everywhere else.
    pub fn fold_magnitude(&self) -> Option<FoldMagnitude> {
        FoldMagnitude::from_degrees(self.rho_degrees.abs()).filter(|value| !value.is_full())
    }
}

/// Why a vertex has no one-crease completion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NoCompletion {
    /// The point is on the paper's edge, where there is no closure condition to
    /// satisfy — walking the creases never comes back round, because the paper
    /// stops.
    ///
    /// **This is a deliberate divergence from Oriedita**, which offers a
    /// flat-foldable candidate here and gets a crease running off the sheet: at
    /// a border vertex with one incident crease its alternating sum degenerates
    /// to a full turn, so it proposes the straight continuation into thin air.
    /// Measured on a 90 degree valley meeting the bottom edge of a 400-unit
    /// sheet, both the port and the solver proposed a crease 50 units below the
    /// paper. Neither answer is useful, so the dispatcher declines for both
    /// regimes and the port keeps its own behaviour where the oracle tests it.
    BoundaryVertex,
    /// The fan could not be evaluated — an unassigned crease, or a segment
    /// passing through the point without ending there.
    Indeterminate,
    /// The vertex already closes. Nothing to add.
    AlreadyClosed,
    /// Closing would need a fold steeper than a full fold.
    ExceedsFullFold,
    /// The solved crease does not lie in the sheet plane in any gap, or lands
    /// outside every gap. Two or more creases would be needed.
    Overdetermined,
    /// Completions exist, but every one of them runs off the paper without
    /// meeting anything, so there is nothing to draw a crease *to*.
    ///
    /// A well-formed sheet always stops a ray — the border is a folding line, so
    /// it stops one like any crease. This reports an open or malformed boundary,
    /// and exists because dropping the candidates silently would look identical
    /// to "no completion exists", which is a different and more discouraging
    /// thing to tell someone.
    RunsOffThePaper,
}

/// Every crease that closes the vertex, one per (gap, reading) that survives.
///
/// `closed_bar` is the closure residual, in radians, at or below which the vertex
/// counts as already closed. Passed in rather than baked in so the tolerance
/// stays the single constant the presentation layer owns — see the fold-angle
/// plan's "keeping the tolerance revisable".
pub fn closure_completions(
    fan: &VertexFan,
    closed_bar: f64,
) -> Result<Vec<ClosureCompletion>, NoCompletion> {
    if fan.indeterminate.is_some() {
        return Err(NoCompletion::Indeterminate);
    }
    let n = fan.creases.len();
    if n == 0 {
        return Err(NoCompletion::Indeterminate);
    }

    let total = closure_product(&fan.creases);
    if quat_residual(total) <= closed_bar {
        return Err(NoCompletion::AlreadyClosed);
    }
    // `w_new` is `w_tot` in every gap, so a negative scalar rules out all of them
    // at once: the missing rotation is more than a half turn and no single crease
    // supplies it.
    if total.0 < -PLANAR_EPSILON {
        return Err(NoCompletion::ExceedsFullFold);
    }

    let inverse = quat_conj(total);
    let mut completions = Vec::new();
    // `Q_L` for the last gap is the empty product; walking gaps downward
    // right-multiplies it by one crease at a time.
    let mut left: Quat = (1.0, 0.0, 0.0, 0.0);
    for gap in (0..n).rev() {
        let axis = quat_rotate(quat_conj(left), [inverse.1, inverse.2, inverse.3]);
        push_gap_completions(&mut completions, fan, gap, total.0, axis);
        let (theta, rho) = fan.creases[gap];
        left = quat_mul(left, crease_quat(theta, rho));
    }

    if completions.is_empty() {
        return Err(NoCompletion::Overdetermined);
    }
    completions.sort_by_key(|completion| completion.gap);
    Ok(completions)
}

/// The readings of `q_new = [w, axis]` that land inside gap `gap`.
fn push_gap_completions(
    out: &mut Vec<ClosureCompletion>,
    fan: &VertexFan,
    gap: usize,
    w: f64,
    axis: [f64; 3],
) {
    // Out of the sheet plane: this gap cannot host a crease at all.
    if axis[2].abs() > PLANAR_EPSILON {
        return;
    }
    let planar = (axis[0] * axis[0] + axis[1] * axis[1]).sqrt();
    if planar <= PLANAR_EPSILON {
        // `q_new` is +/-1: either nothing to add, or a half turn that no crease
        // can supply. Both are settled before we get here.
        return;
    }

    // `2*atan2(|v|, w)` over `[0, pi]`, since `w >= 0` by the caller's guard.
    let rho = 2.0 * planar.atan2(w);
    let theta = axis[1].atan2(axis[0]);
    // The same quaternion read the other way round: a crease pointing the
    // opposite way, folding the opposite direction. At most one of the two can
    // fall in a gap narrower than a half turn, but a reflex gap can take both.
    for (theta, rho) in [
        (theta, rho.to_degrees()),
        (theta + std::f64::consts::PI, -rho.to_degrees()),
    ] {
        if !falls_in_gap(fan, gap, theta) {
            continue;
        }
        out.push(ClosureCompletion {
            theta: normalise_angle(theta),
            rho_degrees: rho,
            gap,
        });
    }
}

/// Is `theta` strictly inside the gap that follows crease `gap`?
///
/// Exclusive at both ends: a completion lying along an existing crease is not a
/// new crease, it is a duplicate. The degree-1 case makes this load-bearing —
/// both readings are inside the single 2*pi gap by width, and only the endpoint
/// test rejects the one lying on top of the existing crease.
fn falls_in_gap(fan: &VertexFan, gap: usize, theta: f64) -> bool {
    let n = fan.creases.len();
    let start = fan.creases[gap].0;
    let width = if n == 1 {
        std::f64::consts::TAU
    } else {
        wrap_positive(fan.creases[(gap + 1) % n].0 - start)
    };
    let offset = wrap_positive(theta - start);
    offset > PLANAR_EPSILON && offset < width - PLANAR_EPSILON
}

/// `angle` mapped into `[0, 2*pi)`.
fn wrap_positive(angle: f64) -> f64 {
    let wrapped = angle % std::f64::consts::TAU;
    if wrapped < 0.0 {
        wrapped + std::f64::consts::TAU
    } else {
        wrapped
    }
}

/// `angle` mapped into `(-pi, pi]`, matching how [`VertexFan`] stores theta.
fn normalise_angle(angle: f64) -> f64 {
    let wrapped = wrap_positive(angle);
    if wrapped > std::f64::consts::PI {
        wrapped - std::f64::consts::TAU
    } else {
        wrapped
    }
}

/// Which lines a candidate ray may end on.
///
/// Creases and the paper border always stop a ray — `is_folding_line` already
/// covers `Black0`, so the border needs nothing special. Auxiliary lines are the
/// only question, and they live in their own collection rather than being a
/// colour, so opting in means scanning one more list.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CandidateStopTargets {
    /// Stop on auxiliary lines too. Off by default: they are construction guides,
    /// and ending a crease on one would be a surprising place to stop.
    pub auxiliary: bool,
}

/// Where a candidate ray ends, and what stopped it.
#[derive(Debug, Clone, PartialEq)]
pub struct CandidateStop {
    pub at: Point,
    /// The line the ray ran into.
    ///
    /// Handed to the commit as its destination, so the software answers the
    /// question the third click used to ask — rather than the commit being
    /// rewritten to do without one.
    pub destination: LineSegment,
}

/// Ray-origin offset below which an intersection is the vertex itself rather than
/// something the ray ran into. Matches the ported extend-until-hit primitive.
const RAY_ORIGIN_EPSILON: f64 = Epsilon::UNKNOWN_1EN5;

/// A candidate as a ray: the infinite line the intersection test needs, plus
/// where it starts and which way it points, which is what tells a hit in front of
/// the vertex from one behind it.
struct Ray {
    line: StraightLine,
    origin: Point,
    direction: (f64, f64),
}

/// How far each candidate ray travels before something stops it.
///
/// # One pass, all rays
///
/// The obvious shape is a loop per candidate, each walking every segment. The
/// preview runs on every pointer move, and six candidates against a 52k-segment
/// document is 300k intersection tests per move. So the walk is outermost and the
/// candidates are the inner loop: the same order the preview already pays for
/// `incident_lines_at` and `vertex_fan_at`, with no index to build or keep.
pub fn stop_candidates(
    model: &CreasePatternModel,
    candidates: &[LineSegment],
    targets: CandidateStopTargets,
) -> Vec<Option<CandidateStop>> {
    // Precomputed per candidate: its infinite line, and the direction that tells
    // a hit in front of the vertex from one behind it.
    let rays: Vec<Option<Ray>> = candidates
        .iter()
        .map(|candidate| {
            let (dx, dy) = (candidate.b.x - candidate.a.x, candidate.b.y - candidate.a.y);
            (dx != 0.0 || dy != 0.0).then(|| Ray {
                line: StraightLine::from_segment(candidate),
                origin: candidate.a,
                direction: (dx, dy),
            })
        })
        .collect();

    let mut best: Vec<Option<(f64, CandidateStop)>> = vec![None; candidates.len()];
    let auxiliary: &[LineSegment] = if targets.auxiliary {
        &model.aux_line_segments
    } else {
        &[]
    };

    for segment in model.line_segments.iter().chain(auxiliary) {
        // Creases and the border; helper colours (indicators, circles) are not
        // things a crease ends on. An auxiliary line reaches here only because
        // the caller asked for its collection.
        if !segment.color.is_folding_line() && !targets.auxiliary {
            continue;
        }
        let target = StraightLine::from_segment(segment);

        for (index, ray) in rays.iter().enumerate() {
            let Some(Ray {
                line,
                origin,
                direction: (dx, dy),
            }) = ray
            else {
                continue;
            };
            if !matches!(
                line.line_segment_intersect_reverse_detail(segment),
                StraightLineIntersection::IntersectX1
                    | StraightLineIntersection::IntersectTA21
                    | StraightLineIntersection::IntersectTB22
            ) {
                continue;
            }

            let at = find_intersection_straight_lines(*line, target);
            // `line` is infinite, so it also meets things *behind* the vertex.
            // A ray does not.
            if (at.x - origin.x) * dx + (at.y - origin.y) * dy <= 0.0 {
                continue;
            }
            let distance = at.distance(*origin);
            if distance <= RAY_ORIGIN_EPSILON {
                continue; // The vertex itself, where every incident crease meets.
            }
            if best[index]
                .as_ref()
                .is_some_and(|(nearest, _)| distance >= *nearest)
            {
                continue;
            }
            best[index] = Some((
                distance,
                CandidateStop {
                    at,
                    destination: segment.clone(),
                },
            ));
        }
    }

    best.into_iter()
        .map(|hit| hit.map(|(_, stop)| stop))
        .collect()
}

/// Candidate rays for the completion tool, from whichever regime owns the vertex.
#[derive(Debug, Clone, PartialEq)]
pub struct VertexCompletionCandidates {
    /// Rays from the vertex, one per candidate, each carrying the crease it
    /// would commit — its mountain/valley and, on the spatial path, its angle.
    ///
    /// The flat path keeps the port's ray *geometry* exactly and only takes the
    /// assignment from the solve; see [`vertex_completion_candidates`].
    pub candidates: Vec<LineSegment>,
    /// What stopped each candidate, index-aligned with `candidates`. The commit
    /// takes its destination from here, so the software answers the question the
    /// third click used to ask.
    pub destinations: Vec<LineSegment>,
    /// Fallback assignment, used only where the solve could not name one: the
    /// active colour, or the lone incident crease's, as the port decides it.
    pub commit_color: LineColor,
    pub regime: VertexRegime,
    /// Why there is nothing to offer, when there is nothing to offer.
    pub no_completion: Option<NoCompletion>,
}

impl VertexCompletionCandidates {
    /// The colour and fold angle to commit for a chosen candidate.
    ///
    /// One rule for both regimes now: a candidate that names a folding crease
    /// carries the assignment the closure solve determined, and anything else
    /// falls back to the port's colour. Maekawa forces the mountain/valley of a
    /// flat completion just as firmly as the spatial solve does — the port only
    /// used the active colour because it had no way to work it out.
    pub fn commit_style(&self, selected: &LineSegment) -> (LineColor, Option<FoldMagnitude>) {
        if matches!(selected.color, LineColor::Red1 | LineColor::Blue2) {
            (selected.color, selected.fold_magnitude)
        } else {
            (self.commit_color, None)
        }
    }

    /// What stopped `selected`, for the commit to use as its destination.
    ///
    /// Matched by position, which is the invariant `candidates` and
    /// `destinations` are built to hold.
    pub fn destination_for(&self, selected: &LineSegment) -> Option<&LineSegment> {
        let index = self
            .candidates
            .iter()
            .position(|candidate| candidate == selected)?;
        self.destinations.get(index)
    }

    /// Whether the assignment the solve forced differs from what the user had
    /// selected, so the UI can say why the crease came out the other colour.
    pub fn overrides_active_color(&self, selected: &LineSegment, active: LineColor) -> bool {
        matches!(selected.color, LineColor::Red1 | LineColor::Blue2) && selected.color != active
    }
}

/// Candidate rays that would complete the vertex under the cursor.
///
/// Dispatch is per vertex, from the same regime test [`vertex_regime`] gives the
/// checker: a vertex whose incident creases are all classic runs Oriedita's
/// candidate *generation* unchanged, and only a vertex touching a non-classic
/// crease takes the solver.
///
/// # Two deliberate divergences from the port
///
/// - **A vertex on the paper's edge is declined.** Closure is a statement about
///   walking all the way round a point, and at the border there is no way round.
///   The port offers a candidate there anyway and it runs off the sheet.
/// - **The mountain/valley comes from the solve, in both regimes.** The port
///   commits in the active colour, which Maekawa may forbid — so the tool could
///   hand you a crease that fails the foldability check a moment later.
///
/// Both live here rather than in [`crate::operations::construction`], so the
/// ported function the oracle tests keeps its own behaviour exactly.
pub fn vertex_completion_candidates(
    model: &CreasePatternModel,
    vertex: Point,
    grid_width: f64,
    active_color: LineColor,
    closed_bar: f64,
    targets: CandidateStopTargets,
) -> VertexCompletionCandidates {
    let lines = incident_lines_at(model, vertex);
    let regime = vertex_regime(&lines);
    let decline = |reason| VertexCompletionCandidates {
        candidates: Vec::new(),
        destinations: Vec::new(),
        commit_color: active_color,
        regime,
        no_completion: Some(reason),
    };

    if !is_interior_vertex(&lines) {
        return decline(NoCompletion::BoundaryVertex);
    }

    let fan = vertex_fan_at(model, vertex);
    let completions = match closure_completions(&fan, closed_bar) {
        Ok(completions) => completions,
        // The flat path is allowed to disagree about *whether* there is a
        // candidate — the port is the authority there, and it is what the oracle
        // pins. Only the assignment is taken from the solve.
        Err(reason) if regime == VertexRegime::Spatial => return decline(reason),
        Err(_) => Vec::new(),
    };

    let (rays, commit_color) = if regime == VertexRegime::Spatial {
        (
            completions
                .into_iter()
                .map(|completion| completion_ray(vertex, completion, grid_width))
                .collect::<Vec<_>>(),
            active_color,
        )
    } else {
        let FlatFoldableVertexCandidates {
            candidates,
            commit_color,
        } = make_vertex_flat_foldable_candidates(model, vertex, grid_width, active_color);
        (
            candidates
                .into_iter()
                .map(|ray| assign_from_solve(ray, &completions))
                .collect(),
            commit_color,
        )
    };

    // Each ray becomes the crease it would be: drawn to what stops it, rather
    // than a fixed-length arrow the user then has to aim.
    let offered = rays.len();
    let mut candidates = Vec::with_capacity(offered);
    let mut destinations = Vec::with_capacity(offered);
    for (ray, stop) in rays
        .iter()
        .zip(stop_candidates(model, &rays, targets))
        // A ray that meets nothing has no crease to become, so it is not offered.
        .filter_map(|(ray, stop)| stop.map(|stop| (ray, stop)))
    {
        candidates.push(ray.with_b(stop.at));
        destinations.push(stop.destination);
    }

    VertexCompletionCandidates {
        no_completion: (offered > 0 && candidates.is_empty())
            .then_some(NoCompletion::RunsOffThePaper),
        candidates,
        destinations,
        commit_color,
        regime,
    }
}

/// Give a port-generated ray the mountain/valley the solve worked out for it.
///
/// Geometry is untouched — the ray is the port's, to the last bit. Only the
/// colour changes, and only when the solve produced a completion pointing the
/// same way. A ray with no match keeps `Purple8` and falls back to the port's
/// commit colour, so an unexpected disagreement degrades to Oriedita's behaviour
/// rather than to a wrong assignment.
fn assign_from_solve(ray: LineSegment, completions: &[ClosureCompletion]) -> LineSegment {
    const MATCH_EPSILON: f64 = 1e-6;
    let (dx, dy) = (ray.b.x - ray.a.x, ray.b.y - ray.a.y);
    if dx == 0.0 && dy == 0.0 {
        return ray;
    }
    let theta = dy.atan2(dx);
    let Some(completion) = completions.iter().find(|completion| {
        let delta = wrap_positive(completion.theta - theta);
        delta < MATCH_EPSILON || (std::f64::consts::TAU - delta) < MATCH_EPSILON
    }) else {
        return ray;
    };
    ray.with_line_color(completion.line_color())
        .with_fold_magnitude(completion.fold_magnitude())
}

/// A candidate as a ray from the vertex, carrying the crease it would become.
///
/// Length matches the port's: `grid_width`, so the two regimes' candidates read
/// the same on the canvas. The ray is an indicator — the committed crease runs to
/// wherever the chosen destination crosses it.
fn completion_ray(vertex: Point, completion: ClosureCompletion, grid_width: f64) -> LineSegment {
    let end = Point::new(
        vertex.x + grid_width * completion.theta.cos(),
        vertex.y + grid_width * completion.theta.sin(),
    );
    LineSegment::with_color(vertex, end, completion.line_color())
        .with_fold_magnitude(completion.fold_magnitude())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::Epsilon;

    /// 1e-6 degrees in radians — the bar the presentation layer applies.
    fn bar() -> f64 {
        1e-6_f64.to_radians()
    }

    /// A fan from degrees, normalised and sorted the way [`vertex_fan`] does —
    /// theta over `(-pi, pi]` — so a fixture's gap indices are the ones the
    /// extraction would really produce.
    fn fan_from(creases: &[(f64, f64)]) -> VertexFan {
        let mut creases: Vec<(f64, f64)> = creases
            .iter()
            .map(|&(theta_deg, rho_deg)| {
                (
                    normalise_angle(theta_deg.to_radians()),
                    rho_deg.to_radians(),
                )
            })
            .collect();
        creases.sort_by(|a, b| a.0.partial_cmp(&b.0).expect("finite"));
        VertexFan {
            point: Point::new(0.0, 0.0),
            creases,
            indeterminate: None,
        }
    }

    /// Applying a completion closes the vertex — the property that matters,
    /// asserted against the checker rather than against the solver's own algebra.
    fn assert_closes(fan: &VertexFan, completion: ClosureCompletion) {
        let mut creases = fan.creases.clone();
        creases.push((completion.theta, completion.rho_degrees.to_radians()));
        creases.sort_by(|a, b| a.0.partial_cmp(&b.0).expect("finite"));
        let completed = VertexFan {
            point: fan.point,
            creases,
            indeterminate: None,
        };
        let residual = crate::checks_spatial::vertex_closure_residual(&completed).to_degrees();
        assert!(
            residual < 1e-9,
            "completing at theta {:.4} rho {:.4} left a residual of {residual} degrees",
            completion.theta.to_degrees(),
            completion.rho_degrees
        );
    }

    #[test]
    fn a_closed_vertex_has_nothing_to_add() {
        // Two collinear valleys: a straight crease through a point, which closes.
        let fan = fan_from(&[(0.0, 180.0), (180.0, 180.0)]);
        assert_eq!(
            closure_completions(&fan, bar()),
            Err(NoCompletion::AlreadyClosed)
        );
    }

    #[test]
    fn a_degree_one_classic_vertex_completes_into_a_straight_crease() {
        let fan = fan_from(&[(0.0, 180.0)]);
        let completions = closure_completions(&fan, bar()).expect("a completion exists");
        // Only one: the other reading of the same quaternion lies on top of the
        // existing crease, and the gap test is exclusive at both ends.
        assert_eq!(completions.len(), 1);
        assert!((completions[0].theta.to_degrees() - 180.0).abs() < 1e-9);
        assert!((completions[0].rho_degrees - 180.0).abs() < 1e-9);
        assert_closes(&fan, completions[0]);
    }

    #[test]
    fn a_classic_odd_vertex_completes_at_full_fold() {
        // Three valleys; the fourth crease is forced to be a mountain.
        let fan = fan_from(&[(0.0, 180.0), (90.0, 180.0), (200.0, 180.0)]);
        let completions = closure_completions(&fan, bar()).expect("a completion exists");
        assert!(!completions.is_empty());
        for completion in &completions {
            assert!(
                (completion.rho_degrees.abs() - 180.0).abs() < 1e-9,
                "a classic fan must complete at a full fold, got {}",
                completion.rho_degrees
            );
            assert_closes(&fan, *completion);
        }
    }

    #[test]
    fn a_classic_even_vertex_has_no_single_crease_completion() {
        // Adding one crease would make the degree odd, and no odd flat vertex
        // satisfies Maekawa. The planarity test is what rejects it.
        let fan = fan_from(&[(0.0, 180.0), (80.0, 180.0), (170.0, 180.0), (260.0, 180.0)]);
        assert!(closure_completions(&fan, bar()).is_err());
    }

    #[test]
    fn a_maekawa_violating_vertex_cannot_be_fixed_by_one_crease() {
        // Four valleys at 90 degrees: Kawasaki holds, Maekawa does not, and the
        // closure product is -1. `w_tot < 0` rules out every gap at once.
        let fan = fan_from(&[(0.0, 180.0), (90.0, 180.0), (180.0, 180.0), (270.0, 180.0)]);
        assert_eq!(
            closure_completions(&fan, bar()),
            Err(NoCompletion::ExceedsFullFold)
        );
    }

    #[test]
    fn an_indeterminate_fan_is_never_completed() {
        let mut fan = fan_from(&[(0.0, 180.0), (90.0, 180.0), (200.0, 180.0)]);
        fan.indeterminate = Some(crate::checks_spatial::Indeterminate::UnsplitJunction);
        assert_eq!(
            closure_completions(&fan, bar()),
            Err(NoCompletion::Indeterminate)
        );
    }

    /// A crease folded to 100 degrees, continued straight through the vertex.
    ///
    /// The one non-classic case with a hand-checkable answer, and a real one: two
    /// collinear creases close for *any* shared angle, so the completion must
    /// come back at exactly 180 degrees round and exactly 100 degrees folded. It
    /// also pins the reading test — the opposite reading of the same quaternion
    /// lands on top of the existing crease and must be rejected.
    #[test]
    fn a_lone_angled_crease_completes_into_a_straight_crease_at_the_same_angle() {
        let fan = fan_from(&[(0.0, 100.0)]);
        let completions = closure_completions(&fan, bar()).expect("a completion exists");
        assert_eq!(completions.len(), 1);
        assert!((completions[0].theta.to_degrees() - 180.0).abs() < 1e-9);
        assert!((completions[0].rho_degrees - 100.0).abs() < 1e-9);
        assert_closes(&fan, completions[0]);
    }

    /// A spatial vertex that *does* admit a completion — the transcription case,
    /// where the missing crease exists because the folded model does.
    ///
    /// §4 is overdetermined, so such fans are codimension 1 and cannot be written
    /// down by picking round numbers; the fixture is *found* instead, by sweeping
    /// one fold angle until the missing rotation lies in the sheet plane. What is
    /// asserted afterwards is not circular: closure of the completed vertex is
    /// [`crate::checks_spatial`]'s verdict, reached without any of this module.
    #[test]
    fn a_spatial_vertex_admitting_a_completion_recovers_it() {
        // Directions chosen so the gap that can host the answer is the *last*
        // one, where `Q_L` is the empty product — which is what makes the
        // planarity residual readable without reaching into the solve.
        let build =
            |last: f64| fan_from(&[(-60.0, 45.0), (10.0, 40.0), (130.0, -40.0), (200.0, last)]);
        // With `Q_L` empty, the solved axis is the closure product's own vector,
        // so its `z` is the planarity residual — signed and continuous, which is
        // what makes it bisectable where the residual itself is not.
        let planarity = |last: f64| closure_product(&build(last).creases).3;
        let (mut low, mut high) = (-8.0_f64, -7.0_f64);
        assert!(
            planarity(low).signum() != planarity(high).signum(),
            "the sweep must bracket a crossing"
        );
        for _ in 0..80 {
            let mid = f64::midpoint(low, high);
            if planarity(mid).signum() == planarity(low).signum() {
                low = mid;
            } else {
                high = mid;
            }
        }

        let fan = build(f64::midpoint(low, high));
        let completions = closure_completions(&fan, bar()).expect("a completion exists");
        assert!(!completions.is_empty());
        for completion in &completions {
            assert!(
                completion.rho_degrees.abs() < 179.0,
                "this vertex closes at a real angle, not a full fold: {}",
                completion.rho_degrees
            );
            assert_closes(&fan, *completion);
        }
    }

    #[test]
    fn a_freely_angled_vertex_reports_that_one_crease_is_not_enough() {
        // Nothing about these angles makes the missing rotation planar.
        let fan = fan_from(&[(0.0, 30.0), (70.0, -110.0), (200.0, 45.0)]);
        assert_eq!(
            closure_completions(&fan, bar()),
            Err(NoCompletion::Overdetermined)
        );
    }

    /// The feature's actual value proposition, measured exhaustively.
    ///
    /// A freely-angled vertex has no one-crease completion — the test above says
    /// so, and sampling random real-valued fold angles finds a completion **0
    /// times in 20,000**, at every degree from 2 to 11.
    ///
    /// That number is worthless as a guide to the tool, and believing it was a
    /// mistake worth pinning down here: nobody draws arbitrary real angles.
    /// Designed origami is snapped — directions on a 45/30/22.5 grid, fold
    /// angles from a small vocabulary — and *snapped geometry lands on the
    /// solvable set systematically*, because the quaternion components then live
    /// in a small algebraic ring where the out-of-plane term cancels exactly.
    ///
    /// So this enumerates every degree-4 and degree-5 vertex on the 45 degree
    /// grid with angles from `{+/-90, +/-180}`, keeps the ones that genuinely
    /// close and involve at least one partial fold, removes each crease in turn,
    /// and requires the tool to name the crease that was taken away — which is
    /// exactly the transcription workflow.
    #[test]
    fn removing_a_crease_from_a_designed_vertex_recovers_it() {
        let grid: Vec<f64> = (0..8).map(|index| f64::from(index) * 45.0).collect();
        let angles = [90.0_f64, -90.0, 180.0, -180.0];
        let mut checked = 0usize;
        let mut unique = 0usize;

        for degree in [4usize, 5] {
            for directions in combinations(&grid, degree) {
                for mask in 0..angles.len().pow(degree as u32) {
                    let mut remaining = mask;
                    let creases: Vec<(f64, f64)> = directions
                        .iter()
                        .map(|&theta| {
                            let angle = angles[remaining % angles.len()];
                            remaining /= angles.len();
                            (theta, angle)
                        })
                        .collect();
                    let full = fan_from(&creases);
                    if crate::checks_spatial::vertex_closure_residual(&full).to_degrees() > 1e-6 {
                        continue;
                    }
                    // All-classic vertices are the port's existing job.
                    if !creases.iter().any(|&(_, rho)| rho.abs() < 179.9) {
                        continue;
                    }

                    for dropped in 0..degree {
                        let partial: Vec<(f64, f64)> = creases
                            .iter()
                            .enumerate()
                            .filter(|(index, _)| *index != dropped)
                            .map(|(_, &crease)| crease)
                            .collect();
                        let (theta, rho) = creases[dropped];
                        let found = closure_completions(&fan_from(&partial), bar()).unwrap_or_else(
                            |reason| {
                                panic!(
                                    "removed {theta} deg / {rho} deg from {creases:?}: {reason:?}"
                                )
                            },
                        );
                        assert!(
                            found.iter().any(|completion| {
                                let delta = (completion.theta.to_degrees().rem_euclid(360.0)
                                    - theta.rem_euclid(360.0))
                                .abs();
                                (delta < 1e-6 || (delta - 360.0).abs() < 1e-6)
                                    && (completion.rho_degrees - rho).abs() < 1e-6
                            }),
                            "removed {theta} deg / {rho} deg from {creases:?}, tool offered {found:?}"
                        );
                        checked += 1;
                        if found.len() == 1 {
                            unique += 1;
                        }
                    }
                }
            }
        }

        // Measured: 1,600 removals, all recovered, 1,120 of them unambiguously.
        // The floor is here so a regression that quietly stops finding these
        // fails rather than passing vacuously.
        assert!(
            checked >= 1_500,
            "expected the enumeration to exercise the solver, got {checked} removals"
        );
        assert!(
            unique * 2 > checked,
            "most recoveries should be unambiguous, got {unique} of {checked}"
        );
    }

    /// Combinations of `k` directions, in ascending order.
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

    /// The generalisation's one falsifiable claim: on the fans the port speaks
    /// for, the solver says the same thing.
    #[test]
    fn closure_completion_matches_oriedita_on_classic_fans() {
        let cases: [&[f64]; 5] = [
            &[0.0, 90.0, 200.0],
            &[0.0, 45.0, 135.0],
            &[10.0, 100.0, 190.0, 250.0, 310.0],
            &[0.0, 30.0, 60.0, 90.0, 120.0],
            &[0.0, 120.0, 240.0],
        ];
        for directions in cases {
            let mut model = sheet();
            for theta in directions {
                let radians = theta.to_radians();
                model.line_segments.push(LineSegment::with_color(
                    Point::new(0.0, 0.0),
                    Point::new(100.0 * radians.cos(), 100.0 * radians.sin()),
                    LineColor::Blue2,
                ));
            }
            let port = make_vertex_flat_foldable_candidates(
                &model,
                Point::new(0.0, 0.0),
                50.0,
                LineColor::Blue2,
            );
            let solved = vertex_completion_candidates(
                &model,
                Point::new(0.0, 0.0),
                50.0,
                LineColor::Blue2,
                bar(),
                stop_targets(),
            );
            // Same regime, so the dispatcher hands these to the port — the point
            // of the test is that the solver would have agreed.
            assert_eq!(solved.regime, VertexRegime::Flat);

            let fan = vertex_fan_at(&model, Point::new(0.0, 0.0));
            let mut solver_directions: Vec<f64> = closure_completions(&fan, bar())
                .map(|completions| {
                    completions
                        .iter()
                        .map(|completion| completion.theta.to_degrees().rem_euclid(360.0))
                        .collect()
                })
                .unwrap_or_default();
            let mut port_directions: Vec<f64> = port
                .candidates
                .iter()
                .map(|candidate| {
                    (candidate.b.y - candidate.a.y)
                        .atan2(candidate.b.x - candidate.a.x)
                        .to_degrees()
                        .rem_euclid(360.0)
                })
                .collect();
            solver_directions.sort_by(|a, b| a.partial_cmp(b).expect("finite"));
            port_directions.sort_by(|a, b| a.partial_cmp(b).expect("finite"));

            assert_eq!(
                solver_directions.len(),
                port_directions.len(),
                "candidate count differs for {directions:?}: solver {solver_directions:?} vs port {port_directions:?}"
            );
            for (solved, ported) in solver_directions.iter().zip(port_directions.iter()) {
                assert!(
                    (solved - ported).abs() < 1e-6,
                    "candidate direction differs for {directions:?}: {solved} vs {ported}"
                );
            }
        }
    }

    /// A square sheet, which every real document has and a candidate ray needs —
    /// without a border, a completion has nothing to run to.
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

    fn stop_targets() -> CandidateStopTargets {
        CandidateStopTargets::default()
    }

    /// A square sheet with the bottom edge split where a crease meets it.
    fn sheet_with_border_split_at(x: f64) -> CreasePatternModel {
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
            if ay == -200.0 && by == -200.0 {
                // Split, which is what drawing a crease down to the edge does.
                model.line_segments.push(LineSegment::with_color(
                    Point::new(ax, ay),
                    Point::new(x, -200.0),
                    LineColor::Black0,
                ));
                model.line_segments.push(LineSegment::with_color(
                    Point::new(x, -200.0),
                    Point::new(bx, by),
                    LineColor::Black0,
                ));
                continue;
            }
            model.line_segments.push(LineSegment::with_color(
                Point::new(ax, ay),
                Point::new(bx, by),
                LineColor::Black0,
            ));
        }
        model
    }

    /// The paper stops at the border, so there is no way round the point and no
    /// closure condition to satisfy. Both regimes decline.
    ///
    /// Left unguarded, the answer is a crease *off the sheet*: a 90 degree valley
    /// meeting the bottom edge of a 400-unit square solved to a crease 50 units
    /// below the paper.
    #[test]
    fn a_vertex_on_the_paper_edge_is_declined_in_both_regimes() {
        for magnitude in [None, FoldMagnitude::from_degrees(90.0)] {
            let mut model = sheet_with_border_split_at(0.0);
            model.line_segments.push(
                LineSegment::with_color(
                    Point::new(0.0, -200.0),
                    Point::new(0.0, 0.0),
                    LineColor::Blue2,
                )
                .with_fold_magnitude(magnitude),
            );
            let at_edge = vertex_completion_candidates(
                &model,
                Point::new(0.0, -200.0),
                50.0,
                LineColor::Blue2,
                bar(),
                stop_targets(),
            );
            assert_eq!(
                at_edge.no_completion,
                Some(NoCompletion::BoundaryVertex),
                "magnitude {magnitude:?} at the paper edge"
            );
            assert!(at_edge.candidates.is_empty());

            // The other end of the same crease is interior, and still answers.
            let interior = vertex_completion_candidates(
                &model,
                Point::new(0.0, 0.0),
                50.0,
                LineColor::Blue2,
                bar(),
                stop_targets(),
            );
            assert_eq!(interior.no_completion, None);
            assert_eq!(interior.candidates.len(), 1);
        }
    }

    /// A ray from the origin toward `(x, y)`, the length a candidate starts at.
    fn ray(x: f64, y: f64) -> LineSegment {
        LineSegment::with_color(Point::new(0.0, 0.0), Point::new(x, y), LineColor::Purple8)
    }

    #[test]
    fn a_ray_stops_at_the_paper_edge() {
        // The common case: nothing in the way, so the border is what stops it.
        // `is_folding_line` already covers `Black0`, so this needs no special
        // handling — worth pinning, because it is the answer most completions get.
        let stops = stop_candidates(&sheet(), &[ray(50.0, 0.0)], stop_targets());
        let stop = stops[0].as_ref().expect("the border stops it");
        assert!((stop.at.x - 200.0).abs() < 1e-9 && stop.at.y.abs() < 1e-9);
        assert_eq!(stop.destination.color, LineColor::Black0);
    }

    #[test]
    fn a_ray_stops_at_the_first_crease_it_meets() {
        let mut model = sheet();
        for x in [50.0_f64, 120.0] {
            model.line_segments.push(LineSegment::with_color(
                Point::new(x, -100.0),
                Point::new(x, 100.0),
                LineColor::Red1,
            ));
        }
        let stops = stop_candidates(&model, &[ray(10.0, 0.0)], stop_targets());
        let stop = stops[0].as_ref().expect("a crease stops it");
        assert!(
            (stop.at.x - 50.0).abs() < 1e-9,
            "took the far crease, not the near one"
        );
    }

    #[test]
    fn a_ray_ignores_what_is_behind_the_vertex() {
        // The intersection test works on an infinite line, so a crease behind the
        // vertex meets it too. A ray does not go backwards.
        let mut model = sheet();
        model.line_segments.push(LineSegment::with_color(
            Point::new(-50.0, -100.0),
            Point::new(-50.0, 100.0),
            LineColor::Red1,
        ));
        let stops = stop_candidates(&model, &[ray(10.0, 0.0)], stop_targets());
        let stop = stops[0].as_ref().expect("the far border stops it");
        assert!(stop.at.x > 0.0, "ran backwards to {:?}", stop.at);
    }

    #[test]
    fn a_ray_is_not_stopped_by_the_creases_at_its_own_vertex() {
        let mut model = sheet();
        for theta in [90.0_f64, 200.0] {
            let radians = theta.to_radians();
            model.line_segments.push(LineSegment::with_color(
                Point::new(0.0, 0.0),
                Point::new(100.0 * radians.cos(), 100.0 * radians.sin()),
                LineColor::Blue2,
            ));
        }
        let stops = stop_candidates(&model, &[ray(10.0, 0.0)], stop_targets());
        let stop = stops[0].as_ref().expect("the border stops it");
        assert!(
            (stop.at.x - 200.0).abs() < 1e-9,
            "stopped at its own vertex"
        );
    }

    #[test]
    fn auxiliary_lines_stop_a_ray_only_when_asked() {
        let mut model = sheet();
        model.aux_line_segments.push(LineSegment::with_color(
            Point::new(30.0, -100.0),
            Point::new(30.0, 100.0),
            LineColor::Cyan3,
        ));

        let ignored = stop_candidates(&model, &[ray(10.0, 0.0)], CandidateStopTargets::default());
        assert!(
            (ignored[0].as_ref().expect("stops somewhere").at.x - 200.0).abs() < 1e-9,
            "an auxiliary line stopped the ray by default"
        );

        let honoured = stop_candidates(
            &model,
            &[ray(10.0, 0.0)],
            CandidateStopTargets { auxiliary: true },
        );
        assert!((honoured[0].as_ref().expect("stops somewhere").at.x - 30.0).abs() < 1e-9);
    }

    #[test]
    fn a_ray_with_nothing_to_hit_reports_running_off_the_paper() {
        // No border, so the completions exist but none of them becomes a crease.
        // Reported rather than silently dropped: silence reads as "no completion
        // exists", which is a different and more discouraging thing to be told.
        let mut model = CreasePatternModel::default();
        for theta in [0.0_f64, 90.0, 200.0] {
            let radians = theta.to_radians();
            model.line_segments.push(LineSegment::with_color(
                Point::new(0.0, 0.0),
                Point::new(100.0 * radians.cos(), 100.0 * radians.sin()),
                LineColor::Blue2,
            ));
        }
        let candidates = vertex_completion_candidates(
            &model,
            Point::new(0.0, 0.0),
            50.0,
            LineColor::Blue2,
            bar(),
            stop_targets(),
        );
        assert!(candidates.candidates.is_empty());
        assert_eq!(
            candidates.no_completion,
            Some(NoCompletion::RunsOffThePaper)
        );
    }

    /// The whole point of the redesign: what the old third click supplied, the
    /// candidate now carries.
    #[test]
    fn a_candidate_carries_the_line_that_stopped_it() {
        let mut model = sheet();
        model.line_segments.push(LineSegment::with_color(
            Point::new(0.0, 0.0),
            Point::new(100.0, 0.0),
            LineColor::Blue2,
        ));
        let candidates = vertex_completion_candidates(
            &model,
            Point::new(0.0, 0.0),
            50.0,
            LineColor::Blue2,
            bar(),
            stop_targets(),
        );
        assert_eq!(candidates.candidates.len(), candidates.destinations.len());
        for candidate in &candidates.candidates {
            let destination = candidates
                .destination_for(candidate)
                .expect("every offered candidate names what stopped it");
            // The far end lies on the line it stopped at.
            let (dx, dy) = (
                destination.b.x - destination.a.x,
                destination.b.y - destination.a.y,
            );
            let (px, py) = (
                candidate.b.x - destination.a.x,
                candidate.b.y - destination.a.y,
            );
            assert!(
                (dx * py - dy * px).abs() < 1e-6,
                "candidate ends at {:?}, not on {destination:?}",
                candidate.b
            );
        }
    }

    /// Maekawa forces the assignment of a flat completion, so the tool commits
    /// what it forces rather than whatever colour happened to be selected.
    #[test]
    fn a_flat_completion_commits_the_assignment_maekawa_forces() {
        // Three valleys: the fourth crease has to be a mountain.
        let mut model = sheet();
        for theta in [0.0_f64, 90.0, 200.0] {
            let radians = theta.to_radians();
            model.line_segments.push(LineSegment::with_color(
                Point::new(0.0, 0.0),
                Point::new(100.0 * radians.cos(), 100.0 * radians.sin()),
                LineColor::Blue2,
            ));
        }
        // Ask with Valley active — the answer must still be a Mountain.
        let candidates = vertex_completion_candidates(
            &model,
            Point::new(0.0, 0.0),
            50.0,
            LineColor::Blue2,
            bar(),
            stop_targets(),
        );
        assert_eq!(candidates.regime, VertexRegime::Flat);
        assert!(!candidates.candidates.is_empty());
        for candidate in &candidates.candidates {
            let (color, magnitude) = candidates.commit_style(candidate);
            assert_eq!(
                color,
                LineColor::Red1,
                "three valleys force a mountain, got {color:?}"
            );
            assert_eq!(magnitude, None, "a flat completion is a full fold");
            assert!(
                candidates.overrides_active_color(candidate, LineColor::Blue2),
                "the UI needs to know the active colour was overridden"
            );
        }
    }

    /// The port's ray *direction* is what the oracle pins, so neither taking the
    /// assignment from the solve nor extending the ray may bend it.
    ///
    /// The endpoint does move, on purpose — that is the extension, and it is why
    /// this asserts a direction rather than a point.
    #[test]
    fn taking_the_assignment_leaves_the_ports_direction() {
        let mut model = sheet();
        for theta in [0.0_f64, 90.0, 200.0] {
            let radians = theta.to_radians();
            model.line_segments.push(LineSegment::with_color(
                Point::new(0.0, 0.0),
                Point::new(100.0 * radians.cos(), 100.0 * radians.sin()),
                LineColor::Blue2,
            ));
        }
        let port = make_vertex_flat_foldable_candidates(
            &model,
            Point::new(0.0, 0.0),
            50.0,
            LineColor::Blue2,
        );
        let dispatched = vertex_completion_candidates(
            &model,
            Point::new(0.0, 0.0),
            50.0,
            LineColor::Blue2,
            bar(),
            stop_targets(),
        );
        assert_eq!(port.candidates.len(), dispatched.candidates.len());
        for (ported, extended) in port.candidates.iter().zip(dispatched.candidates.iter()) {
            assert_eq!(ported.a, extended.a, "ray start moved");
            assert_eq!(ported.active, extended.active);
            let (px, py) = (ported.b.x - ported.a.x, ported.b.y - ported.a.y);
            let (ex, ey) = (extended.b.x - extended.a.x, extended.b.y - extended.a.y);
            let cross = px * ey - py * ex;
            assert!(
                cross.abs() < 1e-9,
                "the extended ray left the port's line: {ported:?} vs {extended:?}"
            );
            assert!(
                px * ex + py * ey > 0.0,
                "the extended ray points the other way: {ported:?} vs {extended:?}"
            );
            assert!(
                (ex * ex + ey * ey) > (px * px + py * py),
                "extension should reach past the port's stub"
            );
        }
    }

    #[test]
    fn a_spatial_vertex_takes_the_solver_and_a_classic_one_takes_the_port() {
        let mut model = sheet();
        model.line_segments.push(LineSegment::with_color(
            Point::new(0.0, 0.0),
            Point::new(100.0, 0.0),
            LineColor::Blue2,
        ));
        model.line_segments.push(
            LineSegment::with_color(
                Point::new(0.0, 0.0),
                Point::new(0.0, 100.0),
                LineColor::Red1,
            )
            .with_fold_magnitude(FoldMagnitude::from_degrees(100.0)),
        );
        model.line_segments.push(
            LineSegment::with_color(
                Point::new(0.0, 0.0),
                Point::new(-100.0, 0.0),
                LineColor::Blue2,
            )
            .with_fold_magnitude(FoldMagnitude::from_degrees(100.0)),
        );
        let candidates = vertex_completion_candidates(
            &model,
            Point::new(0.0, 0.0),
            50.0,
            LineColor::Blue2,
            bar(),
            stop_targets(),
        );
        assert_eq!(candidates.regime, VertexRegime::Spatial);
        // Whatever it finds, a candidate ray must carry the crease it commits.
        for candidate in &candidates.candidates {
            let (color, magnitude) = candidates.commit_style(candidate);
            assert_eq!(color, candidate.color);
            assert_eq!(magnitude, candidate.fold_magnitude);
            assert!(Epsilon::HIGH.gt0(candidate.determine_length()));
        }
    }
}

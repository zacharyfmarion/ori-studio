//! What a witness asks of the folder, judged on the paper as it stands:
//! whether they can see the alignment, whether it is a practical fold at
//! all, how precise it is, and where it happens relative to the crease
//! being made.
//!
//! The ordering pass picks a card's witness by these (`order::pick_witness`),
//! and `measure_ends` and `explain_steps` count and print the same
//! judgements, so what the corpus says about a pick is what the pick used.
//! The rules are the ones in
//! `implementation-plans/precrease-legible-picks.md`, read off a folded
//! markhor:
//!
//! - **R0** An interior point never starts a point-onto-point fold. Lining
//!   an interior point up on another means seeing through the paper. The one
//!   exception is a crease already made through that point, parallel to the
//!   fold and of the opposite assignment: folding it first puts the point on
//!   a folded edge, and being parallel, folding the flap over disturbs
//!   nothing. See [`o2_start_is_practical`].
//! - **R1** Visibility outranks ease: [`Witness::visible`] is asked before
//!   the ease order, and the skinny flap after it.
//! - **R2** Precision: the **lever** is how far apart the things lined up
//!   are — two points, the overlap of two creases, a swing's radius — and the
//!   **reach** is how far the crease being made is from the alignment. The
//!   error at the crease is bounded by their ratio ([`Judgement::error`]),
//!   and a witness whose lever is under [`MIN_LEVER`] or whose error is over
//!   [`MAX_ERROR`] is imprecise.
//! - **R3** A bisection whose vertex is at the crease is the fold — when the
//!   folder can see the angle: its vertex on the sheet's edge, or one of its
//!   arms the edge itself. Two interior creases meeting inside the sheet are
//!   a fold to line up under the paper, and a short crease between them is
//!   joined instead.
//! - **R4** A short crease is creased between its own two marks.
//! - **R7** A mark is a crossing; a crease ending on another is not one.
//! - **R9** A line folded onto itself through a mark is a hinge trick when
//!   the line's crease is short and an ordinary fold when it is long.

use crate::constants::{MIN_ANGLE_SINE, fold_ease};
use crate::direction::Direction;
use crate::line::Line;
use crate::marks::{
    Creased, MIN_ALIGNMENT, mark_exists, mark_is_crossing, witness_alignment, witness_marks_exist,
};
use crate::pinch::PINCH_HALF_LENGTH;
use crate::predicates::{Ref, Witness, ref_on_boundary};
use crate::state::State;
use crate::tol::TOL;

/// The least a fold's two references may be apart, in sheet units, for the
/// fold to be made accurately: a pinch's length and a half. Two marks a
/// thumb's width apart fix a fold no better than one mark and a guess.
pub const MIN_LEVER: f64 = 0.09;
/// The most an alignment's error may grow by the time it reaches the crease:
/// the farthest end of the crease at most this many levers from where the
/// alignment happens. Beyond it the crease lands somewhere near the line.
pub const MAX_ERROR: f64 = 3.0;
/// How far from the crease an alignment's anchor may be and still count as
/// *at* the crease: a bisection's vertex at the crease's end, two marks the
/// crease runs between. A pinch's length: the width of a pressed mark.
pub const AT_CREASE: f64 = 2.0 * PINCH_HALF_LENGTH;
/// A crease no longer than this, with a mark at each end, is creased between
/// them rather than sighted from anything further away: a fifth of the
/// sheet. Lining a short crease up against references elsewhere on the sheet
/// gains nothing over joining two marks the folder can see at once.
pub const CONNECT_CREASE: f64 = 0.2;
/// A crease's alignment at least this long makes a fold onto itself through
/// a mark an ordinary fold — the crease is long enough to lay along itself —
/// rather than the hinge trick a perpendicular to a short crease is.
pub const LONG_ALIGNMENT: f64 = 0.25;
/// Two lines are parallel, for the purpose of R0's exception, within this
/// sine: a crease a degree off the fold still folds the point onto an edge
/// the fold does not disturb.
pub const PARALLEL_SINE: f64 = 0.02;

/// A witness, judged.
#[derive(Debug, Clone, PartialEq)]
pub struct Judgement {
    /// R0: not an interior point folded onto another, or the exception.
    pub practical: bool,
    /// R1: the folder can watch the alignment — [`Witness::visible`].
    pub visible: bool,
    /// The fold leaves a sliver of a flap — [`Witness::skinny`].
    pub skinny: bool,
    /// How far apart the things lined up are; `None` when the witness has no
    /// single alignment to measure (O6).
    pub lever: Option<f64>,
    /// From the alignment's anchor to the nearest point of the crease.
    pub reach: Option<f64>,
    /// From the anchor to the farthest end of the crease: what the error
    /// grows by.
    pub reach_far: Option<f64>,
    /// `reach_far / lever`: how many times the alignment's own error the
    /// crease's end can be off by.
    pub error: Option<f64>,
    /// R2: lever at least [`MIN_LEVER`] and error at most [`MAX_ERROR`]; a
    /// witness with nothing to measure is not called imprecise, and nor is a
    /// crease joined between its own two marks, however short.
    pub precise: bool,
    /// The anchor lies within [`AT_CREASE`] of the crease being made.
    pub at_crease: bool,
    /// R3: an O3 whose vertex is at the crease and at the sheet's edge — or
    /// one of whose arms is the edge — so the angle is one the folder sees.
    pub bisection_at_crease: bool,
    /// R4: an O1 through both ends of a crease no longer than
    /// [`CONNECT_CREASE`].
    pub own_ends: bool,
    /// R7: every mark the witness names that is on the paper is a crossing of
    /// two creases, not a crease's end on another. A mark not yet there is a
    /// press's business, priced by the pick, and not counted here as well.
    pub crossings: bool,
    /// The ease the pick uses: the witness's own, or an edge fold's for a
    /// line folded onto itself along a long crease (R9).
    pub ease: u8,
    /// The folder makes it in one motion: [`Witness::one_motion`], a short
    /// crease joined between its own marks, or a long crease folded onto
    /// itself through a mark (R9) — the same motion as the edge onto itself.
    pub one_motion: bool,
}

impl Judgement {
    /// Whether the judgement makes the fold one the folder makes at the
    /// crease itself: a bisection with its vertex there, or the crease's own
    /// two marks joined.
    pub fn local(&self) -> bool {
        self.bisection_at_crease || self.own_ends
    }
}

/// The direction a line on the paper was made in, for R0's exception.
pub type DirectionOfLine<'a> = &'a dyn Fn(usize) -> Option<Direction>;

/// R0. Whether an O2 is a fold a folder can make: its moving point is on the
/// boundary, or a crease already made runs through it parallel to the fold
/// and of the opposite assignment. Any other witness is practical here — the
/// rule is about lining one point up on another.
pub fn o2_start_is_practical(
    state: &State,
    creased: &Creased,
    fold: &Line,
    direction: Direction,
    direction_of_line: DirectionOfLine<'_>,
    w: &Witness,
) -> bool {
    if w.axiom != 2 {
        return true;
    }
    let Some(&moving) = w.who_moves.first() else {
        return true;
    };
    let Some(r) = w.inputs.get(usize::from(moving)) else {
        return true;
    };
    if ref_on_boundary(state, r) {
        return true;
    }
    let Ref::Point { id } = r else {
        return true;
    };
    let Some(point) = state.points().get(*id) else {
        return false;
    };
    let opposite = direction.flipped();
    if opposite == Direction::Unassigned {
        return false;
    }
    point.lines.iter().any(|&l| {
        creased.crease_reaches(state, l, point.p)
            && state.line(l).cross(fold).abs() <= PARALLEL_SINE
            && direction_of_line(l) == Some(opposite)
    })
}

/// Where the alignment happens: two points' midpoint, two lines' crossing,
/// a perpendicular's foot on the line it is perpendicular to, a swing's
/// pivot. `None` for O6, and for an O3 of parallel lines.
pub fn anchor(state: &State, fold: &Line, w: &Witness) -> Option<[f64; 2]> {
    let point = |i: usize| -> Option<[f64; 2]> {
        match w.inputs.get(i)? {
            Ref::Point { id } | Ref::Corner { id, .. } => Some(state.point(*id)),
            _ => None,
        }
    };
    let line = |i: usize| -> Option<&Line> {
        match w.inputs.get(i)? {
            Ref::Line { id } | Ref::Edge { id, .. } => Some(state.line(*id)),
            _ => None,
        }
    };
    match w.axiom {
        1 | 2 => {
            let (a, b) = (point(0)?, point(1)?);
            Some([(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0])
        }
        3 => line(0)?.intersect(line(1)?),
        4 => line(1)?.intersect(fold),
        5 => point(0),
        7 => line(2)?.intersect(fold),
        _ => None,
    }
}

/// How far apart the things lined up are. A swing's radius is discounted by
/// how squarely the arc meets the line it lands on: a pivot close to that
/// line has the point graze it, and the landing fixes nothing.
pub fn lever(state: &State, creased: &Creased, fold: &Line, w: &Witness) -> Option<f64> {
    let point = |i: usize| -> Option<[f64; 2]> {
        match w.inputs.get(i)? {
            Ref::Point { id } | Ref::Corner { id, .. } => Some(state.point(*id)),
            _ => None,
        }
    };
    let dist = |a: [f64; 2], b: [f64; 2]| (a[0] - b[0]).hypot(a[1] - b[1]);
    match w.axiom {
        1 | 2 => Some(dist(point(0)?, point(1)?)),
        3 | 4 | 7 => witness_alignment(state, creased, fold, w),
        5 => {
            let (pivot, p) = (point(0)?, point(1)?);
            let Some(Ref::Line { id } | Ref::Edge { id, .. }) = w.inputs.get(2) else {
                return None;
            };
            let landing = fold.reflect_point(p);
            let r = [landing[0] - pivot[0], landing[1] - pivot[1]];
            let radius = r[0].hypot(r[1]);
            if radius <= TOL {
                return Some(0.0);
            }
            let u = state.line(*id).direction();
            let square = ((r[0] * u[0] + r[1] * u[1]) / radius).abs();
            Some(radius * square)
        }
        _ => None,
    }
}

/// Distance from `p` to the segment `a`–`b`.
fn segment_distance(p: [f64; 2], a: [f64; 2], b: [f64; 2]) -> f64 {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let len2 = dx * dx + dy * dy;
    let t = if len2 <= TOL * TOL {
        0.0
    } else {
        (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2).clamp(0.0, 1.0)
    };
    (p[0] - (a[0] + t * dx)).hypot(p[1] - (a[1] + t * dy))
}

/// Judge `w` for a fold along `fold` that will crease `made` (its runs, as
/// [`crate::marks::reach`] gives them) for the pattern's own `spans`, in
/// `direction`, on the paper as it stands. The reach and the error are
/// measured to the crease that will be made; whether the crease is a short
/// one between its own two marks is the pattern's crease, since the reach
/// rule may carry a crease past marks it cannot yet promise the folder.
#[allow(clippy::too_many_arguments)]
pub fn judge(
    state: &State,
    creased: &Creased,
    fold: &Line,
    made: &[[[f64; 2]; 2]],
    spans: &[[[f64; 2]; 2]],
    direction: Direction,
    direction_of_line: DirectionOfLine<'_>,
    w: &Witness,
) -> Judgement {
    let practical = o2_start_is_practical(state, creased, fold, direction, direction_of_line, w);
    let lever = lever(state, creased, fold, w);
    let anchor = anchor(state, fold, w);
    let (reach, reach_far) = match anchor {
        Some(a) if !made.is_empty() => {
            let near = made
                .iter()
                .map(|[p, q]| segment_distance(a, *p, *q))
                .fold(f64::INFINITY, f64::min);
            let far = made
                .iter()
                .flat_map(|[p, q]| [*p, *q])
                .map(|e| (e[0] - a[0]).hypot(e[1] - a[1]))
                .fold(0.0, f64::max);
            (Some(near), Some(far))
        }
        _ => (None, None),
    };
    let error = match (lever, reach_far) {
        (Some(l), Some(far)) if l > TOL => Some(far / l),
        (Some(l), Some(_)) if l <= TOL => Some(f64::INFINITY),
        _ => None,
    };
    let own_ends = w.axiom == 1 && is_own_ends(state, fold, spans, w);
    // The crease's own two marks are as far apart as the crease is long, and
    // nothing lines a crease up better than the marks it runs between; the
    // lever floor is for references elsewhere on the sheet.
    let precise =
        (own_ends || lever.is_none_or(|l| l >= MIN_LEVER)) && error.is_none_or(|e| e <= MAX_ERROR);
    let at_crease = reach.is_some_and(|r| r <= AT_CREASE);
    let angle_seen = w.inputs.iter().any(|r| ref_on_boundary(state, r))
        || anchor.is_some_and(|a| state.sheet().on_boundary(a));
    let bisection_at_crease = w.axiom == 3
        && w.visible
        && at_crease
        && angle_seen
        && lever.is_some_and(|l| l >= MIN_ALIGNMENT - TOL);
    let crossings = w.inputs.iter().all(|r| match r {
        Ref::Point { id } => state.points().get(*id).is_some_and(|p| {
            !mark_exists(state, creased, p.p, &p.lines)
                || mark_is_crossing(state, creased, p.p, &p.lines)
        }),
        _ => true,
    });
    let alignment = witness_alignment(state, creased, fold, w);
    let long_crease_onto_itself = w.axiom == 4
        && !w.folds_edge_onto_itself()
        && alignment.is_some_and(|a| a >= LONG_ALIGNMENT);
    let ease = if long_crease_onto_itself {
        fold_ease(4, true).unwrap_or(w.ease as usize) as u8
    } else {
        w.ease
    };
    let one_motion = w.one_motion() || own_ends || long_crease_onto_itself;
    Judgement {
        practical,
        visible: w.visible,
        skinny: w.skinny,
        lever,
        reach,
        reach_far,
        error,
        precise,
        at_crease,
        bisection_at_crease,
        own_ends,
        crossings,
        ease,
        one_motion,
    }
}

/// R4: `w` is an O1 through the two ends of a single crease no longer than
/// [`CONNECT_CREASE`] — each mark within a pinch of an end, one per end.
fn is_own_ends(state: &State, fold: &Line, spans: &[[[f64; 2]; 2]], w: &Witness) -> bool {
    let runs = crate::marks::crease_runs(fold, spans);
    let [(a, b)] = runs.as_slice() else {
        return false;
    };
    let (a, b) = (*a, *b);
    let length = (a[0] - b[0]).hypot(a[1] - b[1]);
    if length > CONNECT_CREASE {
        return false;
    }
    let mut points = w.inputs.iter().filter_map(|r| match r {
        Ref::Point { id } | Ref::Corner { id, .. } => Some(state.point(*id)),
        _ => None,
    });
    let (Some(p), Some(q)) = (points.next(), points.next()) else {
        return false;
    };
    let near = |x: [f64; 2], e: [f64; 2]| (x[0] - e[0]).hypot(x[1] - e[1]) <= AT_CREASE;
    (near(p, a) && near(q, b)) || (near(p, b) && near(q, a))
}

/// Whether `w`'s marks are all on the paper and it names at least the
/// references a card needs — the question [`judge`] does not ask, kept
/// beside it so a caller has both.
pub fn marks_on_paper(state: &State, creased: &Creased, w: &Witness) -> bool {
    witness_marks_exist(state, creased, w)
}

/// The sine the R0 exception and the bisection test share for "squarely",
/// re-exported so the tools print the same numbers the pick used.
pub const SQUARELY_SINE: f64 = MIN_ANGLE_SINE;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sheet::Sheet;
    use crate::state::{DEFAULT_POINT_CAP, LineTag};

    fn v(x: f64) -> Line {
        Line::new([1.0, 0.0], x).expect("line")
    }

    fn h(y: f64) -> Line {
        Line::new([0.0, 1.0], y).expect("line")
    }

    fn witness(axiom: u8, inputs: Vec<Ref>, who_moves: Vec<u8>, visible: bool) -> Witness {
        Witness {
            axiom,
            inputs,
            root: 0,
            who_moves,
            hard: !visible,
            visible,
            skinny: false,
            ease: fold_ease(axiom, false).expect("ease") as u8,
            err: 0.0,
        }
    }

    /// The vertical midline and two horizontals, all creased whole; the fold
    /// judged is y = 0.5, which folds (0.5, 0.25) onto (0.5, 0.75).
    fn paper() -> (State, Creased) {
        let mut state = State::new(Sheet::unit_square(), DEFAULT_POINT_CAP);
        let up = state.add_line(v(0.5), LineTag::Cp).expect("up").id;
        let low = state.add_line(h(0.25), LineTag::Cp).expect("low").id;
        let high = state.add_line(h(0.75), LineTag::Cp).expect("high").id;
        let mut creased = Creased::new(&state);
        creased.add_whole(&state, up);
        creased.add_whole(&state, low);
        creased.add_whole(&state, high);
        (state, creased)
    }

    #[test]
    fn an_interior_point_does_not_start_a_point_onto_point_fold() {
        let (state, creased) = paper();
        let a = state.find_point([0.5, 0.25]).expect("a");
        let b = state.find_point([0.5, 0.75]).expect("b");
        let w = witness(
            2,
            vec![Ref::Point { id: a }, Ref::Point { id: b }],
            vec![0],
            false,
        );
        let fold = h(0.5);
        let none: DirectionOfLine<'_> = &|_| None;
        assert!(!o2_start_is_practical(
            &state,
            &creased,
            &fold,
            Direction::Valley,
            none,
            &w
        ));
        // A mark on the edge moving is a fold.
        let top = state.find_point([0.5, 1.0]).expect("top");
        let edge = witness(
            2,
            vec![Ref::Point { id: top }, Ref::Point { id: a }],
            vec![0],
            true,
        );
        let fold = h(0.625);
        assert!(o2_start_is_practical(
            &state,
            &creased,
            &fold,
            Direction::Valley,
            none,
            &edge
        ));
        // Any other axiom is not this rule's business.
        let o1 = witness(
            1,
            vec![Ref::Point { id: a }, Ref::Point { id: b }],
            vec![],
            true,
        );
        assert!(o2_start_is_practical(
            &state,
            &creased,
            &v(0.5),
            Direction::Valley,
            none,
            &o1
        ));
    }

    #[test]
    fn a_parallel_crease_of_the_opposite_assignment_through_the_point_is_the_exception() {
        let (state, creased) = paper();
        let a = state.find_point([0.5, 0.25]).expect("a");
        let b = state.find_point([0.5, 0.75]).expect("b");
        let low = state.find_line(&h(0.25)).expect("low");
        let w = witness(
            2,
            vec![Ref::Point { id: a }, Ref::Point { id: b }],
            vec![0],
            false,
        );
        let fold = h(0.5);
        // The horizontal through (0.5, 0.25) is parallel to the fold. Made
        // as a mountain, it lets a valley fold start there …
        let mountain: DirectionOfLine<'_> = &|l| (l == low).then_some(Direction::Mountain);
        assert!(o2_start_is_practical(
            &state,
            &creased,
            &fold,
            Direction::Valley,
            mountain,
            &w
        ));
        // … and not a mountain fold, nor a fold with no assignment.
        assert!(!o2_start_is_practical(
            &state,
            &creased,
            &fold,
            Direction::Mountain,
            mountain,
            &w
        ));
        assert!(!o2_start_is_practical(
            &state,
            &creased,
            &fold,
            Direction::Unassigned,
            mountain,
            &w
        ));
        // The vertical through the point is not parallel to the fold.
        let up = state.find_line(&v(0.5)).expect("up");
        let up_mountain: DirectionOfLine<'_> = &|l| (l == up).then_some(Direction::Mountain);
        assert!(!o2_start_is_practical(
            &state,
            &creased,
            &fold,
            Direction::Valley,
            up_mountain,
            &w
        ));
        // And the crease has to be there: the same line, not creased through
        // the point, is no help.
        let mut bare = Creased::new(&state);
        bare.add_whole(&state, up);
        bare.add_spans(&state, low, &h(0.25), &[[[0.6, 0.25], [1.0, 0.25]]]);
        assert!(!o2_start_is_practical(
            &state,
            &bare,
            &fold,
            Direction::Valley,
            mountain,
            &w
        ));
    }

    #[test]
    fn lever_reach_and_error_read_off_the_geometry() {
        let (state, creased) = paper();
        let a = state.find_point([0.5, 0.25]).expect("a");
        let b = state.find_point([0.5, 0.75]).expect("b");
        let w = witness(
            2,
            vec![Ref::Point { id: a }, Ref::Point { id: b }],
            vec![0],
            false,
        );
        let fold = h(0.5);
        let none: DirectionOfLine<'_> = &|_| None;
        // A crease at the far right of the line: the alignment happens at
        // the midline, 0.4 away; its far end is 0.5 away.
        let made = [[[0.9, 0.5], [1.0, 0.5]]];
        let j = judge(
            &state,
            &creased,
            &fold,
            &made,
            &made,
            Direction::Valley,
            none,
            &w,
        );
        assert!((j.lever.expect("lever") - 0.5).abs() < 1e-9);
        assert!((j.reach.expect("reach") - 0.4).abs() < 1e-9);
        assert!((j.reach_far.expect("far") - 0.5).abs() < 1e-9);
        assert!((j.error.expect("error") - 1.0).abs() < 1e-9);
        assert!(j.precise);
        assert!(!j.at_crease);
        assert!(!j.practical, "both points interior");
        // The same crease made across the midline: at the alignment.
        let made = [[[0.4, 0.5], [0.6, 0.5]]];
        let j = judge(
            &state,
            &creased,
            &fold,
            &made,
            &made,
            Direction::Valley,
            none,
            &w,
        );
        assert!(j.at_crease);
        assert!(j.reach.expect("reach") < 1e-9);
    }

    #[test]
    fn a_pair_too_close_or_too_far_from_the_crease_is_imprecise() {
        let mut state = State::new(Sheet::unit_square(), DEFAULT_POINT_CAP);
        let up = state.add_line(v(0.5), LineTag::Cp).expect("up").id;
        let a_line = state.add_line(h(0.48), LineTag::Cp).expect("a").id;
        let b_line = state.add_line(h(0.52), LineTag::Cp).expect("b").id;
        let mut creased = Creased::new(&state);
        for id in [up, a_line, b_line] {
            creased.add_whole(&state, id);
        }
        let a = state.find_point([0.5, 0.48]).expect("a");
        let b = state.find_point([0.5, 0.52]).expect("b");
        let w = witness(
            2,
            vec![Ref::Point { id: a }, Ref::Point { id: b }],
            vec![0],
            false,
        );
        let none: DirectionOfLine<'_> = &|_| None;
        let j = judge(
            &state,
            &creased,
            &h(0.5),
            &[[[0.4, 0.5], [0.6, 0.5]]],
            &[[[0.4, 0.5], [0.6, 0.5]]],
            Direction::Valley,
            none,
            &w,
        );
        assert!(j.lever.expect("lever") < MIN_LEVER);
        assert!(!j.precise, "0.04 apart fixes nothing");
        // Far apart, but the crease is a sheet away from where they meet.
        let (state, creased) = paper();
        let a = state.find_point([0.5, 0.25]).expect("a");
        let b = state.find_point([0.5, 0.75]).expect("b");
        let w = witness(
            2,
            vec![Ref::Point { id: a }, Ref::Point { id: b }],
            vec![0],
            false,
        );
        let wide = Line::new([0.0, 1.0], 0.5).expect("line");
        let far = [[[2.0, 0.5], [2.1, 0.5]]];
        let j = judge(
            &state,
            &creased,
            &wide,
            &far,
            &far,
            Direction::Valley,
            none,
            &w,
        );
        assert!(j.error.expect("error") > MAX_ERROR);
        assert!(!j.precise);
    }

    #[test]
    fn a_bisection_with_its_vertex_at_the_crease_and_a_short_crease_between_its_marks() {
        let (state, creased) = paper();
        let up = state.find_line(&v(0.5)).expect("up");
        let low = state.find_line(&h(0.25)).expect("low");
        let bottom = state.find_line(&h(0.0)).expect("bottom edge");
        // The 45° line through (0.5, 0): the bisector of the vertical and the
        // bottom edge, which meet there — an angle the folder can see.
        let diagonal = Line::from_points([0.5, 0.0], [0.75, 0.25]).expect("line");
        let o3 = witness(
            3,
            vec![
                Ref::Line { id: up },
                Ref::Edge {
                    id: bottom,
                    side: crate::sheet::EdgeSide::Bottom,
                },
            ],
            vec![1],
            true,
        );
        let none: DirectionOfLine<'_> = &|_| None;
        let at = judge(
            &state,
            &creased,
            &diagonal,
            &[[[0.5, 0.0], [0.6, 0.1]]],
            &[[[0.5, 0.0], [0.6, 0.1]]],
            Direction::Valley,
            none,
            &o3,
        );
        assert!(at.at_crease);
        assert!(at.bisection_at_crease);
        assert!(at.local());
        let away = judge(
            &state,
            &creased,
            &diagonal,
            &[[[0.7, 0.2], [0.75, 0.25]]],
            &[[[0.7, 0.2], [0.75, 0.25]]],
            Direction::Valley,
            none,
            &o3,
        );
        assert!(
            !away.bisection_at_crease,
            "the vertex is 0.28 from the crease"
        );
        // Two interior creases meeting inside the sheet: an angle lined up
        // under the paper, which is not the fold for a short crease.
        let interior = Line::from_points([0.5, 0.25], [0.75, 0.5]).expect("line");
        let inside = witness(
            3,
            vec![Ref::Line { id: up }, Ref::Line { id: low }],
            vec![0],
            true,
        );
        let j = judge(
            &state,
            &creased,
            &interior,
            &[[[0.5, 0.25], [0.6, 0.35]]],
            &[[[0.5, 0.25], [0.6, 0.35]]],
            Direction::Valley,
            none,
            &inside,
        );
        assert!(j.at_crease);
        assert!(!j.bisection_at_crease, "its vertex is inside the sheet");
        // A short crease between two marks, and a long one.
        let a = state.find_point([0.5, 0.25]).expect("a");
        let b = state.find_point([0.5, 0.75]).expect("b");
        let o1 = witness(
            1,
            vec![Ref::Point { id: a }, Ref::Point { id: b }],
            vec![],
            true,
        );
        let long = judge(
            &state,
            &creased,
            &v(0.5),
            &[[[0.5, 0.25], [0.5, 0.75]]],
            &[[[0.5, 0.25], [0.5, 0.75]]],
            Direction::Valley,
            none,
            &o1,
        );
        assert!(!long.own_ends, "half a sheet is not a pinch between marks");
        let top = state.find_point([0.5, 1.0]).expect("top");
        let short = witness(
            1,
            vec![Ref::Point { id: b }, Ref::Point { id: top }],
            vec![],
            true,
        );
        let j = judge(
            &state,
            &creased,
            &v(0.5),
            &[[[0.5, 0.75], [0.5, 0.95]]],
            &[[[0.5, 0.75], [0.5, 0.95]]],
            Direction::Valley,
            none,
            &short,
        );
        assert!(j.own_ends, "0.2 long, a mark within a pinch of each end");
    }
}

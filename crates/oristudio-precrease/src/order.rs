//! Deterministic ordering and grouping of a closure's folds for presentation.
//!
//! The closure's rounds are the skeleton: every fold in one round was
//! constructible before the round began, so any order inside a round is
//! executable (monotonicity). Inside a CP round the lines are clustered by
//! direction (parallel lines together), the clusters ordered by normal
//! angle, and the offsets swept alternately — ascending in one cluster,
//! descending in the next — the way a folder works across a sheet.
//! Auxiliary folds keep their own rounds, which the closure placed just
//! before the CP round they unlocked.
//!
//! **Landmarks first** hoists auxiliary folds to a phase 0 at the front. The
//! plan calls this "valid by monotonicity", which holds only for auxiliary
//! lines whose witnesses use nothing but the sheet and earlier landmarks:
//! monotonicity lets a fold move *later*, never earlier. So each auxiliary
//! line is hoisted only when one of its recorded witnesses is **available**
//! from the phase-0 state — every input line is a sheet edge or an
//! already-hoisted landmark, every input point lies on two such lines
//! crossing at the conditioning floor — and that witness becomes its
//! presentation witness. Lines that fail the check stay attached to the CP
//! round they enabled and are reported `hoisted: false`.
//!
//! Grouping merges consecutive steps of one round with the same direction,
//! axiom and input pattern into one row with a count ("fold the sixteenths
//! horizontally: 7 creases").

use crate::closure::{Closure, FoldedLine};
use crate::constants::MIN_ANGLE_SINE;
use crate::direction::Side;
use crate::line::Line;
use crate::marks::{
    Creased, MIN_ALIGNMENT, crease_overlap, point_mark_exists, witness_alignment, witness_aligns,
    witness_aligns_at_all, witness_marks_exist, witness_missing_marks,
};
use crate::pinch::PINCH_HALF_LENGTH;
use crate::predicates::{Ref, Witness, all_witnesses};
use crate::sequence::{Group, StepKind};
use crate::state::{LineTag, State};
use crate::tol::TOL;

/// One folded line in presentation order.
#[derive(Debug, Clone, PartialEq)]
pub struct Placed {
    /// Index into `closure.folded()`.
    pub folded: usize,
    /// Which sweep of the closure this fold came out of; 0 is the hoisted
    /// landmark phase.
    ///
    /// Bookkeeping, and it never leaves this pass — a crease pattern has steps
    /// numbered from one, not rounds. Grouping uses it because a sweep boundary
    /// is a real boundary: the folds after it were certified against a
    /// different sheet, so a row must not merge across one. Its ordering effect
    /// is that the closure folds long lines before short ones, and that is
    /// currently what makes the marks a step is sighted from exist.
    pub sweep: u32,
    /// Presentation witness index (may differ from the closure's choice for
    /// a hoisted line). Indexes the fold's recorded witnesses, or — one past
    /// their end — `found`.
    pub chosen: Option<usize>,
    /// A witness the closure did not record, found here against the paper as
    /// it stands when this fold is made: everything it names is already
    /// there. See [`found_witnesses`].
    pub found: Option<Witness>,
    pub hoisted: bool,
    /// Every mark the presentation witness sights is on the paper.
    ///
    /// False when no recorded witness could be sighted from creases that
    /// actually reach their crossing — the fold is still constructible, but the
    /// folder has to be told to make the mark rather than shown where it is.
    pub marks_exist: bool,
    /// The shortest crease-to-crease stretch the presentation witness lines
    /// up, in sheet units — `None` when it lines up no creases. Below
    /// `MIN_ALIGNMENT` the fold can be made but not precisely, and the card
    /// should say so.
    pub alignment: Option<f64>,
    /// *Which* of the presentation witness's marks are not on the paper, by
    /// state point id.
    ///
    /// Saying only that a mark is missing leaves the driver nothing to act on.
    /// With the ids it can ask ReferenceFinder to construct each one and fold
    /// the answer, which is the difference between flagging the step and fixing
    /// it. Empty exactly when `marks_exist`.
    pub missing: Vec<usize>,
    /// Normal angle of the direction cluster, `[0, π)`. A crease's
    /// *orientation*, unrelated to mountain and valley.
    pub direction_angle: f64,
    /// The face of the sheet this fold is made from. Changes between
    /// consecutive entries are the turn-overs.
    pub side: Side,
    /// This entry is not a fold but a **press**: more crease on the line
    /// `folded` names, which is already on the paper, to put a mark where a
    /// later step needs one. See [`presses_for_mark`].
    pub press: Option<Press>,
}

impl Placed {
    /// The witness this entry presents: one of `f`'s recorded ones, or the
    /// one found against the paper.
    pub fn presented<'a>(&'a self, f: &'a FoldedLine) -> Option<&'a Witness> {
        self.chosen
            .and_then(|c| f.witnesses.get(c).or(self.found.as_ref()))
    }
}

/// A press: refold a line that is already creased and press more of it.
///
/// Not a new fold. The line is on the paper; the folder folds along it again
/// and presses a little further, where two creases are meant to cross and one
/// of them stops short. A real diagram numbers this as a step of its own —
/// *pinch here* — and so does the plan.
#[derive(Debug, Clone, PartialEq)]
pub struct Press {
    /// The line being pressed, by state line id.
    pub line: usize,
    /// Where on the paper the press is for.
    pub at: [f64; 2],
    /// The state point being made, when the press is for a mark. A press that
    /// carries a line out to where a fold uses it has no point of its own.
    pub point: Option<usize>,
    /// Where on the line to press, as two endpoints.
    pub span: [[f64; 2]; 2],
    /// The already-creased line the press is located by: the pinch goes where
    /// that crease crosses this one. `None` for a press that runs to a
    /// findable end instead, which needs no sighting.
    pub sighted_from: Option<usize>,
}

fn folded_angle(line: &crate::line::Line) -> f64 {
    line.folded_angle_offset().0
}

fn folded_offset(line: &crate::line::Line) -> f64 {
    line.folded_angle_offset().1
}

/// Whether every input of `w` is available given the available line set.
fn witness_available(closure: &Closure, w: &Witness, available: &[bool]) -> bool {
    let state = closure.state();
    w.inputs.iter().all(|r| match r {
        Ref::Edge { id, .. } | Ref::Line { id } => available[*id],
        Ref::Corner { id, .. } | Ref::Point { id } => {
            let lines: Vec<usize> = state.points()[*id]
                .lines
                .iter()
                .copied()
                .filter(|&l| available[l])
                .collect();
            lines.iter().enumerate().any(|(i, &a)| {
                lines[i + 1..]
                    .iter()
                    .any(|&b| state.line(a).cross(state.line(b)).abs() >= MIN_ANGLE_SINE)
            })
        }
    })
}

/// Order a round's folds: direction clusters by angle, offsets swept
/// alternately.
fn order_round(closure: &Closure, members: &[usize]) -> Vec<(usize, f64)> {
    let folded = closure.folded();
    let mut keyed: Vec<(f64, f64, usize)> = members
        .iter()
        .map(|&i| {
            let l = &folded[i].line;
            (folded_angle(l), folded_offset(l), i)
        })
        .collect();
    keyed.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.total_cmp(&b.1)));
    // Cluster consecutive equal angles.
    let mut clusters: Vec<Vec<(f64, f64, usize)>> = Vec::new();
    for k in keyed {
        match clusters.last_mut() {
            Some(c) if (c[0].0 - k.0).abs() <= TOL => c.push(k),
            _ => clusters.push(vec![k]),
        }
    }
    let mut out = Vec::new();
    for (ci, cluster) in clusters.iter().enumerate() {
        let angle = cluster[0].0;
        let mut items: Vec<(f64, usize)> = cluster.iter().map(|k| (k.1, k.2)).collect();
        items.sort_by(|a, b| a.0.total_cmp(&b.0));
        if ci % 2 == 1 {
            items.reverse();
        }
        out.extend(items.into_iter().map(|(_, i)| (i, angle)));
    }
    out
}

/// Record the crease `folded_index` leaves on the paper.
///
/// A fold runs the width of the sheet, but the *pattern* usually only wants
/// part of that chord. An auxiliary fold has no target and creases its whole
/// chord — the pinch pass may cut it down later, but only to marks that are
/// used, this one included if a witness names it.
fn record(creased: &mut Creased, closure: &Closure, folded_index: usize) {
    let f = &closure.folded()[folded_index];
    let state = closure.state();
    match f.target.and_then(|t| closure.targets().get(t)) {
        Some(target) if !target.spans.is_empty() => {
            creased.add_spans(state, f.line_id, &f.line, &target.spans)
        }
        _ => creased.add_whole(state, f.line_id),
    }
}

/// Whether the folder can sight `w` for the fold along `line`: every mark it
/// names is on the paper, and every alignment it asks for is between creases
/// that are there. Both halves are the same question — is the reference the
/// closure certified against the geometry also on the paper — asked of points
/// and of lines.
fn sightable(state: &State, creased: &Creased, line: &Line, w: &Witness) -> bool {
    witness_marks_exist(state, creased, w) && witness_aligns(state, creased, line, w)
}

/// Where along `line` to press so that its crease covers `t_p`, starting from
/// its nearest existing run end and running **past** the mark to the nearest end
/// a folder can find.
///
/// It does not stop at the mark. A crease end is findable only on the sheet's
/// boundary or where an already-creased line crosses it squarely
/// (`marks::end_is_found`), and at the moment this press is needed nothing is
/// creased through the mark — that is why it is needed. Stopping there would
/// be the original defect moved from the mark to the crease end. So the press
/// continues to the first such end beyond it, and the boundary always
/// qualifies. The near end is an existing run end and gains nothing new.
///
/// Returns the span and its length, or `None` when the line has no run to
/// extend (it is creased everywhere, or not at all — neither is a press).
fn press_span(
    state: &State,
    creased: &Creased,
    line_id: usize,
    t_p: f64,
) -> Option<([[f64; 2]; 2], f64)> {
    let line = state.line(line_id);
    let runs = creased.runs_of(line_id)?;
    if runs.is_empty() {
        return None;
    }
    let (lo, hi) = state.sheet().clip_parameters(line)?;
    // The run end nearest the mark, and which way the press runs from it.
    let (t_near, _) = runs
        .iter()
        .flat_map(|&(u, v)| [(u, (u - t_p).abs()), (v, (v - t_p).abs())])
        .min_by(|a, b| a.1.total_cmp(&b.1))?;
    let forward = t_near < t_p;
    // The nearest findable end beyond the mark: the boundary, or the crossing
    // with a line that is already creased there and crosses squarely.
    let mut t_far = if forward { hi } else { lo };
    for (other_id, other) in state.lines().iter().enumerate() {
        if other_id == line_id || other.line.cross(line).abs() < MIN_ANGLE_SINE {
            continue;
        }
        // Only a crease whose extent is settled can be an end: an edge, or a CP
        // line, creased exactly where the pattern says. An auxiliary line is
        // recorded here as creased along its whole chord, and the pinch pass
        // will later reduce it to marks — so a crossing with one is not
        // somewhere the folder can be promised to find.
        if matches!(other.tag, LineTag::Aux | LineTag::RfAux) {
            continue;
        }
        let Some(x) = other.line.intersect(line) else {
            continue;
        };
        let t = line.parameter_of(x);
        let beyond = if forward {
            t > t_p + TOL
        } else {
            t < t_p - TOL
        };
        if !beyond || !creased.reaches(state, other_id, x) {
            continue;
        }
        if (t - t_p).abs() < (t_far - t_p).abs() {
            t_far = t;
        }
    }
    let span = [line.point_at(t_near), line.point_at(t_far)];
    Some((span, (t_far - t_near).abs()))
}

/// A pinch on `line` centred on `t_p`, clipped to the sheet.
fn pinch_span(state: &State, line_id: usize, t_p: f64) -> Option<[[f64; 2]; 2]> {
    let line = state.line(line_id);
    let (lo, hi) = state.sheet().clip_parameters(line)?;
    let a = (t_p - PINCH_HALF_LENGTH).max(lo);
    let b = (t_p + PINCH_HALF_LENGTH).min(hi);
    Some([line.point_at(a), line.point_at(b)])
}

/// The presses that put the mark at state point `point` on the paper.
///
/// A mark is in the state only because two lines crossed there squarely, and a
/// line is in the state only because it was folded — so both are already on
/// the paper. What is missing is never a fold, only crease at the crossing:
///
/// - if one of the pair already reaches the mark, the other gets a **pinch**
///   there, located by the crease the folder can see;
/// - if neither does, one is **pressed** from its nearest run end past the
///   mark to a findable end ([`press_span`]), and then the other gets the
///   pinch, located by that.
///
/// Among the pairs that qualify, the cheapest in ink. Empty when the mark is
/// already there. Empty also when no folded pair crosses it squarely — which
/// the closure's own certification makes impossible, and which the invariant
/// test would report rather than this function inventing a construction.
fn presses_for_mark(state: &State, creased: &Creased, point: usize) -> Vec<Press> {
    let Some(pt) = state.points().get(point) else {
        return Vec::new();
    };
    if point_mark_exists(state, creased, point) {
        return Vec::new();
    }
    let p = pt.p;
    let folded: Vec<usize> = pt
        .lines
        .iter()
        .copied()
        .filter(|&l| creased.is_folded(l))
        .collect();

    let mut best: Option<(f64, Vec<Press>)> = None;
    let mut offer = |cost: f64, presses: Vec<Press>| {
        if best.as_ref().is_none_or(|(c, _)| cost < *c) {
            best = Some((cost, presses));
        }
    };

    for (i, &a) in folded.iter().enumerate() {
        for &b in &folded[i + 1..] {
            if state.line(a).cross(state.line(b)).abs() < MIN_ANGLE_SINE {
                continue;
            }
            let (ra, rb) = (creased.reaches(state, a, p), creased.reaches(state, b, p));
            match (ra, rb) {
                // Both there: the mark exists, and we would not be here.
                (true, true) => {}
                // One reaches: pinch the other, sighted from it.
                (true, false) | (false, true) => {
                    let (seen, pressed) = if ra { (a, b) } else { (b, a) };
                    let t = state.line(pressed).parameter_of(p);
                    if let Some(span) = pinch_span(state, pressed, t) {
                        offer(
                            2.0 * PINCH_HALF_LENGTH,
                            vec![Press {
                                line: pressed,
                                at: p,
                                point: Some(point),
                                span,
                                sighted_from: Some(seen),
                            }],
                        );
                    }
                }
                // Neither: press one out past the mark, then pinch the other.
                (false, false) => {
                    for (first, second) in [(a, b), (b, a)] {
                        let t1 = state.line(first).parameter_of(p);
                        let Some((span1, len1)) = press_span(state, creased, first, t1) else {
                            continue;
                        };
                        let t2 = state.line(second).parameter_of(p);
                        let Some(span2) = pinch_span(state, second, t2) else {
                            continue;
                        };
                        offer(
                            len1 + 2.0 * PINCH_HALF_LENGTH,
                            vec![
                                Press {
                                    line: first,
                                    at: p,
                                    point: Some(point),
                                    span: span1,
                                    sighted_from: None,
                                },
                                Press {
                                    line: second,
                                    at: p,
                                    point: Some(point),
                                    span: span2,
                                    sighted_from: Some(first),
                                },
                            ],
                        );
                    }
                }
            }
        }
    }
    best.map(|(_, presses)| presses).unwrap_or_default()
}

/// Where each line input of `w` has to be creased for a fold along `fold` to
/// line it up with at least [`MIN_ALIGNMENT`] of crease, by line: the spots a
/// press must reach. Empty when every alignment the witness asks for is
/// already that long.
///
/// Reaching the place the fold *uses* a line is not enough. A line folded
/// onto itself — the second input of O4, the third of O7 — mirrors about the
/// fold's foot, so crease on one side of the foot can only line up with
/// crease on the other: a crease that stops at the foot lines up with
/// nothing. Two lines bisected mirror onto each other from their crossing,
/// and the side of one that lands on the other is fixed by the fold, so a
/// crease that stops at the crossing lines up with nothing there either. A
/// mark landing on a line (O5, O6, the first input of O7) is a point on a
/// crease and only has to be reached.
fn line_targets(
    state: &State,
    creased: &Creased,
    fold: &Line,
    w: &Witness,
) -> Vec<(usize, [f64; 2])> {
    let line_id = |i: usize| w.inputs.get(i).map(|r| r.id());
    let image = |p: usize, m: usize| {
        state
            .points()
            .get(p)
            .map(|pt| (m, fold.reflect_point(pt.p)))
    };
    let mut out = Vec::new();
    match w.axiom {
        3 => {
            if let (Some(a), Some(b)) = (line_id(0), line_id(1)) {
                out.extend(pair_targets(state, creased, fold, a, b));
            }
        }
        4 => {
            if let Some(l) = line_id(1) {
                out.extend(self_fold_targets(state, creased, fold, l));
            }
        }
        5 => {
            if let (Some(p), Some(m)) = (line_id(1), line_id(2)) {
                out.extend(image(p, m));
            }
        }
        6 => {
            if let (Some(p1), Some(m1), Some(p2), Some(m2)) =
                (line_id(0), line_id(1), line_id(2), line_id(3))
            {
                out.extend(image(p1, m1));
                out.extend(image(p2, m2));
            }
        }
        7 => {
            if let (Some(p), Some(m), Some(l)) = (line_id(0), line_id(1), line_id(2)) {
                out.extend(image(p, m));
                out.extend(self_fold_targets(state, creased, fold, l));
            }
        }
        _ => {}
    }
    // Only lines that are lines: a corner or mark input has no crease to press.
    out.retain(|(l, _)| w.inputs.iter().any(|r| r.is_line() && r.id() == *l));
    out.retain(|(l, at)| !creased.reaches(state, *l, *at));
    out
}

/// The spots on `l` a fold along `fold` needs creased to fold `l` onto
/// itself: a pinch-length either side of the foot, as far as the sheet allows.
fn self_fold_targets(
    state: &State,
    creased: &Creased,
    fold: &Line,
    l: usize,
) -> Vec<(usize, [f64; 2])> {
    if crease_overlap(state, creased, fold, l, l) >= MIN_ALIGNMENT - TOL {
        return Vec::new();
    }
    let line = state.line(l);
    let Some(foot) = fold.intersect(line) else {
        return Vec::new();
    };
    let Some((lo, hi)) = state.sheet().clip_parameters(line) else {
        return Vec::new();
    };
    let t = line.parameter_of(foot);
    [(t - MIN_ALIGNMENT).max(lo), (t + MIN_ALIGNMENT).min(hi)]
        .into_iter()
        .map(|u| (l, line.point_at(u)))
        .collect()
}

/// The spots on `a` and `b` a fold along `fold` needs creased to bring one
/// onto the other, on the side of their crossing the fold pairs up.
///
/// The fold mirrors `a` onto `b` about the crossing, so a stretch of `a` on
/// one side of it lands on `b` on a definite side. Either pairing of sides
/// would do; the one chosen is the one whose creases are closest to already
/// there — fewest spots to press, then the shortest presses. Parallel lines
/// have no crossing and are handled by [`parallel_target`].
fn pair_targets(
    state: &State,
    creased: &Creased,
    fold: &Line,
    a: usize,
    b: usize,
) -> Vec<(usize, [f64; 2])> {
    if crease_overlap(state, creased, fold, a, b) >= MIN_ALIGNMENT - TOL {
        return Vec::new();
    }
    let (la, lb) = (state.line(a), state.line(b));
    let Some(cross) = la.intersect(lb) else {
        return parallel_target(state, creased, fold, a, b)
            .into_iter()
            .collect();
    };
    let (Some((lo_a, hi_a)), Some((lo_b, hi_b))) = (
        state.sheet().clip_parameters(la),
        state.sheet().clip_parameters(lb),
    ) else {
        return Vec::new();
    };
    let (ta, tb) = (la.parameter_of(cross), lb.parameter_of(cross));
    // Which way along `b` a step forward along `a` lands.
    let along = lb.parameter_of(fold.reflect_point(la.point_at(ta + 1.0))) - tb;
    let sigma = if along >= 0.0 { 1.0 } else { -1.0 };
    let candidate = |s: f64| {
        let ua = (ta + s * MIN_ALIGNMENT).clamp(lo_a, hi_a);
        let ub = (tb + sigma * s * MIN_ALIGNMENT).clamp(lo_b, hi_b);
        // Whether the sheet leaves room for the full alignment on this side.
        let room = (ua - ta).abs().min((ub - tb).abs()) >= MIN_ALIGNMENT - TOL;
        let targets = [(a, la.point_at(ua)), (b, lb.point_at(ub))];
        let unreached: Vec<(usize, [f64; 2])> = targets
            .into_iter()
            .filter(|&(l, at)| !creased.reaches(state, l, at))
            .collect();
        let length: f64 = unreached
            .iter()
            .filter_map(|&(l, at)| {
                press_span(state, creased, l, state.line(l).parameter_of(at)).map(|(_, len)| len)
            })
            .sum();
        ((!room, unreached.len(), length), unreached)
    };
    let (plus, minus) = (candidate(1.0), candidate(-1.0));
    let (key_p, key_m) = (plus.0, minus.0);
    if (key_p.0, key_p.1, key_p.2.total_cmp(&key_m.2))
        <= (key_m.0, key_m.1, std::cmp::Ordering::Equal)
    {
        plus.1
    } else {
        minus.1
    }
}

/// For two lines parallel to `fold`, the spot on one of them its crease must
/// reach to lie a pinch-length along the image of the other's — on whichever
/// line that is the shorter press. `None` when nothing is creased.
///
/// The fold lies midway between the lines and there is no crossing: the
/// creases align only where one lands on the other, so the target is a
/// pinch-length inside the landing, not merely its end.
fn parallel_target(
    state: &State,
    creased: &Creased,
    fold: &Line,
    a: usize,
    b: usize,
) -> Option<(usize, [f64; 2])> {
    let runs = |l: usize| -> Vec<(f64, f64)> {
        creased.runs_of(l).map(|r| r.to_vec()).unwrap_or_default()
    };
    // The cheapest spot on `on` to press to, so that its crease lies a
    // pinch-length along some image of `other`'s crease.
    let cost = |on: usize, other: usize| -> Option<(f64, [f64; 2])> {
        let (line, from) = (state.line(on), state.line(other));
        let mine = runs(on);
        if mine.is_empty() {
            return None;
        }
        let (lo, hi) = state.sheet().clip_parameters(line)?;
        runs(other)
            .into_iter()
            .filter_map(|(u, v)| {
                let x = line.parameter_of(fold.reflect_point(from.point_at(u)));
                let y = line.parameter_of(fold.reflect_point(from.point_at(v)));
                let (x, y) = (x.min(y).max(lo), x.max(y).min(hi));
                // An image off the paper is not somewhere a crease can be
                // pressed to.
                (y > x + TOL).then_some((x, y))
            })
            .flat_map(|(x, y)| [(x + MIN_ALIGNMENT).min(y), (y - MIN_ALIGNMENT).max(x)])
            .map(|target| {
                let gap = mine
                    .iter()
                    .flat_map(|&(u, v)| [(u - target).abs(), (v - target).abs()])
                    .fold(f64::INFINITY, f64::min);
                (gap, line.point_at(target))
            })
            .min_by(|x, y| x.0.total_cmp(&y.0))
    };
    match (cost(a, b), cost(b, a)) {
        (Some((ga, pa)), Some((gb, pb))) => Some(if ga <= gb { (a, pa) } else { (b, pb) }),
        (Some((_, pa)), None) => Some((a, pa)),
        (None, Some((_, pb))) => Some((b, pb)),
        (None, None) => None,
    }
}

/// The presses that carry each line `w` uses out to where the fold along
/// `fold` uses it, where its crease does not reach there already.
///
/// The line-input counterpart of [`presses_for_mark`]. A line is a reference
/// only where it is creased; a fold that uses it further along has nothing
/// to align to, so the crease is pressed out — from its nearest run end past
/// the spot to a findable end, exactly as a mark's press is — before the fold.
fn presses_for_lines(state: &State, creased: &Creased, fold: &Line, w: &Witness) -> Vec<Press> {
    let mut out = Vec::new();
    // Each press is recorded before the next spot is looked at: one press
    // from a run end past a spot to a findable end usually covers the spot
    // on the other side of the foot as well.
    let mut paper = creased.clone();
    for (line, at) in line_targets(state, creased, fold, w) {
        if paper.reaches(state, line, at) {
            continue;
        }
        let t = state.line(line).parameter_of(at);
        if let Some((span, _)) = press_span(state, &paper, line, t) {
            paper.add_spans(state, line, state.line(line), &[span]);
            out.push(Press {
                line,
                at,
                point: None,
                span,
                sighted_from: None,
            });
        }
    }
    out
}

/// How many presses may buy a fold something moves in, over one nothing
/// does. One: a single pinch to turn "fold through P perpendicular to A" into
/// "fold P onto Q" is the trade a folder would make; more than that and the
/// plan is paying in steps for a preference.
const MAX_PRESSES_FOR_PREFERENCE: usize = 1;

/// What sighting `witness` would take, without making any of it: the presses,
/// and whether the fold is then well aligned. `None` when no press makes it a
/// fold at all — a mark that cannot be put on the paper, or creases that would
/// never line up.
///
/// Counted on a copy of the paper, because a mark's presses change what the
/// next mark needs. A fold is well aligned when every crease it lines up with
/// a crease overlaps it by [`MIN_ALIGNMENT`]; one that is not can still be
/// folded, less precisely — a fold 0.02 from the sheet's edge lines up 0.02 of
/// edge whatever is pressed — and the ordering pass weighs that as one press
/// worth of trouble.
fn repair(state: &State, creased: &Creased, line: &Line, witness: &Witness) -> Option<Repair> {
    let mut paper = creased.clone();
    let mut presses = 0;
    for point in witness_missing_marks(state, &paper, witness) {
        for press in presses_for_mark(state, &paper, point) {
            paper.add_spans(state, press.line, state.line(press.line), &[press.span]);
            presses += 1;
        }
    }
    if !witness_aligns(state, &paper, line, witness) {
        for press in presses_for_lines(state, &paper, line, witness) {
            paper.add_spans(state, press.line, state.line(press.line), &[press.span]);
            presses += 1;
        }
    }
    if !witness_marks_exist(state, &paper, witness)
        || !witness_aligns_at_all(state, &paper, line, witness)
    {
        return None;
    }
    Some(Repair {
        presses,
        well: witness_aligns(state, &paper, line, witness),
    })
}

/// What [`repair`] found a witness needs.
#[derive(Clone, Copy, Debug)]
struct Repair {
    presses: usize,
    well: bool,
}

impl Repair {
    /// Presses, counting a fold that stays short of [`MIN_ALIGNMENT`] as one
    /// more: "fold P onto Q" after a pinch is as much work as lining up a
    /// sliver, and more precise.
    fn cost(self) -> usize {
        self.presses + usize::from(!self.well)
    }
}

/// Emit the presses that make every mark `witness` sights real and carry its
/// lines to where the fold lines them up, recording each on the paper as it
/// goes — the presses [`repair`] counted.
#[allow(clippy::too_many_arguments)]
fn make_marks_real(
    state: &State,
    closure: &Closure,
    creased: &mut Creased,
    folded_of_line: &[Option<usize>],
    line: &Line,
    witness: &Witness,
    sweep: u32,
    side: Side,
    placed: &mut Vec<Placed>,
) {
    let emit = |press: Press, creased: &mut Creased, placed: &mut Vec<Placed>| {
        let Some(folded_index) = folded_of_line.get(press.line).copied().flatten() else {
            return;
        };
        let f = &closure.folded()[folded_index];
        creased.add_spans(state, press.line, &f.line, &[press.span]);
        placed.push(Placed {
            folded: folded_index,
            sweep,
            chosen: None,
            found: None,
            hoisted: false,
            direction_angle: folded_angle(&f.line),
            side,
            marks_exist: true,
            alignment: None,
            missing: Vec::new(),
            press: Some(press),
        });
    };
    for point in witness_missing_marks(state, creased, witness) {
        for press in presses_for_mark(state, creased, point) {
            emit(press, creased, placed);
        }
    }
    if !witness_aligns(state, creased, line, witness) {
        for press in presses_for_lines(state, creased, line, witness) {
            emit(press, creased, placed);
        }
    }
}

/// The face a fold has to be made from, or `None` when it does not care.
///
/// An auxiliary line has no target and so no direction; a line whose majority
/// is under [`crate::direction::FIRM_MAJORITY`] has one but is not allowed to
/// spend a turn-over on it.
fn forced_side(closure: &Closure, folded_index: usize) -> Option<Side> {
    let target = closure.folded()[folded_index].target?;
    closure.targets().get(target)?.forces_side()
}

/// What sighting one fold settled: which witness the folder is shown, and
/// whether they can see what it names.
struct Sighted {
    /// Presentation witness index into the recorded witnesses, or one past
    /// their end for `found`.
    chosen: Option<usize>,
    /// A witness the closure did not record — see [`found_witnesses`].
    found: Option<Witness>,
    /// Every mark that witness sights is on the paper, and every alignment it
    /// asks for is between creases that are there.
    marks_exist: bool,
    /// The state point ids of the marks that are not.
    missing: Vec<usize>,
    /// The shortest crease alignment that witness asks for.
    alignment: Option<f64>,
}

/// Witnesses for `line` the closure did not record, certified against the
/// paper as it stands: every input already folded, or a crossing of folded
/// lines. Everything the state knows is searched, including lines folded
/// later, which is why the filter is by what is creased now and not by round.
///
/// The closure certifies a line once, against the state before its round,
/// and keeps what it found then. But the order inside a round is free, so
/// by the time a fold is made the paper may carry marks the same round's
/// earlier folds left — the spot a corner lands on, say, where two of them
/// cross — and "fold Q onto P" is a clearer instruction than "fold Q onto B
/// and P onto A" for the same crease. A witness found here names nothing
/// that is not already on the paper, so it is as safe to present as a
/// recorded one.
fn found_witnesses(
    state: &State,
    creased: &Creased,
    line: &Line,
    line_id: usize,
    recorded: &[Witness],
) -> Vec<Witness> {
    let on_paper = |r: &Ref| match r {
        Ref::Edge { .. } | Ref::Corner { .. } => true,
        Ref::Line { id } => *id != line_id && creased.is_folded(*id),
        Ref::Point { id } => state.points().get(*id).is_some_and(|p| {
            p.lines
                .iter()
                .filter(|&&l| l != line_id && creased.is_folded(l))
                .count()
                >= 2
        }),
    };
    all_witnesses(state, line)
        .into_iter()
        .filter(|w| w.inputs.iter().all(on_paper))
        .filter(|w| {
            !recorded
                .iter()
                .any(|r| r.axiom == w.axiom && r.inputs == w.inputs)
        })
        .collect()
}

/// Pick the witness the folder should be shown for fold `i`, put whatever it
/// needs on the paper ahead of it (presses, on `side`), and say whether they
/// can now see what it names.
///
/// The easiest kind of fold the folder can already sight, unless that is a
/// fold nothing moves in — a perpendicular, or a line through two marks — in
/// which case one pinch may buy a fold something does move in: "fold P onto
/// Q" with a pinch first is what a folder would do, "fold through P
/// perpendicular to A" is a hinge trick.
///
/// Not any pinch for any easier fold. Measured on markhor: letting one pinch
/// buy any easier axiom turned 18 line-onto-line folds into point-onto-point
/// with a pinch each, and a fold of an edge onto a crease is not improved by
/// that.
///
/// When the recorded witnesses offer nothing that is both clean and free —
/// a two-point or line-onto-line fold with nothing to press — the paper is
/// asked again for witnesses the closure never saw ([`found_witnesses`]).
///
/// Only if the presses fail (they should not: see `presses_for_mark`) is the
/// step left flagged, naming what is missing, so the invariant test reports
/// it rather than the card pretending.
#[allow(clippy::too_many_arguments)]
fn sight(
    state: &State,
    closure: &Closure,
    creased: &mut Creased,
    folded_of_line: &[Option<usize>],
    i: usize,
    sweep: u32,
    side: Side,
    placed: &mut Vec<Placed>,
) -> Sighted {
    let f = &closure.folded()[i];
    let cost_of = |creased: &Creased, witness: &Witness| -> Option<usize> {
        if sightable(state, creased, &f.line, witness) {
            Some(0)
        } else {
            repair(state, creased, &f.line, witness).map(Repair::cost)
        }
    };
    let pick = |creased: &Creased, witnesses: &[Witness]| -> Option<usize> {
        let already = (0..witnesses.len())
            .filter(|&w| sightable(state, creased, &f.line, &witnesses[w]))
            .min_by_key(|&w| witnesses[w].preference());
        match already {
            Some(w) if !matches!(witnesses[w].axiom, 1 | 4) => Some(w),
            _ => (0..witnesses.len())
                .filter_map(|w| cost_of(creased, &witnesses[w]).map(|cost| (w, cost)))
                .min_by_key(|&(w, cost)| {
                    let (ease, hard, err) = witnesses[w].preference();
                    // Within the budget, the easiest kind of fold; past it,
                    // the fold that costs least. A plan paying four presses
                    // for a fold of an easier kind than one that costs two
                    // is paying in steps for a preference.
                    if cost <= MAX_PRESSES_FOR_PREFERENCE {
                        (0, ease as usize, cost, hard, err)
                    } else {
                        (1, cost, ease as usize, hard, err)
                    }
                })
                .map(|(w, _)| w),
        }
    };
    let recorded = pick(creased, &f.witnesses);
    let clean = recorded.is_some_and(|w| {
        matches!(f.witnesses[w].axiom, 2 | 3) && cost_of(creased, &f.witnesses[w]) == Some(0)
    });
    let mut found: Option<Witness> = None;
    let mut chosen = recorded;
    if !clean {
        let extra = found_witnesses(state, creased, &f.line, f.line_id, &f.witnesses);
        if !extra.is_empty() {
            let all: Vec<Witness> = f.witnesses.iter().chain(&extra).cloned().collect();
            if let Some(w) = pick(creased, &all) {
                chosen = Some(w.min(f.witnesses.len()));
                if w >= f.witnesses.len() {
                    found = Some(all[w].clone());
                }
            }
        }
    }
    // None of them can be folded, whatever is pressed — a perpendicular
    // whose line ends at the sheet's edge exactly at the foot, say. The step
    // is flagged as it is, and the card says so.
    let Some(witness) = chosen.and_then(|w| f.witnesses.get(w).or(found.as_ref())) else {
        let missing = f
            .chosen_witness()
            .map(|w| witness_missing_marks(state, creased, w))
            .unwrap_or_default();
        return Sighted {
            chosen: f.chosen,
            found: None,
            marks_exist: f.witnesses.is_empty(),
            missing,
            alignment: None,
        };
    };
    let witness = witness.clone();
    if !sightable(state, creased, &f.line, &witness) {
        make_marks_real(
            state,
            closure,
            creased,
            folded_of_line,
            &f.line,
            &witness,
            sweep,
            side,
            placed,
        );
    }
    let real = witness_marks_exist(state, creased, &witness)
        && witness_aligns_at_all(state, creased, &f.line, &witness);
    Sighted {
        chosen,
        found,
        marks_exist: real,
        alignment: witness_alignment(state, creased, &f.line, &witness),
        missing: if real {
            Vec::new()
        } else {
            witness_missing_marks(state, creased, &witness)
        },
    }
}

/// Place every folded line. Returns the presentation order.
pub fn order(closure: &Closure, landmarks_first: bool) -> Vec<Placed> {
    let folded = closure.folded();
    let state = closure.state();
    let mut placed: Vec<Placed> = Vec::new();

    // The sheet starts front side up and stays where the previous round left
    // it — a per-round reset would turn it over at every boundary.
    let mut side = Side::Front;

    // What the paper actually carries, grown fold by fold — see `Creased`.
    let mut creased = Creased::new(state);
    // Which fold made each line, for a press to refer back to.
    let mut folded_of_line: Vec<Option<usize>> = vec![None; state.line_count()];
    for (i, f) in folded.iter().enumerate() {
        folded_of_line[f.line_id] = Some(i);
    }

    // Phase 0: hoisted landmarks.
    let mut hoisted = vec![false; folded.len()];
    if landmarks_first {
        let mut available = vec![false; state.line_count()];
        for (id, l) in state.lines().iter().enumerate() {
            available[id] = l.tag == LineTag::Edge;
        }
        for (i, f) in folded.iter().enumerate() {
            if !matches!(f.tag, LineTag::Aux | LineTag::RfAux) {
                continue;
            }
            let usable: Vec<usize> = (0..f.witnesses.len())
                .filter(|&k| witness_available(closure, &f.witnesses[k], &available))
                .collect();
            // Prefer a witness the folder can sight, exactly as the round loop
            // does below. Taking the cheapest available one regardless left a
            // hoisted step flagged as unsightable while a sightable witness sat
            // unused in its own list.
            let pick = usable
                .iter()
                .copied()
                .filter(|&k| sightable(state, &creased, &f.line, &f.witnesses[k]))
                .min_by_key(|&k| f.witnesses[k].preference())
                .or_else(|| {
                    usable
                        .iter()
                        .copied()
                        .min_by_key(|&k| f.witnesses[k].preference())
                });
            if let Some(k) = pick {
                hoisted[i] = true;
                available[f.line_id] = true;
                let w = &f.witnesses[k];
                if !sightable(state, &creased, &f.line, w) {
                    make_marks_real(
                        state,
                        closure,
                        &mut creased,
                        &folded_of_line,
                        &f.line,
                        w,
                        0,
                        side,
                        &mut placed,
                    );
                }
                placed.push(Placed {
                    folded: i,
                    sweep: 0,
                    chosen: Some(k),
                    found: None,
                    hoisted: true,
                    direction_angle: folded_angle(&f.line),
                    side,
                    marks_exist: sightable(state, &creased, &f.line, w),
                    alignment: witness_alignment(state, &creased, &f.line, w),
                    missing: witness_missing_marks(state, &creased, w),
                    press: None,
                });
                record(&mut creased, closure, i);
            }
        }
    }

    // Remaining folds by closure round, renumbered 1..
    let mut rounds: Vec<u32> = folded
        .iter()
        .enumerate()
        .filter(|(i, _)| !hoisted[*i])
        .map(|(_, f)| f.round)
        .collect();
    rounds.sort_unstable();
    rounds.dedup();
    for (k, &r) in rounds.iter().enumerate() {
        let members: Vec<usize> = (0..folded.len())
            .filter(|&i| !hoisted[i] && folded[i].round == r)
            .collect();
        let is_cp_round = members.iter().all(|&i| folded[i].tag == LineTag::Cp);
        let ordered: Vec<(usize, f64)> = if is_cp_round {
            order_round(closure, &members)
        } else {
            members
                .iter()
                .map(|&i| (i, folded_angle(&folded[i].line)))
                .collect()
        };
        // Whichever side is already up leads, so a round that needs only one
        // side — the common case — never turns the sheet over at all. A fold
        // that does not force a side joins the leading block, where it costs
        // nothing.
        let other = side.flipped();
        let (turn, stay): (Vec<_>, Vec<_>) = ordered
            .into_iter()
            .partition(|&(i, _)| forced_side(closure, i) == Some(other));
        // Each fold is sighted against the paper as it stands when the
        // folder reaches it: earlier rounds, the presses made so far, and
        // this round's earlier folds — the order inside a round is free, so
        // those are on the paper too, and a mark one of them leaves is a
        // mark the next may be folded onto. Every witness on a round-r line
        // was certified against the state before the round began, so
        // nothing here can name a mark that is not there yet.
        let sweep = k as u32 + 1;
        for (block, block_side) in [(stay, side), (turn, other)] {
            if block.is_empty() {
                continue;
            }
            side = block_side;
            for (i, angle) in block {
                let sighted = sight(
                    state,
                    closure,
                    &mut creased,
                    &folded_of_line,
                    i,
                    sweep,
                    side,
                    &mut placed,
                );
                placed.push(Placed {
                    folded: i,
                    sweep,
                    chosen: sighted.chosen,
                    found: sighted.found,
                    hoisted: false,
                    direction_angle: angle,
                    side,
                    marks_exist: sighted.marks_exist,
                    alignment: sighted.alignment,
                    missing: sighted.missing,
                    press: None,
                });
                record(&mut creased, closure, i);
            }
        }
    }
    placed
}

/// The pattern label of a witness: axiom and input kinds, `!` when hard.
pub fn pattern(w: Option<&Witness>) -> String {
    match w {
        Some(w) => {
            let kinds: String = w.inputs.iter().map(Ref::kind_code).collect();
            format!("O{}:{}{}", w.axiom, kinds, if w.hard { "!" } else { "" })
        }
        None => "free".to_string(),
    }
}

/// Group consecutive placed steps with the same sweep, side, kind, direction,
/// axiom and pattern. `step_ids` are 1-based positions in `placed`.
pub fn group(closure: &Closure, placed: &[Placed]) -> Vec<Group> {
    let folded = closure.folded();
    let mut groups: Vec<Group> = Vec::new();
    // The sweep the open group belongs to. A sweep boundary ends a group, but
    // it is not part of the group the reader sees.
    let mut open_sweep = u32::MAX;
    for (k, p) in placed.iter().enumerate() {
        let f = &folded[p.folded];
        let w = p.presented(f);
        let kind = if p.press.is_some() {
            StepKind::Press
        } else if f.tag == LineTag::Cp {
            StepKind::Cp
        } else {
            StepKind::Aux
        };
        let axiom = w.map_or(0, |w| w.axiom);
        let pat = pattern(w);
        let id = k as u32 + 1;
        match groups.last_mut() {
            Some(g)
                if open_sweep == p.sweep
                    && g.side == p.side
                    && g.kind == kind
                    && (g.direction_angle - p.direction_angle).abs() <= TOL
                    && g.axiom == axiom
                    && g.pattern == pat =>
            {
                g.step_ids.push(id);
                g.count += 1;
            }
            _ => {
                open_sweep = p.sweep;
                groups.push(Group {
                    side: p.side,
                    kind,
                    direction_angle: p.direction_angle,
                    axiom,
                    pattern: pat,
                    step_ids: vec![id],
                    count: 1,
                })
            }
        }
    }
    groups
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::{Deadline, frozen_clock};
    use crate::closure::Target;
    use crate::line::Line;
    use crate::sheet::Sheet;
    use crate::state::DEFAULT_POINT_CAP;

    fn v(x: f64) -> Line {
        Line::new([1.0, 0.0], x).expect("line")
    }

    fn h(y: f64) -> Line {
        Line::new([0.0, 1.0], y).expect("line")
    }

    fn closure_of(lines: &[Line]) -> Closure {
        let mut c = Closure::new(
            Sheet::unit_square(),
            lines
                .iter()
                .map(|l| Target::unassigned(*l, vec![]))
                .collect(),
            DEFAULT_POINT_CAP,
        );
        c.close(&Deadline::unbounded(frozen_clock()))
            .expect("close");
        c
    }

    /// The midlines, creased only on their lower-left thirds, and the mark at
    /// their crossing — which neither reaches.
    fn two_midlines_stopping_short() -> (State, Creased, usize) {
        let mut state = State::new(Sheet::unit_square(), DEFAULT_POINT_CAP);
        let a = state.add_line(h(0.5), LineTag::Cp).expect("a").id;
        let b = state.add_line(v(0.5), LineTag::Cp).expect("b").id;
        let mut creased = Creased::new(&state);
        creased.add_spans(&state, a, &h(0.5), &[[[0.0, 0.5], [0.3, 0.5]]]);
        creased.add_spans(&state, b, &v(0.5), &[[[0.5, 0.0], [0.5, 0.3]]]);
        let p = state
            .find_point([0.5, 0.5])
            .expect("the crossing is a state point");
        assert!(!point_mark_exists(&state, &creased, p));
        (state, creased, p)
    }

    /// Case (a): one of the pair already reaches the mark, so the other gets a
    /// pinch there, located by the crease that is visible.
    #[test]
    fn a_mark_one_crease_reaches_costs_one_pinch_sighted_from_it() {
        let (state, mut creased, p) = two_midlines_stopping_short();
        let a = state.find_line(&h(0.5)).expect("a");
        let b = state.find_line(&v(0.5)).expect("b");
        creased.add_whole(&state, a);
        let presses = presses_for_mark(&state, &creased, p);
        assert_eq!(presses.len(), 1, "one pinch: {presses:?}");
        let press = &presses[0];
        assert_eq!(
            press.line, b,
            "the pinch goes on the line that does not reach"
        );
        assert_eq!(
            press.sighted_from,
            Some(a),
            "and is located by the one that does"
        );
        let mid = [
            (press.span[0][0] + press.span[1][0]) / 2.0,
            (press.span[0][1] + press.span[1][1]) / 2.0,
        ];
        assert!(
            (mid[0] - 0.5).abs() < 1e-9 && (mid[1] - 0.5).abs() < 1e-9,
            "centred on the mark"
        );
        creased.add_spans(&state, press.line, state.line(press.line), &[press.span]);
        assert!(
            point_mark_exists(&state, &creased, p),
            "and now the mark is there"
        );
    }

    /// Case (b): neither reaches, so one is pressed from its run end **past**
    /// the mark to the sheet's edge — an end the folder can find — and then the
    /// other gets the pinch of case (a).
    #[test]
    fn a_mark_no_crease_reaches_is_pressed_out_to_a_findable_end_then_pinched() {
        let (state, mut creased, p) = two_midlines_stopping_short();
        let presses = presses_for_mark(&state, &creased, p);
        assert_eq!(presses.len(), 2, "a press then a pinch: {presses:?}");
        let (press, pinch) = (&presses[0], &presses[1]);
        assert_eq!(
            press.sighted_from, None,
            "the press is located by its end, not a sighting"
        );
        assert_eq!(
            pinch.sighted_from,
            Some(press.line),
            "the pinch is located by the press"
        );
        assert_ne!(press.line, pinch.line);
        // The press runs from the existing run's end (0.3) through the mark
        // (0.5) to the far edge (1.0): nothing is creased across it beyond the
        // mark, so the edge is the nearest findable end.
        let along = |q: [f64; 2]| state.line(press.line).parameter_of(q);
        let (t0, t1) = (along(press.span[0]), along(press.span[1]));
        let (near, far) = if (t0 - 0.3).abs() < (t1 - 0.3).abs() {
            (t0, t1)
        } else {
            (t1, t0)
        };
        assert!(
            (near - 0.3).abs() < 1e-9,
            "starts at the run end, got {near}"
        );
        assert!((far - 1.0).abs() < 1e-9, "runs to the edge, got {far}");
        // Apply both and the mark exists — with every end of the press findable.
        for pr in &presses {
            creased.add_spans(&state, pr.line, state.line(pr.line), &[pr.span]);
        }
        assert!(point_mark_exists(&state, &creased, p));
        let far_point = state.line(press.line).point_at(far);
        assert!(
            crate::marks::end_is_found(&state, &creased, state.line(press.line), far_point),
            "the press ended somewhere the folder cannot find"
        );
    }

    /// The press stops at the first findable end beyond the mark, not always at
    /// the edge: a crease already crossing the line squarely out there is
    /// nearer, and a shorter press.
    #[test]
    fn a_press_stops_at_the_nearest_findable_end_not_the_edge() {
        let (mut state, mut creased, p) = two_midlines_stopping_short();
        // A vertical crease at x = 0.7, creased across y = 0.5.
        let c = state.add_line(v(0.7), LineTag::Cp).expect("c").id;
        creased.add_spans(&state, c, &v(0.7), &[[[0.7, 0.4], [0.7, 0.6]]]);
        let presses = presses_for_mark(&state, &creased, p);
        let press = presses
            .iter()
            .find(|pr| pr.sighted_from.is_none())
            .expect("a press");
        let a = state.find_line(&h(0.5)).expect("a");
        // Pressing the horizontal costs 0.4 (to the crossing); the vertical
        // would cost 0.7 (to the edge). The cheaper one is chosen, and stops
        // at the crossing rather than running on to the edge.
        assert_eq!(press.line, a, "the cheaper press is on the horizontal");
        let far_x = [press.span[0][0], press.span[1][0]]
            .into_iter()
            .max_by(|p, q| (p - 0.3).abs().total_cmp(&(q - 0.3).abs()))
            .expect("two ends");
        assert!(
            (far_x - 0.7).abs() < 1e-9,
            "stops at the crossing with x = 0.7, got {far_x}"
        );
    }

    fn witness(axiom: u8, inputs: Vec<Ref>) -> Witness {
        Witness {
            axiom,
            inputs,
            root: 0,
            who_moves: Vec::new(),
            hard: false,
            visible: true,
            skinny: false,
            ease: 0,
            err: 0.0,
        }
    }

    /// A line folded onto itself mirrors about the fold's foot, so a crease
    /// that stops at the foot lines up with nothing: the press carries it a
    /// pinch-length past, on to a findable end.
    #[test]
    fn a_self_fold_whose_crease_stops_at_the_foot_is_pressed_past_it() {
        let mut state = State::new(Sheet::unit_square(), DEFAULT_POINT_CAP);
        let a = state.add_line(h(0.5), LineTag::Cp).expect("a").id;
        // The fold itself, in the state so its foot on `a` is a point; not
        // creased, so nothing is findable there yet.
        let fold = v(0.5);
        state.add_line(fold, LineTag::Cp).expect("fold");
        let mut creased = Creased::new(&state);
        // Creased from the left edge exactly to the foot at x = 0.5.
        creased.add_spans(&state, a, &h(0.5), &[[[0.0, 0.5], [0.5, 0.5]]]);
        let p = state.find_point([0.5, 0.5]).expect("foot");
        let w = witness(4, vec![Ref::Point { id: p }, Ref::Line { id: a }]);
        assert!(creased.reaches(&state, a, [0.5, 0.5]), "reaches the foot");
        assert!(
            !witness_aligns_at_all(&state, &creased, &fold, &w),
            "and yet nothing lines up"
        );
        let presses = presses_for_lines(&state, &creased, &fold, &w);
        assert_eq!(presses.len(), 1, "{presses:?}");
        assert_eq!(presses[0].line, a);
        for pr in &presses {
            creased.add_spans(&state, pr.line, state.line(pr.line), &[pr.span]);
        }
        let overlap = crease_overlap(&state, &creased, &fold, a, a);
        assert!(overlap >= MIN_ALIGNMENT - TOL, "lines up {overlap}");
        assert!(witness_aligns(&state, &creased, &fold, &w));
    }

    /// Two creases meeting at their crossing, both on the sides the fold does
    /// not pair up: the bisector between the *other* rays. The press extends
    /// one crease across the crossing so it lands on the other.
    #[test]
    fn a_bisector_of_creases_that_stop_at_their_crossing_gets_one_pressed_across() {
        let mut state = State::new(Sheet::unit_square(), DEFAULT_POINT_CAP);
        let a = state.add_line(v(0.5), LineTag::Cp).expect("a").id;
        let b = state.add_line(h(0.5), LineTag::Cp).expect("b").id;
        let mut creased = Creased::new(&state);
        // Down from the crossing, and left from it.
        creased.add_spans(&state, a, &v(0.5), &[[[0.5, 0.0], [0.5, 0.5]]]);
        creased.add_spans(&state, b, &h(0.5), &[[[0.0, 0.5], [0.5, 0.5]]]);
        // x + y = 1 maps the downward ray onto the *rightward* one, not the
        // leftward one that is creased; x = y would be the fold these
        // creases sight without help.
        let fold = Line::from_points([1.0, 0.0], [0.0, 1.0]).expect("fold");
        let w = witness(3, vec![Ref::Line { id: a }, Ref::Line { id: b }]);
        assert_eq!(crease_overlap(&state, &creased, &fold, a, b), 0.0);
        let presses = presses_for_lines(&state, &creased, &fold, &w);
        assert_eq!(presses.len(), 1, "one crease crosses over: {presses:?}");
        for pr in &presses {
            creased.add_spans(&state, pr.line, state.line(pr.line), &[pr.span]);
        }
        let overlap = crease_overlap(&state, &creased, &fold, a, b);
        assert!(overlap >= MIN_ALIGNMENT - TOL, "lines up {overlap}");
        // The other bisector needed nothing.
        let other = Line::from_points([0.0, 0.0], [1.0, 1.0]).expect("fold");
        let fresh = {
            let mut c = Creased::new(&state);
            c.add_spans(&state, a, &v(0.5), &[[[0.5, 0.0], [0.5, 0.5]]]);
            c.add_spans(&state, b, &h(0.5), &[[[0.0, 0.5], [0.5, 0.5]]]);
            c
        };
        assert!(presses_for_lines(&state, &fresh, &other, &w).is_empty());
        assert!(witness_aligns(&state, &fresh, &other, &w));
    }

    #[test]
    fn quarters_sweep_alternately_and_group_by_pattern() {
        let c = closure_of(&[v(0.25), v(0.5), v(0.75), h(0.25), h(0.5), h(0.75)]);
        let placed = order(&c, false);
        assert_eq!(placed.len(), 6);
        // Round 1: the two midlines; round 2: the four quarter lines,
        // vertical cluster ascending (¼, ¾), horizontal cluster descending.
        let f = c.folded();
        let r2: Vec<(f64, f64)> = placed
            .iter()
            .filter(|p| p.sweep == 2)
            .map(|p| (f[p.folded].line.n[0], f[p.folded].line.d))
            .collect();
        assert_eq!(r2.len(), 4);
        assert!(r2[0].0 > 0.5 && r2[1].0 > 0.5, "verticals first: {r2:?}");
        assert!(r2[0].1 < r2[1].1, "ascending offsets: {r2:?}");
        assert!(r2[2].1 > r2[3].1, "descending offsets: {r2:?}");
        let groups = group(&c, &placed);
        // Midlines: same round, different directions → two groups; quarters:
        // two clusters → two groups of two.
        assert_eq!(groups.len(), 4, "{groups:?}");
        assert!(groups[2..].iter().all(|g| g.count == 2));
        assert!(groups.iter().all(|g| g.pattern.starts_with("O2:")));
    }

    #[test]
    fn landmarks_first_hoists_only_what_certifies_from_the_bare_sheet() {
        let diag = Line::from_points([0.0, 0.0], [1.0, 1.0]).expect("l");
        let anti = Line::from_points([1.0, 0.0], [0.0, 1.0]).expect("l");
        let mut c = closure_of(&[v(1.0 / 3.0), v(2.0 / 3.0), diag, anti]);
        let unbounded = Deadline::unbounded(frozen_clock());
        c.fold_line(v(0.5), LineTag::Aux).expect("fold");
        c.fold_line(
            Line::from_points([0.0, 0.0], [0.5, 1.0]).expect("l"),
            LineTag::Aux,
        )
        .expect("fold");
        c.close(&unbounded).expect("close");
        assert!(c.is_complete());
        let placed = order(&c, true);
        // x = ½ is O2 from corners: hoistable. y = 2x through (0,0) and
        // (½, 1): (½, 1) needs x = ½ (hoisted) and the top edge — hoistable
        // too, after x = ½.
        let hoisted: Vec<usize> = placed
            .iter()
            .filter(|p| p.hoisted)
            .map(|p| p.folded)
            .collect();
        assert_eq!(hoisted.len(), 2, "{placed:?}");
        assert!(placed.iter().take(2).all(|p| p.sweep == 0));
        assert!(placed.iter().skip(2).all(|p| p.sweep >= 1));
        // Without the toggle, nothing is hoisted and the aux folds keep
        // their own sweeps between the CP sweeps.
        let plain = order(&c, false);
        assert!(plain.iter().all(|p| !p.hoisted));
        let aux_sweeps: Vec<u32> = plain
            .iter()
            .filter(|p| c.folded()[p.folded].tag == LineTag::Aux)
            .map(|p| p.sweep)
            .collect();
        assert!(aux_sweeps.iter().all(|&r| r > 1 && r < 4), "{aux_sweeps:?}");
    }

    #[test]
    fn an_aux_line_built_on_a_cp_line_is_not_hoisted() {
        // Target x = ¾ is O2 once x = ½ exists... make the aux depend on a
        // CP line: CP x = ½ folds first; then aux x = ¾ (from (½,0) onto
        // (1,0)) is built on the CP mark, so it cannot move to phase 0.
        let mut c = closure_of(&[v(0.5)]);
        let unbounded = Deadline::unbounded(frozen_clock());
        assert!(c.is_complete());
        c.fold_line(v(0.75), LineTag::Aux).expect("fold");
        let _ = unbounded;
        let placed = order(&c, true);
        let aux = placed
            .iter()
            .find(|p| c.folded()[p.folded].tag == LineTag::Aux)
            .expect("aux");
        // Its witnesses: O2 ((½,0) → (1,0)) needs the CP line; O3 (x = ½
        // onto the right edge) needs it too. Not hoistable.
        assert!(!aux.hoisted, "{:?}", c.folded()[aux.folded].witnesses);
        assert_eq!(aux.sweep, 2);
    }
}

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

use crate::closure::Closure;
use crate::constants::MIN_ANGLE_SINE;
use crate::direction::Side;
use crate::line::Line;
use crate::marks::{
    Creased, point_mark_exists, witness_aligns, witness_marks_exist, witness_missing_marks,
};
use crate::pinch::PINCH_HALF_LENGTH;
use crate::predicates::{Ref, Witness};
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
    /// a hoisted line).
    pub chosen: Option<usize>,
    pub hoisted: bool,
    /// Every mark the presentation witness sights is on the paper.
    ///
    /// False when no recorded witness could be sighted from creases that
    /// actually reach their crossing — the fold is still constructible, but the
    /// folder has to be told to make the mark rather than shown where it is.
    pub marks_exist: bool,
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

/// Where a fold along `fold` uses each line input of `w` — the spot the
/// crease has to reach for the alignment to be made — by input index.
///
/// O3 aligns two lines where the fold crosses them; O4 and O7 fold a line
/// onto itself across the fold, so its foot; O5, O6 and O7 land a mark on a
/// line, so the mark's image. Reaching that spot is enough in every case:
/// the crossing is fixed by the fold, and an image on a crease is an image on
/// a crease.
fn line_use_points(
    state: &State,
    creased: &Creased,
    fold: &Line,
    w: &Witness,
) -> Vec<(usize, [f64; 2])> {
    let line_id = |i: usize| w.inputs.get(i).map(|r| r.id());
    let foot = |l: usize| fold.intersect(state.line(l)).map(|x| (l, x));
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
                match (foot(a), foot(b)) {
                    (Some(fa), Some(fb)) => {
                        out.push(fa);
                        out.push(fb);
                    }
                    // Parallel to the fold, which lies midway between them:
                    // there is no crossing, and the creases align only where
                    // one lands on the other. Carry whichever is cheaper out
                    // to where the other's crease lands.
                    _ => out.extend(parallel_use_point(state, creased, fold, a, b)),
                }
            }
        }
        4 => out.extend(line_id(1).and_then(foot)),
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
                out.extend(foot(l));
            }
        }
        _ => {}
    }
    // Only lines that are lines: a corner or mark input has no crease to press.
    out.retain(|(l, _)| w.inputs.iter().any(|r| r.is_line() && r.id() == *l));
    out
}

/// For two lines parallel to `fold`, the spot on one of them its crease must
/// reach to meet the image of the other's — on whichever line that is the
/// shorter press. `None` when one already overlaps, or nothing is creased.
fn parallel_use_point(
    state: &State,
    creased: &Creased,
    fold: &Line,
    a: usize,
    b: usize,
) -> Option<(usize, [f64; 2])> {
    let ends = |l: usize| -> Vec<[f64; 2]> {
        let line = state.line(l);
        match creased.runs_of(l) {
            Some(runs) => runs
                .iter()
                .flat_map(|&(u, v)| [line.point_at(u), line.point_at(v)])
                .collect(),
            None => Vec::new(),
        }
    };
    // How far `on` would have to be pressed to reach the nearest image of
    // `other`'s crease ends, and where.
    let cost = |on: usize, other: usize| -> Option<(f64, [f64; 2])> {
        let mine = ends(on);
        if mine.is_empty() {
            return None;
        }
        ends(other)
            .into_iter()
            .map(|e| fold.reflect_point(e))
            .map(|img| {
                let gap = mine
                    .iter()
                    .map(|m| (m[0] - img[0]).hypot(m[1] - img[1]))
                    .fold(f64::INFINITY, f64::min);
                (gap, img)
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
    for (line, at) in line_use_points(state, creased, fold, w) {
        if creased.reaches(state, line, at) || out.iter().any(|p: &Press| p.line == line) {
            continue;
        }
        let t = state.line(line).parameter_of(at);
        if let Some((span, _)) = press_span(state, creased, line, t) {
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

/// Emit the presses that make every mark `witness` sights real, recording each
/// on the paper as it goes, and return whether they all are now.
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
) -> bool {
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
            hoisted: false,
            direction_angle: folded_angle(&f.line),
            side,
            marks_exist: true,
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
    witness_marks_exist(state, creased, witness) && witness_aligns(state, creased, line, witness)
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

/// What the sightability pass settled about each fold, parallel to
/// [`Closure::folded`].
///
/// One struct rather than three slices threaded side by side: they are three
/// answers to one question — *which witness does the folder use, and can they
/// see what it names* — and a caller that had to keep them aligned by hand
/// would eventually not.
struct Sighting {
    /// Presentation witness index, which may differ from the closure's pick.
    chosen: Vec<Option<usize>>,
    /// Every mark that witness sights is on the paper.
    marks_exist: Vec<bool>,
    /// The state point ids of the marks that are not.
    missing: Vec<Vec<usize>>,
}

/// Split one round's folds into at most two side-blocks and emit them.
///
/// Every fold in a round was certified against the state as it stood *before*
/// the round began (`closure.rs`, "# Rounds"), so any order inside a round is
/// executable and the split needs no dependency check at all — it is a
/// partition, not a schedule.
///
/// Returns the side the sheet is left on.
fn emit_round(
    ordered: Vec<(usize, f64)>,
    sweep: u32,
    closure: &Closure,
    side: Side,
    sighting: &Sighting,
    placed: &mut Vec<Placed>,
) -> Side {
    let other = side.flipped();
    // Whichever side is already up leads, so a round that needs only one side
    // — the common case — never turns the sheet over at all. A fold that does
    // not force a side joins the leading block, where it costs nothing.
    let (turn, stay): (Vec<_>, Vec<_>) = ordered
        .into_iter()
        .partition(|&(i, _)| forced_side(closure, i) == Some(other));

    let mut at = side;
    for (block, block_side) in [(stay, side), (turn, other)] {
        if block.is_empty() {
            continue;
        }
        at = block_side;
        for (i, angle) in block {
            placed.push(Placed {
                folded: i,
                sweep,
                chosen: sighting.chosen[i],
                hoisted: false,
                direction_angle: angle,
                side: at,
                marks_exist: sighting.marks_exist[i],
                missing: sighting.missing[i].clone(),
                press: None,
            });
        }
    }
    at
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
                    hoisted: true,
                    direction_angle: folded_angle(&f.line),
                    side,
                    marks_exist: sightable(state, &creased, &f.line, w),
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
    let mut sighting = Sighting {
        chosen: folded.iter().map(|f| f.chosen).collect(),
        marks_exist: vec![true; folded.len()],
        missing: vec![Vec::new(); folded.len()],
    };
    for (k, &r) in rounds.iter().enumerate() {
        let members: Vec<usize> = (0..folded.len())
            .filter(|&i| !hoisted[i] && folded[i].round == r)
            .collect();
        // Prefer a witness the folder can actually sight. Every witness on a
        // round-r line was certified against the state as it stood before the
        // round began, so they all see the same paper and the choice does not
        // depend on the order inside the round.
        for &i in &members {
            let f = &folded[i];
            let sightable = (0..f.witnesses.len())
                .filter(|&w| sightable(state, &creased, &f.line, &f.witnesses[w]))
                .min_by_key(|&w| f.witnesses[w].preference());
            match sightable {
                Some(w) => sighting.chosen[i] = Some(w),
                // Nothing recorded can be sighted. Keep the closure's own
                // choice — the fold is still correct — and put the marks it
                // needs on the paper with press steps ahead of this round.
                // Only if that fails (it should not: see `presses_for_mark`)
                // is the step left flagged, naming what is missing, so the
                // invariant test reports it rather than the card pretending.
                None => {
                    if let Some(w) = sighting.chosen[i].and_then(|w| f.witnesses.get(w)) {
                        let real = make_marks_real(
                            state,
                            closure,
                            &mut creased,
                            &folded_of_line,
                            &f.line,
                            w,
                            k as u32 + 1,
                            side,
                            &mut placed,
                        );
                        sighting.marks_exist[i] = real;
                        sighting.missing[i] = if real {
                            Vec::new()
                        } else {
                            witness_missing_marks(state, &creased, w)
                        };
                    } else {
                        sighting.marks_exist[i] = f.witnesses.is_empty();
                    }
                }
            }
        }
        let is_cp_round = members.iter().all(|&i| folded[i].tag == LineTag::Cp);
        let ordered: Vec<(usize, f64)> = if is_cp_round {
            order_round(closure, &members)
        } else {
            members
                .iter()
                .map(|&i| (i, folded_angle(&folded[i].line)))
                .collect()
        };
        side = emit_round(ordered, k as u32 + 1, closure, side, &sighting, &mut placed);
        for &i in &members {
            record(&mut creased, closure, i);
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
        let w = p.chosen.map(|c| &f.witnesses[c]);
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

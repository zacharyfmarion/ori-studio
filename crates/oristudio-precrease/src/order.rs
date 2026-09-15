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
use crate::direction::{Direction, Side};
use crate::judge::{Judgement, MAX_ERROR, judge};
use crate::line::Line;
use crate::marks::{
    Creased, MIN_ALIGNMENT, crease_overlap, crease_runs, findable_end_beyond, pinchable_lines_at,
    point_mark_exists, reach, settled_end_is_found, witness_alignment, witness_aligns,
    witness_aligns_at_all, witness_lines_meet, witness_marks_exist, witness_missing_marks,
    witness_sightable,
};
use crate::pinch::PINCH_HALF_LENGTH;
use crate::predicates::{Ref, Witness, all_witnesses_for_card, crease_through};
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
    /// it stands when this fold is made. See [`candidates`].
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
    /// Crease this fold makes past what the pattern asks for, as spans on
    /// its line, because a later step uses the line there: a stretch a later
    /// step lines up against, its far end somewhere the folder could find
    /// when this fold was made; or a pinch at a crossing with a crease that
    /// was there then, for a mark a later step is sighted at. Either would
    /// have been a press of its own, and is folded into this step instead.
    /// See [`make_marks_real`] and [`pinch_while_folding`].
    pub pressed_on: Vec<[[f64; 2]; 2]>,
    /// The crease this fold leaves on its line, as the runs recorded on the
    /// paper: with the closure reaching references, the pattern's pieces
    /// each carried out to the references they stop at and merged where
    /// they meet ([`crate::marks::reach`]); without, the pattern's own runs.
    /// Empty for a press, and for a fold creased along its whole chord.
    pub made: Vec<[[f64; 2]; 2]>,
    /// A second witness of the same fold, the mirror image of the presented
    /// one about the sheet's centre line, sightable as the paper stands: the
    /// card shows both, because two alignments a sheet apart keep a long
    /// fold straight where one does not. See [`mirror_witness`].
    pub also: Option<Witness>,
    /// The presented witness is a fold the folder cannot make well — an
    /// interior point lined up on another (`judge::o2_start_is_practical`) —
    /// and nothing else was on offer. The card says so.
    pub impractical: bool,
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

impl Press {
    /// Whether this press is a pinch — a mark, not a crease to be lined up
    /// along. A press located by a crossing is a pinch there; one that runs
    /// from a run end to a findable end is more crease.
    pub fn is_pinch(&self) -> bool {
        self.sighted_from.is_some()
    }

    /// Put this press on the paper.
    pub fn record(&self, state: &State, creased: &mut Creased) {
        let line = state.line(self.line);
        if self.is_pinch() {
            creased.add_pinch(state, self.line, line, self.span);
        } else {
            creased.add_spans(state, self.line, line, &[self.span]);
        }
    }
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

/// A round's folds with the ones the folder can already sight first.
///
/// Every fold in a round was certified against the state before the round,
/// so any order is executable; the sweep order (`order_round`) is how a
/// folder works across a sheet. But a fold sighted from a crossing that no
/// crease reaches yet costs a press — and often the crease that would reach
/// it is another fold of the same round. So the sweep order is kept among
/// the folds the paper can already sight, and a fold that cannot be sighted
/// waits behind them: recorded one at a time on a copy of the paper, a fold
/// whose mark the last one just made becomes sightable and takes its turn.
/// Only when nothing left can be sighted is the next one in sweep order
/// taken as it is, and the press it needs is made by `sight`.
fn marks_first(
    closure: &Closure,
    creased: &Creased,
    ordered: Vec<(usize, f64)>,
) -> Vec<(usize, f64)> {
    let state = closure.state();
    let folded = closure.folded();
    let mut paper = creased.clone();
    let mut pending = ordered;
    let mut out = Vec::with_capacity(pending.len());
    while !pending.is_empty() {
        let free = pending.iter().position(|&(i, _)| {
            let f = &folded[i];
            let fold = f.constructed();
            f.witnesses
                .iter()
                .any(|w| sightable(state, &paper, &fold, w))
        });
        let (i, angle) = pending.remove(free.unwrap_or(0));
        // The paper of the sightable-first order is provisional: which
        // witness will be presented is not known yet, so no crease is
        // carried to an O1's marks here.
        record(&mut paper, closure, i, None);
        out.push((i, angle));
    }
    out
}

/// Record the crease `folded_index` leaves on the paper.
///
/// A fold runs the width of the sheet, but the *pattern* usually only wants
/// part of that chord. An auxiliary fold has no target and creases its whole
/// chord — the pinch pass may cut it down later, but only to marks that are
/// used, this one included if a witness names it.
/// Put fold `folded_index` on the paper, and say where: the runs recorded,
/// merged, or empty for a fold creased along its whole chord.
fn record(
    creased: &mut Creased,
    closure: &Closure,
    folded_index: usize,
    presented: Option<&Witness>,
) -> Vec<[[f64; 2]; 2]> {
    let f = &closure.folded()[folded_index];
    let state = closure.state();
    // A grid line is creased as its grid step made it: a pleat's line edge
    // to edge whatever the pattern wants of it, a band's only as far along
    // as the band runs — the same extent `Closure::fold_grid` recorded, read
    // off the grid so the two never disagree.
    if let Some(g) = f.grid {
        let spans = closure
            .grid()
            .and_then(|grid| grid.families.get(g.family))
            .and_then(|family| family.lines.get(g.line))
            .map(|gl| gl.spans.as_slice())
            .unwrap_or(&[]);
        if spans.is_empty() {
            creased.add_whole(state, f.line_id);
            return Vec::new();
        }
        creased.add_spans(state, f.line_id, &f.line, spans);
        return runs_of(&f.line, spans);
    }
    match f.target.and_then(|t| closure.targets().get(t)) {
        Some(target) if !target.spans.is_empty() => {
            // The crease the folder makes for the pattern's pieces: one run
            // from reference to reference when the closure reaches for
            // them, the pieces as they are when it does not — the same
            // rule `Closure::record_crease` keeps its own paper by, applied
            // here to the paper as it stands in presentation order.
            let made = if closure.reach_references() {
                reach(
                    state,
                    creased,
                    &f.line,
                    &target.spans,
                    closure.allow_dangling_folds(),
                )
            } else {
                runs_of(&f.line, &target.spans)
            };
            let made = presented.map_or(made.clone(), |w| through_marks(state, &f.line, made, w));
            creased.add_spans(state, f.line_id, &f.line, &made);
            creased.note_pinchable(state, f.line_id);
            made
        }
        _ => {
            creased.add_whole(state, f.line_id);
            Vec::new()
        }
    }
}

/// A crease through two marks is creased from the one to the other: "fold
/// through P and Q" is made all the way to both, whatever the pattern wants
/// between them (markhor 50). `made` with the stretch between an O1's two
/// marks added, merged into runs; any other witness leaves it alone.
fn through_marks(
    state: &State,
    line: &Line,
    mut made: Vec<[[f64; 2]; 2]>,
    w: &Witness,
) -> Vec<[[f64; 2]; 2]> {
    if w.axiom != 1 {
        return made;
    }
    let marks: Vec<[f64; 2]> = w
        .inputs
        .iter()
        .filter_map(|r| match r {
            Ref::Point { id } | Ref::Corner { id, .. } => Some(state.point(*id)),
            _ => None,
        })
        .filter(|p| line.distance_to_point(*p) <= TOL)
        .collect();
    let [p, q] = marks.as_slice() else {
        return made;
    };
    made.push([*p, *q]);
    runs_of(line, &made)
}

/// `spans` merged into runs, as spans.
fn runs_of(line: &Line, spans: &[[[f64; 2]; 2]]) -> Vec<[[f64; 2]; 2]> {
    crease_runs(line, spans)
        .into_iter()
        .map(|(a, b)| [a, b])
        .collect()
}

/// Whether the folder can sight `w` for the fold along `line`: every mark it
/// names is on the paper, and every alignment it asks for is between creases
/// that are there. Both halves are the same question — is the reference the
/// closure certified against the geometry also on the paper — asked of points
/// and of lines. [`marks::witness_sightable`], which the closure asks too.
fn sightable(state: &State, creased: &Creased, line: &Line, w: &Witness) -> bool {
    witness_sightable(state, creased, line, w)
}

/// For an edge folded onto itself through a mark: how far along `fold` its
/// foot on that edge is from the nearest crease the pattern wants on the
/// fold, in sheet units. Zero when the crease runs to that edge.
fn edge_foot_gap(state: &State, fold: &Line, spans: &[[[f64; 2]; 2]], w: &Witness) -> f64 {
    let Some(Ref::Edge { id, .. }) = w.inputs.get(1) else {
        return 0.0;
    };
    let Some(foot) = state.line(*id).intersect(fold) else {
        return 0.0;
    };
    let t = fold.parameter_of(foot);
    let runs: Vec<(f64, f64)> = if spans.is_empty() {
        state
            .sheet()
            .clip_parameters(fold)
            .map(|(lo, hi)| vec![(lo, hi)])
            .unwrap_or_default()
    } else {
        crease_runs(fold, spans)
            .into_iter()
            .map(|(a, b)| (fold.parameter_of(a), fold.parameter_of(b)))
            .collect()
    };
    runs.iter()
        .map(|&(u, v)| {
            if t < u {
                u - t
            } else if t > v {
                t - v
            } else {
                0.0
            }
        })
        .fold(f64::INFINITY, f64::min)
        .min(f64::MAX)
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
    // A pinch is an anchor to press from as much as a run is: the line is
    // creased there, however briefly.
    let runs: Vec<(f64, f64)> = creased
        .runs_of(line_id)?
        .iter()
        .chain(creased.pinches_of(line_id))
        .copied()
        .collect();
    if runs.is_empty() {
        return None;
    }
    // The run end nearest the mark, and which way the press runs from it.
    let (t_near, _) = runs
        .iter()
        .flat_map(|&(u, v)| [(u, (u - t_p).abs()), (v, (v - t_p).abs())])
        .min_by(|a, b| a.1.total_cmp(&b.1))?;
    let forward = t_near < t_p;
    // The nearest findable end beyond the mark: the boundary, or the crossing
    // with a line of settled extent that is already creased there and
    // crosses squarely — `marks::findable_end_beyond`, the rule a fold's own
    // ends are carried out by.
    let t_far = findable_end_beyond(state, creased, line, t_p, forward)?;
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
    out.retain(|(l, at)| !creased.crease_reaches(state, *l, *at));
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
            .filter(|&(l, at)| !creased.crease_reaches(state, l, at))
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
        if paper.crease_reaches(state, line, at) {
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

/// The "join the marks" witness for a fold along `line` creasing `made`: the
/// O1 through the two ends of its crease, when the crease is one run and
/// both ends are marks on the paper. Whether that is the fold to present is
/// the pick's question (`judge::CONNECT_CREASE`, [`Judgement::own_ends`]);
/// this only makes sure the candidate exists, since the enumeration keeps a
/// dozen points per line and the crease's own ends need not be among them.
fn crease_between_marks(
    state: &State,
    creased: &Creased,
    line: &Line,
    made: &[[[f64; 2]; 2]],
) -> Option<Witness> {
    let [[a, b]] = made else {
        return None;
    };
    let (p, q) = (state.find_point(*a)?, state.find_point(*b)?);
    if p == q || !point_mark_exists(state, creased, p) || !point_mark_exists(state, creased, q) {
        return None;
    }
    crease_through(state, line, p, q)
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
            press.record(state, &mut paper);
            presses += 1;
        }
    }
    if !witness_aligns(state, &paper, line, witness) {
        for press in presses_for_lines(state, &paper, line, witness) {
            press.record(state, &mut paper);
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
        meet: witness_lines_meet(state, &paper, witness),
    })
}

/// What [`repair`] found a witness needs.
#[derive(Clone, Copy, Debug)]
struct Repair {
    presses: usize,
    well: bool,
    /// For a bisector, whether the two creases meet at their crossing on the
    /// paper ([`witness_lines_meet`]). No press repairs this: extending one
    /// crease to an angle it was never part of is not a fold the pattern
    /// asked for.
    meet: bool,
}

impl Repair {
    /// Presses, counting a fold that stays short of [`MIN_ALIGNMENT`] as one
    /// more — "fold P onto Q" after a pinch is as much work as lining up a
    /// sliver, and more precise — and a bisector of creases that never meet
    /// as two more, past the budget one press may buy a preference with, so
    /// it is the choice only when nothing better can be made at all.
    fn cost(self) -> usize {
        self.presses
            + usize::from(!self.well)
            + if self.meet {
                0
            } else {
                MAX_PRESSES_FOR_PREFERENCE + 1
            }
    }
}

/// Put on the paper the marks `w` names that are only spots the folder
/// could have pinched while their line was folded
/// ([`Creased::note_pinchable`]): each pinch joins that line's making step
/// as `pressed_on` — the fold is made once, and pressed at the pattern's
/// crease and at the crossing — and the paper records it. What
/// [`crate::marks::mark_exists`] counted as there is then there in fact,
/// before the witness is sighted or repaired.
///
/// This is where [`crate::marks::reach`]'s ratio meets the marks: a crease
/// left short for its own references is pinched, at the making step,
/// wherever a later fold turns out to need a mark on the line — a pinch's
/// length each, rather than the whole line.
fn pinch_while_folding(
    state: &State,
    creased: &mut Creased,
    folded_of_line: &[Option<usize>],
    w: &Witness,
    placed: &mut [Placed],
) {
    for r in &w.inputs {
        let Ref::Point { id } = r else {
            continue;
        };
        let Some(pt) = state.points().get(*id) else {
            continue;
        };
        let Some(&(line_id, _)) = pinchable_lines_at(state, creased, pt.p, &pt.lines).first()
        else {
            continue;
        };
        let line = state.line(line_id);
        let Some(span) = pinch_span(state, line_id, line.parameter_of(pt.p)) else {
            continue;
        };
        let Some(making) = folded_of_line
            .get(line_id)
            .copied()
            .flatten()
            .and_then(|fi| {
                placed
                    .iter_mut()
                    .find(|q| q.folded == fi && q.press.is_none())
            })
        else {
            continue;
        };
        making.pressed_on.push(span);
        creased.add_pinch(state, line_id, line, span);
    }
}

/// Emit the presses that make every mark `witness` sights real and carry its
/// lines to where the fold lines them up, recording each on the paper as it
/// goes — the presses [`repair`] counted.
///
/// A press is not always a step of its own. If it could have been made
/// while the line was first folded — `snapshots` holds the paper as it
/// stood then — the plan says so: the span joins the making step as
/// `pressed_on` and no press is emitted. "Fold through P and Q, creasing
/// the top third; later, crease the rest" was two steps for one fold. That
/// is a press that runs from the crease's end out to an end that was
/// findable then; and it is a pinch located by a crease that was already
/// there then — which [`pinch_while_folding`] has normally made already,
/// the mark having counted as on the paper. A pinch located by a crease
/// made later stays a step: the crossing it is sighted at was not there to
/// sight.
#[allow(clippy::too_many_arguments)]
fn make_marks_real(
    state: &State,
    closure: &Closure,
    creased: &mut Creased,
    folded_of_line: &[Option<usize>],
    snapshots: &[Option<Creased>],
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
        press.record(state, creased);
        let then = snapshots.get(folded_index).and_then(|s| s.as_ref());
        let while_folding = match press.sighted_from {
            // Only a span that extends the crease the making fold itself
            // left, out to an end the folder could find then by the rule a
            // press's end is chosen by — never through a crossing with an
            // auxiliary line, whose extent is not settled.
            None => then.is_some_and(|then| {
                then.crease_reaches(state, press.line, press.span[0])
                    && settled_end_is_found(state, then, &f.line, press.span[1])
            }),
            // A pinch at a crossing the folder could see then.
            Some(seen) => then.is_some_and(|then| then.reaches(state, seen, press.at)),
        };
        if while_folding
            && let Some(making) = placed
                .iter_mut()
                .find(|q| q.folded == folded_index && q.press.is_none())
        {
            making.pressed_on.push(press.span);
            return;
        }
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
            pressed_on: Vec::new(),
            made: Vec::new(),
            also: None,
            impractical: false,
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

/// A crease no longer than this, in the pattern, is a pinch: it is made on
/// the face where it is a **mountain** rather than the face where it is a
/// valley, because a mountain between two nearby marks is pinched up
/// between finger and thumb, and a valley there has to be creased flat. A
/// tenth of a sheet and a pinch's length.
pub const PINCH_CREASE: f64 = 0.12;

/// The face a fold has to be made from, or `None` when it does not care.
///
/// An auxiliary line has no target and so no direction; a line whose majority
/// is under [`crate::direction::FIRM_MAJORITY`] has one but is not allowed to
/// spend a turn-over on it. A pinch ([`PINCH_CREASE`]) is made from the other
/// face, as a mountain.
fn forced_side(closure: &Closure, folded_index: usize) -> Option<Side> {
    let f = &closure.folded()[folded_index];
    let target = closure.targets().get(f.target?)?;
    let side = target.forces_side()?;
    let length: f64 = crease_runs(&f.line, &target.spans)
        .iter()
        .map(|(a, b)| (a[0] - b[0]).hypot(a[1] - b[1]))
        .sum();
    if !target.spans.is_empty() && length <= PINCH_CREASE {
        Some(side.flipped())
    } else {
        Some(side)
    }
}

/// What sighting one fold settled: which witness the folder is shown, and
/// whether they can see what it names.
struct Sighted {
    /// Presentation witness index into the recorded witnesses, or one past
    /// their end for `found`.
    chosen: Option<usize>,
    /// A witness the closure did not record — see [`candidates`].
    found: Option<Witness>,
    /// Every mark that witness sights is on the paper, and every alignment it
    /// asks for is between creases that are there.
    marks_exist: bool,
    /// The state point ids of the marks that are not.
    missing: Vec<usize>,
    /// The shortest crease alignment that witness asks for.
    alignment: Option<f64>,
    /// The presented witness's mirror image, when the paper has one.
    also: Option<Witness>,
    /// The presented witness is an impractical fold and the only one.
    impractical: bool,
}

/// Every construction the paper offers for `line` at this moment, for the
/// pick to choose from: the closure's recorded witnesses first (so `chosen`
/// can index them), then the ones the paper offers now and the closure did
/// not record — the crease's own two marks joined, and everything
/// [`all_witnesses_for_card`] enumerates whose lines are already folded.
///
/// The closure certifies a line once, against the state before its round,
/// keeps a capped list in scan order, and stops at the first tier that
/// certifies. The order inside a round is free, so by the time a fold is
/// made the paper may carry marks the same round's earlier folds left; and
/// the construction a folder would choose — a bisection at the crease, a
/// perpendicular through its end — is often one the closure never
/// enumerated. Everything the state knows is searched, including lines
/// folded later, which is why the filter is by what is folded now and not
/// by round; a mark that is not yet on the paper is not filtered here, since
/// a press can put it there and the pick prices that.
fn candidates(
    state: &State,
    creased: &Creased,
    line: &Line,
    line_id: usize,
    made: &[[[f64; 2]; 2]],
    recorded: &[Witness],
) -> Vec<Witness> {
    let mut out: Vec<Witness> = recorded.to_vec();
    let folded = |r: &Ref| match r {
        Ref::Edge { .. } | Ref::Corner { .. } | Ref::Point { .. } => true,
        Ref::Line { id } => *id != line_id && creased.is_folded(*id),
    };
    let known = |out: &[Witness], w: &Witness| {
        out.iter()
            .any(|r| r.axiom == w.axiom && r.inputs == w.inputs && r.root == w.root)
    };
    if let Some(w) = crease_between_marks(state, creased, line, made)
        && !known(&out, &w)
    {
        out.push(w);
    }
    for w in all_witnesses_for_card(state, line, creased) {
        if w.inputs.iter().all(folded) && !known(&out, &w) {
            out.push(w);
        }
    }
    out
}

/// The mirror image of `chosen` about the sheet's vertical or horizontal
/// centre line, among `candidates`, when the fold itself is its own mirror
/// image about that line and the mirror is sightable too: the second
/// alignment a symmetric design offers for the same fold (markhor's step
/// 136 — the pair on x = ⅝ beside the pair on x = ⅜). Same axiom, every
/// input the mirror of the other's, so the card can show both and the folder
/// can line up both ends of a long fold at once.
fn mirror_witness(
    state: &State,
    creased: &Creased,
    fold: &Line,
    chosen: &Witness,
    candidates: &[Witness],
) -> Option<Witness> {
    let sheet = *state.sheet();
    let mirrors: [&dyn Fn([f64; 2]) -> [f64; 2]; 2] =
        [&|p: [f64; 2]| [sheet.width - p[0], p[1]], &|p: [f64; 2]| {
            [p[0], sheet.height - p[1]]
        }];
    let same_point = |a: [f64; 2], b: [f64; 2]| (a[0] - b[0]).hypot(a[1] - b[1]) <= TOL;
    let same_line = |a: &Line, b: &Line| {
        ((a.n[0] - b.n[0]).abs() <= TOL
            && (a.n[1] - b.n[1]).abs() <= TOL
            && (a.d - b.d).abs() <= TOL)
            || ((a.n[0] + b.n[0]).abs() <= TOL
                && (a.n[1] + b.n[1]).abs() <= TOL
                && (a.d + b.d).abs() <= TOL)
    };
    let mirror_line = |l: &Line, m: &dyn Fn([f64; 2]) -> [f64; 2]| -> Option<Line> {
        let (a, b) = sheet.clip(l)?;
        Line::from_points(m(a), m(b))
    };
    for m in mirrors {
        // The fold has to be its own mirror image, or the mirror witness is
        // a witness of another fold.
        let Some(fold_image) = mirror_line(fold, m) else {
            continue;
        };
        if !same_line(fold, &fold_image) {
            continue;
        }
        let matches = |w: &Witness| -> bool {
            // The same alignment under another order of its inputs — an O1
            // through a symmetric pair, read from the other end — is not a
            // second one.
            if w.axiom != chosen.axiom
                || w.inputs.len() != chosen.inputs.len()
                || w.inputs.iter().all(|r| chosen.inputs.contains(r))
            {
                return false;
            }
            w.inputs
                .iter()
                .zip(&chosen.inputs)
                .all(|(a, b)| match (a, b) {
                    (
                        Ref::Point { id: x } | Ref::Corner { id: x, .. },
                        Ref::Point { id: y } | Ref::Corner { id: y, .. },
                    ) => same_point(state.point(*x), m(state.point(*y))),
                    (
                        Ref::Line { id: x } | Ref::Edge { id: x, .. },
                        Ref::Line { id: y } | Ref::Edge { id: y, .. },
                    ) => mirror_line(state.line(*y), m)
                        .is_some_and(|k| same_line(state.line(*x), &k)),
                    _ => false,
                })
        };
        if let Some(w) = candidates
            .iter()
            .find(|w| matches(w) && sightable(state, creased, fold, w))
        {
            return Some(w.clone());
        }
    }
    None
}

/// What sighting `witness` for a fold along `fold` costs in presses: none
/// when it is sightable as the paper stands, else what [`repair`] counts,
/// or `None` when no press makes it a fold at all.
fn witness_cost(state: &State, creased: &Creased, fold: &Line, witness: &Witness) -> Option<usize> {
    if sightable(state, creased, fold, witness) {
        Some(0)
    } else {
        repair(state, creased, fold, witness).map(Repair::cost)
    }
}

/// The witness to present for a fold along `fold`, out of `witnesses` — the
/// index of the pick, with its judgement — against the paper as it stands,
/// which will crease `made` in `direction`.
///
/// The key, in order (`implementation-plans/precrease-legible-picks.md`):
///
/// 1. **Practical** (R0): an interior point folded onto another is not a
///    fold, and is presented only when nothing else is on offer.
/// 2. **Free before pressed**: a fold the folder can make now, before one a
///    press has to prepare — with the one trade a folder makes, a single
///    press for a one-motion fold over a two-handed one
///    ([`MAX_PRESSES_FOR_PREFERENCE`]); and no press at all when the crease
///    can be made through two marks already on the paper.
/// 3. **Visible** (R1): an alignment the folder can watch — something on
///    the boundary moves, or a crease lands on a crease — before one lined
///    up under the paper, whatever kind of fold either is.
/// 4. **Precise** (R2): two references far enough apart, and the crease near
///    enough to where they are lined up, that the fold lands where it should.
/// 5. **At the crease** (R3, R4): a bisection whose vertex is the crease's
///    end, or a short crease's own two marks joined, before any other kind
///    of fold — its own marks even where one is a crease's end on another:
///    a short crease pinched between the two creases it runs between is
///    read off them, not sighted from afar.
/// 6. **A crossing to sight from** (R7), before a crease's end on another;
///    then, among free folds, marks already on the paper before a spot
///    still to be pinched while its crease is made — no step, but ink the
///    pattern does not ask for (a press has paid for its marks in the tier).
/// 7. The **ease order** — two points, line onto line, the edge onto itself
///    … — then the skinny flap, the error at the crease, the residual. For a
///    perpendicular to the sheet's edge, the edge whose foot is at the
///    crease.
///
/// Then one override: among what is visible and precise in the winning
/// class — the same presses, whether or not the same motion or as well
/// marked — a fold whose error at the crease is at most a third of the
/// ease-preferred one's is taken instead: a fold three times as accurate is
/// worth a harder kind (markhor 34: two edge marks a sheet apart over two
/// points a fifth apart) or a fuzzier mark (markhor 103).
#[allow(clippy::too_many_arguments)]
fn pick_witness(
    state: &State,
    creased: &Creased,
    fold: &Line,
    spans: &[[[f64; 2]; 2]],
    made: &[[[f64; 2]; 2]],
    direction: Direction,
    direction_of_line: crate::judge::DirectionOfLine<'_>,
    witnesses: &[Witness],
) -> Option<(usize, Judgement)> {
    // A fold perpendicular to one edge is perpendicular to the opposite
    // one too, and both are witnesses of equal ease. The folder wants the
    // edge the crease is at: "fold the bottom edge onto itself" for a
    // crease that runs up from the bottom, whichever edge the mark is
    // nearer. So the tie goes to the edge whose foot on the fold is
    // nearest the crease the pattern wants.
    let at_the_crease = |w: &Witness| -> u64 {
        if !w.folds_edge_onto_itself() {
            return 0;
        }
        (edge_foot_gap(state, fold, spans, w) / 1e-9) as u64
    };
    struct Scored {
        index: usize,
        cost: usize,
        judgement: Judgement,
        one_motion: bool,
    }
    let scored: Vec<Scored> = witnesses
        .iter()
        .enumerate()
        .filter_map(|(index, w)| {
            let cost = witness_cost(state, creased, fold, w)?;
            let judgement = judge(
                state,
                creased,
                fold,
                made,
                spans,
                direction,
                direction_of_line,
                w,
            );
            let one_motion = judgement.one_motion;
            Some(Scored {
                index,
                cost,
                judgement,
                one_motion,
            })
        })
        .collect();
    // A crease through two marks that are on the paper is a fold the
    // folder can make now, and a real diagram makes it — whatever its
    // length — rather than put a mark on the paper for a fold of an
    // easier kind. So no press may buy a preference over it: the pick
    // is among the folds that are free.
    let through_marks = scored
        .iter()
        .any(|c| c.cost == 0 && witnesses[c.index].axiom == 1);
    let practical_exists = scored.iter().any(|c| c.judgement.practical);
    let key = |c: &Scored| {
        let w = &witnesses[c.index];
        let j = &c.judgement;
        // Free one-motion folds; then free two-handed ones beside one-motion
        // folds a single press allows; then by the presses.
        let press_tier = if c.cost == 0 && c.one_motion {
            0
        } else if c.cost == 0 || (c.cost <= MAX_PRESSES_FOR_PREFERENCE && c.one_motion) {
            1
        } else {
            2 + c.cost
        };
        (
            !j.practical,
            press_tier,
            !j.visible,
            !j.precise,
            !j.local(),
            !j.crossings,
            // A spot still to be pinched while its crease is made: ink for
            // no step. A press has paid for its marks in the tier already.
            c.cost == 0 && !j.marks_real,
            j.ease,
            j.skinny,
            j.error.map_or(0, |e| (e * 1e3) as u64),
            (w.err / 1e-18) as u64,
            at_the_crease(w),
        )
    };
    let best = scored
        .iter()
        .filter(|c| c.cost == 0 || !through_marks)
        .filter(|c| c.judgement.practical || !practical_exists)
        .min_by_key(|c| key(c))?;
    // The override: three times as accurate, in the same class — the same
    // presses (not the same tier: a crease through two marks is free and
    // two-handed, and it is exactly the fold the override is for), as
    // visible, as precise, as local. Not as well marked: a fold sighted
    // from a crease's end three times nearer the crease beats one sighted
    // from a crossing a sheet away (markhor 103: an edge mark and a mark at
    // the crease over two edge marks at the far edge).
    let class = |c: &Scored| {
        let k = key(c);
        (k.0, c.cost, k.2, k.3, k.4)
    };
    // Among those, the one the key likes best — not the most accurate of
    // them: past three times better, a corner swing the folder makes in one
    // motion (bird base) is still the fold over a crease sighted through
    // two marks, however much more accurate the two marks are.
    let chosen = match best.judgement.error {
        Some(error) if !best.judgement.local() && best.judgement.visible => scored
            .iter()
            .filter(|c| class(c) == class(best) && c.judgement.visible && c.judgement.precise)
            .filter(|c| c.judgement.error.is_some_and(|e| e <= error / MAX_ERROR))
            .min_by_key(|c| key(c))
            .unwrap_or(best),
        _ => best,
    };
    Some((chosen.index, chosen.judgement.clone()))
}

/// One construction the paper offers for a fold, as the pick saw it: for
/// the tools (`explain_steps`), so what they print is what [`pick_witness`]
/// scored and not a second reading of the paper.
#[derive(Debug, Clone)]
pub struct Explained {
    pub witness: Witness,
    /// The presses sighting it would take; `None` when no press makes it a
    /// fold.
    pub cost: Option<usize>,
    pub judgement: Judgement,
    /// The one the pick chose.
    pub chosen: bool,
    /// The chosen one's mirror image, when the paper has one.
    pub also: bool,
}

/// Every construction the paper offers for a fold along `line` (its id
/// `line_id` in `state`) that will crease `made` for the pattern's `spans`
/// in `direction`, judged and priced as [`pick_witness`] does, with the
/// pick marked — the ordering pass's reasoning laid out for a tool.
#[allow(clippy::too_many_arguments)]
pub fn explain(
    state: &State,
    creased: &Creased,
    line: &Line,
    line_id: usize,
    spans: &[[[f64; 2]; 2]],
    made: &[[[f64; 2]; 2]],
    direction: Direction,
    direction_of_line: crate::judge::DirectionOfLine<'_>,
    recorded: &[Witness],
) -> Vec<Explained> {
    let pool = candidates(state, creased, line, line_id, made, recorded);
    let pick = pick_witness(
        state,
        creased,
        line,
        spans,
        made,
        direction,
        direction_of_line,
        &pool,
    );
    let also = pick
        .as_ref()
        .and_then(|(i, _)| mirror_witness(state, creased, line, &pool[*i], &pool));
    pool.iter()
        .enumerate()
        .map(|(i, w)| Explained {
            witness: w.clone(),
            cost: witness_cost(state, creased, line, w),
            judgement: judge(
                state,
                creased,
                line,
                made,
                spans,
                direction,
                direction_of_line,
                w,
            ),
            chosen: pick.as_ref().is_some_and(|(c, _)| *c == i),
            also: also
                .as_ref()
                .is_some_and(|a| a.axiom == w.axiom && a.inputs == w.inputs),
        })
        .collect()
}

/// Pick the witness the folder should be shown for fold `i`, put whatever it
/// needs on the paper ahead of it (presses, on `side`), and say whether they
/// can now see what it names.
///
/// The pick is [`pick_witness`], over every construction the paper offers
/// at this moment ([`candidates`]): the closure's recorded witnesses and
/// the ones it never enumerated alike. The presented one is `chosen`, an
/// index into the recorded list or one past its end for a witness found
/// here (`found`). Its mirror image, when the paper has one, rides along as
/// `also`.
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
    snapshots: &[Option<Creased>],
    i: usize,
    sweep: u32,
    side: Side,
    placed: &mut Vec<Placed>,
) -> Sighted {
    let f = &closure.folded()[i];
    // The line the witnesses construct — the approximation, for a fold made
    // by one — is the line the folder is sighting.
    let fold = f.constructed();
    let target = f.target.and_then(|t| closure.targets().get(t));
    let spans: &[[[f64; 2]; 2]] = target.map_or(&[], |t| t.spans.as_slice());
    let direction = target.map_or(Direction::Unassigned, |t| t.direction);
    // The crease this fold will leave, judged before it is recorded: the
    // same rule `record` applies a moment later.
    let made: Vec<[[f64; 2]; 2]> = match target {
        Some(t) if !t.spans.is_empty() => {
            if closure.reach_references() {
                reach(
                    state,
                    creased,
                    &f.line,
                    &t.spans,
                    closure.allow_dangling_folds(),
                )
            } else {
                runs_of(&f.line, &t.spans)
            }
        }
        _ => state
            .sheet()
            .clip(&f.line)
            .map(|(a, b)| vec![[a, b]])
            .unwrap_or_default(),
    };
    let direction_of_line = |line_id: usize| -> Option<Direction> {
        let fi = folded_of_line.get(line_id).copied().flatten()?;
        let t = closure.folded()[fi].target?;
        Some(closure.targets()[t].direction)
    };
    let pool = candidates(state, creased, &fold, f.line_id, &made, &f.witnesses);
    let pick = pick_witness(
        state,
        creased,
        &fold,
        spans,
        &made,
        direction,
        &direction_of_line,
        &pool,
    );
    // None of them can be folded, whatever is pressed — a perpendicular
    // whose line ends at the sheet's edge exactly at the foot, say. The step
    // is flagged as it is, and the card says so.
    let Some((index, judgement)) = pick else {
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
            also: None,
            impractical: false,
        };
    };
    let witness = pool[index].clone();
    let (chosen, found) = if index < f.witnesses.len() {
        (Some(index), None)
    } else {
        (Some(f.witnesses.len()), Some(witness.clone()))
    };
    pinch_while_folding(state, creased, folded_of_line, &witness, placed);
    if !sightable(state, creased, &fold, &witness) {
        make_marks_real(
            state,
            closure,
            creased,
            folded_of_line,
            snapshots,
            &fold,
            &witness,
            sweep,
            side,
            placed,
        );
    }
    let also = mirror_witness(state, creased, &fold, &witness, &pool);
    if let Some(w) = &also {
        pinch_while_folding(state, creased, folded_of_line, w, placed);
    }
    let real = witness_marks_exist(state, creased, &witness)
        && witness_aligns_at_all(state, creased, &fold, &witness);
    Sighted {
        chosen,
        found,
        marks_exist: real,
        alignment: witness_alignment(state, creased, &fold, &witness),
        missing: if real {
            Vec::new()
        } else {
            witness_missing_marks(state, creased, &witness)
        },
        also,
        impractical: !judgement.practical,
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
    // The paper as it stood when each fold was made, for a later press to ask
    // whether the fold could have been creased that far in the first place.
    let mut snapshots: Vec<Option<Creased>> = vec![None; folded.len()];

    // The grid is on the paper before anything else and is not placed here:
    // the planner emits its steps ahead of every placed fold. `hoisted`
    // doubles as "already on the paper" for the round loop below. The paper
    // as it stood when a grid line was made is the paper with the whole grid
    // on it — the grid is one block, and a band's line finds its ends on the
    // other family's pleat.
    let mut hoisted = vec![false; folded.len()];
    for (i, f) in folded.iter().enumerate() {
        if f.grid.is_some() {
            hoisted[i] = true;
            record(&mut creased, closure, i, None);
        }
    }
    for (i, f) in folded.iter().enumerate() {
        if f.grid.is_some() {
            snapshots[i] = Some(creased.clone());
        }
    }

    // Phase 0: hoisted landmarks.
    if landmarks_first {
        let mut available = vec![false; state.line_count()];
        for (id, l) in state.lines().iter().enumerate() {
            available[id] = matches!(l.tag, LineTag::Edge | LineTag::Grid);
        }
        for f in folded.iter().filter(|f| f.grid.is_some()) {
            available[f.line_id] = true;
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
                pinch_while_folding(state, &mut creased, &folded_of_line, w, &mut placed);
                if !sightable(state, &creased, &f.line, w) {
                    make_marks_real(
                        state,
                        closure,
                        &mut creased,
                        &folded_of_line,
                        &snapshots,
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
                    pressed_on: Vec::new(),
                    made: record(&mut creased, closure, i, Some(w)),
                    also: None,
                    impractical: false,
                });
                snapshots[i] = Some(creased.clone());
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
        // Sightable folds first, so a mark a fold needs is made by the
        // pattern's own crease rather than by a press.
        let ordered = marks_first(closure, &creased, ordered);
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
                    &snapshots,
                    i,
                    sweep,
                    side,
                    &mut placed,
                );
                let presented = sighted.found.clone().or_else(|| {
                    sighted
                        .chosen
                        .and_then(|c| folded[i].witnesses.get(c).cloned())
                });
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
                    pressed_on: Vec::new(),
                    made: record(&mut creased, closure, i, presented.as_ref()),
                    also: sighted.also,
                    impractical: sighted.impractical,
                });
                snapshots[i] = Some(creased.clone());
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
/// axiom and pattern. `step_ids` are 1-based positions in `placed`, after the
/// `first_id - 1` steps that come before them (the grid's).
pub fn group(closure: &Closure, placed: &[Placed], first_id: u32) -> Vec<Group> {
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
        let id = k as u32 + first_id;
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
    use crate::closure::{FoldOutcome, Target};
    use crate::line::Line;
    use crate::predicates::point_ref;
    use crate::sheet::Sheet;
    use crate::state::DEFAULT_POINT_CAP;

    fn v(x: f64) -> Line {
        Line::new([1.0, 0.0], x).expect("line")
    }

    fn h(y: f64) -> Line {
        Line::new([0.0, 1.0], y).expect("line")
    }

    /// The pick for a fold along `fold`, judged as if it creased the whole
    /// chord, with no direction: what the tests below ask.
    fn pick(
        state: &State,
        creased: &Creased,
        fold: &Line,
        witnesses: &[Witness],
    ) -> Option<(usize, Judgement)> {
        let made: Vec<[[f64; 2]; 2]> = state
            .sheet()
            .clip(fold)
            .map(|(a, b)| vec![[a, b]])
            .unwrap_or_default();
        let none: crate::judge::DirectionOfLine<'_> = &|_| None;
        pick_witness(
            state,
            creased,
            fold,
            &[],
            &made,
            Direction::Unassigned,
            none,
            witnesses,
        )
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

    /// The paper for the two picks below: the horizontal midline creased
    /// whole, the vertical one only up from the bottom edge to y = 0.3, and
    /// the diagonal whole. So the centre is a mark (the horizontal and the
    /// diagonal both reach it), the midline's foot on the bottom edge is a
    /// mark, and the midline's crossing with the top edge is not — both its
    /// lines are folded, and neither crease reaches it.
    fn a_paper_with_a_mark_missing() -> (State, Creased) {
        let mut state = State::new(Sheet::unit_square(), DEFAULT_POINT_CAP);
        let across = state.add_line(h(0.5), LineTag::Cp).expect("across").id;
        let up = state.add_line(v(0.5), LineTag::Cp).expect("up").id;
        let diagonal = Line::from_points([0.0, 0.0], [1.0, 1.0]).expect("diagonal");
        let diag = state.add_line(diagonal, LineTag::Cp).expect("diag").id;
        let mut creased = Creased::new(&state);
        creased.add_whole(&state, across);
        creased.add_spans(&state, up, &v(0.5), &[[[0.5, 0.0], [0.5, 0.3]]]);
        creased.add_whole(&state, diag);
        (state, creased)
    }

    /// A witness found against the paper names marks that are on it — two
    /// creases reaching the spot — never a crossing of lines that are merely
    /// folded elsewhere. The looser test is how a symmetric pair of folds
    /// came out as a corner swing on one side and a press-then-fold on the
    /// other: the found fold named a mark that was not there, and the press
    /// was the price of it.
    #[test]
    fn a_found_witness_names_only_marks_that_are_on_the_paper() {
        let (state, creased) = a_paper_with_a_mark_missing();
        let top = state.find_point([0.5, 1.0]).expect("the midline's top end");
        assert!(!point_mark_exists(&state, &creased, top));
        // The antidiagonal: through the centre, which is a mark, and (0.5, 1)
        // is where a swing about the centre would start from.
        let anti = Line::from_points([1.0, 0.0], [0.0, 1.0]).expect("anti");
        let names_top = |w: &Witness| {
            w.inputs
                .iter()
                .any(|r| matches!(r, Ref::Point { id } if *id == top))
        };
        let pool = candidates(&state, &creased, &anti, usize::MAX, &[], &[]);
        assert!(!pool.is_empty(), "the corners alone give O2");
        assert!(
            pool.iter().any(names_top),
            "the pool holds the swing through the missing mark; the pick prices it"
        );
        let (index, _) = pick(&state, &creased, &anti, &pool).expect("a pick");
        assert!(
            !names_top(&pool[index]),
            "a mark that is not there costs a press, and the corners are free: {:?}",
            pool[index]
        );
    }

    /// A crease through two marks on the paper is made through them — a real
    /// diagram creases between two references it has, whatever the length —
    /// rather than pressing a mark so the fold can be a swing. Without the
    /// two marks the swing is still worth its press.
    #[test]
    fn a_crease_through_two_marks_is_made_through_them_rather_than_pressing_for_a_swing() {
        let (state, creased) = a_paper_with_a_mark_missing();
        let centre = state.find_point([0.5, 0.5]).expect("centre");
        let top = state.find_point([0.5, 1.0]).expect("top");
        let left_edge = state.find_line(&v(0.0)).expect("left edge");
        let anti = Line::from_points([1.0, 0.0], [0.0, 1.0]).expect("anti");
        let plain = |axiom: u8, inputs: Vec<Ref>| Witness {
            axiom,
            inputs,
            root: 0,
            who_moves: Vec::new(),
            hard: false,
            visible: true,
            skinny: false,
            ease: crate::constants::fold_ease(axiom, false).expect("ease") as u8,
            err: 0.0,
        };
        // Through the south-east corner and the centre, both on the paper.
        let through = plain(
            1,
            vec![
                point_ref(&state, state.find_point([1.0, 0.0]).expect("corner")),
                Ref::Point { id: centre },
            ],
        );
        // A swing about the centre, bringing (0.5, 1) onto the left edge —
        // a fold of an easier kind, whose mark costs a pinch.
        let swing = plain(
            5,
            vec![
                Ref::Point { id: centre },
                Ref::Point { id: top },
                Ref::Edge {
                    id: left_edge,
                    side: crate::sheet::EdgeSide::Left,
                },
            ],
        );
        assert_eq!(witness_cost(&state, &creased, &anti, &through), Some(0));
        assert_eq!(witness_cost(&state, &creased, &anti, &swing), Some(1));
        let witnesses = vec![swing.clone(), through.clone()];
        assert_eq!(
            pick(&state, &creased, &anti, &witnesses).map(|(i, _)| i),
            Some(1),
            "through the marks, not the swing"
        );
        // Without the crease through marks, the pinch buys the swing.
        assert_eq!(
            pick(&state, &creased, &anti, std::slice::from_ref(&swing)).map(|(i, _)| i),
            Some(0)
        );
        // And with the crease's second mark missing too, the swing again.
        let mut bare = Creased::new(&state);
        let diag = state
            .find_line(&Line::from_points([0.0, 0.0], [1.0, 1.0]).expect("diagonal"))
            .expect("diag");
        bare.add_whole(&state, diag);
        assert!(!point_mark_exists(&state, &bare, centre));
        let both = vec![swing, through];
        assert_ne!(pick(&state, &bare, &anti, &both).map(|(i, _)| i), Some(1));
    }

    /// A mark the fold could have pinched is free of steps, not of ink: a
    /// one-motion fold whose marks are all there is the fold over one that
    /// wants the pinch first, and the pinch is made only when nothing is.
    #[test]
    fn a_fold_whose_marks_are_there_beats_one_that_wants_a_pinch_first() {
        let mut state = State::new(Sheet::unit_square(), DEFAULT_POINT_CAP);
        let up = state.add_line(v(0.5), LineTag::Cp).expect("up").id;
        let across = state.add_line(h(0.6), LineTag::Cp).expect("across").id;
        let mut creased = Creased::new(&state);
        creased.add_whole(&state, up);
        creased.add_spans(&state, across, &h(0.6), &[[[0.0, 0.6], [0.1, 0.6]]]);
        creased.note_pinchable(&state, across);
        let crossing = state.find_point([0.5, 0.6]).expect("(0.5, 0.6)");
        let top_mark = state.find_point([0.5, 1.0]).expect("(0.5, 1)");
        let top = state.find_line(&h(1.0)).expect("top edge");
        let plain = |axiom: u8, inputs: Vec<Ref>| Witness {
            axiom,
            inputs,
            root: 0,
            who_moves: Vec::new(),
            hard: false,
            visible: true,
            skinny: false,
            ease: crate::constants::fold_ease(axiom, false).expect("ease") as u8,
            err: 0.0,
        };
        // y = 0.8: the top edge onto the horizontal, or (0.5, 0.6) onto
        // (0.5, 1) — the first of which is only a spot the horizontal could
        // have been pinched at.
        let onto = plain(
            3,
            vec![
                Ref::Edge {
                    id: top,
                    side: crate::sheet::EdgeSide::Top,
                },
                Ref::Line { id: across },
            ],
        );
        let swing = plain(
            2,
            vec![Ref::Point { id: crossing }, Ref::Point { id: top_mark }],
        );
        let fold = h(0.8);
        assert!(
            sightable(&state, &creased, &fold, &swing),
            "sightable, with the pinch"
        );
        assert!(!crate::marks::witness_marks_real(&state, &creased, &swing));
        assert_eq!(witness_cost(&state, &creased, &fold, &swing), Some(0));
        let both = vec![swing.clone(), onto];
        assert_eq!(
            pick(&state, &creased, &fold, &both).map(|(i, _)| i),
            Some(1),
            "the edge onto the crease, whose marks are there"
        );
        assert_eq!(
            pick(&state, &creased, &fold, std::slice::from_ref(&swing)).map(|(i, _)| i),
            Some(0),
            "and the swing when it is all there is"
        );
    }

    /// A press buys a swing and nothing else. A fold with two things to
    /// line up at once that the folder can make now is the fold, over
    /// another two-handed fold that a press would allow — Abra paid a press
    /// to turn a free O6 into an O7 — and still loses to a one-motion fold
    /// that one pinch allows, provided the folder can see that fold: a swing
    /// of an interior point onto an interior crease is lined up under the
    /// paper, and the free two-handed fold they can watch wins.
    #[test]
    fn a_press_buys_a_one_motion_fold_and_never_another_two_handed_one() {
        let mut state = State::new(Sheet::unit_square(), DEFAULT_POINT_CAP);
        let across = state.add_line(h(0.5), LineTag::Cp).expect("across").id;
        let up = state.add_line(v(0.5), LineTag::Cp).expect("up").id;
        let diagonal = Line::from_points([0.0, 0.0], [1.0, 1.0]).expect("diagonal");
        let diag = state.add_line(diagonal, LineTag::Cp).expect("diag").id;
        let high = state.add_line(h(0.8), LineTag::Cp).expect("high").id;
        let mut creased = Creased::new(&state);
        creased.add_whole(&state, across);
        creased.add_whole(&state, up);
        // The high horizontal creased short of the right edge: (1, 0.8) on the
        // edge is not yet a mark, and (0.8, 0.8) needs the diagonal pinched.
        creased.add_spans(&state, high, &h(0.8), &[[[0.0, 0.8], [0.85, 0.8]]]);
        // The diagonal creased to just past the centre: folded onto itself
        // about the antidiagonal it lines up with nothing until it is
        // pressed on to (0.8, 0.8).
        creased.add_spans(&state, diag, &diagonal, &[[[0.0, 0.0], [0.52, 0.52]]]);
        let anti = Line::from_points([1.0, 0.0], [0.0, 1.0]).expect("anti");
        let centre = state.find_point([0.5, 0.5]).expect("centre");
        let far = state.find_point([0.8, 0.8]).expect("(0.8, 0.8)");
        let right_mark = state.find_point([1.0, 0.8]).expect("(1, 0.8)");
        let sw = point_ref(&state, state.find_point([0.0, 0.0]).expect("corner"));
        let top = Ref::Edge {
            id: state.find_line(&h(1.0)).expect("top edge"),
            side: crate::sheet::EdgeSide::Top,
        };
        let bottom = Ref::Edge {
            id: state.find_line(&h(0.0)).expect("bottom edge"),
            side: crate::sheet::EdgeSide::Bottom,
        };
        let plain = |axiom: u8, inputs: Vec<Ref>, who_moves: Vec<u8>, visible: bool| Witness {
            axiom,
            inputs,
            root: 0,
            who_moves,
            hard: !visible,
            visible,
            skinny: false,
            ease: crate::constants::fold_ease(axiom, false).expect("ease") as u8,
            err: 0.0,
        };
        // Corner Sw onto the top edge while the centre stays on the midline.
        let two_handed = plain(
            6,
            vec![sw, top, Ref::Point { id: centre }, Ref::Line { id: across }],
            vec![0, 2],
            true,
        );
        // Corner Sw onto the top edge while the diagonal folds onto itself:
        // the diagonal needs pressing out first.
        let perpendicular = plain(7, vec![sw, top, Ref::Line { id: diag }], vec![0], true);
        // Through the centre, swinging (0.8, 0.8) onto the diagonal's
        // crease: the mark needs a pinch first, and the folder cannot see
        // the point land.
        let hidden_swing = plain(
            5,
            vec![
                Ref::Point { id: centre },
                Ref::Point { id: far },
                Ref::Line { id: diag },
            ],
            vec![1],
            false,
        );
        // Through the centre, swinging the edge mark (1, 0.8) onto the bottom
        // edge: a pinch to make the mark, and a fold the folder can watch.
        let swing = plain(
            5,
            vec![
                Ref::Point { id: centre },
                Ref::Point { id: right_mark },
                bottom,
            ],
            vec![1],
            true,
        );
        assert_eq!(witness_cost(&state, &creased, &anti, &two_handed), Some(0));
        assert!(witness_cost(&state, &creased, &anti, &perpendicular).is_some_and(|c| c >= 1));
        assert_eq!(
            witness_cost(&state, &creased, &anti, &hidden_swing),
            Some(1)
        );
        assert_eq!(witness_cost(&state, &creased, &anti, &swing), Some(1));
        let both = vec![perpendicular.clone(), two_handed.clone()];
        assert_eq!(
            pick(&state, &creased, &anti, &both).map(|(i, _)| i),
            Some(1),
            "the free two-handed fold, not the pressed one"
        );
        let hidden = vec![perpendicular.clone(), two_handed.clone(), hidden_swing];
        assert_eq!(
            pick(&state, &creased, &anti, &hidden).map(|(i, _)| i),
            Some(1),
            "a swing lined up under the paper does not buy anything"
        );
        let all = vec![perpendicular, two_handed, swing];
        assert_eq!(
            pick(&state, &creased, &anti, &all).map(|(i, _)| i),
            Some(2),
            "one pinch buys the swing the folder can see"
        );
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

    /// A mark on a crease left short of a crossing with a crease that was
    /// there when it was made is pinched while it is made: the pinch joins
    /// the making step, and the fold that needs the mark costs no press.
    #[test]
    fn a_mark_the_fold_could_have_pinched_joins_the_making_step() {
        let mut state = State::new(Sheet::unit_square(), DEFAULT_POINT_CAP);
        let up = state.add_line(v(0.5), LineTag::Cp).expect("up").id;
        let across = state.add_line(h(0.6), LineTag::Cp).expect("across").id;
        let mut creased = Creased::new(&state);
        creased.add_whole(&state, up);
        creased.add_spans(&state, across, &h(0.6), &[[[0.0, 0.6], [0.1, 0.6]]]);
        creased.note_pinchable(&state, across);
        let crossing = state.find_point([0.5, 0.6]).expect("a state point");
        // The making steps, as `order` would have placed them: the vertical
        // is fold 0, the horizontal fold 1.
        let mut folded_of_line = vec![None; state.line_count()];
        folded_of_line[up] = Some(0);
        folded_of_line[across] = Some(1);
        let placed_fold = |folded: usize| Placed {
            folded,
            sweep: 1,
            chosen: None,
            found: None,
            hoisted: false,
            direction_angle: 0.0,
            side: Side::Front,
            marks_exist: true,
            alignment: None,
            missing: Vec::new(),
            press: None,
            pressed_on: Vec::new(),
            made: Vec::new(),
            also: None,
            impractical: false,
        };
        let mut placed = vec![placed_fold(0), placed_fold(1)];
        let w = witness(
            2,
            vec![
                Ref::Point { id: crossing },
                Ref::Corner {
                    id: 0,
                    corner: crate::sheet::CornerName::Nw,
                },
            ],
        );
        assert!(
            presses_for_mark(&state, &creased, crossing).is_empty(),
            "no press"
        );
        pinch_while_folding(&state, &mut creased, &folded_of_line, &w, &mut placed);
        assert!(
            placed[0].pressed_on.is_empty(),
            "the vertical reaches it already"
        );
        let [span] = placed[1].pressed_on.as_slice() else {
            panic!("one pinch on the horizontal: {:?}", placed[1].pressed_on);
        };
        let mid = [
            (span[0][0] + span[1][0]) / 2.0,
            (span[0][1] + span[1][1]) / 2.0,
        ];
        assert!(
            (mid[0] - 0.5).abs() < 1e-9 && (mid[1] - 0.6).abs() < 1e-9,
            "centred on the crossing: {span:?}"
        );
        assert!(
            creased.reaches(&state, across, [0.5, 0.6]),
            "and on the paper"
        );
        // Asked again, nothing more is added.
        pinch_while_folding(&state, &mut creased, &folded_of_line, &w, &mut placed);
        assert_eq!(placed[1].pressed_on.len(), 1);
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

    /// A pinch marks a spot; it is not a crease to lay another crease along.
    /// The vertical x = 0.25 folded onto a diagonal that is creased only far
    /// away and pinched at their crossing: the marks are there, the alignment
    /// is not — and a press out to the crossing is a crease, and counts.
    #[test]
    fn a_pinch_is_a_mark_and_never_a_line_to_align_with() {
        let mut state = State::new(Sheet::unit_square(), DEFAULT_POINT_CAP);
        let a = state.add_line(v(0.25), LineTag::Cp).expect("a").id;
        let diag = Line::from_points([0.0, 0.5], [0.5, 0.0]).expect("diag");
        let b = state.add_line(diag, LineTag::Cp).expect("b").id;
        // The bisector at their crossing that carries a's upper half onto
        // b's lower-right ray: 22.5° through (0.25, 0.25).
        let (c, s) = (
            std::f64::consts::FRAC_PI_8.cos(),
            std::f64::consts::FRAC_PI_8.sin(),
        );
        let fold = Line::from_points([0.25, 0.25], [0.25 + c, 0.25 + s]).expect("fold");
        let mut creased = Creased::new(&state);
        creased.add_whole(&state, a);
        // b creased only near the right edge, then pinched at the crossing.
        creased.add_spans(&state, b, &diag, &[[[0.45, 0.05], [0.5, 0.0]]]);
        let w = witness(3, vec![Ref::Line { id: a }, Ref::Line { id: b }]);
        assert!(!witness_lines_meet(&state, &creased, &w));
        creased.add_pinch(&state, b, &diag, [[0.22, 0.28], [0.28, 0.22]]);
        assert!(
            creased.reaches(&state, b, [0.25, 0.25]),
            "the mark is there"
        );
        assert!(!creased.crease_reaches(&state, b, [0.25, 0.25]));
        assert!(
            !witness_lines_meet(&state, &creased, &w),
            "a pinch is not the crease"
        );
        assert!(!sightable(&state, &creased, &fold, &w));
        // Pressed out from its run end to the crossing: now it is crease.
        creased.add_spans(&state, b, &diag, &[[[0.45, 0.05], [0.2, 0.3]]]);
        assert!(witness_lines_meet(&state, &creased, &w));
        assert!(sightable(&state, &creased, &fold, &w));
    }

    /// Two creases that would cross somewhere neither of them goes are the
    /// last thing to fold onto each other: a two-point fold that needs two
    /// presses beats it, and a crease through two marks does too.
    #[test]
    fn a_bisector_of_creases_that_never_meet_is_the_last_resort() {
        let mut state = State::new(Sheet::unit_square(), DEFAULT_POINT_CAP);
        let a = state.add_line(v(0.25), LineTag::Cp).expect("a").id;
        let diag = Line::from_points([0.0, 0.5], [0.5, 0.0]).expect("diag");
        let b = state.add_line(diag, LineTag::Cp).expect("b").id;
        let (c, s) = (
            std::f64::consts::FRAC_PI_8.cos(),
            std::f64::consts::FRAC_PI_8.sin(),
        );
        let fold = Line::from_points([0.25, 0.25], [0.25 + c, 0.25 + s]).expect("fold");
        let mut creased = Creased::new(&state);
        creased.add_whole(&state, a);
        creased.add_spans(&state, b, &diag, &[[[0.45, 0.05], [0.5, 0.0]]]);
        let w = witness(3, vec![Ref::Line { id: a }, Ref::Line { id: b }]);
        // Aligned once folded — a's crease lands along b's — but the creases
        // never meet on the paper.
        assert!(crease_overlap(&state, &creased, &fold, a, b) >= MIN_ALIGNMENT - TOL);
        let r = repair(&state, &creased, &fold, &w).expect("foldable");
        assert!(r.well && !r.meet);
        assert!(r.cost() > MAX_PRESSES_FOR_PREFERENCE, "cost {}", r.cost());
    }

    /// *Abra*'s opening: the sheet folded in half each way with the pattern
    /// wanting only part of each midline, then corner to corner along a
    /// diagonal the pattern holds in three pieces. Each fold is made as a
    /// diagram would make it — one crease, edge to edge — and a fold sighted
    /// from a mark in one of the diagonal's gaps needs no press for it.
    /// Without the rule the pieces are placed as they are.
    #[test]
    fn a_fold_is_one_crease_from_reference_to_reference() {
        let diagonal = Line::from_points([0.0, 0.0], [1.0, 1.0]).expect("diagonal");
        let targets = || {
            vec![
                Target::new(v(0.5), vec![1], vec![[[0.5, 0.2], [0.5, 1.0]]], 1.0, 0.0),
                Target::new(h(0.5), vec![2], vec![[[0.0, 0.5], [0.8, 0.5]]], 1.0, 0.0),
                Target::new(
                    diagonal,
                    vec![3, 4, 5],
                    vec![
                        [[0.0, 0.0], [0.1, 0.1]],
                        [[0.25, 0.25], [0.75, 0.75]],
                        [[0.9, 0.9], [1.0, 1.0]],
                    ],
                    1.0,
                    0.0,
                ),
                // Two halvings toward the bottom edge, and a line whose only
                // witness is the perpendicular through their crossing with
                // the diagonal, (1/8, 1/8) — in the diagonal's first gap.
                Target::unassigned(h(0.25), vec![6]),
                Target::unassigned(h(0.125), vec![7]),
                Target::new(
                    v(0.125),
                    vec![8],
                    vec![[[0.125, 0.0], [0.125, 0.125]]],
                    1.0,
                    0.0,
                ),
            ]
        };
        let plan = |reach: bool| {
            let mut c = Closure::new(Sheet::unit_square(), targets(), DEFAULT_POINT_CAP);
            c.set_reach_references(reach);
            c.close(&Deadline::unbounded(frozen_clock()))
                .expect("close");
            assert!(c.is_complete(), "reach {reach}: {:?}", c.remaining());
            let placed = order(&c, false);
            (c, placed)
        };

        let (c, placed) = plan(true);
        let f = c.folded();
        assert!(
            placed.iter().all(|p| p.press.is_none()),
            "no press: {:?}",
            placed
                .iter()
                .filter(|p| p.press.is_some())
                .collect::<Vec<_>>()
        );
        let made_of = |line: &Line| -> [[f64; 2]; 2] {
            let entry = placed
                .iter()
                .find(|p| f[p.folded].line == *line)
                .unwrap_or_else(|| panic!("{line:?} is placed"));
            let [run] = entry.made.as_slice() else {
                panic!("one run: {:?}", entry.made);
            };
            *run
        };
        for line in [v(0.5), h(0.5), diagonal] {
            let run = made_of(&line);
            let mut got = [line.parameter_of(run[0]), line.parameter_of(run[1])];
            got.sort_by(f64::total_cmp);
            let (lo, hi) = c.state().sheet().clip_parameters(&line).expect("clip");
            assert!(
                (got[0] - lo).abs() < 1e-9 && (got[1] - hi).abs() < 1e-9,
                "{line:?} edge to edge: {got:?} vs [{lo}, {hi}]"
            );
        }
        // The pattern's own runs are what a plan without the rule makes.
        let (c, placed) = plan(false);
        let f = c.folded();
        let entry = placed
            .iter()
            .find(|p| p.press.is_none() && f[p.folded].line == diagonal)
            .expect("the diagonal is placed");
        assert_eq!(
            entry.made.len(),
            3,
            "the pieces as they are: {:?}",
            entry.made
        );
    }

    /// A short crease between two marks is creased between them, whatever
    /// else could sight it. A grid of auxiliary lines puts marks at the
    /// centre and at (9/16, 7/16); the pattern then wants the antidiagonal
    /// creased only between those two — 0.088 of the sheet. Folding corner
    /// onto corner would make it, and is not what a folder does for a
    /// thumb's width of crease.
    #[test]
    fn a_short_crease_between_marks_is_creased_through_them() {
        let anti = Line::from_points([1.0, 0.0], [0.0, 1.0]).expect("anti");
        let short = Target::new(anti, vec![], vec![[[0.5, 0.5], [0.5625, 0.4375]]], 1.0, 0.0);
        let mut c = Closure::new(Sheet::unit_square(), vec![short], DEFAULT_POINT_CAP);
        // Each a fold midway between two lines already there, so the grid
        // goes down before the pattern's own crease is looked at. Pattern
        // lines rather than auxiliary ones: a crossing of auxiliary creases
        // is not a reference the reach rule will stop a crease at, and this
        // is a test of a crease that stops at its marks.
        for line in [
            v(0.5),
            h(0.5),
            v(0.75),
            v(0.625),
            v(0.5625),
            h(0.25),
            h(0.375),
            h(0.4375),
        ] {
            assert!(
                matches!(
                    c.fold_line(line, LineTag::Cp).expect("fold"),
                    FoldOutcome::Folded { .. }
                ),
                "{line:?}"
            );
        }
        c.close(&Deadline::unbounded(frozen_clock()))
            .expect("close");
        assert!(c.is_complete());
        let placed = order(&c, false);
        let f = c.folded();
        let entry = placed
            .iter()
            .find(|p| p.press.is_none() && f[p.folded].target.is_some())
            .expect("the antidiagonal is placed");
        let w = entry.presented(&f[entry.folded]).expect("a witness");
        assert_eq!(w.axiom, 1, "{w:?}");
        let ends: Vec<[f64; 2]> = w
            .inputs
            .iter()
            .map(|r| c.state().points()[r.id()].p)
            .collect();
        let near = |p: [f64; 2], q: [f64; 2]| (p[0] - q[0]).hypot(p[1] - q[1]) < 1e-9;
        assert!(
            ends.iter().any(|&e| near(e, [0.5, 0.5]))
                && ends.iter().any(|&e| near(e, [0.5625, 0.4375])),
            "through the crease's own ends, got {ends:?}"
        );
    }

    /// The same paper with a pattern crease shorter than the stretch between
    /// its marks: "fold through P and Q" is creased from the one to the
    /// other (markhor 50).
    #[test]
    fn a_crease_through_two_marks_is_made_all_the_way_between_them() {
        let anti = Line::from_points([1.0, 0.0], [0.0, 1.0]).expect("anti");
        let short = Target::new(anti, vec![], vec![[[0.5, 0.5], [0.53, 0.47]]], 1.0, 0.0);
        let mut c = Closure::new(Sheet::unit_square(), vec![short], DEFAULT_POINT_CAP);
        for line in [
            v(0.5),
            h(0.5),
            v(0.75),
            v(0.625),
            v(0.5625),
            h(0.25),
            h(0.375),
            h(0.4375),
        ] {
            assert!(
                matches!(
                    c.fold_line(line, LineTag::Cp).expect("fold"),
                    FoldOutcome::Folded { .. }
                ),
                "{line:?}"
            );
        }
        c.close(&Deadline::unbounded(frozen_clock()))
            .expect("close");
        assert!(c.is_complete());
        let placed = order(&c, false);
        let f = c.folded();
        let entry = placed
            .iter()
            .find(|p| p.press.is_none() && f[p.folded].target.is_some())
            .expect("the antidiagonal is placed");
        let w = entry.presented(&f[entry.folded]).expect("a witness");
        assert_eq!(w.axiom, 1, "{w:?}");
        let marks: Vec<[f64; 2]> = w
            .inputs
            .iter()
            .map(|r| c.state().points()[r.id()].p)
            .collect();
        let runs = crease_runs(&anti, &entry.made);
        for m in &marks {
            assert!(
                runs.iter().any(|(a, b)| {
                    let (ta, tb, tm) = (
                        anti.parameter_of(*a),
                        anti.parameter_of(*b),
                        anti.parameter_of(*m),
                    );
                    tm >= ta.min(tb) - 1e-9 && tm <= ta.max(tb) + 1e-9
                }),
                "the crease reaches the mark {m:?}: {:?}",
                entry.made
            );
        }
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
        let groups = group(&c, &placed, 1);
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

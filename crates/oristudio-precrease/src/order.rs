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
use crate::marks::{Creased, witness_marks_exist, witness_missing_marks};
use crate::predicates::{Ref, Witness};
use crate::sequence::{Group, StepKind};
use crate::state::LineTag;
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
            let usable = (0..f.witnesses.len())
                .filter(|&k| witness_available(closure, &f.witnesses[k], &available))
                .min_by_key(|&k| f.witnesses[k].preference());
            if let Some(k) = usable {
                hoisted[i] = true;
                available[f.line_id] = true;
                placed.push(Placed {
                    folded: i,
                    sweep: 0,
                    chosen: Some(k),
                    hoisted: true,
                    direction_angle: folded_angle(&f.line),
                    side,
                    marks_exist: witness_marks_exist(state, &creased, &f.witnesses[k]),
                    missing: witness_missing_marks(state, &creased, &f.witnesses[k]),
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
                .filter(|&w| witness_marks_exist(state, &creased, &f.witnesses[w]))
                .min_by_key(|&w| f.witnesses[w].preference());
            match sightable {
                Some(w) => sighting.chosen[i] = Some(w),
                // Nothing recorded can be sighted. Keep the closure's own
                // choice — the fold is still correct — and say so, naming the
                // marks that are missing, so the driver can construct them
                // rather than the card pretending they are already there.
                None => {
                    sighting.marks_exist[i] = f.witnesses.is_empty();
                    if let Some(w) = sighting.chosen[i].and_then(|w| f.witnesses.get(w)) {
                        sighting.missing[i] = witness_missing_marks(state, &creased, w);
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
        let kind = if f.tag == LineTag::Cp {
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

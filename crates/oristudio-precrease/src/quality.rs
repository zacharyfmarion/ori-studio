//! Replay the instructions, not the planner's claims about its own paper.
//!
//! The geometric state supplies stable ids, but an input counts only where an
//! earlier instruction physically left a crease or pinch. In particular this
//! replay never records hypothetical `pinchable` spots. It also applies the
//! final auxiliary pinch pass, which can remove most of an auxiliary chord.

use serde::Serialize;

use crate::closure::Closure;
use crate::direction::{Direction, Side};
use crate::judge::{MAX_PINCH_ERROR, Vouch, judge};
use crate::line::Line;
use crate::marks::{Creased, crease_runs, end_is_found, witness_sightable};
use crate::order::Placed;
use crate::pinch::{Extent, PINCH_HALF_LENGTH, PinchVerdict, placed_pinch_pass};
use crate::state::LineTag;
use crate::tol::TOL;

/// All lengths are normalized to the sheet's longest side. Missing precision
/// measurements are counted separately, never substituted with zero error.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Quality {
    pub folds: usize,
    pub missing_folds: usize,
    /// Required pattern folds omitted from the emitted plan. Auxiliary folds
    /// may be removed if physical replay proves nobody still needs them.
    pub missing_targets: usize,
    pub auxiliary_folds: usize,
    pub attached_marks: usize,
    pub auxiliary_pinches: usize,
    pub extra_length_cp: f64,
    pub extra_length_grid: f64,
    pub extra_length_aux: f64,
    pub duplicate_folds: usize,
    pub unavailable: usize,
    pub unavailable_folds: Vec<usize>,
    pub wrong_face: usize,
    pub reversed: usize,
    /// Fold identities, so an exact target cannot become approximate while
    /// a different target becomes exact and hides the change in a total.
    pub approximate_folds: Vec<usize>,
    pub uncovered: usize,
    pub pinches_beyond: usize,
    pub unknown_pinch_precision: usize,
    pub invisible: usize,
    pub imprecise: usize,
    pub impractical: usize,
    /// Unique pattern instructions failing at least one difficulty criterion.
    pub difficult: usize,
    pub unknown_precision: usize,
    pub measured_precision: usize,
    pub error_sum: f64,
    pub lost_ends: usize,
    pub presses: usize,
    /// Separate extra marks, including ones attached to an earlier fold.
    pub extra_marks: usize,
    /// Union of all physical crease outside the target pattern, including
    /// grid, auxiliaries, presses and attached pinches; overlaps count once.
    pub extra_length: f64,
    pub turnovers: usize,
    pub cards: usize,
}

impl Quality {
    /// Conservative acceptance: no defect category or user-facing work
    /// measure can get worse in exchange for improving another. Counts of
    /// unmeasured alignments protect against "improving" precision by hiding it.
    pub fn dominates(&self, other: &Self) -> bool {
        self.no_worse_than(other)
            && (self.presses < other.presses
                || self.extra_marks < other.extra_marks
                || self.extra_length + 1e-8 < other.extra_length
                || self.turnovers < other.turnovers
                || self.invisible < other.invisible
                || self.imprecise < other.imprecise
                || self.impractical < other.impractical
                || self.unavailable < other.unavailable
                || self.lost_ends < other.lost_ends)
    }

    pub fn no_worse_than(&self, other: &Self) -> bool {
        self.folds == other.folds
            && self.missing_folds <= other.missing_folds
            && self.preserves_requirements(other)
            && self.presses <= other.presses
            && self.extra_marks <= other.extra_marks
            && self.extra_length <= other.extra_length + 1e-8
            && self.turnovers <= other.turnovers
            && self.cards <= other.cards
    }

    /// Correctness and difficulty guard shared by construction alternatives.
    /// Unlike the old ordering gate, this permits unused auxiliary folds to
    /// disappear and allows the search to compare different effort profiles.
    pub fn preserves_requirements(&self, other: &Self) -> bool {
        self.missing_targets <= other.missing_targets
            && self.duplicate_folds <= other.duplicate_folds
            && self.unavailable <= other.unavailable
            && self
                .unavailable_folds
                .iter()
                .all(|i| other.unavailable_folds.contains(i))
            && self.wrong_face <= other.wrong_face
            && self.reversed <= other.reversed
            && self
                .approximate_folds
                .iter()
                .all(|i| other.approximate_folds.contains(i))
            && self.uncovered <= other.uncovered
            && self.pinches_beyond <= other.pinches_beyond
            && self.unknown_pinch_precision <= other.unknown_pinch_precision
            && self.invisible <= other.invisible
            && self.imprecise <= other.imprecise
            && self.impractical <= other.impractical
            && self.difficult <= other.difficult
            && self.unknown_precision <= other.unknown_precision
            && self.lost_ends <= other.lost_ends
    }
}

fn intervals(line: &Line, spans: &[[[f64; 2]; 2]]) -> Vec<(f64, f64)> {
    crease_runs(line, spans)
        .into_iter()
        .map(|(a, b)| (line.parameter_of(a), line.parameter_of(b)))
        .collect()
}

fn outside(made: &[(f64, f64)], wanted: &[(f64, f64)]) -> f64 {
    made.iter()
        .map(|&(a, b)| {
            let covered: f64 = wanted
                .iter()
                .map(|&(u, v)| (b.min(v) - a.max(u)).max(0.0))
                .sum();
            (b - a - covered).max(0.0)
        })
        .sum()
}

/// Reconstruct a completed schedule, including every retroactive amendment.
/// This is intentionally independent of `Placed::marks_exist` and of the
/// scheduler's paper snapshots. Search and benchmark tools share this evaluator.
pub fn evaluate(closure: &Closure, placed: &[Placed]) -> Quality {
    replay(closure, placed, |_, _| {})
}

/// What the replay knows as it reaches a placed entry: the paper the earlier
/// instructions left, and what they settled about the lines on it.
pub(crate) struct ReplayAt<'a> {
    pub paper: &'a Creased,
    /// The direction each line was folded in so far, for `judge`.
    pub direction: &'a [Option<Direction>],
    /// Which lines are exact so far (`sequence::witness_is_exact`).
    pub exact_lines: &'a [bool],
}

pub(crate) fn replay(
    closure: &Closure,
    placed: &[Placed],
    before: impl FnMut(usize, &ReplayAt),
) -> Quality {
    replay_with(closure, placed, &placed_pinch_pass(closure, placed), before)
}

/// [`evaluate`] with the auxiliary pinch pass's verdicts given rather than
/// derived again from `placed`: the plan's own, for a placement whose
/// witnesses differ from the plan's only in what a card presents
/// (`order::ways`), which leaves every other card — the auxiliary folds'
/// pinches among them — as the plan has it.
pub fn evaluate_with(closure: &Closure, placed: &[Placed], extents: &[PinchVerdict]) -> Quality {
    replay_with(closure, placed, extents, |_, _| {})
}

fn replay_with(
    closure: &Closure,
    placed: &[Placed],
    extents: &[PinchVerdict],
    mut before: impl FnMut(usize, &ReplayAt),
) -> Quality {
    let state = closure.state();
    let folded = closure.folded();
    let mut paper = Creased::new(state);
    // Lengths count pinches too; visibility/alignment must keep them separate.
    let mut ink = Creased::new(state);
    let mut seen = vec![false; folded.len()];
    let mut direction = vec![None; state.line_count()];
    let mut exact_lines: Vec<bool> = state
        .lines()
        .iter()
        .map(|l| l.tag == LineTag::Edge)
        .collect();
    let mut quality = Quality::default();
    let mut side = Side::Front;
    for (i, f) in folded.iter().enumerate() {
        if let Some(g) = f.grid {
            let spans = closure
                .grid()
                .and_then(|g0| g0.families.get(g.family))
                .and_then(|family| family.lines.get(g.line))
                .map_or(&[][..], |l| l.spans.as_slice());
            for p in [&mut paper, &mut ink] {
                if spans.is_empty() {
                    p.add_whole(state, f.line_id);
                } else {
                    p.add_spans(state, f.line_id, &f.line, spans);
                }
            }
            seen[i] = true;
            exact_lines[f.line_id] = true;
            direction[f.line_id] = f.target.map(|t| closure.targets()[t].direction);
        }
    }
    for (k, p) in placed.iter().enumerate() {
        before(
            k,
            &ReplayAt {
                paper: &paper,
                direction: &direction,
                exact_lines: &exact_lines,
            },
        );
        let f = &folded[p.folded];
        let target = f.target.map(|t| &closure.targets()[t]);
        let pattern = target.map_or(&[][..], |t| t.spans.as_slice());
        let fold = f.constructed();
        quality.turnovers += usize::from(side != p.side);
        side = p.side;
        quality.cards += usize::from(p.twin_of.is_none());
        if p.press.is_none() {
            quality.folds += 1;
            quality.auxiliary_folds += usize::from(f.target.is_none());
            quality.duplicate_folds += usize::from(seen[p.folded]);
            seen[p.folded] = true;
            quality.wrong_face += usize::from(
                target
                    .and_then(|t| t.forces_side())
                    .is_some_and(|s| s != side),
            );
        }
        let original = p
            .press
            .as_ref()
            .filter(|_| p.chosen.is_none())
            .and_then(|_| {
                placed[..k]
                    .iter()
                    .find(|q| q.folded == p.folded && q.press.is_none())
            });
        let presenting = original.unwrap_or(p);
        let w = presenting.presented(f);
        if p.press.is_none() {
            let exact = f.approximation.is_none()
                && w.is_none_or(|w| crate::sequence::witness_is_exact(state, &exact_lines, w));
            exact_lines[f.line_id] = exact;
            if !exact {
                quality.approximate_folds.push(p.folded);
            }
            if let Some(t) = target {
                let share =
                    crate::direction::share_of(t.direction, t.direction_share, side.direction());
                quality.reversed += usize::from(share > 0.0 && share < 0.5);
            }
        }
        // Auxiliary folds from external RF answers may lack a recorded
        // witness. Report this as unverified, rather than granting free credit.
        let available = (p.press.is_none() || paper.is_folded(f.line_id))
            && w.is_some_and(|w| witness_sightable(state, &paper, &fold, w))
            && presenting
                .also
                .as_ref()
                .is_none_or(|w| witness_sightable(state, &paper, &fold, w));
        quality.unavailable += usize::from(!available);
        if !available {
            quality.unavailable_folds.push(p.folded);
        }
        let vouch = w.map(|w| Vouch::of(state, &paper, &fold, w));
        if let Some(press) = &p.press {
            quality.presses += 1;
            quality.extra_marks += 1;
            match vouch.as_ref().and_then(|v| v.error_at(press.span)) {
                Some(e) if e > MAX_PINCH_ERROR => quality.pinches_beyond += 1,
                None => quality.unknown_pinch_precision += 1,
                _ => {}
            }
            press.record(state, &mut paper);
            ink.add_spans(state, f.line_id, &f.line, &[press.span]);
            continue;
        }
        let aux_pinches = match &extents[k].extent {
            Extent::Pinches { spans } => Some(spans.as_slice()),
            Extent::Full => None,
        };
        let chord = state
            .sheet()
            .clip(&f.line)
            .map(|(a, b)| vec![[a, b]])
            .unwrap_or_default();
        let made = aux_pinches.unwrap_or_else(|| {
            if !p.made.is_empty() {
                &p.made
            } else if !pattern.is_empty() {
                pattern
            } else {
                &chord
            }
        });
        if f.tag == LineTag::Cp {
            if let Some(w) = w {
                let j = judge(
                    state,
                    &paper,
                    &fold,
                    made,
                    pattern,
                    side.direction(),
                    &|id| direction[id],
                    w,
                );
                quality.invisible += usize::from(!j.visible);
                quality.imprecise += usize::from(!j.precise);
                quality.impractical += usize::from(!j.practical);
                quality.difficult += usize::from(!j.visible || !j.precise || !j.practical);
                if let Some(e) = j.error.filter(|e| e.is_finite()) {
                    quality.measured_precision += 1;
                    quality.error_sum += e;
                } else {
                    quality.unknown_precision += 1;
                }
            } else {
                quality.unknown_precision += 1;
            }
            let wanted = if pattern.is_empty() { &chord } else { pattern };
            quality.uncovered +=
                usize::from(outside(&intervals(&f.line, wanted), &intervals(&f.line, made)) > TOL);
        }
        if aux_pinches.is_none() {
            for (a, b) in crease_runs(&f.line, made) {
                quality.lost_ends += usize::from(!end_is_found(state, &paper, &f.line, a));
                quality.lost_ends += usize::from(!end_is_found(state, &paper, &f.line, b));
            }
            paper.add_spans(state, f.line_id, &f.line, made);
        } else {
            quality.extra_marks += made.len();
            quality.auxiliary_pinches += made.len();
            for &span in made {
                paper.add_pinch(state, f.line_id, &f.line, span);
            }
        }
        ink.add_spans(state, f.line_id, &f.line, made);
        direction[f.line_id] = Some(side.direction());
        for &span in &p.pressed_on {
            quality.extra_marks += 1;
            quality.attached_marks += 1;
            match vouch.as_ref().and_then(|v| v.error_at(span)) {
                Some(e) if e > MAX_PINCH_ERROR => quality.pinches_beyond += 1,
                None => quality.unknown_pinch_precision += 1,
                _ => {}
            }
            if (span[0][0] - span[1][0]).hypot(span[0][1] - span[1][1])
                <= 2.0 * PINCH_HALF_LENGTH + TOL
            {
                paper.add_pinch(state, f.line_id, &f.line, span);
            } else {
                paper.add_spans(state, f.line_id, &f.line, &[span]);
            }
            ink.add_spans(state, f.line_id, &f.line, &[span]);
        }
    }
    quality.missing_folds = seen.iter().filter(|&&s| !s).count();
    quality.missing_targets = folded
        .iter()
        .enumerate()
        .filter(|(i, f)| f.target.is_some() && !seen[*i])
        .count();
    for f in folded {
        let chord = state
            .sheet()
            .clip_parameters(&f.line)
            .map(|iv| vec![iv])
            .unwrap_or_default();
        let made = ink.runs_of(f.line_id).unwrap_or(&chord);
        let wanted = f
            .target
            .map(|t| &closure.targets()[t])
            .map_or_else(Vec::new, |t| {
                if t.spans.is_empty() {
                    chord.clone()
                } else {
                    intervals(&f.line, &t.spans)
                }
            });
        let extra = outside(made, &wanted);
        quality.extra_length += extra;
        if f.grid.is_some() {
            quality.extra_length_grid += extra;
        } else if f.target.is_some() {
            quality.extra_length_cp += extra;
        } else {
            quality.extra_length_aux += extra;
        }
    }
    quality
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::{Deadline, frozen_clock};
    use crate::order::order_with;
    use crate::state::DEFAULT_POINT_CAP;
    use crate::{Sheet, TOL, Target};

    fn halves_and_quarter() -> Closure {
        let mut c = Closure::new(
            Sheet::unit_square(),
            [0.25, 0.5]
                .into_iter()
                .map(|x| Target::unassigned(Line::new([1., 0.], x).unwrap(), vec![]))
                .collect(),
            DEFAULT_POINT_CAP,
        );
        c.close(&Deadline::unbounded(frozen_clock())).unwrap();
        c
    }

    #[test]
    fn replay_checks_physical_inputs_instead_of_trusting_the_flag() {
        let c = halves_and_quarter();
        let mut placed = order_with(&c, false, false);
        assert_eq!(evaluate(&c, &placed).unavailable, 0);
        placed.reverse();
        for p in &mut placed {
            p.marks_exist = true;
        }
        assert!(evaluate(&c, &placed).unavailable > 0);
    }

    #[test]
    fn replay_detects_dropped_and_duplicated_folds() {
        let c = halves_and_quarter();
        let mut placed = order_with(&c, false, false);
        let first = placed[0].clone();
        placed.pop();
        assert_eq!(evaluate(&c, &placed).missing_folds, 1);
        placed.push(first);
        assert_eq!(evaluate(&c, &placed).duplicate_folds, 1);
    }

    #[test]
    fn a_missing_alignment_cannot_hide_unknown_pinch_precision() {
        let c = halves_and_quarter();
        let mut placed = order_with(&c, false, false);
        placed[0].chosen = None;
        let line = c.folded()[placed[0].folded].line;
        let (a, b) = c.state().sheet().clip(&line).unwrap();
        placed[0].pressed_on.push([a, b]);
        let q = evaluate(&c, &placed);
        assert!(q.unavailable > 0);
        assert_eq!(q.unknown_pinch_precision, 1);
    }

    #[test]
    fn a_worse_reference_cannot_be_hidden_by_fixing_a_different_one() {
        let a = Quality {
            unavailable: 1,
            unavailable_folds: vec![2],
            ..Quality::default()
        };
        let b = Quality {
            unavailable: 1,
            unavailable_folds: vec![3],
            turnovers: 1,
            ..Quality::default()
        };
        assert!(!a.dominates(&b));
        let unknown = Quality {
            unknown_precision: 1,
            ..Quality::default()
        };
        let known = Quality {
            turnovers: 1,
            ..Quality::default()
        };
        assert!(!unknown.dominates(&known));
    }

    #[test]
    fn extra_crease_is_a_union_including_attached_marks() {
        let line = Line::new([1., 0.], 0.5).unwrap();
        let mut c = Closure::new(
            Sheet::unit_square(),
            vec![Target::new(
                line,
                vec![1],
                vec![[[0.5, 0.], [0.5, 0.25]]],
                0.,
                1.,
            )],
            DEFAULT_POINT_CAP,
        );
        c.close(&Deadline::unbounded(frozen_clock())).unwrap();
        let mut placed = order_with(&c, false, false);
        placed[0].made = vec![[[0.5, 0.], [0.5, 0.25]]];
        placed[0].pressed_on = vec![[[0.5, 0.5], [0.5, 0.56]], [[0.5, 0.53], [0.5, 0.59]]];
        let q = evaluate(&c, &placed);
        assert!((q.extra_length - 0.09).abs() < TOL, "{q:?}");
        assert_eq!(q.extra_marks, 2);
    }
}

//! Search over completed physical constructions: alignments, extents and
//! auxiliary commitments, rather than only permutations of a fixed fold set.

use super::*;
use crate::clock::Deadline;
use crate::quality::{self, Quality};
use serde::Serialize;

#[derive(Debug, Clone, Copy, Default)]
pub struct Options {
    pub max_evaluations: usize,
    pub max_passes: usize,
    /// Keep correctness/difficulty strict while allowing effort tradeoffs.
    pub tradeoffs: bool,
    /// Explore a single displayed alignment only when it independently meets
    /// the existing visibility, practicality and precision requirements.
    pub single_alignment: bool,
    /// Candidate shortlist per fold, ranked by extent and potentially retired
    /// reference work. Zero explores every physically eligible witness.
    pub witnesses_per_fold: usize,
}

impl Options {
    pub const fn production() -> Self {
        Self {
            max_evaluations: 16000,
            max_passes: 3,
            tradeoffs: true,
            single_alignment: true,
            witnesses_per_fold: 24,
        }
    }
}

#[derive(Debug, Default, Serialize)]
pub struct Stats {
    pub evaluations: usize,
    pub alignments_tried: usize,
    pub alignments_changed: usize,
    pub successful_deletion_trials: usize,
    pub expired: bool,
}

pub struct Result {
    pub placed: Vec<Placed>,
    pub stats: Stats,
    pub after_cleanup: Quality,
}

struct Search<'a> {
    closure: &'a Closure,
    deadline: &'a Deadline,
    options: Options,
    initial: Quality,
    stats: Stats,
}

impl Search<'_> {
    fn stopped(&mut self) -> bool {
        let expired = self.deadline.expired();
        self.stats.expired |= expired;
        expired || self.stats.evaluations >= self.options.max_evaluations
    }

    fn evaluate(&mut self, placed: &[Placed]) -> Quality {
        self.stats.evaluations += 1;
        quality::evaluate(self.closure, placed)
    }

    fn better(&self, a: &Quality, b: &Quality) -> bool {
        if !a.preserves_requirements(b) || !a.preserves_requirements(&self.initial) {
            return false;
        }
        if !self.options.tradeoffs {
            return a.folds <= b.folds
                && a.presses <= b.presses
                && a.extra_marks <= b.extra_marks
                && a.extra_length <= b.extra_length + 1e-8
                && a.turnovers <= b.turnovers
                && a.cards <= b.cards
                && (a.folds < b.folds
                    || a.presses < b.presses
                    || a.extra_marks < b.extra_marks
                    || a.extra_length + 1e-8 < b.extra_length
                    || a.turnovers < b.turnovers
                    || a.invisible < b.invisible
                    || a.imprecise < b.imprecise
                    || a.impractical < b.impractical
                    || a.unavailable < b.unavailable
                    || a.lost_ends < b.lost_ends);
        }
        // Dimensionless relative effort. This is an explicit experimental
        // preference, not a measured estimate of human folding time.
        let cost = |q: &Quality| effort(q, &self.initial);
        cost(a) + 1e-8 < cost(b)
            || (cost(a) <= cost(b) + 1e-8
                && (a.invisible < b.invisible
                    || a.imprecise < b.imprecise
                    || a.impractical < b.impractical
                    || a.unavailable < b.unavailable))
    }

    /// Removing a construction can invalidate witnesses, stopping references,
    /// or the auxiliary pinch pass. Replay after each proposed deletion checks
    /// all three against the completed physical prefix.
    fn clean(&mut self, placed: &mut Vec<Placed>, q: &mut Quality, affected: Option<&[usize]>) {
        let mut k = placed.len();
        while k > 0 {
            k -= 1;
            if self.stopped() {
                return;
            }
            let f = &self.closure.folded()[placed[k].folded];
            if affected.is_some_and(|ids| !ids.contains(&f.line_id)) {
                continue;
            }
            if placed[k].press.is_some() || (f.target.is_none() && f.grid.is_none()) {
                let mut proposed = placed.clone();
                proposed.remove(k);
                normalize_twins(&mut proposed);
                let next = self.evaluate(&proposed);
                if self.better(&next, q) {
                    *placed = proposed;
                    *q = next;
                    self.stats.successful_deletion_trials += 1;
                    continue;
                }
            }
            let mut j = placed[k].pressed_on.len();
            while j > 0 {
                j -= 1;
                if self.stopped() {
                    return;
                }
                let span = placed[k].pressed_on.remove(j);
                let next = self.evaluate(placed);
                if self.better(&next, q) {
                    *q = next;
                    self.stats.successful_deletion_trials += 1;
                } else {
                    placed[k].pressed_on.insert(j, span);
                }
            }
        }
    }
}

/// A dimensionless, explicitly chosen effort preference. Correctness and
/// difficulty are separate acceptance gates, never terms that can be bought.
pub(super) fn effort(q: &Quality, baseline: &Quality) -> f64 {
    q.extra_marks as f64 / baseline.extra_marks.max(1) as f64
        + q.extra_length / baseline.extra_length.max(0.1)
        + 0.25 * q.turnovers as f64 / baseline.turnovers.max(1) as f64
        + 0.25 * (q.folds + q.presses) as f64 / (baseline.folds + baseline.presses).max(1) as f64
}

fn normalize_twins(placed: &mut [Placed]) {
    for k in 0..placed.len() {
        if let Some(a) = placed[k].twin_of
            && (k == 0
                || placed[k - 1].folded != a
                || placed[k - 1].press.is_some()
                || placed[k - 1].side != placed[k].side)
        {
            placed[k].twin_of = None;
        }
    }
}

/// A pair was proven symmetric for its original witness and crease extent.
/// Editing either member invalidates that proof; show separate cards unless
/// the scheduler explicitly establishes a new pair on a later rollout.
fn unpair(placed: &mut [Placed], k: usize) {
    placed[k].twin_of = None;
    if k + 1 < placed.len() && placed[k + 1].twin_of == Some(placed[k].folded) {
        placed[k + 1].twin_of = None;
    }
}

fn input_lines(state: &State, w: &Witness) -> Vec<usize> {
    let mut ids = Vec::new();
    for r in &w.inputs {
        match r {
            Ref::Line { id } | Ref::Edge { id, .. } => ids.push(*id),
            Ref::Point { id } | Ref::Corner { id, .. } => ids.extend(&state.points()[*id].lines),
        }
    }
    ids.sort_unstable();
    ids.dedup();
    ids
}

/// An offline construction teacher. The initial implementation deliberately
/// uses a fixed work cap as well as a deadline so benchmark runs can freeze
/// the clock and compare policies at reproducible budgets.
pub fn refine(
    closure: &Closure,
    baseline: Vec<Placed>,
    options: Options,
    deadline: &Deadline,
) -> Result {
    let mut placed = baseline;
    let initial = quality::evaluate(closure, &placed);
    let mut q = initial.clone();
    let mut search = Search {
        closure,
        deadline,
        options,
        initial,
        stats: Stats::default(),
    };
    search.clean(&mut placed, &mut q, None);
    let after_cleanup = q.clone();
    for _ in 0..options.max_passes {
        if search.stopped() {
            break;
        }
        let old_quality = q.clone();
        let mut ids: Vec<_> = placed
            .iter()
            .filter(|p| p.press.is_none())
            .map(|p| {
                let f = &closure.folded()[p.folded];
                let target_length: f64 = f.target.map_or(0.0, |t| {
                    closure.targets()[t]
                        .spans
                        .iter()
                        .map(|[a, b]| (a[0] - b[0]).hypot(a[1] - b[1]))
                        .sum()
                });
                let length: f64 = p
                    .made
                    .iter()
                    .map(|[a, b]| (a[0] - b[0]).hypot(a[1] - b[1]))
                    .sum();
                (
                    p.folded,
                    (length - target_length).max(0.0) + p.pressed_on.len() as f64 * 0.1,
                )
            })
            .collect();
        ids.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
        for (id, _) in ids {
            if search.stopped() {
                break;
            }
            let Some(k) = placed
                .iter()
                .position(|p| p.folded == id && p.press.is_none())
            else {
                continue;
            };
            let mut before = None;
            quality::replay(closure, &placed, |at, now| {
                if at == k {
                    before = Some(now.paper.clone());
                }
            });
            let Some(paper) = before else {
                continue;
            };
            let state = closure.state();
            let f = &closure.folded()[id];
            let fold = f.constructed();
            let spans = f
                .target
                .map_or(&[][..], |t| closure.targets()[t].spans.as_slice());
            let made = if !spans.is_empty() && closure.reach_references() {
                reach(
                    state,
                    &paper,
                    &f.line,
                    spans,
                    closure.allow_dangling_folds(),
                )
            } else {
                placed[k].made.clone()
            };
            if options.single_alignment
                && placed[k].also.is_some()
                && let Some(w) = placed[k].presented(f)
            {
                let j = judge(
                    state,
                    &paper,
                    &fold,
                    &placed[k].made,
                    spans,
                    placed[k].side.direction(),
                    &|_| None,
                    w,
                );
                if j.precise && j.visible && j.practical {
                    let affected = placed[k]
                        .also
                        .as_ref()
                        .map(|w| input_lines(state, w))
                        .unwrap_or_default();
                    let mut proposed = placed.clone();
                    proposed[k].also = None;
                    let mut next = search.evaluate(&proposed);
                    if next.preserves_requirements(&q) {
                        search.clean(&mut proposed, &mut next, Some(&affected));
                        if search.better(&next, &q) {
                            placed = proposed;
                            q = next;
                            search.stats.alignments_changed += 1;
                            continue;
                        }
                    }
                }
            }
            let affected = placed[k]
                .presented(f)
                .map(|w| input_lines(state, w))
                .unwrap_or_default();
            let direction_of = |line| {
                closure
                    .folded()
                    .iter()
                    .find(|f| f.line_id == line)
                    .and_then(|f| f.target)
                    .map(|t| closure.targets()[t].direction)
            };
            let length = |spans: &[[[f64; 2]; 2]]| {
                spans
                    .iter()
                    .map(|[a, b]| (a[0] - b[0]).hypot(a[1] - b[1]))
                    .sum::<f64>()
            };
            let mut pool: Vec<_> = candidates(state, &paper, &fold, f.line_id, &made, &f.witnesses)
                .into_iter()
                .filter_map(|w| {
                    if placed[k].presented(f).is_some_and(|old| {
                        old.axiom == w.axiom && old.inputs == w.inputs && old.root == w.root
                    }) || !witness_marks_real(state, &paper, &w)
                        || !witness_sightable(state, &paper, &fold, &w)
                    {
                        return None;
                    }
                    let extent = if spans.is_empty() || !closure.reach_references() {
                        made.clone()
                    } else {
                        through_marks(state, &f.line, made.clone(), &w)
                    };
                    let j = judge(
                        state,
                        &paper,
                        &fold,
                        &extent,
                        spans,
                        placed[k].side.direction(),
                        &direction_of,
                        &w,
                    );
                    let inputs = input_lines(state, &w);
                    let retired = placed
                        .iter()
                        .filter(|p| {
                            let line = closure.folded()[p.folded].line_id;
                            affected.contains(&line) && !inputs.contains(&line)
                        })
                        .map(|p| p.pressed_on.len() + usize::from(p.press.is_some()))
                        .sum::<usize>();
                    let rank = length(&placed[k].made) - length(&extent) + 0.06 * retired as f64
                        - 0.15
                            * (usize::from(!j.visible)
                                + usize::from(!j.precise)
                                + usize::from(!j.practical)) as f64;
                    Some((rank, w, extent, j))
                })
                .collect();
            // Stable tie order keeps exhaustive and bounded runs reproducible.
            pool.sort_by(|a, b| b.0.total_cmp(&a.0));
            if options.witnesses_per_fold > 0 {
                pool.truncate(options.witnesses_per_fold);
            }
            for (_, w, extent, j) in pool {
                if search.stopped() {
                    break;
                }
                let mut proposed = placed.clone();
                unpair(&mut proposed, k);
                let p = &mut proposed[k];
                p.chosen = Some(f.witnesses.len());
                p.found = Some(w.clone());
                p.made = extent;
                p.alignment = witness_alignment(state, &paper, &fold, &w);
                p.marks_exist = true;
                p.missing.clear();
                p.impractical = !j.practical;
                search.stats.alignments_tried += 1;
                let mut next = search.evaluate(&proposed);
                // A replacement may initially be neutral; deleting the marks
                // it no longer consumes can expose its downstream benefit.
                if !next.preserves_requirements(&q) {
                    continue;
                }
                // An auxiliary with no remaining point consumers temporarily
                // becomes a full crease under the pinch pass. Delete its now
                // unused construction before judging the combined replacement;
                // rejecting that intermediate cost would trap entire chains.
                search.clean(&mut proposed, &mut next, Some(&affected));
                if search.better(&next, &q) {
                    placed = proposed;
                    q = next;
                    search.stats.alignments_changed += 1;
                    break;
                }
            }
        }
        if q == old_quality {
            break;
        }
    }
    Result {
        placed,
        stats: search.stats,
        after_cleanup,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::frozen_clock;
    use crate::state::DEFAULT_POINT_CAP;
    use crate::{Sheet, Target};

    #[test]
    fn unused_auxiliaries_can_disappear_without_dropping_pattern_folds() {
        let mut c = Closure::new(
            Sheet::unit_square(),
            vec![Target::unassigned(
                Line::new([0., 1.], 0.5).unwrap(),
                vec![],
            )],
            DEFAULT_POINT_CAP,
        );
        c.fold_line(Line::new([1., 0.], 0.5).unwrap(), LineTag::Aux)
            .unwrap();
        let deadline = Deadline::unbounded(frozen_clock());
        c.close(&deadline).unwrap();
        let base = order_with(&c, false, false);
        let before = quality::evaluate(&c, &base);
        let result = refine(
            &c,
            base,
            Options {
                max_evaluations: 100,
                max_passes: 1,
                tradeoffs: false,
                single_alignment: false,
                witnesses_per_fold: 0,
            },
            &deadline,
        );
        let after = quality::evaluate(&c, &result.placed);
        assert_eq!(before.auxiliary_folds, 1);
        assert_eq!(after.auxiliary_folds, 0);
        assert_eq!(after.missing_targets, 0);
        assert_eq!(after.unavailable, 0);
        assert!(after.extra_length + 0.9 < before.extra_length);
        assert!(!quality::evaluate(&c, &[]).preserves_requirements(&after));
    }

    #[test]
    fn a_required_auxiliary_is_not_deleted_to_fake_a_shorter_plan() {
        let mut c = Closure::new(
            Sheet::unit_square(),
            vec![Target::unassigned(
                Line::new([1., 0.], 0.25).unwrap(),
                vec![],
            )],
            DEFAULT_POINT_CAP,
        );
        c.fold_line(Line::new([1., 0.], 0.5).unwrap(), LineTag::Aux)
            .unwrap();
        let deadline = Deadline::unbounded(frozen_clock());
        c.close(&deadline).unwrap();
        let base = order_with(&c, false, false);
        let result = refine(
            &c,
            base.clone(),
            Options {
                max_evaluations: 100,
                max_passes: 1,
                tradeoffs: true,
                single_alignment: false,
                witnesses_per_fold: 0,
            },
            &deadline,
        );
        let after = quality::evaluate(&c, &result.placed);
        assert_eq!(after.auxiliary_folds, 1);
        assert_eq!(after.missing_targets, 0);
        assert_eq!(after.unavailable, 0);
        assert_eq!(
            refine(&c, base.clone(), Options::default(), &deadline).placed,
            base
        );
    }

    #[test]
    fn editing_one_member_of_a_pair_requires_separate_cards() {
        let mut c = Closure::new(
            Sheet::unit_square(),
            vec![
                Target::unassigned(Line::new([1., 0.], 0.5).unwrap(), vec![]),
                Target::unassigned(Line::new([0., 1.], 0.5).unwrap(), vec![]),
            ],
            DEFAULT_POINT_CAP,
        );
        c.close(&Deadline::unbounded(frozen_clock())).unwrap();
        let mut placed = order_with(&c, false, false);
        assert_eq!(placed.len(), 2);
        placed[1].twin_of = Some(placed[0].folded);
        unpair(&mut placed, 0);
        assert!(placed.iter().all(|p| p.twin_of.is_none()));
    }

    #[test]
    fn a_new_alignment_can_replace_an_entire_auxiliary_chain() {
        let diagonal = Line::from_points([0., 0.], [1., 1.]).unwrap();
        let mut c = Closure::new(
            Sheet::unit_square(),
            vec![Target::unassigned(diagonal, vec![])],
            DEFAULT_POINT_CAP,
        );
        c.fold_line(Line::new([1., 0.], 0.5).unwrap(), LineTag::Aux)
            .unwrap();
        c.fold_line(Line::new([0., 1.], 0.5).unwrap(), LineTag::Aux)
            .unwrap();
        let deadline = Deadline::unbounded(frozen_clock());
        c.close(&deadline).unwrap();
        let point = |xy: [f64; 2]| {
            c.state()
                .points()
                .iter()
                .position(|p| (p.p[0] - xy[0]).hypot(p.p[1] - xy[1]) < 1e-8)
                .unwrap()
        };
        let via_center =
            crease_through(c.state(), &diagonal, point([0., 0.]), point([0.5, 0.5])).unwrap();
        let mut base = order_with(&c, true, false);
        let p = base
            .iter_mut()
            .find(|p| c.folded()[p.folded].target.is_some())
            .unwrap();
        p.chosen = Some(c.folded()[p.folded].witnesses.len());
        p.found = Some(via_center);
        p.also = None;
        let before = quality::evaluate(&c, &base);
        assert_eq!(before.auxiliary_folds, 2);
        assert_eq!(before.unavailable, 0);
        let result = refine(&c, base, Options::production(), &deadline);
        let after = quality::evaluate(&c, &result.placed);
        assert_eq!(after.auxiliary_folds, 0, "{before:?} -> {after:?}");
        assert_eq!(after.extra_marks, 0);
        assert_eq!(after.missing_targets, 0);
        assert_eq!(after.unavailable, 0);
    }
}

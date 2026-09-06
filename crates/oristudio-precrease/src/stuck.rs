//! The stuck handler's forward-first search.
//!
//! When the closure reaches a fixpoint with targets remaining, enumerate the
//! lines one axiom away from the current state ([`crate::candidates`]),
//! closure-test each on a cloned state, and pick the auxiliary set that
//! unsticks the component at the lowest cost. Iterative deepening: depth 1,
//! then 2, then 3 when the root candidate set is small (the plan's `≤ ~60`).
//!
//! **The goal of the deepening is a set that completes the closure**, not one
//! that merely makes progress: depth `d` is searched in full and the search
//! deepens unless some set of size ≤ `d` leaves nothing remaining. Because
//! depth `d` enumerates every set of size ≤ `d`, the first depth with a
//! completing set gives the fewest auxiliary folds that can finish the job
//! within the bound. Only when the depth bound (or the deadline) is reached
//! with no completing set does the search fall back to the best *partial*
//! set, which the driver applies before re-closing and trying again (the
//! plan's "apply the chosen auxiliary set, re-run closure, repeat").
//!
//! Stopping at the first set that unlocks *anything* is what makes a stuck
//! handler greedy, and it costs auxiliary folds: it took `claim7-cand9` from
//! 2 folds to 3 (a depth-1 line unlocking one of two targets was preferred
//! over the depth-2 pair that finishes both) and `g3d_x19` from 2 to 3.
//!
//! Score, lexicographic (plan: cost model): `(auxiliary folds added, visible
//! auxiliary creases after the pinch pass, remaining CP lines after
//! re-closure, ease sum of the auxiliary folds, canonical key)`. The last
//! term makes the choice deterministic across candidate orders.
//!
//! This is bounded, not exhaustive (plan: honest statement): a per-event
//! deadline stops the search and the result says whether it was exhausted.
//! Externally supplied lines — ReferenceFinder's — enter through the same
//! path ([`score_lines`]) and are never applied verbatim.

use serde::{Deserialize, Serialize};

use crate::candidates::{Candidate, CandidateOptions, candidates, truncate_diverse};
use crate::clock::Deadline;
use crate::closure::{Closure, FoldOutcome};
use crate::error::PrecreaseError;
use crate::line::Line;
use crate::pinch::visible_aux_count;
use crate::state::LineTag;

/// Search knobs.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StuckOptions {
    /// Depth searched unconditionally (plan: 2).
    pub max_depth: u8,
    /// Depth 3 is searched when the root candidate count is at most this.
    pub depth3_threshold: usize,
    /// Candidate set cap below the root (keeps depth 3 bounded).
    pub child_candidates: usize,
    pub candidates: CandidateOptions,
}

impl Default for StuckOptions {
    fn default() -> Self {
        Self {
            max_depth: 2,
            depth3_threshold: 60,
            child_candidates: 60,
            candidates: CandidateOptions::default(),
        }
    }
}

/// The lexicographic score of a candidate auxiliary set.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Score {
    pub aux_folds: usize,
    pub visible_aux: usize,
    pub remaining_after: usize,
    pub ease_sum: u32,
    pub key: Vec<u64>,
}

/// A solution: the auxiliary lines to fold, in order, and the closure after
/// folding them and re-closing.
#[derive(Debug, Clone)]
pub struct StuckResult {
    pub aux: Vec<Line>,
    pub score: Score,
    /// CP lines unlocked by the set.
    pub unlocked: usize,
    /// The set leaves no CP line remaining.
    pub complete: bool,
    pub closure: Closure,
}

/// Counters for one stuck event.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchStats {
    pub root_candidates: usize,
    pub candidates_evaluated: usize,
    pub closures_run: usize,
    pub depth_reached: u8,
    /// Every candidate up to `depth_reached` was evaluated.
    pub exhausted: bool,
    /// The chosen set completes the closure (rather than only unsticking it).
    pub complete: bool,
}

struct Search<'a> {
    opts: &'a StuckOptions,
    deadline: &'a Deadline,
    /// Best set that leaves nothing remaining; the deepening stops on it.
    best_complete: Option<StuckResult>,
    /// Best set that unlocks something without finishing, used only when no
    /// completing set is found within the depth bound.
    best_partial: Option<StuckResult>,
    stats: SearchStats,
    stopped: bool,
    /// Auxiliary lines already in the base closure (charged to earlier events).
    base_aux: usize,
}

fn aux_count(closure: &Closure) -> usize {
    closure
        .folded()
        .iter()
        .filter(|f| matches!(f.tag, LineTag::Aux | LineTag::RfAux))
        .count()
}

impl Search<'_> {
    /// Fold `line` as auxiliary on a clone of `base`, re-close, and return the
    /// clone with how many CP lines it unlocked (`None` when the line is not
    /// constructible from `base`).
    fn try_fold(
        &mut self,
        base: &Closure,
        line: Line,
    ) -> Result<Option<(Closure, usize, bool)>, PrecreaseError> {
        self.stats.candidates_evaluated += 1;
        let mut c = base.clone();
        let before = c.remaining().len();
        let cp_fold = match c.fold_line(line, LineTag::Aux)? {
            FoldOutcome::Folded { cp_target, .. } => cp_target.is_some(),
            _ => return Ok(None),
        };
        let outcome = c.close(self.deadline)?;
        self.stats.closures_run += 1;
        if outcome.budget_hit {
            self.stopped = true;
        }
        let unlocked = before - c.remaining().len();
        Ok(Some((c, unlocked, cp_fold)))
    }

    fn consider(&mut self, closure: &Closure, chosen: &[Line], unlocked: usize) {
        let complete = closure.is_complete();
        let mut key: Vec<u64> = chosen.iter().map(Line::key).collect();
        key.sort_unstable();
        let ease_sum: u32 = closure
            .folded()
            .iter()
            .filter(|f| f.tag == LineTag::Aux || f.tag == LineTag::RfAux)
            .filter_map(|f| f.chosen_witness())
            .map(|w| w.ease_cost())
            .sum();
        let score = Score {
            aux_folds: aux_count(closure).saturating_sub(self.base_aux),
            visible_aux: visible_aux_count(closure),
            remaining_after: closure.remaining().len(),
            ease_sum,
            key,
        };
        let slot = if complete {
            &mut self.best_complete
        } else {
            &mut self.best_partial
        };
        if slot.as_ref().is_none_or(|b| score < b.score) {
            *slot = Some(StuckResult {
                aux: chosen.to_vec(),
                score,
                unlocked,
                complete,
                closure: closure.clone(),
            });
        }
    }

    /// Whether extending a set that already holds `len` lines could still
    /// produce a completing set at most as large as the best one known.
    /// Only the *recursion* is pruned by this; every candidate at the current
    /// level is still evaluated, because a same-size set can win on the
    /// score's later keys (visible auxiliary creases, ease, canonical key)
    /// and the search has to be order-independent.
    fn worth_extending(&self, len: usize) -> bool {
        self.best_complete
            .as_ref()
            .is_none_or(|b| len < b.score.aux_folds)
    }

    fn dfs(
        &mut self,
        base: &Closure,
        cands: &[Candidate],
        depth_left: u8,
        chosen: &mut Vec<Line>,
    ) -> Result<(), PrecreaseError> {
        for cand in cands {
            if self.deadline.expired() {
                self.stopped = true;
                return Ok(());
            }
            if chosen.iter().any(|l| l.approx_eq(&cand.line)) {
                continue;
            }
            let Some((c2, unlocked, cp_fold)) = self.try_fold(base, cand.line)? else {
                continue;
            };
            chosen.push(cand.line);
            if cp_fold || unlocked > 0 {
                self.consider(&c2, chosen, unlocked + usize::from(cp_fold));
            }
            // Keep descending while the set has not finished the job: a line
            // that unlocks something is not a reason to stop looking for a
            // set that unlocks everything.
            if depth_left > 1 && !c2.is_complete() && self.worth_extending(chosen.len()) {
                let mut next = candidates(&c2, &self.opts.candidates);
                truncate_diverse(&mut next, self.opts.child_candidates);
                self.dfs(&c2, &next, depth_left - 1, chosen)?;
            }
            chosen.pop();
            if self.stopped {
                return Ok(());
            }
        }
        Ok(())
    }
}

/// Run the forward-first search from a stuck closure. Returns the best
/// auxiliary set found (or `None`) and the search counters.
pub fn stuck_search(
    closure: &Closure,
    opts: &StuckOptions,
    deadline: &Deadline,
) -> Result<(Option<StuckResult>, SearchStats), PrecreaseError> {
    let root = candidates(closure, &opts.candidates);
    let mut search = Search {
        opts,
        deadline,
        best_complete: None,
        best_partial: None,
        stats: SearchStats {
            root_candidates: root.len(),
            ..SearchStats::default()
        },
        stopped: false,
        base_aux: aux_count(closure),
    };
    let max_depth = if root.len() <= opts.depth3_threshold {
        opts.max_depth.max(3)
    } else {
        opts.max_depth
    };
    let mut chosen = Vec::new();
    for depth in 1..=max_depth {
        search.stats.depth_reached = depth;
        search.dfs(closure, &root, depth, &mut chosen)?;
        if search.best_complete.is_some() || search.stopped {
            break;
        }
    }
    search.stats.exhausted = !search.stopped;
    let best = search.best_complete.or(search.best_partial);
    search.stats.complete = best.as_ref().is_some_and(|b| b.complete);
    Ok((best, search.stats))
}

/// Score externally supplied lines one at a time against the closure: for
/// each, the number of CP lines folding it (as auxiliary) unlocks, or `None`
/// when it is not constructible from the current state.
pub fn score_lines(
    closure: &Closure,
    lines: &[Line],
    deadline: &Deadline,
) -> Result<Vec<Option<usize>>, PrecreaseError> {
    let mut out = Vec::with_capacity(lines.len());
    for &line in lines {
        let mut c = closure.clone();
        let before = c.remaining().len();
        match c.fold_line(line, LineTag::RfAux)? {
            FoldOutcome::Folded { cp_target, .. } => {
                c.close(deadline)?;
                out.push(Some(
                    before - c.remaining().len() + usize::from(cp_target.is_some()),
                ));
            }
            _ => out.push(None),
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::frozen_clock;
    use crate::closure::Target;
    use crate::sheet::Sheet;
    use crate::state::DEFAULT_POINT_CAP;

    fn v(x: f64) -> Line {
        Line::new([1.0, 0.0], x).expect("line")
    }

    fn closure_of(lines: &[Line]) -> Closure {
        let mut c = Closure::new(
            Sheet::unit_square(),
            lines
                .iter()
                .map(|l| Target {
                    line: *l,
                    cp_line_ids: vec![],
                })
                .collect(),
            DEFAULT_POINT_CAP,
        );
        c.close(&Deadline::unbounded(frozen_clock()))
            .expect("close");
        c
    }

    #[test]
    fn grid3_with_diagonals_needs_one_auxiliary_fold() {
        let diag = Line::from_points([0.0, 0.0], [1.0, 1.0]).expect("l");
        let anti = Line::from_points([1.0, 0.0], [0.0, 1.0]).expect("l");
        let c = closure_of(&[
            v(1.0 / 3.0),
            v(2.0 / 3.0),
            Line::new([0.0, 1.0], 1.0 / 3.0).expect("l"),
            Line::new([0.0, 1.0], 2.0 / 3.0).expect("l"),
            diag,
            anti,
        ]);
        assert_eq!(c.remaining().len(), 4);
        let (best, stats) = stuck_search(
            &c,
            &StuckOptions::default(),
            &Deadline::unbounded(frozen_clock()),
        )
        .expect("search");
        let best = best.expect("a solution");
        assert!(stats.exhausted);
        // Depth 1 does not suffice from {edges, diagonals}: the centre and
        // the midlines are the only depth-1 lines and none reaches a third.
        // The panel's `grid3_diag` value is 2 without a diagonal in the CP;
        // with both diagonals folded, x = ½ then y = 2x is a depth-2 set.
        assert!(best.score.aux_folds <= 2, "{:?}", best.score);
        assert!(best.closure.is_complete(), "{:?}", best.closure.remaining());
        assert_eq!(best.unlocked, 4);
    }

    #[test]
    fn nothing_to_do_returns_none() {
        let c = closure_of(&[v(0.5)]);
        assert!(c.is_complete());
        let (best, _) = stuck_search(
            &c,
            &StuckOptions::default(),
            &Deadline::unbounded(frozen_clock()),
        )
        .expect("search");
        // No remaining target: no candidate unlocks anything.
        assert!(best.is_none());
    }

    #[test]
    fn scoring_external_lines_reports_unlocks_and_refusals() {
        let diag = Line::from_points([0.0, 0.0], [1.0, 1.0]).expect("l");
        let anti = Line::from_points([1.0, 0.0], [0.0, 1.0]).expect("l");
        let c = closure_of(&[v(1.0 / 3.0), diag, anti]);
        let y2x = Line::from_points([0.0, 0.0], [0.5, 1.0]).expect("l");
        let scores = score_lines(
            &c,
            &[v(0.5), y2x, v(0.2)],
            &Deadline::unbounded(frozen_clock()),
        )
        .expect("score");
        // x = ½ alone unlocks nothing; y = 2x is not constructible without
        // (½, 1); x = 0.2 is not constructible at all.
        assert_eq!(scores, vec![Some(0), None, None]);
    }
}

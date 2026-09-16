//! Complete-plan search around the flat-sheet scheduling transition.

use super::*;

/// Bounded, deterministic counterfactual scheduling. Each proposal re-executes
/// the real instructions and may amend earlier witnesses; only a fully replayed
/// Pareto improvement replaces the incumbent. No learned geometry is involved.
pub fn improve(
    closure: &Closure,
    landmarks_first: bool,
    merge_twins: bool,
    baseline: Vec<Placed>,
    max_trials: usize,
    deadline: &crate::clock::Deadline,
) -> Vec<Placed> {
    if max_trials == 0 || deadline.expired() {
        return baseline;
    }
    let mut best = baseline;
    let mut quality = crate::quality::evaluate(closure, &best);
    let mut trials = 0;
    if max_trials > 0 && !deadline.expired() {
        best = tighten_extents(closure, best, deadline);
        quality = crate::quality::evaluate(closure, &best);
        trials += 1;
    }
    // Keep twin formation in the transition. Proposals may change which
    // folds pair; replay acceptance protects the total card count.
    loop {
        let mut changes = Vec::new();
        let order: Vec<usize> = best
            .iter()
            .filter(|p| p.press.is_none() && !p.hoisted)
            .map(|p| p.folded)
            .collect();
        for (at, &i) in order.iter().enumerate() {
            let p = best.iter().find(|p| p.folded == i && p.press.is_none());
            let Some(p) = p else {
                continue;
            };
            let f = &closure.folded()[i];
            if f.tag != LineTag::Cp {
                continue;
            }
            let spans = f
                .target
                .map_or(&[][..], |t| closure.targets()[t].spans.as_slice());
            let len = |s: &[[[f64; 2]; 2]]| {
                crease_runs(&f.line, s)
                    .iter()
                    .map(|(a, b)| (a[0] - b[0]).hypot(a[1] - b[1]))
                    .sum::<f64>()
            };
            let extra = (len(&p.made) - len(spans)).max(0.0);
            let press_count = best
                .iter()
                .filter(|q| q.press.is_some() && q.sweep == p.sweep)
                .count();
            let cost = extra + 0.1 * p.pressed_on.len() as f64 + 0.1 * press_count as f64;
            // Counterfactuals in both directions. Advancing the reference
            // provider can keep the consumers in place where delaying their
            // prerequisite would make the continuation impossible.
            for distance in 1..=16 {
                let to = at + distance;
                if to >= order.len() {
                    break;
                }
                let other = &closure.folded()[order[to]];
                if other.tag != LineTag::Cp {
                    continue;
                }
                // Save face transitions without trading them for crease.
                let same_side = forced_side(closure, i) == forced_side(closure, order[to]);
                // Nearby crossings can shorten this fold's reach or put a
                // useful mark on the paper. Geometry only shortlists; replay
                // still establishes whether the references can actually exist.
                let crossing = f.line.intersect(&other.line);
                let useful = crossing.is_some_and(|point| {
                    crate::marks::runs_reach(&f.line, &p.made, point)
                        && other.target.is_some_and(|t| {
                            crate::marks::runs_reach(
                                &other.line,
                                &closure.targets()[t].spans,
                                point,
                            )
                        })
                });
                if distance <= 2 || (cost > 1e-8 && useful) {
                    let rank =
                        cost + if same_side { 0.02 } else { 0.0 } + if useful { 0.2 } else { 0.0 };
                    changes.push((rank, at, to, 1));
                    changes.push((rank, to, at, 1));
                }
            }
        }
        // Whole face blocks can cross a neutral plateau: moving only one
        // member does not save a turn-over, while moving the block does.
        let folds: Vec<_> = best
            .iter()
            .filter(|p| p.press.is_none() && !p.hoisted)
            .collect();
        let mut blocks: Vec<(usize, usize)> = Vec::new();
        for at in 0..folds.len() {
            if at == 0 || folds[at].side != folds[at - 1].side {
                blocks.push((at, at + 1));
            } else if let Some(last) = blocks.last_mut() {
                last.1 = at + 1;
            }
        }
        for pair in blocks.windows(2) {
            let (start, end) = pair[0];
            let next_end = pair[1].1;
            changes.push((1.0, start, next_end - (end - start), end - start));
        }
        changes.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
        if trials >= max_trials || deadline.expired() {
            return best;
        }
        let mut checkpoints = Vec::new();
        if replay_order(
            closure,
            landmarks_first,
            merge_twins,
            &order,
            deadline,
            None,
            Some(&mut checkpoints),
        )
        .is_none()
        {
            return best;
        }
        let mut improved = false;
        for (_, from, to, count) in changes {
            if trials >= max_trials || deadline.expired() {
                return best;
            }
            trials += 1;
            let mut proposed = order.clone();
            let moved: Vec<_> = proposed.drain(from..from + count).collect();
            proposed.splice(to..to, moved);
            let prefix = checkpoints
                .iter()
                .rev()
                .find(|(ids, _)| proposed.starts_with(ids));
            let start = from.min(to);
            let first = proposed[start];
            let f = &closure.folded()[first];
            let mut geometric: Vec<bool> = closure
                .state()
                .lines()
                .iter()
                .map(|l| matches!(l.tag, LineTag::Edge | LineTag::Grid))
                .collect();
            for p in best.iter().filter(|p| p.hoisted && p.press.is_none()) {
                geometric[closure.folded()[p.folded].line_id] = true;
            }
            for f in closure.folded().iter().filter(|f| f.grid.is_some()) {
                geometric[f.line_id] = true;
            }
            for &id in &proposed[..start] {
                geometric[closure.folded()[id].line_id] = true;
            }
            if !f
                .witnesses
                .iter()
                .any(|w| witness_available(closure, w, &geometric))
            {
                continue;
            }
            let Some(candidate) = replay_order(
                closure,
                landmarks_first,
                merge_twins,
                &proposed,
                deadline,
                prefix.map(|(_, s)| s),
                None,
            ) else {
                return best;
            };
            let q = crate::quality::evaluate(closure, &candidate);
            if q.dominates(&quality) {
                best = candidate;
                quality = q;
                improved = true;
                break;
            }
        }
        if !improved {
            return best;
        }
    }
}

/// A late pinch attached to an earlier fold can give an intermediate crease
/// a nearer stopping reference. Re-evaluate its extent on the FINAL prefix,
/// then replay the whole result before accepting the shorter crease.
fn tighten_extents(
    closure: &Closure,
    mut placed: Vec<Placed>,
    deadline: &crate::clock::Deadline,
) -> Vec<Placed> {
    if !closure.reach_references() {
        return placed;
    }
    let mut papers = Vec::new();
    let mut quality =
        crate::quality::replay(closure, &placed, |_, paper| papers.push(paper.clone()));
    for k in 0..placed.len() {
        if deadline.expired() {
            break;
        }
        let p = &placed[k];
        let f = &closure.folded()[p.folded];
        if p.press.is_some() || f.tag != LineTag::Cp {
            continue;
        }
        let Some(target) = f.target.map(|t| &closure.targets()[t]) else {
            continue;
        };
        if target.spans.is_empty() {
            continue;
        }
        let made = reach(
            closure.state(),
            &papers[k],
            &f.line,
            &target.spans,
            closure.allow_dangling_folds(),
        );
        let made = p.presented(f).map_or(made.clone(), |w| {
            through_marks(closure.state(), &f.line, made, w)
        });
        if made == p.made {
            continue;
        }
        let old = std::mem::replace(&mut placed[k].made, made);
        let next = crate::quality::evaluate(closure, &placed);
        if next.dominates(&quality) {
            quality = next;
        } else {
            placed[k].made = old;
        }
    }
    placed
}

#[allow(clippy::too_many_arguments)]
fn replay_order(
    closure: &Closure,
    landmarks_first: bool,
    merge_twins: bool,
    order: &[usize],
    deadline: &crate::clock::Deadline,
    prefix: Option<&Schedule>,
    mut checkpoints: Option<&mut Vec<(Vec<usize>, Schedule)>>,
) -> Option<Vec<Placed>> {
    let mut schedule = prefix
        .cloned()
        .unwrap_or_else(|| Schedule::new(closure, landmarks_first));
    let already: Vec<usize> = schedule
        .placed
        .iter()
        .filter(|p| p.press.is_none() && !p.hoisted)
        .map(|p| p.folded)
        .collect();
    let mut pending: VecDeque<_> = order
        .iter()
        .filter(|i| !already.contains(i))
        .map(|&i| (i, folded_angle(&closure.folded()[i].line)))
        .collect();
    while let Some((i, angle)) = pending.pop_front() {
        // At most 17 immutable-history checkpoints. Keep memory bounded on
        // large patterns instead of retaining a complete prefix per fold.
        if let Some(checkpoints) = checkpoints.as_mut()
            && order.len() - pending.len() > checkpoints.len() * order.len().div_ceil(16).max(1)
        {
            let ids = schedule
                .placed
                .iter()
                .filter(|p| p.press.is_none() && !p.hoisted)
                .map(|p| p.folded)
                .collect();
            checkpoints.push((ids, schedule.clone()));
        }
        if deadline.expired() {
            return None;
        }
        let side = forced_side(closure, i).unwrap_or(schedule.side);
        // A twin must be on the same face and not jump across an auxiliary
        // construction. The original transition consumes only this face block.
        let count = pending
            .iter()
            .take_while(|&&(j, _)| {
                forced_side(closure, j).unwrap_or(side) == side
                    && closure.folded()[j].round == closure.folded()[i].round
            })
            .count();
        let mut block = pending.drain(..count).collect();
        schedule.place(
            closure,
            i,
            angle,
            closure.folded()[i].round,
            side,
            &mut block,
            merge_twins,
        );
        block.append(&mut pending);
        pending = block;
    }
    Some(schedule.placed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::{Deadline, frozen_clock};
    use crate::closure::Target;
    use crate::sheet::Sheet;
    use crate::state::DEFAULT_POINT_CAP;

    fn crossed_quarters() -> Closure {
        let sheet = Sheet::unit_square();
        let targets = [
            ([1., 0.], 0.5, false),
            ([0., 1.], 0.5, true),
            ([1., 0.], 0.25, false),
            ([0., 1.], 0.25, true),
        ]
        .into_iter()
        .enumerate()
        .map(|(i, (n, d, mountain))| {
            let line = Line::new(n, d).unwrap();
            let (a, b) = sheet.clip(&line).unwrap();
            Target::new(
                line,
                vec![i as u32 + 1],
                vec![[a, b]],
                f64::from(mountain),
                f64::from(!mountain),
            )
        })
        .collect();
        let mut closure = Closure::new(sheet, targets, DEFAULT_POINT_CAP);
        closure.close(&Deadline::unbounded(frozen_clock())).unwrap();
        assert!(closure.is_complete());
        closure
    }

    #[test]
    fn a_face_block_can_cross_sweeps_without_buying_marks_or_crease() {
        let c = crossed_quarters();
        let base = order_with(&c, false, true);
        let before = crate::quality::evaluate(&c, &base);
        let after_plan = improve(
            &c,
            false,
            true,
            base.clone(),
            64,
            &Deadline::unbounded(frozen_clock()),
        );
        let after = crate::quality::evaluate(&c, &after_plan);
        assert_eq!(before.turnovers, 2);
        assert_eq!(after.turnovers, 1);
        assert_eq!(after.unavailable, 0);
        assert_eq!(after.extra_marks, 0);
        assert!(after.extra_length < 1e-8);
        assert!(after.dominates(&before), "{before:?} -> {after:?}");
        assert_eq!(
            after_plan,
            improve(
                &c,
                false,
                true,
                base,
                64,
                &Deadline::unbounded(frozen_clock())
            )
        );
    }

    #[test]
    fn no_trials_or_an_expired_budget_returns_the_complete_incumbent() {
        let c = crossed_quarters();
        let base = order_with(&c, false, true);
        assert_eq!(
            base,
            improve(
                &c,
                false,
                true,
                base.clone(),
                0,
                &Deadline::unbounded(frozen_clock())
            )
        );
        use std::sync::atomic::{AtomicUsize, Ordering};
        static TICKS: AtomicUsize = AtomicUsize::new(0);
        fn tick() -> f64 {
            TICKS.fetch_add(1, Ordering::SeqCst) as f64
        }
        let deadline = Deadline::after(tick, 0.5);
        assert_eq!(base, improve(&c, false, true, base.clone(), 64, &deadline));
    }

    #[test]
    fn interruption_at_each_clock_check_never_returns_a_partial_rollout() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static TICKS: AtomicUsize = AtomicUsize::new(0);
        fn tick() -> f64 {
            TICKS.fetch_add(1, Ordering::SeqCst) as f64
        }
        let c = crossed_quarters();
        let base = order_with(&c, false, true);
        let before = crate::quality::evaluate(&c, &base);
        for ticks in 1..=80 {
            TICKS.store(0, Ordering::SeqCst);
            let after_plan = improve(
                &c,
                false,
                true,
                base.clone(),
                64,
                &Deadline::after(tick, f64::from(ticks)),
            );
            let after = crate::quality::evaluate(&c, &after_plan);
            assert!(
                after.no_worse_than(&before),
                "interruption after {ticks} checks"
            );
            assert_eq!(after.missing_folds, 0);
            assert_eq!(after.duplicate_folds, 0);
            assert_eq!(after.unavailable, 0);
        }
    }
}

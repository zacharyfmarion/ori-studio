//! Offline teacher: change a construction decision and execute the continuation.
//! Every beam member is a complete instruction history, not a folded-line set.

use super::*;
use crate::clock::Deadline;
use crate::quality::{self, Quality};
use serde::Serialize;

#[derive(Debug, Clone, Copy)]
pub struct Options {
    pub trials: usize,
    pub width: usize,
    pub cleanup_evaluations: usize,
}

#[derive(Debug, Default, Serialize)]
pub struct Stats {
    pub trials: usize,
    pub feasible: usize,
    pub improved: usize,
    pub expired: bool,
}

pub struct Result {
    pub placed: Vec<Placed>,
    pub stats: Stats,
}

#[derive(Clone)]
struct Plan {
    placed: Vec<Placed>,
    quality: Quality,
}

/// Move a reference provider or its consumer across arbitrarily many rounds.
/// The score only proposes a search order. Complete physical replay decides
/// whether either construction can actually be performed in the new position.
fn moves(closure: &Closure, placed: &[Placed]) -> Vec<(usize, usize)> {
    let folds: Vec<_> = placed
        .iter()
        .filter(|p| p.press.is_none() && !p.hoisted)
        .collect();
    let length = |spans: &[[[f64; 2]; 2]]| {
        spans
            .iter()
            .map(|[a, b]| (a[0] - b[0]).hypot(a[1] - b[1]))
            .sum::<f64>()
    };
    let mut actions = Vec::new();
    for (at, p) in folds.iter().enumerate() {
        let f = &closure.folded()[p.folded];
        let Some(t) = f.target.map(|t| &closure.targets()[t]) else {
            continue;
        };
        let excess = (length(&p.made) - length(&t.spans)).max(0.0);
        let repairs = p.pressed_on.len()
            + placed
                .iter()
                .filter(|q| q.folded == p.folded && q.press.is_some())
                .count();
        for (later, other) in folds.iter().enumerate().skip(at + 1) {
            let g = &closure.folded()[other.folded];
            let useful = f.line.intersect(&g.line).is_some_and(|point| {
                crate::marks::runs_reach(&f.line, &p.made, point)
                    && g.target.is_some_and(|t| {
                        crate::marks::runs_reach(&g.line, &closure.targets()[t].spans, point)
                    })
            });
            if !useful {
                continue;
            }
            let rank = (excess + 0.12 * repairs as f64 + 0.02) / (1.0 + 0.01 * (later - at) as f64);
            actions.push((rank, later, at));
            actions.push((rank * 0.95, at, later));
        }
    }
    actions.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
    // Round-robin over the expensive folds prevents one heavily connected
    // crease from consuming the entire teacher budget.
    let mut uses = vec![0usize; folds.len()];
    let mut diverse = Vec::new();
    for (_, from, to) in actions {
        let bucket = from.min(to);
        let pass = uses[bucket];
        uses[bucket] += 1;
        diverse.push((pass, from, to));
    }
    diverse.sort_by_key(|a| a.0);
    diverse.into_iter().map(|(_, a, b)| (a, b)).collect()
}

/// Search a small frontier of complete plans. Tradeoffs may cross a neutral
/// plateau in work, but never worsen the baseline's correctness or difficulty.
pub fn improve(
    closure: &Closure,
    baseline: Vec<Placed>,
    options: Options,
    deadline: &Deadline,
) -> Result {
    let initial = quality::evaluate(closure, &baseline);
    let mut best = Plan {
        placed: baseline,
        quality: initial.clone(),
    };
    let mut frontier = vec![best.clone()];
    let mut stats = Stats::default();
    let mut visited = std::collections::BTreeSet::new();
    while stats.trials < options.trials && !deadline.expired() && !frontier.is_empty() {
        let mut next = Vec::new();
        for parent in frontier {
            let order: Vec<_> = parent
                .placed
                .iter()
                .filter(|p| p.press.is_none() && !p.hoisted)
                .map(|p| p.folded)
                .collect();
            let mut choices = vec![None; closure.folded().len()];
            for p in parent.placed.iter().filter(|p| p.press.is_none()) {
                choices[p.folded] = p.presented(&closure.folded()[p.folded]).cloned();
            }
            for (from, to) in moves(closure, &parent.placed) {
                if stats.trials >= options.trials || deadline.expired() {
                    break;
                }
                let mut proposal = order.clone();
                let id = proposal.remove(from);
                proposal.insert(to, id);
                if !visited.insert(proposal.clone()) {
                    continue;
                }
                stats.trials += 1;
                // The moved fold gets a fresh witness choice on its new paper;
                // the continuation retains chosen witnesses when still possible.
                let old_choice = choices[id].take();
                let candidate = super::search::replay_order(
                    closure,
                    false,
                    true,
                    &proposal,
                    deadline,
                    None,
                    None,
                    Some(&choices),
                );
                choices[id] = old_choice;
                let Some(mut candidate) = candidate else {
                    break;
                };
                let mut q = quality::evaluate(closure, &candidate);
                if !q.preserves_requirements(&initial) {
                    continue;
                }
                if options.cleanup_evaluations > 0 {
                    candidate = construction::refine(
                        closure,
                        candidate,
                        construction::Options {
                            max_evaluations: options.cleanup_evaluations,
                            max_passes: 1,
                            tradeoffs: true,
                            single_alignment: true,
                            witnesses_per_fold: 16,
                        },
                        deadline,
                    )
                    .placed;
                    q = quality::evaluate(closure, &candidate);
                }
                stats.feasible += 1;
                if construction::effort(&q, &initial) + 1e-8
                    < construction::effort(&best.quality, &initial)
                {
                    best = Plan {
                        placed: candidate.clone(),
                        quality: q.clone(),
                    };
                    stats.improved += 1;
                }
                next.push(Plan {
                    placed: candidate,
                    quality: q,
                });
                next.sort_by(|a, b| {
                    construction::effort(&a.quality, &initial)
                        .total_cmp(&construction::effort(&b.quality, &initial))
                });
                next.truncate(options.width.max(1));
                // Expand multiple complete parents instead of spending the
                // entire trial budget on one parent's local neighbourhood.
                if stats.trials % 32 == 0 {
                    break;
                }
            }
        }
        frontier = next;
    }
    stats.expired = deadline.expired();
    Result {
        placed: best.placed,
        stats,
    }
}

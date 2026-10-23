//! Authoring search over ordinary and inserted M/V landings. Replay uses the
//! returned recipe directly; it never enumerates or substitutes another result.
use std::collections::{BTreeSet, VecDeque};

use oristudio_layer_order::LayerOrder;
use serde::{Deserialize, Serialize};

use crate::{
    ChoiceCount, ClosurePolicy, CompletionLimits, Completions, CompoundRefused, CreaseKind,
    Direction, FaceId, FoldRefusal, PlainFold, Refused, State, TuckChoice, TuckFold, TuckOutcome,
    WitnessOrder,
};

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum FoldLanding {
    #[default]
    Outer,
    Against {
        targets: Vec<[f64; 2]>,
    },
}

#[derive(Debug, Clone)]
pub struct FoldPlacement {
    pub landing: FoldLanding,
    pub completion: Option<WitnessOrder>,
    pub moving: Vec<FaceId>,
    pub state: State,
}

#[derive(Debug)]
struct Pending {
    targets: Vec<[f64; 2]>,
    choice: Box<TuckChoice>,
    next: u64,
}

/// One parent's search, extended in bounded batches. Every candidate moves
/// exactly the seed's material-connected flaps, regardless of the legacy
/// recipe's closure policy. Candidate indices never change: duplicates are
/// discarded before appending, and found results persist.
///
/// The search is over when it has tried every set of targets, or as soon
/// as its candidates cover every order the selection can land in (counted
/// once, up front, without a clock: [`State::placement_scope`]). The pool
/// holds one target per stationary face the flaps land on, so on precreased
/// paper the sets of targets are far too many to try; counting decides a
/// forced fold — a flat sheet folded in half lands one way — before any is.
#[derive(Debug)]
pub struct FoldPlacementSearch {
    parent: State,
    op: PlainFold,
    /// Exact material-connected selection. A layer-order choice cannot add
    /// unselected flaps, even when a legacy landing recipe can carry them.
    moving: Vec<FaceId>,
    pool: Vec<[f64; 2]>,
    combination: Option<Vec<usize>>,
    retry: VecDeque<Vec<[f64; 2]>>,
    pending: VecDeque<Pending>,
    candidates: Vec<FoldPlacement>,
    refusal: Option<Refused>,
    /// Every order the selection can land in, when counted exactly, and
    /// which of them a candidate has landed.
    landings: Option<Landings>,
}

/// The orders a selection can land in, and the ones found so far.
#[derive(Debug)]
struct Landings {
    orders: Completions,
    /// `[upper, lower]`, as every one of them has it.
    forced: Vec<[FaceId; 2]>,
    found: BTreeSet<Vec<usize>>,
}

impl Landings {
    fn new(orders: Completions) -> Self {
        Self {
            forced: orders.forced_pairs(),
            orders,
            found: BTreeSet::new(),
        }
    }

    /// Record the order a candidate landed in; one that is none of them
    /// (which the count's construction rules out) counts toward nothing.
    fn record(&mut self, order: &LayerOrder) {
        if self
            .forced
            .iter()
            .all(|&[upper, lower]| order.above(upper, lower) == Some(true))
            && let Some(choice) = self.orders.choice_of(order)
        {
            self.found.insert(choice);
        }
    }

    fn all_found(&self) -> bool {
        self.found.len() as u64 == self.orders.count().orders
    }
}

impl FoldPlacementSearch {
    pub fn new(parent: &State, op: &PlainFold) -> Self {
        let mut search = Self {
            parent: parent.clone(),
            op: op.clone(),
            moving: Vec::new(),
            pool: Vec::new(),
            combination: None,
            retry: VecDeque::new(),
            pending: VecDeque::new(),
            candidates: Vec::new(),
            refusal: None,
            landings: None,
        };
        let probe = search.tuck(&[[0., 0.]]);
        match parent.placement_scope(&probe) {
            Ok(scope) => {
                search.moving = scope.moving;
                search.pool = scope.targets;
                search.landings = scope.orders.map(Landings::new);
            }
            Err(refused) => {
                search.refusal = Some(refused);
                return search;
            }
        }
        // Preserve the normal refusal/fix when reaching the outside would
        // require additional flaps. Insertions can still land this selection.
        match parent.fold(&op.clone().with_closure(ClosurePolicy::Refuse)) {
            Ok(folded) => search.insert(FoldPlacement {
                landing: FoldLanding::Outer,
                completion: None,
                moving: folded.report.analysis.moving,
                state: folded.state,
            }),
            Err(refused) => search.refusal = Some(refused),
        }
        if !search.pool.is_empty() {
            search.combination = Some(vec![0]);
        }
        search
    }

    pub fn candidates(&self) -> &[FoldPlacement] {
        &self.candidates
    }
    pub fn refusal(&self) -> Option<&Refused> {
        self.refusal.as_ref()
    }
    pub fn count(&self) -> ChoiceCount {
        ChoiceCount {
            orders: self.candidates.len() as u64,
            exact: self.finished(),
        }
    }

    /// Every set of targets tried, or every order the selection can land in
    /// found.
    fn finished(&self) -> bool {
        (self.combination.is_none() && self.retry.is_empty() && self.pending.is_empty())
            || self.all_landed()
    }

    fn all_landed(&self) -> bool {
        self.landings.as_ref().is_some_and(Landings::all_found)
    }

    fn tuck(&self, targets: &[[f64; 2]]) -> TuckFold {
        TuckFold {
            line: self.op.line,
            side: self.op.side,
            direction: self.op.direction,
            seed: self.op.seed.clone(),
            target: targets[0],
            additional_targets: targets[1..].to_vec(),
        }
    }

    fn insert(&mut self, candidate: FoldPlacement) {
        // Legacy Tuck specifies which side of a target to land against. That
        // can also reverse the fold at the flap's own attachment: a flat
        // endpoint, but not another layer order of the requested M/V action.
        // Filter before counting, retaining the original replay witness.
        if candidate.moving != self.moving || !self.matches_direction(&candidate.state) {
            return;
        }
        if !self.candidates.iter().any(|old| {
            old.moving == candidate.moving && old.state.parts() == candidate.state.parts()
        }) {
            if let Some(landings) = &mut self.landings {
                landings.record(candidate.state.order());
            }
            self.candidates.push(candidate);
        }
    }

    fn matches_direction(&self, landed: &State) -> bool {
        // A single-axis fold reflects its moving pieces. Compare orientation
        // with the immediate parent, not the sheet's front side, and resolve
        // split faces back to their parent face. A crossed parent face has
        // both a moving and a stationary child, so the moving parent IDs alone
        // cannot distinguish these attachments.
        let moving: Option<Vec<bool>> = landed
            .faces()
            .iter()
            .map(|face| {
                let before = self
                    .parent
                    .front_up(face.id)
                    .or_else(|| face.parent.and_then(|id| self.parent.front_up(id)))?;
                Some(landed.front_up(face.id)? != before)
            })
            .collect();
        let Some(moving) = moving else {
            return false;
        };
        let on_top = self.parent.view().model_direction(self.op.direction) == Direction::Valley;
        landed.creases().iter().enumerate().all(|(k, crease)| {
            if !matches!(crease.kind, CreaseKind::Folded(_)) {
                return true;
            }
            let [a, b] = landed.topology().crease_faces[k][..] else {
                return false;
            };
            moving[a] == moving[b]
                || landed.above(landed.faces()[a].id, landed.faces()[b].id)
                    == Some(moving[a] == on_top)
        })
    }

    /// Next subset, by cardinality and then lexicographically. No power set is
    /// allocated. The bridge admits a primary target plus at most 64 others.
    fn next_targets(&mut self) -> Option<Vec<[f64; 2]>> {
        let indices = self.combination.as_mut()?;
        let targets = indices.iter().map(|&i| self.pool[i]).collect();
        let n = self.pool.len();
        let k = indices.len();
        if let Some(i) = (0..k).rev().find(|&i| indices[i] < n - k + i) {
            indices[i] += 1;
            for j in i + 1..k {
                indices[j] = indices[j - 1] + 1;
            }
        } else if k < n.min(65) {
            self.combination = Some((0..k + 1).collect());
        } else {
            self.combination = None;
        }
        Some(targets)
    }

    /// Each attempt reserves a share of the batch's node budget; failed trials
    /// cannot trigger unmetered diagnostic searches. The common deadline also
    /// bounds preparation/propagation between calls. Truncation remains pending.
    pub fn advance(&mut self, limits: &CompletionLimits, attempts: usize, results: usize) {
        if self.finished() {
            return;
        }
        let attempts = attempts.max(1);
        let quota = limits
            .max_nodes
            .unwrap_or(CompletionLimits::DEFAULT_MAX_NODES)
            / attempts as u64;
        if quota == 0 {
            return;
        }
        let trial = CompletionLimits {
            max_nodes: Some(quota),
            ..*limits
        };
        // Retry each previously limited target at most once in this batch.
        let mut retry = std::mem::take(&mut self.retry);
        let mut left = results;
        for _ in 0..attempts {
            self.drain(limits, &mut left);
            if limits.out_of_time() || left == 0 || self.all_landed() {
                break;
            }
            let Some(targets) = retry.pop_front().or_else(|| self.next_targets()) else {
                break;
            };
            match self.parent.search_tuck_within(&self.tuck(&targets), &trial) {
                Ok(TuckOutcome::Landed(folded)) => {
                    self.insert(FoldPlacement {
                        landing: FoldLanding::Against { targets },
                        moving: folded.report.fold.moving,
                        completion: folded.report.stored.order,
                        state: folded.state,
                    });
                    left = left.saturating_sub(1);
                }
                Ok(TuckOutcome::ChooseOrder(choice)) => self.pending.push_back(Pending {
                    targets,
                    choice,
                    next: 0,
                }),
                Err(CompoundRefused::Refused(Refused {
                    refusal: FoldRefusal::BudgetExceeded { .. },
                    ..
                })) => self.retry.push_back(targets),
                Err(_) => {}
            }
        }
        self.retry.extend(retry);
        self.drain(limits, &mut left);
    }

    fn drain(&mut self, limits: &CompletionLimits, left: &mut usize) {
        while *left > 0 && !limits.out_of_time() && !self.all_landed() {
            let Some(mut pending) = self.pending.pop_front() else {
                break;
            };
            let count = pending.choice.count();
            let mut ordinal = pending.next;
            let mut indices = vec![0; pending.choice.completions().components().len()];
            for (i, component) in pending
                .choice
                .completions()
                .components()
                .iter()
                .enumerate()
                .rev()
            {
                let size = component.orders.len() as u64;
                if size > 0 {
                    indices[i] = (ordinal % size) as usize;
                    ordinal /= size;
                }
            }
            if pending.next < count.orders {
                if let Ok(folded) = pending.choice.pick(&indices) {
                    self.insert(FoldPlacement {
                        landing: FoldLanding::Against {
                            targets: pending.targets.clone(),
                        },
                        completion: folded.report.stored.order,
                        moving: folded.report.fold.moving,
                        state: folded.state,
                    });
                }
                pending.next += 1;
                *left -= 1;
            }
            if pending.next < count.orders {
                self.pending.push_front(pending);
            } else if !count.exact {
                self.retry.push_back(pending.targets);
            }
        }
    }
}

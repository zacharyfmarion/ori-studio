//! Compound folds through one pipeline (plan D4, research §5.1).
//!
//! Every compound fold — the reverse folds, the crimp and the tuck, the
//! vertex folds (squash, petal, rabbit ear, swivel), and the sinks and the
//! unsink — compiles to its macro and lands through the same steps:
//!
//! 1. **Macro.** The operation's inputs become scores, a partition of the
//!    faces that move into *blocks* (faces whose mutual stacking moves as
//!    one stack), each block's motion, and seeds.
//! 2. **Score** the faces the creases cross, through the one split every
//!    fold shares (`fold::score`): one new vertex per crossed crease, the
//!    line snapped and every vertex classified first (`fold::line`). A
//!    reverse fold scores one line (`Macro`, [`prepare`]); a crimp two, the
//!    second over the first's pieces (`crimp`); a squash one line
//!    per layer (`pieces::score_cuts`); a rabbit ear or a swivel a fan of
//!    rays from a point inside the paper ([`fan`]), a swivel on a folded
//!    edge a line per crease through the layers it runs through
//!    ([`swivel_on_edge`]); a petal fold nothing
//!    over precreases, or its kite creases and H where they are missing
//!    (`pieces::score_cuts`, [`petal`]).
//!    From here on the steps are one implementation for all of them
//!    (`pieces::prepare_pieces`).
//! 3. **Hinge diff.** A crease folds where its two faces' new orientations
//!    differ and lies flat where they agree. That is the fold, unfold or
//!    toggle the declared motions imply, so a macro never lists hinges beside
//!    its motions and the two cannot disagree (a fan of rays does not say
//!    which hinges change; research §5.1). A new crease that would lie flat
//!    is refused.
//! 4. **Derive** the isometries from the stayer, the parent root's piece
//!    that stays, keeping its isometry.
//! 5. **Gate**: the residual and hinge consistency (`Unordered`), every face
//!    where its block's motion puts it, and the image–image guard (research
//!    §6) on every pair whose relative motion changed.
//! 6. **Carry** only the pairs whose faces both stay or are in one block:
//!    kept under a rotation, reversed under a reflection. Never because two
//!    isometries happen to be equal: every block of a reverse fold moves by
//!    the same reflection, yet the blocks keep their absolute order (§5.2).
//! 7. **Seed** the macro's placements (a block against named faces: its own
//!    body for a reverse fold, everything that stays for a vertex fold's
//!    direction seed) and the pairs across blocks, by the macro's rule
//!    (`Across`).
//! 8. **Complete** the rest (`crate::complete`), searching only around the
//!    faces that moved.
//! 9. **Letters** from the order, and **validate** through `State::make`.
//!
//! Zero completions is a refusal that names the conflicting faces; exactly
//! one is the result; more than one is a choice, whose result is stored as
//! the pairs it decided, keyed by witnesses (plan D6), and replayed.

pub mod crimp;
pub mod motion;
pub mod reverse;
pub mod reverse_step;
pub mod sink;
pub mod sink_step;
pub mod tuck;

// The vertex folds (research §5.3): blocks are motion classes, seeded by a
// direction (`vertex`), the rabbit ear's and the swivel's scored as a fan
// (`fan`). `pieces` is the pipeline's steps 3–7 for any scoring, which
// `prepare` shares.
pub mod fan;
mod fan_precreased;
mod folded_swivel;
pub mod petal;
pub(crate) mod pieces;
pub mod rabbit;
pub mod squash;
pub mod swivel;
pub mod swivel_on_edge;
pub mod swivel_valley_mountain;
pub mod vertex;

use std::collections::HashSet;

use oristudio_layer_order::{LayerOrder, Violation};
use serde::Serialize;
use thiserror::Error;

use crate::complete::{CompletionLimits, CompletionRefusal, Completions, FixedKind, FixedPair};
use crate::fold::Refold;
use crate::fold::line::Classified;
use crate::fold::score::{self, Piece};
use crate::isometry::Isometry;
use crate::pattern::{CreaseKind, EdgeId, FaceId, Letter};
use crate::refusal::{FoldRefusal, Refused};
use crate::state::{State, StateParts};
use crate::unordered::Unordered;
use crate::witness::{Broken, WitnessOrder};

use pieces::{Pieces, Scoring, prepare_pieces};

/// How the pairs of two faces in different blocks are ordered (step 7).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Across {
    /// As they were, in absolute terms: reverse folds and tucks (research
    /// §5.2, `crossBlock: "keep"`). Seeds, since the blocks' creases between
    /// them change.
    Keep,
    /// As they were between blocks that move alike; left to the seeds and
    /// the completion between blocks that move differently. A crimp's strip
    /// and tip: as two reverse folds, the second places the tip only against
    /// its own strip, and orders nothing else of the tip against the strip
    /// afresh.
    Alike,
    /// Corresponding halves of nested openings turn as one packet. Only
    /// these explicit block pairs carry their order through the motion;
    /// other pairs keep their absolute order (or, for a crimp, do so only
    /// within the strip or tip). Pocket placements remain per opening.
    Packets {
        coupled: Vec<[usize; 2]>,
        alike_only: bool,
    },
    /// Left to the completion: the vertex folds, whose blocks land in
    /// different places (research §5.3), seeded only against what stays; and
    /// an unsink, whose order back is the completion's alone (research
    /// §5.4).
    Free,
}

impl Across {
    pub(super) fn packets(coupled: Vec<[usize; 2]>, alike_only: bool) -> Self {
        if coupled.is_empty() {
            if alike_only { Self::Alike } else { Self::Keep }
        } else {
            Self::Packets {
                coupled,
                alike_only,
            }
        }
    }
}

/// A block placed against the pieces of some parent faces that stay: above
/// or below each one it overlaps once landed (step 7).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Against {
    pub(crate) block: usize,
    /// Parent face positions; a face the score splits stands for its piece
    /// that stays.
    pub(crate) faces: Vec<usize>,
    pub(crate) above: bool,
}

/// A compound fold compiled (step 1).
#[derive(Debug, Clone)]
pub(crate) struct Macro {
    /// The score line, snapped, with every vertex classified: the blocks'
    /// pieces are on its positive side.
    pub(crate) line: Classified,
    /// Per parent face position, the block its piece on the line's positive
    /// side moves with (the whole face, when it has nothing on the negative
    /// side); none for a face that stays.
    pub(crate) block_of: Vec<Option<usize>>,
    /// Each block's motion in the parent's model frame: a face's isometry
    /// becomes `motion ∘ T`.
    pub(crate) blocks: Vec<Isometry>,
    pub(crate) against: Vec<Against>,
    pub(crate) across: Across,
}

/// What a compound fold did, beside the state it landed.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CompoundReport {
    /// The parent's faces that move, in id order.
    pub moving: Vec<FaceId>,
    /// Per block, the landed state's faces in it, in id order.
    pub blocks: Vec<Vec<FaceId>>,
    /// The creases the score made.
    pub created: Vec<EdgeId>,
    /// Folded creases that lie flat now.
    pub unfolded: Vec<EdgeId>,
    /// Flat creases that fold again.
    pub refolded: Vec<Refold>,
    /// Folded creases whose letter turned, M↔V: a reverse fold's spine.
    pub reversed: Vec<EdgeId>,
    /// How many faces the score split.
    pub split: usize,
}

/// A landed compound fold.
#[derive(Debug, Clone)]
pub struct CompoundFolded {
    pub state: State,
    pub report: CompoundReport,
}

/// Why a compound fold did not land.
#[derive(Debug, Clone, PartialEq, Serialize, Error)]
#[serde(rename_all = "snake_case", tag = "stage")]
pub enum CompoundRefused {
    /// The fold cannot land as asked: a refusal with the fixes that would
    /// (plan D14).
    #[error("{0}")]
    Refused(Refused),
    /// A stored choice no longer resolves (plan D6): the step, and its
    /// subtree, are broken.
    #[error("{0}")]
    Broken(Broken),
}

/// A compound fold with everything but its order decided (steps 2–7).
#[derive(Debug, Clone)]
pub(crate) struct Prepared {
    unordered: Unordered,
    fixed: Vec<FixedPair>,
    /// Where `fixed`'s placements start: every pair from there on puts a
    /// block against paper it lands on, the rest are carried or across.
    placed: usize,
    /// Per landed face position, its block; none for a face that stays.
    block_of: Vec<Option<usize>>,
    blocks: usize,
    moving: Vec<FaceId>,
    created: Vec<EdgeId>,
    unfolded: Vec<EdgeId>,
    /// Flat creases folding again: their position and remembered letter.
    refolds: Vec<(usize, Letter)>,
    /// Folded creases whose letter the order decides again: their position
    /// and the letter they had.
    relettered: Vec<(usize, Letter)>,
    split: usize,
}

/// Steps 2–7 of `m` on `state`, as its next step: the score along its one
/// line (a block face the line crosses keeps its positive piece in the
/// block; the rest of it stays), then the steps every scoring shares
/// ([`pieces`]).
pub(crate) fn prepare(state: &State, m: &Macro) -> Result<Prepared, FoldRefusal> {
    let parts = state.parts();
    let classes = &m.line.classes;
    let nf = parts.faces.len();
    let has = |f: usize, class: i8| {
        parts.faces[f]
            .ring
            .iter()
            .any(|v| classes[v.index()] == class)
    };
    if let Some(f) = (0..nf).find(|&f| m.block_of[f].is_some() && !has(f, 1)) {
        return Err(FoldRefusal::DegenerateSplit {
            face: parts.faces[f].id,
        });
    }
    let split: Vec<bool> = (0..nf)
        .map(|f| m.block_of[f].is_some() && has(f, -1))
        .collect();
    let scored = score::score(
        parts,
        state.topology(),
        classes,
        &m.line.distances,
        &split,
        state.step() + 1,
        state.next_ids(),
    )?;
    let block_of: Vec<Option<usize>> = scored
        .faces
        .iter()
        .map(|s| match s.piece {
            Piece::Negative => None,
            Piece::Whole | Piece::Positive => m.block_of[s.old],
        })
        .collect();
    prepare_pieces(
        state,
        Pieces {
            scoring: Scoring::of(scored),
            block_of,
            blocks: m.blocks.clone(),
            against: m.against.clone(),
            across: m.across.clone(),
        },
    )
}

impl Prepared {
    /// Every order the carried pairs and the seeds allow, with `extra` fixed
    /// beside them (step 8).
    pub(crate) fn complete(
        &self,
        extra: &[FixedPair],
        limits: &CompletionLimits,
    ) -> Result<Completions, CompletionRefusal> {
        if extra.is_empty() {
            return self.unordered.complete(&self.fixed, limits);
        }
        let mut all = self.fixed.clone();
        all.extend_from_slice(extra);
        self.unordered.complete(&all, limits)
    }

    /// The fold with one order (step 9): letters derived, the gate passed.
    pub(crate) fn land(&self, order: LayerOrder) -> Result<CompoundFolded, FoldRefusal> {
        let state = self.unordered.state(order)?;
        Ok(self.folded(state))
    }

    /// Replay a stored choice (plan D6): its pairs fixed beside the seeds,
    /// exactly one order, or broken.
    pub(crate) fn replay(
        &self,
        stored: &WitnessOrder,
        limits: &CompletionLimits,
    ) -> Result<CompoundFolded, Broken> {
        let state = self.unordered.replay(stored, &self.fixed, limits)?;
        Ok(self.folded(state))
    }

    /// A choice's pairs, keyed by the landed faces' witnesses: what the step
    /// stores.
    pub(crate) fn stored(&self, pairs: &[[FaceId; 2]]) -> Option<WitnessOrder> {
        self.unordered.witness_order(pairs)
    }

    /// The landed parts, checked up to their order: what a macro reads to
    /// place its blocks by the landed geometry.
    pub(crate) fn unordered(&self) -> &Unordered {
        &self.unordered
    }

    /// Per landed face position, its block; none for a face that stays.
    pub(crate) fn blocks_of(&self) -> &[Option<usize>] {
        &self.block_of
    }

    /// Placements a macro decides from the landed geometry, beside the ones
    /// its `against` gives — a crimp's tip against its own strip, a tuck's
    /// block around its target: seeds in every completion and replay, turned
    /// with the rest by [`Prepared::lands_flipped`]. A pair of faces that do
    /// not overlap is left out.
    pub(crate) fn place(&mut self, pairs: impl IntoIterator<Item = [FaceId; 2]>) {
        let placed = self.seeds(pairs);
        self.fixed.extend(placed);
    }

    /// Whether the same fold placed another way — `pairs` in place of every
    /// placement it has, such as a tuck against another target — has an
    /// order; none when the budget ran out first.
    pub(crate) fn lands_placed(
        &self,
        pairs: impl IntoIterator<Item = [FaceId; 2]>,
        limits: &CompletionLimits,
    ) -> Option<bool> {
        let mut fixed = self.fixed[..self.placed].to_vec();
        fixed.extend(self.seeds(pairs));
        match self.unordered.complete(&fixed, &first(limits)) {
            Ok(_) => Some(true),
            Err(CompletionRefusal::BudgetExceeded { .. }) => None,
            Err(_) => Some(false),
        }
    }

    /// Pairs `[upper, lower]` as seeds, leaving out faces that do not
    /// overlap.
    fn seeds(&self, pairs: impl IntoIterator<Item = [FaceId; 2]>) -> Vec<FixedPair> {
        let problem = self.unordered.problem();
        pairs
            .into_iter()
            .filter(|&[upper, lower]| problem.is_variable(upper, lower))
            .map(|[upper, lower]| FixedPair {
                upper,
                lower,
                kind: FixedKind::Seed,
            })
            .collect()
    }

    /// Whether some order fits: a search that stops at the first order of
    /// each component.
    pub(crate) fn lands(&self, limits: &CompletionLimits) -> bool {
        self.unordered.complete(&self.fixed, &first(limits)).is_ok()
    }

    /// [`Prepared::lands`] for the same fold with every placement the other
    /// way round: the other kind of a reverse fold or a crimp, on the
    /// geometry already landed rather than scored and gated again, since
    /// neither its carry nor its pairs across blocks depend on the kind.
    pub(crate) fn lands_flipped(&self, limits: &CompletionLimits) -> bool {
        let mut fixed = self.fixed.clone();
        for pair in &mut fixed[self.placed..] {
            std::mem::swap(&mut pair.upper, &mut pair.lower);
        }
        self.unordered.complete(&fixed, &first(limits)).is_ok()
    }

    /// The landed state's faces in block `b`, in id order.
    fn block_faces(&self, b: usize) -> Vec<FaceId> {
        self.unordered
            .parts()
            .faces
            .iter()
            .zip(&self.block_of)
            .filter(|(_, block)| **block == Some(b))
            .map(|(f, _)| f.id)
            .collect()
    }

    fn folded(&self, state: State) -> CompoundFolded {
        let creases = state.creases();
        let letter = |k: usize| match creases.get(k).map(|c| c.kind) {
            Some(CreaseKind::Folded(letter)) => Some(letter),
            _ => None,
        };
        let refolded = self
            .refolds
            .iter()
            .filter_map(|&(k, remembered)| {
                Some(Refold {
                    edge: creases.get(k)?.id,
                    remembered,
                    letter: letter(k)?,
                })
            })
            .collect();
        let mut reversed: Vec<EdgeId> = self
            .relettered
            .iter()
            .filter(|&&(k, before)| letter(k).is_some_and(|now| now != before))
            .filter_map(|&(k, _)| creases.get(k).map(|c| c.id))
            .collect();
        reversed.sort_unstable();
        let report = CompoundReport {
            moving: self.moving.clone(),
            blocks: (0..self.blocks).map(|b| self.block_faces(b)).collect(),
            created: self.created.clone(),
            unfolded: self.unfolded.clone(),
            refolded,
            reversed,
            split: self.split,
        };
        CompoundFolded { state, report }
    }
}

/// A moving face placed directly against the nearest of some faces that
/// stay, on one side of it (step 7). Nothing lies between them, so every
/// other face that stays and overlaps both lies on the same side of the
/// moving face as of that one. A sink anchors each tip face this way: one
/// anchor per block leaves pairs open (research §5.4, 16 on the preliminary
/// base).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Anchor {
    /// Landed positions: the moving face, and the faces that stay it may
    /// lie against. It lies against the nearest of those it overlaps (the
    /// highest when it lies above them, the lowest when below), and the
    /// several nearest where they do not overlap one another.
    pub(crate) face: usize,
    pub(crate) to: Vec<usize>,
    pub(crate) above: bool,
}

impl Prepared {
    /// The landed parts (faces and creases in id order) and, per landed
    /// face position, its block: what an operation reads to anchor faces.
    pub(crate) fn landed(&self) -> (&StateParts, &[Option<usize>]) {
        (self.unordered.parts(), &self.block_of)
    }

    /// Seed `anchors` beside the macro's seeds (see [`Anchor`]). The order of
    /// the faces that stay is the carried one: exactly their pairs that
    /// overlap once landed.
    pub(crate) fn anchor(&mut self, anchors: &[Anchor]) {
        let ids: Vec<FaceId> = self.unordered.parts().faces.iter().map(|f| f.id).collect();
        let problem = self.unordered.problem();
        let stays = |a: usize| self.block_of.get(a).is_some_and(Option::is_none);
        let carried: HashSet<(FaceId, FaceId)> = self
            .fixed
            .iter()
            .filter(|p| p.kind == FixedKind::Carried)
            .map(|p| (p.upper, p.lower))
            .collect();
        // Whether `a` lies above `b`, both staying; none where they do not
        // overlap.
        let higher = |a: usize, b: usize| -> Option<bool> {
            if carried.contains(&(ids[a], ids[b])) {
                Some(true)
            } else if carried.contains(&(ids[b], ids[a])) {
                Some(false)
            } else {
                None
            }
        };
        let mut known: HashSet<(FaceId, FaceId)> =
            self.fixed.iter().map(|p| (p.upper, p.lower)).collect();
        let mut seeds = Vec::new();
        let mut push = |upper: FaceId, lower: FaceId| {
            if known.insert((upper, lower)) {
                seeds.push(FixedPair {
                    upper,
                    lower,
                    kind: FixedKind::Seed,
                });
            }
        };
        for anchor in anchors {
            let t = ids[anchor.face];
            let near: Vec<usize> = anchor
                .to
                .iter()
                .copied()
                .filter(|&s| stays(s) && problem.is_variable(t, ids[s]))
                .collect();
            // Not one with another candidate between it and the moving face.
            let nearest = near.iter().copied().filter(|&s| {
                !near
                    .iter()
                    .any(|&o| o != s && higher(o, s) == Some(anchor.above))
            });
            for s in nearest {
                if anchor.above {
                    push(t, ids[s]);
                } else {
                    push(ids[s], t);
                }
                // Nothing lies between the two, so what lies above the face
                // it lies against lies above it, and what lies below, below.
                for x in (0..ids.len()).filter(|&x| x != s && stays(x)) {
                    if !problem.is_variable(t, ids[x]) {
                        continue;
                    }
                    match higher(s, x) {
                        Some(true) => push(t, ids[x]),
                        Some(false) => push(ids[x], t),
                        None => {}
                    }
                }
            }
        }
        self.fixed.extend(seeds);
    }
}

/// A compound fold whose completion left more than one order (plan D4): the
/// orders to choose from, and the landing of each.
#[derive(Debug, Clone)]
pub(crate) struct Pending {
    pub(crate) prepared: Prepared,
    pub(crate) completions: Completions,
}

impl Pending {
    /// Land the order `choice` names (one listed order per component) and
    /// what the step stores for it: the pairs it decided beyond the forced
    /// ones, keyed by witnesses.
    pub(crate) fn pick(
        &self,
        choice: &[usize],
    ) -> Result<(CompoundFolded, WitnessOrder), FoldRefusal> {
        let no_such = || FoldRefusal::NoSuchChoice {
            choice: choice.to_vec(),
        };
        let order = self.completions.order(choice).ok_or_else(no_such)?;
        let pairs = self.completions.chosen_pairs(choice).ok_or_else(no_such)?;
        let stored = self
            .prepared
            .stored(&pairs)
            .ok_or_else(|| FoldRefusal::Internal {
                message: "a chosen pair names a face with no witness".to_string(),
            })?;
        Ok((self.prepared.land(order)?, stored))
    }
}

/// `limits` for a search that stops at the first order of each component:
/// whether a fold lands, not how.
pub(crate) fn first(limits: &CompletionLimits) -> CompletionLimits {
    CompletionLimits {
        per_component: 1,
        ..*limits
    }
}

/// A completion's refusal as a fold's: no order names the faces it traces
/// to; the rest are the budget or a defect.
pub(crate) fn no_order(refusal: CompletionRefusal) -> FoldRefusal {
    match refusal {
        CompletionRefusal::BudgetExceeded { limit, nodes } => {
            FoldRefusal::BudgetExceeded { limit, nodes }
        }
        CompletionRefusal::AmbiguousOverlap { ambiguities } => FoldRefusal::LayerOrder {
            violations: ambiguities
                .into_iter()
                .map(|ambiguity| Violation::AmbiguousOverlap { ambiguity })
                .collect(),
        },
        CompletionRefusal::FixedContradictory { pair } => FoldRefusal::NoOrder {
            faces: pair.faces().to_vec(),
        },
        CompletionRefusal::InvalidProblem { message } => FoldRefusal::Internal { message },
        refusal => FoldRefusal::NoOrder {
            faces: refusal.faces(),
        },
    }
}

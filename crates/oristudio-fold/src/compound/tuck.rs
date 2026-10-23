//! The tuck (plan Phase 11, research §4.4 and §5.2): a plain fold slid
//! immediately under, or over, a named layer T, through the compound
//! pipeline ([`super`]).
//!
//! - **The direction names the placement.** As the viewer sees it, a valley
//!   tuck goes under its target and a mountain tuck over it: the flap turns
//!   toward T's side of the stack and stops against T.
//! - **What moves** is Beloch's bounded closure (ADR 0052): the seed, grown
//!   across every crease with an end on the moving side, and every
//!   moving-side layer the block would otherwise pass through on its way to
//!   T — for a valley tuck a layer above a moving piece that lies under every
//!   face of T it meets (or meets none), for a mountain tuck the mirror. The
//!   spike's hinges-only closure leaves such a layer inside the taco (its
//!   case 4d). T itself never moves: a seed or a crease that would take it
//!   is refused.
//! - **T is a layer.** The faces joined to T across unfolded creases, the
//!   cross-section's display layer, are T too: they stay, and bound the
//!   closure as T does. A precrease splits one layer into faces, and a piece
//!   of T's layer that meets no face of T is no layer between the block and
//!   T. The layer never reaches through the seed's flaps, whose crease with
//!   T is the fold itself.
//! - **The order** reads "immediately under T" strictly (the spike's H1):
//!   pairs that stay are kept and the block turns over as one; the block lies
//!   under T; a layer G that meets T lies beyond T where it is under every
//!   face of T it meets, and the block then lies over G, and on T's side
//!   otherwise, the block under G (a mountain tuck, the mirror). A layer that
//!   meets no face of T is the completion's. Read loosely — the block against
//!   T alone — the order is not unique in 26% of the spike's feasible tucks;
//!   read strictly, it is in 99.1%.
//! - **The targets.** Only 40% of the layers a plain fold lands on take a
//!   tuck (research §5.2), so the engine lists them rather than let any be
//!   picked: [`State::analyse_tuck`] gives every layer the block lands on,
//!   each with whether it takes the tuck.
//!
//! A tuck may name several stationary targets. Closure is bounded by all of
//! them, adjacency still cannot take any target, and the reflected block must
//! overlap each one. Their strict placement constraints are intersected before
//! completion and the normal admission gate. This represents, for example, a
//! central flap lowered beneath two separate side pockets; it cannot freeze
//! arbitrary connected paper or bypass an infeasible layer order. Old one-target
//! steps use exactly the same closure and constraints as before.
//!
//! The plain fold's own [`crate::Placement::Over`] and
//! [`crate::Placement::Under`] stay what they were: a closed-form placement
//! accepted only if the gate passes it (research §4.4).

use std::collections::VecDeque;

use oristudio_geometry::{Line, convex};
use oristudio_layer_order::{EdgeKind, FacePair, Violation};
use serde::{Deserialize, Serialize};

use crate::complete::{ChoiceCount, CompletionLimits, Completions};
use crate::compound::motion::{MotionKind, StepMotion};
use crate::compound::{
    Across, CompoundFolded, CompoundRefused, CompoundReport, Macro, Pending, Prepared, no_order,
    prepare,
};
use crate::fold::closure::{MovingSide, moving_side, resolve_seed};
use crate::fold::line::{self, Axis, Classified};
use crate::fold::section::flat_components_within;
use crate::fold::{
    ActionKind, FoldActionGeometry, FoldAnalysis, PlainFold, ResolvedSeed, Seed, Snap,
};
use crate::index::BoxIndex;
use crate::numerics::TOL;
use crate::pattern::FaceId;
use crate::refusal::{Fix, FoldRefusal, Refused, Side};
use crate::state::State;
use crate::view::Direction;
use crate::witness::WitnessOrder;

type Point = [f64; 2];

/// The selected material-connected flaps, before placement-dependent overlap
/// closure, and the stationary layers they can land against.
pub(crate) struct PlacementScope {
    pub moving: Vec<FaceId>,
    pub targets: Vec<Point>,
    /// Every order those flaps can land in, outer or inserted (see
    /// `State::placement_scope`); none when it was not counted exactly.
    pub orders: Option<Completions>,
}

/// What counting a selection's landings may spend. Nodes only, never a
/// clock, so every machine counts the same; a fold that needs no search
/// (every pair forced, as when a flat sheet folds in half) uses none. The
/// count only ends a search that has found every landing, so a fold with
/// more than a chooser could step through is not worth counting.
const LANDINGS_LIMITS: CompletionLimits = CompletionLimits {
    per_component: 64,
    max_nodes: Some(4_096),
    deadline: None,
};

/// The most other targets a refusal tries, and offers, as its fixes.
const MAX_FIX_TARGETS_TRIED: usize = 8;
const MAX_FIX_TARGETS: usize = 3;

/// Which side of its target a tuck's block lands on, in the model frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TuckSide {
    Under,
    Over,
}

/// A tuck, named the way a step stores it (plan D6).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TuckFold {
    /// ℓ, in the parent's model frame.
    pub line: Line,
    /// The side of ℓ that moves.
    pub side: Side,
    /// As the viewer sees it: a valley tuck goes under its target, a
    /// mountain tuck over it.
    pub direction: Direction,
    /// What moves with the moving side, as a plain fold's seed.
    pub seed: Seed,
    /// A sheet point inside T, the layer the block lands against.
    pub target: Point,
    /// Other stationary layers the same block must land against. Every target
    /// bounds closure and receives the same strict placement constraints.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub additional_targets: Vec<Point>,
}

/// A layer a tuck's block lands on.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TuckTarget {
    pub face: FaceId,
    /// An interior sheet point of it: what a step stores to name it.
    pub at: Point,
    /// Whether the block can lie immediately under (or over) it; none when
    /// the completion's budget ran out before it was decided.
    pub feasible: Option<bool>,
}

/// What a tuck moves and which layers it can be tucked against, before it
/// lands.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TuckAnalysis {
    /// The line folded along, after snapping, and its moving side.
    pub line: Line,
    pub side: Side,
    pub snap: Snap,
    /// The direction and the placement in the model frame.
    pub direction: Direction,
    pub placement: TuckSide,
    /// The parent's faces that move with a target the block does not reach
    /// into (most targets'), in id order.
    pub moving: Vec<FaceId>,
    /// Every layer the block lands on that stays, in id order.
    pub targets: Vec<TuckTarget>,
}

/// A tuck's choices as a step stores them (plan D6).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct TuckChoices {
    /// The pairs the completion left free, as they were chosen.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<WitnessOrder>,
}

/// What a tuck did.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TuckReport {
    pub line: Line,
    pub side: Side,
    pub snap: Snap,
    /// The direction and the placement in the model frame.
    pub direction: Direction,
    pub placement: TuckSide,
    /// T, which stays (and keeps its id).
    pub target: FaceId,
    #[serde(flatten)]
    pub fold: CompoundReport,
    /// The animation's legs (plan D15): the block turning about ℓ.
    pub motion: StepMotion,
    /// What the step stores: the order chosen among several.
    pub stored: TuckChoices,
}

/// A landed tuck.
#[derive(Debug, Clone)]
pub struct TuckFolded {
    pub state: State,
    pub report: TuckReport,
}

/// A tuck whose completion left more than one order (plan D4).
#[derive(Debug, Clone)]
pub struct TuckChoice {
    pending: Pending,
    context: Context,
}

impl TuckChoice {
    /// Every order there is to choose from, per independent component.
    pub fn completions(&self) -> &Completions {
        &self.pending.completions
    }

    /// The true ‹ n of m ›.
    pub fn count(&self) -> ChoiceCount {
        self.pending.completions.count()
    }

    /// Land the order `choice` names (one listed order per component); the
    /// report's `stored` holds what the step stores for it.
    pub fn pick(&self, choice: &[usize]) -> Result<TuckFolded, FoldRefusal> {
        let (folded, order) = self.pending.pick(choice)?;
        Ok(self.context.report(folded, Some(order)))
    }
}

/// Where a tuck got to.
#[derive(Debug, Clone)]
pub enum TuckOutcome {
    Landed(Box<TuckFolded>),
    /// More than one order fits: pick one.
    ChooseOrder(Box<TuckChoice>),
}

/// What turns a landed compound fold into a tuck's report.
#[derive(Debug, Clone)]
struct Context {
    line: Line,
    side: Side,
    snap: Snap,
    direction: Direction,
    placement: TuckSide,
    target: FaceId,
}

impl Context {
    fn report(&self, folded: CompoundFolded, order: Option<WitnessOrder>) -> TuckFolded {
        let groups: Vec<(Vec<FaceId>, bool)> = folded
            .report
            .blocks
            .iter()
            .map(|faces| (faces.clone(), self.direction == Direction::Valley))
            .collect();
        let motion = StepMotion::half_turns(self.line, self.side, &groups, MotionKind::Visual);
        TuckFolded {
            state: folded.state,
            report: TuckReport {
                line: self.line,
                side: self.side,
                snap: self.snap,
                direction: self.direction,
                placement: self.placement,
                target: self.target,
                fold: folded.report,
                motion,
                stored: TuckChoices { order },
            },
        }
    }
}

/// A tuck's line, moving side and seed on a state, before its target.
struct Tuck {
    classified: Classified,
    side: MovingSide,
    /// In the model frame.
    direction: Direction,
    /// Seed face positions.
    seed: Vec<usize>,
    /// Per face position, its moving piece's box (an empty box for none).
    boxes: Vec<[f64; 4]>,
    index: BoxIndex,
    /// Per face position, its display layer (the cross-section's rows),
    /// never joined through the seed's flaps: a target's layer is the paper
    /// that stays with it.
    layer: Vec<usize>,
}

impl Tuck {
    fn placement(&self) -> TuckSide {
        match self.direction {
            Direction::Valley => TuckSide::Under,
            Direction::Mountain => TuckSide::Over,
        }
    }

    fn under(&self) -> bool {
        self.placement() == TuckSide::Under
    }

    fn line(&self) -> Line {
        self.classified.axis.line_and_side().0
    }

    fn side(&self) -> Side {
        self.classified.axis.line_and_side().1
    }

    /// The faces that move for a tuck against the faces at positions
    /// `targets` (or against no face yet, for the targets' listing), per face
    /// position (see the module docs). Refused when everything would move, or
    /// a target's layer would.
    fn closure(&self, state: &State, targets: &[usize]) -> Result<Vec<bool>, Refused> {
        let faces = state.faces();
        // Each target with its whole flat layer: a layer is between the
        // block and T only where it lies short of every face of that layer
        // it meets, and none of the layer moves.
        let targets: Vec<usize> = (0..faces.len())
            .filter(|&f| targets.iter().any(|&t| self.layer[t] == self.layer[f]))
            .collect();
        let targets = &targets[..];
        let target_moves =
            |f: usize| -> Refused { FoldRefusal::TuckTargetMoves { face: faces[f].id }.into() };
        let under = self.under();
        // Whether a moving-side layer lies on the near side of every face of
        // T it meets: under T for a valley tuck, over it for a mountain one.
        let short_of_target = |c: usize| {
            targets.iter().all(|&t| {
                self.side.pieces[c].as_ref().is_none_or(|piece| {
                    convex::penetration(piece, &state.geometry().images[t]) <= TOL
                        || state.above(faces[c].id, faces[t].id) == Some(!under)
                })
            })
        };
        let mut moving = vec![false; faces.len()];
        let mut queue = VecDeque::new();
        for &f in &self.seed {
            if targets.contains(&f) {
                return Err(target_moves(f));
            }
            if !moving[f] {
                moving[f] = true;
                queue.push_back(f);
            }
        }
        while let Some(m) = queue.pop_front() {
            for &p in &self.side.adjacent[m] {
                if targets.contains(&p) {
                    return Err(target_moves(p));
                }
                if !moving[p] {
                    moving[p] = true;
                    queue.push_back(p);
                }
            }
            let Some(piece_m) = &self.side.pieces[m] else {
                continue;
            };
            for c in self.index.query(&self.boxes[m], TOL) {
                if moving[c] || targets.contains(&c) {
                    continue;
                }
                let Some(piece_c) = &self.side.pieces[c] else {
                    continue;
                };
                if convex::penetration(piece_c, piece_m) <= TOL {
                    continue;
                }
                let Some(above) = state.above(faces[c].id, faces[m].id) else {
                    return Err(FoldRefusal::LayerOrder {
                        violations: FacePair::new(faces[c].id, faces[m].id)
                            .map(|pair| Violation::MissingPair { pair })
                            .into_iter()
                            .collect(),
                    }
                    .into());
                };
                // The block turns toward the layers above it for a valley:
                // those it would pass on its way to T come along.
                if above == under && short_of_target(c) {
                    moving[c] = true;
                    queue.push_back(c);
                }
            }
        }
        let stays = |f: usize| {
            state.faces()[f]
                .ring
                .iter()
                .any(|v| self.classified.classes[v.index()] == -1)
        };
        if (0..faces.len()).all(|f| moving[f] && !stays(f)) {
            let fixes = if self.side.flaps.len() > 1 {
                vec![Fix::PickFlap {
                    flaps: self.side.flaps.clone(),
                }]
            } else {
                Vec::new()
            };
            return Err(Refused {
                refusal: FoldRefusal::NothingStays,
                fixes,
            });
        }
        Ok(moving)
    }

    /// The compound fold of `moving`, through the pipeline's steps 2–7: one
    /// block reflected across ℓ, placed by [`placements`] afterwards.
    fn prepare(&self, state: &State, moving: &[bool]) -> Result<Prepared, FoldRefusal> {
        prepare(
            state,
            &Macro {
                line: self.classified.clone(),
                block_of: moving.iter().map(|&m| m.then_some(0)).collect(),
                blocks: vec![self.classified.axis.reflection()],
                against: Vec::new(),
                across: Across::Keep,
            },
        )
    }

    /// Every order the block `moving` can land in with each hinge folded in
    /// the tuck's direction, placed against nothing; none when it is not
    /// counted exactly within [`LANDINGS_LIMITS`] or has no order at all.
    /// A hinge is a crease between the block and paper that stays: valley,
    /// the block's face lies above the other, mountain below — the hinge
    /// test the placement search admits a landing by.
    fn landings(&self, state: &State, moving: &[bool]) -> Option<Completions> {
        let mut prepared = self.prepare(state, moving).ok()?;
        let on_top = self.direction == Direction::Valley;
        let (parts, blocks) = prepared.landed();
        let in_block = |id: FaceId| {
            parts
                .faces
                .binary_search_by_key(&id, |f| f.id)
                .ok()
                .map(|at| blocks[at].is_some())
        };
        let hinges: Vec<[FaceId; 2]> = prepared
            .unordered()
            .view()
            .edges()
            .iter()
            .filter(|edge| matches!(edge.kind, EdgeKind::Folded(_)))
            .filter_map(|edge| {
                let [f, g] = edge.faces;
                match (in_block(f)?, in_block(g)?) {
                    (true, false) => Some(if on_top { [f, g] } else { [g, f] }),
                    (false, true) => Some(if on_top { [g, f] } else { [f, g] }),
                    _ => None,
                }
            })
            .collect();
        prepared.place(hinges);
        let orders = prepared.complete(&[], &LANDINGS_LIMITS).ok()?;
        orders.count().exact.then_some(orders)
    }

    /// Whether the face at position `f` stays whole and the block, landed,
    /// lies over it somewhere: a layer it could be tucked against.
    fn lands_on(&self, state: &State, moving: &[bool], f: usize) -> bool {
        if moving[f] {
            return false;
        }
        let reflection = self.classified.axis.reflection();
        let image = &state.geometry().images[f];
        (0..moving.len()).filter(|&m| moving[m]).any(|m| {
            self.side.pieces[m].as_ref().is_some_and(|piece| {
                let landed: Vec<Point> = piece.iter().rev().map(|&p| reflection.apply(p)).collect();
                convex::penetration(&landed, image) > TOL
            })
        })
    }
}

/// The strict placements of a tuck against `target` (see the module docs),
/// each as `[upper, lower]` over the landed faces of `prepared`: the block
/// against T, and against every layer that meets T, by which side of T it
/// is on.
fn placements(state: &State, prepared: &Prepared, target: FaceId, under: bool) -> Vec<[FaceId; 2]> {
    let unordered = prepared.unordered();
    let landed = &unordered.parts().faces;
    let blocks = prepared.blocks_of();
    let problem = unordered.problem();
    let position = |id: FaceId| landed.binary_search_by_key(&id, |f| f.id).ok();
    // A stationary landed face is a parent face or the piece of one the
    // score split; either way it stands where that parent face stood.
    let parent_of = |at: usize| {
        let face = &landed[at];
        if state.face(face.id).is_some() {
            face.id
        } else {
            face.parent.unwrap_or(face.id)
        }
    };
    let mut out = Vec::new();
    for pair in problem.variables() {
        let (Some(a), Some(b)) = (position(pair.lo()), position(pair.hi())) else {
            continue;
        };
        let (block, other) = match (blocks[a], blocks[b]) {
            (Some(_), None) => (a, b),
            (None, Some(_)) => (b, a),
            _ => continue,
        };
        let g = landed[other].id;
        let beyond = if g == target {
            false
        } else if problem.is_variable(g, target) {
            match state.above(parent_of(other), target) {
                Some(above) => above != under,
                None => continue,
            }
        } else {
            continue;
        };
        // Under T: over a layer beyond T, under one on T's side and under T
        // itself; over T, the mirror.
        let block_above = beyond == under;
        let block = landed[block].id;
        out.push(if block_above { [block, g] } else { [g, block] });
    }
    out
}

impl State {
    /// What a tuck would move and every layer its block lands on, each with
    /// whether the block can lie immediately under (over) it, without
    /// folding. `op.target` is not read.
    ///
    /// Each target costs a completion, and each moving set a preparation, so
    /// `limits.deadline` is read before every one: the targets that move
    /// least are decided first, and those left when it passes are listed
    /// undecided.
    pub fn analyse_tuck(
        &self,
        op: &TuckFold,
        limits: &CompletionLimits,
    ) -> Result<TuckAnalysis, Refused> {
        let tuck = self.tuck(op)?;
        let open = tuck.closure(self, &[])?;
        let faces = self.faces();
        // A target with no paper on the moving side is not met by the
        // closure, so its moving set is the open one; a target that crosses
        // ℓ keeps the layers above it (below it) out, so it is grown its own.
        let mut sets: Vec<Vec<bool>> = vec![open.clone()];
        let mut listed: Vec<(usize, usize)> = Vec::new();
        for f in 0..faces.len() {
            let moving = if tuck.side.pieces[f].is_some() {
                match tuck.closure(self, &[f]) {
                    Ok(moving) => moving,
                    Err(_) => continue,
                }
            } else {
                open.clone()
            };
            if !tuck.lands_on(self, &moving, f) {
                continue;
            }
            let set = match sets.iter().position(|set| *set == moving) {
                Some(set) => set,
                None => {
                    sets.push(moving);
                    sets.len() - 1
                }
            };
            listed.push((f, set));
        }
        let under = tuck.under();
        // The closure brings every layer between the seed and T along, so a
        // target nearer the seed moves less: cheaper to decide, and likelier
        // to take the tuck. Each moving set's targets are decided together.
        let sizes: Vec<usize> = sets
            .iter()
            .map(|set| set.iter().filter(|&&m| m).count())
            .collect();
        listed.sort_by_key(|&(f, set)| (sizes[set], set, f));
        // One geometry per moving set, prepared when its first target is
        // decided and placed against each; none when it does not prepare.
        let mut prepared: Vec<Option<Option<Prepared>>> = (0..sets.len()).map(|_| None).collect();
        let mut targets = Vec::new();
        for (f, set) in listed {
            let id = faces[f].id;
            let feasible = if limits.out_of_time() {
                None
            } else {
                match prepared[set].get_or_insert_with(|| tuck.prepare(self, &sets[set]).ok()) {
                    Some(prepared) => {
                        prepared.lands_placed(placements(self, prepared, id, under), limits)
                    }
                    None => Some(false),
                }
            };
            if let Some(at) = self.face_witness(id) {
                targets.push(TuckTarget {
                    face: id,
                    at,
                    feasible,
                });
            }
        }
        targets.sort_by_key(|t| t.face);
        Ok(TuckAnalysis {
            line: tuck.line(),
            side: tuck.side(),
            snap: tuck.classified.snap,
            direction: tuck.direction,
            placement: tuck.placement(),
            moving: (0..open.len())
                .filter(|&f| open[f])
                .map(|f| self.faces()[f].id)
                .collect(),
            targets,
        })
    }

    /// A tuck, with its stored choices (empty for a new step), under the
    /// default completion limits.
    pub fn tuck_fold(
        &self,
        op: &TuckFold,
        choices: &TuckChoices,
    ) -> Result<TuckOutcome, CompoundRefused> {
        self.tuck_fold_within(op, choices, &CompletionLimits::default())
    }

    /// [`State::tuck_fold`] under `limits`. A tuck no order fits is refused
    /// naming T and the faces the conflict traces to, and one whose block
    /// lands nowhere on T naming none, each with the targets near it that
    /// take the tuck; a stored choice that no longer resolves is
    /// [`CompoundRefused::Broken`].
    pub fn tuck_fold_within(
        &self,
        op: &TuckFold,
        choices: &TuckChoices,
        limits: &CompletionLimits,
    ) -> Result<TuckOutcome, CompoundRefused> {
        self.tuck_with_diagnostics(op, choices, limits, true)
    }

    /// Search trials do not recursively search diagnostic alternatives.
    pub(crate) fn search_tuck_within(
        &self,
        op: &TuckFold,
        limits: &CompletionLimits,
    ) -> Result<TuckOutcome, CompoundRefused> {
        self.tuck_with_diagnostics(op, &TuckChoices::default(), limits, false)
    }

    fn tuck_with_diagnostics(
        &self,
        op: &TuckFold,
        choices: &TuckChoices,
        limits: &CompletionLimits,
        diagnose: bool,
    ) -> Result<TuckOutcome, CompoundRefused> {
        let refused = |r: Refused| CompoundRefused::Refused(r);
        let tuck = self.tuck(op).map_err(refused)?;
        let targets = self
            .tuck_target_positions(op)
            .map_err(|r| refused(r.into()))?;
        let target = targets[0];
        let target_id = self.faces()[target].id;
        let moving = tuck.closure(self, &targets).map_err(refused)?;
        for &target in &targets {
            if !tuck.lands_on(self, &moving, target) {
                let mut problem = if diagnose {
                    self.tuck_missed(&tuck, &moving, target, limits)
                } else {
                    FoldRefusal::TuckInfeasible {
                        target: target_id,
                        placement: tuck.placement(),
                        faces: Vec::new(),
                    }
                    .into()
                };
                // Single-target alternatives do not establish that every retained
                // target can still take the tuck. Never offer an unverified fix.
                if targets.len() > 1 {
                    problem.fixes.clear();
                }
                return Err(refused(problem));
            }
        }
        let under = tuck.under();
        let mut prepared = tuck.prepare(self, &moving).map_err(|r| refused(r.into()))?;
        let unplaced = prepared.clone();
        let constraints: Vec<_> = targets
            .iter()
            .flat_map(|&t| placements(self, &prepared, self.faces()[t].id, under))
            .collect();
        prepared.place(constraints);
        let context = Context {
            line: tuck.line(),
            side: tuck.side(),
            snap: tuck.classified.snap,
            direction: tuck.direction,
            placement: tuck.placement(),
            target: target_id,
        };
        if let Some(stored) = &choices.order {
            let folded = prepared
                .replay(stored, limits)
                .map_err(CompoundRefused::Broken)?;
            return Ok(TuckOutcome::Landed(Box::new(
                context.report(folded, Some(stored.clone())),
            )));
        }
        let completions = match prepared.complete(&[], limits) {
            Ok(completions) => completions,
            Err(refusal) => {
                if !diagnose {
                    return Err(refused(no_order(refusal).into()));
                }
                let mut problem = self.diagnose_tuck(
                    &tuck,
                    &moving,
                    &unplaced,
                    target,
                    no_order(refusal),
                    limits,
                );
                if targets.len() > 1 {
                    problem.fixes.clear();
                }
                return Err(refused(problem));
            }
        };
        if completions.is_unique() {
            let order = completions
                .order(&vec![0; completions.components().len()])
                .ok_or_else(|| {
                    refused(
                        FoldRefusal::Internal {
                            message: "a unique completion has no order".to_string(),
                        }
                        .into(),
                    )
                })?;
            let folded = prepared.land(order).map_err(|r| refused(r.into()))?;
            return Ok(TuckOutcome::Landed(Box::new(context.report(folded, None))));
        }
        Ok(TuckOutcome::ChooseOrder(Box::new(TuckChoice {
            pending: Pending {
                prepared,
                completions,
            },
            context,
        })))
    }

    fn tuck_target_positions(&self, op: &TuckFold) -> Result<Vec<usize>, FoldRefusal> {
        let mut targets = Vec::new();
        for &point in std::iter::once(&op.target).chain(&op.additional_targets) {
            let at = self
                .face_at(point)
                .and_then(|id| self.face_position(id))
                .ok_or(FoldRefusal::WitnessNotInFace { point })?;
            if !targets.contains(&at) {
                targets.push(at);
            }
        }
        Ok(targets)
    }

    /// Material adjacency resolves the selection independently of placement.
    /// Only these pieces can move in a layer-order search, so a target must
    /// overlap their reflected images, not those of unselected flaps.
    ///
    /// The scope also counts every order the selection can land in: the
    /// same block turned over as every landing turns it (the tuck's own
    /// preparation), with each hinge folded in `op.direction` and placed
    /// against nothing. Every landing the search can find, outer or
    /// inserted, is one of these orders, so once it has found them all
    /// there is nothing left to search; when there is one, the fold is
    /// forced and the search is over before it starts.
    pub(crate) fn placement_scope(&self, op: &TuckFold) -> Result<PlacementScope, Refused> {
        let tuck = self.tuck(op)?;
        let mut mandatory = vec![false; self.faces().len()];
        let mut queue: VecDeque<usize> = tuck.seed.iter().copied().collect();
        while let Some(f) = queue.pop_front() {
            if mandatory[f] {
                continue;
            }
            mandatory[f] = true;
            queue.extend(tuck.side.adjacent[f].iter().copied());
        }
        let reflection = tuck.classified.axis.reflection();
        let images: Vec<Vec<Point>> = tuck
            .side
            .pieces
            .iter()
            .enumerate()
            .filter(|(i, _)| mandatory[*i])
            .filter_map(|(_, piece)| piece.as_ref())
            .map(|piece| piece.iter().rev().map(|&p| reflection.apply(p)).collect())
            .collect();
        let targets = self
            .faces()
            .iter()
            .enumerate()
            .filter(|(i, _)| {
                !mandatory[*i]
                    && images
                        .iter()
                        .any(|image| convex::penetration(image, &self.geometry().images[*i]) > TOL)
            })
            .filter_map(|(_, face)| self.face_witness(face.id))
            .collect();
        let moving = self
            .faces()
            .iter()
            .enumerate()
            .filter(|(i, _)| mandatory[*i])
            .map(|(_, face)| face.id)
            .collect();
        let orders = tuck.landings(self, &mandatory);
        Ok(PlacementScope {
            moving,
            targets,
            orders,
        })
    }

    fn tuck(&self, op: &TuckFold) -> Result<Tuck, Refused> {
        let classified =
            line::classify(&self.geometry().vertex_images, Axis::new(&op.line, op.side))?;
        let side = moving_side(self, &classified)?;
        let direction = self.view().model_direction(op.direction);
        let seed = resolve_seed(
            self,
            &side.pieces,
            direction,
            &ResolvedSeed::from(&op.seed),
            &classified.axis,
        )?;
        let boxes: Vec<[f64; 4]> = side
            .pieces
            .iter()
            .map(|p| convex::bounding_box(p.as_deref().unwrap_or(&[])))
            .collect();
        let index = BoxIndex::new(boxes.clone());
        // The seed's flaps fold: their F crease with T, if any, is the fold
        // itself, so T's layer stops at them.
        let seed_flaps: Vec<usize> = seed.iter().filter_map(|&f| side.flap_of[f]).collect();
        let layer = flat_components_within(self, |f| {
            side.flap_of[f].is_none_or(|k| !seed_flaps.contains(&k))
        });
        Ok(Tuck {
            classified,
            side,
            direction,
            seed,
            boxes,
            index,
            layer,
        })
    }

    /// A tuck against the face at `target` that no order fits: refused
    /// naming T and the faces the conflict traces to, offering the targets
    /// near T that the same moving set takes — the layers that meet T first.
    fn diagnose_tuck(
        &self,
        tuck: &Tuck,
        moving: &[bool],
        unplaced: &Prepared,
        target: usize,
        refusal: FoldRefusal,
        limits: &CompletionLimits,
    ) -> Refused {
        let FoldRefusal::NoOrder { faces } = refusal else {
            return refusal.into();
        };
        Refused {
            refusal: FoldRefusal::TuckInfeasible {
                target: self.faces()[target].id,
                placement: tuck.placement(),
                faces,
            },
            fixes: self.tuck_fixes(tuck, moving, unplaced, target, limits),
        }
    }

    /// A tuck against the face at `target` that its block lands nowhere on:
    /// no placement names T, so a completion would land the plain fold and
    /// call it a tuck. Refused as a tuck no order fits, naming no conflict,
    /// with the targets near T that the same moving set takes.
    fn tuck_missed(
        &self,
        tuck: &Tuck,
        moving: &[bool],
        target: usize,
        limits: &CompletionLimits,
    ) -> Refused {
        let fixes = match tuck.prepare(self, moving) {
            Ok(unplaced) => self.tuck_fixes(tuck, moving, &unplaced, target, limits),
            Err(_) => Vec::new(),
        };
        Refused {
            refusal: FoldRefusal::TuckInfeasible {
                target: self.faces()[target].id,
                placement: tuck.placement(),
                faces: Vec::new(),
            },
            fixes,
        }
    }

    /// The targets near the face at `target` that the same moving set
    /// takes, as a refusal offers them: the layers that meet T first.
    fn tuck_fixes(
        &self,
        tuck: &Tuck,
        moving: &[bool],
        unplaced: &Prepared,
        target: usize,
        limits: &CompletionLimits,
    ) -> Vec<Fix> {
        let target_id = self.faces()[target].id;
        let under = tuck.under();
        let mut near: Vec<usize> = (0..self.faces().len())
            .filter(|&f| f != target && tuck.lands_on(self, moving, f))
            .filter(|&f| {
                tuck.side.pieces[f].is_none()
                    || tuck.closure(self, &[f]).is_ok_and(|other| other == moving)
            })
            .collect();
        near.sort_by_key(|&f| (self.above(self.faces()[f].id, target_id).is_none(), f));
        near.into_iter()
            .take(MAX_FIX_TARGETS_TRIED)
            .filter(|&f| {
                let id = self.faces()[f].id;
                unplaced.lands_placed(placements(self, unplaced, id, under), limits) == Some(true)
            })
            .take(MAX_FIX_TARGETS)
            .filter_map(|f| {
                let face = self.faces()[f].id;
                Some(Fix::TuckTarget {
                    face,
                    at: self.face_witness(face)?,
                })
            })
            .collect()
    }
}

// ---------------------------------------------------------------------------
// What the tools and the panes ask of a tuck beside landing it (plan D12,
// D14): what it moves against its target, the plain fold the depth picker
// previews the stacks of, and its picture. A tuck's geometry is a plain
// fold's of its block (one reflection across ℓ), so each reads as a plain
// fold's:
//
// - **What moves** is the bounded closure against T, the moving side's
//   flaps those of the plain fold along ℓ (which the chips number and a
//   refusal's fixes index), the ones the seed named picked and every other
//   flap the closure reaches added.
// - **The picture** is a plain fold's of the block: ℓ across the silhouette,
//   the spans where the block meets it, and the arrow from the block to where
//   it lands, under (or over) T.

impl TuckFold {
    /// The plain fold its line, side, direction and seed name: what the depth
    /// picker previews the stacks of, and whose flaps the layer picker shows.
    pub fn plain(&self) -> PlainFold {
        PlainFold::new(self.line, self.side, self.direction).with_seed(self.seed.clone())
    }
}

impl State {
    /// What the tuck `op` moves against its target, as a plain fold's
    /// analysis reads (see above). Refused as the tuck is before it lands: a
    /// target off the paper, a target that would move, a target the block
    /// lands nowhere on (without the fixes the tuck offers, which cost a
    /// completion each), nothing staying.
    pub fn analyse_tuck_fold(&self, op: &TuckFold) -> Result<FoldAnalysis, Refused> {
        let tuck = self.tuck(op)?;
        let targets = self.tuck_target_positions(op)?;
        let moving = tuck.closure(self, &targets)?;
        for target in targets {
            if !tuck.lands_on(self, &moving, target) {
                return Err(FoldRefusal::TuckInfeasible {
                    target: self.faces()[target].id,
                    placement: tuck.placement(),
                    faces: Vec::new(),
                }
                .into());
            }
        }
        let moving: Vec<FaceId> = (0..moving.len())
            .filter(|&f| moving[f])
            .map(|f| self.faces()[f].id)
            .collect();
        let (flaps, picked) = match self.analyse_fold(&op.plain()) {
            Ok(plain) => (plain.flaps, plain.picked),
            // The plain fold refused (its own closure would take T, say):
            // the moving side's flaps, every one of them named.
            Err(_) => {
                let flaps = tuck.side.flaps.clone();
                let picked = (0..flaps.len()).collect();
                (flaps, picked)
            }
        };
        let added = (0..flaps.len())
            .filter(|k| !picked.contains(k))
            .filter(|&k| {
                flaps[k]
                    .faces
                    .iter()
                    .any(|f| moving.binary_search(f).is_ok())
            })
            .collect();
        Ok(FoldAnalysis {
            line: tuck.line(),
            side: tuck.side(),
            snap: tuck.classified.snap,
            direction: tuck.direction,
            flaps,
            picked,
            added,
            moving,
        })
    }

    /// The picture of the tuck `op` on this state, before it lands (see
    /// above): no cover at the arrow's head yet.
    pub fn tuck_action(&self, op: &TuckFold) -> Result<FoldActionGeometry, Refused> {
        let analysis = self.analyse_tuck_fold(op)?;
        self.fold_action(&analysis, ActionKind::Fold, None)
    }
}

impl TuckReport {
    /// The landed tuck's picture on `parent`, the state it folded, with
    /// `landed`'s cover at the arrow's head when it is given.
    pub fn action(
        &self,
        parent: &State,
        landed: Option<&State>,
    ) -> Result<FoldActionGeometry, Refused> {
        let analysis = FoldAnalysis {
            line: self.line,
            side: self.side,
            snap: self.snap,
            direction: self.direction,
            flaps: Vec::new(),
            picked: Vec::new(),
            added: Vec::new(),
            moving: self.fold.moving.clone(),
        };
        parent.fold_action(&analysis, ActionKind::Fold, landed)
    }
}

impl TuckFolded {
    /// Its picture on `parent`, the state it folded, with the landed state's
    /// cover at the arrow's head.
    pub fn action(&self, parent: &State) -> Result<FoldActionGeometry, Refused> {
        self.report.action(parent, Some(&self.state))
    }
}

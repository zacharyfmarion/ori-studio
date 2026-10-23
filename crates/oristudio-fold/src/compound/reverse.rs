//! The reverse fold (plan Phase 9, research §5.2): ℓ, the tip side, an anchor
//! and the kind, through the compound pipeline ([`super`]).
//!
//! - **The tip** is the paper on the tip side grown from the anchor across
//!   every crease off ℓ, folded or flat: the moving side's flaps (plan D3)
//!   that hold the anchor. Layers not hinged to it stay, even where they lie
//!   on it; the completion decides where the tip goes among them.
//! - **Openings.** Each flap opens on its own (case 2b: two stacked flaps
//!   reverse, each into its own pocket) at a split into a lower block T1 and
//!   an upper block T2 such that no T1 piece lies above a T2 piece it
//!   overlaps, and every crease across the split belongs to a folded spine
//!   or a two-sided pocket boundary meeting at one material tip (one layer
//!   per side wherever they overlap). Each block is hinged
//!   on ℓ to a body of its own that stays,
//!   the lower body below the upper wherever they overlap. A flap with one
//!   admissible opening takes it; with more, the step chooses one, stored as
//!   the upper block's faces by witnesses (plan D6).
//! - **The scan** takes each line the flap's folded creases lie on as a
//!   candidate spine, plus unions meeting at a common material tip. It cuts
//!   each boundary and lists splits with nothing in T1 over T2: down-sets of their
//!   stacking, one per way to split a stack rather than one per subset of the
//!   tip's faces, capped at [`MAX_OPENINGS`] per flap with the cap reported.
//!   A gap extending sideways around a pocket supersedes its partial gaps;
//!   different depths among overlapping layers remain distinct choices.
//! - **The fold** reflects every tip piece across ℓ — the geometry and crease
//!   pattern of a plain fold of the whole tip — as two blocks per flap.
//!   Carried: pairs that stay, kept; pairs in one block, reversed. Seeded:
//!   pairs across blocks, kept in absolute terms except corresponding halves
//!   of nested openings along one spine, which turn together as a packet;
//!   each block against its own
//!   body, inside putting T1 over B1 and T2 under B2, outside the reverse.
//!   The completion decides the rest: with these seeds it is unique in
//!   99.4% of the spike's feasible inside folds.
//! - **Letters** follow from the order; research §5.2's rules hold as tests:
//!   the spine creases across an opening turn M↔V, every other tip crease
//!   keeps its letter, and a new crease where a spine crosses ℓ takes the
//!   body's spine letter for an inside fold and the other for an outside one.
//! - **The kind** is usually forced by the geometry: [`State::reverse_kinds`]
//!   says which kinds land, so a tool can pre-select the only one, and a
//!   refusal of one kind offers the other when it lands.

use std::collections::BTreeSet;

use oristudio_geometry::{Line, convex};
use serde::{Deserialize, Serialize};

use crate::complete::{ChoiceCount, CompletionLimits, Completions};
use crate::compound::motion::{MotionKind, StepMotion};
use crate::compound::{
    Across, Against, CompoundFolded, CompoundRefused, CompoundReport, Macro, Pending, Prepared,
    no_order, prepare,
};
use crate::fold::closure::{MovingSide, moving_side, resolve_seed};
use crate::fold::line::{self, Axis, Classified};
use crate::fold::{ResolvedSeed, Seed, Snap};
use crate::numerics::TOL;
use crate::pattern::{CreaseKind, EdgeId, FaceId};
use crate::refusal::{Fix, Flap, FoldRefusal, Refused, Side};
use crate::state::State;
use crate::view::Direction;
use crate::witness::{Broken, BrokenWitness, WitnessOrder};

type Point = [f64; 2];

/// The most openings the scan lists for one flap.
pub const MAX_OPENINGS: usize = 64;

/// The most ways to open a grown tip that a refusal tries before it offers
/// to grow the tip: each is a completion, and a refusal of a large model
/// should not cost many.
const MAX_FIX_PLANS: usize = 4;

/// Which way the tip goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReverseKind {
    /// Into the flap, between its layers.
    Inside,
    /// Around the outside of the flap.
    Outside,
}

impl ReverseKind {
    pub fn other(self) -> ReverseKind {
        match self {
            ReverseKind::Inside => ReverseKind::Outside,
            ReverseKind::Outside => ReverseKind::Inside,
        }
    }
}

/// A reverse fold, named the way a step stores it (plan D6).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReverseFold {
    /// ℓ, in the parent's model frame.
    pub line: Line,
    /// The side of ℓ the tip is on.
    pub side: Side,
    /// What the tip grows from: every layer on the tip side, the top layers
    /// at a sheet point as the viewer sees them, or flaps by sheet points.
    pub anchor: Seed,
    pub kind: ReverseKind,
}

/// Why a flap of the tip has no opening.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NoOpening {
    /// No folded crease off ℓ joins two of its faces: a single layer, or
    /// layers joined only by flat creases.
    NoSpine,
    /// No split along a spine keeps every lower layer below every upper one.
    NoSplit,
    /// Every split leaves a block hinged on ℓ to nothing that stays.
    NoBody,
    /// Every split puts the lower block's body over the upper's somewhere.
    BodiesCross,
}

/// One way a flap of the tip opens (see the module docs).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Opening {
    /// T1, the lower block: the parent's faces, in id order.
    pub lower: Vec<FaceId>,
    /// T2, the upper block.
    pub upper: Vec<FaceId>,
    /// Their common line for a straight opening; none for a pocket whose
    /// boundary turns along several folded hinges.
    pub spine: Option<Line>,
    /// The creases across the opening, in id order: they turn M↔V.
    pub across: Vec<EdgeId>,
    /// The faces each block is hinged to on ℓ, which stay, in id order.
    pub lower_body: Vec<FaceId>,
    pub upper_body: Vec<FaceId>,
    /// What a step stores to choose it.
    pub stored: StoredOpening,
}

/// An opening as a step stores it: the faces of its upper block, each by an
/// interior sheet point (plan D6).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredOpening {
    pub upper: Vec<Point>,
}

/// A flap of the tip and the ways it opens.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TipFlap {
    /// Its index among the moving side's flaps (the plain fold's flaps for
    /// the same line and side).
    pub index: usize,
    pub flap: Flap,
    /// The admissible openings, fewest lower faces first.
    pub openings: Vec<Opening>,
    /// The scan stopped at [`MAX_OPENINGS`]: more may exist.
    pub truncated: bool,
    /// Why there is none, when there is none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub none: Option<NoOpening>,
}

/// What a reverse fold of a state moves and how its flaps open, before it
/// lands.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ReverseAnalysis {
    /// The line folded along, after snapping, and the tip's side of it.
    pub line: Line,
    pub side: Side,
    pub snap: Snap,
    /// The tip: the parent's faces that move, in id order.
    pub tip: Vec<FaceId>,
    pub flaps: Vec<TipFlap>,
}

/// A reverse fold's choices as a step stores them (plan D6).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct ReverseChoices {
    /// The opening of each flap that has more than one, by its upper block.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub openings: Vec<StoredOpening>,
    /// The pairs the completion left free, as they were chosen.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<WitnessOrder>,
}

/// What a reverse fold did.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ReverseReport {
    pub line: Line,
    pub side: Side,
    pub snap: Snap,
    pub kind: ReverseKind,
    /// Each opening flap's opening; its blocks are the report's blocks `2k`
    /// (lower) and `2k + 1` (upper).
    pub openings: Vec<Opening>,
    /// The tip's flaps with no spine to open along (single layers), moving
    /// whole beside the ones that open: the parent's faces of each. Their
    /// blocks follow the openings'.
    pub whole: Vec<Vec<FaceId>>,
    #[serde(flatten)]
    pub fold: CompoundReport,
    /// The animation's legs (plan D15).
    pub motion: StepMotion,
    /// What the step stores: the openings chosen among several, and the
    /// order chosen among several.
    pub stored: ReverseChoices,
}

/// A landed reverse fold.
#[derive(Debug, Clone)]
pub struct ReverseFolded {
    pub state: State,
    pub report: ReverseReport,
}

/// A reverse fold whose completion left more than one order (plan D4).
#[derive(Debug, Clone)]
pub struct ReverseChoice {
    pending: Pending,
    context: Context,
}

impl ReverseChoice {
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
    pub fn pick(&self, choice: &[usize]) -> Result<ReverseFolded, FoldRefusal> {
        let (folded, order) = self.pending.pick(choice)?;
        Ok(self.context.report(folded, Some(order)))
    }
}

/// Where a reverse fold got to.
#[derive(Debug, Clone)]
pub enum ReverseOutcome {
    Landed(Box<ReverseFolded>),
    /// A flap opens more than one way and the choices name none of them:
    /// store one of each such flap's openings and fold again.
    ChooseOpening(Box<ReverseAnalysis>),
    /// More than one order fits: pick one.
    ChooseOrder(Box<ReverseChoice>),
}

/// What turns a landed compound fold into a reverse fold's report.
#[derive(Debug, Clone)]
struct Context {
    line: Line,
    side: Side,
    snap: Snap,
    kind: ReverseKind,
    openings: Vec<Opening>,
    whole: Vec<Vec<FaceId>>,
    stored_openings: Vec<StoredOpening>,
}

impl Context {
    fn new(state: &State, tip: &Tip, plan: &Plan, kind: ReverseKind) -> Context {
        let ids = |faces: &[usize]| faces.iter().map(|&f| state.faces()[f].id).collect();
        Context {
            line: tip.line(),
            side: tip.side(),
            snap: tip.classified.snap,
            kind,
            openings: plan.openings.iter().map(|o| o.public(state)).collect(),
            whole: plan.whole.iter().map(|faces| ids(faces)).collect(),
            stored_openings: plan.stored.clone(),
        }
    }

    fn report(&self, folded: CompoundFolded, order: Option<WitnessOrder>) -> ReverseFolded {
        // Lower blocks turn up for an inside fold (T1 lands over B1), upper
        // blocks down; the reverse for an outside one. A flap moving whole
        // turns with the lower blocks.
        let up_is_lower = self.kind == ReverseKind::Inside;
        let opened = 2 * self.openings.len();
        let groups: Vec<(Vec<FaceId>, bool)> = folded
            .report
            .blocks
            .iter()
            .enumerate()
            .map(|(b, faces)| (faces.clone(), (b >= opened || b % 2 == 0) == up_is_lower))
            .collect();
        let motion = StepMotion::half_turns(self.line, self.side, &groups, MotionKind::Visual);
        ReverseFolded {
            state: folded.state,
            report: ReverseReport {
                line: self.line,
                side: self.side,
                snap: self.snap,
                kind: self.kind,
                openings: self.openings.clone(),
                whole: self.whole.clone(),
                fold: folded.report,
                motion,
                stored: ReverseChoices {
                    openings: self.stored_openings.clone(),
                    order,
                },
            },
        }
    }
}

impl State {
    /// The tip of a reverse fold and how each of its flaps opens, without
    /// folding.
    pub fn analyse_reverse(&self, op: &ReverseFold) -> Result<ReverseAnalysis, Refused> {
        let tip = self.tip(op)?;
        Ok(tip.analysis(self))
    }

    /// The kinds of this reverse fold that land (with the stored openings,
    /// when a flap opens more than one way): a tool pre-selects the kind when
    /// only one does (research §5.2: on a two-layer flap and a generic line,
    /// exactly one does).
    pub fn reverse_kinds(
        &self,
        op: &ReverseFold,
        choices: &ReverseChoices,
    ) -> Result<Vec<ReverseKind>, CompoundRefused> {
        let tip = self.tip(op).map_err(CompoundRefused::Refused)?;
        let Some(plan) = tip.choose(self, choices)? else {
            return Ok(Vec::new());
        };
        // The kinds share their geometry: prepared once, the outside fold is
        // the inside one with its placements turned.
        let Ok(prepared) = tip.prepare(self, &plan, ReverseKind::Inside) else {
            return Ok(Vec::new());
        };
        let limits = CompletionLimits::default();
        Ok([
            (ReverseKind::Inside, prepared.lands(&limits)),
            (ReverseKind::Outside, prepared.lands_flipped(&limits)),
        ]
        .into_iter()
        .filter_map(|(kind, lands)| lands.then_some(kind))
        .collect())
    }

    /// A reverse fold, with its stored choices (empty for a new step), under
    /// the default completion limits.
    pub fn reverse_fold(
        &self,
        op: &ReverseFold,
        choices: &ReverseChoices,
    ) -> Result<ReverseOutcome, CompoundRefused> {
        self.reverse_fold_within(op, choices, &CompletionLimits::default())
    }

    /// [`State::reverse_fold`] under `limits`. A refusal comes with the fixes
    /// that land: the other kind, the flaps in the tip's way, or the flaps
    /// that do open. A stored choice that no longer resolves is
    /// [`CompoundRefused::Broken`].
    pub fn reverse_fold_within(
        &self,
        op: &ReverseFold,
        choices: &ReverseChoices,
        limits: &CompletionLimits,
    ) -> Result<ReverseOutcome, CompoundRefused> {
        let tip = self.tip(op).map_err(CompoundRefused::Refused)?;
        let Some(plan) = tip.choose(self, choices)? else {
            return Ok(ReverseOutcome::ChooseOpening(Box::new(tip.analysis(self))));
        };
        let prepared = tip
            .prepare(self, &plan, op.kind)
            .map_err(|r| CompoundRefused::Refused(r.into()))?;
        let context = Context::new(self, &tip, &plan, op.kind);
        if let Some(stored) = &choices.order {
            let folded = prepared
                .replay(stored, limits)
                .map_err(CompoundRefused::Broken)?;
            return Ok(ReverseOutcome::Landed(Box::new(
                context.report(folded, Some(stored.clone())),
            )));
        }
        let completions = match prepared.complete(&[], limits) {
            Ok(completions) => completions,
            Err(refusal) => {
                let refusal = no_order(refusal);
                return Err(CompoundRefused::Refused(
                    self.diagnose(op, &tip, &plan, &prepared, refusal, limits),
                ));
            }
        };
        if completions.is_unique() {
            let order = completions
                .order(&vec![0; completions.components().len()])
                .ok_or_else(|| {
                    CompoundRefused::Refused(
                        FoldRefusal::Internal {
                            message: "a unique completion has no order".to_string(),
                        }
                        .into(),
                    )
                })?;
            let folded = prepared
                .land(order)
                .map_err(|r| CompoundRefused::Refused(r.into()))?;
            return Ok(ReverseOutcome::Landed(Box::new(
                context.report(folded, None),
            )));
        }
        Ok(ReverseOutcome::ChooseOrder(Box::new(ReverseChoice {
            pending: Pending {
                prepared,
                completions,
            },
            context,
        })))
    }

    /// The tip of `op`: its line classified, the moving side's flaps, and the
    /// flaps the anchor grows over. Everything moving is refused, offering
    /// the flaps to pick. A crimp's first line has the same tip.
    pub(super) fn tip(&self, op: &ReverseFold) -> Result<Tip, Refused> {
        let classified = line::classify_for_selection(
            &self.geometry().vertex_images,
            Axis::new(&op.line, op.side),
        )?;
        let side = moving_side(self, &classified)?;
        // The top layers at a point are the top as the viewer sees them.
        let top = self.view().model_direction(Direction::Valley);
        let seeded = resolve_seed(
            self,
            &side.pieces,
            top,
            &ResolvedSeed::from(&op.anchor),
            &classified.axis,
        )?;
        let mut flaps: Vec<usize> = seeded.iter().filter_map(|&f| side.flap_of[f]).collect();
        flaps.sort_unstable();
        flaps.dedup();
        Tip::new(self, classified, side, flaps)
    }

    /// Fixes for a reverse fold no order fits: the other kind when it lands
    /// (the refusal is then that this kind does not fit), and the flaps in
    /// the tip's way when growing the tip over them lands (the tip is then
    /// not free) — keeping the openings chosen if it can, otherwise opening
    /// some other way, which the grown fold then asks for.
    ///
    /// The other kind is the fold `prepared` with its placements turned, so
    /// it costs one completion, not a second scoring and gate; a grown plan
    /// is tried once, however many ways of keeping the openings reach it.
    fn diagnose(
        &self,
        op: &ReverseFold,
        tip: &Tip,
        plan: &Plan,
        prepared: &Prepared,
        refusal: FoldRefusal,
        limits: &CompletionLimits,
    ) -> Refused {
        let FoldRefusal::NoOrder { faces } = refusal else {
            return refusal.into();
        };
        let mut fixes = Vec::new();
        let other = op.kind.other();
        if prepared.lands_flipped(limits) {
            fixes.push(Fix::OtherKind { kind: other });
        }
        // The layers in the way: faces the conflict traces to with paper on
        // the tip side, outside the tip. The fold splits only tip faces, so
        // every other face keeps its id.
        let blocking: BTreeSet<usize> = faces
            .iter()
            .filter_map(|&id| self.face_position(id))
            .filter(|&f| !tip.in_tip[f] && tip.side.pieces[f].is_some())
            .collect();
        if blocking.is_empty() {
            return Refused {
                refusal: FoldRefusal::ReverseKindInfeasible {
                    kind: op.kind,
                    faces,
                },
                fixes,
            };
        }
        let mut grown: Vec<usize> = tip.flaps.clone();
        grown.extend(blocking.iter().filter_map(|&f| tip.side.flap_of[f]));
        grown.sort_unstable();
        grown.dedup();
        let added: Vec<usize> = grown
            .iter()
            .copied()
            .filter(|f| tip.flaps.binary_search(f).is_err())
            .collect();
        let mut tried: Vec<Plan> = Vec::new();
        if let Ok(bigger) = Tip::new(self, tip.classified.clone(), tip.side.clone(), grown)
            && [plan.stored.as_slice(), &[]].iter().any(|chosen| {
                bigger
                    .plans(self, chosen, MAX_FIX_PLANS)
                    .into_iter()
                    .any(|plan| {
                        if tried.contains(&plan) {
                            return false;
                        }
                        let lands = bigger.lands(self, &plan, op.kind, limits);
                        tried.push(plan);
                        lands
                    })
            })
        {
            fixes.push(Fix::IncludeFlaps { flaps: added });
        }
        Refused {
            refusal: FoldRefusal::ReverseTipNotFree {
                blocking: blocking.iter().map(|&f| self.faces()[f].id).collect(),
                faces,
            },
            fixes,
        }
    }
}

/// A reverse fold's tip on a state (and a crimp's, at its first line).
#[derive(Debug, Clone)]
pub(super) struct Tip {
    pub(super) classified: Classified,
    pub(super) side: MovingSide,
    /// The moving side's flaps the tip grows over, ascending.
    pub(super) flaps: Vec<usize>,
    /// Per face position.
    pub(super) in_tip: Vec<bool>,
    has_stationary: Vec<bool>,
    /// Per flap of the tip (in `flaps` order), its openings.
    openings: Vec<FlapOpenings>,
}

/// How a tip's flaps move.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Plan {
    /// Each opening flap's opening, in the tip's flap order.
    pub(super) openings: Vec<RawOpening>,
    /// The flaps with no spine to open along, moving whole beside them.
    pub(super) whole: Vec<Vec<usize>>,
    /// The openings chosen among several, as a step stores them.
    pub(super) stored: Vec<StoredOpening>,
}

/// A flap's openings, by face positions.
#[derive(Debug, Clone)]
struct FlapOpenings {
    openings: Vec<RawOpening>,
    truncated: bool,
    none: Option<NoOpening>,
}

/// An opening by face and crease positions.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct RawOpening {
    pub(super) lower: Vec<usize>,
    pub(super) upper: Vec<usize>,
    spine: Option<Line>,
    across: Vec<usize>,
    pub(super) lower_body: Vec<usize>,
    pub(super) upper_body: Vec<usize>,
}

impl RawOpening {
    pub(super) fn public(&self, state: &State) -> Opening {
        let ids = |faces: &[usize]| faces.iter().map(|&f| state.faces()[f].id).collect();
        let mut across: Vec<EdgeId> = self.across.iter().map(|&k| state.creases()[k].id).collect();
        across.sort_unstable();
        Opening {
            lower: ids(&self.lower),
            upper: ids(&self.upper),
            spine: self.spine,
            across,
            lower_body: ids(&self.lower_body),
            upper_body: ids(&self.upper_body),
            stored: StoredOpening {
                upper: self
                    .upper
                    .iter()
                    .filter_map(|&f| state.face_witness(state.faces()[f].id))
                    .collect(),
            },
        }
    }
}

impl Tip {
    /// Two openings form a nested packet only along the same spine, with
    /// one upper half above the other's and its lower half below the other's.
    /// Test the actual moving-side pieces, not overlap elsewhere in a face.
    /// Pairwise coupling avoids merging unrelated sibling pockets through a
    /// common enclosing flap. All opposite-half and body contacts remain.
    pub(super) fn packet_pairs(&self, state: &State, plan: &Plan) -> Vec<[usize; 2]> {
        let above = |upper: &[usize], lower: &[usize]| {
            let mut overlaps = false;
            for &a in upper {
                for &b in lower {
                    let (Some(p), Some(q)) = (&self.side.pieces[a], &self.side.pieces[b]) else {
                        continue;
                    };
                    if convex::penetration(p, q) > TOL {
                        overlaps = true;
                        if state.above(state.faces()[a].id, state.faces()[b].id) != Some(true) {
                            return false;
                        }
                    }
                }
            }
            overlaps
        };
        let mut coupled = Vec::new();
        for (a, outer) in plan.openings.iter().enumerate() {
            for (b, inner) in plan.openings.iter().enumerate().skip(a + 1) {
                // Both ends of every spine segment must lie on the other
                // spine; a shared crossing point is insufficient.
                let (Some(_), Some(spine)) = (outer.spine, inner.spine) else {
                    continue;
                };
                let same_spine = outer.across.iter().all(|&k| {
                    state.creases()[k].vertices.iter().all(|v| {
                        spine
                            .signed_distance(state.geometry().vertex_images[v.index()])
                            .abs()
                            <= TOL
                    })
                });
                let nested = (above(&outer.upper, &inner.upper)
                    && above(&inner.lower, &outer.lower))
                    || (above(&inner.upper, &outer.upper) && above(&outer.lower, &inner.lower));
                if same_spine && nested {
                    coupled.push([2 * a, 2 * b]);
                    coupled.push([2 * a + 1, 2 * b + 1]);
                }
            }
        }
        coupled
    }

    fn new(
        state: &State,
        classified: Classified,
        side: MovingSide,
        flaps: Vec<usize>,
    ) -> Result<Tip, Refused> {
        let nf = state.faces().len();
        let in_tip: Vec<bool> = (0..nf)
            .map(|f| side.flap_of[f].is_some_and(|k| flaps.binary_search(&k).is_ok()))
            .collect();
        // Adjacency has now grown the entire tip. Untouched layers may have
        // near vertices, but every corner of participating faces must pass,
        // including their stationary portions and any attached paper.
        if let Some(refused) = classified.refusal_for(
            state
                .faces()
                .iter()
                .zip(&in_tip)
                .filter(|(_, moves)| **moves)
                .flat_map(|(face, _)| face.ring.iter().copied()),
        ) {
            return Err(refused);
        }
        let has_stationary: Vec<bool> = state
            .faces()
            .iter()
            .map(|face| {
                face.ring
                    .iter()
                    .any(|v| classified.classes[v.index()] == -1)
            })
            .collect();
        if (0..nf).all(|f| in_tip[f] && !has_stationary[f]) {
            let fixes = if side.flaps.len() > 1 {
                vec![Fix::PickFlap {
                    flaps: side.flaps.clone(),
                }]
            } else {
                Vec::new()
            };
            return Err(Refused {
                refusal: FoldRefusal::NothingStays,
                fixes,
            });
        }
        let mut tip = Tip {
            classified,
            side,
            flaps,
            in_tip,
            has_stationary,
            openings: Vec::new(),
        };
        tip.openings = tip
            .flaps
            .iter()
            .map(|&k| {
                let faces: Vec<usize> = (0..nf)
                    .filter(|&f| tip.side.flap_of[f] == Some(k))
                    .collect();
                tip.scan(state, &faces)
            })
            .collect();
        Ok(tip)
    }

    pub(super) fn line(&self) -> Line {
        self.classified.axis.line_and_side().0
    }

    pub(super) fn side(&self) -> Side {
        self.classified.axis.line_and_side().1
    }

    pub(super) fn analysis(&self, state: &State) -> ReverseAnalysis {
        ReverseAnalysis {
            line: self.line(),
            side: self.side(),
            snap: self.classified.snap,
            tip: (0..state.faces().len())
                .filter(|&f| self.in_tip[f])
                .map(|f| state.faces()[f].id)
                .collect(),
            flaps: self
                .flaps
                .iter()
                .zip(&self.openings)
                .map(|(&k, o)| TipFlap {
                    index: k,
                    flap: self.side.flaps[k].clone(),
                    openings: o.openings.iter().map(|r| r.public(state)).collect(),
                    truncated: o.truncated,
                    none: o.none,
                })
                .collect(),
        }
    }

    /// How each flap moves: at its only opening or its stored one, or whole
    /// when it has no spine to open along and another flap opens. `None` when
    /// a flap opens several ways and no stored opening names one; refused
    /// when no flap opens, or one with a spine cannot; broken when a stored
    /// opening names no opening.
    pub(super) fn choose(
        &self,
        state: &State,
        choices: &ReverseChoices,
    ) -> Result<Option<Plan>, CompoundRefused> {
        let opens = |o: &FlapOpenings| !o.openings.is_empty();
        let any_opens = self.openings.iter().any(opens);
        // A flap with no spine moves whole beside one that opens.
        let moves =
            |o: &FlapOpenings| opens(o) || (any_opens && o.none == Some(NoOpening::NoSpine));
        if let Some((k, flap)) = self.openings.iter().enumerate().find(|(_, o)| !moves(o)) {
            let faces = self.side.flaps[self.flaps[k]].faces.clone();
            let opening: Vec<Flap> = self
                .flaps
                .iter()
                .zip(&self.openings)
                .filter(|(_, o)| opens(o))
                .map(|(&j, _)| self.side.flaps[j].clone())
                .collect();
            let fixes = if opening.is_empty() {
                Vec::new()
            } else {
                vec![Fix::PickFlap { flaps: opening }]
            };
            return Err(CompoundRefused::Refused(Refused {
                refusal: FoldRefusal::ReverseNoOpening {
                    faces,
                    cause: flap.none.unwrap_or(NoOpening::NoSpine),
                },
                fixes,
            }));
        }
        let mut picked: Vec<Option<usize>> = self
            .openings
            .iter()
            .map(|o| (o.openings.len() == 1).then_some(0))
            .collect();
        let mut named = vec![false; self.openings.len()];
        for (i, stored) in choices.openings.iter().enumerate() {
            let mut faces = BTreeSet::new();
            for (witness, &point) in stored.upper.iter().enumerate() {
                let face = point
                    .iter()
                    .all(|c| c.is_finite())
                    .then(|| state.face_at(point))
                    .flatten()
                    .and_then(|id| state.face_position(id))
                    .ok_or(CompoundRefused::Broken(Broken::Witness {
                        witness: BrokenWitness::NoFace { witness, point },
                    }))?;
                faces.insert(face);
            }
            match self.named(state, &faces) {
                Some((k, j)) if !named[k] => {
                    named[k] = true;
                    picked[k] = Some(j);
                }
                _ => return Err(CompoundRefused::Broken(Broken::Opening { opening: i })),
            }
        }
        let mut plan = Plan {
            openings: Vec::new(),
            whole: Vec::new(),
            stored: Vec::new(),
        };
        for ((pick, o), &k) in picked.iter().zip(&self.openings).zip(&self.flaps) {
            match pick {
                Some(j) => {
                    let opening = o.openings[*j].clone();
                    if o.openings.len() > 1 {
                        plan.stored.push(opening.public(state).stored);
                    }
                    plan.openings.push(opening);
                }
                None if o.openings.is_empty() => plan.whole.push(
                    (0..state.faces().len())
                        .filter(|&f| self.side.flap_of[f] == Some(k))
                        .collect(),
                ),
                None => return Ok(None),
            }
        }
        Ok(Some(plan))
    }

    /// The opening, as (flap, opening), whose split the faces at a stored
    /// opening's witnesses name; none when no one opening's does.
    ///
    /// - **By the block.** The witnesses name the faces of one block, one
    ///   face each. A face may have been split since — by a precrease made
    ///   in an earlier step, which only engine drift or an imported document
    ///   puts there — and its pieces lie side by side, joined by flat
    ///   creases, which no split between blocks crosses (every crease across
    ///   one is folded). So the faces name a block when they lie in it and
    ///   every flat-joined part of it holds one: a containment no nested
    ///   opening satisfies, whose larger block has a layer with no witness.
    /// - **Either way up.** The faces were the upper block where the step
    ///   chose it. Started the other side up (the Paper pane's Front up /
    ///   Back up replays every step on the sheet turned over, each step's
    ///   direction the viewer's), the model-frame stack is reversed and the
    ///   same split has them as its lower block. An opening is its split,
    ///   so the lower blocks are read when no upper one is named.
    fn named(&self, state: &State, faces: &BTreeSet<usize>) -> Option<(usize, usize)> {
        let creases = state.creases();
        let topology = state.topology();
        let names = |block: &[usize]| {
            if !faces.iter().all(|f| block.contains(f)) {
                return false;
            }
            let mut joined = UnionFind::new(block.len());
            for (a, &f) in block.iter().enumerate() {
                for &k in &topology.face_creases[f] {
                    let flat = matches!(creases[k].kind, CreaseKind::Flat(_));
                    let across = topology.across(k, f);
                    if let Some(b) = across.and_then(|g| block.iter().position(|&h| h == g))
                        && flat
                    {
                        joined.join(a, b);
                    }
                }
            }
            let held: BTreeSet<usize> = block
                .iter()
                .enumerate()
                .filter(|(_, f)| faces.contains(f))
                .map(|(a, _)| joined.root(a))
                .collect();
            (0..block.len()).all(|a| held.contains(&joined.root(a)))
        };
        let find = |block: fn(&RawOpening) -> &[usize]| {
            let mut found = self.openings.iter().enumerate().flat_map(|(k, o)| {
                o.openings
                    .iter()
                    .enumerate()
                    .filter(|(_, r)| names(block(r)))
                    .map(move |(j, _)| (k, j))
            });
            match (found.next(), found.next()) {
                (Some(named), None) => Some(named),
                _ => None,
            }
        };
        find(|r| &r.upper).or_else(|| find(|r| &r.lower))
    }

    /// Up to `cap` plans keeping the openings `chosen`: every way to open
    /// the other flaps that open several ways, in the order their openings
    /// are listed. None when a flap cannot move.
    fn plans(&self, state: &State, chosen: &[StoredOpening], cap: usize) -> Vec<Plan> {
        let mut plans = vec![ReverseChoices {
            openings: chosen.to_vec(),
            order: None,
        }];
        let open = |o: &&FlapOpenings| {
            o.openings.len() > 1
                && !o
                    .openings
                    .iter()
                    .any(|r| chosen.contains(&r.public(state).stored))
        };
        for o in self.openings.iter().filter(open) {
            plans = plans
                .into_iter()
                .flat_map(|choices| {
                    o.openings.iter().map(move |opening| {
                        let mut more = choices.clone();
                        more.openings.push(opening.public(state).stored);
                        more
                    })
                })
                .take(cap)
                .collect();
        }
        plans
            .iter()
            .filter_map(|choices| self.choose(state, choices).ok().flatten())
            .collect()
    }

    /// Whether the plan of this kind has at least one order: a search that
    /// stops at the first order of each component.
    fn lands(
        &self,
        state: &State,
        plan: &Plan,
        kind: ReverseKind,
        limits: &CompletionLimits,
    ) -> bool {
        self.prepare(state, plan, kind)
            .ok()
            .is_some_and(|prepared| prepared.lands(limits))
    }

    /// The compound fold of a plan, through the pipeline's steps 2–7: each
    /// opening two blocks against their bodies, each flap moving whole a
    /// block placed by the completion alone.
    fn prepare(
        &self,
        state: &State,
        plan: &Plan,
        kind: ReverseKind,
    ) -> Result<Prepared, FoldRefusal> {
        let nf = state.faces().len();
        let mut block_of = vec![None; nf];
        let mut against = Vec::with_capacity(2 * plan.openings.len());
        let inside = kind == ReverseKind::Inside;
        for (k, opening) in plan.openings.iter().enumerate() {
            let (lower, upper) = (2 * k, 2 * k + 1);
            for &f in &opening.lower {
                block_of[f] = Some(lower);
            }
            for &f in &opening.upper {
                block_of[f] = Some(upper);
            }
            against.push(Against {
                block: lower,
                faces: opening.lower_body.clone(),
                above: inside,
            });
            against.push(Against {
                block: upper,
                faces: opening.upper_body.clone(),
                above: !inside,
            });
        }
        for (j, whole) in plan.whole.iter().enumerate() {
            for &f in whole {
                block_of[f] = Some(2 * plan.openings.len() + j);
            }
        }
        let reflection = self.classified.axis.reflection();
        prepare(
            state,
            &Macro {
                line: self.classified.clone(),
                block_of,
                blocks: vec![reflection; 2 * plan.openings.len() + plan.whole.len()],
                against,
                across: Across::packets(self.packet_pairs(state, plan), false),
            },
        )
    }

    /// The admissible openings of the flap whose face positions are `flap`
    /// (see the module docs).
    fn scan(&self, state: &State, flap: &[usize]) -> FlapOpenings {
        let classes = &self.classified.classes;
        let topology = state.topology();
        let images = &state.geometry().vertex_images;
        let in_flap = |f: usize| flap.binary_search(&f).is_ok();

        // The flap's hinges (creases with an end on the tip side), and the
        // folded ones grouped by the line their image lies on.
        let mut hinges: Vec<(usize, [usize; 2])> = Vec::new();
        let mut spines: Vec<(Line, Vec<usize>)> = Vec::new();
        for (k, crease) in state.creases().iter().enumerate() {
            let [a, b] = crease.vertices;
            if classes[a.index()].max(classes[b.index()]) < 1 {
                continue;
            }
            let [f, g] = match topology.crease_faces[k][..] {
                [f, g] if in_flap(f) && in_flap(g) => [f, g],
                _ => continue,
            };
            hinges.push((k, [f, g]));
            if !crease.kind.is_folded() {
                continue;
            }
            let (p, q) = (images[a.index()], images[b.index()]);
            match spines.iter_mut().find(|(line, _)| {
                line.signed_distance(p).abs() <= TOL && line.signed_distance(q).abs() <= TOL
            }) {
                Some((_, ks)) => ks.push(hinges.len() - 1),
                None => {
                    if let Some(line) = Line::from_points(p, q) {
                        spines.push((line, vec![hinges.len() - 1]));
                    }
                }
            }
        }
        if spines.is_empty() {
            return FlapOpenings {
                openings: Vec::new(),
                truncated: false,
                none: Some(NoOpening::NoSpine),
            };
        }

        // Which flap faces lie over which, where their tip-side pieces
        // overlap.
        let mut over: Vec<(usize, usize)> = Vec::new();
        for (pair, lo_above) in state.order().pairs() {
            let (Some(lo_above), Some(f), Some(g)) = (
                lo_above,
                state.face_position(pair.lo()),
                state.face_position(pair.hi()),
            ) else {
                continue;
            };
            if !in_flap(f) || !in_flap(g) {
                continue;
            }
            let (Some(p), Some(q)) = (&self.side.pieces[f], &self.side.pieces[g]) else {
                continue;
            };
            if convex::penetration(p, q) > TOL {
                over.push(if lo_above { (f, g) } else { (g, f) });
            }
        }

        let bodies = Bodies::new(state, self, flap);
        let local = |f: usize| flap.binary_search(&f).unwrap_or(0);
        let (mut openings, mut truncated) = (Vec::new(), false);
        let (mut split_any, mut bodied_any) = (false, false);
        // A pocket may close around a corner, with several folded boundary
        // lines meeting at one material tip. Keep the straight-spine searches
        // and add only those local boundary unions, not arbitrary combinations
        // of unrelated or parallel folds elsewhere in the flap.
        let mut cuts: Vec<Vec<usize>> = spines.iter().map(|(_, hs)| hs.clone()).collect();
        let vertices: BTreeSet<_> = hinges
            .iter()
            .flat_map(|&(k, _)| state.creases()[k].vertices)
            .collect();
        for v in vertices {
            let tip = images[v.index()];
            if self.classified.axis.distance(tip) <= TOL {
                continue;
            }
            let boundary: Vec<_> = spines
                .iter()
                .filter(|(line, hs)| {
                    line.signed_distance(tip).abs() <= TOL
                        && hs
                            .iter()
                            .any(|&h| state.creases()[hinges[h].0].vertices.contains(&v))
                })
                .collect();
            if boundary.len() < 2 {
                continue;
            }
            let mut cut: Vec<_> = boundary
                .iter()
                .flat_map(|(_, hs)| hs.iter().copied())
                .collect();
            cut.sort_unstable();
            if !cuts.contains(&cut) {
                cuts.push(cut);
            }
        }
        for cut in &cuts {
            // Pieces left once the spine's creases are cut.
            let mut pieces = UnionFind::new(flap.len());
            for (h, &(_, [f, g])) in hinges.iter().enumerate() {
                if !cut.contains(&h) {
                    pieces.join(local(f), local(g));
                }
            }
            let piece_of: Vec<usize> = (0..flap.len()).map(|i| pieces.root(i)).collect();
            // Room for the empty/full sets plus one beyond the output cap.
            let Some(splits) = down_sets(&piece_of, &over, &local, MAX_OPENINGS + 3) else {
                continue;
            };
            truncated |= splits.len() == MAX_OPENINGS + 3;
            for lower_pieces in splits {
                let lower: Vec<usize> = (0..flap.len())
                    .filter(|&i| lower_pieces.contains(&piece_of[i]))
                    .map(|i| flap[i])
                    .collect();
                if lower.is_empty() || lower.len() == flap.len() {
                    continue;
                }
                let upper: Vec<usize> = flap
                    .iter()
                    .copied()
                    .filter(|f| lower.binary_search(f).is_err())
                    .collect();
                let across: Vec<usize> = cut
                    .iter()
                    .map(|&h| hinges[h])
                    .filter(|&(_, [f, g])| {
                        lower.binary_search(&f).is_ok() != lower.binary_search(&g).is_ok()
                    })
                    .map(|(k, _)| k)
                    .collect();
                if across.is_empty() {
                    continue;
                }
                let spine = spines
                    .iter()
                    .find(|(_, hs)| across.iter().all(|k| hs.iter().any(|&h| hinges[h].0 == *k)))
                    .map(|(line, _)| *line);
                // A bent two-sided pocket has one layer on each side of the
                // gap wherever paper overlaps. Do not invent mixed reversals
                // through different depths of a stacked/pleated tip: those
                // retain the established straight-spine openings.
                if spine.is_none()
                    && over.iter().any(|&(a, b)| {
                        lower.binary_search(&a).is_ok() == lower.binary_search(&b).is_ok()
                    })
                {
                    continue;
                }
                split_any = true;
                let (lower_body, upper_body) = (bodies.of(&lower), bodies.of(&upper));
                if lower_body.is_empty() || upper_body.is_empty() {
                    continue;
                }
                bodied_any = true;
                if !bodies.separated(state, &lower_body, &upper_body) {
                    continue;
                }
                let opening = RawOpening {
                    lower,
                    upper,
                    spine,
                    across,
                    lower_body,
                    upper_body,
                };
                if openings.contains(&opening) {
                    continue;
                }
                if openings.len() >= MAX_OPENINGS {
                    truncated = true;
                    break;
                }
                openings.push(opening);
            }
        }
        openings.sort_by(|a, b| (a.lower.len(), &a.lower).cmp(&(b.lower.len(), &b.lower)));
        openings.dedup();
        // Extend a gap around the tip when the additional boundary opens a
        // side-by-side part of the SAME pocket. Choosing just one side would
        // put its sibling front panel into the back block. A genuinely deeper
        // gap still survives: moving to it changes an overlapping layer pair.
        let complete: Vec<_> = openings
            .iter()
            .filter(|o| o.spine.is_none())
            .cloned()
            .collect();
        openings.retain(|opening| {
            !complete.iter().any(|pocket| {
                if opening.across.len() >= pocket.across.len()
                    || !opening.across.iter().all(|k| pocket.across.contains(k))
                {
                    return false;
                }
                let changed: Vec<_> = flap
                    .iter()
                    .copied()
                    .filter(|f| opening.lower.contains(f) != pocket.lower.contains(f))
                    .collect();
                // Existing crossings of the gap must all remain crossings, and
                // each reassigned panel must expose a previously unopened region.
                let was_crossed = |a, b| opening.lower.contains(&a) != opening.lower.contains(&b);
                !changed.is_empty()
                    && over.iter().all(|&(a, b)| {
                        !was_crossed(a, b) || (!changed.contains(&a) && !changed.contains(&b))
                    })
            })
        });
        let none = openings.is_empty().then_some(if !split_any {
            NoOpening::NoSplit
        } else if !bodied_any {
            NoOpening::NoBody
        } else {
            NoOpening::BodiesCross
        });
        FlapOpenings {
            openings,
            truncated,
            none,
        }
    }
}

/// What each face of a flap is hinged to on ℓ, and the pieces that stay.
struct Bodies {
    /// Per flap face (by position), the faces of its body: its own piece
    /// that stays, and every face wholly on the stationary side across a
    /// crease on ℓ.
    of_face: Vec<(usize, Vec<usize>)>,
    /// Per face position, its image on the stationary side, once computed.
    pieces: Vec<Option<Vec<Point>>>,
}

impl Bodies {
    fn new(state: &State, tip: &Tip, flap: &[usize]) -> Bodies {
        let classes = &tip.classified.classes;
        let topology = state.topology();
        let half = tip.classified.axis.moving_half_plane();
        let mut of_face: Vec<(usize, Vec<usize>)> = flap
            .iter()
            .map(|&f| {
                let own = if tip.has_stationary[f] {
                    vec![f]
                } else {
                    Vec::new()
                };
                (f, own)
            })
            .collect();
        for (k, crease) in state.creases().iter().enumerate() {
            if crease.kind == CreaseKind::Border
                || crease.vertices.iter().any(|v| classes[v.index()] != 0)
            {
                continue;
            }
            let [f, g] = match topology.crease_faces[k][..] {
                [f, g] => [f, g],
                _ => continue,
            };
            for (inner, outer) in [(f, g), (g, f)] {
                if let Ok(i) = flap.binary_search(&inner)
                    && tip.side.pieces[outer].is_none()
                {
                    of_face[i].1.push(outer);
                }
            }
        }
        let images = &state.geometry().images;
        let pieces = (0..state.faces().len())
            .map(|f| {
                if tip.side.pieces[f].is_none() {
                    return Some(images[f].clone());
                }
                if !tip.has_stationary[f] {
                    return None;
                }
                half.map(|h| convex::split(&images[f], &h, TOL).outside)
                    .filter(|p| p.len() >= 3)
            })
            .collect();
        Bodies { of_face, pieces }
    }

    /// The body of a block, ascending.
    fn of(&self, block: &[usize]) -> Vec<usize> {
        let mut body: Vec<usize> = self
            .of_face
            .iter()
            .filter(|(f, _)| block.binary_search(f).is_ok())
            .flat_map(|(_, body)| body.iter().copied())
            .collect();
        body.sort_unstable();
        body.dedup();
        body
    }

    /// No face in both, and the lower body below the upper wherever their
    /// pieces that stay overlap.
    fn separated(&self, state: &State, lower: &[usize], upper: &[usize]) -> bool {
        let faces = state.faces();
        for &a in lower {
            for &b in upper {
                if a == b {
                    return false;
                }
                let (Some(p), Some(q)) = (&self.pieces[a], &self.pieces[b]) else {
                    continue;
                };
                if convex::penetration(p, q) > TOL
                    && state.above(faces[a].id, faces[b].id) != Some(false)
                {
                    return false;
                }
            }
        }
        true
    }
}

/// The ways to split pieces into a lower part that nothing of the upper part
/// lies under: given each flap face's piece (`piece_of`, by local position)
/// and the pairs `(upper, lower)` of overlapping faces, the sets of pieces
/// closed under "lies under". Pieces that lie under one another both ways
/// must stay together. At most `cap` sets; `None` when everything is one
/// piece. A closed sink's pockets are these splits too ([`super::sink`]).
pub(crate) fn down_sets(
    piece_of: &[usize],
    over: &[(usize, usize)],
    local: &impl Fn(usize) -> usize,
    cap: usize,
) -> Option<Vec<BTreeSet<usize>>> {
    let mut ids: Vec<usize> = piece_of.to_vec();
    ids.sort_unstable();
    ids.dedup();
    if ids.len() < 2 {
        return None;
    }
    let index = |p: usize| ids.binary_search(&p).unwrap_or(0);
    let n = ids.len();
    // under[i]: the pieces that lie under piece i somewhere.
    let mut under: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); n];
    for &(upper, lower) in over {
        let (u, l) = (index(piece_of[local(upper)]), index(piece_of[local(lower)]));
        if u != l {
            under[u].insert(l);
        }
    }
    // Close it, then merge the pieces that lie under each other.
    let mut below: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); n];
    for (i, set) in below.iter_mut().enumerate() {
        let mut stack: Vec<usize> = under[i].iter().copied().collect();
        while let Some(j) = stack.pop() {
            if set.insert(j) {
                stack.extend(under[j].iter().copied());
            }
        }
    }
    let mut group: Vec<usize> = (0..n).collect();
    for i in 0..n {
        for &j in &below[i] {
            if below[j].contains(&i) {
                let (a, b) = (group[i].min(group[j]), group[i].max(group[j]));
                for g in group.iter_mut() {
                    if *g == b {
                        *g = a;
                    }
                }
            }
        }
    }
    let mut groups: Vec<usize> = group.clone();
    groups.sort_unstable();
    groups.dedup();
    if groups.len() < 2 {
        return None;
    }
    let members: Vec<Vec<usize>> = groups
        .iter()
        .map(|&g| (0..n).filter(|&i| group[i] == g).collect())
        .collect();
    // The groups each group lies over. Since `below` is closed, a group's
    // set holds every set of the groups in it, and is larger: ordering by
    // its size visits the groups bottom first.
    let needs: Vec<BTreeSet<usize>> = groups
        .iter()
        .zip(&members)
        .map(|(&g, members)| {
            members
                .iter()
                .flat_map(|&i| below[i].iter().map(|&j| group[j]))
                .filter(|&h| h != g)
                .collect()
        })
        .collect();
    let mut order: Vec<usize> = (0..groups.len()).collect();
    order.sort_by_key(|&k| needs[k].len());
    let mut out: Vec<BTreeSet<usize>> = Vec::new();
    let mut chosen: BTreeSet<usize> = BTreeSet::new();
    walk(&order, 0, &groups, &needs, &mut chosen, &mut out, cap);
    Some(
        out.into_iter()
            .map(|set| {
                groups
                    .iter()
                    .zip(&members)
                    .filter(|(g, _)| set.contains(g))
                    .flat_map(|(_, members)| members.iter().map(|&i| ids[i]))
                    .collect()
            })
            .collect(),
    )
}

/// Every way to extend `chosen` (groups in the lower part) through
/// `order[at..]`, each group taken only when the groups it needs are.
fn walk(
    order: &[usize],
    at: usize,
    groups: &[usize],
    needs: &[BTreeSet<usize>],
    chosen: &mut BTreeSet<usize>,
    out: &mut Vec<BTreeSet<usize>>,
    cap: usize,
) {
    if out.len() >= cap {
        return;
    }
    let Some(&k) = order.get(at) else {
        out.push(chosen.clone());
        return;
    };
    walk(order, at + 1, groups, needs, chosen, out, cap);
    if needs[k].iter().all(|g| chosen.contains(g)) {
        chosen.insert(groups[k]);
        walk(order, at + 1, groups, needs, chosen, out, cap);
        chosen.remove(&groups[k]);
    }
}

/// Union–find over `0..n`.
struct UnionFind {
    parent: Vec<usize>,
}

impl UnionFind {
    fn new(n: usize) -> UnionFind {
        UnionFind {
            parent: (0..n).collect(),
        }
    }

    fn root(&mut self, mut i: usize) -> usize {
        while self.parent[i] != i {
            self.parent[i] = self.parent[self.parent[i]];
            i = self.parent[i];
        }
        i
    }

    fn join(&mut self, a: usize, b: usize) {
        let (ra, rb) = (self.root(a), self.root(b));
        if ra != rb {
            self.parent[ra.max(rb)] = ra.min(rb);
        }
    }
}

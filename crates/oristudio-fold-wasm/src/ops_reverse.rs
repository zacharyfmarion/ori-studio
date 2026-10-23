//! The reverse fold on the bridge (plan Phase 9, research §5.2): the
//! document's `inside-reverse` and `outside-reverse` ops, resolved, landed
//! and asked about through the compound seam ([`crate::compound`]).
//!
//! ```ts
//! // `apps/web/src/fold/engine/foldEngineReverseWire.ts` holds these shapes in full.
//! class FoldEngine {
//!   /** For a reverse op, `{ family: 'reverse', …ReverseAsked }`: what it
//!    *  moves, which kinds land, and the choice it still needs — an opening,
//!    *  or one of the orders listed per kind. The op's kind is not read: the
//!    *  answer is both kinds'. */
//!   compound_analysis(state: number, op: FoldReverseOp, choices?: FoldChoices):
//!     Outcome<FoldCompoundAnalysis>;
//! }
//! ```
//!
//! - **The op** names its line as a fold does — an axiom with its root, a
//!   free line, an existing crease, or the tools' model line — and its tip
//!   side as a fold names its moving side; its seed is the anchor the tip
//!   grows from: every layer on the tip side, the top layers at a sheet
//!   point as the viewer sees them, or flaps by sheet points. Its kind is
//!   the op's.
//! - **Choices** are the engine's own (plan D6): `opening`, per flap that
//!   opens more than one way, its upper block by witnesses; `completion`, the
//!   pairs the completion left free, FOLD `faceOrders` over witnesses.
//! - **Landing** follows the seam: a choice still open is `choice_needed`, a
//!   stored one that no longer resolves `choice_broken`, and the engine's
//!   refusals come with their fixes — the other kind, the flaps in the tip's
//!   way, the flaps that open.
//! - **Asking** (`compound_analysis`, [`CompoundOp::ask`]): the tip and each
//!   flap's openings, the kinds that land with the openings named — a tool
//!   pre-selects the only one, and offers the other only when it lands too —
//!   and what is still to choose: an opening, or, per kind, the orders the
//!   completion leaves, each listed as the `completion` that picks it, the
//!   first [`MAX_ORDERS`] of them. Of both kinds, so the answer does not wait
//!   on the kind. A reverse fold folds along one line, so it also answers the
//!   plain fold's queries: what moves, its picture, its depth choices.

use oristudio_fold::{
    ChoiceCount, ClosurePolicy, Direction, FoldActionGeometry, FoldAnalysis, Placement, PlainFold,
    ReverseAnalysis, ReverseChoices, ReverseFold, ReverseFolded, ReverseKind, ReverseOutcome, Side,
    State, StepSummary, WitnessOrder,
};
use serde::{Deserialize, Serialize};

use crate::compound::{
    CompoundAsked, CompoundLanded, CompoundOp, CompoundStepReport, Parent, compound_refusal, landed,
};
use crate::resolve::{Rejection, along_line};
use crate::wire::{AlongLine, BridgeError, Choices, LineInput, Motion, Point, Refusal, SeedInput};

/// The most orders a choice lists: the ~1% of reverse folds that leave
/// several leave two or three (research §5.2).
pub const MAX_ORDERS: usize = 8;

/// A reverse fold as the document stores it (`FoldReverseOp` without its
/// kind): the line, the tip side and the anchor, as a fold along a line
/// names its line, moving side and seed.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct AlongReverse {
    pub line: LineInput,
    /// A sheet point whose image is on the tip side, when nothing else says.
    #[serde(default)]
    pub moving: Option<Point>,
    /// The tools' alternative to `moving` for a model line.
    #[serde(default)]
    pub side: Option<Side>,
    pub seed: SeedInput,
}

/// A reverse fold resolved in its parent, with its stored choices.
#[derive(Debug, Clone, PartialEq)]
pub struct ReverseStep {
    pub op: ReverseFold,
    pub choices: ReverseChoices,
}

/// The op resolved in `parent`: its line, side and anchor as a fold's. Its
/// choices are checked before (`resolve::check_choices`).
pub fn resolve_reverse(
    parent: &State,
    along: &AlongReverse,
    kind: ReverseKind,
    choices: &Choices,
) -> Result<ReverseStep, Rejection> {
    let fold = AlongLine {
        landing: Default::default(),
        line: along.line.clone(),
        direction: None,
        motion: Motion {
            moving: along.moving,
            side: along.side,
            seed: along.seed.clone(),
            placement: Placement::OnTop,
            closure: ClosurePolicy::Include,
        },
    };
    // The direction is the viewer's top, which the tip's depth anchor counts
    // from as a reverse fold does.
    let resolved = along_line(
        parent,
        &fold,
        Direction::Valley,
        oristudio_fold::ActionKind::Fold,
        choices.root.as_ref(),
    )?;
    let plain = resolved
        .plain(parent)
        .ok_or_else(|| BridgeError::InvalidInput("a reverse fold needs a line".to_string()))?
        .map_err(Rejection::from)?;
    Ok(ReverseStep {
        op: ReverseFold {
            line: plain.line,
            side: plain.side,
            anchor: plain.seed,
            kind,
        },
        choices: ReverseChoices {
            openings: choices.openings().to_vec(),
            order: choices.completion().cloned(),
        },
    })
}

impl ReverseStep {
    /// The plain fold its line, side and anchor name.
    fn plain_fold(&self) -> PlainFold {
        PlainFold::new(self.op.line, self.op.side, Direction::Valley)
            .with_seed(self.op.anchor.clone())
    }

    /// The moving side's flaps (the plain fold's, which a refusal's
    /// `include_flaps` indexes), the tip's among them picked, the tip's faces
    /// moving.
    fn fold_analysis(&self, parent: &State) -> Result<FoldAnalysis, Refusal> {
        let reverse = parent.analyse_reverse(&self.op).map_err(Refusal::from)?;
        let direction = parent.view().model_direction(self.op.kind.seen_direction());
        let (flaps, picked) = match parent.analyse_fold(&self.plain_fold()) {
            Ok(plain) => (plain.flaps, reverse.flaps.iter().map(|f| f.index).collect()),
            Err(_) => (
                reverse.flaps.iter().map(|f| f.flap.clone()).collect(),
                (0..reverse.flaps.len()).collect(),
            ),
        };
        Ok(FoldAnalysis {
            line: reverse.line,
            side: reverse.side,
            snap: reverse.snap,
            direction,
            flaps,
            picked,
            added: Vec::new(),
            moving: reverse.tip,
        })
    }
}

impl CompoundOp for ReverseStep {
    fn order_selection(
        &self,
        parent: &State,
        query: &crate::order_selection::OrderQuery,
    ) -> Result<crate::order_selection::OrderSelection, Refusal> {
        use crate::order_selection::OrderSelection;
        match parent.reverse_fold_within(&self.op, &self.choices, &query.limits()) {
            Ok(ReverseOutcome::Landed(folded)) => {
                Ok(OrderSelection::unique(folded.report.stored.order))
            }
            Ok(ReverseOutcome::ChooseOrder(choice)) => {
                OrderSelection::pick(choice.completions(), query, |pick| {
                    choice.pick(pick).map(|folded| folded.report.stored.order)
                })
            }
            Ok(ReverseOutcome::ChooseOpening(_)) => Err(crate::compound::choice_needed(
                crate::compound::NeededChoice::Opening,
            )),
            Err(refused) => Err(crate::compound::compound_refusal(refused)),
        }
    }

    fn analysis(&self, parent: &State) -> Option<Result<FoldAnalysis, Refusal>> {
        Some(self.fold_analysis(parent))
    }

    fn action(&self, parent: &State) -> Option<Result<FoldActionGeometry, Refusal>> {
        Some(
            parent
                .reverse_action(&self.op, &self.choices)
                .map_err(compound_refusal),
        )
    }

    fn plain(&self) -> Option<PlainFold> {
        Some(self.plain_fold())
    }

    fn ask(&self, parent: &State) -> Result<Result<CompoundAsked, Refusal>, BridgeError> {
        Ok(ask(parent, self).map(|asked| CompoundAsked::Reverse(Box::new(asked))))
    }

    fn apply(&self, parent: &State) -> Result<Box<dyn CompoundLanded>, Refusal> {
        let folded = landed(parent.reverse_fold(&self.op, &self.choices))?;
        Ok(Box::new(Landed(folded)))
    }
}

/// A landed reverse fold, held by the bridge.
#[derive(Debug)]
struct Landed(Box<ReverseFolded>);

impl CompoundLanded for Landed {
    fn state(&self) -> &State {
        &self.0.state
    }

    fn report(&self) -> CompoundStepReport {
        CompoundStepReport::Reverse(Box::new(self.0.report.clone()))
    }

    fn summary(&self, parent: Parent<'_>) -> Result<Result<StepSummary, Refusal>, BridgeError> {
        Ok(self.0.summary(parent?).map_err(Refusal::from))
    }

    fn action(
        &self,
        parent: Parent<'_>,
    ) -> Result<Option<Result<FoldActionGeometry, Refusal>>, BridgeError> {
        Ok(Some(self.0.action(parent?).map_err(Refusal::from)))
    }
}

/// What the tools learn of a reverse fold before it lands: of both kinds,
/// so one answer serves a kind control that has not chosen yet.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ReverseAsked {
    /// The tip, the line it folds along and each flap's openings.
    pub analysis: ReverseAnalysis,
    /// The kinds that land with the openings named; none while a flap's
    /// opening is still to choose.
    pub kinds: Vec<ReverseKind>,
    /// A flap opens more than one way and the choices name none of its
    /// openings (`analysis.flaps[k].openings[j].stored`): no kind lands until
    /// one is stored.
    pub opening: bool,
    /// Per kind that lands with more than one order, the orders to choose
    /// from; a kind that lands with one has none.
    pub orders: Vec<ReverseOrders>,
}

/// The orders a reverse fold of one kind leaves (research §5.2: the ~1%
/// that are genuine alternatives, mostly two or three).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ReverseOrders {
    pub kind: ReverseKind,
    /// The true ‹ n of m ›.
    pub count: ChoiceCount,
    /// The first [`MAX_ORDERS`], each the `completion` that picks it.
    pub orders: Vec<WitnessOrder>,
    /// More are listed than `orders` holds.
    pub more: bool,
}

/// The answer for `step`'s line, side, anchor and openings, of both kinds.
/// A stored completion is not asked about: the orders are listed whichever
/// one is stored, so a chooser can move between them.
fn ask(parent: &State, step: &ReverseStep) -> Result<ReverseAsked, Refusal> {
    let choices = ReverseChoices {
        openings: step.choices.openings.clone(),
        order: None,
    };
    let analysis = parent.analyse_reverse(&step.op).map_err(Refusal::from)?;
    let kinds = parent
        .reverse_kinds(&step.op, &choices)
        .map_err(compound_refusal)?;
    // An opening to choose: a flap with several that the choices name none of.
    let opening = analysis.flaps.iter().any(|flap| {
        flap.openings.len() > 1
            && !flap
                .openings
                .iter()
                .any(|o| choices.openings.contains(&o.stored))
    });
    let mut orders = Vec::new();
    // Only the kinds that land are folded: a refusal is the preview's to
    // say, and its diagnosis is the costly part.
    for &kind in &kinds {
        let op = ReverseFold {
            kind,
            ..step.op.clone()
        };
        match parent.reverse_fold(&op, &choices) {
            Ok(ReverseOutcome::ChooseOrder(choice)) => {
                let (picks, more) = choice.choices(MAX_ORDERS);
                orders.push(ReverseOrders {
                    kind,
                    count: choice.count(),
                    orders: picks
                        .iter()
                        .filter_map(|pick| choice.pick(pick).ok()?.report.stored.order)
                        .collect(),
                    more,
                });
            }
            Ok(ReverseOutcome::Landed(_) | ReverseOutcome::ChooseOpening(_)) | Err(_) => {}
        }
    }
    Ok(ReverseAsked {
        analysis,
        kinds,
        opening,
        orders,
    })
}

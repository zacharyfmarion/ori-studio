//! Sinks on the bridge (plan Phase 11, research §5.4): the document's
//! `open-sink`, `closed-sink` and `unsink` ops resolved in their parent and
//! landed, and the queries a sink tool asks before it commits one.
//!
//! ```ts
//! // `apps/web/src/fold/engine/foldEngineSinkWire.ts` holds these shapes.
//! class FoldEngine {
//!   /** For a sink op, `{ family: 'sink', analysis, open }`: the point it
//!    *  names and how it sinks — its outline, its outside's letter, its apex
//!    *  and the square line (the open sink's landmark), why an open sink is
//!    *  refused, and its pockets, each with what a step stores to choose
//!    *  it. Not asked of an unsink. */
//!   compound_analysis(state: number, op: FoldSinkOp, choices?: FoldChoices):
//!     Outcome<FoldCompoundAnalysis>;
//!   /** How many orders the sink leaves with these choices: one when it is
//!    *  decided, and nothing to choose. */
//!   sink_orders(state: number, op: FoldSinkOp, choices?: FoldChoices):
//!     Outcome<{ count: ChoiceCount; components: ComponentCount[] }>;
//!   /** The completion a step stores for one listed order per component;
//!    *  null when the sink is decided. */
//!   sink_pick(state: number, op: FoldSinkOp, choices: FoldChoices | undefined,
//!     choice: Uint32Array): Outcome<{ completion: WitnessOrder | null }>;
//!   /** For an unsink op, the sunk points on its side of its line that it
//!    *  can pull back out, each a flap of that side: what an unsink tool
//!    *  names when the folder has named none. Its seed is not read. */
//!   sunk_points(state: number, op: FoldSinkOp, choices?: FoldChoices):
//!     Outcome<{ line: Line; side: Side; snap: Snap; points: Flap[] }>;
//! }
//! ```
//!
//! A sink lands through `apply`, like every step, so a commit lands exactly
//! as a replay will: its line resolves as a fold's (an axiom with its root,
//! a free line, an existing crease, or the tools' model line), `moving` or
//! the seed's point names the side the point's tip is on — for an unsink,
//! the side the sunk tip lies on — and the seed names the point (plan D6).
//!
//! A sink folds along one line, so it also answers the plain fold's queries
//! a tool previews with, as the reverse folds do: what moves (`analyse`: the
//! moving side's flaps, the point's picked, its faces moving), its picture
//! (`action`: the point's plain fold seen as a mountain, with the push onto
//! its crown; an unsink's seen as a valley, pulled), and the plain fold its
//! line and anchor name (`depth_choices`). A landed one is pictured the same
//! way (`step_action`).
//! The stored pocket and completion are the engine's: a sheet point on the
//! faces either side of the pocket, and FOLD `faceOrders` triples over
//! witnesses. A sink that needs a choice the step does not store is refused
//! `choice_needed` (its `pocket` or its `completion`); one whose stored
//! choice no longer resolves, `choice_broken` — the compound folds' own, on
//! the seam's one path (`crate::compound`). Either marks a replayed step
//! broken. A landed one reports as the step's `compound`,
//! `{ family: 'sink', step, … }`, its motion's legs among it.

use oristudio_fold::{
    ActionKind, ChoiceCount, CompoundRefused, Direction, FaceId, FoldActionGeometry, FoldAnalysis,
    PlainFold, Side, SinkChoices, SinkFold, SinkFolded, SinkKind, SinkOutcome, SinkPoint, State,
    StepSummary, StoredPocket, SunkPoints, Unsink, WitnessOrder,
};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use crate::bridge::{Bridge, settle};
use crate::compound::{
    CompoundAsked, CompoundLanded, CompoundOp, CompoundStepReport, NeededChoice, Parent,
    choice_needed, compound_refusal, landed,
};
use crate::io::ComponentCount;
use crate::resolve::{Rejection, along_line, check_choices, finite_point};
use crate::wire::{
    AlongLine, BridgeError, Choices, LineInput, Motion, Op, Outcome, Point, Refusal, SeedInput,
};
use crate::{FoldEngine, bridge_error, parse, parse_choices, to_js_value};

/// A sink op (`FoldSinkOp`): the line, as a fold along one names it; the
/// side, by `moving` (or the tools' `side` of a model line) or the seed's
/// point; and the seed naming the point, or the sunk tip of an unsink.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct SinkOp {
    pub line: LineInput,
    #[serde(default)]
    pub moving: Option<Point>,
    #[serde(default)]
    pub side: Option<Side>,
    pub seed: SeedInput,
}

/// A sink op resolved in its parent: the engine's sink or unsink, with its
/// stored choices.
#[derive(Debug, Clone)]
pub enum SinkResolved {
    Sink { op: SinkFold, choices: SinkChoices },
    Unsink { op: Unsink, choices: SinkChoices },
}

impl SinkResolved {
    fn outcome(&self, parent: &State) -> Result<SinkOutcome, CompoundRefused> {
        match self {
            SinkResolved::Sink { op, choices } => parent.sink(op, choices),
            SinkResolved::Unsink { op, choices } => parent.unsink(op, choices),
        }
    }

    /// The plain fold its line, side and anchor name.
    fn plain_fold(&self) -> PlainFold {
        let (line, side, anchor) = match self {
            SinkResolved::Sink { op, .. } => (op.line, op.side, &op.anchor),
            SinkResolved::Unsink { op, .. } => (op.line, op.side, &op.anchor),
        };
        PlainFold::new(line, side, Direction::Valley).with_seed(anchor.clone())
    }

    /// The moving side's flaps (the section's along ℓ, in the order a
    /// refusal's `pick_flap` lists them), the point's — or the sunk tip's —
    /// among them picked, its faces moving, seen as the step's picture sees
    /// it: a sink a mountain, an unsink a valley. The flaps are the section's,
    /// not a plain fold's analysis's: a plain fold of a sunk tip alone takes
    /// the paper round it along, and everything would move.
    fn fold_analysis(&self, parent: &State) -> Result<FoldAnalysis, Refusal> {
        let (line, side, snap, moving, seen) = match self {
            SinkResolved::Sink { op, .. } => {
                let point = parent.analyse_sink(op)?;
                (
                    point.line,
                    point.side,
                    point.snap,
                    point.point.faces,
                    Direction::Mountain,
                )
            }
            SinkResolved::Unsink { op, .. } => {
                let tip = parent.analyse_unsink(op)?;
                (tip.line, tip.side, tip.snap, tip.faces, Direction::Valley)
            }
        };
        let within = |faces: &[FaceId]| {
            !faces.is_empty() && faces.iter().all(|f| moving.binary_search(f).is_ok())
        };
        let flaps = parent
            .cross_section(&line, side)
            .map(|section| section.flaps)
            .unwrap_or_default();
        let picked = (0..flaps.len())
            .filter(|&k| within(&flaps[k].faces))
            .collect();
        Ok(FoldAnalysis {
            line,
            side,
            snap,
            direction: parent.view().model_direction(seen),
            flaps,
            picked,
            added: Vec::new(),
            moving,
        })
    }
}

/// What a sink tool previews (`compound_analysis`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SinkAnalysed {
    pub analysis: SinkPoint,
    /// Why an open sink of this point is refused, with its fixes; none when
    /// one may land.
    pub open: Option<Refusal>,
}

/// How many orders a sink leaves (`sink_orders`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SinkOrders {
    pub count: ChoiceCount,
    pub components: Vec<ComponentCount>,
}

/// What a step stores for a pick (`sink_pick`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SinkPicked {
    pub completion: Option<WitnessOrder>,
}

/// A sink op and its choices, resolved in `parent`: the line as a fold's,
/// and the choices a sink takes — a closed sink's pocket, any sink's
/// completion, an axiom line's root — which are checked before
/// (`resolve::check_choices`, by `wire::Op::takes`).
pub fn resolve(
    parent: &State,
    op: &Op,
    sink: &SinkOp,
    choices: &Choices,
) -> Result<SinkResolved, Rejection> {
    let closed = matches!(op, Op::ClosedSink(_));
    let along = AlongLine {
        landing: Default::default(),
        line: sink.line.clone(),
        direction: None,
        motion: Motion {
            moving: sink.moving,
            side: sink.side,
            seed: sink.seed.clone(),
            placement: Default::default(),
            closure: Default::default(),
        },
    };
    // The direction is no part of a sink: any one resolves the line.
    let resolved = along_line(
        parent,
        &along,
        Direction::Valley,
        ActionKind::Fold,
        choices.root.as_ref(),
    )?;
    let fold = match resolved.plain(parent) {
        Some(Ok(fold)) => fold,
        Some(Err(refusal)) => return Err(refusal.into()),
        None => {
            return Err(BridgeError::InvalidInput(
                "a sink's line resolves to no fold line".to_string(),
            )
            .into());
        }
    };
    let pocket = match choices.pocket {
        Some([above, below]) => {
            finite_point("pocket", above)?;
            finite_point("pocket", below)?;
            Some(StoredPocket { above, below })
        }
        None => None,
    };
    let choices = SinkChoices {
        pocket,
        order: choices
            .completion
            .clone()
            .filter(|order| !order.orders.is_empty()),
    };
    Ok(match op {
        Op::Unsink(_) => SinkResolved::Unsink {
            op: Unsink {
                line: fold.line,
                side: fold.side,
                anchor: fold.seed,
            },
            choices,
        },
        _ => SinkResolved::Sink {
            op: SinkFold {
                line: fold.line,
                side: fold.side,
                anchor: fold.seed,
                kind: if closed {
                    SinkKind::Closed
                } else {
                    SinkKind::Open
                },
            },
            choices,
        },
    })
}

impl CompoundOp for SinkResolved {
    fn order_selection(
        &self,
        parent: &State,
        query: &crate::order_selection::OrderQuery,
    ) -> Result<crate::order_selection::OrderSelection, Refusal> {
        use crate::order_selection::OrderSelection;
        match match self {
            Self::Sink { op, choices } => parent.sink_within(op, choices, &query.limits()),
            Self::Unsink { op, choices } => parent.unsink_within(op, choices, &query.limits()),
        } {
            Ok(SinkOutcome::Landed(folded)) => {
                Ok(OrderSelection::unique(folded.report.stored.order))
            }
            Ok(SinkOutcome::ChooseOrder(choice)) => {
                OrderSelection::pick(choice.completions(), query, |pick| {
                    choice.pick(pick).map(|folded| folded.report.stored.order)
                })
            }
            Ok(SinkOutcome::ChoosePocket(_)) => Err(crate::compound::choice_needed(
                crate::compound::NeededChoice::Pocket,
            )),
            Err(refused) => Err(crate::compound::compound_refusal(refused)),
        }
    }

    fn analysis(&self, parent: &State) -> Option<Result<FoldAnalysis, Refusal>> {
        Some(self.fold_analysis(parent))
    }

    fn action(&self, parent: &State) -> Option<Result<FoldActionGeometry, Refusal>> {
        Some(
            match self {
                SinkResolved::Sink { op, .. } => parent.sink_action(op),
                SinkResolved::Unsink { op, .. } => parent.unsink_action(op),
            }
            .map_err(Refusal::from),
        )
    }

    fn plain(&self) -> Option<PlainFold> {
        Some(self.plain_fold())
    }

    /// What a sink tool previews: the point and how it sinks. An unsink has
    /// no point to analyse, and is the caller's mistake: its tool asks for
    /// the sunk points instead ([`sunk_points`]).
    fn ask(&self, parent: &State) -> Result<Result<CompoundAsked, Refusal>, BridgeError> {
        let SinkResolved::Sink { op, .. } = self else {
            return Err(BridgeError::InvalidInput(
                "an unsink has no point to analyse: it unsinks the tip its seed names".to_string(),
            ));
        };
        Ok(parent
            .analyse_sink(op)
            .map(|analysis| {
                CompoundAsked::Sink(Box::new(SinkAnalysed {
                    open: analysis.open.clone().map(Refusal::from),
                    analysis,
                }))
            })
            .map_err(Refusal::from))
    }

    /// Land it: refused when it needs a choice the step does not store, or
    /// a stored one no longer resolves.
    fn apply(&self, parent: &State) -> Result<Box<dyn CompoundLanded>, Refusal> {
        Ok(Box::new(Landed(landed(self.outcome(parent))?)))
    }
}

/// A landed sink or unsink, held by the bridge: its summary counts the
/// layers along ℓ on the side the paper moved from; its picture is the one
/// its preview showed, with the landed state's cover.
#[derive(Debug)]
struct Landed(Box<SinkFolded>);

impl CompoundLanded for Landed {
    fn state(&self) -> &State {
        &self.0.state
    }

    fn report(&self) -> CompoundStepReport {
        CompoundStepReport::Sink(Box::new(self.0.report.clone()))
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

/// How many orders a sink leaves with these choices: one when it is
/// decided.
pub fn sink_orders(
    bridge: &Bridge,
    state: u32,
    op: &Op,
    choices: &Choices,
) -> Result<Outcome<SinkOrders>, BridgeError> {
    let (parent, sink) = match sink_of(bridge, state, op, choices)? {
        Ok(found) => found,
        Err(refusal) => return Ok(Outcome::Refused(refusal)),
    };
    Ok(match sink.outcome(parent) {
        Ok(SinkOutcome::Landed(_)) => Outcome::Ok(SinkOrders {
            count: ChoiceCount {
                orders: 1,
                exact: true,
            },
            components: Vec::new(),
        }),
        Ok(SinkOutcome::ChooseOrder(choice)) => Outcome::Ok(SinkOrders {
            count: choice.count(),
            components: choice
                .completions()
                .components()
                .iter()
                .map(|c| ComponentCount {
                    pairs: c.pairs.iter().map(|pair| [pair.lo(), pair.hi()]).collect(),
                    orders: c.orders.len(),
                    truncated: c.truncated,
                })
                .collect(),
        }),
        Ok(SinkOutcome::ChoosePocket(_)) => Outcome::Refused(choice_needed(NeededChoice::Pocket)),
        Err(refused) => Outcome::Refused(compound_refusal(refused)),
    })
}

/// The completion a step stores for `choice`, one listed order per
/// component; none when the sink is decided.
pub fn sink_pick(
    bridge: &Bridge,
    state: u32,
    op: &Op,
    choices: &Choices,
    choice: &[usize],
) -> Result<Outcome<SinkPicked>, BridgeError> {
    let (parent, sink) = match sink_of(bridge, state, op, choices)? {
        Ok(found) => found,
        Err(refusal) => return Ok(Outcome::Refused(refusal)),
    };
    Ok(match sink.outcome(parent) {
        Ok(SinkOutcome::Landed(_)) => Outcome::Ok(SinkPicked { completion: None }),
        Ok(SinkOutcome::ChooseOrder(pending)) => match pending.pick(choice) {
            Ok(folded) => Outcome::Ok(SinkPicked {
                completion: folded.report.stored.order,
            }),
            Err(refusal) => Outcome::Refused(refusal.into()),
        },
        Ok(SinkOutcome::ChoosePocket(_)) => Outcome::Refused(choice_needed(NeededChoice::Pocket)),
        Err(refused) => Outcome::Refused(compound_refusal(refused)),
    })
}

/// The sunk points on an unsink op's side of its line that it can pull
/// back out (`State::sunk_points`): what an unsink tool names when the folder
/// has named none. The op's seed is not read; a sink op is the caller's
/// mistake.
pub fn sunk_points(
    bridge: &Bridge,
    state: u32,
    op: &Op,
    choices: &Choices,
) -> Result<Outcome<SunkPoints>, BridgeError> {
    if !matches!(op, Op::Unsink(_)) {
        return Err(BridgeError::InvalidInput(format!(
            "a {} step pulls out no sunk point: give an unsink op",
            op.kind()
        )));
    }
    let (parent, unsink) = match sink_of(bridge, state, op, choices)? {
        Ok(found) => found,
        Err(refusal) => return Ok(Outcome::Refused(refusal)),
    };
    let SinkResolved::Unsink { op, .. } = unsink else {
        return Err(BridgeError::InvalidInput(
            "an unsink op resolved to a sink".to_string(),
        ));
    };
    Ok(parent
        .sunk_points(&op.line, op.side)
        .map_err(Refusal::from)
        .into())
}

/// The held state and the sink op resolved in it, its choices checked as
/// `apply` checks them; a refusal when it does not resolve. Any other op is
/// the caller's mistake.
fn sink_of<'b>(
    bridge: &'b Bridge,
    state: u32,
    op: &Op,
    choices: &Choices,
) -> Result<Result<(&'b State, SinkResolved), Refusal>, BridgeError> {
    let parent = bridge.state(state)?;
    let (Op::OpenSink(sink) | Op::ClosedSink(sink) | Op::Unsink(sink)) = op else {
        return Err(BridgeError::InvalidInput(format!(
            "a {} step is no sink: give an open-sink, closed-sink or unsink op",
            op.kind()
        )));
    };
    let resolved =
        check_choices(op.takes(), choices).and_then(|()| resolve(parent, op, sink, choices));
    Ok(settle(resolved)?.map(|sink| (parent, sink)))
}

#[wasm_bindgen]
impl FoldEngine {
    /// How many orders a sink leaves with these choices.
    pub fn sink_orders(
        &self,
        state: u32,
        op: JsValue,
        choices: JsValue,
    ) -> Result<JsValue, JsValue> {
        let op: Op = parse("op", op)?;
        let choices = parse_choices(choices)?;
        to_js_value(&sink_orders(&self.inner, state, &op, &choices).map_err(bridge_error)?)
    }

    /// The completion a step stores for one listed order per component.
    pub fn sink_pick(
        &self,
        state: u32,
        op: JsValue,
        choices: JsValue,
        choice: &[u32],
    ) -> Result<JsValue, JsValue> {
        let op: Op = parse("op", op)?;
        let choices = parse_choices(choices)?;
        let choice: Vec<usize> = choice.iter().map(|&k| k as usize).collect();
        to_js_value(&sink_pick(&self.inner, state, &op, &choices, &choice).map_err(bridge_error)?)
    }

    /// The sunk points an unsink op's line and side can pull back out.
    pub fn sunk_points(
        &self,
        state: u32,
        op: JsValue,
        choices: JsValue,
    ) -> Result<JsValue, JsValue> {
        let op: Op = parse("op", op)?;
        let choices = parse_choices(choices)?;
        to_js_value(&sunk_points(&self.inner, state, &op, &choices).map_err(bridge_error)?)
    }
}

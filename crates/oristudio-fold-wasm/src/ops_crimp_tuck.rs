//! The crimp and the tuck across the bridge (plan Phase 11): the document's
//! `crimp` and `tuck` ops resolved in their parent and landed through the
//! compound seam ([`crate::compound`]), and their tools' calls.
//!
//! ```ts
//! // `apps/web/src/fold/engine/foldEngineCrimpTuckWire.ts` holds these shapes in full.
//! class FoldEngine {
//!   /** For a crimp, `{ family: 'crimp', analysis, kinds }`: its tip at ℓ1
//!    *  with its flaps' openings, what lies beyond ℓ2, and the kinds that
//!    *  land (null while a flap opening several ways is still to choose).
//!    *  For a tuck, `{ family: 'tuck', analysis }`: what it moves and every
//!    *  layer its block lands on, each with whether it takes the tuck. */
//!   compound_analysis(state: number, op: CrimpOp | TuckOp, choices?: FoldChoices):
//!     Outcome<FoldCompoundAnalysis>;
//!   /** Fold it: landed; an opening to choose; or the orders to choose
//!    *  from, each already landed under its own handle — held as `apply`
//!    *  holds a step, its report the step's `compound` — with what its step
//!    *  stores. Every landed state stays held until released. */
//!   crimp(state: number, op: CrimpOp, choices?: FoldChoices): Outcome<CompoundTried>;
//!   tuck(state: number, op: TuckOp, choices?: FoldChoices): Outcome<CompoundTried>;
//! }
//! ```
//!
//! A stored crimp or tuck replays through `apply`, as every step does: it
//! lands only when its stored choices decide it, and is refused
//! `choice_needed` when they do not and `choice_broken` when they no longer
//! resolve, so the replay marks the step broken (plan D6). The ops' lines are
//! the document's anchors: a tuck's line may be an axiom with its stored
//! root; a crimp's first line may, and its second is named by two sheet
//! points or a crease, since a step stores one root. A landed one keeps its
//! step's summary as it lands, so its parent need not stay held for that.
//!
//! Each also answers the plain fold's queries, as a reverse fold does: a
//! crimp of its tip at ℓ1 — what moves, the plain fold along ℓ1 for the depth
//! picker, its picture (ℓ1 and the pleat arrow across both lines) — and a
//! tuck of its block against its target, a plain fold's in all three. A
//! landed one's picture is drawn on its parent from its report
//! (`step_action`).

use oristudio_fold::complete::Deadline;
use oristudio_fold::numerics::MIN_FEATURE;
use oristudio_fold::{
    ActionKind, ChoiceCount, CompletionLimits, Completions, CrimpAnalysis, CrimpFold, CrimpFolded,
    CrimpOutcome, Direction, FoldActionGeometry, FoldAnalysis, LineRefusal, PlainFold,
    ReverseChoices, ReverseKind, Side, State, StepSummary, StoredOpening, TuckAnalysis,
    TuckChoices, TuckFold, TuckFolded, TuckOutcome, WitnessOrder,
};
use oristudio_geometry::Line;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use crate::bridge::{Bridge, settle};
use crate::compound::{
    CompoundAsked, CompoundLanded, CompoundOp, CompoundStepReport, Parent, compound_refusal, landed,
};
use crate::resolve::{self, Rejection, check_choices, finite_point, model_line};
use crate::wire::{
    AlongLine, Applied, BridgeError, Choices, LineInput, Motion, Outcome, Point, Refusal,
    SeedInput, Takes,
};
use crate::{FoldEngine, bridge_error, parse, parse_choices, to_js_value};

/// The most orders a choice lands at once; past it, the rest are counted,
/// not landed.
pub const MAX_CANDIDATES: usize = 16;

/// What a tuck's target listing may spend, in milliseconds. A tool lists
/// them once per line, side, direction and seed (plan D14, tier 2), and
/// each target is a completion: at 129–256 faces natively about 60 ms, so a
/// deep stack's thirty would take seconds. A target the budget leaves
/// undecided (`feasible: null`) is one the tool lets the fold itself decide.
pub const TUCK_TARGETS_BUDGET_MS: f64 = 150.0;

/// Milliseconds on a monotonic clock, for a completion's deadline: the
/// page's `performance.now()` in a browser or worker.
#[cfg(target_arch = "wasm32")]
pub(crate) mod clock {
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    extern "C" {
        #[wasm_bindgen(js_namespace = performance, js_name = now)]
        fn performance_now() -> f64;
    }

    pub fn now_ms() -> f64 {
        performance_now()
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) mod clock {
    use std::sync::OnceLock;
    use std::time::Instant;

    pub fn now_ms() -> f64 {
        static START: OnceLock<Instant> = OnceLock::new();
        START.get_or_init(Instant::now).elapsed().as_secs_f64() * 1e3
    }
}

/// A crimp (`FoldCrimpOp`).
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct CrimpOp {
    /// ℓ1, the line nearer the body.
    pub line: LineInput,
    /// ℓ2, the line nearer the tip.
    pub second: LineInput,
    /// Inside or outside, on both lines.
    pub crimp: ReverseKind,
    /// A sheet point on ℓ1's tip side, when the seed does not name one.
    #[serde(default)]
    pub moving: Option<Point>,
    /// The tools' alternative to `moving` for a model line.
    #[serde(default)]
    pub side: Option<Side>,
    /// What the tip grows from.
    pub seed: SeedInput,
}

impl CrimpOp {
    /// Its choices (`wire::Op::takes`): its flaps' openings and its
    /// completion, and a root of ℓ1's when that is an axiom.
    pub fn takes(&self) -> Takes {
        Takes {
            root: self.line.is_axiom(),
            completion: true,
            opening: true,
            pocket: false,
        }
    }
}

/// A tuck (`FoldTuckOp`): valley under its target, mountain over it.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct TuckOp {
    pub line: LineInput,
    pub direction: Direction,
    #[serde(default)]
    pub moving: Option<Point>,
    #[serde(default)]
    pub side: Option<Side>,
    pub seed: SeedInput,
    /// A sheet point inside the layer the block lands against.
    pub target: Point,
    #[serde(default, rename = "additionalTargets")]
    pub additional_targets: Vec<Point>,
}

impl TuckOp {
    /// Its choices (`wire::Op::takes`): its completion, and a root when its
    /// line is an axiom's. A tuck opens no flap.
    pub fn takes(&self) -> Takes {
        Takes {
            root: self.line.is_axiom(),
            completion: true,
            opening: false,
            pocket: false,
        }
    }
}

/// What a crimp or tuck stores (`FoldChoices`' keys): the openings chosen
/// among several, and the order chosen among several.
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
pub struct StoredChoices {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub opening: Vec<StoredOpening>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion: Option<WitnessOrder>,
}

/// A crimp or tuck its own call landed, held as `apply` holds a step (its
/// report the step's `compound`), with what its step stores beside a root
/// of its line's.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Candidate {
    #[serde(flatten)]
    pub step: Applied,
    pub stored: StoredChoices,
}

/// Where a crimp's or tuck's own call got to.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum CompoundTried {
    Landed(Box<Candidate>),
    /// A flap opens several ways: store one of each such flap's openings
    /// (`choices.opening`) and fold again.
    ChooseOpening {
        analysis: Box<CrimpAnalysis>,
    },
    /// More than one order fits: each landed (up to [`MAX_CANDIDATES`]).
    ChooseOrder {
        /// The true ‹ n of m ›, and whether it is exact.
        orders: u64,
        exact: bool,
        candidates: Vec<Candidate>,
    },
}

/// A crimp's analysis and the kinds that land.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CrimpAnalysed {
    pub analysis: CrimpAnalysis,
    pub kinds: Option<Vec<ReverseKind>>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TuckAnalysed {
    pub analysis: TuckAnalysis,
}

/// A stored order, none when it is empty: as the document reads it, an
/// empty one is no choice.
fn order(choices: &Choices) -> Option<WitnessOrder> {
    choices
        .completion
        .clone()
        .filter(|o| !o.faces.is_empty() || !o.orders.is_empty())
}

/// A crimp's choices, as the engine takes them.
fn crimp_choices(choices: &Choices) -> ReverseChoices {
    ReverseChoices {
        openings: choices.opening.clone().unwrap_or_default(),
        order: order(choices),
    }
}

/// What a crimp's step stores, by the document's keys.
fn stored(choices: &ReverseChoices) -> StoredChoices {
    StoredChoices {
        opening: choices.openings.clone(),
        completion: choices.order.clone(),
    }
}

/// What a tuck's step stores, by the document's keys.
fn tuck_stored(choices: &TuckChoices) -> StoredChoices {
    StoredChoices {
        opening: Vec::new(),
        completion: choices.order.clone(),
    }
}

/// The plain fold a line, a side and a seed name in `parent`: the line, its
/// moving side and the seed resolved as a valley or mountain step's.
fn plain(
    parent: &State,
    line: &LineInput,
    direction: Direction,
    moving: Option<Point>,
    side: Option<Side>,
    seed: &SeedInput,
    root: Option<&Line>,
) -> Result<PlainFold, Rejection> {
    let along = AlongLine {
        landing: Default::default(),
        line: line.clone(),
        direction: Some(direction),
        motion: Motion {
            moving,
            side,
            seed: seed.clone(),
            placement: Default::default(),
            closure: Default::default(),
        },
    };
    let resolved = resolve::along_line(parent, &along, direction, ActionKind::Fold, root)?;
    match resolved.plain(parent) {
        Some(fold) => fold.map_err(Rejection::from),
        None => Err(BridgeError::InvalidInput("the line names no fold".to_string()).into()),
    }
}

/// A crimp's second line in `parent`'s model frame: through two sheet
/// points, along a crease, or (the tools') a model line.
fn second_line(parent: &State, line: &LineInput) -> Result<Line, Rejection> {
    match line {
        LineInput::Free { through: [a, b] } => {
            finite_point("second.through", *a)?;
            finite_point("second.through", *b)?;
            let point = |p: Point| {
                parent
                    .resolve_point(p)
                    .ok_or(LineRefusal::PointOffPaper { point: p })
            };
            let (ia, ib) = (point(*a)?, point(*b)?);
            let distance = (ib[0] - ia[0]).hypot(ib[1] - ia[1]);
            Line::from_points(ia, ib)
                .filter(|_| distance >= MIN_FEATURE)
                .ok_or_else(|| {
                    LineRefusal::FreeLineTooShort {
                        a: *a,
                        b: *b,
                        distance,
                    }
                    .into()
                })
        }
        LineInput::Crease { at } => {
            let (segment, _) = resolve::crease(parent, *at)?;
            if segment.length() < MIN_FEATURE {
                return Err(LineRefusal::SegmentTooShort { segment }.into());
            }
            parent
                .resolve_segment(&segment)
                .ok_or_else(|| LineRefusal::SegmentNotOnAFace { segment }.into())
        }
        LineInput::Model { line } => Ok(model_line(line)?.0),
        LineInput::Axiom { .. } => Err(BridgeError::InvalidInput(
            "a crimp's second line is named by two sheet points or a crease: a step stores one root"
                .to_string(),
        )
        .into()),
    }
}

/// A crimp resolved in its parent, with its stored choices.
#[derive(Debug, Clone)]
pub struct CrimpStep {
    pub fold: CrimpFold,
    pub choices: ReverseChoices,
}

/// A tuck resolved in its parent, with its stored choice.
#[derive(Debug, Clone)]
pub struct TuckStep {
    pub fold: TuckFold,
    pub choices: TuckChoices,
}

/// A crimp op resolved in `parent`. Its choices are checked before
/// (`resolve::check_choices`).
pub fn resolve_crimp(
    parent: &State,
    op: &CrimpOp,
    choices: &Choices,
) -> Result<CrimpStep, Rejection> {
    let first = plain(
        parent,
        &op.line,
        Direction::Valley,
        op.moving,
        op.side,
        &op.seed,
        choices.root.as_ref(),
    )?;
    Ok(CrimpStep {
        fold: CrimpFold {
            first: first.line,
            second: second_line(parent, &op.second)?,
            side: first.side,
            anchor: first.seed,
            kind: op.crimp,
        },
        choices: crimp_choices(choices),
    })
}

/// A tuck op resolved in `parent`. Its choices are checked before.
pub fn resolve_tuck(parent: &State, op: &TuckOp, choices: &Choices) -> Result<TuckStep, Rejection> {
    finite_point("target", op.target)?;
    if op.additional_targets.len() > 64 {
        return Err(
            BridgeError::InvalidInput("at most 64 additional tuck targets".to_string()).into(),
        );
    }
    for &target in &op.additional_targets {
        finite_point("additionalTargets", target)?;
    }
    let fold = plain(
        parent,
        &op.line,
        op.direction,
        op.moving,
        op.side,
        &op.seed,
        choices.root.as_ref(),
    )?;
    Ok(TuckStep {
        fold: TuckFold {
            line: fold.line,
            side: fold.side,
            direction: op.direction,
            seed: fold.seed,
            target: op.target,
            additional_targets: op.additional_targets.clone(),
        },
        choices: TuckChoices {
            order: order(choices),
        },
    })
}

impl CompoundOp for CrimpStep {
    fn order_selection(
        &self,
        parent: &State,
        query: &crate::order_selection::OrderQuery,
    ) -> Result<crate::order_selection::OrderSelection, Refusal> {
        use crate::order_selection::OrderSelection;
        match parent.crimp_fold_within(&self.fold, &self.choices, &query.limits()) {
            Ok(CrimpOutcome::Landed(folded)) => {
                Ok(OrderSelection::unique(folded.report.stored.order))
            }
            Ok(CrimpOutcome::ChooseOrder(choice)) => {
                OrderSelection::pick(choice.completions(), query, |pick| {
                    choice.pick(pick).map(|folded| folded.report.stored.order)
                })
            }
            Ok(CrimpOutcome::ChooseOpening(_)) => Err(crate::compound::choice_needed(
                crate::compound::NeededChoice::Opening,
            )),
            Err(refused) => Err(crate::compound::compound_refusal(refused)),
        }
    }

    /// Its tip at ℓ1, as a plain fold's analysis reads.
    fn analysis(&self, parent: &State) -> Option<Result<FoldAnalysis, Refusal>> {
        Some(parent.analyse_crimp_fold(&self.fold).map_err(Refusal::from))
    }

    /// ℓ1 with the tip's spans, and the pleat arrow across both lines.
    fn action(&self, parent: &State) -> Option<Result<FoldActionGeometry, Refusal>> {
        Some(parent.crimp_action(&self.fold).map_err(Refusal::from))
    }

    /// The plain fold along ℓ1 its side and anchor name.
    fn plain(&self) -> Option<PlainFold> {
        Some(self.fold.plain())
    }

    /// Its analysis, and the kinds that land once every flap that opens
    /// several ways has its opening chosen.
    fn ask(&self, parent: &State) -> Result<Result<CompoundAsked, Refusal>, BridgeError> {
        let analysed = || -> Result<CrimpAnalysed, Refusal> {
            let analysis = parent.analyse_crimp(&self.fold).map_err(Refusal::from)?;
            let open = analysis.tip.flaps.iter().any(|f| f.openings.len() > 1)
                && self.choices.openings.is_empty();
            let kinds = if open {
                None
            } else {
                Some(
                    parent
                        .crimp_kinds(&self.fold, &self.choices)
                        .map_err(compound_refusal)?,
                )
            };
            Ok(CrimpAnalysed { analysis, kinds })
        };
        Ok(analysed().map(|analysed| CompoundAsked::Crimp(Box::new(analysed))))
    }

    fn apply(&self, parent: &State) -> Result<Box<dyn CompoundLanded>, Refusal> {
        let folded = landed(parent.crimp_fold(&self.fold, &self.choices))?;
        Ok(Box::new(Kept::crimp(parent, &self.fold, *folded)))
    }
}

impl CompoundOp for TuckStep {
    fn order_selection(
        &self,
        parent: &State,
        query: &crate::order_selection::OrderQuery,
    ) -> Result<crate::order_selection::OrderSelection, Refusal> {
        use crate::order_selection::OrderSelection;
        match parent.tuck_fold_within(&self.fold, &self.choices, &query.limits()) {
            Ok(TuckOutcome::Landed(folded)) => {
                Ok(OrderSelection::unique(folded.report.stored.order))
            }
            Ok(TuckOutcome::ChooseOrder(choice)) => {
                OrderSelection::pick(choice.completions(), query, |pick| {
                    choice.pick(pick).map(|folded| folded.report.stored.order)
                })
            }

            Err(refused) => Err(crate::compound::compound_refusal(refused)),
        }
    }

    /// What it moves against its target, as a plain fold's analysis reads.
    fn analysis(&self, parent: &State) -> Option<Result<FoldAnalysis, Refusal>> {
        Some(parent.analyse_tuck_fold(&self.fold).map_err(Refusal::from))
    }

    /// A plain fold's picture of its block.
    fn action(&self, parent: &State) -> Option<Result<FoldActionGeometry, Refusal>> {
        Some(parent.tuck_action(&self.fold).map_err(Refusal::from))
    }

    /// The plain fold its line, side, direction and seed name.
    fn plain(&self) -> Option<PlainFold> {
        Some(self.fold.plain())
    }

    /// Every layer its block lands on, with whether it takes the tuck,
    /// decided within [`TUCK_TARGETS_BUDGET_MS`].
    fn ask(&self, parent: &State) -> Result<Result<CompoundAsked, Refusal>, BridgeError> {
        let limits = CompletionLimits {
            deadline: Some(Deadline {
                now_ms: clock::now_ms,
                at_ms: clock::now_ms() + TUCK_TARGETS_BUDGET_MS,
            }),
            ..CompletionLimits::default()
        };
        Ok(parent
            .analyse_tuck(&self.fold, &limits)
            .map(|analysis| CompoundAsked::Tuck(Box::new(TuckAnalysed { analysis })))
            .map_err(Refusal::from))
    }

    fn apply(&self, parent: &State) -> Result<Box<dyn CompoundLanded>, Refusal> {
        let folded = landed(parent.tuck_fold(&self.fold, &self.choices))?;
        Ok(Box::new(Kept::tuck(parent, &self.fold, *folded)))
    }
}

/// A landed crimp or tuck, held by the bridge with its step's summary, taken
/// when it landed, so its parent need not stay held for that. Its picture is
/// drawn on its parent from its report, so that one does.
#[derive(Debug)]
struct Kept {
    state: State,
    report: CompoundStepReport,
    step: StepSummary,
}

impl Kept {
    fn crimp(parent: &State, fold: &CrimpFold, folded: CrimpFolded) -> Kept {
        let layers = layers(parent, &fold.first, fold.side);
        let step = StepSummary::new(parent, &folded.state, layers);
        Kept {
            state: folded.state,
            report: CompoundStepReport::Crimp(Box::new(folded.report)),
            step,
        }
    }

    fn tuck(parent: &State, fold: &TuckFold, folded: TuckFolded) -> Kept {
        let layers = layers(parent, &fold.line, fold.side);
        let step = StepSummary::new(parent, &folded.state, layers);
        Kept {
            state: folded.state,
            report: CompoundStepReport::Tuck(Box::new(folded.report)),
            step,
        }
    }
}

impl CompoundLanded for Kept {
    fn state(&self) -> &State {
        &self.state
    }

    fn report(&self) -> CompoundStepReport {
        self.report.clone()
    }

    fn summary(&self, _parent: Parent<'_>) -> Result<Result<StepSummary, Refusal>, BridgeError> {
        Ok(Ok(self.step.clone()))
    }

    /// A crimp's ℓ1 and pleat arrow, or a tuck's line and arrow with the
    /// landed state's cover at its head, on the parent it folded.
    fn action(
        &self,
        parent: Parent<'_>,
    ) -> Result<Option<Result<FoldActionGeometry, Refusal>>, BridgeError> {
        let action = match &self.report {
            CompoundStepReport::Crimp(report) => report.action(parent?),
            CompoundStepReport::Tuck(report) => report.action(parent?, Some(&self.state)),
            // Kept holds only crimps and tucks.
            _ => return Ok(None),
        };
        Ok(Some(action.map_err(Refusal::from)))
    }
}

/// A crimp or tuck its own call landed, not held yet, with what its step
/// stores.
type Landing = (Box<Kept>, StoredChoices);

/// What a crimp's or tuck's own call came to, before its states are held.
enum Tried {
    Landed(Landing),
    ChooseOpening(Box<CrimpAnalysis>),
    ChooseOrder {
        count: ChoiceCount,
        candidates: Vec<Landing>,
    },
}

impl Bridge {
    /// Fold a crimp: landed, an opening to choose, or every order landed.
    pub fn crimp(
        &mut self,
        state: u32,
        op: &CrimpOp,
        choices: &Choices,
    ) -> Result<Outcome<CompoundTried>, BridgeError> {
        let parent = self.state(state)?;
        let resolved =
            check_choices(op.takes(), choices).and_then(|()| resolve_crimp(parent, op, choices));
        let step = match settle(resolved)? {
            Ok(step) => step,
            Err(refusal) => return Ok(Outcome::Refused(refusal)),
        };
        let kept = |folded: CrimpFolded| -> Landing {
            let stored = stored(&folded.report.stored);
            (Box::new(Kept::crimp(parent, &step.fold, folded)), stored)
        };
        let tried = match parent.crimp_fold(&step.fold, &step.choices) {
            Ok(CrimpOutcome::Landed(folded)) => Tried::Landed(kept(*folded)),
            Ok(CrimpOutcome::ChooseOpening(analysis)) => Tried::ChooseOpening(analysis),
            Ok(CrimpOutcome::ChooseOrder(choice)) => Tried::ChooseOrder {
                count: choice.count(),
                candidates: picks(&sizes(choice.completions()))
                    .iter()
                    .filter_map(|pick| choice.pick(pick).ok())
                    .map(kept)
                    .collect(),
            },
            Err(refused) => return Ok(Outcome::Refused(compound_refusal(refused))),
        };
        Ok(Outcome::Ok(self.hold_tried(state, tried)))
    }

    /// Fold a tuck: landed, or every order landed.
    pub fn tuck(
        &mut self,
        state: u32,
        op: &TuckOp,
        choices: &Choices,
    ) -> Result<Outcome<CompoundTried>, BridgeError> {
        let parent = self.state(state)?;
        let resolved =
            check_choices(op.takes(), choices).and_then(|()| resolve_tuck(parent, op, choices));
        let step = match settle(resolved)? {
            Ok(step) => step,
            Err(refusal) => return Ok(Outcome::Refused(refusal)),
        };
        let kept = |folded: TuckFolded| -> Landing {
            let stored = tuck_stored(&folded.report.stored);
            (Box::new(Kept::tuck(parent, &step.fold, folded)), stored)
        };
        let tried = match parent.tuck_fold(&step.fold, &step.choices) {
            Ok(TuckOutcome::Landed(folded)) => Tried::Landed(kept(*folded)),
            Ok(TuckOutcome::ChooseOrder(choice)) => Tried::ChooseOrder {
                count: choice.count(),
                candidates: picks(&sizes(choice.completions()))
                    .iter()
                    .filter_map(|pick| choice.pick(pick).ok())
                    .map(kept)
                    .collect(),
            },
            Err(refused) => return Ok(Outcome::Refused(compound_refusal(refused))),
        };
        Ok(Outcome::Ok(self.hold_tried(state, tried)))
    }

    /// Hold every state a crimp's or tuck's call landed, in order, as `apply`
    /// holds a step of `parent`.
    fn hold_tried(&mut self, parent: u32, tried: Tried) -> CompoundTried {
        let mut hold = |(kept, stored): Landing| Candidate {
            step: self.hold_compound(kept, parent),
            stored,
        };
        match tried {
            Tried::Landed(landing) => CompoundTried::Landed(Box::new(hold(landing))),
            Tried::ChooseOpening(analysis) => CompoundTried::ChooseOpening { analysis },
            Tried::ChooseOrder { count, candidates } => CompoundTried::ChooseOrder {
                orders: count.orders,
                exact: count.exact,
                candidates: candidates.into_iter().map(&mut hold).collect(),
            },
        }
    }
}

/// "Layers" for a compound step (plan D14): the display layers along its
/// (first) line on the side that moves.
fn layers(parent: &State, line: &Line, side: Side) -> Option<usize> {
    parent
        .cross_section(line, side)
        .ok()
        .map(|section| section.layers)
}

/// How many orders each independent component of a choice lists.
fn sizes(completions: &Completions) -> Vec<usize> {
    completions
        .components()
        .iter()
        .map(|c| c.orders.len())
        .collect()
}

/// Every choice of one order per component, at most [`MAX_CANDIDATES`].
fn picks(sizes: &[usize]) -> Vec<Vec<usize>> {
    let mut picks = vec![Vec::new()];
    for &n in sizes {
        picks = picks
            .into_iter()
            .flat_map(|p: Vec<usize>| {
                (0..n).map(move |k| {
                    let mut q = p.clone();
                    q.push(k);
                    q
                })
            })
            .take(MAX_CANDIDATES)
            .collect();
    }
    picks
}

#[wasm_bindgen]
impl FoldEngine {
    /// Fold a crimp; `choices` may be `undefined` or `null`.
    pub fn crimp(&mut self, state: u32, op: JsValue, choices: JsValue) -> Result<JsValue, JsValue> {
        let op: CrimpOp = parse("op", op)?;
        let choices = parse_choices(choices)?;
        to_js_value(
            &self
                .inner
                .crimp(state, &op, &choices)
                .map_err(bridge_error)?,
        )
    }

    /// Fold a tuck; `choices` may be `undefined` or `null`.
    pub fn tuck(&mut self, state: u32, op: JsValue, choices: JsValue) -> Result<JsValue, JsValue> {
        let op: TuckOp = parse("op", op)?;
        let choices = parse_choices(choices)?;
        to_js_value(
            &self
                .inner
                .tuck(state, &op, &choices)
                .map_err(bridge_error)?,
        )
    }
}

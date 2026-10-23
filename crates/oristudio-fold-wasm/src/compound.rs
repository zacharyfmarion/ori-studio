//! The one seam every compound fold reaches the bridge through (plan D4): a
//! resolved op ([`CompoundOp`]) and what it lands ([`CompoundLanded`]), so
//! the bridge holds, pictures, summarises and reports any of them alike, and
//! each family adds a module of its own rather than arms across
//! [`crate::bridge`]: the reverse folds (`ops_reverse`), the crimp and the
//! tuck (`ops_crimp_tuck`), the vertex folds (`ops_squash_family`) and the
//! sinks (`ops_sinks`).
//!
//! ```ts
//! // `apps/web/src/fold/engine/foldEngineCompoundWire.ts` holds these shapes.
//! class FoldEngine {
//!   /** What a compound fold from `state` is before it lands, as its
//!    *  family's tools ask: its family's answer, tagged by `family`. Any
//!    *  other op is the caller's mistake. */
//!   compound_analysis(state: number, op: FoldOp, choices?: FoldChoices):
//!     Outcome<FoldCompoundAnalysis>;
//! }
//! ```
//!
//! - **Resolving.** A family's op resolves in `resolve` like any other step
//!   — its lines and side from the document's anchors, its stored choices
//!   read as the engine's — to a [`CompoundOp`]. The choices an op takes
//!   none of are refused first, by the one check every op shares
//!   (`wire::Choices::unexpected`).
//! - **Landing.** [`CompoundOp::apply`] lands it, or refuses, through the one
//!   choice/refusal path every family's outcome takes ([`landed`]): a step
//!   whose stored choices leave more than one result is refused as
//!   `choice_needed`, naming the choice ([`FamilyOutcome`] says which, per
//!   family); a tool asks its family's question for the candidates and
//!   stores one; a replay marks the step broken, as plan D6 has it. A stored
//!   choice that no longer resolves is `choice_broken`, with the engine's
//!   [`Broken`] cause.
//! - **Asking.** What a tool asks before a step lands is its family's own
//!   question ([`CompoundOp::ask`]), one call for every family, answered as
//!   [`CompoundAsked`]. Every family answers for its picture. A family that
//!   folds along one line — the reverse folds, a crimp along its first line,
//!   a tuck, the sinks — also answers the plain fold's other queries: what
//!   moves, the plain fold its line and anchor name for the depth picker.
//!   The vertex folds answer neither, and asking is the caller's mistake.
//! - **Holding.** A landed one is held under its parent's handle; its step's
//!   summary and picture are asked of it, against its parent only when it
//!   needs one ([`Parent`]): a crimp or a tuck keeps the summary it took as it
//!   landed, so it answers that after its parent is released.
//! - **Reporting.** What it did crosses beside a plain fold's report as
//!   [`CompoundStepReport`], tagged by its family, whether `apply` landed it
//!   or its family's own call did; every family's carries its motion's legs.

use std::fmt::Debug;

use oristudio_fold::{
    Broken, CompoundRefused, CrimpFolded, CrimpOutcome, CrimpReport, FoldActionGeometry,
    FoldAnalysis, PlainFold, ReverseFolded, ReverseOutcome, ReverseReport, SinkFolded, SinkOutcome,
    SinkReport, State, StepSummary, TuckFolded, TuckOutcome, TuckReport, VertexFolded,
    VertexOutcome, VertexReport,
};
use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::bridge::{Bridge, settle};
use crate::resolve::{Resolved, resolve};
use crate::wire::{BridgeError, BridgeRefusal, Choices, Op, Outcome, Refusal};
use crate::{FoldEngine, bridge_error, parse, parse_choices, to_js_value};

/// A compound fold resolved in its parent, ready to land or be asked about.
pub trait CompoundOp: Debug {
    /// What moves, as a plain fold's analysis reads: the line and side, the
    /// moving side's flaps, the ones the anchor picked, and the faces that
    /// move. Its direction is the one the viewer sees the near layer turn.
    /// None for a family that folds along no one line, or more than one.
    fn analysis(&self, _parent: &State) -> Option<Result<FoldAnalysis, Refusal>> {
        None
    }
    /// Its picture on the parent, before it lands; none for a family with
    /// none to draw.
    fn action(&self, _parent: &State) -> Option<Result<FoldActionGeometry, Refusal>> {
        None
    }
    /// The plain fold its line, side and anchor name: what a depth pick
    /// previews the stacks of. None, as `analysis`.
    fn plain(&self) -> Option<PlainFold> {
        None
    }
    /// Its family's question before it lands: what a tool previews and
    /// chooses from. Thrown, a question the op cannot be asked (an unsink has
    /// no point to analyse).
    fn ask(&self, parent: &State) -> Result<Result<CompoundAsked, Refusal>, BridgeError>;
    /// Inspect a specific order without choosing it for a saved step.
    fn order_selection(
        &self,
        parent: &State,
        query: &crate::order_selection::OrderQuery,
    ) -> Result<crate::order_selection::OrderSelection, Refusal>;
    /// Land it with its stored choices.
    fn apply(&self, parent: &State) -> Result<Box<dyn CompoundLanded>, Refusal>;
}

/// The state a held compound fold folded, or why it is not held any more:
/// handed to what needs it and dropped by what does not, so a step that kept
/// its summary as it landed answers after its parent is released.
pub type Parent<'a> = Result<&'a State, BridgeError>;

/// A landed compound fold, held under its handle.
pub trait CompoundLanded: Debug {
    fn state(&self) -> &State;
    /// What it did, on the wire.
    fn report(&self) -> CompoundStepReport;
    /// Its summary: against the parent it folded, or the one it kept.
    fn summary(&self, parent: Parent<'_>) -> Result<Result<StepSummary, Refusal>, BridgeError>;
    /// Its picture on the parent it folded, with the landed state's cover;
    /// none for a family with none to draw (its motion is in its report).
    fn action(
        &self,
        _parent: Parent<'_>,
    ) -> Result<Option<Result<FoldActionGeometry, Refusal>>, BridgeError> {
        Ok(None)
    }
}

/// What a landed compound fold did, tagged by its family.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "family", rename_all = "snake_case")]
pub enum CompoundStepReport {
    /// An inside or outside reverse fold (`ops_reverse`).
    Reverse(Box<ReverseReport>),
    /// A crimp and a tuck (`ops_crimp_tuck`).
    Crimp(Box<CrimpReport>),
    Tuck(Box<TuckReport>),
    /// A squash, petal fold, rabbit ear or swivel, by its `kind`
    /// (`ops_squash_family`).
    Vertex(Box<VertexReport>),
    /// An open or closed sink, or an unsink, by its `step` (`ops_sinks`).
    Sink(Box<SinkReport>),
}

/// What a tool learns of a compound fold before it lands, tagged by its
/// family: each family's own answer.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "family", rename_all = "snake_case")]
pub enum CompoundAsked {
    /// The tip and its openings, of both kinds (`ops_reverse`).
    Reverse(Box<crate::ops_reverse::ReverseAsked>),
    /// A crimp's tip and what lies beyond ℓ2, and the kinds that land; a
    /// tuck's moving faces and the layers it can be tucked against
    /// (`ops_crimp_tuck`).
    Crimp(Box<crate::ops_crimp_tuck::CrimpAnalysed>),
    Tuck(Box<crate::ops_crimp_tuck::TuckAnalysed>),
    /// The flap, petal or fan a vertex op names (`ops_squash_family`).
    Vertex(Box<crate::ops_squash_family::VertexAnalysed>),
    /// The point a sink names and how it sinks (`ops_sinks`).
    Sink(Box<crate::ops_sinks::SinkAnalysed>),
}

/// The choice a compound step still has to make before it lands, as
/// `choice_needed` names it: the document key it is stored under.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NeededChoice {
    /// A flap opens more than one way (reverse folds, crimps).
    Opening,
    /// A closed sink's point has more than one pocket to sink into.
    Pocket,
    /// The completion leaves more than one order.
    Completion,
}

/// Where a family's fold got to, as the seam reads it: landed, or the choice
/// its stored choices leave open.
#[derive(Debug)]
pub enum Reached<L> {
    Landed(L),
    Needs(NeededChoice),
}

/// A family's outcome as the seam reads it: which of its outcomes landed,
/// and which choice each of the others needs. One impl per family, here, so
/// no family words its own `choice_needed`.
pub trait FamilyOutcome {
    /// What the family lands: its state and its report.
    type Folded;
    fn reached(self) -> Reached<Self::Folded>;
}

impl FamilyOutcome for ReverseOutcome {
    type Folded = Box<ReverseFolded>;
    fn reached(self) -> Reached<Self::Folded> {
        match self {
            ReverseOutcome::Landed(folded) => Reached::Landed(folded),
            ReverseOutcome::ChooseOpening(_) => Reached::Needs(NeededChoice::Opening),
            ReverseOutcome::ChooseOrder(_) => Reached::Needs(NeededChoice::Completion),
        }
    }
}

impl FamilyOutcome for CrimpOutcome {
    type Folded = Box<CrimpFolded>;
    fn reached(self) -> Reached<Self::Folded> {
        match self {
            CrimpOutcome::Landed(folded) => Reached::Landed(folded),
            CrimpOutcome::ChooseOpening(_) => Reached::Needs(NeededChoice::Opening),
            CrimpOutcome::ChooseOrder(_) => Reached::Needs(NeededChoice::Completion),
        }
    }
}

impl FamilyOutcome for TuckOutcome {
    type Folded = Box<TuckFolded>;
    fn reached(self) -> Reached<Self::Folded> {
        match self {
            TuckOutcome::Landed(folded) => Reached::Landed(folded),
            TuckOutcome::ChooseOrder(_) => Reached::Needs(NeededChoice::Completion),
        }
    }
}

impl FamilyOutcome for VertexOutcome {
    type Folded = Box<VertexFolded>;
    fn reached(self) -> Reached<Self::Folded> {
        match self {
            VertexOutcome::Landed(folded) => Reached::Landed(folded),
            VertexOutcome::ChooseOrder(_) => Reached::Needs(NeededChoice::Completion),
        }
    }
}

impl FamilyOutcome for SinkOutcome {
    type Folded = Box<SinkFolded>;
    fn reached(self) -> Reached<Self::Folded> {
        match self {
            SinkOutcome::Landed(folded) => Reached::Landed(folded),
            SinkOutcome::ChoosePocket(_) => Reached::Needs(NeededChoice::Pocket),
            SinkOutcome::ChooseOrder(_) => Reached::Needs(NeededChoice::Completion),
        }
    }
}

/// The one way a compound fold's outcome reaches the wire: landed, or
/// refused — `choice_needed` naming the choice still open, the engine's
/// refusal with its fixes, or `choice_broken` (plan D6).
pub fn landed<O: FamilyOutcome>(outcome: Result<O, CompoundRefused>) -> Result<O::Folded, Refusal> {
    match outcome.map(FamilyOutcome::reached) {
        Ok(Reached::Landed(landed)) => Ok(landed),
        Ok(Reached::Needs(choice)) => Err(choice_needed(choice)),
        Err(refused) => Err(compound_refusal(refused)),
    }
}

/// A compound fold's refusal on the wire: the engine's, with its fixes, or a
/// stored choice that no longer resolves.
pub fn compound_refusal(refused: CompoundRefused) -> Refusal {
    match refused {
        CompoundRefused::Refused(refused) => refused.into(),
        CompoundRefused::Broken(broken) => broken_choice(broken),
    }
}

/// A stored choice that no longer resolves (plan D6).
pub fn broken_choice(broken: Broken) -> Refusal {
    BridgeRefusal::ChoiceBroken { broken }.into()
}

/// A step whose stored choices leave more than one result.
pub fn choice_needed(choice: NeededChoice) -> Refusal {
    BridgeRefusal::ChoiceNeeded { choice }.into()
}

/// The caller asked a compound fold a question its family does not answer:
/// a plain fold's, of one that folds along no one line.
pub(crate) fn asks_its_own(op: &Op) -> BridgeError {
    BridgeError::InvalidInput(format!(
        "a {} step is no fold along one line: ask `compound_analysis`",
        op.kind()
    ))
}

impl Bridge {
    /// What a compound fold from `state` is before it lands, as its family's
    /// tools ask ([`CompoundOp::ask`]). `op` must be a compound fold.
    pub fn compound_analysis(
        &self,
        state: u32,
        op: &Op,
        choices: &Choices,
    ) -> Result<Outcome<CompoundAsked>, BridgeError> {
        let parent = self.state(state)?;
        let not_compound = || {
            BridgeError::InvalidInput(format!(
                "`compound_analysis` asks of a compound fold, not a {} step",
                op.kind()
            ))
        };
        if !op.is_compound() {
            return Err(not_compound());
        }
        match settle(resolve(parent, op, choices))? {
            Ok(Resolved::Compound(compound)) => Ok(compound.ask(parent)?.into()),
            Ok(_) => Err(not_compound()),
            Err(refusal) => Ok(Outcome::Refused(refusal)),
        }
    }
}

#[wasm_bindgen]
impl FoldEngine {
    /// What a compound fold from `state` is before it lands, as its family's
    /// tools ask; `choices` may be `undefined` or `null`.
    pub fn compound_analysis(
        &self,
        state: u32,
        op: JsValue,
        choices: JsValue,
    ) -> Result<JsValue, JsValue> {
        let op: Op = parse("op", op)?;
        let choices = parse_choices(choices)?;
        to_js_value(
            &self
                .inner
                .compound_analysis(state, &op, &choices)
                .map_err(bridge_error)?,
        )
    }
}

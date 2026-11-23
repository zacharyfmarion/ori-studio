//! A tuck in place across the bridge: a valley or mountain step whose
//! landing is `{ kind: 'in_place', targets, moves }` — the flap is folded
//! along the step's line already, keeps its place and its creases, and is
//! tucked against the targets (`oristudio_fold::TuckInPlace`). Its line,
//! side and seed resolve as the plain fold's; it lands, reports, draws and
//! chooses its order as a tuck does, through the compound seam
//! ([`crate::compound`]), so a stored one replays through `apply` as every
//! step does.

use oristudio_fold::{
    Direction, FoldActionGeometry, FoldAnalysis, InPlace, PlainFold, State, TuckChoices,
    TuckInPlace, TuckOutcome,
};

use crate::compound::{CompoundAsked, CompoundLanded, CompoundOp, compound_refusal, landed};
use crate::ops_crimp_tuck::{Kept, order, plain};
use crate::order_selection::{OrderQuery, OrderSelection};
use crate::resolve::{Rejection, finite_point};
use crate::wire::{AlongLine, BridgeError, Choices, Point, Refusal};

/// A tuck in place resolved in its parent, with its stored choices.
#[derive(Debug)]
pub struct TuckInPlaceStep {
    pub fold: TuckInPlace,
    pub choices: TuckChoices,
}

/// A valley or mountain step landing in place, resolved in `parent`. Its
/// choices are checked before (`resolve::check_choices`).
pub fn resolve_in_place(
    parent: &State,
    a: &AlongLine,
    direction: Direction,
    targets: &[Point],
    moves: InPlace,
    choices: &Choices,
) -> Result<TuckInPlaceStep, Rejection> {
    let Some((&target, others)) = targets.split_first() else {
        return Err(BridgeError::InvalidInput("a tuck in place needs a target".into()).into());
    };
    for &point in targets {
        finite_point("landing.targets", point)?;
    }
    let fold = plain(
        parent,
        &a.line,
        direction,
        a.motion.moving,
        a.motion.side,
        &a.motion.seed,
        choices.root.as_ref(),
    )?;
    Ok(TuckInPlaceStep {
        fold: TuckInPlace {
            line: fold.line,
            side: fold.side,
            direction,
            seed: fold.seed,
            moves,
            target,
            additional_targets: others.to_vec(),
        },
        choices: TuckChoices {
            order: order(choices),
        },
    })
}

impl CompoundOp for TuckInPlaceStep {
    /// What it moves, as a plain fold's analysis reads.
    fn analysis(&self, parent: &State) -> Option<Result<FoldAnalysis, Refusal>> {
        Some(
            parent
                .analyse_tuck_in_place(&self.fold)
                .map_err(Refusal::from),
        )
    }

    /// The plain fold's picture of its block, with a push into its target.
    fn action(&self, parent: &State) -> Option<Result<FoldActionGeometry, Refusal>> {
        Some(
            parent
                .tuck_in_place_action(&self.fold)
                .map_err(Refusal::from),
        )
    }

    /// The plain fold its line, side, direction and seed name.
    fn plain(&self) -> Option<PlainFold> {
        Some(
            PlainFold::new(self.fold.line, self.fold.side, self.fold.direction)
                .with_seed(self.fold.seed.clone()),
        )
    }

    /// A tuck in place is chosen among a valley or mountain fold's layer
    /// orders, never asked a question of its own.
    fn ask(&self, _parent: &State) -> Result<Result<CompoundAsked, Refusal>, BridgeError> {
        Err(BridgeError::InvalidInput(
            "a tuck in place has no question to ask".into(),
        ))
    }

    fn order_selection(
        &self,
        parent: &State,
        query: &OrderQuery,
    ) -> Result<OrderSelection, Refusal> {
        match parent.tuck_in_place_within(&self.fold, &self.choices, &query.limits()) {
            Ok(TuckOutcome::Landed(folded)) => {
                Ok(OrderSelection::unique(folded.report.stored.order))
            }
            Ok(TuckOutcome::ChooseOrder(choice)) => {
                OrderSelection::pick(choice.completions(), query, |pick| {
                    choice.pick(pick).map(|folded| folded.report.stored.order)
                })
            }
            Err(refused) => Err(compound_refusal(refused)),
        }
    }

    fn apply(&self, parent: &State) -> Result<Box<dyn CompoundLanded>, Refusal> {
        let folded = landed(parent.tuck_in_place(&self.fold, &self.choices))?;
        Ok(Box::new(Kept::tuck_in_place(
            parent,
            &self.fold.line,
            self.fold.side,
            *folded,
        )))
    }
}

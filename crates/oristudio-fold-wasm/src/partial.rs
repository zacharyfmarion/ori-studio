//! Partial precreases: a precrease with an `extent` (a segment, or a pinch)
//! creases only that stretch of its line and lands crease marks
//! (`oristudio_fold::crease_marks`). `apply`, `analyse` and `action` each
//! ask [`mark`] of such an op before anything else, so all three see one
//! answer: `analyse` its report's analysis (the extent's refusals among
//! them, which a whole precrease's analysis has no word for), `action` its
//! picture along the extent, `apply` the state it lands, held as any fold's.
//!
//! The line, its side and the seed resolve as the whole precrease's do
//! (`resolve`); the extent's sheet points by one rule
//! (`resolve::precrease_extent`), projected onto the located line by the
//! engine.

use oristudio_fold::{AnchoredRefused, Extent, Folded, State};

use crate::bridge::settle;
use crate::resolve::{Resolved, precrease_extent, resolve};
use crate::wire::{BridgeError, Choices, Op, Refusal};

/// The extent of `op` when it is a partial precrease; none for any other op
/// or a whole precrease. A malformed extent is the caller's mistake.
pub fn partial_extent(op: &Op) -> Result<Option<Extent>, BridgeError> {
    let extent = precrease_extent(op)?;
    Ok((!extent.is_whole()).then_some(extent))
}

/// The partial precrease `op` names on `parent`, landed but not held: its
/// marks, its report and its extent; or a refusal, which a stored step's
/// replay reads as broken.
pub fn mark(
    parent: &State,
    op: &Op,
    choices: &Choices,
    extent: &Extent,
) -> Result<Result<Folded, Refusal>, BridgeError> {
    Ok(match settle(resolve(parent, op, choices))? {
        Ok(Resolved::Anchored { fold, .. }) => parent
            .precrease_anchored_extent(&fold, extent)
            .map_err(|refused| match refused {
                AnchoredRefused::Line(line) => Refusal::from(line),
                // A partial precrease lands nothing, so it has no sliver
                // to offer a remedy for.
                AnchoredRefused::Fold { refused, .. } => Refusal::from(refused),
            }),
        Ok(Resolved::Plain { fold, .. }) => parent
            .precrease_extent(&fold, extent)
            .map_err(Refusal::from),
        Ok(_) => {
            return Err(BridgeError::InvalidInput(format!(
                "a {} step has no line to crease part of",
                op.kind()
            )));
        }
        Err(refusal) => Err(refusal),
    })
}

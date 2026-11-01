//! Landing a `cp-jump` op against its parent (plan D16, D6): what
//! `Bridge::apply` does with every stored one, and what a pick does with the
//! op it is about to return, so a committed import is exactly what its
//! replays land.
//!
//! The stored `cpJson` is read back through the kernel's FOLD reader and
//! imported after the parent — its sheet must fit the parent's, the view is
//! kept and the root continues — and the stored `orderJson`'s witnesses,
//! with the imported letters, must decide one order. Anything else refuses,
//! and the replay marks the step broken.

use oristudio_fold::complete::CompletionLimits;
use oristudio_fold::{ImportTarget, ImportedPattern, State, WitnessOrder};

use super::kernel::input_of_cp_json;
use super::wire::{CpJump, IoRefusal, StoredField};
use crate::resolve::Rejection;
use crate::wire::BridgeRefusal;

/// The state a stored `cp-jump` lands after `parent`.
pub fn land(parent: &State, jump: &CpJump) -> Result<State, IoRefusal> {
    let input = input_of_cp_json(&jump.cp_json)?;
    let stored: WitnessOrder =
        serde_json::from_str(&jump.order_json).map_err(|_| IoRefusal::StoredUnreadable {
            field: StoredField::OrderJson,
        })?;
    let mut pattern = ImportedPattern::new(&input, ImportTarget::After(parent))?;
    // Seen turned as the Layer order dialog left it, from the parent's view;
    // clockwise on screen is the view's turn the other way.
    if jump.turn_deg != 0.0 {
        pattern.rotate_view(-jump.turn_deg.to_radians());
    }
    // Every pair is stored, so this is propagation, not a search.
    pattern
        .replay(&stored, &CompletionLimits::default())
        .map_err(|broken| IoRefusal::OrderBroken { broken })
}

/// The order a state stores for its `cp-jump`: every pair, by witnesses.
pub fn order_json(state: &State) -> Result<String, IoRefusal> {
    let internal =
        |message: String| IoRefusal::Import(oristudio_fold::ImportRefusal::Internal { message });
    let stored = WitnessOrder::of_state(state)
        .ok_or_else(|| internal("a face of the state has no witness".to_string()))?;
    serde_json::to_string(&stored).map_err(|error| internal(error.to_string()))
}

impl From<IoRefusal> for Rejection {
    fn from(refusal: IoRefusal) -> Rejection {
        BridgeRefusal::Io(refusal).into()
    }
}

//! Collapse (`implementation-plans/fold-collapse-existing-creases.md`): the
//! held state collapsed along creases it already has, as the `collapse` op
//! stores it — `{ kind: 'collapse', creases, orderJson }`, the stretches it
//! changes by their sheet ends and the order chosen, by witnesses
//! ([`oristudio_fold::collapse`]).
//!
//! - **Opening** ([`crate::io::Imports::open_collapse`]) derives the pattern
//!   from the state and completes its order, held under an import's handle,
//!   so its ‹ n of m › is an import's. An order of it is the op a step
//!   stores ([`crate::io::Imports::collapse_op`]); the tool previews and
//!   commits that op as any step's.
//! - **Landing** ([`land`]) derives the pattern from the parent again and
//!   replays the stored order: what `Bridge::apply` does with every stored
//!   one. A parent whose creases no longer include a stretch, or whose
//!   letters no longer fold flat, refuses (`collapse_*`, `import_*`), and
//!   the replay marks the step broken.
//!
//! The step is held as a view change is, beside its parent
//! (`resolve::Resolved::View`): its summary is the diff from the parent —
//! the creases it folded, unfolded and reversed — and it has no picture.

use oristudio_fold::complete::CompletionLimits;
use oristudio_fold::{Collapsing, State, WitnessOrder};

use super::wire::{Collapse, IoRefusal, StoredField};

/// The state a stored `collapse` lands after `parent`.
pub fn land(parent: &State, op: &Collapse) -> Result<State, IoRefusal> {
    let stored: WitnessOrder =
        serde_json::from_str(&op.order_json).map_err(|_| IoRefusal::StoredUnreadable {
            field: StoredField::OrderJson,
        })?;
    let collapsing = Collapsing::new(parent, &op.creases)?;
    // Every pair is stored, so this is propagation, not a search.
    collapsing
        .replay(&stored, &CompletionLimits::default())
        .map_err(|broken| IoRefusal::OrderBroken { broken })
}

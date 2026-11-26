//! Adjust order (`implementation-plans/fold-adjust-order.md`): a step that
//! keeps its parent's paper exactly as it is and chooses its layer order
//! again.
//!
//! [`Reordering::of`] is the parent's own parts, one step on, with the order
//! left out: every vertex, every crease with its letter and the step that
//! made it, every face with its lineage, the crease marks, the root and the
//! view. Nothing is rebuilt, so no geometry can move. Every letter is known,
//! so the letters fix the pairs a crease joins and the rest is the order
//! being chosen: [`Reordering::decided_by`] takes seeds that decide every
//! pair (the Layer order dialog's Apply, `steer::StateFaces`), and
//! [`Reordering::replay`] a stored [`WitnessOrder`] (the step's `orderJson`,
//! plan D6), as an import's order is replayed.
//!
//! **Ori Studio original work**, not a port: the same `Unordered` and
//! completion Import CP lands through.

use crate::complete::{CompletionLimits, FixedPair};
use crate::pattern::EdgeId;
use crate::refusal::FoldRefusal;
use crate::state::State;
use crate::unordered::Unordered;
use crate::witness::{Broken, WitnessOrder};

/// A state's parts, one step on, whose order is to be chosen again (see the
/// module docs).
#[derive(Debug, Clone)]
pub struct Reordering {
    unordered: Unordered,
}

impl Reordering {
    /// `parent`'s own parts as the next step's, with no order. Refused only
    /// as the gate would refuse the parent itself, which landed: a defect.
    pub fn of(parent: &State) -> Result<Reordering, FoldRefusal> {
        let mut parts = parent.parts().clone();
        parts.step = parent.step() + 1;
        // Every letter is known: a reordering decides none.
        Unordered::new(parts, Vec::<EdgeId>::new()).map(|unordered| Reordering { unordered })
    }

    /// The parts, faces and creases in id order, and their constraint
    /// problem.
    pub fn unordered(&self) -> &Unordered {
        &self.unordered
    }

    /// The state whose order the letters and `seeds` decide: every pair, so
    /// one order and no choice. An order the seeds leave open is refused
    /// ([`Broken::NotUnique`]), never guessed; seeds that clash with the
    /// letters or each other are [`Broken::Completion`].
    pub fn decided_by(
        &self,
        seeds: &[FixedPair],
        limits: &CompletionLimits,
    ) -> Result<State, Broken> {
        let mut fixed = self.unordered.letter_seeds();
        fixed.extend_from_slice(seeds);
        let completions = self
            .unordered
            .complete(&fixed, limits)
            .map_err(|refusal| Broken::Completion { refusal })?;
        let count = completions.count();
        if !completions.is_unique() {
            return Err(Broken::NotUnique { orders: count });
        }
        let order = completions
            .order(&vec![0; completions.components().len()])
            .ok_or(Broken::NotUnique { orders: count })?;
        self.unordered
            .state(order)
            .map_err(|refusal| Broken::Gate { refusal })
    }

    /// Replay a stored order (plan D6): its witnesses and the letters must
    /// decide one order.
    pub fn replay(
        &self,
        stored: &WitnessOrder,
        limits: &CompletionLimits,
    ) -> Result<State, Broken> {
        self.unordered
            .replay(stored, &self.unordered.letter_seeds(), limits)
    }
}

/// The state a stored Adjust order lands after `parent` (see the module
/// docs). A parent that no longer reorders is a gate refusal of the order.
pub fn reorder(
    parent: &State,
    stored: &WitnessOrder,
    limits: &CompletionLimits,
) -> Result<State, Broken> {
    Reordering::of(parent)
        .map_err(|refusal| Broken::Gate { refusal })?
        .replay(stored, limits)
}

//! Adjust order (`implementation-plans/fold-adjust-order.md`): the Layer
//! order dialog opened on a held state's own paper, and the step its Apply
//! lands, which keeps every crease, face and pose of the state and stores
//! only the order (`{ kind: 'adjust-order', orderJson }`).
//!
//! - **The dialog's fold** is the state's crease pattern as Import CP's
//!   opening folds an import's: through the kernel's FOLD writer
//!   ([`super::kernel::cp_json`] of `fold_cp_to_model`), then Edit's whole
//!   fold of it. Its faces are matched with the state's many to one, across
//!   the state's flat creases (`oristudio_fold::steer::StateFaces`).
//! - **The opening** draws the state's own order over those faces, so the
//!   dialog opens on the paper as Fold shows it, from the side Fold shows it
//!   and turned as Fold turns it.
//! - **The pick** finds the match again from the state (nothing is held
//!   between the two calls), checks the digest the dialog analysed, takes
//!   Apply's relations as seeds over the state's faces, and lands the op
//!   *by replaying it* ([`land`], what `Bridge::apply` does with every stored
//!   one), so a committed step is exactly what its replays land.
//!
//! A turn or a side the dialog was left at is never part of it: the step
//! keeps the state's view.

use oristudio_cp::folding::{FoldedFigureModel, folded_paper_scene_with_order};
use oristudio_cp::session::{EngineError, FoldSource};
use oristudio_fold::complete::CompletionLimits;
use oristudio_fold::steer::{LayerSource, StateFaces};
use oristudio_fold::{
    Broken, CompletionRefusal, KernelFrame, Reordering, State, WitnessOrder, fold_cp_to_model,
};
use oristudio_layer_order::LayerOrderError;

use super::imports::edit_fold_source;
use super::jump;
use super::kernel::cp_json;
use super::wire::{
    AdjustOrder, IoCallError, IoRefusal, LayerOpening, ReorderOp, Reordered, StoredField,
};
use crate::bridge::Bridge;
use crate::wire::{Choices, Op, Outcome};

/// The state's paper as the dialog analyses it, and its match with the
/// state's faces.
struct Matched {
    source: FoldSource,
    layer: LayerSource,
    reordering: Reordering,
    faces: StateFaces,
    frame: KernelFrame,
}

/// Match `state` with Edit's fold of its crease pattern, or the code of why
/// the dialog cannot open on it: the kernel's, the dialog source's, or
/// `faces_differ`.
fn matched(state: &State) -> Result<Matched, &'static str> {
    let text = cp_json(&fold_cp_to_model(state)).map_err(|refusal| refusal.code())?;
    let source = edit_fold_source(&text)?;
    let layer = LayerSource::from_oriedita(&source).map_err(|refusal| refusal.code())?;
    let reordering = Reordering::of(state).map_err(|refusal| refusal.code())?;
    let frame = KernelFrame::of(state.sheet());
    let faces =
        StateFaces::of(&layer, reordering.unordered(), &frame).map_err(|_| "faces_differ")?;
    Ok(Matched {
        source,
        layer,
        reordering,
        faces,
        frame,
    })
}

/// What the Layer order dialog opens on for `state`: the fold it analyses,
/// the state's order drawn over its faces, and how Fold shows the state.
/// Refused as `import_layer_unavailable` when the dialog cannot work on it.
pub fn opening(state: &State) -> Outcome<LayerOpening> {
    let opened = (|| -> Result<LayerOpening, &'static str> {
        let m = matched(state)?;
        let relations = m
            .faces
            .oriedita_relations(&m.layer, m.reordering.unordered(), state.order())
            .map_err(|_| "faces_differ")?;
        let shown = folded_paper_scene_with_order(
            m.layer.render_inputs(),
            &relations,
            &m.source.aux_segments,
            &FoldedFigureModel::default(),
        )
        .map_err(|error| EngineError::from(error).code)?
        .ok_or("no_subfaces")?;
        let look = m.faces.look(m.reordering.unordered(), &m.frame);
        Ok(LayerOpening {
            source: m.source,
            shown,
            look,
        })
    })();
    match opened {
        Ok(opening) => Outcome::Ok(opening),
        Err(reason) => Outcome::Refused(IoRefusal::LayerUnavailable { reason }.into()),
    }
}

/// Land the order the dialog's Apply chose for the held state `parent`:
/// `relations`, flat `[upper, lower, …]` over the faces of the opening whose
/// source has `digest`, in Oriedita's convention. With the letters they must
/// decide every pair; the step then lands as its replay will.
pub fn pick(
    bridge: &mut Bridge,
    parent: u32,
    digest: &str,
    relations: &[u32],
) -> Result<Outcome<Reordered>, IoCallError> {
    if !relations.len().is_multiple_of(2) {
        return Err(IoCallError::invalid(
            "relations must be [upper, lower] pairs",
        ));
    }
    let state = bridge.state(parent)?;
    let m = match matched(state) {
        Ok(m) => m,
        Err(reason) => {
            return Ok(Outcome::Refused(
                IoRefusal::LayerUnavailable { reason }.into(),
            ));
        }
    };
    if m.source.digest != digest {
        return Err(IoCallError::invalid(format!(
            "the relations are over faces {digest}, not the {} this state opens on",
            m.source.digest
        )));
    }
    let pairs: Vec<[usize; 2]> = relations
        .chunks_exact(2)
        .map(|pair| [pair[0] as usize, pair[1] as usize])
        .collect();
    let seeds = m
        .faces
        .seeds(m.reordering.unordered(), &pairs)
        .ok_or_else(|| {
            IoCallError::invalid("a relation names a face the dialog's fold does not have")
        })?;
    let landed = seeds
        .map_err(|error| match error {
            LayerOrderError::ContradictoryOrder { pair } => Broken::Completion {
                refusal: CompletionRefusal::FixedContradictory { pair },
            },
            other => Broken::Completion {
                refusal: CompletionRefusal::InvalidProblem {
                    message: other.to_string(),
                },
            },
        })
        .and_then(|seeds| {
            m.reordering
                .decided_by(&seeds, &CompletionLimits::default())
        })
        .map_err(|broken| IoRefusal::OrderBroken { broken })
        .and_then(|state| jump::order_json(&state));
    let op = match landed {
        Ok(order_json) => AdjustOrder { order_json },
        Err(refusal) => return Ok(Outcome::Refused(refusal.into())),
    };
    let applied = bridge.apply(parent, &Op::AdjustOrder(op.clone()), &Choices::default())?;
    Ok(match applied {
        Outcome::Ok(applied) => Outcome::Ok(Reordered {
            state: applied.state,
            summary: applied.summary,
            op: ReorderOp::AdjustOrder(op),
        }),
        Outcome::Refused(refusal) => Outcome::Refused(refusal),
    })
}

/// The state a stored `adjust-order` lands after `parent`: the parent's own
/// parts, the stored order's witnesses and the letters deciding one order.
pub fn land(parent: &State, op: &AdjustOrder) -> Result<State, IoRefusal> {
    let stored: WitnessOrder =
        serde_json::from_str(&op.order_json).map_err(|_| IoRefusal::StoredUnreadable {
            field: StoredField::OrderJson,
        })?;
    // Every pair is stored, so this is propagation, not a search.
    oristudio_fold::reorder(parent, &stored, &CompletionLimits::default())
        .map_err(|broken| IoRefusal::OrderBroken { broken })
}

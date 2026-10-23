//! What the Fold oracles share: Fold states as the engine's FOLD step frames,
//! single-pair flips, the seeded Oriedita verification ([`oriedita`]) and the
//! Flat-Folder `verify` runner ([`flat_folder`]).

#![allow(dead_code)]

pub mod flat_folder;
pub mod oriedita;

use oristudio_fold::fold_file::{fold_face_orders, step_frame};
use oristudio_fold::{CreaseKind, State};
use oristudio_layer_order::{FacePair, LayerOrder};
use treemaker_fold::FoldDocument;

/// A state as Flat-Folder's `verify` reads it: the engine's own FOLD step
/// frame (`fold_file::step_frame`, what the FOLD export writes), with its
/// faces, `B`/`M`/`V`/`F` edges and `faceOrders` by face position, over the
/// crease pattern. A step frame's vertices sit at their folded images and
/// `verify` folds the crease pattern itself, so they go back to the sheet
/// coordinates the frame's face matrices start from.
pub fn verify_frame(state: &State) -> Result<FoldDocument, String> {
    let mut frame = step_frame(state).map_err(|e| e.to_string())?;
    frame.vertices_coords = state.vertices().iter().map(|p| p.to_vec()).collect();
    Ok(frame)
}

/// Another order on a state's faces as the `faceOrders` its step frame would
/// carry: what a negative control hands `verify` beside the frame.
pub fn verify_order(state: &State, order: &LayerOrder) -> Result<Vec<[i64; 3]>, String> {
    fold_face_orders(state, order).map_err(|e| e.to_string())
}

/// Whether any crease is flat: a precrease, or a fold since undone. Oriedita
/// folds only the folding colours, so it merges faces across these.
pub fn has_flat_creases(state: &State) -> bool {
    state
        .creases()
        .iter()
        .any(|crease| matches!(crease.kind, CreaseKind::Flat(_)))
}

/// `order` with one pair the other way round; none for an undetermined pair.
pub fn flipped(order: &LayerOrder, pair: FacePair) -> Option<LayerOrder> {
    let lo_above = order.above(pair.lo(), pair.hi())?;
    let (upper, lower) = if lo_above {
        (pair.hi(), pair.lo())
    } else {
        (pair.lo(), pair.hi())
    };
    let mut flipped = order.clone();
    flipped.set_above(upper, lower).ok()?;
    Some(flipped)
}

/// A deterministic pick among `n` items for a sequence and a step: SplitMix64's
/// finaliser over both.
pub fn pick(sequence: u64, step: u32, n: usize) -> usize {
    let mut z = sequence
        .wrapping_mul(0x9e37_79b9_7f4a_7c15)
        .wrapping_add(u64::from(step));
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    ((z ^ (z >> 31)) % n.max(1) as u64) as usize
}

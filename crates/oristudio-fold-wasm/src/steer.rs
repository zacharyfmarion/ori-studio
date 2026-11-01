//! The Layer order dialog's engine across the bridge
//! (`implementation-plans/layer-order-dialog.md`, row E7; approach 5): the
//! constraint sessions of `oristudio_fold::steer`, held by handle
//! ([`LayerSessions`]) on the same `FoldEngine` the Fold workspace uses, so
//! the dialog needs no wasm of its own.
//!
//! The dialog runs these in workers of its own (U6), never in the Fold
//! workspace's: a call cannot be interrupted, so its Stop and Cancel
//! terminate the worker, and every session goes with it. Nothing in the
//! Fold workspace calls them, and none of Fold's own calls changes.
//!
//! - [`sessions`]: the store and every call, in plain Rust.
//! - [`wire`]: what crosses, and the codes refusals and errors carry.
//! - [`bindings`]: the `layer_*` calls on `FoldEngine`, with typed arrays.
//!
//! **The two engine paths share these calls** (approach 5): the dialog's
//! worker opens a session on the order its host shows
//! (`layer_open_showing`) or restores the host's record, and keeps it while
//! the user builds constraints, adding each by the preview it saw
//! (`layer_commit_preview`); a host's short-lived engine (H2,
//! `resolveLayerOrder`) restores a record, retries it on the same session
//! when it ran out of time (`layer_restore_record`), reads
//! `layer_oriedita_relations` and is terminated.
//!
//! **E6** is bound beside these, over the same store: the smallest clashing
//! set (`layer_explain`, `layer_explain_list`) and a solutions cursor
//! (`layer_solutions_*`, `layer_step`) that lives beside its session. There
//! is no count worker: the dialog's one worker advances the count in short
//! slices between its other calls, so the count, the index and the stepper
//! read one cursor.

pub mod bindings;
pub mod sessions;
pub mod wire;

pub use sessions::LayerSessions;
pub use wire::{
    CantFitKind, CantFitWire, CarriedRow, ClashWire, CommitDone, Committing, Explained,
    FACE_AMBIGUOUS, FACE_GONE, FACE_INTACT, LayerCallError, LayerFoldSource, LayerLimits,
    LayerOpened, LayerRefusal, LayerRestored, LayerSolutionCaps, LayerStepBy, OpenedOnWire,
    Opening, PAIR_KEPT, PAIR_MOVED, PAIR_UNRESOLVED, PackedStacks, PreviewFits, Previewed,
    RestoredOutcome, Restoring, SavedFace, SavedFaces, Saving, Showing, Sides, SteppedTo, Stepping,
    candidate_of, constraints_of, direction_of, flat_pairs, relations_of, side_of, triples_of,
};

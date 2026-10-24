//! Steering a flat folded figure's layer order: the engine of the Layer order
//! dialog (`implementation-plans/layer-order-dialog.md`, approach 1 and 2),
//! behind the `kernel` feature because it reads the CP kernel's own fold.
//!
//! **Ori Studio original work, not a port.** Nothing here comes from
//! Oriedita, Flat-Folder or TreeMaker. It reads Oriedita's wireframe through
//! the CP kernel's public accessors (`oristudio_cp::folding::FoldedRenderInputs`),
//! orders it with `oristudio-layer-order`'s constraint problem and
//! `treemaker-flatfold`'s search through [`crate::complete`], and hands
//! orders back in Oriedita's own relation form, so Edit can fold them through
//! its seeded entry (`CpSession::folded_figure_fold_with_order`). None of it
//! is inside a ported module, and none of it changes what an unseeded fold
//! does.
//!
//! - [`LayerSource`]: the solver's folded view built from exactly the faces
//!   Edit folded, so dialog face *k* is Oriedita face *k*, with the
//!   letters Oriedita's edge rule gives, the refusals that keep v1 honest
//!   ([`SourceRefusal`]), the pairs only the solver sees as overlapping, and
//!   [`LayerSource::oriedita_relations`] for an order going back.
//! - [`ConstraintSession`]: what the dialog asks while the user builds
//!   constraints (E5): the open pairs, a preview that never commits, a commit
//!   of the whole list, the stacks and the paper scene of the order on
//!   screen, the saved record, and a restore onto creases that may have
//!   changed ([`ConstraintSession::restore`], decision D10). The smallest
//!   clashing set and the solution count (E6) build on it:
//!   [`CantFit::constraints`] is where a smallest set is looked for.
//! - [`LayerOrderRecord`], [`read_record`] and [`encode_record`]: the saved
//!   form, byte for byte the TypeScript codec's
//!   (`apps/web/src/lib/layerOrder/layerOrderRecord.ts`).
//!
//! Nothing here is bound to wasm yet (E7).

mod record;
mod restore;
mod session;
mod source;
mod stacks;

pub use record::{
    Attention, AttentionReason, EncodeRefusal, FoldSign, LayerOrderRecord, RECORD_MAX_BYTES,
    RECORD_VERSION, RecordDamage, RecordFace, RecordPair, RecordPart, RecordRead, encode_record,
    js_number, read_record,
};
pub use restore::{
    AREA_TOLERANCE, ConstraintStatus, FaceStatus, GoneCause, RestoreOutcome, Restored,
    SavedPairStatus,
};
pub use session::{
    CantFit, CantFitProof, Commit, Committed, Constraint, ConstraintFault, ConstraintSession,
    Limits, Preview, PreviewFit, SessionRefusal, TimedOut, Verb,
};
pub use source::{LayerSource, PaperFrame, SourceRefusal, ToleranceCause};
pub use stacks::{ChangedSpots, Stacks, ViewSide};

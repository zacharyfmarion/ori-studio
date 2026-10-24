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
//!
//! The constraint session the dialog drives (open pairs, preview, commit,
//! explain, the saved record) is built on this source by the plan's later
//! rows (E5, E6).

mod source;

pub use source::{LayerSource, PaperFrame, SourceRefusal, ToleranceCause};

//! Layer order for flat folded states.
//!
//! Holds what the Fold engine, the "start from Edit's folded figure" bridge
//! and the oracle tests share (plan D8, `implementation-plans/fold-workspace.md`):
//!
//! - [`view`]: the input, a folded state as face images and the creases
//!   between them;
//! - [`order`]: the pairwise order on overlapping faces (cyclic relations
//!   allowed, undetermined pairs reported), with conversions to FOLD
//!   `faceOrders` and to Oriedita's convention;
//! - [`overlay`]: the overlay of convex face images into cells, built in full
//!   or kept wherever an operation's touched faces do not reach;
//! - [`problem`]: the constraint problem (variables, taco-taco, taco-tortilla
//!   and tortilla-tortilla buckets, transitivity from shared cells), built in
//!   full or over the faces an operation touched;
//! - [`check`](mod@check): one checker that names faces.
//!
//! Everything is decided at the one tolerance, `oristudio_geometry::tol::TOL`,
//! with the convex primitives of `oristudio_geometry::convex`. A search that
//! completes an order (plan D8: Flat-Folder's, through `treemaker-flatfold`)
//! consumes [`ConstraintProblem`] as it is.

pub mod check;
pub mod error;
pub mod order;
pub mod overlay;
pub mod problem;
mod shape;
mod table;
pub mod view;

pub use check::{CheckReport, Scope, Violation, check, check_problem, derived_letter};
pub use error::LayerOrderError;
pub use order::{FacePair, LayerOrder, LayerOrderBuilder, OrderTable, OrieditaRelation, Stacking};
pub use overlay::{Cell, Overlay};
pub use problem::{
    Ambiguity, AmbiguityCause, Buckets, Constraint, ConstraintKind, ConstraintProblem,
    MAX_STACKED_TRIPLES, StackDepth,
};
pub use view::{Edge, EdgeKind, Face, FaceId, FoldedView, Letter, MAX_FACES};

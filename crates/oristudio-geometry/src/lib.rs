//! Shared origami geometry for Ori Studio.
//!
//! The pieces the precrease planner (References workspace) and the Fold engine
//! both need, so each exists once:
//!
//! - [`tol`]: the one tolerance, in unit-sheet units and radians.
//! - [`line`](mod@line): canonical infinite lines, tolerance equality and a
//!   tolerance-aware [`LineIndex`]; [`pointgrid`]: the tolerance-aware point
//!   index.
//! - [`frame`]: one rectangular sheet in Oriedita model space and its maps to
//!   the unit rectangle; [`outline`]: border creases chained into rectangular
//!   frames (rectangles only); [`sheet`]: the unit rectangle itself.
//! - [`construct`]: the seven Huzita–Justin constructions over a [`Paper`]
//!   ([`paper`]), with their certificates. Its header states the licensing
//!   tiers.
//! - [`convex`]: convex-polygon primitives (orientation, clipping, half-plane
//!   splits, overlap) used by the layer-order crate and the Fold engine.
//!
//! Everything but `paper` and `convex` moved here from `oristudio-precrease`,
//! which re-exports the modules so its paths and wire shapes are unchanged;
//! see `implementation-plans/fold-workspace.md` (D9).
//!
//! # Coordinate space
//!
//! The unit sheet frame: y-up, origin at the lower left, longer side 1 (the
//! precrease and ReferenceFinder convention). Tolerances are fractions of that
//! sheet. [`frame`] maps it from Oriedita's y-down model space.

pub mod construct;
pub mod convex;
pub mod error;
pub mod frame;
pub mod line;
pub mod outline;
pub mod paper;
pub mod pointgrid;
pub mod sheet;
pub mod tol;

pub use construct::{Certificate, Construction, Pt, Root};
pub use error::GeometryError;
pub use frame::{Frame, FrameAffines, RfRect};
pub use line::{Line, LineIndex};
pub use outline::RefusalReason;
pub use paper::Paper;
pub use pointgrid::PointGrid;
pub use sheet::{CornerName, EdgeSide, Sheet};
pub use tol::{SNAP_RADIUS, TOL};

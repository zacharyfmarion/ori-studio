//! Precrease planner geometry for Ori Studio's References workspace.
//!
//! This crate is the first half of the planner described in
//! `implementation-plans/reference-finder-integration.md`: everything a
//! crease pattern needs before a single folding step is computed — the sheet
//! frame(s) hidden in its border creases, its segments merged into distinct
//! infinite lines, and an exactness probe that says whether the pattern lives
//! on a lattice a finite fold sequence can construct. The closure planner
//! (axioms, certificates, stuck search, pinch pass) lands in a later phase on
//! top of these types.
//!
//! # Licensing tiers
//!
//! The crate is original work under `MIT OR Apache-2.0`. It has no dependency
//! edge to the TreeMaker port (`treemaker-*`, GPL) and links no ReferenceFinder
//! code; ReferenceFinder's answers reach the planner as JSON from a separate
//! worker at runtime. Three tiers describe exactly what the crate takes from
//! Robert J. Lang's ReferenceFinder (plan decision D3):
//!
//! 1. **Behavioural constants and heuristic definitions adopted as facts**,
//!    declared in [`constants`]: the crossing-angle conditioning floor
//!    `minAngleSine = 0.342`; the skinny-flap aspect ratio `0.1`; the
//!    visibility rule (a fold is legible when at least one of its inputs is
//!    a sheet edge or a mark on one); the trivial-Haga O5 exclusion; the
//!    axiom-ease order `O2 < O3 < O7 < O6 < O5 < O4 < O1`; and the pinch
//!    convention (a line consumed only through the marks it creates is
//!    rendered as a pinch). The planner phase uses them; this phase only
//!    declares them.
//! 2. **Geometry derived from the Huzita–Justin definitions** — lines,
//!    reflections, intersections, and later the seven axioms including the
//!    O6 common-tangent cubic — written from the definitions, not from any
//!    implementation.
//! 3. **No expression copied from ReferenceFinder's `src/core` or
//!    `src/app`.** The author has read `refLine*.cpp`, so this is not a clean
//!    room; the permissive claim rests on that discipline plus the Node
//!    cross-check harness, which lives inside the GPL whole rather than here.
//!    If any code is ever transcribed, this crate becomes GPL and gets its own
//!    rows in `LICENSING.md`.
//!
//! # Coordinate spaces
//!
//! Input is Oriedita model space (y-down, default paper ±200). Each
//! rectangular sheet gets a [`Frame`] whose unit rectangle is y-up with a
//! lower-left origin and longer side 1 — ReferenceFinder's convention — so
//! the map from model space contains a reflection. See [`frame`].
//!
//! # Tolerance
//!
//! One epsilon, [`tol::TOL`], in unit-sheet units for positions and in
//! radians for directions, plus [`tol::SNAP_RADIUS`] for the exactness probe.
//! Line equality resolves the `(n, d) ~ (−n, −d)` identification at compare
//! time, never by snapping components. See [`tol`] and [`line`].

pub mod components;
pub mod constants;
pub mod error;
pub mod exactness;
pub mod frame;
pub mod lattice;
pub mod line;
pub mod merge;
pub mod outline;
pub mod pointgrid;
pub mod tol;

pub use components::{Component, SheetAnalysis, Warning, analyze};
pub use error::PrecreaseError;
pub use exactness::{
    Exactness, ExactnessClass, Residuals, SnappedComponent, SnappedLine, probe, snap,
};
pub use frame::{Frame, FrameAffines, RfRect};
pub use lattice::{LatticeOffset, Ring};
pub use line::{Line, LineIndex};
pub use merge::{LineKind, MergedLine};
pub use outline::RefusalReason;
pub use tol::{SNAP_RADIUS, TOL};

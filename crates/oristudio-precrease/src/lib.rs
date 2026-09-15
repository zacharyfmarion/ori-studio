//! Precrease planner geometry for Ori Studio's References workspace.
//!
//! The planner described in
//! `implementation-plans/reference-finder-integration.md`, in two halves.
//!
//! Everything a crease pattern needs before a single folding step is computed:
//! the sheet frame(s) hidden in its border creases ([`frame`], [`outline`],
//! [`components`]), its segments merged into distinct infinite lines
//! ([`merge`]), and an exactness probe that says whether the pattern lives on
//! a lattice a finite fold sequence can construct ([`exactness`],
//! [`lattice`]).
//!
//! Then the planner itself: the state `(L, P)` of folded lines and their
//! in-paper intersections ([`state`]), forward constructors for the seven
//! Huzita–Justin axioms ([`construct`]) and the inverse conditions that select
//! their witnesses ([`predicates`]), the incremental closure that folds every
//! constructible line to a fixpoint ([`closure`]), the forward-first search
//! that unsticks it ([`candidates`], [`stuck`]), the pinch pass that reduces
//! an auxiliary crease to the marks it is needed for ([`pinch`]), the
//! ordering and grouping passes ([`order`]) and the driver that runs them and
//! emits the wire shape ([`planner`], [`sequence`]).
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
//!    fold-ease order `O2 < O3 < O4 on an edge < O5 < O7 < O6 < O4 < O1`;
//!    and the pinch
//!    convention (a line consumed only through the marks it creates is
//!    rendered as a pinch). Two of these are scored, never enforced —
//!    visibility and the skinny flap, because a crease-pattern line has to be
//!    folded whether or not it is legible; the trivial-Haga exclusion is
//!    enforced, because a point already on the line it is folded onto has
//!    nothing to align.
//! 2. **Geometry derived from the Huzita–Justin definitions** — lines,
//!    reflections, intersections, and the seven axioms including the O6
//!    common-tangent cubic — written from the definitions, with their
//!    validity filters re-derived from one principle (*a fold must align
//!    in-paper material*), not from any implementation. [`construct`] states
//!    each axiom as an alignment condition and solves it.
//! 3. **No expression copied from ReferenceFinder's `src/core` or
//!    `src/app`.** The author has read `refLine*.cpp`, so this is not a clean
//!    room; the permissive claim rests on that discipline plus the Node
//!    cross-check harness in `tools/precrease-rf-crosscheck/`, which lives
//!    inside the GPL whole rather than here — as does the predicate that
//!    mimics ReferenceFinder's legibility filters, so that the crate scores
//!    the rules and only the harness applies them the way ReferenceFinder
//!    does. If any code is ever transcribed, this crate becomes GPL and gets
//!    its own rows in `LICENSING.md`.
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

pub mod candidates;
pub mod clock;
pub mod closure;
pub mod components;
pub mod constants;
pub mod construct;
pub mod direction;
pub mod drive;
pub mod error;
pub mod exactness;
pub mod fixture_io;
pub mod frame;
pub mod grid;
pub mod judge;
pub mod lattice;
pub mod line;
pub mod marks;
pub mod merge;
pub mod order;
pub mod outline;
pub mod pinch;
pub mod planner;
pub mod pointgrid;
pub mod predicates;
pub mod sequence;
pub mod sheet;
pub mod state;
pub mod stuck;
pub mod tol;

pub use clock::{Clock, Deadline, default_clock};
pub use closure::{CloseOutcome, Closure, FoldOutcome, FoldedLine, Target};
pub use components::{Component, SheetAnalysis, Warning, analyze};
pub use direction::{Direction, FIRM_MAJORITY, Side, majority, share_of};
pub use drive::{DriverState, LastStep, PlanAction, PlanState, StopReason, next_action};
pub use error::PrecreaseError;
pub use exactness::{
    Exactness, ExactnessClass, Residuals, SnappedComponent, SnappedLine, probe, snap,
};
pub use frame::{Frame, FrameAffines, RfRect};
pub use grid::{Grid, GridFamily, GridKind, GridLine};
pub use lattice::{LatticeOffset, Ring};
pub use line::{Line, LineIndex};
pub use marks::{
    Creased, MIN_ALIGNMENT, crease_lands_on, crease_runs, end_is_found, ends_are_found,
    mark_exists, point_lands_on, point_mark_exists, runs_reach, witness_aligns, witness_lines_meet,
    witness_marks_exist, witness_missing_marks,
};
pub use merge::{LineKind, MergedLine};
pub use outline::RefusalReason;
pub use pinch::Extent;
pub use planner::{
    Explanation, Planner, PlannerOptions, PlannerOptionsJson, RemainingLine, StuckSummary,
};
pub use predicates::{Ref, Witness};
pub use sequence::{Sequence, Status, Step, StepKind, Totals};
pub use sheet::Sheet;
pub use state::{LineTag, State};
pub use tol::{SNAP_RADIUS, TOL};

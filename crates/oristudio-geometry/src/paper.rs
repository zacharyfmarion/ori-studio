//! What a Huzita–Justin construction asks of the paper it folds.
//!
//! The validity filters in [`crate::construct`] follow one principle, *a fold
//! must align in-paper material*, and that needs only three questions of the
//! paper: is a point on it (a landing point, a crossing with a reference), where
//! along a line is there paper (the material O3 folds onto its reference), and
//! does a fold cross it at all. [`Paper`] is those three questions.
//!
//! [`Sheet`](crate::sheet::Sheet), the precrease planner's rectangle, answers
//! them with the methods it already had, so the planner's constructions are
//! unchanged by the trait (the probe in
//! `research/2026-10-08-fold-workspace/r3-reuse-geometry-cp-io.md` found them
//! bit-identical over 600,000 constructions). The Fold engine's silhouette, a
//! union of convex faces, answers them for folded paper, where the same filters
//! refuse a fold onto a landmark whose material is not there.

use crate::line::Line;
use crate::tol::TOL;

/// The paper a construction folds, in the unit frame.
pub trait Paper {
    /// Whether `p` lies on the paper padded by `pad`.
    fn contains(&self, p: [f64; 2], pad: f64) -> bool;

    /// The maximal runs of `line` that lie on the paper, as disjoint parameter
    /// intervals `(t0, t1)` along it (see [`Line::parameter`]); none when the
    /// line misses the paper. A line that only touches the paper at a point
    /// yields a degenerate interval.
    fn intervals(&self, line: &Line) -> impl Iterator<Item = (f64, f64)>;

    /// Whether `line` has an in-paper run longer than [`TOL`]: a fold that
    /// only grazes the paper is not a fold.
    fn crosses(&self, line: &Line) -> bool {
        self.intervals(line).any(|(t0, t1)| t1 - t0 > TOL)
    }
}

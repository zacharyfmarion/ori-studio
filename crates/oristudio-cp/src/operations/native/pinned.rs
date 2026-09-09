//! Pinned vertices — positions that a transform must leave exactly where they
//! are.
//!
//! **Ori Studio native.** Oriedita has no notion of a held vertex; every
//! transform there moves whatever is selected, whole. This is a constraint
//! layered *onto* those ported operations, and it is written so that an empty
//! set is byte-identical to the port: [`PinnedPoints::holds`] short-circuits on
//! an empty slice, and every call site reduces to the expression it replaced.
//! So the Oriedita parity oracle sees the operations it always saw.
//!
//! # Why the kernel, and not a fix-up afterwards
//!
//! `move_selected_lines` deletes the selected creases, transforms them, and then
//! re-splits them against everything they now cross. A crease with one end held
//! is *stretched*, and a stretched crease crosses different creases than a
//! translated one — so a correction applied after the split would produce
//! geometry the splitter never saw. The constraint has to be applied while the
//! new coordinates are being computed, which is here.
//!
//! # Why it is a position
//!
//! For the same reason the browser's pin is (`cp-workspace/pins/vertexPins.ts`):
//! a crease-pattern vertex is not an object, it is a coincidence of crease
//! endpoints, and there is no id to hold. The caller sends positions on the
//! command payload and matching uses [`VERTEX_COINCIDENCE`], the same epsilon
//! that decides which endpoints sit on one junction anywhere else in the kernel.

use super::vertex::VERTEX_COINCIDENCE;
use crate::geometry::Point;

/// The pinned positions a single command was given. Borrowed, never owned: it is
/// read from the payload for the length of one dispatch.
#[derive(Debug, Clone, Copy, Default)]
pub struct PinnedPoints<'a> {
    points: &'a [Point],
}

impl<'a> PinnedPoints<'a> {
    pub fn new(points: &'a [Point]) -> Self {
        Self { points }
    }

    /// No pins: every operation below behaves exactly as its Oriedita port does.
    pub fn none() -> Self {
        Self { points: &[] }
    }

    pub fn is_empty(&self) -> bool {
        self.points.is_empty()
    }

    /// Whether a pin sits on `point`.
    pub fn holds(&self, point: Point) -> bool {
        !self.points.is_empty()
            && self
                .points
                .iter()
                .any(|pin| pin.distance(point) <= VERTEX_COINCIDENCE)
    }

    /// `before` when it is pinned, `after` otherwise — the whole rule.
    ///
    /// Applied per endpoint rather than per segment, which is what makes a
    /// crease with one pinned end *stretch* rather than refuse: the free end
    /// takes the transform and the held one does not.
    pub fn hold(&self, before: Point, after: Point) -> Point {
        if self.holds(before) { before } else { after }
    }
}

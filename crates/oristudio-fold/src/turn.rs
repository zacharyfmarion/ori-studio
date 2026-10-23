//! Turning the model over about either display axis: a document's turn step
//! names the axis (`apps/web/src/lib/steps/turn.ts`, `TurnOverAxis`), and one
//! turn is one step whichever it is.
//!
//! [`State::turn_over`] mirrors the display side to side, about its vertical
//! axis. Top to bottom is the same mirror followed by a half turn, since
//! `(x, y) ↦ (x, −y)` is the rotation by π after `(x, y) ↦ (−x, y)`. Like
//! every turn it changes only the view: no layer, letter or isometry moves.

use serde::{Deserialize, Serialize};

use crate::state::State;

/// The display axis a turn-over turns the model about.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TurnAxis {
    /// Side to side: what [`State::turn_over`] does.
    #[default]
    Vertical,
    /// Top to bottom.
    Horizontal,
}

impl State {
    /// Turn the model over about `axis`, as one step.
    pub fn turn_over_about(&self, axis: TurnAxis) -> State {
        let view = self.view().turned_over();
        let view = match axis {
            TurnAxis::Vertical => view,
            TurnAxis::Horizontal => view.rotated(std::f64::consts::PI),
        };
        self.with_view(view, self.step() + 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sheet::Sheet;
    use crate::view::StartSide;

    fn close(a: [f64; 2], b: [f64; 2]) -> bool {
        (a[0] - b[0]).abs() < 1e-12 && (a[1] - b[1]).abs() < 1e-12
    }

    #[test]
    fn a_vertical_turn_is_turn_over() {
        let s = State::flat(Sheet::square(), StartSide::Front)
            .unwrap_or_else(|e| panic!("{e}"))
            .rotate(0.3);
        let turned = s.turn_over_about(TurnAxis::Vertical);
        assert_eq!(turned.view(), s.turn_over().view());
        assert_eq!(turned.step(), s.step() + 1);
    }

    #[test]
    fn a_horizontal_turn_mirrors_the_display_top_to_bottom_in_one_step() {
        let s = State::flat(Sheet::square(), StartSide::Front)
            .unwrap_or_else(|e| panic!("{e}"))
            .rotate(0.7);
        let turned = s.turn_over_about(TurnAxis::Horizontal);
        assert_eq!(turned.step(), s.step() + 1);
        assert!(turned.view().flipped);
        let p = [0.25, 0.8];
        let seen = s.view().transform().apply(p);
        let after = turned.view().transform().apply(p);
        assert!(close(after, [seen[0], -seen[1]]), "{after:?} {seen:?}");
        // Twice is where it started, and the model never moved.
        let back = turned.turn_over_about(TurnAxis::Horizontal);
        assert!(close(back.view().transform().apply(p), seen));
        assert_eq!(back.order(), s.order());
        assert_eq!(back.residual(), s.residual());
    }
}

//! The view: a turn-over and a rotation, applied for display only (plan D2,
//! D6 *Frames*).
//!
//! The *model frame* is the folded frame the root-carried isometries give.
//! Every stored line, every layer order and every letter lives in it; the view
//! only says how a viewer sees it. Keeping the two apart is what lets a stored
//! line mean the same thing after a turn-over (the core spike composed the
//! turn-over into the root isometry instead, research §3).
//!
//! What the view changes is what "toward the viewer" means: after a turn-over
//! the viewer looks at the model frame from −z, so a valley the viewer makes
//! is a mountain in the model frame, and the layer the viewer sees on top is
//! the bottom one there.

use serde::{Deserialize, Serialize};

use crate::isometry::Isometry;

/// A plain fold's direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    /// The moving part rotates toward the viewer and lands on top.
    Valley,
    /// The moving part rotates away from the viewer and lands underneath.
    Mountain,
}

impl Direction {
    pub fn opposite(self) -> Direction {
        match self {
            Direction::Valley => Direction::Mountain,
            Direction::Mountain => Direction::Valley,
        }
    }
}

/// Which side of the sheet faces the viewer before any fold.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum StartSide {
    #[default]
    Front,
    Back,
}

/// How the viewer sees the model frame.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
pub struct View {
    /// Turned over: the viewer looks from −z.
    pub flipped: bool,
    /// Counter-clockwise rotation in radians, applied after the turn-over.
    pub rotation: f64,
}

impl View {
    /// The view of a sheet that starts with `side` up. A sheet started back-up
    /// is a front-up model seen turned over, so the first valley the viewer
    /// makes stores an M (research §3.1).
    pub fn starting(side: StartSide) -> View {
        View {
            flipped: side == StartSide::Back,
            rotation: 0.0,
        }
    }

    /// Model frame to display frame: the rotation after the mirror image
    /// `x ↦ −x` when turned over. A linear map; the display places the camera.
    pub fn transform(&self) -> Isometry {
        let rotation = Isometry::rotation(self.rotation);
        if self.flipped {
            rotation.after(&Isometry::MIRROR_X)
        } else {
            rotation
        }
    }

    /// A direction the viewer gives, in the model frame.
    pub fn model_direction(&self, seen: Direction) -> Direction {
        if self.flipped { seen.opposite() } else { seen }
    }

    /// Whether the viewer sees `above` (a model-frame relation) as above.
    pub fn seen_above(&self, above: bool) -> bool {
        above != self.flipped
    }

    /// Turned over about the display's vertical axis: mirroring the display
    /// after a rotation by θ is the rotation by −θ after the mirror image.
    pub fn turned_over(&self) -> View {
        View {
            flipped: !self.flipped,
            rotation: normalize_angle(-self.rotation),
        }
    }

    /// Rotated by `angle` radians, counter-clockwise on the display. A
    /// non-finite angle is no rotation.
    pub fn rotated(&self, angle: f64) -> View {
        let angle = if angle.is_finite() { angle } else { 0.0 };
        View {
            flipped: self.flipped,
            rotation: normalize_angle(self.rotation + angle),
        }
    }
}

/// The same angle in (−π, π].
fn normalize_angle(angle: f64) -> f64 {
    let tau = std::f64::consts::TAU;
    let a = angle.rem_euclid(tau);
    if a > std::f64::consts::PI { a - tau } else { a }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: [f64; 2], b: [f64; 2]) -> bool {
        (a[0] - b[0]).abs() < 1e-12 && (a[1] - b[1]).abs() < 1e-12
    }

    #[test]
    fn a_turned_over_view_swaps_valley_and_mountain() {
        let front = View::starting(StartSide::Front);
        let back = View::starting(StartSide::Back);
        assert_eq!(front.model_direction(Direction::Valley), Direction::Valley);
        assert_eq!(back.model_direction(Direction::Valley), Direction::Mountain);
        assert!(back.seen_above(false));
        assert_eq!(front.turned_over(), back);
    }

    #[test]
    fn turning_over_mirrors_the_display_horizontally() {
        let quarter = std::f64::consts::FRAC_PI_2;
        let v = View::default().rotated(quarter);
        let p = [1.0, 0.0];
        let seen = v.transform().apply(p);
        // Mirroring the display: the same point at −x.
        let turned = v.turned_over().transform().apply(p);
        assert!(close(turned, [-seen[0], seen[1]]));
        assert!(!v.turned_over().transform().front_up());
        // Twice is the identity.
        assert_eq!(v.turned_over().turned_over(), v);
    }

    #[test]
    fn rotation_stays_in_one_turn() {
        let v = View::default().rotated(3.0).rotated(3.0);
        assert!(v.rotation > -std::f64::consts::PI && v.rotation <= std::f64::consts::PI);
        assert!((v.rotation - (6.0 - std::f64::consts::TAU)).abs() < 1e-12);
        assert_eq!(v.rotated(f64::NAN), v);
        assert_eq!(v.rotated(f64::INFINITY), v);
    }
}

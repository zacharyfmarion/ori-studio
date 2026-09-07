//! Which way a crease folds, and which face of the sheet it is folded from.
//!
//! A precrease is made by an alignment — bring a point onto a point, a line
//! onto a line — and an alignment fold is a **valley on the face you are
//! working from**. So a crease that must end up a mountain in the finished
//! pattern is made with the sheet turned over, and the direction a step wants
//! decides the side it has to be made on. That is the whole content of
//! [`Direction::side`], and it is why the presentation order has to group
//! steps by side: every turn-over is a step the folder actually performs.
//!
//! # One direction per line
//!
//! A step folds one whole line, and a line's creases in the finished pattern
//! are very often *not* all the same direction — measured over 395 designs of
//! the benchmark corpus, 31.7% of steps fold a line that carries both. A step
//! that creased part of a line one way and part the other is not a fold anyone
//! can make, so the direction is decided once for the whole line, by
//! [`majority`], **by creased length and never by count**.
//!
//! The cost of that is real and is not hidden: 14.8% of all creased length
//! ends up the opposite way from the finished pattern. [`Target::direction_share`]
//! carries it per line so the consumer can say so.
//!
//! [`Target::direction_share`]: crate::closure::Target::direction_share
//!
//! # Firm and weak majorities
//!
//! 41.7% of those mixed lines are near coin-flips. Below [`FIRM_MAJORITY`] the
//! majority is not treated as deciding anything: the line does not force a
//! side, and the ordering pass folds it on whichever side is already up. That
//! is [`Direction::is_firm`], and it is a tie-break rather than a policy — it
//! is worth about 9% of the remaining turn-overs.

use serde::{Deserialize, Serialize};

/// The share of a line's creased length its majority direction must reach
/// before the direction is allowed to force a turn-over.
pub const FIRM_MAJORITY: f64 = 0.6;

/// Which way a crease folds in the finished pattern.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    Mountain,
    Valley,
    /// The line carries no mountain or valley creases at all — an auxiliary
    /// fold, or a line the pattern leaves unassigned. It is still creased, on
    /// whichever side the sheet happens to be on.
    Unassigned,
}

/// Which face of the sheet is up.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Side {
    /// The face the finished pattern is read from. Every sequence starts and
    /// ends here.
    Front,
    Back,
}

impl Side {
    /// The other face.
    pub fn flipped(self) -> Side {
        match self {
            Side::Front => Side::Back,
            Side::Back => Side::Front,
        }
    }

    /// What a crease made from this face becomes in the finished pattern.
    pub fn direction(self) -> Direction {
        match self {
            Side::Front => Direction::Valley,
            Side::Back => Direction::Mountain,
        }
    }
}

impl Direction {
    /// The face a crease of this direction has to be made from, or `None` when
    /// the line does not care.
    pub fn side(self) -> Option<Side> {
        match self {
            Direction::Mountain => Some(Side::Back),
            Direction::Valley => Some(Side::Front),
            Direction::Unassigned => None,
        }
    }

    /// The direction of the same crease seen from the other face.
    pub fn flipped(self) -> Direction {
        match self {
            Direction::Mountain => Direction::Valley,
            Direction::Valley => Direction::Mountain,
            Direction::Unassigned => Direction::Unassigned,
        }
    }

    /// Whether a majority of `share` decides this direction. `Unassigned` never
    /// does; anything else does once it reaches [`FIRM_MAJORITY`].
    pub fn is_firm(self, share: f64) -> bool {
        self != Direction::Unassigned && share >= FIRM_MAJORITY
    }
}

/// The majority direction of a line's creases and the share of the creased
/// length it covers.
///
/// Returns `(Unassigned, 0.0)` for a line with no mountain and no valley
/// length — an auxiliary fold. A dead tie resolves to `Mountain` for
/// determinism; it is under [`FIRM_MAJORITY`] either way, so the ordering pass
/// decides it.
pub fn majority(mountain_length: f64, valley_length: f64) -> (Direction, f64) {
    let total = mountain_length + valley_length;
    if total.is_nan() || total <= 0.0 {
        return (Direction::Unassigned, 0.0);
    }
    if mountain_length >= valley_length {
        (Direction::Mountain, mountain_length / total)
    } else {
        (Direction::Valley, valley_length / total)
    }
}

/// The share of a line's creased length that `resolved` gets right, given that
/// `majority` covers `share` of it.
///
/// The ordering pass may crease a line the opposite way from its majority when
/// the majority is weak, and the consumer needs the honest number for the line
/// it is actually looking at.
pub fn share_of(majority: Direction, share: f64, resolved: Direction) -> f64 {
    match (majority, resolved) {
        (Direction::Unassigned, _) | (_, Direction::Unassigned) => 0.0,
        (m, r) if m == r => share,
        _ => 1.0 - share,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_line_with_no_creases_is_unassigned() {
        assert_eq!(majority(0.0, 0.0), (Direction::Unassigned, 0.0));
    }

    #[test]
    fn the_majority_is_by_length_and_not_by_count() {
        // One long mountain against three short valleys.
        let (direction, share) = majority(0.9, 0.3);
        assert_eq!(direction, Direction::Mountain);
        assert!((share - 0.75).abs() < 1e-12, "{share}");
        assert!(direction.is_firm(share));
    }

    #[test]
    fn a_near_coin_flip_does_not_force_a_side() {
        let (direction, share) = majority(0.55, 0.45);
        assert_eq!(direction, Direction::Mountain);
        assert!(!direction.is_firm(share), "0.55 is under the firm majority");
        assert_eq!(direction.side(), Some(Side::Back), "it still leans");
    }

    #[test]
    fn a_mountain_is_folded_from_the_back_and_a_valley_from_the_front() {
        assert_eq!(Direction::Mountain.side(), Some(Side::Back));
        assert_eq!(Direction::Valley.side(), Some(Side::Front));
        assert_eq!(Direction::Unassigned.side(), None);
        assert_eq!(Side::Back.direction(), Direction::Mountain);
        assert_eq!(Side::Front.direction(), Direction::Valley);
    }

    #[test]
    fn creasing_a_weak_line_the_other_way_reports_the_share_it_gets_right() {
        let (direction, share) = majority(0.55, 0.45);
        assert!((share_of(direction, share, Direction::Mountain) - 0.55).abs() < 1e-12);
        assert!((share_of(direction, share, Direction::Valley) - 0.45).abs() < 1e-12);
    }

    #[test]
    fn an_unassigned_line_has_no_share_either_way() {
        assert_eq!(share_of(Direction::Unassigned, 0.0, Direction::Valley), 0.0);
        assert_eq!(
            share_of(Direction::Mountain, 1.0, Direction::Unassigned),
            0.0
        );
    }
}

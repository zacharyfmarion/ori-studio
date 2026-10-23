//! The numerics policy (plan D5, research §6): f64 with one tolerance, line
//! snapping, and a minimum feature size.
//!
//! Every length is a fraction of the sheet, whose longer side is 1, so the
//! shared [`TOL`] is "1e-6 of the sheet" without scaling.
//!
//! | Band | Distance `d` of a vertex image from the fold line | Meaning |
//! |---|---|---|
//! | on | `|d| ≤ TOL` | the line passes through it; it is snapped exactly |
//! | near miss | `TOL < |d| < MIN_FEATURE` | refused, never folded |
//! | side | `|d| ≥ MIN_FEATURE` | on the moving or the stationary side |

pub use oristudio_geometry::tol::TOL;

/// Minimum material feature μ. Near misses, new creases shorter than μ, and
/// new pieces thinner than μ/2 are refused to keep material topology stable.
///
/// Narrow overlaps of existing face images do not create small material
/// pieces. They are allowed when the full overlay, pair and hinge constraints
/// agree at [`TOL`]; ambiguous geometry and invalid orders remain refused.
/// The original blanket overlap cutoff predated that structural validity gate.
pub const MIN_FEATURE: f64 = 1e-3;

/// How exactly a snapped line must pass through every vertex image it is
/// snapped through. A vertex left between this and [`TOL`] off it would
/// become a chord endpoint whose chord leans by about its offset over the
/// chord's length, so the snap is refused as ambiguous instead (the spike
/// refused 12 of 27k attempts this way).
pub const EXACT: f64 = 1e-9;

// The bands only work while they are far apart.
const _: () = assert!(MIN_FEATURE / TOL >= 100.0);
const _: () = assert!(TOL / EXACT >= 100.0);

/// Where a distance from the fold line falls.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Band {
    /// On the moving side, at least [`MIN_FEATURE`] from the line.
    Moving,
    /// On the stationary side, at least [`MIN_FEATURE`] from the line.
    Stationary,
    /// Within [`TOL`] of the line.
    On,
    /// Strictly between [`TOL`] and [`MIN_FEATURE`] from the line.
    Near,
}

impl Band {
    /// The band of a signed distance, positive on the moving side.
    pub(crate) fn of(d: f64) -> Band {
        let a = d.abs();
        if a <= TOL {
            Band::On
        } else if a < MIN_FEATURE {
            Band::Near
        } else if d > 0.0 {
            Band::Moving
        } else {
            Band::Stationary
        }
    }

    /// The vertex class the fold works with: +1 moving side, −1 stationary
    /// side, 0 on the line. A near miss has no class.
    pub(crate) fn class(self) -> Option<i8> {
        match self {
            Band::Moving => Some(1),
            Band::Stationary => Some(-1),
            Band::On => Some(0),
            Band::Near => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bands_split_at_tol_and_the_minimum_feature() {
        assert_eq!(Band::of(0.0), Band::On);
        assert_eq!(Band::of(-TOL), Band::On);
        assert_eq!(Band::of(2.0 * TOL), Band::Near);
        assert_eq!(Band::of(-0.5 * MIN_FEATURE), Band::Near);
        assert_eq!(Band::of(MIN_FEATURE), Band::Moving);
        assert_eq!(Band::of(-0.3), Band::Stationary);
        assert_eq!(Band::Near.class(), None);
        assert_eq!(Band::On.class(), Some(0));
    }
}

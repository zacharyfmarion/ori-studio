//! The crate's tolerance policy: one epsilon, in unit-sheet units.
//!
//! The editor decides line identity with Oriedita's `Epsilon::POINT =
//! 2.5e-4` in its 400-unit paper space
//! (`crates/oristudio-cp/src/geometry/epsilon.rs`). Divided by the 400 side
//! that is `6.25e-7` of the sheet; [`TOL`] rounds it up to `1e-6` so the
//! planner never calls two lines distinct that the editor treats as one. The
//! same number is used in radians for directions, since a unit normal that is
//! off by `TOL` radians moves a point at unit distance by `TOL`.
//!
//! The prototype's false negatives came from mixing two tolerances (1e-7
//! predicates against 1e-6 hash quanta); everything in this crate that
//! compares, indexes or dedupes lines and points uses [`TOL`], and every
//! index is tolerance-aware rather than exact-hashed.

/// Position tolerance in unit-sheet units and direction tolerance in radians.
pub const TOL: f64 = 1e-6;

/// Radius within which the exactness probe may move a line or a vertex onto
/// the lattice: `2e-3` of the sheet side (≈ 0.8 units in the 400 space). A
/// design whose residuals exceed this is off-lattice, not snappable.
pub const SNAP_RADIUS: f64 = 2e-3;

// The two tolerances must stay far apart: the probe treats anything under
// `TOL` as exact and anything under `SNAP_RADIUS` as a candidate to move.
const _: () = assert!(SNAP_RADIUS / TOL >= 1000.0);

/// The Oriedita constant [`TOL`] derives from, kept here so the derivation is
/// checkable without a dependency on `oristudio-cp`.
pub const ORIEDITA_EPSILON_POINT: f64 = 0.01 * 0.025;

/// Side of Oriedita's default paper in model units (±200).
pub const ORIEDITA_PAPER_SIDE: f64 = 400.0;

/// Oriedita's default paper rectangle as `[x0, y0, x1, y1]` in model space,
/// the fallback sheet for a crease pattern with no border creases.
pub const ORIEDITA_DEFAULT_PAPER: [f64; 4] = [-200.0, -200.0, 200.0, 200.0];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tol_is_the_editor_point_epsilon_rounded_up() {
        let derived = ORIEDITA_EPSILON_POINT / ORIEDITA_PAPER_SIDE;
        assert!((derived - 6.25e-7).abs() < 1e-18);
        assert!(TOL > derived);
        assert!(TOL < 2.0 * derived);
    }
}

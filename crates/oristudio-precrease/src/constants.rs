//! Behavioural constants adopted from ReferenceFinder **as facts** — tier 1 of
//! the licence header in `lib.rs`. They describe what a legible, accurate hand
//! fold is; the planner phase scores steps with them (they are never enforced
//! on a CP line, which has to be folded regardless). This phase only declares
//! them so the later phases share one source.

/// Two folded lines create a usable mark only when they cross at an angle
/// whose sine is at least this: `|sin θ| ≥ 0.342` (about 20°). Below it the
/// intersection is too ill-conditioned to locate by hand.
pub const MIN_ANGLE_SINE: f64 = 0.342;

/// A fold that would leave a flap thinner than this fraction of the sheet is
/// considered hard to make (the "skinny flap" rule). Scored, not enforced.
pub const SKINNY_FLAP_ASPECT: f64 = 0.1;

/// Visibility rule: a step is legible when at least one of its inputs is a
/// sheet edge, or a mark that lies on a sheet edge. Steps whose every input
/// is interior are harder to locate and are flagged `hard`.
pub const VISIBILITY_MATTERS: bool = true;

/// The trivial Haga case of O5 — folding a point onto a line it already
/// touches — carries no information, so it is **enforced** by the O5
/// constructor rather than scored: no such construction is produced, and no
/// witness can name one. (It is the one legibility rule that is enforced;
/// visibility and the skinny flap are scored, because a crease-pattern line
/// has to be folded whether or not it is legible.)
pub const EXCLUDE_TRIVIAL_HAGA_O5: bool = true;

/// Axiom ease order, most accurate by hand first: O2 (point onto point),
/// O3 (line onto line), O7, O6, O5, O4, O1 (crease through two points is
/// the least accurate). The index in this array is the ease penalty.
pub const AXIOM_EASE_ORDER: [u8; 7] = [2, 3, 7, 6, 5, 4, 1];

/// Pinch convention: an auxiliary line that later steps consume only through
/// the marks it creates is rendered as a pinch around each consumed mark,
/// never as a full crease. A line used *as a line* (reflection, perpendicular
/// reference, landing line) stays a full crease and counts as visible.
pub const PINCH_WHEN_ONLY_MARKS_ARE_USED: bool = true;

/// A ReferenceFinder solution counts as exact only at this error or below;
/// measured exact solutions carry 1e-8..1e-17 (plan decision D8).
pub const RF_EXACT_ERROR: f64 = 1e-9;

/// Ease penalty of a Huzita–Justin axiom (1..=7) under [`AXIOM_EASE_ORDER`];
/// `None` for an out-of-range axiom number.
pub fn axiom_ease(axiom: u8) -> Option<usize> {
    AXIOM_EASE_ORDER.iter().position(|&a| a == axiom)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ease_order_lists_every_axiom_once() {
        let mut seen = [false; 8];
        for &a in &AXIOM_EASE_ORDER {
            assert!(!seen[a as usize], "axiom {a} listed twice");
            seen[a as usize] = true;
        }
        assert!(seen[1..].iter().all(|&s| s));
        assert_eq!(axiom_ease(2), Some(0));
        assert_eq!(axiom_ease(1), Some(6));
        assert_eq!(axiom_ease(8), None);
    }
}

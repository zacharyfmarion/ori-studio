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

/// Fold ease order, easiest by hand first: O2 (point onto point), O3 (line
/// onto line), the sheet's edge folded onto itself through a mark (O4 whose
/// line is an edge), O5 (swing a point onto a line about a pivot), then the
/// folds with two things to line up at once — O7 (a line onto itself while
/// a point lands on a line), O6 (two points onto two lines) — then the folds
/// nothing moves in: O4 through a mark perpendicular to a crease, and O1 (a
/// crease through two points, the least accurate). The index in this array
/// is the ease penalty; the flag is whether the line an O4 is perpendicular
/// to is the sheet's edge, and means nothing on any other axiom.
///
/// ReferenceFinder's default order has O7 and O6 ahead of O5. Read off a
/// card, "fold P onto A and Q onto B" is two motions to hold at once where
/// "fold through P, bringing Q onto A" is one, and the one-motion fold is the
/// clearer instruction for the same crease; so O5 comes first here. An edge
/// folded onto itself is one motion too, and the surest there is — the edge
/// is brought back onto itself along its whole length and the mark only says
/// where — which is how a diagram gives a perpendicular to an edge ("fold the
/// bottom edge onto itself through P"), so it comes before O5; a crease
/// folded onto itself is harder to see and stays where it was. This is the
/// order the card's choice is made in; the stuck search breaks its ties on
/// [`AXIOM_SEARCH_ORDER`].
pub const FOLD_EASE_ORDER: [(u8, bool); 8] = [
    (2, false),
    (3, false),
    (4, true),
    (5, false),
    (7, false),
    (6, false),
    (4, false),
    (1, false),
];

/// ReferenceFinder's default axiom order, `O2 < O3 < O7 < O6 < O5 < O4 < O1`:
/// the tie-break the stuck search sums over an auxiliary set's witnesses.
/// Kept apart from [`FOLD_EASE_ORDER`] so that which auxiliary lines the
/// search takes does not move with how a card words a fold — it is a
/// tie-break among equal candidate sets, and the fixtures pin what it picks.
pub const AXIOM_SEARCH_ORDER: [u8; 7] = [2, 3, 7, 6, 5, 4, 1];

/// Pinch convention: an auxiliary line that later steps consume only through
/// the marks it creates is rendered as a pinch around each consumed mark,
/// never as a full crease. A line used *as a line* (reflection, perpendicular
/// reference, landing line) stays a full crease and counts as visible.
pub const PINCH_WHEN_ONLY_MARKS_ARE_USED: bool = true;

/// A ReferenceFinder solution counts as exact only at this error or below;
/// measured exact solutions carry 1e-8..1e-17 (plan decision D8).
pub const RF_EXACT_ERROR: f64 = 1e-9;

/// Ease penalty of a fold under [`FOLD_EASE_ORDER`]: its Huzita–Justin
/// axiom (1..=7), and for an O4 whether the line it is perpendicular to is
/// the sheet's edge. `None` for an out-of-range axiom number.
pub fn fold_ease(axiom: u8, edge_onto_itself: bool) -> Option<usize> {
    let edge = edge_onto_itself && axiom == 4;
    FOLD_EASE_ORDER
        .iter()
        .position(|&(a, e)| a == axiom && e == edge)
}

/// [`fold_ease`] of an axiom on its own: the general case, a crease or an
/// unknown line rather than the edge.
pub fn axiom_ease(axiom: u8) -> Option<usize> {
    fold_ease(axiom, false)
}

/// The search's penalty for an axiom under [`AXIOM_SEARCH_ORDER`].
pub fn axiom_search_ease(axiom: u8) -> Option<usize> {
    AXIOM_SEARCH_ORDER.iter().position(|&a| a == axiom)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ease_order_lists_every_axiom_once() {
        let mut seen = [false; 8];
        for &a in &AXIOM_SEARCH_ORDER {
            assert!(!seen[a as usize], "axiom {a} listed twice");
            seen[a as usize] = true;
        }
        assert!(seen[1..].iter().all(|&s| s), "an axiom is missing");
        // The card's order lists every fold once: each axiom on a crease,
        // and the perpendicular to an edge on its own.
        let mut seen = [[false; 2]; 8];
        for &(a, e) in &FOLD_EASE_ORDER {
            assert!(
                !seen[a as usize][usize::from(e)],
                "fold {a}/{e} listed twice"
            );
            seen[a as usize][usize::from(e)] = true;
        }
        assert!(seen[1..].iter().all(|s| s[0]), "an axiom is missing");
        assert!(seen[4][1], "the edge folded onto itself is missing");
        assert_eq!(axiom_ease(2), Some(0));
        assert_eq!(axiom_ease(1), Some(7));
        assert_eq!(axiom_ease(8), None);
        assert!(fold_ease(4, true) < fold_ease(5, false));
        assert!(fold_ease(3, false) < fold_ease(4, true));
        assert_eq!(fold_ease(5, true), fold_ease(5, false));
    }
}

//! Saying which way an *already unassigned* crease folds.
//!
//! Ori Studio original, for the same reason as its sibling
//! [`super::unassign`]: Oriedita has no unassigned crease to hint about.
//!
//! # Why this is not part of `CreaseMakeUnassigned`
//!
//! [`super::unassign::make_unassigned_keeping_direction`] recovers the direction
//! from the colour the crease is *leaving*, so it can only hint a crease that
//! still has a direction to lose. Applied to a crease that is already
//! [`LineColor::None`] it does nothing at all — there is no colour to read.
//!
//! That left the hint reachable in exactly one way: unassign a decided crease.
//! A crease drawn unassigned, imported unassigned from a FOLD `U` edge, or
//! unassigned with the direction deliberately forgotten could never be hinted,
//! and a hint once set could never be changed or cleared. This is the verb for
//! that, and the gates make the two exact complements — that one acts only on
//! `Red1`/`Blue2`, this one only on `None`.
//!
//! Hints matter because they are the sound half of a question the solver cannot
//! answer alone: at a full fold `+180` and `-180` are the same rotation, so
//! closure cannot tell mountain from valley. Measured, supplying the hint takes
//! k=2 determinacy from 29% to 79% and drives branching to zero.

use crate::geometry::{FoldDirection, LineColor};
use crate::model::CreasePatternModel;

/// What a hint-setting command does to each selected crease.
///
/// A three-state verb rather than an `Option<FoldDirection>` payload, because
/// over the wire an absent field and a deliberate clear must not look alike: a
/// client that forgot to send the field would otherwise silently erase hints.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum DirectionHintChange {
    Mountain,
    Valley,
    /// Forget which way it went, leaving a plain unassigned crease.
    Clear,
}

impl DirectionHintChange {
    /// The hint this change writes, or `None` for [`Self::Clear`].
    pub const fn hint(self) -> Option<FoldDirection> {
        match self {
            Self::Mountain => Some(FoldDirection::Mountain),
            Self::Valley => Some(FoldDirection::Valley),
            Self::Clear => None,
        }
    }
}

/// Set or clear the fold-direction hint on each unassigned crease in `indices`.
/// Returns how many actually changed.
///
/// **Only [`LineColor::None`] is touched.** A `Red1`/`Blue2` crease already
/// states its direction in its colour, and writing a hint beside it would create
/// the contradictory state [`crate::geometry::LineSegment::with_line_color`]
/// exists to prevent; a border or auxiliary line is not a crease at all. So
/// "select everything and hint mountain" hints the undecided creases and leaves
/// every decided one exactly as it was, which is what a user means by it.
///
/// A crease already carrying the requested hint is not counted, so a repeated
/// click reports no change rather than a phantom edit — the same honesty
/// [`super::unassign`] applies to an already-unassigned crease.
///
/// Geometry is untouched, so there is deliberately no `fix2` sweep: no crossing
/// can appear from a hint, and `fix2` would clear the selection the user is
/// still working with.
pub fn set_direction_hint(
    model: &mut CreasePatternModel,
    indices: &[usize],
    change: DirectionHintChange,
) -> usize {
    let hint = change.hint();
    let mut changed = 0;
    for &index in indices {
        let Some(segment) = model.line_segments.get(index) else {
            continue;
        };
        if !matches!(segment.color, LineColor::None) || segment.fold_direction_hint == hint {
            continue;
        }
        model.line_segments[index] = segment.with_direction_hint(hint);
        changed += 1;
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::{DirectionHintChange, set_direction_hint};
    use crate::geometry::{FoldDirection, FoldMagnitude, LineColor, LineSegment, Point};
    use crate::model::CreasePatternModel;

    fn model_with(colors: &[LineColor]) -> CreasePatternModel {
        let mut model = CreasePatternModel::default();
        model.line_segments.clear();
        for (index, color) in colors.iter().enumerate() {
            let offset = index as f64;
            model.line_segments.push(
                LineSegment::new(Point::new(offset, 0.0), Point::new(offset, 10.0))
                    .with_line_color(*color),
            );
        }
        model
    }

    #[test]
    fn an_unassigned_crease_takes_the_hint() {
        let mut model = model_with(&[LineColor::None, LineColor::None]);
        assert_eq!(
            set_direction_hint(&mut model, &[0, 1], DirectionHintChange::Mountain),
            2
        );
        assert_eq!(
            model.line_segments[0].fold_direction_hint,
            Some(FoldDirection::Mountain)
        );
        assert_eq!(
            model.line_segments[1].fold_direction_hint,
            Some(FoldDirection::Mountain)
        );
        // The colour must not move: hinting is not deciding.
        assert_eq!(model.line_segments[0].color, LineColor::None);
    }

    /// The whole reason this verb exists: the unassign verbs read the direction
    /// off the colour they are leaving, so neither can touch a crease that is
    /// already unassigned.
    #[test]
    fn reaches_creases_the_unassign_verbs_cannot() {
        use crate::operations::native::unassign::make_unassigned_keeping_direction;

        let mut model = model_with(&[LineColor::None]);
        assert_eq!(make_unassigned_keeping_direction(&mut model, &[0]), 0);
        assert_eq!(model.line_segments[0].fold_direction_hint, None);

        assert_eq!(
            set_direction_hint(&mut model, &[0], DirectionHintChange::Valley),
            1
        );
        assert_eq!(
            model.line_segments[0].fold_direction_hint,
            Some(FoldDirection::Valley)
        );
    }

    #[test]
    fn a_hint_can_be_changed_and_cleared() {
        let mut model = model_with(&[LineColor::None]);
        set_direction_hint(&mut model, &[0], DirectionHintChange::Mountain);

        assert_eq!(
            set_direction_hint(&mut model, &[0], DirectionHintChange::Valley),
            1
        );
        assert_eq!(
            model.line_segments[0].fold_direction_hint,
            Some(FoldDirection::Valley)
        );

        assert_eq!(
            set_direction_hint(&mut model, &[0], DirectionHintChange::Clear),
            1
        );
        assert_eq!(model.line_segments[0].fold_direction_hint, None);
    }

    /// The gate, and the exact complement of `make_unassigned`'s. A decided
    /// crease states its direction in its colour; a hint beside it would be a
    /// second, disagreeing source of truth.
    #[test]
    fn decided_creases_borders_and_auxiliary_lines_are_left_alone() {
        let mut model = model_with(&[
            LineColor::Red1,
            LineColor::Blue2,
            LineColor::Black0,
            LineColor::Cyan3,
            LineColor::None,
        ]);
        assert_eq!(
            set_direction_hint(&mut model, &[0, 1, 2, 3, 4], DirectionHintChange::Mountain),
            1
        );
        for index in 0..4 {
            assert_eq!(model.line_segments[index].fold_direction_hint, None);
        }
        assert_eq!(model.line_segments[0].color, LineColor::Red1);
        assert_eq!(
            model.line_segments[4].fold_direction_hint,
            Some(FoldDirection::Mountain)
        );
    }

    #[test]
    fn setting_the_hint_a_crease_already_has_changes_nothing() {
        let mut model = model_with(&[LineColor::None]);
        assert_eq!(
            set_direction_hint(&mut model, &[0], DirectionHintChange::Mountain),
            1
        );
        assert_eq!(
            set_direction_hint(&mut model, &[0], DirectionHintChange::Mountain),
            0
        );
        // Clearing one that was never hinted is likewise not an edit.
        let mut fresh = model_with(&[LineColor::None]);
        assert_eq!(
            set_direction_hint(&mut fresh, &[0], DirectionHintChange::Clear),
            0
        );
    }

    /// Deciding the crease afterwards must drop the hint rather than leave it
    /// contradicting the new colour.
    #[test]
    fn deciding_the_direction_afterwards_clears_the_hint() {
        let mut model = model_with(&[LineColor::None]);
        set_direction_hint(&mut model, &[0], DirectionHintChange::Mountain);
        model.line_segments[0] = model.line_segments[0].with_line_color(LineColor::Blue2);
        assert_eq!(model.line_segments[0].fold_direction_hint, None);
    }

    /// A hint says which way, never how far. An unassigned crease has no
    /// magnitude to begin with and must not acquire one.
    #[test]
    fn no_fold_magnitude_is_introduced() {
        let mut model = model_with(&[LineColor::None]);
        set_direction_hint(&mut model, &[0], DirectionHintChange::Valley);
        assert_eq!(model.line_segments[0].fold_magnitude, None);

        // And a magnitude cannot be smuggled in beside the hint either: the
        // segment is unassigned, so `with_fold_magnitude` refuses it.
        let ninety = FoldMagnitude::from_degrees(90.0).expect("in range");
        model.line_segments[0] = model.line_segments[0].with_fold_magnitude(Some(ninety));
        assert_eq!(model.line_segments[0].fold_magnitude, None);
    }

    #[test]
    fn out_of_range_indices_are_ignored() {
        let mut model = model_with(&[LineColor::None]);
        assert_eq!(
            set_direction_hint(&mut model, &[0, 99], DirectionHintChange::Mountain),
            1
        );
    }

    #[test]
    fn geometry_is_untouched() {
        let mut model = model_with(&[LineColor::None]);
        let before = (model.line_segments[0].a, model.line_segments[0].b);
        set_direction_hint(&mut model, &[0], DirectionHintChange::Mountain);
        assert_eq!((model.line_segments[0].a, model.line_segments[0].b), before);
    }
}

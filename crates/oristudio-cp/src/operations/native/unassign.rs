//! Forgetting a crease's mountain/valley decision.
//!
//! Ori Studio original, and there is no Oriedita counterpart because upstream has
//! nothing to forget: `LineColor.NONE` is declared in the Java source and never
//! referenced by a handler, so the only way to reach an unassigned crease in
//! Oriedita is to import a FOLD file that already contains one.
//!
//! Here it is a first-class state, and the reason it needs a verb is
//! `implementation-plans/fold-angle-propagation.md`: an unassigned crease is the
//! *input* to fold-angle propagation, which solves its angle from its
//! neighbours. Without this, a free crease could only be drawn from scratch, and
//! the common case — "I drew this pattern, now let the solver redecide these
//! twelve creases" — had no route at all. `ReplaceLineTypeSelect` cannot serve
//! it either: its target list comes from [`crate::model::CustomLineType`], which
//! has no unassigned member.

use crate::geometry::LineColor;
use crate::model::CreasePatternModel;

/// Drop the mountain/valley decision on each of `indices`, leaving the crease
/// where it is with no fold direction and no fold angle. Returns how many
/// changed.
///
/// **Only `Red1` and `Blue2` are touched** — the same gate
/// [`crate::operations::color::set_signed_fold_angles`] uses, for the same
/// reason. Those are the two colours that carry a fold. A `Black0` is the
/// paper's border rather than an undecided crease, and unassigning one would
/// delete a boundary that [`crate::checks_spatial::is_interior_vertex`] depends
/// on; an auxiliary line is not a crease at all. So "select everything and
/// unassign" leaves the sheet edge and the reference lines alone, which is what
/// a user means by it.
///
/// [`crate::geometry::LineSegment::with_line_color`] drops `fold_magnitude` on
/// the way out, which is right here: a crease with no direction cannot carry a
/// magnitude, and leaving one behind would resurrect it if the crease were later
/// recoloured by hand.
///
/// Geometry is untouched, so there is deliberately no `fix2` sweep. No crossing
/// can appear from a recolour, and `fix2` clears the selection — a surprising
/// side effect for a verb that moved nothing, and one the user would feel
/// immediately because unassigning is usually followed by another action on the
/// same lines.
pub fn make_unassigned(model: &mut CreasePatternModel, indices: &[usize]) -> usize {
    unassign(model, indices, false)
}

/// Unassign, **remembering which way each crease folded**.
///
/// The common case, and the one the fold-angle chip performs. Forgetting the
/// direction as well is the rarer intent, which is why it keeps the longer path
/// through [`make_unassigned`].
///
/// The hint is what lets the solver settle a mountain/valley question it cannot
/// answer alone: at a full fold `+180` and `-180` are the same rotation, so
/// closure genuinely cannot tell them apart. Measured, supplying it takes k=2
/// determinacy from 29% to 79% and drives branching to zero.
pub fn make_unassigned_keeping_direction(
    model: &mut CreasePatternModel,
    indices: &[usize],
) -> usize {
    unassign(model, indices, true)
}

fn unassign(model: &mut CreasePatternModel, indices: &[usize], keep_direction: bool) -> usize {
    let mut changed = 0;
    for &index in indices {
        let Some(segment) = model.line_segments.get(index) else {
            continue;
        };
        if !matches!(segment.color, LineColor::Red1 | LineColor::Blue2) {
            continue;
        }
        let updated = if keep_direction {
            segment.with_direction_kept()
        } else {
            segment.with_line_color(LineColor::None)
        };
        model.line_segments[index] = updated;
        changed += 1;
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::make_unassigned;
    use crate::geometry::{FoldMagnitude, LineColor, LineSegment, Point};
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
    fn mountains_and_valleys_become_unassigned() {
        let mut model = model_with(&[LineColor::Red1, LineColor::Blue2]);
        assert_eq!(make_unassigned(&mut model, &[0, 1]), 2);
        assert_eq!(model.line_segments[0].color, LineColor::None);
        assert_eq!(model.line_segments[1].color, LineColor::None);
    }

    /// The gate, stated as a test because it is the whole safety of the verb: a
    /// border is the paper's edge, and an auxiliary line is not a crease.
    #[test]
    fn borders_and_auxiliary_lines_are_left_alone() {
        let mut model = model_with(&[LineColor::Black0, LineColor::Cyan3, LineColor::Red1]);
        assert_eq!(make_unassigned(&mut model, &[0, 1, 2]), 1);
        assert_eq!(model.line_segments[0].color, LineColor::Black0);
        assert_eq!(model.line_segments[1].color, LineColor::Cyan3);
        assert_eq!(model.line_segments[2].color, LineColor::None);
    }

    /// A partial fold angle must not survive the loss of its direction. If it
    /// did, recolouring the crease by hand later would restore an angle the user
    /// never asked for.
    #[test]
    fn a_partial_fold_angle_does_not_survive() {
        let mut model = model_with(&[LineColor::Blue2]);
        let ninety = FoldMagnitude::from_degrees(90.0).expect("in range");
        model.line_segments[0] = model.line_segments[0].with_fold_magnitude(Some(ninety));
        assert_eq!(make_unassigned(&mut model, &[0]), 1);
        assert_eq!(model.line_segments[0].color, LineColor::None);
        assert_eq!(model.line_segments[0].fold_magnitude, None);
    }

    #[test]
    fn an_already_unassigned_crease_is_not_counted_again() {
        let mut model = model_with(&[LineColor::None]);
        assert_eq!(make_unassigned(&mut model, &[0]), 0);
    }

    #[test]
    fn out_of_range_indices_are_ignored() {
        let mut model = model_with(&[LineColor::Red1]);
        assert_eq!(make_unassigned(&mut model, &[0, 99]), 1);
        assert_eq!(model.line_segments[0].color, LineColor::None);
    }

    /// The two verbs differ in exactly one thing, and it is the point of both.
    #[test]
    fn keeping_the_direction_is_what_separates_the_two_verbs() {
        use super::make_unassigned_keeping_direction;
        use crate::geometry::FoldDirection;

        let mut kept = model_with(&[LineColor::Red1, LineColor::Blue2]);
        assert_eq!(make_unassigned_keeping_direction(&mut kept, &[0, 1]), 2);
        assert_eq!(kept.line_segments[0].color, LineColor::None);
        assert_eq!(
            kept.line_segments[0].fold_direction_hint,
            Some(FoldDirection::Mountain)
        );
        assert_eq!(
            kept.line_segments[1].fold_direction_hint,
            Some(FoldDirection::Valley)
        );

        let mut forgotten = model_with(&[LineColor::Red1]);
        assert_eq!(make_unassigned(&mut forgotten, &[0]), 1);
        assert_eq!(forgotten.line_segments[0].fold_direction_hint, None);
    }

    /// Deciding a direction replaces the hint with the real thing. A hint beside
    /// a real colour would be a second, disagreeing source of truth.
    #[test]
    fn deciding_a_direction_clears_the_hint() {
        use super::make_unassigned_keeping_direction;

        let mut model = model_with(&[LineColor::Red1]);
        make_unassigned_keeping_direction(&mut model, &[0]);
        assert!(model.line_segments[0].fold_direction_hint.is_some());
        model.line_segments[0] = model.line_segments[0].with_line_color(LineColor::Blue2);
        assert_eq!(model.line_segments[0].fold_direction_hint, None);
    }

    #[test]
    fn geometry_is_untouched() {
        let mut model = model_with(&[LineColor::Red1]);
        let before = (model.line_segments[0].a, model.line_segments[0].b);
        make_unassigned(&mut model, &[0]);
        assert_eq!((model.line_segments[0].a, model.line_segments[0].b), before);
    }
}

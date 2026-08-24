//! Forgetting what a line does, leaving it undecided.
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

/// Drop the mountain/valley decision on each of `indices`, leaving the line
/// where it is with no fold direction and no fold angle. Returns how many
/// changed.
///
/// **Every line but an already-unassigned one is touched**: a mountain, a
/// valley, a paper edge, an auxiliary line of any colour. Undecided is a state a
/// line is *put into*, not a property only `Red1` and `Blue2` have — "this line
/// is part of the pattern and I have not decided what it does" is as true of a
/// border as of a crease.
///
/// The gate was `Red1 | Blue2` until the owner asked for this, on the reasoning
/// that those are the two colours carrying a fold. What that cost was silence:
/// selecting a border or a reference line and picking Make Unassigned did
/// nothing, with no message, which is a worse outcome than any the gate was
/// avoiding. Every aux colour goes, not just `Cyan3` — `Orange4` is what
/// [`crate::operations::construction`] authors by default, and unassigning one
/// aux colour while silently declining another would reproduce the same bug one
/// colour along.
///
/// Neither a border nor an auxiliary line carries a direction, so
/// [`crate::geometry::FoldDirection::from_line_color`] answers `None` for both
/// and [`make_unassigned_keeping_direction`] needs no special case: there is no
/// direction to keep, and it unassigns them with no hint.
///
/// # What this does to the checker
///
/// A `Black0` is what makes a vertex a boundary vertex —
/// [`crate::checks_spatial::is_interior_vertex`] declines any vertex touching
/// one — so unassigning borders moves vertices into the population the closure
/// condition applies to. Measured over the Tier A corpus (13 documents, 4,701
/// vertices) rather than assumed:
///
/// - Unassigning **one** border segment changes no verdict's content anywhere.
///   The vertex still touches the *other* border at that corner, so it is still
///   not interior; it only moves from the flat branch, which reported nothing
///   for it, to a spatial report of
///   [`crate::checks_spatial::Unknowable::PaperEdge`]. 286 single-border trials,
///   390 vertices gaining that report, 0 new failures.
/// - Unassigning **every** border changes 1,224 verdicts (26% of vertices) and
///   every one of them lands on `Unknowable::TooManyUnknowns`, because a rim
///   vertex then has two undecided creases and the live check solves for fewer.
///   **0 become `Broken`**, and `checked_vertices` — the denominator "no errors"
///   is implicitly about — is identical on all 13 files.
///
/// So the checker gains no new evaluations here; it gains the admission that a
/// condition now exists at the rim and it cannot see far enough to evaluate it.
///
/// # Select-all dissolves the sheet outline, and that is allowed
///
/// Deliberately unguarded, on four grounds. The measurement above is the first:
/// the feared outcome — a document lighting up red because its border went
/// undecided — does not occur. The second is that a guard has no principled
/// shape: Ctrl+A and a drag-box round the whole sheet are one intent, and a
/// rule keyed on either would make the verb depend on *how* the selection was
/// made. The third is that this is an explicit, single-purpose menu item and one
/// undo, and replacing "silently does nothing" with "silently does less than
/// asked" keeps the defect while adding a rule to learn. The fourth is that it
/// is cheap: with no `Black0` left,
/// [`crate::checks_spatial::interior_border_segments`] early-outs and never
/// traces the arrangement, so `CheckCamv` on the corpus's largest document runs
/// 30.8ms → 11.7ms, faster than before.
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
/// "Keeping" is all it does: a border or an auxiliary line has no direction to
/// keep, so it unassigns with no hint and the two verbs agree on it exactly.
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
        // Already undecided: nothing to forget, and counting it would report a
        // change that did not happen.
        if segment.color == LineColor::None {
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

    /// A paper edge is a line whose fold can be undecided like any other. It
    /// carries no direction, so there is no hint to invent for it.
    #[test]
    fn a_paper_edge_becomes_unassigned_with_no_hint() {
        let mut model = model_with(&[LineColor::Black0]);
        assert_eq!(make_unassigned(&mut model, &[0]), 1);
        assert_eq!(model.line_segments[0].color, LineColor::None);
        assert_eq!(model.line_segments[0].fold_direction_hint, None);
    }

    #[test]
    fn an_auxiliary_line_becomes_unassigned_with_no_hint() {
        let mut model = model_with(&[LineColor::Cyan3]);
        assert_eq!(make_unassigned(&mut model, &[0]), 1);
        assert_eq!(model.line_segments[0].color, LineColor::None);
        assert_eq!(model.line_segments[0].fold_direction_hint, None);
    }

    /// `Cyan3` is one aux colour of eight, and `Orange4` is the one
    /// `operations::construction` authors by default. Unassigning the first and
    /// declining the second would be the same silent no-op this verb was widened
    /// to remove.
    #[test]
    fn every_auxiliary_colour_unassigns_not_just_cyan() {
        let aux = [
            LineColor::Cyan3,
            LineColor::Orange4,
            LineColor::Magenta5,
            LineColor::Green6,
            LineColor::Yellow7,
            LineColor::Purple8,
            LineColor::Other9,
            LineColor::Grey10,
        ];
        let mut model = model_with(&aux);
        let indices: Vec<usize> = (0..aux.len()).collect();
        assert_eq!(make_unassigned(&mut model, &indices), aux.len());
        for segment in &model.line_segments {
            assert_eq!(segment.color, LineColor::None);
        }
    }

    /// The keep-direction variant needs no special case for the two colours that
    /// have no direction: it must reach the same place as the forgetting one.
    #[test]
    fn keeping_the_direction_leaves_no_hint_on_a_border_or_an_aux_line() {
        use super::make_unassigned_keeping_direction;

        let mut model = model_with(&[LineColor::Black0, LineColor::Cyan3]);
        assert_eq!(make_unassigned_keeping_direction(&mut model, &[0, 1]), 2);
        for segment in &model.line_segments {
            assert_eq!(segment.color, LineColor::None);
            assert_eq!(segment.fold_direction_hint, None);
        }
    }

    /// **The border is deliberately unguarded**, so select-all dissolves the
    /// sheet outline. See this module's reasoning: measured on the Tier A corpus
    /// it produces no new closure failure anywhere, a guard has no principled
    /// shape between Ctrl+A and a drag-box, and the verb is one explicit menu
    /// item and one undo. Pinned here so restoring a guard is a decision rather
    /// than a regression.
    #[test]
    fn select_all_takes_the_sheet_outline_with_it() {
        let mut model = model_with(&[
            LineColor::Black0,
            LineColor::Black0,
            LineColor::Red1,
            LineColor::Cyan3,
        ]);
        assert_eq!(make_unassigned(&mut model, &[0, 1, 2, 3]), 4);
        assert!(
            model
                .line_segments
                .iter()
                .all(|segment| segment.color == LineColor::None)
        );
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

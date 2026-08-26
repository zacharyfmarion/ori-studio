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
/// **Every line but a bare unassigned one is touched**: a mountain, a valley, a
/// paper edge, an auxiliary line of any colour, and an unassigned crease still
/// carrying a direction hint. Undecided is a state a line is *put into*, not a
/// property only `Red1` and `Blue2` have — "this line is part of the pattern and
/// I have not decided what it does" is as true of a border as of a crease.
///
/// The hint is why "already unassigned" is not the same as "nothing left to
/// forget". It is the only thing that survives into `LineColor::None`, so a
/// hinted crease is half-decided, and clearing it is the whole of what separates
/// this verb from [`make_unassigned_keeping_direction`]. Skipping it — which the
/// colour gate did, in both its old and its widened form — made this a silent
/// no-op on precisely the creases the other verb had just produced, so a user
/// who kept the direction and then wanted it gone got nothing from the menu item
/// that says it forgets. (`CreaseSetDirectionHint`'s "None" chip could reach
/// them, but a context-panel chip is not an answer for a menu item that
/// silently declines.)
///
/// The gate was `Red1 | Blue2` until the owner asked for this, on the reasoning
/// that those are the two colours carrying a fold. What that cost was silence:
/// selecting a border or a reference line and picking Make Unassigned did
/// nothing, with no message, which is a worse outcome than any the gate was
/// avoiding. Every aux colour goes, not just `Cyan3` — see below for why that is
/// not merely a symmetry argument.
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
/// # An auxiliary line is a different question, and it had to be measured separately
///
/// The numbers above are about `Black0` and cover the aux case not at all — the
/// **Tier A corpus contains zero auxiliary lines** (every segment is `M`, `V` or
/// `B`, plus one `LineColor::None`), so the 286 trials never touched one. And
/// they would not have transferred: what a border does to the checker is stop a
/// vertex being interior, and what an aux line does is nothing, because
/// [`crate::checks_spatial::vertex_fan`] has no fold angle to read off it. Turning
/// one undecided is what puts an *unknown* at both its ends.
///
/// So the population had to be constructed, and it is: chords between existing
/// endpoints, capped at one per twenty segments — 954 lines over the 12 documents
/// this applies to — authored at both `Cyan3` and `Orange4` and then unassigned.
/// That models construction scaffolding; it is nobody's real scaffolding, and it
/// is written down as a construction for that reason.
///
/// From the aux-free document to every aux line unassigned:
///
/// - `checked_vertices` **7,907 → 7,519** (−4.9%), and diagnostic rows **13 →
///   1,726**. The same shape as the border case: coverage down, admission up.
/// - **0 new failures**, which is the load-bearing one. `Broken` is 1 before and
///   1 after — the one `failure_case.osf` already had.
///
/// One caveat on the rows, because the construction is visible in them: these
/// chords cut across faces, which by itself takes the 13 baseline rows to 1
/// before anything is unassigned. The 12 lost are `InteriorBorder` findings on
/// two files, and they went to the *geometry* being added rather than to this
/// verb — a chord through a face leaves no border with paper on both sides. The
/// coverage and failure numbers are unaffected by it:
/// [`crate::checks::point_line_map`] is per endpoint, not per face.
///
/// # The colour split is why the gate could not stay selective
///
/// [`crate::checks::point_line_map`] **skips `Cyan3`** and skips nothing else,
/// which is Oriedita's own quirk carried over. So while they are still aux, the
/// two colours are not interchangeable to the checker, and it is measurable:
/// drawing all 954 chords as `Cyan3` moves `checked_vertices` by **0**, and
/// drawing the same 954 as `Orange4` moves it **7,907 → 7,658**, on 7 of the 12
/// files. Unassigning takes both to the identical 7,519 — so **64% of the total
/// coverage cost of an `Orange4` line is already paid the moment it is drawn**,
/// and none of a `Cyan3` line's is.
///
/// That is what a colour-selective gate would have cost, and it is not a symmetry
/// argument. Reaching `Cyan3` while declining `Orange4` would leave two reference
/// lines on the same spot in states the checker reports differently. `Orange4` is
/// also what [`crate::operations::construction`] authors by default, so it is the
/// colour most users would be holding when they asked.
///
/// # What a dissolved border costs: one finding stops being sayable
///
/// The measurement above asked whether anything new goes *wrong*, and nothing
/// does. That is the wrong direction to have looked. What a border carries is
/// not only a constraint but the *subject* of a finding, and
/// [`crate::checks_spatial::interior_border_segments`] is a filter on `Black0`:
/// no border, no border with paper on both sides, nothing to report. The finding
/// is not weakened, it is unexpressible.
///
/// `known-good/byu solar driven.fold` is the file that shows it, because it is
/// where that check came from: it carries a closed hexagon of `B` edges — a cut
/// through the sheet, R19 in `implementation-plans/3d-folded-state.md` — and 6
/// of its border segments have paper on both sides. Measured through
/// `CheckCamv`, unassigning every border takes it from
///
/// - `checked_vertices` 90, **6 `warning/InteriorBorder`** — the only thing the
///   check says about this document at all — to
/// - `checked_vertices` 90, **0 warnings**, 36 `info/TooManyUnknowns`.
///
/// `ALL-combined.fold` moves the same way, 6 → 0, alongside 562 new `info` rows.
/// The 3D gate follows: [`crate::folding3d::admit`] reads the same list, so
/// `InteriorCut { line: 58 }`, which names the cut and points at it, becomes a
/// `VertexIndeterminate` at an unrelated rim vertex. The fold is still refused;
/// the user just loses the sentence that said where to look.
///
/// And the 30.2ms → 11.3ms on `ALL-combined.fold` is that same fact wearing a
/// different hat, not a second one in its favour: with no `Black0` left, the
/// early-out fires and the check is fast because it is examining nothing. It is
/// not a saving and it is cited here only so nobody cites it as one.
///
/// # Select-all dissolves the sheet outline, and that is still allowed
///
/// Deliberately unguarded, on three grounds, none of which is that it is free.
///
/// The first is that a guard has no principled shape: Ctrl+A and a drag-box
/// round the whole sheet are one intent, and a rule keyed on either would make
/// the verb depend on *how* the selection was made. The second is that this is
/// an explicit, single-purpose menu item and one undo, and replacing "silently
/// does nothing" with "silently does less than asked" keeps the defect while
/// adding a rule to learn.
///
/// The third is that the loss above is a loss of one *finding*, not of coverage,
/// and coverage is what the user is told about. This lands in the same week as
/// "give every vertex a verdict, so silence stops reading as success", and the
/// question that raises — does a document that has lost its paper boundary
/// deserve to say so — is already answered, in the right direction:
///
/// - A rim vertex moves off [`crate::checks_spatial::Unknowable::PaperEdge`],
///   which is the one verdict `lib::spatial_closure_diagnostics` emits **no row
///   for**, onto `TooManyUnknowns`, which emits one apiece. So the rim goes from
///   silent to loud — 562 new rows on `ALL-combined.fold`, 36 on `byu solar
///   driven.fold` — and the HUD counts them in its unexamined clause.
/// - A whole-document select-all drives `checked_vertices` to **0** (measured on
///   both files), which is case 8 of
///   `implementation-plans/never-report-silence.md` — the catch for a check that
///   examined nothing, and the loudest coverage signal the product has.
///
/// So no new verdict belongs here. A verdict could not restore what was lost
/// anyway: `InteriorBorder` is definitionally a statement about a `Black0`, and
/// after this verb there is not one to make it about.
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
/// # On an already-unassigned crease it does nothing, and says nothing
///
/// Decided rather than inherited, because it reads at a glance like the defect
/// [`make_unassigned`] was just widened to remove — one menu item along, the same
/// selection, the same zero, and the frontend surfaces the count nowhere, so the
/// user gets no message at all.
///
/// It is not the same defect, and the thing that separates them is the
/// postcondition rather than the count. This verb's is *"unassigned, whatever
/// direction it had preserved"*, and an already-unassigned crease satisfies it
/// already — hinted or bare. Reporting zero is then the honest answer to "how
/// many did you have to change", not a decline. What made the old
/// [`make_unassigned`] a defect is that its postcondition is *"unassigned, and
/// nothing remembered"*, which a hinted crease does **not** satisfy: it returned
/// zero with work still to do.
///
/// So the law is `changed == 0` **iff** the requested state already holds, for
/// both verbs, and `zero_means_the_state_already_holds` pins it exhaustively over
/// every colour × hint. That is what makes silence defensible here, and it is
/// what the old kernel failed.
///
/// Acting anyway is not available as an alternative: there is no colour left to
/// read a direction off, so [`crate::geometry::LineSegment::with_direction_kept`]
/// would *clear* the hint this verb is named for.
/// [`super::direction_hint::set_direction_hint`] is the verb that writes a hint
/// from scratch; [`make_unassigned`] is the one that takes it away.
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
        // Already undecided, with nothing left to forget. A hint is the one
        // thing that survives into this state, so an unassigned crease carrying
        // one is *not* finished being unassigned — and forgetting it is the
        // entire difference between the two verbs. Skipping it here made
        // "Make Unassigned" a silent no-op on exactly the creases
        // "Make Unassigned (Keep Direction)" had just produced.
        if segment.color == LineColor::None
            && (keep_direction || segment.fold_direction_hint.is_none())
        {
            continue;
        }
        let updated = if keep_direction {
            segment.with_direction_kept()
        } else {
            // `with_line_color` deliberately preserves the hint across
            // `None -> None`, because that transition is how a hinted crease
            // survives every other recolour path. Clearing it is this verb's
            // own intent, so it is said here, through the enforcement point
            // that refuses to write a hint anywhere but an unassigned crease.
            segment
                .with_line_color(LineColor::None)
                .with_direction_hint(None)
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
    /// sheet outline. See this module's reasoning: it costs the
    /// `InteriorBorder` finding, which is a real loss and is recorded as one,
    /// but a guard has no principled shape between Ctrl+A and a drag-box, and
    /// the verb is one explicit menu item and one undo. Pinned here so restoring
    /// a guard is a decision rather than a regression.
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

    /// **Forgetting the hint is the one thing this verb does that its sibling
    /// does not**, so declining to do it made the two menu items identical on
    /// every crease the sibling had produced. The colour gate skipped
    /// `LineColor::None` outright, which is right for a bare unassigned crease
    /// and wrong for a hinted one: the hint is the half that is still decided.
    #[test]
    fn forgetting_reaches_a_hint_left_by_keeping() {
        use super::make_unassigned_keeping_direction;
        use crate::geometry::FoldDirection;

        let mut model = model_with(&[LineColor::Red1]);
        assert_eq!(make_unassigned_keeping_direction(&mut model, &[0]), 1);
        assert_eq!(
            model.line_segments[0].fold_direction_hint,
            Some(FoldDirection::Mountain)
        );

        // The state the user is in when they change their mind: undecided, and
        // still remembering which way it went.
        assert_eq!(make_unassigned(&mut model, &[0]), 1);
        assert_eq!(model.line_segments[0].color, LineColor::None);
        assert_eq!(model.line_segments[0].fold_direction_hint, None);

        // And now there really is nothing left to forget.
        assert_eq!(make_unassigned(&mut model, &[0]), 0);
    }

    /// The complement, and the reason the gate tests `keep_direction` rather
    /// than just the hint: keeping the direction of a crease that has no colour
    /// to read one from is a no-op, and must stay one. `with_direction_kept`
    /// would otherwise *clear* the very hint it is named for, because
    /// `FoldDirection::from_line_color(None)` is `None`.
    #[test]
    fn keeping_the_direction_never_erases_a_hint_it_cannot_recover() {
        use super::make_unassigned_keeping_direction;
        use crate::geometry::FoldDirection;

        let mut model = model_with(&[LineColor::Blue2]);
        make_unassigned_keeping_direction(&mut model, &[0]);
        let hinted = model.line_segments[0].fold_direction_hint;
        assert_eq!(hinted, Some(FoldDirection::Valley));

        assert_eq!(make_unassigned_keeping_direction(&mut model, &[0]), 0);
        assert_eq!(model.line_segments[0].fold_direction_hint, hinted);
    }

    /// A mixed selection is the realistic one, and the count has to be honest
    /// about which lines it reached: the bare unassigned crease is not an edit.
    #[test]
    fn a_mixed_selection_counts_only_the_lines_that_moved() {
        use crate::geometry::FoldDirection;

        let mut model = model_with(&[
            LineColor::Red1,
            LineColor::None,
            LineColor::None,
            LineColor::Black0,
        ]);
        model.line_segments[1] =
            model.line_segments[1].with_direction_hint(Some(FoldDirection::Valley));

        // Red1, the hinted crease and the border move; the bare one does not.
        assert_eq!(make_unassigned(&mut model, &[0, 1, 2, 3]), 3);
        for segment in &model.line_segments {
            assert_eq!(segment.color, LineColor::None);
            assert_eq!(segment.fold_direction_hint, None);
        }
    }

    /// **A zero from either verb means the requested state already held.**
    ///
    /// The law that makes a silent no-op defensible, and the one the old kernel
    /// broke: `make_unassigned` returned zero on a hinted unassigned crease while
    /// its own postcondition — no colour *and* no hint — did not hold there. Each
    /// verb's postcondition is written out here independently of the code under
    /// test, so this cannot be satisfied by whatever the gate happens to skip.
    ///
    /// Exhaustive over colour x hint, which is where the miss hid: the two old
    /// gates were written in terms of colour alone.
    #[test]
    fn zero_means_the_state_already_holds() {
        use super::make_unassigned_keeping_direction;
        use crate::geometry::FoldDirection;

        let colors = [
            LineColor::Black0,
            LineColor::Red1,
            LineColor::Blue2,
            LineColor::Cyan3,
            LineColor::Orange4,
            LineColor::Magenta5,
            LineColor::Green6,
            LineColor::Yellow7,
            LineColor::Purple8,
            LineColor::Other9,
            LineColor::Grey10,
            LineColor::None,
        ];
        let hints = [
            None,
            Some(FoldDirection::Mountain),
            Some(FoldDirection::Valley),
        ];

        for color in colors {
            for hint in hints {
                let mut model = model_with(&[color]);
                // Only an unassigned crease can carry a hint at all, which is
                // `with_direction_hint`'s own rule; a hint on a coloured crease
                // is not a state to test because it is not a state that exists.
                if hint.is_some() {
                    if color != LineColor::None {
                        continue;
                    }
                    model.line_segments[0] = model.line_segments[0].with_direction_hint(hint);
                }
                let before = model.line_segments[0].clone();

                // Forgetting: undecided, and nothing remembered.
                let forget_holds =
                    before.color == LineColor::None && before.fold_direction_hint.is_none();
                let mut forgetting = model.clone();
                assert_eq!(
                    make_unassigned(&mut forgetting, &[0]) == 0,
                    forget_holds,
                    "make_unassigned on {color:?}/{hint:?}"
                );
                assert_eq!(forgetting.line_segments[0].color, LineColor::None);
                assert_eq!(forgetting.line_segments[0].fold_direction_hint, None);

                // Keeping: undecided, with whatever direction it had preserved.
                let keep_holds = before.color == LineColor::None;
                let mut keeping = model.clone();
                assert_eq!(
                    make_unassigned_keeping_direction(&mut keeping, &[0]) == 0,
                    keep_holds,
                    "make_unassigned_keeping_direction on {color:?}/{hint:?}"
                );
                assert_eq!(keeping.line_segments[0].color, LineColor::None);
                if keep_holds {
                    // Nothing to do also means nothing taken away.
                    assert_eq!(
                        keeping.line_segments[0].fold_direction_hint,
                        before.fold_direction_hint
                    );
                }
            }
        }
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

//! `CreaseMakeUnassigned` through the command dispatch, not the free function.
//!
//! The two verbs are one `OperationId` separated by a payload flag, and the
//! default is the *keeping* one — so a unit test that calls
//! `operations::native::unassign::make_unassigned` directly exercises neither
//! the flag nor the arm the menu item reaches. That gap is where the
//! hint-clearing no-op survived: the free function was covered, the two menu
//! items were not, and they differ in exactly one thing.
//!
//! `line_ids` is **one-based** here, unlike the zero-based indices the free
//! function takes; getting that wrong is the other thing only this level sees.

use oristudio_cp::geometry::{FoldDirection, LineColor, LineSegment, Point};
use oristudio_cp::model::CreasePatternModel;
use oristudio_cp::{
    CreasePatternCommand, CreasePatternCommandPayload, CreasePatternDocument, OperationId,
    execute_command,
};

fn document_with(colors: &[LineColor]) -> CreasePatternDocument {
    let mut crease_pattern = CreasePatternModel::default();
    crease_pattern.line_segments.clear();
    for (index, color) in colors.iter().enumerate() {
        let offset = index as f64;
        crease_pattern.line_segments.push(
            LineSegment::new(Point::new(offset, 0.0), Point::new(offset, 10.0))
                .with_line_color(*color),
        );
    }
    CreasePatternDocument {
        crease_pattern,
        ..CreasePatternDocument::default()
    }
}

/// One-based line ids, and `forget_direction` as the menu passes it: `None` is
/// `cp.makeUnassignedKeepDirection`, `Some(true)` is `cp.makeUnassigned`.
///
/// Returns the count **as the caller receives it** — `CommandResult` carries no
/// numeric field, so `"Changed N line(s)"` in `diagnostics[0]` is the only
/// channel the web has, and asserting on anything else would not be testing what
/// the user is told.
fn unassign(
    document: &mut CreasePatternDocument,
    line_ids: &[usize],
    forget_direction: Option<bool>,
) -> usize {
    let result = execute_command(
        document,
        CreasePatternCommand::new(OperationId::CreaseMakeUnassigned).with_payload(
            CreasePatternCommandPayload {
                line_ids: line_ids.to_vec(),
                forget_direction,
                ..CreasePatternCommandPayload::default()
            },
        ),
    )
    .expect("CreaseMakeUnassigned is supported");
    let reported = result.diagnostics.first().expect("a changed-count message");
    reported
        .strip_prefix("Changed ")
        .and_then(|rest| rest.strip_suffix(" line(s)"))
        .unwrap_or_else(|| panic!("unexpected result message {reported:?}"))
        .parse()
        .expect("a number")
}

/// **The whole difference between the two menu items, on the one document where
/// they differ.** Keep Direction leaves a hint; Make Unassigned must then be
/// able to take it away, or the second item is a no-op on everything the first
/// produces and the user has no way back.
#[test]
fn make_unassigned_clears_a_hint_that_keep_direction_left() {
    let mut document = document_with(&[LineColor::Red1]);

    assert_eq!(unassign(&mut document, &[1], None), 1);
    assert_eq!(
        document.crease_pattern.line_segments[0].color,
        LineColor::None
    );
    assert_eq!(
        document.crease_pattern.line_segments[0].fold_direction_hint,
        Some(FoldDirection::Mountain)
    );

    // The user changes their mind. This reported `changed = 0` and left the
    // hint in place, which is what made the menu item silently do nothing.
    assert_eq!(unassign(&mut document, &[1], Some(true)), 1);
    assert_eq!(
        document.crease_pattern.line_segments[0].fold_direction_hint,
        None
    );

    // Idempotent afterwards: now there really is nothing left to forget.
    assert_eq!(unassign(&mut document, &[1], Some(true)), 0);
}

/// Keep Direction stays a no-op on an already-unassigned crease, hint or not.
/// It reads the direction off the colour it is leaving and there is none, so
/// acting would *erase* the hint it is named for.
#[test]
fn keep_direction_leaves_an_existing_hint_alone() {
    let mut document = document_with(&[LineColor::Blue2]);
    assert_eq!(unassign(&mut document, &[1], None), 1);
    assert_eq!(unassign(&mut document, &[1], None), 0);
    assert_eq!(
        document.crease_pattern.line_segments[0].fold_direction_hint,
        Some(FoldDirection::Valley)
    );
}

/// The mixed selection a user actually has, with the count they are shown.
///
/// Line 2 is put into the half-decided state first, by the sibling verb, which
/// is how a document acquires one in practice. Four lines move and the bare
/// unassigned crease does not — the count reported this as 3 before, because
/// the hinted crease was skipped along with the bare one.
#[test]
fn a_mixed_selection_reports_only_what_moved() {
    let mut document = document_with(&[
        LineColor::Red1,
        LineColor::Blue2,
        LineColor::Black0,
        LineColor::None,
    ]);
    assert_eq!(unassign(&mut document, &[2], None), 1);
    assert_eq!(
        document.crease_pattern.line_segments[1].fold_direction_hint,
        Some(FoldDirection::Valley)
    );

    assert_eq!(unassign(&mut document, &[1, 2, 3, 4], Some(true)), 3);
    for segment in &document.crease_pattern.line_segments {
        assert_eq!(segment.color, LineColor::None);
        assert_eq!(segment.fold_direction_hint, None);
    }

    // Everything is bare now, so a repeat is honest about changing nothing.
    assert_eq!(unassign(&mut document, &[1, 2, 3, 4], Some(true)), 0);
}

/// Keep Direction over the same selection: the two creases keep their
/// directions, the border has none to keep, and the bare crease is untouched.
#[test]
fn keep_direction_over_a_mixed_selection() {
    let mut document = document_with(&[
        LineColor::Red1,
        LineColor::Blue2,
        LineColor::Black0,
        LineColor::None,
    ]);

    assert_eq!(unassign(&mut document, &[1, 2, 3, 4], None), 3);
    let hints: Vec<_> = document
        .crease_pattern
        .line_segments
        .iter()
        .map(|segment| segment.fold_direction_hint)
        .collect();
    assert_eq!(
        hints,
        vec![
            Some(FoldDirection::Mountain),
            Some(FoldDirection::Valley),
            None,
            None
        ]
    );
}

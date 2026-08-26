//! `CreaseToggleMv` — the C tool — through the command dispatch.
//!
//! The dispatch is where the tool actually is. Its two limbs are separate
//! functions (`operations::color::toggle_mountain_valley`, the port of
//! `LineColor.changeMV`, and `operations::native::direction_hint::flip_direction_hints`,
//! which is ours) and a unit test on either one alone cannot see whether the
//! *tool* reaches a crease — which is exactly how a hinted crease stayed
//! unreachable while both halves passed their own tests.
//!
//! It also has two input paths that resolve their targets differently — a click
//! sends `line_ids`, a drag-box sends corner `points` — and only this level
//! exercises the branch between them. `line_ids` is **one-based** here.

use oristudio_cp::geometry::{FoldDirection, LineColor, LineSegment, Point};
use oristudio_cp::model::CreasePatternModel;
use oristudio_cp::operations::native::direction_hint::DirectionHintChange;
use oristudio_cp::{
    CreasePatternCommand, CreasePatternCommandPayload, CreasePatternDocument, OperationId,
    execute_command,
};

/// Horizontal segments stacked one unit apart, so a box can enclose a chosen
/// prefix of them.
fn document_with(colors: &[LineColor]) -> CreasePatternDocument {
    let mut crease_pattern = CreasePatternModel::default();
    crease_pattern.line_segments.clear();
    for (index, color) in colors.iter().enumerate() {
        let offset = index as f64;
        crease_pattern.line_segments.push(
            LineSegment::new(Point::new(0.0, offset), Point::new(10.0, offset))
                .with_line_color(*color),
        );
    }
    CreasePatternDocument {
        crease_pattern,
        ..CreasePatternDocument::default()
    }
}

fn hint(document: &mut CreasePatternDocument, line_id: usize, change: DirectionHintChange) {
    let result = execute_command(
        document,
        CreasePatternCommand::new(OperationId::CreaseSetDirectionHint).with_payload(
            CreasePatternCommandPayload {
                line_ids: vec![line_id],
                direction_hint: Some(change),
                ..CreasePatternCommandPayload::default()
            },
        ),
    );
    assert!(result.is_ok(), "CreaseSetDirectionHint is supported");
}

/// The count **as the caller receives it** — `CommandResult` carries no numeric
/// field, so the `"Changed N line(s)"` diagnostic is the only channel the web has.
fn changed(result: oristudio_cp::CommandResult) -> usize {
    let reported = result.diagnostics.first().expect("a changed-count message");
    reported
        .strip_prefix("Changed ")
        .and_then(|rest| rest.strip_suffix(" line(s)"))
        .unwrap_or_else(|| panic!("unexpected result message {reported:?}"))
        .parse()
        .expect("a number")
}

/// A click: one crease, sent as `line_ids`.
fn flip_line(document: &mut CreasePatternDocument, line_ids: &[usize]) -> usize {
    changed(
        execute_command(
            document,
            CreasePatternCommand::new(OperationId::CreaseToggleMv).with_payload(
                CreasePatternCommandPayload {
                    line_ids: line_ids.to_vec(),
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("CreaseToggleMv is supported"),
    )
}

/// A drag-box: two opposite corners, no `line_ids` at all — the frontend sends
/// an empty list here on purpose, so the kernel resolves the region itself.
fn flip_box(document: &mut CreasePatternDocument, a: Point, b: Point) -> usize {
    changed(
        execute_command(
            document,
            CreasePatternCommand::new(OperationId::CreaseToggleMv).with_payload(
                CreasePatternCommandPayload {
                    points: vec![a, b],
                    ..CreasePatternCommandPayload::default()
                },
            ),
        )
        .expect("CreaseToggleMv is supported"),
    )
}

fn hints(document: &CreasePatternDocument) -> Vec<Option<FoldDirection>> {
    document
        .crease_pattern
        .line_segments
        .iter()
        .map(|segment| segment.fold_direction_hint)
        .collect()
}

fn colors(document: &CreasePatternDocument) -> Vec<LineColor> {
    document
        .crease_pattern
        .line_segments
        .iter()
        .map(|segment| segment.color)
        .collect()
}

/// **The ask.** Clicking a hinted unassigned crease flips which way it says it
/// goes, and leaves it undecided — a hint is a belief about the fold, and the
/// tool that reverses a stated direction has no reason to stop at the ones
/// stated in a colour.
///
/// This reported `changed = 0` and moved nothing before, because the tool was
/// only its ported limb and `LineColor.changeMV` is the identity on everything
/// that is not `Red1`/`Blue2`.
#[test]
fn clicking_a_hinted_crease_flips_its_hint() {
    let mut document = document_with(&[LineColor::None]);
    hint(&mut document, 1, DirectionHintChange::Mountain);

    assert_eq!(flip_line(&mut document, &[1]), 1);
    assert_eq!(hints(&document), vec![Some(FoldDirection::Valley)]);
    assert_eq!(colors(&document), vec![LineColor::None]);

    // Clicking again is the way back, exactly as it is for a decided crease.
    assert_eq!(flip_line(&mut document, &[1]), 1);
    assert_eq!(hints(&document), vec![Some(FoldDirection::Mountain)]);
    assert_eq!(colors(&document), vec![LineColor::None]);
}

/// The ported limb is untouched, and the two limbs cannot both claim a line.
#[test]
fn a_decided_crease_still_flips_its_colour_and_is_counted_once() {
    let mut document = document_with(&[LineColor::Red1, LineColor::Blue2]);

    assert_eq!(flip_line(&mut document, &[1, 2]), 2);
    assert_eq!(colors(&document), vec![LineColor::Blue2, LineColor::Red1]);
    assert_eq!(hints(&document), vec![None, None]);
}

/// **A box flips both kinds in one gesture and one undo.** Upstream's box
/// collects every mountain and valley it encloses; ours collects every stated
/// direction, which is the same sentence with the hint admitted to it. The mixed
/// selection is the realistic one, and the count has to name only the lines that
/// had something to reverse.
#[test]
fn a_box_flips_colours_and_hints_together_and_leaves_the_rest() {
    let mut document = document_with(&[
        LineColor::Red1,
        LineColor::Blue2,
        LineColor::None, // hinted below
        LineColor::None, // bare: no direction to reverse
        LineColor::Black0,
        LineColor::Cyan3,
    ]);
    hint(&mut document, 3, DirectionHintChange::Valley);

    // A box round all six.
    assert_eq!(
        flip_box(&mut document, Point::new(-1.0, -1.0), Point::new(11.0, 6.0)),
        3
    );
    assert_eq!(
        colors(&document),
        vec![
            LineColor::Blue2,
            LineColor::Red1,
            LineColor::None,
            LineColor::None,
            LineColor::Black0,
            LineColor::Cyan3,
        ]
    );
    assert_eq!(
        hints(&document),
        vec![None, None, Some(FoldDirection::Mountain), None, None, None,]
    );
}

/// A box that encloses only undecided creases is not a licence to decide them.
/// Inventing a direction here is the one outcome that would make the gesture
/// destructive, and it is the reason a bare crease is skipped rather than
/// seeded: `CreaseSetDirectionHint` is the verb for stating a direction.
#[test]
fn a_box_over_undecided_creases_decides_nothing() {
    let mut document = document_with(&[LineColor::None, LineColor::None, LineColor::None]);
    let before = document.crease_pattern.line_segments.clone();

    assert_eq!(
        flip_box(&mut document, Point::new(-1.0, -1.0), Point::new(11.0, 3.0)),
        0
    );
    assert_eq!(document.crease_pattern.line_segments, before);
}

/// The click path's own gate, which the box path cannot show: a hinted crease
/// outside the box stays put, so "flip everything stated" is scoped by the
/// region rather than applied to the document.
#[test]
fn a_box_reaches_only_the_lines_inside_it() {
    let mut document = document_with(&[LineColor::None, LineColor::None, LineColor::Red1]);
    hint(&mut document, 1, DirectionHintChange::Mountain);
    hint(&mut document, 2, DirectionHintChange::Mountain);

    // Encloses lines 1 and 2 (y = 0 and y = 1) but not line 3 (y = 2).
    assert_eq!(
        flip_box(&mut document, Point::new(-1.0, -1.0), Point::new(11.0, 1.5)),
        2
    );
    assert_eq!(
        hints(&document),
        vec![
            Some(FoldDirection::Valley),
            Some(FoldDirection::Valley),
            None
        ]
    );
    assert_eq!(colors(&document)[2], LineColor::Red1);
}

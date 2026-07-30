//! `lengthen_crease` must not write creases that leave the drawing.
//!
//! Oriedita's parallel guard compares an unnormalized cross product against a
//! fixed absolute epsilon, so its angular tolerance shrinks as the segments grow.
//! Creases that are parallel by construction can read as crossing, and the
//! infinite-line solve then answers with a point astronomically far away. See
//! `MAX_LENGTHEN_EXTENSION_DIAGONALS` in `operations::transform`.

use oristudio_cp::geometry::{LineColor, Point};
use oristudio_cp::{
    CreasePatternCommand, CreasePatternCommandPayload, CreasePatternDocument, OperationId,
    execute_command,
};

/// Furthest any crease endpoint sits from the origin.
fn furthest_extent(document: &CreasePatternDocument) -> f64 {
    document
        .crease_pattern
        .line_segments
        .iter()
        .flat_map(|segment| [segment.a, segment.b])
        .map(|point| point.x.abs().max(point.y.abs()))
        .fold(0.0, f64::max)
}

/// Runs a drag-select lengthen and reports the diagnostics it emitted.
fn lengthen(document: &mut CreasePatternDocument, points: Vec<Point>) -> Vec<String> {
    execute_command(
        document,
        CreasePatternCommand::new(OperationId::LengthenCrease).with_payload(
            CreasePatternCommandPayload {
                points,
                line_color: Some(LineColor::Blue2),
                selection_distance: Some(1.0),
                ..CreasePatternCommandPayload::default()
            },
        ),
    )
    .expect("lengthen should execute")
    .diagnostics
}

/// Verbatim geometry from a user file (`iguana_20.osf`) that this bug corrupted:
/// three pleat columns that are vertical by construction, each carrying ~1e-10 of
/// x-dust from earlier edits, sitting ~14,000 units from the origin. Extending one
/// onto another used to solve for an intersection 4.3e12 units away.
#[test]
fn near_parallel_pleat_columns_do_not_extend_to_infinity() {
    let mut document = CreasePatternDocument::default();
    // The crease being extended.
    document.crease_pattern.add_line(
        Point::new(14279.999999981805, -854.9999999818125),
        Point::new(14279.999999982074, -800.0000000000083),
        LineColor::Blue2,
    );
    // The neighbouring column clicked as the target: 5.8e-12 rad off parallel.
    document.crease_pattern.add_line(
        Point::new(14255.000000000678, 2055.000000000694),
        Point::new(14255.00000000015, 2669.999999999875),
        LineColor::Red1,
    );

    let extent_before = furthest_extent(&document);
    let segments_before = document.crease_pattern.line_segments.len();
    let diagnostics = lengthen(
        &mut document,
        vec![
            Point::new(14279.5, -830.0),
            Point::new(14280.5, -830.0),
            Point::new(14255.0, 2400.0),
        ],
    );

    assert_eq!(
        document.crease_pattern.line_segments.len(),
        segments_before,
        "a near-parallel target must not extend, got {diagnostics:?}"
    );
    assert!(
        furthest_extent(&document) <= extent_before,
        "no crease may reach beyond the geometry that was already there"
    );
}

/// The bound must not cost ordinary lengthens: a crease meeting a genuinely
/// perpendicular target still extends, at the same 14,000-unit offset.
#[test]
fn perpendicular_target_still_extends_far_from_the_origin() {
    let mut document = CreasePatternDocument::default();
    document.crease_pattern.add_line(
        Point::new(14000.0, 0.0),
        Point::new(14001.0, 0.0),
        LineColor::Red1,
    );
    document.crease_pattern.add_line(
        Point::new(14002.0, -1.0),
        Point::new(14002.0, 1.0),
        LineColor::Black0,
    );

    let diagnostics = lengthen(
        &mut document,
        vec![
            Point::new(14000.5, -0.5),
            Point::new(14000.5, 0.5),
            Point::new(14002.0, 0.0),
        ],
    );

    assert_eq!(diagnostics, vec!["Changed 1 line(s)"]);
    assert!(
        document
            .crease_pattern
            .line_segments
            .iter()
            .any(|segment| segment.a == Point::new(14002.0, 0.0)
                && segment.b == Point::new(14001.0, 0.0)
                && segment.color == LineColor::Blue2),
        "the extension should reach the target and stop there"
    );
}

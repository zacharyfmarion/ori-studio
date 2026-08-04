//! Wire-format constants that must never move.
//!
//! A share link is a *stateful* promise: once one exists, it has to keep opening.
//! The dangerous failures are not bugs in the codec — they are ordinary,
//! reasonable changes elsewhere in the app that shift a number the codec
//! serialises, so **new** links are fine, **old** links decode to something
//! subtly wrong, and nothing fails.
//!
//! The worst example: `LineColor` is serialised as `discriminant + 2`. Insert a
//! variant in the middle of that enum — a completely normal thing to do — and
//! every link ever shared decodes with the wrong crease colours. Mountains
//! become valleys. No test in the app would notice.
//!
//! So these tests do not check the codec. They check the things the codec
//! *depends on*, and they fail with an explanation of what to do instead.

use oristudio_cp::CreasePatternDocument;
use oristudio_cp::geometry::{FoldMagnitude, LineColor};
use oristudio_cp::model::{CreasePatternModel, GridState};
use oristudio_cp::share::{ShareOptions, decode_share, encode_share};

/// The exact `LineColor` → wire code mapping, frozen.
///
/// If this fails, do **not** update the numbers. The mapping is baked into every
/// link already shared. Either keep the discriminants stable, or introduce a new
/// `format_version` whose decoder uses the new mapping while v1's keeps the old.
#[test]
fn line_colour_wire_codes_are_frozen() {
    let frozen: [(LineColor, i32); 13] = [
        (LineColor::Angle, -2),
        (LineColor::None, -1),
        (LineColor::Black0, 0),
        (LineColor::Red1, 1),
        (LineColor::Blue2, 2),
        (LineColor::Cyan3, 3),
        (LineColor::Orange4, 4),
        (LineColor::Magenta5, 5),
        (LineColor::Green6, 6),
        (LineColor::Yellow7, 7),
        (LineColor::Purple8, 8),
        (LineColor::Other9, 9),
        (LineColor::Grey10, 10),
    ];
    for (colour, number) in frozen {
        assert_eq!(
            colour.number(),
            number,
            "{colour:?} changed discriminant — every previously shared link now decodes \
             this colour wrong. Restore it, or add a new format_version."
        );
    }
}

/// Fold angles ride the wire as raw `FoldMagnitude` storage units. Changing the
/// scale silently rescales every angle in every existing link.
#[test]
fn fold_magnitude_scale_is_frozen() {
    assert_eq!(
        FoldMagnitude::UNITS_PER_DEGREE,
        10_000_000,
        "fold angles are transmitted in these units; changing the scale rescales \
         every angle in every link already shared"
    );
    // A round number through the same conversion the codec uses.
    assert_eq!(
        FoldMagnitude::to_transport(FoldMagnitude::from_degrees(90.0)),
        900_000_000
    );
}

/// The grid states the codec writes as small integers.
#[test]
fn grid_state_wire_codes_are_frozen() {
    assert_eq!(GridState::Hidden.state(), 0);
    assert_eq!(GridState::WithinPaper.state(), 1);
    assert_eq!(GridState::Full.state(), 2);
}

/// A document exercising every part of the format at once.
///
/// The plain golden fixture uses a simple pattern, which means a change to (say)
/// the circle encoding or a rare colour would not move it at all. This one
/// touches every section and every extension tag, so the byte-exactness check has
/// something to bite on.
fn kitchen_sink() -> CreasePatternDocument {
    use oristudio_cp::geometry::{Circle, LineSegment, Point, RgbColor};
    use oristudio_cp::model::TextElement;

    let seg = |ax: f64, ay: f64, bx: f64, by: f64, c: LineColor| {
        LineSegment::with_color(Point::new(ax, ay), Point::new(bx, by), c)
    };
    let mut model = CreasePatternModel::default();

    // Every colour, so a discriminant shift moves the bytes.
    for (i, colour) in [
        LineColor::Angle,
        LineColor::None,
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
    ]
    .into_iter()
    .enumerate()
    {
        let y = f64::from(i as i32) * 7.0;
        model.line_segments.push(seg(-100.0, y, 100.0, y, colour));
    }
    // A non-classic fold angle, a custom colour, a duplicate and a degenerate.
    model.line_segments[3].fold_magnitude = FoldMagnitude::from_degrees(60.5);
    model.line_segments[4].customized = 1;
    model.line_segments[4].customized_color = RgbColor::new(9, 8, 7);
    model.line_segments.push(model.line_segments[0].clone());
    model
        .line_segments
        .push(seg(5.0, 5.0, 5.0, 5.0, LineColor::Red1));

    model
        .aux_line_segments
        .push(seg(-50.0, -50.0, 50.0, 50.0, LineColor::Cyan3));
    model
        .circles
        .push(Circle::new(1.5, -2.5, 30.0, LineColor::Green6));
    model.texts.push(TextElement::new(3.0, 4.0, "kitchen sink"));
    model.points.push(Point::new(-11.0, 22.0));
    model.grid.grid_size = 32;
    model.grid.base_state = GridState::Full;

    CreasePatternDocument {
        title: Some("Everything".to_string()),
        crease_pattern: model,
        ..Default::default()
    }
}

/// Round-trip the kitchen sink and check every carried field individually.
///
/// Deliberately field-by-field rather than one equality assert: an equality
/// failure says "something changed", while these say *which* thing, which is the
/// difference between a five-minute fix and an afternoon.
#[test]
fn every_carried_field_survives_a_round_trip() {
    let source = kitchen_sink();
    let payload = encode_share(&source, ShareOptions::default()).expect("encode");
    let back = decode_share(&payload).expect("decode").document;
    let (a, b) = (&source.crease_pattern, &back.crease_pattern);

    assert_eq!(back.title, source.title, "title");
    assert_eq!(b.line_segments.len(), a.line_segments.len(), "crease count");
    assert_eq!(
        b.aux_line_segments.len(),
        a.aux_line_segments.len(),
        "aux count"
    );
    assert_eq!(b.circles.len(), a.circles.len(), "circle count");
    assert_eq!(b.texts.len(), a.texts.len(), "text count");
    assert_eq!(b.points.len(), a.points.len(), "point count");
    assert_eq!(b.grid.grid_size, a.grid.grid_size, "grid size");
    assert_eq!(b.grid.base_state, a.grid.base_state, "grid state");

    let colours = |m: &CreasePatternModel| {
        let mut v: Vec<i32> = m.line_segments.iter().map(|s| s.color.number()).collect();
        v.sort_unstable();
        v
    };
    assert_eq!(colours(b), colours(a), "colour multiset");

    let angles = |m: &CreasePatternModel| {
        let mut v: Vec<u32> = m
            .line_segments
            .iter()
            .map(|s| FoldMagnitude::to_transport(s.fold_magnitude))
            .collect();
        v.sort_unstable();
        v
    };
    assert_eq!(angles(b), angles(a), "fold magnitudes");

    let custom = b
        .line_segments
        .iter()
        .find(|s| s.customized != 0)
        .expect("custom colour survived");
    assert_eq!(
        (
            custom.customized_color.red,
            custom.customized_color.green,
            custom.customized_color.blue
        ),
        (9, 8, 7),
        "custom colour channels"
    );
    assert_eq!(b.texts[0].text, "kitchen sink", "text content");
}

/// Byte-exactness for the kitchen sink.
///
/// Regenerate with `UPDATE_SHARE_GOLDEN=1` **only** after deciding the change is
/// intentional and that old links are unaffected — the point of this fixture is
/// to make that a decision rather than an accident.
#[test]
fn kitchen_sink_payload_is_byte_stable() {
    let payload = encode_share(&kitchen_sink(), ShareOptions::default()).expect("encode");
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/oristudio-cp/share-kitchen-sink.bin");

    if std::env::var("UPDATE_SHARE_GOLDEN").is_ok() {
        std::fs::write(&path, &payload).expect("write fixture");
    }
    let expected = std::fs::read(&path).expect("kitchen-sink fixture");
    assert_eq!(
        payload, expected,
        "the encoding of a full-surface document changed. If that is intentional it needs \
         a new format_version, not a refreshed fixture — links already shared decode with \
         the old rules."
    );
    // And the committed bytes must still decode, not merely match.
    decode_share(&expected).expect("committed fixture must decode");
}

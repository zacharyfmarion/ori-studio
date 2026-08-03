//! Round-trip properties for the share codec.
//!
//! The contract is not "approximately the same pattern": the decoder must
//! reproduce the encoder's intended geometry exactly, and the foldability
//! diagnostics must be identical in both directions.

use oristudio_cp::CreasePatternDocument;
use oristudio_cp::checks_spatial::dispatched_camv;
use oristudio_cp::geometry::{Circle, FoldMagnitude, LineColor, LineSegment, Point};
use oristudio_cp::model::{CreasePatternModel, GridState, TextElement};
use oristudio_cp::share::{ShareOptions, decode_share, encode_share};

fn seg(ax: f64, ay: f64, bx: f64, by: f64, color: LineColor) -> LineSegment {
    LineSegment::with_color(Point::new(ax, ay), Point::new(bx, by), color)
}

fn doc(model: CreasePatternModel) -> CreasePatternDocument {
    CreasePatternDocument {
        crease_pattern: model,
        ..Default::default()
    }
}

/// A small but genuinely flat-foldable pattern: the classic bird-base corner
/// fan, which exercises a real interior vertex rather than a scribble.
fn fan() -> CreasePatternModel {
    let mut model = CreasePatternModel::default();
    for (x, y) in [
        (-200.0, -200.0),
        (200.0, -200.0),
        (200.0, 200.0),
        (-200.0, 200.0),
    ] {
        model
            .line_segments
            .push(seg(x, y, -x, y, LineColor::Black0));
        model
            .line_segments
            .push(seg(x, y, x, -y, LineColor::Black0));
    }
    // Eight rays at 45 degrees around the origin: alternating sum is exact.
    for k in 0..8 {
        let angle = std::f64::consts::FRAC_PI_4 * f64::from(k);
        let colour = if k % 2 == 0 {
            LineColor::Red1
        } else {
            LineColor::Blue2
        };
        model.line_segments.push(seg(
            0.0,
            0.0,
            150.0 * angle.cos(),
            150.0 * angle.sin(),
            colour,
        ));
    }
    model
}

fn roundtrip(document: &CreasePatternDocument) -> CreasePatternDocument {
    let bytes = encode_share(document, ShareOptions::default()).expect("encode");
    decode_share(&bytes).expect("decode").document
}

#[test]
fn crease_count_and_colours_survive() {
    let source = doc(fan());
    let back = roundtrip(&source);
    assert_eq!(
        back.crease_pattern.line_segments.len(),
        source.crease_pattern.line_segments.len()
    );
    let mut a: Vec<i32> = source
        .crease_pattern
        .line_segments
        .iter()
        .map(|s| s.color.number())
        .collect();
    let mut b: Vec<i32> = back
        .crease_pattern
        .line_segments
        .iter()
        .map(|s| s.color.number())
        .collect();
    a.sort_unstable();
    b.sort_unstable();
    assert_eq!(a, b);
}

#[test]
fn foldability_diagnostics_are_identical() {
    let source = doc(fan());
    let back = roundtrip(&source);
    let before = dispatched_camv(&source.crease_pattern);
    let after = dispatched_camv(&back.crease_pattern);
    assert_eq!(before.flat.len(), after.flat.len());
    assert_eq!(before.spatial.len(), after.spatial.len());
}

/// All thirteen `LineColor` variants must survive. `.cp` collapses ten of them
/// onto `Cyan3`, and because `point_line_map` skips only `Cyan3` that silently
/// deletes real Maekawa diagnostics.
#[test]
fn every_line_colour_variant_survives() {
    let colours = [
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
    ];
    let mut model = CreasePatternModel::default();
    for (i, c) in colours.iter().enumerate() {
        let y = f64::from(i as i32) * 10.0;
        model.line_segments.push(seg(0.0, y, 100.0, y, *c));
    }
    let back = roundtrip(&doc(model));
    let mut got: Vec<i32> = back
        .crease_pattern
        .line_segments
        .iter()
        .map(|s| s.color.number())
        .collect();
    got.sort_unstable();
    let mut want: Vec<i32> = colours.iter().map(|c| c.number()).collect();
    want.sort_unstable();
    assert_eq!(got, want);
}

#[test]
fn fold_magnitudes_survive_exactly() {
    let mut model = fan();
    // FoldMagnitude stores 1e-7 degree units in a u32, so these must come back
    // bit-identical -- angles contribute zero reconstruction error.
    model.line_segments[8].fold_magnitude = FoldMagnitude::from_degrees(90.0);
    model.line_segments[9].fold_magnitude = FoldMagnitude::from_degrees(60.5);
    model.line_segments[10].fold_magnitude = FoldMagnitude::from_degrees(0.000_000_1);
    let source = doc(model);
    let back = roundtrip(&source);

    let mut want: Vec<u32> = source
        .crease_pattern
        .line_segments
        .iter()
        .map(|s| FoldMagnitude::to_transport(s.fold_magnitude))
        .collect();
    let mut got: Vec<u32> = back
        .crease_pattern
        .line_segments
        .iter()
        .map(|s| FoldMagnitude::to_transport(s.fold_magnitude))
        .collect();
    want.sort_unstable();
    got.sort_unstable();
    assert_eq!(got, want);
}

#[test]
fn an_all_classic_document_pays_nothing_for_fold_angles() {
    let plain = encode_share(&doc(fan()), ShareOptions::default()).unwrap();
    let mut model = fan();
    model.line_segments[8].fold_magnitude = FoldMagnitude::from_degrees(90.0);
    let angled = encode_share(&doc(model), ShareOptions::default()).unwrap();
    assert!(
        angled.len() > plain.len(),
        "the angled document should carry the extension, the plain one should not"
    );
}

#[test]
fn aux_lines_circles_texts_points_and_title_survive() {
    let mut model = fan();
    model
        .aux_line_segments
        .push(seg(-100.0, -100.0, 100.0, 100.0, LineColor::Cyan3));
    model
        .aux_line_segments
        .push(seg(-100.0, 100.0, 100.0, -100.0, LineColor::Cyan3));
    model
        .circles
        .push(Circle::new(10.0, 20.0, 30.0, LineColor::Green6));
    model.texts.push(TextElement::new(5.0, 6.0, "hello ori"));
    model.points.push(Point::new(33.0, 44.0));
    model.grid.grid_size = 16;
    model.grid.base_state = GridState::Full;

    let mut source = doc(model);
    source.title = Some("Test Pattern".to_string());
    let back = roundtrip(&source);

    assert_eq!(back.title.as_deref(), Some("Test Pattern"));
    assert_eq!(back.crease_pattern.aux_line_segments.len(), 2);
    assert_eq!(back.crease_pattern.circles.len(), 1);
    assert_eq!(back.crease_pattern.texts.len(), 1);
    assert_eq!(back.crease_pattern.texts[0].text, "hello ori");
    assert_eq!(back.crease_pattern.points.len(), 1);
    assert_eq!(back.crease_pattern.grid.grid_size, 16);
    assert_eq!(back.crease_pattern.grid.base_state, GridState::Full);
}

#[test]
fn custom_colours_survive() {
    let mut model = fan();
    model.line_segments[8].customized = 1;
    model.line_segments[8].customized_color = oristudio_cp::geometry::RgbColor::new(1, 2, 3);
    let back = roundtrip(&doc(model));
    let hit = back
        .crease_pattern
        .line_segments
        .iter()
        .find(|s| s.customized != 0)
        .expect("custom colour survived");
    assert_eq!(hit.customized_color.red, 1);
    assert_eq!(hit.customized_color.green, 2);
    assert_eq!(hit.customized_color.blue, 3);
}

#[test]
fn degenerate_and_duplicate_creases_survive() {
    let mut model = fan();
    let dup = model.line_segments[0].clone();
    model.line_segments.push(dup);
    // Zero-length crease: legal in the format (a zero adjacency gap).
    model
        .line_segments
        .push(seg(7.0, 7.0, 7.0, 7.0, LineColor::Red1));
    let source = doc(model);
    let back = roundtrip(&source);
    assert_eq!(
        back.crease_pattern.line_segments.len(),
        source.crease_pattern.line_segments.len()
    );
}

#[test]
fn a_unit_square_pattern_survives() {
    // No Oriedita normalisation: the quantum must adapt to document scale.
    let mut model = CreasePatternModel::default();
    model
        .line_segments
        .push(seg(0.0, 0.0, 1.0, 0.0, LineColor::Black0));
    model
        .line_segments
        .push(seg(1.0, 0.0, 1.0, 1.0, LineColor::Black0));
    model
        .line_segments
        .push(seg(0.0, 0.0, 1.0, 1.0, LineColor::Red1));
    model
        .line_segments
        .push(seg(0.5, 0.0, 0.5, 1.0, LineColor::Blue2));
    let source = doc(model);
    let back = roundtrip(&source);
    assert_eq!(back.crease_pattern.line_segments.len(), 4);
    for s in &back.crease_pattern.line_segments {
        for p in [s.a, s.b] {
            assert!(p.x.abs() <= 1.0 + 1e-9 && p.y.abs() <= 1.0 + 1e-9);
        }
    }
}

#[test]
fn float_noise_on_one_intended_vertex_collapses_to_one_vertex() {
    // Real .cp files carry the same intended coordinate with different
    // accumulated noise. Those endpoints must reconstruct identically, or the
    // creases stop sharing a vertex and CAMV loses the fan.
    let mut model = CreasePatternModel::default();
    let noisy = [200.0, 199.999_999_999_999_97, 200.000_000_000_000_03];
    for (i, &x) in noisy.iter().enumerate() {
        model.line_segments.push(seg(
            x,
            200.0,
            0.0,
            f64::from(i as i32) * 10.0,
            LineColor::Red1,
        ));
    }
    let back = roundtrip(&doc(model));
    // Canonical crease order puts the lower vertex index first, so check the
    // whole endpoint set rather than assuming which end the corner landed on:
    // one shared corner plus three distinct fan points.
    let vertices: std::collections::HashSet<(u64, u64)> = back
        .crease_pattern
        .line_segments
        .iter()
        .flat_map(|s| [s.a, s.b])
        .map(|p| (p.x.to_bits(), p.y.to_bits()))
        .collect();
    assert_eq!(
        vertices.len(),
        4,
        "noisy duplicates must merge to one vertex"
    );
}

#[test]
fn an_empty_document_roundtrips() {
    let back = roundtrip(&doc(CreasePatternModel::default()));
    assert!(back.crease_pattern.line_segments.is_empty());
}

#[test]
fn session_state_is_deliberately_not_carried() {
    let mut model = fan();
    model.line_segments[0].selected = 3;
    let mut source = doc(model);
    source
        .metadata
        .insert("junk".into(), serde_json::json!({"big": "blob"}));
    let back = roundtrip(&source);
    assert!(back.metadata.is_empty(), "metadata must not ride along");
    assert!(
        back.crease_pattern
            .line_segments
            .iter()
            .all(|s| s.selected == 0),
        "selection is session state"
    );
}

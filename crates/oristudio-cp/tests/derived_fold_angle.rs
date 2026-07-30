//! Derived geometry inherits the fold angle of the crease it came from.
//!
//! The rule: **colour answers "which family", magnitude belongs to the crease
//! being transformed.** Extending, reflecting or mirroring a 90 degree crease
//! must produce a 90 degree crease, whether the line type comes from the source
//! or from the user's active selection.
//!
//! Each operation gets three cases, because two of them fail in opposite
//! directions: the angle must be carried, it must not be *invented* from a
//! classic source, and the colour must still come from wherever that tool says.

use oristudio_cp::geometry::{FoldMagnitude, LineColor, LineSegment, Point};
use oristudio_cp::model::{CreasePatternModel, crease_fold_angle};
use oristudio_cp::operations::construction::{
    double_symmetric_draw, mirror_selected_lines, symmetric_draw,
};
use oristudio_cp::operations::transform::{LengthenColorMode, lengthen_crease};

fn crease(
    ax: f64,
    ay: f64,
    bx: f64,
    by: f64,
    color: LineColor,
    degrees: Option<f64>,
) -> LineSegment {
    LineSegment::from_coordinates(ax, ay, bx, by)
        .with_line_color(color)
        .with_fold_magnitude(degrees.and_then(FoldMagnitude::from_degrees))
}

fn magnitudes(model: &CreasePatternModel) -> Vec<Option<f64>> {
    model
        .line_segments
        .iter()
        .map(|segment| segment.fold_magnitude.map(FoldMagnitude::degrees))
        .collect()
}

// ------------------------------------------------------------------- the seam

#[test]
fn inheriting_onto_a_line_that_cannot_carry_an_angle_is_a_no_op() {
    // Applying magnitude after colour must never smuggle an angle onto a border
    // or auxiliary line — that is what makes the call order safe everywhere.
    let source = crease(0.0, 0.0, 1.0, 0.0, LineColor::Red1, Some(90.0));
    for color in [LineColor::Black0, LineColor::Cyan3] {
        let derived = LineSegment::from_coordinates(0.0, 1.0, 1.0, 1.0)
            .with_line_color(color)
            .with_fold_magnitude_of(&source);
        assert_eq!(derived.fold_magnitude, None, "{color:?} must stay classic");
    }
}

#[test]
fn inheriting_carries_the_angle_across_a_family_change() {
    // The active-type case: the family comes from the user's selection, the
    // angle from the crease being transformed.
    let source = crease(0.0, 0.0, 1.0, 0.0, LineColor::Red1, Some(90.0));
    let derived = LineSegment::from_coordinates(0.0, 1.0, 1.0, 1.0)
        .with_line_color(LineColor::Blue2)
        .with_fold_magnitude_of(&source);
    assert_eq!(crease_fold_angle(&derived), Some(90.0), "valley at 90");
    assert_eq!(crease_fold_angle(&source), Some(-90.0), "source unchanged");
}

// ------------------------------------------------- mirror selection (DrawCreaseSymmetric)

fn mirrored_model(source_degrees: Option<f64>) -> CreasePatternModel {
    let mut model = CreasePatternModel::default();
    let mut source = crease(-100.0, 100.0, 100.0, 100.0, LineColor::Red1, source_degrees);
    source.selected = 2;
    model.add_line_segment(source);
    // Mirror across the x axis.
    let axis = LineSegment::from_coordinates(-200.0, 0.0, 200.0, 0.0);
    mirror_selected_lines(&mut model, &axis);
    model
}

#[test]
fn mirroring_a_90_degree_crease_yields_a_90_degree_crease() {
    let model = mirrored_model(Some(90.0));
    assert!(
        model.line_segments.len() >= 2,
        "the mirror should have added a segment"
    );
    for magnitude in magnitudes(&model) {
        assert_eq!(magnitude, Some(90.0));
    }
}

#[test]
fn mirroring_a_classic_crease_stays_classic() {
    for magnitude in magnitudes(&mirrored_model(None)) {
        assert_eq!(magnitude, None, "the fix must not invent an angle");
    }
}

// ---------------------------------------------------------- mirror line (SymmetricDraw)

#[test]
fn symmetric_draw_takes_the_family_from_the_active_type_and_the_angle_from_the_source() {
    let mut model = CreasePatternModel::default();
    let source = crease(0.0, 0.0, 100.0, 0.0, LineColor::Red1, Some(90.0));
    let mirror = LineSegment::from_coordinates(0.0, 0.0, 0.0, 100.0);
    model.add_line_segment(source.clone());

    // Active type is valley, deliberately different from the source's mountain.
    assert!(symmetric_draw(
        &mut model,
        &source,
        &mirror,
        LineColor::Blue2
    ));

    let added = model
        .line_segments
        .iter()
        .find(|segment| segment.color == LineColor::Blue2)
        .expect("the reflected crease");
    assert_eq!(
        crease_fold_angle(added),
        Some(90.0),
        "family from the active type, angle from the source"
    );
}

#[test]
fn symmetric_draw_from_a_classic_source_stays_classic() {
    let mut model = CreasePatternModel::default();
    let source = crease(0.0, 0.0, 100.0, 0.0, LineColor::Red1, None);
    let mirror = LineSegment::from_coordinates(0.0, 0.0, 0.0, 100.0);
    model.add_line_segment(source.clone());
    symmetric_draw(&mut model, &source, &mirror, LineColor::Blue2);

    for magnitude in magnitudes(&model) {
        assert_eq!(magnitude, None);
    }
}

// ------------------------------------------------------------- extend (LengthenCrease)

/// `lengthen_crease`'s first argument is the stroke the user drags **across**
/// the creases they want to extend — not the crease itself. Getting that wrong
/// silently extends nothing, which is how the first version of this test passed
/// while only ever inspecting the untouched original.
fn lengthened_model(source_degrees: Option<f64>, mode: LengthenColorMode) -> CreasePatternModel {
    let mut model = CreasePatternModel::default();
    model.add_line_segment(crease(
        0.0,
        0.0,
        100.0,
        0.0,
        LineColor::Red1,
        source_degrees,
    ));
    // A wall further along, to extend out to.
    model.add_line_segment(crease(200.0, -100.0, 200.0, 100.0, LineColor::Blue2, None));

    let stroke = LineSegment::from_coordinates(50.0, -20.0, 50.0, 20.0);
    let added = lengthen_crease(&mut model, stroke, Point::new(200.0, 0.0), 10.0, mode);
    assert!(
        added > 0,
        "fixture extended nothing, so the test would be vacuous"
    );
    model
}

/// The extension runs from the wall back to the original crease's far end.
fn extension_of(model: &CreasePatternModel) -> &LineSegment {
    model
        .line_segments
        .iter()
        .find(|segment| {
            let spans = |x: f64| (segment.a.x - x).abs() < 1e-6 || (segment.b.x - x).abs() < 1e-6;
            spans(200.0) && spans(100.0)
        })
        .expect("the extension segment")
}

#[test]
fn extending_a_90_degree_crease_keeps_90_in_both_colour_modes() {
    // The whole point of the rule: the two E-family tools differ in the family
    // they paint, never in the angle they preserve.
    for mode in [
        LengthenColorMode::SameAsOriginal,
        LengthenColorMode::Current(LineColor::Blue2),
    ] {
        let model = lengthened_model(Some(90.0), mode);
        let extension = extension_of(&model);
        assert_eq!(
            extension.fold_magnitude.map(FoldMagnitude::degrees),
            Some(90.0),
            "extension lost the angle in {mode:?}"
        );
    }
}

#[test]
fn extending_takes_the_family_from_the_colour_mode() {
    // ...and only the family. Same source, two modes, two colours, one angle.
    let same = lengthened_model(Some(90.0), LengthenColorMode::SameAsOriginal);
    assert_eq!(
        extension_of(&same).color,
        LineColor::Red1,
        "same as original"
    );

    let current = lengthened_model(Some(90.0), LengthenColorMode::Current(LineColor::Blue2));
    assert_eq!(
        extension_of(&current).color,
        LineColor::Blue2,
        "active type"
    );
}

#[test]
fn extending_a_classic_crease_stays_classic() {
    for mode in [
        LengthenColorMode::SameAsOriginal,
        LengthenColorMode::Current(LineColor::Blue2),
    ] {
        let model = lengthened_model(None, mode);
        assert_eq!(
            extension_of(&model).fold_magnitude,
            None,
            "the fix must not invent an angle in {mode:?}"
        );
    }
}

// ---------------------------------------------------------- double symmetric draw

#[test]
fn double_symmetric_draw_carries_the_angle() {
    // The operation needs an L or T *touch* against the drag axis, not a
    // crossing -- see `is_double_symmetric_intersection`. A shared endpoint at
    // the drag's start is the simplest shape that qualifies.
    let mut model = CreasePatternModel::default();
    model.add_line_segment(crease(0.0, 0.0, 0.0, 100.0, LineColor::Red1, Some(90.0)));
    let before = model.line_segments.len();

    let drag = LineSegment::from_coordinates(0.0, 0.0, 100.0, 100.0);
    let added = double_symmetric_draw(&mut model, &drag);

    assert!(
        added > 0,
        "fixture produced no output, so this would pass vacuously"
    );
    assert!(model.line_segments.len() > before);
    for segment in &model.line_segments[before..] {
        assert_eq!(
            segment.fold_magnitude.map(FoldMagnitude::degrees),
            Some(90.0),
            "double-symmetric output lost the angle"
        );
    }
}

#[test]
fn double_symmetric_draw_from_a_classic_source_stays_classic() {
    let mut model = CreasePatternModel::default();
    model.add_line_segment(crease(0.0, 0.0, 0.0, 100.0, LineColor::Red1, None));
    let before = model.line_segments.len();
    let drag = LineSegment::from_coordinates(0.0, 0.0, 100.0, 100.0);
    assert!(double_symmetric_draw(&mut model, &drag) > 0);

    for segment in &model.line_segments[before..] {
        assert_eq!(segment.fold_magnitude, None, "must not invent an angle");
    }
}

// ------------------------------------------------- ContinuousSymmetricDraw is correct by cloning

#[test]
fn continuous_symmetric_draw_stays_correct_because_it_clones() {
    // This one needs no fix: it clones real model segments and overrides only
    // the colour, and `with_line_color` keeps the magnitude across a M/V swap.
    // Pinned because that is a subtle reason to be correct, and one refactor
    // away from silently regressing.
    use oristudio_cp::operations::construction::continuous_symmetric_draw;

    let mut model = CreasePatternModel::default();
    model.add_line_segment(crease(-100.0, 0.0, 100.0, 0.0, LineColor::Red1, Some(90.0)));
    model.add_line_segment(crease(
        100.0,
        -100.0,
        100.0,
        100.0,
        LineColor::Red1,
        Some(90.0),
    ));
    let before = model.line_segments.len();

    let added = continuous_symmetric_draw(
        &mut model,
        Point::new(-100.0, 0.0),
        Point::new(0.0, 0.0),
        LineColor::Blue2,
    );

    assert!(
        added > 0,
        "fixture produced no output, so this would pass vacuously"
    );
    assert!(model.line_segments.len() > before);
    for segment in &model.line_segments[before..] {
        assert_eq!(
            segment.fold_magnitude.map(FoldMagnitude::degrees),
            Some(90.0),
            "continuous-symmetric output lost the angle"
        );
    }
}

// -------------------------------------------------------------- recurrence guard

/// Source-level guard: copying a source crease's colour without its magnitude.
///
/// The audit that found these four sites worked by grepping one idiom, and that
/// only keeps working while the idiom stays greppable — the whole problem is
/// that `with_line_color(source.color)` *looks* complete. A reviewer will not
/// spot the missing half, so this fires instead.
///
/// Deliberately a source scan rather than a lint: a clippy lint is the
/// principled answer and is not worth writing for four call sites, and the repo
/// already gates on source shape elsewhere (`i18n:check`).
#[test]
fn colour_is_never_inherited_without_the_fold_angle() {
    use std::path::Path;

    let mut offenders = Vec::new();
    for file in [
        "construction.rs",
        "transform.rs",
        "color.rs",
        "arrangement.rs",
    ] {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src/operations")
            .join(file);
        let source = std::fs::read_to_string(&path).expect("operations source");
        let lines: Vec<&str> = source.lines().collect();

        for (index, line) in lines.iter().enumerate() {
            // `with_line_color(<something>.color)` — inheriting a source
            // crease's family. Not `with_line_color(LineColor::Red1)`, which
            // sets an explicit type and inherits nothing.
            let Some(open) = line.find("with_line_color(") else {
                continue;
            };
            let arg = &line[open + "with_line_color(".len()..];
            if !arg.starts_with(|c: char| c.is_ascii_lowercase() || c == '&' || c == '*') {
                continue;
            }
            if !arg.contains(".color)") {
                continue;
            }
            // The magnitude must be inherited in the same expression, which in
            // practice means within the next couple of lines.
            let window = lines[index..(index + 3).min(lines.len())].join(" ");
            if window.contains("with_fold_magnitude_of") {
                continue;
            }
            offenders.push(format!("{file}:{}: {}", index + 1, line.trim()));
        }
    }

    assert!(
        offenders.is_empty(),
        "these sites copy a source crease's colour but not its fold angle, so a \
         90-degree crease would come back as a full fold. Follow the \
         `with_line_color(...)` with `.with_fold_magnitude_of(source)` — see \
         implementation-plans/derived-geometry-fold-angle-inheritance.md\n  {}",
        offenders.join("\n  ")
    );
}

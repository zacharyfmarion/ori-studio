use oristudio_cp::checks::{
    CamvAngleArithmetic, FixInaccurateOptions, FixInaccurateType, FlatFoldabilityColor,
    FlatFoldabilityRule, check_camv_task, check1, check2, check3, check4, check4_with,
    fix_inaccurate_for_indices,
};
use oristudio_cp::geometry::{LineColor, LineSegment, Point};
use oristudio_cp::model::CreasePatternModel;

#[test]
fn check1_reports_overlapping_non_auxiliary_pairs_in_oriedita_order() {
    let mut model = CreasePatternModel::default();
    let first = segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1);
    let second = segment(5.0, 0.0, 15.0, 0.0, LineColor::Blue2);
    let aux_overlap = segment(6.0, 0.0, 8.0, 0.0, LineColor::Cyan3);
    model.add_line_segment(first.clone());
    model.add_line_segment(second.clone());
    model.add_line_segment(aux_overlap);

    assert_eq!(check1(&model), vec![second, first]);
}

#[test]
fn check2_reports_t_shape_non_auxiliary_pairs_in_oriedita_order() {
    let mut model = CreasePatternModel::default();
    let bar = segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1);
    let stem = segment(5.0, 0.0, 5.0, 5.0, LineColor::Blue2);
    let crossing = segment(2.0, -1.0, 2.0, 1.0, LineColor::Black0);
    model.add_line_segment(bar.clone());
    model.add_line_segment(stem.clone());
    model.add_line_segment(crossing);

    assert_eq!(check2(&model), vec![stem, bar]);
}

#[test]
fn check3_reports_invalid_boundary_vertex_line_counts() {
    let mut model = CreasePatternModel::default();
    model.add_line_segment(segment(0.0, 0.0, 10.0, 0.0, LineColor::Black0));
    model.add_line_segment(segment(0.0, 0.0, 0.0, 10.0, LineColor::Red1));

    let diagnostics = check3(&model);

    assert!(diagnostics.contains(&LineSegment::new(Point::origin(), Point::origin())));
}

#[test]
fn check3_reports_maekawa_and_fushimi_failures_without_deduplicating_markers() {
    let mut model = CreasePatternModel::default();
    model.add_line_segment(segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1));
    model.add_line_segment(segment(0.0, 0.0, -10.0, 0.0, LineColor::Red1));
    model.add_line_segment(segment(0.0, 0.0, 0.0, 10.0, LineColor::Blue2));
    model.add_line_segment(segment(0.0, 0.0, 0.0, -10.0, LineColor::Blue2));

    let origin_markers = check3(&model)
        .into_iter()
        .filter(|segment| segment.a == Point::origin() && segment.b == Point::origin())
        .count();

    assert!(origin_markers >= 2);
}

#[test]
fn check4_reports_structured_maekawa_violation() {
    let mut model = CreasePatternModel::default();
    model.add_line_segment(segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1));
    model.add_line_segment(segment(0.0, 0.0, -10.0, 0.0, LineColor::Blue2));

    let violations = check4(&model);

    let origin = violations
        .iter()
        .find(|violation| violation.point == Point::origin())
        .expect("shared vertex should have a structured violation");
    assert_eq!(origin.rule, FlatFoldabilityRule::Maekawa);
    assert_eq!(origin.color, FlatFoldabilityColor::Equal);
    assert!(origin.big_little_big.is_empty());
}

#[test]
fn check4_reports_big_little_big_payloads() {
    let mut model = CreasePatternModel::default();
    model.add_line_segment(segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1));
    model.add_line_segment(segment(0.0, 0.0, 8.660254037844386, 5.0, LineColor::Red1));
    model.add_line_segment(segment(0.0, 0.0, 0.0, 10.0, LineColor::Blue2));
    model.add_line_segment(segment(0.0, 0.0, -10.0, 0.0, LineColor::Blue2));
    model.add_line_segment(segment(0.0, 0.0, -8.660254037844386, -5.0, LineColor::Red1));
    model.add_line_segment(segment(0.0, 0.0, 0.0, -10.0, LineColor::Red1));

    let violations = check4(&model);

    assert!(violations.iter().any(|violation| {
        violation.rule == FlatFoldabilityRule::BigLittleBig
            && violation.big_little_big.iter().any(|line| line.violating)
    }));
}

#[test]
fn check_camv_task_recomputes_check4_and_marks_dirty() {
    let mut model = CreasePatternModel::default();
    model.add_line_segment(segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1));
    model.add_line_segment(segment(0.0, 0.0, -10.0, 0.0, LineColor::Blue2));

    let result = check_camv_task(&model);

    assert!(result.dirty);
    assert_eq!(result.violations, check4(&model));
}

#[test]
fn fix_inaccurate_bp_snaps_near_grid_coordinates() {
    let mut model = CreasePatternModel::default();
    model.add_line_segment(segment(0.1954, 0.0, 10.0, 0.0, LineColor::Red1));

    let result = fix_inaccurate_for_indices(
        &mut model,
        &[0],
        FixInaccurateOptions {
            use_bp: true,
            use_22_5: false,
            fix_precision: 0.05,
        },
    );

    assert_eq!(result.fix_type, FixInaccurateType::Bp);
    assert!(result.applied);
    assert_eq!(result.num_fixed_lines, 1);
    assert!((model.line_segments[0].a.x - 0.1953125).abs() < 1e-12);
}

#[test]
fn fix_inaccurate_uses_bundled_twenty_two_point_five_data() {
    let mut model = CreasePatternModel::default();
    model.add_line_segment(segment(117.1574, 0.0, 200.0, 0.0, LineColor::Blue2));

    let result = fix_inaccurate_for_indices(
        &mut model,
        &[0],
        FixInaccurateOptions {
            use_bp: false,
            use_22_5: true,
            fix_precision: 0.05,
        },
    );

    assert_eq!(result.fix_type, FixInaccurateType::Pure22_5);
    assert!(result.applied);
    assert_eq!(result.num_fixed_lines, 1);
    assert!((model.line_segments[0].a.x - 117.157287525381).abs() < 1e-12);
}

fn segment(ax: f64, ay: f64, bx: f64, by: f64, color: LineColor) -> LineSegment {
    LineSegment::with_color(Point::new(ax, ay), Point::new(bx, by), color)
}

/// The six bit-exact coordinate transforms.
///
/// Each only permutes and negates coordinates, so every one is lossless in
/// `f64` and none of them changes the geometry by so much as an ulp. A check
/// that answers differently under any of them is answering about the frame, not
/// about the pattern.
const EXACT_TRANSFORMS: [(&str, fn(Point) -> Point); 6] = [
    ("identity", |p| p),
    ("rot90", |p| Point::new(-p.y, p.x)),
    ("rot180", |p| Point::new(-p.x, -p.y)),
    ("rot270", |p| Point::new(p.y, -p.x)),
    ("mirror-x", |p| Point::new(-p.x, p.y)),
    ("transpose", |p| Point::new(p.y, p.x)),
];

/// A single vertex at the origin, from `(bearing_degrees, colour)` rays.
fn fan(rays: &[(f64, LineColor)], arm: f64) -> CreasePatternModel {
    let mut model = CreasePatternModel::default();
    for (bearing, color) in rays {
        let radians = bearing.to_radians();
        model.add_line_segment(segment(
            0.0,
            0.0,
            arm * radians.cos(),
            arm * radians.sin(),
            *color,
        ));
    }
    model
}

fn transformed(model: &CreasePatternModel, f: fn(Point) -> Point) -> CreasePatternModel {
    let mut out = CreasePatternModel::default();
    for s in &model.line_segments {
        out.add_line_segment(LineSegment::with_color(f(s.a), f(s.b), s.color));
    }
    out
}

/// The rule reported at the origin under each transform, or `None` for clean.
fn rules_across_transforms(
    model: &CreasePatternModel,
    arithmetic: CamvAngleArithmetic,
) -> Vec<Option<FlatFoldabilityRule>> {
    EXACT_TRANSFORMS
        .iter()
        .map(|(_, f)| {
            check4_with(&transformed(model, *f), arithmetic)
                .into_iter()
                .find(|v| v.point.distance(Point::origin()) < 1e-3)
                .map(|v| v.rule)
        })
        .collect()
}

/// The regression this whole split exists for.
///
/// A vertex that genuinely violates Kawasaki — by 1.4e-6 degrees, comfortably
/// over the 1e-6 bar — must be caught whichever way up it is drawn. Upstream's
/// arithmetic catches it in **three of six** orientations, which is both a
/// missed violation and proof that the bar is not the only thing deciding.
#[test]
fn a_real_violation_is_caught_in_every_orientation() {
    // Sectors (90+d)/(90-d)/90/90 with d = 7e-7, so the alternating sum is 2d =
    // 1.4e-6 degrees. Colours give |M - V| = 2, so Maekawa passes and the only
    // thing left to report is the angle.
    let d = 7e-7;
    let model = fan(
        &[
            (0.0, LineColor::Red1),
            (90.0 + d, LineColor::Red1),
            (180.0, LineColor::Blue2),
            (270.0 + d, LineColor::Red1),
        ],
        50.0,
    );

    let refined = rules_across_transforms(&model, CamvAngleArithmetic::Refined);
    assert!(
        refined
            .iter()
            .all(|r| *r == Some(FlatFoldabilityRule::Angles)),
        "a real 1.4e-6 deg violation must be caught in all six orientations, got {refined:?}"
    );
}

/// The other half: being orientation-independent must not mean being blind.
#[test]
fn a_vertex_well_under_the_bar_stays_clean_in_every_orientation() {
    // The same fan 200x further inside the bar. Nothing to report, anywhere.
    let model = fan(
        &[
            (0.0, LineColor::Red1),
            (90.0 + 5e-9, LineColor::Red1),
            (180.0, LineColor::Blue2),
            (270.0 + 5e-9, LineColor::Red1),
        ],
        50.0,
    );

    let refined = rules_across_transforms(&model, CamvAngleArithmetic::Refined);
    assert!(
        refined.iter().all(Option::is_none),
        "a vertex 200x inside the bar must be clean in all six orientations, got {refined:?}"
    );
}

/// A near-lattice box-pleat vertex — the shape a solved detection produces, and
/// the one upstream's arithmetic reports differently depending on rotation.
#[test]
fn a_near_lattice_vertex_reports_the_same_thing_in_every_orientation() {
    // Degree 6 with 45/90 sectors, nudged off the lattice by the amount an exact
    // solve actually leaves: ~1e-6 units on a 50-unit arm. Its true Kawasaki
    // residual is far under the bar, so the honest answer is "clean" six times.
    let off = 1.2e-6_f64.atan2(50.0).to_degrees();
    let model = fan(
        &[
            (0.0 + off, LineColor::Red1),
            (45.0 + off, LineColor::Blue2),
            (135.0 + off, LineColor::Red1),
            (225.0 + off, LineColor::Red1),
            (270.0 + off, LineColor::Red1),
            (315.0 + off, LineColor::Blue2),
        ],
        50.0,
    );

    let refined = rules_across_transforms(&model, CamvAngleArithmetic::Refined);
    assert!(
        refined.iter().all(|rule| *rule == refined[0]),
        "the verdict must not depend on the frame, got {refined:?}"
    );
    assert!(
        refined[0].is_none(),
        "its true residual is far under the bar, so the answer is clean, got {refined:?}"
    );
}

/// Big-little-big detection is preserved, and is also orientation-independent.
#[test]
fn big_little_big_is_reported_in_every_orientation() {
    // A little sector flanked by same-coloured creases is the condition; sectors
    // 20/100/160/80 put the 20 between two Red1. The remaining two are chosen so
    // |M - V| = 2, or Maekawa fires first and masks it.
    let model = fan(
        &[
            (0.0, LineColor::Red1),
            (20.0, LineColor::Red1),
            (120.0, LineColor::Red1),
            (280.0, LineColor::Blue2),
        ],
        50.0,
    );

    for arithmetic in [
        CamvAngleArithmetic::Refined,
        CamvAngleArithmetic::OrieditaExact,
    ] {
        let rules = rules_across_transforms(&model, arithmetic);
        assert!(
            rules
                .iter()
                .all(|r| *r == Some(FlatFoldabilityRule::BigLittleBig)),
            "{arithmetic:?} must report big-little-big in all six orientations, got {rules:?}"
        );
    }
}

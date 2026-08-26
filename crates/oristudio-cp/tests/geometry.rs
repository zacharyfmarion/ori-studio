use oristudio_cp::geometry::{
    Circle, CircleIntersection, Epsilon, FoldDirection, FoldMagnitude, Intersection, Line,
    LineColor, LineSegment, ParallelJudgement, Point, Polygon, PolygonIntersection, Rectangle,
    StraightLine, angle, angle_between_m180_180, bisection, circle_to_circle_intersection,
    determine_line_segment_distance, determine_line_segment_intersection,
    determine_line_segment_intersection_sweet, determine_line_segment_intersection_with_precision,
    equal, find_line_symmetry_point, get_segment_with_length, internal_division_ratio, is_inside,
    is_inside_sweet, is_line_segment_overlapping, is_line_segment_parallel,
    line_segment_change_length, move_parallel, point_rotate,
};

fn assert_close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() < 1.0e-9,
        "expected {expected}, got {actual}"
    );
}

fn assert_point_close(actual: Point, expected: Point) {
    assert_close(actual.x, expected.x);
    assert_close(actual.y, expected.y);
}

#[test]
fn pointset_line_and_rectangle_primitives_match_oriedita_carriers() {
    let line = Line::new(4, 9, LineColor::Blue2);
    assert_eq!(line.begin, 4);
    assert_eq!(line.end, 9);
    assert_eq!(line.color, LineColor::Blue2);
    assert_eq!(line.reset(), Line::default());

    let rectangle = Rectangle::new(
        Point::new(0.0, 0.0),
        Point::new(10.0, 0.0),
        Point::new(10.0, 10.0),
        Point::new(0.0, 10.0),
    );
    assert_eq!(rectangle.p1(), Some(Point::new(0.0, 0.0)));
    assert_eq!(rectangle.p4(), Some(Point::new(0.0, 10.0)));
    assert_eq!(rectangle.as_polygon().line_segments().len(), 4);
}

#[test]
fn projection_distance_and_angle_match_oriedita_shapes() {
    let segment = LineSegment::from_coordinates(0.0, 0.0, 10.0, 0.0);
    assert_close(
        determine_line_segment_distance(Point::new(5.0, 3.0), &segment),
        3.0,
    );
    assert_close(
        determine_line_segment_distance(Point::new(12.0, 3.0), &segment),
        13.0_f64.sqrt(),
    );

    assert_close(angle((Point::new(0.0, 0.0), Point::new(0.0, -1.0))), 270.0);
    assert_eq!(
        angle((Point::new(1.0, 1.0), Point::new(1.0, 1.0))),
        -10000.0
    );
    assert_close(angle_between_m180_180(540.0), 180.0);
}

#[test]
fn strict_and_sweet_inside_checks_diverge_at_tiny_endpoint_offsets() {
    let a = Point::new(0.0, 0.0);
    let b = Point::new(1.0, 0.0);
    let just_past_endpoint = Point::new(1.0 + Epsilon::SWEET_DISTANCE / 2.0, 0.0);

    assert_eq!(is_inside(a, just_past_endpoint, b), 0);
    assert_eq!(is_inside_sweet(a, just_past_endpoint, b), 1);
}

#[test]
fn segment_intersection_state_codes_cover_cross_l_t_and_points() {
    let horizontal = LineSegment::from_coordinates(0.0, 0.0, 10.0, 0.0);
    let vertical_cross = LineSegment::from_coordinates(5.0, -5.0, 5.0, 5.0);
    let l_shape = LineSegment::from_coordinates(0.0, 0.0, 0.0, 10.0);
    let t_shape = LineSegment::from_coordinates(10.0, -5.0, 10.0, 5.0);
    let point_on_horizontal = LineSegment::from_coordinates(5.0, 0.0, 5.0, 0.0);
    let point_same = LineSegment::from_coordinates(1.0, 2.0, 1.0, 2.0);

    assert_eq!(
        determine_line_segment_intersection(&horizontal, &vertical_cross),
        Intersection::Intersects1
    );
    assert_eq!(
        determine_line_segment_intersection(&horizontal, &l_shape),
        Intersection::IntersectsLShapeS1StartS2Start21
    );
    assert_eq!(
        determine_line_segment_intersection(&horizontal, &t_shape),
        Intersection::IntersectsTShapeS1VerticalBar26
    );
    assert_eq!(
        determine_line_segment_intersection(&horizontal, &point_on_horizontal),
        Intersection::IntersectAtPointS2_6
    );
    assert_eq!(
        determine_line_segment_intersection(&point_same, &point_same),
        Intersection::IntersectAtPoint4
    );
}

#[test]
fn sweet_intersection_accepts_tiny_endpoint_overshoot() {
    let base = LineSegment::from_coordinates(0.0, 0.0, 1.0, 0.0);
    let overshooting_vertical =
        LineSegment::from_coordinates(1.0 + Epsilon::SWEET_DISTANCE / 2.0, -1.0, 1.0, 1.0);

    assert_eq!(
        determine_line_segment_intersection(&base, &overshooting_vertical),
        Intersection::NoIntersection0
    );
    assert_eq!(
        determine_line_segment_intersection_sweet(&base, &overshooting_vertical),
        Intersection::IntersectsTShapeS1VerticalBar26
    );
}

#[test]
fn parallel_overlap_state_codes_match_oriedita_cases() {
    let long = LineSegment::from_coordinates(0.0, 0.0, 10.0, 0.0);

    assert_eq!(
        determine_line_segment_intersection(
            &long,
            &LineSegment::from_coordinates(0.0, 0.0, 10.0, 0.0)
        ),
        Intersection::ParallelEqual31
    );
    assert_eq!(
        determine_line_segment_intersection(
            &long,
            &LineSegment::from_coordinates(0.0, 0.0, 5.0, 0.0)
        ),
        Intersection::ParallelStartOfS1ContainsStartOfS2_321
    );
    assert_eq!(
        determine_line_segment_intersection(
            &long,
            &LineSegment::from_coordinates(10.0, 0.0, 15.0, 0.0)
        ),
        Intersection::ParallelEndOfS1IntersectsStartOfS2_343
    );
    assert_eq!(
        determine_line_segment_intersection(
            &long,
            &LineSegment::from_coordinates(3.0, 0.0, 7.0, 0.0)
        ),
        Intersection::ParallelS1IncludesS2_361
    );
    assert_eq!(
        determine_line_segment_intersection(
            &long,
            &LineSegment::from_coordinates(5.0, 0.0, 15.0, 0.0)
        ),
        Intersection::ParallelS1EndOverlapsS2Start371
    );
    assert!(is_line_segment_overlapping(
        &long,
        &LineSegment::from_coordinates(5.0, 0.0, 15.0, 0.0)
    ));
}

#[test]
fn exact_parallel_precision_zero_preserves_strict_behavior() {
    let base = LineSegment::from_coordinates(0.0, 0.0, 10.0, 0.0);
    let near_parallel =
        LineSegment::from_coordinates(0.0, Epsilon::UNKNOWN_1EN7, 10.0, Epsilon::UNKNOWN_1EN7);

    assert_eq!(
        determine_line_segment_intersection_with_precision(&base, &near_parallel, 0.0),
        Intersection::NoIntersection0
    );
    assert_eq!(
        is_line_segment_parallel(
            StraightLine::from_segment(&base),
            StraightLine::from_segment(&near_parallel)
        ),
        ParallelJudgement::ParallelEqual
    );
}

#[test]
fn rotation_symmetry_parallel_and_length_helpers_match_oriedita() {
    assert_point_close(
        point_rotate(Point::new(0.0, 0.0), Point::new(1.0, 0.0), 90.0),
        Point::new(0.0, 1.0),
    );
    assert_point_close(
        find_line_symmetry_point(
            Point::new(0.0, 0.0),
            Point::new(0.0, 1.0),
            Point::new(3.0, 4.0),
        ),
        Point::new(-3.0, 4.0),
    );

    let segment = LineSegment::from_coordinates(0.0, 0.0, 4.0, 0.0);
    let moved = move_parallel(&segment, 2.0);
    assert_point_close(moved.a, Point::new(0.0, -2.0));
    assert_point_close(moved.b, Point::new(4.0, -2.0));

    assert_point_close(
        get_segment_with_length(&segment, 10.0).b,
        Point::new(10.0, 0.0),
    );
    assert_point_close(
        line_segment_change_length(&segment, 2.0).b,
        Point::new(2.0, 0.0),
    );
}

#[test]
fn circle_and_polygon_helpers_match_oriedita_basics() {
    let c1 = Circle::new(0.0, 0.0, 5.0, LineColor::Black0);
    let c2 = Circle::new(10.0, 0.0, 5.0, LineColor::Black0);
    let c3 = Circle::new(9.0, 0.0, 5.0, LineColor::Black0);

    assert_eq!(
        circle_to_circle_intersection(c1, c2),
        CircleIntersection::Tangent
    );
    assert_eq!(
        circle_to_circle_intersection(c1, c3),
        CircleIntersection::Intersect
    );
    assert_point_close(
        c1.turn_around_point(Point::new(10.0, 0.0)),
        Point::new(2.5, 0.0),
    );

    let square = Polygon::new(vec![
        Point::new(0.0, 0.0),
        Point::new(10.0, 0.0),
        Point::new(10.0, 10.0),
        Point::new(0.0, 10.0),
    ]);

    assert_eq!(
        square.inside(Point::new(5.0, 5.0)),
        PolygonIntersection::Inside
    );
    assert_eq!(
        square.inside(Point::new(0.0, 5.0)),
        PolygonIntersection::Border
    );
    assert_eq!(
        square.inside(Point::new(-1.0, 5.0)),
        PolygonIntersection::Outside
    );
    assert_close(square.calculate_area(), -100.0);
}

#[test]
fn internal_division_and_bisection_keep_oriedita_sentinel_behavior() {
    assert_point_close(
        internal_division_ratio(Point::new(0.0, 0.0), Point::new(10.0, 0.0), 1.0, 3.0),
        Point::new(2.5, 0.0),
    );
    assert_eq!(
        internal_division_ratio(Point::new(0.0, 0.0), Point::new(0.0, 0.0), 1.0, 1.0),
        Point::new(-10000.0, -10000.0)
    );

    let bisector = bisection(Point::new(0.0, 0.0), Point::new(4.0, 0.0), 4.0);
    assert_point_close(bisector.a, Point::new(2.0, -2.0));
    assert_point_close(bisector.b, Point::new(2.0, 2.0));
    assert!(equal(
        Point::new(1.0, 1.0),
        Point::new(1.0, 1.0 + Epsilon::POINT / 2.0)
    ));
}

/// The sign of a fold angle is read in exactly one place, and zero is not a
/// direction.
///
/// Two predicates used to answer this: `degrees < 0.0` on the write path and
/// `degrees.is_sign_negative()` on the check path. They agree on every float
/// except one — IEEE 754 gives zero a sign bit, so `-0.0` is a valley to the
/// first and a mountain to the second. The solver emits `-0.0`, which is how a
/// single crease came out painted a valley by the write while the check
/// reported it folding the other way.
#[test]
fn a_fold_angle_of_zero_names_no_direction() {
    assert_eq!(
        FoldDirection::of_signed_angle(-90.0),
        Some(FoldDirection::Mountain)
    );
    assert_eq!(
        FoldDirection::of_signed_angle(90.0),
        Some(FoldDirection::Valley)
    );
    // Both zeros, and they must answer the same.
    assert_eq!(FoldDirection::of_signed_angle(0.0), None);
    assert_eq!(FoldDirection::of_signed_angle(-0.0), None);
    assert_eq!(FoldDirection::of_signed_angle(f64::NAN), None);

    for (direction, folded) in [
        (FoldDirection::Mountain, -180.0),
        (FoldDirection::Valley, 180.0),
    ] {
        assert!(!direction.admits(0.0), "{direction:?} admitted +0");
        assert!(!direction.admits(-0.0), "{direction:?} admitted -0");
        assert!(direction.admits(folded));
        // "Folds the other way" — what a hint clash actually is. Distinct from
        // "does not fold this way", which is also true of an angle that does not
        // fold at all.
        assert!(!direction.flipped().admits(folded));
        assert!(!direction.flipped().admits(0.0));
        assert!(!direction.flipped().admits(-0.0));
    }
}

/// A zero answer writes a magnitude and never a direction.
///
/// On a decided crease that means the mountain or valley the user gave it
/// survives — reading `degrees < 0.0` used to turn every zero-angled mountain
/// into a valley. On an unassigned crease there is nothing to keep, and this
/// model cannot spell a directionless folding crease, so it stays undecided with
/// its hint rather than being given a direction the answer never determined.
#[test]
fn a_zero_fold_angle_decides_no_directions() {
    let crease = |color: LineColor| {
        LineSegment::with_color(Point::new(0.0, 0.0), Point::new(100.0, 0.0), color)
            .with_fold_magnitude(FoldMagnitude::from_degrees(120.0))
    };

    for (color, zero) in [
        (LineColor::Red1, 0.0_f64),
        (LineColor::Red1, -0.0_f64),
        (LineColor::Blue2, 0.0_f64),
        (LineColor::Blue2, -0.0_f64),
    ] {
        let written = crease(color).with_signed_fold_angle(zero);
        assert_eq!(written.color, color, "{color:?} at {zero}");
        assert_eq!(written.fold_magnitude, Some(FoldMagnitude::FLAT));
    }

    let undecided = LineSegment::with_color(
        Point::new(0.0, 0.0),
        Point::new(100.0, 0.0),
        LineColor::None,
    )
    .with_direction_hint(Some(FoldDirection::Valley));
    for zero in [0.0_f64, -0.0_f64] {
        assert_eq!(
            undecided.with_signed_fold_angle(zero),
            undecided,
            "a zero answer decided an unassigned crease at {zero}"
        );
    }
    // A real angle still decides it — that is the whole point of admitting
    // unassigned creases here.
    let decided = undecided.with_signed_fold_angle(-70.5);
    assert_eq!(decided.color, LineColor::Red1);
    assert_eq!(decided.fold_direction_hint, None);
}

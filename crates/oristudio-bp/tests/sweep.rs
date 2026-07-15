use oristudio_bp::math::geometry::PathPoint;
use oristudio_bp::sweep::{
    AaUnion, ArcPoint, Clip, CpLine, CreaseType, GeneralUnion, Overlap, PathEx, RoughUnion,
    RoundedRect, RrIntersection, Stacking, aa_union, clip_lines, general_union, get_stacking,
    get_stacking_ex, overlap_test, rough_union, rr_intersection,
};

fn path(points: &[(f64, f64)]) -> Vec<PathPoint> {
    points.iter().map(|(x, y)| PathPoint::new(*x, *y)).collect()
}

fn path_ex(points: &[(f64, f64)], is_hole: bool) -> PathEx {
    PathEx {
        points: path(points),
        is_hole,
        from: None,
    }
}

fn cp_line(crease_type: CreaseType, x1: f64, y1: f64, x2: f64, y2: f64) -> CpLine {
    CpLine {
        crease_type,
        p1: PathPoint::new(x1, y1),
        p2: PathPoint::new(x2, y2),
    }
}

fn aabb(top: f64, right: f64, bottom: f64, left: f64) -> Vec<Vec<PathPoint>> {
    vec![path(&[
        (right, top),
        (left, top),
        (left, bottom),
        (right, bottom),
    ])]
}

fn rounded_rect(x: f64, y: f64, width: f64, height: f64, radius: f64) -> RoundedRect {
    RoundedRect {
        x,
        y,
        width,
        height,
        radius,
    }
}

fn circular_path_eq(actual: &[PathPoint], expected: &[PathPoint]) -> bool {
    if actual.len() != expected.len() {
        return false;
    }
    (0..actual.len()).any(|offset| {
        actual
            .iter()
            .enumerate()
            .all(|(i, point)| *point == expected[(i + offset) % expected.len()])
    })
}

fn circular_arc_path_eq(actual: &[ArcPoint], expected: &[ArcPoint]) -> bool {
    if actual.len() != expected.len() {
        return false;
    }
    (0..actual.len()).any(|offset| {
        actual
            .iter()
            .enumerate()
            .all(|(i, point)| arc_point_eq(point, &expected[(i + offset) % expected.len()]))
    })
}

fn arc_point_eq(actual: &ArcPoint, expected: &ArcPoint) -> bool {
    point_close(actual.point, expected.point)
        && match (actual.arc, expected.arc) {
            (Some(actual), Some(expected)) => point_close(actual, expected),
            (None, None) => true,
            _ => false,
        }
        && match (actual.radius, expected.radius) {
            (Some(actual), Some(expected)) => (actual - expected).abs() < 1e-9,
            (None, None) => true,
            _ => false,
        }
}

fn point_close(actual: PathPoint, expected: PathPoint) -> bool {
    (actual.x - expected.x).abs() < 1e-9 && (actual.y - expected.y).abs() < 1e-9
}

fn same_members(actual: &[usize], expected: &[usize]) -> bool {
    actual.len() == expected.len() && expected.iter().all(|value| actual.contains(value))
}

fn parse_path(value: &str) -> Vec<PathPoint> {
    value
        .split("),")
        .map(|part| {
            let clean = part.trim_matches(|c| c == '(' || c == ')' || c == ' ');
            let mut coordinates = clean.split(',');
            let x = parse_number(coordinates.next().unwrap());
            let y = parse_number(coordinates.next().unwrap());
            PathPoint::new(x, y)
        })
        .collect()
}

fn parse_arc_path(value: &str) -> Vec<ArcPoint> {
    value
        .split("),")
        .map(|part| {
            let clean = part.trim_matches(|c| c == '(' || c == ')' || c == ' ');
            let coordinates = clean.split(',').map(parse_number).collect::<Vec<_>>();
            let point = PathPoint::new(coordinates[0], coordinates[1]);
            if coordinates.len() == 5 {
                ArcPoint {
                    point,
                    arc: Some(PathPoint::new(coordinates[2], coordinates[3])),
                    radius: Some(coordinates[4]),
                }
            } else {
                ArcPoint {
                    point,
                    arc: None,
                    radius: None,
                }
            }
        })
        .collect()
}

fn parse_number(value: &str) -> f64 {
    if let Some((numerator, denominator)) = value.split_once('/') {
        numerator.parse::<f64>().unwrap() / denominator.parse::<f64>().unwrap()
    } else {
        value.parse().unwrap()
    }
}

#[test]
fn stacking_groups_paths_into_outer_and_inner_paths() {
    let result = Stacking::new().get(&[
        path(&[(0.0, 0.0), (5.0, 0.0), (5.0, 5.0), (0.0, 5.0)]),
        path(&[(1.0, 1.0), (1.0, 4.0), (4.0, 4.0), (4.0, 1.0)]),
        path(&[(2.0, 2.0), (3.0, 2.0), (3.0, 3.0), (2.0, 3.0)]),
    ]);

    assert_eq!(result.len(), 2);
    assert!(result.iter().any(|group| group.inner.len() == 1));
    assert!(result.iter().any(|group| group.inner.is_empty()));
}

#[test]
fn stacking_assigns_single_level_holes_to_containing_outer_path() {
    let outer = path(&[(0.0, 0.0), (6.0, 0.0), (6.0, 6.0), (0.0, 6.0)]);
    let hole = path(&[(1.0, 1.0), (1.0, 5.0), (5.0, 5.0), (5.0, 1.0)]);
    let separate = path(&[(7.0, 0.0), (9.0, 0.0), (9.0, 2.0), (7.0, 2.0)]);

    let result = get_stacking(&[outer.clone(), hole.clone(), separate.clone()]);

    let group = result
        .iter()
        .find(|group| group.outer == outer)
        .expect("outer group exists");
    assert_eq!(group.inner, vec![hole]);
    assert!(result.iter().any(|group| group.outer == separate));
}

#[test]
fn stacking_keeps_parent_group_when_child_precedes_parent_in_input() {
    let outer = path(&[(0.0, 0.0), (6.0, 0.0), (6.0, 6.0), (0.0, 6.0)]);
    let hole = path(&[(1.0, 1.0), (1.0, 5.0), (5.0, 5.0), (5.0, 1.0)]);

    let result = get_stacking(&[hole.clone(), outer.clone()]);

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].outer, outer);
    assert_eq!(result[0].inner, vec![hole]);
}

#[test]
fn stacking_ex_preserves_path_metadata() {
    let outer = path_ex(&[(0.0, 0.0), (6.0, 0.0), (6.0, 6.0), (0.0, 6.0)], true);
    let inner = path_ex(&[(1.0, 1.0), (1.0, 5.0), (5.0, 5.0), (5.0, 1.0)], false);

    let result = get_stacking_ex(&[outer.clone(), inner.clone()]);

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].outer, outer);
    assert_eq!(result[0].inner, vec![inner]);
}

#[test]
fn overlap_detects_cross_polygon_overlap() {
    assert!(Overlap::test(&[
        parse_path("(0,1),(2,1),(2,3),(0,3)"),
        parse_path("(1,0),(3,1),(3,2),(1,2)"),
    ]));
}

#[test]
fn overlap_rejects_endpoint_only_contact() {
    assert!(!overlap_test(&[
        parse_path("(3,-1),(4,2),(6,3),(5,0)"),
        parse_path("(3,6),(15/2,15/2),(6,3),(0,0)"),
    ]));
}

#[test]
fn overlap_ignores_same_polygon_floating_error_self_intersections() {
    assert!(!overlap_test(&[
        parse_path("(1019/16,907/16),(1131/16,2139/16),(1611/16,2539/16),(1499/16,1307/16)"),
        parse_path("(28,109),(61,131),(42,36),(1375/31,1130/31),(8,9)"),
    ]));
}

#[test]
fn overlap_preserves_upstream_containment_quirk() {
    // BP Studio v0.7.14 returns false for full containment; preserve that for parity.
    assert!(!overlap_test(&[
        path(&[(0.0, 0.0), (0.0, 5.0), (5.0, 5.0), (5.0, 0.0)]),
        path(&[(1.0, 1.0), (2.0, 1.0), (2.0, 2.0), (1.0, 2.0)]),
    ]));
}

#[test]
fn clip_clips_lines_in_boundary_and_subdivides_all_lines() {
    let result = Clip::new().get(&[
        cp_line(CreaseType::Border, 1.0, 1.0, 5.0, 1.0),
        cp_line(CreaseType::Border, 5.0, 1.0, 5.0, 5.0),
        cp_line(CreaseType::Border, 1.0, 5.0, 5.0, 5.0),
        cp_line(CreaseType::Border, 1.0, 1.0, 1.0, 5.0),
        cp_line(CreaseType::Mountain, 0.0, 3.0, 4.0, 3.0),
        cp_line(CreaseType::Valley, 3.0, 2.0, 3.0, 4.0),
    ]);

    assert_eq!(
        result
            .iter()
            .filter(|line| line.crease_type == CreaseType::Border)
            .count(),
        5
    );
    assert_eq!(
        result
            .iter()
            .filter(|line| line.crease_type == CreaseType::Mountain)
            .count(),
        2
    );
    assert_eq!(
        result
            .iter()
            .filter(|line| line.crease_type == CreaseType::Valley)
            .count(),
        2
    );
}

#[test]
fn clip_ignores_duplicate_non_border_segments_after_subdivision() {
    let result = clip_lines(&[
        cp_line(CreaseType::Border, 0.0, 0.0, 4.0, 0.0),
        cp_line(CreaseType::Border, 4.0, 0.0, 4.0, 4.0),
        cp_line(CreaseType::Border, 0.0, 4.0, 4.0, 4.0),
        cp_line(CreaseType::Border, 0.0, 0.0, 0.0, 4.0),
        cp_line(CreaseType::Mountain, 1.0, 2.0, 3.0, 2.0),
        cp_line(CreaseType::Mountain, 1.0, 2.0, 3.0, 2.0),
    ]);

    assert_eq!(
        result
            .iter()
            .filter(|line| line.crease_type == CreaseType::Mountain)
            .count(),
        1
    );
}

#[test]
fn aa_union_finds_union_of_aabbs() {
    let result = aa_union(&[
        aabb(4.0, 5.0, 1.0, 1.0),
        aabb(3.0, 4.0, 0.0, 0.0),
        aabb(5.0, 4.0, 4.0, 2.0),
    ]);

    assert_eq!(result.len(), 1);
    assert!(!result[0].is_hole);
    assert!(circular_path_eq(
        &result[0].points,
        &parse_path("(0,0),(4,0),(4,1),(5,1),(5,4),(4,4),(4,5),(2,5),(2,4),(1,4),(1,3),(0,3)")
    ));
}

#[test]
fn aa_union_handles_mixed_aabb_and_path_case() {
    let result = aa_union(&[
        aabb(4.0, 4.0, 2.0, 0.0),
        vec![parse_path("(1,0),(3,0),(3,2),(2,2),(1,2)")],
    ]);

    assert_eq!(result.len(), 1);
    assert!(circular_path_eq(
        &result[0].points,
        &parse_path("(1,0),(3,0),(3,2),(4,2),(4,4),(0,4),(0,2),(1,2)")
    ));
}

#[test]
fn aa_union_results_can_be_unioned_again() {
    let mut union = AaUnion::new(false);
    let result1 = union.get(&[aabb(4.0, 5.0, 1.0, 1.0), aabb(3.0, 4.0, 0.0, 0.0)]);
    let result1_component = result1
        .iter()
        .map(|path| path.points.clone())
        .collect::<Vec<_>>();
    let result2 = union.get(&[result1_component, aabb(5.0, 4.0, 4.0, 2.0)]);

    assert_eq!(result2.len(), 1);
    assert!(circular_path_eq(
        &result2[0].points,
        &parse_path("(0,0),(4,0),(4,1),(5,1),(5,4),(4,4),(4,5),(2,5),(2,4),(1,4),(1,3),(0,3)")
    ));
}

#[test]
fn aa_union_can_handle_multiple_subpaths() {
    let result = aa_union(&[
        aabb(1.0, 1.0, 0.0, 0.0),
        aabb(3.0, 1.0, 2.0, 0.0),
        aabb(3.0, 2.0, 2.0, 1.0),
    ]);

    assert_eq!(result.len(), 2);
    assert!(result.iter().any(|path| circular_path_eq(
        &path.points,
        &parse_path("(0,2),(1,2),(2,2),(2,3),(1,3),(0,3)")
    )));
    assert!(
        result
            .iter()
            .any(|path| circular_path_eq(&path.points, &parse_path("(0,0),(1,0),(1,1),(0,1)")))
    );
}

#[test]
fn aa_union_can_handle_multiple_subpaths_and_holes() {
    let result = aa_union(&[
        aabb(2.0, 5.0, 0.0, 1.0),
        aabb(5.0, 2.0, 1.0, 0.0),
        aabb(5.0, 6.0, 1.0, 4.0),
        aabb(6.0, 5.0, 4.0, 1.0),
    ]);

    assert_eq!(result.len(), 2);
    assert!(result.iter().any(|path| !path.is_hole
        && circular_path_eq(
            &path.points,
            &parse_path("(1,1),(1,0),(5,0),(5,1),(6,1),(6,5),(5,5),(5,6),(1,6),(1,5),(0,5),(0,1)")
        )));
    assert!(result.iter().any(|path| path.is_hole
        && circular_path_eq(&path.points, &parse_path("(2,2),(2,4),(4,4),(4,2)"))));
}

#[test]
fn aa_union_can_check_self_intersection() {
    let result = AaUnion::new(true).get(&[vec![parse_path(
        "(0,0),(3,0),(3,2),(1,2),(1,1),(2,1),(2,3),(0,3)",
    )]]);

    assert_eq!(result.len(), 1);
    assert!(circular_path_eq(
        &result[0].points,
        &parse_path("(0,0),(3,0),(3,2),(2,2),(2,3),(0,3)")
    ));
}

#[test]
fn aa_union_can_handle_keyholes() {
    let result = AaUnion::new(true).get(&[vec![parse_path(
        "(0,0),(3,0),(3,2),(2,2),(2,1),(1,1),(1,2),(3,2),(3,3),(0,3)",
    )]]);

    assert_eq!(result.len(), 2);
    assert!(result.iter().any(|path| !path.is_hole
        && circular_path_eq(&path.points, &parse_path("(0,0),(3,0),(3,2),(3,3),(0,3)"))));
    assert!(result.iter().any(|path| path.is_hole
        && circular_path_eq(&path.points, &parse_path("(1,1),(1,2),(2,2),(2,1)"))));
}

#[test]
fn rough_union_marks_holes_in_result() {
    let result = RoughUnion::new().union(&[
        vec![parse_path("(0,0),(2,0),(2,2),(0,2)")],
        vec![parse_path("(2,2),(4,2),(4,4),(2,4)")],
        vec![parse_path("(2,0),(4,0),(4,2),(3,2),(3,1),(2,1)")],
        vec![parse_path("(0,2),(1,2),(1,3),(2,3),(2,4),(0,4)")],
    ]);

    assert_eq!(result.len(), 1);
    assert!(same_members(&result[0].from, &[0, 1, 2, 3]));
    assert_eq!(
        result[0].paths.iter().filter(|path| !path.is_hole).count(),
        1
    );
    assert_eq!(
        result[0].paths.iter().filter(|path| path.is_hole).count(),
        1
    );
}

#[test]
fn rough_union_gives_origin_info_for_resulting_paths() {
    let result = rough_union(&[
        vec![parse_path("(0,0),(2,0),(2,4),(0,4)")],
        vec![parse_path("(2,0),(4,0),(4,4),(2,4)")],
        vec![parse_path("(1,1),(3,1),(3,3),(1,3)")],
        vec![parse_path("(5,1),(7,1),(7,3),(5,3)")],
    ]);

    assert_eq!(result.len(), 2);
    assert!(
        result
            .iter()
            .any(|component| same_members(&component.from, &[0, 1, 2]))
    );
    assert!(result.iter().any(|component| component.from == vec![3]));
}

#[test]
fn general_union_matches_aa_union_for_axis_aligned_case() {
    let result = GeneralUnion::new().get(&[
        aabb(4.0, 5.0, 1.0, 1.0),
        aabb(3.0, 4.0, 0.0, 0.0),
        aabb(5.0, 4.0, 4.0, 2.0),
    ]);

    assert_eq!(result.len(), 1);
    assert!(circular_path_eq(
        &result[0].points,
        &parse_path("(0,0),(4,0),(4,1),(5,1),(5,4),(4,4),(4,5),(2,5),(2,4),(1,4),(1,3),(0,3)")
    ));
}

#[test]
fn general_union_finds_union_of_crossing_polygons() {
    let result = general_union(&[
        vec![parse_path("(0,0),(4,2),(0,4)")],
        vec![parse_path("(4,0),(4,4),(0,2)")],
    ]);

    assert_eq!(result.len(), 1);
    assert!(circular_path_eq(
        &result[0].points,
        &parse_path("(0,0),(2,1),(4,0),(4,2),(4,4),(2,3),(0,4),(0,2)")
    ));
}

#[test]
fn general_union_handles_upstream_floating_error_regressions() {
    let result = general_union(&[vec![
        parse_path("(34,4),(34,-3),(40,-3),(40,2.6666666666666665),(39,4)"),
        parse_path(
            "(70,4),(66.6842105263158,4),(66.10309278350516,3.8762886597938144),(64,3),(64,-3),(70,-3)",
        ),
        parse_path("(64,36),(62,36),(62,24),(64,24)"),
        parse_path(
            "(64,42),(41,42),(40.17910447761194,40.02985074626866),(40,39.46153846153846),(40,36),(64,36)",
        ),
        parse_path("(40,52),(40,40),(64,40),(64,52)"),
        parse_path("(42,36),(40,36),(40,24),(42,24)"),
        parse_path("(64,8),(44,8),(40,5),(40,-8),(64,-8)"),
        parse_path("(62,30),(43.333333333333336,30),(42,29),(42,22),(62,22)"),
        parse_path(
            "(62,24),(62,36),(42.5,36),(42,35.333333333333336),(42,24),(40,24),(40,-4),(64,-4),(64,24)",
        ),
    ]]);

    assert_eq!(result.len(), 2);

    let result2 = general_union(&[vec![
        parse_path(
            "(94,90),(66,90),(66,63),(73.97142857142858,63),(76.78683385579937,62.34796238244514),(78.33333333333333,62),(94,62)",
        ),
        parse_path("(88,90),(60,90),(60,63),(68.57142857142857,63),(72,62),(88,62)"),
        parse_path(
            "(82,90),(54,90),(54,63),(62.57142857142857,63),(66,62),(69.6,62),(71.11598746081505,62.35109717868338),(74,63),(82,63)",
        ),
        parse_path(
            "(76,90),(48,90),(48,63),(56.57142857142857,63),(60,62),(63.666666666666664,62),(65.21316614420063,62.34796238244514),(68.02857142857142,63),(76,63)",
        ),
        parse_path("(42,90),(42,62),(59,62),(59,63),(70,63),(70,90)"),
    ]]);

    assert_eq!(result2.len(), 1);
    assert_eq!(result2[0].points.len(), 23);
}

#[test]
fn rr_intersection_finds_mixed_rounded_rectangle_intersections() {
    let result1 = RrIntersection::new().get(&[
        rounded_rect(1.0, 1.0, 2.0, 1.0, 1.0),
        rounded_rect(3.0, 3.0, 0.0, 0.0, 1.0),
    ]);

    assert_eq!(result1.len(), 1);
    assert!(circular_arc_path_eq(
        &result1[0],
        &parse_arc_path(
            "(2,3),(3,2,2,2,1),(3.8660254037844384,2.5,3.5773502691896257,2,1),(3,3,3.5773502691896257,3,1)"
        )
    ));

    let result2 = rr_intersection(&[
        rounded_rect(1.0, 1.0, 2.0, 1.0, 1.0),
        rounded_rect(5.0, 4.0, 0.0, 0.0, 3.0),
    ]);

    assert_eq!(result2.len(), 1);
    assert!(circular_arc_path_eq(
        &result2[0],
        &parse_arc_path(
            "(4,2),(3,3,4,3,1),(2.1715728752538097,3),(4,1.1715728752538097,2.649165125326327,1.649165125326327,3)"
        )
    ));
}

#[test]
fn rr_intersection_handles_complete_overlap() {
    let result = rr_intersection(&[
        rounded_rect(1.0, 1.0, 2.0, 1.0, 1.0),
        rounded_rect(2.0, 2.0, 0.0, 0.0, 1.0),
    ]);

    assert_eq!(result.len(), 1);
    assert!(circular_arc_path_eq(
        &result[0],
        &parse_arc_path("(1,2,1,3,1),(2,1,1,1,1),(3,2,3,1,1),(2,3,3,3,1)")
    ));
}

#[test]
fn rr_intersection_handles_arc_trisection() {
    let result = rr_intersection(&[
        rounded_rect(1.0, 1.0, 0.0, 0.0, 1.0),
        rounded_rect(3.0, 3.0, 0.0, 0.0, 3.0),
    ]);

    assert_eq!(result.len(), 1);
    assert!(circular_arc_path_eq(
        &result[0],
        &parse_arc_path(
            "(1,2,2,2,1),(0.29289321881345254,1.7071067811865475,0.5857864376269049,2,1),(1.7071067811865475,0.29289321881345254,0.75,0.75,3),(2,1,2,0.585786437626905,1)"
        )
    ));
}

#[test]
fn rr_intersection_handles_upstream_epsilon_error_case() {
    let result = rr_intersection(&[
        rounded_rect(1.0, 5.0, 0.0, 0.0, 1.0),
        rounded_rect(3.0, 3.0, 0.0, 0.0, 3.0),
    ]);

    assert_eq!(result.len(), 1);
    assert!(circular_arc_path_eq(
        &result[0],
        &parse_arc_path(
            "(2,5,2,4,1),(1.7071067811865483,5.707106781186548,2.0000000000000004,5.414213562373095,1),(0.2928932188134521,4.292893218813452,0.75,5.25,3),(1,4,0.585786437626905,4,1)"
        )
    ));
}

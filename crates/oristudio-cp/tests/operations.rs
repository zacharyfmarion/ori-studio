use oristudio_cp::geometry::{FoldMagnitude, LineColor, LineSegment, Point};
use oristudio_cp::model::CreasePatternModel;
use oristudio_cp::operations::arrangement::{
    branch_trim, del_v_all, del_v_all_color_change, del_v_at_point, del_v_at_point_color_change,
    del_v_pair, delete_intersecting_or_overlapping_lines_along,
    delete_line_segment_vertex_for_index, delete_line_segments_for_indices,
    delete_overlapping_lines_along, divide_intersections, divide_intersections_fast,
    divide_line_segment_with_new_lines, fix1, fix2, intersect_divide_pair,
    remove_overlapping_lines, remove_overlapping_lines_with_precision,
};
use std::collections::BTreeSet;

#[test]
fn intersect_divide_pair_splits_crossing_segments() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(10.0, 0.0), LineColor::Red1);
    model.add_line(
        Point::new(5.0, -5.0),
        Point::new(5.0, 5.0),
        LineColor::Blue2,
    );

    let added = intersect_divide_pair(&mut model, 0, 1);

    assert_eq!(added, 2);
    assert_eq!(model.line_segments.len(), 4);
    assert_segment(
        &model.line_segments[0],
        Point::new(0.0, 0.0),
        Point::new(5.0, 0.0),
        LineColor::Red1,
    );
    assert_segment(
        &model.line_segments[1],
        Point::new(5.0, -5.0),
        Point::new(5.0, 0.0),
        LineColor::Blue2,
    );
    assert_segment(
        &model.line_segments[2],
        Point::new(10.0, 0.0),
        Point::new(5.0, 0.0),
        LineColor::Red1,
    );
    assert_segment(
        &model.line_segments[3],
        Point::new(5.0, 5.0),
        Point::new(5.0, 0.0),
        LineColor::Blue2,
    );
}

#[test]
fn intersect_divide_pair_splits_t_shape_owner_segment() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(10.0, 0.0), LineColor::Red1);
    model.add_line(Point::new(5.0, 0.0), Point::new(5.0, 5.0), LineColor::Blue2);

    let added = intersect_divide_pair(&mut model, 0, 1);

    assert_eq!(added, 1);
    assert_eq!(model.line_segments.len(), 3);
    assert_segment(
        &model.line_segments[0],
        Point::new(0.0, 0.0),
        Point::new(5.0, 0.0),
        LineColor::Red1,
    );
    assert_segment(
        &model.line_segments[1],
        Point::new(5.0, 0.0),
        Point::new(5.0, 5.0),
        LineColor::Blue2,
    );
    assert_segment(
        &model.line_segments[2],
        Point::new(10.0, 0.0),
        Point::new(5.0, 0.0),
        LineColor::Red1,
    );
}

#[test]
fn intersect_divide_pair_uses_later_color_for_overlap_piece() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(10.0, 0.0), LineColor::Red1);
    model.add_line(
        Point::new(5.0, 0.0),
        Point::new(15.0, 0.0),
        LineColor::Blue2,
    );

    let added = intersect_divide_pair(&mut model, 0, 1);

    assert_eq!(added, 1);
    assert_eq!(model.line_segments.len(), 3);
    assert_segment(
        &model.line_segments[0],
        Point::new(0.0, 0.0),
        Point::new(5.0, 0.0),
        LineColor::Red1,
    );
    assert_segment(
        &model.line_segments[1],
        Point::new(10.0, 0.0),
        Point::new(15.0, 0.0),
        LineColor::Blue2,
    );
    assert_segment(
        &model.line_segments[2],
        Point::new(10.0, 0.0),
        Point::new(5.0, 0.0),
        LineColor::Blue2,
    );
}

#[test]
fn divide_intersections_arranges_crossing_segments() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(10.0, 0.0), LineColor::Red1);
    model.add_line(
        Point::new(5.0, -5.0),
        Point::new(5.0, 5.0),
        LineColor::Blue2,
    );

    divide_intersections(&mut model);

    assert_eq!(model.line_segments.len(), 4);
    assert!(contains_segment(
        &model,
        Point::new(0.0, 0.0),
        Point::new(5.0, 0.0),
        LineColor::Red1,
    ));
    assert!(contains_segment(
        &model,
        Point::new(10.0, 0.0),
        Point::new(5.0, 0.0),
        LineColor::Red1,
    ));
    assert!(contains_segment(
        &model,
        Point::new(5.0, -5.0),
        Point::new(5.0, 0.0),
        LineColor::Blue2,
    ));
    assert!(contains_segment(
        &model,
        Point::new(5.0, 5.0),
        Point::new(5.0, 0.0),
        LineColor::Blue2,
    ));
}

#[test]
fn divide_intersections_fast_splits_new_and_existing_crossing_lines() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(10.0, 0.0), LineColor::Red1);
    model.add_line(
        Point::new(5.0, -5.0),
        Point::new(5.0, 5.0),
        LineColor::Blue2,
    );
    let mut to_delete = BTreeSet::new();

    let intersection = divide_intersections_fast(&mut model, 1, 0, &mut to_delete);

    assert_eq!(
        intersection,
        oristudio_cp::geometry::Intersection::Intersects1
    );
    assert!(to_delete.is_empty());
    assert_eq!(model.line_segments.len(), 4);
    assert_segment(
        &model.line_segments[0],
        Point::new(0.0, 0.0),
        Point::new(5.0, 0.0),
        LineColor::Red1,
    );
    assert_segment(
        &model.line_segments[1],
        Point::new(5.0, -5.0),
        Point::new(5.0, 0.0),
        LineColor::Blue2,
    );
    assert_segment(
        &model.line_segments[2],
        Point::new(5.0, 0.0),
        Point::new(5.0, 5.0),
        LineColor::Blue2,
    );
    assert_segment(
        &model.line_segments[3],
        Point::new(5.0, 0.0),
        Point::new(10.0, 0.0),
        LineColor::Red1,
    );
}

#[test]
fn divide_intersections_fast_preserves_cyan_auxiliary_split_rules() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(10.0, 0.0), LineColor::Red1);
    model.add_line(Point::new(5.0, 0.0), Point::new(5.0, 5.0), LineColor::Cyan3);
    let mut to_delete = BTreeSet::new();

    let intersection = divide_intersections_fast(&mut model, 1, 0, &mut to_delete);

    assert_eq!(
        intersection,
        oristudio_cp::geometry::Intersection::NoIntersection0
    );
    assert!(to_delete.is_empty());
    assert_eq!(model.line_segments.len(), 2);
    assert_segment(
        &model.line_segments[0],
        Point::new(0.0, 0.0),
        Point::new(10.0, 0.0),
        LineColor::Red1,
    );
    assert_segment(
        &model.line_segments[1],
        Point::new(5.0, 0.0),
        Point::new(5.0, 5.0),
        LineColor::Cyan3,
    );
}

#[test]
fn divide_intersections_fast_splits_parallel_overlap_with_new_line_color() {
    let mut model = CreasePatternModel::default();
    model.add_line(
        Point::new(0.0, 0.0),
        Point::new(10.0, 0.0),
        LineColor::Blue2,
    );
    model.add_line(Point::new(5.0, 0.0), Point::new(15.0, 0.0), LineColor::Red1);
    let mut to_delete = BTreeSet::new();

    let intersection = divide_intersections_fast(&mut model, 1, 0, &mut to_delete);

    assert_eq!(
        intersection,
        oristudio_cp::geometry::Intersection::ParallelS1StartOverlapsS2End373
    );
    assert!(to_delete.is_empty());
    assert_eq!(model.line_segments.len(), 3);
    assert_segment(
        &model.line_segments[0],
        Point::new(0.0, 0.0),
        Point::new(5.0, 0.0),
        LineColor::Blue2,
    );
    assert_segment(
        &model.line_segments[1],
        Point::new(10.0, 0.0),
        Point::new(15.0, 0.0),
        LineColor::Red1,
    );
    assert_segment(
        &model.line_segments[2],
        Point::new(5.0, 0.0),
        Point::new(10.0, 0.0),
        LineColor::Red1,
    );
}

#[test]
fn divide_line_segment_with_new_lines_splits_inserted_line_against_existing_lines() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(10.0, 0.0), LineColor::Red1);
    model.add_line(
        Point::new(5.0, -5.0),
        Point::new(5.0, 5.0),
        LineColor::Blue2,
    );

    divide_line_segment_with_new_lines(&mut model, 1, 2);

    assert_eq!(model.line_segments.len(), 4);
    assert!(contains_segment(
        &model,
        Point::new(0.0, 0.0),
        Point::new(5.0, 0.0),
        LineColor::Red1,
    ));
    assert!(contains_segment(
        &model,
        Point::new(5.0, 0.0),
        Point::new(10.0, 0.0),
        LineColor::Red1,
    ));
    assert!(contains_segment(
        &model,
        Point::new(5.0, -5.0),
        Point::new(5.0, 0.0),
        LineColor::Blue2,
    ));
    assert!(contains_segment(
        &model,
        Point::new(5.0, 0.0),
        Point::new(5.0, 5.0),
        LineColor::Blue2,
    ));
}

#[test]
fn divide_line_segment_with_new_lines_deletes_existing_exact_duplicate() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(10.0, 0.0), LineColor::Red1);
    model.add_line(
        Point::new(10.0, 0.0),
        Point::new(0.0, 0.0),
        LineColor::Blue2,
    );

    divide_line_segment_with_new_lines(&mut model, 1, 2);

    assert_eq!(model.line_segments.len(), 1);
    assert_segment(
        &model.line_segments[0],
        Point::new(10.0, 0.0),
        Point::new(0.0, 0.0),
        LineColor::Blue2,
    );
}

#[test]
fn delete_line_segment_vertex_for_index_removes_line_and_cleans_straight_vertex() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(10.0, 0.0), LineColor::Red1);
    model.add_line(
        Point::new(10.0, 0.0),
        Point::new(20.0, 0.0),
        LineColor::Red1,
    );
    model.add_line(
        Point::new(10.0, 0.0),
        Point::new(10.0, 5.0),
        LineColor::Blue2,
    );

    assert!(delete_line_segment_vertex_for_index(&mut model, 2));

    assert_eq!(model.line_segments.len(), 1);
    assert_segment(
        &model.line_segments[0],
        Point::new(0.0, 0.0),
        Point::new(20.0, 0.0),
        LineColor::Red1,
    );
}

#[test]
fn delete_line_segments_for_indices_removes_resolved_lines_without_vertex_cleanup() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(1.0, 0.0), LineColor::Red1);
    model.add_line(Point::new(0.0, 1.0), Point::new(1.0, 1.0), LineColor::Blue2);
    model.add_line(
        Point::new(0.0, 2.0),
        Point::new(1.0, 2.0),
        LineColor::Black0,
    );

    let deleted = delete_line_segments_for_indices(&mut model, &[0, 2]);

    assert_eq!(deleted, 2);
    assert_eq!(model.line_segments.len(), 1);
    assert_segment(
        &model.line_segments[0],
        Point::new(0.0, 1.0),
        Point::new(1.0, 1.0),
        LineColor::Blue2,
    );
}

#[test]
fn delete_overlapping_lines_along_removes_only_overlapping_segments() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(10.0, 0.0), LineColor::Red1);
    model.add_line(
        Point::new(5.0, -5.0),
        Point::new(5.0, 5.0),
        LineColor::Blue2,
    );
    model.add_line(
        Point::new(0.0, 1.0),
        Point::new(10.0, 1.0),
        LineColor::Cyan3,
    );
    let selection = LineSegment::with_color(
        Point::new(2.0, 0.0),
        Point::new(8.0, 0.0),
        LineColor::Black0,
    );

    assert!(delete_overlapping_lines_along(&mut model, &selection));

    assert_eq!(model.line_segments.len(), 2);
    assert!(contains_segment(
        &model,
        Point::new(5.0, -5.0),
        Point::new(5.0, 5.0),
        LineColor::Blue2,
    ));
    assert!(contains_segment(
        &model,
        Point::new(0.0, 1.0),
        Point::new(10.0, 1.0),
        LineColor::Cyan3,
    ));
}

#[test]
fn delete_intersecting_or_overlapping_lines_along_removes_crossing_segments_too() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(10.0, 0.0), LineColor::Red1);
    model.add_line(
        Point::new(5.0, -5.0),
        Point::new(5.0, 5.0),
        LineColor::Blue2,
    );
    model.add_line(
        Point::new(0.0, 1.0),
        Point::new(10.0, 1.0),
        LineColor::Cyan3,
    );
    let selection = LineSegment::with_color(
        Point::new(2.0, 0.0),
        Point::new(8.0, 0.0),
        LineColor::Black0,
    );

    assert!(delete_intersecting_or_overlapping_lines_along(
        &mut model, &selection
    ));

    assert_eq!(model.line_segments.len(), 1);
    assert_segment(
        &model.line_segments[0],
        Point::new(0.0, 1.0),
        Point::new(10.0, 1.0),
        LineColor::Cyan3,
    );
}

#[test]
fn del_v_at_point_merges_straight_same_color_pair_and_preserves_false_return() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(10.0, 0.0), LineColor::Red1);
    model.add_line(
        Point::new(10.0, 0.0),
        Point::new(20.0, 0.0),
        LineColor::Red1,
    );

    let result = del_v_at_point(&mut model, Point::new(10.0, 0.0), 0.000001, 0.000001);

    assert!(!result);
    assert_eq!(model.line_segments.len(), 1);
    assert_segment(
        &model.line_segments[0],
        Point::new(0.0, 0.0),
        Point::new(20.0, 0.0),
        LineColor::Red1,
    );
}

#[test]
fn del_v_at_point_color_change_uses_first_original_color_like_oriedita() {
    let mut model = CreasePatternModel::default();
    model.add_line(
        Point::new(0.0, 0.0),
        Point::new(10.0, 0.0),
        LineColor::Black0,
    );
    model.add_line(
        Point::new(10.0, 0.0),
        Point::new(20.0, 0.0),
        LineColor::Red1,
    );

    let result = del_v_at_point_color_change(&mut model, Point::new(10.0, 0.0), 0.000001, 0.000001);

    assert!(!result);
    assert_eq!(model.line_segments.len(), 1);
    assert_segment(
        &model.line_segments[0],
        Point::new(0.0, 0.0),
        Point::new(20.0, 0.0),
        LineColor::Black0,
    );
}

#[test]
fn del_v_pair_uses_oriedita_color_matrix() {
    let mut model = CreasePatternModel::default();
    let first =
        LineSegment::with_color(Point::new(0.0, 0.0), Point::new(10.0, 0.0), LineColor::Red1);
    let second = LineSegment::with_color(
        Point::new(10.0, 0.0),
        Point::new(20.0, 0.0),
        LineColor::Blue2,
    );
    model.add_line_segment(first.clone());
    model.add_line_segment(second.clone());

    let new_line = del_v_pair(&mut model, &first, &second).expect("merge should happen");

    assert_segment(
        &new_line,
        Point::new(0.0, 0.0),
        Point::new(20.0, 0.0),
        LineColor::Black0,
    );
    assert_eq!(model.line_segments, vec![new_line]);
}

#[test]
fn del_v_all_merges_same_color_non_cyan_vertex_pairs() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(10.0, 0.0), LineColor::Red1);
    model.add_line(
        Point::new(10.0, 0.0),
        Point::new(20.0, 0.0),
        LineColor::Red1,
    );

    del_v_all(&mut model);

    assert_eq!(model.line_segments.len(), 1);
    assert_segment(
        &model.line_segments[0],
        Point::new(0.0, 0.0),
        Point::new(20.0, 0.0),
        LineColor::Red1,
    );
}

#[test]
fn del_v_all_color_change_uses_pair_color_matrix() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(10.0, 0.0), LineColor::Red1);
    model.add_line(
        Point::new(10.0, 0.0),
        Point::new(20.0, 0.0),
        LineColor::Blue2,
    );

    del_v_all_color_change(&mut model);

    assert_eq!(model.line_segments.len(), 1);
    assert_segment(
        &model.line_segments[0],
        Point::new(0.0, 0.0),
        Point::new(20.0, 0.0),
        LineColor::Black0,
    );
}

#[test]
fn branch_trim_matches_oriedita_restart_quirk_for_dangling_chain() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(10.0, 0.0), LineColor::Red1);
    model.add_line(
        Point::new(10.0, 0.0),
        Point::new(20.0, 0.0),
        LineColor::Red1,
    );
    model.add_line(
        Point::new(20.0, 0.0),
        Point::new(30.0, 0.0),
        LineColor::Red1,
    );

    branch_trim(&mut model);

    assert_eq!(model.line_segments.len(), 1);
    assert_segment(
        &model.line_segments[0],
        Point::new(10.0, 0.0),
        Point::new(20.0, 0.0),
        LineColor::Red1,
    );
}

#[test]
fn fix1_deletes_exact_duplicate_and_uses_later_color() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(10.0, 0.0), LineColor::Red1);
    model.add_line(
        Point::new(10.0, 0.0),
        Point::new(0.0, 0.0),
        LineColor::Blue2,
    );

    assert!(fix1(&mut model));

    assert_eq!(model.line_segments.len(), 1);
    assert_segment(
        &model.line_segments[0],
        Point::new(0.0, 0.0),
        Point::new(10.0, 0.0),
        LineColor::Blue2,
    );
}

#[test]
fn fix1_selects_partially_overlapping_non_cyan_lines() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(10.0, 0.0), LineColor::Red1);
    model.add_line(
        Point::new(5.0, 0.0),
        Point::new(15.0, 0.0),
        LineColor::Blue2,
    );

    assert!(!fix1(&mut model));

    assert_eq!(model.line_segments[0].selected, 2);
    assert_eq!(model.line_segments[1].selected, 2);
}

#[test]
fn fix2_splits_near_t_intersections_and_appends_segments_like_oriedita() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(10.0, 0.0), LineColor::Red1);
    model.add_line(Point::new(5.0, 0.0), Point::new(5.0, 5.0), LineColor::Blue2);

    fix2(&mut model);

    assert_eq!(model.line_segments.len(), 3);
    assert_segment(
        &model.line_segments[0],
        Point::new(5.0, 0.0),
        Point::new(5.0, 5.0),
        LineColor::Blue2,
    );
    assert_segment(
        &model.line_segments[1],
        Point::new(0.0, 0.0),
        Point::new(5.0, 0.0),
        LineColor::Red1,
    );
    assert_segment(
        &model.line_segments[2],
        Point::new(5.0, 0.0),
        Point::new(10.0, 0.0),
        LineColor::Red1,
    );
}

#[test]
fn overlapping_line_removal_keeps_first_matching_segment() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(10.0, 0.0), LineColor::Red1);
    model.add_line(
        Point::new(10.0, 0.0),
        Point::new(0.0, 0.0),
        LineColor::Blue2,
    );
    model.add_line(
        Point::new(0.0, 0.0),
        Point::new(0.0, 10.0),
        LineColor::Cyan3,
    );

    remove_overlapping_lines(&mut model);

    assert_eq!(model.line_segments.len(), 2);
    assert_eq!(model.line_segments[0].color, LineColor::Red1);
    assert_eq!(model.line_segments[0].a, Point::new(0.0, 0.0));
    assert_eq!(model.line_segments[0].b, Point::new(10.0, 0.0));
    assert_eq!(model.line_segments[1].color, LineColor::Cyan3);
}

#[test]
fn overlapping_line_removal_uses_requested_precision() {
    let mut model = CreasePatternModel::default();
    model.add_line_segment(LineSegment::from_coordinates(0.0, 0.0, 10.0, 0.0));
    model.add_line_segment(LineSegment::from_coordinates(0.0001, 0.0, 10.0001, 0.0));

    remove_overlapping_lines_with_precision(&mut model, 0.001);

    assert_eq!(model.line_segments.len(), 1);
}

/// Fold angles are an Ori Studio addition to a ported operation, so this
/// behaviour has no upstream to check against — Oriedita creases are always
/// +/-180. The rule: merge losslessly when both sides agree, leave the vertex
/// alone when they do not, because two creases at different fold angles are
/// genuinely two creases.
#[test]
fn del_v_all_preserves_a_shared_fold_angle_and_refuses_a_mixed_one() {
    let sixty = FoldMagnitude::from_degrees(60.0).expect("60 is a valid magnitude");
    let ninety = FoldMagnitude::from_degrees(90.0).expect("90 is a valid magnitude");

    let mountain = |a: Point, b: Point, magnitude: Option<FoldMagnitude>| LineSegment {
        fold_magnitude: magnitude,
        ..LineSegment::with_color(a, b, LineColor::Red1)
    };

    // Same angle: one crease, drawn as two. Merges, and keeps the angle.
    let mut same = CreasePatternModel::default();
    same.add_line_segment(mountain(
        Point::new(0.0, 0.0),
        Point::new(10.0, 0.0),
        Some(sixty),
    ));
    same.add_line_segment(mountain(
        Point::new(10.0, 0.0),
        Point::new(20.0, 0.0),
        Some(sixty),
    ));
    del_v_all(&mut same);
    assert_eq!(same.line_segments.len(), 1);
    assert_eq!(same.line_segments[0].fold_magnitude, Some(sixty));

    // Different angles: genuinely a vertex. Left alone rather than flattened
    // to one angle or to a classic 180.
    let mut mixed = CreasePatternModel::default();
    mixed.add_line_segment(mountain(
        Point::new(0.0, 0.0),
        Point::new(10.0, 0.0),
        Some(sixty),
    ));
    mixed.add_line_segment(mountain(
        Point::new(10.0, 0.0),
        Point::new(20.0, 0.0),
        Some(ninety),
    ));
    del_v_all(&mut mixed);
    assert_eq!(mixed.line_segments.len(), 2);

    // A fold angle against a classic crease is the same disagreement: 60 is not
    // 180, so the vertex stays.
    let mut against_classic = CreasePatternModel::default();
    against_classic.add_line_segment(mountain(
        Point::new(0.0, 0.0),
        Point::new(10.0, 0.0),
        Some(sixty),
    ));
    against_classic.add_line_segment(mountain(Point::new(10.0, 0.0), Point::new(20.0, 0.0), None));
    del_v_all(&mut against_classic);
    assert_eq!(against_classic.line_segments.len(), 2);
}

/// `DeletePoint` is this same merge applied to one vertex, so it follows the
/// same rule. The two disagreeing would be a defect rather than a distinction.
#[test]
fn del_v_at_point_follows_the_same_fold_angle_rule() {
    let sixty = FoldMagnitude::from_degrees(60.0).expect("60 is a valid magnitude");
    let ninety = FoldMagnitude::from_degrees(90.0).expect("90 is a valid magnitude");
    let mountain = |a: Point, b: Point, magnitude: Option<FoldMagnitude>| LineSegment {
        fold_magnitude: magnitude,
        ..LineSegment::with_color(a, b, LineColor::Red1)
    };
    let vertex = Point::new(10.0, 0.0);

    let mut same = CreasePatternModel::default();
    same.add_line_segment(mountain(Point::new(0.0, 0.0), vertex, Some(sixty)));
    same.add_line_segment(mountain(vertex, Point::new(20.0, 0.0), Some(sixty)));
    del_v_at_point(&mut same, vertex, 1.0, 1e-6);
    assert_eq!(same.line_segments.len(), 1);
    assert_eq!(same.line_segments[0].fold_magnitude, Some(sixty));

    let mut mixed = CreasePatternModel::default();
    mixed.add_line_segment(mountain(Point::new(0.0, 0.0), vertex, Some(sixty)));
    mixed.add_line_segment(mountain(vertex, Point::new(20.0, 0.0), Some(ninety)));
    del_v_at_point(&mut mixed, vertex, 1.0, 1e-6);
    assert_eq!(mixed.line_segments.len(), 2);
}

/// Every Oriedita document is all-classic, so the whole fold-angle rule has to
/// be invisible to it — this is the case the parity oracle exercises.
#[test]
fn del_v_all_is_unchanged_for_documents_without_fold_angles() {
    let mut model = CreasePatternModel::default();
    model.add_line_segment(LineSegment::with_color(
        Point::new(0.0, 0.0),
        Point::new(10.0, 0.0),
        LineColor::Red1,
    ));
    model.add_line_segment(LineSegment::with_color(
        Point::new(10.0, 0.0),
        Point::new(20.0, 0.0),
        LineColor::Red1,
    ));

    del_v_all(&mut model);

    assert_eq!(model.line_segments.len(), 1);
    assert_eq!(model.line_segments[0].fold_magnitude, None);
}

/// A mountain merged with a valley resolves to an edge by Oriedita's colour
/// matrix, and an edge carries no fold angle — so a shared magnitude is dropped
/// rather than carried onto a line where it would mean nothing.
#[test]
fn del_v_all_color_change_drops_the_angle_when_the_pair_resolves_to_an_edge() {
    let sixty = FoldMagnitude::from_degrees(60.0).expect("60 is a valid magnitude");
    let with_angle = |a: Point, b: Point, color: LineColor| LineSegment {
        fold_magnitude: Some(sixty),
        ..LineSegment::with_color(a, b, color)
    };

    let mut model = CreasePatternModel::default();
    model.add_line_segment(with_angle(
        Point::new(0.0, 0.0),
        Point::new(10.0, 0.0),
        LineColor::Red1,
    ));
    model.add_line_segment(with_angle(
        Point::new(10.0, 0.0),
        Point::new(20.0, 0.0),
        LineColor::Blue2,
    ));

    del_v_all_color_change(&mut model);

    assert_eq!(model.line_segments.len(), 1);
    assert_eq!(model.line_segments[0].color, LineColor::Black0);
    assert_eq!(model.line_segments[0].fold_magnitude, None);
}

/// The sweep's worst case: every interior vertex is degree two, so every one of
/// them merges. This is also its *typical* case, since collapsing split creases
/// is what the tool is for.
///
/// The value-based version cost O(vertices x segments) — a full scan of the
/// segment list per deletion and of every vertex group per redirect. Measured
/// on this exact input in a debug build: 1.35s before, 0.01s after.
///
/// The bound is set from those two numbers rather than picked round. It has to
/// sit far enough above 0.01s to survive a loaded CI box and far enough below
/// 1.35s to actually fire, which is the whole point — an earlier draft of this
/// test used 10s and would have passed against the quadratic version it exists
/// to catch.
#[test]
fn del_v_all_collapses_a_dense_grid_without_going_quadratic() {
    const LINES: usize = 100;
    const SPLITS: usize = 100;

    let mut model = CreasePatternModel::default();
    for row in 0..LINES {
        let y = row as f64;
        for split in 0..SPLITS {
            let x = split as f64;
            model.add_line_segment(LineSegment::with_color(
                Point::new(x, y),
                Point::new(x + 1.0, y),
                LineColor::Red1,
            ));
        }
    }
    assert_eq!(model.line_segments.len(), LINES * SPLITS);

    let started = std::time::Instant::now();
    del_v_all(&mut model);
    let elapsed = started.elapsed();

    // Each row collapses to a single segment spanning it.
    assert_eq!(model.line_segments.len(), LINES);
    for segment in &model.line_segments {
        assert_eq!(segment.a.x.min(segment.b.x), 0.0);
        assert_eq!(segment.a.x.max(segment.b.x), SPLITS as f64);
    }
    assert!(
        elapsed < std::time::Duration::from_millis(500),
        "dense-grid sweep took {elapsed:?}; suspect a reintroduced quadratic"
    );
}

fn assert_segment(segment: &LineSegment, a: Point, b: Point, color: LineColor) {
    assert_eq!(segment.a, a);
    assert_eq!(segment.b, b);
    assert_eq!(segment.color, color);
}

fn contains_segment(model: &CreasePatternModel, a: Point, b: Point, color: LineColor) -> bool {
    model
        .line_segments
        .iter()
        .any(|segment| segment.a == a && segment.b == b && segment.color == color)
}

use oristudio_cp::geometry::{FoldDirection, LineColor, LineSegment, Point};
use oristudio_cp::model::{CreasePatternModel, CustomLineType};
use oristudio_cp::operations::color::{
    advance_line_type, alternate_mountain_valley_along, alternate_mountain_valley_crossing,
    change_crease_type, delete_line_type_for_indices, delete_selected_line_type, make_aux,
    make_mountain, replace_line_type_for_indices, replace_selected_line_type,
    set_line_color_for_indices, toggle_mountain_valley,
};
use oristudio_cp::operations::native::unassign::make_unassigned_keeping_direction;

#[test]
fn set_line_color_for_indices_changes_non_aux_lines_in_place() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(10.0, 0.0), LineColor::Red1);

    let changed = set_line_color_for_indices(&mut model, &[0], LineColor::Blue2);

    assert_eq!(changed, 1);
    assert_eq!(model.line_segments[0].color, LineColor::Blue2);
}

#[test]
fn set_line_color_for_indices_replaces_aux_lines_with_insertion_splitting() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(10.0, 0.0), LineColor::Red1);
    model.add_line(
        Point::new(5.0, -5.0),
        Point::new(5.0, 5.0),
        LineColor::Cyan3,
    );

    let changed = make_mountain(&mut model, &[1]);

    assert_eq!(changed, 1);
    assert_eq!(model.line_segments.len(), 4);
    assert!(
        model
            .line_segments
            .iter()
            .all(|segment| segment.color == LineColor::Red1)
    );
}

#[test]
fn make_aux_deletes_folding_lines_and_appends_cyan_replacements() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(1.0, 0.0), LineColor::Red1);
    model.add_line(Point::new(0.0, 1.0), Point::new(1.0, 1.0), LineColor::Blue2);
    model.add_line(Point::new(0.0, 2.0), Point::new(1.0, 2.0), LineColor::Cyan3);

    let changed = make_aux(&mut model, &[0, 1, 2]);

    assert_eq!(changed, 2);
    assert_eq!(model.line_segments.len(), 3);
    assert_segment(
        &model.line_segments[0],
        Point::new(0.0, 2.0),
        Point::new(1.0, 2.0),
        LineColor::Cyan3,
    );
    assert_segment(
        &model.line_segments[1],
        Point::new(0.0, 0.0),
        Point::new(1.0, 0.0),
        LineColor::Cyan3,
    );
    assert_segment(
        &model.line_segments[2],
        Point::new(0.0, 1.0),
        Point::new(1.0, 1.0),
        LineColor::Cyan3,
    );
}

/// **The reported bug.** Upstream's `isFoldingLine()` gate is `Black0 | Red1 |
/// Blue2`, so an unassigned crease — a state Oriedita's UI cannot produce — fell
/// through it and "Make Auxiliary" did nothing, silently, on a menu item that
/// only checks whether anything is selected.
#[test]
fn make_aux_converts_an_unassigned_crease() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(1.0, 0.0), LineColor::None);

    let changed = make_aux(&mut model, &[0]);

    assert_eq!(changed, 1);
    assert_eq!(model.line_segments.len(), 1);
    assert_segment(
        &model.line_segments[0],
        Point::new(0.0, 0.0),
        Point::new(1.0, 0.0),
        LineColor::Cyan3,
    );
}

/// A crease unassigned *keeping* its direction is still unassigned, and it must
/// not carry the remembered direction onto a line that no longer folds.
#[test]
fn make_aux_drops_the_direction_hint_of_an_unassigned_crease() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(1.0, 0.0), LineColor::Red1);
    assert_eq!(make_unassigned_keeping_direction(&mut model, &[0]), 1);
    assert_eq!(
        model.line_segments[0].fold_direction_hint,
        Some(FoldDirection::Mountain)
    );

    assert_eq!(make_aux(&mut model, &[0]), 1);

    assert_eq!(model.line_segments[0].color, LineColor::Cyan3);
    assert_eq!(model.line_segments[0].fold_direction_hint, None);
}

/// The gate widened by exactly one colour. Every aux colour still declines —
/// upstream declines them too, and unlike the unassigned case the postcondition
/// ("this line is auxiliary") already holds, so zero is the honest count.
#[test]
fn make_aux_still_declines_lines_that_are_already_auxiliary() {
    let aux = [
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
    for (index, color) in aux.iter().enumerate() {
        let offset = index as f64;
        model.add_line(Point::new(offset, 0.0), Point::new(offset, 10.0), *color);
    }
    let before = model.line_segments.clone();
    let indices: Vec<usize> = (0..aux.len()).collect();

    assert_eq!(make_aux(&mut model, &indices), 0);

    assert_eq!(model.line_segments, before);
}

/// A mixed selection is the realistic one, and the count has to name only the
/// lines that moved.
#[test]
fn make_aux_counts_only_the_lines_it_reaches() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(1.0, 0.0), LineColor::Red1);
    model.add_line(Point::new(0.0, 1.0), Point::new(1.0, 1.0), LineColor::None);
    model.add_line(
        Point::new(0.0, 2.0),
        Point::new(1.0, 2.0),
        LineColor::Black0,
    );
    model.add_line(Point::new(0.0, 3.0), Point::new(1.0, 3.0), LineColor::Cyan3);

    // Red1, the unassigned crease and the border move; the aux line does not.
    assert_eq!(make_aux(&mut model, &[0, 1, 2, 3]), 3);
    assert!(
        model
            .line_segments
            .iter()
            .all(|segment| segment.color == LineColor::Cyan3)
    );
}

#[test]
fn set_line_color_for_indices_changes_equal_duplicates_like_oriedita_hashset() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(10.0, 0.0), LineColor::Red1);
    model.add_line(Point::new(0.0, 0.0), Point::new(10.0, 0.0), LineColor::Red1);

    let changed = set_line_color_for_indices(&mut model, &[1], LineColor::Blue2);

    assert_eq!(changed, 2);
    assert_eq!(model.line_segments[0].color, LineColor::Blue2);
    assert_eq!(model.line_segments[1].color, LineColor::Blue2);
}

#[test]
fn replace_line_type_for_indices_filters_by_custom_type() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(1.0, 0.0), LineColor::Red1);
    model.add_line(Point::new(0.0, 1.0), Point::new(1.0, 1.0), LineColor::Blue2);
    model.add_line(
        Point::new(0.0, 2.0),
        Point::new(1.0, 2.0),
        LineColor::Black0,
    );

    let changed = replace_line_type_for_indices(
        &mut model,
        &[0, 1, 2],
        CustomLineType::MountainAndValley,
        CustomLineType::Aux,
    );

    assert_eq!(changed, 2);
    assert_eq!(model.line_segments[0].color, LineColor::Cyan3);
    assert_eq!(model.line_segments[1].color, LineColor::Cyan3);
    assert_eq!(model.line_segments[2].color, LineColor::Black0);
}

#[test]
fn replace_selected_line_type_uses_selected_flags() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(1.0, 0.0), LineColor::Red1);
    model.add_line(Point::new(0.0, 1.0), Point::new(1.0, 1.0), LineColor::Blue2);
    model.line_segments[0] = model.line_segments[0].with_selected(2);

    let changed =
        replace_selected_line_type(&mut model, CustomLineType::Mountain, CustomLineType::Valley);

    assert_eq!(changed, 1);
    assert_eq!(model.line_segments[0].color, LineColor::Blue2);
    assert_eq!(model.line_segments[1].color, LineColor::Blue2);
}

#[test]
fn delete_line_type_for_indices_removes_matching_lines_by_value_order() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(1.0, 0.0), LineColor::Red1);
    model.add_line(Point::new(0.0, 1.0), Point::new(1.0, 1.0), LineColor::Blue2);
    model.add_line(
        Point::new(0.0, 2.0),
        Point::new(1.0, 2.0),
        LineColor::Black0,
    );

    let deleted =
        delete_line_type_for_indices(&mut model, &[0, 1, 2], CustomLineType::MountainAndValley);

    assert_eq!(deleted, 2);
    assert_eq!(model.line_segments.len(), 1);
    assert_eq!(model.line_segments[0].color, LineColor::Black0);
}

#[test]
fn delete_selected_line_type_uses_selected_flags() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(1.0, 0.0), LineColor::Red1);
    model.add_line(Point::new(0.0, 1.0), Point::new(1.0, 1.0), LineColor::Blue2);
    model.line_segments[0] = model.line_segments[0].with_selected(2);

    let deleted = delete_selected_line_type(&mut model, CustomLineType::MountainAndValley);

    assert_eq!(deleted, 1);
    assert_eq!(model.line_segments.len(), 1);
    assert_eq!(model.line_segments[0].color, LineColor::Blue2);
}

#[test]
fn toggle_mountain_valley_changes_only_red_and_blue() {
    let mut model = CreasePatternModel::default();
    model.add_line(Point::new(0.0, 0.0), Point::new(1.0, 0.0), LineColor::Red1);
    model.add_line(Point::new(0.0, 1.0), Point::new(1.0, 1.0), LineColor::Blue2);
    model.add_line(
        Point::new(0.0, 2.0),
        Point::new(1.0, 2.0),
        LineColor::Black0,
    );

    let changed = toggle_mountain_valley(&mut model, &[0, 1, 2]);

    assert_eq!(changed, 2);
    assert_eq!(model.line_segments[0].color, LineColor::Blue2);
    assert_eq!(model.line_segments[1].color, LineColor::Red1);
    assert_eq!(model.line_segments[2].color, LineColor::Black0);
}

#[test]
fn change_crease_type_advances_folding_lines_only() {
    let mut model = CreasePatternModel::default();
    model.add_line(
        Point::new(0.0, 0.0),
        Point::new(1.0, 0.0),
        LineColor::Black0,
    );
    model.add_line(Point::new(0.0, 1.0), Point::new(1.0, 1.0), LineColor::Cyan3);

    assert!(change_crease_type(&mut model, 0));
    assert_eq!(model.line_segments[0].color, LineColor::Red1);
    assert!(!change_crease_type(&mut model, 1));
    assert_eq!(model.line_segments[1].color, LineColor::Cyan3);
}

#[test]
fn advance_line_type_matches_oriedita_click_cycle() {
    let mut model = CreasePatternModel::default();
    model.add_line(
        Point::new(0.0, 0.0),
        Point::new(1.0, 0.0),
        LineColor::Black0,
    );
    model.add_line(Point::new(0.0, 1.0), Point::new(1.0, 1.0), LineColor::Blue2);

    assert!(advance_line_type(&mut model, 0));
    assert_eq!(model.line_segments[0].color, LineColor::Blue2);
    assert_eq!(model.line_segments[1].color, LineColor::Black0);
    assert_eq!(model.line_segments[1].selected, 2);
    assert!(advance_line_type(&mut model, 1));
    assert_eq!(model.line_segments[1].color, LineColor::Red1);
    assert_eq!(model.line_segments[1].selected, 0);
    assert!(advance_line_type(&mut model, 1));
    assert_eq!(model.line_segments[1].color, LineColor::Blue2);
    assert!(advance_line_type(&mut model, 1));
    assert_eq!(model.line_segments[1].color, LineColor::Black0);
}

#[test]
fn alternate_mountain_valley_along_overlapping_lines_by_distance() {
    let mut model = CreasePatternModel::default();
    model.add_line(
        Point::new(10.0, 0.0),
        Point::new(20.0, 0.0),
        LineColor::Black0,
    );
    model.add_line(
        Point::new(0.0, 0.0),
        Point::new(5.0, 0.0),
        LineColor::Black0,
    );
    let guide =
        LineSegment::with_color(Point::new(0.0, 0.0), Point::new(20.0, 0.0), LineColor::Red1);

    let changed = alternate_mountain_valley_along(&mut model, &guide, LineColor::Red1);

    assert_eq!(changed, 2);
    assert_eq!(model.line_segments[1].color, LineColor::Red1);
    assert_eq!(model.line_segments[0].color, LineColor::Blue2);
}

#[test]
fn alternate_mountain_valley_crossing_orders_from_drag_endpoint() {
    let mut model = CreasePatternModel::default();
    model.add_line(
        Point::new(5.0, -1.0),
        Point::new(5.0, 1.0),
        LineColor::Black0,
    );
    model.add_line(
        Point::new(15.0, -1.0),
        Point::new(15.0, 1.0),
        LineColor::Black0,
    );
    let guide = LineSegment::with_color(
        Point::new(0.0, 0.0),
        Point::new(20.0, 0.0),
        LineColor::Blue2,
    );

    let changed = alternate_mountain_valley_crossing(&mut model, &guide, LineColor::Red1);

    assert_eq!(changed, 2);
    assert_eq!(model.line_segments[1].color, LineColor::Red1);
    assert_eq!(model.line_segments[0].color, LineColor::Blue2);
}

fn assert_segment(segment: &LineSegment, a: Point, b: Point, color: LineColor) {
    assert_eq!(segment.a, a);
    assert_eq!(segment.b, b);
    assert_eq!(segment.color, color);
}

/// `CreaseSetFoldAngle` touches only folding creases, and reports how many it
/// actually changed so the UI can say so.
#[test]
fn set_fold_angle_skips_lines_that_cannot_carry_one() {
    use oristudio_cp::geometry::FoldMagnitude;
    use oristudio_cp::operations::color::set_fold_magnitude_for_indices;

    let mut model = CreasePatternModel::default();
    model.add_line_segment(
        LineSegment::from_coordinates(0.0, 0.0, 1.0, 0.0).with_line_color(LineColor::Red1),
    );
    model.add_line_segment(
        LineSegment::from_coordinates(0.0, 1.0, 1.0, 1.0).with_line_color(LineColor::Blue2),
    );
    model.add_line_segment(
        LineSegment::from_coordinates(0.0, 2.0, 1.0, 2.0).with_line_color(LineColor::Black0),
    );
    model.add_line_segment(
        LineSegment::from_coordinates(0.0, 3.0, 1.0, 3.0).with_line_color(LineColor::Cyan3),
    );

    let ninety = FoldMagnitude::from_degrees(90.0).expect("in range");
    let changed = set_fold_magnitude_for_indices(&mut model, &[0, 1, 2, 3], Some(ninety));

    assert_eq!(changed, 2, "only the two creases should change");
    assert_eq!(model.line_segments[0].fold_magnitude, Some(ninety));
    assert_eq!(model.line_segments[1].fold_magnitude, Some(ninety));
    assert_eq!(model.line_segments[2].fold_magnitude, None, "border");
    assert_eq!(model.line_segments[3].fold_magnitude, None, "auxiliary");
}

/// Setting 180 stores `None`, so a document that has been round-tripped through
/// "set 180" is byte-identical to one that never carried an angle.
#[test]
fn setting_180_leaves_the_document_byte_identical() {
    use oristudio_cp::geometry::FoldMagnitude;
    use oristudio_cp::operations::color::set_fold_magnitude_for_indices;

    let mut model = CreasePatternModel::default();
    model.add_line_segment(
        LineSegment::from_coordinates(0.0, 0.0, 1.0, 0.0).with_line_color(LineColor::Red1),
    );
    let pristine = serde_json::to_string(&model).expect("serialise");

    let changed =
        set_fold_magnitude_for_indices(&mut model, &[0], FoldMagnitude::from_degrees(180.0));
    assert_eq!(changed, 0, "180 is already the classic state");
    assert_eq!(serde_json::to_string(&model).expect("serialise"), pristine);
}

/// The architecture's central claim, asserted at the operation level: flipping
/// mountain/valley negates rho and needs no fold-angle-aware code.
#[test]
fn mountain_valley_flip_preserves_the_magnitude() {
    use oristudio_cp::geometry::FoldMagnitude;
    use oristudio_cp::model::crease_fold_angle;
    use oristudio_cp::operations::color::{
        set_fold_magnitude_for_indices, set_line_color_for_indices,
    };

    let mut model = CreasePatternModel::default();
    model.add_line_segment(
        LineSegment::from_coordinates(0.0, 0.0, 1.0, 0.0).with_line_color(LineColor::Red1),
    );
    set_fold_magnitude_for_indices(&mut model, &[0], FoldMagnitude::from_degrees(90.0));
    assert_eq!(crease_fold_angle(&model.line_segments[0]), Some(-90.0));

    set_line_color_for_indices(&mut model, &[0], LineColor::Blue2);
    assert_eq!(
        crease_fold_angle(&model.line_segments[0]),
        Some(90.0),
        "flipping M/V must negate rho with no magnitude-aware code"
    );
}

/// Splitting a crease at a new intersection must carry the fold angle into both
/// halves. This falls out of `with_coordinates` using `..*self`, exactly as the
/// colour does — but it is load-bearing enough to pin, because silently
/// flattening half a crease would be very hard to notice.
#[test]
fn splitting_a_crease_preserves_its_fold_angle() {
    use oristudio_cp::geometry::FoldMagnitude;
    use oristudio_cp::operations::arrangement::divide_line_segment_with_new_lines;

    let ninety = FoldMagnitude::from_degrees(90.0).expect("in range");
    let mut model = CreasePatternModel::default();
    // A horizontal 90-degree mountain...
    model.add_line_segment(
        LineSegment::from_coordinates(-100.0, 0.0, 100.0, 0.0)
            .with_line_color(LineColor::Red1)
            .with_fold_magnitude(Some(ninety)),
    );
    let original_end = model.line_segments.len();
    // ...crossed by a classic valley.
    model.add_line_segment(
        LineSegment::from_coordinates(0.0, -100.0, 0.0, 100.0).with_line_color(LineColor::Blue2),
    );
    let added_end = model.line_segments.len();

    divide_line_segment_with_new_lines(&mut model, original_end, added_end);

    let mountains: Vec<_> = model
        .line_segments
        .iter()
        .filter(|segment| segment.color == LineColor::Red1)
        .collect();
    assert!(mountains.len() >= 2, "the mountain should have been split");
    for piece in mountains {
        assert_eq!(
            piece.fold_magnitude,
            Some(ninety),
            "every piece of a 90-degree crease must still be 90 degrees"
        );
    }
    // The classic valley's pieces stay classic — the split must not invent an angle.
    for piece in model
        .line_segments
        .iter()
        .filter(|segment| segment.color == LineColor::Blue2)
    {
        assert_eq!(piece.fold_magnitude, None);
    }
}

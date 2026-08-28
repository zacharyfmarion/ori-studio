use oristudio_cp::geometry::{LineColor, LineSegment, Point};
use oristudio_cp::model::{CreasePatternModel, GridState, SnapCandidates, SnapPolicy};
use oristudio_cp::operations::construction::{
    DrawCreaseTarget, FoldableLineDrawOperationMode, angle_restricted_converging_candidates,
    angle_system_candidates, angle_system_draw_to_destination, axiom5_draw_to_destination,
    axiom5_indicators, axiom7_draw_to_destination, axiom7_indicator, commit_axiom5_indicator,
    commit_parallel_width_indicator, continuous_symmetric_draw, double_symmetric_draw,
    draw_crease_angle_restricted_3_candidates, draw_crease_angle_restricted_3_to_point,
    draw_crease_angle_restricted_5, draw_crease_angle_restricted_converging, draw_crease_segment,
    fishbone_draw, foldable_line_draw_operation_mode, foldable_line_draw_switches_to_free,
    foldable_line_input_candidates, foldable_line_input_direct, foldable_line_input_fallback,
    foldable_line_input_to_destination, inward, make_vertex_flat_foldable_candidates,
    make_vertex_flat_foldable_to_destination, mirror_selected_lines, parallel_draw,
    parallel_width_indicators, perpendicular_indicator, perpendicular_projection,
    square_bisector_from_lines_to_destination, square_bisector_from_points_to_destination,
    square_bisector_parallel_between_destinations, square_bisector_parallel_destination_is_usable,
    square_bisector_parallel_indicator, symmetric_draw,
};
use oristudio_cp::{
    CreasePatternCommand, CreasePatternCommandPayload, CreasePatternDocument, OperationId,
    execute_command, preview_command,
};

#[test]
fn draw_crease_segment_inserts_and_splits_fold_lines() {
    let mut model = CreasePatternModel::default();
    model.add_line(
        Point::new(1.0, -1.0),
        Point::new(1.0, 1.0),
        LineColor::Black0,
    );
    let segment = segment(0.0, 0.0, 2.0, 0.0, LineColor::Red1);

    assert!(draw_crease_segment(
        &mut model,
        &segment,
        DrawCreaseTarget::FoldLine
    ));

    assert_eq!(model.line_segments.len(), 4);
    assert!(contains_segment(
        &model.line_segments,
        Point::new(0.0, 0.0),
        Point::new(1.0, 0.0),
        LineColor::Red1,
    ));
    assert!(contains_segment(
        &model.line_segments,
        Point::new(1.0, 0.0),
        Point::new(2.0, 0.0),
        LineColor::Red1,
    ));
}

#[test]
fn draw_crease_segment_aux_lines_append_without_foldline_splitting() {
    let mut model = CreasePatternModel::default();
    let segment = segment(0.0, 0.0, 2.0, 0.0, LineColor::Yellow7);

    assert!(draw_crease_segment(
        &mut model,
        &segment,
        DrawCreaseTarget::AuxLine
    ));

    assert!(model.line_segments.is_empty());
    assert_eq!(model.aux_line_segments, vec![segment]);
}

#[test]
fn draw_crease_segment_ignores_degenerate_segments() {
    let mut model = CreasePatternModel::default();
    let segment = segment(0.0, 0.0, 0.0, 0.0, LineColor::Red1);

    assert!(!draw_crease_segment(
        &mut model,
        &segment,
        DrawCreaseTarget::FoldLine
    ));
    assert!(model.is_empty());
}

#[test]
fn mirror_selected_lines_reflects_across_axis_and_unselects() {
    let mut model = CreasePatternModel::default();
    model.add_line_segment(segment(1.0, 0.0, 1.0, 1.0, LineColor::Red1).with_selected(2));
    model.add_line_segment(segment(3.0, 0.0, 3.0, 1.0, LineColor::Blue2));
    let axis = segment(0.0, 0.0, 0.0, 1.0, LineColor::Black0);

    let mirrored = mirror_selected_lines(&mut model, &axis);

    assert_eq!(mirrored, 1);
    assert_eq!(model.line_segments.len(), 3);
    assert!(contains_segment(
        &model.line_segments,
        Point::new(-1.0, 0.0),
        Point::new(-1.0, 1.0),
        LineColor::Red1,
    ));
    assert!(
        model
            .line_segments
            .iter()
            .all(|segment| segment.selected == 0)
    );
}

#[test]
fn parallel_draw_adds_parallel_segment_to_destination() {
    let mut model = model_from_segments(&[segment(2.0, -1.0, 2.0, 1.0, LineColor::Black0)]);
    let parallel = segment(0.0, 0.0, 1.0, 0.0, LineColor::Red1);
    let destination = segment(2.0, -1.0, 2.0, 1.0, LineColor::Black0);

    assert!(parallel_draw(
        &mut model,
        Point::new(0.0, 0.5),
        &parallel,
        &destination,
        LineColor::Blue2,
    ));
    assert!(contains_segment(
        &model.line_segments,
        Point::new(2.0, 0.5),
        Point::new(0.0, 0.5),
        LineColor::Blue2,
    ));
}

#[test]
fn parallel_width_indicators_offset_selected_segment() {
    let mut model = CreasePatternModel::default();
    let selected = segment(0.0, 0.0, 2.0, 0.0, LineColor::Red1);
    let indicators = parallel_width_indicators(&selected, 1.0);

    assert_eq!(indicators[0].color, LineColor::Purple8);
    assert!(commit_parallel_width_indicator(
        &mut model,
        &indicators[0],
        LineColor::Blue2,
    ));
    assert_eq!(model.line_segments.len(), 1);
    assert_eq!(model.line_segments[0].color, LineColor::Blue2);
}

#[test]
fn perpendicular_projection_adds_short_projection_when_target_outside_span() {
    let mut model = CreasePatternModel::default();
    let base = segment(0.0, 0.0, 1.0, 0.0, LineColor::Black0);

    assert!(perpendicular_projection(
        &mut model,
        Point::new(2.0, 1.0),
        &base,
        LineColor::Red1,
    ));
    assert!(contains_segment(
        &model.line_segments,
        Point::new(2.0, 1.0),
        Point::new(2.0, 0.0),
        LineColor::Red1,
    ));
}

#[test]
fn perpendicular_indicator_extends_across_existing_hits() {
    let model = model_from_segments(&[
        segment(-1.0, -2.0, 1.0, -2.0, LineColor::Black0),
        segment(-1.0, 2.0, 1.0, 2.0, LineColor::Black0),
    ]);
    let base = segment(-1.0, 0.0, 1.0, 0.0, LineColor::Red1);

    let indicator = perpendicular_indicator(&model, Point::new(0.0, 0.0), &base)
        .expect("point on span should produce indicator");

    assert_eq!(indicator.color, LineColor::Purple8);
    assert!((indicator.a.x - 0.0).abs() < 1e-12);
    assert!((indicator.a.y + 2.0).abs() < 1e-12);
    assert!((indicator.b.x - 0.0).abs() < 1e-12);
    assert!((indicator.b.y - 2.0).abs() < 1e-12);
}

#[test]
fn symmetric_draw_reflects_source_ray_across_mirror_line() {
    let mut model = model_from_segments(&[segment(0.0, 2.0, 2.0, 2.0, LineColor::Black0)]);
    let source = segment(0.0, 0.0, 1.0, 0.0, LineColor::Red1);
    let mirror = segment(0.0, 0.0, 1.0, 1.0, LineColor::Blue2);

    assert!(symmetric_draw(
        &mut model,
        &source,
        &mirror,
        LineColor::Red1,
    ));
    // The reflected ray is anchored at the mirror crossing (0, 0) and extends to
    // the crease at y = 2 (Oriedita `extendToIntersectionPoint` keeps endpoint A),
    // rather than starting at the reflected point (0, 1).
    assert!(
        model
            .line_segments
            .iter()
            .any(|segment| segment.color == LineColor::Red1
                && (segment.a.x - 0.0).abs() < 1e-12
                && (segment.a.y - 0.0).abs() < 1e-12
                && (segment.b.x - 0.0).abs() < 1e-12
                && (segment.b.y - 2.0).abs() < 1e-12)
    );
}

// Helper: reflected Red ray anchored at the mirror crossing (0,0) extending to the
// crease at y = 2. Both Mirror Line modes must produce this exact segment.
fn has_reflected_ray_to_y2(document: &CreasePatternDocument) -> bool {
    document.crease_pattern.line_segments.iter().any(|segment| {
        segment.color == LineColor::Red1
            && segment.a.x.abs() < 1e-12
            && segment.a.y.abs() < 1e-12
            && segment.b.x.abs() < 1e-12
            && (segment.b.y - 2.0).abs() < 1e-12
    })
}

#[test]
fn symmetric_draw_command_point_mode_mirrors_segment_ab_over_bc() {
    // Point mode (Oriedita "select points ABC"): 3 clicks mirror segment AB over the
    // line BC. A=(1,0), B=(0,0), C=(1,1) is the same construction as the op-level
    // test above, so the handler's 3-point branch must produce the identical ray.
    let mut document = CreasePatternDocument {
        crease_pattern: model_from_segments(&[segment(0.0, 2.0, 2.0, 2.0, LineColor::Black0)]),
        ..Default::default()
    };
    let command = CreasePatternCommand::new(OperationId::SymmetricDraw).with_payload(
        CreasePatternCommandPayload {
            points: vec![
                Point::new(1.0, 0.0),
                Point::new(0.0, 0.0),
                Point::new(1.0, 1.0),
            ],
            line_color: Some(LineColor::Red1),
            ..Default::default()
        },
    );

    execute_command(&mut document, command).expect("point-mode symmetric draw executes");
    assert!(
        has_reflected_ray_to_y2(&document),
        "expected reflected ray (0,0)->(0,2); got {:?}",
        document.crease_pattern.line_segments,
    );
}

#[test]
fn symmetric_draw_command_line_mode_resolves_nearest_creases() {
    // Line mode (Oriedita "select lines AB"): 2 clicks each resolve to the nearest
    // existing crease, mirroring source over mirror — unchanged by the dual-mode
    // refactor. Click near the source ray and near the mirror line.
    let mut document = CreasePatternDocument {
        crease_pattern: model_from_segments(&[
            segment(0.0, 0.0, 1.0, 0.0, LineColor::Black0),
            segment(0.0, 0.0, 1.0, 1.0, LineColor::Black0),
            segment(0.0, 2.0, 2.0, 2.0, LineColor::Black0),
        ]),
        ..Default::default()
    };
    let command = CreasePatternCommand::new(OperationId::SymmetricDraw).with_payload(
        CreasePatternCommandPayload {
            points: vec![Point::new(0.5, 0.0), Point::new(0.5, 0.5)],
            line_color: Some(LineColor::Red1),
            selection_distance: Some(1.0),
            ..Default::default()
        },
    );

    execute_command(&mut document, command).expect("line-mode symmetric draw executes");
    assert!(
        has_reflected_ray_to_y2(&document),
        "expected reflected ray (0,0)->(0,2); got {:?}",
        document.crease_pattern.line_segments,
    );
}

#[test]
fn double_symmetric_draw_reflects_far_endpoint_across_drag_axis() {
    let mut model = model_from_segments(&[
        segment(0.0, 1.0, 2.0, 1.0, LineColor::Red1),
        segment(-3.0, 0.0, -3.0, 2.0, LineColor::Black0),
    ]);
    let drag_axis = segment(0.0, 0.0, 0.0, 2.0, LineColor::Black0);

    assert_eq!(double_symmetric_draw(&mut model, &drag_axis), 1);
    // The reflected rib is anchored at the drag-axis crossing (0, 1) and runs to
    // the crease at x = -3, connected across rather than starting at the
    // reflected point (-2, 1).
    assert!(contains_segment_close(
        &model.line_segments,
        Point::new(0.0, 1.0),
        Point::new(-3.0, 1.0),
        LineColor::Red1,
    ));
}

#[test]
fn continuous_symmetric_draw_reflects_across_successive_hits_and_alternates_colors() {
    let mut model = model_from_segments(&[
        segment(2.0, -1.0, 2.0, 1.0, LineColor::Blue2),
        segment(4.0, -1.0, 4.0, 1.0, LineColor::Black0),
    ]);

    assert_eq!(
        continuous_symmetric_draw(
            &mut model,
            Point::new(0.0, 0.0),
            Point::new(1.0, 0.0),
            LineColor::Red1,
        ),
        2
    );
    assert!(contains_segment_close(
        &model.line_segments,
        Point::new(0.0, 0.0),
        Point::new(2.0, 0.0),
        LineColor::Red1,
    ));
    assert!(contains_segment_close(
        &model.line_segments,
        Point::new(2.0, 0.0),
        Point::new(4.0, 0.0),
        LineColor::Blue2,
    ));
}

#[test]
fn inward_connects_triangle_vertices_to_incenter() {
    let mut model = CreasePatternModel::default();

    assert_eq!(
        inward(
            &mut model,
            Point::new(0.0, 0.0),
            Point::new(4.0, 0.0),
            Point::new(0.0, 3.0),
            LineColor::Blue2,
        ),
        3
    );

    assert!(contains_segment(
        &model.line_segments,
        Point::new(0.0, 0.0),
        Point::new(1.0, 1.0),
        LineColor::Blue2,
    ));
    assert!(contains_segment(
        &model.line_segments,
        Point::new(4.0, 0.0),
        Point::new(1.0, 1.0),
        LineColor::Blue2,
    ));
    assert!(contains_segment(
        &model.line_segments,
        Point::new(0.0, 3.0),
        Point::new(1.0, 1.0),
        LineColor::Blue2,
    ));
}

#[test]
fn square_bisector_points_draws_to_destination() {
    let destination = segment(2.0, -1.0, 2.0, 3.0, LineColor::Black0);
    let mut model = model_from_segments(std::slice::from_ref(&destination));

    assert!(square_bisector_from_points_to_destination(
        &mut model,
        Point::new(0.0, 0.0),
        Point::new(4.0, 0.0),
        Point::new(0.0, 3.0),
        &destination,
        LineColor::Red1,
    ));

    assert!(contains_segment_close(
        &model.line_segments,
        Point::new(2.0, 2.0 / 3.0),
        Point::new(4.0, 0.0),
        LineColor::Red1,
    ));
}

#[test]
fn square_bisector_nonparallel_lines_draw_to_destination() {
    let first = segment(0.0, 0.0, 4.0, 0.0, LineColor::Black0);
    let second = segment(0.0, 0.0, 0.0, 4.0, LineColor::Black0);
    let destination = segment(2.0, -1.0, 2.0, 3.0, LineColor::Black0);
    let mut model = model_from_segments(&[first.clone(), second.clone(), destination.clone()]);

    assert!(square_bisector_from_lines_to_destination(
        &mut model,
        &first,
        &second,
        &destination,
        LineColor::Blue2,
    ));

    assert!(contains_segment_close(
        &model.line_segments,
        Point::new(2.0, 2.0),
        Point::new(0.0, 0.0),
        LineColor::Blue2,
    ));
}

#[test]
fn square_bisector_parallel_indicator_and_destination_commit() {
    let first = segment(-2.0, 0.0, 2.0, 0.0, LineColor::Black0);
    let second = segment(-2.0, 2.0, 2.0, 2.0, LineColor::Black0);
    let left = segment(-3.0, -1.0, -3.0, 3.0, LineColor::Black0);
    let right = segment(3.0, -1.0, 3.0, 3.0, LineColor::Black0);
    let mut model = model_from_segments(&[first.clone(), second.clone(), left, right]);

    let indicator = square_bisector_parallel_indicator(&model, &first, &second)
        .expect("parallel lines should produce indicator");
    assert_eq!(indicator.color, LineColor::Purple8);
    assert!(same_segment_close(
        &indicator,
        Point::new(-3.0, 1.0),
        Point::new(3.0, 1.0),
        LineColor::Purple8,
    ));

    let first_destination = segment(-1.0, -1.0, -1.0, 3.0, LineColor::Black0);
    let second_destination = segment(1.0, -1.0, 1.0, 3.0, LineColor::Black0);
    assert!(square_bisector_parallel_between_destinations(
        &mut model,
        &indicator,
        &second,
        &first_destination,
        &second_destination,
        LineColor::Red1,
    ));
    assert!(contains_segment(
        &model.line_segments,
        Point::new(-1.0, 1.0),
        Point::new(1.0, 1.0),
        LineColor::Red1,
    ));
}

#[test]
fn square_bisector_parallel_refuses_a_destination_parallel_to_the_bisector() {
    // Upstream never reaches this: `move_drag_select_destination_2L_P` refuses to
    // *offer* such a crease, so the commit can assume it away. That assumption is
    // the whole hazard — a destination parallel to the indicator gets intersected
    // with it, and `find_intersection` divides by a determinant that is float
    // noise rather than a clean zero, so the answer comes back finite and vast.
    let first = segment(-2.0, 0.0, 2.0, 0.0, LineColor::Black0);
    let second = segment(-2.0, 2.0, 2.0, 2.0, LineColor::Black0);
    let mut model = model_from_segments(&[first.clone(), second.clone()]);
    let indicator = square_bisector_parallel_indicator(&model, &first, &second)
        .expect("parallel sources produce an indicator");

    // Horizontal, so parallel to both sources and to the midline between them.
    let along = segment(-3.0, 0.5, 3.0, 0.5, LineColor::Black0);
    let crossing = segment(1.0, -1.0, 1.0, 3.0, LineColor::Black0);
    assert!(!square_bisector_parallel_destination_is_usable(
        &second, &along
    ));
    assert!(square_bisector_parallel_destination_is_usable(
        &second, &crossing
    ));

    let before = model.line_segments.len();
    for (a, b) in [(&along, &crossing), (&crossing, &along), (&along, &along)] {
        assert!(!square_bisector_parallel_between_destinations(
            &mut model,
            &indicator,
            &second,
            a,
            b,
            LineColor::Red1,
        ));
    }
    assert_eq!(model.line_segments.len(), before);
    let worst = model
        .line_segments
        .iter()
        .flat_map(|s| [s.a, s.b])
        .map(|p| p.x.abs().max(p.y.abs()))
        .fold(0.0_f64, f64::max);
    assert!(worst < 10.0, "a refused destination must not leak geometry");
}

#[test]
fn square_bisector_command_point_mode_routes_on_four_points() {
    // Mode A: 3 angle points (vertex is the 2nd) + a 4th point near the destination
    // crease → the handler's `else` branch resolves the destination and bisects.
    let mut document = CreasePatternDocument {
        crease_pattern: model_from_segments(&[segment(2.0, -1.0, 2.0, 3.0, LineColor::Black0)]),
        ..Default::default()
    };
    let command = CreasePatternCommand::new(OperationId::SquareBisector).with_payload(
        CreasePatternCommandPayload {
            points: vec![
                Point::new(0.0, 0.0),
                Point::new(4.0, 0.0),
                Point::new(0.0, 3.0),
                Point::new(2.0, 0.5),
            ],
            line_color: Some(LineColor::Red1),
            selection_distance: Some(1.0),
            ..Default::default()
        },
    );

    execute_command(&mut document, command).expect("point-mode square bisector executes");
    assert!(
        contains_segment_close(
            &document.crease_pattern.line_segments,
            Point::new(2.0, 2.0 / 3.0),
            Point::new(4.0, 0.0),
            LineColor::Red1,
        ),
        "expected bisector (2,2/3)-(4,0); got {:?}",
        document.crease_pattern.line_segments,
    );
}

#[test]
fn square_bisector_command_line_mode_routes_on_three_line_ids() {
    // Mode B: 2 source crease ids + a destination crease id → the `line_ids.len() >= 3`
    // branch bisects the angle between the sources and draws to the destination.
    let mut document = CreasePatternDocument {
        crease_pattern: model_from_segments(&[
            segment(0.0, 0.0, 4.0, 0.0, LineColor::Black0),
            segment(0.0, 0.0, 0.0, 4.0, LineColor::Black0),
            segment(2.0, -1.0, 2.0, 3.0, LineColor::Black0),
        ]),
        ..Default::default()
    };
    let command = CreasePatternCommand::new(OperationId::SquareBisector).with_payload(
        CreasePatternCommandPayload {
            line_ids: vec![1, 2, 3],
            line_color: Some(LineColor::Blue2),
            ..Default::default()
        },
    );

    execute_command(&mut document, command).expect("line-mode square bisector executes");
    assert!(
        contains_segment_close(
            &document.crease_pattern.line_segments,
            Point::new(2.0, 2.0),
            Point::new(0.0, 0.0),
            LineColor::Blue2,
        ),
        "expected bisector (2,2)-(0,0); got {:?}",
        document.crease_pattern.line_segments,
    );
}

#[test]
fn line_segment_division_command_divides_the_drawn_segment_by_count() {
    // Drag (0,0)->(2,0) with division count 2 → two equal Red creases, dividing the
    // *drawn* line (not an existing crease).
    let mut document = CreasePatternDocument::default();
    let command = CreasePatternCommand::new(OperationId::LineSegmentDivision).with_payload(
        CreasePatternCommandPayload {
            points: vec![Point::new(0.0, 0.0), Point::new(2.0, 0.0)],
            division_count: Some(2),
            line_color: Some(LineColor::Red1),
            ..Default::default()
        },
    );

    execute_command(&mut document, command).expect("line division executes");
    assert_eq!(document.crease_pattern.line_segments.len(), 2);
    assert!(contains_segment_close(
        &document.crease_pattern.line_segments,
        Point::new(0.0, 0.0),
        Point::new(1.0, 0.0),
        LineColor::Red1,
    ));
    assert!(contains_segment_close(
        &document.crease_pattern.line_segments,
        Point::new(1.0, 0.0),
        Point::new(2.0, 0.0),
        LineColor::Red1,
    ));
}

#[test]
fn line_segment_ratio_command_splits_the_drawn_segment_at_the_ratio_point() {
    // Drag (0,0)->(10,0) with ratio 1:3 → two Blue creases meeting at the 1:3 point
    // (2.5, 0), matching Oriedita's reversed-drag geometry.
    let mut document = CreasePatternDocument::default();
    let command = CreasePatternCommand::new(OperationId::LineSegmentRatioSet).with_payload(
        CreasePatternCommandPayload {
            points: vec![Point::new(0.0, 0.0), Point::new(10.0, 0.0)],
            ratio_s: Some(1.0),
            ratio_t: Some(3.0),
            line_color: Some(LineColor::Blue2),
            ..Default::default()
        },
    );

    execute_command(&mut document, command).expect("line ratio executes");
    assert_eq!(document.crease_pattern.line_segments.len(), 2);
    assert!(contains_segment_close(
        &document.crease_pattern.line_segments,
        Point::new(10.0, 0.0),
        Point::new(2.5, 0.0),
        LineColor::Blue2,
    ));
    assert!(contains_segment_close(
        &document.crease_pattern.line_segments,
        Point::new(0.0, 0.0),
        Point::new(2.5, 0.0),
        LineColor::Blue2,
    ));
}

#[test]
fn fishbone_draw_adds_alternating_perpendicular_ribs() {
    let mut model = model_from_segments(&[
        segment(-1.0, -2.0, 3.0, -2.0, LineColor::Black0),
        segment(-1.0, 2.0, 3.0, 2.0, LineColor::Black0),
    ]);
    let drag = segment(0.0, 0.0, 2.0, 0.0, LineColor::Black0);

    assert_eq!(
        fishbone_draw(&mut model, &drag, 1.0, LineColor::Red1, 0.5),
        6
    );
    // Each rib runs the full distance between the two bounding creases, connected
    // across the spine (Oriedita `extendToIntersectionPoint` keeps the anchor and
    // `del_V` fuses the two collinear halves) rather than starting one grid step
    // away from the spine.
    assert!(contains_segment_close(
        &model.line_segments,
        Point::new(2.0, -2.0),
        Point::new(2.0, 2.0),
        LineColor::Red1,
    ));
    assert!(contains_segment_close(
        &model.line_segments,
        Point::new(1.0, -2.0),
        Point::new(1.0, 2.0),
        LineColor::Blue2,
    ));
    assert!(contains_segment_close(
        &model.line_segments,
        Point::new(0.0, -2.0),
        Point::new(0.0, 2.0),
        LineColor::Red1,
    ));
}

#[test]
fn axiom7_indicator_extends_fold_line_and_clips_to_destination() {
    let target_segment = segment(4.0, -2.0, 4.0, 2.0, LineColor::Black0);
    let perpendicular_segment = segment(0.0, 0.0, 1.0, 0.0, LineColor::Black0);
    let top = segment(0.0, 3.0, 4.0, 3.0, LineColor::Black0);
    let bottom = segment(0.0, -3.0, 4.0, -3.0, LineColor::Black0);
    let mut model = model_from_segments(&[target_segment.clone(), top, bottom]);

    let indicator = axiom7_indicator(
        &model,
        Point::new(0.0, 0.0),
        &target_segment,
        &perpendicular_segment,
    )
    .expect("resolved Axiom 7 inputs should produce an indicator");
    assert_eq!(indicator.color, LineColor::Purple8);
    assert!(same_segment_close(
        &indicator,
        Point::new(2.0, -3.0),
        Point::new(2.0, 3.0),
        LineColor::Purple8,
    ));

    let destination = segment(0.0, 1.0, 4.0, 1.0, LineColor::Black0);
    assert!(axiom7_draw_to_destination(
        &mut model,
        &indicator,
        &destination,
        LineColor::Blue2,
    ));
    assert!(contains_segment_close(
        &model.line_segments,
        Point::new(2.0, 1.0),
        indicator.a,
        LineColor::Blue2,
    ));
}

#[test]
fn axiom5_tangent_indicators_commit_and_destination_draw() {
    let target = segment(2.0, -2.0, 2.0, 2.0, LineColor::Black0);
    let top = segment(-1.0, 2.0, 3.0, 2.0, LineColor::Black0);
    let bottom = segment(-1.0, -2.0, 3.0, -2.0, LineColor::Black0);
    let destination = segment(-1.0, 1.0, 3.0, 1.0, LineColor::Black0);
    let mut model = model_from_segments(&[target.clone(), top, bottom, destination.clone()]);

    let indicators = axiom5_indicators(&model, Point::new(0.0, 0.0), &target, Point::new(1.0, 0.0))
        .expect("tangent Axiom 5 setup should produce indicators");
    assert_eq!(indicators[0].color, LineColor::Purple8);
    assert!(
        same_segment_close(
            &indicators[0],
            Point::new(1.0, 0.0),
            Point::new(1.0, 2.0),
            LineColor::Purple8,
        ) || same_segment_close(
            &indicators[0],
            Point::new(1.0, 0.0),
            Point::new(1.0, -2.0),
            LineColor::Purple8,
        )
    );

    assert!(commit_axiom5_indicator(
        &mut model,
        &indicators[0],
        LineColor::Red1,
    ));
    assert!(
        model
            .line_segments
            .iter()
            .any(|segment| segment.color == LineColor::Red1)
    );

    assert!(axiom5_draw_to_destination(
        &mut model,
        Point::new(1.0, 0.0),
        &indicators[0],
        &indicators[1],
        &destination,
        Point::new(1.0, 1.1),
        LineColor::Blue2,
    ));
    assert!(contains_segment_close(
        &model.line_segments,
        Point::new(1.0, 0.0),
        Point::new(1.0, 1.0),
        LineColor::Blue2,
    ));
}

#[test]
fn make_vertex_flat_foldable_generates_odd_vertex_candidate_and_commits_to_destination() {
    let source = segment(0.0, 0.0, 1.0, 0.0, LineColor::Red1);
    let destination = segment(-1.0, -1.0, -1.0, 1.0, LineColor::Black0);
    let mut model = model_from_segments(&[source, destination.clone()]);

    let candidates =
        make_vertex_flat_foldable_candidates(&model, Point::new(0.0, 0.0), 1.0, LineColor::Blue2);
    assert_eq!(candidates.commit_color, LineColor::Red1);
    assert_eq!(candidates.candidates.len(), 1);
    assert!(same_segment_close(
        &candidates.candidates[0],
        Point::new(0.0, 0.0),
        Point::new(-1.0, 0.0),
        LineColor::Purple8,
    ));

    assert!(make_vertex_flat_foldable_to_destination(
        &mut model,
        Point::new(0.0, 0.0),
        &candidates.candidates[0],
        &destination,
        candidates.commit_color,
        None,
    ));
    assert!(contains_segment_close(
        &model.line_segments,
        Point::new(-1.0, 0.0),
        Point::new(0.0, 0.0),
        LineColor::Red1,
    ));
}

#[test]
fn make_vertex_flat_foldable_command_finds_its_own_destination() {
    // The same geometry as the three-click test below, with the third click
    // removed: the candidate ray already runs to the border at x=-1, so the
    // software answers the question that click used to ask.
    let mut document = CreasePatternDocument {
        crease_pattern: model_from_segments(&[
            segment(0.0, 0.0, 1.0, 0.0, LineColor::Red1),
            segment(-1.0, -1.0, -1.0, 1.0, LineColor::Black0),
        ]),
        ..Default::default()
    };
    let command = CreasePatternCommand::new(OperationId::VertexMakeAngularlyFlatFoldable)
        .with_payload(CreasePatternCommandPayload {
            points: vec![Point::new(0.0, 0.0), Point::new(-0.5, 0.0)],
            line_color: Some(LineColor::Blue2),
            selection_distance: Some(1.0),
            grid_width: Some(1.0),
            ..Default::default()
        });

    execute_command(&mut document, command).expect("2-point flat-foldable executes");
    assert!(
        contains_segment_close(
            &document.crease_pattern.line_segments,
            Point::new(-1.0, 0.0),
            Point::new(0.0, 0.0),
            LineColor::Red1,
        ),
        "expected the same crease the three-click flow commits; got {:?}",
        document.crease_pattern.line_segments,
    );
}

#[test]
fn make_vertex_flat_foldable_command_uses_separate_candidate_and_destination() {
    // Oriedita's 3 clicks: vertex (0,0), a point on the candidate ray (0,0)->(-1,0),
    // then a point on the destination crease at x=-1. The candidate (point[1]) and
    // destination (point[2]) are distinct locations — the old 2-point collapse could
    // not express this. Commits the Red crease (-1,0)-(0,0).
    let mut document = CreasePatternDocument {
        crease_pattern: model_from_segments(&[
            segment(0.0, 0.0, 1.0, 0.0, LineColor::Red1),
            segment(-1.0, -1.0, -1.0, 1.0, LineColor::Black0),
        ]),
        ..Default::default()
    };
    let command = CreasePatternCommand::new(OperationId::VertexMakeAngularlyFlatFoldable)
        .with_payload(CreasePatternCommandPayload {
            points: vec![
                Point::new(0.0, 0.0),
                Point::new(-0.5, 0.0),
                Point::new(-1.0, 0.5),
            ],
            line_color: Some(LineColor::Blue2),
            selection_distance: Some(1.0),
            grid_width: Some(1.0),
            ..Default::default()
        });

    execute_command(&mut document, command).expect("3-point flat-foldable executes");
    assert!(
        contains_segment_close(
            &document.crease_pattern.line_segments,
            Point::new(-1.0, 0.0),
            Point::new(0.0, 0.0),
            LineColor::Red1,
        ),
        "expected committed crease (-1,0)-(0,0); got {:?}",
        document.crease_pattern.line_segments,
    );
}

#[test]
fn foldable_line_input_candidates_and_commit_paths_match_expected_geometry() {
    let source = segment(0.0, 0.0, 1.0, 0.0, LineColor::Red1);
    let destination = segment(-1.0, -1.0, -1.0, 1.0, LineColor::Black0);
    let mut model = model_from_segments(&[source, destination.clone()]);

    let candidates = foldable_line_input_candidates(&model, Point::new(0.0, 0.0), 1.0);
    assert_eq!(candidates.len(), 1);
    assert!(same_segment_close(
        &candidates[0],
        Point::new(0.0, 0.0),
        Point::new(-1.0, 0.0),
        LineColor::Purple8,
    ));

    let fallback = foldable_line_input_fallback(Point::new(2.0, 2.0));
    assert_eq!(fallback.a, Point::new(2.0, 2.0));
    assert_eq!(fallback.b, Point::new(2.0, 2.0));

    assert!(foldable_line_input_direct(
        &mut model,
        &candidates[0],
        LineColor::Blue2,
    ));
    assert!(contains_segment_close(
        &model.line_segments,
        Point::new(0.0, 0.0),
        Point::new(-1.0, 0.0),
        LineColor::Blue2,
    ));

    assert!(foldable_line_input_to_destination(
        &mut model,
        &candidates[0],
        &destination,
        LineColor::Red1,
    ));
    assert!(contains_segment_close(
        &model.line_segments,
        Point::new(-1.0, 0.0),
        Point::new(0.0, 0.0),
        LineColor::Red1,
    ));
}

#[test]
fn foldable_line_draw_routes_by_incident_fold_line_parity() {
    let odd_model = model_from_segments(&[segment(0.0, 0.0, 1.0, 0.0, LineColor::Red1)]);
    assert_eq!(
        foldable_line_draw_operation_mode(&odd_model, Point::new(0.0, 0.0), 0.5),
        FoldableLineDrawOperationMode::VertexMakeAngularlyFlatFoldable,
    );

    let even_model = model_from_segments(&[
        segment(0.0, 0.0, 1.0, 0.0, LineColor::Red1),
        segment(0.0, 0.0, 0.0, 1.0, LineColor::Blue2),
    ]);
    assert_eq!(
        foldable_line_draw_operation_mode(&even_model, Point::new(0.0, 0.0), 0.5),
        FoldableLineDrawOperationMode::DrawCreaseFree,
    );
    assert!(foldable_line_draw_switches_to_free(
        Point::new(1.0, 0.0),
        Point::new(0.0, 0.0),
        0.5,
    ));
}

#[test]
fn angle_restricted_5_snaps_to_angle_system_and_nearby_line() {
    let mut model = model_from_segments(&[segment(2.0, -1.0, 2.0, 1.0, LineColor::Black0)]);

    assert!(draw_crease_angle_restricted_5(
        &mut model,
        Point::new(0.0, 0.0),
        Point::new(2.0, 0.2),
        4,
        [40.0, 60.0, 80.0, 30.0, 50.0, 100.0],
        SnapPolicy {
            selection_distance: 0.5,
            candidates: vertices_only(),
        },
        LineColor::Red1,
    ));
    assert!(contains_segment_close(
        &model.line_segments,
        Point::new(0.0, 0.0),
        Point::new(2.0, 0.0),
        LineColor::Red1,
    ));
}

#[test]
fn angle_system_candidates_and_destination_draw_match_expected_geometry() {
    let candidates = angle_system_candidates(
        Point::new(0.0, 0.0),
        Point::new(1.0, 0.0),
        4,
        [40.0, 60.0, 80.0, 30.0, 50.0, 100.0],
    );
    assert_eq!(candidates.len(), 8);
    assert_eq!(candidates[0].color, LineColor::Green6);
    assert_eq!(candidates[1].color, LineColor::Orange4);

    let destination = segment(0.0, 1.0, 2.0, 1.0, LineColor::Black0);
    let mut model = model_from_segments(std::slice::from_ref(&destination));
    assert!(angle_system_draw_to_destination(
        &mut model,
        Point::new(1.0, 0.0),
        &candidates[1],
        &destination,
        LineColor::Blue2,
    ));
    assert!(contains_segment_close(
        &model.line_segments,
        Point::new(2.0, 1.0),
        Point::new(1.0, 0.0),
        LineColor::Blue2,
    ));
}

#[test]
fn angle_restricted_3_candidates_and_draw_snap_to_nearby_line() {
    let candidates = draw_crease_angle_restricted_3_candidates(
        Point::new(1.0, 0.0),
        Point::new(0.0, 0.0),
        4,
        [40.0, 60.0, 80.0, 30.0, 50.0, 100.0],
    );
    assert_eq!(candidates.len(), 7);
    assert_eq!(candidates[0].color, LineColor::Orange4);
    assert_eq!(candidates[1].color, LineColor::Green6);

    let target_line = segment(0.0, 1.0, 3.0, 1.0, LineColor::Black0);
    let mut model = model_from_segments(std::slice::from_ref(&target_line));
    assert!(draw_crease_angle_restricted_3_to_point(
        &mut model,
        Point::new(1.2, 0.95),
        Point::new(0.0, 0.0),
        &candidates[0],
        0.5,
        LineColor::Blue2,
    ));
    assert!(contains_segment_close(
        &model.line_segments,
        Point::new(1.0, 1.0),
        Point::new(0.0, 0.0),
        LineColor::Blue2,
    ));
}

#[test]
fn angle_restricted_converging_candidates_and_draw_add_two_lines() {
    let base = segment(0.0, 0.0, 1.0, 0.0, LineColor::Purple8);
    let candidates =
        angle_restricted_converging_candidates(&base, 4, [40.0, 60.0, 80.0, 30.0, 50.0, 100.0]);
    assert_eq!(candidates.indicators.len(), 14);
    assert_eq!(candidates.indicators[0].color, LineColor::Orange4);
    assert!(
        candidates
            .intersections
            .iter()
            .any(|point| contains_point_close(*point, Point::new(0.5, 0.5)))
    );

    let mut model = CreasePatternModel::default();
    assert_eq!(
        draw_crease_angle_restricted_converging(
            &mut model,
            &base,
            Point::new(0.5, 0.5),
            LineColor::Red1,
        ),
        2
    );
    assert!(contains_segment_close(
        &model.line_segments,
        Point::new(0.0, 0.0),
        Point::new(0.5, 0.5),
        LineColor::Red1,
    ));
    assert!(contains_segment_close(
        &model.line_segments,
        Point::new(1.0, 0.0),
        Point::new(0.5, 0.5),
        LineColor::Red1,
    ));
}

fn segment(ax: f64, ay: f64, bx: f64, by: f64, color: LineColor) -> LineSegment {
    LineSegment::with_color(Point::new(ax, ay), Point::new(bx, by), color)
}

fn model_from_segments(segments: &[LineSegment]) -> CreasePatternModel {
    let mut model = CreasePatternModel::default();
    for segment in segments {
        model.add_line_segment(segment.clone());
    }
    model
}

fn contains_segment(segments: &[LineSegment], a: Point, b: Point, color: LineColor) -> bool {
    segments
        .iter()
        .any(|segment| segment.a == a && segment.b == b && segment.color == color)
}

fn contains_segment_close(segments: &[LineSegment], a: Point, b: Point, color: LineColor) -> bool {
    segments
        .iter()
        .any(|segment| same_segment_close(segment, a, b, color))
}

fn contains_point_close(actual: Point, expected: Point) -> bool {
    (actual.x - expected.x).abs() < 1e-12 && (actual.y - expected.y).abs() < 1e-12
}

fn same_segment_close(segment: &LineSegment, a: Point, b: Point, color: LineColor) -> bool {
    segment.color == color
        && ((contains_point_close(segment.a, a) && contains_point_close(segment.b, b))
            || (contains_point_close(segment.a, b) && contains_point_close(segment.b, a)))
}

// --- Angle Restricted Line endpoint snapping ------------------------------
//
// The endpoint is resolved kernel-side, after the cursor has been projected
// onto the angle system — which is why the frontend's own snapper cannot do it
// and why these live here. The scenario throughout is the reported one: the
// default 8-division grid (50-unit cells), a divider that includes 45 degrees,
// and an anchor on the lattice.

/// Upstream searches every vertex and whatever grid the document declares.
fn upstream_candidates() -> SnapCandidates {
    SnapCandidates {
        grid: GridState::WithinPaper,
        vertices: true,
    }
}

fn vertices_only() -> SnapCandidates {
    SnapCandidates {
        grid: GridState::Hidden,
        vertices: true,
    }
}

fn angle_restricted_payload(
    pointer: Point,
    candidates: Option<SnapCandidates>,
) -> CreasePatternCommandPayload {
    CreasePatternCommandPayload {
        points: vec![Point::new(0.0, 0.0), pointer],
        angle_system_divider: Some(8),
        selection_distance: Some(8.0),
        line_color: Some(LineColor::Red1),
        snap_candidates: candidates,
        ..CreasePatternCommandPayload::default()
    }
}

fn draw_angle_restricted(pointer: Point, candidates: Option<SnapCandidates>) -> Point {
    let mut document = CreasePatternDocument::default();
    let command = CreasePatternCommand {
        operation: OperationId::DrawCreaseAngleRestricted5,
        payload: angle_restricted_payload(pointer, candidates),
    };
    execute_command(&mut document, command).expect("command executes");
    let drawn = document
        .crease_pattern
        .line_segments
        .first()
        .expect("a crease was drawn");
    // The anchor is (0, 0); report whichever end is not it.
    if drawn.a == Point::new(0.0, 0.0) {
        drawn.b
    } else {
        drawn.a
    }
}

#[track_caller]
fn assert_close(found: Point, expected: Point) {
    assert!(
        (found.x - expected.x).abs() < 1e-9 && (found.y - expected.y).abs() < 1e-9,
        "expected {expected:?}, got {found:?}"
    );
}

/// The reported bug: released beside the lattice point (50, 50), which sits on
/// the 45-degree ray, the crease used to end at the bare projection (49.5,
/// 49.5).
#[test]
fn angle_restricted_5_endpoint_snaps_to_a_grid_point_on_the_ray() {
    assert_close(
        draw_angle_restricted(Point::new(52.0, 47.0), Some(upstream_candidates())),
        Point::new(50.0, 50.0),
    );
}

/// A grid point close to the release but *off* the ray must not pull the
/// endpoint off the angle system — upstream's collinearity gate
/// (`zure_flg`), which is the whole point of the tool.
#[test]
fn angle_restricted_5_ignores_a_grid_point_off_the_ray() {
    // Release at the foot of the lattice point (100, 50) on the 22.5-degree
    // ray: inside the 8-unit selection distance, so only the collinearity gate
    // can reject it.
    let ray = 22.5_f64.to_radians();
    let target = Point::new(100.0, 50.0);
    let reach = target.x * ray.cos() + target.y * ray.sin();
    let pointer = Point::new(reach * ray.cos(), reach * ray.sin());
    assert!(
        pointer.distance(target) < 8.0,
        "the case needs the grid point in range, not out of it"
    );

    assert_close(
        draw_angle_restricted(pointer, Some(upstream_candidates())),
        pointer,
    );
}

/// Beyond the selection distance the endpoint stays on the projection, however
/// exactly it lines up with the lattice.
#[test]
fn angle_restricted_5_ignores_a_grid_point_out_of_range() {
    // On the 45-degree ray but ~14 units short of (50, 50), with a selection
    // distance of 8.
    let pointer = Point::new(40.0, 40.0);
    assert_close(
        draw_angle_restricted(pointer, Some(upstream_candidates())),
        pointer,
    );
}

/// Snapping off: no grid, no vertices, the bare projection.
#[test]
fn angle_restricted_5_honours_a_caller_that_wants_no_snapping() {
    let candidates = SnapCandidates {
        grid: GridState::Hidden,
        vertices: false,
    };
    assert_close(
        draw_angle_restricted(Point::new(52.0, 47.0), Some(candidates)),
        Point::new(49.5, 49.5),
    );
}

/// Grid off, vertices on: the two candidate sets are independent.
#[test]
fn angle_restricted_5_can_drop_the_grid_and_keep_vertices() {
    assert_close(
        draw_angle_restricted(Point::new(52.0, 47.0), Some(vertices_only())),
        Point::new(49.5, 49.5),
    );

    let mut document = CreasePatternDocument::default();
    document.crease_pattern.add_line(
        Point::new(50.0, 50.0),
        Point::new(80.0, 90.0),
        LineColor::Black0,
    );
    let command = CreasePatternCommand {
        operation: OperationId::DrawCreaseAngleRestricted5,
        payload: angle_restricted_payload(Point::new(52.0, 47.0), Some(vertices_only())),
    };
    execute_command(&mut document, command).expect("command executes");
    assert!(contains_segment_close(
        &document.crease_pattern.line_segments,
        Point::new(0.0, 0.0),
        Point::new(50.0, 50.0),
        LineColor::Red1,
    ));
}

/// No `snap_candidates` in the payload means upstream: the document's own grid
/// state decides, so a headless caller and the oracle keep their behaviour.
#[test]
fn angle_restricted_5_defaults_to_the_documents_grid_state() {
    assert_close(
        draw_angle_restricted(Point::new(52.0, 47.0), None),
        Point::new(50.0, 50.0),
    );

    let mut document = CreasePatternDocument::default();
    document.crease_pattern.grid.base_state = GridState::Hidden;
    let command = CreasePatternCommand {
        operation: OperationId::DrawCreaseAngleRestricted5,
        payload: angle_restricted_payload(Point::new(52.0, 47.0), None),
    };
    execute_command(&mut document, command).expect("command executes");
    assert!(contains_segment_close(
        &document.crease_pattern.line_segments,
        Point::new(0.0, 0.0),
        Point::new(49.5, 49.5),
        LineColor::Red1,
    ));
}

/// The preview reports the endpoint as a point only when it actually landed on
/// one, which is what the canvas rings.
#[test]
fn angle_restricted_5_preview_reports_only_a_real_snap() {
    let document = CreasePatternDocument::default();

    let snapped = preview_command(
        &document,
        CreasePatternCommand {
            operation: OperationId::DrawCreaseAngleRestricted5,
            payload: angle_restricted_payload(Point::new(52.0, 47.0), Some(upstream_candidates())),
        },
    )
    .expect("preview runs");
    assert_eq!(snapped.points.len(), 1);
    assert_close(snapped.points[0], Point::new(50.0, 50.0));
    assert_close(snapped.segments[0].b, Point::new(50.0, 50.0));

    let free = preview_command(
        &document,
        CreasePatternCommand {
            operation: OperationId::DrawCreaseAngleRestricted5,
            payload: angle_restricted_payload(Point::new(40.0, 40.0), Some(upstream_candidates())),
        },
    )
    .expect("preview runs");
    assert!(free.points.is_empty());
    assert_close(free.segments[0].b, Point::new(40.0, 40.0));
}

/// Releasing on the anchor itself: the closest point is the anchor, so the
/// segment has no length and nothing is drawn — as upstream's length gate does.
#[test]
fn angle_restricted_5_draws_nothing_when_the_release_collapses_onto_the_anchor() {
    let mut document = CreasePatternDocument::default();
    let command = CreasePatternCommand {
        operation: OperationId::DrawCreaseAngleRestricted5,
        payload: angle_restricted_payload(Point::new(0.0, 0.0), Some(upstream_candidates())),
    };
    execute_command(&mut document, command).expect("command executes");
    assert!(document.crease_pattern.line_segments.is_empty());
}

/// The two parallel creases from `bisector_bug.osf`, at the coordinates that
/// produced the runaway endpoint. Their determinant is float noise (~-1.6e-9)
/// rather than a clean zero, which is exactly why the non-parallel arm's
/// `find_intersection` returned a finite point instead of failing.
fn parallel_sources_from_bug_report() -> (LineSegment, LineSegment) {
    (
        segment(
            408.578_643_762_690_66,
            549.999_999_999_999_1,
            308.578_643_762_672_9,
            650.0,
            LineColor::Black0,
        ),
        segment(
            250.0,
            650.0,
            343.933_982_822_021_1,
            556.066_017_177_978_7,
            LineColor::Black0,
        ),
    )
}

fn largest_coordinate(model: &CreasePatternModel) -> f64 {
    model
        .line_segments
        .iter()
        .flat_map(|s| [s.a, s.b])
        .map(|p| p.x.abs().max(p.y.abs()))
        .fold(0.0_f64, f64::max)
}

#[test]
fn square_bisector_command_parallel_lines_never_emit_runaway_coordinates() {
    // The reported bug: this committed a crease ending at ~3.4e14, far outside a
    // sheet spanning x 250..1100, y -200..650.
    let (first, second) = parallel_sources_from_bug_report();
    let destination = segment(
        408.578_643_762_690_66,
        549.999_999_999_999_1,
        350.0,
        550.0,
        LineColor::Black0,
    );
    let mut document = CreasePatternDocument {
        crease_pattern: model_from_segments(&[first, second, destination]),
        ..Default::default()
    };
    let before = largest_coordinate(&document.crease_pattern);
    let creases_before = document.crease_pattern.line_segments.len();

    // Two ids is upstream's "take the indicator whole", which is deliberately not
    // dispatched — that arm commits an unbounded ray. Three is the *non-parallel*
    // shape. Both stay refused, and neither may leak geometry on the way out.
    for line_ids in [vec![1, 2], vec![1, 2, 3]] {
        let command = CreasePatternCommand::new(OperationId::SquareBisector).with_payload(
            CreasePatternCommandPayload {
                line_ids: line_ids.clone(),
                line_color: Some(LineColor::Red1),
                ..Default::default()
            },
        );
        assert!(
            execute_command(&mut document, command).is_err(),
            "parallel sources with ids {line_ids:?} should be refused"
        );
        assert_eq!(largest_coordinate(&document.crease_pattern), before);
        assert_eq!(document.crease_pattern.line_segments.len(), creases_before);
    }
}

#[test]
fn square_bisector_preview_offers_the_indicator_only_when_parallel() {
    // The indicator is what the next two picks cut, so the surface has to be able
    // to draw it; its presence is also how the surface tells the two interactions
    // apart (one destination versus two).
    let (first, second) = parallel_sources_from_bug_report();
    let crossing = segment(300.0, 500.0, 400.0, 700.0, LineColor::Black0);
    let document = CreasePatternDocument {
        crease_pattern: model_from_segments(&[first, second, crossing]),
        ..Default::default()
    };
    let preview_for = |line_ids: Vec<usize>| {
        preview_command(
            &document,
            CreasePatternCommand::new(OperationId::SquareBisector).with_payload(
                CreasePatternCommandPayload {
                    line_ids,
                    ..Default::default()
                },
            ),
        )
        .expect("preview succeeds")
    };

    let parallel = preview_for(vec![1, 2]);
    assert_eq!(parallel.segments.len(), 1);
    assert_eq!(parallel.segments[0].color, LineColor::Purple8);

    // Non-parallel sources show nothing until a destination is hovered.
    assert!(preview_for(vec![1, 3]).segments.is_empty());
}

#[test]
fn square_bisector_command_parallel_lines_cut_between_two_destinations() {
    // The arm we do dispatch: two parallel sources plus two creases that cross the
    // midline between them, which become the new crease's endpoints. Bounded by
    // construction, which is why this one is safe where "take it whole" is not.
    let (first, second) = parallel_sources_from_bug_report();
    let left = segment(300.0, 500.0, 300.0, 700.0, LineColor::Black0);
    let right = segment(400.0, 500.0, 400.0, 700.0, LineColor::Black0);
    let mut document = CreasePatternDocument {
        crease_pattern: model_from_segments(&[first, second, left, right]),
        ..Default::default()
    };
    let before = document.crease_pattern.line_segments.len();

    let command = CreasePatternCommand::new(OperationId::SquareBisector).with_payload(
        CreasePatternCommandPayload {
            line_ids: vec![1, 2, 3, 4],
            line_color: Some(LineColor::Red1),
            ..Default::default()
        },
    );
    execute_command(&mut document, command).expect("parallel two-destination cut executes");

    assert!(document.crease_pattern.line_segments.len() > before);
    assert!(largest_coordinate(&document.crease_pattern) < 1_000.0);
}

#[test]
fn square_bisector_command_parallel_lines_reject_a_destination_along_the_bisector() {
    // A destination parallel to the sources never crosses the midline. Upstream
    // declines to offer it; we say so rather than dividing by its determinant.
    let (first, second) = parallel_sources_from_bug_report();
    // Same slope as the sources, so parallel to the midline too.
    let along = segment(250.0, 700.0, 350.0, 600.0, LineColor::Black0);
    let crossing = segment(300.0, 500.0, 300.0, 700.0, LineColor::Black0);
    let mut document = CreasePatternDocument {
        crease_pattern: model_from_segments(&[first, second, along, crossing]),
        ..Default::default()
    };
    let before = largest_coordinate(&document.crease_pattern);
    let creases_before = document.crease_pattern.line_segments.len();

    for line_ids in [vec![1, 2, 3, 4], vec![1, 2, 4, 3]] {
        let command = CreasePatternCommand::new(OperationId::SquareBisector).with_payload(
            CreasePatternCommandPayload {
                line_ids: line_ids.clone(),
                line_color: Some(LineColor::Red1),
                ..Default::default()
            },
        );
        assert!(
            execute_command(&mut document, command).is_err(),
            "a destination along the bisector should be refused, ids {line_ids:?}"
        );
        assert_eq!(largest_coordinate(&document.crease_pattern), before);
        assert_eq!(document.crease_pattern.line_segments.len(), creases_before);
    }
}

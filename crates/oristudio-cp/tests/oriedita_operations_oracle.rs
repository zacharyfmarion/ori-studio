use oristudio_cp::checks::{
    FixInaccurateOptions, FixInaccurateResult, FlatFoldabilityColor, FlatFoldabilityRule,
    FlatFoldabilityViolation, FlatFoldableBoundaryCheck, check_camv_task, check1, check2, check3,
    check4, fix_inaccurate_for_indices, flat_foldable_boundary_check,
};
use oristudio_cp::geometry::{Circle, Intersection, LineColor, LineSegment, Point, RgbColor};
use oristudio_cp::model::{CreasePatternModel, CustomLineType, TextElement};
use oristudio_cp::operations::arrangement::{
    branch_trim, del_v_all, del_v_all_color_change, del_v_at_point, del_v_at_point_color_change,
    del_v_pair, delete_intersecting_or_overlapping_lines_along,
    delete_line_segment_vertex_for_index, delete_line_segments_for_indices,
    delete_overlapping_lines_along, divide_intersections, divide_intersections_fast,
    divide_line_segment_with_new_lines, fix1, fix2, intersect_divide_pair,
};
use oristudio_cp::operations::circle::{
    CircleInversionOutput, change_custom_color_for_indices, concentric, concentric_select,
    concentric_two_circle_select, draw as draw_circle, free as draw_circle_free, invert_circle,
    invert_line_segment, organize, separate, tangent_lines_point_circle, tangent_lines_two_circles,
    through_three_points,
};
use oristudio_cp::operations::color::{
    advance_line_type, alternate_mountain_valley_along, alternate_mountain_valley_crossing,
    change_crease_type, delete_line_type_for_indices, make_aux, make_edge, make_mountain,
    make_valley, replace_line_type_for_indices, set_line_color_for_indices, toggle_mountain_valley,
};
use oristudio_cp::operations::construction::{
    AngleRestrictedConvergingCandidates, DrawCreaseTarget, FoldableLineDrawOperationMode,
    angle_restricted_converging_candidates, angle_system_candidates,
    angle_system_draw_to_destination, axiom5_draw_to_destination, axiom5_indicators,
    axiom7_draw_to_destination, axiom7_indicator, commit_axiom5_indicator, commit_axiom7_indicator,
    commit_parallel_width_indicator, commit_square_bisector_parallel_indicator,
    continuous_symmetric_draw, double_symmetric_draw, draw_crease_angle_restricted_3_candidates,
    draw_crease_angle_restricted_3_to_point, draw_crease_angle_restricted_5,
    draw_crease_angle_restricted_converging, draw_crease_segment, fishbone_draw,
    foldable_line_draw_operation_mode, foldable_line_draw_switches_to_free,
    foldable_line_input_candidates, foldable_line_input_direct, foldable_line_input_to_destination,
    inward, make_vertex_flat_foldable_candidates, make_vertex_flat_foldable_to_destination,
    mirror_selected_lines, parallel_draw, parallel_width_indicators, perpendicular_indicator,
    perpendicular_projection, square_bisector_from_lines_to_destination,
    square_bisector_from_points_to_destination, square_bisector_parallel_between_destinations,
    square_bisector_parallel_indicator, symmetric_draw,
};
use oristudio_cp::operations::generators::{
    DefaultMolecule, VoronoiApplyResult, VoronoiState, default_molecule,
    regular_polygon_no_corners, voronoi_apply, voronoi_press,
};
use oristudio_cp::operations::measure::{angle_between_three_points, length_between_points};
use oristudio_cp::operations::point::{
    divide_segment_by_count, divide_segment_by_ratio, draw_point_on_segment,
};
use oristudio_cp::operations::selection::{
    delete_selected_lines, select_all, select_box, select_connected_from_point, select_indices,
    select_intersecting_line, select_lasso, select_polygon, unselect_all, unselect_indices,
    unselect_intersecting_line, unselect_lasso, unselect_polygon,
};
use oristudio_cp::operations::text::{
    TextSelectionState, text_create_or_select_pressed, text_delete_at, text_delete_box,
    text_drag_selected,
};
use oristudio_cp::operations::transform::{
    LengthenColorMode, OperationFrame, OperationFrameDragState, copy_selected_lines,
    copy_selected_lines_by_points, extend_to_intersection_point_2, lengthen_crease,
    move_selected_lines, move_selected_lines_by_points, operation_frame_drag,
    operation_frame_press, operation_frame_release, translate_model,
};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::Command;

#[test]
fn intersect_divide_pair_matches_oriedita_operations_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    for (i, j, segments) in [
        (
            0,
            1,
            vec![
                segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
                segment(5.0, -5.0, 5.0, 5.0, LineColor::Blue2),
            ],
        ),
        (
            0,
            1,
            vec![
                segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
                segment(5.0, 0.0, 5.0, 5.0, LineColor::Blue2),
            ],
        ),
        (
            0,
            1,
            vec![
                segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
                segment(5.0, 0.0, 15.0, 0.0, LineColor::Blue2),
            ],
        ),
        (
            1,
            0,
            vec![
                segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
                segment(5.0, 0.0, 15.0, 0.0, LineColor::Blue2),
            ],
        ),
    ] {
        let mut model = model_from_segments(&segments);
        let added = intersect_divide_pair(&mut model, i, j);

        let mut args = vec![
            "intersect-divide-pair".to_string(),
            i.to_string(),
            j.to_string(),
            segments.len().to_string(),
        ];
        push_segment_args(&mut args, &segments);

        let rust_summary = format!("added|{added}\n{}", line_segment_set_summary(&model));
        assert_eq!(rust_summary, run_oracle(&oracle, &args));
    }
}

#[test]
fn divide_intersections_matches_oriedita_operations_oracle_for_crossing_fixture() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let segments = vec![
        segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
        segment(5.0, -5.0, 5.0, 5.0, LineColor::Blue2),
    ];
    let mut model = model_from_segments(&segments);
    divide_intersections(&mut model);

    let mut args = vec!["intersect-divide".to_string(), segments.len().to_string()];
    push_segment_args(&mut args, &segments);

    assert_eq!(line_segment_set_summary(&model), run_oracle(&oracle, &args));
}

#[test]
fn divide_intersections_fast_matches_oriedita_foldlineset_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    for (i, j, segments) in [
        (
            1,
            0,
            vec![
                segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
                segment(5.0, -5.0, 5.0, 5.0, LineColor::Blue2),
            ],
        ),
        (
            1,
            0,
            vec![
                segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
                segment(5.0, 0.0, 5.0, 5.0, LineColor::Cyan3),
            ],
        ),
        (
            1,
            0,
            vec![
                segment(0.0, 0.0, 10.0, 0.0, LineColor::Blue2),
                segment(5.0, 0.0, 15.0, 0.0, LineColor::Red1),
            ],
        ),
        (
            1,
            0,
            vec![
                segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
                segment(10.0, 0.0, 0.0, 0.0, LineColor::Blue2),
            ],
        ),
    ] {
        let mut model = model_from_segments(&segments);
        let mut to_delete = BTreeSet::new();
        let intersection = divide_intersections_fast(&mut model, i, j, &mut to_delete);

        let mut args = vec![
            "foldline-divide-fast".to_string(),
            i.to_string(),
            j.to_string(),
            segments.len().to_string(),
        ];
        push_segment_args(&mut args, &segments);

        let rust_summary = format!(
            "intersection|{}\n{}{}",
            intersection_state(intersection),
            delete_summary(&to_delete),
            line_segment_set_summary(&model)
        );
        assert_eq!(rust_summary, run_oracle(&oracle, &args));
    }
}

#[test]
fn divide_line_segment_with_new_lines_matches_oriedita_foldlineset_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    for (original_end, added_end, segments) in [
        (
            1,
            2,
            vec![
                segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
                segment(5.0, -5.0, 5.0, 5.0, LineColor::Blue2),
            ],
        ),
        (
            1,
            2,
            vec![
                segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
                segment(10.0, 0.0, 0.0, 0.0, LineColor::Blue2),
            ],
        ),
    ] {
        let mut model = model_from_segments(&segments);
        divide_line_segment_with_new_lines(&mut model, original_end, added_end);

        let mut args = vec![
            "foldline-divide-new-lines".to_string(),
            original_end.to_string(),
            added_end.to_string(),
            segments.len().to_string(),
        ];
        push_segment_args(&mut args, &segments);

        assert_eq!(line_segment_set_summary(&model), run_oracle(&oracle, &args));
    }
}

#[test]
fn delete_inside_line_matches_oriedita_foldlineset_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let selection = segment(2.0, 0.0, 8.0, 0.0, LineColor::Black0);
    let segments = vec![
        segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
        segment(5.0, -5.0, 5.0, 5.0, LineColor::Blue2),
        segment(0.0, 1.0, 10.0, 1.0, LineColor::Cyan3),
    ];

    for mode in ["l", "lX"] {
        let mut model = model_from_segments(&segments);
        let deleted = match mode {
            "l" => delete_overlapping_lines_along(&mut model, &selection),
            "lX" => delete_intersecting_or_overlapping_lines_along(&mut model, &selection),
            _ => unreachable!(),
        };

        let mut args = vec!["foldline-delete-inside".to_string(), mode.to_string()];
        push_one_segment_args(&mut args, &selection);
        args.push(segments.len().to_string());
        push_segment_args(&mut args, &segments);

        let rust_summary = format!("deleted|{deleted}\n{}", line_segment_set_summary(&model));
        assert_eq!(rust_summary, run_oracle(&oracle, &args));
    }
}

#[test]
fn line_delete_commands_match_oriedita_foldlineset_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let vertex_segments = vec![
        segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
        segment(10.0, 0.0, 20.0, 0.0, LineColor::Red1),
        segment(10.0, 0.0, 10.0, 5.0, LineColor::Blue2),
    ];
    let mut model = model_from_segments(&vertex_segments);
    let deleted = delete_line_segment_vertex_for_index(&mut model, 2);
    let mut args = vec![
        "foldline-delete-line-vertex".to_string(),
        "2".to_string(),
        vertex_segments.len().to_string(),
    ];
    push_segment_args(&mut args, &vertex_segments);
    let rust_summary = format!("deleted|{deleted}\n{}", line_segment_set_summary(&model));
    assert_eq!(rust_summary, run_oracle(&oracle, &args));

    let box_segments = vec![
        segment(0.0, 0.0, 1.0, 0.0, LineColor::Red1),
        segment(0.0, 1.0, 1.0, 1.0, LineColor::Blue2),
        segment(0.0, 2.0, 1.0, 2.0, LineColor::Black0),
    ];
    let mut model = model_from_segments(&box_segments);
    let deleted = delete_line_segments_for_indices(&mut model, &[0, 2]);
    let mut args = vec![
        "foldline-delete-lines".to_string(),
        "0,2".to_string(),
        box_segments.len().to_string(),
    ];
    push_segment_args(&mut args, &box_segments);
    let rust_summary = format!("deleted|{deleted}\n{}", line_segment_set_summary(&model));
    assert_eq!(rust_summary, run_oracle(&oracle, &args));
}

#[test]
fn del_v_at_point_matches_oriedita_foldlineset_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    for segments in [
        vec![
            segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
            segment(10.0, 0.0, 20.0, 0.0, LineColor::Red1),
        ],
        vec![
            segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
            segment(10.0, 0.0, 20.0, 0.0, LineColor::Blue2),
        ],
    ] {
        let mut model = model_from_segments(&segments);
        let result = del_v_at_point(&mut model, Point::new(10.0, 0.0), 0.000001, 0.000001);

        let mut args = vec![
            "foldline-del-v".to_string(),
            "10".to_string(),
            "0".to_string(),
            "0.000001".to_string(),
            "0.000001".to_string(),
            segments.len().to_string(),
        ];
        push_segment_args(&mut args, &segments);

        let rust_summary = format!("result|{result}\n{}", line_segment_set_summary(&model));
        assert_eq!(rust_summary, run_oracle(&oracle, &args));
    }
}

#[test]
fn del_v_at_point_color_change_matches_oriedita_foldlineset_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    for segments in [
        vec![
            segment(0.0, 0.0, 10.0, 0.0, LineColor::Black0),
            segment(10.0, 0.0, 20.0, 0.0, LineColor::Red1),
        ],
        vec![
            segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
            segment(10.0, 0.0, 20.0, 0.0, LineColor::Blue2),
        ],
        vec![
            segment(0.0, 0.0, 10.0, 0.0, LineColor::Cyan3),
            segment(10.0, 0.0, 20.0, 0.0, LineColor::Cyan3),
        ],
    ] {
        let mut model = model_from_segments(&segments);
        let result =
            del_v_at_point_color_change(&mut model, Point::new(10.0, 0.0), 0.000001, 0.000001);

        let mut args = vec![
            "foldline-del-v-cc".to_string(),
            "10".to_string(),
            "0".to_string(),
            "0.000001".to_string(),
            "0.000001".to_string(),
            segments.len().to_string(),
        ];
        push_segment_args(&mut args, &segments);

        let rust_summary = format!("result|{result}\n{}", line_segment_set_summary(&model));
        assert_eq!(rust_summary, run_oracle(&oracle, &args));
    }
}

#[test]
fn del_v_pair_and_all_variants_match_oriedita_foldlineset_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let mixed_segments = vec![
        segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
        segment(10.0, 0.0, 20.0, 0.0, LineColor::Blue2),
    ];
    let mut pair_model = model_from_segments(&mixed_segments);
    let pair_result = del_v_pair(&mut pair_model, &mixed_segments[0], &mixed_segments[1]);
    let mut pair_args = vec![
        "foldline-del-v-pair".to_string(),
        "0".to_string(),
        "1".to_string(),
        mixed_segments.len().to_string(),
    ];
    push_segment_args(&mut pair_args, &mixed_segments);
    let pair_summary = format!(
        "{}{}",
        optional_segment_result_summary(pair_result.as_ref()),
        line_segment_set_summary(&pair_model)
    );
    assert_eq!(pair_summary, run_oracle(&oracle, &pair_args));

    let same_color_segments = vec![
        segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
        segment(10.0, 0.0, 20.0, 0.0, LineColor::Red1),
    ];
    let mut all_model = model_from_segments(&same_color_segments);
    del_v_all(&mut all_model);
    let mut all_args = vec![
        "foldline-del-v-all".to_string(),
        same_color_segments.len().to_string(),
    ];
    push_segment_args(&mut all_args, &same_color_segments);
    assert_eq!(
        line_segment_set_summary(&all_model),
        run_oracle(&oracle, &all_args)
    );

    let mut all_cc_model = model_from_segments(&mixed_segments);
    del_v_all_color_change(&mut all_cc_model);
    let mut all_cc_args = vec![
        "foldline-del-v-all-cc".to_string(),
        mixed_segments.len().to_string(),
    ];
    push_segment_args(&mut all_cc_args, &mixed_segments);
    assert_eq!(
        line_segment_set_summary(&all_cc_model),
        run_oracle(&oracle, &all_cc_args)
    );
}

/// A chain longer than one pair, so the sweep has to fold each merged segment
/// into the next one as it reaches the following vertex. Two pairs collapse in
/// the middle of the walk and the survivors have to stay reachable through the
/// vertex groups; a sweep that only ever merged the original segments would
/// stop after the first pair.
///
/// Interleaves colours so both variants are exercised on the same chain: the
/// same-colour sweep may only take the red run, while the ignore-colour sweep
/// resolves red-against-blue to black on the way through.
#[test]
fn del_v_all_collinear_chain_matches_oriedita_foldlineset_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let chain = vec![
        segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
        segment(10.0, 0.0, 20.0, 0.0, LineColor::Red1),
        segment(20.0, 0.0, 30.0, 0.0, LineColor::Red1),
        segment(30.0, 0.0, 40.0, 0.0, LineColor::Blue2),
        segment(40.0, 0.0, 50.0, 0.0, LineColor::Blue2),
    ];

    let mut all_model = model_from_segments(&chain);
    del_v_all(&mut all_model);
    let mut all_args = vec!["foldline-del-v-all".to_string(), chain.len().to_string()];
    push_segment_args(&mut all_args, &chain);
    assert_eq!(
        line_segment_set_summary(&all_model),
        run_oracle(&oracle, &all_args)
    );

    let mut cc_model = model_from_segments(&chain);
    del_v_all_color_change(&mut cc_model);
    let mut cc_args = vec!["foldline-del-v-all-cc".to_string(), chain.len().to_string()];
    push_segment_args(&mut cc_args, &chain);
    assert_eq!(
        line_segment_set_summary(&cc_model),
        run_oracle(&oracle, &cc_args)
    );
}

/// Endpoints that are close but not equal, straddling `PointLineMap`'s 1e-4
/// vertex tolerance. The spatial hash buckets by eps-sized cells, so this is
/// where its cell-neighbourhood search has to agree with upstream's scan of
/// every vertex seen so far — including the pair that sits just outside the
/// tolerance and must stay two vertices.
#[test]
fn del_v_all_near_coincident_endpoints_match_oriedita_foldlineset_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    for gap in [1e-5, 5e-5, 9.9e-5, 1.01e-4, 1e-3] {
        let segments = vec![
            segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
            segment(10.0 + gap, 0.0, 20.0, 0.0, LineColor::Red1),
        ];

        let mut model = model_from_segments(&segments);
        del_v_all(&mut model);
        let mut args = vec!["foldline-del-v-all".to_string(), segments.len().to_string()];
        push_segment_args(&mut args, &segments);
        assert_eq!(
            line_segment_set_summary(&model),
            run_oracle(&oracle, &args),
            "gap {gap} disagreed with the Oriedita oracle"
        );
    }
}

#[test]
fn branch_trim_matches_oriedita_foldlineset_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let segments = vec![
        segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
        segment(10.0, 0.0, 20.0, 0.0, LineColor::Red1),
        segment(20.0, 0.0, 30.0, 0.0, LineColor::Red1),
    ];
    let mut model = model_from_segments(&segments);
    branch_trim(&mut model);

    let mut args = vec![
        "foldline-branch-trim".to_string(),
        segments.len().to_string(),
    ];
    push_segment_args(&mut args, &segments);

    assert_eq!(line_segment_set_summary(&model), run_oracle(&oracle, &args));
}

#[test]
fn check1_and_check2_match_oriedita_foldlineset_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let check1_segments = vec![
        segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
        segment(5.0, 0.0, 15.0, 0.0, LineColor::Blue2),
        segment(6.0, 0.0, 8.0, 0.0, LineColor::Cyan3),
    ];
    let check1_model = model_from_segments(&check1_segments);
    let mut check1_args = vec![
        "foldline-check1".to_string(),
        check1_segments.len().to_string(),
    ];
    push_segment_args(&mut check1_args, &check1_segments);
    assert_eq!(
        line_segment_list_summary(&check1(&check1_model)),
        run_oracle(&oracle, &check1_args)
    );

    let check2_segments = vec![
        segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
        segment(5.0, 0.0, 5.0, 5.0, LineColor::Blue2),
        segment(2.0, -1.0, 2.0, 1.0, LineColor::Black0),
    ];
    let check2_model = model_from_segments(&check2_segments);
    let mut check2_args = vec![
        "foldline-check2".to_string(),
        check2_segments.len().to_string(),
    ];
    push_segment_args(&mut check2_args, &check2_segments);
    assert_eq!(
        line_segment_list_summary(&check2(&check2_model)),
        run_oracle(&oracle, &check2_args)
    );
}

#[test]
fn check3_matches_oriedita_foldlineset_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    for segments in [
        vec![
            segment(0.0, 0.0, 10.0, 0.0, LineColor::Black0),
            segment(0.0, 0.0, 0.0, 10.0, LineColor::Red1),
        ],
        vec![
            segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
            segment(0.0, 0.0, -10.0, 0.0, LineColor::Red1),
            segment(0.0, 0.0, 0.0, 10.0, LineColor::Blue2),
            segment(0.0, 0.0, 0.0, -10.0, LineColor::Blue2),
        ],
        vec![
            segment(0.0, 0.0, 10.0, 0.0, LineColor::Black0),
            segment(0.0, 0.0, 0.0, 10.0, LineColor::Black0),
            segment(0.0, 0.0, 7.0, 7.0, LineColor::Red1),
        ],
    ] {
        let model = model_from_segments(&segments);
        let mut args = vec!["foldline-check3".to_string(), segments.len().to_string()];
        push_segment_args(&mut args, &segments);
        assert_eq!(
            line_segment_list_summary(&check3(&model)),
            run_oracle(&oracle, &args)
        );
    }
}

#[test]
fn check4_matches_oriedita_foldlineset_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    for segments in [
        vec![
            segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
            segment(0.0, 0.0, -10.0, 0.0, LineColor::Blue2),
        ],
        vec![
            segment(0.0, 0.0, 10.0, 0.0, LineColor::Black0),
            segment(0.0, 0.0, 0.0, 10.0, LineColor::Red1),
        ],
        vec![
            segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
            segment(0.0, 0.0, 8.660254037844386, 5.0, LineColor::Red1),
            segment(0.0, 0.0, 0.0, 10.0, LineColor::Blue2),
            segment(0.0, 0.0, -10.0, 0.0, LineColor::Blue2),
            segment(0.0, 0.0, -8.660254037844386, -5.0, LineColor::Red1),
            segment(0.0, 0.0, 0.0, -10.0, LineColor::Red1),
        ],
        vec![
            segment(0.0, 0.0, 10.0, 0.0, LineColor::Black0),
            segment(0.0, 0.0, 0.0, 10.0, LineColor::Black0),
            segment(0.0, 0.0, 7.0, 7.0, LineColor::Red1),
        ],
    ] {
        let model = model_from_segments(&segments);
        let mut args = vec!["foldline-check4".to_string(), segments.len().to_string()];
        push_segment_args(&mut args, &segments);
        assert_eq!(
            flat_foldability_violation_summary(&check4(&model)),
            run_oracle(&oracle, &args)
        );
    }
}

#[test]
fn check_camv_task_matches_oriedita_task_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let segments = vec![
        segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
        segment(0.0, 0.0, -10.0, 0.0, LineColor::Blue2),
    ];
    let model = model_from_segments(&segments);
    let result = check_camv_task(&model);
    let mut args = vec!["check-camv-task".to_string(), segments.len().to_string()];
    push_segment_args(&mut args, &segments);
    let rust_summary = format!(
        "dirty|{}\n{}",
        result.dirty,
        flat_foldability_violation_summary(&result.violations)
    );

    assert_eq!(rust_summary, run_oracle(&oracle, &args));
}

#[test]
fn fix_workers_match_oriedita_foldlineset_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    for segments in [
        vec![
            segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
            segment(10.0, 0.0, 0.0, 0.0, LineColor::Blue2),
        ],
        vec![
            segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
            segment(5.0, 0.0, 15.0, 0.0, LineColor::Blue2),
        ],
    ] {
        let mut model = model_from_segments(&segments);
        let result = fix1(&mut model);
        let mut args = vec!["foldline-fix1".to_string(), segments.len().to_string()];
        push_segment_args(&mut args, &segments);
        let rust_summary = format!(
            "result|{result}\n{}",
            line_segment_set_with_selection_summary(&model)
        );
        assert_eq!(rust_summary, run_oracle(&oracle, &args));
    }

    let fix2_segments = vec![
        segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
        segment(5.0, 0.0, 5.0, 5.0, LineColor::Blue2),
    ];
    let mut model = model_from_segments(&fix2_segments);
    fix2(&mut model);
    let mut args = vec!["foldline-fix2".to_string(), fix2_segments.len().to_string()];
    push_segment_args(&mut args, &fix2_segments);
    assert_eq!(
        line_segment_set_with_selection_summary(&model),
        run_oracle(&oracle, &args)
    );
}

#[test]
fn fix_inaccurate_matches_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    for (segments, options, indices) in [
        (
            vec![segment(0.1954, 0.0, 10.0, 0.0, LineColor::Red1)],
            FixInaccurateOptions {
                use_bp: true,
                use_22_5: false,
                fix_precision: 0.05,
            },
            vec![0usize],
        ),
        (
            vec![segment(117.1574, 0.0, 200.0, 0.0, LineColor::Blue2)],
            FixInaccurateOptions {
                use_bp: false,
                use_22_5: true,
                fix_precision: 0.05,
            },
            vec![0usize],
        ),
        (
            vec![segment(0.3, 0.0, 10.7, 0.0, LineColor::Cyan3)],
            FixInaccurateOptions::default(),
            vec![0usize],
        ),
    ] {
        let mut model = model_from_segments(&segments);
        let result = fix_inaccurate_for_indices(&mut model, &indices, options);
        let mut args = vec![
            "foldline-fix-inaccurate".to_string(),
            options.use_bp.to_string(),
            options.use_22_5.to_string(),
            options.fix_precision.to_string(),
            indices
                .iter()
                .map(|index| index.to_string())
                .collect::<Vec<_>>()
                .join(","),
            segments.len().to_string(),
        ];
        push_segment_args(&mut args, &segments);
        let rust_summary = format!(
            "{}{}",
            fix_inaccurate_result_summary(&result),
            line_segment_set_summary(&model)
        );
        assert_eq!(rust_summary, run_oracle(&oracle, &args));
    }
}

#[test]
fn color_operations_match_oriedita_foldlineset_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let aux_segments = vec![
        segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
        segment(5.0, -5.0, 5.0, 5.0, LineColor::Cyan3),
    ];
    let mut model = model_from_segments(&aux_segments);
    let changed = set_line_color_for_indices(&mut model, &[1], LineColor::Red1);
    let mut args = vec![
        "foldline-set-color".to_string(),
        LineColor::Red1.number().to_string(),
        "1".to_string(),
        aux_segments.len().to_string(),
    ];
    push_segment_args(&mut args, &aux_segments);
    let rust_summary = format!("changed|{changed}\n{}", line_segment_set_summary(&model));
    assert_eq!(rust_summary, run_oracle(&oracle, &args));

    let mv_segments = vec![
        segment(0.0, 0.0, 1.0, 0.0, LineColor::Red1),
        segment(0.0, 1.0, 1.0, 1.0, LineColor::Blue2),
        segment(0.0, 2.0, 1.0, 2.0, LineColor::Black0),
    ];
    let mut model = model_from_segments(&mv_segments);
    toggle_mountain_valley(&mut model, &[0, 1, 2]);
    let mut args = vec![
        "foldline-change-mv".to_string(),
        "0,1,2".to_string(),
        mv_segments.len().to_string(),
    ];
    push_segment_args(&mut args, &mv_segments);
    assert_eq!(line_segment_set_summary(&model), run_oracle(&oracle, &args));

    let change_type_segments = vec![
        segment(0.0, 0.0, 1.0, 0.0, LineColor::Black0),
        segment(0.0, 1.0, 1.0, 1.0, LineColor::Cyan3),
    ];
    let mut model = model_from_segments(&change_type_segments);
    let changed = change_crease_type(&mut model, 0);
    let mut args = vec![
        "foldline-change-type".to_string(),
        "0".to_string(),
        change_type_segments.len().to_string(),
    ];
    push_segment_args(&mut args, &change_type_segments);
    let rust_summary = format!("changed|{changed}\n{}", line_segment_set_summary(&model));
    assert_eq!(rust_summary, run_oracle(&oracle, &args));

    for (color, apply) in [
        (
            LineColor::Red1,
            make_mountain as fn(&mut CreasePatternModel, &[usize]) -> usize,
        ),
        (LineColor::Blue2, make_valley),
        (LineColor::Black0, make_edge),
    ] {
        let make_segments = vec![
            segment(0.0, 0.0, 10.0, 0.0, LineColor::Cyan3),
            segment(5.0, 0.0, 5.0, 5.0, LineColor::Black0),
        ];
        let mut model = model_from_segments(&make_segments);
        let changed = apply(&mut model, &[0, 1]);
        let mut args = vec![
            "foldline-make-color".to_string(),
            color.number().to_string(),
            "0,1".to_string(),
            make_segments.len().to_string(),
        ];
        push_segment_args(&mut args, &make_segments);
        let rust_summary = format!("changed|{changed}\n{}", line_segment_set_summary(&model));
        assert_eq!(rust_summary, run_oracle(&oracle, &args));
    }

    let make_aux_segments = vec![
        segment(0.0, 0.0, 1.0, 0.0, LineColor::Red1),
        segment(0.0, 1.0, 1.0, 1.0, LineColor::Blue2),
        segment(0.0, 2.0, 1.0, 2.0, LineColor::Cyan3),
    ];
    let mut model = model_from_segments(&make_aux_segments);
    let changed = make_aux(&mut model, &[0, 1, 2]);
    let mut args = vec![
        "foldline-make-aux".to_string(),
        "0,1,2".to_string(),
        make_aux_segments.len().to_string(),
    ];
    push_segment_args(&mut args, &make_aux_segments);
    let rust_summary = format!("changed|{changed}\n{}", line_segment_set_summary(&model));
    assert_eq!(rust_summary, run_oracle(&oracle, &args));

    let advance_segments = vec![
        segment(0.0, 0.0, 1.0, 0.0, LineColor::Black0),
        segment(0.0, 1.0, 1.0, 1.0, LineColor::Blue2),
    ];
    let mut model = model_from_segments(&advance_segments);
    let result = advance_line_type(&mut model, 0);
    let mut args = vec![
        "foldline-advance-type".to_string(),
        "0".to_string(),
        advance_segments.len().to_string(),
    ];
    push_segment_args(&mut args, &advance_segments);
    let rust_summary = format!(
        "result|{result}\n{}",
        line_segment_set_with_selection_summary(&model)
    );
    assert_eq!(rust_summary, run_oracle(&oracle, &args));

    let alternate_segments = vec![
        segment(10.0, 0.0, 20.0, 0.0, LineColor::Black0),
        segment(0.0, 0.0, 5.0, 0.0, LineColor::Black0),
    ];
    let guide = segment(0.0, 0.0, 20.0, 0.0, LineColor::Red1);
    let mut model = model_from_segments(&alternate_segments);
    let changed = alternate_mountain_valley_along(&mut model, &guide, LineColor::Red1);
    let mut args = vec![
        "foldline-alternate-mv".to_string(),
        LineColor::Red1.number().to_string(),
    ];
    push_one_segment_args(&mut args, &guide);
    args.push(alternate_segments.len().to_string());
    push_segment_args(&mut args, &alternate_segments);
    let rust_summary = format!("changed|{changed}\n{}", line_segment_set_summary(&model));
    assert_eq!(rust_summary, run_oracle(&oracle, &args));

    let crossing_segments = vec![
        segment(5.0, -1.0, 5.0, 1.0, LineColor::Black0),
        segment(15.0, -1.0, 15.0, 1.0, LineColor::Black0),
    ];
    let guide = segment(0.0, 0.0, 20.0, 0.0, LineColor::Blue2);
    let mut model = model_from_segments(&crossing_segments);
    let changed = alternate_mountain_valley_crossing(&mut model, &guide, LineColor::Red1);
    let mut args = vec![
        "foldline-alternate-mv-crossing".to_string(),
        LineColor::Red1.number().to_string(),
    ];
    push_one_segment_args(&mut args, &guide);
    args.push(crossing_segments.len().to_string());
    push_segment_args(&mut args, &crossing_segments);
    let rust_summary = format!("changed|{changed}\n{}", line_segment_set_summary(&model));
    assert_eq!(rust_summary, run_oracle(&oracle, &args));
}

#[test]
fn selected_type_commands_match_oriedita_foldlineset_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let duplicate_segments = vec![
        segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
        segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
        segment(0.0, 1.0, 10.0, 1.0, LineColor::Blue2),
    ];
    let mut model = model_from_segments(&duplicate_segments);
    let changed = replace_line_type_for_indices(
        &mut model,
        &[1],
        CustomLineType::Mountain,
        CustomLineType::Valley,
    );
    let mut args = vec![
        "foldline-replace-type".to_string(),
        CustomLineType::Mountain.number().to_string(),
        CustomLineType::Valley.number().to_string(),
        "1".to_string(),
        duplicate_segments.len().to_string(),
    ];
    push_segment_args(&mut args, &duplicate_segments);
    let rust_summary = format!(
        "changed|{changed}\n{}",
        line_segment_set_with_selection_summary(&model)
    );
    assert_eq!(rust_summary, run_oracle(&oracle, &args));

    let delete_segments = vec![
        segment(0.0, 0.0, 1.0, 0.0, LineColor::Red1),
        segment(0.0, 1.0, 1.0, 1.0, LineColor::Blue2),
        segment(0.0, 2.0, 1.0, 2.0, LineColor::Black0),
    ];
    let mut model = model_from_segments(&delete_segments);
    delete_line_type_for_indices(&mut model, &[0, 1, 2], CustomLineType::MountainAndValley);
    let mut args = vec![
        "foldline-delete-type".to_string(),
        CustomLineType::MountainAndValley.number().to_string(),
        "0,1,2".to_string(),
        delete_segments.len().to_string(),
    ];
    push_segment_args(&mut args, &delete_segments);
    assert_eq!(
        line_segment_set_with_selection_summary(&model),
        run_oracle(&oracle, &args)
    );

    let mut model = model_from_segments(&delete_segments);
    model.line_segments[0] = model.line_segments[0].with_selected(2);
    model.line_segments[2] = model.line_segments[2].with_selected(2);
    delete_selected_lines(&mut model);
    let mut args = vec![
        "foldline-delete-selected".to_string(),
        "0,2".to_string(),
        delete_segments.len().to_string(),
    ];
    push_segment_args(&mut args, &delete_segments);
    assert_eq!(
        line_segment_set_with_selection_summary(&model),
        run_oracle(&oracle, &args)
    );
}

#[test]
fn selection_primitives_match_oriedita_foldlineset_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let segments = vec![
        segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
        segment(5.0, -5.0, 5.0, 5.0, LineColor::Blue2),
        segment(0.0, 1.0, 10.0, 1.0, LineColor::Black0),
    ];

    let mut model = model_from_segments(&segments);
    select_all(&mut model);
    let mut args = vec![
        "foldline-select-all".to_string(),
        "select".to_string(),
        "-".to_string(),
        segments.len().to_string(),
    ];
    push_segment_args(&mut args, &segments);
    assert_eq!(
        line_segment_set_with_selection_summary(&model),
        run_oracle(&oracle, &args)
    );

    let mut model = model_from_segments(&segments);
    for index in 0..segments.len() {
        model.line_segments[index] = model.line_segments[index].with_selected(2);
    }
    unselect_all(&mut model);
    let mut args = vec![
        "foldline-select-all".to_string(),
        "unselect".to_string(),
        "0,1,2".to_string(),
        segments.len().to_string(),
    ];
    push_segment_args(&mut args, &segments);
    assert_eq!(
        line_segment_set_with_selection_summary(&model),
        run_oracle(&oracle, &args)
    );

    let mut model = model_from_segments(&segments);
    select_indices(&mut model, &[0, 2]);
    let mut args = vec![
        "foldline-select-indices".to_string(),
        "select".to_string(),
        "0,2".to_string(),
        "-".to_string(),
        segments.len().to_string(),
    ];
    push_segment_args(&mut args, &segments);
    assert_eq!(
        line_segment_set_with_selection_summary(&model),
        run_oracle(&oracle, &args)
    );

    let mut model = model_from_segments(&segments);
    model.line_segments[0] = model.line_segments[0].with_selected(2);
    model.line_segments[2] = model.line_segments[2].with_selected(2);
    unselect_indices(&mut model, &[2]);
    let mut args = vec![
        "foldline-select-indices".to_string(),
        "unselect".to_string(),
        "2".to_string(),
        "0,2".to_string(),
        segments.len().to_string(),
    ];
    push_segment_args(&mut args, &segments);
    assert_eq!(
        line_segment_set_with_selection_summary(&model),
        run_oracle(&oracle, &args)
    );
}

#[test]
fn polygon_and_intersection_selection_match_oriedita_foldlineset_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let polygon_segments = vec![
        segment(0.25, 0.25, 0.75, 0.75, LineColor::Red1),
        segment(-1.0, 0.0, 0.0, 0.0, LineColor::Blue2),
        segment(-1.0, 0.5, 2.0, 0.5, LineColor::Black0),
    ];
    let polygon = vec![
        Point::new(0.0, 0.0),
        Point::new(1.0, 0.0),
        Point::new(1.0, 1.0),
        Point::new(0.0, 1.0),
    ];

    let mut model = model_from_segments(&polygon_segments);
    select_polygon(
        &mut model,
        &oristudio_cp::geometry::Polygon::new(polygon.clone()),
    );
    let mut args = vec![
        "foldline-select-polygon".to_string(),
        "select".to_string(),
        "-".to_string(),
        polygon.len().to_string(),
    ];
    push_points_args(&mut args, &polygon);
    args.push(polygon_segments.len().to_string());
    push_segment_args(&mut args, &polygon_segments);
    assert_eq!(
        line_segment_set_with_selection_summary(&model),
        run_oracle(&oracle, &args)
    );

    model.line_segments[2] = model.line_segments[2].with_selected(2);
    unselect_polygon(
        &mut model,
        &oristudio_cp::geometry::Polygon::new(polygon.clone()),
    );
    let mut args = vec![
        "foldline-select-polygon".to_string(),
        "unselect".to_string(),
        "0,2".to_string(),
        polygon.len().to_string(),
    ];
    push_points_args(&mut args, &polygon);
    args.push(polygon_segments.len().to_string());
    push_segment_args(&mut args, &polygon_segments);
    assert_eq!(
        line_segment_set_with_selection_summary(&model),
        run_oracle(&oracle, &args)
    );

    let mut box_model = model_from_segments(&polygon_segments);
    select_box(
        &mut box_model,
        &oristudio_cp::geometry::Polygon::new(polygon.clone()),
    );
    let mut args = vec![
        "foldline-select-box".to_string(),
        "select".to_string(),
        "-".to_string(),
        polygon.len().to_string(),
    ];
    push_points_args(&mut args, &polygon);
    args.push(polygon_segments.len().to_string());
    push_segment_args(&mut args, &polygon_segments);
    assert_eq!(
        line_segment_set_with_selection_summary(&box_model),
        run_oracle(&oracle, &args)
    );

    let lasso_segments = vec![
        segment(0.25, 0.25, 0.75, 0.75, LineColor::Red1),
        segment(-0.5, 0.5, 0.5, 0.5, LineColor::Blue2),
        segment(2.0, 2.0, 3.0, 3.0, LineColor::Black0),
    ];
    let mut lasso_model = model_from_segments(&lasso_segments);
    select_lasso(
        &mut lasso_model,
        &oristudio_cp::geometry::Polygon::new(polygon.clone()),
    );
    let mut args = vec![
        "foldline-select-lasso".to_string(),
        "select".to_string(),
        "-".to_string(),
        polygon.len().to_string(),
    ];
    push_points_args(&mut args, &polygon);
    args.push(lasso_segments.len().to_string());
    push_segment_args(&mut args, &lasso_segments);
    assert_eq!(
        line_segment_set_with_selection_summary(&lasso_model),
        run_oracle(&oracle, &args)
    );

    unselect_lasso(
        &mut lasso_model,
        &oristudio_cp::geometry::Polygon::new(polygon.clone()),
    );
    let mut args = vec![
        "foldline-select-lasso".to_string(),
        "unselect".to_string(),
        "0,1".to_string(),
        polygon.len().to_string(),
    ];
    push_points_args(&mut args, &polygon);
    args.push(lasso_segments.len().to_string());
    push_segment_args(&mut args, &lasso_segments);
    assert_eq!(
        line_segment_set_with_selection_summary(&lasso_model),
        run_oracle(&oracle, &args)
    );

    let mut lx_model = model_from_segments(&polygon_segments);
    let selection = segment(-0.5, 0.5, 1.5, 0.5, LineColor::Magenta5);
    select_intersecting_line(&mut lx_model, &selection);
    let mut args = vec![
        "foldline-select-lx".to_string(),
        "select".to_string(),
        "-".to_string(),
    ];
    push_one_segment_args(&mut args, &selection);
    args.push(polygon_segments.len().to_string());
    push_segment_args(&mut args, &polygon_segments);
    assert_eq!(
        line_segment_set_with_selection_summary(&lx_model),
        run_oracle(&oracle, &args)
    );

    unselect_intersecting_line(&mut lx_model, &selection);
    let mut args = vec![
        "foldline-select-lx".to_string(),
        "unselect".to_string(),
        "0,2".to_string(),
    ];
    push_one_segment_args(&mut args, &selection);
    args.push(polygon_segments.len().to_string());
    push_segment_args(&mut args, &polygon_segments);
    assert_eq!(
        line_segment_set_with_selection_summary(&lx_model),
        run_oracle(&oracle, &args)
    );
}

#[test]
fn connected_selection_matches_oriedita_foldlineset_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let segments = vec![
        segment(0.0, 0.0, 1.0, 0.0, LineColor::Red1),
        segment(1.0, 0.0, 2.0, 0.0, LineColor::Blue2),
        segment(2.0, 0.0, 3.0, 0.0, LineColor::Black0),
        segment(10.0, 0.0, 11.0, 0.0, LineColor::Cyan3),
    ];
    let mut model = model_from_segments(&segments);
    select_connected_from_point(&mut model, Point::new(1.0, 0.0));

    let mut args = vec![
        "foldline-select-connected".to_string(),
        "1".to_string(),
        "0".to_string(),
        "-".to_string(),
        segments.len().to_string(),
    ];
    push_segment_args(&mut args, &segments);

    assert_eq!(
        line_segment_set_with_selection_summary(&model),
        run_oracle(&oracle, &args)
    );
}

#[test]
fn transform_commands_match_oriedita_foldlineset_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let translate_segments = vec![
        segment(0.0, 0.0, 1.0, 0.0, LineColor::Red1),
        segment(0.0, 2.0, 1.0, 2.0, LineColor::Blue2),
    ];
    let mut model = model_from_segments(&translate_segments);
    translate_model(&mut model, 5.0, -2.0);
    let mut args = vec![
        "foldline-translate".to_string(),
        "5".to_string(),
        "-2".to_string(),
        translate_segments.len().to_string(),
    ];
    push_segment_args(&mut args, &translate_segments);
    assert_eq!(
        line_segment_set_with_selection_summary(&model),
        run_oracle(&oracle, &args)
    );

    let selected_segments = vec![
        segment(1.0, -1.0, 1.0, 2.0, LineColor::Black0),
        segment(0.0, 0.0, 2.0, 0.0, LineColor::Red1),
    ];
    let mut model = model_from_segments(&selected_segments);
    model.line_segments[1] = model.line_segments[1].with_selected(2);
    move_selected_lines(&mut model, Point::new(0.0, 1.0));
    let mut args = vec![
        "foldline-transform-selected".to_string(),
        "move".to_string(),
        "0".to_string(),
        "1".to_string(),
        "1".to_string(),
        selected_segments.len().to_string(),
    ];
    push_segment_args(&mut args, &selected_segments);
    assert_eq!(
        line_segment_set_with_selection_summary(&model),
        run_oracle(&oracle, &args)
    );

    let mut model = model_from_segments(&selected_segments);
    model.line_segments[1] = model.line_segments[1].with_selected(2);
    copy_selected_lines(&mut model, Point::new(0.0, 1.0));
    let mut args = vec![
        "foldline-transform-selected".to_string(),
        "copy".to_string(),
        "0".to_string(),
        "1".to_string(),
        "1".to_string(),
        selected_segments.len().to_string(),
    ];
    push_segment_args(&mut args, &selected_segments);
    assert_eq!(
        line_segment_set_with_selection_summary(&model),
        run_oracle(&oracle, &args)
    );

    let four_point_segments = vec![segment(1.0, 0.0, 1.0, 1.0, LineColor::Red1)];
    let original_a = Point::new(0.0, 0.0);
    let original_b = Point::new(1.0, 0.0);
    let target_a = Point::new(2.0, 3.0);
    let target_b = Point::new(4.0, 3.0);

    let mut model = model_from_segments(&four_point_segments);
    model.line_segments[0] = model.line_segments[0].with_selected(2);
    move_selected_lines_by_points(&mut model, original_a, original_b, target_a, target_b);
    let mut args = vec![
        "foldline-transform-selected-4p".to_string(),
        "move".to_string(),
    ];
    push_points_args(&mut args, &[original_a, original_b, target_a, target_b]);
    args.push("0".to_string());
    args.push(four_point_segments.len().to_string());
    push_segment_args(&mut args, &four_point_segments);
    assert_eq!(
        line_segment_set_with_selection_summary(&model),
        run_oracle(&oracle, &args)
    );

    let mut model = model_from_segments(&four_point_segments);
    model.line_segments[0] = model.line_segments[0].with_selected(2);
    copy_selected_lines_by_points(&mut model, original_a, original_b, target_a, target_b);
    let mut args = vec![
        "foldline-transform-selected-4p".to_string(),
        "copy".to_string(),
    ];
    push_points_args(&mut args, &[original_a, original_b, target_a, target_b]);
    args.push("0".to_string());
    args.push(four_point_segments.len().to_string());
    push_segment_args(&mut args, &four_point_segments);
    assert_eq!(
        line_segment_set_with_selection_summary(&model),
        run_oracle(&oracle, &args)
    );
}

#[test]
fn operation_frame_sequence_matches_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let segments = vec![segment(2.0, 2.0, 3.0, 2.0, LineColor::Black0)];
    let circles = vec![Circle::new(9.0, 9.0, 1.0, LineColor::Cyan3)];
    let mut model = model_from_segments(&segments);
    for circle in &circles {
        model.add_circle(*circle);
    }
    let mut frame = OperationFrame::default();
    let mut state = operation_frame_press(&model, &mut frame, Point::new(2.1, 2.1), 0.5);
    operation_frame_drag(&model, &mut frame, &mut state, Point::new(5.0, 4.0), 0.5);
    operation_frame_release(&model, &mut frame, &state, Point::new(5.0, 4.0), 0.5);

    let mut args = operation_frame_args(
        0.5,
        &OperationFrame::default(),
        &segments,
        &circles,
        &[
            ("press", Point::new(2.1, 2.1)),
            ("drag", Point::new(5.0, 4.0)),
            ("release", Point::new(5.0, 4.0)),
        ],
    );
    assert_eq!(
        operation_frame_summary(&frame, &state),
        run_oracle(&oracle, &args)
    );

    let model = CreasePatternModel::default();
    let mut frame = operation_frame_fixture();
    let mut state = operation_frame_press(&model, &mut frame, Point::new(-0.1, 1.0), 0.5);
    operation_frame_drag(&model, &mut frame, &mut state, Point::new(0.5, 1.0), 0.5);
    operation_frame_release(&model, &mut frame, &state, Point::new(0.5, 1.0), 0.5);

    args = operation_frame_args(
        0.5,
        &operation_frame_fixture(),
        &[],
        &[],
        &[
            ("press", Point::new(-0.1, 1.0)),
            ("drag", Point::new(0.5, 1.0)),
            ("release", Point::new(0.5, 1.0)),
        ],
    );
    assert_eq!(
        operation_frame_summary(&frame, &state),
        run_oracle(&oracle, &args)
    );
}

#[test]
fn extend_to_intersection_matches_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    for (source, segments) in [
        (
            segment(0.0, 0.0, 1.0, 0.0, LineColor::Red1),
            vec![
                segment(5.0, -1.0, 5.0, 1.0, LineColor::Blue2),
                segment(10.0, -1.0, 10.0, 1.0, LineColor::Black0),
            ],
        ),
        (
            segment(0.0, 0.0, 1.0, 0.0, LineColor::Red1),
            vec![segment(5.0, 0.0, 7.0, 0.0, LineColor::Blue2)],
        ),
    ] {
        let model = model_from_segments(&segments);
        let result = extend_to_intersection_point_2(&model, &source);
        let mut args = vec!["foldline-extend-to-intersection".to_string()];
        push_one_segment_args(&mut args, &source);
        args.push(segments.len().to_string());
        push_segment_args(&mut args, &segments);
        assert_eq!(
            optional_segment_result_summary(Some(&result)),
            run_oracle(&oracle, &args)
        );
    }
}

#[test]
fn lengthen_crease_matches_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    for (mode_name, color_mode, extension_point) in [
        (
            "current",
            LengthenColorMode::Current(LineColor::Blue2),
            Point::new(2.0, 0.25),
        ),
        (
            "same",
            LengthenColorMode::SameAsOriginal,
            Point::new(0.25, 0.0),
        ),
    ] {
        let segments = vec![
            segment(0.0, 0.0, 1.0, 0.0, LineColor::Red1),
            segment(2.0, -1.0, 2.0, 1.0, LineColor::Black0),
        ];
        let selection_line = segment(0.5, -1.0, 0.5, 1.0, LineColor::Magenta5);
        let mut model = model_from_segments(&segments);
        let added = lengthen_crease(
            &mut model,
            selection_line.clone(),
            extension_point,
            1.0,
            color_mode,
        );

        let mut args = vec![
            "foldline-lengthen".to_string(),
            mode_name.to_string(),
            LineColor::Blue2.number().to_string(),
            "1.0".to_string(),
        ];
        push_one_segment_args(&mut args, &selection_line);
        push_points_args(&mut args, &[extension_point]);
        args.push(segments.len().to_string());
        push_segment_args(&mut args, &segments);
        let rust_summary = format!("added|{added}\n{}", line_segment_set_summary(&model));
        assert_eq!(rust_summary, run_oracle(&oracle, &args), "{mode_name}");
    }
}

#[test]
fn parallel_draw_modes_match_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let existing_segments = vec![segment(2.0, -1.0, 2.0, 1.0, LineColor::Black0)];
    let target = Point::new(0.0, 0.5);
    let parallel = segment(0.0, 0.0, 1.0, 0.0, LineColor::Red1);
    let destination = segment(2.0, -1.0, 2.0, 1.0, LineColor::Black0);
    let mut model = model_from_segments(&existing_segments);
    let added = parallel_draw(
        &mut model,
        target,
        &parallel,
        &destination,
        LineColor::Blue2,
    );
    let mut args = vec!["foldline-parallel-draw".to_string()];
    push_points_args(&mut args, &[target]);
    push_one_segment_args(&mut args, &parallel);
    push_one_segment_args(&mut args, &destination);
    args.push(LineColor::Blue2.number().to_string());
    args.push(existing_segments.len().to_string());
    push_segment_args(&mut args, &existing_segments);
    let rust_summary = format!("added|{added}\n{}", line_segment_set_summary(&model));
    assert_eq!(rust_summary, run_oracle(&oracle, &args));

    let selected = segment(0.0, 0.0, 2.0, 0.0, LineColor::Red1);
    let indicators = parallel_width_indicators(&selected, 1.0);
    let mut model = CreasePatternModel::default();
    let added = commit_parallel_width_indicator(&mut model, &indicators[0], LineColor::Blue2);
    let mut args = vec!["foldline-parallel-width".to_string()];
    push_one_segment_args(&mut args, &selected);
    args.push("1.0".to_string());
    args.push("0".to_string());
    args.push(LineColor::Blue2.number().to_string());
    args.push("0".to_string());
    let rust_summary = format!("added|{added}\n{}", line_segment_set_summary(&model));
    assert_eq!(rust_summary, run_oracle(&oracle, &args));
}

#[test]
fn perpendicular_draw_modes_match_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let base = segment(0.0, 0.0, 1.0, 0.0, LineColor::Black0);
    let target = Point::new(2.0, 1.0);
    let mut model = CreasePatternModel::default();
    let added = perpendicular_projection(&mut model, target, &base, LineColor::Red1);
    let mut args = vec!["foldline-perpendicular-projection".to_string()];
    push_points_args(&mut args, &[target]);
    push_one_segment_args(&mut args, &base);
    args.push(LineColor::Red1.number().to_string());
    args.push("0".to_string());
    let rust_summary = format!("added|{added}\n{}", line_segment_set_summary(&model));
    assert_eq!(rust_summary, run_oracle(&oracle, &args));

    let indicator_segments = vec![
        segment(-1.0, -2.0, 1.0, -2.0, LineColor::Black0),
        segment(-1.0, 2.0, 1.0, 2.0, LineColor::Black0),
    ];
    let base = segment(-1.0, 0.0, 1.0, 0.0, LineColor::Red1);
    let target = Point::new(0.0, 0.0);
    let model = model_from_segments(&indicator_segments);
    let indicator = perpendicular_indicator(&model, target, &base);
    let mut args = vec!["foldline-perpendicular-indicator".to_string()];
    push_points_args(&mut args, &[target]);
    push_one_segment_args(&mut args, &base);
    args.push(indicator_segments.len().to_string());
    push_segment_args(&mut args, &indicator_segments);
    assert_eq!(
        optional_segment_result_summary(indicator.as_ref()),
        run_oracle(&oracle, &args)
    );
}

#[test]
fn axiom5_modes_match_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let target_segment = segment(2.0, -2.0, 2.0, 2.0, LineColor::Black0);
    let destination = segment(-1.0, 1.0, 3.0, 1.0, LineColor::Black0);
    let segments = vec![
        target_segment.clone(),
        segment(-1.0, 2.0, 3.0, 2.0, LineColor::Black0),
        segment(-1.0, -2.0, 3.0, -2.0, LineColor::Black0),
        destination.clone(),
    ];
    let model = model_from_segments(&segments);
    let indicators = axiom5_indicators(
        &model,
        Point::new(0.0, 0.0),
        &target_segment,
        Point::new(1.0, 0.0),
    )
    .expect("tangent Axiom 5 fixture should produce indicators");
    let mut args = vec!["foldline-axiom5-indicator".to_string()];
    push_points_args(&mut args, &[Point::new(0.0, 0.0)]);
    push_one_segment_args(&mut args, &target_segment);
    push_points_args(&mut args, &[Point::new(1.0, 0.0)]);
    args.push(segments.len().to_string());
    push_segment_args(&mut args, &segments);
    assert_line_summary_close(
        &line_segment_list_summary(&indicators),
        &run_oracle(&oracle, &args),
        1e-9,
        "axiom5-indicator",
    );

    let mut model = model_from_segments(&segments);
    let added = commit_axiom5_indicator(&mut model, &indicators[0], LineColor::Red1);
    let mut args = vec!["foldline-axiom5-commit".to_string()];
    push_one_segment_args(&mut args, &indicators[0]);
    args.push(LineColor::Red1.number().to_string());
    args.push(segments.len().to_string());
    push_segment_args(&mut args, &segments);
    let rust_summary = format!("added|{added}\n{}", line_segment_set_summary(&model));
    assert_line_summary_close(
        &rust_summary,
        &run_oracle(&oracle, &args),
        1e-9,
        "axiom5-commit",
    );

    let mut model = model_from_segments(&segments);
    let added = axiom5_draw_to_destination(
        &mut model,
        Point::new(1.0, 0.0),
        &indicators[0],
        &indicators[1],
        &destination,
        Point::new(1.0, 1.1),
        LineColor::Blue2,
    );
    let mut args = vec!["foldline-axiom5-destination".to_string()];
    push_points_args(&mut args, &[Point::new(1.0, 0.0)]);
    push_one_segment_args(&mut args, &indicators[0]);
    push_one_segment_args(&mut args, &indicators[1]);
    push_one_segment_args(&mut args, &destination);
    push_points_args(&mut args, &[Point::new(1.0, 1.1)]);
    args.push(LineColor::Blue2.number().to_string());
    args.push(segments.len().to_string());
    push_segment_args(&mut args, &segments);
    let rust_summary = format!("added|{added}\n{}", line_segment_set_summary(&model));
    assert_line_summary_close(
        &rust_summary,
        &run_oracle(&oracle, &args),
        1e-9,
        "axiom5-destination",
    );
}

#[test]
fn make_vertex_flat_foldable_matches_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let vertex = Point::new(0.0, 0.0);
    let destination = segment(-1.0, -1.0, -1.0, 1.0, LineColor::Black0);
    let segments = vec![
        segment(0.0, 0.0, 1.0, 0.0, LineColor::Red1),
        destination.clone(),
    ];
    let candidates = make_vertex_flat_foldable_candidates(
        &model_from_segments(&segments),
        vertex,
        1.0,
        LineColor::Blue2,
    );
    let mut args = vec!["foldline-make-vertex-flat-foldable-candidates".to_string()];
    push_points_args(&mut args, &[vertex]);
    args.push("1.0".to_string());
    args.push(LineColor::Blue2.number().to_string());
    args.push(segments.len().to_string());
    push_segment_args(&mut args, &segments);
    let rust_summary = format!(
        "color|{}\n{}",
        candidates.commit_color.number(),
        line_segment_list_summary(&candidates.candidates)
    );
    assert_line_summary_close(
        &rust_summary,
        &run_oracle(&oracle, &args),
        1e-9,
        "make-vertex-flat-foldable-candidates",
    );

    let mut model = model_from_segments(&segments);
    let added = make_vertex_flat_foldable_to_destination(
        &mut model,
        vertex,
        &candidates.candidates[0],
        &destination,
        candidates.commit_color,
        // The flat path is Oriedita's: no fold angle, so the oracle still speaks
        // for it byte for byte.
        None,
    );
    let mut args = vec!["foldline-make-vertex-flat-foldable-destination".to_string()];
    push_points_args(&mut args, &[vertex]);
    push_one_segment_args(&mut args, &candidates.candidates[0]);
    push_one_segment_args(&mut args, &destination);
    args.push(candidates.commit_color.number().to_string());
    args.push(segments.len().to_string());
    push_segment_args(&mut args, &segments);
    let rust_summary = format!("added|{added}\n{}", line_segment_set_summary(&model));
    assert_line_summary_close(
        &rust_summary,
        &run_oracle(&oracle, &args),
        1e-9,
        "make-vertex-flat-foldable-destination",
    );
}

#[test]
fn foldable_line_input_matches_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let vertex = Point::new(0.0, 0.0);
    let destination = segment(-1.0, -1.0, -1.0, 1.0, LineColor::Black0);
    let segments = vec![
        segment(0.0, 0.0, 1.0, 0.0, LineColor::Red1),
        destination.clone(),
    ];
    let candidates = foldable_line_input_candidates(&model_from_segments(&segments), vertex, 1.0);
    let mut args = vec!["foldline-foldable-input-candidates".to_string()];
    push_points_args(&mut args, &[vertex]);
    args.push("1.0".to_string());
    args.push(segments.len().to_string());
    push_segment_args(&mut args, &segments);
    assert_line_summary_close(
        &line_segment_list_summary(&candidates),
        &run_oracle(&oracle, &args),
        1e-9,
        "foldable-input-candidates",
    );

    let mut model = model_from_segments(&segments);
    let added = foldable_line_input_direct(&mut model, &candidates[0], LineColor::Blue2);
    let mut args = vec!["foldline-foldable-input-direct".to_string()];
    push_one_segment_args(&mut args, &candidates[0]);
    args.push(LineColor::Blue2.number().to_string());
    args.push(segments.len().to_string());
    push_segment_args(&mut args, &segments);
    let rust_summary = format!("added|{added}\n{}", line_segment_set_summary(&model));
    assert_line_summary_close(
        &rust_summary,
        &run_oracle(&oracle, &args),
        1e-9,
        "foldable-input-direct",
    );

    let mut model = model_from_segments(&segments);
    let added = foldable_line_input_to_destination(
        &mut model,
        &candidates[0],
        &destination,
        LineColor::Red1,
    );
    let mut args = vec!["foldline-foldable-input-destination".to_string()];
    push_one_segment_args(&mut args, &candidates[0]);
    push_one_segment_args(&mut args, &destination);
    args.push(LineColor::Red1.number().to_string());
    args.push(segments.len().to_string());
    push_segment_args(&mut args, &segments);
    let rust_summary = format!("added|{added}\n{}", line_segment_set_summary(&model));
    assert_line_summary_close(
        &rust_summary,
        &run_oracle(&oracle, &args),
        1e-9,
        "foldable-input-destination",
    );
}

#[test]
fn foldable_line_draw_routing_matches_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let segments = vec![segment(0.0, 0.0, 1.0, 0.0, LineColor::Red1)];
    let mode = foldable_line_draw_operation_mode(
        &model_from_segments(&segments),
        Point::new(0.0, 0.0),
        0.5,
    );
    let mut args = vec![
        "foldline-foldable-draw-mode".to_string(),
        "0.0".to_string(),
        "0.0".to_string(),
        "0.5".to_string(),
        segments.len().to_string(),
    ];
    push_segment_args(&mut args, &segments);
    assert_eq!(
        format!("mode|{}\n", foldable_line_draw_mode_name(mode)),
        run_oracle(&oracle, &args)
    );

    let switched =
        foldable_line_draw_switches_to_free(Point::new(1.0, 0.0), Point::new(0.0, 0.0), 0.5);
    let args = vec![
        "foldline-foldable-draw-switch".to_string(),
        "1.0".to_string(),
        "0.0".to_string(),
        "0.0".to_string(),
        "0.0".to_string(),
        "0.5".to_string(),
    ];
    assert_eq!(format!("switch|{switched}\n"), run_oracle(&oracle, &args));
}

#[test]
fn axiom7_modes_match_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let target_segment = segment(4.0, -2.0, 4.0, 2.0, LineColor::Black0);
    let perpendicular_segment = segment(0.0, 0.0, 1.0, 0.0, LineColor::Black0);
    let top = segment(0.0, 3.0, 4.0, 3.0, LineColor::Black0);
    let bottom = segment(0.0, -3.0, 4.0, -3.0, LineColor::Black0);
    let segments = vec![target_segment.clone(), top, bottom];
    let model = model_from_segments(&segments);
    let indicator = axiom7_indicator(
        &model,
        Point::new(0.0, 0.0),
        &target_segment,
        &perpendicular_segment,
    );

    let mut args = vec![
        "foldline-axiom7-indicator".to_string(),
        "0.0".to_string(),
        "0.0".to_string(),
    ];
    push_one_segment_args(&mut args, &target_segment);
    push_one_segment_args(&mut args, &perpendicular_segment);
    args.push(segments.len().to_string());
    push_segment_args(&mut args, &segments);
    assert_eq!(
        optional_segment_result_summary(indicator.as_ref()),
        run_oracle(&oracle, &args)
    );
    let indicator = indicator.expect("oracle-tested fixture should produce an indicator");

    let mut model = model_from_segments(&segments);
    let added = commit_axiom7_indicator(&mut model, &indicator, LineColor::Red1);
    let mut args = vec!["foldline-axiom7-commit".to_string()];
    push_one_segment_args(&mut args, &indicator);
    args.push(LineColor::Red1.number().to_string());
    args.push(segments.len().to_string());
    push_segment_args(&mut args, &segments);
    let rust_summary = format!("added|{added}\n{}", line_segment_set_summary(&model));
    assert_eq!(rust_summary, run_oracle(&oracle, &args));

    let destination = segment(0.0, 1.0, 4.0, 1.0, LineColor::Black0);
    let mut model = model_from_segments(&segments);
    let added = axiom7_draw_to_destination(&mut model, &indicator, &destination, LineColor::Blue2);
    let mut args = vec!["foldline-axiom7-destination".to_string()];
    push_one_segment_args(&mut args, &indicator);
    push_one_segment_args(&mut args, &destination);
    args.push(LineColor::Blue2.number().to_string());
    args.push(segments.len().to_string());
    push_segment_args(&mut args, &segments);
    let rust_summary = format!("added|{added}\n{}", line_segment_set_summary(&model));
    assert_eq!(rust_summary, run_oracle(&oracle, &args));
}

#[test]
fn symmetric_draw_matches_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let existing_segments = vec![segment(0.0, 2.0, 2.0, 2.0, LineColor::Black0)];
    let source = segment(0.0, 0.0, 1.0, 0.0, LineColor::Red1);
    let mirror = segment(0.0, 0.0, 1.0, 1.0, LineColor::Blue2);
    let mut model = model_from_segments(&existing_segments);
    let added = symmetric_draw(&mut model, &source, &mirror, LineColor::Red1);

    let mut args = vec!["foldline-symmetric-draw".to_string()];
    push_one_segment_args(&mut args, &source);
    push_one_segment_args(&mut args, &mirror);
    args.push(LineColor::Red1.number().to_string());
    args.push(existing_segments.len().to_string());
    push_segment_args(&mut args, &existing_segments);
    let rust_summary = format!("added|{added}\n{}", line_segment_set_summary(&model));
    assert_eq!(rust_summary, run_oracle(&oracle, &args));
}

#[test]
fn double_symmetric_draw_matches_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let segments = vec![
        segment(0.0, 1.0, 2.0, 1.0, LineColor::Red1),
        segment(-3.0, 0.0, -3.0, 2.0, LineColor::Black0),
    ];
    let drag_axis = segment(0.0, 0.0, 0.0, 2.0, LineColor::Black0);
    let mut model = model_from_segments(&segments);
    let added = double_symmetric_draw(&mut model, &drag_axis);

    let mut args = vec!["foldline-double-symmetric-draw".to_string()];
    push_one_segment_args(&mut args, &drag_axis);
    args.push(segments.len().to_string());
    push_segment_args(&mut args, &segments);
    let rust_summary = format!("added|{added}\n{}", line_segment_set_summary(&model));
    assert_eq!(rust_summary, run_oracle(&oracle, &args));
}

#[test]
fn continuous_symmetric_draw_matches_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let segments = vec![
        segment(2.0, -1.0, 2.0, 1.0, LineColor::Blue2),
        segment(4.0, -1.0, 4.0, 1.0, LineColor::Black0),
    ];
    let mut model = model_from_segments(&segments);
    let added = continuous_symmetric_draw(
        &mut model,
        Point::new(0.0, 0.0),
        Point::new(1.0, 0.0),
        LineColor::Red1,
    );

    let mut args = vec![
        "foldline-continuous-symmetric-draw".to_string(),
        "0.0".to_string(),
        "0.0".to_string(),
        "1.0".to_string(),
        "0.0".to_string(),
        LineColor::Red1.number().to_string(),
        segments.len().to_string(),
    ];
    push_segment_args(&mut args, &segments);
    let rust_summary = format!("added|{added}\n{}", line_segment_set_summary(&model));
    assert_line_summary_close(
        &rust_summary,
        &run_oracle(&oracle, &args),
        1e-9,
        "continuous-symmetric-draw",
    );
}

#[test]
fn inward_matches_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let segments = vec![segment(1.0, -1.0, 1.0, 4.0, LineColor::Black0)];
    let mut model = model_from_segments(&segments);
    let added = inward(
        &mut model,
        Point::new(0.0, 0.0),
        Point::new(4.0, 0.0),
        Point::new(0.0, 3.0),
        LineColor::Blue2,
    );

    let mut args = vec![
        "foldline-inward".to_string(),
        "0.0".to_string(),
        "0.0".to_string(),
        "4.0".to_string(),
        "0.0".to_string(),
        "0.0".to_string(),
        "3.0".to_string(),
        LineColor::Blue2.number().to_string(),
        segments.len().to_string(),
    ];
    push_segment_args(&mut args, &segments);
    let rust_summary = format!("added|{added}\n{}", line_segment_set_summary(&model));
    assert_eq!(rust_summary, run_oracle(&oracle, &args));
}

#[test]
fn square_bisector_modes_match_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let destination = segment(2.0, -1.0, 2.0, 3.0, LineColor::Black0);
    let segments = vec![destination.clone()];
    let mut model = model_from_segments(&segments);
    let added = square_bisector_from_points_to_destination(
        &mut model,
        Point::new(0.0, 0.0),
        Point::new(4.0, 0.0),
        Point::new(0.0, 3.0),
        &destination,
        LineColor::Red1,
    );
    let mut args = vec![
        "foldline-square-bisector-3p".to_string(),
        "0.0".to_string(),
        "0.0".to_string(),
        "4.0".to_string(),
        "0.0".to_string(),
        "0.0".to_string(),
        "3.0".to_string(),
    ];
    push_one_segment_args(&mut args, &destination);
    args.push(LineColor::Red1.number().to_string());
    args.push(segments.len().to_string());
    push_segment_args(&mut args, &segments);
    let rust_summary = format!("added|{added}\n{}", line_segment_set_summary(&model));
    assert_line_summary_close(
        &rust_summary,
        &run_oracle(&oracle, &args),
        1e-12,
        "square-bisector-3p",
    );

    let first = segment(0.0, 0.0, 4.0, 0.0, LineColor::Black0);
    let second = segment(0.0, 0.0, 0.0, 4.0, LineColor::Black0);
    let segments = vec![first.clone(), second.clone(), destination.clone()];
    let mut model = model_from_segments(&segments);
    let added = square_bisector_from_lines_to_destination(
        &mut model,
        &first,
        &second,
        &destination,
        LineColor::Blue2,
    );
    let mut args = vec!["foldline-square-bisector-2l-np".to_string()];
    push_one_segment_args(&mut args, &first);
    push_one_segment_args(&mut args, &second);
    push_one_segment_args(&mut args, &destination);
    args.push(LineColor::Blue2.number().to_string());
    args.push(segments.len().to_string());
    push_segment_args(&mut args, &segments);
    let rust_summary = format!("added|{added}\n{}", line_segment_set_summary(&model));
    assert_line_summary_close(
        &rust_summary,
        &run_oracle(&oracle, &args),
        1e-12,
        "square-bisector-2l-np",
    );

    let parallel_first = segment(-2.0, 0.0, 2.0, 0.0, LineColor::Black0);
    let parallel_second = segment(-2.0, 2.0, 2.0, 2.0, LineColor::Black0);
    let left = segment(-3.0, -1.0, -3.0, 3.0, LineColor::Black0);
    let right = segment(3.0, -1.0, 3.0, 3.0, LineColor::Black0);
    let segments = vec![parallel_first.clone(), parallel_second.clone(), left, right];
    let model = model_from_segments(&segments);
    let indicator = square_bisector_parallel_indicator(&model, &parallel_first, &parallel_second);
    let mut args = vec!["foldline-square-bisector-parallel-indicator".to_string()];
    push_one_segment_args(&mut args, &parallel_first);
    push_one_segment_args(&mut args, &parallel_second);
    args.push(segments.len().to_string());
    push_segment_args(&mut args, &segments);
    assert_eq!(
        optional_segment_result_summary(indicator.as_ref()),
        run_oracle(&oracle, &args)
    );
    let indicator = indicator.expect("oracle-tested fixture should produce an indicator");

    let mut model = model_from_segments(&segments);
    let added = commit_square_bisector_parallel_indicator(&mut model, &indicator, LineColor::Red1);
    let mut args = vec!["foldline-square-bisector-parallel-commit".to_string()];
    push_one_segment_args(&mut args, &indicator);
    args.push(LineColor::Red1.number().to_string());
    args.push(segments.len().to_string());
    push_segment_args(&mut args, &segments);
    let rust_summary = format!("added|{added}\n{}", line_segment_set_summary(&model));
    assert_eq!(rust_summary, run_oracle(&oracle, &args));

    let first_destination = segment(-1.0, -1.0, -1.0, 3.0, LineColor::Black0);
    let second_destination = segment(1.0, -1.0, 1.0, 3.0, LineColor::Black0);
    let mut model = model_from_segments(&segments);
    let added = square_bisector_parallel_between_destinations(
        &mut model,
        &indicator,
        &first_destination,
        &second_destination,
        LineColor::Blue2,
    );
    let mut args = vec!["foldline-square-bisector-parallel-between".to_string()];
    push_one_segment_args(&mut args, &indicator);
    push_one_segment_args(&mut args, &first_destination);
    push_one_segment_args(&mut args, &second_destination);
    args.push(LineColor::Blue2.number().to_string());
    args.push(segments.len().to_string());
    push_segment_args(&mut args, &segments);
    let rust_summary = format!("added|{added}\n{}", line_segment_set_summary(&model));
    assert_eq!(rust_summary, run_oracle(&oracle, &args));
}

#[test]
fn fishbone_draw_matches_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let segments = vec![
        segment(-1.0, -2.0, 3.0, -2.0, LineColor::Black0),
        segment(-1.0, 2.0, 3.0, 2.0, LineColor::Black0),
    ];
    let drag = segment(0.0, 0.0, 2.0, 0.0, LineColor::Black0);
    let mut model = model_from_segments(&segments);
    let added = fishbone_draw(&mut model, &drag, 1.0, LineColor::Red1, 0.5);

    let mut args = vec!["foldline-fishbone".to_string()];
    push_one_segment_args(&mut args, &drag);
    args.push("1.0".to_string());
    args.push(LineColor::Red1.number().to_string());
    args.push("0.5".to_string());
    args.push(segments.len().to_string());
    push_segment_args(&mut args, &segments);
    let rust_summary = format!("added|{added}\n{}", line_segment_set_summary(&model));
    assert_line_summary_close(
        &rust_summary,
        &run_oracle(&oracle, &args),
        1e-12,
        "fishbone",
    );
}

#[test]
fn point_line_division_matches_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let count_segment = segment(0.0, 0.0, 2.0, 0.0, LineColor::Red1);
    let count_segments = vec![segment(1.0, -1.0, 1.0, 1.0, LineColor::Black0)];
    let mut count_model = model_from_segments(&count_segments);
    divide_segment_by_count(&mut count_model, &count_segment, 2);

    let mut count_args = vec!["foldline-divide-count".to_string(), "2".to_string()];
    push_one_segment_args(&mut count_args, &count_segment);
    count_args.push(count_segments.len().to_string());
    push_segment_args(&mut count_args, &count_segments);
    assert_eq!(
        line_segment_set_summary(&count_model),
        run_oracle(&oracle, &count_args)
    );

    let ratio_segment = segment(0.0, 0.0, 10.0, 0.0, LineColor::Blue2);
    let mut ratio_model = CreasePatternModel::default();
    divide_segment_by_ratio(&mut ratio_model, &ratio_segment, 1.0, 3.0);

    let mut ratio_args = vec![
        "foldline-divide-ratio".to_string(),
        "1.0".to_string(),
        "3.0".to_string(),
    ];
    push_one_segment_args(&mut ratio_args, &ratio_segment);
    ratio_args.push("0".to_string());
    assert_eq!(
        line_segment_set_summary(&ratio_model),
        run_oracle(&oracle, &ratio_args)
    );

    let zero_ratio_segment = segment(-1.0, 2.0, 3.0, 2.0, LineColor::Cyan3);
    let mut zero_ratio_model = CreasePatternModel::default();
    divide_segment_by_ratio(&mut zero_ratio_model, &zero_ratio_segment, 0.0, 4.0);

    let mut zero_ratio_args = vec![
        "foldline-divide-ratio".to_string(),
        "0.0".to_string(),
        "4.0".to_string(),
    ];
    push_one_segment_args(&mut zero_ratio_args, &zero_ratio_segment);
    zero_ratio_args.push("0".to_string());
    assert_eq!(
        line_segment_set_summary(&zero_ratio_model),
        run_oracle(&oracle, &zero_ratio_args)
    );
}

#[test]
fn draw_point_matches_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let segments = vec![segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1)];
    for (target, selection_distance) in [(Point::new(4.0, 0.2), 1.0), (Point::new(4.0, 2.0), 1.0)] {
        let mut model = model_from_segments(&segments);
        let changed = draw_point_on_segment(&mut model, 0, target, selection_distance);
        let mut args = vec![
            "foldline-draw-point".to_string(),
            "0".to_string(),
            target.x.to_string(),
            target.y.to_string(),
            selection_distance.to_string(),
            segments.len().to_string(),
        ];
        push_segment_args(&mut args, &segments);
        let rust_summary = format!("changed|{changed}\n{}", line_segment_set_summary(&model));
        assert_eq!(rust_summary, run_oracle(&oracle, &args));
    }
}

#[test]
fn basic_circle_draw_modes_match_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let center = Point::new(1.0, 2.0);
    let radius_point = Point::new(4.0, 6.0);
    let mut model = CreasePatternModel::default();
    let changed = draw_circle(&mut model, center, radius_point);
    let mut args = vec!["foldline-circle-draw".to_string()];
    push_points_args(&mut args, &[center, radius_point]);
    let rust_summary = format!("changed|{changed}\n{}", circle_set_summary(&model));
    assert_eq!(rust_summary, run_oracle(&oracle, &args));

    let mut zero_model = CreasePatternModel::default();
    let zero_changed = draw_circle(&mut zero_model, center, center);
    let mut zero_args = vec!["foldline-circle-draw".to_string()];
    push_points_args(&mut zero_args, &[center, center]);
    let rust_summary = format!(
        "changed|{zero_changed}\n{}",
        circle_set_summary(&zero_model)
    );
    assert_eq!(rust_summary, run_oracle(&oracle, &zero_args));

    let mut free_model = CreasePatternModel::default();
    let free_changed = draw_circle_free(&mut free_model, center, center);
    let mut free_args = vec!["foldline-circle-draw-free".to_string()];
    push_points_args(&mut free_args, &[center, center]);
    let rust_summary = format!(
        "changed|{free_changed}\n{}",
        circle_set_summary(&free_model)
    );
    assert_eq!(rust_summary, run_oracle(&oracle, &free_args));
}

#[test]
fn circle_three_point_matches_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    for points in [
        [
            Point::new(1.0, 0.0),
            Point::new(0.0, 1.0),
            Point::new(-1.0, 0.0),
        ],
        [
            Point::new(0.0, 0.0),
            Point::new(1.0, 0.0),
            Point::new(2.0, 0.0),
        ],
    ] {
        let mut model = CreasePatternModel::default();
        let changed = through_three_points(&mut model, points[0], points[1], points[2]);
        let mut args = vec!["foldline-circle-three-point".to_string()];
        push_points_args(&mut args, &points);
        let rust_summary = format!("changed|{changed}\n{}", circle_set_summary(&model));
        assert_eq!(rust_summary, run_oracle(&oracle, &args));
    }
}

#[test]
fn circle_separate_and_concentric_modes_match_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let center = Point::new(10.0, 10.0);
    let radius_a = Point::new(1.0, 1.0);
    let radius_b = Point::new(4.0, 5.0);
    let mut model = CreasePatternModel::default();
    let changed = separate(&mut model, center, radius_a, radius_b);
    let mut args = vec!["foldline-circle-separate".to_string()];
    push_points_args(&mut args, &[center, radius_a, radius_b]);
    let rust_summary = format!("changed|{changed}\n{}", circle_set_summary(&model));
    assert_eq!(rust_summary, run_oracle(&oracle, &args));

    let original = Circle::new(2.0, 3.0, 7.0, LineColor::Magenta5);
    let mut model = CreasePatternModel::default();
    let changed = concentric(&mut model, original, radius_a, radius_b);
    let mut args = vec!["foldline-circle-concentric".to_string()];
    push_circle_args(&mut args, original);
    push_points_args(&mut args, &[radius_a, radius_b]);
    let rust_summary = format!("changed|{changed}\n{}", circle_set_summary(&model));
    assert_eq!(rust_summary, run_oracle(&oracle, &args));
}

#[test]
fn circle_concentric_selection_modes_match_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let target = Circle::new(0.0, 0.0, 5.0, LineColor::Cyan3);
    let reference1 = Circle::new(10.0, 0.0, 2.0, LineColor::Cyan3);
    let reference2 = Circle::new(12.0, 0.0, 4.0, LineColor::Cyan3);
    for candidate_index in [0, 1, 2] {
        let mut model = CreasePatternModel::default();
        let changed =
            concentric_select(&mut model, target, reference1, reference2, candidate_index);
        let mut args = vec![
            "foldline-circle-concentric-select".to_string(),
            candidate_index.to_string(),
        ];
        push_circle_args(&mut args, target);
        push_circle_args(&mut args, reference1);
        push_circle_args(&mut args, reference2);
        let rust_summary = format!("changed|{changed}\n{}", circle_set_summary(&model));
        assert_eq!(rust_summary, run_oracle(&oracle, &args));
    }

    for (circle2, expected_added) in [
        (Circle::new(5.0, 0.0, 1.0, LineColor::Cyan3), 2),
        (Circle::new(2.0, 0.0, 1.0, LineColor::Cyan3), 0),
    ] {
        let circle1 = Circle::new(0.0, 0.0, 1.0, LineColor::Cyan3);
        let mut model = CreasePatternModel::default();
        let added = concentric_two_circle_select(&mut model, circle1, circle2);
        assert_eq!(added, expected_added);
        let mut args = vec!["foldline-circle-concentric-two".to_string()];
        push_circle_args(&mut args, circle1);
        push_circle_args(&mut args, circle2);
        let rust_summary = format!("added|{added}\n{}", circle_set_summary(&model));
        assert_eq!(rust_summary, run_oracle(&oracle, &args));
    }
}

#[test]
fn circle_inversion_modes_match_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let inversion = Circle::new(0.0, 0.0, 1.0, LineColor::Cyan3);
    for subject in [
        Circle::new(2.0, 0.0, 0.5, LineColor::Magenta5),
        Circle::new(1.0, 0.0, 1.0, LineColor::Magenta5),
    ] {
        let mut model = CreasePatternModel::default();
        let output = invert_circle(&mut model, subject, inversion);
        let mut args = vec!["foldline-circle-invert-circle".to_string()];
        push_circle_args(&mut args, subject);
        push_circle_args(&mut args, inversion);
        let rust_summary = format!(
            "outcome|{}\n{}{}",
            circle_inversion_output(output),
            line_segment_set_summary(&model),
            circle_set_summary(&model)
        );
        assert_eq!(rust_summary, run_oracle(&oracle, &args));
    }

    for subject in [
        segment(2.0, -1.0, 2.0, 1.0, LineColor::Black0),
        segment(-1.0, 0.0, 1.0, 0.0, LineColor::Black0),
    ] {
        let mut model = CreasePatternModel::default();
        let output = invert_line_segment(&mut model, &subject, inversion);
        let mut args = vec!["foldline-circle-invert-line".to_string()];
        push_one_segment_args(&mut args, &subject);
        push_circle_args(&mut args, inversion);
        let rust_summary = format!(
            "outcome|{}\n{}{}",
            circle_inversion_output(output),
            line_segment_set_summary(&model),
            circle_set_summary(&model)
        );
        assert_eq!(rust_summary, run_oracle(&oracle, &args));
    }
}

#[test]
fn organize_circles_matches_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let circles = vec![
        Circle::new(0.0, 0.0, 2.0, LineColor::Cyan3),
        Circle::new(2.0, 0.0, 0.0, LineColor::Cyan3),
        Circle::new(9.0, 9.0, 0.0, LineColor::Cyan3),
    ];
    let segments = vec![segment(2.0, -1.0, 2.0, 1.0, LineColor::Black0)];
    let mut model = CreasePatternModel::default();
    for circle in &circles {
        model.add_circle(*circle);
    }
    for segment in &segments {
        model.add_line_segment(segment.clone());
    }
    let deleted = organize(&mut model);

    let mut args = vec![
        "foldline-circle-organize".to_string(),
        circles.len().to_string(),
    ];
    for circle in &circles {
        push_circle_args(&mut args, *circle);
    }
    args.push(segments.len().to_string());
    push_segment_args(&mut args, &segments);
    let rust_summary = format!("deleted|{deleted}\n{}", circle_set_summary(&model));
    assert_eq!(rust_summary, run_oracle(&oracle, &args));
}

#[test]
fn circle_change_color_matches_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let circles = vec![
        Circle::new(0.0, 0.0, 1.0, LineColor::Cyan3),
        Circle::new(3.0, 0.0, 1.0, LineColor::Cyan3),
    ];
    let duplicate = segment(0.0, 0.0, 1.0, 0.0, LineColor::Cyan3);
    let segments = vec![
        duplicate.clone(),
        duplicate,
        segment(0.0, 1.0, 1.0, 1.0, LineColor::Red1),
    ];
    let color = RgbColor::new(10, 20, 30);

    let mut model = model_from_segments(&segments);
    for circle in &circles {
        model.add_circle(*circle);
    }
    let changed = change_custom_color_for_indices(&mut model, &[1], &[1, 2], color);

    let mut args = vec![
        "foldline-circle-change-color".to_string(),
        "1".to_string(),
        "1,2".to_string(),
        color.red.to_string(),
        color.green.to_string(),
        color.blue.to_string(),
        circles.len().to_string(),
    ];
    for circle in &circles {
        push_circle_args(&mut args, *circle);
    }
    args.push(segments.len().to_string());
    push_segment_args(&mut args, &segments);
    let rust_summary = format!(
        "changed|{changed}\n{}{}",
        circle_set_summary(&model),
        line_segment_customization_summary(&model)
    );
    assert_eq!(rust_summary, run_oracle(&oracle, &args));
}

#[test]
fn circle_tangent_candidates_match_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let model = CreasePatternModel::default();
    let point = Point::new(5.0, 0.0);
    let circle = Circle::new(0.0, 0.0, 1.0, LineColor::Cyan3);
    let candidates = tangent_lines_point_circle(&model, point, circle);
    let mut args = vec!["foldline-circle-tangent-point".to_string()];
    push_points_args(&mut args, &[point]);
    push_circle_args(&mut args, circle);
    args.push("0".to_string());
    assert_eq!(
        line_segment_list_summary(&candidates),
        run_oracle(&oracle, &args)
    );

    let circle1 = Circle::new(0.0, 0.0, 1.0, LineColor::Cyan3);
    let circle2 = Circle::new(5.0, 0.0, 1.0, LineColor::Cyan3);
    let candidates = tangent_lines_two_circles(circle1, circle2);
    let mut args = vec!["foldline-circle-tangent-two".to_string()];
    push_circle_args(&mut args, circle1);
    push_circle_args(&mut args, circle2);
    assert_eq!(
        line_segment_list_summary(&candidates),
        run_oracle(&oracle, &args)
    );
}

#[test]
fn regular_polygon_no_corners_matches_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let existing_segments = vec![segment(0.5, -1.0, 0.5, 1.0, LineColor::Black0)];
    let p1 = Point::new(0.0, 0.0);
    let p2 = Point::new(1.0, 0.0);
    let mut model = model_from_segments(&existing_segments);
    let added = regular_polygon_no_corners(&mut model, p1, p2, 4, LineColor::Red1);

    let mut args = vec![
        "foldline-regular-polygon".to_string(),
        "4".to_string(),
        LineColor::Red1.number().to_string(),
    ];
    push_points_args(&mut args, &[p1, p2]);
    args.push(existing_segments.len().to_string());
    push_segment_args(&mut args, &existing_segments);
    let rust_summary = format!("added|{added}\n{}", line_segment_set_summary(&model));
    assert_eq!(rust_summary, run_oracle(&oracle, &args));
}

#[test]
fn voronoi_create_matches_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let snap_segments = vec![segment(2.0, 0.0, 3.0, 0.0, LineColor::Black0)];
    let snap_points = vec![
        Point::new(0.0, 0.0),
        Point::new(2.1, 0.0),
        Point::new(0.0, 2.0),
        Point::new(2.05, 0.0),
    ];
    let model = model_from_segments(&snap_segments);
    let mut state = VoronoiState::default();
    for point in &snap_points {
        voronoi_press(&model, &mut state, *point, 0.25);
    }
    let args = voronoi_args(
        0.25,
        LineColor::Red1,
        false,
        &snap_segments,
        &[],
        &snap_points,
    );
    assert_line_summary_close(
        &voronoi_state_summary(&state),
        &run_oracle(&oracle, &args),
        1e-9,
        "voronoi-state",
    );

    let seed_points = vec![
        Point::new(0.0, 0.0),
        Point::new(2.0, 0.0),
        Point::new(0.0, 2.0),
    ];
    let mut model = CreasePatternModel::default();
    let mut state = VoronoiState::default();
    for point in &seed_points {
        voronoi_press(&model, &mut state, *point, 0.25);
    }
    let result = voronoi_apply(&mut model, &mut state, LineColor::Blue2);
    let args = voronoi_args(0.25, LineColor::Blue2, true, &[], &[], &seed_points);
    let rust_summary = format!(
        "{}{}{}",
        voronoi_apply_result_summary(result),
        line_segment_set_summary(&model),
        circle_set_summary(&model)
    );
    assert_line_summary_close(
        &rust_summary,
        &run_oracle(&oracle, &args),
        1e-9,
        "voronoi-apply",
    );
}

#[test]
fn flat_foldable_boundary_check_matches_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    for (context, mut boundary, segments) in [
        (
            "zero-crossings",
            vec![segment(-1.0, 0.0, 1.0, 0.0, LineColor::Yellow7)],
            vec![],
        ),
        (
            "odd-crossings",
            vec![segment(-1.0, 0.0, 1.0, 0.0, LineColor::Yellow7)],
            vec![segment(0.0, -1.0, 0.0, 1.0, LineColor::Red1)],
        ),
        (
            "invalid-overlap",
            vec![segment(-1.0, 0.0, 1.0, 0.0, LineColor::Yellow7)],
            vec![segment(-1.0, 0.0, 1.0, 0.0, LineColor::Red1)],
        ),
    ] {
        let model = model_from_segments(&segments);
        let result = flat_foldable_boundary_check(&model, &mut boundary);
        let mut args = vec![
            "flat-foldable-boundary-check".to_string(),
            boundary.len().to_string(),
        ];
        push_segment_args(
            &mut args,
            &boundary_with_color(&boundary, LineColor::Yellow7),
        );
        args.push(segments.len().to_string());
        push_segment_args(&mut args, &segments);

        let rust_summary = format!(
            "{}{}",
            flat_foldable_result_summary(result),
            line_segment_list_summary(&boundary)
        );
        assert_line_summary_close(&rust_summary, &run_oracle(&oracle, &args), 1e-9, context);
    }
}

#[test]
fn text_operations_match_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let mut model = CreasePatternModel::default();
    let mut state = TextSelectionState::default();
    text_create_or_select_pressed(&mut model, &mut state, Point::new(10.0, 10.0));
    text_drag_selected(&mut model, &mut state, Point::new(15.0, 12.0));
    let args = text_sequence_args(
        TextSelectionState::default(),
        &[],
        &[
            TextEvent::Press(Point::new(10.0, 10.0)),
            TextEvent::Drag(Point::new(15.0, 12.0)),
        ],
    );
    assert_eq!(text_summary(&model, &state), run_oracle(&oracle, &args));

    let mut model = CreasePatternModel::default();
    model.add_text(TextElement::new(10.0, 10.0, "a"));
    model.add_text(TextElement::new(50.0, 50.0, "b"));
    let mut state = TextSelectionState {
        selected: Some(0),
        is_selected: true,
        dirty: true,
        selection_start: None,
    };
    text_delete_at(&mut model, &mut state, Point::new(11.0, 10.0));
    let args = text_sequence_args(
        TextSelectionState {
            selected: Some(0),
            is_selected: true,
            dirty: true,
            selection_start: None,
        },
        &[
            TextElement::new(10.0, 10.0, "a"),
            TextElement::new(50.0, 50.0, "b"),
        ],
        &[TextEvent::Delete(Point::new(11.0, 10.0))],
    );
    assert_eq!(text_summary(&model, &state), run_oracle(&oracle, &args));

    let mut model = CreasePatternModel::default();
    model.add_text(TextElement::new(10.0, 10.0, "a"));
    model.add_text(TextElement::new(60.0, 60.0, "b"));
    let mut state = TextSelectionState {
        selected: Some(1),
        is_selected: true,
        dirty: false,
        selection_start: None,
    };
    text_delete_box(
        &mut model,
        &mut state,
        Point::new(0.0, 0.0),
        Point::new(40.0, 40.0),
    );
    let args = text_sequence_args(
        TextSelectionState {
            selected: Some(1),
            is_selected: true,
            dirty: false,
            selection_start: None,
        },
        &[
            TextElement::new(10.0, 10.0, "a"),
            TextElement::new(60.0, 60.0, "b"),
        ],
        &[TextEvent::Box(Point::new(0.0, 0.0), Point::new(40.0, 40.0))],
    );
    assert_eq!(text_summary(&model, &state), run_oracle(&oracle, &args));
}

#[test]
fn default_molecule_generators_match_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    for (molecule, resource, p1, p2) in [
        (
            DefaultMolecule::Blintz,
            "blintz.fold",
            Point::new(-199.99999999999997, -200.0),
            Point::new(200.0, 200.0),
        ),
        (
            DefaultMolecule::FishBase,
            "fish_base.fold",
            Point::new(-199.99999999999997, -200.0),
            Point::new(-186.73241451857626, -167.96921519080254),
        ),
        (
            DefaultMolecule::DoveBase,
            "dove_base.fold",
            Point::new(-199.99999999999997, -200.0),
            Point::new(-169.0726658116157, -169.07266581161576),
        ),
        (
            DefaultMolecule::BirdBase,
            "bird_base.fold",
            Point::new(-199.99999999999997, -200.0),
            Point::new(-185.21831060958067, -164.31384499886317),
        ),
        (
            DefaultMolecule::FrogBase,
            "frog_base.fold",
            Point::new(-199.99999999999997, -200.0),
            Point::new(-185.53375636724545, -165.07539842521055),
        ),
    ] {
        let mut model = CreasePatternModel::default();
        let added = default_molecule(&mut model, molecule, p1, p2, LineColor::Blue2)
            .expect("bundled default molecule should import");
        let resource_path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources/default-molecules")
            .join(resource);

        let mut args = vec![
            "foldline-default-molecule".to_string(),
            resource_path.to_string_lossy().into_owned(),
            LineColor::Blue2.number().to_string(),
        ];
        push_points_args(&mut args, &[p1, p2]);
        args.push("0".to_string());

        let rust_summary = format!("added|{added}\n{}", line_segment_set_summary(&model));
        let oracle_summary = run_oracle(&oracle, &args);
        assert_line_summary_close(&rust_summary, &oracle_summary, 1e-9, resource);
    }
}

#[test]
fn draw_crease_segment_matches_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let existing_segments = vec![segment(1.0, -1.0, 1.0, 1.0, LineColor::Black0)];
    let fold_segment = segment(0.0, 0.0, 2.0, 0.0, LineColor::Red1);
    let mut model = model_from_segments(&existing_segments);
    let changed = draw_crease_segment(&mut model, &fold_segment, DrawCreaseTarget::FoldLine);
    let mut args = vec!["foldline-draw-crease".to_string(), "fold".to_string()];
    push_one_segment_args(&mut args, &fold_segment);
    args.push(existing_segments.len().to_string());
    push_segment_args(&mut args, &existing_segments);
    let rust_summary = format!(
        "changed|{changed}\n{}{}",
        line_segment_set_summary(&model),
        aux_line_segment_set_summary(&model)
    );
    assert_eq!(rust_summary, run_oracle(&oracle, &args));

    let aux_segment = segment(0.0, 0.0, 2.0, 0.0, LineColor::Yellow7);
    let mut model = CreasePatternModel::default();
    let changed = draw_crease_segment(&mut model, &aux_segment, DrawCreaseTarget::AuxLine);
    let mut args = vec!["foldline-draw-crease".to_string(), "aux".to_string()];
    push_one_segment_args(&mut args, &aux_segment);
    args.push("0".to_string());
    let rust_summary = format!(
        "changed|{changed}\n{}{}",
        line_segment_set_summary(&model),
        aux_line_segment_set_summary(&model)
    );
    assert_eq!(rust_summary, run_oracle(&oracle, &args));
}

#[test]
fn angle_restricted_5_matches_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let segments = vec![segment(2.0, -1.0, 2.0, 1.0, LineColor::Black0)];
    let mut model = model_from_segments(&segments);
    let angles = [40.0, 60.0, 80.0, 30.0, 50.0, 100.0];
    let added = draw_crease_angle_restricted_5(
        &mut model,
        Point::new(0.0, 0.0),
        Point::new(2.0, 0.2),
        4,
        angles,
        0.5,
        LineColor::Red1,
    );

    let mut args = vec![
        "foldline-angle-restricted5".to_string(),
        "0.0".to_string(),
        "0.0".to_string(),
        "2.0".to_string(),
        "0.2".to_string(),
        "4".to_string(),
    ];
    for angle in angles {
        args.push(angle.to_string());
    }
    args.push("0.5".to_string());
    args.push(LineColor::Red1.number().to_string());
    args.push(segments.len().to_string());
    push_segment_args(&mut args, &segments);
    let rust_summary = format!("added|{added}\n{}", line_segment_set_summary(&model));
    assert_line_summary_close(
        &rust_summary,
        &run_oracle(&oracle, &args),
        1e-12,
        "angle-restricted-5",
    );
}

#[test]
fn angle_system_modes_match_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let angles = [40.0, 60.0, 80.0, 30.0, 50.0, 100.0];
    let candidates = angle_system_candidates(Point::new(0.0, 0.0), Point::new(1.0, 0.0), 4, angles);
    let mut args = vec![
        "foldline-angle-system-candidates".to_string(),
        "0.0".to_string(),
        "0.0".to_string(),
        "1.0".to_string(),
        "0.0".to_string(),
        "4".to_string(),
    ];
    for angle in angles {
        args.push(angle.to_string());
    }
    assert_line_summary_close(
        &line_segment_list_summary(&candidates),
        &run_oracle(&oracle, &args),
        1e-12,
        "angle-system-candidates",
    );

    let destination = segment(0.0, 1.0, 2.0, 1.0, LineColor::Black0);
    let segments = vec![destination.clone()];
    let mut model = model_from_segments(&segments);
    let added = angle_system_draw_to_destination(
        &mut model,
        Point::new(1.0, 0.0),
        &candidates[1],
        &destination,
        LineColor::Blue2,
    );
    let mut args = vec![
        "foldline-angle-system-draw".to_string(),
        "1.0".to_string(),
        "0.0".to_string(),
    ];
    push_one_segment_args(&mut args, &candidates[1]);
    push_one_segment_args(&mut args, &destination);
    args.push(LineColor::Blue2.number().to_string());
    args.push(segments.len().to_string());
    push_segment_args(&mut args, &segments);
    let rust_summary = format!("added|{added}\n{}", line_segment_set_summary(&model));
    assert_line_summary_close(
        &rust_summary,
        &run_oracle(&oracle, &args),
        1e-12,
        "angle-system-draw",
    );
}

#[test]
fn angle_restricted_3_matches_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let angles = [40.0, 60.0, 80.0, 30.0, 50.0, 100.0];
    let candidates = draw_crease_angle_restricted_3_candidates(
        Point::new(1.0, 0.0),
        Point::new(0.0, 0.0),
        4,
        angles,
    );
    let mut args = vec![
        "foldline-angle-restricted3-candidates".to_string(),
        "1.0".to_string(),
        "0.0".to_string(),
        "0.0".to_string(),
        "0.0".to_string(),
        "4".to_string(),
    ];
    for angle in angles {
        args.push(angle.to_string());
    }
    assert_line_summary_close(
        &line_segment_list_summary(&candidates),
        &run_oracle(&oracle, &args),
        1e-9,
        "angle-restricted3-candidates",
    );

    let target_line = segment(0.0, 1.0, 3.0, 1.0, LineColor::Black0);
    let segments = vec![target_line];
    let mut model = model_from_segments(&segments);
    let added = draw_crease_angle_restricted_3_to_point(
        &mut model,
        Point::new(1.2, 0.95),
        Point::new(0.0, 0.0),
        &candidates[0],
        0.5,
        LineColor::Blue2,
    );
    let mut args = vec![
        "foldline-angle-restricted3-draw".to_string(),
        "1.2".to_string(),
        "0.95".to_string(),
        "0.0".to_string(),
        "0.0".to_string(),
    ];
    push_one_segment_args(&mut args, &candidates[0]);
    args.push("0.5".to_string());
    args.push(LineColor::Blue2.number().to_string());
    args.push(segments.len().to_string());
    push_segment_args(&mut args, &segments);
    let rust_summary = format!("added|{added}\n{}", line_segment_set_summary(&model));
    assert_line_summary_close(
        &rust_summary,
        &run_oracle(&oracle, &args),
        1e-9,
        "angle-restricted3-draw",
    );
}

#[test]
fn angle_restricted_converging_matches_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let base = segment(0.0, 0.0, 1.0, 0.0, LineColor::Purple8);
    let angles = [40.0, 60.0, 80.0, 30.0, 50.0, 100.0];
    let candidates = angle_restricted_converging_candidates(&base, 4, angles);
    let mut args = vec!["foldline-angle-restricted-converging-candidates".to_string()];
    push_one_segment_args(&mut args, &base);
    args.push("4".to_string());
    for angle in angles {
        args.push(angle.to_string());
    }
    assert_line_summary_close(
        &angle_restricted_converging_summary(&candidates),
        &run_oracle(&oracle, &args),
        1e-9,
        "angle-restricted-converging-candidates",
    );

    let converge_point = candidates
        .intersections
        .iter()
        .copied()
        .find(|point| points_close(*point, Point::new(0.5, 0.5), 1e-9))
        .expect("divider fan should contain the midpoint convergence");
    let mut model = CreasePatternModel::default();
    let added =
        draw_crease_angle_restricted_converging(&mut model, &base, converge_point, LineColor::Red1);
    let mut args = vec!["foldline-angle-restricted-converging-draw".to_string()];
    push_one_segment_args(&mut args, &base);
    args.push(converge_point.x.to_string());
    args.push(converge_point.y.to_string());
    args.push(LineColor::Red1.number().to_string());
    args.push("0".to_string());
    let rust_summary = format!("added|{added}\n{}", line_segment_set_summary(&model));
    assert_line_summary_close(
        &rust_summary,
        &run_oracle(&oracle, &args),
        1e-9,
        "angle-restricted-converging-draw",
    );
}

#[test]
fn draw_symmetric_matches_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let axis = segment(0.0, 0.0, 0.0, 1.0, LineColor::Black0);
    let segments = vec![
        segment(1.0, 0.0, 1.0, 1.0, LineColor::Red1),
        segment(3.0, 0.0, 3.0, 1.0, LineColor::Blue2),
    ];
    let mut model = model_from_segments(&segments);
    model.line_segments[0] = model.line_segments[0].with_selected(2);
    let mirrored = mirror_selected_lines(&mut model, &axis);

    let mut args = vec!["foldline-draw-symmetric".to_string()];
    push_one_segment_args(&mut args, &axis);
    args.push("0".to_string());
    args.push(segments.len().to_string());
    push_segment_args(&mut args, &segments);
    let rust_summary = format!(
        "mirrored|{mirrored}\n{}",
        line_segment_set_with_selection_summary(&model)
    );
    assert_eq!(rust_summary, run_oracle(&oracle, &args));
}

#[test]
fn measure_commands_match_oriedita_oracle() {
    let Some(oracle) = operations_oracle() else {
        eprintln!(
            "skipping Oriedita operations oracle test: ORIEDITA_OPERATIONS_ORACLE is not set"
        );
        return;
    };

    let length_a = Point::new(0.0, 0.0);
    let length_b = Point::new(3.0, 4.0);
    let length = length_between_points(length_a, length_b);
    let mut args = vec!["measure-length".to_string()];
    push_points_args(&mut args, &[length_a, length_b]);
    assert_eq!(
        format!("length|{}\n", java_double_string(length)),
        run_oracle(&oracle, &args)
    );

    let angle_a = Point::new(0.0, 1.0);
    let angle_center = Point::new(0.0, 0.0);
    let angle_b = Point::new(1.0, 0.0);
    let angle = angle_between_three_points(angle_a, angle_center, angle_b);
    let mut args = vec!["measure-angle".to_string()];
    push_points_args(&mut args, &[angle_a, angle_center, angle_b]);
    assert_eq!(
        format!("angle|{}\n", java_double_string(angle)),
        run_oracle(&oracle, &args)
    );
}

fn operations_oracle() -> Option<PathBuf> {
    std::env::var("ORIEDITA_OPERATIONS_ORACLE")
        .or_else(|_| std::env::var("ORIEDITA_GEOMETRY_ORACLE"))
        .ok()
        .map(|oracle| resolve_oracle_path(&oracle))
}

fn resolve_oracle_path(oracle: &str) -> PathBuf {
    let path = PathBuf::from(oracle);
    if path.is_absolute() || path.exists() {
        return path;
    }

    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(path)
}

fn run_oracle(oracle: &Path, args: &[String]) -> String {
    let output = Command::new(oracle)
        .args(args)
        .output()
        .unwrap_or_else(|err| panic!("failed to run Oriedita operations oracle {oracle:?}: {err}"));

    assert!(
        output.status.success(),
        "Oriedita operations oracle failed with status {:?}: {}",
        output.status.code(),
        String::from_utf8_lossy(&output.stderr)
    );

    String::from_utf8(output.stdout).expect("oracle stdout should be valid UTF-8")
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

fn push_segment_args(args: &mut Vec<String>, segments: &[LineSegment]) {
    for segment in segments {
        push_one_segment_args(args, segment);
    }
}

fn push_one_segment_args(args: &mut Vec<String>, segment: &LineSegment) {
    args.push(segment.a.x.to_string());
    args.push(segment.a.y.to_string());
    args.push(segment.b.x.to_string());
    args.push(segment.b.y.to_string());
    args.push(segment.color.number().to_string());
}

fn push_circle_args(args: &mut Vec<String>, circle: Circle) {
    args.push(circle.x.to_string());
    args.push(circle.y.to_string());
    args.push(circle.r.to_string());
    args.push(circle.color.number().to_string());
}

fn operation_frame_args(
    selection_distance: f64,
    frame: &OperationFrame,
    segments: &[LineSegment],
    circles: &[Circle],
    events: &[(&str, Point)],
) -> Vec<String> {
    let mut args = vec![
        "operation-frame-sequence".to_string(),
        selection_distance.to_string(),
        frame.active.to_string(),
    ];
    for point in frame.points {
        args.push(point.x.to_string());
        args.push(point.y.to_string());
    }
    args.push(segments.len().to_string());
    push_segment_args(&mut args, segments);
    args.push(circles.len().to_string());
    for circle in circles {
        push_circle_args(&mut args, *circle);
    }
    args.push(events.len().to_string());
    for (event, point) in events {
        args.push((*event).to_string());
        args.push(point.x.to_string());
        args.push(point.y.to_string());
    }
    args
}

fn voronoi_args(
    selection_distance: f64,
    color: LineColor,
    apply: bool,
    segments: &[LineSegment],
    circles: &[Circle],
    points: &[Point],
) -> Vec<String> {
    let mut args = vec![
        "foldline-voronoi".to_string(),
        selection_distance.to_string(),
        color.number().to_string(),
        apply.to_string(),
        segments.len().to_string(),
    ];
    push_segment_args(&mut args, segments);
    args.push(circles.len().to_string());
    for circle in circles {
        push_circle_args(&mut args, *circle);
    }
    args.push(points.len().to_string());
    push_points_args(&mut args, points);
    args
}

enum TextEvent {
    Press(Point),
    Drag(Point),
    Delete(Point),
    Box(Point, Point),
}

fn text_sequence_args(
    state: TextSelectionState,
    texts: &[TextElement],
    events: &[TextEvent],
) -> Vec<String> {
    let mut args = vec![
        "text-sequence".to_string(),
        state
            .selected
            .map(|index| index.to_string())
            .unwrap_or_else(|| "-1".to_string()),
        state.is_selected.to_string(),
        state.dirty.to_string(),
        texts.len().to_string(),
    ];
    for text in texts {
        args.push(text.x.0.to_string());
        args.push(text.y.0.to_string());
        args.push(text.text.clone());
    }
    args.push(events.len().to_string());
    for event in events {
        match event {
            TextEvent::Press(point) => {
                args.push("press".to_string());
                args.push(point.x.to_string());
                args.push(point.y.to_string());
            }
            TextEvent::Drag(point) => {
                args.push("drag".to_string());
                args.push(point.x.to_string());
                args.push(point.y.to_string());
            }
            TextEvent::Delete(point) => {
                args.push("delete".to_string());
                args.push(point.x.to_string());
                args.push(point.y.to_string());
            }
            TextEvent::Box(first, second) => {
                args.push("box".to_string());
                args.push(first.x.to_string());
                args.push(first.y.to_string());
                args.push(second.x.to_string());
                args.push(second.y.to_string());
            }
        }
    }
    args
}

fn push_points_args(args: &mut Vec<String>, points: &[Point]) {
    for point in points {
        args.push(point.x.to_string());
        args.push(point.y.to_string());
    }
}

fn line_segment_set_summary(model: &CreasePatternModel) -> String {
    line_segment_list_summary(&model.line_segments)
}

fn angle_restricted_converging_summary(candidates: &AngleRestrictedConvergingCandidates) -> String {
    format!(
        "{}{}",
        line_segment_list_summary(&candidates.indicators),
        point_list_summary(&candidates.intersections)
    )
}

fn line_segment_list_summary(segments: &[LineSegment]) -> String {
    let mut output = String::new();
    output.push_str(&format!("lines|{}\n", segments.len()));
    for segment in segments {
        output.push_str(&format!(
            "line|{}|{}|{}|{}|{}\n",
            java_double_string(segment.a.x),
            java_double_string(segment.a.y),
            java_double_string(segment.b.x),
            java_double_string(segment.b.y),
            segment.color.number()
        ));
    }
    output
}

fn point_list_summary(points: &[Point]) -> String {
    let mut output = String::new();
    output.push_str(&format!("points|{}\n", points.len()));
    for point in points {
        output.push_str(&format!(
            "point|{}|{}\n",
            java_double_string(point.x),
            java_double_string(point.y)
        ));
    }
    output
}

fn flat_foldability_violation_summary(violations: &[FlatFoldabilityViolation]) -> String {
    let mut output = String::new();
    output.push_str(&format!("violations|{}\n", violations.len()));
    for violation in violations {
        output.push_str(&format!(
            "violation|{}|{}|{}|{}\n",
            java_double_string(violation.point.x),
            java_double_string(violation.point.y),
            flat_foldability_rule_name(violation.rule),
            flat_foldability_color_name(violation.color)
        ));
        output.push_str(&format!("lbl|{}\n", violation.little_big_little.len()));
        for line in &violation.little_big_little {
            output.push_str(&format!(
                "lblline|{}|{}|{}|{}|{}|{}\n",
                java_double_string(line.segment.a.x),
                java_double_string(line.segment.a.y),
                java_double_string(line.segment.b.x),
                java_double_string(line.segment.b.y),
                line.segment.color.number(),
                line.violating
            ));
        }
    }
    output
}

fn flat_foldability_rule_name(rule: FlatFoldabilityRule) -> &'static str {
    match rule {
        FlatFoldabilityRule::NumberOfFolds => "NUMBER_OF_FOLDS",
        FlatFoldabilityRule::Angles => "ANGLES",
        FlatFoldabilityRule::Maekawa => "MAEKAWA",
        FlatFoldabilityRule::LittleBigLittle => "LITTLE_BIG_LITTLE",
        FlatFoldabilityRule::None => "NONE",
    }
}

fn flat_foldability_color_name(color: FlatFoldabilityColor) -> &'static str {
    match color {
        FlatFoldabilityColor::NotEnoughMountain => "NOT_ENOUGH_MOUNTAIN",
        FlatFoldabilityColor::NotEnoughValley => "NOT_ENOUGH_VALLEY",
        FlatFoldabilityColor::Equal => "EQUAL",
        FlatFoldabilityColor::Correct => "CORRECT",
        FlatFoldabilityColor::Unknown => "UNKNOWN",
    }
}

fn fix_inaccurate_result_summary(result: &FixInaccurateResult) -> String {
    format!(
        "result|{}|{}|{}|{}|{}\n",
        result.fix_type.as_str(),
        result.num_fixed_lines,
        result.num_fixable_lines,
        result.applied,
        result.warning
    )
}

fn line_segment_set_with_selection_summary(model: &CreasePatternModel) -> String {
    let mut output = String::new();
    output.push_str(&format!("lines|{}\n", model.line_segments.len()));
    for segment in &model.line_segments {
        output.push_str(&format!(
            "line|{}|{}|{}|{}|{}|{}\n",
            java_double_string(segment.a.x),
            java_double_string(segment.a.y),
            java_double_string(segment.b.x),
            java_double_string(segment.b.y),
            segment.color.number(),
            segment.selected
        ));
    }
    output
}

fn line_segment_customization_summary(model: &CreasePatternModel) -> String {
    let mut output = String::new();
    output.push_str(&format!("lines|{}\n", model.line_segments.len()));
    for segment in &model.line_segments {
        output.push_str(&format!(
            "line|{}|{}|{}|{}|{}|{}|{}|{}|{}\n",
            java_double_string(segment.a.x),
            java_double_string(segment.a.y),
            java_double_string(segment.b.x),
            java_double_string(segment.b.y),
            segment.color.number(),
            segment.customized,
            segment.customized_color.red,
            segment.customized_color.green,
            segment.customized_color.blue
        ));
    }
    output
}

fn aux_line_segment_set_summary(model: &CreasePatternModel) -> String {
    let mut output = String::new();
    output.push_str(&format!("aux|{}\n", model.aux_line_segments.len()));
    for segment in &model.aux_line_segments {
        output.push_str(&format!(
            "auxline|{}|{}|{}|{}|{}\n",
            java_double_string(segment.a.x),
            java_double_string(segment.a.y),
            java_double_string(segment.b.x),
            java_double_string(segment.b.y),
            segment.color.number()
        ));
    }
    output
}

fn circle_set_summary(model: &CreasePatternModel) -> String {
    let mut output = String::new();
    output.push_str(&format!("circles|{}\n", model.circles.len()));
    for circle in &model.circles {
        output.push_str(&format!(
            "circle|{}|{}|{}|{}|{}|{}|{}|{}\n",
            java_double_string(circle.x),
            java_double_string(circle.y),
            java_double_string(circle.r),
            circle.color.number(),
            circle.customized,
            circle.customized_color.red,
            circle.customized_color.green,
            circle.customized_color.blue
        ));
    }
    output
}

fn voronoi_state_summary(state: &VoronoiState) -> String {
    let mut output = String::new();
    output.push_str(&format!("seeds|{}\n", state.seed_points.len()));
    for seed in &state.seed_points {
        output.push_str(&format!(
            "seed|{}|{}\n",
            java_double_string(seed.x),
            java_double_string(seed.y)
        ));
    }
    output.push_str(&format!("voronoi|{}\n", state.line_segments.len()));
    for line in &state.line_segments {
        output.push_str(&format!(
            "vline|{}|{}|{}|{}|{}|{}|{}\n",
            java_double_string(line.line_segment.a.x),
            java_double_string(line.line_segment.a.y),
            java_double_string(line.line_segment.b.x),
            java_double_string(line.line_segment.b.y),
            line.voronoi_a,
            line.voronoi_b,
            line.selected
        ));
    }
    output
}

fn voronoi_apply_result_summary(result: VoronoiApplyResult) -> String {
    format!("applied|{}|{}\n", result.lines_added, result.circles_added)
}

fn text_summary(model: &CreasePatternModel, state: &TextSelectionState) -> String {
    let mut output = String::new();
    let (has_start, start) = state
        .selection_start
        .map(|point| (true, point))
        .unwrap_or((false, Point::origin()));
    output.push_str(&format!(
        "textstate|{}|{}|{}|{}|{}|{}\n",
        state
            .selected
            .map(|index| index.to_string())
            .unwrap_or_else(|| "-1".to_string()),
        state.is_selected,
        state.dirty,
        has_start,
        java_double_string(start.x),
        java_double_string(start.y),
    ));
    output.push_str(&format!("texts|{}\n", model.texts.len()));
    for text in &model.texts {
        output.push_str(&format!(
            "text|{}|{}|{}\n",
            java_double_string(text.x.0),
            java_double_string(text.y.0),
            text.text
        ));
    }
    output
}

fn flat_foldable_result_summary(result: FlatFoldableBoundaryCheck) -> String {
    format!(
        "result|{}|{}|{}\n",
        result.color.number(),
        result.suitable_intersections,
        result.crossing_count
    )
}

fn boundary_with_color(boundary: &[LineSegment], color: LineColor) -> Vec<LineSegment> {
    boundary
        .iter()
        .map(|segment| segment.with_line_color(color))
        .collect()
}

fn optional_segment_result_summary(segment: Option<&LineSegment>) -> String {
    match segment {
        Some(segment) => format!(
            "result|{}|{}|{}|{}|{}\n",
            java_double_string(segment.a.x),
            java_double_string(segment.a.y),
            java_double_string(segment.b.x),
            java_double_string(segment.b.y),
            segment.color.number()
        ),
        None => "result|null\n".to_string(),
    }
}

fn operation_frame_summary(frame: &OperationFrame, state: &OperationFrameDragState) -> String {
    format!(
        "frame|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}\n",
        frame.active,
        state.mode.oriedita_name(),
        java_double_string(frame.points[0].x),
        java_double_string(frame.points[0].y),
        java_double_string(frame.points[1].x),
        java_double_string(frame.points[1].y),
        java_double_string(frame.points[2].x),
        java_double_string(frame.points[2].y),
        java_double_string(frame.points[3].x),
        java_double_string(frame.points[3].y),
        java_double_string(state.last_mouse_pos.x),
        java_double_string(state.last_mouse_pos.y)
    )
}

fn operation_frame_fixture() -> OperationFrame {
    OperationFrame {
        active: true,
        points: [
            Point::new(0.0, 0.0),
            Point::new(0.0, 2.0),
            Point::new(2.0, 2.0),
            Point::new(2.0, 0.0),
        ],
    }
}

fn delete_summary(to_delete: &BTreeSet<usize>) -> String {
    let mut output = String::from("delete");
    for index in to_delete {
        output.push_str(&format!("|{index}"));
    }
    output.push('\n');
    output
}

fn intersection_state(intersection: Intersection) -> i32 {
    intersection.state()
}

fn circle_inversion_output(output: CircleInversionOutput) -> &'static str {
    match output {
        CircleInversionOutput::None => "none",
        CircleInversionOutput::Circle => "circle",
        CircleInversionOutput::LineSegment => "line",
    }
}

fn foldable_line_draw_mode_name(mode: FoldableLineDrawOperationMode) -> &'static str {
    match mode {
        FoldableLineDrawOperationMode::DrawCreaseFree => "free",
        FoldableLineDrawOperationMode::VertexMakeAngularlyFlatFoldable => "flat",
    }
}

fn assert_line_summary_close(left: &str, right: &str, tolerance: f64, context: &str) {
    let left_lines: Vec<_> = left.lines().collect();
    let right_lines: Vec<_> = right.lines().collect();
    assert_eq!(
        left_lines.len(),
        right_lines.len(),
        "{context}: summary line count differs\nleft:\n{left}\nright:\n{right}"
    );

    for (index, (left_line, right_line)) in left_lines.iter().zip(right_lines.iter()).enumerate() {
        if left_line.starts_with("line|") && right_line.starts_with("line|") {
            assert_line_entry_close(left_line, right_line, tolerance, context, index);
        } else if left_line.starts_with("vline|") && right_line.starts_with("vline|") {
            assert_voronoi_line_entry_close(left_line, right_line, tolerance, context, index);
        } else if left_line.starts_with("circle|") && right_line.starts_with("circle|") {
            assert_circle_entry_close(left_line, right_line, tolerance, context, index);
        } else if (left_line.starts_with("point|") && right_line.starts_with("point|"))
            || (left_line.starts_with("seed|") && right_line.starts_with("seed|"))
        {
            assert_point_entry_close(left_line, right_line, tolerance, context, index);
        } else {
            assert_eq!(
                left_line, right_line,
                "{context}: summary line {index} differs"
            );
        }
    }
}

fn assert_line_entry_close(left: &str, right: &str, tolerance: f64, context: &str, index: usize) {
    let left_parts: Vec<_> = left.split('|').collect();
    let right_parts: Vec<_> = right.split('|').collect();
    assert_eq!(
        left_parts.len(),
        right_parts.len(),
        "{context}: line entry {index} field count differs"
    );
    assert_eq!(
        left_parts[0], right_parts[0],
        "{context}: line entry prefix"
    );

    for field in 1..=4 {
        let left_value: f64 = left_parts[field]
            .parse()
            .unwrap_or_else(|err| panic!("{context}: bad left float {left}: {err}"));
        let right_value: f64 = right_parts[field]
            .parse()
            .unwrap_or_else(|err| panic!("{context}: bad right float {right}: {err}"));
        assert!(
            (left_value - right_value).abs() <= tolerance,
            "{context}: line entry {index} field {field} differs: {left_value} vs {right_value}"
        );
    }
    assert_eq!(
        left_parts[5], right_parts[5],
        "{context}: line entry {index} color differs"
    );
}

fn assert_voronoi_line_entry_close(
    left: &str,
    right: &str,
    tolerance: f64,
    context: &str,
    index: usize,
) {
    let left_parts: Vec<_> = left.split('|').collect();
    let right_parts: Vec<_> = right.split('|').collect();
    assert_eq!(
        left_parts.len(),
        right_parts.len(),
        "{context}: voronoi line entry {index} field count differs"
    );
    assert_eq!(
        left_parts[0], right_parts[0],
        "{context}: voronoi line entry prefix"
    );

    for field in 1..=4 {
        let left_value: f64 = left_parts[field]
            .parse()
            .unwrap_or_else(|err| panic!("{context}: bad left float {left}: {err}"));
        let right_value: f64 = right_parts[field]
            .parse()
            .unwrap_or_else(|err| panic!("{context}: bad right float {right}: {err}"));
        assert!(
            (left_value - right_value).abs() <= tolerance,
            "{context}: voronoi line entry {index} field {field} differs: {left_value} vs {right_value}"
        );
    }
    assert_eq!(
        left_parts[5..],
        right_parts[5..],
        "{context}: voronoi line entry {index} metadata differs"
    );
}

fn assert_circle_entry_close(left: &str, right: &str, tolerance: f64, context: &str, index: usize) {
    let left_parts: Vec<_> = left.split('|').collect();
    let right_parts: Vec<_> = right.split('|').collect();
    assert_eq!(
        left_parts.len(),
        right_parts.len(),
        "{context}: circle entry {index} field count differs"
    );
    assert_eq!(
        left_parts[0], right_parts[0],
        "{context}: circle entry prefix"
    );

    for field in 1..=3 {
        let left_value: f64 = left_parts[field]
            .parse()
            .unwrap_or_else(|err| panic!("{context}: bad left float {left}: {err}"));
        let right_value: f64 = right_parts[field]
            .parse()
            .unwrap_or_else(|err| panic!("{context}: bad right float {right}: {err}"));
        assert!(
            (left_value - right_value).abs() <= tolerance,
            "{context}: circle entry {index} field {field} differs: {left_value} vs {right_value}"
        );
    }
    assert_eq!(
        left_parts[4..],
        right_parts[4..],
        "{context}: circle entry {index} metadata differs"
    );
}

fn assert_point_entry_close(left: &str, right: &str, tolerance: f64, context: &str, index: usize) {
    let left_parts: Vec<_> = left.split('|').collect();
    let right_parts: Vec<_> = right.split('|').collect();
    assert_eq!(
        left_parts.len(),
        right_parts.len(),
        "{context}: point entry {index} field count differs"
    );
    assert_eq!(
        left_parts[0], right_parts[0],
        "{context}: point entry prefix"
    );

    for field in 1..=2 {
        let left_value: f64 = left_parts[field]
            .parse()
            .unwrap_or_else(|err| panic!("{context}: bad left float {left}: {err}"));
        let right_value: f64 = right_parts[field]
            .parse()
            .unwrap_or_else(|err| panic!("{context}: bad right float {right}: {err}"));
        assert!(
            (left_value - right_value).abs() <= tolerance,
            "{context}: point entry {index} field {field} differs: {left_value} vs {right_value}"
        );
    }
}

fn points_close(left: Point, right: Point, tolerance: f64) -> bool {
    (left.x - right.x).abs() <= tolerance && (left.y - right.y).abs() <= tolerance
}

fn java_double_string(value: f64) -> String {
    if value != 0.0 && value.abs() < 1e-3 {
        return format!("{value:E}");
    }
    if value.is_finite() && value.fract() == 0.0 {
        format!("{value:.1}")
    } else {
        value.to_string()
    }
}

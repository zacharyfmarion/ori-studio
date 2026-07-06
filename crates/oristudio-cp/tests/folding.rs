use oristudio_cp::folding::{
    ChainPermutationGenerator, DisplayStyle, EstimationOrder, EstimationStep, FoldedFigureModel,
    FoldedFigureRenderAntialias, FoldedFigureRenderGeometry, FoldedFigureRenderPaint,
    FoldedFigureRenderPrimitiveKind, FoldedFigureRenderStroke, FoldedFigureState,
    FoldingEstimateSession, HierarchyRelation, InitialHierarchy, RenderPathCommand, RgbaColor,
    SubFacePermutationSearch, SubFaceSwapper, WorkerOverlapEnumerator,
    additional_estimation_from_segments, configure_subfaces_from_segments,
    duplicate_estimation_order_for_display, equivalence_condition_candidates_from_segments,
    estimate_wireframe_from_segments, fold_another, folded_figure_snapshot_from_segments,
    folding_estimate_case_filename, folding_estimate_from_segments, folding_estimate_save_batch,
    folding_estimate_to_case, initial_hierarchy_from_segments, overlap_search_from_segments,
    overlap_search_from_segments_with_swap, parse_oriedita_render_primitives,
    possible_overlap_search_for_ordered_subfaces, possible_overlap_search_for_subfaces,
    possible_overlap_search_for_subfaces_with_swap, prepare_subface_segments, prioritize_subfaces,
    two_colored_folding_estimate_from_segments, two_colored_subface_segments_from_segments,
};
use oristudio_cp::geometry::{LineColor, LineSegment, Point, RgbColor};
use oristudio_cp::io::cp;

#[test]
fn folded_figure_model_defaults_match_oriedita() {
    let model = FoldedFigureModel::default();

    assert_eq!(model.front_color, RgbColor::new(255, 255, 50));
    assert_eq!(model.back_color, RgbColor::new(233, 233, 233));
    assert_eq!(model.line_color, RgbColor::new(0, 0, 0));
    assert_eq!(model.scale, 1.0);
    assert_eq!(model.rotation, 0.0);
    assert!(model.anti_alias);
    assert!(!model.display_shadows);
    assert_eq!(model.state, FoldedFigureState::Front0);
    assert_eq!(model.folded_cases, 1);
    assert_eq!(model.transparent_transparency, 16);
    assert!(!model.transparency_color);
}

#[test]
fn folded_figure_snapshot_serializes_wireframe_state_after_order_2() {
    let snapshot = folded_figure_snapshot_from_segments(
        &square_with_diagonal(),
        1,
        EstimationOrder::Order2,
        FoldedFigureModel::default(),
    )
    .expect("folded figure snapshot");

    assert_eq!(snapshot.estimation_step, EstimationStep::Step2);
    assert_eq!(snapshot.display_style, DisplayStyle::Wire2);
    assert_eq!(snapshot.discovered_fold_cases, 0);
    let wireframe = snapshot.wireframe.as_ref().expect("order 2 wireframe");
    assert_eq!(wireframe.lines.len(), 5);
    assert_eq!(wireframe.faces.len(), 2);

    let value = serde_json::to_value(&snapshot).expect("serialized snapshot");
    assert_eq!(value["model"]["front_color"]["red"], 255);
    assert_eq!(value["model"]["state"], "Front0");
    assert_eq!(value["estimation_step"], "Step2");
    assert_eq!(value["display_style"], "Wire2");
    assert_eq!(value["wireframe"]["faces"].as_array().unwrap().len(), 2);
}

#[test]
fn folded_figure_snapshot_leaves_wireframe_empty_before_order_2() {
    let snapshot = folded_figure_snapshot_from_segments(
        &square_with_diagonal(),
        1,
        EstimationOrder::Order1,
        FoldedFigureModel::default(),
    )
    .expect("folded figure snapshot");

    assert_eq!(snapshot.estimation_step, EstimationStep::Step1);
    assert_eq!(snapshot.display_style, DisplayStyle::Development1);
    assert!(snapshot.wireframe.is_none());
}

#[test]
fn folded_render_primitive_parser_reads_oriedita_recorder_output() {
    let output = "\
schema|folded-render-primitives|1
fixture|simple-square|paper-front
primitive|0|fill_path|color|255|255|50|255|basic|1.000000000|2|0|10.000000000|aa_off|M|-30.000000000|-30.000000000;L|70.000000000|70.000000000;L|70.000000000|-30.000000000;Z
primitive|1|stroke_path|color|0|0|0|255|basic|1.200000048|0|0|10.000000000|aa_on|M|-30.000000000|-30.000000000;L|70.000000000|-30.000000000
";

    let snapshot = parse_oriedita_render_primitives(output).expect("parse render primitives");

    assert_eq!(snapshot.schema_version, 1);
    assert_eq!(snapshot.fixture.as_deref(), Some("simple-square"));
    assert_eq!(snapshot.pass.as_deref(), Some("paper-front"));
    assert_eq!(snapshot.primitives.len(), 2);
    assert_eq!(
        snapshot.primitives[0].kind,
        FoldedFigureRenderPrimitiveKind::FillPath
    );
    assert_eq!(
        snapshot.primitives[0].style.paint,
        FoldedFigureRenderPaint::Color {
            color: RgbaColor::new(255, 255, 50, 255)
        }
    );
    assert_eq!(
        snapshot.primitives[0].style.stroke,
        FoldedFigureRenderStroke::Basic {
            width: 1.0,
            end_cap: 2,
            line_join: 0,
            miter_limit: 10.0
        }
    );
    assert_eq!(
        snapshot.primitives[0].style.antialias,
        FoldedFigureRenderAntialias::Off
    );

    let FoldedFigureRenderGeometry::Path { commands } = &snapshot.primitives[0].geometry else {
        panic!("first primitive should be a path");
    };
    assert_eq!(
        commands.first(),
        Some(&RenderPathCommand::MoveTo {
            point: Point::new(-30.0, -30.0)
        })
    );
    assert_eq!(commands.last(), Some(&RenderPathCommand::Close));

    let value = serde_json::to_value(&snapshot).expect("serialized render snapshot");
    assert_eq!(value["primitives"][0]["kind"], "fill_path");
    assert_eq!(value["primitives"][0]["style"]["paint"]["kind"], "color");
}

#[test]
fn wireframe_fold_builds_faces_and_face_positions() {
    let segments = square_with_diagonal();

    let folded = estimate_wireframe_from_segments(&segments, 1).expect("folded wireframe");

    assert_eq!(folded.points.len(), 4);
    assert_eq!(folded.lines.len(), 5);
    assert_eq!(folded.faces.len(), 2);
    assert_eq!(folded.starting_face, 0);
    assert_eq!(folded.face_positions[0], 1);
    assert!(folded.face_positions.contains(&2));
}

#[test]
fn wireframe_fold_returns_none_without_faces() {
    let segments = vec![LineSegment::with_color(
        Point::new(0.0, 0.0),
        Point::new(1.0, 0.0),
        LineColor::Black0,
    )];

    assert!(estimate_wireframe_from_segments(&segments, 1).is_none());
}

#[test]
fn subface_preparation_removes_points_duplicates_and_splits_crossings() {
    let segments = vec![
        LineSegment::with_color(Point::new(0.0, 0.0), Point::new(10.0, 0.0), LineColor::Red1),
        LineSegment::with_color(
            Point::new(5.0, -5.0),
            Point::new(5.0, 5.0),
            LineColor::Blue2,
        ),
        LineSegment::with_color(Point::new(0.0, 0.0), Point::new(10.0, 0.0), LineColor::Red1),
        LineSegment::with_color(
            Point::new(2.0, 2.0),
            Point::new(2.0, 2.0),
            LineColor::Black0,
        ),
    ];

    let prepared = prepare_subface_segments(&segments);

    assert_eq!(prepared.len(), 4);
    assert!(prepared.iter().all(|segment| segment.a != segment.b));
    assert_eq!(
        prepared
            .iter()
            .filter(|segment| segment.color == LineColor::Red1)
            .count(),
        2
    );
    assert_eq!(
        prepared
            .iter()
            .filter(|segment| segment.color == LineColor::Blue2)
            .count(),
        2
    );
}

#[test]
fn subface_configuration_maps_subfaces_to_folded_faces() {
    let segments = square_with_diagonal();

    let configuration =
        configure_subfaces_from_segments(&segments, 1).expect("subface configuration");

    assert!(!configuration.subfaces.is_empty());
    assert_eq!(configuration.face_id_count_max, 2);
    assert!(
        configuration
            .subfaces
            .iter()
            .any(|subface| subface.face_ids == vec![0, 1])
    );
    assert!(!configuration.reduced_subface_indices.is_empty());
}

#[test]
fn initial_hierarchy_uses_mountain_valley_and_face_parity() {
    let segments = square_with_diagonal();

    let hierarchy = initial_hierarchy_from_segments(&segments, 1)
        .expect("hierarchy should not fail")
        .expect("hierarchy");

    assert_eq!(hierarchy.faces_total, 2);
    assert_eq!(
        hierarchy.relations,
        vec![HierarchyRelation {
            upper_face: 0,
            lower_face: 1,
        }]
    );
}

#[test]
fn equivalence_condition_candidates_are_exposed() {
    let segments = quartered_square();

    let conditions = equivalence_condition_candidates_from_segments(&segments, 1)
        .expect("condition generation should not fail")
        .expect("condition set");

    assert!(
        !conditions.triple_conditions.is_empty() || !conditions.quadruple_conditions.is_empty()
    );
}

#[test]
fn additional_estimation_produces_hierarchy_relations() {
    let segments = square_with_diagonal();

    let estimation = additional_estimation_from_segments(&segments, 1)
        .expect("additional estimation should not fail")
        .expect("additional estimation");

    assert_eq!(estimation.hierarchy.faces_total, 2);
    assert_eq!(estimation.hierarchy.relations.len(), 1);
}

#[test]
fn chain_permutation_generator_honors_pair_guides() {
    let mut generator = ChainPermutationGenerator::new(4);
    generator.add_guide(1, 2).expect("valid guide");
    generator.add_guide(2, 3).expect("valid guide");
    generator.initialize();

    for permutation in collect_permutations(generator, 16) {
        let one = position(&permutation, 1);
        let two = position(&permutation, 2);
        let three = position(&permutation, 3);
        assert!(one < two);
        assert!(two < three);
    }
}

#[test]
fn chain_permutation_generator_applies_top_and_bottom_constraints() {
    let mut generator = ChainPermutationGenerator::new(4);
    generator.set_top_indices([2, 3]).expect("valid top set");
    generator
        .set_bottom_indices([1, 4])
        .expect("valid bottom set");
    generator.initialize();

    for permutation in collect_permutations(generator, 16) {
        assert!([2, 3].contains(&permutation[0]));
        assert!([1, 4].contains(&permutation[3]));
    }
}

#[test]
fn chain_permutation_generator_supports_temporary_guides() {
    let mut generator = ChainPermutationGenerator::new(3);
    generator.initialize();
    generator.next(3).expect("advance before temp guide");
    generator.add_guide(2, 1).expect("valid temporary guide");
    generator.next(3).expect("advance with temp guide");

    let temp_permutation = generator.current_permutation();
    assert!(position(&temp_permutation, 2) < position(&temp_permutation, 1));

    generator.clear_temp_guide();
    generator
        .next(3)
        .expect("advance after clearing temp guide");
    assert_eq!(generator.current_permutation().len(), 3);
}

#[test]
fn subface_permutation_search_builds_transitive_reduced_guides() {
    let hierarchy = InitialHierarchy {
        faces_total: 4,
        relations: vec![
            HierarchyRelation {
                upper_face: 0,
                lower_face: 1,
            },
            HierarchyRelation {
                upper_face: 1,
                lower_face: 2,
            },
            HierarchyRelation {
                upper_face: 0,
                lower_face: 2,
            },
        ],
    };
    let mut search = SubFacePermutationSearch::new(vec![0, 1, 2, 3]);
    search.set_guide_map(&hierarchy, None).expect("guide map");

    for ordering in collect_subface_orderings(search, 12) {
        assert!(position(&ordering, 0) < position(&ordering, 1));
        assert!(position(&ordering, 1) < position(&ordering, 2));
    }
}

#[test]
fn subface_overlap_search_advances_past_hierarchy_contradictions() {
    let hierarchy = InitialHierarchy {
        faces_total: 3,
        relations: vec![HierarchyRelation {
            upper_face: 2,
            lower_face: 0,
        }],
    };
    let mut search = SubFacePermutationSearch::new(vec![0, 1, 2]);
    search.set_guide_map(&hierarchy, None).expect("guide map");

    assert!(
        search
            .possible_overlapping_search(&hierarchy)
            .expect("subface search should be supported")
    );

    let ordering = search.current_ordering();
    assert!(position(&ordering, 2) < position(&ordering, 0));
}

#[test]
fn subface_priority_prefers_new_pair_information_then_face_count() {
    let hierarchy = InitialHierarchy {
        faces_total: 4,
        relations: Vec::new(),
    };
    let subfaces = vec![
        oristudio_cp::folding::SubFace {
            face_ids: vec![0, 1],
        },
        oristudio_cp::folding::SubFace {
            face_ids: vec![1, 2, 3],
        },
        oristudio_cp::folding::SubFace {
            face_ids: vec![0, 1, 2, 3],
        },
    ];

    let priority = prioritize_subfaces(&subfaces, &[0, 1, 2], &hierarchy);

    assert_eq!(priority.ordered_subface_indices, vec![2, 1, 0]);
    assert_eq!(priority.valid_count, 1);
}

#[test]
fn worker_overlap_search_composes_valid_subface_orders() {
    let hierarchy = InitialHierarchy {
        faces_total: 3,
        relations: vec![HierarchyRelation {
            upper_face: 2,
            lower_face: 0,
        }],
    };
    let subfaces = vec![oristudio_cp::folding::SubFace {
        face_ids: vec![0, 1, 2],
    }];

    let search = possible_overlap_search_for_subfaces(&subfaces, &[0], &hierarchy, None)
        .expect("worker search should be supported");

    assert!(search.found);
    assert_eq!(search.priority.valid_count, 1);
    assert!(
        search
            .hierarchy
            .relations
            .iter()
            .any(|relation| relation.upper_face == 2 && relation.lower_face == 0)
    );
}

#[test]
fn subface_swapper_moves_recorded_dead_end_toward_front() {
    let mut swapper = SubFaceSwapper::new();
    let mut order = vec![0, 1, 2, 3];
    let counters = vec![0, 0, 0, 0];

    swapper.visit(order[0]);
    swapper.record(4);
    swapper.process(&mut order, 4, &counters);

    assert_eq!(order, vec![0, 3, 1, 2]);
    assert!(swapper.should_estimate(2));
}

#[test]
fn worker_overlap_search_with_swap_runs_realtime_search_path() {
    let hierarchy = InitialHierarchy {
        faces_total: 7,
        relations: Vec::new(),
    };
    let subfaces = vec![
        oristudio_cp::folding::SubFace {
            face_ids: vec![0, 1, 2, 3],
        },
        oristudio_cp::folding::SubFace {
            face_ids: vec![4, 5, 6],
        },
    ];
    let conditions = oristudio_cp::folding::EquivalenceConditionSet {
        triple_conditions: vec![
            oristudio_cp::folding::EquivalenceCondition {
                a: 4,
                b: 5,
                c: 4,
                d: 6,
            },
            oristudio_cp::folding::EquivalenceCondition {
                a: 5,
                b: 4,
                c: 5,
                d: 6,
            },
            oristudio_cp::folding::EquivalenceCondition {
                a: 6,
                b: 4,
                c: 6,
                d: 5,
            },
        ],
        quadruple_conditions: Vec::new(),
    };

    let search = possible_overlap_search_for_subfaces_with_swap(
        &subfaces,
        &[0, 1],
        &hierarchy,
        Some(&conditions),
    )
    .expect("worker search should be supported");

    assert!(!search.found);
    assert_eq!(search.priority.valid_count, 2);
}

#[test]
fn worker_overlap_search_promotes_final_aea_error_subface() {
    let hierarchy = InitialHierarchy {
        faces_total: 3,
        relations: vec![HierarchyRelation {
            upper_face: 2,
            lower_face: 0,
        }],
    };
    let subfaces = vec![
        oristudio_cp::folding::SubFace {
            face_ids: vec![0, 1],
        },
        oristudio_cp::folding::SubFace {
            face_ids: vec![1, 2],
        },
        oristudio_cp::folding::SubFace {
            face_ids: vec![0, 1, 2],
        },
    ];

    let search = possible_overlap_search_for_ordered_subfaces(&subfaces, 2, &hierarchy, None, true)
        .expect("worker search should be supported");

    assert!(search.found);
    assert_eq!(search.priority.valid_count, 3);
    assert_eq!(search.priority.ordered_subface_indices, vec![1, 2, 0]);
}

#[test]
fn worker_overlap_enumerator_preserves_state_for_next_solution() {
    let hierarchy = InitialHierarchy {
        faces_total: 3,
        relations: vec![HierarchyRelation {
            upper_face: 2,
            lower_face: 0,
        }],
    };
    let subfaces = vec![
        oristudio_cp::folding::SubFace {
            face_ids: vec![0, 1],
        },
        oristudio_cp::folding::SubFace {
            face_ids: vec![1, 2],
        },
        oristudio_cp::folding::SubFace {
            face_ids: vec![0, 1, 2],
        },
    ];
    let mut enumerator =
        WorkerOverlapEnumerator::from_ordered_subfaces(&subfaces, &[0, 1, 2], 2, &hierarchy, None)
            .expect("worker enumerator");

    let first = enumerator
        .possible_overlapping_search(true)
        .expect("first overlap search");
    assert!(first.found);
    assert_eq!(first.priority.valid_count, 3);

    let changed = enumerator
        .next(enumerator.valid_count())
        .expect("advance overlap search");
    assert!(changed > 0);

    let next = enumerator
        .possible_overlapping_search(false)
        .expect("next overlap search");
    assert!(next.found);
    assert_eq!(next.priority.valid_count, 3);
}

#[test]
fn overlap_search_from_segments_runs_folded_worker_pipeline() {
    let search = overlap_search_from_segments(&square_with_diagonal(), 1)
        .expect("overlap search should not fail")
        .expect("overlap search result");

    assert!(search.found);
    assert_eq!(search.hierarchy.faces_total, 2);
    assert!(!search.hierarchy.relations.is_empty());
}

#[test]
fn overlap_search_from_segments_with_swap_runs_initial_worker_pipeline() {
    let search = overlap_search_from_segments_with_swap(&square_with_diagonal(), 1)
        .expect("overlap search should not fail")
        .expect("overlap search result");

    assert!(search.found);
    assert_eq!(search.hierarchy.faces_total, 2);
    assert!(!search.hierarchy.relations.is_empty());
}

#[test]
fn folding_estimate_runs_ordered_stages_to_first_solution() {
    let estimate = folding_estimate_from_segments(
        &square_with_diagonal(),
        1,
        oristudio_cp::folding::EstimationOrder::Order5,
    )
    .expect("folding estimate");

    assert_eq!(
        estimate.estimation_step,
        oristudio_cp::folding::EstimationStep::Step5
    );
    assert_eq!(
        estimate.display_style,
        oristudio_cp::folding::DisplayStyle::Paper5
    );
    assert_eq!(estimate.discovered_fold_cases, 1);
    assert!(!estimate.find_another_overlap_valid);
    assert!(estimate.overlap.as_ref().is_some_and(|search| search.found));
}

#[test]
fn folding_estimate_session_reuses_worker_for_order6() {
    let mut session = FoldingEstimateSession::new(&square_with_diagonal(), 1);

    let first = session
        .folding_estimated(oristudio_cp::folding::EstimationOrder::Order5)
        .expect("first folding estimate");
    assert_eq!(first.discovered_fold_cases, 1);
    assert!(!first.find_another_overlap_valid);

    let next = session
        .folding_estimated(oristudio_cp::folding::EstimationOrder::Order6)
        .expect("next folding estimate");
    assert_eq!(
        next.estimation_step,
        oristudio_cp::folding::EstimationStep::Step5
    );
    assert_eq!(next.discovered_fold_cases, 1);
    assert!(!next.find_another_overlap_valid);
}

#[test]
fn fold_another_runs_order6_on_existing_session() {
    let mut session = FoldingEstimateSession::new(&square_with_diagonal(), 1);
    session
        .folding_estimated(oristudio_cp::folding::EstimationOrder::Order5)
        .expect("first folding estimate");

    let estimate = fold_another(&mut session).expect("another folding estimate");

    assert_eq!(estimate.discovered_fold_cases, 1);
    assert!(!estimate.find_another_overlap_valid);
}

#[test]
fn folding_estimate_to_case_stops_when_no_more_solutions() {
    let mut session = FoldingEstimateSession::new(&square_with_diagonal(), 1);

    let batch = folding_estimate_to_case(
        &mut session,
        3,
        oristudio_cp::folding::EstimationOrder::Order5,
    )
    .expect("specific folding estimate");

    assert_eq!(batch.discovered_case_numbers, vec![1]);
    assert_eq!(session.estimate().discovered_fold_cases, 1);
    assert!(!session.estimate().find_another_overlap_valid);
}

#[test]
fn folding_estimate_to_case_finds_solution_sample_cases() {
    let segments = solution_sample_segments();
    let mut session = FoldingEstimateSession::new(&segments, 1);

    let batch = folding_estimate_to_case(
        &mut session,
        17,
        oristudio_cp::folding::EstimationOrder::Order5,
    )
    .expect("specific folding estimate");

    assert_eq!(session.estimate().discovered_fold_cases, 16);
    assert_eq!(
        batch.discovered_case_numbers,
        (1usize..=16).collect::<Vec<_>>()
    );
    assert!(!session.estimate().find_another_overlap_valid);
}

#[test]
fn folding_estimate_save_batch_records_case_numbers_and_filename_suffixes() {
    let mut session = FoldingEstimateSession::new(&square_with_diagonal(), 1);

    let batch = folding_estimate_save_batch(&mut session, 100).expect("save batch estimate");

    assert_eq!(batch.discovered_case_numbers, vec![1]);
    assert_eq!(
        folding_estimate_case_filename("/tmp/folded.image.png", 12),
        "/tmp/folded.image_12.png"
    );
    assert_eq!(
        folding_estimate_case_filename("/tmp/folded-image", 12),
        "/tmp/folded-image"
    );
}

#[test]
fn duplicate_estimation_order_follows_oriedita_display_mapping() {
    use oristudio_cp::folding::{DisplayStyle, EstimationOrder};

    assert_eq!(
        duplicate_estimation_order_for_display(DisplayStyle::None0),
        EstimationOrder::Order0
    );
    assert_eq!(
        duplicate_estimation_order_for_display(DisplayStyle::Development1),
        EstimationOrder::Order1
    );
    assert_eq!(
        duplicate_estimation_order_for_display(DisplayStyle::Wire2),
        EstimationOrder::Order2
    );
    assert_eq!(
        duplicate_estimation_order_for_display(DisplayStyle::Transparent3),
        EstimationOrder::Order3
    );
    assert_eq!(
        duplicate_estimation_order_for_display(DisplayStyle::Development4),
        EstimationOrder::Order4
    );
    assert_eq!(
        duplicate_estimation_order_for_display(DisplayStyle::Paper5),
        EstimationOrder::Order5
    );
}

#[test]
fn two_colored_subface_segments_keep_development_coordinates() {
    let prepared = two_colored_subface_segments_from_segments(&two_square_strip(), 1)
        .expect("two-colored subface preparation");

    assert!(!prepared.is_empty());
    assert!(
        prepared
            .iter()
            .any(|segment| segment.a.x == 10.0 || segment.b.x == 10.0)
    );
}

#[test]
fn two_colored_folding_estimate_runs_to_step10() {
    let estimate = two_colored_folding_estimate_from_segments(&two_square_strip(), 1)
        .expect("two-colored folding estimate");

    assert_eq!(
        estimate.estimation_step,
        oristudio_cp::folding::EstimationStep::Step10
    );
    assert_eq!(
        estimate.display_style,
        oristudio_cp::folding::DisplayStyle::Paper5
    );
    assert!(estimate.discovered_fold_cases >= 1);
    assert!(estimate.overlap.as_ref().is_some_and(|search| search.found));
}

fn square_with_diagonal() -> Vec<LineSegment> {
    vec![
        LineSegment::with_color(
            Point::new(0.0, 0.0),
            Point::new(1.0, 0.0),
            LineColor::Black0,
        ),
        LineSegment::with_color(
            Point::new(1.0, 0.0),
            Point::new(1.0, 1.0),
            LineColor::Black0,
        ),
        LineSegment::with_color(
            Point::new(1.0, 1.0),
            Point::new(0.0, 1.0),
            LineColor::Black0,
        ),
        LineSegment::with_color(
            Point::new(0.0, 1.0),
            Point::new(0.0, 0.0),
            LineColor::Black0,
        ),
        LineSegment::with_color(Point::new(0.0, 0.0), Point::new(1.0, 1.0), LineColor::Red1),
    ]
}

fn two_square_strip() -> Vec<LineSegment> {
    vec![
        segment(0.0, 0.0, 10.0, 0.0, LineColor::Black0),
        segment(10.0, 0.0, 20.0, 0.0, LineColor::Black0),
        segment(20.0, 0.0, 20.0, 10.0, LineColor::Black0),
        segment(20.0, 10.0, 10.0, 10.0, LineColor::Black0),
        segment(10.0, 10.0, 0.0, 10.0, LineColor::Black0),
        segment(0.0, 10.0, 0.0, 0.0, LineColor::Black0),
        segment(10.0, 0.0, 10.0, 10.0, LineColor::Red1),
    ]
}

fn quartered_square() -> Vec<LineSegment> {
    vec![
        LineSegment::with_color(
            Point::new(0.0, 0.0),
            Point::new(1.0, 0.0),
            LineColor::Black0,
        ),
        LineSegment::with_color(
            Point::new(1.0, 0.0),
            Point::new(1.0, 1.0),
            LineColor::Black0,
        ),
        LineSegment::with_color(
            Point::new(1.0, 1.0),
            Point::new(0.0, 1.0),
            LineColor::Black0,
        ),
        LineSegment::with_color(
            Point::new(0.0, 1.0),
            Point::new(0.0, 0.0),
            LineColor::Black0,
        ),
        LineSegment::with_color(Point::new(0.5, 0.5), Point::new(0.0, 0.0), LineColor::Red1),
        LineSegment::with_color(Point::new(0.5, 0.5), Point::new(1.0, 0.0), LineColor::Blue2),
        LineSegment::with_color(Point::new(0.5, 0.5), Point::new(1.0, 1.0), LineColor::Red1),
        LineSegment::with_color(Point::new(0.5, 0.5), Point::new(0.0, 1.0), LineColor::Blue2),
    ]
}

fn solution_sample_segments() -> Vec<LineSegment> {
    cp::import_cp_str(include_str!(
        "../../../tests/fixtures/oriedita/solution_sample_1.cp"
    ))
    .expect("solution sample cp")
    .line_segments
}

fn collect_permutations(mut generator: ChainPermutationGenerator, limit: usize) -> Vec<Vec<usize>> {
    let mut permutations = Vec::new();
    for step in 0..limit {
        if step > 0 && generator.next(generator.num_digits()).expect("advance") == 0 {
            break;
        }
        permutations.push(generator.current_permutation());
    }
    permutations
}

fn collect_subface_orderings(
    mut search: SubFacePermutationSearch,
    limit: usize,
) -> Vec<Vec<usize>> {
    let mut permutations = Vec::new();
    for step in 0..limit {
        if step > 0 && search.next(search.face_ids().len()).expect("advance") == 0 {
            break;
        }
        permutations.push(search.current_ordering());
    }
    permutations
}

fn position(permutation: &[usize], value: usize) -> usize {
    permutation
        .iter()
        .position(|digit| *digit == value)
        .expect("value should be present")
}

fn segment(ax: f64, ay: f64, bx: f64, by: f64, color: LineColor) -> LineSegment {
    LineSegment::with_color(Point::new(ax, ay), Point::new(bx, by), color)
}

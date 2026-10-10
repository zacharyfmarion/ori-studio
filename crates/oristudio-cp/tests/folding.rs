use oristudio_cp::FoldGraphError;
use oristudio_cp::folding::{
    AdditionalEstimationError, ChainPermutationGenerator, DisplayStyle, EstimationOrder,
    EstimationStep, FoldContradiction, FoldOutcome, FoldSetupError, FoldedFigureModel,
    FoldedFigureRenderAntialias, FoldedFigureRenderGeometry, FoldedFigureRenderOptions,
    FoldedFigureRenderPaint, FoldedFigureRenderPrimitive, FoldedFigureRenderPrimitiveKind,
    FoldedFigureRenderSnapshot, FoldedFigureRenderStroke, FoldedFigureState, FoldedPaperEdgeKind,
    FoldedPaperScene, FoldingEstimateError, FoldingEstimateSession, HierarchyRelation,
    InitialHierarchy, RenderPathCommand, RgbaColor, SubFacePermutationSearch, SubFaceSwapper,
    WorkerOverlapEnumerator, WorkerOverlapSearchError, additional_estimation_from_segments,
    configure_subfaces_from_segments, duplicate_estimation_order_for_display,
    equivalence_condition_candidates_from_segments, estimate_wireframe_from_segments, fold_another,
    folded_figure_paper_scene_from_segments, folded_figure_render_snapshot_from_segments,
    folded_figure_snapshot_from_segments, folding_estimate_case_filename,
    folding_estimate_from_segments, folding_estimate_save_batch, folding_estimate_to_case,
    initial_hierarchy_from_segments, overlap_search_from_segments,
    overlap_search_from_segments_with_swap, parse_oriedita_render_primitives,
    possible_overlap_search_for_ordered_subfaces, possible_overlap_search_for_subfaces,
    possible_overlap_search_for_subfaces_with_swap, prepare_subface_segments, prioritize_subfaces,
    two_colored_folding_estimate_from_segments, two_colored_subface_segments_from_segments,
};
use oristudio_cp::geometry::{
    Epsilon, Intersection, LineColor, LineSegment, Point, Polygon, PolygonIntersection, RgbColor,
    determine_line_segment_intersection,
};
use oristudio_cp::io::{cp, ori};

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

    let folded = estimate_wireframe_from_segments(&segments, 1)
        .expect("connected fold graph")
        .expect("folded wireframe");

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

    assert!(
        estimate_wireframe_from_segments(&segments, 1)
            .expect("connected fold graph")
            .is_none()
    );
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

    let prepared = prepare_subface_segments(&segments).expect("not cancellable in a test");

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

    let configuration = configure_subfaces_from_segments(&segments, 1)
        .expect("connected fold graph")
        .expect("subface configuration");

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

/// The priority order is a **permutation**: every subface once, none twice.
///
/// The sweep ends with a tail of subfaces that carry no new pair information —
/// all their pairs were claimed by something placed earlier — and selecting
/// among *those* is where the ordering used to collapse. The seed for "best so
/// far" was index 0, which is a real subface rather than a sentinel in this
/// 0-based port, so once nothing could beat it the already-placed subface 0 was
/// chosen again, and again. The list came back the right length and the wrong
/// contents.
///
/// Nothing downstream survives that. `from_ordered_subfaces` builds one entry
/// per slot, so the duplicates become duplicate entries and the omitted
/// subfaces are simply absent from the search — absent from the guide maps,
/// from the final additional-estimation pass, and from any recovery that would
/// go looking for them. On `hex pleated pangolin` it turned 266 subfaces into 66
/// distinct ones and dropped every subface the 3D path builds to carry a
/// cross-plane coupling, which is why that model could never be ordered.
///
/// The tail here is three two-face subfaces over pairs the first subface has
/// already claimed, so all three score zero and the collapse is reachable.
#[test]
fn subface_priority_is_a_permutation_even_when_the_tail_adds_nothing() {
    let hierarchy = InitialHierarchy {
        faces_total: 4,
        relations: Vec::new(),
    };
    let subfaces = vec![
        oristudio_cp::folding::SubFace {
            face_ids: vec![0, 1, 2, 3],
        },
        oristudio_cp::folding::SubFace {
            face_ids: vec![0, 1],
        },
        oristudio_cp::folding::SubFace {
            face_ids: vec![1, 2],
        },
        oristudio_cp::folding::SubFace {
            face_ids: vec![2, 3],
        },
    ];

    let priority = prioritize_subfaces(&subfaces, &[0, 1, 2, 3], &hierarchy);

    // Only the first carries new information, so the other three are the tail.
    assert_eq!(priority.valid_count, 1);
    assert_eq!(priority.ordered_subface_indices.len(), subfaces.len());
    let mut seen = priority.ordered_subface_indices.clone();
    seen.sort_unstable();
    assert_eq!(
        seen,
        vec![0, 1, 2, 3],
        "the priority order lost subfaces and repeated others: {:?}",
        priority.ordered_subface_indices
    );
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
fn worker_overlap_contradiction_is_extractable() {
    // A layer-ordering contradiction is recoverable: it carries the offending
    // face pair so the fold can conclude gracefully instead of erroring out.
    let err =
        WorkerOverlapSearchError::AdditionalEstimation(AdditionalEstimationError::Contradiction {
            upper_face: 15,
            lower_face: 12,
        });
    assert_eq!(
        err.contradiction(),
        Some(FoldContradiction {
            upper_face: 15,
            lower_face: 12,
        })
    );
    assert_eq!(
        FoldingEstimateError::WorkerOverlap(err).contradiction(),
        Some(FoldContradiction {
            upper_face: 15,
            lower_face: 12,
        })
    );

    // Structural failures stay fatal — there is nothing to render past them.
    let structural = WorkerOverlapSearchError::FinalAdditionalEstimationRequired {
        valid_count: 1,
        reduced_subface_count: 2,
    };
    assert_eq!(structural.contradiction(), None);
    assert_eq!(
        FoldingEstimateError::WorkerOverlap(structural).contradiction(),
        None
    );
}

#[test]
fn folding_a_globally_non_flat_foldable_cp_reports_a_contradiction() {
    // Real CP (no CAMV / local flat-foldability violations) that nonetheless has
    // no consistent global layer ordering. Oriedita shows this as red faces with
    // no error dialog; our fold must conclude gracefully and record the offending
    // face pair rather than aborting with WorkerOverlap(AdditionalEstimation(...)).
    let doc = ori::import_ori_json(include_str!(
        "../../../tests/fixtures/oriedita/failing_global_flat_fold.ori"
    ))
    .expect("import ori fixture");
    let segments = doc.crease_pattern.line_segments;

    let mut session = FoldingEstimateSession::new(&segments, 1);
    let estimate = session
        .folding_estimated(EstimationOrder::Order5)
        .expect("fold should conclude, not error, on a global contradiction");

    let contradiction = estimate
        .contradiction
        .expect("a global layer-ordering contradiction should be recorded");
    assert_ne!(contradiction.upper_face, contradiction.lower_face);
    // No valid layering exists: fall back to the transparent development so the
    // figure still renders.
    assert_eq!(estimate.estimation_step, EstimationStep::Step3);
    assert_eq!(estimate.discovered_fold_cases, 0);

    // The snapshot carries flat CP polygons for both faces so the editor can fill
    // them red; each must be a real (>= 3 vertex) polygon.
    let snapshot = folded_figure_snapshot_from_segments(
        &segments,
        1,
        EstimationOrder::Order5,
        FoldedFigureModel::default(),
    )
    .expect("snapshot should build");
    let faces = snapshot
        .contradiction_faces
        .expect("contradiction face geometry should be present");
    assert!(faces.upper.len() >= 3, "upper face should be a polygon");
    assert!(faces.lower.len() >= 3, "lower face should be a polygon");
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
        .expect("connected fold graph")
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

/// A pattern with several layer-ordering solutions, so navigation has somewhere
/// to go. `solution_sample_1.cp` yields 15.
fn multi_solution_session() -> FoldingEstimateSession {
    FoldingEstimateSession::new(&solution_sample_segments(), 1)
}

#[test]
fn restart_returns_to_the_first_solution() {
    let mut session = multi_solution_session();
    session
        .folding_estimated(oristudio_cp::folding::EstimationOrder::Order5)
        .expect("first");
    let first_overlap = session.estimate().overlap.clone().expect("first overlap");

    // Walk a few solutions in, then rewind.
    for _ in 0..3 {
        fold_another(&mut session).expect("advance");
    }
    assert!(session.estimate().current_fold_case > 1);

    let restarted = session.restart().expect("restart");
    assert_eq!(restarted.current_fold_case, 1);
    assert_eq!(restarted.discovered_fold_cases, 1);
    // Deterministic enumeration: the rewound solution is the one we started on.
    assert_eq!(session.estimate().overlap, Some(first_overlap));
}

#[test]
fn forward_walk_keeps_current_and_discovered_in_step() {
    let mut session = multi_solution_session();
    let mut estimate = session
        .folding_estimated(oristudio_cp::folding::EstimationOrder::Order5)
        .expect("first");
    assert_eq!(estimate.current_fold_case, estimate.discovered_fold_cases);
    while estimate.find_another_overlap_valid {
        estimate = fold_another(&mut session).expect("advance");
        // Stepping forward always lands on the newest solution, so the count and
        // the shown case only diverge after a rewind.
        assert_eq!(estimate.current_fold_case, estimate.discovered_fold_cases);
    }
    assert!(
        estimate.discovered_fold_cases > 1,
        "fixture needs >1 solution"
    );
}

#[test]
fn fold_another_wraps_to_the_first_solution_at_the_end() {
    let mut session = multi_solution_session();
    let first = session
        .folding_estimated(oristudio_cp::folding::EstimationOrder::Order5)
        .expect("first");
    let first_overlap = first.overlap.clone().expect("first overlap");

    let mut estimate = first;
    while estimate.find_another_overlap_valid {
        estimate = fold_another(&mut session).expect("advance");
    }
    let last_case = estimate.current_fold_case;
    assert!(last_case > 1);

    // One more press at the end wraps rather than dead-ending, which is what
    // upstream does.
    let wrapped = fold_another(&mut session).expect("wrap");
    assert_eq!(wrapped.current_fold_case, 1);
    assert_eq!(session.estimate().overlap, Some(first_overlap));
}

#[test]
fn fold_another_does_not_wrap_when_there_is_only_one_solution() {
    let mut session = FoldingEstimateSession::new(&square_with_diagonal(), 1);
    session
        .folding_estimated(oristudio_cp::folding::EstimationOrder::Order5)
        .expect("first");
    assert_eq!(session.estimate().discovered_fold_cases, 1);

    // Wrapping here would re-fold to exactly where we already are.
    let estimate = fold_another(&mut session).expect("another");
    assert_eq!(estimate.discovered_fold_cases, 1);
    assert_eq!(estimate.current_fold_case, 1);
}

#[test]
fn folding_estimate_to_case_seeks_backwards_by_replaying() {
    let mut session = multi_solution_session();
    session
        .folding_estimated(oristudio_cp::folding::EstimationOrder::Order5)
        .expect("first");

    // Record what case 2 looks like on the way out.
    let second = fold_another(&mut session).expect("second");
    assert_eq!(second.current_fold_case, 2);
    let second_overlap = session.estimate().overlap.clone().expect("second overlap");

    for _ in 0..3 {
        fold_another(&mut session).expect("advance");
    }
    assert!(session.estimate().current_fold_case > 2);

    folding_estimate_to_case(
        &mut session,
        2,
        oristudio_cp::folding::EstimationOrder::Order5,
    )
    .expect("seek back");

    assert_eq!(session.estimate().current_fold_case, 2);
    // Replay is exact, not merely "some solution numbered 2".
    assert_eq!(session.estimate().overlap, Some(second_overlap));
}

#[test]
fn folding_estimate_to_case_still_seeks_forwards() {
    let mut session = multi_solution_session();
    session
        .folding_estimated(oristudio_cp::folding::EstimationOrder::Order5)
        .expect("first");

    folding_estimate_to_case(
        &mut session,
        4,
        oristudio_cp::folding::EstimationOrder::Order5,
    )
    .expect("seek forward");

    assert_eq!(session.estimate().current_fold_case, 4);
    assert_eq!(session.estimate().discovered_fold_cases, 4);
}

/// The kabuto fixture folds to a stack with several layer steps, so its paper
/// render carries shadow bands — unlike a single-crease fold, whose one subface
/// has no interior step to cast onto.
fn kabuto_segments() -> Vec<LineSegment> {
    let fold: treemaker_fold::FoldDocument = serde_json::from_str(include_str!(
        "../../../tests/fixtures/flat-folder/kabuto.fold"
    ))
    .expect("kabuto fold fixture");
    fold.edges_vertices
        .iter()
        .enumerate()
        .map(|(index, edge)| {
            let a = &fold.vertices_coords[edge[0]];
            let b = &fold.vertices_coords[edge[1]];
            let color = match fold.edges_assignment.get(index).map(|value| value.as_str()) {
                Some("M") => LineColor::Red1,
                Some("V") => LineColor::Blue2,
                _ => LineColor::Black0,
            };
            LineSegment::with_color(
                Point::new(a[0] * 400.0, a[1] * 400.0),
                Point::new(b[0] * 400.0, b[1] * 400.0),
                color,
            )
        })
        .collect()
}

/// The kabuto paper render, front side only so every primitive is one pass.
fn kabuto_front_render(display_shadows: bool) -> Vec<FoldedFigureRenderPrimitive> {
    let model = FoldedFigureModel {
        display_shadows,
        ..FoldedFigureModel::default()
    };
    folded_figure_render_snapshot_from_segments(
        &kabuto_segments(),
        1,
        DisplayStyle::Paper5,
        model,
        FoldedFigureRenderOptions::default(),
    )
    .expect("kabuto paper render")
    .expect("paper primitives")
    .primitives
}

/// The closed polygons of a path primitive, one per subpath.
fn path_polygons(primitive: &FoldedFigureRenderPrimitive) -> Vec<Vec<Point>> {
    let FoldedFigureRenderGeometry::Path { commands } = &primitive.geometry else {
        return Vec::new();
    };
    let mut polygons = Vec::new();
    for command in commands {
        match command {
            RenderPathCommand::MoveTo { point } => polygons.push(vec![*point]),
            RenderPathCommand::LineTo { point } => {
                if let Some(polygon) = polygons.last_mut() {
                    polygon.push(*point);
                }
            }
            _ => {}
        }
    }
    polygons
}

fn same_polygon(a: &[Point], b: &[Point]) -> bool {
    a.len() == b.len()
        && a.iter()
            .zip(b)
            .all(|(first, second)| first.distance(*second) < 1e-9)
}

struct KabutoShadows {
    receivers: Vec<FoldedFigureRenderPrimitive>,
    faces: Vec<Vec<Point>>,
    edges: Vec<(Point, Point)>,
}

fn kabuto_shadows() -> KabutoShadows {
    let primitives = kabuto_front_render(true);
    let receivers = primitives
        .iter()
        .filter(|primitive| {
            matches!(
                primitive.style.paint,
                FoldedFigureRenderPaint::LayerShadow { .. }
            )
        })
        .cloned()
        .collect::<Vec<_>>();
    let faces = primitives
        .iter()
        .filter(|primitive| {
            primitive.kind == FoldedFigureRenderPrimitiveKind::FillPath
                && matches!(primitive.style.paint, FoldedFigureRenderPaint::Color { .. })
        })
        .flat_map(path_polygons)
        .collect::<Vec<_>>();
    let edges = primitives
        .iter()
        .filter(|primitive| primitive.kind == FoldedFigureRenderPrimitiveKind::StrokePath)
        .flat_map(path_polygons)
        .filter(|points| points.len() == 2)
        .map(|points| (points[0], points[1]))
        .collect::<Vec<_>>();
    assert!(!receivers.is_empty(), "kabuto should cast shadows");
    KabutoShadows {
        receivers,
        faces,
        edges,
    }
}

#[test]
fn shadows_need_the_model_flag() {
    let primitives = kabuto_front_render(false);
    assert!(
        !primitives.iter().any(|primitive| matches!(
            primitive.style.paint,
            FoldedFigureRenderPaint::LayerShadow { .. }
        )),
        "shadows are off by default"
    );
}

/// A shadow is painted over the paper that receives it: every subpath is one
/// of the pass's own subfaces, and no subface receives from two primitives.
#[test]
fn a_shadow_covers_subfaces_of_its_pass_and_each_subface_once() {
    let shadows = kabuto_shadows();
    let mut covered = 0;
    for receiver in &shadows.receivers {
        let polygons = path_polygons(receiver);
        assert!(!polygons.is_empty());
        for polygon in &polygons {
            assert!(
                shadows.faces.iter().any(|face| same_polygon(face, polygon)),
                "shadow subpath {polygon:?} is not a subface"
            );
            let receivers = shadows
                .receivers
                .iter()
                .filter(|other| {
                    path_polygons(other)
                        .iter()
                        .any(|p| same_polygon(p, polygon))
                })
                .count();
            assert_eq!(receivers, 1, "subface {polygon:?} receives twice");
            covered += 1;
        }
    }
    assert!(
        covered < shadows.faces.len(),
        "some paper is not in any shadow"
    );
}

/// What casts the shadow is the outline of a layer above, and every outline
/// line is a drawn paper edge; at least one of them borders the receiver.
#[test]
fn a_shadow_is_cast_by_drawn_edges_that_meet_its_paper() {
    let shadows = kabuto_shadows();
    for receiver in &shadows.receivers {
        let FoldedFigureRenderPaint::LayerShadow { occluder_edges, .. } = &receiver.style.paint
        else {
            unreachable!()
        };
        assert!(!occluder_edges.is_empty());
        let polygons = path_polygons(receiver);
        let mut touches_receiver = false;
        for edge in occluder_edges {
            assert!(
                shadows.edges.iter().any(|(a, b)| {
                    (a.distance(edge.from) < 1e-9 && b.distance(edge.to) < 1e-9)
                        || (a.distance(edge.to) < 1e-9 && b.distance(edge.from) < 1e-9)
                }),
                "occluder edge {edge:?} is not a drawn paper edge"
            );
            touches_receiver |= polygons.iter().any(|polygon| {
                polygon.iter().any(|p| p.distance(edge.from) < 1e-9)
                    && polygon.iter().any(|p| p.distance(edge.to) < 1e-9)
            });
        }
        assert!(touches_receiver, "no occluder edge borders the receiver");
    }
}

/// The reach and darkness are Oriedita's constants, carried through the
/// figure's scale, and the shadow sits between the pass's faces and its edges.
#[test]
fn a_shadow_keeps_upstreams_reach_and_sits_between_faces_and_edges() {
    let primitives = kabuto_front_render(true);
    let sequence_of = |predicate: &dyn Fn(&FoldedFigureRenderPrimitive) -> bool| {
        primitives
            .iter()
            .filter(|primitive| predicate(primitive))
            .map(|primitive| primitive.sequence)
            .collect::<Vec<_>>()
    };
    let faces = sequence_of(&|primitive| {
        matches!(primitive.style.paint, FoldedFigureRenderPaint::Color { .. })
            && primitive.kind == FoldedFigureRenderPrimitiveKind::FillPath
    });
    let shadows = sequence_of(&|primitive| {
        matches!(
            primitive.style.paint,
            FoldedFigureRenderPaint::LayerShadow { .. }
        )
    });
    let edges =
        sequence_of(&|primitive| primitive.kind == FoldedFigureRenderPrimitiveKind::StrokePath);
    assert!(faces.iter().max() < shadows.iter().min());
    assert!(shadows.iter().max() < edges.iter().min());

    let mut tallest = 0;
    for primitive in &primitives {
        if let FoldedFigureRenderPaint::LayerShadow {
            width,
            strength,
            occluder_edges,
        } = &primitive.style.paint
        {
            assert!(
                (width - 10.0).abs() < 1e-9,
                "reach is the 10-unit offset, got {width}"
            );
            assert!((strength - 50.0 / 255.0).abs() < 1e-12);
            for edge in occluder_edges {
                assert!(edge.step >= 1, "a casting edge is at least one sheet tall");
                tallest = tallest.max(edge.step);
            }
        }
    }
    // The base reach is per region; how far past it a ledge casts is the
    // renderer's reading of its height, so the height has to travel with it.
    assert!(
        tallest > 1,
        "kabuto's stacks give ledges taller than one sheet"
    );
}

/// An `n`x`n` grid of unit squares, optionally with one more square parked far
/// away from it and touching nothing.
///
/// The grid alone is Euler-exact (`faces - lines + points == 1`). The detached
/// square pushes it to 2, which the tolerance in `FoldGraph::calculate_faces`
/// (`0.005 * faces.len()`) waves through from ~200 faces up — so this is the
/// smallest shape of input that reaches the spanning walk while being
/// disconnected.
fn grid_lines(n: usize, detached_square: bool) -> Vec<LineSegment> {
    let mut segments = Vec::new();
    let side = n as f64;
    for row in 0..=n {
        let y = row as f64;
        for column in 0..n {
            let x = column as f64;
            segments.push(segment(x, y, x + 1.0, y, LineColor::Red1));
        }
    }
    for column in 0..=n {
        let x = column as f64;
        for row in 0..n {
            let y = row as f64;
            segments.push(segment(x, y, x, y + 1.0, LineColor::Blue2));
        }
    }
    if detached_square {
        let far = side + 10.0;
        segments.push(segment(far, 0.0, far + 1.0, 0.0, LineColor::Black0));
        segments.push(segment(far + 1.0, 0.0, far + 1.0, 1.0, LineColor::Black0));
        segments.push(segment(far + 1.0, 1.0, far, 1.0, LineColor::Black0));
        segments.push(segment(far, 1.0, far, 0.0, LineColor::Black0));
    }
    segments
}

/// The control: the same grid, connected, folds without complaint. Without this,
/// the test below could pass because the input is merely big.
#[test]
fn connected_grid_of_that_size_still_folds() {
    let folded = estimate_wireframe_from_segments(&grid_lines(15, false), 1)
        .expect("connected fold graph")
        .expect("folded wireframe");

    assert_eq!(folded.faces.len(), 225);
    assert!(
        folded.face_positions.iter().all(|position| *position != 0),
        "every face in a connected grid is reached by the walk"
    );
}

/// Before this was typed, the walk broke out of its BFS on an empty frontier and
/// the unreached faces came back with `associated_line: None` — which
/// `fold_movement` reads as "do not move this point". The figure drew a folded
/// grid beside an unfolded square, reported `Ok`, and said nothing.
#[test]
fn disconnected_face_graph_is_refused_rather_than_left_unfolded() {
    let segments = grid_lines(15, true);

    let error = estimate_wireframe_from_segments(&segments, 1)
        .expect_err("a disconnected fold graph must not fold");

    assert_eq!(
        error,
        FoldGraphError::DisconnectedFaces {
            reached: 225,
            unreached: 1,
        }
    );
}

/// The refusal has to reach the caller of the *fold*, not only the wireframe
/// helper: `G` runs a whole estimate, and every stage of it walks this graph.
#[test]
fn disconnected_face_graph_fails_the_whole_fold_estimate() {
    let error = folded_figure_snapshot_from_segments(
        &grid_lines(15, true),
        1,
        EstimationOrder::Order5,
        FoldedFigureModel::default(),
    )
    .expect_err("a disconnected fold graph must not produce a figure");

    assert_eq!(
        error,
        FoldingEstimateError::Setup(FoldSetupError::FoldGraph(
            FoldGraphError::DisconnectedFaces {
                reached: 225,
                unreached: 1,
            }
        ))
    );
    assert!(
        error.contradiction().is_none(),
        "a disconnected graph is not a layer-ordering contradiction, and must \
         not fall back to the transparent development the way one does"
    );
}

/// Three different things used to arrive at `Step3` / `Transparent3` with zero
/// solutions and nothing to tell them apart: a request that stopped below the
/// layer search, a search that found no valid ordering, and a contradiction that
/// was deliberately rewound to that stage. `outcome` is what tells them apart.
#[test]
fn the_transparent_development_says_why_it_is_the_answer() {
    let solved = folded_figure_snapshot_from_segments(
        &square_with_diagonal(),
        1,
        EstimationOrder::Order5,
        FoldedFigureModel::default(),
    )
    .expect("snapshot");
    assert_eq!(solved.outcome, FoldOutcome::Solved);
    assert_eq!(solved.estimation_step, EstimationStep::Step5);

    let not_attempted = folded_figure_snapshot_from_segments(
        &square_with_diagonal(),
        1,
        EstimationOrder::Order3,
        FoldedFigureModel::default(),
    )
    .expect("snapshot");
    assert_eq!(not_attempted.outcome, FoldOutcome::NotAttempted);
    assert_eq!(not_attempted.estimation_step, EstimationStep::Step3);
    assert_eq!(not_attempted.display_style, DisplayStyle::Transparent3);

    let doc = ori::import_ori_json(include_str!(
        "../../../tests/fixtures/oriedita/failing_global_flat_fold.ori"
    ))
    .expect("import ori fixture");
    let contradicted = folded_figure_snapshot_from_segments(
        &doc.crease_pattern.line_segments,
        1,
        EstimationOrder::Order5,
        FoldedFigureModel::default(),
    )
    .expect("snapshot");
    assert_eq!(contradicted.outcome, FoldOutcome::Contradiction);
    // Same stage and same style as the request that never asked. That is the
    // whole point.
    assert_eq!(contradicted.estimation_step, not_attempted.estimation_step);
    assert_eq!(contradicted.display_style, not_attempted.display_style);

    let value = serde_json::to_value(&contradicted).expect("serialized snapshot");
    assert_eq!(value["outcome"], "Contradiction");
}

/// A snapshot written before `outcome` existed still loads — `.osf` files carry
/// these, and a missing field must not fail the read.
#[test]
fn a_snapshot_without_an_outcome_reads_back_as_not_attempted() {
    let mut value = serde_json::to_value(
        folded_figure_snapshot_from_segments(
            &square_with_diagonal(),
            1,
            EstimationOrder::Order5,
            FoldedFigureModel::default(),
        )
        .expect("snapshot"),
    )
    .expect("serialize");
    value
        .as_object_mut()
        .expect("object")
        .remove("outcome")
        .expect("outcome was serialized");

    let restored: oristudio_cp::folding::FoldedFigureSnapshot =
        serde_json::from_value(value).expect("deserialize without outcome");
    assert_eq!(restored.outcome, FoldOutcome::NotAttempted);
}

// --- holes in the sheet -----------------------------------------------------

/// A 400x400 sheet with a 50x100 rectangular hole, folded in half on `x = 50`.
///
/// Reduced from the file that reported the bug
/// (`research/2026-08-31-holes-in-the-folding-pipeline.md`) to the smallest
/// shape that reproduces it: the hole's left edge lies on the fold line, so two
/// creases run from the outer boundary to the hole and the paper region is
/// simply connected. Physically, a sheet with a window in it, book-folded.
fn holed_sheet_segments() -> Vec<LineSegment> {
    let mut segments = Vec::new();
    for (ax, ay, bx, by) in [
        (-200.0, -200.0, 50.0, -200.0),
        (50.0, -200.0, 200.0, -200.0),
        (200.0, -200.0, 200.0, 200.0),
        (200.0, 200.0, 50.0, 200.0),
        (50.0, 200.0, -200.0, 200.0),
        (-200.0, 200.0, -200.0, -200.0),
        // The hole.
        (50.0, -50.0, 100.0, -50.0),
        (100.0, -50.0, 100.0, 50.0),
        (100.0, 50.0, 50.0, 50.0),
        (50.0, 50.0, 50.0, -50.0),
    ] {
        segments.push(segment(ax, ay, bx, by, LineColor::Black0));
    }
    for (ax, ay, bx, by) in [(50.0, -200.0, 50.0, -50.0), (50.0, 50.0, 50.0, 200.0)] {
        segments.push(segment(ax, ay, bx, by, LineColor::Blue2));
    }
    segments
}

/// The reported bug, end to end.
///
/// Before the hole was dropped this aborted with `SameParityAdjacentFaces`,
/// naming a crease that had nothing to do with the hole: the hole face joined
/// the dual graph as a hub, made it non-bipartite, and the BFS carried the wrong
/// parity outward from there.
#[test]
fn a_sheet_with_a_hole_in_it_folds() {
    let segments = holed_sheet_segments();

    let wireframe = estimate_wireframe_from_segments(&segments, 1)
        .expect("the arrangement traces")
        .expect("and has faces");
    assert_eq!(
        wireframe.faces.len(),
        2,
        "one paper face either side of the fold line; the hole is not paper"
    );

    let mut session = FoldingEstimateSession::new(&segments, 1);
    session
        .folding_estimated(EstimationOrder::Order5)
        .expect("a holed sheet folds");
    assert_eq!(session.estimate().outcome, FoldOutcome::Solved);
    assert!(
        session.estimate().discovered_fold_cases >= 1,
        "the layer search found no ordering"
    );
}

/// The reported file, folded.
///
/// `holed_sheet_spiral.ori` is the crease pattern the hole bug was reported on:
/// a 400x400 sheet with a 50x100 window cut out of it and a spiral of creases
/// running into the window from three sides. Before the hole stopped being
/// traced as paper it aborted with `SameParityAdjacentFaces`, naming a crease
/// three segments away from the window.
///
/// The solution count is pinned rather than described. `treemaker-flatfold` —
/// the Flat-Folder port, which has filtered hole faces since it landed — reads
/// the same one from the same geometry, so the number is a cross-check between
/// two independent solvers rather than a recording of whatever this one did.
#[test]
fn the_reported_holed_sheet_folds_with_one_layer_ordering() {
    let doc = ori::import_ori_json(include_str!(
        "../../../tests/fixtures/oriedita/holed_sheet_spiral.ori"
    ))
    .expect("import the fixture");
    let segments = doc.crease_pattern.line_segments;
    assert_eq!(segments.len(), 83);

    let wireframe = estimate_wireframe_from_segments(&segments, 1)
        .expect("the arrangement traces")
        .expect("and has faces");
    assert_eq!(
        wireframe.faces.len(),
        34,
        "34 faces of paper; the 35th region the arrangement traces is the window"
    );

    let mut session = FoldingEstimateSession::new(&segments, 1);
    session
        .folding_estimated(EstimationOrder::Order5)
        .expect("the reported sheet folds");
    assert_eq!(session.estimate().outcome, FoldOutcome::Solved);
    assert_eq!(
        session.estimate().discovered_fold_cases,
        1,
        "exactly one layer ordering, which treemaker-flatfold reads too"
    );
    assert!(
        !session.estimate().find_another_overlap_valid,
        "and no other, so the count is the whole answer rather than a prefix"
    );
}

/// A window that sits astride the fold line.
///
/// `holed_frame_collinear.ori` is a picture frame folded along one diagonal that
/// the window interrupts, so the fold line arrives as **two collinear crease
/// segments** with the hole between them. That is the shape whose dual graph
/// gains a cycle around the hole while every crease axis stays on one line —
/// the holonomy is the identity for any angle, which is why it folds at 180 here
/// and why its 3D twin is admitted at any angle in `folding3d.rs`.
///
/// It is also the smallest document that reaches the loop-gap check at all:
/// two faces, two joins, one independent cycle, and no interior vertex.
#[test]
fn a_window_astride_the_fold_line_folds() {
    let doc = ori::import_ori_json(include_str!(
        "../../../tests/fixtures/oriedita/holed_frame_collinear.ori"
    ))
    .expect("import the fixture");
    let segments = doc.crease_pattern.line_segments;
    assert_eq!(segments.len(), 10);

    let wireframe = estimate_wireframe_from_segments(&segments, 1)
        .expect("the arrangement traces")
        .expect("and has faces");
    assert_eq!(
        wireframe.faces.len(),
        2,
        "one face either side of the fold line, and no filled window"
    );

    let mut session = FoldingEstimateSession::new(&segments, 1);
    session
        .folding_estimated(EstimationOrder::Order5)
        .expect("a frame folded across its window folds");
    assert_eq!(session.estimate().outcome, FoldOutcome::Solved);
    assert_eq!(session.estimate().discovered_fold_cases, 1);
}

/// The control, and the reason the test above is about the hole rather than
/// about that particular sheet: fill the hole in with paper — same outline, same
/// fold line, now continuous — and the answer is the same.
///
/// This is the comparison that could not be made before. Filling the hole is
/// exactly what `calculate_faces` used to do on its own, and the filled sheet
/// folded; the open one aborted.
#[test]
fn the_same_sheet_with_the_hole_filled_in_folds_the_same_way() {
    let inside =
        |point: Point| (49.0..=101.0).contains(&point.x) && (-51.0..=51.0).contains(&point.y);
    let mut segments: Vec<LineSegment> = holed_sheet_segments()
        .into_iter()
        .filter(|line| !(inside(line.a) && inside(line.b)))
        .collect();
    segments.push(segment(50.0, -50.0, 50.0, 50.0, LineColor::Blue2));

    let mut session = FoldingEstimateSession::new(&segments, 1);
    session
        .folding_estimated(EstimationOrder::Order5)
        .expect("the control folds");
    assert_eq!(session.estimate().outcome, FoldOutcome::Solved);
}

/// A crease pattern carrying sub-tolerance creases still folds.
///
/// The user-visible shape of the share-link bug: select every crease, press
/// Fold, and get `fold_faces_unresolved` on a pattern that folds fine in the
/// editor it was shared from. The two documents differed only by two creases of
/// 4.6e-5 and 1.1e-4, minted by the web planarizer cutting a crease short of the
/// vertex it ends on. Both are under `Epsilon::POINT`, so the kernel welds each
/// one's endpoints into a single vertex and the crease arrives as a self-loop.
///
/// Two tails, as the reported document had, because the count decides which
/// error surfaces: one leaves the Euler sum at 1 and smuggles a corrupt face
/// through to a later check, while two put the sum out of range and clear the
/// arrangement — which is the reported `fold_faces_unresolved`. The fix is the
/// same for both, and the assertion worth making is that the fold happens.
///
/// Session-level on purpose: `fold_segments` is where a Step1 estimate becomes
/// that error, and the fold is the verb the user actually pressed.
#[test]
fn sub_tolerance_creases_do_not_stop_a_fold() {
    let seg = |ax: f64, ay: f64, bx: f64, by: f64, color| {
        LineSegment::with_color(Point::new(ax, ay), Point::new(bx, by), color)
    };
    let sound = vec![
        seg(-200.0, -200.0, 200.0, -200.0, LineColor::Black0),
        seg(200.0, -200.0, 200.0, 200.0, LineColor::Black0),
        seg(200.0, 200.0, -200.0, 200.0, LineColor::Black0),
        seg(-200.0, 200.0, -200.0, -200.0, LineColor::Black0),
        seg(-200.0, -200.0, 0.0, 0.0, LineColor::Red1),
        seg(0.0, 0.0, 200.0, 200.0, LineColor::Red1),
        seg(200.0, -200.0, 0.0, 0.0, LineColor::Blue2),
        seg(0.0, 0.0, -200.0, 200.0, LineColor::Blue2),
    ];

    let fold_all = |segments: &[LineSegment]| {
        let mut session = oristudio_cp::session::CpSession::default();
        let handle = session.load_document(oristudio_cp::CreasePatternDocument {
            crease_pattern: oristudio_cp::CreasePatternModel {
                line_segments: segments.to_vec(),
                ..Default::default()
            },
            ..Default::default()
        });
        // 1-based ids, every crease selected — what the panel sends for
        // Select All then Fold.
        let ids: Vec<usize> = (1..=segments.len()).collect();
        session.folded_figure_fold_selected(
            handle,
            &ids,
            1,
            EstimationOrder::Order5,
            FoldedFigureModel::default(),
        )
    };

    assert!(fold_all(&sound).is_ok(), "the pattern folds to begin with");

    let tail = oristudio_cp::geometry::Epsilon::POINT / 10.0;
    let mut with_tail = sound.clone();
    with_tail.push(seg(0.0, 0.0, tail, tail, LineColor::Red1));
    with_tail.push(seg(
        200.0,
        200.0,
        200.0 - tail,
        200.0 - tail,
        LineColor::Red1,
    ));

    match fold_all(&with_tail) {
        Ok(_) => {}
        Err(error) => panic!("sub-tolerance creases stopped the fold: {error}"),
    }
}

/// A figure held by a session renders from inputs derived once at fold time
/// (`FoldedRenderInputs`); the from-segments entry point derives them per
/// call. The two must agree byte for byte in every style, and across a model
/// change — the cache is a cost, never an answer.
#[test]
fn session_renders_from_cached_inputs_identically_to_the_segments_path() {
    let segments = kabuto_segments();
    let mut session = oristudio_cp::session::CpSession::default();
    let handle = session.load_document(oristudio_cp::CreasePatternDocument {
        crease_pattern: oristudio_cp::CreasePatternModel {
            line_segments: segments.clone(),
            ..Default::default()
        },
        ..Default::default()
    });
    let ids: Vec<usize> = (1..=segments.len()).collect();
    let folded = session
        .folded_figure_fold_selected(
            handle,
            &ids,
            1,
            EstimationOrder::Order5,
            FoldedFigureModel::default(),
        )
        .expect("kabuto folds");

    let recoloured = FoldedFigureModel {
        front_color: RgbColor::new(10, 20, 30),
        display_shadows: true,
        ..FoldedFigureModel::default()
    };
    let after_change = session
        .folded_figure_set_model(folded.handle, recoloured.clone())
        .expect("set model");
    assert_eq!(
        after_change.wireframe,
        estimate_wireframe_from_segments(&segments, 1).expect("wireframe"),
        "the snapshot's wireframe is the cached one, unchanged by the model"
    );

    for style in [
        DisplayStyle::Wire2,
        DisplayStyle::Transparent3,
        DisplayStyle::Paper5,
    ] {
        let cached = session
            .folded_figure_render_snapshot(
                folded.handle,
                Some(style),
                FoldedFigureRenderOptions::default(),
            )
            .expect("session render");
        let fresh = folded_figure_render_snapshot_from_segments(
            &segments,
            1,
            style,
            recoloured.clone(),
            FoldedFigureRenderOptions::default(),
        )
        .expect("segments render");
        assert!(fresh.is_some(), "{style:?} renders");
        assert_eq!(
            cached, fresh,
            "{style:?}: cached inputs changed the picture"
        );
    }
}

// --- paper scene ------------------------------------------------------------

/// The fixtures the render tests draw, plus the small ones above: a
/// single-crease square, a two-layer strip, the sample with several
/// solutions, and the kabuto's many-layer stack. (`quartered_square` is a
/// layer-order contradiction, not a figure, so it has no `Paper5` picture.)
fn paper_scene_fixtures() -> Vec<(&'static str, Vec<LineSegment>)> {
    vec![
        ("square_with_diagonal", square_with_diagonal()),
        ("two_square_strip", two_square_strip()),
        ("solution_sample", solution_sample_segments()),
        ("kabuto", kabuto_segments()),
    ]
}

fn paper_scene_and_snapshot(
    segments: &[LineSegment],
    state: FoldedFigureState,
) -> (FoldedPaperScene, FoldedFigureRenderSnapshot) {
    let model = FoldedFigureModel {
        state,
        ..FoldedFigureModel::default()
    };
    let scene = folded_figure_paper_scene_from_segments(segments, &[], 1, &model)
        .expect("paper scene")
        .expect("something to draw");
    let snapshot = folded_figure_render_snapshot_from_segments(
        segments,
        1,
        DisplayStyle::Paper5,
        model,
        FoldedFigureRenderOptions::default(),
    )
    .expect("paper render")
    .expect("paper primitives");
    (scene, snapshot)
}

/// The drawer's subface fills in stream order: the ring each traces and the
/// colour it is painted, which is the front or back colour of the face the
/// drawer chose as visible there.
fn paper_fills(snapshot: &FoldedFigureRenderSnapshot) -> Vec<(Vec<Point>, RgbaColor)> {
    snapshot
        .primitives
        .iter()
        .filter(|primitive| primitive.kind == FoldedFigureRenderPrimitiveKind::FillPath)
        .filter_map(|primitive| {
            let FoldedFigureRenderPaint::Color { color } = primitive.style.paint else {
                return None;
            };
            let FoldedFigureRenderGeometry::Path { commands } = &primitive.geometry else {
                return None;
            };
            let ring = commands
                .iter()
                .filter_map(|command| match command {
                    RenderPathCommand::MoveTo { point } | RenderPathCommand::LineTo { point } => {
                        Some(*point)
                    }
                    _ => None,
                })
                .collect();
            Some((ring, color))
        })
        .collect()
}

/// D6's assurance: the scene shows the faces the oracle-checked drawer shows.
/// Every subface polygon is the ring of the drawer's `fill_path` for it, in
/// the drawer's order, and the top of its stack is the face whose side the
/// drawer painted — on both sides of the figure.
#[test]
fn paper_scene_subfaces_are_the_drawers_fills_with_their_visible_face_on_top() {
    for (name, segments) in paper_scene_fixtures() {
        for state in [FoldedFigureState::Front0, FoldedFigureState::Back1] {
            let (scene, snapshot) = paper_scene_and_snapshot(&segments, state);
            let fills = paper_fills(&snapshot);
            assert!(
                !fills.is_empty(),
                "{name} {state:?}: the drawer paints nothing"
            );
            assert_eq!(
                scene.subfaces.len(),
                fills.len(),
                "{name} {state:?}: one scene subface per drawer fill"
            );
            for (index, (subface, (ring, color))) in scene.subfaces.iter().zip(&fills).enumerate() {
                assert_eq!(
                    subface.polygon, *ring,
                    "{name} {state:?}: subface {index} is not the drawer's ring"
                );
                let top = subface.faces_top_to_bottom[0];
                let face = &scene.faces[top];
                let painted = if face.front_up {
                    RgbaColor::from_rgb(FoldedFigureModel::default().front_color)
                } else {
                    RgbaColor::from_rgb(FoldedFigureModel::default().back_color)
                };
                assert_eq!(
                    *color, painted,
                    "{name} {state:?}: subface {index} painted a side its top face {top} does not show"
                );
            }
        }
    }
}

/// A face's outline is its folded ring, and each outline edge carries the
/// crease it came from: paper edges are borders, mountains and valleys are
/// folds. Nothing flat ever appears, because no 0° line reaches the fold.
#[test]
fn paper_scene_faces_carry_their_folded_outline_and_edge_roles() {
    for (name, segments) in paper_scene_fixtures() {
        let (scene, _) = paper_scene_and_snapshot(&segments, FoldedFigureState::Front0);
        let wireframe = estimate_wireframe_from_segments(&segments, 1)
            .expect("wireframe")
            .expect("faces");
        assert_eq!(
            scene.faces.len(),
            wireframe.faces.len(),
            "{name}: one scene face per kernel face"
        );

        let mut folds = 0;
        let mut borders = 0;
        for (index, (face, ring)) in scene.faces.iter().zip(&wireframe.faces).enumerate() {
            assert_eq!(
                face.outline.len(),
                ring.len(),
                "{name}: face {index} outline"
            );
            assert_eq!(face.edges.len(), ring.len(), "{name}: face {index} edges");
            assert!(
                face.outline.len() >= 3,
                "{name}: face {index} is not a polygon"
            );
            for (edge_index, edge) in face.edges.iter().enumerate() {
                let next = (edge_index + 1) % face.outline.len();
                assert_eq!(edge.from, face.outline[edge_index]);
                assert_eq!(edge.to, face.outline[next]);
                match edge.kind {
                    FoldedPaperEdgeKind::Border => borders += 1,
                    FoldedPaperEdgeKind::Fold => folds += 1,
                    FoldedPaperEdgeKind::Flat => {
                        panic!("{name}: face {index} edge {edge_index} reports a flat crease")
                    }
                }
            }
        }
        assert!(folds > 0, "{name}: a folded figure has fold edges");
        assert!(borders > 0, "{name}: a sheet has a border");
        assert!(
            scene.aux_lines.is_empty(),
            "{name}: no aux line reaches the fold"
        );
        assert!(scene.sheet > 0.0, "{name}: the sheet has an extent");
    }
}

/// Schema 2: a face names the wireframe point behind each outline point — the
/// ring the wireframe walks, point for point. So the two faces of a fold name
/// its ends alike and place them alike, while corners of a stack folded onto
/// one place keep different names: a painter can part those and still keep a
/// fold joined.
#[test]
fn paper_scene_faces_name_the_wireframe_point_behind_each_outline_point() {
    for (name, segments) in paper_scene_fixtures() {
        let wireframe = estimate_wireframe_from_segments(&segments, 1)
            .expect("wireframe")
            .expect("faces");
        for state in [FoldedFigureState::Front0, FoldedFigureState::Back1] {
            let (scene, _) = paper_scene_and_snapshot(&segments, state);
            assert_eq!(scene.schema_version, 3, "{name} {state:?}");
            let mut placed: Vec<Option<Point>> = vec![None; wireframe.points.len()];
            for (index, (face, ring)) in scene.faces.iter().zip(&wireframe.faces).enumerate() {
                assert_eq!(face.points, *ring, "{name} {state:?}: face {index}");
                for (point, &vertex) in face.outline.iter().zip(&face.points) {
                    let at = placed[vertex].get_or_insert(*point);
                    assert_eq!(
                        at, point,
                        "{name} {state:?}: vertex {vertex} is in two places"
                    );
                }
            }

            // Each fold is the edge of exactly one other face, which names its
            // ends as this one does.
            let mut folds = 0;
            for (index, face) in scene.faces.iter().enumerate() {
                let count = face.points.len();
                for (edge_index, edge) in face.edges.iter().enumerate() {
                    if edge.kind != FoldedPaperEdgeKind::Fold {
                        continue;
                    }
                    folds += 1;
                    let ends = [
                        face.points[edge_index],
                        face.points[(edge_index + 1) % count],
                    ];
                    let across = scene
                        .faces
                        .iter()
                        .enumerate()
                        .filter(|(other, _)| *other != index)
                        .filter(|(_, other)| {
                            let n = other.points.len();
                            (0..n).any(|k| {
                                let pair = [other.points[k], other.points[(k + 1) % n]];
                                pair == ends || pair == [ends[1], ends[0]]
                            })
                        })
                        .count();
                    assert_eq!(
                        across, 1,
                        "{name} {state:?}: face {index} edge {edge_index} is a fold of {across} other faces"
                    );
                }
            }
            assert!(folds > 0, "{name} {state:?}: not vacuous, the figure folds");

            // Not keyed by position: some place holds two different vertices.
            let tolerance = 1e-9 * scene.sheet;
            let placed = placed.iter().flatten().collect::<Vec<_>>();
            let stacked = placed
                .iter()
                .enumerate()
                .any(|(i, a)| placed[i + 1..].iter().any(|b| a.distance(**b) <= tolerance));
            assert!(
                stacked,
                "{name} {state:?}: a fold lays two corners on one place"
            );
        }
    }
}

/// Schema 3: `sheet_points` places every wireframe point on the unfolded
/// sheet, so each face's map from the sheet to the scene can be fitted from
/// its own corners. That map is the fold — a reflection chain, then the
/// render camera — so it is a similarity at the model's scale, mirrored
/// exactly when the face shows the other side from a face that is not, and
/// it takes every corner of the face where its outline has it. The faces laid
/// out on the sheet tile it: their areas add up to the paper's.
#[test]
fn paper_scene_sheet_points_map_each_face_to_the_scene_by_a_similarity() {
    for (name, segments) in paper_scene_fixtures() {
        let wireframe = estimate_wireframe_from_segments(&segments, 1)
            .expect("wireframe")
            .expect("faces");
        for state in [FoldedFigureState::Front0, FoldedFigureState::Back1] {
            for (scale, rotation) in [(1.0, 0.0), (2.5, 30.0)] {
                let model = FoldedFigureModel {
                    state,
                    scale,
                    rotation,
                    ..FoldedFigureModel::default()
                };
                let scene = folded_figure_paper_scene_from_segments(&segments, &[], 1, &model)
                    .expect("paper scene")
                    .expect("something to draw");
                let label = format!("{name} {state:?} ×{scale} {rotation}°");
                assert_eq!(scene.schema_version, 3, "{label}");
                assert_eq!(
                    scene.sheet_points.len(),
                    wireframe.points.len(),
                    "{label}: one sheet point per wireframe point"
                );

                let tolerance = 1e-7 * scene.sheet.max(1.0);
                let mut reference: Option<(bool, bool)> = None;
                let mut sheet_area = 0.0;
                for (index, face) in scene.faces.iter().enumerate() {
                    let sheet = face
                        .points
                        .iter()
                        .map(|&vertex| scene.sheet_points[vertex])
                        .collect::<Vec<_>>();
                    sheet_area += ring_area(&sheet).abs();
                    // In the crease pattern's own frame: a sheet mirrored or turned
                    // fits every face as well, but turns an affine spread's axis.
                    for corner in &sheet {
                        assert!(
                            segments.iter().any(|segment| {
                                segment.a.distance(*corner) <= tolerance
                                    || segment.b.distance(*corner) <= tolerance
                            }),
                            "{label}: face {index} lies off the crease pattern at {corner:?}"
                        );
                    }
                    let map = fit_affine(&sheet, &face.outline)
                        .unwrap_or_else(|| panic!("{label}: face {index} has no area"));
                    for (corner, at) in sheet.iter().zip(&face.outline) {
                        assert!(
                            apply_affine(&map, *corner).distance(*at) <= tolerance,
                            "{label}: face {index} is not one affine map from the sheet"
                        );
                    }
                    let [[a, b], [c, d]] = map.0;
                    let column_x = (a * a + c * c).sqrt();
                    let column_y = (b * b + d * d).sqrt();
                    assert!(
                        (column_x - scale).abs() <= 1e-9 * scale
                            && (column_y - scale).abs() <= 1e-9 * scale
                            && (a * b + c * d).abs() <= 1e-9 * scale * scale,
                        "{label}: face {index} is not a similarity at the model's scale"
                    );
                    let mirrored = a * d - b * c < 0.0;
                    match reference {
                        None => reference = Some((mirrored, face.front_up)),
                        Some((first_mirrored, first_front_up)) => assert_eq!(
                            mirrored != first_mirrored,
                            face.front_up != first_front_up,
                            "{label}: face {index} is mirrored against the side it shows"
                        ),
                    }
                }

                let (mut min, mut max) = (
                    Point::new(f64::INFINITY, f64::INFINITY),
                    Point::new(f64::NEG_INFINITY, f64::NEG_INFINITY),
                );
                for point in &scene.sheet_points {
                    min = Point::new(min.x.min(point.x), min.y.min(point.y));
                    max = Point::new(max.x.max(point.x), max.y.max(point.y));
                }
                let paper = (max.x - min.x) * (max.y - min.y);
                assert!(
                    (sheet_area - paper).abs() <= 1e-9 * paper,
                    "{label}: the faces on the sheet cover {sheet_area}, the paper {paper}"
                );
            }
        }
    }
}

/// A linear part and a translation.
struct Affine([[f64; 2]; 2], Point);

fn apply_affine(map: &Affine, point: Point) -> Point {
    let [[a, b], [c, d]] = map.0;
    Point::new(
        a * point.x + b * point.y + map.1.x,
        c * point.x + d * point.y + map.1.y,
    )
}

/// The affine map taking `from` onto `to`, through the first corner and the
/// two others that span the most area; `None` for a ring with none.
fn fit_affine(from: &[Point], to: &[Point]) -> Option<Affine> {
    let mut best = None;
    let mut most = 0.0;
    for i in 1..from.len() {
        for j in i + 1..from.len() {
            let u = Point::new(from[i].x - from[0].x, from[i].y - from[0].y);
            let v = Point::new(from[j].x - from[0].x, from[j].y - from[0].y);
            let area = (u.x * v.y - u.y * v.x).abs();
            if area > most {
                most = area;
                best = Some((i, j));
            }
        }
    }
    let (i, j) = best?;
    let u = Point::new(from[i].x - from[0].x, from[i].y - from[0].y);
    let v = Point::new(from[j].x - from[0].x, from[j].y - from[0].y);
    let big_u = Point::new(to[i].x - to[0].x, to[i].y - to[0].y);
    let big_v = Point::new(to[j].x - to[0].x, to[j].y - to[0].y);
    let det = u.x * v.y - u.y * v.x;
    let inverse = [[v.y / det, -v.x / det], [-u.y / det, u.x / det]];
    let linear = [
        [
            big_u.x * inverse[0][0] + big_v.x * inverse[1][0],
            big_u.x * inverse[0][1] + big_v.x * inverse[1][1],
        ],
        [
            big_u.y * inverse[0][0] + big_v.y * inverse[1][0],
            big_u.y * inverse[0][1] + big_v.y * inverse[1][1],
        ],
    ];
    let origin = Point::new(
        to[0].x - (linear[0][0] * from[0].x + linear[0][1] * from[0].y),
        to[0].y - (linear[1][0] * from[0].x + linear[1][1] * from[0].y),
    );
    Some(Affine(linear, origin))
}

/// Shoelace: the signed area of a closed ring.
fn ring_area(ring: &[Point]) -> f64 {
    let mut twice = 0.0;
    for (index, point) in ring.iter().enumerate() {
        let next = ring[(index + 1) % ring.len()];
        twice += point.x * next.y - next.x * point.y;
    }
    twice / 2.0
}

/// The scene's coordinates are the render snapshot's for the model's state:
/// the rear pass mirrors and moves the figure, and the scene follows the same
/// camera, so a subface ring matches the drawer's on the back exactly as on
/// the front (the test above), and differs from the front's.
#[test]
fn paper_scene_back_side_is_mirrored_through_the_rear_camera() {
    let segments = kabuto_segments();
    let (front, _) = paper_scene_and_snapshot(&segments, FoldedFigureState::Front0);
    let (back, _) = paper_scene_and_snapshot(&segments, FoldedFigureState::Back1);
    assert!(front.subfaces.len() == back.subfaces.len());
    assert!(
        front
            .subfaces
            .iter()
            .zip(&back.subfaces)
            .any(|(a, b)| a.polygon != b.polygon),
        "the rear pass moves the figure"
    );
    assert_eq!(front.sheet, back.sheet, "the sheet is the same paper");
}

/// An auxiliary line laid across each fixture's sheet, clear of every vertex,
/// and the number of creases it crosses in the flat sheet.
fn aux_line_across(segments: &[LineSegment]) -> (LineSegment, usize) {
    let (mut min, mut max) = (
        Point::new(f64::INFINITY, f64::INFINITY),
        Point::new(f64::NEG_INFINITY, f64::NEG_INFINITY),
    );
    for segment in segments {
        for point in [segment.a, segment.b] {
            min = Point::new(min.x.min(point.x), min.y.min(point.y));
            max = Point::new(max.x.max(point.x), max.y.max(point.y));
        }
    }
    let (w, h) = (max.x - min.x, max.y - min.y);
    let aux = LineSegment::with_color(
        Point::new(min.x + 0.113 * w, min.y + 0.071 * h),
        Point::new(max.x - 0.087 * w, max.y - 0.137 * h),
        LineColor::Cyan3,
    );
    let crossings = segments
        .iter()
        .filter(|segment| {
            determine_line_segment_intersection(&aux, segment) == Intersection::Intersects1
        })
        .count();
    (aux, crossings)
}

/// Phase 5's contract for the flat figure: the document's aux lines ride
/// through the fold face by face. Each piece lies inside its face's folded
/// outline on both sides of the figure, and a line that crosses `n` creases
/// on the sheet arrives as `n + 1` pieces — one per face it visits.
#[test]
fn paper_scene_aux_lines_lie_inside_their_faces_one_piece_per_face_crossed() {
    for (name, segments) in paper_scene_fixtures() {
        let (aux, crossings) = aux_line_across(&segments);
        for state in [FoldedFigureState::Front0, FoldedFigureState::Back1] {
            let model = FoldedFigureModel {
                state,
                ..FoldedFigureModel::default()
            };
            let scene = folded_figure_paper_scene_from_segments(
                &segments,
                std::slice::from_ref(&aux),
                1,
                &model,
            )
            .expect("paper scene")
            .expect("something to draw");
            assert_eq!(
                scene.aux_lines.len(),
                crossings + 1,
                "{name} {state:?}: pieces for a line crossing {crossings} creases"
            );
            let mut faces_visited = scene
                .aux_lines
                .iter()
                .map(|piece| piece.face)
                .collect::<Vec<_>>();
            faces_visited.sort_unstable();
            faces_visited.dedup();
            assert_eq!(
                faces_visited.len(),
                scene.aux_lines.len(),
                "{name} {state:?}: a face carries one piece of a line through it"
            );
            for piece in &scene.aux_lines {
                let face = scene
                    .faces
                    .get(piece.face)
                    .unwrap_or_else(|| panic!("{name} {state:?}: {piece:?} names no face"));
                let outline = Polygon::new(face.outline.clone());
                assert!(
                    piece.from.distance(piece.to) > Epsilon::POINT,
                    "{name} {state:?}: {piece:?} is shorter than the point tolerance"
                );
                assert_eq!(
                    outline.inside(Point::mid(piece.from, piece.to)),
                    PolygonIntersection::Inside,
                    "{name} {state:?}: {piece:?} does not run inside its face"
                );
                for end in [piece.from, piece.to] {
                    assert_ne!(
                        outline.inside(end),
                        PolygonIntersection::Outside,
                        "{name} {state:?}: {piece:?} ends outside its face"
                    );
                }
            }
        }
    }
}

/// The session folds only the document's foldable creases, and its scene
/// still carries the document's aux lines — the ones the document held when
/// the figure was folded, whatever the selection named.
#[test]
fn session_paper_scene_folds_the_documents_aux_lines() {
    let mut segments = square_with_diagonal();
    let aux = LineSegment::with_color(Point::new(0.3, 0.1), Point::new(0.1, 0.3), LineColor::Cyan3);
    segments.push(aux.clone());
    let mut session = oristudio_cp::session::CpSession::default();
    let handle = session.load_document(oristudio_cp::CreasePatternDocument {
        crease_pattern: oristudio_cp::CreasePatternModel {
            line_segments: segments.clone(),
            ..Default::default()
        },
        ..Default::default()
    });
    // Every id, aux line included: the selection filter keeps the creases.
    let ids: Vec<usize> = (1..=segments.len()).collect();
    let folded = session
        .folded_figure_fold_selected(
            handle,
            &ids,
            1,
            EstimationOrder::Order5,
            FoldedFigureModel::default(),
        )
        .expect("the square folds");
    let scene = session
        .folded_figure_paper_scene(folded.handle, None)
        .expect("session scene")
        .expect("drawn");
    assert_eq!(scene.faces.len(), 2, "the aux line did not split a face");
    assert_eq!(scene.aux_lines.len(), 2, "one piece per triangle");
    assert_eq!(
        scene,
        folded_figure_paper_scene_from_segments(
            &segments[..5],
            &[aux],
            1,
            &FoldedFigureModel::default()
        )
        .expect("segments scene")
        .expect("drawn"),
        "the session's aux lines are the document's"
    );
}

/// An aux line drawn after the fold is on the paper, not folded, so it shows
/// without a refold: named, the document answers for the scene's aux lines as
/// it stands now; unnamed, the fold-time capture does.
#[test]
fn session_paper_scene_follows_the_documents_aux_lines_as_they_are_now() {
    let segments = square_with_diagonal();
    let mut session = oristudio_cp::session::CpSession::default();
    let handle = session.load_document(oristudio_cp::CreasePatternDocument {
        crease_pattern: oristudio_cp::CreasePatternModel {
            line_segments: segments.clone(),
            ..Default::default()
        },
        ..Default::default()
    });
    let ids: Vec<usize> = (1..=segments.len()).collect();
    let folded = session
        .folded_figure_fold_selected(
            handle,
            &ids,
            1,
            EstimationOrder::Order5,
            FoldedFigureModel::default(),
        )
        .expect("the square folds");
    let aux = LineSegment::with_color(Point::new(0.3, 0.1), Point::new(0.1, 0.3), LineColor::Cyan3);
    session
        .insert_line_segments(handle, std::slice::from_ref(&aux))
        .expect("draw an aux line");

    let at_fold = session
        .folded_figure_paper_scene(folded.handle, None)
        .expect("session scene")
        .expect("drawn");
    assert!(at_fold.aux_lines.is_empty(), "the fold held no aux line");
    let now = session
        .folded_figure_paper_scene(folded.handle, Some(handle))
        .expect("session scene")
        .expect("drawn");
    assert_eq!(now.aux_lines.len(), 2, "one piece per triangle");
    assert_eq!(
        now,
        folded_figure_paper_scene_from_segments(
            &segments,
            &[aux],
            1,
            &FoldedFigureModel::default()
        )
        .expect("segments scene")
        .expect("drawn"),
        "the aux lines are the document's, through the fold's faces"
    );
    // The creases are still the fold's: only the aux lines moved.
    assert_eq!(now.faces, at_fold.faces);
    assert!(
        session
            .folded_figure_paper_scene(folded.handle, Some(99))
            .is_err()
    );
}

/// The session accessor answers from the fold's cached inputs and solved
/// ordering — the same thing the from-segments path searches — and follows
/// the model the figure holds now, like the render snapshot does.
#[test]
fn session_paper_scene_matches_the_segments_path_and_follows_the_model() {
    let segments = kabuto_segments();
    let mut session = oristudio_cp::session::CpSession::default();
    let handle = session.load_document(oristudio_cp::CreasePatternDocument {
        crease_pattern: oristudio_cp::CreasePatternModel {
            line_segments: segments.clone(),
            ..Default::default()
        },
        ..Default::default()
    });
    let ids: Vec<usize> = (1..=segments.len()).collect();
    let folded = session
        .folded_figure_fold_selected(
            handle,
            &ids,
            1,
            EstimationOrder::Order5,
            FoldedFigureModel::default(),
        )
        .expect("kabuto folds");

    let front = session
        .folded_figure_paper_scene(folded.handle, None)
        .expect("session scene")
        .expect("drawn");
    let fresh =
        folded_figure_paper_scene_from_segments(&segments, &[], 1, &FoldedFigureModel::default())
            .expect("segments scene")
            .expect("drawn");
    assert_eq!(front, fresh, "cached inputs changed the scene");

    let back_model = FoldedFigureModel {
        state: FoldedFigureState::Back1,
        scale: 2.0,
        ..FoldedFigureModel::default()
    };
    session
        .folded_figure_set_model(folded.handle, back_model.clone())
        .expect("set model");
    let back = session
        .folded_figure_paper_scene(folded.handle, None)
        .expect("session scene")
        .expect("drawn");
    assert!(back.flipped, "the scene follows the model's side");
    assert_eq!(
        back.sheet,
        front.sheet * 2.0,
        "the sheet follows the model's scale"
    );
    assert_eq!(
        back,
        folded_figure_paper_scene_from_segments(&segments, &[], 1, &back_model)
            .expect("segments scene")
            .expect("drawn")
    );
}

/// A fold whose layers cannot be ordered has no `Paper5` picture, and the
/// session says so without searching again. The render snapshot still draws
/// the transparent development the fold rewound to, so a caller that asks for
/// both gets a figure and no scene — never a re-raised contradiction, and
/// never a second run of a search the fold already exhausted.
#[test]
fn session_paper_scene_declines_a_fold_with_no_layer_ordering() {
    let doc = ori::import_ori_json(include_str!(
        "../../../tests/fixtures/oriedita/failing_global_flat_fold.ori"
    ))
    .expect("import ori fixture");
    let segments = doc.crease_pattern.line_segments;
    let mut session = oristudio_cp::session::CpSession::default();
    let handle = session.load_document(oristudio_cp::CreasePatternDocument {
        crease_pattern: oristudio_cp::CreasePatternModel {
            line_segments: segments.clone(),
            ..Default::default()
        },
        ..Default::default()
    });
    let ids: Vec<usize> = (1..=segments.len()).collect();
    let folded = session
        .folded_figure_fold_selected(
            handle,
            &ids,
            1,
            EstimationOrder::Order5,
            FoldedFigureModel::default(),
        )
        .expect("the fold concludes gracefully");
    assert_eq!(folded.snapshot.outcome, FoldOutcome::Contradiction);
    assert_eq!(folded.snapshot.display_style, DisplayStyle::Transparent3);

    let drawn = session
        .folded_figure_render_snapshot(folded.handle, None, FoldedFigureRenderOptions::default())
        .expect("render snapshot")
        .expect("the transparent development draws");
    assert!(!drawn.primitives.is_empty());
    assert_eq!(
        session
            .folded_figure_paper_scene(folded.handle, None)
            .expect("no error for a state the drawer renders"),
        None,
        "a fold with no ordering has no paper scene"
    );
}

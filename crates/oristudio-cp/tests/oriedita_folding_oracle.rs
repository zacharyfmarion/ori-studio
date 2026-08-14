use oristudio_cp::folding::{
    AdditionalEstimation, AdditionalEstimationError, ChainPermutationGenerator,
    EquivalenceConditionSet, FoldingEstimateSession, HierarchyRelation, InitialHierarchy,
    InitialHierarchyError, SubFace, SubFaceConfiguration, SubFacePermutationSearch,
    WorkerOverlapEnumerator, additional_estimation_from_segments, configure_subfaces_from_segments,
    duplicate_estimation_order_for_display, equivalence_condition_candidates_from_segments,
    estimate_wireframe_from_segments, folding_estimate_case_filename,
    folding_estimate_from_segments, folding_estimate_save_batch, folding_estimate_to_case,
    initial_hierarchy_from_segments, overlap_search_from_segments,
    overlap_search_from_segments_with_swap, possible_overlap_search_for_ordered_subfaces,
    possible_overlap_search_for_subfaces, possible_overlap_search_for_subfaces_with_swap,
    prepare_subface_segments, prioritize_subfaces, two_colored_folding_estimate_from_segments,
    two_colored_subface_segments_from_segments,
};
use oristudio_cp::geometry::{LineColor, LineSegment, Point};
use oristudio_cp::io::cp;
use std::path::{Path, PathBuf};
use std::process::Command;

#[test]
fn wireframe_folding_matches_oriedita_oracle() {
    let Some(oracle) = folding_oracle() else {
        eprintln!("skipping Oriedita folding oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };

    for starting_face in [1, 0] {
        let segments = square_with_diagonal();
        let folded = estimate_wireframe_from_segments(&segments, starting_face)
            .expect("connected fold graph")
            .expect("Rust wireframe folding should succeed");
        let mut args = vec![
            "wireframe-folding-summary".to_string(),
            starting_face.to_string(),
            segments.len().to_string(),
        ];
        push_segment_args(&mut args, &segments);
        let oracle_args = args.iter().map(String::as_str).collect::<Vec<_>>();

        assert_eq!(
            wireframe_summary(&folded),
            run_oracle(&oracle, &oracle_args)
        );
    }
}

#[test]
fn subface_arrangement_preparation_matches_oriedita_oracle() {
    let Some(oracle) = folding_oracle() else {
        eprintln!("skipping Oriedita folding oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };

    for segments in [
        vec![
            segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
            segment(5.0, -5.0, 5.0, 5.0, LineColor::Blue2),
            segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
            segment(2.0, 2.0, 2.0, 2.0, LineColor::Black0),
        ],
        vec![
            segment(0.0, 0.0, 10.0, 0.0, LineColor::Red1),
            segment(5.0, 0.0, 5.0, 5.0, LineColor::Blue2),
            segment(10.0, 0.0, 0.0, 0.0, LineColor::Red1),
        ],
        vec![
            segment(0.0, 0.0, 1.0, 0.0, LineColor::Black0),
            segment(0.0, 0.00005, 1.0, 0.00005, LineColor::Black0),
        ],
    ] {
        // No cancel is bound in a test, so `check` is inert and this cannot fail.
        let prepared = prepare_subface_segments(&segments).expect("not cancellable in a test");
        let mut args = vec![
            "split-subface-arrangement".to_string(),
            segments.len().to_string(),
        ];
        push_segment_args(&mut args, &segments);
        let oracle_args = args.iter().map(String::as_str).collect::<Vec<_>>();

        assert_eq!(
            line_segment_summary(&prepared),
            run_oracle(&oracle, &oracle_args)
        );
    }
}

#[test]
fn two_colored_subface_arrangement_matches_oriedita_oracle() {
    let Some(oracle) = folding_oracle() else {
        eprintln!("skipping Oriedita folding oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };

    for starting_face in [1, 0] {
        let segments = two_square_strip();
        let prepared = two_colored_subface_segments_from_segments(&segments, starting_face)
            .expect("connected fold graph")
            .expect("two-colored subface arrangement");
        let mut args = vec![
            "two-colored-subface-arrangement".to_string(),
            starting_face.to_string(),
            segments.len().to_string(),
        ];
        push_segment_args(&mut args, &segments);
        let oracle_args = args.iter().map(String::as_str).collect::<Vec<_>>();

        assert_eq!(
            line_segment_summary(&prepared),
            run_oracle(&oracle, &oracle_args)
        );
    }
}

#[test]
fn two_colored_folding_estimate_matches_oriedita_oracle() {
    let Some(oracle) = folding_oracle() else {
        eprintln!("skipping Oriedita folding oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };

    let segments = two_square_strip();
    let estimate =
        two_colored_folding_estimate_from_segments(&segments, 1).expect("two-colored estimate");
    let mut args = vec![
        "two-colored-estimate-summary".to_string(),
        "1".to_string(),
        segments.len().to_string(),
    ];
    push_segment_args(&mut args, &segments);
    let oracle_args = args.iter().map(String::as_str).collect::<Vec<_>>();

    assert_eq!(
        folding_estimate_summary(&estimate),
        run_oracle(&oracle, &oracle_args)
    );
}

#[test]
fn subface_configuration_matches_oriedita_oracle() {
    let Some(oracle) = folding_oracle() else {
        eprintln!("skipping Oriedita folding oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };

    for starting_face in [1, 0] {
        let segments = square_with_diagonal();
        let configuration = configure_subfaces_from_segments(&segments, starting_face)
            .expect("connected fold graph")
            .expect("Rust subface configuration should succeed");
        let mut args = vec![
            "subface-configuration-summary".to_string(),
            starting_face.to_string(),
            segments.len().to_string(),
        ];
        push_segment_args(&mut args, &segments);
        let oracle_args = args.iter().map(String::as_str).collect::<Vec<_>>();

        assert_eq!(
            subface_configuration_summary(&configuration),
            run_oracle(&oracle, &oracle_args)
        );
    }
}

#[test]
fn initial_hierarchy_matches_oriedita_oracle() {
    let Some(oracle) = folding_oracle() else {
        eprintln!("skipping Oriedita folding oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };

    for (starting_face, segments) in [
        (1, square_with_diagonal()),
        (1, square_with_blue_diagonal()),
        (0, square_with_diagonal()),
    ] {
        let hierarchy = initial_hierarchy_from_segments(&segments, starting_face)
            .expect("Rust initial hierarchy should not have a parity error")
            .expect("Rust initial hierarchy should succeed");
        let mut args = vec![
            "initial-hierarchy-summary".to_string(),
            starting_face.to_string(),
            segments.len().to_string(),
        ];
        push_segment_args(&mut args, &segments);
        let oracle_args = args.iter().map(String::as_str).collect::<Vec<_>>();

        assert_eq!(
            initial_hierarchy_summary(Ok(&hierarchy)),
            run_oracle(&oracle, &oracle_args)
        );
    }
}

#[test]
fn equivalence_condition_candidates_match_oriedita_oracle() {
    let Some(oracle) = folding_oracle() else {
        eprintln!("skipping Oriedita folding oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };

    for (starting_face, segments) in [(1, quartered_square()), (0, quartered_square())] {
        let conditions = equivalence_condition_candidates_from_segments(&segments, starting_face)
            .expect("Rust equivalence condition generation should not have a parity error")
            .expect("Rust equivalence condition generation should succeed");
        let mut args = vec![
            "equivalence-candidates-summary".to_string(),
            starting_face.to_string(),
            segments.len().to_string(),
        ];
        push_segment_args(&mut args, &segments);
        let oracle_args = args.iter().map(String::as_str).collect::<Vec<_>>();

        assert_eq!(
            equivalence_condition_summary(&conditions),
            run_oracle(&oracle, &oracle_args)
        );
    }
}

#[test]
fn additional_estimation_matches_oriedita_oracle() {
    let Some(oracle) = folding_oracle() else {
        eprintln!("skipping Oriedita folding oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };

    for starting_face in [1, 0] {
        let segments = square_with_diagonal();
        let estimation = additional_estimation_from_segments(&segments, starting_face)
            .expect("Rust additional estimation should not have an initial hierarchy error")
            .expect("Rust additional estimation should succeed");
        let mut args = vec![
            "additional-estimation-summary".to_string(),
            starting_face.to_string(),
            segments.len().to_string(),
        ];
        push_segment_args(&mut args, &segments);
        let oracle_args = args.iter().map(String::as_str).collect::<Vec<_>>();

        assert_eq!(
            additional_estimation_summary(Ok(&estimation)),
            run_oracle(&oracle, &oracle_args)
        );
    }
}

#[test]
fn chain_permutation_generator_matches_oriedita_oracle() {
    let Some(oracle) = folding_oracle() else {
        eprintln!("skipping Oriedita folding oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };

    for case in [
        PermutationCase {
            digits: 3,
            guides: &[],
            top: &[],
            bottom: &[],
            limit: 8,
        },
        PermutationCase {
            digits: 4,
            guides: &[(1, 2), (2, 3)],
            top: &[],
            bottom: &[],
            limit: 8,
        },
        PermutationCase {
            digits: 4,
            guides: &[(1, 3)],
            top: &[2, 4],
            bottom: &[1, 3],
            limit: 8,
        },
    ] {
        let mut generator = ChainPermutationGenerator::new(case.digits);
        for (upper, lower) in case.guides {
            generator.add_guide(*upper, *lower).expect("valid guide");
        }
        generator
            .set_top_indices(case.top.iter().copied())
            .expect("valid top indices");
        generator
            .set_bottom_indices(case.bottom.iter().copied())
            .expect("valid bottom indices");
        generator.initialize();

        let mut args = vec![
            "chain-permutation-summary".to_string(),
            case.digits.to_string(),
            case.guides.len().to_string(),
        ];
        for (upper, lower) in case.guides {
            args.push(upper.to_string());
            args.push(lower.to_string());
        }
        args.push(joined_or_dash(case.top));
        args.push(joined_or_dash(case.bottom));
        args.push(case.limit.to_string());
        let oracle_args = args.iter().map(String::as_str).collect::<Vec<_>>();

        assert_eq!(
            chain_permutation_summary(generator, case.limit),
            run_oracle(&oracle, &oracle_args)
        );
    }
}

#[test]
fn chain_permutation_temp_guides_match_oriedita_oracle() {
    let Some(oracle) = folding_oracle() else {
        eprintln!("skipping Oriedita folding oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };

    let mut generator = ChainPermutationGenerator::new(4);
    generator.add_guide(1, 3).expect("valid guide");
    generator.initialize();

    let args = [
        "chain-permutation-temp-summary",
        "4",
        "1",
        "1",
        "3",
        "-",
        "-",
        "2",
        "2",
        "1",
        "2",
        "4",
    ];

    assert_eq!(
        chain_permutation_temp_summary(generator, 2, 2, 1, 2, 4),
        run_oracle(&oracle, &args)
    );
}

#[test]
fn subface_guide_permutations_match_oriedita_oracle() {
    let Some(oracle) = folding_oracle() else {
        eprintln!("skipping Oriedita folding oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };

    for case in [
        SubFaceGuideCase {
            faces_total: 4,
            face_ids: &[0, 1, 2, 3],
            relations: &[(0, 1), (1, 2), (0, 2)],
            limit: 10,
        },
        SubFaceGuideCase {
            faces_total: 5,
            face_ids: &[1, 2, 4],
            relations: &[(1, 4), (2, 4)],
            limit: 8,
        },
    ] {
        let hierarchy = InitialHierarchy {
            faces_total: case.faces_total,
            relations: case
                .relations
                .iter()
                .map(|(upper_face, lower_face)| HierarchyRelation {
                    upper_face: *upper_face,
                    lower_face: *lower_face,
                })
                .collect(),
        };
        let mut search = SubFacePermutationSearch::new(case.face_ids.to_vec());
        search.set_guide_map(&hierarchy, None).expect("guide map");

        let mut args = vec![
            "subface-guide-permutation-summary".to_string(),
            case.faces_total.to_string(),
            case.face_ids.len().to_string(),
        ];
        for face_id in case.face_ids {
            args.push(face_id.to_string());
        }
        args.push(case.relations.len().to_string());
        for (upper_face, lower_face) in case.relations {
            args.push(upper_face.to_string());
            args.push(lower_face.to_string());
        }
        args.push(case.limit.to_string());
        let oracle_args = args.iter().map(String::as_str).collect::<Vec<_>>();

        assert_eq!(
            subface_guide_summary(search, case.limit),
            run_oracle(&oracle, &oracle_args)
        );
    }
}

#[test]
fn subface_overlap_search_matches_oriedita_oracle() {
    let Some(oracle) = folding_oracle() else {
        eprintln!("skipping Oriedita folding oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };

    for case in [
        SubFaceOverlapCase {
            faces_total: 3,
            face_ids: &[0, 1, 2],
            relations: &[(2, 0)],
            triple_conditions: &[],
            quadruple_conditions: &[],
        },
        SubFaceOverlapCase {
            faces_total: 3,
            face_ids: &[0, 1, 2],
            relations: &[(1, 0)],
            triple_conditions: &[(0, 1, 0, 2)],
            quadruple_conditions: &[],
        },
        // The cases below all pass the 2000-permutation mark, which is where
        // `SubFace.possible_overlapping_search` hands over to the
        // CombinationGenerator. Every one of them was verified to cross it (the
        // reported permutation count is > 2000), so this is the parity gate on
        // the accelerator itself, not just on the brute-force path.
        //
        // Forbidding all six orderings of the faces {0, 1, 2} leaves the subface
        // with no valid stacking at all, so the accelerator has to exhaust its
        // constraint search and report that.
        SubFaceOverlapCase {
            faces_total: 8,
            face_ids: &[0, 1, 2, 3, 4, 5, 6, 7],
            relations: &[],
            triple_conditions: &[
                (0, 1, 0, 2),
                (0, 2, 0, 1),
                (1, 2, 1, 0),
                (1, 0, 1, 2),
                (2, 0, 2, 1),
                (2, 1, 2, 0),
            ],
            quadruple_conditions: &[],
        },
        SubFaceOverlapCase {
            faces_total: 9,
            face_ids: &[0, 1, 2, 3, 4, 5, 6, 7, 8],
            relations: &[],
            triple_conditions: &[
                (0, 1, 0, 2),
                (0, 2, 0, 1),
                (1, 2, 1, 0),
                (1, 0, 1, 2),
                (2, 0, 2, 1),
                (2, 1, 2, 0),
            ],
            quadruple_conditions: &[],
        },
        // The same set minus one condition, so exactly one ordering of
        // {0, 1, 2} survives: the accelerator has to find it and feed it back to
        // the permutation generator as guides.
        SubFaceOverlapCase {
            faces_total: 9,
            face_ids: &[0, 1, 2, 3, 4, 5, 6, 7, 8],
            relations: &[],
            triple_conditions: &[
                (0, 1, 0, 2),
                (0, 2, 0, 1),
                (1, 2, 1, 0),
                (1, 0, 1, 2),
                (2, 0, 2, 1),
            ],
            quadruple_conditions: &[],
        },
        // Mixed 3EC/4EC, so the accelerator builds a QuaternaryConstraint too.
        SubFaceOverlapCase {
            faces_total: 9,
            face_ids: &[0, 1, 2, 3, 4, 5, 6, 7, 8],
            relations: &[],
            triple_conditions: &[
                (7, 3, 7, 0),
                (2, 3, 2, 5),
                (5, 0, 5, 6),
                (3, 0, 3, 5),
                (5, 0, 5, 3),
                (1, 7, 1, 4),
                (2, 8, 2, 1),
            ],
            quadruple_conditions: &[(5, 2, 6, 3)],
        },
    ] {
        let hierarchy = InitialHierarchy {
            faces_total: case.faces_total,
            relations: case
                .relations
                .iter()
                .map(|(upper_face, lower_face)| HierarchyRelation {
                    upper_face: *upper_face,
                    lower_face: *lower_face,
                })
                .collect(),
        };
        let conditions = EquivalenceConditionSet {
            triple_conditions: case
                .triple_conditions
                .iter()
                .map(|(a, b, c, d)| oristudio_cp::folding::EquivalenceCondition {
                    a: *a,
                    b: *b,
                    c: *c,
                    d: *d,
                })
                .collect(),
            quadruple_conditions: case
                .quadruple_conditions
                .iter()
                .map(|(a, b, c, d)| oristudio_cp::folding::EquivalenceCondition {
                    a: *a,
                    b: *b,
                    c: *c,
                    d: *d,
                })
                .collect(),
        };
        let mut search = SubFacePermutationSearch::new(case.face_ids.to_vec());
        search
            .set_guide_map(&hierarchy, Some(&conditions))
            .expect("guide map");

        let mut args = vec![
            "subface-overlap-search-summary".to_string(),
            case.faces_total.to_string(),
            case.face_ids.len().to_string(),
        ];
        for face_id in case.face_ids {
            args.push(face_id.to_string());
        }
        args.push(case.relations.len().to_string());
        for (upper_face, lower_face) in case.relations {
            args.push(upper_face.to_string());
            args.push(lower_face.to_string());
        }
        args.push(case.triple_conditions.len().to_string());
        for (a, b, c, d) in case.triple_conditions {
            args.push(a.to_string());
            args.push(b.to_string());
            args.push(c.to_string());
            args.push(d.to_string());
        }
        args.push(case.quadruple_conditions.len().to_string());
        for (a, b, c, d) in case.quadruple_conditions {
            args.push(a.to_string());
            args.push(b.to_string());
            args.push(c.to_string());
            args.push(d.to_string());
        }
        let oracle_args = args.iter().map(String::as_str).collect::<Vec<_>>();

        assert_eq!(
            subface_overlap_summary(search, &hierarchy),
            run_oracle(&oracle, &oracle_args)
        );
    }
}

/// A fixed-seed differential sweep over subfaces hard enough to reach the
/// CombinationGenerator.
///
/// The hand-picked cases above pin specific behaviours; this pins the search as
/// a whole. Each case forbids most orderings of one triple of faces, which is
/// what starves the permutation generator and forces the switch, and the whole
/// summary — outcome, exact permutation count, and the exact final permutation —
/// has to match Oriedita's.
#[test]
fn combination_generator_sweep_matches_oriedita_oracle() {
    let Some(oracle) = folding_oracle() else {
        eprintln!("skipping Oriedita folding oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };

    let mut rng = SweepRng::new(0x9E37_79B9_7F4A_7C15);
    let mut crossed = 0usize;

    for _ in 0..60 {
        let face_count = 8 + rng.below(3);
        let face_ids = (0..face_count).collect::<Vec<_>>();

        let core = rng.sample(face_count, 3);
        let (x, y, z) = (core[0], core[1], core[2]);
        let mut triple_conditions = vec![
            (x, y, x, z),
            (x, z, x, y),
            (y, z, y, x),
            (y, x, y, z),
            (z, x, z, y),
            (z, y, z, x),
        ];
        for _ in 0..rng.below(3) {
            let index = rng.below(triple_conditions.len());
            triple_conditions.remove(index);
        }
        for _ in 0..rng.below(4) {
            let pick = rng.sample(face_count, 3);
            triple_conditions.push((pick[0], pick[1], pick[0], pick[2]));
        }

        let mut quadruple_conditions = Vec::new();
        for _ in 0..rng.below(3) {
            let pick = rng.sample(face_count, 4);
            quadruple_conditions.push((pick[0], pick[1], pick[2], pick[3]));
        }

        let hierarchy = InitialHierarchy {
            faces_total: face_count,
            relations: Vec::new(),
        };
        let conditions = EquivalenceConditionSet {
            triple_conditions: triple_conditions
                .iter()
                .map(|(a, b, c, d)| oristudio_cp::folding::EquivalenceCondition {
                    a: *a,
                    b: *b,
                    c: *c,
                    d: *d,
                })
                .collect(),
            quadruple_conditions: quadruple_conditions
                .iter()
                .map(|(a, b, c, d)| oristudio_cp::folding::EquivalenceCondition {
                    a: *a,
                    b: *b,
                    c: *c,
                    d: *d,
                })
                .collect(),
        };

        let mut search = SubFacePermutationSearch::new(face_ids.clone());
        search
            .set_guide_map(&hierarchy, Some(&conditions))
            .expect("guide map");

        let mut args = vec![
            "subface-overlap-search-summary".to_string(),
            face_count.to_string(),
            face_count.to_string(),
        ];
        for face_id in &face_ids {
            args.push(face_id.to_string());
        }
        args.push("0".to_string());
        args.push(triple_conditions.len().to_string());
        for (a, b, c, d) in &triple_conditions {
            args.push(a.to_string());
            args.push(b.to_string());
            args.push(c.to_string());
            args.push(d.to_string());
        }
        args.push(quadruple_conditions.len().to_string());
        for (a, b, c, d) in &quadruple_conditions {
            args.push(a.to_string());
            args.push(b.to_string());
            args.push(c.to_string());
            args.push(d.to_string());
        }
        let oracle_args = args.iter().map(String::as_str).collect::<Vec<_>>();

        let expected = run_oracle(&oracle, &oracle_args);
        if expected
            .split('|')
            .nth(2)
            .and_then(|count| count.parse::<usize>().ok())
            .is_some_and(|count| count > 2000)
        {
            crossed += 1;
        }
        assert_eq!(
            subface_overlap_summary(search, &hierarchy),
            expected,
            "faces {face_count}, 3EC {triple_conditions:?}, 4EC {quadruple_conditions:?}"
        );
    }

    assert!(
        crossed >= 10,
        "the sweep reached the CombinationGenerator in only {crossed} of 60 cases, so it is no \
         longer covering what it was written to cover"
    );
}

/// xorshift64, so the sweep above is reproducible without a dependency.
struct SweepRng(u64);

impl SweepRng {
    fn new(seed: u64) -> Self {
        Self(seed)
    }

    fn next_value(&mut self) -> u64 {
        let mut value = self.0;
        value ^= value << 13;
        value ^= value >> 7;
        value ^= value << 17;
        self.0 = value;
        value
    }

    fn below(&mut self, bound: usize) -> usize {
        (self.next_value() % bound as u64) as usize
    }

    /// `count` distinct values from `0..total`, by partial Fisher-Yates.
    fn sample(&mut self, total: usize, count: usize) -> Vec<usize> {
        let mut pool = (0..total).collect::<Vec<_>>();
        for index in 0..count {
            let pick = index + self.below(total - index);
            pool.swap(index, pick);
        }
        pool.truncate(count);
        pool
    }
}

#[test]
fn subface_priority_matches_oriedita_oracle() {
    let Some(oracle) = folding_oracle() else {
        eprintln!("skipping Oriedita folding oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };

    for case in [
        SubFacePriorityCase {
            faces_total: 4,
            subfaces: &[&[0usize, 1], &[1usize, 2, 3], &[0usize, 1, 2, 3]],
            relations: &[],
        },
        SubFacePriorityCase {
            faces_total: 5,
            subfaces: &[&[0usize, 2, 4], &[1usize, 2], &[0usize, 1, 4]],
            relations: &[(0, 4)],
        },
    ] {
        let hierarchy = InitialHierarchy {
            faces_total: case.faces_total,
            relations: case
                .relations
                .iter()
                .map(|(upper_face, lower_face)| HierarchyRelation {
                    upper_face: *upper_face,
                    lower_face: *lower_face,
                })
                .collect(),
        };
        let subfaces = case
            .subfaces
            .iter()
            .map(|face_ids| SubFace {
                face_ids: face_ids.to_vec(),
            })
            .collect::<Vec<_>>();
        let reduced = (0..subfaces.len()).collect::<Vec<_>>();
        let priority = prioritize_subfaces(&subfaces, &reduced, &hierarchy);

        let mut args = vec![
            "subface-priority-summary".to_string(),
            case.faces_total.to_string(),
            case.subfaces.len().to_string(),
        ];
        for face_ids in case.subfaces {
            args.push(face_ids.len().to_string());
            for face_id in *face_ids {
                args.push(face_id.to_string());
            }
        }
        args.push(case.relations.len().to_string());
        for (upper_face, lower_face) in case.relations {
            args.push(upper_face.to_string());
            args.push(lower_face.to_string());
        }
        let oracle_args = args.iter().map(String::as_str).collect::<Vec<_>>();

        assert_eq!(
            subface_priority_summary(&priority, &subfaces),
            run_oracle(&oracle, &oracle_args)
        );
    }
}

#[test]
fn worker_overlap_search_matches_oriedita_no_swap_oracle() {
    let Some(oracle) = folding_oracle() else {
        eprintln!("skipping Oriedita folding oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };

    let case = WorkerOverlapCase {
        faces_total: 3,
        subfaces: &[&[0usize, 1, 2]],
        relations: &[(2, 0)],
        triple_conditions: &[],
        quadruple_conditions: &[],
    };
    let hierarchy = InitialHierarchy {
        faces_total: case.faces_total,
        relations: case
            .relations
            .iter()
            .map(|(upper_face, lower_face)| HierarchyRelation {
                upper_face: *upper_face,
                lower_face: *lower_face,
            })
            .collect(),
    };
    let conditions = EquivalenceConditionSet {
        triple_conditions: Vec::new(),
        quadruple_conditions: Vec::new(),
    };
    let subfaces = case
        .subfaces
        .iter()
        .map(|face_ids| SubFace {
            face_ids: face_ids.to_vec(),
        })
        .collect::<Vec<_>>();
    let reduced = (0..subfaces.len()).collect::<Vec<_>>();
    let search =
        possible_overlap_search_for_subfaces(&subfaces, &reduced, &hierarchy, Some(&conditions))
            .expect("worker overlap search");

    let args = worker_overlap_args("worker-overlap-search-summary", &case);
    let oracle_args = args.iter().map(String::as_str).collect::<Vec<_>>();

    assert_eq!(
        worker_overlap_summary(&search),
        run_oracle(&oracle, &oracle_args)
    );
}

#[test]
fn worker_overlap_search_with_swap_matches_oriedita_oracle() {
    let Some(oracle) = folding_oracle() else {
        eprintln!("skipping Oriedita folding oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };

    let case = WorkerOverlapCase {
        faces_total: 7,
        subfaces: &[&[0usize, 1, 2, 3], &[4, 5, 6]],
        relations: &[],
        triple_conditions: &[(4, 5, 4, 6), (5, 4, 5, 6), (6, 4, 6, 5)],
        quadruple_conditions: &[],
    };
    let hierarchy = InitialHierarchy {
        faces_total: case.faces_total,
        relations: Vec::new(),
    };
    let conditions = EquivalenceConditionSet {
        triple_conditions: case
            .triple_conditions
            .iter()
            .map(|(a, b, c, d)| oristudio_cp::folding::EquivalenceCondition {
                a: *a,
                b: *b,
                c: *c,
                d: *d,
            })
            .collect(),
        quadruple_conditions: Vec::new(),
    };
    let subfaces = case
        .subfaces
        .iter()
        .map(|face_ids| SubFace {
            face_ids: face_ids.to_vec(),
        })
        .collect::<Vec<_>>();
    let reduced = (0..subfaces.len()).collect::<Vec<_>>();
    let search = possible_overlap_search_for_subfaces_with_swap(
        &subfaces,
        &reduced,
        &hierarchy,
        Some(&conditions),
    )
    .expect("worker overlap search");

    let args = worker_overlap_args("worker-overlap-search-swap-summary", &case);
    let oracle_args = args.iter().map(String::as_str).collect::<Vec<_>>();

    assert_eq!(
        worker_overlap_summary_with_order(&search),
        run_oracle(&oracle, &oracle_args)
    );
}

#[test]
fn worker_overlap_final_recovery_matches_oriedita_oracle() {
    let Some(oracle) = folding_oracle() else {
        eprintln!("skipping Oriedita folding oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };

    let case = WorkerOverlapCase {
        faces_total: 3,
        subfaces: &[&[0usize, 1], &[1, 2], &[0, 1, 2]],
        relations: &[(2, 0)],
        triple_conditions: &[],
        quadruple_conditions: &[],
    };
    let hierarchy = InitialHierarchy {
        faces_total: case.faces_total,
        relations: vec![HierarchyRelation {
            upper_face: 2,
            lower_face: 0,
        }],
    };
    let subfaces = case
        .subfaces
        .iter()
        .map(|face_ids| SubFace {
            face_ids: face_ids.to_vec(),
        })
        .collect::<Vec<_>>();
    let search = possible_overlap_search_for_ordered_subfaces(&subfaces, 2, &hierarchy, None, true)
        .expect("worker overlap search");

    let args = worker_overlap_ordered_args("worker-overlap-ordered-summary", &case, 2, true);
    let oracle_args = args.iter().map(String::as_str).collect::<Vec<_>>();

    assert_eq!(
        worker_overlap_summary_with_order(&search),
        run_oracle(&oracle, &oracle_args)
    );
}

#[test]
fn worker_overlap_enumerator_sequence_matches_oriedita_oracle() {
    let Some(oracle) = folding_oracle() else {
        eprintln!("skipping Oriedita folding oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };

    let case = WorkerOverlapCase {
        faces_total: 3,
        subfaces: &[&[0usize, 1], &[1, 2], &[0, 1, 2]],
        relations: &[(2, 0)],
        triple_conditions: &[],
        quadruple_conditions: &[],
    };
    let hierarchy = InitialHierarchy {
        faces_total: case.faces_total,
        relations: vec![HierarchyRelation {
            upper_face: 2,
            lower_face: 0,
        }],
    };
    let subfaces = case
        .subfaces
        .iter()
        .map(|face_ids| SubFace {
            face_ids: face_ids.to_vec(),
        })
        .collect::<Vec<_>>();
    let enumerator =
        WorkerOverlapEnumerator::from_ordered_subfaces(&subfaces, &[0, 1, 2], 2, &hierarchy, None)
            .expect("worker overlap enumerator");
    let actions = [
        WorkerOverlapSequenceAction::Search(true),
        WorkerOverlapSequenceAction::Next(3),
        WorkerOverlapSequenceAction::Search(false),
    ];
    let args = worker_overlap_ordered_sequence_args(&case, 2, &actions);
    let oracle_args = args.iter().map(String::as_str).collect::<Vec<_>>();

    assert_eq!(
        worker_overlap_enumerator_sequence_summary(enumerator, &actions),
        run_oracle(&oracle, &oracle_args)
    );
}

#[test]
fn worker_overlap_from_segments_matches_oriedita_no_swap_oracle() {
    let Some(oracle) = folding_oracle() else {
        eprintln!("skipping Oriedita folding oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };

    for starting_face in [1, 0] {
        let segments = square_with_diagonal();
        let search = overlap_search_from_segments(&segments, starting_face)
            .expect("worker overlap search should not fail")
            .expect("worker overlap search");
        let mut args = vec![
            "worker-overlap-from-segments-summary".to_string(),
            starting_face.to_string(),
            segments.len().to_string(),
        ];
        push_segment_args(&mut args, &segments);
        let oracle_args = args.iter().map(String::as_str).collect::<Vec<_>>();

        assert_eq!(
            worker_overlap_summary(&search),
            run_oracle(&oracle, &oracle_args)
        );
    }
}

#[test]
fn worker_overlap_from_segments_with_swap_matches_oriedita_oracle() {
    let Some(oracle) = folding_oracle() else {
        eprintln!("skipping Oriedita folding oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };

    for starting_face in [1, 0] {
        let segments = square_with_diagonal();
        let search = overlap_search_from_segments_with_swap(&segments, starting_face)
            .expect("worker overlap search should not fail")
            .expect("worker overlap search");
        let mut args = vec![
            "worker-overlap-from-segments-swap-summary".to_string(),
            starting_face.to_string(),
            segments.len().to_string(),
        ];
        push_segment_args(&mut args, &segments);
        let oracle_args = args.iter().map(String::as_str).collect::<Vec<_>>();

        assert_eq!(
            worker_overlap_summary(&search),
            run_oracle(&oracle, &oracle_args)
        );
    }
}

#[test]
fn folding_estimate_first_solution_matches_oriedita_oracle() {
    let Some(oracle) = folding_oracle() else {
        eprintln!("skipping Oriedita folding oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };

    let segments = square_with_diagonal();
    let estimate = folding_estimate_from_segments(
        &segments,
        1,
        oristudio_cp::folding::EstimationOrder::Order5,
    )
    .expect("folding estimate");
    let mut args = vec![
        "folding-estimate-summary".to_string(),
        "1".to_string(),
        "5".to_string(),
        segments.len().to_string(),
    ];
    push_segment_args(&mut args, &segments);
    let oracle_args = args.iter().map(String::as_str).collect::<Vec<_>>();

    assert_eq!(
        folding_estimate_summary(&estimate),
        run_oracle(&oracle, &oracle_args)
    );
}

#[test]
fn folding_estimate_sequence_matches_oriedita_order6_oracle() {
    let Some(oracle) = folding_oracle() else {
        eprintln!("skipping Oriedita folding oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };

    let segments = square_with_diagonal();
    let mut session = FoldingEstimateSession::new(&segments, 1);
    let orders = [
        oristudio_cp::folding::EstimationOrder::Order5,
        oristudio_cp::folding::EstimationOrder::Order6,
    ];
    let mut args = vec![
        "folding-estimate-sequence-summary".to_string(),
        "1".to_string(),
        orders.len().to_string(),
        "5".to_string(),
        "6".to_string(),
        segments.len().to_string(),
    ];
    push_segment_args(&mut args, &segments);
    let oracle_args = args.iter().map(String::as_str).collect::<Vec<_>>();

    assert_eq!(
        folding_estimate_sequence_summary(&mut session, &orders),
        run_oracle(&oracle, &oracle_args)
    );
}

#[test]
fn folding_estimate_fresh_order6_matches_oriedita_oracle() {
    let Some(oracle) = folding_oracle() else {
        eprintln!("skipping Oriedita folding oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };

    let segments = square_with_diagonal();
    let estimate = folding_estimate_from_segments(
        &segments,
        1,
        oristudio_cp::folding::EstimationOrder::Order6,
    )
    .expect("folding estimate");
    let mut args = vec![
        "folding-estimate-summary".to_string(),
        "1".to_string(),
        "6".to_string(),
        segments.len().to_string(),
    ];
    push_segment_args(&mut args, &segments);
    let oracle_args = args.iter().map(String::as_str).collect::<Vec<_>>();

    assert_eq!(
        folding_estimate_summary(&estimate),
        run_oracle(&oracle, &oracle_args)
    );
}

#[test]
fn folding_estimate_specific_matches_oriedita_oracle() {
    let Some(oracle) = folding_oracle() else {
        eprintln!("skipping Oriedita folding oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };

    let segments = square_with_diagonal();
    let mut session = FoldingEstimateSession::new(&segments, 1);
    let batch = folding_estimate_to_case(
        &mut session,
        3,
        oristudio_cp::folding::EstimationOrder::Order5,
    )
    .expect("specific folding estimate");
    let mut args = vec![
        "folding-estimate-specific-summary".to_string(),
        "1".to_string(),
        "3".to_string(),
        "5".to_string(),
        segments.len().to_string(),
    ];
    push_segment_args(&mut args, &segments);
    let oracle_args = args.iter().map(String::as_str).collect::<Vec<_>>();

    assert_eq!(
        folding_estimate_batch_summary("specific_case", &batch, session.estimate()),
        run_oracle(&oracle, &oracle_args)
    );
}

#[test]
fn folding_estimate_specific_solution_sample_matches_oriedita_oracle() {
    let Some(oracle) = folding_oracle() else {
        eprintln!("skipping Oriedita folding oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };

    let segments = solution_sample_segments();
    let mut session = FoldingEstimateSession::new(&segments, 1);
    let batch = folding_estimate_to_case(
        &mut session,
        17,
        oristudio_cp::folding::EstimationOrder::Order5,
    )
    .expect("specific folding estimate");
    let mut args = vec![
        "folding-estimate-specific-summary".to_string(),
        "1".to_string(),
        "17".to_string(),
        "5".to_string(),
        segments.len().to_string(),
    ];
    push_segment_args(&mut args, &segments);
    let oracle_args = args.iter().map(String::as_str).collect::<Vec<_>>();

    assert_eq!(session.estimate().discovered_fold_cases, 16);
    assert_eq!(
        folding_estimate_batch_summary("specific_case", &batch, session.estimate()),
        run_oracle(&oracle, &oracle_args)
    );
}

#[test]
fn folding_estimate_save_batch_matches_oriedita_oracle() {
    let Some(oracle) = folding_oracle() else {
        eprintln!("skipping Oriedita folding oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };

    let segments = square_with_diagonal();
    let mut session = FoldingEstimateSession::new(&segments, 1);
    let batch = folding_estimate_save_batch(&mut session, 100).expect("save batch estimate");
    let mut args = vec![
        "folding-estimate-save-batch-summary".to_string(),
        "1".to_string(),
        "100".to_string(),
        segments.len().to_string(),
    ];
    push_segment_args(&mut args, &segments);
    let oracle_args = args.iter().map(String::as_str).collect::<Vec<_>>();

    assert_eq!(
        folding_estimate_batch_summary("batch_case", &batch, session.estimate()),
        run_oracle(&oracle, &oracle_args)
    );
}

#[test]
fn folding_estimate_case_filename_matches_oriedita_oracle() {
    let Some(oracle) = folding_oracle() else {
        eprintln!("skipping Oriedita folding oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };

    for filename in ["/tmp/folded.image.png", "/tmp/folded-image"] {
        let args = ["folding-estimate-case-filename", filename, "12"];
        assert_eq!(
            format!(
                "case_filename|{}\n",
                folding_estimate_case_filename(filename, 12)
            ),
            run_oracle(&oracle, &args)
        );
    }
}

#[test]
fn duplicate_estimation_order_matches_oriedita_oracle() {
    let Some(oracle) = folding_oracle() else {
        eprintln!("skipping Oriedita folding oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };

    for style in [
        oristudio_cp::folding::DisplayStyle::None0,
        oristudio_cp::folding::DisplayStyle::Development1,
        oristudio_cp::folding::DisplayStyle::Wire2,
        oristudio_cp::folding::DisplayStyle::Transparent3,
        oristudio_cp::folding::DisplayStyle::Development4,
        oristudio_cp::folding::DisplayStyle::Paper5,
    ] {
        let style_name = display_style_name(style);
        let args = ["duplicate-estimation-order", style_name];
        assert_eq!(
            format!(
                "duplicate_order|ORDER_{}\n",
                estimation_order_value(duplicate_estimation_order_for_display(style))
            ),
            run_oracle(&oracle, &args)
        );
    }
}

#[test]
fn subface_swapper_matches_oriedita_oracle() {
    let Some(oracle) = folding_oracle() else {
        eprintln!("skipping Oriedita folding oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };

    let counters = [0usize, 0, 2, 0];
    let actions = [
        SwapperAction::Visit(0),
        SwapperAction::Record(3),
        SwapperAction::Process(4),
        SwapperAction::Estimate(1),
        SwapperAction::Record(2),
        SwapperAction::Process(4),
    ];
    let mut args = vec![
        "subface-swapper-summary".to_string(),
        counters.len().to_string(),
    ];
    for counter in counters {
        args.push(counter.to_string());
    }
    args.push(actions.len().to_string());
    for action in actions {
        match action {
            SwapperAction::Visit(index) => {
                args.push("visit".to_string());
                args.push(index.to_string());
            }
            SwapperAction::Record(index) => {
                args.push("record".to_string());
                args.push(index.to_string());
            }
            SwapperAction::Process(max) => {
                args.push("process".to_string());
                args.push(max.to_string());
            }
            SwapperAction::Estimate(index) => {
                args.push("estimate".to_string());
                args.push(index.to_string());
            }
        }
    }
    let oracle_args = args.iter().map(String::as_str).collect::<Vec<_>>();

    assert_eq!(
        subface_swapper_summary(&[0, 0, 2, 0], &actions),
        run_oracle(&oracle, &oracle_args)
    );
}

fn folding_oracle() -> Option<PathBuf> {
    std::env::var("ORIEDITA_GEOMETRY_ORACLE")
        .or_else(|_| std::env::var("ORIEDITA_ORACLE"))
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

fn run_oracle(oracle: &Path, args: &[&str]) -> String {
    let output = Command::new(oracle)
        .args(args)
        .output()
        .unwrap_or_else(|err| panic!("failed to run Oriedita folding oracle {oracle:?}: {err}"));

    assert!(
        output.status.success(),
        "Oriedita folding oracle failed with status {:?}: {}",
        output.status.code(),
        String::from_utf8_lossy(&output.stderr)
    );

    String::from_utf8(output.stdout).expect("oracle stdout should be valid UTF-8")
}

fn wireframe_summary(folded: &oristudio_cp::folding::FoldedWireframe) -> String {
    let mut output = String::new();
    output.push_str(&format!(
        "wireframe|{}|{}|{}|{}\n",
        folded.points.len(),
        folded.lines.len(),
        folded.faces.len(),
        folded.starting_face
    ));
    for (index, point) in folded.points.iter().enumerate() {
        output.push_str(&format!(
            "vertex|{}|{}|{}\n",
            index,
            java_double_string(point.x),
            java_double_string(point.y)
        ));
    }
    for (index, line) in folded.lines.iter().enumerate() {
        output.push_str(&format!(
            "edge|{}|{}|{}|{}\n",
            index,
            line.begin,
            line.end,
            line.color.number()
        ));
    }
    for (index, face) in folded.faces.iter().enumerate() {
        let points = face
            .iter()
            .map(|point| point.to_string())
            .collect::<Vec<_>>()
            .join(",");
        output.push_str(&format!("face|{}|{}\n", index, points));
        output.push_str(&format!(
            "face_position|{}|{}\n",
            index, folded.face_positions[index]
        ));
    }
    output
}

fn push_segment_args(args: &mut Vec<String>, segments: &[LineSegment]) {
    for segment in segments {
        args.push(segment.a.x.to_string());
        args.push(segment.a.y.to_string());
        args.push(segment.b.x.to_string());
        args.push(segment.b.y.to_string());
        args.push(segment.color.number().to_string());
    }
}

fn line_segment_summary(segments: &[LineSegment]) -> String {
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

fn subface_configuration_summary(configuration: &SubFaceConfiguration) -> String {
    let mut output = String::new();
    output.push_str(&format!(
        "subfaces|{}|{}\n",
        configuration.subfaces.len(),
        configuration.face_id_count_max
    ));
    for (index, subface) in configuration.subfaces.iter().enumerate() {
        output.push_str(&format!(
            "subface|{}|{}\n",
            index,
            joined_ids(&subface.face_ids)
        ));
    }
    output.push_str(&format!(
        "reduced|{}\n",
        configuration.reduced_subface_indices.len()
    ));
    for (index, subface_index) in configuration.reduced_subface_indices.iter().enumerate() {
        output.push_str(&format!(
            "reduced_subface|{}|{}|{}\n",
            index,
            subface_index,
            joined_ids(&configuration.subfaces[*subface_index].face_ids)
        ));
    }
    output
}

fn initial_hierarchy_summary(
    hierarchy: Result<&InitialHierarchy, InitialHierarchyError>,
) -> String {
    match hierarchy {
        Ok(hierarchy) => {
            let mut output = String::new();
            output.push_str(&format!(
                "hierarchy|{}|{}\n",
                hierarchy.faces_total,
                hierarchy.relations.len()
            ));
            for relation in &hierarchy.relations {
                output.push_str(&format!(
                    "relation|{}|{}\n",
                    relation.upper_face, relation.lower_face
                ));
            }
            output
        }
        Err(InitialHierarchyError::SameParityAdjacentFaces {
            line,
            first_face,
            second_face,
        }) => format!("hierarchy_error|same_parity|{line}|{first_face}|{second_face}\n"),
        // Unreachable: no cancel is bound in a test. Given its own string rather
        // than folded into an existing arm so that if it ever did occur, the
        // oracle comparison would fail loudly instead of matching by accident.
        Err(InitialHierarchyError::Cancelled) => "hierarchy_error|cancelled\n".to_string(),
    }
}

fn equivalence_condition_summary(conditions: &EquivalenceConditionSet) -> String {
    let mut output = String::new();
    output.push_str(&format!(
        "equivalence|{}|{}\n",
        conditions.triple_conditions.len(),
        conditions.quadruple_conditions.len()
    ));
    for condition in &conditions.triple_conditions {
        output.push_str(&format!(
            "triple|{}|{}|{}|{}\n",
            condition.a, condition.b, condition.c, condition.d
        ));
    }
    for condition in &conditions.quadruple_conditions {
        output.push_str(&format!(
            "quad|{}|{}|{}|{}\n",
            condition.a, condition.b, condition.c, condition.d
        ));
    }
    output
}

fn additional_estimation_summary(
    estimation: Result<&AdditionalEstimation, AdditionalEstimationError>,
) -> String {
    match estimation {
        Ok(estimation) => {
            let mut output = String::new();
            output.push_str(&format!(
                "additional|{}|{}\n",
                estimation.hierarchy.faces_total,
                estimation.hierarchy.relations.len()
            ));
            for relation in &estimation.hierarchy.relations {
                output.push_str(&format!(
                    "relation|{}|{}\n",
                    relation.upper_face, relation.lower_face
                ));
            }
            output
        }
        Err(error) => format!("additional_error|{error:?}\n"),
    }
}

struct PermutationCase<'a> {
    digits: usize,
    guides: &'a [(usize, usize)],
    top: &'a [usize],
    bottom: &'a [usize],
    limit: usize,
}

struct SubFaceGuideCase<'a> {
    faces_total: usize,
    face_ids: &'a [usize],
    relations: &'a [(usize, usize)],
    limit: usize,
}

struct SubFaceOverlapCase<'a> {
    faces_total: usize,
    face_ids: &'a [usize],
    relations: &'a [(usize, usize)],
    triple_conditions: &'a [(usize, usize, usize, usize)],
    quadruple_conditions: &'a [(usize, usize, usize, usize)],
}

struct SubFacePriorityCase<'a> {
    faces_total: usize,
    subfaces: &'a [&'a [usize]],
    relations: &'a [(usize, usize)],
}

struct WorkerOverlapCase<'a> {
    faces_total: usize,
    subfaces: &'a [&'a [usize]],
    relations: &'a [(usize, usize)],
    triple_conditions: &'a [(usize, usize, usize, usize)],
    quadruple_conditions: &'a [(usize, usize, usize, usize)],
}

fn worker_overlap_args(command: &str, case: &WorkerOverlapCase<'_>) -> Vec<String> {
    let mut args = vec![
        command.to_string(),
        case.faces_total.to_string(),
        case.subfaces.len().to_string(),
    ];
    for face_ids in case.subfaces {
        args.push(face_ids.len().to_string());
        for face_id in *face_ids {
            args.push(face_id.to_string());
        }
    }
    args.push(case.relations.len().to_string());
    for (upper_face, lower_face) in case.relations {
        args.push(upper_face.to_string());
        args.push(lower_face.to_string());
    }
    args.push(case.triple_conditions.len().to_string());
    for (a, b, c, d) in case.triple_conditions {
        args.push(a.to_string());
        args.push(b.to_string());
        args.push(c.to_string());
        args.push(d.to_string());
    }
    args.push(case.quadruple_conditions.len().to_string());
    for (a, b, c, d) in case.quadruple_conditions {
        args.push(a.to_string());
        args.push(b.to_string());
        args.push(c.to_string());
        args.push(d.to_string());
    }
    args
}

fn worker_overlap_ordered_args(
    command: &str,
    case: &WorkerOverlapCase<'_>,
    valid_count: usize,
    swap: bool,
) -> Vec<String> {
    let mut args = vec![
        command.to_string(),
        case.faces_total.to_string(),
        case.subfaces.len().to_string(),
        valid_count.to_string(),
        swap.to_string(),
    ];
    for face_ids in case.subfaces {
        args.push(face_ids.len().to_string());
        for face_id in *face_ids {
            args.push(face_id.to_string());
        }
    }
    args.push(case.relations.len().to_string());
    for (upper_face, lower_face) in case.relations {
        args.push(upper_face.to_string());
        args.push(lower_face.to_string());
    }
    args.push(case.triple_conditions.len().to_string());
    for (a, b, c, d) in case.triple_conditions {
        args.push(a.to_string());
        args.push(b.to_string());
        args.push(c.to_string());
        args.push(d.to_string());
    }
    args.push(case.quadruple_conditions.len().to_string());
    for (a, b, c, d) in case.quadruple_conditions {
        args.push(a.to_string());
        args.push(b.to_string());
        args.push(c.to_string());
        args.push(d.to_string());
    }
    args
}

fn worker_overlap_ordered_sequence_args(
    case: &WorkerOverlapCase<'_>,
    valid_count: usize,
    actions: &[WorkerOverlapSequenceAction],
) -> Vec<String> {
    let mut args = vec![
        "worker-overlap-ordered-sequence-summary".to_string(),
        case.faces_total.to_string(),
        case.subfaces.len().to_string(),
        valid_count.to_string(),
    ];
    for face_ids in case.subfaces {
        args.push(face_ids.len().to_string());
        for face_id in *face_ids {
            args.push(face_id.to_string());
        }
    }
    args.push(case.relations.len().to_string());
    for (upper_face, lower_face) in case.relations {
        args.push(upper_face.to_string());
        args.push(lower_face.to_string());
    }
    args.push(case.triple_conditions.len().to_string());
    for (a, b, c, d) in case.triple_conditions {
        args.push(a.to_string());
        args.push(b.to_string());
        args.push(c.to_string());
        args.push(d.to_string());
    }
    args.push(case.quadruple_conditions.len().to_string());
    for (a, b, c, d) in case.quadruple_conditions {
        args.push(a.to_string());
        args.push(b.to_string());
        args.push(c.to_string());
        args.push(d.to_string());
    }
    args.push(actions.len().to_string());
    for action in actions {
        match *action {
            WorkerOverlapSequenceAction::Search(swap) => {
                args.push("search".to_string());
                args.push(swap.to_string());
            }
            WorkerOverlapSequenceAction::Next(subface_count) => {
                args.push("next".to_string());
                args.push(subface_count.to_string());
            }
        }
    }
    args
}

#[derive(Clone, Copy)]
enum WorkerOverlapSequenceAction {
    Search(bool),
    Next(usize),
}

#[derive(Clone, Copy)]
enum SwapperAction {
    Visit(usize),
    Record(usize),
    Process(usize),
    Estimate(usize),
}

fn chain_permutation_summary(mut generator: ChainPermutationGenerator, limit: usize) -> String {
    let mut output = String::new();
    output.push_str(&format!("permutations|{}\n", generator.count()));
    if limit == 0 {
        return output;
    }
    push_chain_permutation(&mut output, 0, 0, &generator);
    for step in 1..limit {
        let changed = generator
            .next(generator.num_digits())
            .expect("valid generator advance");
        if changed == 0 {
            output.push_str(&format!("end|{}|0|{}\n", step, generator.count()));
            return output;
        }
        push_chain_permutation(&mut output, step, changed, &generator);
    }
    output
}

fn chain_permutation_temp_summary(
    mut generator: ChainPermutationGenerator,
    steps_before_temp: usize,
    temp_upper: usize,
    temp_lower: usize,
    steps_after_temp: usize,
    limit_after_clear: usize,
) -> String {
    let mut output = String::new();
    output.push_str(&format!("permutations|{}\n", generator.count()));
    push_chain_permutation(&mut output, 0, 0, &generator);
    for step in 1..=steps_before_temp {
        let changed = generator
            .next(generator.num_digits())
            .expect("valid generator advance");
        if changed == 0 {
            output.push_str(&format!("end|{}|0|{}\n", step, generator.count()));
            return output;
        }
        push_chain_permutation(&mut output, step, changed, &generator);
    }

    generator
        .add_guide(temp_upper, temp_lower)
        .expect("valid temp guide");
    output.push_str(&format!("temp|{}|{}\n", temp_upper, temp_lower));
    for step in 1..=steps_after_temp {
        let changed = generator
            .next(generator.num_digits())
            .expect("valid generator advance");
        if changed == 0 {
            output.push_str(&format!("end_temp|{}|0|{}\n", step, generator.count()));
            return output;
        }
        push_chain_permutation(&mut output, step, changed, &generator);
    }

    generator.clear_temp_guide();
    output.push_str("clear_temp\n");
    for step in 1..=limit_after_clear {
        let changed = generator
            .next(generator.num_digits())
            .expect("valid generator advance");
        if changed == 0 {
            output.push_str(&format!("end_clear|{}|0|{}\n", step, generator.count()));
            return output;
        }
        push_chain_permutation(&mut output, step, changed, &generator);
    }
    output
}

fn push_chain_permutation(
    output: &mut String,
    step: usize,
    changed: usize,
    generator: &ChainPermutationGenerator,
) {
    output.push_str(&format!(
        "permutation|{}|{}|{}|{}\n",
        step,
        changed,
        generator.count(),
        joined_ids(&generator.current_permutation())
    ));
}

fn subface_guide_summary(mut search: SubFacePermutationSearch, limit: usize) -> String {
    let mut output = String::new();
    output.push_str(&format!(
        "subface_permutations|{}\n",
        search.permutation_count()
    ));
    if limit == 0 {
        return output;
    }
    push_subface_permutation(&mut output, 0, 0, &search);
    for step in 1..limit {
        let changed = search.next(search.face_ids().len()).expect("valid advance");
        if changed == 0 {
            output.push_str(&format!("end|{}|0|{}\n", step, search.permutation_count()));
            return output;
        }
        push_subface_permutation(&mut output, step, changed, &search);
    }
    output
}

fn push_subface_permutation(
    output: &mut String,
    step: usize,
    changed: usize,
    search: &SubFacePermutationSearch,
) {
    output.push_str(&format!(
        "subface_permutation|{}|{}|{}|{}\n",
        step,
        changed,
        search.permutation_count(),
        joined_ids(&search.current_ordering())
    ));
}

fn subface_overlap_summary(
    mut search: SubFacePermutationSearch,
    hierarchy: &InitialHierarchy,
) -> String {
    match search.possible_overlapping_search(hierarchy) {
        Ok(found) => format!(
            "subface_overlap|{}|{}|{}\n",
            if found { 1000 } else { 0 },
            search.permutation_count(),
            joined_ids(&search.current_ordering())
        ),
        Err(error) => format!("subface_overlap_error|{error:?}\n"),
    }
}

fn subface_priority_summary(
    priority: &oristudio_cp::folding::SubFacePriority,
    subfaces: &[SubFace],
) -> String {
    let mut output = String::new();
    output.push_str(&format!(
        "subface_priority|{}|{}\n",
        priority.valid_count,
        priority.ordered_subface_indices.len()
    ));
    for (rank, subface_index) in priority.ordered_subface_indices.iter().enumerate() {
        output.push_str(&format!(
            "priority_subface|{}|{}|{}\n",
            rank,
            subface_index,
            joined_ids(&subfaces[*subface_index].face_ids)
        ));
    }
    output
}

fn worker_overlap_summary(search: &oristudio_cp::folding::WorkerOverlapSearch) -> String {
    let mut output = String::new();
    output.push_str(&format!(
        "worker_overlap|{}|{}|{}|{}\n",
        if search.found { 1000 } else { 0 },
        search.priority.valid_count,
        search.subface_total,
        search.hierarchy.relations.len()
    ));
    for relation in &search.hierarchy.relations {
        output.push_str(&format!(
            "relation|{}|{}\n",
            relation.upper_face, relation.lower_face
        ));
    }
    output
}

fn worker_overlap_summary_with_order(
    search: &oristudio_cp::folding::WorkerOverlapSearch,
) -> String {
    let mut output = worker_overlap_summary(search);
    output.push_str(&format!(
        "worker_order|{}\n",
        joined_ids(&search.priority.ordered_subface_indices)
    ));
    output
}

fn worker_overlap_enumerator_sequence_summary(
    mut enumerator: WorkerOverlapEnumerator,
    actions: &[WorkerOverlapSequenceAction],
) -> String {
    let mut output = String::new();
    for action in actions {
        match *action {
            WorkerOverlapSequenceAction::Search(swap) => {
                let search = enumerator
                    .possible_overlapping_search(swap)
                    .expect("worker overlap search");
                output.push_str(&format!("worker_action|search|{swap}\n"));
                output.push_str(&worker_overlap_summary_with_order(&search));
            }
            WorkerOverlapSequenceAction::Next(subface_count) => {
                let changed = enumerator.next(subface_count).expect("worker next");
                output.push_str(&format!(
                    "worker_next|{}|{}|{}\n",
                    subface_count,
                    changed,
                    enumerator.valid_count()
                ));
                output.push_str(&format!(
                    "worker_order|{}\n",
                    joined_ids(&enumerator.priority().ordered_subface_indices)
                ));
            }
        }
    }
    output
}

fn folding_estimate_summary(estimate: &oristudio_cp::folding::FoldingEstimate) -> String {
    let mut output = String::new();
    output.push_str(&format!(
        "folding_estimate|{}|{}|{}|{}|{}\n",
        estimation_step_name(estimate.estimation_step),
        display_style_name(estimate.display_style),
        estimate.discovered_fold_cases,
        estimate.find_another_overlap_valid,
        estimate.text_result
    ));
    if let Some(search) = &estimate.overlap {
        output.push_str(&worker_overlap_summary(search));
    } else {
        output.push_str("worker_overlap|-1|0|0|0\n");
    }
    output
}

fn folding_estimate_sequence_summary(
    session: &mut FoldingEstimateSession,
    orders: &[oristudio_cp::folding::EstimationOrder],
) -> String {
    let mut output = String::new();
    for order in orders {
        let estimate = session.folding_estimated(*order).expect("folding estimate");
        output.push_str(&format!(
            "folding_estimate_action|{}\n",
            estimation_order_value(*order)
        ));
        output.push_str(&folding_estimate_summary(&estimate));
    }
    output
}

fn folding_estimate_batch_summary(
    prefix: &str,
    batch: &oristudio_cp::folding::FoldingEstimateBatch,
    final_estimate: &oristudio_cp::folding::FoldingEstimate,
) -> String {
    let mut output = String::new();
    for discovered_case in &batch.discovered_case_numbers {
        output.push_str(&format!("{prefix}|{discovered_case}\n"));
    }
    output.push_str(&folding_estimate_summary(final_estimate));
    output
}

fn estimation_order_value(order: oristudio_cp::folding::EstimationOrder) -> i32 {
    match order {
        oristudio_cp::folding::EstimationOrder::Order0 => 0,
        oristudio_cp::folding::EstimationOrder::Order1 => 1,
        oristudio_cp::folding::EstimationOrder::Order2 => 2,
        oristudio_cp::folding::EstimationOrder::Order3 => 3,
        oristudio_cp::folding::EstimationOrder::Order4 => 4,
        oristudio_cp::folding::EstimationOrder::Order5 => 5,
        oristudio_cp::folding::EstimationOrder::Order6 => 6,
        oristudio_cp::folding::EstimationOrder::Order51 => 51,
    }
}

fn estimation_step_name(step: oristudio_cp::folding::EstimationStep) -> &'static str {
    match step {
        oristudio_cp::folding::EstimationStep::Step0 => "STEP_0",
        oristudio_cp::folding::EstimationStep::Step1 => "STEP_1",
        oristudio_cp::folding::EstimationStep::Step2 => "STEP_2",
        oristudio_cp::folding::EstimationStep::Step3 => "STEP_3",
        oristudio_cp::folding::EstimationStep::Step4 => "STEP_4",
        oristudio_cp::folding::EstimationStep::Step5 => "STEP_5",
        oristudio_cp::folding::EstimationStep::Step10 => "STEP_10",
    }
}

fn display_style_name(style: oristudio_cp::folding::DisplayStyle) -> &'static str {
    match style {
        oristudio_cp::folding::DisplayStyle::None0 => "NONE_0",
        oristudio_cp::folding::DisplayStyle::Development1 => "DEVELOPMENT_1",
        oristudio_cp::folding::DisplayStyle::Wire2 => "WIRE_2",
        oristudio_cp::folding::DisplayStyle::Transparent3 => "TRANSPARENT_3",
        oristudio_cp::folding::DisplayStyle::Development4 => "DEVELOPMENT_4",
        oristudio_cp::folding::DisplayStyle::Paper5 => "PAPER_5",
    }
}

fn subface_swapper_summary(counters: &[usize], actions: &[SwapperAction]) -> String {
    let mut swapper = oristudio_cp::folding::SubFaceSwapper::new();
    let mut order = (0..counters.len()).collect::<Vec<_>>();
    let mut output = String::new();
    push_swapper_summary(&mut output, "initial", &swapper, &order);
    for action in actions {
        match *action {
            SwapperAction::Visit(index) => {
                if let Some(item) = order.get(index).copied() {
                    swapper.visit(item);
                }
                push_swapper_summary(&mut output, &format!("visit|{index}"), &swapper, &order);
            }
            SwapperAction::Record(index) => {
                swapper.record(index + 1);
                push_swapper_summary(&mut output, &format!("record|{index}"), &swapper, &order);
            }
            SwapperAction::Process(max) => {
                swapper.process(&mut order, max, counters);
                push_swapper_summary(&mut output, &format!("process|{max}"), &swapper, &order);
            }
            SwapperAction::Estimate(index) => {
                let estimate = swapper.should_estimate(index + 1);
                output.push_str(&format!("estimate|{}|{}\n", index, estimate));
                push_swapper_summary(
                    &mut output,
                    &format!("after_estimate|{index}"),
                    &swapper,
                    &order,
                );
            }
        }
    }
    output
}

fn push_swapper_summary(
    output: &mut String,
    label: &str,
    swapper: &oristudio_cp::folding::SubFaceSwapper,
    order: &[usize],
) {
    output.push_str(&format!(
        "swapper|{}|{}|{}\n",
        label,
        swapper.visited_count(),
        joined_ids(order)
    ));
}

fn joined_ids(ids: &[usize]) -> String {
    ids.iter()
        .map(|id| id.to_string())
        .collect::<Vec<_>>()
        .join(",")
}

fn joined_or_dash(ids: &[usize]) -> String {
    if ids.is_empty() {
        "-".to_string()
    } else {
        joined_ids(ids)
    }
}

fn segment(ax: f64, ay: f64, bx: f64, by: f64, color: LineColor) -> LineSegment {
    LineSegment::with_color(Point::new(ax, ay), Point::new(bx, by), color)
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

fn square_with_blue_diagonal() -> Vec<LineSegment> {
    let mut segments = square_with_diagonal();
    if let Some(diagonal) = segments.last_mut() {
        *diagonal = diagonal.with_line_color(LineColor::Blue2);
    }
    segments
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
        segment(0.0, 0.0, 1.0, 0.0, LineColor::Black0),
        segment(1.0, 0.0, 1.0, 1.0, LineColor::Black0),
        segment(1.0, 1.0, 0.0, 1.0, LineColor::Black0),
        segment(0.0, 1.0, 0.0, 0.0, LineColor::Black0),
        segment(0.5, 0.5, 0.0, 0.0, LineColor::Red1),
        segment(0.5, 0.5, 1.0, 0.0, LineColor::Blue2),
        segment(0.5, 0.5, 1.0, 1.0, LineColor::Red1),
        segment(0.5, 0.5, 0.0, 1.0, LineColor::Blue2),
    ]
}

fn solution_sample_segments() -> Vec<LineSegment> {
    cp::import_cp_str(include_str!(
        "../../../tests/fixtures/oriedita/solution_sample_1.cp"
    ))
    .expect("solution sample cp")
    .line_segments
}

fn java_double_string(value: f64) -> String {
    if value.is_finite() && value.fract() == 0.0 {
        format!("{value:.1}")
    } else {
        value.to_string()
    }
}

use oristudio_bp::layout::generators::config_generator;
use oristudio_bp::layout::{
    CornerType, LayoutConfiguration, LayoutJunction, LayoutPartition, LayoutRepository,
    LayoutStretch, NodeSet, Store, ValidJunction, ValidJunctionData, clean_up, convert_index,
    create_junction, create_quadrants, create_valid_junctions, get_factors,
    get_structure_signature, group_junctions, one_is_contained_in_another, start_end_points,
    uncovered_junction_indices,
};
use oristudio_bp::math::geometry::Rectangle;
use oristudio_bp::model::{
    Configuration, Corner, Edge, Flap, NodeId, Overlap, Partition, Point, Repository, Strategy,
    Stretch,
};
use oristudio_bp::shared::{QuadrantDirection, make_quadrant_code};
use oristudio_bp::tree::BpTree;
use std::collections::BTreeSet;

#[test]
fn store_generates_lazily_and_caches_entries() {
    let mut store = Store::new([1, 2, 3].into_iter());

    assert!(!store.done());
    assert_eq!(store.completed_len(), None);
    assert!(store.entries().is_empty());

    assert_eq!(store.next_entry(), Some(&1));
    assert!(!store.done());
    assert_eq!(store.entries(), &[1]);

    store.rest();
    assert!(store.done());
    assert_eq!(store.completed_len(), Some(3));
    assert_eq!(store.entries(), &[1, 2, 3]);
    assert_eq!(store.next_entry(), None);
}

#[test]
fn valid_junction_json_signature_and_covering_match_upstream_rules() {
    let tree = sample_tree();
    let junction = valid_junction(
        &tree,
        1,
        2,
        junction_data(
            QuadrantDirection::Ur,
            Point { x: 2.0, y: 3.0 },
            Point { x: 5.0, y: 4.0 },
            Point { x: 1.0, y: 1.0 },
            Point { x: 2.0, y: 3.0 },
        ),
    );

    assert_eq!(junction.oriented_ids(), [1, 2]);
    assert!(junction.involves(2));
    assert_eq!(
        junction.base_rectangle(1.0),
        Rectangle::new((1.0, 1.0), (3.0, 4.0))
    );
    assert_eq!(
        serde_json::to_string(&junction.to_json()).unwrap(),
        r#"{"c":[{"type":4,"e":1,"q":0},{"type":2},{"type":4,"e":2,"q":2},{"type":2}],"f":{"x":1.0,"y":1.0},"ox":2.0,"oy":3.0,"sx":5.0}"#
    );
    assert_eq!(junction.to_json().c[0].corner_type, CornerType::Flap as u8);
    assert_eq!(
        get_structure_signature(std::slice::from_ref(&junction)).unwrap(),
        r#"[{"c":[{"type":4,"e":1,"q":0},{"type":2},{"type":4,"e":2,"q":2},{"type":2}],"f":{"x":1.0,"y":1.0},"ox":2.0,"oy":3.0,"sx":5.0}]"#
    );

    let mut flipped = junction.clone();
    flipped.f = Point { x: -1.0, y: 1.0 };
    assert_eq!(flipped.oriented_ids(), [2, 1]);
    let oriented = junction.to_oriented_json(Point { x: -1.0, y: 1.0 });
    assert_eq!(oriented.f, Point { x: -1.0, y: 1.0 });
    assert_eq!(oriented.c[0].e, Some(2));
    assert_eq!(oriented.c[2].e, Some(1));

    let mut junctions = vec![
        junction.clone(),
        valid_junction(
            &tree,
            1,
            3,
            junction_data(
                QuadrantDirection::Lr,
                Point { x: 3.0, y: 1.0 },
                Point { x: 4.0, y: 4.0 },
                Point { x: 1.0, y: -1.0 },
                Point { x: 2.0, y: 0.0 },
            ),
        ),
        valid_junction(
            &tree,
            2,
            3,
            junction_data(
                QuadrantDirection::Ul,
                Point { x: 1.0, y: 3.0 },
                Point { x: 6.0, y: 4.0 },
                Point { x: -1.0, y: 1.0 },
                Point { x: 20.0, y: 2.0 },
            ),
        ),
    ];
    junctions[0].set_geometrically_covered_by(1);
    assert!(junctions[0].is_covered(&junctions));
    assert_eq!(junctions[0].get_covering(&junctions), vec![1]);
    junctions[1].set_geometrically_covered_by(2);
    assert!(!junctions[0].is_covered(&junctions));
    assert!(junctions[0].get_covering(&junctions).is_empty());
    junctions[0].reset_covering();
    assert!(!junctions[0].is_covered(&junctions));
    assert!(junctions[0].is_closer_than(&junctions[2]));
}

#[test]
fn create_valid_junctions_collects_leaf_pair_collisions() {
    let tree = sample_tree();

    let junctions = create_valid_junctions(&tree).unwrap();

    assert_eq!(junctions.len(), 1);
    assert!([1, 2, 3].contains(&junctions[0].a));
    assert!([1, 2, 3].contains(&junctions[0].b));
    assert_ne!(junctions[0].a, junctions[0].b);
}

#[test]
fn quadrants_group_by_code_and_match_corner_geometry() {
    let tree = sample_tree();
    let junctions = vec![
        valid_junction(
            &tree,
            1,
            2,
            junction_data(
                QuadrantDirection::Ur,
                Point { x: 2.0, y: 3.0 },
                Point { x: 5.0, y: 4.0 },
                Point { x: 1.0, y: 1.0 },
                Point { x: 2.0, y: 3.0 },
            ),
        ),
        valid_junction(
            &tree,
            1,
            3,
            junction_data(
                QuadrantDirection::Lr,
                Point { x: 3.0, y: 1.0 },
                Point { x: 4.0, y: 4.0 },
                Point { x: 1.0, y: -1.0 },
                Point { x: 2.0, y: 0.0 },
            ),
        ),
    ];

    let result = create_quadrants(&junctions, &tree).unwrap();
    assert_eq!(result.opposite_map.get(&1).unwrap(), &vec![2, 3]);
    assert_eq!(result.opposite_map.get(&2).unwrap(), &vec![1]);
    assert_eq!(result.directional[QuadrantDirection::Ur as usize], vec![4]);
    assert_eq!(result.directional[QuadrantDirection::Ul as usize], vec![13]);
    assert_eq!(result.directional[QuadrantDirection::Ll as usize], vec![10]);
    assert_eq!(result.directional[QuadrantDirection::Lr as usize], vec![7]);

    let quadrant = result
        .map
        .get(&make_quadrant_code(1, QuadrantDirection::Ur))
        .unwrap();
    assert_eq!(quadrant.flap, 1);
    assert_eq!(quadrant.f, Point { x: 1.0, y: 1.0 });
    assert_eq!(quadrant.point(&tree).unwrap(), Point { x: 2.0, y: 3.0 });
    assert_eq!(quadrant.w, 1.0);
    assert_eq!(
        quadrant.start_end_points(&tree).unwrap(),
        [Point { x: 12.0, y: 10.0 }, Point { x: 10.0, y: 13.0 }]
    );
    assert_eq!(
        start_end_points(std::slice::from_ref(quadrant), &tree).unwrap(),
        [Point { x: 12.0, y: 10.0 }, Point { x: 10.0, y: 13.0 }]
    );
    assert_eq!(
        quadrant.corner(&tree, 4.0).unwrap(),
        Point { x: 6.0, y: 7.0 }
    );
    assert_eq!(
        quadrant
            .overlap_corner(
                &tree,
                &overlap(1, 2, 2.0, 3.0),
                &parent_junction(1, 2, 2.0, 3.0),
                QuadrantDirection::Ur,
                0.0,
            )
            .unwrap(),
        Point { x: 10.0, y: 10.0 }
    );
    assert_eq!(
        quadrant
            .overlap_corner(
                &tree,
                &overlap(1, 2, 2.0, 3.0),
                &parent_junction(1, 2, 2.0, 3.0),
                QuadrantDirection::Lr,
                0.0,
            )
            .unwrap(),
        Point { x: 12.0, y: 10.0 }
    );
    assert_eq!(
        get_factors(QuadrantDirection::Ll),
        Point { x: -1.0, y: -1.0 }
    );
    assert!(one_is_contained_in_another(
        Point { x: 1.0, y: 1.0 },
        Point { x: 2.0, y: 2.0 }
    ));
}

#[test]
fn partition_external_connection_targets_match_bp_side_selection_rules() {
    let tree = sample_tree();
    let junctions = sample_junctions(&tree);
    let repo = LayoutRepository::new(&tree, "1,2,3", &junctions, None).unwrap();
    let partitions = vec![LayoutPartition::new(Partition {
        overlaps: vec![overlap(1, 2, 2.0, 3.0)],
        strategy: None,
    })];
    let partition = &partitions[0];
    let map = partition.external_corner_maps()[0];
    let [mut left, mut right] = partition
        .external_connection_targets(map, &partitions, &repo, &tree)
        .unwrap();
    if left.x > right.x {
        std::mem::swap(&mut left, &mut right);
    }

    assert_eq!(
        partition
            .external_connection_target(
                Point {
                    x: left.x - 1.0,
                    y: left.y
                },
                map,
                &partitions,
                &repo,
                &tree,
                None,
            )
            .unwrap(),
        Some(left)
    );
    assert_eq!(
        partition
            .external_connection_target(
                Point {
                    x: (left.x + right.x) / 2.0,
                    y: left.y
                },
                map,
                &partitions,
                &repo,
                &tree,
                None,
            )
            .unwrap(),
        None
    );
    assert_eq!(
        partition
            .external_connection_target(
                Point {
                    x: (left.x + right.x) / 2.0,
                    y: left.y
                },
                map,
                &partitions,
                &repo,
                &tree,
                Some(QuadrantDirection::Ur),
            )
            .unwrap(),
        Some(left)
    );
    assert_eq!(
        partition
            .external_connection_target(
                Point {
                    x: (left.x + right.x) / 2.0,
                    y: left.y
                },
                map,
                &partitions,
                &repo,
                &tree,
                Some(QuadrantDirection::Ul),
            )
            .unwrap(),
        Some(right)
    );
}

#[test]
fn node_set_tracks_leaves_lcas_distances_and_changes() {
    let tree = sample_tree();
    let junctions = vec![
        valid_junction(
            &tree,
            1,
            2,
            junction_data(
                QuadrantDirection::Ur,
                Point { x: 2.0, y: 3.0 },
                Point { x: 5.0, y: 4.0 },
                Point { x: 1.0, y: 1.0 },
                Point { x: 2.0, y: 3.0 },
            ),
        ),
        valid_junction(
            &tree,
            1,
            3,
            junction_data(
                QuadrantDirection::Lr,
                Point { x: 3.0, y: 1.0 },
                Point { x: 4.0, y: 4.0 },
                Point { x: 1.0, y: -1.0 },
                Point { x: 2.0, y: 0.0 },
            ),
        ),
    ];
    let quadrants = create_quadrants(&junctions, &tree).unwrap();
    let mut node_set = NodeSet::new(&tree, &junctions, &quadrants.map).unwrap();

    assert_eq!(node_set.leaves, vec![1, 2, 3]);
    assert_eq!(node_set.nodes, vec![1, 2, 3]);
    assert!(node_set.quadrant_coverage.contains_key(&1));
    assert!(!node_set.quadrant_coverage.contains_key(&0));

    assert_eq!(
        node_set.dist_triple(&tree, 1, 2, 3).unwrap(),
        oristudio_bp::layout::DistTriple {
            d1: 10.0,
            d2: 8.0,
            d3: 6.0,
        }
    );

    let same = NodeSet::new(&tree, &junctions, &quadrants.map).unwrap();
    assert!(!node_set.compare(&same, &BTreeSet::new()));
    assert!(node_set.compare(&same, &BTreeSet::from([2])));
}

#[test]
fn create_junction_returns_valid_or_invalid_overlap_models() {
    let valid_tree = two_leaf_tree(2.0);
    let junction = create_junction(&valid_tree, 2, 1, 0).unwrap();
    let LayoutJunction::Valid(junction) = junction else {
        panic!("expected valid junction");
    };
    assert_eq!(junction.a, 1);
    assert_eq!(junction.b, 2);
    assert_eq!(junction.s, Point { x: 3.0, y: 3.0 });
    assert_eq!(junction.o, Point { x: 1.0, y: 1.0 });
    assert_eq!(junction.f, Point { x: 1.0, y: 1.0 });
    assert_eq!(junction.tip, Point { x: 5.0, y: 5.0 });
    assert_eq!(junction.to_json().c[0].corner_type, CornerType::Flap as u8);

    let invalid_tree = two_leaf_tree(5.0);
    let mut junction = create_junction(&invalid_tree, 1, 2, 0).unwrap();
    assert!(!junction.valid());
    assert_eq!(junction.a(), 1);
    assert_eq!(junction.b(), 2);
    let LayoutJunction::Invalid(invalid) = &mut junction else {
        panic!("expected invalid junction");
    };
    assert!(!invalid.processed);
    assert_eq!(invalid.distance_after_flap_radii(), 0.0);
    let polygon = invalid.get_polygon(&invalid_tree).unwrap();
    assert!(invalid.processed);
    assert!(!polygon.is_empty());
}

#[test]
fn configuration_and_partition_shell_preserve_raw_cleanup_and_corner_maps() {
    let raw_partition = Partition {
        strategy: Some(Strategy::HalfIntegral),
        overlaps: vec![
            Overlap {
                c: vec![
                    corner(CornerType::Coincide, Some(-99), Some(0)),
                    corner(CornerType::Socket, Some(-7), Some(1)),
                    corner(CornerType::Flap, Some(2), Some(2)),
                    corner(CornerType::Side, None, None),
                ],
                ox: 6.0,
                oy: 5.0,
                id: Some(-99),
                parent: 0,
                shift: None,
            },
            Overlap {
                c: vec![
                    corner(CornerType::Internal, Some(-99), Some(0)),
                    corner(CornerType::Intersection, Some(2), Some(1)),
                    corner(CornerType::Flap, Some(1), Some(2)),
                    corner(CornerType::Side, None, None),
                ],
                ox: 4.0,
                oy: 3.0,
                id: Some(-7),
                parent: 1,
                shift: None,
            },
        ],
    };

    let cleaned = clean_up(vec![raw_partition.clone()]);
    assert_eq!(convert_index(0), -1);
    assert_eq!(cleaned[0].overlaps[0].id, None);
    assert_eq!(cleaned[0].overlaps[1].id, None);
    assert_eq!(cleaned[0].overlaps[0].c[1].e, Some(-2));
    assert_eq!(cleaned[0].overlaps[1].c[0].e, Some(-1));

    let config = LayoutConfiguration::new(
        Configuration {
            partitions: vec![raw_partition],
            raw: Some(true),
            patterns: None,
            index: Some(2),
        },
        true,
    );
    assert!(config.single_mode);
    assert_eq!(config.raw_partitions().unwrap().len(), 1);
    assert_eq!(config.overlaps.len(), 2);
    assert_eq!(config.overlap_map.get(&-1), Some(&[0, 0]));
    assert_eq!(config.overlap_map.get(&-2), Some(&[0, 1]));
    assert!(config.signature().unwrap().contains("\"partitions\""));
    assert!(config.to_json(true).patterns.unwrap().is_empty());
    assert_eq!(config.to_json(true).index, Some(2));

    let partition = &config.partitions[0];
    assert_eq!(partition.to_json().strategy, Some(Strategy::HalfIntegral));
    assert_eq!(partition.corner_map.len(), 8);
    assert_eq!(partition.constraints().len(), 4);
    assert_eq!(partition.external_corner_maps().len(), 3);
    assert_eq!(
        partition.displacement_reference().unwrap().corner_type,
        CornerType::Internal as u8
    );
    assert!(partition.find_overlap_for_flap(2).is_some());

    let parents = vec![
        parent_junction(1, 2, 8.0, 8.0),
        parent_junction(1, 3, 7.0, 7.0),
    ];
    let exposed = partition
        .exposed_overlap(0, &partition.overlaps, &parents)
        .unwrap();
    assert_eq!(exposed.shift, Some(Point { x: 7.0, y: 7.0 }));
    assert_eq!(exposed.ox, -1.0);
    assert_eq!(exposed.oy, -2.0);
    let intersection = partition
        .corner_map
        .iter()
        .find(|map| map.corner.corner_type == CornerType::Intersection as u8)
        .unwrap();
    assert_eq!(
        partition.resolve_division(intersection, &parents).unwrap(),
        [2, 3]
    );

    let mut config = config;
    assert!(config.complete().is_err());
}

#[test]
fn grouping_repository_and_stretch_shell_preserve_lifecycle_boundaries() {
    let tree = sample_tree();
    let mut junctions = sample_junctions(&tree);
    let groups = group_junctions(&junctions).unwrap();
    assert_eq!(groups.len(), 2);
    assert_eq!(groups[0].flaps, vec![1, 2]);
    assert_eq!(groups[1].flaps, vec![1, 3]);
    assert_eq!(
        uncovered_junction_indices(&tree, &mut junctions).unwrap(),
        vec![0, 1]
    );

    let prototype = stretch_prototype("1,2,3");
    let mut repo = LayoutRepository::new(&tree, "1,2,3", &junctions, Some(&prototype)).unwrap();
    assert!(repo.is_valid);
    assert_eq!(
        repo.direction() as u8,
        oristudio_bp::shared::SlashDirection::Fw as u8
    );
    assert_eq!(repo.configuration_count(), None);
    assert!(repo.to_json().is_none());
    assert!(repo.init().is_err());
    assert!(!repo.try_update_origin(repo.origin));
    assert!(repo.try_update_origin(Point { x: 9.0, y: 9.0 }));
    let max = repo
        .get_max_intersection_distance(
            &tree,
            &junctions[0].to_json(),
            &junctions[1].to_json(),
            true,
        )
        .unwrap();
    assert_eq!(max, 10.0);

    let mut stored = stretch_prototype("1,2,3");
    stored.repo = Some(Repository {
        configurations: Vec::new(),
        index: 2,
    });
    let mut stored_repo = LayoutRepository::new(&tree, "1,2,3", &junctions, Some(&stored)).unwrap();
    assert_eq!(stored_repo.configuration_count(), Some(0));
    assert_eq!(stored_repo.to_json().unwrap().index, 2);
    stored_repo.set_index(1);
    assert_eq!(stored_repo.to_json().unwrap().index, 1);
    assert!(stored_repo.complete().is_ok());
}

#[test]
fn repository_config_generator_recovers_stored_configs_and_searches_single_junctions() {
    let tree = sample_tree();
    let mut stored = stretch_prototype("stored");
    stored.repo = Some(Repository {
        configurations: vec![Configuration {
            partitions: vec![Partition {
                overlaps: vec![overlap(1, 2, 2.0, 2.0)],
                strategy: None,
            }],
            raw: None,
            patterns: None,
            index: Some(0),
        }],
        index: 0,
    });
    let stored_repo = LayoutRepository::new(
        &tree,
        "stored",
        &sample_junctions(&tree)[..1],
        Some(&stored),
    )
    .unwrap();
    let configs = config_generator(&stored_repo, Some(&stored)).unwrap();
    assert_eq!(configs.len(), 1);
    assert_eq!(configs[0].to_json(true).index, Some(0));

    let single = vec![valid_junction(
        &tree,
        1,
        2,
        junction_data(
            QuadrantDirection::Ur,
            Point { x: 2.0, y: 2.0 },
            Point { x: 100.0, y: 100.0 },
            Point { x: 1.0, y: 1.0 },
            Point { x: 2.0, y: 3.0 },
        ),
    )];
    let prototype = stretch_prototype("single");
    let mut repo = LayoutRepository::new(&tree, "single", &single, Some(&prototype)).unwrap();
    let configs = config_generator(&repo, None).unwrap();
    assert_eq!(configs.len(), 1);
    assert!(configs[0].pattern().is_some());
    assert!(repo.to_json().is_none());
    repo.init().unwrap();
    assert_eq!(repo.configurations().len(), 1);
    assert!(repo.pattern().is_some());
    assert!(repo.to_json().is_none());
    repo.complete().unwrap();
    assert_eq!(repo.to_json().unwrap().configurations.len(), 1);

    let multi = shared_quadrant_junctions(&tree);
    let prototype = stretch_prototype("multi");
    let multi_repo = LayoutRepository::new(&tree, "multi", &multi, Some(&prototype)).unwrap();
    assert!(config_generator(&multi_repo, None).is_err());

    let mut multi_repo = LayoutRepository::new(&tree, "multi", &multi, Some(&prototype)).unwrap();
    assert!(multi_repo.init().is_err());
    assert!(multi_repo.configurations().is_empty());
    multi_repo.init_with_tree(&tree).unwrap();
    assert!(!multi_repo.configurations().is_empty());
    assert!(multi_repo.pattern().is_some());
    assert!(multi_repo.to_json().is_none());
    multi_repo.complete_with_tree(&tree).unwrap();
    let serialized = multi_repo.to_json().unwrap();
    assert!(!serialized.configurations.is_empty());
    assert!(
        serialized.configurations[0]
            .patterns
            .as_ref()
            .is_some_and(|patterns| !patterns.is_empty())
    );
}

#[test]
fn stretch_update_reuses_cached_repositories_during_dragging() {
    let tree = sample_tree();
    let prototype = stretch_prototype("1,2,3");
    let mut junctions = sample_junctions(&tree);
    let mut stretch = LayoutStretch::new(&tree, &junctions, &prototype).unwrap();

    let unchanged = stretch
        .update(&tree, &junctions, &prototype, false, &BTreeSet::new())
        .unwrap();
    assert!(!unchanged.repo_to_process);
    assert!(!unchanged.node_set_changed);

    let changed_length = stretch
        .update(&tree, &junctions, &prototype, false, &BTreeSet::from([1]))
        .unwrap();
    assert!(!changed_length.repo_to_process);
    assert!(changed_length.node_set_changed);

    stretch.is_active = false;
    let reactivated = stretch
        .update(&tree, &junctions, &prototype, false, &BTreeSet::new())
        .unwrap();
    assert!(reactivated.repo_to_process);
    assert!(stretch.is_active);

    let single = vec![junctions.remove(0)];
    let first_replace = stretch
        .update(&tree, &single, &prototype, true, &BTreeSet::new())
        .unwrap();
    assert!(first_replace.replaced_repo);
    assert!(first_replace.cleared_pattern_contour);
    assert!(!first_replace.reused_cached_repo);
    assert_eq!(stretch.cache_len(), 1);

    let original = sample_junctions(&tree);
    let reused = stretch
        .update(&tree, &original, &prototype, true, &BTreeSet::new())
        .unwrap();
    assert!(reused.reused_cached_repo);
    assert!(reused.repo_to_process);
    stretch.cleanup();
    assert_eq!(stretch.cache_len(), 0);
    assert!(stretch.complete().is_err());
    assert_eq!(stretch.to_json().id, "1,2,3");
}

fn sample_tree() -> BpTree {
    BpTree::new(
        &[
            Edge {
                n1: 0,
                n2: 1,
                length: 10.0,
            },
            Edge {
                n1: 0,
                n2: 2,
                length: 8.0,
            },
            Edge {
                n1: 0,
                n2: 3,
                length: 6.0,
            },
        ],
        &[
            flap(1, 0.0, 0.0, 2.0, 3.0),
            flap(2, 20.0, 0.0, 2.0, 2.0),
            flap(3, 0.0, 20.0, 3.0, 3.0),
        ],
    )
    .unwrap()
}

fn two_leaf_tree(length: f64) -> BpTree {
    BpTree::new(
        &[
            Edge {
                n1: 0,
                n2: 1,
                length,
            },
            Edge {
                n1: 0,
                n2: 2,
                length,
            },
        ],
        &[flap(1, 0.0, 0.0, 5.0, 5.0), flap(2, 8.0, 8.0, 5.0, 5.0)],
    )
    .unwrap()
}

fn sample_junctions(tree: &BpTree) -> Vec<ValidJunction> {
    vec![
        valid_junction(
            tree,
            1,
            2,
            junction_data(
                QuadrantDirection::Ur,
                Point { x: 2.0, y: 3.0 },
                Point { x: 5.0, y: 4.0 },
                Point { x: 1.0, y: 1.0 },
                Point { x: 2.0, y: 3.0 },
            ),
        ),
        valid_junction(
            tree,
            1,
            3,
            junction_data(
                QuadrantDirection::Lr,
                Point { x: 3.0, y: 1.0 },
                Point { x: 4.0, y: 4.0 },
                Point { x: 1.0, y: -1.0 },
                Point { x: 2.0, y: 0.0 },
            ),
        ),
    ]
}

fn shared_quadrant_junctions(tree: &BpTree) -> Vec<ValidJunction> {
    vec![
        valid_junction(
            tree,
            1,
            2,
            junction_data(
                QuadrantDirection::Ur,
                Point { x: 2.0, y: 3.0 },
                Point { x: 100.0, y: 100.0 },
                Point { x: 1.0, y: 1.0 },
                Point { x: 2.0, y: 3.0 },
            ),
        ),
        valid_junction(
            tree,
            1,
            3,
            junction_data(
                QuadrantDirection::Ur,
                Point { x: 3.0, y: 2.0 },
                Point { x: 100.0, y: 100.0 },
                Point { x: 1.0, y: 1.0 },
                Point { x: 2.0, y: 3.0 },
            ),
        ),
    ]
}

fn stretch_prototype(id: &str) -> Stretch {
    Stretch {
        id: id.to_string(),
        configuration: None,
        pattern: None,
        repo: None,
    }
}

fn corner(corner_type: CornerType, e: Option<i64>, q: Option<u8>) -> Corner {
    Corner {
        corner_type: corner_type as u8,
        e,
        q,
        dynamic: None,
    }
}

fn overlap(a: i64, b: i64, ox: f64, oy: f64) -> Overlap {
    Overlap {
        c: vec![
            corner(CornerType::Flap, Some(a), Some(0)),
            corner(CornerType::Side, None, None),
            corner(CornerType::Flap, Some(b), Some(2)),
            corner(CornerType::Side, None, None),
        ],
        ox,
        oy,
        id: None,
        parent: 0,
        shift: None,
    }
}

fn parent_junction(a: i64, b: i64, ox: f64, oy: f64) -> oristudio_bp::model::Junction {
    oristudio_bp::model::Junction {
        c: vec![
            corner(CornerType::Flap, Some(a), Some(0)),
            corner(CornerType::Side, None, None),
            corner(CornerType::Flap, Some(b), Some(2)),
            corner(CornerType::Side, None, None),
        ],
        f: Point { x: 1.0, y: 1.0 },
        ox,
        oy,
        sx: ox + 1.0,
    }
}

fn flap(id: NodeId, x: f64, y: f64, width: f64, height: f64) -> Flap {
    Flap {
        id,
        x,
        y,
        width,
        height,
    }
}

fn valid_junction(tree: &BpTree, a: NodeId, b: NodeId, data: ValidJunctionData) -> ValidJunction {
    ValidJunction::new(tree, a, b, data).unwrap()
}

fn junction_data(
    dir: QuadrantDirection,
    o: Point,
    s: Point,
    f: Point,
    tip: Point,
) -> ValidJunctionData {
    ValidJunctionData {
        lca: 0,
        s,
        o,
        f,
        dir,
        tip,
    }
}

use oristudio_bp::layout::graphics::{
    RiverContour, configuration_free_corners, corresponding_point, device_graphics,
    device_graphics_key, flap_ridges, node_graphics, path_right_corners, repo_device_graphics,
    repo_device_graphics_from_selection, river_ridges,
};
use oristudio_bp::layout::pattern::LayoutPattern;
use oristudio_bp::layout::{
    CornerType, LayoutConfiguration, LayoutRepository, ValidJunction, ValidJunctionData,
};
use oristudio_bp::math::geometry::PathPoint;
use oristudio_bp::model::{
    Configuration, Corner, Device, Edge, Flap, Gadget, Overlap, Partition, Pattern, Piece, Point,
    Repository as RepositoryModel, Stretch,
};
use oristudio_bp::shared::QuadrantDirection;
use oristudio_bp::sweep::PathEx;
use oristudio_bp::tree::BpTree;
use std::collections::BTreeSet;

#[test]
fn flap_ridges_match_bp_border_and_patterned_quadrant_rules() {
    let tree = BpTree::new(
        &[Edge {
            n1: 0,
            n2: 1,
            length: 1.0,
        }],
        &[Flap {
            id: 1,
            x: 0.0,
            y: 0.0,
            width: 2.0,
            height: 2.0,
        }],
    )
    .unwrap();
    let node = tree.node(1).unwrap();

    assert_eq!(flap_ridges(node, &BTreeSet::new()).len(), 8);
    assert_eq!(flap_ridges(node, &BTreeSet::from([1 << 2])).len(), 7);
}

#[test]
fn river_right_angle_helpers_match_bp_geometry() {
    let square = path(&[(0.0, 0.0), (4.0, 0.0), (4.0, 4.0), (0.0, 4.0)]);
    let corners = path_right_corners(&square);

    assert_eq!(corners.len(), 4);
    assert_eq!(
        corresponding_point(corners[0][0], corners[0][1], corners[0][2], 1.0, 1.0),
        PathPoint::new(1.0, 1.0)
    );
}

#[test]
fn river_ridges_connect_outer_corners_to_matching_inner_corners() {
    let contour = RiverContour {
        outer: PathEx {
            points: path(&[(0.0, 0.0), (4.0, 0.0), (4.0, 4.0), (0.0, 4.0)]),
            is_hole: false,
            from: None,
        },
        inner: vec![path(&[(1.0, 1.0), (1.0, 3.0), (3.0, 3.0), (3.0, 1.0)])],
    };

    let ridges = river_ridges(1.0, &[contour], &[]);

    assert!(ridges.iter().any(|ridge| {
        ridge[0] == Point { x: 0.0, y: 0.0 } && ridge[1] == Point { x: 1.0, y: 1.0 }
    }));
}

#[test]
fn device_graphics_exports_positioned_pattern_payload() {
    let tree = two_leaf_tree();
    let junction = repo_valid_junction(&tree);
    let mut repo = LayoutRepository::new(&tree, "1,2", &[junction], None).unwrap();
    let config = layout_config(vec![partition(overlap_with_quadrants(0, 2.0, 2.0))], false);
    let positioned = LayoutPattern::new_positioned_with_repo(
        Pattern {
            devices: vec![device(2.0)],
        },
        &config,
        &mut repo,
        &tree,
    )
    .unwrap();

    let graphics = device_graphics(&positioned, 0, &config, &repo, &tree).unwrap();

    assert_eq!(device_graphics_key(&repo, 0), "s1,2.0");
    assert!(!graphics.contours.is_empty());
    assert!(!graphics.ridges.is_empty());
    assert!(
        graphics
            .axis_parallel
            .as_ref()
            .is_some_and(|lines| !lines.is_empty())
    );
    assert!(graphics.range.is_some_and(|range| range[0] <= range[1]));
    assert_eq!(graphics.location, Some(Point { x: 3.0, y: 3.0 }));
    assert_eq!(graphics.forward, Some(true));
}

#[test]
fn node_graphics_exports_flap_contours_and_ridges() {
    let tree = BpTree::new(
        &[Edge {
            n1: 0,
            n2: 1,
            length: 1.0,
        }],
        &[Flap {
            id: 1,
            x: 0.0,
            y: 0.0,
            width: 2.0,
            height: 2.0,
        }],
    )
    .unwrap();
    let node = tree.node(1).unwrap();
    let contour = RiverContour {
        outer: PathEx {
            points: path(&[(0.0, 0.0), (2.0, 0.0), (2.0, 2.0), (0.0, 2.0)]),
            is_hole: false,
            from: None,
        },
        inner: Vec::new(),
    };

    let graphics = node_graphics(node, &[contour], &BTreeSet::new(), &[]);

    assert_eq!(graphics.contours.len(), 1);
    assert_eq!(graphics.contours[0].outer[0], Point { x: 0.0, y: 0.0 });
    assert_eq!(graphics.ridges.len(), 8);
    assert!(graphics.axis_parallel.is_none());
    assert!(graphics.range.is_none());
    assert!(graphics.location.is_none());
    assert!(graphics.forward.is_none());
}

#[test]
fn node_graphics_exports_river_ridges_with_free_corners() {
    let tree = branched_tree();
    let node = tree.node(3).unwrap();
    let contour = RiverContour {
        outer: PathEx {
            points: path(&[(0.0, 0.0), (4.0, 0.0), (4.0, 4.0), (0.0, 4.0)]),
            is_hole: false,
            from: None,
        },
        inner: vec![path(&[(2.0, 2.0), (2.0, 3.0), (3.0, 3.0), (3.0, 2.0)])],
    };
    let expected = river_ridges(node.length, std::slice::from_ref(&contour), &[]);

    let graphics = node_graphics(node, &[contour], &BTreeSet::new(), &[]);

    assert_eq!(graphics.ridges, expected);
    assert_eq!(graphics.contours[0].inner.len(), 1);
}

#[test]
fn configuration_free_corners_match_external_pattern_corners() {
    let tree = two_leaf_tree();
    let junction = repo_valid_junction(&tree);
    let mut repo = LayoutRepository::new(&tree, "1,2", &[junction], None).unwrap();
    let config = layout_config(vec![partition(overlap_with_quadrants(0, 2.0, 2.0))], false);
    let positioned = LayoutPattern::new_positioned_with_repo(
        Pattern {
            devices: vec![device(2.0)],
        },
        &config,
        &mut repo,
        &tree,
    )
    .unwrap();

    let corners = configuration_free_corners(&config, &positioned).unwrap();

    assert_eq!(corners, vec![Point { x: 3.0, y: 5.0 }]);
}

#[test]
fn repo_device_graphics_preserves_skip_and_emit_behavior() {
    let tree = two_leaf_tree();
    let junction = repo_valid_junction(&tree);
    let mut repo = LayoutRepository::new(&tree, "1,2", &[junction], None).unwrap();

    assert!(repo_device_graphics(&repo, &tree).unwrap().is_empty());

    let config = layout_config(vec![partition(overlap_with_quadrants(0, 2.0, 2.0))], false);
    let positioned = LayoutPattern::new_positioned_with_repo(
        Pattern {
            devices: vec![device(2.0)],
        },
        &config,
        &mut repo,
        &tree,
    )
    .unwrap();

    let entries = repo_device_graphics_from_selection(&repo, &config, &positioned, &tree).unwrap();

    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].0, "s1,2.0");
    assert!(!entries[0].1.contours.is_empty());
    assert!(entries[0].1.forward.is_some());
}

#[test]
fn stored_repository_selected_pattern_can_be_initialized_for_graphics() {
    let tree = two_leaf_tree();
    let junction = repo_valid_junction(&tree);
    let mut repo = LayoutRepository::new(&tree, "1,2", &[junction], None).unwrap();
    let config = layout_config(vec![partition(overlap_with_quadrants(0, 2.0, 2.0))], false);
    let positioned = LayoutPattern::new_positioned_with_repo(
        Pattern {
            devices: vec![device(2.0)],
        },
        &config,
        &mut repo,
        &tree,
    )
    .unwrap();
    let mut stored_config = config.to_json(false);
    stored_config.patterns = Some(vec![positioned.to_json()]);
    stored_config.index = Some(0);
    let prototype = Stretch {
        id: "1,2".to_string(),
        configuration: None,
        pattern: Some(positioned.to_json()),
        repo: Some(RepositoryModel {
            configurations: vec![stored_config],
            index: 0,
            // Same junction below, so the stored repository is still valid and
            // is reused rather than regenerated.
            signature: Some(repo.signature.clone()),
        }),
    };
    let junction = repo_valid_junction(&tree);
    let mut restored = LayoutRepository::new(&tree, "1,2", &[junction], Some(&prototype)).unwrap();

    assert!(repo_device_graphics(&restored, &tree).is_err());
    assert!(
        restored
            .initialize_selected_pattern_with_tree(&tree)
            .unwrap()
    );
    let graphics = repo_device_graphics(&restored, &tree).unwrap();

    assert_eq!(graphics.len(), 1);
    assert_eq!(graphics[0].0, "s1,2.0");
    assert!(!graphics[0].1.ridges.is_empty());
}

fn path(points: &[(f64, f64)]) -> Vec<PathPoint> {
    points.iter().map(|(x, y)| PathPoint::new(*x, *y)).collect()
}

fn two_leaf_tree() -> BpTree {
    BpTree::new(
        &[
            Edge {
                n1: 0,
                n2: 1,
                length: 2.0,
            },
            Edge {
                n1: 0,
                n2: 2,
                length: 2.0,
            },
        ],
        &[
            Flap {
                id: 1,
                x: 0.0,
                y: 0.0,
                width: 0.0,
                height: 0.0,
            },
            Flap {
                id: 2,
                x: 8.0,
                y: 8.0,
                width: 0.0,
                height: 0.0,
            },
        ],
    )
    .unwrap()
}

fn branched_tree() -> BpTree {
    BpTree::new(
        &[
            Edge {
                n1: 0,
                n2: 3,
                length: 1.0,
            },
            Edge {
                n1: 3,
                n2: 1,
                length: 1.0,
            },
            Edge {
                n1: 3,
                n2: 2,
                length: 1.0,
            },
        ],
        &[
            Flap {
                id: 1,
                x: 0.0,
                y: 0.0,
                width: 0.0,
                height: 0.0,
            },
            Flap {
                id: 2,
                x: 4.0,
                y: 4.0,
                width: 0.0,
                height: 0.0,
            },
        ],
    )
    .unwrap()
}

fn layout_config(partitions: Vec<Partition>, single_mode: bool) -> LayoutConfiguration {
    LayoutConfiguration::new(
        Configuration {
            partitions,
            raw: None,
            patterns: None,
            index: None,
        },
        single_mode,
    )
}

fn partition(overlap: Overlap) -> Partition {
    Partition {
        overlaps: vec![overlap],
        strategy: None,
    }
}

fn overlap_with_quadrants(parent: usize, ox: f64, oy: f64) -> Overlap {
    Overlap {
        c: vec![
            corner(CornerType::Flap, Some(1), Some(QuadrantDirection::Ur as u8)),
            corner(CornerType::Side, None, None),
            corner(CornerType::Flap, Some(2), Some(QuadrantDirection::Ll as u8)),
            corner(CornerType::Flap, Some(2), Some(QuadrantDirection::Lr as u8)),
        ],
        ox,
        oy,
        id: None,
        parent,
        shift: None,
    }
}

fn device(size: f64) -> Device {
    Device {
        gadgets: vec![Gadget {
            pieces: vec![Piece {
                ox: size,
                oy: size,
                u: 0.0,
                v: 0.0,
                detours: None,
                shift: None,
            }],
            offset: None,
            anchors: None,
        }],
        offset: None,
        add_ons: None,
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

fn repo_valid_junction(tree: &BpTree) -> ValidJunction {
    ValidJunction::new(
        tree,
        1,
        2,
        ValidJunctionData {
            lca: 0,
            s: Point { x: 8.0, y: 8.0 },
            o: Point { x: 0.0, y: 0.0 },
            f: Point { x: 1.0, y: 1.0 },
            dir: QuadrantDirection::Ur,
            tip: Point { x: 0.0, y: 0.0 },
        },
    )
    .unwrap()
}

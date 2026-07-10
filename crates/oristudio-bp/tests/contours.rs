use oristudio_bp::layout::contours::{
    ContourPath, CriticalCorner, PatternContour, RationalContour, RationalPathEx, RoughContour,
    TraceContour, build_pattern_contours, build_rough_contours, build_trace_contours,
    check_critical_corners, combine_contours, combine_graphical_contours, corner_signature,
    create_leaf_sets, create_raw_contour_for_leaf, create_start_end_map, create_trace_contour,
    critical_corners_for_node, expand_path, expand_rough_contours, leaf_rough_contour,
    process_pattern_contours, simplify, span, to_graphical_contours, to_graphical_contours_ex,
};
use oristudio_bp::layout::trace::{RepoTrace, Trace};
use oristudio_bp::layout::{LayoutRepository, ValidJunction, ValidJunctionData};
use oristudio_bp::math::geometry::{PathPoint, Point, map_directions};
use oristudio_bp::model::{Edge, Flap, NodeId, Point as LayoutPoint};
use oristudio_bp::shared::QuadrantDirection;
use oristudio_bp::sweep::PathEx;
use oristudio_bp::tree::BpTree;
use std::collections::{BTreeMap, BTreeSet};

#[test]
fn rough_contour_path_helpers_match_bp_expansion_and_simplification() {
    let square = path(&[(2.0, 2.0), (0.0, 2.0), (0.0, 0.0), (2.0, 0.0)], false);
    let expanded = expand_path(&square, 1.0);
    assert_points(
        &expanded.points,
        &[(3.0, 3.0), (-1.0, 3.0), (-1.0, -1.0), (3.0, -1.0)],
    );
    assert_eq!(span(&expanded), 4.0);

    let with_midpoints = path(
        &[
            (3.0, 3.0),
            (1.0, 3.0),
            (-1.0, 3.0),
            (-1.0, -1.0),
            (3.0, -1.0),
        ],
        true,
    );
    let simplified = simplify(&with_midpoints);
    assert!(simplified.is_hole);
    assert_points(
        &simplified.points,
        &[(3.0, 3.0), (-1.0, 3.0), (-1.0, -1.0), (3.0, -1.0)],
    );
}

#[test]
fn rough_contours_expand_and_preserve_children_and_leaves() {
    let first = rough(1, &[(2.0, 2.0), (0.0, 2.0), (0.0, 0.0), (2.0, 0.0)]);
    let second = rough(2, &[(6.0, 2.0), (4.0, 2.0), (4.0, 0.0), (6.0, 0.0)]);
    let expanded = expand_rough_contours(&[first, second], 1.0, 0);

    assert_eq!(expanded.len(), 1);
    assert_eq!(expanded[0].id, 0);
    assert_eq!(expanded[0].children.len(), 2);
    assert_eq!(expanded[0].leaves, vec![1, 2]);
    assert_eq!(expanded[0].outer.len(), 1);
}

#[test]
fn leaf_rough_contour_uses_aabb_path_and_leaf_id() {
    let tree = BpTree::new(
        &[Edge {
            n1: 0,
            n2: 1,
            length: 2.0,
        }],
        &[Flap {
            id: 1,
            x: 1.0,
            y: 2.0,
            width: 3.0,
            height: 4.0,
        }],
    )
    .unwrap();
    let contour = leaf_rough_contour(tree.node(1).unwrap());

    assert_eq!(contour.id, 1);
    assert_eq!(contour.leaves, vec![1]);
    assert!(contour.children.is_empty());
    assert_points(
        &contour.outer[0].points,
        &[(6.0, 8.0), (-1.0, 8.0), (-1.0, 0.0), (6.0, 0.0)],
    );
}

#[test]
fn combine_contours_inserts_pattern_contour_into_paired_outer_path() {
    let trace = TraceContour {
        outer: vec![ContourPath::new(path_points(&[
            (0.0, 0.0),
            (4.0, 0.0),
            (4.0, 4.0),
            (0.0, 4.0),
        ]))],
        inner: Vec::new(),
        leaves: vec![1],
        raw: false,
    };
    let pattern = PatternContour {
        points: exact_points(&["(4,1)", "(2,2)", "(1,4)"]),
        ids: vec![1],
        repo: Some("repo".to_string()),
        for_index: Some(0),
        leaves: vec![1],
    };

    let contours = combine_contours(&[trace], &[pattern], &[]).unwrap();

    assert_eq!(contours.len(), 1);
    assert_points(
        &contours[0].outer,
        &[
            (0.0, 0.0),
            (4.0, 0.0),
            (4.0, 1.0),
            (2.0, 2.0),
            (1.0, 4.0),
            (0.0, 4.0),
        ],
    );
}

#[test]
fn extended_graphical_contours_match_compatibility_wrapper_geometry() {
    let trace = TraceContour {
        outer: vec![ContourPath::new(path_points(&[
            (0.0, 0.0),
            (4.0, 0.0),
            (4.0, 4.0),
            (0.0, 4.0),
        ]))],
        inner: Vec::new(),
        leaves: vec![1],
        raw: false,
    };
    let pattern = PatternContour {
        points: exact_points(&["(4,1)", "(2,2)", "(1,4)"]),
        ids: vec![1],
        repo: Some("repo".to_string()),
        for_index: Some(0),
        leaves: vec![1],
    };

    let extended = combine_graphical_contours(
        std::slice::from_ref(&trace),
        std::slice::from_ref(&pattern),
        &[],
    )
    .unwrap();
    let compat = combine_contours(&[trace], &[pattern], &[]).unwrap();

    assert_eq!(extended.len(), compat.len());
    assert_eq!(extended[0].outer.points, compat[0].outer);
    assert_eq!(extended[0].inner, compat[0].inner);
    assert!(!extended[0].outer.is_hole);
}

#[test]
fn graphical_contours_handle_upstream_raw_mode_floating_error_fixture() {
    let contour = RationalContour {
        outer: vec![
            rational_path_ex(
                "(34,32),(34,44),(14,44),(14,25),(130/7,25),(22,24),(26,24),(26,41/2),(28,67/4),(28,16),(42,16),(42,32)",
            ),
            rational_path_ex("(20,44),(0,44),(0,24),(12,24),(72/5,25),(20,25)"),
            rational_path_ex("(12,39),(12,25),(22,25),(22,39)"),
        ],
        inner: vec![
            rational_path_ex("(32,42),(16,42),(16,27),(132/7,27),(156/7,26),(32,26)"),
            rational_path_ex("(18,42),(2,42),(2,26),(58/5,26),(14,27),(18,27)"),
            rational_path_ex("(14,37),(14,27),(20,27),(20,37)"),
            rational_path_ex("(40,30),(28,30),(28,21),(148/5,18),(40,18)"),
        ],
        leaves: Vec::new(),
        raw: true,
    };

    let result = to_graphical_contours(&contour).unwrap();

    assert!(result.iter().any(|contour| {
        contour
            .inner
            .iter()
            .any(|inner| inner.iter().any(|point| point.x == 28.0 && point.y == 26.0))
    }));
}

#[test]
fn extended_graphical_contours_preserve_trivial_outer_path_metadata() {
    let contour = RationalContour {
        outer: vec![RationalPathEx {
            points: parse_point_list("(0,0),(4,0),(4,4),(0,4)"),
            is_hole: false,
            leaves: None,
        }],
        inner: Vec::new(),
        leaves: Vec::new(),
        raw: false,
    };

    let extended = to_graphical_contours_ex(&contour).unwrap();
    let compat = to_graphical_contours(&contour).unwrap();

    assert_eq!(extended[0].outer.points, compat[0].outer);
    assert_eq!(extended[0].inner, compat[0].inner);
    assert!(!extended[0].outer.is_hole);
}

#[test]
fn pattern_contour_start_end_map_uses_repo_directional_quadrants() {
    let tree = two_leaf_tree();
    let repo = repo(&tree);
    let trace = empty_repo_trace(&repo);
    let quadrants = repo.directional_quadrants[QuadrantDirection::Ur as usize]
        .iter()
        .map(|code| repo.quadrants.get(code).unwrap().clone())
        .collect::<Vec<_>>();

    let map = create_start_end_map(&quadrants, &trace, &repo, &tree).unwrap();

    assert!(map[QuadrantDirection::Ur as usize].is_some());
    assert!(map[QuadrantDirection::Ul as usize].is_none());
}

#[test]
fn pattern_contour_processing_skips_irrelevant_raw_components() {
    let tree = two_leaf_tree();
    let repo = repo(&tree);
    let trace = empty_repo_trace(&repo);
    let trace_contour = TraceContour {
        outer: vec![
            ContourPath::new(path_points(&[
                (0.0, 0.0),
                (4.0, 0.0),
                (4.0, 4.0),
                (0.0, 4.0),
            ]))
            .with_leaves(vec![1, 2]),
        ],
        inner: Vec::new(),
        leaves: vec![1, 2],
        raw: true,
    };

    let contours = process_pattern_contours(&[trace_contour], &[], &trace, &repo, &tree).unwrap();

    assert!(contours.is_empty());
}

#[test]
fn pattern_contour_builder_skips_repositories_without_selected_patterns() {
    let tree = two_leaf_tree();
    let repo = repo(&tree);
    let mut trace_contours = BTreeMap::new();
    trace_contours.insert(
        1,
        vec![TraceContour {
            outer: vec![ContourPath::new(path_points(&[
                (0.0, 0.0),
                (4.0, 0.0),
                (4.0, 4.0),
                (0.0, 4.0),
            ]))],
            inner: Vec::new(),
            leaves: vec![1],
            raw: false,
        }],
    );

    let contours = build_pattern_contours(&tree, &trace_contours, &[&repo]).unwrap();

    assert!(contours.is_empty());
}

#[test]
fn trace_contour_critical_corner_signatures_require_direction() {
    let contour = ContourPath::new(path_points(&[
        (0.0, 0.0),
        (4.0, 0.0),
        (4.0, 4.0),
        (0.0, 4.0),
    ]));
    let direction = test_quadrant_direction(map_directions(&contour.points)[0]);
    let mut corners = BTreeSet::from([corner_signature(contour.points[0], direction)]);

    assert!(check_critical_corners(&[contour], &mut corners));
    assert!(corners.is_empty());

    let mut missing = BTreeSet::from([corner_signature(
        PathPoint::new(99.0, 99.0),
        QuadrantDirection::Ur,
    )]);
    assert!(!check_critical_corners(&[], &mut missing));
}

#[test]
fn trace_contour_leaf_sets_preserve_shared_leaf_break_behavior() {
    let tree = three_leaf_tree();
    let repo12 =
        LayoutRepository::new(&tree, "s1,2", &[repo_valid_junction_for(&tree, 1, 2)], None)
            .unwrap();
    let repo13 =
        LayoutRepository::new(&tree, "s1,3", &[repo_valid_junction_for(&tree, 1, 3)], None)
            .unwrap();
    let mut remaining = BTreeSet::from([1, 2, 3]);

    let leaf_sets = create_leaf_sets(
        &[repo12.node_set.clone(), repo13.node_set.clone()],
        &mut remaining,
    );

    assert_eq!(leaf_sets[0].leaves, vec![1, 2]);
    assert!(leaf_sets[0].has_overlapping);
    assert_eq!(leaf_sets[1].leaves, vec![1, 3]);
    assert!(leaf_sets[1].has_overlapping);
    assert_eq!(remaining, BTreeSet::from([3]));
}

#[test]
fn trace_contour_raw_leaf_expands_and_applies_covered_junction_detours() {
    let tree = chain_tree();
    let node = tree.node(10).unwrap();
    let leaf = tree.node(1).unwrap();
    let length = leaf.dist - node.dist - leaf.length + node.length;
    let expected = expand_path(&leaf_rough_contour(leaf).outer[0], length);

    let raw = create_raw_contour_for_leaf(node, leaf, &[]).unwrap();
    assert_eq!(raw.points, expected.points);

    let covered = vec![covered_junction(&tree)];
    let detoured = create_raw_contour_for_leaf(node, leaf, &covered).unwrap();
    assert_eq!(detoured.points.len(), expected.points.len() + 2);
}

#[test]
fn rough_and_trace_task_helpers_build_bottom_up_contours() {
    let tree = branched_internal_tree();
    let roughs = build_rough_contours(&tree).unwrap();

    assert!(roughs.contains_key(&1));
    assert!(roughs.contains_key(&2));
    assert!(roughs.contains_key(&10));
    assert!(!roughs.contains_key(&0));
    let mut node_leaves = roughs
        .get(&10)
        .unwrap()
        .iter()
        .flat_map(|rough| rough.leaves.iter().copied())
        .collect::<Vec<_>>();
    node_leaves.sort_unstable();
    assert_eq!(node_leaves, vec![1, 2]);

    let traces = build_trace_contours(&tree, &roughs, &[], &BTreeMap::new()).unwrap();
    let node_traces = traces.get(&10).unwrap();
    assert_eq!(node_traces.len(), roughs.get(&10).unwrap().len());
    assert!(node_traces.iter().all(|trace| !trace.raw));
}

#[test]
fn trace_task_collects_repository_critical_corners() {
    let tree = two_leaf_tree();
    let repo = repo(&tree);
    let node = tree.node(1).unwrap();

    let corners = critical_corners_for_node(node, &[&repo], &tree).unwrap();

    assert_eq!(corners.len(), 1);
    assert_eq!(corners[0].flap, 1);
    assert!(corners[0].signature.ends_with(",0"));
    assert_eq!(corners[0].node_set.leaves, vec![1, 2]);
}

#[test]
fn trace_contour_helper_switches_to_raw_mode_when_critical_corner_is_hidden() {
    let tree = two_leaf_tree();
    let repo = repo(&tree);
    let node = tree.node(0).unwrap();
    let rough = RoughContour {
        id: 0,
        outer: vec![path(
            &[(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)],
            false,
        )],
        children: vec![
            leaf_rough_contour(tree.node(1).unwrap()),
            leaf_rough_contour(tree.node(2).unwrap()),
        ],
        leaves: vec![1, 2],
    };
    let critical = CriticalCorner {
        signature: "99,99,0".to_string(),
        flap: 1,
        node_set: repo.node_set.clone(),
    };

    let trace =
        create_trace_contour(node, &rough, &[critical], &[], &tree, &BTreeMap::new()).unwrap();

    assert!(trace.raw);
    assert_eq!(trace.leaves, vec![1, 2]);
    assert!(!trace.outer.is_empty());
}

fn rough(id: NodeId, points: &[(f64, f64)]) -> RoughContour {
    RoughContour {
        id,
        outer: vec![path(points, false)],
        children: Vec::new(),
        leaves: vec![id],
    }
}

fn path_points(points: &[(f64, f64)]) -> Vec<PathPoint> {
    points.iter().map(|(x, y)| PathPoint::new(*x, *y)).collect()
}

fn path(points: &[(f64, f64)], is_hole: bool) -> PathEx {
    PathEx {
        points: path_points(points),
        is_hole,
        from: None,
    }
}

fn exact_points(points: &[&str]) -> Vec<Point> {
    points
        .iter()
        .map(|point| Point::parse_test(point).unwrap())
        .collect()
}

fn rational_path_ex(points: &str) -> RationalPathEx {
    RationalPathEx {
        points: parse_point_list(points),
        is_hole: false,
        leaves: None,
    }
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

fn three_leaf_tree() -> BpTree {
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
            Edge {
                n1: 0,
                n2: 3,
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
            Flap {
                id: 3,
                x: -8.0,
                y: 8.0,
                width: 0.0,
                height: 0.0,
            },
        ],
    )
    .unwrap()
}

fn chain_tree() -> BpTree {
    BpTree::new(
        &[
            Edge {
                n1: 0,
                n2: 10,
                length: 5.0,
            },
            Edge {
                n1: 10,
                n2: 1,
                length: 2.0,
            },
            Edge {
                n1: 10,
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

fn branched_internal_tree() -> BpTree {
    BpTree::new(
        &[
            Edge {
                n1: 0,
                n2: 10,
                length: 2.0,
            },
            Edge {
                n1: 0,
                n2: 3,
                length: 2.0,
            },
            Edge {
                n1: 10,
                n2: 1,
                length: 2.0,
            },
            Edge {
                n1: 10,
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
            Flap {
                id: 3,
                x: -8.0,
                y: 8.0,
                width: 0.0,
                height: 0.0,
            },
        ],
    )
    .unwrap()
}

fn repo(tree: &BpTree) -> LayoutRepository {
    LayoutRepository::new(tree, "s1,2", &[repo_valid_junction(tree)], None).unwrap()
}

fn empty_repo_trace(repo: &LayoutRepository) -> RepoTrace {
    RepoTrace::new(
        Trace::new(Vec::new(), repo.direction(), Vec::new()),
        repo.node_set.leaves.iter().copied(),
    )
}

fn repo_valid_junction(tree: &BpTree) -> ValidJunction {
    repo_valid_junction_for(tree, 1, 2)
}

fn repo_valid_junction_for(tree: &BpTree, a: NodeId, b: NodeId) -> ValidJunction {
    ValidJunction::new(
        tree,
        a,
        b,
        ValidJunctionData {
            lca: 0,
            s: LayoutPoint { x: 8.0, y: 8.0 },
            o: LayoutPoint { x: 0.0, y: 0.0 },
            f: LayoutPoint { x: 1.0, y: 1.0 },
            dir: QuadrantDirection::Ur,
            tip: LayoutPoint { x: 0.0, y: 0.0 },
        },
    )
    .unwrap()
}

fn covered_junction(tree: &BpTree) -> ValidJunction {
    ValidJunction::new(
        tree,
        1,
        2,
        ValidJunctionData {
            lca: 10,
            s: LayoutPoint { x: 8.0, y: 8.0 },
            o: LayoutPoint { x: 3.0, y: 2.0 },
            f: LayoutPoint { x: 1.0, y: 1.0 },
            dir: QuadrantDirection::Ur,
            tip: LayoutPoint { x: 0.0, y: 0.0 },
        },
    )
    .unwrap()
}

fn test_quadrant_direction(value: u8) -> QuadrantDirection {
    match value {
        0 => QuadrantDirection::Ur,
        1 => QuadrantDirection::Ul,
        2 => QuadrantDirection::Ll,
        _ => QuadrantDirection::Lr,
    }
}

fn parse_point_list(points: &str) -> Vec<Point> {
    points
        .split("),")
        .map(|point| {
            let mut point = point.to_string();
            if !point.ends_with(')') {
                point.push(')');
            }
            Point::parse_test(&point).unwrap()
        })
        .collect()
}

fn assert_points(actual: &[PathPoint], expected: &[(f64, f64)]) {
    assert_eq!(actual.len(), expected.len());
    for (point, (x, y)) in actual.iter().zip(expected) {
        assert_eq!((point.x, point.y), (*x, *y));
    }
}

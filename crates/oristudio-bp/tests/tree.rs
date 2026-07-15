use oristudio_bp::model::{Edge, Flap, NodeId};
use oristudio_bp::tree::{AreaTree, BpTree};

fn edge(n1: NodeId, n2: NodeId, length: f64) -> Edge {
    Edge { n1, n2, length }
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

fn parse_tree(edges: &str, flaps: Option<&str>) -> BpTree {
    let edges = edges
        .split("),")
        .filter(|part| !part.trim().is_empty())
        .map(|part| {
            let clean = part.trim_matches(|c| c == '(' || c == ')' || c == ' ');
            let values = clean
                .split(',')
                .map(|value| value.parse::<f64>().unwrap())
                .collect::<Vec<_>>();
            edge(values[0] as NodeId, values[1] as NodeId, values[2])
        })
        .collect::<Vec<_>>();
    let flaps = flaps
        .map(|flaps| {
            flaps
                .split("),")
                .filter(|part| !part.trim().is_empty())
                .map(|part| {
                    let clean = part.trim_matches(|c| c == '(' || c == ')' || c == ' ');
                    let values = clean
                        .split(',')
                        .map(|value| value.parse::<f64>().unwrap())
                        .collect::<Vec<_>>();
                    flap(
                        values[0] as NodeId,
                        values[1],
                        values[2],
                        values[3],
                        values[4],
                    )
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    BpTree::new(&edges, &flaps).unwrap()
}

#[test]
fn tree_is_constructed_from_edges() {
    let tree = BpTree::new(&[edge(0, 1, 2.0), edge(0, 2, 2.0)], &[]).unwrap();

    assert_eq!(tree.nodes().len(), 3);
    assert_eq!(tree.root_id(), 0);
    assert_eq!(tree.node(tree.root_id()).unwrap().height, 1);
}

#[test]
fn tree_is_foolproof_on_invalid_input() {
    let tree = BpTree::new(
        &[
            edge(0, 1, 2.0),
            edge(2, 3, 2.0),
            edge(1, 2, 2.0),
            edge(1, 2, 3.0),
            edge(2, 1, 4.0),
            edge(2, 0, 1.0),
            edge(4, 3, 1.0),
        ],
        &[],
    )
    .unwrap();

    assert!(tree.node(0).is_some());
    assert!(tree.node(4).is_some());
}

#[test]
fn tree_balances_itself() {
    let mut tree = parse_tree("(0,1,2),(0,2,2)", None);
    assert_eq!(tree.root_id(), 0);

    tree.add_edge(3, 1, 2.0).unwrap();
    tree.add_edge(4, 3, 2.0).unwrap();

    assert_eq!(tree.root_id(), 1);
    assert_eq!(tree.node(tree.root_id()).unwrap().height, 2);
}

#[test]
fn tree_can_remove_leaf_nodes() {
    let mut tree = parse_tree("(0,1,2),(0,2,2),(2,3,2),(3,4,2)", None);

    assert_eq!(tree.root_id(), 2);
    assert!(tree.node(1).is_some());
    assert!(tree.node(0).is_some());

    assert!(!tree.remove_leaf(0).unwrap());
    tree.flush_remove().unwrap();
    assert!(tree.node(0).is_some());

    assert!(tree.remove_leaf(1).unwrap());
    assert!(tree.remove_leaf(0).unwrap());
    tree.flush_remove().unwrap();
    assert!(tree.node(1).is_none());
    assert!(tree.node(0).is_none());

    tree.recompute().unwrap();
    assert_eq!(tree.root_id(), 3);
    assert_eq!(tree.node(tree.root_id()).unwrap().height, 1);
}

#[test]
fn tree_keeps_distance_records() {
    let mut tree = parse_tree("(0,1,1),(0,2,2),(2,3,3),(3,4,4)", None);

    assert_eq!(tree.node(0).unwrap().dist, 2.0);
    assert_eq!(tree.node(2).unwrap().dist, 0.0);
    assert_eq!(tree.node(0).unwrap().parent, Some(2));
    assert_eq!(tree.dist(0, 3).unwrap(), 5.0);
    assert_eq!(tree.dist(1, 4).unwrap(), 10.0);

    tree.set_length(0, 5.0).unwrap();
    assert_eq!(tree.dist(1, 4).unwrap(), 13.0);
}

#[test]
fn tree_outputs_balanced_json() {
    let tree = parse_tree("(0,1,1),(0,2,2),(2,3,3),(3,4,4)", None);
    let edges = tree.to_json().edges;

    assert_eq!(
        edges,
        vec![
            edge(2, 3, 3.0),
            edge(2, 0, 2.0),
            edge(3, 4, 4.0),
            edge(0, 1, 1.0),
        ]
    );
}

#[test]
fn tree_creates_distance_map() {
    let tree = parse_tree("(0,1,1),(0,2,2),(0,3,2),(3,4,1),(3,5,2)", None);
    let dist_map = tree.dist_map();

    assert_eq!(dist_map.len(), 6);
    assert!(dist_map.contains(&(5, 4, 3.0)) || dist_map.contains(&(4, 5, 3.0)));
    assert!(dist_map.contains(&(4, 1, 4.0)) || dist_map.contains(&(1, 4, 4.0)));
    assert!(dist_map.contains(&(5, 2, 6.0)) || dist_map.contains(&(2, 5, 6.0)));
}

#[test]
fn tree_updates_aabb_when_child_updates() {
    let mut tree = parse_tree(
        "(0,1,1),(1,2,2),(0,3,3),(3,4,4)",
        Some("(2,8,8,0,0),(4,5,2,0,0)"),
    );

    assert_eq!(
        tree.node(2).unwrap().aabb.to_array(),
        [10.0, 10.0, 6.0, 6.0]
    );
    assert_eq!(
        tree.node(1).unwrap().aabb.to_array(),
        [11.0, 11.0, 5.0, 5.0]
    );
    assert_eq!(tree.node(4).unwrap().aabb.to_array(), [6.0, 9.0, -2.0, 1.0]);
    assert_eq!(
        tree.node(3).unwrap().aabb.to_array(),
        [9.0, 12.0, -5.0, -2.0]
    );
    assert_eq!(
        tree.node(0).unwrap().aabb.to_array(),
        [11.0, 12.0, -5.0, -2.0]
    );

    tree.set_aabb(2, 0.0, 0.0, 0.0, 0.0).unwrap();
    assert_eq!(
        tree.node(0).unwrap().aabb.to_array(),
        [9.0, 12.0, -5.0, -3.0]
    );
}

#[test]
fn tree_updates_aabb_when_child_node_is_removed() {
    let mut tree = parse_tree(
        "(0,1,1),(1,2,1),(2,3,1),(2,4,1),(0,5,1),(5,6,1)",
        Some("(6,0,0,0,0),(3,3,2,0,0),(4,5,2,0,0)"),
    );
    assert_eq!(tree.node(1).unwrap().aabb.to_array(), [5.0, 8.0, -1.0, 0.0]);

    assert!(tree.remove_leaf(3).unwrap());
    tree.flush_remove().unwrap();
    assert_eq!(tree.node(1).unwrap().aabb.to_array(), [5.0, 8.0, -1.0, 2.0]);
}

#[test]
fn tree_join_split_and_merge_match_upstream_root_behavior() {
    let mut join_tree = parse_tree("(0,1,2),(1,2,2),(0,3,2),(3,4,2)", None);
    assert_eq!(join_tree.root_id(), 0);
    join_tree.join(1).unwrap();
    assert_eq!(join_tree.root_id(), 0);
    assert_eq!(join_tree.node(2).unwrap().parent, Some(0));
    join_tree.join(0).unwrap();
    assert_eq!(join_tree.root_id(), 3);

    let mut split_tree = parse_tree("(0,1,2),(1,2,2),(0,3,2),(3,4,2),(4,5,2)", None);
    assert_eq!(split_tree.root_id(), 0);
    split_tree.split(6, 3).unwrap();
    assert_eq!(split_tree.root_id(), 6);

    let mut merge_tree = parse_tree("(0,1,2),(1,2,2),(1,3,2),(0,4,2),(0,5,2)", None);
    merge_tree.merge(1).unwrap();
    assert_eq!(merge_tree.root_id(), 0);
    assert_eq!(merge_tree.node(0).unwrap().children.len(), 4);
}

#[test]
fn area_tree_simplifies_tree_structure() {
    let tree = parse_tree("(0,1,1),(1,2,1),(0,3,1),(3,4,1)", None);
    let area_tree = AreaTree::new(&tree, false).unwrap();
    let ids = area_tree
        .nodes()
        .iter()
        .flatten()
        .map(|node| node.id)
        .collect::<Vec<_>>();

    assert_eq!(ids, vec![0, 2, 4]);
}

#[test]
fn area_tree_balances_tree_by_area() {
    let tree = parse_tree(
        "(0,1,1),(1,2,1),(1,3,1),(0,4,1),(4,5,4),(4,6,3)",
        Some("(2,0,0,1,1),(3,0,0,0,0),(5,0,0,0,0),(6,0,0,0,0)"),
    );
    let area_tree = AreaTree::new(&tree, true).unwrap();

    assert_eq!(area_tree.root_id(), 4);
    assert!(area_tree.root().parent.is_none());
    let areas = area_tree
        .root()
        .children
        .iter()
        .map(|id| area_tree.nodes()[*id as usize].as_ref().unwrap().area)
        .collect::<Vec<_>>();
    let expected = (f64::sqrt(2.0 + 5.0 / std::f64::consts::PI) + 1.0).powi(2);
    assert_eq!(areas.len(), 3);
    assert!((areas[0] - 16.0).abs() < 1e-10);
    assert!((areas[1] - 9.0).abs() < 1e-10);
    assert!((areas[2] - expected).abs() < 1e-10);
    assert_eq!(area_tree.nodes()[0].as_ref().unwrap().length, 1.0);
}

#[test]
fn area_tree_creates_hierarchy() {
    let tree = parse_tree(
        "(16,20,3),(16,49,2),(16,9,1),(16,18,1),(16,7,1),(20,29,1),(20,21,4),(20,23,3),(20,24,3),(20,25,2),(20,26,1),(20,27,1),(20,28,1),(20,22,2),(49,38,1),(49,50,1),(9,12,1),(9,15,2),(9,10,3),(9,11,1),(18,19,14),(18,17,7),(7,0,5),(7,8,1),(29,32,1),(29,37,6),(29,31,5),(38,39,2),(38,46,2),(12,14,1),(12,13,1),(0,1,1),(0,2,1),(0,3,1),(0,4,1),(0,5,1),(0,6,1),(32,33,2),(32,30,5),(39,45,1),(39,41,1),(39,42,1),(39,43,1),(39,44,1),(39,40,1),(46,47,1),(46,48,1),(33,34,7),(33,35,1),(33,36,7)",
        None,
    );
    let area_tree = AreaTree::new(&tree, true).unwrap();
    let hierarchies = area_tree.create_hierarchy().unwrap();

    assert_eq!(hierarchies.len(), 3);
    assert_eq!(
        hierarchies
            .iter()
            .map(|hierarchy| hierarchy.leaves.len())
            .collect::<Vec<_>>(),
        vec![5, 23, 37]
    );
}

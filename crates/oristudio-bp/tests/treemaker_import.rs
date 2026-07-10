use oristudio_bp::GridType;
use oristudio_bp::io::treemaker_import::{TreeMakerParser, TreeMakerVisitor, tree_maker};

#[test]
fn tree_maker_import_reads_upstream_v5_sample() {
    let sample = include_str!("../../../tests/fixtures/bp-studio/sample.tmd5");
    let project = tree_maker("Test", sample).expect("sample imports");

    assert_eq!(project.design.title, "Test");
    assert_eq!(project.design.tree.nodes.len(), 7);
    assert_eq!(project.design.tree.edges.len(), 6);
    assert_eq!(project.design.layout.flaps.len(), 5);
    assert_eq!(project.design.tree.sheet.grid_type, GridType::Rectangular);
    assert_eq!(project.design.tree.sheet.width, 8.0);
    assert_eq!(project.design.tree.sheet.height, 8.0);
    assert_eq!(project.design.layout.sheet, project.design.tree.sheet);

    let first = &project.design.tree.nodes[0];
    assert_eq!(first.id, 1);
    assert_eq!(first.x, 4.0);
    assert_eq!(first.y, 3.0);
    assert_eq!(
        project
            .design
            .layout
            .flaps
            .iter()
            .map(|flap| flap.id)
            .collect::<Vec<_>>(),
        vec![2, 3, 5, 6, 7]
    );
    assert_eq!(
        project
            .design
            .tree
            .edges
            .iter()
            .map(|edge| edge.length)
            .collect::<Vec<_>>(),
        vec![3.0, 3.0, 2.0, 3.0, 3.0, 1.0]
    );
}

#[test]
fn tree_maker_import_applies_denominator_lcm_and_rounding_quirks() {
    let project = tree_maker("Fractional", &fractional_tmd5()).expect("fractional file imports");

    assert_eq!(project.design.title, "Fractional");
    assert_eq!(project.design.tree.sheet.width, 16.0);
    assert_eq!(project.design.tree.sheet.height, 16.0);
    assert_eq!(project.design.tree.nodes[0].name, "leaf a");
    assert_eq!(project.design.tree.nodes[0].x, 4.0);
    assert_eq!(project.design.tree.nodes[0].y, 4.0);
    assert_eq!(project.design.tree.nodes[1].x, 12.0);
    assert_eq!(project.design.tree.nodes[1].y, 12.0);
    assert_eq!(project.design.layout.flaps[0].x, 4.0);
    assert_eq!(project.design.layout.flaps[1].y, 12.0);
    assert_eq!(project.design.tree.edges[0].n1, 1);
    assert_eq!(project.design.tree.edges[0].n2, 2);
    assert_eq!(project.design.tree.edges[0].length, 1.0);
}

#[test]
fn tree_maker_import_rejects_invalid_and_corrupted_files() {
    assert!(tree_maker("Bad", "invalid content").is_err());

    let sample = include_str!("../../../tests/fixtures/bp-studio/sample.tmd5");
    assert!(
        tree_maker(
            "Bad",
            sample.get(..100).expect("ascii fixture prefix exists")
        )
        .is_err()
    );
}

#[test]
fn tree_maker_parser_exposes_direct_bp_studio_visitor_shape() {
    let data = fractional_tmd5();
    let visitor = TreeMakerVisitor::new(&data);
    let parser = TreeMakerParser::parse(visitor).expect("parser reads file");

    assert_eq!(parser.result().design.tree.nodes.len(), 2);
}

fn fractional_tmd5() -> String {
    [
        "tree", "5.0", "1", "1", "0.125", "false", "0.5", "0.5", "90", "true", "false", "false",
        "false", "false", "false", "false", "2", "1", "21", "0", "0", "0", "0", "0", "node", "1",
        "leaf a", "0.25", "0.25", "-999", "0", "true", "false", "false", "false", "false", "false",
        "false", "0", "0", "0", "0", "node", "2", "leaf b", "0.75", "0.75", "-999", "0", "true",
        "false", "false", "false", "false", "false", "false", "0", "0", "0", "0", "edge", "1",
        "edge 1", "0.5", "0", "1", "true", "false", "2", "1", "2",
    ]
    .join("\n")
}

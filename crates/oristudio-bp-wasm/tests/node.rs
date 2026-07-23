use wasm_bindgen_test::*;

#[derive(serde::Deserialize, serde::Serialize)]
struct WasmWorkspaceProject {
    filename: String,
    handle: u32,
}

#[derive(serde::Deserialize)]
struct WasmProjectSummary {
    title: String,
}

#[derive(serde::Deserialize)]
struct WasmLayoutSnapshot {
    #[serde(rename = "nodeGraphics")]
    node_graphics: Vec<WasmGraphicsEntry>,
    #[serde(rename = "deviceGraphics", default)]
    device_graphics: Vec<WasmGraphicsEntry>,
    #[serde(rename = "patternNotFound")]
    pattern_not_found: bool,
}

#[derive(serde::Deserialize)]
struct WasmPackingValidation {
    valid: bool,
    errors: Vec<WasmPackingValidationError>,
}

#[derive(serde::Deserialize)]
struct WasmPackingValidationError {
    message: String,
}

#[derive(serde::Deserialize)]
struct WasmGraphicsEntry {
    id: String,
    data: WasmGraphicsData,
}

#[derive(serde::Deserialize)]
struct WasmGraphicsData {
    contours: Vec<WasmContourData>,
    #[serde(default)]
    range: Option<[f64; 2]>,
    #[serde(default)]
    location: Option<oristudio_bp::Point>,
    #[serde(default)]
    forward: Option<bool>,
}

#[derive(serde::Deserialize)]
struct WasmContourData {
    outer: Vec<oristudio_bp::Point>,
}

#[wasm_bindgen_test]
fn sample_project_can_round_trip_through_wasm_handle() {
    let handle = oristudio_bp_wasm::bp_new_sample_project().expect("sample handle");
    let exported = oristudio_bp_wasm::bp_export_bps(handle).expect("sample export");
    assert!(exported.contains("\"version\":\"0.7\""));
    oristudio_bp_wasm::bp_free_project(handle).expect("free handle");
}

#[wasm_bindgen_test]
fn tree_maker_import_and_ordered_workspace_round_trip_through_wasm_handle() {
    let imported = oristudio_bp_wasm::bp_import_treemaker(
        "Imported",
        include_str!("../../../tests/fixtures/bp-studio/sample.tmd5"),
    )
    .expect("TreeMaker import handle");
    let summary_value = oristudio_bp_wasm::bp_project_summary(imported).expect("summary");
    let summary: WasmProjectSummary =
        serde_wasm_bindgen::from_value(summary_value).expect("summary decodes");
    assert_eq!(summary.title, "Imported");

    let mut first = oristudio_bp::Project::sample();
    first.design.title = "First".to_string();
    let mut second = oristudio_bp::Project::sample();
    second.design.title = "Second".to_string();
    let archive = oristudio_bp::io::bpz::write_workspace_project_entries(&[
        ("z-last.bps".to_string(), first),
        ("a-first.bps".to_string(), second),
    ])
    .expect("workspace archive");
    let value = oristudio_bp_wasm::bp_load_workspace(&archive).expect("workspace loads");
    let projects: Vec<WasmWorkspaceProject> =
        serde_wasm_bindgen::from_value(value).expect("workspace decodes");

    assert_eq!(
        projects
            .iter()
            .map(|project| project.filename.as_str())
            .collect::<Vec<_>>(),
        vec!["z-last.bps", "a-first.bps"]
    );

    let export_request = vec![
        WasmWorkspaceProject {
            filename: "export-z.bps".to_string(),
            handle: projects[0].handle,
        },
        WasmWorkspaceProject {
            filename: "export-a.bps".to_string(),
            handle: projects[1].handle,
        },
    ];
    let exported = oristudio_bp_wasm::bp_export_workspace(
        serde_wasm_bindgen::to_value(&export_request).expect("request encodes"),
    )
    .expect("workspace exports");
    let exported_entries =
        oristudio_bp::io::bpz::read_workspace_project_entries(&exported).expect("export reads");
    assert_eq!(
        exported_entries
            .iter()
            .map(|(filename, _project)| filename.as_str())
            .collect::<Vec<_>>(),
        vec!["export-z.bps", "export-a.bps"]
    );

    oristudio_bp_wasm::bp_free_project(imported).expect("free import");
    for project in projects {
        oristudio_bp_wasm::bp_free_project(project.handle).expect("free workspace project");
    }
}

#[wasm_bindgen_test]
fn sample_project_exports_cp_and_fold_through_wasm_handle() {
    let handle = oristudio_bp_wasm::bp_new_sample_project().expect("sample handle");

    let cp = oristudio_bp_wasm::bp_export_cp(handle, false, true, 1.0).expect("cp export");
    let fold = oristudio_bp_wasm::bp_export_fold(handle, false, true).expect("fold export");

    assert!(cp.contains("1 -200 -200 -200 200"));
    assert!(fold.contains("\"file_creator\":\"Box Pleating Studio\""));
    oristudio_bp_wasm::bp_free_project(handle).expect("free handle");
}

#[wasm_bindgen_test]
fn layout_snapshot_is_available_through_wasm_handle() {
    let handle =
        oristudio_bp_wasm::bp_load_project(sample_optimizer_project_text()).expect("sample handle");
    let value = oristudio_bp_wasm::bp_project_layout_snapshot(handle).expect("layout snapshot");
    let snapshot: WasmLayoutSnapshot =
        serde_wasm_bindgen::from_value(value).expect("layout snapshot decodes");

    assert!(snapshot.node_graphics.iter().any(|entry| entry.id == "f1"));
    assert!(snapshot.node_graphics.iter().any(|entry| entry.id == "f2"));
    assert!(snapshot.node_graphics.iter().any(|entry| {
        entry
            .data
            .contours
            .iter()
            .any(|contour| !contour.outer.is_empty())
    }));
    assert!(!snapshot.pattern_not_found);

    oristudio_bp_wasm::bp_free_project(handle).expect("free handle");
}

#[wasm_bindgen_test]
fn packing_validation_reports_current_manual_layout_status() {
    let handle = oristudio_bp_wasm::bp_load_project(sample_valid_packing_project_text())
        .expect("sample handle");
    let value =
        oristudio_bp_wasm::bp_project_packing_validation(handle).expect("packing validation");
    let report: WasmPackingValidation =
        serde_wasm_bindgen::from_value(value).expect("validation report decodes");
    assert!(report.valid);
    assert!(report.errors.is_empty());

    oristudio_bp_wasm::bp_move_layout_flap(handle, 2, 0.0, 0.0, false).expect("move flap");
    let value =
        oristudio_bp_wasm::bp_project_packing_validation(handle).expect("packing validation");
    let report: WasmPackingValidation =
        serde_wasm_bindgen::from_value(value).expect("validation report decodes");
    assert!(!report.valid);
    assert!(
        report
            .errors
            .iter()
            .any(|error| error.message.contains("violates distance"))
    );

    oristudio_bp_wasm::bp_free_project(handle).expect("free handle");
}

#[wasm_bindgen_test]
fn stretch_completion_mutates_project_through_wasm_handle() {
    let project = oristudio_bp::io::bps::load_project_str(sample_stretch_project_text())
        .expect("sample project decodes");
    let tree =
        oristudio_bp::tree::BpTree::new(&project.design.tree.edges, &project.design.layout.flaps)
            .expect("sample tree builds");
    let stretch_id =
        oristudio_bp::layout::active_layout_repositories(&tree, &project.design.layout.stretches)
            .expect("active repositories")
            .into_iter()
            .map(|repository| repository.stretch_id)
            .next()
            .expect("active stretch exists");
    let handle =
        oristudio_bp_wasm::bp_load_project(sample_stretch_project_text()).expect("sample handle");
    let snapshot_value =
        oristudio_bp_wasm::bp_complete_stretch(handle, &stretch_id).expect("complete stretch");
    let snapshot: oristudio_bp::Project =
        serde_wasm_bindgen::from_value(snapshot_value).expect("complete snapshot decodes");
    let stretch = snapshot
        .design
        .layout
        .stretches
        .iter()
        .find(|stretch| stretch.id == stretch_id)
        .expect("completed stretch exists");
    let repo = stretch.repo.as_ref().expect("repository persisted");

    assert!(!repo.configurations.is_empty());
    assert!(
        repo.configurations[0]
            .patterns
            .as_ref()
            .is_some_and(|patterns| !patterns.is_empty())
    );

    oristudio_bp_wasm::bp_free_project(handle).expect("free handle");
}

#[wasm_bindgen_test]
fn stretch_store_navigation_mutates_project_through_wasm_handle() {
    let (text, stretch_id) = sample_stretch_project_with_duplicate_stores();
    let handle = oristudio_bp_wasm::bp_load_project(&text).expect("sample handle");

    let snapshot_value =
        oristudio_bp_wasm::bp_switch_stretch_config(handle, &stretch_id, 1).expect("next config");
    let snapshot: oristudio_bp::Project =
        serde_wasm_bindgen::from_value(snapshot_value).expect("config snapshot decodes");
    let repo = snapshot
        .design
        .layout
        .stretches
        .iter()
        .find(|stretch| stretch.id == stretch_id)
        .and_then(|stretch| stretch.repo.as_ref())
        .expect("repository persisted");
    assert_eq!(repo.index, 1);

    let snapshot_value = oristudio_bp_wasm::bp_switch_stretch_config(handle, &stretch_id, -1)
        .expect("previous config");
    let snapshot: oristudio_bp::Project =
        serde_wasm_bindgen::from_value(snapshot_value).expect("config snapshot decodes");
    let repo = snapshot
        .design
        .layout
        .stretches
        .iter()
        .find(|stretch| stretch.id == stretch_id)
        .and_then(|stretch| stretch.repo.as_ref())
        .expect("repository persisted");
    assert_eq!(repo.index, 0);

    let snapshot_value =
        oristudio_bp_wasm::bp_switch_stretch_pattern(handle, &stretch_id, 1).expect("next pattern");
    let snapshot: oristudio_bp::Project =
        serde_wasm_bindgen::from_value(snapshot_value).expect("pattern snapshot decodes");
    let repo = snapshot
        .design
        .layout
        .stretches
        .iter()
        .find(|stretch| stretch.id == stretch_id)
        .and_then(|stretch| stretch.repo.as_ref())
        .expect("repository persisted");
    assert_eq!(repo.configurations[0].index, Some(1));

    let snapshot_value = oristudio_bp_wasm::bp_switch_stretch_pattern(handle, &stretch_id, -1)
        .expect("previous pattern");
    let snapshot: oristudio_bp::Project =
        serde_wasm_bindgen::from_value(snapshot_value).expect("pattern snapshot decodes");
    let repo = snapshot
        .design
        .layout
        .stretches
        .iter()
        .find(|stretch| stretch.id == stretch_id)
        .and_then(|stretch| stretch.repo.as_ref())
        .expect("repository persisted");
    assert_eq!(repo.configurations[0].index, Some(0));

    oristudio_bp_wasm::bp_free_project(handle).expect("free handle");
}

#[wasm_bindgen_test]
fn device_move_mutates_project_through_wasm_handle() {
    let (text, stretch_id) = sample_stretch_project_with_duplicate_stores();
    let before_project =
        oristudio_bp::io::bps::load_project_str(&text).expect("completed project decodes");
    let old_offset = before_project
        .design
        .layout
        .stretches
        .iter()
        .find(|stretch| stretch.id == stretch_id)
        .and_then(|stretch| stretch.repo.as_ref())
        .and_then(|repo| {
            let config = repo.configurations.get(repo.index)?;
            let pattern = config
                .patterns
                .as_ref()?
                .get(config.index.expect("pattern index persisted"))?;
            pattern.devices.first()?.offset
        });
    let handle = oristudio_bp_wasm::bp_load_project(&text).expect("sample handle");
    let layout_value = oristudio_bp_wasm::bp_project_layout_snapshot(handle).expect("layout");
    let layout: WasmLayoutSnapshot =
        serde_wasm_bindgen::from_value(layout_value).expect("layout decodes");
    let device = layout
        .device_graphics
        .iter()
        .find(|entry| entry.id == format!("s{stretch_id}.0"))
        .expect("device graphics exists");
    let old = device.data.location.expect("device location is exported");
    let range = device.data.range.expect("device range is exported");
    let forward = device.data.forward.expect("device direction is exported");
    let dx = movable_device_delta(range);
    let target = oristudio_bp::Point {
        x: old.x + dx,
        y: old.y + if forward { dx } else { -dx },
    };

    let snapshot_value =
        oristudio_bp_wasm::bp_move_device(handle, &stretch_id, 0, target.x, target.y, false)
            .expect("move device");
    let snapshot: oristudio_bp::Project =
        serde_wasm_bindgen::from_value(snapshot_value).expect("move snapshot decodes");
    let repo = snapshot
        .design
        .layout
        .stretches
        .iter()
        .find(|stretch| stretch.id == stretch_id)
        .and_then(|stretch| stretch.repo.as_ref())
        .expect("repository persisted");
    let config = &repo.configurations[repo.index];
    let pattern = &config.patterns.as_ref().expect("patterns persisted")
        [config.index.expect("pattern index persisted")];
    assert_ne!(pattern.devices[0].offset, old_offset);

    oristudio_bp_wasm::bp_free_project(handle).expect("free handle");
}

#[wasm_bindgen_test]
fn layout_flap_commands_mutate_project_through_wasm_handle() {
    let handle =
        oristudio_bp_wasm::bp_load_project(sample_optimizer_project_text()).expect("sample handle");
    let snapshot_value =
        oristudio_bp_wasm::bp_move_layout_flap(handle, 1, 4.0, 5.0, false).expect("move flap");
    let snapshot: oristudio_bp::Project =
        serde_wasm_bindgen::from_value(snapshot_value).expect("move snapshot decodes");
    let moved = snapshot
        .design
        .layout
        .flaps
        .iter()
        .find(|flap| flap.id == 1)
        .expect("flap exists");
    assert_eq!((moved.x, moved.y), (4.0, 5.0));

    let ids = serde_wasm_bindgen::to_value(&vec![1_u32, 2_u32]).expect("ids encode");
    let snapshot_value =
        oristudio_bp_wasm::bp_move_layout_flaps(handle, ids, 6.0, 4.0, false).expect("move flaps");
    let snapshot: oristudio_bp::Project =
        serde_wasm_bindgen::from_value(snapshot_value).expect("move group snapshot decodes");
    let first = snapshot
        .design
        .layout
        .flaps
        .iter()
        .find(|flap| flap.id == 1)
        .expect("first flap exists");
    let second = snapshot
        .design
        .layout
        .flaps
        .iter()
        .find(|flap| flap.id == 2)
        .expect("second flap exists");
    assert_eq!((first.x, first.y), (6.0, 4.0));
    assert_eq!((second.x, second.y), (10.0, 8.0));

    let snapshot_value =
        oristudio_bp_wasm::bp_resize_layout_flap(handle, 1, 3.0, 4.0).expect("resize flap");
    let snapshot: oristudio_bp::Project =
        serde_wasm_bindgen::from_value(snapshot_value).expect("resize snapshot decodes");
    let resized = snapshot
        .design
        .layout
        .flaps
        .iter()
        .find(|flap| flap.id == 1)
        .expect("flap exists");
    assert_eq!((resized.width, resized.height), (3.0, 4.0));

    oristudio_bp_wasm::bp_free_project(handle).expect("free handle");
}

#[wasm_bindgen_test]
fn layout_sheet_commands_mutate_project_through_wasm_handle() {
    let handle =
        oristudio_bp_wasm::bp_load_project(sample_optimizer_project_text()).expect("sample handle");

    let snapshot_value =
        oristudio_bp_wasm::bp_subdivide_layout_sheet(handle).expect("subdivide sheet");
    let snapshot: oristudio_bp::Project =
        serde_wasm_bindgen::from_value(snapshot_value).expect("subdivide snapshot decodes");
    assert_eq!(snapshot.design.layout.sheet.width, 32.0);
    assert_eq!(snapshot.design.layout.flaps[0].x, 4.0);
    assert_eq!(snapshot.design.tree.edges[0].length, 10.0);

    let snapshot_value = oristudio_bp_wasm::bp_flip_layout_sheet(handle, true).expect("flip sheet");
    let snapshot: oristudio_bp::Project =
        serde_wasm_bindgen::from_value(snapshot_value).expect("flip snapshot decodes");
    assert_eq!(snapshot.design.layout.flaps[0].x, 20.0);

    oristudio_bp_wasm::bp_free_project(handle).expect("free handle");

    let handle =
        oristudio_bp_wasm::bp_load_project(sample_tree_authoring_project_text()).expect("handle");
    let snapshot_value = oristudio_bp_wasm::bp_update_layout_sheet(handle, "diagonal", 8.0, 8.0)
        .expect("switch sheet grid");
    let snapshot: oristudio_bp::Project =
        serde_wasm_bindgen::from_value(snapshot_value).expect("grid snapshot decodes");
    assert_eq!(
        snapshot.design.layout.sheet.grid_type,
        oristudio_bp::GridType::Diagonal
    );
    assert_eq!(snapshot.design.layout.sheet.width, 8.0);

    let snapshot_value = oristudio_bp_wasm::bp_update_layout_sheet(handle, "diag", 6.0, 6.0)
        .expect("resize diagonal sheet");
    let snapshot: oristudio_bp::Project =
        serde_wasm_bindgen::from_value(snapshot_value).expect("resize grid snapshot decodes");
    assert_eq!(snapshot.design.layout.sheet.width, 6.0);

    oristudio_bp_wasm::bp_free_project(handle).expect("free handle");
}

#[wasm_bindgen_test]
fn tree_authoring_commands_mutate_project_through_wasm_handle() {
    let handle =
        oristudio_bp_wasm::bp_load_project(sample_tree_authoring_project_text()).expect("handle");
    let tree_value = oristudio_bp_wasm::bp_project_tree_data(handle).expect("tree data");
    let tree: oristudio_bp::engine::UpdateTreeData =
        serde_wasm_bindgen::from_value(tree_value).expect("tree data decodes");
    assert_eq!(tree.edges.len(), 2);

    let snapshot_value = oristudio_bp_wasm::bp_add_tree_leaf(handle, 1, 2.0).expect("add leaf");
    let snapshot: oristudio_bp::Project =
        serde_wasm_bindgen::from_value(snapshot_value).expect("snapshot decodes");
    assert_eq!(snapshot.design.tree.nodes.len(), 4);
    assert_eq!(snapshot.design.layout.flaps[0].id, 3);
    let seeded_flap = (
        snapshot.design.layout.flaps[0].x,
        snapshot.design.layout.flaps[0].y,
    );

    let snapshot_value =
        oristudio_bp_wasm::bp_move_tree_vertex(handle, 3, 4.2, 5.8, false).expect("move vertex");
    let snapshot: oristudio_bp::Project =
        serde_wasm_bindgen::from_value(snapshot_value).expect("snapshot decodes");
    let moved = snapshot
        .design
        .tree
        .nodes
        .iter()
        .find(|node| node.id == 3)
        .expect("new node exists");
    assert_eq!((moved.x, moved.y, moved.is_new), (4.2, 5.8, None));
    // Moving the vertex in the tree diagram leaves its flap exactly where the
    // layout had it.
    assert_eq!(
        snapshot
            .design
            .layout
            .flaps
            .iter()
            .find(|flap| flap.id == 3)
            .map(|flap| (flap.x, flap.y)),
        Some(seeded_flap)
    );

    let snapshot_value = oristudio_bp_wasm::bp_update_tree_edge_length(handle, 0, 2, 3.0, false)
        .expect("edge length");
    let snapshot: oristudio_bp::Project =
        serde_wasm_bindgen::from_value(snapshot_value).expect("snapshot decodes");
    assert!(snapshot.design.tree.edges.iter().any(|edge| {
        ((edge.n1, edge.n2) == (0, 2) || (edge.n1, edge.n2) == (2, 0)) && edge.length == 3.0
    }));

    let snapshot_value = oristudio_bp_wasm::bp_split_tree_edge(handle, 0, 2).expect("split edge");
    let snapshot: oristudio_bp::Project =
        serde_wasm_bindgen::from_value(snapshot_value).expect("snapshot decodes");
    assert!(snapshot.design.tree.nodes.iter().any(|node| node.id == 4));

    let snapshot_value = oristudio_bp_wasm::bp_join_tree_vertex(handle, 4).expect("join vertex");
    let snapshot: oristudio_bp::Project =
        serde_wasm_bindgen::from_value(snapshot_value).expect("snapshot decodes");
    assert!(!snapshot.design.tree.nodes.iter().any(|node| node.id == 4));

    let exported = oristudio_bp_wasm::bp_export_bps(handle).expect("export");
    assert!(!exported.contains("\"isNew\""));
    oristudio_bp_wasm::bp_free_project(handle).expect("free handle");
}

#[wasm_bindgen_test]
fn optimizer_boundary_is_available_through_wasm_handle() {
    let handle =
        oristudio_bp_wasm::bp_load_project(sample_optimizer_project_text()).expect("sample handle");
    let request_value = oristudio_bp_wasm::bp_optimizer_request(handle, "random", false, 3, true)
        .expect("optimizer request");
    let request: oristudio_bp::optimizer::OptimizerRequest =
        serde_wasm_bindgen::from_value(request_value.clone()).expect("request decodes");

    assert_eq!(request.layout, oristudio_bp::optimizer::LayoutMode::Random);
    assert_eq!(request.random, 3);

    let result = oristudio_bp::optimizer::OptimizerResult {
        width: 32.0,
        height: 16.0,
        flaps: vec![
            oristudio_bp::optimizer::FlapResult {
                id: 1,
                x: 0.0,
                y: 0.0,
            },
            oristudio_bp::optimizer::FlapResult {
                id: 2,
                x: 26.0,
                y: 0.0,
            },
        ],
    };
    let result_value = serde_wasm_bindgen::to_value(&result).expect("result encodes");
    let snapshot_value =
        oristudio_bp_wasm::bp_optimizer_template(handle, request_value, result_value)
            .expect("template applies");
    let snapshot: oristudio_bp::Project =
        serde_wasm_bindgen::from_value(snapshot_value).expect("snapshot decodes");

    assert_eq!(snapshot.design.mode, oristudio_bp::DesignMode::Layout);
    assert_eq!(snapshot.design.layout.flaps.len(), 2);
    let view_request = simple_view_optimizer_request();
    let solved_value = oristudio_bp_wasm::bp_optimizer_solve(
        serde_wasm_bindgen::to_value(&view_request).expect("view request encodes"),
        Some(0.0),
    )
    .expect("view optimizer solves");
    let solved: oristudio_bp::optimizer::OptimizerResult =
        serde_wasm_bindgen::from_value(solved_value).expect("view result decodes");

    assert_eq!(solved.width, 8.0);
    assert_eq!(solved.flaps[1].x, 8.0);
    assert_eq!(solved.flaps[1].y, 7.0);

    let report_value = oristudio_bp_wasm::bp_optimizer_solve_report(
        serde_wasm_bindgen::to_value(&view_request).expect("view request encodes"),
        Some(0.0),
    )
    .expect("view optimizer report solves");
    let report: oristudio_bp::optimizer::OptimizerSolveReport =
        serde_wasm_bindgen::from_value(report_value).expect("view report decodes");

    assert_eq!(report.result, solved);
    assert!(
        report
            .events
            .contains(&oristudio_bp::optimizer::OptimizerEvent::Start)
    );

    let random_request = simple_random_optimizer_request();
    let random_request_value =
        serde_wasm_bindgen::to_value(&random_request).expect("random request encodes");
    let solved_value =
        oristudio_bp_wasm::bp_optimizer_solve(random_request_value.clone(), Some(0.0))
            .expect("random optimizer solves");
    let solved: oristudio_bp::optimizer::OptimizerResult =
        serde_wasm_bindgen::from_value(solved_value.clone()).expect("random result decodes");

    assert_eq!(solved.width, 8.0);
    assert_eq!(solved.flaps[0].x, 8.0);
    assert_eq!(solved.flaps[0].y, 7.0);
    oristudio_bp_wasm::bp_validate_optimizer_packing(random_request_value, solved_value)
        .expect("random result validates");
    oristudio_bp_wasm::bp_free_project(handle).expect("free handle");
}

fn sample_optimizer_project_text() -> &'static str {
    r#"{"version":"0.7","design":{"title":"","mode":"tree","layout":{"sheet":{"type":"rect","width":16,"height":16},"flaps":[{"id":1,"x":2,"y":3,"width":4,"height":5},{"id":2,"x":8,"y":9,"width":6,"height":7}],"stretches":[]},"tree":{"sheet":{"type":"rect","width":20,"height":20},"nodes":[],"edges":[{"n1":0,"n2":1,"length":5},{"n1":0,"n2":2,"length":6}]}}}"#
}

fn sample_tree_authoring_project_text() -> &'static str {
    r#"{"version":"0.7","design":{"title":"Tree","mode":"tree","layout":{"sheet":{"type":"rect","width":8,"height":8},"flaps":[],"stretches":[]},"tree":{"sheet":{"type":"rect","width":8,"height":8},"nodes":[{"id":0,"x":4,"y":4,"name":"root"},{"id":1,"x":1,"y":1,"name":"a"},{"id":2,"x":7,"y":1,"name":"b"}],"edges":[{"n1":0,"n2":1,"length":1},{"n1":0,"n2":2,"length":2}]}}}"#
}

fn sample_valid_packing_project_text() -> &'static str {
    r#"{"version":"0.7","design":{"title":"Valid packing","mode":"layout","layout":{"sheet":{"type":"rect","width":8,"height":8},"flaps":[{"id":1,"x":0,"y":0,"width":0,"height":0},{"id":2,"x":4,"y":0,"width":0,"height":0}],"stretches":[]},"tree":{"sheet":{"type":"rect","width":8,"height":8},"nodes":[{"id":0,"x":4,"y":4,"name":"root"},{"id":1,"x":1,"y":1,"name":"a"},{"id":2,"x":7,"y":1,"name":"b"}],"edges":[{"n1":0,"n2":1,"length":1},{"n1":0,"n2":2,"length":1}]}}}"#
}

fn sample_stretch_project_text() -> &'static str {
    r#"{"version":"0.7","design":{"title":"Stretch","mode":"layout","layout":{"sheet":{"type":"rect","width":32,"height":32},"flaps":[{"id":1,"x":0,"y":0,"width":2,"height":3},{"id":2,"x":20,"y":0,"width":2,"height":2},{"id":3,"x":0,"y":20,"width":3,"height":3}],"stretches":[]},"tree":{"sheet":{"type":"rect","width":32,"height":32},"nodes":[{"id":0,"x":4,"y":4,"name":"root"},{"id":1,"x":1,"y":1,"name":"a"},{"id":2,"x":7,"y":1,"name":"b"},{"id":3,"x":1,"y":7,"name":"c"}],"edges":[{"n1":0,"n2":1,"length":10},{"n1":0,"n2":2,"length":8},{"n1":0,"n2":3,"length":6}]}}}"#
}

fn sample_stretch_project_with_duplicate_stores() -> (String, String) {
    let project = oristudio_bp::io::bps::load_project_str(sample_stretch_project_text())
        .expect("sample project decodes");
    let tree =
        oristudio_bp::tree::BpTree::new(&project.design.tree.edges, &project.design.layout.flaps)
            .expect("sample tree builds");
    let stretch_id =
        oristudio_bp::layout::active_layout_repositories(&tree, &project.design.layout.stretches)
            .expect("active repositories")
            .into_iter()
            .map(|repository| repository.stretch_id)
            .next()
            .expect("active stretch exists");
    let mut session = oristudio_bp::engine::BpProjectSession::new(project).expect("session");
    session
        .complete_stretch(&stretch_id)
        .expect("stretch completes");
    let mut project = session.project().clone();
    let stretch = project
        .design
        .layout
        .stretches
        .iter_mut()
        .find(|stretch| stretch.id == stretch_id)
        .expect("completed stretch exists");
    let repo = stretch.repo.as_mut().expect("repository persisted");
    repo.configurations.push(repo.configurations[0].clone());
    let patterns = repo.configurations[0]
        .patterns
        .as_mut()
        .expect("patterns persisted");
    patterns.push(patterns[0].clone());
    let text = oristudio_bp::io::bps::save_project_string(&project).expect("project serializes");
    (text, stretch_id)
}

fn movable_device_delta(range: [f64; 2]) -> f64 {
    if range[1].is_finite() && range[1] > 0.0 {
        return range[1].min(1.0);
    }
    if range[0].is_finite() && range[0] < 0.0 {
        return range[0].max(-1.0);
    }
    if range[1].is_infinite() && range[1].is_sign_positive() {
        return 1.0;
    }
    if range[0].is_infinite() && range[0].is_sign_negative() {
        return -1.0;
    }
    panic!("device range is immovable: {range:?}");
}

fn simple_view_optimizer_request() -> oristudio_bp::optimizer::OptimizerRequest {
    oristudio_bp::optimizer::OptimizerRequest {
        command: oristudio_bp::optimizer::OptimizerCommand::Start,
        use_bh: false,
        layout: oristudio_bp::optimizer::LayoutMode::View,
        random: 0,
        problem: oristudio_bp::optimizer::OptimizerProblem {
            grid_type: oristudio_bp::GridType::Rectangular,
            flaps: vec![
                oristudio_bp::optimizer::FlapRequest {
                    id: 1,
                    width: 0.0,
                    height: 0.0,
                },
                oristudio_bp::optimizer::FlapRequest {
                    id: 2,
                    width: 0.0,
                    height: 0.0,
                },
            ],
            hierarchies: vec![oristudio_bp::tree::Hierarchy {
                leaves: vec![1, 2],
                dist_map: vec![(1, 2, 10.0)],
                parents: Vec::new(),
            }],
        },
        vec: Some(vec![
            oristudio_bp::Point { x: 0.0, y: 0.0 },
            oristudio_bp::Point { x: 0.3, y: 0.4 },
        ]),
    }
}

fn simple_random_optimizer_request() -> oristudio_bp::optimizer::OptimizerRequest {
    oristudio_bp::optimizer::OptimizerRequest {
        layout: oristudio_bp::optimizer::LayoutMode::Random,
        vec: None,
        random: 1,
        ..simple_view_optimizer_request()
    }
}

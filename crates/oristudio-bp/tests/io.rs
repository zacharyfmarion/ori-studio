use oristudio_bp::engine::{ContourData, GraphicsData};
use oristudio_bp::grid::BpGrid;
use oristudio_bp::io::{bps, bpz, cp, fold_export, migrations};
use oristudio_bp::math::geometry::PathPoint;
use oristudio_bp::model::{DesignMode, Edge, Flap, Point, Sheet, Stretch};
use oristudio_bp::sweep::{CpLine, CreaseType};
use oristudio_bp::{CURRENT_VERSION, GridType, Project};
use serde_json::Value;
use std::collections::BTreeMap;

#[test]
fn sample_project_serializes_like_current_bp_studio_sample() {
    let project = Project::sample();
    let text = bps::save_project_string(&project).expect("sample project serializes");
    assert_eq!(
        text,
        r#"{"version":"0.7","design":{"title":"","mode":"tree","layout":{"sheet":{"type":"rect","width":16,"height":16},"flaps":[],"stretches":[]},"tree":{"sheet":{"type":"rect","width":20,"height":20},"nodes":[],"edges":[]}}}"#
    );
}

#[test]
fn migration_treats_unversioned_file_as_version_zero() {
    assert_eq!(
        migrations::version_index(&serde_json::json!({})).unwrap(),
        0
    );
}

#[test]
fn migration_rejects_unknown_version() {
    let err = migrations::version_index(&serde_json::json!({ "version": "~~~" }))
        .expect_err("unknown version should fail");
    assert!(err.to_string().contains("Unrecognized version"));
}

#[test]
fn migration_v06_isolates_design_history_and_state() {
    let text = include_str!("../../../tests/fixtures/bp-studio/v04.session.sample.json");
    let value = migrations::process_str(text).expect("sample migrates");
    assert_eq!(
        value.get("version").and_then(Value::as_str),
        Some(CURRENT_VERSION)
    );
    assert!(value.get("design").is_some());
    assert!(value.get("history").is_some());
    assert!(value.get("state").is_some());
    assert!(value.get("title").is_none());
    assert!(value.get("layout").is_none());
    assert!(value.pointer("/design/history").is_none());
    assert!(value.pointer("/design/layout/zoom").is_none());
    assert!(value.pointer("/state/layout/zoom").is_some());

    let project = bps::load_project_str(text).expect("migrated sample loads as typed project");
    assert_eq!(project.version, CURRENT_VERSION);
}

#[test]
fn migration_hard_limit_clamps_troll_sample_and_deprecates_history() {
    let text = include_str!("../../../tests/fixtures/bp-studio/v07.troll.sample.json");
    let value = migrations::process_str(text).expect("troll sample migrates");
    assert_eq!(
        value
            .pointer("/design/layout/sheet/width")
            .and_then(Value::as_i64),
        Some(8192)
    );
    assert!(value.get("history").is_none());
}

#[test]
fn bps_round_trip_uses_migrated_current_version() {
    let text = include_str!("../../../tests/fixtures/bp-studio/v04.session.sample.json");
    let project = bps::load_project_str(text).expect("project loads");
    let saved = bps::save_project_string(&project).expect("project saves");
    let reparsed = bps::load_project_str(&saved).expect("saved project reloads");
    assert_eq!(reparsed.version, CURRENT_VERSION);
    assert_eq!(project.design.title, reparsed.design.title);
}

#[test]
fn bpz_round_trip_reads_canonical_workspace_files() {
    let mut files = BTreeMap::new();
    files.insert(
        "Untitled.bps".to_string(),
        bps::save_project_string(&Project::sample()).unwrap(),
    );
    let archive = bpz::write_workspace_files(&files).expect("workspace writes");
    let read = bpz::read_workspace_files(&archive).expect("workspace reads");
    assert_eq!(read, files);
    let projects = bpz::read_workspace_projects(&archive).expect("workspace projects load");
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].version, CURRENT_VERSION);
}

#[test]
fn bpz_ordered_entries_preserve_workspace_tab_order() {
    let mut first = Project::sample();
    first.design.title = "First".to_string();
    let mut second = Project::sample();
    second.design.title = "Second".to_string();
    let mut third = Project::sample();
    third.design.title = "Third".to_string();

    let entries = vec![
        ("z-last.bps".to_string(), first),
        ("a-first.bps".to_string(), second),
        ("m-middle".to_string(), third),
    ];
    let archive = bpz::write_workspace_project_entries(&entries).expect("workspace writes");
    let read = bpz::read_workspace_project_entries(&archive).expect("workspace reads");

    assert_eq!(
        read.iter()
            .map(|(name, project)| (name.as_str(), project.design.title.as_str()))
            .collect::<Vec<_>>(),
        vec![
            ("z-last.bps", "First"),
            ("a-first.bps", "Second"),
            ("m-middle.bps", "Third"),
        ]
    );
}

#[test]
fn cp_serializer_uses_oripa_numbers_and_normalizes_negative_zero() {
    let text = cp::to_cp(&[
        cp_line(CreaseType::Mountain, 1.0, 2.0, 3.5, -0.0),
        cp_line(CreaseType::Auxiliary, 0.25, 0.5, 0.75, 1.0),
    ]);

    assert_eq!(text, "2 1 2 3.5 0\n4 0.25 0.5 0.75 1");
}

#[test]
fn cp_transform_preserves_bp_studio_sixteenth_snap_quirk() {
    assert_eq!(cp::fix(1.0 + 1e-12), 1.0);
    assert_eq!(cp::fix(1.03), 1.03);

    let grid = BpGrid::new(Sheet {
        grid_type: GridType::Rectangular,
        width: 16.0,
        height: 16.0,
    });
    let mut project = Project::sample();
    project.design.mode = DesignMode::Layout;
    let text = cp::export_lines(
        &[cp_line(CreaseType::Border, 0.0, 0.0, 16.0, 16.0)],
        &grid,
        &project,
        cp::CpExportOptions::default(),
    )
    .unwrap();

    assert_eq!(text, "1 -200 200 200 -200");
}

#[test]
fn cp_line_components_follow_layout_controller_crease_types() {
    let borders = vec![
        Point { x: 0.0, y: 0.0 },
        Point { x: 4.0, y: 0.0 },
        Point { x: 4.0, y: 4.0 },
        Point { x: 0.0, y: 4.0 },
    ];
    let mut components = cp::CpLineComponents {
        use_auxiliary: false,
        node_outer_contours: vec![vec![
            Point { x: 1.0, y: 1.0 },
            Point { x: 3.0, y: 1.0 },
            Point { x: 3.0, y: 3.0 },
            Point { x: 1.0, y: 3.0 },
        ]],
        node_ridges: vec![[Point { x: 1.0, y: 1.0 }, Point { x: 3.0, y: 3.0 }]],
        device_draw_ridges: vec![[Point { x: 1.0, y: 3.0 }, Point { x: 3.0, y: 1.0 }]],
        device_axis_parallels: vec![[Point { x: 2.0, y: 1.0 }, Point { x: 2.0, y: 3.0 }]],
    };

    let mut assembled = Vec::new();
    cp::add_path(
        &mut assembled,
        &components.node_outer_contours[0],
        CreaseType::Valley,
    );
    assert_eq!(
        assembled[0],
        cp_line(CreaseType::Valley, 1.0, 1.0, 3.0, 1.0)
    );

    let valley_lines = cp::get_cp_lines(&borders, &components);
    assert!(
        valley_lines
            .iter()
            .any(|line| line.crease_type == CreaseType::Valley)
    );
    assert!(
        valley_lines
            .iter()
            .any(|line| line.crease_type == CreaseType::Mountain)
    );
    assert!(
        valley_lines
            .iter()
            .any(|line| line.crease_type == CreaseType::Border)
    );
    assert!(
        !valley_lines
            .iter()
            .any(|line| line.crease_type == CreaseType::Auxiliary)
    );

    components.use_auxiliary = true;
    let auxiliary_lines = cp::get_cp_lines(&borders, &components);
    assert!(
        auxiliary_lines
            .iter()
            .any(|line| line.crease_type == CreaseType::Auxiliary)
    );
}

#[test]
fn fold_export_matches_bp_studio_assignment_and_vertex_order() {
    let mut project = Project::sample();
    project.design.title = "Fold title".to_string();
    project.design.description = Some("Fold description".to_string());

    let text = fold_export::to_fold(
        &[
            cp_line(CreaseType::Border, 0.0, 0.0, 1.0, 0.0),
            cp_line(CreaseType::Mountain, 1.0, 0.0, 1.0, 1.0),
            cp_line(CreaseType::Valley, 1.0, 1.0, 0.0, 0.0),
            cp_line(CreaseType::Auxiliary, 0.0, 0.0, 1.0, 1.0),
            cp_line(CreaseType::None, 1.0, 1.0, -0.0, -0.0),
        ],
        &project,
    )
    .unwrap();

    assert_eq!(
        text,
        r#"{"file_spec":1.1,"file_creator":"Box Pleating Studio","file_title":"Fold title","file_description":"Fold description","vertices_coords":[[0,0],[1,0],[1,1]],"edges_vertices":[[0,1],[1,2],[2,0],[0,2],[2,0]],"edges_assignment":["B","M","V","F","U"],"edges_foldAngle":[0,-180,180,0,0]}"#
    );
}

#[test]
fn project_level_cp_export_handles_stretch_free_projects() {
    let text = cp::export_project(&Project::sample(), cp::CpExportOptions::default()).unwrap();

    assert_eq!(
        text,
        "1 -200 -200 -200 200\n1 -200 200 200 200\n1 200 200 200 -200\n1 200 -200 -200 -200"
    );
}

#[test]
fn project_level_cp_export_ignores_inactive_stretch_prototypes() {
    let mut project = Project::sample();
    project.design.layout.stretches.push(Stretch {
        id: "1,2".to_string(),
        configuration: None,
        pattern: None,
        repo: None,
    });
    let text = cp::export_project(&project, cp::CpExportOptions::default()).unwrap();

    assert_eq!(
        text,
        "1 -200 -200 -200 200\n1 -200 200 200 200\n1 200 200 200 -200\n1 200 -200 -200 -200"
    );
}

#[test]
fn project_level_cp_export_generates_active_stretch_graphics() {
    let mut project = Project::sample();
    project.design.tree.edges = vec![
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
    ];
    project.design.layout.flaps = vec![
        Flap {
            id: 1,
            x: 0.0,
            y: 0.0,
            width: 2.0,
            height: 3.0,
        },
        Flap {
            id: 2,
            x: 20.0,
            y: 0.0,
            width: 2.0,
            height: 2.0,
        },
        Flap {
            id: 3,
            x: 0.0,
            y: 20.0,
            width: 3.0,
            height: 3.0,
        },
    ];

    let text = cp::export_project(&project, cp::CpExportOptions::default()).unwrap();

    assert!(text.lines().count() > 4, "{text}");
    assert!(text.lines().any(|line| line.starts_with("2 ")), "{text}");
}

#[test]
fn project_level_cp_export_can_use_materialized_graphics() {
    let project = Project::sample();
    let node_graphics = vec![GraphicsData {
        contours: vec![ContourData {
            outer: vec![
                Point { x: 1.0, y: 1.0 },
                Point { x: 3.0, y: 1.0 },
                Point { x: 3.0, y: 3.0 },
                Point { x: 1.0, y: 3.0 },
            ],
            inner: Vec::new(),
        }],
        ridges: vec![[Point { x: 1.0, y: 1.0 }, Point { x: 3.0, y: 3.0 }]],
        axis_parallel: None,
        range: None,
        location: None,
        forward: None,
    }];
    let device_graphics = vec![GraphicsData {
        contours: Vec::new(),
        ridges: vec![[Point { x: 1.0, y: 3.0 }, Point { x: 3.0, y: 1.0 }]],
        axis_parallel: Some(vec![[Point { x: 2.0, y: 1.0 }, Point { x: 2.0, y: 3.0 }]]),
        range: None,
        location: None,
        forward: None,
    }];

    let text = cp::export_project_with_graphics(
        &project,
        &node_graphics,
        &device_graphics,
        cp::CpExportOptions::default(),
    )
    .unwrap();

    assert!(text.contains("4 -175 175 -150 175"), "{text}");
    assert!(text.contains("2 -175 175 -150 150"), "{text}");
    assert!(text.contains("3 -150 175 -150 150"), "{text}");
}

fn cp_line(crease_type: CreaseType, x1: f64, y1: f64, x2: f64, y2: f64) -> CpLine {
    CpLine {
        crease_type,
        p1: PathPoint::new(x1, y1),
        p2: PathPoint::new(x2, y2),
    }
}

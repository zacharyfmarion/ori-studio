use oristudio_bp::engine::{
    BpProjectSession, BpSession, DesignUpdateRequest, EngineState, GraphicsData, OrderedRecord,
    Processor, TaskSpec, UpdateResult,
};
use oristudio_bp::grid::{BpGrid, get_dots};
use oristudio_bp::io::cp::project_graphics_snapshot;
use oristudio_bp::layout::active_layout_repositories;
use oristudio_bp::model::{
    Design, DesignMode, Edge, Flap, GridType, Layout, Point, Project, Sheet, Stretch, Tree, Vertex,
};
use oristudio_bp::tree::BpTree;
use serde_json::json;

#[test]
fn update_result_flush_matches_upstream_empty_shape_and_resets() {
    let mut result = UpdateResult::new();
    assert_eq!(
        serde_json::to_value(result.flush()).unwrap(),
        json!({
            "add": {
                "nodes": [],
                "junctions": {},
                "stretches": {}
            },
            "update": {
                "stretches": []
            },
            "remove": {
                "nodes": [],
                "junctions": [],
                "stretches": []
            },
            "patternNotFound": false,
            "edit": [],
            "graphics": {}
        })
    );

    result.add_node(3);
    result.set_pattern_not_found();
    assert_eq!(result.flush().add.nodes, vec![3]);
    assert!(result.flush().add.nodes.is_empty());
}

#[test]
fn ordered_record_serializes_in_assignment_order_without_reordering_updates() {
    let mut record = OrderedRecord::new();
    record.insert("b", 1);
    record.insert("a", 2);
    record.insert("b", 3);

    assert_eq!(record.len(), 2);
    assert_eq!(record.get("b"), Some(&3));
    assert_eq!(serde_json::to_string(&record).unwrap(), r#"{"b":3,"a":2}"#);
}

#[test]
fn update_result_collects_tree_and_graphics_payloads() {
    let tree = BpTree::new(
        &[
            Edge {
                n1: 0,
                n2: 1,
                length: 1.0,
            },
            Edge {
                n1: 0,
                n2: 2,
                length: 2.0,
            },
        ],
        &[],
    )
    .unwrap();
    let mut result = UpdateResult::new();
    result.export_tree(&tree);
    result.add_graphics(
        "f1",
        GraphicsData {
            contours: Vec::new(),
            ridges: vec![[Point { x: 0.0, y: 0.0 }, Point { x: 1.0, y: 1.0 }]],
            axis_parallel: None,
            range: None,
            location: None,
            forward: None,
        },
    );

    let flushed = result.flush();
    assert_eq!(flushed.tree.unwrap().edges.len(), 2);
    assert_eq!(flushed.graphics.get("f1").unwrap().ridges.len(), 1);
}

#[test]
fn engine_state_reset_matches_temporary_and_persistent_state_split() {
    let mut state = EngineState::default();
    let mut result = UpdateResult::new();
    state.root_changed = true;
    state.tree_structure_changed = true;
    state.mark_children_changed(1);
    state.mark_children_changed(1);
    state.mark_parent_changed(2);
    state.stretch_prototypes.insert(
        "s",
        Stretch {
            id: "s".to_string(),
            configuration: None,
            pattern: None,
            repo: None,
        },
    );
    state.stretches.insert(
        "keep",
        Stretch {
            id: "keep".to_string(),
            configuration: None,
            pattern: None,
            repo: None,
        },
    );
    result.add_node(7);

    state.reset();
    assert!(!state.root_changed);
    assert!(!state.tree_structure_changed);
    assert!(state.children_changed.is_empty());
    assert!(state.parent_changed.is_empty());
    assert!(state.stretch_prototypes.is_empty());
    assert_eq!(state.stretches.len(), 1);
    assert_eq!(result.flush().add.nodes, vec![7]);

    state.full_reset(&mut result);
    assert!(state.stretches.is_empty());
    assert!(result.flush().add.nodes.is_empty());
}

#[test]
fn processor_runs_highest_priority_first_and_resets_state_after_success() {
    let final_task = TaskSpec::leaf("final");
    let side_task = TaskSpec::leaf("side");
    let middle_task = TaskSpec::new("middle", vec![final_task]);
    let first_task = TaskSpec::new("first", vec![middle_task, side_task]);
    let mut state = EngineState::default();
    state.mark_length_changed(1);
    let mut order = Vec::new();

    Processor::run(&mut state, vec![first_task], |task, state| {
        order.push((task.name(), task.priority()));
        state.mark_children_changed(task.priority() as u32);
        Ok(())
    })
    .unwrap();

    assert_eq!(
        order,
        vec![("first", 2), ("middle", 1), ("side", 0), ("final", 0)]
    );
    assert!(state.length_changed.is_empty());
    assert!(state.children_changed.is_empty());
}

#[test]
fn session_init_returns_upstream_shaped_tree_update() {
    let design = sample_design();
    let (session, update) = BpSession::from_design(&design).unwrap();

    assert_eq!(session.state().tree.as_ref().unwrap().root_id(), 0);
    assert_eq!(update.add.nodes, vec![0, 1, 2]);
    assert_eq!(
        update.edit,
        vec![
            (
                true,
                Edge {
                    n1: 0,
                    n2: 1,
                    length: 1.0
                }
            ),
            (
                true,
                Edge {
                    n1: 0,
                    n2: 2,
                    length: 2.0
                }
            )
        ]
    );
    assert_eq!(update.tree.unwrap().edges.len(), 2);
}

#[test]
fn session_tree_commands_emit_edit_node_delta_and_hierarchy_payloads() {
    let design = sample_design();
    let (mut session, _) = BpSession::from_design(&design).unwrap();

    let add = session
        .add_leaf(
            3,
            1,
            2.0,
            Flap {
                id: 3,
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 1.0,
            },
        )
        .unwrap();
    assert_eq!(add.add.nodes, vec![3]);
    assert_eq!(
        add.edit,
        vec![(
            true,
            Edge {
                n1: 3,
                n2: 1,
                length: 2.0
            }
        )]
    );

    let hierarchy = session.get_hierarchy(false, false).unwrap();
    assert_eq!(hierarchy.len(), 1);
    assert!(hierarchy[0].leaves.contains(&2));
    assert!(hierarchy[0].leaves.contains(&3));

    let remove = session.remove_leaf(vec![3], Vec::new()).unwrap();
    assert_eq!(remove.remove.nodes, vec![3]);
    assert_eq!(
        remove.edit,
        vec![(
            false,
            Edge {
                n1: 3,
                n2: 1,
                length: 2.0
            }
        )]
    );
}

#[test]
fn session_update_design_changes_lengths_without_edit_records() {
    let design = sample_design();
    let (mut session, _) = BpSession::from_design(&design).unwrap();
    let update = session
        .update_design(DesignUpdateRequest {
            flaps: Vec::new(),
            edges: vec![Edge {
                n1: 0,
                n2: 2,
                length: 5.0,
            }],
            stretches: Vec::new(),
            dragging: true,
        })
        .unwrap();

    assert!(update.edit.is_empty());
    assert_eq!(update.tree.unwrap().edges.len(), 2);
    assert!(session.state().is_dragging);
}

#[test]
fn session_split_and_merge_emit_controller_edit_sequences() {
    let design = sample_design();
    let (mut session, _) = BpSession::from_design(&design).unwrap();

    let split = session
        .split(
            Edge {
                n1: 0,
                n2: 2,
                length: 2.0,
            },
            4,
        )
        .unwrap();
    assert_eq!(split.add.nodes, vec![4]);
    assert_eq!(
        split.edit,
        vec![
            (
                false,
                Edge {
                    n1: 2,
                    n2: 0,
                    length: 2.0
                }
            ),
            (
                true,
                Edge {
                    n1: 0,
                    n2: 4,
                    length: 1.0
                }
            ),
            (
                true,
                Edge {
                    n1: 4,
                    n2: 2,
                    length: 1.0
                }
            )
        ]
    );

    let merge = session
        .merge(Edge {
            n1: 0,
            n2: 4,
            length: 1.0,
        })
        .unwrap();
    assert_eq!(merge.remove.nodes, vec![4]);
    assert_eq!(
        merge.edit,
        vec![
            (
                false,
                Edge {
                    n1: 4,
                    n2: 2,
                    length: 1.0
                }
            ),
            (
                true,
                Edge {
                    n1: 2,
                    n2: 0,
                    length: 1.0
                }
            ),
            (
                false,
                Edge {
                    n1: 4,
                    n2: 0,
                    length: 1.0
                }
            )
        ]
    );
}

#[test]
fn session_edit_tree_can_force_expected_root_for_history_navigation() {
    let mut design = sample_design();
    design.tree.edges.push(Edge {
        n1: 1,
        n2: 3,
        length: 1.0,
    });
    let (mut session, _) = BpSession::from_design(&design).unwrap();

    let update = session
        .edit_tree(Vec::new(), 1, Vec::new(), Vec::new())
        .unwrap();

    assert_eq!(session.state().tree.as_ref().unwrap().root_id(), 1);
    assert!(update.edit.is_empty());
    assert_eq!(update.tree.unwrap().edges[0].n1, 1);
}

#[test]
fn project_session_adds_leaf_at_bp_studio_empty_spot_and_tracks_history() {
    let project = sample_project();
    let mut session = BpProjectSession::new(project).unwrap();

    let update = session.add_leaf(1, 2.0).unwrap();

    assert_eq!(update.add.nodes, vec![3]);
    assert!(
        session.project().design.tree.nodes.iter().any(|node| {
            node.id == 3 && node.x == 2.0 && node.y == 1.0 && node.is_new.is_none()
        })
    );
    // Leaves 1 and 2 are seeded default flaps at the origin on load (BP Studio
    // parity). Adding a leaf to node 1 makes it internal, so its flap is dropped
    // and only the sibling leaf 2 plus the new leaf 3 (at the empty spot) remain.
    assert_eq!(
        session.project().design.layout.flaps,
        vec![
            Flap {
                id: 2,
                x: 0.0,
                y: 0.0,
                width: 0.0,
                height: 0.0
            },
            Flap {
                id: 3,
                x: 2.0,
                y: 1.0,
                width: 0.0,
                height: 0.0
            }
        ]
    );
    assert_eq!(session.project().design.tree.edges.len(), 3);
    assert_eq!(session.history().steps().len(), 1);
}

#[test]
fn project_session_moves_new_vertex_and_syncs_runtime_flap_without_persisting_is_new() {
    let mut project = sample_project();
    project.design.tree.nodes.push(Vertex {
        id: 3,
        x: 2.0,
        y: 2.0,
        name: String::new(),
        is_new: Some(true),
    });
    project.design.tree.edges.push(Edge {
        n1: 3,
        n2: 1,
        length: 2.0,
    });
    project.design.layout.flaps.push(Flap {
        id: 3,
        x: 2.0,
        y: 2.0,
        width: 0.0,
        height: 0.0,
    });
    let mut session = BpProjectSession::new(project).unwrap();

    session
        .move_vertex(3, Point { x: 4.2, y: 5.8 }, false)
        .unwrap();

    let vertex = session
        .project()
        .design
        .tree
        .nodes
        .iter()
        .find(|node| node.id == 3)
        .unwrap();
    assert_eq!((vertex.x, vertex.y, vertex.is_new), (4.2, 5.8, None));
    let flap = session
        .project()
        .design
        .layout
        .flaps
        .iter()
        .find(|flap| flap.id == 3)
        .unwrap();
    assert_eq!((flap.x, flap.y), (4.0, 6.0));
    assert!(
        session
            .project_for_export()
            .design
            .tree
            .nodes
            .iter()
            .all(|node| node.is_new.is_none())
    );
}

#[test]
fn project_session_split_join_and_edge_length_update_mutate_saved_tree() {
    let project = sample_project();
    let mut session = BpProjectSession::new(project).unwrap();

    session.update_edge_length(0, 2, 3.0, false).unwrap();
    assert_eq!(session.project().design.tree.edges[1].length, 3.0);

    let split = session.split_edge(0, 2).unwrap();
    assert_eq!(split.add.nodes, vec![3]);
    assert!(
        session
            .project()
            .design
            .tree
            .nodes
            .iter()
            .any(|node| { node.id == 3 && node.x == 6.0 && node.y == 3.0 })
    );

    let join = session.join_vertex(3).unwrap();
    assert_eq!(join.remove.nodes, vec![3]);
    assert!(
        !session
            .project()
            .design
            .tree
            .nodes
            .iter()
            .any(|node| node.id == 3)
    );
    assert_eq!(session.history().steps().len(), 3);
}

#[test]
fn project_session_moves_and_resizes_flaps_with_grid_constraints() {
    let mut project = sample_project();
    project.design.layout.flaps = vec![
        Flap {
            id: 1,
            x: 1.0,
            y: 1.0,
            width: 2.0,
            height: 2.0,
        },
        Flap {
            id: 2,
            x: 5.0,
            y: 1.0,
            width: 2.0,
            height: 2.0,
        },
    ];
    let mut session = BpProjectSession::new(project).unwrap();

    session
        .move_flap(1, Point { x: 7.0, y: 7.0 }, false)
        .unwrap();
    let moved = session
        .project()
        .design
        .layout
        .flaps
        .iter()
        .find(|flap| flap.id == 1)
        .unwrap();
    assert_eq!((moved.x, moved.y), (6.0, 6.0));

    assert!(session.resize_flap(1, 9.0, 9.0).is_err());
    session.resize_flap(1, 1.0, 2.0).unwrap();
    let resized = session
        .project()
        .design
        .layout
        .flaps
        .iter()
        .find(|flap| flap.id == 1)
        .unwrap();
    assert_eq!((resized.width, resized.height), (1.0, 2.0));
    assert_eq!(session.history().steps().len(), 2);
}

#[test]
fn project_session_moves_flap_groups_with_shared_constraints() {
    let mut project = sample_project();
    project.design.layout.flaps = vec![
        Flap {
            id: 1,
            x: 1.0,
            y: 1.0,
            width: 2.0,
            height: 2.0,
        },
        Flap {
            id: 2,
            x: 5.0,
            y: 1.0,
            width: 2.0,
            height: 2.0,
        },
    ];
    let mut session = BpProjectSession::new(project).unwrap();

    session
        .move_flaps(&[1, 2], Point { x: 5.0, y: 5.0 }, false)
        .unwrap();

    let flaps = &session.project().design.layout.flaps;
    let first = flaps.iter().find(|flap| flap.id == 1).unwrap();
    let second = flaps.iter().find(|flap| flap.id == 2).unwrap();
    assert_eq!((first.x, first.y), (2.0, 5.0));
    assert_eq!((second.x, second.y), (6.0, 5.0));
    assert_eq!(session.history().steps().len(), 1);
}

#[test]
fn project_session_transforms_layout_sheet_and_scales_edge_lengths() {
    let mut project = sample_project();
    project.design.layout.flaps = vec![Flap {
        id: 1,
        x: 1.0,
        y: 1.0,
        width: 2.0,
        height: 2.0,
    }];
    let mut session = BpProjectSession::new(project).unwrap();

    session.subdivide_layout_sheet().unwrap();
    assert_eq!(
        session.project().design.layout.sheet,
        Sheet {
            grid_type: GridType::Rectangular,
            width: 16.0,
            height: 16.0,
        }
    );
    assert_eq!(
        session.project().design.layout.flaps[0],
        Flap {
            id: 1,
            x: 2.0,
            y: 2.0,
            width: 4.0,
            height: 4.0,
        }
    );
    assert_eq!(
        session
            .project()
            .design
            .tree
            .edges
            .iter()
            .map(|edge| edge.length)
            .collect::<Vec<_>>(),
        vec![2.0, 4.0]
    );

    session.flip_layout_sheet(true).unwrap();
    assert_eq!(
        session.project().design.layout.flaps[0],
        Flap {
            id: 1,
            x: 10.0,
            y: 2.0,
            width: 4.0,
            height: 4.0,
        }
    );
    assert_eq!(session.history().steps().len(), 2);
}

#[test]
fn project_session_updates_layout_sheet_with_checked_anchor_shifts() {
    let mut project = sample_project();
    // Both tree leaves (1 and 2) must have flaps for a valid design. Leaf 1 is
    // the flap under test (right edge at x=7 drives the resize shift); leaf 2 is
    // placed left of it so it neither drives nor blocks the leftward shift.
    project.design.layout.flaps = vec![
        Flap {
            id: 1,
            x: 5.0,
            y: 1.0,
            width: 2.0,
            height: 2.0,
        },
        Flap {
            id: 2,
            x: 2.0,
            y: 2.0,
            width: 0.0,
            height: 0.0,
        },
    ];
    let mut session = BpProjectSession::new(project).unwrap();

    session
        .update_layout_sheet(GridType::Rectangular, 6.0, 8.0)
        .unwrap();
    assert_eq!(session.project().design.layout.sheet.width, 6.0);
    assert_eq!(session.project().design.layout.flaps[0].x, 4.0);

    session
        .update_layout_sheet(GridType::Diagonal, 6.0, 6.0)
        .unwrap();
    assert_eq!(
        session.project().design.layout.sheet.grid_type,
        GridType::Diagonal
    );
    let grid = BpGrid::new(session.project().design.layout.sheet.clone());
    let flap = &session.project().design.layout.flaps[0];
    for point in get_dots(
        Point {
            x: flap.x,
            y: flap.y,
        },
        flap.width,
        flap.height,
    ) {
        assert!(grid.contains(point));
    }
    assert_eq!(session.history().steps().len(), 2);
}

#[test]
fn project_graphics_snapshot_exports_node_graphics_and_invalid_junctions() {
    let mut project = sample_project();
    project.design.layout.flaps = vec![
        Flap {
            id: 1,
            x: 1.0,
            y: 1.0,
            width: 1.0,
            height: 1.0,
        },
        Flap {
            id: 2,
            x: 1.5,
            y: 1.0,
            width: 1.0,
            height: 1.0,
        },
    ];

    let snapshot = project_graphics_snapshot(&project).unwrap();

    assert!(snapshot.node_graphics.iter().any(|entry| entry.id == "f1"));
    assert!(snapshot.node_graphics.iter().any(|entry| entry.id == "f2"));
    assert!(
        snapshot
            .node_graphics
            .iter()
            .any(|entry| !entry.data.contours.is_empty() && !entry.data.ridges.is_empty())
    );
    assert_eq!(snapshot.invalid_junctions.len(), 1);
    assert_eq!(snapshot.invalid_junctions[0].flap_ids, [1, 2]);
    assert!(!snapshot.invalid_junctions[0].polygon.is_empty());
}

#[test]
fn project_session_completes_active_stretch_repository() {
    let (project, stretch_id) = active_three_leaf_project();
    let mut session = BpProjectSession::new(project).unwrap();

    session.complete_stretch(&stretch_id).unwrap();

    let stretch = session
        .project()
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
    assert_eq!(session.history().steps().len(), 1);
}

#[test]
fn project_session_switches_stretch_configurations_and_patterns() {
    let (project, stretch_id) = active_three_leaf_project();
    let mut setup = BpProjectSession::new(project).unwrap();
    setup.complete_stretch(&stretch_id).unwrap();
    let mut project = setup.project().clone();
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
    let mut session = BpProjectSession::new(project).unwrap();

    session.switch_stretch_config(&stretch_id, 1).unwrap();
    let stretch = session
        .project()
        .design
        .layout
        .stretches
        .iter()
        .find(|stretch| stretch.id == stretch_id)
        .expect("stretch exists");
    let repo = stretch.repo.as_ref().expect("repository persisted");
    assert_eq!(repo.index, 1);

    session.switch_stretch_config(&stretch_id, -1).unwrap();
    let stretch = session
        .project()
        .design
        .layout
        .stretches
        .iter()
        .find(|stretch| stretch.id == stretch_id)
        .expect("stretch exists");
    let repo = stretch.repo.as_ref().expect("repository persisted");
    assert_eq!(repo.index, 0);

    session.switch_stretch_pattern(&stretch_id, 1).unwrap();
    let stretch = session
        .project()
        .design
        .layout
        .stretches
        .iter()
        .find(|stretch| stretch.id == stretch_id)
        .expect("stretch exists");
    let repo = stretch.repo.as_ref().expect("repository persisted");
    assert_eq!(repo.configurations[0].index, Some(1));

    session.switch_stretch_pattern(&stretch_id, -1).unwrap();
    let stretch = session
        .project()
        .design
        .layout
        .stretches
        .iter()
        .find(|stretch| stretch.id == stretch_id)
        .expect("stretch exists");
    let repo = stretch.repo.as_ref().expect("repository persisted");
    assert_eq!(repo.configurations[0].index, Some(0));
}

#[test]
fn project_session_moves_selected_pattern_device_and_persists_offset() {
    let (project, stretch_id) = active_three_leaf_project();
    let mut session = BpProjectSession::new(project).unwrap();
    session.complete_stretch(&stretch_id).unwrap();
    let before = project_graphics_snapshot(session.project()).unwrap();
    let device = before
        .device_graphics
        .iter()
        .find(|entry| entry.id == format!("s{stretch_id}.0"))
        .expect("device graphics exists");
    let old = device.data.location.expect("device location is exported");
    let range = device.data.range.expect("device range is exported");
    let forward = device.data.forward.expect("device direction is exported");
    let dx = movable_device_delta(range);
    let target = Point {
        x: old.x + dx,
        y: old.y + if forward { dx } else { -dx },
    };
    let old_offset = session
        .project()
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

    session
        .move_device(&stretch_id, 0, target, false)
        .expect("device moves");

    let after = project_graphics_snapshot(session.project()).unwrap();
    let moved = after
        .device_graphics
        .iter()
        .find(|entry| entry.id == format!("s{stretch_id}.0"))
        .expect("moved device graphics exists");
    assert_eq!(moved.data.location, Some(target));
    let stretch = session
        .project()
        .design
        .layout
        .stretches
        .iter()
        .find(|stretch| stretch.id == stretch_id)
        .expect("stretch exists");
    let repo = stretch.repo.as_ref().expect("repository persisted");
    let config = &repo.configurations[repo.index];
    let pattern = &config.patterns.as_ref().expect("patterns persisted")
        [config.index.expect("pattern index persisted")];
    assert_ne!(pattern.devices[0].offset, old_offset);
    assert_eq!(session.history().steps().len(), 2);
}

fn sample_design() -> Design {
    Design {
        title: "test".to_string(),
        description: None,
        mode: DesignMode::Tree,
        layout: Layout {
            sheet: Sheet {
                grid_type: GridType::Rectangular,
                width: 8.0,
                height: 8.0,
            },
            flaps: Vec::new(),
            stretches: Vec::new(),
        },
        tree: Tree {
            sheet: Sheet {
                grid_type: GridType::Rectangular,
                width: 8.0,
                height: 8.0,
            },
            nodes: Vec::new(),
            edges: vec![
                Edge {
                    n1: 0,
                    n2: 1,
                    length: 1.0,
                },
                Edge {
                    n1: 0,
                    n2: 2,
                    length: 2.0,
                },
            ],
        },
    }
}

fn sample_project() -> Project {
    let mut project = Project::sample();
    project.design = sample_design();
    project.design.tree.nodes = vec![
        Vertex {
            id: 0,
            x: 4.0,
            y: 4.0,
            name: "root".to_string(),
            is_new: None,
        },
        Vertex {
            id: 1,
            x: 1.0,
            y: 1.0,
            name: "a".to_string(),
            is_new: None,
        },
        Vertex {
            id: 2,
            x: 7.0,
            y: 1.0,
            name: "b".to_string(),
            is_new: None,
        },
    ];
    project
}

fn active_three_leaf_project() -> (Project, String) {
    let mut project = sample_project();
    project.design.mode = DesignMode::Layout;
    project.design.tree.nodes.push(Vertex {
        id: 3,
        x: 7.0,
        y: 7.0,
        name: "c".to_string(),
        is_new: None,
    });
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
    let tree = BpTree::new(&project.design.tree.edges, &project.design.layout.flaps).unwrap();
    let stretch_id = active_layout_repositories(&tree, &project.design.layout.stretches)
        .unwrap()
        .into_iter()
        .map(|repository| repository.stretch_id)
        .next()
        .expect("active stretch exists");
    (project, stretch_id)
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

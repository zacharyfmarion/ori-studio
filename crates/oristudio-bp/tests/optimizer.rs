use oristudio_bp::model::{DesignMode, Flap, GridType, Point, Project};
use oristudio_bp::optimizer::{
    LayoutMode, OptimizerEvent, OptimizerOptionsBase, OptimizerRequest, OptimizerResult,
    check_optimizer_result, create_optimizer_request, solve, solve_report, solve_with_progress,
    validate_optimizer_packing, write_to_template,
};
use oristudio_bp::tree::Hierarchy;

#[test]
fn optimizer_request_orders_flaps_by_last_hierarchy_and_normalizes_view_vector() {
    let mut project = Project::sample();
    project.design.layout.sheet.width = 10.0;
    project.design.layout.sheet.height = 20.0;
    project.design.layout.flaps = vec![flap(2, 6.0, 10.0, 3.0, 4.0), flap(1, 2.0, 5.0, 1.0, 2.0)];
    let hierarchies = vec![hierarchy(vec![2, 1]), hierarchy(vec![1, 2])];

    let request = create_optimizer_request(
        &project,
        hierarchies.clone(),
        OptimizerOptionsBase {
            layout: LayoutMode::View,
            use_bh: true,
            random: 7,
        },
        false,
    )
    .unwrap();

    assert_eq!(request.problem.grid_type, GridType::Rectangular);
    assert_eq!(request.problem.hierarchies, hierarchies);
    assert_eq!(request.problem.flaps[0].id, 1);
    assert_eq!(request.problem.flaps[0].width, 0.0);
    assert_eq!(request.problem.flaps[1].id, 2);
    assert_eq!(
        request.vec.unwrap(),
        vec![Point { x: 0.2, y: 0.25 }, Point { x: 0.6, y: 0.5 }]
    );
}

#[test]
fn optimizer_request_random_mode_omits_initial_vector_and_keeps_dimensions() {
    let mut project = Project::sample();
    project.design.layout.flaps = vec![flap(1, 2.0, 3.0, 4.0, 5.0)];

    let request = create_optimizer_request(
        &project,
        vec![hierarchy(vec![1])],
        OptimizerOptionsBase {
            layout: LayoutMode::Random,
            use_bh: false,
            random: 3,
        },
        true,
    )
    .unwrap();

    assert!(request.vec.is_none());
    assert_eq!(request.problem.flaps[0].width, 4.0);
    assert_eq!(request.problem.flaps[0].height, 5.0);
}

#[test]
fn optimizer_request_serializes_with_bp_studio_wire_names() {
    let mut project = Project::sample();
    project.design.layout.flaps = vec![flap(1, 2.0, 3.0, 4.0, 5.0)];
    let request = create_optimizer_request(
        &project,
        vec![Hierarchy {
            leaves: vec![1],
            dist_map: vec![(1, 1, 0.0)],
            parents: Vec::new(),
        }],
        OptimizerOptionsBase {
            layout: LayoutMode::Random,
            use_bh: true,
            random: 3,
        },
        true,
    )
    .unwrap();

    let value = serde_json::to_value(request).unwrap();

    assert_eq!(value["useBH"], true);
    assert!(value["problem"]["hierarchies"][0].get("distMap").is_some());
    assert!(value["problem"]["hierarchies"][0].get("dist_map").is_none());
}

#[test]
fn optimizer_request_rejects_duplicate_view_coordinates_until_jitter_is_ported() {
    let mut project = Project::sample();
    project.design.layout.flaps = vec![flap(1, 2.0, 3.0, 0.0, 0.0), flap(2, 2.0, 3.0, 0.0, 0.0)];

    let err = create_optimizer_request(
        &project,
        vec![hierarchy(vec![1, 2])],
        OptimizerOptionsBase {
            layout: LayoutMode::View,
            use_bh: false,
            random: 0,
        },
        true,
    )
    .expect_err("duplicate view coordinates need upstream random jitter");

    assert!(err.to_string().contains("Math.random jitter"));
}

#[test]
fn optimizer_result_validation_and_template_write_match_bp_boundary() {
    let mut project = Project::sample();
    project.design.layout.flaps = vec![flap(1, 2.0, 3.0, 4.0, 5.0)];
    let request = OptimizerRequest {
        command: oristudio_bp::optimizer::OptimizerCommand::Start,
        use_bh: false,
        layout: LayoutMode::Random,
        random: 0,
        problem: oristudio_bp::optimizer::OptimizerProblem {
            grid_type: GridType::Rectangular,
            flaps: vec![oristudio_bp::optimizer::FlapRequest {
                id: 1,
                width: 4.0,
                height: 5.0,
            }],
            hierarchies: vec![hierarchy(vec![1])],
        },
        vec: None,
    };
    let result = OptimizerResult {
        width: 16.0,
        height: 20.0,
        flaps: vec![oristudio_bp::optimizer::FlapResult {
            id: 1,
            x: 6.0,
            y: 7.0,
        }],
    };

    check_optimizer_result(&result).unwrap();
    validate_optimizer_packing(&request, &result).unwrap();
    let next = write_to_template(&project, &request, &result).unwrap();

    assert_eq!(next.design.mode, DesignMode::Layout);
    assert_eq!(next.design.layout.sheet.width, 16.0);
    assert_eq!(next.design.layout.flaps[0], flap(1, 6.0, 7.0, 4.0, 5.0));
    assert!(next.design.layout.stretches.is_empty());
}

#[test]
fn optimizer_packing_validation_accepts_valid_different_layouts() {
    let request = OptimizerRequest {
        command: oristudio_bp::optimizer::OptimizerCommand::Start,
        use_bh: false,
        layout: LayoutMode::Random,
        random: 1,
        problem: oristudio_bp::optimizer::OptimizerProblem {
            grid_type: GridType::Rectangular,
            flaps: two_flap_requests(0.0, 0.0),
            hierarchies: vec![two_flap_hierarchy()],
        },
        vec: None,
    };
    let result = OptimizerResult {
        width: 10.0,
        height: 10.0,
        flaps: vec![
            oristudio_bp::optimizer::FlapResult {
                id: 1,
                x: 0.0,
                y: 0.0,
            },
            oristudio_bp::optimizer::FlapResult {
                id: 2,
                x: 10.0,
                y: 0.0,
            },
        ],
    };

    validate_optimizer_packing(&request, &result).unwrap();
}

#[test]
fn optimizer_packing_validation_rejects_invalid_distance() {
    let request = OptimizerRequest {
        command: oristudio_bp::optimizer::OptimizerCommand::Start,
        use_bh: false,
        layout: LayoutMode::Random,
        random: 1,
        problem: oristudio_bp::optimizer::OptimizerProblem {
            grid_type: GridType::Rectangular,
            flaps: two_flap_requests(0.0, 0.0),
            hierarchies: vec![two_flap_hierarchy()],
        },
        vec: None,
    };
    let result = OptimizerResult {
        width: 10.0,
        height: 10.0,
        flaps: vec![
            oristudio_bp::optimizer::FlapResult {
                id: 1,
                x: 0.0,
                y: 0.0,
            },
            oristudio_bp::optimizer::FlapResult {
                id: 2,
                x: 9.0,
                y: 0.0,
            },
        ],
    };

    let err = validate_optimizer_packing(&request, &result).unwrap_err();

    assert!(err.to_string().contains("violates distance"));
}

#[test]
fn optimizer_packing_validation_rejects_out_of_bounds_anchor() {
    let request = OptimizerRequest {
        command: oristudio_bp::optimizer::OptimizerCommand::Start,
        use_bh: false,
        layout: LayoutMode::Random,
        random: 1,
        problem: oristudio_bp::optimizer::OptimizerProblem {
            grid_type: GridType::Rectangular,
            flaps: two_flap_requests(0.0, 0.0),
            hierarchies: vec![Hierarchy {
                leaves: vec![1, 2],
                dist_map: Vec::new(),
                parents: Vec::new(),
            }],
        },
        vec: None,
    };
    let result = OptimizerResult {
        width: 10.0,
        height: 10.0,
        flaps: vec![
            oristudio_bp::optimizer::FlapResult {
                id: 1,
                x: -1.0,
                y: 0.0,
            },
            oristudio_bp::optimizer::FlapResult {
                id: 2,
                x: 0.0,
                y: 0.0,
            },
        ],
    };

    let err = validate_optimizer_packing(&request, &result).unwrap_err();

    assert!(err.to_string().contains("outside the rectangular sheet"));
}

#[test]
fn optimizer_solver_matches_simple_bp_oracle_for_view_layout() {
    let request = OptimizerRequest {
        command: oristudio_bp::optimizer::OptimizerCommand::Start,
        use_bh: false,
        layout: LayoutMode::View,
        random: 0,
        problem: oristudio_bp::optimizer::OptimizerProblem {
            grid_type: GridType::Rectangular,
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
            hierarchies: vec![Hierarchy {
                leaves: vec![1, 2],
                dist_map: vec![(1, 2, 10.0)],
                parents: Vec::new(),
            }],
        },
        vec: Some(vec![Point { x: 0.0, y: 0.0 }, Point { x: 0.3, y: 0.4 }]),
    };

    let result = solve(&request, Some(0)).unwrap();

    assert_eq!(result.width, 8.0);
    assert_eq!(result.height, 8.0);
    assert_eq!(
        result.flaps,
        vec![
            oristudio_bp::optimizer::FlapResult {
                id: 1,
                x: 0.0,
                y: 0.0,
            },
            oristudio_bp::optimizer::FlapResult {
                id: 2,
                x: 8.0,
                y: 7.0,
            },
        ]
    );

    let basin_result = solve(
        &OptimizerRequest {
            use_bh: true,
            ..request
        },
        Some(0),
    )
    .unwrap();

    assert_eq!(basin_result, result);
}

#[test]
fn optimizer_solve_report_records_progress_events_without_changing_result() {
    let request = simple_view_optimizer_request();

    let report = solve_report(&request, Some(0)).unwrap();
    let result = solve(&request, Some(0)).unwrap();

    assert_eq!(report.result, result);
    assert!(report.events.contains(&OptimizerEvent::Start));
    assert!(report.events.contains(&OptimizerEvent::Pack(0)));
    assert!(report.events.contains(&OptimizerEvent::Fit((0, 2))));
    assert!(report.events.contains(&OptimizerEvent::Fit((2, 2))));
}

#[test]
fn optimizer_progress_can_cancel_before_kernel_work() {
    let request = simple_view_optimizer_request();
    let mut events = Vec::new();

    let err = solve_with_progress(&request, Some(0), || true, |event| events.push(event))
        .expect_err("cancel predicate should stop optimizer");

    assert!(matches!(err, oristudio_bp::BpError::OptimizationCancelled));
    assert_eq!(events, vec![OptimizerEvent::Start]);
}

#[test]
fn optimizer_solver_matches_simple_bp_oracle_for_random_layout() {
    let request = OptimizerRequest {
        command: oristudio_bp::optimizer::OptimizerCommand::Start,
        use_bh: false,
        layout: LayoutMode::Random,
        random: 1,
        problem: oristudio_bp::optimizer::OptimizerProblem {
            grid_type: GridType::Rectangular,
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
            hierarchies: vec![Hierarchy {
                leaves: vec![1, 2],
                dist_map: vec![(1, 2, 10.0)],
                parents: Vec::new(),
            }],
        },
        vec: None,
    };

    let result = solve(&request, Some(0)).unwrap();

    assert_eq!(result.width, 8.0);
    assert_eq!(
        result.flaps,
        vec![
            oristudio_bp::optimizer::FlapResult {
                id: 1,
                x: 8.0,
                y: 7.0,
            },
            oristudio_bp::optimizer::FlapResult {
                id: 2,
                x: 0.0,
                y: 0.0,
            },
        ]
    );
    assert!(solve(&request, Some(4_294_967_296)).is_err());
}

fn simple_view_optimizer_request() -> OptimizerRequest {
    OptimizerRequest {
        command: oristudio_bp::optimizer::OptimizerCommand::Start,
        use_bh: false,
        layout: LayoutMode::View,
        random: 0,
        problem: oristudio_bp::optimizer::OptimizerProblem {
            grid_type: GridType::Rectangular,
            flaps: two_flap_requests(0.0, 0.0),
            hierarchies: vec![two_flap_hierarchy()],
        },
        vec: Some(vec![Point { x: 0.0, y: 0.0 }, Point { x: 0.3, y: 0.4 }]),
    }
}

#[test]
fn optimizer_solver_matches_one_flap_random_fixture() {
    let request: OptimizerRequest = serde_json::from_str(include_str!(
        "../../../tests/fixtures/bp-studio/optimizer.one-flap.request.json"
    ))
    .unwrap();

    let result = solve(&request, Some(0)).unwrap();

    assert_eq!(result.width, 3.0);
    assert_eq!(
        result.flaps,
        vec![oristudio_bp::optimizer::FlapResult {
            id: 1,
            x: 3.0,
            y: 3.0,
        }]
    );
}

#[test]
fn optimizer_solver_matches_dimensioned_rectangular_view_oracle() {
    let request = OptimizerRequest {
        command: oristudio_bp::optimizer::OptimizerCommand::Start,
        use_bh: false,
        layout: LayoutMode::View,
        random: 0,
        problem: oristudio_bp::optimizer::OptimizerProblem {
            grid_type: GridType::Rectangular,
            flaps: two_flap_requests(2.0, 2.0),
            hierarchies: vec![two_flap_hierarchy()],
        },
        vec: Some(vec![Point { x: 0.0, y: 0.0 }, Point { x: 0.3, y: 0.4 }]),
    };

    let result = solve(&request, Some(0)).unwrap();

    assert_eq!(result.width, 10.0);
    assert_eq!(result.flaps[0].x, 0.0);
    assert_eq!(result.flaps[0].y, 0.0);
    assert_eq!(result.flaps[1].x, 10.0);
    assert_eq!(result.flaps[1].y, 9.0);
}

#[test]
fn optimizer_solver_matches_diagonal_view_oracle() {
    let request = OptimizerRequest {
        command: oristudio_bp::optimizer::OptimizerCommand::Start,
        use_bh: false,
        layout: LayoutMode::View,
        random: 0,
        problem: oristudio_bp::optimizer::OptimizerProblem {
            grid_type: GridType::Diagonal,
            flaps: two_flap_requests(0.0, 0.0),
            hierarchies: vec![two_flap_hierarchy()],
        },
        vec: Some(vec![Point { x: 0.5, y: 0.5 }, Point { x: 0.7, y: 0.5 }]),
    };

    let result = solve(&request, Some(0)).unwrap();

    assert_eq!(result.width, 10.0);
    assert_eq!(result.flaps[0].x, 0.0);
    assert_eq!(result.flaps[0].y, 5.0);
    assert_eq!(result.flaps[1].x, 10.0);
    assert_eq!(result.flaps[1].y, 5.0);
}

fn hierarchy(leaves: Vec<u32>) -> Hierarchy {
    Hierarchy {
        leaves,
        dist_map: Vec::new(),
        parents: Vec::new(),
    }
}

fn two_flap_hierarchy() -> Hierarchy {
    Hierarchy {
        leaves: vec![1, 2],
        dist_map: vec![(1, 2, 10.0)],
        parents: Vec::new(),
    }
}

fn two_flap_requests(width: f64, height: f64) -> Vec<oristudio_bp::optimizer::FlapRequest> {
    vec![
        oristudio_bp::optimizer::FlapRequest {
            id: 1,
            width,
            height,
        },
        oristudio_bp::optimizer::FlapRequest {
            id: 2,
            width,
            height,
        },
    ]
}

fn flap(id: u32, x: f64, y: f64, width: f64, height: f64) -> Flap {
    Flap {
        id,
        x,
        y,
        width,
        height,
    }
}

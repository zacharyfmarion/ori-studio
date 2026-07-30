use oristudio_cp::folding::{
    DisplayStyle, FoldedFigureModel, FoldedFigureRenderGeometry, FoldedFigureRenderOptions,
    FoldedFigureRenderPaint, FoldedFigureRenderPrimitive, FoldedFigureRenderPrimitiveKind,
    FoldedFigureRenderSnapshot, FoldedFigureRenderStroke, FoldedFigureRenderStyle,
    FoldedFigureState, FoldedShadowGeometry, FoldedSubfaceFigure, OrieditaCustomConstraint,
    OrieditaCustomConstraintFaceOrder, OrieditaCustomConstraintType, OrieditaFoldedFigureCamera,
    OrieditaFoldedFigureCameraSet, OrieditaFoldedFigureCameraTarget, RenderPathCommand,
    folded_figure_camera_set_display_position_moved, folded_figure_camera_set_from_segments,
    folded_figure_camera_set_position_specified_from_tv, folded_figure_camera_set_scaled,
    folded_figure_paper_render_snapshot_from_segments, folded_figure_render_snapshot_from_segments,
    folded_figure_transparent_render_snapshot_from_segments,
    folded_figure_wire_render_snapshot_from_segments, folded_subface_figure_from_segments,
    parse_oriedita_render_primitives,
};
use oristudio_cp::geometry::{LineColor, LineSegment, Point};
use std::path::{Path, PathBuf};
use std::process::Command;
use treemaker_fold::{Assignment, FoldDocument};

#[test]
fn paper_render_oracle_outputs_are_parseable() {
    let Some(oracle) = render_oracle() else {
        eprintln!("skipping Oriedita render oracle test: ORIEDITA_RENDER_ORACLE is not set");
        return;
    };

    for case in paper_render_cases() {
        let output = run_oracle(&oracle, &[case.command, "simple-square"]);
        let snapshot =
            parse_oriedita_render_primitives(&output).expect("parse Oriedita render primitives");

        assert_eq!(snapshot.schema_version, 1);
        assert_eq!(snapshot.fixture.as_deref(), Some("simple-square"));
        assert_eq!(snapshot.pass.as_deref(), Some(case.pass));
        assert!(!snapshot.primitives.is_empty());
        assert_eq!(
            snapshot.primitives[0].kind,
            FoldedFigureRenderPrimitiveKind::FillPath
        );
        assert!(matches!(
            snapshot.primitives[0].geometry,
            FoldedFigureRenderGeometry::Path { .. }
        ));
    }
}

#[test]
fn paper_render_primitives_match_oriedita_oracle() {
    let Some(oracle) = render_oracle() else {
        eprintln!("skipping Oriedita render oracle test: ORIEDITA_RENDER_ORACLE is not set");
        return;
    };

    for case in paper_render_cases() {
        let output = run_oracle(&oracle, &[case.command, "simple-square"]);
        let oracle_snapshot =
            parse_oriedita_render_primitives(&output).expect("parse Oriedita render primitives");
        let model = FoldedFigureModel {
            state: case.state,
            ..FoldedFigureModel::default()
        };
        let rust_snapshot =
            folded_figure_paper_render_snapshot_from_segments(&simple_square(), 1, model)
                .expect("Rust paper render")
                .expect("paper primitives");

        assert_eq!(rust_snapshot.pass.as_deref(), Some(case.pass));
        assert_primitives_match(case.pass, &rust_snapshot, &oracle_snapshot);
    }
}

#[test]
fn kabuto_paper_render_primitives_match_oriedita_oracle() {
    let Some(oracle) = render_oracle() else {
        eprintln!("skipping Oriedita render oracle test: ORIEDITA_RENDER_ORACLE is not set");
        return;
    };

    let segments = kabuto_segments();
    for case in paper_render_segment_cases() {
        let output = run_oracle_owned(&oracle, &segment_oracle_args(case.command, &segments));
        let oracle_snapshot =
            parse_oriedita_render_primitives(&output).expect("parse Oriedita render primitives");
        let model = FoldedFigureModel {
            state: case.state,
            ..FoldedFigureModel::default()
        };
        let rust_snapshot = folded_figure_paper_render_snapshot_from_segments(&segments, 1, model)
            .expect("Rust paper render")
            .expect("paper primitives");

        assert_eq!(rust_snapshot.pass.as_deref(), Some(case.pass));
        assert_primitives_match_with_coordinate_tolerance(
            case.pass,
            &rust_snapshot,
            &oracle_snapshot,
        );
    }
}

#[test]
fn kabuto_folded_subface_figure_matches_oriedita_oracle() {
    let Some(oracle) = render_oracle() else {
        eprintln!("skipping Oriedita render oracle test: ORIEDITA_RENDER_ORACLE is not set");
        return;
    };

    let segments = kabuto_segments();
    let output = run_oracle_owned(
        &oracle,
        &segment_oracle_args_with_starting_face("folded-subface-figure-summary", 1, &segments),
    );
    let figure =
        folded_subface_figure_from_segments(&segments, 1).expect("Rust folded subface figure");
    assert_summary_eq(
        "kabuto folded subface figure",
        &folded_subface_figure_summary(&figure),
        &output,
    );
}

#[test]
fn kabuto_folded_camera_set_matches_oriedita_oracle() {
    let Some(oracle) = render_oracle() else {
        eprintln!("skipping Oriedita render oracle test: ORIEDITA_RENDER_ORACLE is not set");
        return;
    };

    let segments = kabuto_segments();
    let output = run_oracle_owned(
        &oracle,
        &segment_oracle_args("folded-render-cameras-segments", &segments),
    );
    let oracle_cameras = parse_oriedita_camera_set(&output).expect("parse Oriedita cameras");
    let rust_cameras =
        folded_figure_camera_set_from_segments(&segments, 1, FoldedFigureModel::default())
            .expect("Rust camera set");
    assert_camera_set_close("kabuto cameras", &rust_cameras, &oracle_cameras);
}

#[test]
fn kabuto_folded_camera_mutations_match_oriedita_oracle() {
    let Some(oracle) = render_oracle() else {
        eprintln!("skipping Oriedita render oracle test: ORIEDITA_RENDER_ORACLE is not set");
        return;
    };

    let segments = kabuto_segments();
    let base = folded_figure_camera_set_from_segments(&segments, 1, FoldedFigureModel::default())
        .expect("Rust camera set");

    let scale_output = run_oracle_owned(
        &oracle,
        &segment_oracle_args_with_prefix(
            "folded-render-cameras-scale-segments",
            &["1.75", "25.0", "30.0"],
            &segments,
        ),
    );
    let oracle_scaled =
        parse_oriedita_camera_set(&scale_output).expect("parse scaled Oriedita cameras");
    let rust_scaled =
        folded_figure_camera_set_scaled(base.clone(), 1.75, Some(Point::new(25.0, 30.0)));
    assert_camera_set_close("kabuto cameras scaled", &rust_scaled, &oracle_scaled);

    let move_output = run_oracle_owned(
        &oracle,
        &segment_oracle_args_with_prefix(
            "folded-render-cameras-move-segments",
            &["front", "7.5", "-3.25"],
            &segments,
        ),
    );
    let oracle_moved =
        parse_oriedita_camera_set(&move_output).expect("parse moved Oriedita cameras");
    let rust_moved = folded_figure_camera_set_display_position_moved(
        base.clone(),
        OrieditaFoldedFigureCameraTarget::Front,
        Point::new(7.5, -3.25),
    );
    assert_camera_set_close("kabuto cameras moved", &rust_moved, &oracle_moved);

    let specify_output = run_oracle_owned(
        &oracle,
        &segment_oracle_args_with_prefix(
            "folded-render-cameras-specify-segments",
            &["transparent-rear", "33.0", "12.0"],
            &segments,
        ),
    );
    let oracle_specified =
        parse_oriedita_camera_set(&specify_output).expect("parse specified Oriedita cameras");
    let rust_specified = folded_figure_camera_set_position_specified_from_tv(
        base,
        OrieditaFoldedFigureCameraTarget::TransparentRear,
        Point::new(33.0, 12.0),
    );
    assert_camera_set_close(
        "kabuto cameras specified",
        &rust_specified,
        &oracle_specified,
    );
}

#[test]
fn paper_shadow_render_oracle_outputs_are_parseable() {
    let Some(oracle) = render_oracle() else {
        eprintln!("skipping Oriedita render oracle test: ORIEDITA_RENDER_ORACLE is not set");
        return;
    };

    let segments = kabuto_segments();
    for case in paper_shadow_render_cases() {
        let output = run_oracle_owned(&oracle, &segment_oracle_args(case.command, &segments));
        let snapshot =
            parse_oriedita_render_primitives(&output).expect("parse Oriedita render primitives");

        assert_eq!(snapshot.schema_version, 1);
        assert_eq!(snapshot.fixture.as_deref(), Some("segments"));
        assert_eq!(snapshot.pass.as_deref(), Some(case.pass));
        assert!(
            snapshot.primitives.iter().any(|primitive| matches!(
                primitive.style.paint,
                FoldedFigureRenderPaint::Gradient { .. }
            )),
            "{} should include gradient shadows",
            case.pass
        );
    }
}

#[test]
fn kabuto_paper_shadow_render_primitives_match_oriedita_oracle() {
    let Some(oracle) = render_oracle() else {
        eprintln!("skipping Oriedita render oracle test: ORIEDITA_RENDER_ORACLE is not set");
        return;
    };

    let segments = kabuto_segments();
    for case in paper_shadow_render_cases() {
        let output = run_oracle_owned(&oracle, &segment_oracle_args(case.command, &segments));
        let oracle_snapshot =
            parse_oriedita_render_primitives(&output).expect("parse Oriedita render primitives");
        let model = FoldedFigureModel {
            state: case.state,
            display_shadows: true,
            ..FoldedFigureModel::default()
        };
        let rust_snapshot = folded_figure_paper_render_snapshot_from_segments(&segments, 1, model)
            .expect("Rust paper shadow render")
            .expect("paper shadow primitives");

        assert_eq!(rust_snapshot.pass.as_deref(), Some(case.pass));
        assert_primitives_match_with_coordinate_tolerance(
            case.pass,
            &rust_snapshot,
            &oracle_snapshot,
        );
    }
}

#[test]
fn paper_visible_face_oracle_outputs_are_parseable() {
    let Some(oracle) = render_oracle() else {
        eprintln!("skipping Oriedita render oracle test: ORIEDITA_RENDER_ORACLE is not set");
        return;
    };

    let segments = kabuto_segments();
    for case in paper_visible_face_cases() {
        let output = run_oracle_owned(&oracle, &segment_oracle_args(case.command, &segments));
        let lines = output.lines().collect::<Vec<_>>();
        assert_eq!(
            lines.first().copied(),
            Some("schema|folded-render-visible-faces|1")
        );
        let expected_fixture = format!("fixture|segments|{}", case.pass);
        assert_eq!(lines.get(1).copied(), Some(expected_fixture.as_str()));
        assert!(
            lines
                .get(2)
                .is_some_and(|line| line.starts_with("subfaces|"))
        );

        let visible = lines
            .iter()
            .filter(|line| line.starts_with("visible|"))
            .copied()
            .collect::<Vec<_>>();
        assert!(
            !visible.is_empty(),
            "{} should list visible subfaces",
            case.pass
        );
        for row in visible {
            assert_eq!(
                row.split('|').count(),
                11,
                "{case_pass} row should have stable columns: {row}",
                case_pass = case.pass
            );
        }
    }
}

#[test]
fn transparent_and_wire_render_oracle_outputs_are_parseable() {
    let Some(oracle) = render_oracle() else {
        eprintln!("skipping Oriedita render oracle test: ORIEDITA_RENDER_ORACLE is not set");
        return;
    };

    let segments = kabuto_segments();
    for case in wire_render_cases()
        .into_iter()
        .chain(transparent_grayscale_render_cases())
        .chain(transparent_color_render_cases())
    {
        let output = run_oracle_owned(&oracle, &segment_oracle_args(case.command, &segments));
        let snapshot =
            parse_oriedita_render_primitives(&output).expect("parse Oriedita render primitives");

        assert_eq!(snapshot.schema_version, 1);
        assert_eq!(snapshot.fixture.as_deref(), Some("segments"));
        assert_eq!(snapshot.pass.as_deref(), Some(case.pass));
        assert!(
            !snapshot.primitives.is_empty(),
            "{} should include render primitives",
            case.pass
        );
    }
}

#[test]
fn kabuto_wire_render_primitives_match_oriedita_oracle() {
    let Some(oracle) = render_oracle() else {
        eprintln!("skipping Oriedita render oracle test: ORIEDITA_RENDER_ORACLE is not set");
        return;
    };

    let segments = kabuto_segments();
    for case in wire_render_cases() {
        let output = run_oracle_owned(&oracle, &segment_oracle_args(case.command, &segments));
        let oracle_snapshot =
            parse_oriedita_render_primitives(&output).expect("parse Oriedita render primitives");
        let model = FoldedFigureModel {
            state: case.state,
            ..FoldedFigureModel::default()
        };
        let rust_snapshot = folded_figure_wire_render_snapshot_from_segments(&segments, 1, model)
            .expect("Rust wire render")
            .expect("wire primitives");

        assert_eq!(rust_snapshot.pass.as_deref(), Some(case.pass));
        assert_primitives_match_with_coordinate_tolerance(
            case.pass,
            &rust_snapshot,
            &oracle_snapshot,
        );
    }
}

#[test]
fn kabuto_transparent_render_primitives_match_oriedita_oracle() {
    let Some(oracle) = render_oracle() else {
        eprintln!("skipping Oriedita render oracle test: ORIEDITA_RENDER_ORACLE is not set");
        return;
    };

    let segments = kabuto_segments();
    for (cases, color) in [
        (transparent_grayscale_render_cases(), false),
        (transparent_color_render_cases(), true),
    ] {
        for case in cases {
            let output = run_oracle_owned(&oracle, &segment_oracle_args(case.command, &segments));
            let oracle_snapshot = parse_oriedita_render_primitives(&output)
                .expect("parse Oriedita render primitives");
            let model = FoldedFigureModel {
                state: case.state,
                transparency_color: color,
                ..FoldedFigureModel::default()
            };
            let rust_snapshot =
                folded_figure_transparent_render_snapshot_from_segments(&segments, 1, model)
                    .expect("Rust transparent render")
                    .expect("transparent primitives");

            assert_eq!(rust_snapshot.pass.as_deref(), Some(case.pass));
            assert_primitives_match_with_coordinate_tolerance(
                case.pass,
                &rust_snapshot,
                &oracle_snapshot,
            );
        }
    }
}

#[test]
fn kabuto_folded_overlay_primitives_match_oriedita_oracle() {
    let Some(oracle) = render_oracle() else {
        eprintln!("skipping Oriedita render oracle test: ORIEDITA_RENDER_ORACLE is not set");
        return;
    };

    let segments = kabuto_segments();
    let constraints = vec![
        OrieditaCustomConstraint {
            face_order: OrieditaCustomConstraintFaceOrder::Normal,
            constraint_type: OrieditaCustomConstraintType::ColorBack,
            position: Point::new(10.0, 10.0),
        },
        OrieditaCustomConstraint {
            face_order: OrieditaCustomConstraintFaceOrder::Flipped,
            constraint_type: OrieditaCustomConstraintType::ColorFront,
            position: Point::new(20.0, 20.0),
        },
    ];

    let cases = [
        (
            "paper-both-full",
            DisplayStyle::Paper5,
            FoldedFigureState::Both2,
            vec![
                "paper",
                "both",
                "false",
                "true",
                "true",
                "true",
                "7",
                "0,2",
                "1,3",
                "2",
                "normal",
                "color-back",
                "10.0",
                "10.0",
                "flipped",
                "color-front",
                "20.0",
                "20.0",
            ],
            FoldedFigureRenderOptions {
                display_mark: true,
                selected: true,
                index: 7,
                display_numbers: true,
                selected_flat_point_indices: vec![0, 2],
                selected_folded_point_indices: vec![1, 3],
                custom_constraints: constraints.clone(),
                // Diffed against Oriedita's own output, so shadow bands have to
                // carry upstream's width quirk rather than the product default.
                shadow_geometry: FoldedShadowGeometry::OrieditaExact,
            },
        ),
        (
            "transparent-grayscale-both-full",
            DisplayStyle::Transparent3,
            FoldedFigureState::Both2,
            vec![
                "transparent",
                "both",
                "false",
                "false",
                "false",
                "false",
                "7",
                "-",
                "-",
                "2",
                "normal",
                "color-back",
                "10.0",
                "10.0",
                "flipped",
                "color-front",
                "20.0",
                "20.0",
            ],
            FoldedFigureRenderOptions {
                custom_constraints: constraints.clone(),
                shadow_geometry: FoldedShadowGeometry::OrieditaExact,
                ..FoldedFigureRenderOptions::default()
            },
        ),
    ];

    for (pass, display_style, state, prefix, options) in cases {
        let output = run_oracle_owned(
            &oracle,
            &segment_oracle_args_with_prefix("folded-render-overlays-segments", &prefix, &segments),
        );
        let oracle_snapshot =
            parse_oriedita_render_primitives(&output).expect("parse Oriedita render primitives");
        let model = FoldedFigureModel {
            state,
            ..FoldedFigureModel::default()
        };
        let rust_snapshot = folded_figure_render_snapshot_from_segments(
            &segments,
            1,
            display_style,
            model,
            options,
        )
        .expect("Rust full folded render")
        .expect("full folded primitives");

        assert_eq!(rust_snapshot.pass.as_deref(), Some(pass));
        assert_primitives_match_with_coordinate_tolerance(pass, &rust_snapshot, &oracle_snapshot);
    }
}

fn assert_primitives_match(
    pass: &str,
    rust_snapshot: &FoldedFigureRenderSnapshot,
    oracle_snapshot: &FoldedFigureRenderSnapshot,
) {
    if rust_snapshot.primitives == oracle_snapshot.primitives {
        return;
    }
    let mismatch = rust_snapshot
        .primitives
        .iter()
        .zip(&oracle_snapshot.primitives)
        .position(|(rust, oracle)| rust != oracle);
    panic!(
        "{pass} primitives should match: Rust len {}, oracle len {}, first mismatch {:?}\nRust: {:?}\nOracle: {:?}",
        rust_snapshot.primitives.len(),
        oracle_snapshot.primitives.len(),
        mismatch,
        mismatch.and_then(|index| rust_snapshot.primitives.get(index)),
        mismatch.and_then(|index| oracle_snapshot.primitives.get(index))
    );
}

fn assert_summary_eq(label: &str, rust: &str, oracle: &str) {
    if rust == oracle {
        return;
    }

    let rust_lines = rust.lines().collect::<Vec<_>>();
    let oracle_lines = oracle.lines().collect::<Vec<_>>();
    let mismatch = rust_lines
        .iter()
        .zip(&oracle_lines)
        .position(|(rust, oracle)| rust != oracle);
    let context = mismatch
        .map(|index| {
            let start = index.saturating_sub(5);
            let end = (index + 6).min(rust_lines.len().max(oracle_lines.len()));
            (start..end)
                .map(|line| {
                    format!(
                        "{line}: {:?} <> {:?}",
                        rust_lines.get(line),
                        oracle_lines.get(line)
                    )
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();
    panic!(
        "{label} should match: Rust len {}, oracle len {}, first mismatch {:?}\n{}",
        rust_lines.len(),
        oracle_lines.len(),
        mismatch,
        context
    );
}

fn assert_primitives_match_with_coordinate_tolerance(
    pass: &str,
    rust_snapshot: &FoldedFigureRenderSnapshot,
    oracle_snapshot: &FoldedFigureRenderSnapshot,
) {
    assert_eq!(rust_snapshot.schema_version, oracle_snapshot.schema_version);
    assert_eq!(rust_snapshot.pass, oracle_snapshot.pass);
    assert_eq!(
        rust_snapshot.primitives.len(),
        oracle_snapshot.primitives.len(),
        "{pass} primitive count"
    );
    for (index, (rust, oracle)) in rust_snapshot
        .primitives
        .iter()
        .zip(&oracle_snapshot.primitives)
        .enumerate()
    {
        assert_primitive_approximately_matches(pass, index, rust, oracle);
    }
}

fn assert_primitive_approximately_matches(
    pass: &str,
    index: usize,
    rust: &FoldedFigureRenderPrimitive,
    oracle: &FoldedFigureRenderPrimitive,
) {
    assert_eq!(rust.sequence, oracle.sequence, "{pass} primitive {index}");
    assert_eq!(rust.kind, oracle.kind, "{pass} primitive {index}");
    assert_style_approximately_matches(pass, index, &rust.style, &oracle.style);
    assert_geometry_approximately_matches(pass, index, &rust.geometry, &oracle.geometry);
}

fn assert_style_approximately_matches(
    pass: &str,
    index: usize,
    rust: &FoldedFigureRenderStyle,
    oracle: &FoldedFigureRenderStyle,
) {
    assert_paint_approximately_matches(pass, index, &rust.paint, &oracle.paint);
    assert_stroke_approximately_matches(pass, index, &rust.stroke, &oracle.stroke);
    assert_eq!(
        rust.antialias, oracle.antialias,
        "{pass} primitive {index} antialias"
    );
}

fn assert_paint_approximately_matches(
    pass: &str,
    index: usize,
    rust: &FoldedFigureRenderPaint,
    oracle: &FoldedFigureRenderPaint,
) {
    match (rust, oracle) {
        (FoldedFigureRenderPaint::None, FoldedFigureRenderPaint::None)
        | (FoldedFigureRenderPaint::Texture, FoldedFigureRenderPaint::Texture) => {}
        (
            FoldedFigureRenderPaint::Color { color: rust },
            FoldedFigureRenderPaint::Color { color: oracle },
        ) => assert_eq!(rust, oracle, "{pass} primitive {index} color"),
        (
            FoldedFigureRenderPaint::Gradient {
                from: rust_from,
                from_color: rust_from_color,
                to: rust_to,
                to_color: rust_to_color,
                cyclic: rust_cyclic,
            },
            FoldedFigureRenderPaint::Gradient {
                from: oracle_from,
                from_color: oracle_from_color,
                to: oracle_to,
                to_color: oracle_to_color,
                cyclic: oracle_cyclic,
            },
        ) => {
            assert_point_close(pass, index, "gradient from", *rust_from, *oracle_from);
            assert_eq!(
                rust_from_color, oracle_from_color,
                "{pass} primitive {index} gradient from color"
            );
            assert_point_close(pass, index, "gradient to", *rust_to, *oracle_to);
            assert_eq!(
                rust_to_color, oracle_to_color,
                "{pass} primitive {index} gradient to color"
            );
            assert_eq!(
                rust_cyclic, oracle_cyclic,
                "{pass} primitive {index} gradient cyclic"
            );
        }
        (
            FoldedFigureRenderPaint::Other {
                class_name: rust_class,
            },
            FoldedFigureRenderPaint::Other {
                class_name: oracle_class,
            },
        ) => assert_eq!(
            rust_class, oracle_class,
            "{pass} primitive {index} paint class"
        ),
        _ => panic!("{pass} primitive {index} paint mismatch: {rust:?} != {oracle:?}"),
    }
}

fn assert_stroke_approximately_matches(
    pass: &str,
    index: usize,
    rust: &FoldedFigureRenderStroke,
    oracle: &FoldedFigureRenderStroke,
) {
    match (rust, oracle) {
        (FoldedFigureRenderStroke::None, FoldedFigureRenderStroke::None) => {}
        (
            FoldedFigureRenderStroke::Basic {
                width: rust_width,
                end_cap: rust_end_cap,
                line_join: rust_line_join,
                miter_limit: rust_miter_limit,
            },
            FoldedFigureRenderStroke::Basic {
                width: oracle_width,
                end_cap: oracle_end_cap,
                line_join: oracle_line_join,
                miter_limit: oracle_miter_limit,
            },
        ) => {
            assert_f64_close(pass, index, "stroke width", *rust_width, *oracle_width);
            assert_eq!(
                rust_end_cap, oracle_end_cap,
                "{pass} primitive {index} stroke cap"
            );
            assert_eq!(
                rust_line_join, oracle_line_join,
                "{pass} primitive {index} stroke join"
            );
            assert_f64_close(
                pass,
                index,
                "stroke miter",
                *rust_miter_limit,
                *oracle_miter_limit,
            );
        }
        (
            FoldedFigureRenderStroke::Other {
                class_name: rust_class,
            },
            FoldedFigureRenderStroke::Other {
                class_name: oracle_class,
            },
        ) => assert_eq!(
            rust_class, oracle_class,
            "{pass} primitive {index} stroke class"
        ),
        _ => panic!("{pass} primitive {index} stroke mismatch: {rust:?} != {oracle:?}"),
    }
}

fn assert_geometry_approximately_matches(
    pass: &str,
    index: usize,
    rust: &FoldedFigureRenderGeometry,
    oracle: &FoldedFigureRenderGeometry,
) {
    match (rust, oracle) {
        (
            FoldedFigureRenderGeometry::Path { commands: rust },
            FoldedFigureRenderGeometry::Path { commands: oracle },
        ) => {
            assert_eq!(
                rust.len(),
                oracle.len(),
                "{pass} primitive {index} path command count"
            );
            for (command_index, (rust, oracle)) in rust.iter().zip(oracle).enumerate() {
                assert_path_command_close(pass, index, command_index, rust, oracle);
            }
        }
        (
            FoldedFigureRenderGeometry::Segment {
                from: rust_from,
                to: rust_to,
            },
            FoldedFigureRenderGeometry::Segment {
                from: oracle_from,
                to: oracle_to,
            },
        ) => {
            assert_point_close(pass, index, "segment from", *rust_from, *oracle_from);
            assert_point_close(pass, index, "segment to", *rust_to, *oracle_to);
        }
        (
            FoldedFigureRenderGeometry::Polygon { points: rust },
            FoldedFigureRenderGeometry::Polygon { points: oracle },
        ) => {
            assert_eq!(
                rust.len(),
                oracle.len(),
                "{pass} primitive {index} polygon point count"
            );
            for (point_index, (rust, oracle)) in rust.iter().zip(oracle).enumerate() {
                assert_point_close(
                    pass,
                    index,
                    format!("polygon point {point_index}"),
                    *rust,
                    *oracle,
                );
            }
        }
        (
            FoldedFigureRenderGeometry::Rect {
                x: rust_x,
                y: rust_y,
                width: rust_width,
                height: rust_height,
            },
            FoldedFigureRenderGeometry::Rect {
                x: oracle_x,
                y: oracle_y,
                width: oracle_width,
                height: oracle_height,
            },
        )
        | (
            FoldedFigureRenderGeometry::Ellipse {
                x: rust_x,
                y: rust_y,
                width: rust_width,
                height: rust_height,
            },
            FoldedFigureRenderGeometry::Ellipse {
                x: oracle_x,
                y: oracle_y,
                width: oracle_width,
                height: oracle_height,
            },
        ) => {
            assert_f64_close(pass, index, "rect x", *rust_x, *oracle_x);
            assert_f64_close(pass, index, "rect y", *rust_y, *oracle_y);
            assert_f64_close(pass, index, "rect width", *rust_width, *oracle_width);
            assert_f64_close(pass, index, "rect height", *rust_height, *oracle_height);
        }
        (
            FoldedFigureRenderGeometry::Text {
                value: rust_value,
                position: rust_position,
            },
            FoldedFigureRenderGeometry::Text {
                value: oracle_value,
                position: oracle_position,
            },
        ) => {
            assert_eq!(
                rust_value, oracle_value,
                "{pass} primitive {index} text value"
            );
            assert_point_close(
                pass,
                index,
                "text position",
                *rust_position,
                *oracle_position,
            );
        }
        _ => panic!("{pass} primitive {index} geometry mismatch: {rust:?} != {oracle:?}"),
    }
}

fn assert_path_command_close(
    pass: &str,
    primitive_index: usize,
    command_index: usize,
    rust: &RenderPathCommand,
    oracle: &RenderPathCommand,
) {
    match (rust, oracle) {
        (
            RenderPathCommand::MoveTo { point: rust },
            RenderPathCommand::MoveTo { point: oracle },
        ) => assert_point_close(pass, primitive_index, command_index, *rust, *oracle),
        (
            RenderPathCommand::LineTo { point: rust },
            RenderPathCommand::LineTo { point: oracle },
        ) => assert_point_close(pass, primitive_index, command_index, *rust, *oracle),
        (
            RenderPathCommand::QuadTo {
                control: rust_control,
                point: rust_point,
            },
            RenderPathCommand::QuadTo {
                control: oracle_control,
                point: oracle_point,
            },
        ) => {
            assert_point_close(
                pass,
                primitive_index,
                format!("path command {command_index} quad control"),
                *rust_control,
                *oracle_control,
            );
            assert_point_close(
                pass,
                primitive_index,
                format!("path command {command_index} quad point"),
                *rust_point,
                *oracle_point,
            );
        }
        (
            RenderPathCommand::CubicTo {
                control_1: rust_control_1,
                control_2: rust_control_2,
                point: rust_point,
            },
            RenderPathCommand::CubicTo {
                control_1: oracle_control_1,
                control_2: oracle_control_2,
                point: oracle_point,
            },
        ) => {
            assert_point_close(
                pass,
                primitive_index,
                format!("path command {command_index} cubic control 1"),
                *rust_control_1,
                *oracle_control_1,
            );
            assert_point_close(
                pass,
                primitive_index,
                format!("path command {command_index} cubic control 2"),
                *rust_control_2,
                *oracle_control_2,
            );
            assert_point_close(
                pass,
                primitive_index,
                format!("path command {command_index} cubic point"),
                *rust_point,
                *oracle_point,
            );
        }
        (RenderPathCommand::Close, RenderPathCommand::Close) => {}
        _ => panic!(
            "{pass} primitive {primitive_index} path command {command_index} mismatch: {rust:?} != {oracle:?}"
        ),
    }
}

fn assert_point_close(
    pass: &str,
    primitive_index: usize,
    label: impl std::fmt::Display,
    rust: Point,
    oracle: Point,
) {
    assert_f64_close(
        pass,
        primitive_index,
        format!("{label} x"),
        rust.x,
        oracle.x,
    );
    assert_f64_close(
        pass,
        primitive_index,
        format!("{label} y"),
        rust.y,
        oracle.y,
    );
}

fn assert_f64_close(
    pass: &str,
    primitive_index: usize,
    label: impl std::fmt::Display,
    rust: f64,
    oracle: f64,
) {
    const TOLERANCE: f64 = 1.5e-9;
    assert!(
        (rust - oracle).abs() <= TOLERANCE,
        "{pass} primitive {primitive_index} {label}: {rust} != {oracle}"
    );
}

fn assert_camera_set_close(
    pass: &str,
    rust: &OrieditaFoldedFigureCameraSet,
    oracle: &OrieditaFoldedFigureCameraSet,
) {
    assert_camera_close(pass, "folded", &rust.folded, &oracle.folded);
    assert_camera_close(pass, "front", &rust.front, &oracle.front);
    assert_camera_close(pass, "rear", &rust.rear, &oracle.rear);
    assert_camera_close(
        pass,
        "transparent_front",
        &rust.transparent_front,
        &oracle.transparent_front,
    );
    assert_camera_close(
        pass,
        "transparent_rear",
        &rust.transparent_rear,
        &oracle.transparent_rear,
    );
}

fn assert_camera_close(
    pass: &str,
    name: &str,
    rust: &OrieditaFoldedFigureCamera,
    oracle: &OrieditaFoldedFigureCamera,
) {
    assert_point_close(
        pass,
        0,
        format!("{name} camera position"),
        rust.camera_position,
        oracle.camera_position,
    );
    assert_f64_close(
        pass,
        0,
        format!("{name} angle"),
        rust.angle_degrees,
        oracle.angle_degrees,
    );
    assert_f64_close(
        pass,
        0,
        format!("{name} mirror"),
        rust.mirror,
        oracle.mirror,
    );
    assert_f64_close(
        pass,
        0,
        format!("{name} zoom x"),
        rust.zoom_x,
        oracle.zoom_x,
    );
    assert_f64_close(
        pass,
        0,
        format!("{name} zoom y"),
        rust.zoom_y,
        oracle.zoom_y,
    );
    assert_point_close(
        pass,
        0,
        format!("{name} display position"),
        rust.display_position,
        oracle.display_position,
    );
}

struct PaperRenderCase {
    command: &'static str,
    pass: &'static str,
    state: FoldedFigureState,
}

fn paper_render_cases() -> [PaperRenderCase; 3] {
    [
        PaperRenderCase {
            command: "folded-render-paper-front",
            pass: "paper-front",
            state: FoldedFigureState::Front0,
        },
        PaperRenderCase {
            command: "folded-render-paper-back",
            pass: "paper-back",
            state: FoldedFigureState::Back1,
        },
        PaperRenderCase {
            command: "folded-render-paper-both",
            pass: "paper-both",
            state: FoldedFigureState::Both2,
        },
    ]
}

fn paper_render_segment_cases() -> [PaperRenderCase; 3] {
    [
        PaperRenderCase {
            command: "folded-render-paper-front-segments",
            pass: "paper-front",
            state: FoldedFigureState::Front0,
        },
        PaperRenderCase {
            command: "folded-render-paper-back-segments",
            pass: "paper-back",
            state: FoldedFigureState::Back1,
        },
        PaperRenderCase {
            command: "folded-render-paper-both-segments",
            pass: "paper-both",
            state: FoldedFigureState::Both2,
        },
    ]
}

fn paper_shadow_render_cases() -> [PaperRenderCase; 3] {
    [
        PaperRenderCase {
            command: "folded-render-paper-front-shadows-segments",
            pass: "paper-front-shadows",
            state: FoldedFigureState::Front0,
        },
        PaperRenderCase {
            command: "folded-render-paper-back-shadows-segments",
            pass: "paper-back-shadows",
            state: FoldedFigureState::Back1,
        },
        PaperRenderCase {
            command: "folded-render-paper-both-shadows-segments",
            pass: "paper-both-shadows",
            state: FoldedFigureState::Both2,
        },
    ]
}

fn paper_visible_face_cases() -> [PaperRenderCase; 3] {
    [
        PaperRenderCase {
            command: "folded-render-paper-visible-front-segments",
            pass: "paper-visible-front",
            state: FoldedFigureState::Front0,
        },
        PaperRenderCase {
            command: "folded-render-paper-visible-back-segments",
            pass: "paper-visible-back",
            state: FoldedFigureState::Back1,
        },
        PaperRenderCase {
            command: "folded-render-paper-visible-both-segments",
            pass: "paper-visible-both",
            state: FoldedFigureState::Both2,
        },
    ]
}

fn wire_render_cases() -> [PaperRenderCase; 4] {
    [
        PaperRenderCase {
            command: "folded-render-wire-front-segments",
            pass: "wire-front",
            state: FoldedFigureState::Front0,
        },
        PaperRenderCase {
            command: "folded-render-wire-back-segments",
            pass: "wire-back",
            state: FoldedFigureState::Back1,
        },
        PaperRenderCase {
            command: "folded-render-wire-both-segments",
            pass: "wire-both",
            state: FoldedFigureState::Both2,
        },
        PaperRenderCase {
            command: "folded-render-wire-transparent-state-segments",
            pass: "wire-transparent-state",
            state: FoldedFigureState::Transparent3,
        },
    ]
}

fn transparent_grayscale_render_cases() -> [PaperRenderCase; 4] {
    [
        PaperRenderCase {
            command: "folded-render-transparent-grayscale-front-segments",
            pass: "transparent-grayscale-front",
            state: FoldedFigureState::Front0,
        },
        PaperRenderCase {
            command: "folded-render-transparent-grayscale-back-segments",
            pass: "transparent-grayscale-back",
            state: FoldedFigureState::Back1,
        },
        PaperRenderCase {
            command: "folded-render-transparent-grayscale-both-segments",
            pass: "transparent-grayscale-both",
            state: FoldedFigureState::Both2,
        },
        PaperRenderCase {
            command: "folded-render-transparent-grayscale-transparent-state-segments",
            pass: "transparent-grayscale-transparent-state",
            state: FoldedFigureState::Transparent3,
        },
    ]
}

fn transparent_color_render_cases() -> [PaperRenderCase; 4] {
    [
        PaperRenderCase {
            command: "folded-render-transparent-color-front-segments",
            pass: "transparent-color-front",
            state: FoldedFigureState::Front0,
        },
        PaperRenderCase {
            command: "folded-render-transparent-color-back-segments",
            pass: "transparent-color-back",
            state: FoldedFigureState::Back1,
        },
        PaperRenderCase {
            command: "folded-render-transparent-color-both-segments",
            pass: "transparent-color-both",
            state: FoldedFigureState::Both2,
        },
        PaperRenderCase {
            command: "folded-render-transparent-color-transparent-state-segments",
            pass: "transparent-color-transparent-state",
            state: FoldedFigureState::Transparent3,
        },
    ]
}

fn segment_oracle_args(command: &str, segments: &[LineSegment]) -> Vec<String> {
    let mut args = vec![command.to_string(), segments.len().to_string()];
    for segment in segments {
        args.push(java_double_string(segment.a.x));
        args.push(java_double_string(segment.a.y));
        args.push(java_double_string(segment.b.x));
        args.push(java_double_string(segment.b.y));
        args.push(segment.color.number().to_string());
    }
    args
}

fn segment_oracle_args_with_prefix(
    command: &str,
    prefix: &[&str],
    segments: &[LineSegment],
) -> Vec<String> {
    let mut args = vec![command.to_string()];
    args.extend(prefix.iter().map(|value| (*value).to_string()));
    args.push(segments.len().to_string());
    for segment in segments {
        args.push(java_double_string(segment.a.x));
        args.push(java_double_string(segment.a.y));
        args.push(java_double_string(segment.b.x));
        args.push(java_double_string(segment.b.y));
        args.push(segment.color.number().to_string());
    }
    args
}

fn segment_oracle_args_with_starting_face(
    command: &str,
    starting_face: i32,
    segments: &[LineSegment],
) -> Vec<String> {
    let mut args = vec![
        command.to_string(),
        starting_face.to_string(),
        segments.len().to_string(),
    ];
    for segment in segments {
        args.push(java_double_string(segment.a.x));
        args.push(java_double_string(segment.a.y));
        args.push(java_double_string(segment.b.x));
        args.push(java_double_string(segment.b.y));
        args.push(segment.color.number().to_string());
    }
    args
}

fn folded_subface_figure_summary(figure: &FoldedSubfaceFigure) -> String {
    let mut output = String::new();
    output.push_str(&format!(
        "pointset|{}|{}|{}\n",
        figure.points.len(),
        figure.lines.len(),
        figure.faces.len()
    ));
    for (index, point) in figure.points.iter().enumerate() {
        output.push_str(&format!(
            "point|{}|{}|{}\n",
            index,
            java_double_string(point.x),
            java_double_string(point.y)
        ));
    }
    for (index, line) in figure.lines.iter().enumerate() {
        output.push_str(&format!(
            "line|{}|{}|{}|{}\n",
            index,
            line.begin,
            line.end,
            line.color.number()
        ));
    }
    for (index, face) in figure.faces.iter().enumerate() {
        output.push_str(&format!("face|{}|{}\n", index, joined_ids(face)));
    }
    output
}

fn joined_ids(ids: &[usize]) -> String {
    ids.iter()
        .map(usize::to_string)
        .collect::<Vec<_>>()
        .join(",")
}

fn render_oracle() -> Option<PathBuf> {
    std::env::var("ORIEDITA_RENDER_ORACLE")
        .or_else(|_| std::env::var("ORIEDITA_GEOMETRY_ORACLE"))
        .ok()
        .map(|oracle| resolve_oracle_path(&oracle))
}

fn parse_oriedita_camera_set(output: &str) -> Result<OrieditaFoldedFigureCameraSet, String> {
    let mut folded = None;
    let mut front = None;
    let mut rear = None;
    let mut transparent_front = None;
    let mut transparent_rear = None;

    for (index, line) in output.lines().enumerate() {
        let fields = line.split('|').collect::<Vec<_>>();
        match fields.first().copied() {
            Some("schema") => {
                if fields.as_slice() != ["schema", "folded-render-cameras", "1"] {
                    return Err(format!("invalid camera schema line {index}: {line}"));
                }
            }
            Some("fixture") => {
                if fields.as_slice() != ["fixture", "segments", "cameras"] {
                    return Err(format!("invalid camera fixture line {index}: {line}"));
                }
            }
            Some("camera") => {
                let camera = parse_oriedita_camera_row(&fields, index)?;
                match fields.get(1).copied() {
                    Some("folded") => folded = Some(camera),
                    Some("front") => front = Some(camera),
                    Some("rear") => rear = Some(camera),
                    Some("transparent-front") => transparent_front = Some(camera),
                    Some("transparent-rear") => transparent_rear = Some(camera),
                    Some(name) => return Err(format!("unknown camera name {name:?}")),
                    None => return Err(format!("missing camera name at line {index}")),
                }
            }
            Some(other) => return Err(format!("unknown camera record {other:?} at line {index}")),
            None => {}
        }
    }

    Ok(OrieditaFoldedFigureCameraSet {
        folded: folded.ok_or_else(|| "missing folded camera".to_string())?,
        front: front.ok_or_else(|| "missing front camera".to_string())?,
        rear: rear.ok_or_else(|| "missing rear camera".to_string())?,
        transparent_front: transparent_front
            .ok_or_else(|| "missing transparent front camera".to_string())?,
        transparent_rear: transparent_rear
            .ok_or_else(|| "missing transparent rear camera".to_string())?,
    })
}

fn parse_oriedita_camera_row(
    fields: &[&str],
    line: usize,
) -> Result<OrieditaFoldedFigureCamera, String> {
    if fields.len() != 10 {
        return Err(format!("camera row {line} must have 10 fields"));
    }
    Ok(OrieditaFoldedFigureCamera {
        camera_position: Point::new(
            parse_camera_f64(fields[2], line, "camera position x")?,
            parse_camera_f64(fields[3], line, "camera position y")?,
        ),
        angle_degrees: parse_camera_f64(fields[4], line, "angle")?,
        mirror: parse_camera_f64(fields[5], line, "mirror")?,
        zoom_x: parse_camera_f64(fields[6], line, "zoom x")?,
        zoom_y: parse_camera_f64(fields[7], line, "zoom y")?,
        display_position: Point::new(
            parse_camera_f64(fields[8], line, "display position x")?,
            parse_camera_f64(fields[9], line, "display position y")?,
        ),
    })
}

fn parse_camera_f64(value: &str, line: usize, label: &str) -> Result<f64, String> {
    value
        .parse::<f64>()
        .map_err(|err| format!("invalid {label} at camera line {line}: {err}"))
}

fn resolve_oracle_path(oracle: &str) -> PathBuf {
    let path = PathBuf::from(oracle);
    if path.is_absolute() {
        path
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join(path)
    }
}

fn run_oracle(oracle: &Path, args: &[&str]) -> String {
    let output = Command::new(oracle)
        .args(args)
        .output()
        .unwrap_or_else(|err| panic!("failed to run Oriedita render oracle {oracle:?}: {err}"));
    assert!(
        output.status.success(),
        "Oriedita render oracle failed with status {:?}: {}",
        output.status.code(),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).expect("oracle stdout should be valid UTF-8")
}

fn run_oracle_owned(oracle: &Path, args: &[String]) -> String {
    let args = args.iter().map(String::as_str).collect::<Vec<_>>();
    run_oracle(oracle, &args)
}

fn kabuto_segments() -> Vec<LineSegment> {
    let fold: FoldDocument = serde_json::from_str(include_str!(
        "../../../tests/fixtures/flat-folder/kabuto.fold"
    ))
    .expect("kabuto fold fixture");
    fold.edges_vertices
        .iter()
        .enumerate()
        .map(|(index, edge)| {
            let a = &fold.vertices_coords[edge[0]];
            let b = &fold.vertices_coords[edge[1]];
            let color = fold
                .edges_assignment
                .get(index)
                .copied()
                .map(fold_assignment_color)
                .unwrap_or(LineColor::Black0);
            LineSegment::with_color(Point::new(a[0], a[1]), Point::new(b[0], b[1]), color)
        })
        .collect()
}

fn fold_assignment_color(assignment: Assignment) -> LineColor {
    match assignment {
        Assignment::Mountain => LineColor::Red1,
        Assignment::Valley => LineColor::Blue2,
        Assignment::Flat => LineColor::Cyan3,
        Assignment::Boundary | Assignment::Unassigned | Assignment::Cut | Assignment::Join => {
            LineColor::Black0
        }
    }
}

fn java_double_string(value: f64) -> String {
    if value.is_finite() && value.fract() == 0.0 {
        format!("{value:.1}")
    } else {
        value.to_string()
    }
}

fn simple_square() -> Vec<LineSegment> {
    vec![
        LineSegment::with_color(
            Point::new(-50.0, -50.0),
            Point::new(50.0, -50.0),
            LineColor::Black0,
        ),
        LineSegment::with_color(
            Point::new(50.0, -50.0),
            Point::new(50.0, 50.0),
            LineColor::Black0,
        ),
        LineSegment::with_color(
            Point::new(50.0, 50.0),
            Point::new(-50.0, 50.0),
            LineColor::Black0,
        ),
        LineSegment::with_color(
            Point::new(-50.0, 50.0),
            Point::new(-50.0, -50.0),
            LineColor::Black0,
        ),
        LineSegment::with_color(
            Point::new(-50.0, -50.0),
            Point::new(50.0, 50.0),
            LineColor::Red1,
        ),
    ]
}

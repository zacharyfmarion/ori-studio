use oristudio_cp::folding::{
    FoldedFigureModel, FoldedFigureRenderGeometry, FoldedFigureRenderPaint,
    FoldedFigureRenderPrimitiveKind, FoldedFigureState,
    folded_figure_paper_render_snapshot_from_segments, parse_oriedita_render_primitives,
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
        let mut model = FoldedFigureModel::default();
        model.state = case.state;
        let rust_snapshot =
            folded_figure_paper_render_snapshot_from_segments(&simple_square(), 1, model)
                .expect("Rust paper render")
                .expect("paper primitives");

        assert_eq!(rust_snapshot.pass.as_deref(), Some(case.pass));
        assert_primitives_match(case.pass, &rust_snapshot, &oracle_snapshot);
    }
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

fn assert_primitives_match(
    pass: &str,
    rust_snapshot: &oristudio_cp::folding::FoldedFigureRenderSnapshot,
    oracle_snapshot: &oristudio_cp::folding::FoldedFigureRenderSnapshot,
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

fn render_oracle() -> Option<PathBuf> {
    std::env::var("ORIEDITA_RENDER_ORACLE")
        .or_else(|_| std::env::var("ORIEDITA_GEOMETRY_ORACLE"))
        .ok()
        .map(|oracle| resolve_oracle_path(&oracle))
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

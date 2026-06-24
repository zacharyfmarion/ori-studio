use oristudio_cp::folding::{
    FoldedFigureRenderGeometry, FoldedFigureRenderPrimitiveKind, parse_oriedita_render_primitives,
};
use std::path::{Path, PathBuf};
use std::process::Command;

#[test]
fn paper_front_render_oracle_output_is_parseable() {
    let Some(oracle) = render_oracle() else {
        eprintln!("skipping Oriedita render oracle test: ORIEDITA_RENDER_ORACLE is not set");
        return;
    };

    let output = run_oracle(&oracle, &["folded-render-paper-front", "simple-square"]);
    let snapshot =
        parse_oriedita_render_primitives(&output).expect("parse Oriedita render primitives");

    assert_eq!(snapshot.schema_version, 1);
    assert_eq!(snapshot.fixture.as_deref(), Some("simple-square"));
    assert_eq!(snapshot.pass.as_deref(), Some("paper-front"));
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

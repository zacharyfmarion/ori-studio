//! Real fixtures: the iguana `.osf` (31 disjoint sheets, 16 rotated 45°) and
//! the spike's FOLD fixtures (all exact).

use std::path::{Path, PathBuf};

use oristudio_precrease::{ExactnessClass, SheetAnalysis, analyze};
use serde_json::Value;

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

/// FOLD frame → flat segments + Oriedita colour codes.
fn fold_to_segments(fold: &Value) -> (Vec<f64>, Vec<i32>) {
    let vertices = fold["vertices_coords"].as_array().expect("vertices_coords");
    let edges = fold["edges_vertices"].as_array().expect("edges_vertices");
    let assignments = fold["edges_assignment"].as_array();
    let mut segments = Vec::with_capacity(edges.len() * 4);
    let mut colors = Vec::with_capacity(edges.len());
    for (i, e) in edges.iter().enumerate() {
        let a = e[0].as_u64().expect("vertex index") as usize;
        let b = e[1].as_u64().expect("vertex index") as usize;
        for v in [a, b] {
            segments.push(vertices[v][0].as_f64().expect("x"));
            segments.push(vertices[v][1].as_f64().expect("y"));
        }
        let code = match assignments.and_then(|a| a[i].as_str()) {
            Some("B") => 0,
            Some("M") => 1,
            Some("V") => 2,
            Some("U") => -1,
            _ => 3,
        };
        colors.push(code);
    }
    (segments, colors)
}

fn analyze_fold_file(path: &Path) -> SheetAnalysis {
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let fold: Value = serde_json::from_str(&text).expect("fold json");
    let (segments, colors) = fold_to_segments(&fold);
    analyze(&segments, &colors, None).expect("analysis")
}

#[test]
fn iguana_canvas_splits_into_thirty_one_rectangular_sheets() {
    let path = repo_root().join("tests/fixtures/simulation/iguana_24.osf");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let osf: Value = serde_json::from_str(&text).expect("osf json");
    let fold = &osf["workspace"]["documents"][1]["creasePattern"]["foldProjection"];
    let (segments, colors) = fold_to_segments(fold);
    assert_eq!(colors.len(), 7910);

    let analysis = analyze(&segments, &colors, None).expect("analysis");
    assert_eq!(analysis.components.len(), 31);
    assert!(
        analysis.components.iter().all(|c| c.refused.is_none()),
        "refused: {:?}",
        analysis
            .components
            .iter()
            .filter_map(|c| c.refused.as_ref())
            .collect::<Vec<_>>()
    );
    assert!(analysis.unassigned_segments.is_empty());
    assert!(analysis.warnings.is_empty(), "{:?}", analysis.warnings);

    let s = std::f64::consts::FRAC_1_SQRT_2;
    let mut axis_aligned = 0;
    let mut rotated = 0;
    for c in &analysis.components {
        let frame = c.frame.expect("frame");
        if frame.x_axis[1].abs() < 1e-9 {
            axis_aligned += 1;
            assert_eq!(frame.x_axis, [1.0, 0.0]);
        } else {
            rotated += 1;
            assert!((frame.x_axis[0] - s).abs() < 1e-9 && (frame.x_axis[1] + s).abs() < 1e-9);
        }
        let rect = c.rf_rect.expect("rect");
        assert!((rect.width.max(rect.height) - 1.0).abs() < 1e-12);
        assert!(c.outline_residual < 1e-9);
        assert!(!c.merged_lines.is_empty());
        let e = c.exactness.as_ref().expect("exactness");
        assert_eq!(
            e.class,
            ExactnessClass::Exact,
            "component {} residuals {:?} family {:?}",
            c.id,
            e.residuals,
            e.family
        );
    }
    assert_eq!(axis_aligned, 15);
    assert_eq!(rotated, 16);

    // Every border segment belongs to exactly one loop, every crease to one sheet.
    let border_total: usize = analysis
        .components
        .iter()
        .map(|c| c.border_segment_indices.len())
        .sum();
    let crease_total: usize = analysis
        .components
        .iter()
        .map(|c| c.segment_indices.len())
        .sum();
    assert_eq!(border_total, colors.iter().filter(|&&c| c == 0).count());
    assert_eq!(crease_total, colors.iter().filter(|&&c| c != 0).count());

    // The largest component is the 24-grid box pleat the plan measured:
    // its ~1,800 segments collapse roughly twenty to one.
    let biggest = analysis
        .components
        .iter()
        .max_by_key(|c| c.segment_indices.len())
        .expect("component");
    assert!(biggest.segment_indices.len() > 1500);
    assert!(biggest.merged_lines.len() < biggest.segment_indices.len() / 10);
}

#[test]
fn spike_grid6_is_exact_with_fourteen_lines() {
    let analysis = analyze_fold_file(&repo_root().join("tests/fixtures/precrease/grid6.fold"));
    assert_eq!(analysis.components.len(), 1);
    let c = &analysis.components[0];
    assert!(c.refused.is_none());
    assert_eq!(c.merged_lines.len(), 14);
    let e = c.exactness.as_ref().expect("exactness");
    assert_eq!(e.class, ExactnessClass::Exact, "{:?}", e.residuals);
    assert_eq!(e.snapped.lines.len(), 14);
}

#[test]
fn panel_counterexample_fixtures_are_exact() {
    // The design panel's counterexample crease patterns, kept beside the planner's
    // own fixtures. grid6 has its own test above, and iguana-c0 is a real design
    // rather than a counterexample, so both are skipped here.
    let dir = repo_root().join("tests/fixtures/precrease");
    let mut seen = 0;
    for entry in std::fs::read_dir(&dir).expect("precrease fixtures") {
        let path = entry.expect("entry").path();
        if path.extension().and_then(|e| e.to_str()) != Some("fold") {
            continue;
        }
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default();
        if name == "grid6" || name == "iguana-c0" {
            continue;
        }
        seen += 1;
        let analysis = analyze_fold_file(&path);
        assert_eq!(analysis.components.len(), 1, "{}", path.display());
        let c = &analysis.components[0];
        assert!(c.refused.is_none(), "{}", path.display());
        let e = c.exactness.as_ref().expect("exactness");
        assert_eq!(
            e.class,
            ExactnessClass::Exact,
            "{} residuals {:?}",
            path.display(),
            e.residuals
        );
        assert_eq!(e.snapped.lines.len(), c.merged_lines.len());
    }
    assert_eq!(seen, 5);
}

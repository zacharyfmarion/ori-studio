//! A/B the two placement channels on a real `.osf`: writing the solver's
//! `vertices_exact` versus writing only `movement_report.moved_vertices`.
//!
//! Both rewrite the same creases through the same frame; they differ only in
//! which vertices get a solved position. Counting CAMV `Angles` violations on
//! the resulting document is the product-visible consequence.
//!
//! Usage:
//!   cargo run --release -p oristudio-cp-compiler \
//!     --example placement_channel_ab -- <file.osf>

use oristudio_cp::io::fold::export_fold_document;
use oristudio_cp::model::CreasePatternModel;
use oristudio_cp_compiler::{ExactSolveOptions, Point2, exact_solve_input_from_fold, solve_exact};
use serde_json::Value;
use std::collections::BTreeMap;

fn main() {
    let path = std::env::args().nth(1).expect("usage: <file.osf>");
    let raw = std::fs::read_to_string(&path).expect("read");
    let root: Value = serde_json::from_str(&raw).expect("json");
    let cp = &root["workspace"]["creasePattern"]["creasePattern"];
    let model: CreasePatternModel =
        serde_json::from_value(cp["document"]["crease_pattern"].clone()).expect("model");
    let region = &cp["suppressionRegions"][0];
    let cx = region["center"]["x"].as_f64().unwrap_or(0.0);
    let cy = region["center"]["y"].as_f64().unwrap_or(0.0);
    let hw = region["width"].as_f64().unwrap_or(0.0) / 2.0;
    let hh = region["height"].as_f64().unwrap_or(0.0) / 2.0;
    let inside = |x: f64, y: f64| x >= cx - hw && x <= cx + hw && y >= cy - hh && y <= cy + hh;

    let mut owned = model.clone();
    owned.line_segments = model
        .line_segments
        .iter()
        .filter(|s| inside(s.a.x, s.a.y) && inside(s.b.x, s.b.y))
        .cloned()
        .collect();

    let fold = export_fold_document(&owned, None);
    let (input, xform) = exact_solve_input_from_fold(&fold).expect("rebuild");
    let solved = solve_exact(&input, ExactSolveOptions::default());

    // Channel A: the whole solved array, indexed by vertex id.
    let from_exact: BTreeMap<usize, Point2> = solved
        .vertices_exact
        .iter()
        .enumerate()
        .map(|(id, p)| (id, *p))
        .collect();
    // Channel B: only what the movement report names.
    let from_report: BTreeMap<usize, Point2> = solved.movement_report["moved_vertices"]
        .as_array()
        .map(|entries| {
            entries
                .iter()
                .filter_map(|e| {
                    let id = e["vertex_id"].as_u64()? as usize;
                    let after = e["after"].as_object()?;
                    Some((id, Point2::new(after["x"].as_f64()?, after["y"].as_f64()?)))
                })
                .collect()
        })
        .unwrap_or_default();

    println!("== {} ==", path.rsplit('/').next().unwrap_or(&path));
    println!("status {:?}", solved.status);
    println!(
        "placed by vertices_exact: {}   by moved_vertices: {}",
        from_exact.len(),
        from_report.len()
    );
    println!(
        "  before (document as saved):        {}",
        describe(&place(&owned, &fold, &BTreeMap::new(), &xform))
    );
    println!(
        "  after, placed by moved_vertices:   {}",
        describe(&place(&owned, &fold, &from_report, &xform))
    );
    println!(
        "  after, placed by vertices_exact:   {}",
        describe(&place(&owned, &fold, &from_exact, &xform))
    );
}

/// Rewrite the owned creases from solved positions, exactly as the web does:
/// segment `i` is FOLD edge `i`, and each end takes its vertex id's position.
fn place(
    owned: &CreasePatternModel,
    fold: &treemaker_fold::FoldDocument,
    positions: &BTreeMap<usize, Point2>,
    xform: &oristudio_cp_compiler::Similarity,
) -> CreasePatternModel {
    let mut out = owned.clone();
    for (index, segment) in out.line_segments.iter_mut().enumerate() {
        let Some(edge) = fold.edges_vertices.get(index) else {
            continue;
        };
        if let Some(p) = positions.get(&edge[0]) {
            let d = xform.invert(*p);
            segment.a.x = d.x;
            segment.a.y = d.y;
        }
        if let Some(p) = positions.get(&edge[1]) {
            let d = xform.invert(*p);
            segment.b.x = d.x;
            segment.b.y = d.y;
        }
    }
    out
}

fn describe(model: &CreasePatternModel) -> String {
    let result = oristudio_cp::checks::check_camv_task(model);
    let angles = result
        .violations
        .iter()
        .filter(|v| v.rule == oristudio_cp::checks::FlatFoldabilityRule::Angles)
        .count();
    format!(
        "CAMV total {:>3}   Angles {:>3}",
        result.violations.len(),
        angles
    )
}

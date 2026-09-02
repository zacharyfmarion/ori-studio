//! How much of the benchmark's ground truth would Ori Studio call flat-foldable?
//!
//! The 563-sample benchmark scores against `gt.graph.json` — pixel coordinates
//! plus M/V/B labels — and its success metric (`solve_recovered_original`) only
//! asks whether the solve *matched* that graph. It never asks whether the graph
//! folds. This runs each ground truth through the same CAMV checker the editor
//! draws its markers from, which is what "import it and look" would show.
//!
//! Usage:
//!   cargo run --release -p oristudio-cp-compiler \
//!     --example gt_graph_camv_survey -- <pack-dir>...

use oristudio_cp::checks::{FlatFoldabilityRule, check_camv_task};
use serde::Deserialize;

/// Paper spans pixels `[32, image_size - 32]`; the editor's sheet is ±200.
const INSET: f64 = 32.0;
const PAPER: f64 = 400.0;

#[derive(Deserialize)]
struct GroundTruthGraph {
    #[serde(default = "default_image_size")]
    image_size: f64,
    vertices_px: Vec<[f64; 2]>,
    edges_vertices: Vec<[usize; 2]>,
    #[serde(default)]
    edges_assignment_labels: Vec<serde_json::Value>,
    #[serde(default)]
    edges_assignment: Vec<serde_json::Value>,
}

fn default_image_size() -> f64 {
    1024.0
}

fn main() {
    println!(
        "{:<44} {:>6} {:>7} {:>7} {:>7} {:>7}   {}",
        "pack", "n", "clean", "angle", "BLB", "both", "worst angle / BLB counts"
    );
    let (mut all, mut all_clean) = (0usize, 0usize);
    for pack in std::env::args().skip(1) {
        let Ok(entries) = std::fs::read_dir(format!("{pack}/samples")) else {
            continue;
        };
        let (mut n, mut clean, mut angle_only, mut blb_only, mut both) = (0, 0, 0, 0, 0);
        let (mut worst_angle, mut worst_blb) = (0usize, 0usize);
        let mut blb_total = 0usize;
        for entry in entries.flatten() {
            let Ok(text) = std::fs::read_to_string(entry.path().join("gt.graph.json")) else {
                continue;
            };
            let Ok(graph) = serde_json::from_str::<GroundTruthGraph>(&text) else {
                continue;
            };
            let Some(fold) = to_fold_json(&graph) else {
                continue;
            };
            let Ok(document) = oristudio_cp::io::fold::import_fold_file_document_json(&fold) else {
                continue;
            };
            n += 1;
            let violations = check_camv_task(&document.crease_pattern).violations;
            let angles = violations
                .iter()
                .filter(|v| matches!(v.rule, FlatFoldabilityRule::Angles))
                .count();
            let blb = violations.len() - angles;
            worst_angle = worst_angle.max(angles);
            worst_blb = worst_blb.max(blb);
            blb_total += blb;
            match (angles > 0, blb > 0) {
                (false, false) => clean += 1,
                (true, false) => angle_only += 1,
                (false, true) => blb_only += 1,
                (true, true) => both += 1,
            }
        }
        if n == 0 {
            continue;
        }
        all += n;
        all_clean += clean;
        println!(
            "{:<44} {n:>6} {clean:>7} {angle_only:>7} {blb_only:>7} {both:>7}   worst {worst_angle} / {worst_blb}, {blb_total} BLB total",
            pack.rsplit('/').next().unwrap_or(&pack)
        );
    }
    println!("\n{all_clean} of {all} ground-truth samples are CAMV-clean.");
}

/// Ground-truth pixels -> a FOLD on the editor's sheet, which is what an import
/// would produce.
fn to_fold_json(graph: &GroundTruthGraph) -> Option<String> {
    let span = graph.image_size - 2.0 * INSET;
    if span <= 0.0 {
        return None;
    }
    let map = |v: f64| (v - INSET) / span * PAPER - PAPER / 2.0;
    let labels = if graph.edges_assignment_labels.is_empty() {
        &graph.edges_assignment
    } else {
        &graph.edges_assignment_labels
    };
    let assignment: Vec<String> = (0..graph.edges_vertices.len())
        .map(|index| {
            labels
                .get(index)
                .and_then(|value| value.as_str())
                .unwrap_or("U")
                .to_owned()
        })
        .collect();
    serde_json::to_string(&serde_json::json!({
        "file_spec": 1.1,
        "vertices_coords": graph.vertices_px.iter()
            .map(|p| [map(p[0]), map(p[1])]).collect::<Vec<_>>(),
        "edges_vertices": graph.edges_vertices,
        "edges_assignment": assignment,
    }))
    .ok()
}

//! Strict-topology diagnostics for FOLD pairs, one JSON line per pair.
//!
//! Reads a list file of `predicted.fold<TAB>truth.fold` lines (already in a
//! common frame, aux edges dropped) and prints the full `StrictTopologyMetrics`
//! for each at the given vertex/split tolerance, so an analysis can cluster
//! the missing and extra edges the benchmark counted into repair sites with
//! the same metric the benchmark uses.
//!
//!   cargo run --release -p oristudio-cp-eval --example strict_diff -- pairs.tsv 4.0
use oristudio_cp_eval::{EvalGraph, StrictTopologyOptions, strict_topology_metrics};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let list = std::fs::read_to_string(&args[1]).expect("list file");
    let tolerance: f64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(4.0);
    for line in list.lines() {
        let mut parts = line.split('\t');
        let (Some(pred), Some(truth)) = (parts.next(), parts.next()) else {
            continue;
        };
        let load = |path: &str| -> Result<EvalGraph, String> {
            let text = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
            let value: serde_json::Value =
                serde_json::from_str(&text).map_err(|e| format!("{path}: {e}"))?;
            EvalGraph::from_fold_value(&value).map_err(|e| format!("{path}: {e}"))
        };
        let record = match (load(pred), load(truth)) {
            (Ok(p), Ok(t)) => {
                let m = strict_topology_metrics(
                    &p,
                    &t,
                    StrictTopologyOptions {
                        vertex_tolerance: tolerance,
                        split_merge_tolerance: tolerance,
                        compare_assignments: true,
                    },
                );
                serde_json::json!({ "pred": pred, "truth": truth, "metrics": m })
            }
            (Err(e), _) | (_, Err(e)) => {
                serde_json::json!({ "pred": pred, "truth": truth, "error": e })
            }
        };
        println!("{record}");
    }
}

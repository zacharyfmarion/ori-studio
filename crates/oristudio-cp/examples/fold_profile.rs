//! Native fold-estimation profiling harness.
//!
//! Loads an Oriedita `.ori` file or an Ori Studio `.osf` project, runs the fold
//! estimation order-by-order with wall-clock timing and the `fold-profiling`
//! counters, and prints a summary. Native iteration is far faster than the
//! browser loop for perf work.
//!
//! ```bash
//! CARGO_PROFILE_RELEASE_DEBUG=true \
//!   cargo run -p oristudio-cp --release --features fold-profiling \
//!   --example fold_profile -- /path/to/slow_fold_iguana.ori
//! ```
//!
//! Add `--loop N` to fold N times (keeps the process alive for `sample`/`samply`).

use oristudio_cp::CreasePatternModel;
use oristudio_cp::folding::{EstimationOrder, FoldingEstimateSession};
use oristudio_cp::io::cp::import_cp_str;
use oristudio_cp::io::ori::import_ori_json;
use std::path::Path;
use std::time::Instant;

/// Pull the editable crease pattern out of an `.osf` project.
///
/// The node at `workspace.creasePattern.creasePattern.document.crease_pattern`
/// is the kernel's own serde form of [`CreasePatternModel`], so this is a
/// straight deserialize rather than a second parser to keep in step.
fn load_osf(text: &str) -> CreasePatternModel {
    let root = serde_json::from_str::<serde_json::Value>(text).expect("parse .osf JSON");
    let node = root
        .pointer("/workspace/creasePattern/creasePattern/document/crease_pattern")
        .expect("no editable crease pattern in this .osf");
    serde_json::from_value(node.clone()).expect("deserialize crease pattern")
}

fn main() {
    let mut args = std::env::args().skip(1);
    let mut path = None;
    let mut loops = 1usize;
    let mut starting_face = 1i32;
    let mut csv = false;
    let mut max_order = 5usize;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--loop" => loops = args.next().and_then(|v| v.parse().ok()).unwrap_or(1),
            "--starting-face" => {
                starting_face = args.next().and_then(|v| v.parse().ok()).unwrap_or(1)
            }
            // One line per file, for diffing a whole corpus before/after a perf
            // change. Carries the fingerprint, so a run that got faster and also
            // got *different* is visible in the same table.
            "--csv" => csv = true,
            // Stop after this order. `--max-order 4` measures setup only, which
            // is what a change to the fold *graph* moves; Order5 is the layer
            // search and can run for an hour on a hard model, drowning the
            // signal.
            "--max-order" => max_order = args.next().and_then(|v| v.parse().ok()).unwrap_or(5),
            other => path = Some(other.to_string()),
        }
    }
    let path =
        path.expect("usage: fold_profile <file.ori|file.osf|file.cp> [--loop N] [--csv] ...");

    let text = std::fs::read_to_string(&path).expect("read input file");
    let lowercase = path.to_ascii_lowercase();
    let model = if lowercase.ends_with(".osf") {
        load_osf(&text)
    } else if lowercase.ends_with(".cp") {
        import_cp_str(&text).expect("import .cp")
    } else {
        import_ori_json(&text).expect("import .ori").crease_pattern
    };
    let segments = &model.line_segments;
    let name = Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.clone());
    if !csv {
        println!("loaded {} ({} line segments)", path, segments.len());
    }

    let steps = [
        EstimationOrder::Order1,
        EstimationOrder::Order2,
        EstimationOrder::Order3,
        EstimationOrder::Order4,
        EstimationOrder::Order5,
    ];
    let steps = &steps[..max_order.clamp(1, steps.len())];

    for iteration in 0..loops {
        oristudio_cp::fold_profiling::reset();
        let mut session = FoldingEstimateSession::new(segments, starting_face);
        let total = Instant::now();
        let mut per_step = Vec::with_capacity(steps.len());
        for &step in steps {
            let start = Instant::now();
            // A fold that refuses (disconnected graph, parity abort) is a normal
            // corpus outcome, not a harness failure — record it and move on, so
            // one bad file cannot end a 660-file run.
            if let Err(error) = session.folding_estimated(step) {
                if csv {
                    println!("{name},{},ERR,,,,,{error:?}", segments.len());
                } else {
                    println!("[iter {iteration}] {step:?}: FAILED {error:?}");
                }
                return;
            }
            let elapsed = start.elapsed().as_secs_f64() * 1000.0;
            per_step.push(elapsed);
            if !csv {
                println!(
                    "[iter {iteration}] {step:?}: {elapsed:8.1}ms | {}",
                    oristudio_cp::fold_profiling::snapshot()
                );
            }
        }
        let total_ms = total.elapsed().as_secs_f64() * 1000.0;
        if !csv {
            println!("[iter {iteration}] TOTAL: {total_ms:.1}ms");
        }

        // Correctness fingerprint: discovered cases + a stable hash of the final
        // overlap hierarchy. Must stay identical across perf refactors.
        let estimate = session.estimate();
        let mut hash: u64 = 1469598103934665603; // FNV offset
        let mut relation_count = 0usize;
        if let Some(overlap) = &estimate.overlap {
            let mut relations: Vec<(usize, usize)> = overlap
                .hierarchy
                .relations
                .iter()
                .map(|r| (r.upper_face, r.lower_face))
                .collect();
            relations.sort_unstable();
            relation_count = relations.len();
            for (u, l) in relations {
                for byte in u.to_le_bytes().iter().chain(l.to_le_bytes().iter()) {
                    hash ^= *byte as u64;
                    hash = hash.wrapping_mul(1099511628211);
                }
            }
        }
        if csv {
            println!(
                "{name},{},{:.1},{:.1},{:.1},{},{},{:#018x}",
                segments.len(),
                per_step.get(3).copied().unwrap_or(0.0),
                per_step.get(4).copied().unwrap_or(0.0),
                total_ms,
                estimate.discovered_fold_cases,
                relation_count,
                hash
            );
        } else {
            println!(
                "[iter {iteration}] FINGERPRINT: cases={} relations={} hier_hash={:#018x}\n",
                estimate.discovered_fold_cases, relation_count, hash
            );
        }
    }
}

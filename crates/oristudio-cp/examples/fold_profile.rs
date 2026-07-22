//! Native fold-estimation profiling harness.
//!
//! Loads an Oriedita `.ori` file, runs the fold estimation order-by-order with
//! wall-clock timing and the `fold-profiling` counters, and prints a summary.
//! Native iteration is far faster than the browser loop for perf work.
//!
//! ```bash
//! CARGO_PROFILE_RELEASE_DEBUG=true \
//!   cargo run -p oristudio-cp --release --features fold-profiling \
//!   --example fold_profile -- /path/to/slow_fold_iguana.ori
//! ```
//!
//! Add `--loop N` to fold N times (keeps the process alive for `sample`/`samply`).

use oristudio_cp::folding::{EstimationOrder, FoldingEstimateSession};
use oristudio_cp::io::ori::import_ori_json;
use std::time::Instant;

fn main() {
    let mut args = std::env::args().skip(1);
    let mut path = None;
    let mut loops = 1usize;
    let mut starting_face = 1i32;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--loop" => loops = args.next().and_then(|v| v.parse().ok()).unwrap_or(1),
            "--starting-face" => {
                starting_face = args.next().and_then(|v| v.parse().ok()).unwrap_or(1)
            }
            other => path = Some(other.to_string()),
        }
    }
    let path = path.expect("usage: fold_profile <file.ori> [--loop N] [--starting-face N]");

    let text = std::fs::read_to_string(&path).expect("read .ori file");
    let document = import_ori_json(&text).expect("import .ori");
    let segments = &document.crease_pattern.line_segments;
    println!("loaded {} ({} line segments)", path, segments.len());

    let steps = [
        EstimationOrder::Order1,
        EstimationOrder::Order2,
        EstimationOrder::Order3,
        EstimationOrder::Order4,
        EstimationOrder::Order5,
    ];

    for iteration in 0..loops {
        oristudio_cp::fold_profiling::reset();
        let mut session = FoldingEstimateSession::new(segments, starting_face);
        let total = Instant::now();
        for step in steps {
            let start = Instant::now();
            session.folding_estimated(step).expect("fold step");
            let elapsed = start.elapsed().as_secs_f64() * 1000.0;
            println!(
                "[iter {iteration}] {step:?}: {elapsed:8.1}ms | {}",
                oristudio_cp::fold_profiling::snapshot()
            );
        }
        println!(
            "[iter {iteration}] TOTAL: {:.1}ms",
            total.elapsed().as_secs_f64() * 1000.0
        );

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
        println!(
            "[iter {iteration}] FINGERPRINT: cases={} relations={} hier_hash={:#018x}\n",
            estimate.discovered_fold_cases, relation_count, hash
        );
    }
}

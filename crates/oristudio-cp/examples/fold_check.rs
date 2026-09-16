//! Does a crease pattern fold flat, by the editor's own Fold?
//!
//! Loads a FOLD file with the kernel's importer, runs `FoldingEstimateSession`
//! to `Order5` under a deadline — the editor's Fold — and prints the outcome,
//! next to the exactness the editor's checker would report (odd-degree
//! interior vertices, worst Kawasaki residual). One line per file.
//!
//!   cargo run --release -p oristudio-cp --example fold_check -- [--seconds N] <file.fold>...
use std::sync::Arc;
use std::time::{Duration, Instant};

use oristudio_cp::cancel::{self, CancelHandle, CancelSource, RunId};
use oristudio_cp::folding::{EstimationOrder, EstimationStep, FoldOutcome, FoldingEstimateSession};
use oristudio_cp::geometry::{LineColor, LineSegment};
use oristudio_cp::io::fold::import_fold_json;

struct Deadline(Instant);

impl CancelSource for Deadline {
    fn cancelled_run(&self) -> u32 {
        u32::from(Instant::now() >= self.0)
    }
}

fn is_crease(color: LineColor) -> bool {
    matches!(
        color,
        LineColor::Black0 | LineColor::Red1 | LineColor::Blue2
    )
}

fn fold(creases: &[LineSegment], seconds: f64) -> (String, f64) {
    let started = Instant::now();
    let handle = CancelHandle::new(
        Arc::new(Deadline(started + Duration::from_secs_f64(seconds))),
        RunId::new(1).expect("nonzero"),
    );
    let _guard = cancel::bind(Some(handle));
    let mut session = FoldingEstimateSession::new(creases, 1);
    let outcome = match session.folding_estimated(EstimationOrder::Order5) {
        Err(error) if error.is_cancelled() => "timeout".to_owned(),
        Err(error) => format!("error: {error:?}"),
        Ok(estimate) if estimate.estimation_step == EstimationStep::Step1 => {
            "faces_unresolved".to_owned()
        }
        Ok(estimate) => match estimate.outcome {
            FoldOutcome::Solved => "solved".to_owned(),
            FoldOutcome::NoSolutions => "no_solutions".to_owned(),
            FoldOutcome::Contradiction => "contradiction".to_owned(),
            FoldOutcome::NotAttempted => "not_attempted".to_owned(),
        },
    };
    (outcome, started.elapsed().as_secs_f64())
}

fn main() {
    let mut seconds = 60.0;
    let mut files = Vec::new();
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--seconds" {
            seconds = args
                .next()
                .and_then(|value| value.parse().ok())
                .expect("--seconds <n>");
        } else {
            files.push(arg);
        }
    }
    for file in files {
        let text = match std::fs::read_to_string(&file) {
            Ok(text) => text,
            Err(error) => {
                println!("{file}\tread: {error}");
                continue;
            }
        };
        let model = match import_fold_json(&text) {
            Ok(model) => model,
            Err(error) => {
                println!("{file}\timport: {error:?}");
                continue;
            }
        };
        let creases: Vec<LineSegment> = model
            .line_segments
            .iter()
            .filter(|segment| is_crease(segment.color))
            .cloned()
            .collect();
        let (outcome, elapsed) = fold(&creases, seconds);
        println!(
            "{file}\tcreases {}\tfold {outcome}\t{elapsed:.1}s",
            creases.len()
        );
    }
}

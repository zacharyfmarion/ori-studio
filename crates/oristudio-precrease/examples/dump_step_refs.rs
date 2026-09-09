//! What each step of a plan is sighted from, and whether those marks are on the
//! paper.
//!
//! ```sh
//! cargo run --release -p oristudio-precrease --example dump_step_refs -- <file> [from] [to]
//! ```

use std::path::Path;

use oristudio_precrease::analyze;
use oristudio_precrease::clock::frozen_clock;
use oristudio_precrease::fixture_io::load_path;
use oristudio_precrease::planner::{Planner, PlannerOptions};
use oristudio_precrease::predicates::Ref;

const ORIEDITA_PAPER: [f64; 4] = [-200.0, -200.0, 200.0, 200.0];

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let from: usize = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(1);
    let to: usize = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(from + 4);
    let cp = load_path(Path::new(&args[0]), None).expect("load");
    let analysis = analyze(&cp.segments, &cp.colors, Some(ORIEDITA_PAPER)).expect("analyze");
    let component = analysis
        .components
        .iter()
        .max_by_key(|c| c.unit_segments.len())
        .expect("a component");
    let opts = PlannerOptions {
        clock: frozen_clock(),
        stuck_budget_ms: 0.0,
        total_budget_ms: 0.0,
        ..PlannerOptions::default()
    };
    let mut planner = Planner::new(component, opts);
    planner.plan().expect("plan");
    let seq = planner.sequence(false);

    let mut folds = 0;
    for step in &seq.steps {
        folds += 1;
        if folds < from || folds > to {
            continue;
        }
        let witness = step.chosen.and_then(|c| step.witnesses.get(c));
        let inputs = witness
            .map(|w| {
                w.inputs
                    .iter()
                    .map(|r| match r {
                        Ref::Edge { id, side } => format!("edge {side:?}#{id}"),
                        Ref::Line { id } => format!("line#{id}"),
                        Ref::Corner { id, corner } => format!("corner {corner:?}#{id}"),
                        Ref::Point { id } => format!("POINT#{id}"),
                    })
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_else(|| "(no witness)".into());
        println!(
            "fold {folds:3}  step {:3}  O{}  marks_exist={:<5}  witnesses={}  inputs: {inputs}",
            step.id,
            witness.map_or(0, |w| w.axiom),
            step.marks_exist,
            step.witnesses.len(),
        );
    }
}

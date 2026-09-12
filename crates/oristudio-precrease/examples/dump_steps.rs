//! Print a plan's steps, one line each, for reading a sequence without the
//! browser: id, kind, axiom, the witness's inputs with their coordinates, the
//! line, its in-paper segment, direction and side.
//!
//! ```sh
//! cargo run --release -p oristudio-precrease --example dump_steps -- <file> [--no-grid] [--whole] [--no-reach] [--no-sightable] [--no-dangling] [--component N]
//! ```

use std::path::PathBuf;

use oristudio_precrease::analyze;
use oristudio_precrease::clock::default_clock;
use oristudio_precrease::fixture_io::load_path;
use oristudio_precrease::planner::{GridMode, Planner, PlannerOptions};
use oristudio_precrease::predicates::Ref;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let grid = !args.iter().any(|a| a == "--no-grid");
    let reach = !args.iter().any(|a| a == "--no-reach");
    let sightable = !args.iter().any(|a| a == "--no-sightable");
    let no_dangling = args.iter().any(|a| a == "--no-dangling");
    let whole = args.iter().any(|a| a == "--whole");
    let component: usize = args
        .iter()
        .position(|a| a == "--component")
        .and_then(|i| args.get(i + 1))
        .and_then(|c| c.parse().ok())
        .unwrap_or(0);
    let is_component_value = |i: usize| i > 0 && args[i - 1] == "--component";
    let file = PathBuf::from(
        args.iter()
            .enumerate()
            .find(|(i, a)| !a.starts_with("--") && !is_component_value(*i))
            .map(|(_, a)| a)
            .expect("a file"),
    );
    let cp = load_path(&file, None).expect("load");
    let analysis = analyze(
        &cp.segments,
        &cp.colors,
        Some([-200.0, -200.0, 200.0, 200.0]),
    )
    .expect("analyze");
    let opts = PlannerOptions {
        precrease_grid: match (grid, whole) {
            (false, _) => GridMode::Off,
            (true, true) => GridMode::Whole,
            (true, false) => GridMode::WhereNeeded,
        },
        reach_references: reach,
        disallow_dangling_folds: no_dangling,
        prefer_sightable: sightable,
        clock: default_clock(),
        ..PlannerOptions::default()
    };
    let mut planner = Planner::new(&analysis.components[component], opts);
    let status = planner.plan_without_reference_finder().expect("plan");
    let seq = planner.sequence(false);
    println!(
        "status {status:?} steps {} totals {:?}",
        seq.steps.len(),
        seq.totals
    );
    let point = |id: usize| seq.points.iter().find(|p| p.id == id).map(|p| p.p);
    for s in &seq.steps {
        let w = s.chosen.and_then(|c| s.witnesses.get(c));
        let inputs: Vec<String> = w
            .map(|w| {
                w.inputs
                    .iter()
                    .map(|r| match r {
                        Ref::Edge { side, .. } => format!("edge:{side:?}"),
                        Ref::Corner { corner, .. } => format!("corner:{corner:?}"),
                        Ref::Line { id } => {
                            let l = seq.lines.iter().find(|l| l.id == *id);
                            format!("line#{id}(step {:?})", l.and_then(|l| l.step))
                        }
                        Ref::Point { id } => match point(*id) {
                            Some(p) => format!("pt#{id}({:.4},{:.4})", p[0], p[1]),
                            None => format!("pt#{id}"),
                        },
                    })
                    .collect()
            })
            .unwrap_or_default();
        let [a, b] = s.segment;
        println!(
            "{:>3} {:?}{} O{} {:?} {:?} line n=({:.4},{:.4}) d={:.5} seg ({:.3},{:.3})-({:.3},{:.3}) cp={:?} spans={} made={}{}{} marks={} align={:?} exact={} hard={}{}",
            s.id,
            s.kind,
            match s.grid.as_ref() {
                Some(g) if g.pleat => format!("[pleat {} lines, {}ths]", g.lines.len(), g.level),
                Some(g) => format!(
                    "[{}ths {} lines in {}]",
                    g.level,
                    g.lines.len(),
                    g.regions
                        .iter()
                        .map(|r| format!(
                            "{:.3}..{:.3}{}",
                            r.bounds[0].fraction,
                            r.bounds[1].fraction,
                            r.extent
                                .map(|e| format!(" along {:.3}..{:.3}", e[0], e[1]))
                                .unwrap_or_default()
                        ))
                        .collect::<Vec<_>>()
                        .join(",")
                ),
                None => String::new(),
            },
            w.map_or(0, |w| w.axiom),
            s.direction,
            s.side,
            s.line.n[0],
            s.line.n[1],
            s.line.d,
            a[0],
            a[1],
            b[0],
            b[1],
            s.cp_line_ids,
            s.cp_spans
                .iter()
                .map(|[p, q]| format!("({:.3},{:.3})-({:.3},{:.3})", p[0], p[1], q[0], q[1]))
                .collect::<Vec<_>>()
                .join(" "),
            s.made
                .iter()
                .map(|[p, q]| format!("({:.3},{:.3})-({:.3},{:.3})", p[0], p[1], q[0], q[1]))
                .collect::<Vec<_>>()
                .join(" "),
            if s.pressed_on.is_empty() {
                String::new()
            } else {
                format!(
                    " pressed_on={}",
                    s.pressed_on
                        .iter()
                        .map(|[p, q]| format!(
                            "({:.3},{:.3})-({:.3},{:.3})",
                            p[0], p[1], q[0], q[1]
                        ))
                        .collect::<Vec<_>>()
                        .join(" ")
                )
            },
            s.press
                .as_ref()
                .map(|p| {
                    format!(
                        " press at=({:.3},{:.3}) point={:?} sighted_from={:?}",
                        p.at[0], p.at[1], p.point, p.sighted_from
                    )
                })
                .unwrap_or_default(),
            s.marks_exist,
            s.alignment,
            s.exact,
            s.hard,
            if inputs.is_empty() {
                String::new()
            } else {
                format!(" <- {}", inputs.join(", "))
            },
        );
    }
    for f in &seq.findings {
        println!(
            "finding line n=({:.4},{:.4}) d={:.5} cp={:?}",
            f.line.n[0], f.line.n[1], f.line.d, f.cp_line_ids
        );
    }
}

//! For chosen steps of a plan, every construction the paper offered at that
//! moment — the one the card presents and the ones it did not — with what
//! each would have asked the folder to line up.
//!
//! ```sh
//! cargo run --release -p oristudio-precrease --example explain_steps -- <file> <step-id>[,<step-id>...] [--no-grid]
//! ```
//!
//! The plan is replayed onto a bare sheet the way `measure_ends` replays it,
//! and at each requested step the witnesses are re-derived from that paper
//! (`all_witnesses_on`) rather than read from the closure's capped list, so
//! a construction the closure never enumerated shows up here too. Each is
//! printed with its inputs as geometry, whether it was sightable as the
//! paper stood, and two numbers a folder feels: the **lever** — how far
//! apart the things being lined up are, which is what bounds the fold's
//! angular accuracy — and the **reach** — how far the crease the step makes
//! is from the place the alignment happens, which is how much that angular
//! error grows by the time it arrives at the crease.

use std::path::PathBuf;

use oristudio_precrease::analyze;
use oristudio_precrease::clock::default_clock;
use oristudio_precrease::fixture_io::load_path;
use oristudio_precrease::line::Line;
use oristudio_precrease::marks::{
    Creased, crease_runs, witness_alignment, witness_marks_exist, witness_sightable,
};
use oristudio_precrease::pinch::Extent;
use oristudio_precrease::planner::{GridMode, Planner, PlannerOptions};
use oristudio_precrease::predicates::{Ref, Witness, all_witnesses_on};
use oristudio_precrease::sequence::{Sequence, Step, StepKind};
use oristudio_precrease::state::State;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let grid = !args.iter().any(|a| a == "--no-grid");
    let positional: Vec<&String> = args.iter().filter(|a| !a.starts_with("--")).collect();
    let (Some(file), Some(ids)) = (positional.first(), positional.get(1)) else {
        eprintln!("usage: explain_steps <file> <step-id>[,<step-id>...] [--no-grid]");
        std::process::exit(2);
    };
    let wanted: Vec<u32> = ids
        .split(',')
        .filter_map(|s| s.trim().parse().ok())
        .collect();
    let cp = load_path(&PathBuf::from(file), None).expect("load");
    let analysis = analyze(
        &cp.segments,
        &cp.colors,
        Some([-200.0, -200.0, 200.0, 200.0]),
    )
    .expect("analyze");
    let opts = PlannerOptions {
        precrease_grid: if grid {
            GridMode::WhereNeeded
        } else {
            GridMode::Off
        },
        clock: default_clock(),
        ..PlannerOptions::default()
    };
    let mut planner = Planner::new(&analysis.components[0], opts);
    planner.plan_without_reference_finder().expect("plan");
    let seq = planner.sequence(false);
    let sheet = *planner.sheet().expect("sheet");
    let point_cap = PlannerOptions::default().point_cap;

    let mut state = State::new(sheet, point_cap);
    let mut creased = Creased::new(&state);
    for step in &seq.steps {
        if wanted.contains(&step.id) {
            explain(&seq, step, &state, &creased);
        }
        replay(step, &mut state, &mut creased);
    }
}

/// Put a step on the replay paper exactly as `measure_ends` does.
fn replay(step: &Step, state: &mut State, creased: &mut Creased) {
    if let Some(grid) = &step.grid {
        for line in &grid.lines {
            if let Ok(outcome) = state.add_line(line.line, step.tag) {
                if line.spans.is_empty() {
                    creased.add_whole(state, outcome.id);
                } else {
                    creased.add_spans(state, outcome.id, &line.line, &line.spans);
                }
            }
        }
        return;
    }
    if step.kind == StepKind::Press {
        if let Extent::Pinches { spans } = &step.extent
            && let Ok(outcome) = state.add_line(step.line, step.tag)
        {
            creased.add_spans(state, outcome.id, &step.line, spans);
        }
        return;
    }
    let spans = if step.made.is_empty() {
        &step.cp_spans
    } else {
        &step.made
    };
    let Ok(outcome) = state.add_line(step.line, step.tag) else {
        return;
    };
    if spans.is_empty() {
        creased.add_whole(state, outcome.id);
    } else {
        creased.add_spans(state, outcome.id, &step.line, spans);
    }
    for span in &step.pressed_on {
        let len = (span[0][0] - span[1][0]).hypot(span[0][1] - span[1][1]);
        if len <= 2.0 * oristudio_precrease::pinch::PINCH_HALF_LENGTH + 1e-9 {
            creased.add_pinch(state, outcome.id, &step.line, *span);
        } else {
            creased.add_spans(state, outcome.id, &step.line, &[*span]);
        }
    }
    creased.note_pinchable(state, outcome.id);
}

fn point_name(state: &State, r: &Ref) -> String {
    match r {
        Ref::Edge { side, .. } => format!("edge:{side:?}"),
        Ref::Corner { corner, .. } => format!("corner:{corner:?}"),
        Ref::Line { id } => {
            let l = state.line(*id);
            match state.clip(*id) {
                Some((a, b)) => format!("line({:.3},{:.3})-({:.3},{:.3})", a[0], a[1], b[0], b[1]),
                None => format!("line n=({:.3},{:.3}) d={:.3}", l.n[0], l.n[1], l.d),
            }
        }
        Ref::Point { id } => {
            let p = state.point(*id);
            let on_edge = state.points()[*id].on_boundary;
            format!(
                "pt({:.3},{:.3}){}",
                p[0],
                p[1],
                if on_edge { "@edge" } else { "" }
            )
        }
    }
}

/// The distance between the two things a witness lines up: the accuracy of
/// the fold is bounded by how far apart they are.
fn lever(state: &State, creased: &Creased, fold: &Line, w: &Witness) -> Option<f64> {
    let p = |i: usize| -> Option<[f64; 2]> {
        match w.inputs.get(i)? {
            Ref::Point { id } | Ref::Corner { id, .. } => Some(state.point(*id)),
            _ => None,
        }
    };
    let dist = |a: [f64; 2], b: [f64; 2]| (a[0] - b[0]).hypot(a[1] - b[1]);
    match w.axiom {
        1 | 2 => Some(dist(p(0)?, p(1)?)),
        // A line lined up along a line: the overlap of the creases.
        3 | 4 | 7 => witness_alignment(state, creased, fold, w),
        // A swing: the point's distance from the pivot is the lever.
        5 => Some(dist(p(0)?, p(1)?)),
        _ => None,
    }
}

/// Where the alignment happens, for the reach: the midpoint of two points,
/// the crossing of two lines, the foot of a perpendicular, the pivot.
fn anchor(state: &State, fold: &Line, w: &Witness) -> Option<[f64; 2]> {
    let p = |i: usize| -> Option<[f64; 2]> {
        match w.inputs.get(i)? {
            Ref::Point { id } | Ref::Corner { id, .. } => Some(state.point(*id)),
            _ => None,
        }
    };
    let l = |i: usize| -> Option<&Line> {
        match w.inputs.get(i)? {
            Ref::Line { id } | Ref::Edge { id, .. } => Some(state.line(*id)),
            _ => None,
        }
    };
    match w.axiom {
        1 | 2 => {
            let (a, b) = (p(0)?, p(1)?);
            Some([(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0])
        }
        3 => l(0)?.intersect(l(1)?),
        4 => l(1)?.intersect(fold),
        5 => p(0),
        7 => l(2)?.intersect(fold),
        _ => None,
    }
}

fn explain(seq: &Sequence, step: &Step, state: &State, creased: &Creased) {
    let made = if step.made.is_empty() {
        &step.cp_spans
    } else {
        &step.made
    };
    let runs = crease_runs(&step.line, made);
    let run_len: f64 = runs
        .iter()
        .map(|(a, b)| (a[0] - b[0]).hypot(a[1] - b[1]))
        .sum();
    let chosen = step.chosen.and_then(|c| step.witnesses.get(c));
    println!(
        "== step {} {:?} {:?} line n=({:.4},{:.4}) d={:.5} crease {:.3} long {}",
        step.id,
        step.kind,
        step.direction,
        step.line.n[0],
        step.line.n[1],
        step.line.d,
        run_len,
        runs.iter()
            .map(|(a, b)| format!("({:.3},{:.3})-({:.3},{:.3})", a[0], a[1], b[0], b[1]))
            .collect::<Vec<_>>()
            .join(" ")
    );
    if let Some(w) = chosen {
        let names: Vec<String> = w
            .inputs
            .iter()
            .map(|r| match r {
                Ref::Point { id } => seq
                    .points
                    .iter()
                    .find(|p| p.id == *id)
                    .map(|p| format!("pt({:.3},{:.3})", p.p[0], p.p[1]))
                    .unwrap_or_else(|| format!("pt#{id}")),
                Ref::Line { id } => seq
                    .lines
                    .iter()
                    .find(|l| l.id == *id)
                    .map(|l| format!("line#{}(step {:?})", id, l.step))
                    .unwrap_or_else(|| format!("line#{id}")),
                Ref::Edge { side, .. } => format!("edge:{side:?}"),
                Ref::Corner { corner, .. } => format!("corner:{corner:?}"),
            })
            .collect();
        println!(
            "   card: O{} [{}] moves={:?} hard={} ease={}",
            w.axiom,
            names.join(", "),
            w.who_moves,
            w.hard,
            w.ease
        );
    }
    // What the closure recorded for the line, by axiom, so a construction the
    // paper offers can be told from one the pick was ever shown.
    let mut recorded: Vec<String> = Vec::new();
    for axiom in 1..=7u8 {
        let n = step.witnesses.iter().filter(|w| w.axiom == axiom).count();
        if n > 0 {
            let edge_self = step
                .witnesses
                .iter()
                .any(|w| w.axiom == axiom && w.folds_edge_onto_itself());
            recorded.push(format!(
                "O{axiom}×{n}{}",
                if axiom == 4 && edge_self {
                    "(edge)"
                } else {
                    ""
                }
            ));
        }
    }
    println!("   recorded: {}", recorded.join(" "));
    let mut all = all_witnesses_on(state, &step.line, creased);
    all.sort_by_key(|w| w.preference());
    let crease_mid = runs
        .first()
        .map(|(a, b)| [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0]);
    for w in &all {
        let sightable = witness_sightable(state, creased, &step.line, w);
        let marks = witness_marks_exist(state, creased, w);
        let align = witness_alignment(state, creased, &step.line, w);
        let lever = lever(state, creased, &step.line, w);
        let reach = match (anchor(state, &step.line, w), crease_mid) {
            (Some(a), Some(m)) => Some((a[0] - m[0]).hypot(a[1] - m[1])),
            _ => None,
        };
        let inputs: Vec<String> = w.inputs.iter().map(|r| point_name(state, r)).collect();
        println!(
            "   {} O{} ease={} hard={} moves={:?} marks={} align={} lever={} reach={} [{}]",
            if sightable { "OK " } else { "   " },
            w.axiom,
            w.ease,
            w.hard,
            w.who_moves,
            marks,
            align
                .map(|a| format!("{a:.3}"))
                .unwrap_or_else(|| "-".into()),
            lever
                .map(|a| format!("{a:.3}"))
                .unwrap_or_else(|| "-".into()),
            reach
                .map(|a| format!("{a:.3}"))
                .unwrap_or_else(|| "-".into()),
            inputs.join(", ")
        );
    }
}

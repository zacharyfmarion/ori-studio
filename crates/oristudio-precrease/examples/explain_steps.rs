//! For chosen steps of a plan, every construction the paper offered at that
//! moment — the one the card presents and the ones it did not — judged and
//! priced the way the pick judged them.
//!
//! ```sh
//! cargo run --release -p oristudio-precrease --example explain_steps -- <file> <step-id>[,<step-id>...] [--no-grid]
//! ```
//!
//! The plan is replayed onto a bare sheet the way `measure_ends` replays it,
//! and at each requested step the ordering pass's own reasoning is laid out
//! (`order::explain`): the recorded witnesses and every construction the
//! paper offers, each with the presses sighting it would take and its
//! judgement — practical (R0), visible (R1), precise (R2: the **lever** the
//! alignment has and the **error** it grows to by the crease), a crossing to
//! sight from (R7), local to the crease (R3, R4), sighted from marks already
//! there (`m`), corner to corner (`C`). The pick is marked `card`,
//! its mirror image `also`; when the pick made here differs from the one the
//! plan presented, both are shown, since the replay's paper and the ordering
//! pass's can differ in what was pinched along the way.

use std::path::PathBuf;

use oristudio_precrease::analyze;
use oristudio_precrease::clock::default_clock;
use oristudio_precrease::direction::Direction;
use oristudio_precrease::fixture_io::load_path;
use oristudio_precrease::judge::{DirectionOfLine, Judgement, Vouch};
use oristudio_precrease::marks::{Creased, crease_runs};
use oristudio_precrease::order::{Explained, explain};
use oristudio_precrease::pinch::{Extent, PINCH_HALF_LENGTH};
use oristudio_precrease::planner::{GridMode, Planner, PlannerOptions};
use oristudio_precrease::predicates::{Ref, Witness};
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
    let mut replay = Replay::default();
    for step in &seq.steps {
        if wanted.contains(&step.id) {
            explain_step(&seq, step, &state, &creased, &replay);
        }
        // What the presented alignment vouches for, as the plan judged it.
        let vouch = step
            .chosen
            .and_then(|c| step.witnesses.get(c))
            .and_then(|w| seq.witness_in(&state, w))
            .map_or(Vouch::everything(), |w| {
                Vouch::of(&state, &creased, &step.line, &w)
            });
        replay.put(step, &mut state, &mut creased, vouch);
    }
}

/// What the replay knows beyond the paper: the direction each replayed line
/// was made in (by replay line id), for R0's exception.
#[derive(Default)]
struct Replay {
    directions: Vec<Option<Direction>>,
}

impl Replay {
    fn note(&mut self, id: usize, d: Direction) {
        if self.directions.len() <= id {
            self.directions.resize(id + 1, None);
        }
        self.directions[id] = Some(d);
    }

    fn direction_of(&self, id: usize) -> Option<Direction> {
        self.directions.get(id).copied().flatten()
    }

    /// Put a step on the replay paper exactly as `measure_ends` does.
    fn put(&mut self, step: &Step, state: &mut State, creased: &mut Creased, vouch: Vouch) {
        if let Some(grid) = &step.grid {
            for line in &grid.lines {
                if let Ok(outcome) = state.add_line(line.line, step.tag) {
                    if line.spans.is_empty() {
                        creased.add_whole(state, outcome.id);
                    } else {
                        creased.add_spans(state, outcome.id, &line.line, &line.spans);
                    }
                    self.note(outcome.id, line.direction);
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
            if len <= 2.0 * PINCH_HALF_LENGTH + 1e-9 {
                creased.add_pinch(state, outcome.id, &step.line, *span);
            } else {
                creased.add_spans(state, outcome.id, &step.line, &[*span]);
            }
        }
        creased.note_pinchable(state, outcome.id, |span| vouch.covers(span));
        self.note(outcome.id, step.direction);
    }
}

fn ref_name(state: &State, creased: &Creased, r: &Ref) -> String {
    match r {
        Ref::Edge { side, .. } => format!("edge:{side:?}"),
        Ref::Corner { corner, .. } => format!("corner:{corner:?}"),
        Ref::Line { id } => {
            let l = state.line(*id);
            let runs: Vec<String> = creased
                .runs_of(*id)
                .map(|runs| {
                    runs.iter()
                        .map(|&(u, v)| {
                            let (a, b) = (l.point_at(u), l.point_at(v));
                            format!("({:.3},{:.3})-({:.3},{:.3})", a[0], a[1], b[0], b[1])
                        })
                        .collect()
                })
                .unwrap_or_default();
            format!("line[{}]", runs.join(" "))
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

fn flags(j: &Judgement) -> String {
    [
        if j.practical { 'P' } else { 'x' },
        if j.visible { 'v' } else { '.' },
        if j.precise { 'p' } else { '.' },
        if j.crossings { 'c' } else { '.' },
        if j.local() { 'L' } else { '.' },
        if j.marks_real { 'm' } else { '.' },
        if j.overlong { 'O' } else { '.' },
        if j.skinny { 's' } else { '.' },
        if j.corner_to_corner { 'C' } else { '.' },
    ]
    .iter()
    .collect()
}

fn num(x: Option<f64>, digits: usize) -> String {
    x.map_or_else(|| "-".to_string(), |v| format!("{v:.digits$}"))
}

fn explain_step(seq: &Sequence, step: &Step, state: &State, creased: &Creased, replay: &Replay) {
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
    println!(
        "== step {} {:?} {:?} {:?} line n=({:.4},{:.4}) d={:.5} crease {:.3} long {}{}",
        step.id,
        step.kind,
        step.direction,
        step.side,
        step.line.n[0],
        step.line.n[1],
        step.line.d,
        run_len,
        runs.iter()
            .map(|(a, b)| format!("({:.3},{:.3})-({:.3},{:.3})", a[0], a[1], b[0], b[1]))
            .collect::<Vec<_>>()
            .join(" "),
        if step.impractical { " IMPRACTICAL" } else { "" }
    );
    let recorded: Vec<Witness> = step
        .witnesses
        .iter()
        .filter_map(|w| seq.witness_in(state, w))
        .collect();
    if recorded.len() < step.witnesses.len() {
        println!(
            "   ({} of {} recorded witnesses name something not on the replay paper yet)",
            step.witnesses.len() - recorded.len(),
            step.witnesses.len()
        );
    }
    let presented = step
        .chosen
        .and_then(|c| step.witnesses.get(c))
        .and_then(|w| seq.witness_in(state, w));
    let direction_of_line: DirectionOfLine<'_> = &|id: usize| replay.direction_of(id);
    let mut rows: Vec<Explained> = explain(
        state,
        creased,
        &step.line,
        usize::MAX,
        &step.cp_spans,
        made,
        step.direction,
        direction_of_line,
        &recorded,
    );
    let same = |a: &Witness, b: &Witness| a.axiom == b.axiom && a.inputs == b.inputs;
    let pick = rows.iter().find(|r| r.chosen).map(|r| r.witness.clone());
    match (&presented, &pick) {
        (Some(p), Some(c)) if !same(p, c) => println!(
            "   NOTE: the plan presented O{} [{}], the pick here is O{} [{}] — the papers differ",
            p.axiom,
            p.inputs
                .iter()
                .map(|r| ref_name(state, creased, r))
                .collect::<Vec<_>>()
                .join(", "),
            c.axiom,
            c.inputs
                .iter()
                .map(|r| ref_name(state, creased, r))
                .collect::<Vec<_>>()
                .join(", "),
        ),
        (Some(_), None) => {
            println!("   NOTE: nothing here can be folded; the plan's card is flagged")
        }
        (None, _) => println!("   (the plan presented no witness)"),
        _ => {}
    }
    if let Some(also) = &step.also {
        println!(
            "   also: O{} [{}]",
            also.axiom,
            seq.witness_in(state, also)
                .map(|a| a
                    .inputs
                    .iter()
                    .map(|r| ref_name(state, creased, r))
                    .collect::<Vec<_>>()
                    .join(", "))
                .unwrap_or_else(|| "?".into())
        );
    }
    // The pick first, then what could be folded now, then by what the pick
    // would ask next: presses, visibility, precision, ease, error.
    rows.sort_by(|a, b| {
        b.chosen.cmp(&a.chosen).then_with(|| {
            let k = |r: &Explained| {
                (
                    r.cost.map_or(usize::MAX, |c| c),
                    !r.judgement.practical,
                    !r.judgement.visible,
                    !r.judgement.precise,
                    !r.judgement.crossings,
                    !r.judgement.local(),
                    r.judgement.ease,
                    r.judgement.error.map_or(0, |e| (e * 1e3) as u64),
                )
            };
            k(a).cmp(&k(b))
        })
    });
    for r in &rows {
        let w = &r.witness;
        let j = &r.judgement;
        let inputs: Vec<String> = w
            .inputs
            .iter()
            .map(|x| ref_name(state, creased, x))
            .collect();
        println!(
            "   {}{} O{} ease={} [{}] cost={} lever={} reach={} err={} off={} moves={:?} {}{}",
            if r.chosen { "card " } else { "     " },
            match r.cost {
                Some(0) => "OK ",
                Some(_) => "   ",
                None => "-- ",
            },
            w.axiom,
            j.ease,
            flags(j),
            r.cost.map_or_else(|| "none".to_string(), |c| c.to_string()),
            num(j.lever, 3),
            num(j.reach, 3),
            num(j.error, 2),
            num(j.mark_offset, 3),
            w.who_moves,
            inputs.join(", "),
            if r.also { " (also)" } else { "" }
        );
    }
}

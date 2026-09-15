//! Measure the two closure orders against each other on a corpus.
//!
//! ```sh
//! cargo run --release -p oristudio-precrease --example measure_ends -- [--no-grid] <dir-or-file>...
//! ```
//!
//! Per design and in total: steps, turn-overs, steps sighted from a mark that
//! is not on the paper, crease ends with no landmark, and steps that crease
//! one line in pieces. Run twice — with the endpoint preference on and off —
//! and print both, because a reorder cannot be simulated after the fact:
//! changing what folds first changes what is constructible next, so the two
//! plans are different plans. `--no-grid` plans without the precrease grid,
//! to measure the grid the same way; `--no-reach` plans with every CP step
//! creasing exactly the pattern's pieces rather than one run from reference
//! to reference, and `--no-sightable` without the closure folding first what
//! the paper can sight, `--no-defer` with every line folded in the first
//! round it can be rather than waiting for a nearer anchor, and
//! `--no-dangling` with every crease carried to a
//! reference at both ends, to measure those rules the same way. `-v` names
//! every lost end, every step made in pieces and every press — with what the
//! press was for: a fold that had a free witness, a mark the pattern makes
//! later anyway, or neither — with the preference on, to be read by hand.
//!
//! What is replayed is what each step *made*: a CP step's `made` run (its
//! pattern spans when the plan did not reach) and whatever it pressed on, a
//! press's pinch, a grid line's spans. The reach length is the crease those
//! runs hold past the pattern's own — the cost of the rule, from
//! `implementation-plans/precrease-reach-references.md`.

use std::path::{Path, PathBuf};

use oristudio_precrease::analyze;
use oristudio_precrease::direction::{Direction, Side};
use oristudio_precrease::fixture_io::load_path;
use oristudio_precrease::judge::judge;
use oristudio_precrease::marks::{
    Creased, crease_runs, end_is_found, point_mark_exists, witness_sightable,
};
use oristudio_precrease::pinch::{Extent, PINCH_HALF_LENGTH};
use oristudio_precrease::planner::{GridMode, Planner, PlannerOptions};
use oristudio_precrease::predicates::all_witnesses_on;
use oristudio_precrease::sequence::{Sequence, StepKind};
use oristudio_precrease::sheet::Sheet;
use oristudio_precrease::state::State;

const ORIEDITA_PAPER: [f64; 4] = [-200.0, -200.0, 200.0, 200.0];

#[derive(Default, Clone, Copy, PartialEq, Debug)]
struct Tally {
    steps: usize,
    rounds: usize,
    turn_overs: usize,
    phantom: usize,
    ends: usize,
    lost_ends: usize,
    /// CP steps whose crease on their line is more than one run: a fold
    /// the folder is asked to make in pieces, with paper left blank between.
    pieces: usize,
    /// The blank stretches between those runs, in sheet-sides.
    gap_len: f64,
    /// Crease the CP steps make past the pattern's own, in sheet-sides: the
    /// blank between a line's pieces joined, and each end carried out to a
    /// reference — the reach rule's cost.
    reach_len: f64,
    /// The most one step makes past the pattern, and which step.
    longest_reach: (f64, u32),
    reversed: usize,
    /// Press steps: extra crease made so a later step can be sighted.
    presses: usize,
    /// Of the presses: ones before a step that had another witness sightable
    /// on the paper as it stood — a press the pick could have avoided.
    presses_with_free_witness: usize,
    /// Of the presses: ones for a mark the pattern's own creases do make,
    /// later in the plan — a press an order could have avoided.
    presses_made_later: usize,
    /// Their total length, in sheet-sides.
    press_len: f64,
    /// Marks pinched while the crease they are on was made — a pinch on a
    /// step's `pressed_on` rather than a press step of its own.
    pinched_while_folding: usize,
    /// The picks, judged on the replay paper as `order::pick_witness` judged
    /// them (`implementation-plans/precrease-legible-picks.md`): CP steps
    /// whose card the folder cannot watch (R1), cannot make precisely (R2),
    /// makes through the paper (R0), makes at the crease itself — a
    /// bisection with its vertex there, a short crease joined between its
    /// own marks (R3, R4), and shows twice, mirrored (R8). `judged` is how many CP steps the
    /// replay could judge at all: a card naming a crease the replay has not
    /// made yet is skipped and counted in `unjudged`.
    judged: usize,
    unjudged: usize,
    invisible: usize,
    imprecise: usize,
    impractical: usize,
    bisections_at_crease: usize,
    own_ends: usize,
    mirrored: usize,
    /// O1 picks joining marks far beyond the crease — presented only when
    /// nothing else was on offer.
    overlong: usize,
    /// The error at the crease summed over the judged picks that have one,
    /// and how many that is, for the mean.
    error_sum: f64,
    error_n: usize,
}

impl Tally {
    fn add(&mut self, o: Tally) {
        self.steps += o.steps;
        self.rounds += o.rounds;
        self.turn_overs += o.turn_overs;
        self.phantom += o.phantom;
        self.ends += o.ends;
        self.lost_ends += o.lost_ends;
        self.pieces += o.pieces;
        self.gap_len += o.gap_len;
        self.reach_len += o.reach_len;
        if o.longest_reach.0 > self.longest_reach.0 {
            self.longest_reach = o.longest_reach;
        }
        self.reversed += o.reversed;
        self.presses += o.presses;
        self.presses_with_free_witness += o.presses_with_free_witness;
        self.presses_made_later += o.presses_made_later;
        self.press_len += o.press_len;
        self.pinched_while_folding += o.pinched_while_folding;
        self.judged += o.judged;
        self.unjudged += o.unjudged;
        self.invisible += o.invisible;
        self.imprecise += o.imprecise;
        self.impractical += o.impractical;
        self.bisections_at_crease += o.bisections_at_crease;
        self.own_ends += o.own_ends;
        self.mirrored += o.mirrored;
        self.overlong += o.overlong;
        self.error_sum += o.error_sum;
        self.error_n += o.error_n;
    }

    fn picks_line(&self) -> String {
        format!(
            "picks {:5} judged ({:4} not yet on the replay paper)  invisible {:4}  imprecise {:4}  impractical {:4}  bisections at the crease {:4}  own ends {:4}  mirrored {:4}  overlong {:4}  mean error {:.2}",
            self.judged,
            self.unjudged,
            self.invisible,
            self.imprecise,
            self.impractical,
            self.bisections_at_crease,
            self.own_ends,
            self.mirrored,
            self.overlong,
            self.error_sum / self.error_n.max(1) as f64
        )
    }
}

/// Replay a sequence onto a bare sheet, counting the ends the folder cannot
/// find at the moment the step is performed. With `verbose`, say which.
fn measure(seq: &Sequence, sheet: Sheet, point_cap: usize, verbose: bool) -> Tally {
    let mut state = State::new(sheet, point_cap);
    let mut creased = Creased::new(&state);
    // The direction each replayed line was made in, by replay line id, for
    // R0's exception.
    let mut directions: Vec<Option<Direction>> = Vec::new();
    let note = |directions: &mut Vec<Option<Direction>>, id: usize, d: Direction| {
        if directions.len() <= id {
            directions.resize(id + 1, None);
        }
        directions[id] = Some(d);
    };
    // The paper without its presses, for asking afterwards which marks the
    // pattern's own creases make anyway: a press for one of those is a
    // press an order could have avoided.
    let mut unpressed = Creased::new(&state);
    // (step id, the mark or spot the press is for, whether the step it
    // serves had a sightable witness without it).
    let mut presses: Vec<(u32, [f64; 2], bool)> = Vec::new();
    let mut t = Tally {
        steps: seq.steps.len(),
        turn_overs: usize::from(seq.steps.first().is_some_and(|s| s.side == Side::Back))
            + seq
                .steps
                .windows(2)
                .filter(|w| w[0].side != w[1].side)
                .count(),
        phantom: seq.steps.iter().filter(|s| !s.marks_exist).count(),
        reversed: seq
            .steps
            .iter()
            .filter(|s| s.direction_share > 0.0 && s.direction_share < 0.5)
            .count(),
        ..Tally::default()
    };
    for (k, step) in seq.steps.iter().enumerate() {
        // A grid step creases a pleat's lines edge to edge and a band's as
        // far along as its spans say: nothing to find, all of it on the paper.
        if let Some(grid) = &step.grid {
            for line in &grid.lines {
                if let Ok(outcome) = state.add_line(line.line, step.tag) {
                    if line.spans.is_empty() {
                        creased.add_whole(&state, outcome.id);
                        unpressed.add_whole(&state, outcome.id);
                    } else {
                        creased.add_spans(&state, outcome.id, &line.line, &line.spans);
                        unpressed.add_spans(&state, outcome.id, &line.line, &line.spans);
                    }
                    note(&mut directions, outcome.id, line.direction);
                }
            }
            continue;
        }
        // A press is a pinch on a line already made: it goes on the paper, but
        // it is not a crease with ends a folder must find — it is pressed *at*
        // a mark. Its empty `cp_spans` must not read as "creased whole".
        if step.kind == StepKind::Press {
            let Extent::Pinches { spans } = &step.extent else {
                continue;
            };
            t.presses += 1;
            t.press_len += spans
                .iter()
                .map(|[a, b]| (a[0] - b[0]).hypot(a[1] - b[1]))
                .sum::<f64>();
            // The step this press is for is the next fold; ask whether it
            // had a witness the paper could sight as it stood, press or no.
            let served = seq.steps[k + 1..]
                .iter()
                .find(|s| s.kind != StepKind::Press);
            let free = served.is_some_and(|s| {
                all_witnesses_on(&state, &s.line, &creased)
                    .iter()
                    .any(|w| witness_sightable(&state, &creased, &s.line, w))
            });
            if let Some(press) = &step.press {
                presses.push((step.id, press.at, free));
            }
            if let Ok(outcome) = state.add_line(step.line, step.tag) {
                creased.add_spans(&state, outcome.id, &step.line, spans);
            }
            continue;
        }
        // The crease the step made: one run from reference to reference, or
        // the pattern's pieces when the plan did not reach for them.
        let spans = if step.made.is_empty() {
            &step.cp_spans
        } else {
            &step.made
        };
        // Per end of a merged run, not per segment: a CP splits a line at every
        // change of assignment, and those joints are not ends.
        let runs = crease_runs(&step.line, spans);
        let length_of = |runs: &[([f64; 2], [f64; 2])]| -> f64 {
            runs.iter()
                .map(|(a, b)| (a[0] - b[0]).hypot(a[1] - b[1]))
                .sum()
        };
        let past =
            (length_of(&runs) - length_of(&crease_runs(&step.line, &step.cp_spans))).max(0.0);
        t.reach_len += past;
        if past > t.longest_reach.0 {
            t.longest_reach = (past, step.id);
        }
        if verbose && past > 1e-9 {
            println!("  step {:>3} creases {:.3} past the pattern", step.id, past);
        }
        if runs.len() > 1 {
            t.pieces += 1;
            let gaps: f64 = runs
                .windows(2)
                .map(|w| (w[0].1[0] - w[1].0[0]).hypot(w[0].1[1] - w[1].0[1]))
                .sum();
            t.gap_len += gaps;
            if verbose {
                println!(
                    "  step {:>3} in {} pieces, {:.3} blank between them",
                    step.id,
                    runs.len(),
                    gaps
                );
            }
        }
        // The pick, judged as the ordering pass judged it — on the paper as
        // it stands, before the step is made.
        if step.kind == StepKind::Cp {
            if step.also.is_some() {
                t.mirrored += 1;
            }
            if step.impractical {
                t.impractical += 1;
            }
            let chosen = step
                .chosen
                .and_then(|c| step.witnesses.get(c))
                .and_then(|w| seq.witness_in(&state, w));
            match chosen {
                Some(w) => {
                    t.judged += 1;
                    let direction_of_line = |id: usize| directions.get(id).copied().flatten();
                    let j = judge(
                        &state,
                        &creased,
                        &step.line,
                        spans,
                        &step.cp_spans,
                        step.direction,
                        &direction_of_line,
                        &w,
                    );
                    if !j.visible {
                        t.invisible += 1;
                    }
                    if !j.precise {
                        t.imprecise += 1;
                    }
                    if j.bisection_at_crease {
                        t.bisections_at_crease += 1;
                    }
                    if j.own_ends {
                        t.own_ends += 1;
                    }
                    // Judged against the pattern's own crease rather than
                    // `made`, which already runs from mark to mark for an
                    // O1 and so never reads as overlong here.
                    if w.axiom == 1 && overlong_for_pattern(&step.line, &step.cp_spans, &state, &w)
                    {
                        t.overlong += 1;
                    }
                    if let Some(e) = j.error.filter(|e| e.is_finite()) {
                        t.error_sum += e;
                        t.error_n += 1;
                    }
                    if verbose && (!j.visible || !j.precise || step.impractical) {
                        println!(
                            "  step {:>3} O{} {}{}{}lever {} error {}",
                            step.id,
                            w.axiom,
                            if step.impractical {
                                "impractical, "
                            } else {
                                ""
                            },
                            if j.visible { "" } else { "invisible, " },
                            if j.precise { "" } else { "imprecise, " },
                            j.lever.map_or("-".to_string(), |l| format!("{l:.3}")),
                            j.error.map_or("-".to_string(), |e| format!("{e:.2}")),
                        );
                    }
                }
                None if step.chosen.is_some() => t.unjudged += 1,
                None => {}
            }
        }
        let ends: Vec<[f64; 2]> = runs.into_iter().flat_map(|(a, b)| [a, b]).collect();
        t.ends += ends.len();
        for end in &ends {
            if end_is_found(&state, &creased, &step.line, *end) {
                continue;
            }
            t.lost_ends += 1;
            if verbose {
                println!(
                    "  step {:>3} end ({:.3},{:.3}) is nowhere to be found",
                    step.id, end[0], end[1]
                );
            }
        }
        let Ok(outcome) = state.add_line(step.line, step.tag) else {
            continue;
        };
        note(&mut directions, outcome.id, step.direction);
        if spans.is_empty() {
            creased.add_whole(&state, outcome.id);
            unpressed.add_whole(&state, outcome.id);
        } else {
            creased.add_spans(&state, outcome.id, &step.line, spans);
            unpressed.add_spans(&state, outcome.id, &step.line, spans);
        }
        // What the step pressed on past the pattern is crease on the paper
        // too, and a later end may be found on it. A span no longer than a
        // pinch is a pinch — a mark made while folding, not crease.
        for span in &step.pressed_on {
            let len = (span[0][0] - span[1][0]).hypot(span[0][1] - span[1][1]);
            if len <= 2.0 * PINCH_HALF_LENGTH + 1e-9 {
                t.pinched_while_folding += 1;
                creased.add_pinch(&state, outcome.id, &step.line, *span);
            } else {
                creased.add_spans(&state, outcome.id, &step.line, &[*span]);
            }
        }
        creased.note_pinchable(&state, outcome.id);
    }
    for (id, at, free) in presses {
        let made_later = state
            .find_point(at)
            .is_some_and(|p| point_mark_exists(&state, &unpressed, p));
        if free {
            t.presses_with_free_witness += 1;
        } else if made_later {
            t.presses_made_later += 1;
        }
        if verbose {
            println!(
                "  step {:>3} press at ({:.3},{:.3}): {}",
                id,
                at[0],
                at[1],
                if free {
                    "a free witness existed"
                } else if made_later {
                    "the mark is made later by the pattern"
                } else {
                    "necessary: no free witness, no crease ever reaches it"
                }
            );
        }
    }
    t
}

/// Whether an O1's two marks lie beyond the pattern's own crease on `line`
/// by more than that crease's length (and more than
/// [`oristudio_precrease::judge::CONNECT_CREASE`]) — the pick's
/// `Judgement::overlong`, read off the pattern.
fn overlong_for_pattern(
    line: &oristudio_precrease::line::Line,
    spans: &[[[f64; 2]; 2]],
    state: &State,
    w: &oristudio_precrease::predicates::Witness,
) -> bool {
    let marks: Vec<f64> = w
        .inputs
        .iter()
        .filter_map(|r| match r {
            oristudio_precrease::predicates::Ref::Point { id }
            | oristudio_precrease::predicates::Ref::Corner { id, .. } => {
                Some(line.parameter_of(state.point(*id)))
            }
            _ => None,
        })
        .collect();
    let [p, q] = marks.as_slice() else {
        return false;
    };
    let (lo, hi) = (p.min(*q), p.max(*q));
    let runs: Vec<(f64, f64)> = crease_runs(line, spans)
        .into_iter()
        .map(|(a, b)| {
            let (u, v) = (line.parameter_of(a), line.parameter_of(b));
            (u.min(v), u.max(v))
        })
        .collect();
    if runs.is_empty() {
        return false;
    }
    let length: f64 = runs.iter().map(|(u, v)| v - u).sum();
    let covered: f64 = runs
        .iter()
        .map(|(u, v)| (v.min(hi) - u.max(lo)).max(0.0))
        .sum();
    (hi - lo) - covered > length.max(oristudio_precrease::judge::CONNECT_CREASE)
}

#[allow(clippy::too_many_arguments)]
fn plan_file(
    path: &Path,
    prefer: bool,
    grid: bool,
    reach: bool,
    sightable: bool,
    no_dangling: bool,
    no_defer: bool,
    verbose: bool,
) -> Option<Tally> {
    let cp = load_path(path, None).ok()?;
    let analysis = analyze(&cp.segments, &cp.colors, Some(ORIEDITA_PAPER)).ok()?;
    let mut total = Tally::default();
    for component in &analysis.components {
        // The product's budgets, not unbounded ones: the stuck search now
        // runs on off-lattice components too, and unbounded it can search a
        // hand-drawn design for an hour. The browser gives it four seconds
        // an event and thirty in all, and a measurement at any other setting
        // is of a planner nobody ships. A real clock, therefore — a frozen
        // one never expires.
        let opts = PlannerOptions {
            prefer_findable_ends: prefer,
            precrease_grid: if grid {
                GridMode::WhereNeeded
            } else {
                GridMode::Off
            },
            reach_references: reach,
            allow_dangling_folds: !no_dangling,
            defer_far_anchors: !no_defer,
            prefer_sightable: sightable,
            ..PlannerOptions::default()
        };
        let point_cap = opts.point_cap;
        let mut planner = Planner::new(component, opts);
        if planner.plan_without_reference_finder().is_err() {
            return None;
        }
        let sheet = *planner.sheet()?;
        let mut t = measure(&planner.sequence(false), sheet, point_cap, verbose);
        t.rounds = planner
            .closure_ref()
            .map_or(0, |c| c.stats().rounds as usize);
        total.add(t);
    }
    (total.steps > 0).then_some(total)
}

/// Every crease pattern under the given paths, recursively. A corpus design is
/// a directory holding `truth.fold` beside its source image, so a bare
/// directory means "everything under here".
fn collect(path: &Path, out: &mut Vec<PathBuf>) {
    if path.is_dir() {
        let Ok(entries) = std::fs::read_dir(path) else {
            return;
        };
        let mut kids: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
        kids.sort();
        for kid in kids {
            collect(&kid, out);
        }
    } else if matches!(
        path.extension().and_then(|e| e.to_str()),
        Some("fold" | "cp" | "opx")
    ) {
        out.push(path.to_path_buf());
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let grid = !args.iter().any(|a| a == "--no-grid");
    let reach = !args.iter().any(|a| a == "--no-reach");
    let sightable = !args.iter().any(|a| a == "--no-sightable");
    let no_dangling = args.iter().any(|a| a == "--no-dangling");
    let no_defer = args.iter().any(|a| a == "--no-defer");
    let verbose = args.iter().any(|a| a == "-v");
    let flags = [
        "--no-grid",
        "--no-reach",
        "--no-sightable",
        "--no-dangling",
        "--no-defer",
        "-v",
    ];
    let mut paths = Vec::new();
    for a in args.iter().filter(|a| !flags.contains(&a.as_str())) {
        collect(Path::new(a), &mut paths);
    }
    // One plan per design: the corpus keeps a detection and a topology beside
    // the truth, and they are the same pattern read three ways.
    paths.retain(|p| {
        !matches!(
            p.file_stem().and_then(|s| s.to_str()),
            Some("detected" | "topology")
        )
    });
    let mut on = Tally::default();
    let mut off = Tally::default();
    let mut planned = 0;
    // better / worse, per design, for each measure.
    let mut score = [[0usize; 2]; 3];
    // Say what these numbers are, in the output, every time. They are measured
    // through `plan_without_reference_finder`, which is not the driver Ori
    // Studio ships: the browser's loop asks ReferenceFinder when the stuck
    // search fails, and this cannot. So a plan here gives up one step earlier
    // than a real one, and every count below is a ceiling on defects rather
    // than a measurement of them. Quoting one as the product's behaviour has
    // already happened once.
    println!(
        "NOTE: measured WITHOUT the ReferenceFinder fallback \
         (`Planner::plan_without_reference_finder`), which the shipping driver \
         has and this does not. Defect counts below are CEILINGS."
    );
    println!(
        "design\tsteps\tphantom on/off\tturns on/off\tlost ends on/off\tpieces on/off\tblank+reach (most @step)"
    );
    for path in &paths {
        if verbose {
            println!("{}", path.display());
        }
        let (a, b) = (
            plan_file(
                path,
                true,
                grid,
                reach,
                sightable,
                no_dangling,
                no_defer,
                verbose,
            ),
            plan_file(
                path,
                false,
                grid,
                reach,
                sightable,
                no_dangling,
                no_defer,
                false,
            ),
        );
        let (Some(a), Some(b)) = (a, b) else {
            println!("{}\tdid not plan", path.display());
            continue;
        };
        planned += 1;
        // A corpus design is a directory holding truth.fold, so the directory
        // is the design's name; a loose .cp or .fold is its own.
        let name = if path.file_stem().is_some_and(|s| s == "truth") {
            path.parent().and_then(|d| d.file_name())
        } else {
            path.file_name()
        }
        .unwrap_or_default()
        .to_string_lossy();
        println!(
            "{name}\t{}\t{}/{}\t{}/{}\t{}/{}\t{}/{}\t{:.2}+{:.2} ({:.2} @{})",
            a.steps,
            a.phantom,
            b.phantom,
            a.turn_overs,
            b.turn_overs,
            a.lost_ends,
            b.lost_ends,
            a.pieces,
            b.pieces,
            a.gap_len,
            a.reach_len,
            a.longest_reach.0,
            a.longest_reach.1
        );
        println!("  {}", a.picks_line());
        for (k, (x, y)) in [
            (a.phantom, b.phantom),
            (a.turn_overs, b.turn_overs),
            (a.lost_ends, b.lost_ends),
        ]
        .into_iter()
        .enumerate()
        {
            if x < y {
                score[k][0] += 1;
            } else if x > y {
                score[k][1] += 1;
            }
        }
        on.add(a);
        off.add(b);
    }
    println!("\n{planned} designs planned of {}", paths.len());
    for (label, t) in [("preference on ", on), ("preference off", off)] {
        println!(
            "{label}  steps {:5}  rounds {:5}  phantom {:4}  presses {:4} ({:.1} sheet-sides; {} with a free witness, {} for a mark made later, {} necessary)  pinched while folding {:4}  turn-overs {:4}  lost ends {:5} / {:5} ({:.1}%)  in pieces {:4} ({:.1} sheet-sides blank)  reach {:.1} sheet-sides (most {:.2})  reversed {:4}",
            t.steps,
            t.rounds,
            t.phantom,
            t.presses,
            t.press_len,
            t.presses_with_free_witness,
            t.presses_made_later,
            t.presses - t.presses_with_free_witness - t.presses_made_later,
            t.pinched_while_folding,
            t.turn_overs,
            t.lost_ends,
            t.ends,
            100.0 * t.lost_ends as f64 / t.ends.max(1) as f64,
            t.pieces,
            t.gap_len,
            t.reach_len,
            t.longest_reach.0,
            t.reversed
        );
        println!("{label}  {}", t.picks_line());
    }
    for (label, [better, worse]) in ["phantom", "turn-overs", "lost ends"]
        .into_iter()
        .zip(score)
    {
        println!("{label}: better on {better} designs, worse on {worse}");
    }
}

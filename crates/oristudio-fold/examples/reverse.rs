//! Native timings for the reverse fold (plan Phase 9), bucketed by the
//! parent's face count like the reverse spike's `perf.mjs` (research §5.2:
//! its reverse op, Flat-Folder's arrangement and completion took 2.9, 11 and
//! 10 ms at 33–64 faces, 15.6, 78 and 518 ms at 129–256).
//!
//! ```sh
//! cargo run -p oristudio-fold --release --example reverse
//! ```
//!
//! First the crane (`tests/ida`, plan D14: "real models are the primary
//! target"), each of its sixteen steps timed as the median of 15 runs: its
//! reverse folds land at 4 to 52 faces. Then two sets of random states, each
//! with inside reverse folds drawn as the spike's campaign draws them
//! (`random::reverse_fold`: a folded crease as the spine, ℓ across it), the
//! first opening of each flap taken:
//!
//! - **campaign**: the spike's own starting states (`random::folded`, one to
//!   four plain folds);
//! - **stacks**: `perf`'s states, all-layer folds along random lines through
//!   the middle of the model from the flat square until it has more than 256
//!   faces: deep stacks, with tips of half the model.
//!
//! Columns: `analyse` is the tip and its openings (`State::analyse_reverse`);
//! the rest the whole operation through the compound pipeline — score, gate,
//! carry, seed, completion around the moved faces, letters and
//! `State::make` — for the folds that land, those that leave a choice of
//! orders, and those refused (no order, with the refusal's fixes tried).

#[path = "../tests/beloch/mod.rs"]
mod beloch;
#[path = "../tests/ida/mod.rs"]
mod ida;

use std::hint::black_box;
use std::time::Instant;

use oristudio_fold::random::{self, Rng};
use oristudio_fold::{
    Direction, PlainFold, ReverseChoices, ReverseOutcome, Sheet, Side, StartSide, State, VertexId,
};
use oristudio_geometry::Line;

#[derive(Default)]
struct Bucket {
    analyse: Vec<f64>,
    landed: Vec<f64>,
    choice: Vec<f64>,
    refused: Vec<f64>,
    tips: Vec<usize>,
}

fn ms(t: Instant) -> f64 {
    t.elapsed().as_secs_f64() * 1e3
}

fn mean(v: &[f64]) -> f64 {
    v.iter().sum::<f64>() / v.len().max(1) as f64
}

fn p95(v: &[f64]) -> f64 {
    let mut s = v.to_vec();
    s.sort_by(f64::total_cmp);
    s.get(((s.len() as f64 * 0.95).ceil() as usize).saturating_sub(1))
        .copied()
        .unwrap_or(0.0)
}

/// An all-layer fold along a random line through the middle of the model.
fn middle_fold(state: &State, rng: &mut Rng) -> Option<PlainFold> {
    let images: Vec<[f64; 2]> = (0..state.vertices().len())
        .filter_map(|v| state.vertex_image(VertexId(v as u32)))
        .collect();
    let (x0, y0, x1, y1) = images.iter().fold(
        (
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ),
        |b, p| (b.0.min(p[0]), b.1.min(p[1]), b.2.max(p[0]), b.3.max(p[1])),
    );
    let c = [
        x0 + (0.3 + 0.4 * rng.next_f64()) * (x1 - x0),
        y0 + (0.3 + 0.4 * rng.next_f64()) * (y1 - y0),
    ];
    let a = rng.next_f64() * std::f64::consts::PI;
    let line = Line::from_point_direction(c, [a.cos(), a.sin()])?;
    let side = if rng.chance(0.5) {
        Side::Positive
    } else {
        Side::Negative
    };
    let direction = if rng.chance(0.5) {
        Direction::Valley
    } else {
        Direction::Mountain
    };
    Some(PlainFold::new(line, side, direction))
}

const RANGES: [(usize, usize); 5] = [(1, 8), (9, 32), (33, 64), (65, 128), (129, 256)];

/// Time `draws` reverse folds of `state` into its face count's bucket.
fn time(state: &State, rng: &mut Rng, draws: usize, buckets: &mut [Bucket]) {
    let faces = state.faces().len();
    let Some(k) = RANGES
        .iter()
        .position(|&(lo, hi)| (lo..=hi).contains(&faces))
    else {
        return;
    };
    for _ in 0..draws {
        let Some(reverse) = random::reverse_fold(state, rng, 0.2) else {
            continue;
        };
        let t = Instant::now();
        let Ok(analysis) = state.analyse_reverse(&reverse) else {
            continue;
        };
        let analyse = ms(t);
        if analysis.flaps.iter().any(|f| f.openings.is_empty()) {
            continue;
        }
        let choices = ReverseChoices {
            openings: analysis
                .flaps
                .iter()
                .filter(|f| f.openings.len() > 1)
                .map(|f| f.openings[0].stored.clone())
                .collect(),
            order: None,
        };
        let b = &mut buckets[k];
        b.analyse.push(analyse);
        b.tips.push(analysis.tip.len());
        let t = Instant::now();
        let outcome = state.reverse_fold(&reverse, &choices);
        let fold = ms(t);
        match outcome {
            Ok(ReverseOutcome::Landed(_)) => b.landed.push(fold),
            Ok(ReverseOutcome::ChooseOrder(_)) => b.choice.push(fold),
            Ok(ReverseOutcome::ChooseOpening(_)) => {}
            Err(_) => b.refused.push(fold),
        }
    }
}

fn print(title: &str, buckets: &[Bucket]) {
    println!("\n{title}\n");
    println!(
        "| Faces | Ops | Tip faces (mean) | Analyse mean | Landed mean / p95 (n) | Choice mean (n) | Refused mean / p95 (n) |"
    );
    println!("|---|---|---|---|---|---|---|");
    for (b, (lo, hi)) in buckets.iter().zip(RANGES) {
        if b.analyse.is_empty() {
            continue;
        }
        let tips = b.tips.iter().sum::<usize>() as f64 / b.tips.len() as f64;
        println!(
            "| {lo}–{hi} | {} | {tips:.1} | {:.3} ms | {:.3} / {:.3} ms ({}) | {:.3} ms ({}) | {:.3} / {:.3} ms ({}) |",
            b.analyse.len(),
            mean(&b.analyse),
            mean(&b.landed),
            p95(&b.landed),
            b.landed.len(),
            mean(&b.choice),
            b.choice.len(),
            mean(&b.refused),
            p95(&b.refused),
            b.refused.len(),
        );
    }
}

/// The median of 15 runs.
fn median_ms<T>(mut run: impl FnMut() -> T) -> f64 {
    let mut times: Vec<f64> = (0..15)
        .map(|_| {
            let t = Instant::now();
            black_box(run());
            ms(t)
        })
        .collect();
    times.sort_by(f64::total_cmp);
    times[times.len() / 2]
}

fn crane() {
    let square = match State::flat(Sheet::square(), StartSide::Front) {
        Ok(s) => s,
        Err(e) => panic!("{e}"),
    };
    let mut sequence = ida::Sequence::new(square, oristudio_fold::Isometry::IDENTITY);
    sequence.bird_base();
    sequence.neck_and_tail();
    let pattern =
        beloch::pattern(&beloch::document("crane.fold")).unwrap_or_else(|e| panic!("{e}"));
    let head = ida::new_crease_line(sequence.state(), &pattern);
    sequence.head(head);
    println!("\nThe crane by Ida's route\n");
    println!("| Step | Faces before → after | Pairs after | Time (median) |");
    println!("|---|---|---|---|");
    for step in &sequence.steps {
        let time = match &step.op {
            ida::Op::Fold(op) => median_ms(|| step.parent.fold(op).is_ok()),
            ida::Op::Reverse(op, choices) => {
                median_ms(|| step.parent.reverse_fold(op, choices).is_ok())
            }
        };
        println!(
            "| {} | {} → {} | {} | {time:.3} ms |",
            step.name,
            step.parent.faces().len(),
            step.state.faces().len(),
            step.state.order().len()
        );
    }
}

fn main() {
    crane();
    let mut campaign: Vec<Bucket> = RANGES.iter().map(|_| Bucket::default()).collect();
    for i in 0..1500u64 {
        let mut rng = Rng::new(7777 + i);
        let Ok(state) = random::folded(&mut rng) else {
            continue;
        };
        if state.faces().len() <= 60 {
            time(&state, &mut rng, 1, &mut campaign);
        }
    }
    print("Campaign states", &campaign);

    let mut stacks: Vec<Bucket> = RANGES.iter().map(|_| Bucket::default()).collect();
    for run in 0..40u64 {
        let mut rng = Rng::new(4242 + run);
        let mut state = match State::flat(Sheet::square(), StartSide::Front) {
            Ok(s) => s,
            Err(e) => panic!("{e}"),
        };
        let mut guard = 0;
        while state.faces().len() <= 256 && guard < 200 {
            guard += 1;
            let Some(op) = middle_fold(&state, &mut rng) else {
                continue;
            };
            let Ok(folded) = state.fold(&op) else {
                continue;
            };
            state = folded.state;
            time(&state, &mut rng, 3, &mut stacks);
        }
    }
    print("Deep stacks", &stacks);

    let mut sequences: Vec<Bucket> = RANGES.iter().map(|_| Bucket::default()).collect();
    for seed in 0..120u64 {
        let Ok(drawn) = random::Sequence::new(0x5eed_0000 + seed, 40, 256) else {
            continue;
        };
        let mut rng = Rng::new(seed);
        for step in drawn {
            if let random::Outcome::Landed(folded) = step.outcome {
                time(&folded.state, &mut rng, 2, &mut sequences);
            }
        }
    }
    print("Random sequences", &sequences);
}

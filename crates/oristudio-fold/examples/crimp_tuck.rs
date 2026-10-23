//! Native timings for the crimp and the tuck (plan Phase 11), bucketed by the
//! parent's face count like `reverse`:
//!
//! ```sh
//! cargo run -p oristudio-fold --release --example crimp_tuck
//! ```
//!
//! On the engine's random sequences (`random::Sequence` to 256 faces) and on
//! `perf`'s deep stacks (all-layer folds through the middle of the model),
//! each state takes a crimp drawn as the spike's crimp campaign draws them
//! (`random::crimp_fold`, its flaps at their first openings, inside) and a
//! tuck drawn as its tuck campaign does (`random::tuck_fold`). Columns: the
//! crimp's analysis (tip, openings, both scores' first and ℓ2), the crimp
//! whole (scores, gate, carry, seeds, completion, letters, `State::make`)
//! for those that land and those refused (with the other kind tried for the
//! fix); the tuck whole, landed and refused (with nearby targets tried for
//! the fixes); and the tuck's target listing (`State::analyse_tuck`, one
//! completion per layer the block lands on).

use std::time::Instant;

use oristudio_fold::random::{self, Rng};
use oristudio_fold::{
    CompletionLimits, CrimpOutcome, Direction, PlainFold, ReverseChoices, Sheet, Side, StartSide,
    State, TuckChoices, TuckOutcome, VertexId,
};
use oristudio_geometry::Line;

#[derive(Default)]
struct Bucket {
    crimp_analyse: Vec<f64>,
    crimp_landed: Vec<f64>,
    crimp_refused: Vec<f64>,
    tuck_landed: Vec<f64>,
    tuck_refused: Vec<f64>,
    tuck_targets: Vec<f64>,
    targets: Vec<usize>,
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

const RANGES: [(usize, usize); 5] = [(1, 8), (9, 32), (33, 64), (65, 128), (129, 256)];

fn time(state: &State, rng: &mut Rng, buckets: &mut [Bucket]) {
    let faces = state.faces().len();
    let Some(k) = RANGES
        .iter()
        .position(|&(lo, hi)| (lo..=hi).contains(&faces))
    else {
        return;
    };
    let b = &mut buckets[k];
    if let Some(op) = random::crimp_fold(state, rng, 0.2) {
        let t = Instant::now();
        if let Ok(analysis) = state.analyse_crimp(&op)
            && analysis.tip.flaps.iter().all(|f| !f.openings.is_empty())
        {
            b.crimp_analyse.push(ms(t));
            let choices = ReverseChoices {
                openings: analysis
                    .tip
                    .flaps
                    .iter()
                    .filter(|f| f.openings.len() > 1)
                    .map(|f| f.openings[0].stored.clone())
                    .collect(),
                order: None,
            };
            let t = Instant::now();
            match state.crimp_fold(&op, &choices) {
                Ok(CrimpOutcome::Landed(_) | CrimpOutcome::ChooseOrder(_)) => {
                    b.crimp_landed.push(ms(t));
                }
                Ok(CrimpOutcome::ChooseOpening(_)) => {}
                Err(_) => b.crimp_refused.push(ms(t)),
            }
        }
    }
    if let Some(op) = random::tuck_fold(state, rng) {
        let t = Instant::now();
        match state.tuck_fold(&op, &TuckChoices::default()) {
            Ok(TuckOutcome::Landed(_) | TuckOutcome::ChooseOrder(_)) => b.tuck_landed.push(ms(t)),
            Err(_) => b.tuck_refused.push(ms(t)),
        }
        let t = Instant::now();
        if let Ok(analysis) = state.analyse_tuck(&op, &CompletionLimits::default()) {
            b.tuck_targets.push(ms(t));
            b.targets.push(analysis.targets.len());
        }
    }
}

fn print(title: &str, buckets: &[Bucket]) {
    println!("\n{title}\n");
    println!(
        "| Faces | Crimp analyse | Crimp landed mean / p95 (n) | Crimp refused mean / p95 (n) | Tuck landed mean / p95 (n) | Tuck refused mean / p95 (n) | Tuck targets mean / p95 (layers) |"
    );
    println!("|---|---|---|---|---|---|---|");
    for (b, (lo, hi)) in buckets.iter().zip(RANGES) {
        if b.crimp_analyse.is_empty() && b.tuck_targets.is_empty() {
            continue;
        }
        let layers = b.targets.iter().sum::<usize>() as f64 / b.targets.len().max(1) as f64;
        println!(
            "| {lo}–{hi} | {:.3} ms | {:.2} / {:.2} ms ({}) | {:.2} / {:.2} ms ({}) | {:.2} / {:.2} ms ({}) | {:.2} / {:.2} ms ({}) | {:.2} / {:.2} ms ({layers:.1}) |",
            mean(&b.crimp_analyse),
            mean(&b.crimp_landed),
            p95(&b.crimp_landed),
            b.crimp_landed.len(),
            mean(&b.crimp_refused),
            p95(&b.crimp_refused),
            b.crimp_refused.len(),
            mean(&b.tuck_landed),
            p95(&b.tuck_landed),
            b.tuck_landed.len(),
            mean(&b.tuck_refused),
            p95(&b.tuck_refused),
            b.tuck_refused.len(),
            mean(&b.tuck_targets),
            p95(&b.tuck_targets),
        );
    }
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

fn main() {
    let mut sequences: Vec<Bucket> = RANGES.iter().map(|_| Bucket::default()).collect();
    for seed in 0..120u64 {
        let Ok(drawn) = random::Sequence::new(0x5eed_0000 + seed, 40, 256) else {
            continue;
        };
        let mut rng = Rng::new(seed);
        for step in drawn {
            if let random::Outcome::Landed(folded) = step.outcome {
                time(&folded.state, &mut rng, &mut sequences);
            }
        }
    }
    print("Random sequences", &sequences);

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
            time(&state, &mut rng, &mut stacks);
        }
    }
    print("Deep stacks", &stacks);
}

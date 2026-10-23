//! Native timings for the axiom side of a step, bucketed by face count like
//! `perf`: every landmark of a state (with visibility and crossings), and the
//! candidates of an O2 and an O6 over them, on states made by all-layer folds
//! along random lines through the middle of the folded model.
//!
//! ```sh
//! cargo run -p oristudio-fold --release --example landmarks
//! ```
//!
//! Landmarks are computed once per state and cached (plan D14 tier 2);
//! candidates once per set of picked inputs.

use std::time::Instant;

use oristudio_fold::random::Rng;
use oristudio_fold::{Axiom, Direction, PlainFold, Sheet, Side, StartSide, State, VertexId};
use oristudio_geometry::Line;

#[derive(Default)]
struct Bucket {
    landmarks: Vec<f64>,
    points: Vec<usize>,
    segments: Vec<usize>,
    o2: Vec<f64>,
    o6: Vec<f64>,
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
    s.get((s.len() * 95 / 100).min(s.len().saturating_sub(1)))
        .copied()
        .unwrap_or(0.0)
}

/// An all-layer fold along a random line through the middle of the model.
fn random_fold(state: &State, rng: &mut Rng) -> Option<PlainFold> {
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
    let direction = if rng.next_f64() < 0.5 {
        Direction::Valley
    } else {
        Direction::Mountain
    };
    Some(PlainFold::new(line, Side::Positive, direction))
}

fn main() {
    let edges = [8usize, 32, 64, 128, 256, usize::MAX];
    let mut buckets: Vec<Bucket> = (0..edges.len()).map(|_| Bucket::default()).collect();
    let mut rng = Rng::new(0x1a4d_0a2c);
    for _ in 0..40 {
        let Ok(mut state) = State::flat(Sheet::square(), StartSide::Front) else {
            return;
        };
        let mut misses = 0;
        while state.faces().len() <= 256 && misses < 50 {
            let Some(op) = random_fold(&state, &mut rng) else {
                misses += 1;
                continue;
            };
            let Ok(folded) = state.fold(&op) else {
                misses += 1;
                continue;
            };
            state = folded.state;
            let bucket = &mut buckets[edges
                .iter()
                .position(|&e| state.faces().len() <= e)
                .unwrap_or(edges.len() - 1)];

            let t = Instant::now();
            let landmarks = state.landmarks(&[]);
            bucket.landmarks.push(ms(t));
            bucket.points.push(landmarks.points.len());
            bucket.segments.push(landmarks.segments.len());

            let point = |rng: &mut Rng| {
                let p = &landmarks.points[rng.below(landmarks.points.len())];
                p.sources[0].sheet
            };
            let segment =
                |rng: &mut Rng| landmarks.segments[rng.below(landmarks.segments.len())].sheet;
            let o2 = Axiom::O2 {
                p: point(&mut rng),
                q: point(&mut rng),
            };
            let t = Instant::now();
            let _ = state.axiom_candidates(&o2);
            bucket.o2.push(ms(t));
            let o6 = Axiom::O6 {
                p1: point(&mut rng),
                m1: segment(&mut rng),
                p2: point(&mut rng),
                m2: segment(&mut rng),
            };
            let t = Instant::now();
            let _ = state.axiom_candidates(&o6);
            bucket.o6.push(ms(t));
        }
    }
    println!(
        "| Faces | States | Points | Segments | Landmarks mean / p95 | O2 candidates | O6 candidates |"
    );
    println!("|---|---|---|---|---|---|---|");
    let mut lo = 1;
    for (bucket, &hi) in buckets.iter().zip(&edges) {
        if bucket.landmarks.is_empty() {
            continue;
        }
        let label = if hi == usize::MAX {
            format!("{lo}+")
        } else {
            format!("{lo}–{hi}")
        };
        let n = bucket.landmarks.len();
        println!(
            "| {label} | {n} | {:.0} | {:.0} | {:.2} / {:.2} ms | {:.3} ms | {:.3} ms |",
            bucket.points.iter().sum::<usize>() as f64 / n as f64,
            bucket.segments.iter().sum::<usize>() as f64 / n as f64,
            mean(&bucket.landmarks),
            p95(&bucket.landmarks),
            mean(&bucket.o2),
            mean(&bucket.o6),
        );
        lo = hi + 1;
    }
}

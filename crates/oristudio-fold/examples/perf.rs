//! Native timings for the plain fold, bucketed by the landed state's face
//! count like the core spike's `perf.mjs` (research §12): all-layer folds
//! along random lines through the middle of the folded model, from the flat
//! square until it has more than 256 faces.
//!
//! ```sh
//! cargo run -p oristudio-fold --release --example perf
//! ```
//!
//! Columns: `analyse` is the closure (snap, classify, pieces, flaps, U);
//! `fold` the whole operation, the incremental gate included; `gate` the full
//! gate from scratch on the landed parts (`State::make`); `check` the
//! layer-order checker with a newly built problem; and a valley fold of the
//! top layer at a point of each landed state, not kept.
//!
//! With `FOLD_PERF_SPLIT=1` it also prints, to stderr, where the gate's time
//! goes above 128 faces (overlay, constraint build, check) and, for each
//! top-layer fold, the incremental rebuild against a full build.

use std::time::Instant;

use oristudio_fold::random::Rng;
use oristudio_fold::{Direction, PlainFold, Sheet, Side, StartSide, State, VertexId};
use oristudio_geometry::Line;

#[derive(Default)]
struct Bucket {
    analyse: Vec<f64>,
    fold: Vec<f64>,
    gate: Vec<f64>,
    check: Vec<f64>,
    pairs: Vec<usize>,
    top: Vec<f64>,
}

/// A valley fold of the top layer along a random line through the middle of
/// the model, seeded at a point on its moving side.
fn top_layer(state: &State, rng: &mut Rng) -> Option<PlainFold> {
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
    let p = [c[0] + 0.02 * line.n[0], c[1] + 0.02 * line.n[1]];
    let top = *state.stack_at(p)?.first()?;
    let at = state.isometry(top)?.inverse().apply(p);
    Some(
        PlainFold::new(line, Side::Positive, Direction::Valley)
            .with_seed(oristudio_fold::Seed::Depth { at, layers: 1 }),
    )
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

fn main() {
    let ranges = [(1, 8), (9, 32), (33, 64), (65, 128), (129, 256)];
    let mut buckets: Vec<Bucket> = ranges.iter().map(|_| Bucket::default()).collect();
    for run in 0..40u64 {
        let mut rng = Rng::new(4242 + run);
        let mut state = match State::flat(Sheet::square(), StartSide::Front) {
            Ok(s) => s,
            Err(e) => panic!("{e}"),
        };
        let mut guard = 0;
        while state.faces().len() <= 256 && guard < 200 {
            guard += 1;
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
            let Some(line) = Line::from_point_direction(c, [a.cos(), a.sin()]) else {
                continue;
            };
            let side = if rng.next_f64() < 0.5 {
                Side::Positive
            } else {
                Side::Negative
            };
            let direction = if rng.next_f64() < 0.5 {
                Direction::Valley
            } else {
                Direction::Mountain
            };
            let op = PlainFold::new(line, side, direction);

            let t = Instant::now();
            let analysed = state.analyse_fold(&op);
            let analyse = ms(t);
            if analysed.is_err() {
                continue;
            }
            let t = Instant::now();
            let Ok(folded) = state.fold(&op) else {
                continue;
            };
            let fold = ms(t);
            let landed = folded.state;
            let t = Instant::now();
            let full = State::make(landed.parts().clone());
            let gate = ms(t);
            let t = Instant::now();
            let report = landed.check_full();
            let check = ms(t);
            assert!(full.is_ok() && report.is_valid());
            if std::env::var_os("FOLD_PERF_SPLIT").is_some() && landed.faces().len() > 128 {
                let view = landed.folded_view();
                let t = Instant::now();
                let _ = oristudio_layer_order::Overlay::build(view);
                let overlay = ms(t);
                let t = Instant::now();
                let problem = oristudio_layer_order::ConstraintProblem::build(view);
                let build = ms(t);
                let t = Instant::now();
                let _ = oristudio_layer_order::check_problem(
                    &problem,
                    view,
                    landed.order(),
                    oristudio_layer_order::Scope::All,
                );
                let checking = ms(t);
                eprintln!(
                    "faces {} cells {} constraints {} overlay {overlay:.2} build {build:.2} check {checking:.2}",
                    landed.faces().len(),
                    problem.overlay().cells().len(),
                    problem.constraints().len()
                );
            }

            let faces = landed.faces().len();
            if let Some(k) = ranges
                .iter()
                .position(|&(lo, hi)| (lo..=hi).contains(&faces))
            {
                let b = &mut buckets[k];
                b.analyse.push(analyse);
                b.fold.push(fold);
                b.gate.push(gate);
                b.check.push(check);
                b.pairs.push(landed.order().len());
            }
            // The same line on the landed state, folding only the top layer
            // at a point on the moving side: what a flap fold costs.
            let k = ranges
                .iter()
                .position(|&(lo, hi)| (lo..=hi).contains(&faces));
            if let (Some(k), Some(op)) = (k, top_layer(&landed, &mut rng)) {
                let t = Instant::now();
                if let Ok(top) = landed.fold(&op) {
                    buckets[k].top.push(ms(t));
                    if std::env::var_os("FOLD_PERF_SPLIT").is_some() {
                        let mut touched: std::collections::BTreeSet<_> =
                            top.report.moving_faces.iter().copied().collect();
                        touched.extend(
                            top.state
                                .faces()
                                .iter()
                                .map(|f| f.id)
                                .filter(|&id| landed.face(id).is_none()),
                        );
                        let view = top.state.folded_view();
                        let t = Instant::now();
                        let _ = landed.problem().rebuild(view, &touched);
                        let rebuild = ms(t);
                        let t = Instant::now();
                        let _ = oristudio_layer_order::ConstraintProblem::build(view);
                        let build = ms(t);
                        let t = Instant::now();
                        let _ = oristudio_layer_order::Overlay::build(view);
                        let overlay = ms(t);
                        eprintln!(
                            "top faces {} touched {} fold {:.2} rebuild {rebuild:.2} build {build:.2} overlay {overlay:.2}",
                            top.state.faces().len(),
                            touched.len(),
                            buckets[k].top.last().copied().unwrap_or(0.0)
                        );
                    }
                }
            }
            state = landed;
        }
    }
    println!(
        "| Faces | Folds | Pairs (mean) | Analyse mean | Fold mean / p95 | Full gate mean | Check mean | Top-layer fold mean / p95 (n) |"
    );
    println!("|---|---|---|---|---|---|---|---|");
    for (b, (lo, hi)) in buckets.iter().zip(ranges) {
        if b.fold.is_empty() {
            continue;
        }
        let pairs = b.pairs.iter().sum::<usize>() as f64 / b.pairs.len() as f64;
        println!(
            "| {lo}–{hi} | {} | {:.0} | {:.3} ms | {:.3} / {:.3} ms | {:.3} ms | {:.3} ms | {:.3} / {:.3} ms ({}) |",
            b.fold.len(),
            pairs,
            mean(&b.analyse),
            mean(&b.fold),
            p95(&b.fold),
            mean(&b.gate),
            mean(&b.check),
            mean(&b.top),
            p95(&b.top),
            b.top.len(),
        );
    }
}

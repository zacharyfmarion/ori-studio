//! Stage-0 precision sweep for the CP share-link codec.
//!
//! Answers: for a given coordinate quantum `q = 2^-F`, does a crease pattern still report the
//! *same* flat-foldability violations after the codec's only lossy step?
//!
//! The share codec is lossless except for canonicalise + quantise (alphabets, vertex table,
//! adjacency and deflate all round-trip exactly), so applying that transform and re-running the
//! real kernel measures the whole precision question without implementing the codec first.
//!
//! Usage: `cargo run --release -p oristudio-cp --example share_precision -- <corpus-dir>`
//! Emits CSV on stdout: `file,F,v0,v1,rule_hist_match,matched,max_disp`

use std::collections::BTreeMap;
use std::path::Path;

use oristudio_cp::checks::FlatFoldabilityViolation;
use oristudio_cp::checks_spatial::dispatched_camv;
use oristudio_cp::geometry::{FoldMagnitude, Point};
use oristudio_cp::io::cp::import_cp_str;
use oristudio_cp::model::CreasePatternModel;

/// Complete-linkage clustering: every member of a cluster lies within `tau` of the cluster's
/// first element, so cluster diameter is bounded by `tau` (single linkage is unbounded and was
/// measured merging vertices 2e-6 apart).
fn canonicalise(values: &[f64], tau: f64) -> BTreeMap<u64, f64> {
    let mut sorted: Vec<f64> = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    sorted.dedup();

    let mut map = BTreeMap::new();
    let mut i = 0usize;
    while i < sorted.len() {
        let mut j = i;
        while j + 1 < sorted.len() && sorted[j + 1] - sorted[i] <= tau {
            j += 1;
        }
        let rep = sorted[(i + j) / 2];
        for v in sorted.iter().take(j + 1).skip(i) {
            map.insert(v.to_bits(), rep);
        }
        i = j + 1;
    }
    map
}

fn transform(model: &CreasePatternModel, f_bits: i32) -> (CreasePatternModel, f64) {
    let q = 2f64.powi(-f_bits);

    let mut xs = Vec::with_capacity(model.line_segments.len() * 2);
    let mut ys = Vec::with_capacity(model.line_segments.len() * 2);
    for s in &model.line_segments {
        xs.push(s.a.x);
        xs.push(s.b.x);
        ys.push(s.a.y);
        ys.push(s.b.y);
    }
    let cx = canonicalise(&xs, q);
    let cy = canonicalise(&ys, q);

    let snap = |v: f64, m: &BTreeMap<u64, f64>| -> f64 {
        let rep = m.get(&v.to_bits()).copied().unwrap_or(v);
        (rep / q).round() * q
    };

    let mut out = model.clone();
    let mut max_disp: f64 = 0.0;
    for s in &mut out.line_segments {
        let (ax, ay) = (snap(s.a.x, &cx), snap(s.a.y, &cy));
        let (bx, by) = (snap(s.b.x, &cx), snap(s.b.y, &cy));
        max_disp = max_disp
            .max((ax - s.a.x).abs())
            .max((ay - s.a.y).abs())
            .max((bx - s.b.x).abs())
            .max((by - s.b.y).abs());
        s.a = Point::new(ax, ay);
        s.b = Point::new(bx, by);
    }
    (out, max_disp)
}

/// Give every `stride`-th crease a non-classic fold magnitude, so the document exercises the
/// **spatial closure** path that an all-classic `.cp` corpus can never reach.
///
/// The dispatch in `dispatched_camv` is per *vertex*, so this produces a genuinely mixed
/// document: vertices touching an injected crease take the closure path, the rest stay flat.
/// The injected angles are arbitrary, which makes the absolute residuals meaningless — but the
/// question here is whether *quantisation moves them*, and that is measured by matching each
/// vertex to itself before and after. `FoldMagnitude` stores 1e-7 degree units in a `u32`, so
/// the angle itself round-trips exactly; coordinates are the only lossy input.
fn inject_fold_angles(model: &mut CreasePatternModel, stride: usize) {
    if stride == 0 {
        return;
    }
    const ANGLES: [f64; 4] = [90.0, 60.0, 120.0, 45.0];
    for (i, s) in model.line_segments.iter_mut().enumerate() {
        if i % stride == 0 {
            s.fold_magnitude = FoldMagnitude::from_degrees(ANGLES[(i / stride) % ANGLES.len()]);
        }
    }
}

fn rule_histogram(vs: &[FlatFoldabilityViolation]) -> BTreeMap<(u8, u8), usize> {
    let mut h = BTreeMap::new();
    for v in vs {
        let key = (v.rule as u8, v.color as u8);
        *h.entry(key).or_insert(0usize) += 1;
    }
    h
}

/// Greedy positional match: every violation before must correspond to one after, at the same
/// point (within a generous 1e-3) with the same rule and colour.
fn matched(before: &[FlatFoldabilityViolation], after: &[FlatFoldabilityViolation]) -> bool {
    if before.len() != after.len() {
        return false;
    }
    let mut used = vec![false; after.len()];
    for b in before {
        let mut hit = false;
        for (i, a) in after.iter().enumerate() {
            if used[i] || a.rule != b.rule || a.color != b.color {
                continue;
            }
            if (a.point.x - b.point.x).abs() < 1e-3 && (a.point.y - b.point.y).abs() < 1e-3 {
                used[i] = true;
                hit = true;
                break;
            }
        }
        if !hit {
            return false;
        }
    }
    true
}

fn main() {
    let dir = std::env::args().nth(1).expect("usage: <corpus-dir>");
    let f_values: Vec<i32> = std::env::args()
        .nth(2)
        .unwrap_or_else(|| "20,24,28,30,32,36,40".to_string())
        .split(',')
        .filter_map(|s| s.trim().parse().ok())
        .collect();
    // arg 3: give every Nth crease a fold angle. 0 = leave the document all-classic.
    let stride: usize = std::env::args()
        .nth(3)
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0);

    let mut files: Vec<_> = std::fs::read_dir(Path::new(&dir))
        .expect("corpus dir")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|e| e == "cp"))
        .collect();
    files.sort();

    // P3: spatial closure residual, matched by vertex position so `max_dR` is a true
    // per-vertex delta rather than a difference of maxima.
    //
    // NOTE: `spatial_vertex_reports` early-returns empty unless `has_non_classic_creases`
    // (`checks_spatial.rs:721`) -- the closure bar is the NON-FLAT regime. An all-classic
    // document (every `.cp` file, and any Oriedita-compatible CP) produces zero reports, so
    // `closure_n = 0` means NOT APPLICABLE, not "passed". Emit the count so a reader cannot
    // mistake a vacuous zero for a clean result.
    println!("file,F,v0,v1,rule_hist_match,matched,max_disp,closure_n,max_dR_deg,crossed_bar");
    for path in &files {
        let Ok(text) = std::fs::read_to_string(path) else {
            continue;
        };
        let Ok(model) = import_cp_str(&text) else {
            continue;
        };
        if model.line_segments.is_empty() {
            continue;
        }
        let mut model = model;
        inject_fold_angles(&mut model, stride);

        let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("?");
        // `dispatched_camv` is the product path: flat vertices to Oriedita's checker, vertices
        // touching a non-classic crease to the closure checker. On an all-classic document
        // `flat` is exactly `check4`.
        let d0 = dispatched_camv(&model);
        let v0 = d0.flat;
        let h0 = rule_histogram(&v0);
        let r0 = d0.spatial;

        for &f in &f_values {
            let (t, disp) = transform(&model, f);
            let d1 = dispatched_camv(&t);
            let v1 = d1.flat;
            let h1 = rule_histogram(&v1);

            let r1 = d1.spatial;
            let deg = 180.0 / std::f64::consts::PI;
            // Cell size == match window, so any counterpart within the window shares a cell
            // or an adjacent one -- the same trick `point_line_map` uses.
            const CELL: f64 = 1e-3;
            let key = |p: Point| ((p.x / CELL).floor() as i64, (p.y / CELL).floor() as i64);
            let mut grid: BTreeMap<(i64, i64), Vec<usize>> = BTreeMap::new();
            for (i, b) in r1.iter().enumerate() {
                if b.residual.is_some() {
                    grid.entry(key(b.point)).or_default().push(i);
                }
            }

            let mut max_dr: f64 = 0.0;
            let mut crossed = 0usize;
            for a in &r0 {
                let Some(ra) = a.residual else { continue };
                let (kx, ky) = key(a.point);
                let mut best: Option<f64> = None;
                let mut best_d = f64::INFINITY;
                for dx in -1..=1 {
                    for dy in -1..=1 {
                        for &i in grid.get(&(kx + dx, ky + dy)).into_iter().flatten() {
                            let b = &r1[i];
                            let d = (b.point.x - a.point.x)
                                .abs()
                                .max((b.point.y - a.point.y).abs());
                            if d < best_d {
                                best_d = d;
                                best = b.residual;
                            }
                        }
                    }
                }
                if best_d > CELL {
                    continue;
                }
                let Some(rb) = best else { continue };
                max_dr = max_dr.max((rb - ra).abs() * deg);
                if (ra * deg < 1e-6) != (rb * deg < 1e-6) {
                    crossed += 1;
                }
            }

            let closure_n = r0.iter().filter(|r| r.residual.is_some()).count();
            println!(
                "{},{},{},{},{},{},{:.3e},{},{:.3e},{}",
                name,
                f,
                v0.len(),
                v1.len(),
                u8::from(h0 == h1),
                u8::from(matched(&v0, &v1)),
                disp,
                closure_n,
                max_dr,
                crossed
            );
        }
    }
}

//! Why does a solved pattern still fail Big-Little-Big?
//!
//! Solves a region the way the product does, then dissects every remaining
//! BigLittleBig violation: the sector fan, whether the vertex is really two
//! creases passing through (in which case the ground-truth sectors are equal in
//! opposite pairs and BLB is vacuous), and whether the solver was in a position
//! to straighten them — i.e. whether the two halves share a carrier group.
//!
//! Usage:
//!   cargo run --release -p oristudio-cp-compiler --example blb_anatomy -- <file.osf>

use oristudio_cp::checks::{FlatFoldabilityRule, check_camv_task};
use oristudio_cp::io::fold::export_fold_document;
use oristudio_cp::model::CreasePatternModel;
use oristudio_cp_compiler::{ExactSolveOptions, exact_solve_input_from_fold, solve_exact};
use serde_json::Value;

/// `carrier_bin_id`'s angle bin, in radians (`fold_exactize.rs`).
const CARRIER_ANGLE_BIN: f64 = 0.01;
const CARRIER_RHO_BIN: f64 = 0.0025;

fn main() {
    let path = std::env::args().nth(1).expect("usage: <file.osf>");
    let raw = std::fs::read_to_string(&path).expect("read");
    let root: Value = serde_json::from_str(&raw).expect("json");
    let cp = &root["workspace"]["creasePattern"]["creasePattern"];
    let model: CreasePatternModel =
        serde_json::from_value(cp["document"]["crease_pattern"].clone()).expect("model");

    let fold = export_fold_document(&model, None);
    let (input, xform) = exact_solve_input_from_fold(&fold).expect("rebuild");
    let solved = solve_exact(
        &input,
        ExactSolveOptions {
            polish: true,
            timeout_seconds: 60.0,
            ..Default::default()
        },
    );
    println!("solve status: {:?}", solved.status);

    // Write the solved coordinates back onto the creases, then check.
    let mut out = model.clone();
    for (index, segment) in out.line_segments.iter_mut().enumerate() {
        let edge = fold.edges_vertices[index];
        let a = xform.invert(solved.vertices_exact[edge[0]]);
        let b = xform.invert(solved.vertices_exact[edge[1]]);
        segment.a.x = a.x;
        segment.a.y = a.y;
        segment.b.x = b.x;
        segment.b.y = b.y;
    }

    // Before / after, so "the solve converges into BLB" is a measurement.
    let before = check_camv_task(&model);
    let ba = before
        .violations
        .iter()
        .filter(|v| matches!(v.rule, FlatFoldabilityRule::Angles))
        .count();
    let bb = before.violations.len() - ba;
    println!("BEFORE the solve: {ba} angle, {bb} assignment/ordering");

    let result = check_camv_task(&out);
    let blb: Vec<_> = result
        .violations
        .iter()
        .filter(|v| !matches!(v.rule, FlatFoldabilityRule::Angles))
        .collect();
    let angles = result.violations.len() - blb.len();
    println!(
        "after the solve: {} CAMV violations ({angles} angle, {} assignment/ordering)",
        result.violations.len(),
        blb.len()
    );

    let mut tally = Tally::default();
    for violation in &blb {
        let (x, y) = (violation.point.x, violation.point.y);
        let rays = rays_at(&out, x, y);
        if rays.is_empty() {
            continue;
        }
        // The deficit that matters: CAMV crimps away the GLOBALLY smallest
        // sector when its two bounding creases differ, and reports a violation
        // when they match. So the fix is for the smallest sector to be one whose
        // bounds differ — and this is how far that is from being true.
        {
            let n = rays.len();
            let secs: Vec<f64> = (0..n)
                .map(|i| (rays[(i + 1) % n].bearing - rays[i].bearing).rem_euclid(360.0))
                .collect();
            let mut smallest_same = f64::INFINITY;
            let mut smallest_diff = f64::INFINITY;
            for i in 0..n {
                let bounded_same = rays[i].label == rays[(i + 1) % n].label;
                if bounded_same {
                    smallest_same = smallest_same.min(secs[i]);
                } else {
                    smallest_diff = smallest_diff.min(secs[i]);
                }
            }
            if smallest_same.is_finite() && smallest_diff.is_finite() {
                tally.deficits.push(smallest_diff - smallest_same);
            }
        }
        anatomy(&rays, &mut tally);
        // Would equal sectors have satisfied it? BLB needs a *strictly* smaller
        // sector, so a fan whose sectors all tie cannot violate it at all.
        if rays.len() >= 3 {
            let n = rays.len();
            let secs: Vec<f64> = (0..n)
                .map(|i| (rays[(i + 1) % n].bearing - rays[i].bearing).rem_euclid(360.0))
                .collect();
            let inside: Vec<f64> = secs.iter().copied().filter(|s| *s < 179.9).collect();
            if !inside.is_empty() {
                let spread = inside.iter().cloned().fold(0.0_f64, f64::max)
                    - inside.iter().cloned().fold(f64::INFINITY, f64::min);
                tally.spreads.push((n, spread));
            }
        }
    }
    println!("\n== anatomy of {} violations ==", blb.len());
    println!(
        "  crossings whose arms are near-collinear pairs (a pass-through): {}",
        tally.pass_through
    );
    println!(
        "    ...of those, arms that share a carrier bin (solver could straighten): {}",
        tally.same_bin
    );
    println!(
        "    ...arms in DIFFERENT carrier bins (solver never straightens them): {}",
        tally.diff_bin
    );
    println!(
        "    ...of those pairs, assignment differs across the vertex: {}",
        tally.split_assignment
    );
    println!("  not a pass-through crossing: {}", tally.other);
    println!(
        "\n  worst deviation from straight across all pass-through arms: {:.4} deg",
        tally.worst_bend
    );
    println!(
        "  carrier angle bin width: {:.4} deg",
        CARRIER_ANGLE_BIN.to_degrees()
    );

    println!("\n== how far from satisfying BLB ==");
    println!("   (deficit = how much the offending sector must rise before a");
    println!("    differently-bounded sector becomes the smallest instead)");
    let mut d = tally.deficits.clone();
    d.sort_by(f64::total_cmp);
    if !d.is_empty() {
        let q = |f: f64| d[((d.len() - 1) as f64 * f) as usize];
        println!(
            "  {} vertices: median {:.3} deg, p90 {:.3} deg, max {:.3} deg",
            d.len(),
            q(0.5),
            q(0.9),
            q(1.0)
        );
        println!(
            "  under 1 deg: {}   under 5 deg: {}",
            d.iter().filter(|v| **v < 1.0).count(),
            d.iter().filter(|v| **v < 5.0).count()
        );
    }

    println!("\n== how far each violating fan is from equal sectors ==");
    let mut by_degree: std::collections::BTreeMap<usize, Vec<f64>> = Default::default();
    for (n, spread) in &tally.spreads {
        by_degree.entry(*n).or_default().push(*spread);
    }
    for (degree, mut spreads) in by_degree {
        spreads.sort_by(f64::total_cmp);
        let median = spreads[spreads.len() / 2];
        println!(
            "  degree {degree}: {} vertices, sector spread median {:.3} deg, max {:.3} deg",
            spreads.len(),
            median,
            spreads.last().copied().unwrap_or(0.0)
        );
    }
}

#[derive(Default)]
struct Tally {
    pass_through: usize,
    same_bin: usize,
    diff_bin: usize,
    split_assignment: usize,
    other: usize,
    worst_bend: f64,
    spreads: Vec<(usize, f64)>,
    deficits: Vec<f64>,
}

struct Ray {
    bearing: f64,
    label: String,
    rho: f64,
    theta: f64,
}

fn rays_at(model: &CreasePatternModel, x: f64, y: f64) -> Vec<Ray> {
    let mut rays = Vec::new();
    for segment in &model.line_segments {
        for (from, to) in [(segment.a, segment.b), (segment.b, segment.a)] {
            if (from.x - x).abs() > 1e-6 || (from.y - y).abs() > 1e-6 {
                continue;
            }
            let colour = format!("{:?}", segment.color);
            if colour == "Black0" || colour == "Cyan3" {
                continue;
            }
            rays.push(Ray {
                bearing: (to.y - from.y)
                    .atan2(to.x - from.x)
                    .to_degrees()
                    .rem_euclid(360.0),
                label: colour,
                rho: rho_of(segment.a.x, segment.a.y, segment.b.x, segment.b.y),
                theta: theta_of(segment.a.x, segment.a.y, segment.b.x, segment.b.y),
            });
        }
    }
    rays.sort_by(|a, b| a.bearing.total_cmp(&b.bearing));
    rays
}

/// Carrier normal angle, as `carrier_from` builds it, folded to a half-turn.
fn theta_of(ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
    (-(bx - ax)).atan2(by - ay).rem_euclid(std::f64::consts::PI)
}

/// Distance from the origin to the line, in unit-square units (400 -> 1).
fn rho_of(ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
    let (dx, dy) = (bx - ax, by - ay);
    let len = dx.hypot(dy).max(1e-12);
    ((ax * -dy + ay * dx) / len) / 400.0
}

fn anatomy(rays: &[Ray], tally: &mut Tally) {
    // Pair each ray with the one closest to opposite it.
    let n = rays.len();
    if n < 4 || n % 2 == 1 {
        tally.other += 1;
        return;
    }
    let mut bends = Vec::new();
    let mut pairs = Vec::new();
    for i in 0..n / 2 {
        let j = (0..n)
            .filter(|k| *k != i)
            .min_by(|a, b| {
                let da = ((rays[*a].bearing - rays[i].bearing).abs() - 180.0).abs();
                let db = ((rays[*b].bearing - rays[i].bearing).abs() - 180.0).abs();
                da.total_cmp(&db)
            })
            .unwrap();
        let bend = ((rays[j].bearing - rays[i].bearing).abs() - 180.0).abs();
        bends.push(bend);
        pairs.push((i, j, bend));
    }
    let worst = bends.iter().cloned().fold(0.0_f64, f64::max);
    if worst > 3.0 {
        tally.other += 1;
        return;
    }
    tally.pass_through += 1;
    tally.worst_bend = tally.worst_bend.max(worst);
    for (i, j, _) in pairs {
        let same_bin = (rays[i].theta / CARRIER_ANGLE_BIN).round()
            == (rays[j].theta / CARRIER_ANGLE_BIN).round()
            && (rays[i].rho / CARRIER_RHO_BIN).round() == (rays[j].rho / CARRIER_RHO_BIN).round();
        if same_bin {
            tally.same_bin += 1;
        } else {
            tally.diff_bin += 1;
        }
        if rays[i].label != rays[j].label {
            tally.split_assignment += 1;
        }
    }
}

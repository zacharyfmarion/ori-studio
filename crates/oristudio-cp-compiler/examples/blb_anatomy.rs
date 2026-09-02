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
    let (mut input, xform) = exact_solve_input_from_fold(&fold).expect("rebuild");
    // `SOLVE_INPUT=attachment`: solve the raw detection the file carries (the
    // region's `solveInput`) instead of the document — the state a user's
    // Review & Fix starts from, before any repair.
    let attachment = std::env::var("SOLVE_INPUT").as_deref() == Ok("attachment");
    if attachment {
        input = serde_json::from_value(cp["suppressionRegions"][0]["solveInput"].clone())
            .expect("attachment solveInput");
        println!(
            "solving the ATTACHMENT: {} vertices, {} spans",
            input.vertices.len(),
            input.selected_spans.len()
        );
    }
    let mut options = ExactSolveOptions {
        polish: true,
        timeout_seconds: 60.0,
        ..Default::default()
    };
    if std::env::var("ANGLE_FAMILY").as_deref() == Ok("off") {
        options.angle_family = oristudio_cp_compiler::AngleFamilyMode::Off;
    }
    if let Some(v) = std::env::var("ANGLE_FAMILY_TOL_DEG")
        .ok()
        .and_then(|v| v.parse::<f64>().ok())
    {
        options.angle_family_snap_tolerance_radians = v.to_radians();
    }
    let solved = solve_exact(&input, options);
    // What the pinned round did, and how far the carriers were from the
    // lattice when it took them.
    // Which lattice the fold spans sit on, whatever the solver inferred: the
    // fraction within 1.5° of each candidate step.
    {
        let thetas: Vec<f64> = input
            .selected_spans
            .iter()
            .filter(|s| s.assignment_label() != oristudio_cp_compiler::AssignmentLabel::Boundary)
            .map(|s| s.carrier.normal.y.atan2(s.carrier.normal.x))
            .collect();
        for step_deg in [45.0_f64, 30.0, 22.5, 15.0, 11.25] {
            let step = step_deg.to_radians();
            let within = |tol: f64| {
                thetas
                    .iter()
                    .filter(|t| (*t - (*t / step).round() * step).abs() <= tol.to_radians())
                    .count()
            };
            println!(
                "  lattice {step_deg:>5}°: within 0.5° {:>4}  within 1.5° {:>4}  within 3° {:>4}  of {} fold spans",
                within(0.5),
                within(1.5),
                within(3.0),
                thetas.len()
            );
        }
    }
    let theorem = &solved.theorem_residual_report;
    println!(
        "solver: termination {}  polish stop {}  kawasaki before {} after {}  camv before {}a/{}b after {}a/{}b",
        solved.movement_report["termination"],
        solved.movement_report["polish"]["stop_reason"],
        theorem["before"]["max_kawasaki_residual_degrees"],
        theorem["after"]["max_kawasaki_residual_degrees"],
        theorem["before"]["camv_angle_violations"],
        theorem["before"]["big_little_big_violations"],
        theorem["after"]["camv_angle_violations"],
        theorem["after"]["big_little_big_violations"],
    );
    println!(
        "pinned_family: {}",
        solved.movement_report["polish"]["pinned_family"]
    );
    if let Some(step) = solved.movement_report["polish"]["pinned_family"]["step_degrees"].as_f64() {
        let step = step.to_radians();
        let mut offsets: Vec<f64> = input
            .selected_spans
            .iter()
            .filter(|s| s.assignment_label() != oristudio_cp_compiler::AssignmentLabel::Boundary)
            .map(|s| {
                let theta = s.carrier.normal.y.atan2(s.carrier.normal.x);
                (theta - (theta / step).round() * step).abs().to_degrees()
            })
            .collect();
        offsets.sort_by(f64::total_cmp);
        let q = |f: f64| offsets[((offsets.len() - 1) as f64 * f) as usize];
        println!(
            "  |lattice offset| over fold spans: median {:.3} p75 {:.3} p90 {:.3} max {:.3} deg;  within 0.5: {}  0.5-1.5: {}  >1.5: {}",
            q(0.5),
            q(0.75),
            q(0.9),
            q(1.0),
            offsets.iter().filter(|o| **o <= 0.5).count(),
            offsets.iter().filter(|o| **o > 0.5 && **o <= 1.5).count(),
            offsets.iter().filter(|o| **o > 1.5).count(),
        );
    }
    leftover_report(&input, &solved);
    if attachment {
        return;
    }
    println!(
        "solve status: {:?}   accepted {}   rejection_reasons {}",
        solved.status,
        solved.movement_report["accepted"],
        solved.movement_report["rejection_reasons"]
    );
    {
        use std::collections::BTreeMap;
        let mut sizes: BTreeMap<usize, usize> = BTreeMap::new();
        for span in &input.selected_spans {
            if let Some(id) = span.source_carrier_ids.first() {
                *sizes.entry(*id).or_default() += 1;
            }
        }
        let shared = sizes.values().filter(|n| **n > 1).count();
        let in_shared: usize = sizes.values().filter(|n| **n > 1).sum();
        println!(
            "carrier groups: {} total, {shared} hold more than one span ({in_shared} of {} spans)",
            sizes.len(),
            input.selected_spans.len()
        );
    }

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
    // A crease the solve collapsed to a point (a merged pair's stub) is gone
    // once the answer is written — the editor drops it on insert — so it is
    // dropped here too, or its zero-length line would add a ray of no direction
    // to the merged vertex's fan.
    out.line_segments
        .retain(|segment| segment.a.distance(segment.b) > 0.0);

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

/// For every Big-Little-Big vertex left after the solve: its fan, and for each
/// crease in it, how far its carrier sits from the adopted lattice and whether
/// that put it inside the pin tolerance. The unpinned ones are why the vertex
/// is still there.
fn leftover_report(
    input: &oristudio_cp_compiler::ExactSolveInput,
    solved: &oristudio_cp_compiler::ExactSolvedGraph,
) {
    use oristudio_cp_compiler::fold_export::export_exact_solved_to_fold_document;
    let pinned = &solved.movement_report["polish"]["pinned_family"];
    let Some(step_degrees) = pinned["step_degrees"].as_f64() else {
        println!("leftovers: no family adopted");
        return;
    };
    let last = pinned["attempts"].as_array().and_then(|a| a.last());
    let tolerance_degrees = last
        .and_then(|a| a["tolerance_degrees"].as_f64())
        .unwrap_or(1.5);
    // The short-crease attempt widens per carrier: noise over the crease length.
    let noise_px = last.and_then(|a| a["short_crease_noise_px"].as_f64());
    let image_px = input.image_size.map_or(1024.0, |s| s as f64);
    let step = step_degrees.to_radians();
    let Ok(mut fold) = export_exact_solved_to_fold_document(input, solved) else {
        println!("leftovers: export failed");
        return;
    };
    // Land on the editor's ±200 sheet so the import's rescale is a near-identity
    // and the checker's points map back to solved vertices by proximity.
    for coord in &mut fold.vertices_coords {
        coord[0] = coord[0] * 400.0 - 200.0;
        coord[1] = coord[1] * 400.0 - 200.0;
    }
    let Ok(model) = oristudio_cp::io::fold::import_fold_document(&fold) else {
        println!("leftovers: import failed");
        return;
    };
    let violations = check_camv_task(&model).violations;
    let leftovers: Vec<_> = violations
        .iter()
        .filter(|v| !matches!(v.rule, FlatFoldabilityRule::Angles))
        .collect();
    println!(
        "\n== leftovers: {} non-angle violations after the solve (family {step_degrees}°, tolerance {tolerance_degrees}°) ==",
        leftovers.len()
    );
    for violation in leftovers {
        let (px, py) = (violation.point.x, violation.point.y);
        let nearest = solved
            .vertices_exact
            .iter()
            .enumerate()
            .map(|(id, p)| {
                (
                    id,
                    ((p.x * 400.0 - 200.0 - px).powi(2) + (p.y * 400.0 - 200.0 - py).powi(2))
                        .sqrt(),
                )
            })
            .min_by(|a, b| a.1.total_cmp(&b.1));
        let Some((id, dist)) = nearest else { continue };
        let at = solved.vertices_exact[id];
        println!(
            "  vertex {id} ({:?}, {:.2} sheet units from the marker) at ({:.0}, {:.0}) px of {image_px:.0}:",
            violation.rule,
            dist,
            at.x * image_px,
            at.y * image_px
        );
        let mut fan: Vec<(f64, String)> = Vec::new();
        for span in &input.selected_spans {
            if span.assignment_label() == oristudio_cp_compiler::AssignmentLabel::Boundary {
                continue;
            }
            let [a, b] = span.vertices;
            if a != id && b != id {
                continue;
            }
            let (from, to) = if a == id { (a, b) } else { (b, a) };
            let (pf, pt) = (solved.vertices_exact[from], solved.vertices_exact[to]);
            let ray = (pt.y - pf.y)
                .atan2(pt.x - pf.x)
                .to_degrees()
                .rem_euclid(360.0);
            let theta = span.carrier.normal.y.atan2(span.carrier.normal.x);
            let offset = (theta - (theta / step).round() * step).to_degrees();
            let length_px = ((pt.x - pf.x).powi(2) + (pt.y - pf.y).powi(2)).sqrt() * 1024.0;
            let allowed = match noise_px {
                Some(noise) if length_px > 0.0 => {
                    tolerance_degrees.max((noise / length_px).atan().to_degrees())
                }
                _ => tolerance_degrees,
            };
            let pinned_here = offset.abs() <= allowed;
            let _ = image_px;
            fan.push((
                ray,
                format!(
                    "    ray {ray:>7.2}°  {:?}  carrier off-lattice {offset:+.2}°  {}  length {length_px:.1} px  span {}",
                    span.assignment_label(),
                    if pinned_here { "pinned  " } else { "UNPINNED" },
                    span.id
                ),
            ));
        }
        fan.sort_by(|a, b| a.0.total_cmp(&b.0));
        for (_, line) in fan {
            println!("{line}");
        }
    }
}

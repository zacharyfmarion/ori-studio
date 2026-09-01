//! Verify the exact claim: after a solve, **zero Kawasaki error** and yet
//! Big-Little-Big violations.
//!
//! Prints the solver's own Kawasaki residual, the checker's angle-rule count,
//! and the BLB count side by side, then the fan at each violating vertex with
//! its ground-truth counterpart — so "the angles are fine, the ordering is not"
//! is visible rather than asserted.
//!
//! Usage:
//!   cargo run --release -p oristudio-cp-compiler \
//!     --example kawasaki_clean_but_blb -- <sample-dir> [noise]

use oristudio_cp::checks::{FlatFoldabilityRule, check_camv_task};
use oristudio_cp_compiler::{
    CandidateVertexMovementPolicy, ExactSolveOptions, Point2, exact_solve_input_from_fold,
    solve_exact,
};
use treemaker_fold::FoldDocument;

fn main() {
    let dir = std::env::args()
        .nth(1)
        .expect("usage: <sample-dir> [noise]");
    let noise: f64 = std::env::args()
        .nth(2)
        .and_then(|v| v.parse().ok())
        .unwrap_or(0.001);
    let text = std::fs::read_to_string(format!("{dir}/gt.fold")).expect("gt.fold");
    let fold: FoldDocument = serde_json::from_str(&text).expect("fold");

    let gt_doc = oristudio_cp::io::fold::import_fold_file_document_json(&text).expect("import");
    let gt = check_camv_task(&gt_doc.crease_pattern).violations;
    println!(
        "GROUND TRUTH: {} CAMV violations  (this is the target, and it is clean)\n",
        gt.len()
    );

    let (input, xform) = exact_solve_input_from_fold(&fold).expect("rebuild");
    let mut noisy = input.clone();
    let mut seed = 0x9E3779B97F4A7C15_u64;
    for vertex in &mut noisy.vertices {
        if vertex.movement_policy != CandidateVertexMovementPolicy::Movable {
            continue;
        }
        vertex.point = Point2::new(
            vertex.point.x + noise * gauss(&mut seed),
            vertex.point.y + noise * gauss(&mut seed),
        );
    }

    let solved = solve_exact(
        &noisy,
        ExactSolveOptions {
            polish: true,
            timeout_seconds: 60.0,
            ..Default::default()
        },
    );
    let residual = &solved.theorem_residual_report["after"];

    let mut out = fold.clone();
    for (index, coord) in out.vertices_coords.iter_mut().enumerate() {
        if let Some(point) = solved.vertices_exact.get(index) {
            let back = xform.invert(*point);
            coord[0] = back.x;
            coord[1] = back.y;
        }
    }
    let text = serde_json::to_string(&out).expect("json");
    let document = oristudio_cp::io::fold::import_fold_file_document_json(&text).expect("import");
    let violations = check_camv_task(&document.crease_pattern).violations;
    let angles = violations
        .iter()
        .filter(|v| matches!(v.rule, FlatFoldabilityRule::Angles))
        .count();

    println!("AFTER THE SOLVE (noise {noise} of the paper edge)");
    println!("  verdict                        {:?}", solved.status);
    println!(
        "  solver's Kawasaki residual     {} deg   (its own measure; bar is 1e-6)",
        residual["max_kawasaki_residual_degrees"]
    );
    println!("  CAMV angle-rule violations     {angles}   <-- Kawasaki, per the checker");
    println!(
        "  CAMV BigLittleBig violations   {}   <-- the ordering rule",
        violations.len() - angles
    );

    println!("\nthe fans that fail, with what ground truth has at the same vertex:");
    for violation in violations
        .iter()
        .filter(|v| !matches!(v.rule, FlatFoldabilityRule::Angles))
    {
        let solved_fan = fan(&out, violation.point.x, violation.point.y);
        // Ground truth has not moved much, so the nearest GT vertex is the same one.
        let nearest = fold
            .vertices_coords
            .iter()
            .min_by(|a, b| {
                let da = (a[0] - violation.point.x).hypot(a[1] - violation.point.y);
                let db = (b[0] - violation.point.x).hypot(b[1] - violation.point.y);
                da.total_cmp(&db)
            })
            .expect("vertices");
        let gt_fan = fan(&fold, nearest[0], nearest[1]);
        println!(
            "\n  vertex near ({:.2}, {:.2})",
            violation.point.x, violation.point.y
        );
        println!("    ground truth  {gt_fan}");
        println!("    after solve   {solved_fan}");
    }
}

/// Sectors at a point, smallest first, as a readable list.
fn fan(fold: &FoldDocument, x: f64, y: f64) -> String {
    let mut bearings = Vec::new();
    for (edge, assignment) in fold.edges_vertices.iter().zip(&fold.edges_assignment) {
        if !matches!(
            assignment,
            treemaker_fold::Assignment::Mountain | treemaker_fold::Assignment::Valley
        ) {
            continue;
        }
        for (from, to) in [(edge[0], edge[1]), (edge[1], edge[0])] {
            let a = &fold.vertices_coords[from];
            if (a[0] - x).abs() > 1e-6 || (a[1] - y).abs() > 1e-6 {
                continue;
            }
            let b = &fold.vertices_coords[to];
            bearings.push(
                (b[1] - a[1])
                    .atan2(b[0] - a[0])
                    .to_degrees()
                    .rem_euclid(360.0),
            );
        }
    }
    if bearings.is_empty() {
        return "(no folds here)".to_owned();
    }
    bearings.sort_by(f64::total_cmp);
    let n = bearings.len();
    let mut sectors: Vec<f64> = (0..n)
        .map(|i| (bearings[(i + 1) % n] - bearings[i]).rem_euclid(360.0))
        .collect();
    sectors.sort_by(f64::total_cmp);
    let shown: Vec<String> = sectors.iter().map(|s| format!("{s:.4}")).collect();
    format!(
        "sectors {}   gap to 2nd-smallest {:.4} deg",
        shown.join(" "),
        sectors[1] - sectors[0]
    )
}

fn gauss(seed: &mut u64) -> f64 {
    let mut next = || {
        *seed ^= *seed << 13;
        *seed ^= *seed >> 7;
        *seed ^= *seed << 17;
        (*seed >> 11) as f64 / (1u64 << 53) as f64
    };
    let (u1, u2) = (next().max(1e-12), next());
    (-2.0 * u1.ln()).sqrt() * (std::f64::consts::TAU * u2).cos()
}

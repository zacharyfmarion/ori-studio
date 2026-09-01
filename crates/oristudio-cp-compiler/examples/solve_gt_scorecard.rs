//! Does the solve keep an exactly-foldable pattern foldable?
//!
//! For every sample whose ground truth is CAMV-clean: solve it as-is (the solve
//! should be a no-op), then perturb it the way detection does and solve again.
//! The second run is the one that matters — it is the only setting where "the
//! solve introduced a violation" is provable, because the target is known to be
//! clean and the only thing between the two is the solver.
//!
//! Usage:
//!   cargo run --release -p oristudio-cp-compiler --example solve_gt_scorecard \
//!     -- <pack-dir> [noise-in-paper-units]

use oristudio_cp::checks::{FlatFoldabilityRule, check_camv_task};
use oristudio_cp_compiler::{
    ExactSolveInput, ExactSolveOptions, Point2, exact_solve_input_from_fold, solve_exact,
};
use treemaker_fold::FoldDocument;

fn main() {
    let pack = std::env::args().nth(1).expect("usage: <pack-dir> [noise]");
    let noise: f64 = std::env::args()
        .nth(2)
        .and_then(|v| v.parse().ok())
        .unwrap_or(0.004);

    println!("noise sigma: {noise} of the paper edge\n");
    println!(
        "{:<30} {:>6} {:>6}   {:<22} {:<22}  {:>9}",
        "sample", "verts", "edges", "solved as-is", "solved after noise", "GT err px"
    );

    let mut entries: Vec<_> = std::fs::read_dir(format!("{pack}/samples"))
        .expect("samples/")
        .flatten()
        .collect();
    entries.sort_by_key(std::fs::DirEntry::file_name);

    let (mut clean_kept, mut clean_broken, mut refused, mut considered) = (0, 0, 0, 0);
    for entry in entries {
        let Ok(text) = std::fs::read_to_string(entry.path().join("gt.fold")) else {
            continue;
        };
        let Ok(fold) = serde_json::from_str::<FoldDocument>(&text) else {
            continue;
        };
        // Only patterns whose ground truth is already clean can answer the
        // question; anything else confounds "the solve broke it".
        let Ok(gt_doc) = oristudio_cp::io::fold::import_fold_file_document_json(&text) else {
            continue;
        };
        if !check_camv_task(&gt_doc.crease_pattern)
            .violations
            .is_empty()
        {
            continue;
        }
        considered += 1;
        let name: String = entry
            .file_name()
            .to_string_lossy()
            .chars()
            .take(28)
            .collect();

        let Ok((input, xform)) = exact_solve_input_from_fold(&fold) else {
            println!(
                "{name:<30} {:>6} {:>6}   REFUSED (paper is not a square)",
                fold.vertices_coords.len(),
                fold.edges_vertices.len()
            );
            refused += 1;
            continue;
        };
        let as_is = run(&input, &fold, &xform);

        // Perturb every movable interior vertex, deterministically per sample.
        let mut noisy = input.clone();
        let mut seed = 0x9E3779B97F4A7C15_u64 ^ (name.len() as u64);
        for vertex in &mut noisy.vertices {
            if vertex.movement_policy
                != oristudio_cp_compiler::CandidateVertexMovementPolicy::Movable
            {
                continue;
            }
            vertex.point = Point2::new(
                vertex.point.x + noise * gauss(&mut seed),
                vertex.point.y + noise * gauss(&mut seed),
            );
        }
        let perturbed = run(&noisy, &fold, &xform);

        if perturbed.1 == 0 && perturbed.2 == 0 {
            clean_kept += 1;
        } else {
            clean_broken += 1;
        }
        println!(
            "{name:<30} {:>6} {:>6}   {:<22} {:<22}  {:>9.2}",
            fold.vertices_coords.len(),
            fold.edges_vertices.len(),
            format!("{} {}a {}b", as_is.0, as_is.1, as_is.2),
            format!("{} {}a {}b", perturbed.0, perturbed.1, perturbed.2),
            perturbed.3
        );
    }
    println!(
        "\n{considered} clean-GT samples: {clean_kept} stayed clean through a noisy solve, \
         {clean_broken} came back with violations, {refused} refused (non-square paper)"
    );
}

/// Solve and report `(status, angle violations, BLB violations, GT error px)`.
fn run(
    input: &ExactSolveInput,
    fold: &FoldDocument,
    xform: &oristudio_cp_compiler::Similarity,
) -> (String, usize, usize, f64) {
    let solved = solve_exact(
        input,
        ExactSolveOptions {
            polish: true,
            timeout_seconds: 60.0,
            ..Default::default()
        },
    );
    let mut out = fold.clone();
    for (index, coord) in out.vertices_coords.iter_mut().enumerate() {
        let Some(point) = solved.vertices_exact.get(index) else {
            continue;
        };
        let back = xform.invert(*point);
        coord[0] = back.x;
        coord[1] = back.y;
    }
    let Ok(text) = serde_json::to_string(&out) else {
        return (format!("{:?}", solved.status), 0, 0, f64::NAN);
    };
    let Ok(document) = oristudio_cp::io::fold::import_fold_file_document_json(&text) else {
        return (format!("{:?}", solved.status), 0, 0, f64::NAN);
    };
    let violations = check_camv_task(&document.crease_pattern).violations;
    let angles = violations
        .iter()
        .filter(|v| matches!(v.rule, FlatFoldabilityRule::Angles))
        .count();

    // Distance from ground truth, as a fraction of the paper edge scaled to 1024.
    let mut worst = 0.0_f64;
    for (index, coord) in fold.vertices_coords.iter().enumerate() {
        let Some(point) = solved.vertices_exact.get(index) else {
            continue;
        };
        let back = xform.invert(*point);
        worst = worst.max((back.x - coord[0]).hypot(back.y - coord[1]));
    }
    (
        format!("{:?}", solved.status),
        angles,
        violations.len() - angles,
        worst / xform.side * 1024.0,
    )
}

/// Box-Muller on a xorshift stream, so a run is reproducible per sample.
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

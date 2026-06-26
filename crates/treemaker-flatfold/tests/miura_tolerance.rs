//! Guardrail: the flat-folder must handle large exactly-constructed patterns
//! and tolerate small coordinate noise. Pins the precision cliff measured at
//! ~1e-4 relative noise (2026-06-10) so folder changes cannot silently
//! tighten it; this protects exact-solve polish output from regressing.

use treemaker_flatfold::{SolutionLimit, SolveOptions, solve_flat_fold};
use treemaker_fold::FoldDocument;

fn miura(rows: usize, cols: usize, noise: f64) -> FoldDocument {
    let w = 2.0;
    let h = 1.0;
    let shear = 0.5;
    let mut vertices = Vec::new();
    let index = |i: usize, j: usize| i * (cols + 1) + j;
    // Deterministic pseudo-noise so the test is reproducible.
    let mut seed = 0x9e3779b97f4a7c15u64;
    let mut jitter = move || {
        seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        ((seed >> 11) as f64 / (1u64 << 53) as f64 - 0.5) * 2.0 * noise
    };
    for i in 0..=rows {
        for j in 0..=cols {
            vertices.push(vec![
                j as f64 * w + (i % 2) as f64 * shear + jitter(),
                i as f64 * h + jitter(),
            ]);
        }
    }
    let mut edges = Vec::new();
    let mut assignments = Vec::new();
    for i in 0..=rows {
        for j in 0..cols {
            edges.push(vec![index(i, j), index(i, j + 1)]);
            assignments.push(if i == 0 || i == rows {
                "B".to_owned()
            } else if i % 2 == 1 {
                "M".to_owned()
            } else {
                "V".to_owned()
            });
        }
    }
    for i in 0..rows {
        for j in 0..=cols {
            edges.push(vec![index(i, j), index(i + 1, j)]);
            assignments.push(if j == 0 || j == cols {
                "B".to_owned()
            } else if (i + j) % 2 == 0 {
                "M".to_owned()
            } else {
                "V".to_owned()
            });
        }
    }
    let value = serde_json::json!({
        "file_spec": 1.1,
        "file_classes": ["singleModel"],
        "frame_classes": ["creasePattern"],
        "vertices_coords": vertices,
        "edges_vertices": edges,
        "edges_assignment": assignments,
    });
    serde_json::from_value(value).expect("miura fold document")
}

fn assert_folds(document: &FoldDocument, label: &str) {
    let result = solve_flat_fold(
        document,
        SolveOptions {
            solution_limit: SolutionLimit::Count(1),
            ..SolveOptions::default()
        },
    );
    assert!(result.is_ok(), "{label} must flat-fold: {:?}", result.err());
}

#[test]
fn exact_miura_folds_at_scale() {
    assert_folds(&miura(10, 10, 0.0), "exact 220-edge miura");
}

#[test]
fn miura_tolerates_small_coordinate_noise() {
    // Paper spans ~20 units; 2e-4 absolute = 1e-5 relative noise.
    assert_folds(&miura(10, 10, 2e-4), "miura at 1e-5 relative noise");
}

use oristudio_layer_spread::spatial::{Cell, Input, solve};

fn folded_strip() -> Input {
    Input {
        positions: vec![
            [-1., -1., 0.],
            [1., -1., 0.],
            [1., 1., 0.],
            [-1., 1., 0.],
            [-1., -1., 0.],
            [-1., 1., 0.],
        ],
        faces: vec![vec![0, 1, 2, 3], vec![1, 4, 5, 2]],
        triangles: vec![[0, 1, 2], [0, 2, 3], [1, 4, 5], [1, 5, 2]],
        triangle_faces: vec![0, 0, 1, 1],
        groups: vec![0, 1],
        cells: vec![Cell {
            ring: vec![[-1., -1., 0.], [1., -1., 0.], [1., 1., 0.], [-1., 1., 0.]],
            faces: vec![1, 0],
            normal: [0., 0., 1.],
        }],
    }
}
#[test]
fn opens_shared_material_without_moving_the_hinge_apart() {
    let input = folded_strip();
    let solved = solve(&input).unwrap();
    assert!(solved.mean_gap > 0.005);
    assert!(solved.constraint_residual <= 2e-6);
    assert_eq!(solved.displacements.len(), 6); // Not eight independent face vertices.
    for a in 0..3 {
        assert!(solved.displacements.iter().map(|p| p[a]).sum::<f64>().abs() < 1e-5);
        assert!(solved.displacements.iter().all(|p| p[a].abs() <= 0.220003));
    }
}
#[test]
fn a_quarter_turn_rotates_the_whole_vector_solution() {
    let input = folded_strip();
    let expected = solve(&input).unwrap();
    let mut rotated = input.clone();
    for p in &mut rotated.positions {
        *p = [p[0], -p[2], p[1]];
    }
    for c in &mut rotated.cells {
        c.normal = [0., -1., 0.];
        for p in &mut c.ring {
            *p = [p[0], -p[2], p[1]];
        }
    }
    let result = solve(&rotated).unwrap();
    for (a, b) in expected.displacements.iter().zip(result.displacements) {
        assert!((a[0] - b[0]).abs() < 1e-5);
        assert!((a[2] + b[1]).abs() < 1e-5);
        assert!((a[1] - b[2]).abs() < 1e-5);
    }
}
#[test]
fn no_stack_stays_put_and_bad_identity_is_refused() {
    let mut input = folded_strip();
    input.cells.clear();
    assert!(
        solve(&input)
            .unwrap()
            .displacements
            .iter()
            .flatten()
            .all(|&d| d == 0.)
    );
    input.triangles[0][0] = 999;
    assert!(solve(&input).is_err());
    input = folded_strip();
    input.cells[0].faces = vec![1, 1];
    assert!(solve(&input).is_err());
}

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

#[test]
fn dense_stack_above_the_old_sample_cap_opens_with_subdivided_witnesses() {
    // Forty cells with 50 coincident triangular layers produce 147,000 raw
    // corner samples. Only 3,675 distinct crossing rows are needed. Synthetic
    // geometry keeps the user's external corpus out of the repository.
    let mut input = Input {
        positions: Vec::new(),
        faces: Vec::new(),
        triangles: Vec::new(),
        triangle_faces: Vec::new(),
        groups: Vec::new(),
        cells: vec![Cell {
            ring: vec![[-1., -1., 0.], [1., -1., 0.], [0., 1., 0.]],
            faces: (0..50).collect(),
            normal: [0., 0., 1.],
        }],
    };
    for face in 0..50 {
        input.positions.extend(input.cells[0].ring.iter().copied());
        let triangle = [3 * face, 3 * face + 1, 3 * face + 2];
        input.faces.push(triangle.to_vec());
        input.triangles.push(triangle);
        input.triangle_faces.push(face);
        input.groups.push(face);
    }
    let original = solve(&input).unwrap();
    input.cells = vec![input.cells[0].clone(); 40];
    let repeated = solve(&input).unwrap();
    assert!(repeated.mean_gap > 0.001);
    assert!(repeated.constraint_residual <= 2e-6);
    // Repeating cells scales the gap objective relative to the shape terms,
    // so do not assert invariant displacement. These parallel layers have
    // constant gaps: subdividing equally weighted witnesses preserves those.
    let center = [0., -1. / 3., 0.];
    input.cells = (0..40)
        .flat_map(|_| {
            (0..3)
                .map(|i| Cell {
                    ring: vec![input.positions[i], input.positions[(i + 1) % 3], center],
                    faces: (0..50).collect(),
                    normal: [0., 0., 1.],
                })
                .collect::<Vec<_>>()
        })
        .collect();
    let subdivided = solve(&input).unwrap();
    assert!((subdivided.mean_gap - repeated.mean_gap).abs() < 2e-5);
    assert!(original.mean_gap > 0.001);
}

#[test]
fn arbitrary_rotations_keep_finite_connected_bounded_openings() {
    for angle in [0.17_f64, 0.63, 1.09, 2.37] {
        let rotate = |[x, y, z]: [f64; 3]| {
            let (s, c) = angle.sin_cos();
            [
                c * x - s * y,
                c * (s * x + c * y) - s * z,
                s * (s * x + c * y) + c * z,
            ]
        };
        let mut input = folded_strip();
        input.positions.iter_mut().for_each(|p| *p = rotate(*p));
        for cell in &mut input.cells {
            cell.normal = rotate(cell.normal);
            cell.ring.iter_mut().for_each(|p| *p = rotate(*p));
        }
        let result = solve(&input).unwrap();
        assert_eq!(result.displacements.len(), 6);
        assert!(result.mean_gap > 0.005);
        assert!(result.constraint_residual <= 2e-6);
        assert!(
            result
                .displacements
                .iter()
                .flatten()
                .all(|v| v.is_finite() && v.abs() <= 0.220003)
        );
    }
}

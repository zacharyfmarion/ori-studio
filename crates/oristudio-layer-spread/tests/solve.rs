use oristudio_layer_spread::{Cell, Input, solve};

fn book() -> Input {
    Input {
        xy: vec![[0., 0.], [1., 0.], [1., 1.], [0., 1.], [0., 0.], [0., 1.]],
        faces: vec![vec![0, 1, 2, 3], vec![1, 4, 5, 2]],
        triangles: vec![[0, 1, 2], [0, 2, 3], [1, 4, 5], [1, 5, 2]],
        triangle_faces: vec![0, 0, 1, 1],
        orders: vec![[1, 0]],
        plane_groups: None,
        cells: vec![Cell {
            faces: vec![0, 1],
            point: [0.5, 0.5],
            area: 1.,
        }],
    }
}

#[test]
fn opens_book_with_shared_crease_and_planar_faces() {
    let result = solve(&book()).unwrap();
    assert!(result.heights[0] - result.heights[4] > 0.1);
    assert!(result.heights[3] - result.heights[5] > 0.1);
    // Planarity is a soft objective: centroid sampling permits a tiny twist.
    // Continuity is exact because both faces use the same crease vertex IDs.
    assert!((result.heights[1] - result.heights[2]).abs() < 1e-4);
    assert!(result.diagnostics.max_relative_warp < 1e-4);
    assert!(result.diagnostics.max_crossing < 1e-7);
    assert!(result.diagnostics.max_slope <= 0.35);
    for reference in &result.references {
        let [a, b, c] = reference.plane;
        let [x, y, z] = reference.center;
        assert!((a * x + b * y + c - z).abs() < 1e-12);
    }
}

#[test]
fn reversing_order_reverses_heights() {
    let input = book();
    let front = solve(&input).unwrap();
    let mut back = input.clone();
    back.orders[0].reverse();
    back.cells[0].faces.reverse();
    let back = solve(&back).unwrap();
    for (a, b) in front.heights.iter().zip(back.heights) {
        assert!((a + b).abs() < 1e-5);
    }
}

#[test]
fn rejects_missing_material_identity_and_missing_order() {
    let mut input = book();
    input.triangles[0][0] = 99;
    assert!(solve(&input).is_err());
    let mut input = book();
    input.orders.clear();
    assert!(solve(&input).is_err());
}

#[test]
fn single_layer_is_flat_not_a_failed_solve() {
    let mut input = book();
    input.xy.truncate(4);
    input.faces.truncate(1);
    input.triangles.truncate(2);
    input.triangle_faces.truncate(2);
    input.orders.clear();
    input.cells[0].faces = vec![0];
    let result = solve(&input).unwrap();
    assert!(result.heights.iter().all(|&z| z == 0.));
}

#[test]
fn flat_subdivision_shares_a_plane_without_an_extra_layer() {
    let whole = solve(&book()).unwrap();
    let mut input = book();
    input.faces = vec![vec![0, 1, 2], vec![0, 2, 3], vec![1, 4, 5, 2]];
    input.triangle_faces = vec![0, 1, 2, 2];
    input.plane_groups = Some(vec![0, 0, 1]);
    input.orders = vec![[2, 0], [2, 1]];
    input.cells = vec![
        Cell {
            faces: vec![0, 2],
            point: [2. / 3., 1. / 3.],
            area: 0.5,
        },
        Cell {
            faces: vec![1, 2],
            point: [1. / 3., 2. / 3.],
            area: 0.5,
        },
    ];
    let split = solve(&input).unwrap();
    // More centroid samples change the least-squares quadrature slightly,
    // but never create a third spacing target or bend along the precrease.
    assert!(split.diagnostics.mean_gap > 0.9 * whole.diagnostics.mean_gap);
    assert!(
        (split.heights[0] + split.heights[2] - split.heights[1] - split.heights[3]).abs() < 0.004
    );
    assert!(split.diagnostics.max_relative_warp < 0.002);
}

#[test]
fn narrow_triangle_keeps_height_precision_through_validation() {
    // A book with a nearly collinear extra boundary corner. Independently
    // rounding its solved heights to Float32 inflates the reported slope above
    // 0.35 even though the double-precision pose is comfortably within bounds.
    let mut input = book();
    input.xy.push([0.2, -1e-8]);
    input.faces[0] = vec![0, 6, 1, 2, 3];
    input.triangles.insert(0, [0, 6, 1]);
    input.triangle_faces.insert(0, 0);
    let angle: f64 = 0.2;
    let transform = |[x, y]: [f64; 2]| {
        [
            angle.cos() * x - angle.sin() * y - 0.4,
            angle.sin() * x + angle.cos() * y - 0.3,
        ]
    };
    input.xy.iter_mut().for_each(|p| *p = transform(*p));
    input.cells[0].point = transform(input.cells[0].point);
    let result = solve(&input).unwrap();
    assert!(result.diagnostics.max_slope <= 0.351);
    assert!(result.diagnostics.max_relative_warp <= 0.051);
    assert!(result.diagnostics.mean_gap > 0.1);
    assert_eq!(result.heights.len(), input.xy.len());
}

#[test]
fn shift_keeps_the_opened_book_its_own_size() {
    let input = book();
    let result = solve(&input).unwrap();
    for (side, reference) in result.references.iter().enumerate() {
        let shift = &result.shifts[side];
        assert_eq!(shift.len(), 2 * input.xy.len());
        let [a, b, c] = reference.plane;
        let above = |v: usize| result.heights[v] - a * input.xy[v][0] - b * input.xy[v][1] - c;
        // Both leaves run from the crease at x = 1 to their free edge at x = 0.
        for (free, crease) in [(0, 1), (3, 2), (4, 1), (5, 2)] {
            let lift = above(free) - above(crease);
            let flat = input.xy[crease][0] - input.xy[free][0];
            let shifted = flat + shift[2 * crease] - shift[2 * free];
            let before = (flat * flat + lift * lift).sqrt() - 1.;
            let after = (shifted * shifted + lift * lift).sqrt() - 1.;
            assert!(before > 0.005);
            assert!(after.abs() < before / 20.);
        }
    }
}

#[test]
fn single_layer_has_no_shift() {
    let mut input = book();
    input.xy.truncate(4);
    input.faces.truncate(1);
    input.triangles.truncate(2);
    input.triangle_faces.truncate(2);
    input.orders.clear();
    input.cells[0].faces = vec![0];
    let result = solve(&input).unwrap();
    assert!(result.shifts.iter().flatten().all(|&v| v == 0.));
}

/// `layers` loose unit squares, face 0 on top. Each has its own four vertices.
fn stack(layers: usize) -> Input {
    let corners = [[0., 0.], [1., 0.], [1., 1.], [0., 1.]];
    Input {
        xy: (0..layers).flat_map(|_| corners).collect(),
        faces: (0..layers).map(|f| (4 * f..4 * f + 4).collect()).collect(),
        triangles: (0..layers)
            .flat_map(|f| [[4 * f, 4 * f + 1, 4 * f + 2], [4 * f, 4 * f + 2, 4 * f + 3]])
            .collect(),
        triangle_faces: (0..layers).flat_map(|f| [f, f]).collect(),
        orders: (0..layers)
            .flat_map(|upper| (upper + 1..layers).map(move |lower| [lower, upper]))
            .collect(),
        plane_groups: None,
        cells: vec![Cell {
            faces: (0..layers).collect(),
            point: [0.6, 0.3],
            area: 1.,
        }],
    }
}

#[test]
fn layers_far_apart_stay_in_order_without_a_penalty_of_their_own() {
    let layers = 30;
    let input = stack(layers);
    let result = solve(&input).unwrap();
    // A square over a square overlaps in two triangle pairs. Only faces within
    // eight places of each other are penalized: 8 * 22 + (7 + 6 + ... + 1) pairs,
    // of the 435 that overlap.
    assert_eq!(result.diagnostics.overlap_regions, 2 * 204);
    assert_eq!(result.diagnostics.reach, 8);
    let level = |face: usize| &result.heights[4 * face..4 * face + 4];
    for upper in 0..layers {
        for lower in upper + 1..layers {
            let lowest = level(upper).iter().copied().fold(f64::INFINITY, f64::min);
            let highest = level(lower)
                .iter()
                .copied()
                .fold(f64::NEG_INFINITY, f64::max);
            assert!(lowest > highest, "face {upper} is not above face {lower}");
        }
    }
    assert!(result.diagnostics.max_crossing < 1e-7);
}

#[test]
fn a_deep_stack_is_measured_by_the_pairs_it_penalizes() {
    // 448 layers overlap in 200,256 triangle pairs, over the 200,000 a solve
    // may penalize. Counted on the pairs within reach, it is 7,096.
    let result = solve(&stack(448)).unwrap();
    assert_eq!(result.diagnostics.overlap_regions, 2 * (8 * 440 + 28));
    assert!(result.diagnostics.mean_gap > 0.);
}

#[test]
fn a_pair_is_penalized_where_any_cell_stacks_it_near() {
    // Ten whole squares: the top and the bottom are nine places apart, out of
    // reach, so 44 of the 45 pairs are penalized, in two triangle pairs each.
    let whole = solve(&stack(10)).unwrap();
    assert_eq!(whole.diagnostics.overlap_regions, 2 * 44);
    // Narrow the eight between them to the left half. On the right the top
    // lies directly on the bottom, so that pair is penalized too. A whole
    // square overlaps a half in three triangle pairs.
    let mut input = stack(10);
    for face in 1..9 {
        input.xy[4 * face + 1][0] = 0.5;
        input.xy[4 * face + 2][0] = 0.5;
    }
    input.cells = vec![
        Cell {
            faces: (0..10).collect(),
            point: [0.3, 0.2],
            area: 0.5,
        },
        Cell {
            faces: vec![0, 9],
            point: [0.75, 0.4],
            area: 0.5,
        },
    ];
    let split = solve(&input).unwrap();
    assert_eq!(split.diagnostics.overlap_regions, 2 + 3 * 16 + 2 * 28);
    // The two whole squares open like a wedge over the halves on the left.
    for corner in [0, 3] {
        assert!(split.heights[corner] - split.heights[36 + corner] > 0.2);
    }
}

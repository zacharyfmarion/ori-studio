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

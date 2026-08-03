//! Mirror symmetry in the optimizer's continuous pre-solve.
//!
//! The symmetry constraints are linear equalities in the full variable vector
//! (position plus the sheet-scale variable), following TreeMaker's
//! `tmConditionNodesPaired` / `tmConditionNodeSymmetric`. These tests check that
//! a solved layout is symmetric to solver tolerance on every axis, that a start
//! vector can be folded onto the manifold exactly, and that an unusable symmetry
//! request is rejected with a message naming the flaps at fault.

use oristudio_bp::model::GridType;
use oristudio_bp::optimizer::kernel::{
    KernelFlap, KernelHierarchy, KernelSymmetry, OptimizerSheet, basin_hopping_rssl_with_progress,
    basin_hopping_symmetric_with_progress, get_scale, greedy_solve_integer_symmetric, pack_rssl,
    pack_rssl_symmetric, rounded_exact, setup_initial_scale, symmetrize,
};
use oristudio_bp::optimizer::{OptimizerSymmetry, SymmetryAxis, SymmetryPreset};

const AXES: [SymmetryAxis; 4] = [
    SymmetryAxis::VerticalHalf,
    SymmetryAxis::HorizontalHalf,
    SymmetryAxis::MainDiagonal,
    SymmetryAxis::AntiDiagonal,
];

/// A star tree: `flaps.len()` leaves all at the same distance from one root, so
/// every pair is `2 * leg` apart.
fn star(flaps: &[(u32, i32, i32)], leg: i32) -> KernelHierarchy {
    let kernel_flaps = flaps
        .iter()
        .map(|&(id, width, height)| KernelFlap { id, width, height })
        .collect::<Vec<_>>();
    let mut dist_map = Vec::new();
    for i in 0..kernel_flaps.len() {
        for j in (i + 1)..kernel_flaps.len() {
            dist_map.push((i, j, f64::from(2 * leg)));
        }
    }
    KernelHierarchy {
        sheet: OptimizerSheet::Rect,
        flaps: kernel_flaps,
        dist_map,
        parents: Vec::new(),
        parent_map: Default::default(),
    }
}

fn symmetry(axis: SymmetryAxis, partners: &[(u32, u32)]) -> OptimizerSymmetry {
    OptimizerSymmetry {
        axis,
        partners: partners.to_vec(),
        negative_side: Vec::new(),
    }
}

fn spread_start(hierarchy: &KernelHierarchy) -> Vec<f64> {
    let count = hierarchy.flaps.len();
    let mut x = Vec::with_capacity(count * 2 + 1);
    for i in 0..count {
        // Deliberately lopsided so an asymmetric start has to be corrected.
        x.push(0.15 + 0.7 * (i as f64) / (count as f64));
        x.push(0.2 + 0.5 * ((i * 3 % count) as f64) / (count as f64));
    }
    x.push(0.0);
    setup_initial_scale(&mut x, hierarchy);
    x
}

/// Largest violation of the mirror relation across all flaps.
fn symmetry_error(x: &[f64], hierarchy: &KernelHierarchy, symmetry: &KernelSymmetry) -> f64 {
    let m = x[x.len() - 1];
    let mut worst: f64 = 0.0;
    for i in 0..hierarchy.flaps.len() {
        let j = symmetry.partner[i];
        let width = f64::from(hierarchy.flaps[i].width);
        let height = f64::from(hierarchy.flaps[i].height);
        let (mx, my) = symmetry
            .axis
            .mirror_norm(x[i * 2], x[i * 2 + 1], width, height, m);
        worst = worst.max((x[j * 2] - mx).abs());
        worst = worst.max((x[j * 2 + 1] - my).abs());
    }
    worst
}

#[test]
fn presets_swap_meaning_between_sheet_types() {
    // A diagonal-grid sheet is the paper rotated 45 degrees against the grid, so
    // a book fold of the paper runs diagonally in grid coordinates.
    assert_eq!(
        SymmetryAxis::for_preset(SymmetryPreset::Book, GridType::Rectangular),
        [SymmetryAxis::VerticalHalf, SymmetryAxis::HorizontalHalf]
    );
    assert_eq!(
        SymmetryAxis::for_preset(SymmetryPreset::Book, GridType::Diagonal),
        [SymmetryAxis::MainDiagonal, SymmetryAxis::AntiDiagonal]
    );
    assert_eq!(
        SymmetryAxis::for_preset(SymmetryPreset::Diagonal, GridType::Rectangular),
        [SymmetryAxis::MainDiagonal, SymmetryAxis::AntiDiagonal]
    );
    assert_eq!(
        SymmetryAxis::for_preset(SymmetryPreset::Diagonal, GridType::Diagonal),
        [SymmetryAxis::VerticalHalf, SymmetryAxis::HorizontalHalf]
    );
}

#[test]
fn symmetrize_folds_a_start_vector_onto_the_manifold_exactly() {
    let hierarchy = star(&[(1, 0, 0), (2, 0, 0), (3, 0, 0), (4, 0, 0)], 8);
    for axis in AXES {
        let resolved = KernelSymmetry::from_request(
            &symmetry(axis, &[(1, 2), (2, 1), (3, 4), (4, 3)]),
            &hierarchy,
        )
        .unwrap();
        let mut x = spread_start(&hierarchy);
        assert!(symmetry_error(&x, &hierarchy, &resolved) > 1e-3, "{axis:?}");
        symmetrize(&mut x, &hierarchy, &resolved);
        assert!(
            symmetry_error(&x, &hierarchy, &resolved) < 1e-12,
            "{axis:?}: symmetrize left an error"
        );
    }
}

#[test]
fn symmetrize_moves_an_on_axis_flap_onto_the_axis() {
    let hierarchy = star(&[(1, 0, 0), (2, 0, 0), (3, 0, 0)], 8);
    for axis in AXES {
        let resolved =
            KernelSymmetry::from_request(&symmetry(axis, &[(1, 2), (2, 1), (3, 3)]), &hierarchy)
                .unwrap();
        let mut x = spread_start(&hierarchy);
        symmetrize(&mut x, &hierarchy, &resolved);
        assert!(
            symmetry_error(&x, &hierarchy, &resolved) < 1e-12,
            "{axis:?}: on-axis flap not folded onto the axis"
        );
    }
}

#[test]
fn solved_layouts_are_symmetric_on_every_axis() {
    let hierarchy = star(&[(1, 0, 0), (2, 0, 0), (3, 0, 0), (4, 0, 0)], 8);
    for axis in AXES {
        let resolved = KernelSymmetry::from_request(
            &symmetry(axis, &[(1, 2), (2, 1), (3, 4), (4, 3)]),
            &hierarchy,
        )
        .unwrap();
        let mut x = spread_start(&hierarchy);
        symmetrize(&mut x, &hierarchy, &resolved);
        let packed =
            pack_rssl_symmetric(x, &hierarchy, None, None, Some(&resolved)).expect("pack runs");
        assert!(packed.success, "{axis:?}: pack failed {:?}", packed.status);
        let error = symmetry_error(&packed.x, &hierarchy, &resolved);
        assert!(
            error < 1e-6,
            "{axis:?}: solved layout is not symmetric (error {error:e})"
        );
        // Sanity: it actually packed something rather than collapsing.
        assert!(get_scale(&packed.x) >= 4.0);
    }
}

#[test]
fn symmetric_layouts_stay_symmetric_with_flap_dimensions() {
    // Under a book axis a mirrored pair keeps its dimensions; under a diagonal
    // axis width and height swap. Both cases must land exactly on the mirror.
    let book = star(&[(1, 4, 2), (2, 4, 2), (3, 0, 0), (4, 0, 0)], 10);
    let resolved = KernelSymmetry::from_request(
        &symmetry(
            SymmetryAxis::VerticalHalf,
            &[(1, 2), (2, 1), (3, 4), (4, 3)],
        ),
        &book,
    )
    .unwrap();
    let mut x = spread_start(&book);
    symmetrize(&mut x, &book, &resolved);
    let packed = pack_rssl_symmetric(x, &book, None, None, Some(&resolved)).unwrap();
    assert!(packed.success);
    assert!(symmetry_error(&packed.x, &book, &resolved) < 1e-6);

    let diagonal = star(&[(1, 4, 2), (2, 2, 4), (3, 0, 0), (4, 0, 0)], 10);
    let resolved = KernelSymmetry::from_request(
        &symmetry(
            SymmetryAxis::MainDiagonal,
            &[(1, 2), (2, 1), (3, 4), (4, 3)],
        ),
        &diagonal,
    )
    .unwrap();
    let mut x = spread_start(&diagonal);
    symmetrize(&mut x, &diagonal, &resolved);
    let packed = pack_rssl_symmetric(x, &diagonal, None, None, Some(&resolved)).unwrap();
    assert!(packed.success);
    assert!(symmetry_error(&packed.x, &diagonal, &resolved) < 1e-6);
}

#[test]
fn absent_symmetry_leaves_the_upstream_path_untouched() {
    let hierarchy = star(&[(1, 0, 0), (2, 0, 0), (3, 0, 0), (4, 0, 0)], 8);
    let x = spread_start(&hierarchy);
    let plain = pack_rssl(x.clone(), &hierarchy, None, None).unwrap();
    let none = pack_rssl_symmetric(x, &hierarchy, None, None, None).unwrap();
    assert_eq!(plain, none);
}

// ---------------------------------------------------------------- validation

fn rejection(partners: &[(u32, u32)], axis: SymmetryAxis, hierarchy: &KernelHierarchy) -> String {
    KernelSymmetry::from_request(&symmetry(axis, partners), hierarchy)
        .expect_err("expected the symmetry to be rejected")
        .to_string()
}

#[test]
fn an_unpaired_flap_is_named_rather_than_assumed_to_be_on_the_axis() {
    let hierarchy = star(&[(1, 0, 0), (2, 0, 0), (3, 0, 0)], 8);
    let message = rejection(&[(1, 2), (2, 1)], SymmetryAxis::VerticalHalf, &hierarchy);
    assert!(message.contains('3'), "{message}");
}

#[test]
fn a_pairing_that_does_not_pair_back_is_rejected() {
    let hierarchy = star(&[(1, 0, 0), (2, 0, 0), (3, 0, 0)], 8);
    let message = rejection(
        &[(1, 2), (2, 3), (3, 1)],
        SymmetryAxis::VerticalHalf,
        &hierarchy,
    );
    assert!(message.contains("not a mirror"), "{message}");
}

#[test]
fn an_unknown_flap_is_rejected() {
    let hierarchy = star(&[(1, 0, 0), (2, 0, 0)], 8);
    let message = rejection(
        &[(1, 2), (2, 1), (9, 9)],
        SymmetryAxis::VerticalHalf,
        &hierarchy,
    );
    assert!(message.contains("unknown flap 9"), "{message}");
}

#[test]
fn a_non_square_flap_cannot_sit_on_a_diagonal_axis() {
    // A flap on the axis has to be its own mirror image, and a 5x2 rectangle
    // reflected about y = x is a 2x5 rectangle.
    let hierarchy = star(&[(1, 0, 0), (2, 0, 0), (3, 5, 2)], 10);
    let message = rejection(
        &[(1, 2), (2, 1), (3, 3)],
        SymmetryAxis::MainDiagonal,
        &hierarchy,
    );
    assert!(message.contains("its own mirror image"), "{message}");

    // The same flap is fine on a book axis, where only the width parity matters.
    let hierarchy = star(&[(1, 0, 0), (2, 0, 0), (3, 4, 2)], 10);
    KernelSymmetry::from_request(
        &symmetry(SymmetryAxis::VerticalHalf, &[(1, 2), (2, 1), (3, 3)]),
        &hierarchy,
    )
    .expect("an even-width flap can sit on a vertical book axis");
}

#[test]
fn an_odd_width_flap_cannot_sit_on_a_vertical_book_axis() {
    // Centring a width-5 flap on the axis would put its anchor half a grid unit
    // off the lattice.
    let hierarchy = star(&[(1, 0, 0), (2, 0, 0), (3, 5, 0)], 10);
    let message = rejection(
        &[(1, 2), (2, 1), (3, 3)],
        SymmetryAxis::VerticalHalf,
        &hierarchy,
    );
    assert!(message.contains("its own mirror image"), "{message}");
}

#[test]
fn paired_flaps_must_be_mirror_images_as_boxes() {
    let hierarchy = star(&[(1, 4, 2), (2, 3, 2)], 10);
    let message = rejection(&[(1, 2), (2, 1)], SymmetryAxis::VerticalHalf, &hierarchy);
    assert!(message.contains("not mirror images"), "{message}");

    // Across a diagonal axis the mirror image has width and height exchanged, so
    // an identical pair is the wrong thing there.
    let hierarchy = star(&[(1, 4, 2), (2, 4, 2)], 10);
    let message = rejection(&[(1, 2), (2, 1)], SymmetryAxis::MainDiagonal, &hierarchy);
    assert!(message.contains("not mirror images"), "{message}");
}

// ------------------------------------------------------------ grid fitting

/// Check that a fitted integer layout is *exactly* symmetric on the grid: every
/// flap's mirror partner sits at the reflected grid point, with no tolerance.
fn assert_fitted_layout_is_symmetric(
    label: &str,
    hierarchy: &KernelHierarchy,
    resolved: &KernelSymmetry,
    output: &[i32],
) {
    let count = hierarchy.flaps.len();
    let size = output[output.len() - 1];
    let (center_x, center_y) = match hierarchy.sheet {
        OptimizerSheet::Diag => (true, true),
        OptimizerSheet::Rect => resolved.axis.centered(),
    };
    if center_x || center_y {
        assert_eq!(
            size % 2,
            0,
            "{label}: a centred axis needs the sheet centre on a grid point"
        );
    }
    let half = size / 2;
    for i in 0..count {
        let j = resolved.partner[i];
        // back to the coordinate frame the mirror map is expressed in
        let to_axis_frame = |index: usize| {
            (
                f64::from(output[index * 2] - if center_x { half } else { 0 }),
                f64::from(output[index * 2 + 1] - if center_y { half } else { 0 }),
            )
        };
        let (x, y) = to_axis_frame(i);
        let (px, py) = to_axis_frame(j);
        let (mx, my) = resolved.axis.mirror_grid(
            x,
            y,
            f64::from(hierarchy.flaps[i].width),
            f64::from(hierarchy.flaps[i].height),
        );
        assert_eq!(
            (px, py),
            (mx, my),
            "{label}: flap {} at ({x},{y}) should mirror to ({mx},{my}) but partner {} is at ({px},{py})",
            hierarchy.flaps[i].id,
            hierarchy.flaps[j].id
        );
    }
    // Every flap must fit inside the sheet it reports.
    for i in 0..count {
        let (x, y) = (output[i * 2], output[i * 2 + 1]);
        assert!(
            x >= 0
                && y >= 0
                && x + hierarchy.flaps[i].width <= size
                && y + hierarchy.flaps[i].height <= size,
            "{label}: flap {} at ({x},{y}) escapes its {size}x{size} sheet",
            hierarchy.flaps[i].id
        );
    }
}

fn fit(hierarchy: &KernelHierarchy, resolved: &KernelSymmetry) -> Vec<i32> {
    let mut x = spread_start(hierarchy);
    symmetrize(&mut x, hierarchy, resolved);
    let packed = pack_rssl_symmetric(x, hierarchy, None, None, Some(resolved)).expect("pack runs");
    assert!(packed.success, "pack failed: {:?}", packed.status);
    greedy_solve_integer_symmetric(&packed.x, hierarchy, resolved, &mut || false, &mut |_| {})
        .expect("symmetric fit succeeds")
}

#[test]
fn fitted_layouts_are_exactly_symmetric_on_every_axis() {
    let hierarchy = star(&[(1, 0, 0), (2, 0, 0), (3, 0, 0), (4, 0, 0)], 8);
    for axis in AXES {
        let resolved = KernelSymmetry::from_request(
            &symmetry(axis, &[(1, 2), (2, 1), (3, 4), (4, 3)]),
            &hierarchy,
        )
        .unwrap();
        let output = fit(&hierarchy, &resolved);
        assert_fitted_layout_is_symmetric(&format!("{axis:?}"), &hierarchy, &resolved, &output);
    }
}

#[test]
fn fitted_layouts_keep_on_axis_flaps_on_the_axis() {
    let hierarchy = star(&[(1, 0, 0), (2, 0, 0), (3, 0, 0), (4, 0, 0), (5, 0, 0)], 8);
    for axis in AXES {
        let resolved = KernelSymmetry::from_request(
            &symmetry(axis, &[(1, 2), (2, 1), (3, 4), (4, 3), (5, 5)]),
            &hierarchy,
        )
        .unwrap();
        let output = fit(&hierarchy, &resolved);
        assert_fitted_layout_is_symmetric(&format!("{axis:?}"), &hierarchy, &resolved, &output);
    }
}

#[test]
fn fitted_layouts_are_symmetric_with_flap_dimensions() {
    let book = star(&[(1, 4, 2), (2, 4, 2), (3, 0, 0), (4, 0, 0)], 10);
    let resolved = KernelSymmetry::from_request(
        &symmetry(
            SymmetryAxis::VerticalHalf,
            &[(1, 2), (2, 1), (3, 4), (4, 3)],
        ),
        &book,
    )
    .unwrap();
    let output = fit(&book, &resolved);
    assert_fitted_layout_is_symmetric("book+dims", &book, &resolved, &output);

    let diagonal = star(&[(1, 4, 2), (2, 2, 4), (3, 0, 0), (4, 0, 0)], 10);
    let resolved = KernelSymmetry::from_request(
        &symmetry(
            SymmetryAxis::MainDiagonal,
            &[(1, 2), (2, 1), (3, 4), (4, 3)],
        ),
        &diagonal,
    )
    .unwrap();
    let output = fit(&diagonal, &resolved);
    assert_fitted_layout_is_symmetric("diagonal+dims", &diagonal, &resolved, &output);
}

#[test]
fn fitted_layouts_respect_the_tree_distances() {
    let hierarchy = star(&[(1, 0, 0), (2, 0, 0), (3, 0, 0), (4, 0, 0), (5, 0, 0)], 8);
    for axis in AXES {
        let resolved = KernelSymmetry::from_request(
            &symmetry(axis, &[(1, 2), (2, 1), (3, 4), (4, 3), (5, 5)]),
            &hierarchy,
        )
        .unwrap();
        let output = fit(&hierarchy, &resolved);
        for &(i, j, dist) in &hierarchy.dist_map {
            let dx = f64::from(output[i * 2] - output[j * 2]);
            let dy = f64::from(output[i * 2 + 1] - output[j * 2 + 1]);
            let separation = (dx * dx + dy * dy).sqrt();
            assert!(
                separation >= dist - 1e-9,
                "{axis:?}: flaps {} and {} are {separation} apart but need {dist}",
                hierarchy.flaps[i].id,
                hierarchy.flaps[j].id
            );
        }
    }
}

#[test]
fn diagonal_sheets_fit_symmetrically_too() {
    let mut hierarchy = star(&[(1, 0, 0), (2, 0, 0), (3, 0, 0), (4, 0, 0)], 8);
    hierarchy.sheet = OptimizerSheet::Diag;
    for axis in AXES {
        let resolved = KernelSymmetry::from_request(
            &symmetry(axis, &[(1, 2), (2, 1), (3, 4), (4, 3)]),
            &hierarchy,
        )
        .unwrap();
        let mut x = spread_start(&hierarchy);
        symmetrize(&mut x, &hierarchy, &resolved);
        let packed = pack_rssl_symmetric(x, &hierarchy, None, None, Some(&resolved)).unwrap();
        assert!(packed.success, "{axis:?}: {:?}", packed.status);
        let output = greedy_solve_integer_symmetric(
            &packed.x,
            &hierarchy,
            &resolved,
            &mut || false,
            &mut |_| {},
        )
        .unwrap();
        let size = output[output.len() - 1];
        assert_eq!(size % 2, 0, "{axis:?}: diagonal sheets are even-sized");
        // The diamond is the L1 ball of radius size/2 about the sheet centre.
        let half = size / 2;
        for i in 0..hierarchy.flaps.len() {
            let radius = (output[i * 2] - half).abs() + (output[i * 2 + 1] - half).abs();
            assert!(
                radius <= half,
                "{axis:?}: flap {} is outside the diamond",
                hierarchy.flaps[i].id
            );
        }
    }
}

// ------------------------------------------------------- basin hopping / random

#[test]
fn basin_hopping_stays_on_the_symmetry_manifold() {
    let hierarchy = star(&[(1, 0, 0), (2, 0, 0), (3, 0, 0), (4, 0, 0), (5, 0, 0)], 8);
    for axis in AXES {
        let resolved = KernelSymmetry::from_request(
            &symmetry(axis, &[(1, 2), (2, 1), (3, 4), (4, 3), (5, 5)]),
            &hierarchy,
        )
        .unwrap();
        let x = spread_start(&hierarchy);
        let packed = basin_hopping_symmetric_with_progress(
            x,
            &hierarchy,
            7,
            &mut || false,
            &mut |_| {},
            Some(&resolved),
        )
        .expect("basin hopping runs");
        assert!(packed.success, "{axis:?}: {:?}", packed.status);
        let error = symmetry_error(&packed.x, &hierarchy, &resolved);
        assert!(
            error < 1e-6,
            "{axis:?}: basin hopping drifted off the manifold (error {error:e})"
        );
    }
}

#[test]
fn basin_hopping_without_symmetry_is_unchanged() {
    let hierarchy = star(&[(1, 0, 0), (2, 0, 0), (3, 0, 0)], 8);
    let x = spread_start(&hierarchy);
    let plain =
        basin_hopping_rssl_with_progress(x.clone(), &hierarchy, 11, &mut || false, &mut |_| {})
            .unwrap();
    let none =
        basin_hopping_symmetric_with_progress(x, &hierarchy, 11, &mut || false, &mut |_| {}, None)
            .unwrap();
    assert_eq!(plain, none);
}

#[test]
fn basin_hopping_does_not_lose_to_a_single_solve() {
    // Symmetry should not make the search worse: with the same start, a
    // basin-hopping run must be at least as good as one plain solve.
    let hierarchy = star(&[(1, 0, 0), (2, 0, 0), (3, 0, 0), (4, 0, 0)], 8);
    let resolved = KernelSymmetry::from_request(
        &symmetry(
            SymmetryAxis::VerticalHalf,
            &[(1, 2), (2, 1), (3, 4), (4, 3)],
        ),
        &hierarchy,
    )
    .unwrap();
    let mut x = spread_start(&hierarchy);
    symmetrize(&mut x, &hierarchy, &resolved);
    let single = pack_rssl_symmetric(x.clone(), &hierarchy, None, None, Some(&resolved)).unwrap();
    let hopped = basin_hopping_symmetric_with_progress(
        x,
        &hierarchy,
        3,
        &mut || false,
        &mut |_| {},
        Some(&resolved),
    )
    .unwrap();
    assert!(hopped.success && single.success);
    assert!(
        get_scale(&hopped.x) <= get_scale(&single.x) + 1e-9,
        "basin hopping returned a worse sheet: {} vs {}",
        get_scale(&hopped.x),
        get_scale(&single.x)
    );
}

#[test]
fn fitted_layouts_with_dimensions_respect_the_rounded_distances() {
    // A flap with width or height is not a disc: it is its rectangle inflated by
    // the leaf radius, so separation is the per-axis interval distance rather
    // than the distance between anchors. Checking anchors here would pass
    // layouts whose flap boxes overlap.
    let cases = [
        (
            SymmetryAxis::VerticalHalf,
            star(&[(1, 6, 3), (2, 6, 3), (3, 0, 0), (4, 0, 0)], 10),
        ),
        (
            SymmetryAxis::HorizontalHalf,
            star(&[(1, 6, 3), (2, 6, 3), (3, 0, 0), (4, 0, 0)], 10),
        ),
        (
            SymmetryAxis::MainDiagonal,
            star(&[(1, 6, 3), (2, 3, 6), (3, 0, 0), (4, 0, 0)], 10),
        ),
        (
            SymmetryAxis::AntiDiagonal,
            star(&[(1, 6, 3), (2, 3, 6), (3, 0, 0), (4, 0, 0)], 10),
        ),
    ];
    for (axis, hierarchy) in cases {
        let resolved = KernelSymmetry::from_request(
            &symmetry(axis, &[(1, 2), (2, 1), (3, 4), (4, 3)]),
            &hierarchy,
        )
        .unwrap();
        let output = fit(&hierarchy, &resolved);
        let positions = output
            .iter()
            .map(|&value| f64::from(value))
            .collect::<Vec<_>>();
        for &(i, j, dist) in &hierarchy.dist_map {
            let violation = rounded_exact(&positions, i, j, dist, &hierarchy.flaps);
            assert!(
                violation <= 1e-9,
                "{axis:?}: flaps {} and {} are too close under the rounded metric \
                 (dist^2 shortfall {violation})",
                hierarchy.flaps[i].id,
                hierarchy.flaps[j].id
            );
        }
    }
}

/// A mirror pair occupies two mirrored positions, and which member takes which
/// is free as far as the packing goes — so in random mode the solver settles it
/// differently per pair per seed, and flaps appear to swap sides against the
/// tree the user drew. `negative_side` says which member belongs on which side.
mod drawn_sides {
    use oristudio_bp::model::GridType;
    use oristudio_bp::optimizer::{
        FlapRequest, LayoutMode, OptimizerCommand, OptimizerProblem, OptimizerRequest,
        OptimizerSymmetry, SymmetryAxis, solve, validate_optimizer_packing,
    };
    use oristudio_bp::tree::Hierarchy;

    /// Three mirror pairs hanging off a spine at different depths, plus a tip on
    /// the axis — the shape the report came from.
    fn request(negative_side: Vec<u32>) -> OptimizerRequest {
        // (id, spine depth, leg length)
        let spec: [(u32, i32, i32); 7] = [
            (1, 1, 1),
            (2, 1, 1),
            (3, 2, 2),
            (4, 2, 2),
            (5, 3, 2),
            (6, 3, 2),
            (7, 4, 1),
        ];
        let dist = |a: (u32, i32, i32), b: (u32, i32, i32)| -> f64 {
            if a.1 == b.1 {
                f64::from(2 * a.2)
            } else {
                f64::from((a.1 - b.1).abs() + a.2 + b.2)
            }
        };
        let mut dist_map = Vec::new();
        for i in 0..spec.len() {
            for j in (i + 1)..spec.len() {
                dist_map.push((spec[i].0, spec[j].0, dist(spec[i], spec[j])));
            }
        }
        OptimizerRequest {
            command: OptimizerCommand::Start,
            use_bh: false,
            layout: LayoutMode::Random,
            random: 3,
            problem: OptimizerProblem {
                grid_type: GridType::Rectangular,
                flaps: spec
                    .iter()
                    .map(|&(id, _, _)| FlapRequest {
                        id,
                        width: 0.0,
                        height: 0.0,
                    })
                    .collect(),
                hierarchies: vec![Hierarchy {
                    leaves: spec.iter().map(|&(id, _, _)| id).collect(),
                    dist_map,
                    parents: Vec::new(),
                }],
            },
            vec: None,
            symmetry: Some(OptimizerSymmetry {
                axis: SymmetryAxis::VerticalHalf,
                partners: vec![(1, 2), (2, 1), (3, 4), (4, 3), (5, 6), (6, 5), (7, 7)],
                negative_side,
            }),
        }
    }

    /// Whether each flap ended up left of the sheet's vertical centre line.
    fn left_of_centre(result: &oristudio_bp::optimizer::OptimizerResult, id: u32) -> bool {
        let flap = result.flaps.iter().find(|flap| flap.id == id).unwrap();
        flap.x < result.width / 2.0
    }

    #[test]
    fn every_pair_lands_on_the_side_it_was_drawn() {
        let request = request(vec![1, 3, 5]);
        for seed in 0..12 {
            let result = solve(&request, Some(seed)).unwrap();
            for (drawn_left, drawn_right) in [(1, 2), (3, 4), (5, 6)] {
                assert!(
                    left_of_centre(&result, drawn_left),
                    "seed {seed}: flap {drawn_left} was drawn left but packed right"
                );
                assert!(
                    !left_of_centre(&result, drawn_right),
                    "seed {seed}: flap {drawn_right} was drawn right but packed left"
                );
            }
        }
    }

    #[test]
    fn reversing_the_drawing_reverses_the_packing() {
        let request = request(vec![2, 4, 6]);
        for seed in 0..6 {
            let result = solve(&request, Some(seed)).unwrap();
            for (drawn_left, drawn_right) in [(2, 1), (4, 3), (6, 5)] {
                assert!(
                    left_of_centre(&result, drawn_left),
                    "seed {seed}: flap {drawn_left}"
                );
                assert!(
                    !left_of_centre(&result, drawn_right),
                    "seed {seed}: flap {drawn_right}"
                );
            }
        }
    }

    #[test]
    fn orienting_never_returns_a_layout_the_checker_rejects() {
        let request = request(vec![1, 3, 5]);
        for seed in 0..12 {
            let result = solve(&request, Some(seed)).unwrap();
            validate_optimizer_packing(&request, &result)
                .unwrap_or_else(|error| panic!("seed {seed}: {error}"));
        }
    }

    /// Mirror *subtrees*, whose partners are not interchangeable: 1 and 2 are
    /// short leaves, 3 and 4 long ones, and each short leaf is a sibling of the
    /// long leaf on its own side. Exchanging a pair here moves a flap to a spot
    /// only ever cleared for its partner, which for these distances is often too
    /// tight — so the orientation pass has to check rather than assume.
    fn subtree_request(negative_side: Vec<u32>) -> OptimizerRequest {
        // (id, side, leg length); a leaf reaches the far side via the two spine
        // edges, so an across-the-axis distance picks up 2.
        let spec: [(u32, i32, i32); 4] = [(1, 0, 1), (3, 0, 3), (2, 1, 1), (4, 1, 3)];
        let dist = |a: (u32, i32, i32), b: (u32, i32, i32)| -> f64 {
            if a.1 == b.1 {
                f64::from(a.2 + b.2)
            } else {
                f64::from(a.2 + 2 + b.2)
            }
        };
        let mut dist_map = Vec::new();
        for i in 0..spec.len() {
            for j in (i + 1)..spec.len() {
                dist_map.push((spec[i].0, spec[j].0, dist(spec[i], spec[j])));
            }
        }
        OptimizerRequest {
            command: OptimizerCommand::Start,
            use_bh: false,
            layout: LayoutMode::Random,
            random: 3,
            problem: OptimizerProblem {
                grid_type: GridType::Rectangular,
                flaps: spec
                    .iter()
                    .map(|&(id, _, _)| FlapRequest {
                        id,
                        width: 0.0,
                        height: 0.0,
                    })
                    .collect(),
                hierarchies: vec![Hierarchy {
                    leaves: spec.iter().map(|&(id, _, _)| id).collect(),
                    dist_map,
                    parents: Vec::new(),
                }],
            },
            vec: None,
            symmetry: Some(OptimizerSymmetry {
                axis: SymmetryAxis::VerticalHalf,
                partners: vec![(1, 2), (2, 1), (3, 4), (4, 3)],
                negative_side,
            }),
        }
    }

    #[test]
    fn a_pair_that_cannot_be_exchanged_keeps_the_layout_valid() {
        // The packing wins over the labelling: where an exchange would not hold,
        // the solver's arrangement stands rather than a broken separation.
        let request = subtree_request(vec![1, 3]);
        for seed in 0..12 {
            let result = solve(&request, Some(seed)).unwrap();
            validate_optimizer_packing(&request, &result).unwrap_or_else(|error| {
                panic!("seed {seed}: orienting produced an invalid layout: {error}")
            });
        }
    }

    #[test]
    fn a_wholly_reversed_layout_is_reflected_rather_than_unpicked_pair_by_pair() {
        // Here the partners are not interchangeable one at a time, so per-pair
        // exchanges get refused. Reflecting the whole layout moves every flap to
        // where its own mirror was, changes no separation, and settles all of
        // them at once — without it these sides would stay as the solver left
        // them.
        let request = subtree_request(vec![1, 3]);
        for seed in 0..12 {
            let result = solve(&request, Some(seed)).unwrap();
            let centre = result.width / 2.0;
            let left = |id: u32| result.flaps.iter().find(|flap| flap.id == id).unwrap().x < centre;
            assert!(
                left(1) && left(3),
                "seed {seed}: drawn-left flaps packed right"
            );
        }
    }

    #[test]
    fn an_empty_drawing_leaves_the_solver_alone() {
        // Nothing declared, nothing moved: the previous behaviour, which is what
        // an older client's request still gets.
        let plain = request(Vec::new());
        for seed in 0..6 {
            validate_optimizer_packing(&plain, &solve(&plain, Some(seed)).unwrap()).unwrap();
        }
    }
}

/// The bridge sends this request as JSON, so the field names have to line up
/// with what `apps/web/src/lib/bpOptimizerSymmetry.ts` writes.
#[test]
fn symmetry_request_round_trips_the_drawn_sides_over_json() {
    let json = r#"{"axis":"verticalHalf","partners":[[1,2],[2,1]],"negativeSide":[1]}"#;
    let parsed: OptimizerSymmetry = serde_json::from_str(json).unwrap();
    assert_eq!(parsed.negative_side, vec![1]);
    assert_eq!(parsed.axis, SymmetryAxis::VerticalHalf);

    // An older client sends no sides at all, and still solves.
    let legacy = r#"{"axis":"verticalHalf","partners":[[1,2],[2,1]]}"#;
    let parsed: OptimizerSymmetry = serde_json::from_str(legacy).unwrap();
    assert!(parsed.negative_side.is_empty());

    let re_encoded = serde_json::to_string(&parsed).unwrap();
    assert!(re_encoded.contains("negativeSide"), "{re_encoded}");
}

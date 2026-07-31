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
    KernelFlap, KernelHierarchy, KernelSymmetry, OptimizerSheet, get_scale, pack_rssl,
    pack_rssl_symmetric, setup_initial_scale, symmetrize,
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
            dist_map.push((i, j, 2 * leg));
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

//! Hand-built crease patterns: frames, the y-flip, rotation, refusals, the
//! fallback, and the exactness classes on a synthetic grid.

use oristudio_precrease::{
    ExactnessClass, Line, PrecreaseError, RefusalReason, SNAP_RADIUS, TOL, Warning, analyze,
};

struct Cp {
    segments: Vec<f64>,
    colors: Vec<i32>,
}

impl Cp {
    fn new() -> Self {
        Self {
            segments: Vec::new(),
            colors: Vec::new(),
        }
    }

    fn seg(&mut self, color: i32, a: [f64; 2], b: [f64; 2]) -> u32 {
        self.segments.extend_from_slice(&[a[0], a[1], b[0], b[1]]);
        self.colors.push(color);
        self.colors.len() as u32 - 1
    }

    fn polygon_border(&mut self, corners: &[[f64; 2]]) {
        for i in 0..corners.len() {
            self.seg(0, corners[i], corners[(i + 1) % corners.len()]);
        }
    }
}

fn close(a: [f64; 2], b: [f64; 2], eps: f64) -> bool {
    (a[0] - b[0]).abs() < eps && (a[1] - b[1]).abs() < eps
}

#[test]
fn asymmetric_cp_maps_into_the_unit_frame_with_a_y_flip() {
    // Model space is y-down: (0, 400) is the on-screen bottom-left corner.
    let mut cp = Cp::new();
    cp.polygon_border(&[[0.0, 0.0], [400.0, 0.0], [400.0, 400.0], [0.0, 400.0]]);
    let up_right = cp.seg(1, [0.0, 400.0], [100.0, 300.0]);
    let high = cp.seg(2, [100.0, 100.0], [200.0, 100.0]);

    let analysis = analyze(&cp.segments, &cp.colors, None).expect("analysis");
    assert_eq!(analysis.components.len(), 1);
    assert!(analysis.unassigned_segments.is_empty());
    assert!(analysis.warnings.is_empty());
    let c = &analysis.components[0];
    let frame = c.frame.expect("frame");
    assert_eq!(frame.origin, [0.0, 400.0]);
    assert_eq!(frame.x_axis, [1.0, 0.0]);
    assert_eq!(frame.y_axis, [0.0, -1.0]);
    assert_eq!(c.segment_indices, vec![up_right, high]);
    // The crease from the bottom-left corner up and right lands at (¼, ¼);
    // without the flip it would read (¼, ¾).
    assert!(close(
        [c.unit_segments[0][2], c.unit_segments[0][3]],
        [0.25, 0.25],
        1e-12
    ));
    // The crease near the top of the screen is high in the unit frame.
    assert!(close(
        [c.unit_segments[1][0], c.unit_segments[1][1]],
        [0.25, 0.75],
        1e-12
    ));
    assert!(close(
        [c.unit_segments[1][2], c.unit_segments[1][3]],
        [0.5, 0.75],
        1e-12
    ));
    let affines = c.affines.expect("affines");
    assert_eq!(affines.model_to_unit, [0.0025, 0.0, 0.0, -0.0025, 0.0, 1.0]);
    let exactness = c.exactness.as_ref().expect("exactness");
    assert_eq!(exactness.class, ExactnessClass::Exact);
    assert_eq!(c.merged_lines.len(), 2);
    assert!(c.merged_lines.iter().all(|l| !l.on_outline));
}

#[test]
fn rotated_square_recovers_the_rotation_and_exact_corners() {
    // A diamond: corners on-screen top (200,0), right (400,200), bottom
    // (200,400), left (0,200); side 200√2.
    let mut cp = Cp::new();
    cp.polygon_border(&[[200.0, 0.0], [400.0, 200.0], [200.0, 400.0], [0.0, 200.0]]);
    cp.seg(1, [200.0, 0.0], [200.0, 400.0]); // vertical diagonal of the diamond
    cp.seg(2, [100.0, 300.0], [300.0, 300.0]); // horizontal chord

    let analysis = analyze(&cp.segments, &cp.colors, None).expect("analysis");
    assert_eq!(analysis.components.len(), 1);
    let c = &analysis.components[0];
    assert!(c.refused.is_none());
    let frame = c.frame.expect("frame");
    let s = std::f64::consts::FRAC_1_SQRT_2;
    assert!(
        close(frame.x_axis, [s, -s], 1e-12),
        "x_axis {:?}",
        frame.x_axis
    );
    assert!((frame.rotation_radians() + std::f64::consts::FRAC_PI_4).abs() < 1e-12);
    assert_eq!(frame.origin, [200.0, 400.0]);
    assert!((frame.width - 200.0 * std::f64::consts::SQRT_2).abs() < 1e-9);
    assert!((frame.height - frame.width).abs() < 1e-9);
    let rect = c.rf_rect.expect("rect");
    assert!((rect.width - 1.0).abs() < 1e-12 && (rect.height - 1.0).abs() < 1e-12);
    // Corners land exactly on the unit square's corners.
    assert!(close(
        frame.model_to_unit([200.0, 400.0]),
        [0.0, 0.0],
        1e-12
    ));
    assert!(close(
        frame.model_to_unit([400.0, 200.0]),
        [1.0, 0.0],
        1e-12
    ));
    assert!(close(frame.model_to_unit([0.0, 200.0]), [0.0, 1.0], 1e-12));
    assert!(close(frame.model_to_unit([200.0, 0.0]), [1.0, 1.0], 1e-12));
    // The diamond's vertical diagonal is the unit square's main diagonal.
    let diagonal = Line::from_points([0.0, 0.0], [1.0, 1.0]).expect("line");
    assert!(c.merged_lines[0].line.approx_eq(&diagonal));
    // The horizontal chord at y = 300 becomes x + y = ½.
    let chord = Line::from_points([0.0, 0.5], [0.5, 0.0]).expect("line");
    assert!(c.merged_lines[1].line.approx_eq(&chord));
    assert_eq!(
        c.exactness.as_ref().expect("exactness").class,
        ExactnessClass::Exact
    );
}

#[test]
fn non_square_rectangle_reports_reference_finder_dimensions() {
    let mut cp = Cp::new();
    cp.polygon_border(&[[0.0, 0.0], [336.0, 0.0], [336.0, 400.0], [0.0, 400.0]]);
    cp.seg(1, [0.0, 400.0], [336.0, 0.0]);
    let analysis = analyze(&cp.segments, &cp.colors, None).expect("analysis");
    let c = &analysis.components[0];
    let frame = c.frame.expect("frame");
    assert_eq!(frame.width, 336.0);
    assert_eq!(frame.height, 400.0);
    assert_eq!(frame.longer(), 400.0);
    let rect = c.rf_rect.expect("rect");
    assert!((rect.width - 0.84).abs() < 1e-15);
    assert!((rect.height - 1.0).abs() < 1e-15);
    let d = c.unit_segments[0];
    assert!(close([d[0], d[1]], [0.0, 0.0], 1e-12) && close([d[2], d[3]], [0.84, 1.0], 1e-12));
}

#[test]
fn hexagonal_sheet_is_refused_with_its_corners() {
    let mut cp = Cp::new();
    let r = 200.0f64;
    let corners: Vec<[f64; 2]> = (0..6)
        .map(|i| {
            let a = std::f64::consts::PI / 3.0 * i as f64;
            [200.0 + r * a.cos(), 200.0 + r * a.sin()]
        })
        .collect();
    cp.polygon_border(&corners);
    let inside = cp.seg(1, [150.0, 200.0], [250.0, 200.0]);
    let analysis = analyze(&cp.segments, &cp.colors, None).expect("analysis");
    assert_eq!(analysis.components.len(), 1);
    let c = &analysis.components[0];
    assert!(c.frame.is_none() && c.exactness.is_none());
    match &c.refused {
        Some(RefusalReason::NonRectangular { vertices }) => assert_eq!(vertices.len(), 6),
        other => panic!("expected a non-rectangular refusal, got {other:?}"),
    }
    // The interior crease is still attached to the refused component.
    assert_eq!(c.segment_indices, vec![inside]);
    assert!(analysis.unassigned_segments.is_empty());
}

#[test]
fn no_border_falls_back_to_the_paper_with_a_warning() {
    let mut cp = Cp::new();
    cp.seg(1, [-200.0, 200.0], [200.0, -200.0]);
    cp.seg(2, [0.0, -200.0], [0.0, 200.0]);
    let outside = cp.seg(1, [300.0, 0.0], [400.0, 0.0]);

    assert_eq!(
        analyze(&cp.segments, &cp.colors, None),
        Err(PrecreaseError::NoSheet)
    );

    let paper = [-200.0, -200.0, 200.0, 200.0];
    let analysis = analyze(&cp.segments, &cp.colors, Some(paper)).expect("analysis");
    assert_eq!(analysis.warnings, vec![Warning::NoBorderFallback { paper }]);
    assert_eq!(analysis.components.len(), 1);
    let c = &analysis.components[0];
    assert!(c.is_fallback);
    let frame = c.frame.expect("frame");
    assert_eq!(frame.origin, [-200.0, 200.0]);
    assert_eq!(c.segment_indices, vec![0, 1]);
    assert_eq!(analysis.unassigned_segments, vec![outside]);
    assert_eq!(
        c.exactness.as_ref().expect("exactness").class,
        ExactnessClass::Exact
    );
}

#[test]
fn disjoint_sheets_are_split_and_strays_are_unassigned() {
    let mut cp = Cp::new();
    cp.polygon_border(&[[0.0, 0.0], [100.0, 0.0], [100.0, 100.0], [0.0, 100.0]]);
    cp.polygon_border(&[[300.0, 0.0], [400.0, 0.0], [400.0, 100.0], [300.0, 100.0]]);
    let left = cp.seg(1, [0.0, 0.0], [100.0, 100.0]);
    let right = cp.seg(2, [300.0, 100.0], [400.0, 0.0]);
    let stray = cp.seg(1, [150.0, 50.0], [250.0, 50.0]);
    let analysis = analyze(&cp.segments, &cp.colors, None).expect("analysis");
    assert_eq!(analysis.components.len(), 2);
    assert_eq!(analysis.components[0].segment_indices, vec![left]);
    assert_eq!(analysis.components[1].segment_indices, vec![right]);
    assert_eq!(analysis.unassigned_segments, vec![stray]);
    assert_eq!(
        analysis.components[0].border_segment_indices,
        vec![0, 1, 2, 3]
    );
    assert_eq!(
        analysis.components[1].border_segment_indices,
        vec![4, 5, 6, 7]
    );
}

#[test]
fn a_crease_along_the_border_is_flagged_on_outline() {
    let mut cp = Cp::new();
    cp.polygon_border(&[[0.0, 0.0], [400.0, 0.0], [400.0, 400.0], [0.0, 400.0]]);
    cp.seg(1, [0.0, 400.0], [200.0, 400.0]); // mountain drawn over the bottom edge
    cp.seg(1, [0.0, 200.0], [400.0, 200.0]);
    let analysis = analyze(&cp.segments, &cp.colors, None).expect("analysis");
    let c = &analysis.components[0];
    assert_eq!(c.merged_lines.len(), 2);
    assert!(c.merged_lines[0].on_outline);
    assert!(!c.merged_lines[1].on_outline);
}

#[test]
fn malformed_input_is_a_typed_error() {
    assert_eq!(
        analyze(&[0.0, 0.0, 1.0], &[1], None),
        Err(PrecreaseError::MalformedSegments { len: 3 })
    );
    assert_eq!(
        analyze(&[0.0, 0.0, 1.0, 1.0], &[], None),
        Err(PrecreaseError::ColorCountMismatch {
            segments: 1,
            colors: 0
        })
    );
    assert_eq!(
        analyze(&[0.0, 0.0, f64::NAN, 1.0], &[1], None),
        Err(PrecreaseError::NonFiniteCoordinate { index: 2 })
    );
    assert_eq!(
        analyze(&[0.0, 0.0, 1.0, 1.0], &[1], Some([0.0, 0.0, 0.0, 1.0])),
        Err(PrecreaseError::InvalidPaperFallback)
    );
}

#[test]
fn skewed_borders_are_accepted_near_rectangular_and_refused_beyond() {
    // One corner pulled 0.4 model units (1e-3 of the side): near rectangle.
    let mut cp = Cp::new();
    cp.polygon_border(&[[0.0, 0.0], [400.0, 0.0], [400.4, 400.0], [0.0, 400.0]]);
    cp.seg(1, [0.0, 200.0], [400.2, 200.0]);
    let analysis = analyze(&cp.segments, &cp.colors, None).expect("analysis");
    let c = &analysis.components[0];
    assert!(c.frame.is_some());
    assert!(c.outline_residual > 5e-4 && c.outline_residual < SNAP_RADIUS);
    assert_eq!(c.segment_indices, vec![4]);
    let e = c.exactness.as_ref().expect("exactness");
    assert_ne!(e.class, ExactnessClass::Exact);
    assert!(e.residuals.outline > TOL);

    // Pulled 20 units (5e-2): refused.
    let mut cp = Cp::new();
    cp.polygon_border(&[[0.0, 0.0], [400.0, 0.0], [420.0, 400.0], [0.0, 400.0]]);
    let analysis = analyze(&cp.segments, &cp.colors, None).expect("analysis");
    assert!(matches!(
        analysis.components[0].refused,
        Some(RefusalReason::NonRectangular { .. })
    ));
}

/// A 1/6 grid on a 400-unit square with every grid vertex split, optionally
/// jittering the interior vertices by `jitter` sheet units.
fn grid6(jitter: f64) -> Cp {
    const N: usize = 6;
    let side = 400.0;
    let pos = |i: usize, j: usize| -> [f64; 2] {
        let mut p = [side * i as f64 / N as f64, side * j as f64 / N as f64];
        let interior = i > 0 && i < N && j > 0 && j < N;
        if interior && jitter > 0.0 {
            // Deterministic pattern with both signs and both axes exercised.
            let k = (i * 7 + j * 3) % 4;
            let (sx, sy) = match k {
                0 => (1.0, -0.5),
                1 => (-1.0, 1.0),
                2 => (0.5, 1.0),
                _ => (-0.5, -1.0),
            };
            // Scaled by an irrational factor so the perturbed vertices do
            // not accidentally land on a finer rational lattice (a jitter
            // in whole model units would, and that design would be exact).
            let irrational = std::f64::consts::PI / 3.0;
            p[0] += sx * jitter * side * irrational;
            p[1] += sy * jitter * side * irrational;
        }
        p
    };
    let mut cp = Cp::new();
    for i in 0..=N {
        for j in 0..N {
            // Vertical pieces at x = i/6, horizontal pieces at y = i/6.
            let vertical_is_border = i == 0 || i == N;
            cp.seg(
                if vertical_is_border { 0 } else { 1 },
                pos(i, j),
                pos(i, j + 1),
            );
            cp.seg(
                if vertical_is_border { 0 } else { 2 },
                pos(j, i),
                pos(j + 1, i),
            );
        }
    }
    cp
}

#[test]
fn exact_grid_is_exact_and_snaps_to_itself() {
    let cp = grid6(0.0);
    let analysis = analyze(&cp.segments, &cp.colors, None).expect("analysis");
    assert_eq!(analysis.components.len(), 1);
    let c = &analysis.components[0];
    assert_eq!(c.border_segment_indices.len(), 24);
    assert_eq!(c.merged_lines.len(), 10);
    let e = c.exactness.as_ref().expect("exactness");
    assert_eq!(e.class, ExactnessClass::Exact);
    assert!(e.residuals.merge_max < 1e-12 && e.residuals.offset_max < 1e-12);
    assert_eq!(e.snapped.lines.len(), 10);
    assert_eq!(e.snapped.max_displacement_unit, 0.0);
    assert!(e.snapped.complete);
    for (snapped, merged) in e.snapped.lines.iter().zip(&c.merged_lines) {
        assert!(snapped.line.approx_eq_within(&merged.line, 1e-15));
        let lattice = snapped.lattice.expect("lattice element");
        assert!(lattice.denominator == 6 || lattice.denominator == 3 || lattice.denominator == 2);
    }
}

#[test]
fn jittered_grid_is_snappable_with_a_sensible_displacement() {
    let cp = grid6(1e-3);
    let analysis = analyze(&cp.segments, &cp.colors, None).expect("analysis");
    let c = &analysis.components[0];
    // The bent pieces no longer merge at TOL …
    assert!(c.merged_lines.len() > 10);
    let e = c.exactness.as_ref().expect("exactness");
    assert_eq!(
        e.class,
        ExactnessClass::Snappable,
        "residuals {:?} off lines {} off vertices {} dupes {} inconsistent {} family {:?}",
        e.residuals,
        e.off_lattice_lines,
        e.off_lattice_vertices,
        e.near_duplicate_lines,
        e.inconsistent_vertices,
        e.family
    );
    assert!(e.residuals.merge_max > TOL || e.residuals.angle_max > TOL);
    // … but snap back onto the ten grid lines, each moved by about the jitter.
    assert_eq!(e.snapped.lines.len(), 10);
    assert!(e.snapped.complete);
    assert!(e.snapped.max_displacement_unit > 5e-4);
    assert!(e.snapped.max_displacement_unit < SNAP_RADIUS);
    assert!(
        (e.snapped.max_displacement_model - e.snapped.max_displacement_unit * 400.0).abs() < 1e-9
    );
    assert_eq!(e.snapped.family, "odd_3_rational");
    let exact = grid6(0.0);
    let exact = analyze(&exact.segments, &exact.colors, None).expect("analysis");
    for snapped in &e.snapped.lines {
        assert!(
            exact.components[0]
                .merged_lines
                .iter()
                .any(|m| m.line.approx_eq(&snapped.line)),
            "snapped line {:?} is not a grid line",
            snapped.line
        );
    }
}

#[test]
fn heavily_jittered_grid_is_off_lattice() {
    let cp = grid6(5e-2);
    let analysis = analyze(&cp.segments, &cp.colors, None).expect("analysis");
    let e = analysis.components[0]
        .exactness
        .as_ref()
        .expect("exactness");
    assert_eq!(e.class, ExactnessClass::OffLattice);
    assert!(e.off_lattice_lines > 0);
    assert!(e.off_lattice_vertices > 0);
    assert!(!e.snapped.complete);
    assert!(e.snapped.max_displacement_unit >= SNAP_RADIUS);
}

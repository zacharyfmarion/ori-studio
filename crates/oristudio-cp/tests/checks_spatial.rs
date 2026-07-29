//! Generalised vertex-closure checks.
//!
//! The cases here are the ones Phase 0 found by measurement, not by reasoning:
//! the `|w|` trap that silently accepts every Maekawa violation, and the two
//! independent ways a fan can be indeterminate while looking exactly like a
//! parity failure.

use oristudio_cp::checks_spatial::{
    Indeterminate, VertexFan, VertexRegime, spatial_vertex_reports, vertex_closure_residual,
    vertex_dof, vertex_fan, vertex_regime,
};
use oristudio_cp::geometry::{FoldMagnitude, LineColor, LineSegment, Point};
use oristudio_cp::model::CreasePatternModel;

const ORIGIN: Point = Point::new(0.0, 0.0);

/// Build a fan directly from `(theta_degrees, rho_degrees)`, bypassing topology.
fn fan(creases: &[(f64, f64)]) -> VertexFan {
    let mut sorted: Vec<(f64, f64)> = creases
        .iter()
        .map(|&(theta, rho)| (theta.to_radians(), rho.to_radians()))
        .collect();
    sorted.sort_by(|a, b| a.0.partial_cmp(&b.0).expect("finite"));
    VertexFan {
        point: ORIGIN,
        creases: sorted,
        indeterminate: None,
    }
}

fn residual_degrees(creases: &[(f64, f64)]) -> f64 {
    vertex_closure_residual(&fan(creases)).to_degrees()
}

const M: f64 = -180.0;
const V: f64 = 180.0;

#[test]
fn a_maekawa_violating_vertex_reports_360_not_zero() {
    // THE trap. Both VVVM and VVVV compose to the identity *rotation*; only the
    // quaternion lift tells them apart. Measuring with `2*acos(|w|)` would report
    // both as a perfect zero and silently accept every Maekawa violation.
    assert!(residual_degrees(&[(0.0, V), (90.0, V), (180.0, V), (270.0, M)]) < 1e-9);
    assert!(
        (residual_degrees(&[(0.0, V), (90.0, V), (180.0, V), (270.0, V)]) - 360.0).abs() < 1e-9
    );
    assert!(
        (residual_degrees(&[(0.0, M), (90.0, M), (180.0, V), (270.0, V)]) - 360.0).abs() < 1e-9
    );
}

#[test]
fn flat_foldable_vertices_close() {
    // theta 0/60/150/270 -> sectors 60/90/120/90; opposite sectors sum to 180,
    // so 2D Kawasaki holds.
    for mountain in 0..4 {
        let creases: Vec<(f64, f64)> = [0.0, 60.0, 150.0, 270.0]
            .iter()
            .enumerate()
            .map(|(index, &theta)| (theta, if index == mountain { M } else { V }))
            .collect();
        assert!(
            residual_degrees(&creases) < 1e-9,
            "single-mountain assignment {mountain} should close"
        );
    }
}

#[test]
fn a_kawasaki_violating_vertex_does_not_close() {
    assert!(residual_degrees(&[(0.0, M), (70.0, V), (180.0, V), (260.0, V)]) > 1.0);
}

#[test]
fn closure_subsumes_maekawa_parity_for_odd_degrees() {
    // Odd degree cannot flat-fold: M - V has the parity of the degree, so it can
    // never be +/-2. Every assignment must fail.
    for assignment in 0..8u8 {
        let creases: Vec<(f64, f64)> = [0.0, 120.0, 240.0]
            .iter()
            .enumerate()
            .map(|(index, &theta)| (theta, if assignment >> index & 1 == 1 { M } else { V }))
            .collect();
        assert!(
            residual_degrees(&creases) > 1.0,
            "degree-3 assignment {assignment:b} must not close"
        );
    }
}

#[test]
fn a_non_flat_degree_4_vertex_closes_on_the_one_dof_family() {
    // Reproduces Wong section 3 on a non-singular Kawasaki vertex: the fold
    // angles couple as rho1 = -rho3, rho2 = rho4. (The square vertex is the
    // documented singularity where the angles decouple, so it is unusable here.)
    let creases = [
        (0.0, -50.0),
        (60.0, 120.235),
        (150.0, 50.0),
        (270.0, 120.235),
    ];
    let residual = residual_degrees(&creases);
    assert!(
        residual < 0.01,
        "expected the coupled family to close, got {residual} degrees"
    );
}

#[test]
fn degree_of_freedom_uses_jacobian_rank_not_n_minus_3() {
    // A point sitting mid-way along a straight crease is degree 2, and the naive
    // `n - 3` would underflow. The constraints collapse to rho1 = rho2, so the
    // true answer is 1. These are everywhere in a real pattern.
    let collinear = fan(&[(0.0, 90.0), (180.0, 90.0)]);
    assert_eq!(vertex_dof(&collinear), 1);

    // A degree-4 vertex has one rigid degree of freedom.
    let degree4 = fan(&[
        (0.0, -50.0),
        (60.0, 120.235),
        (150.0, 50.0),
        (270.0, 120.235),
    ]);
    assert_eq!(vertex_dof(&degree4), 1);
}

#[test]
fn a_developable_degree_3_vertex_is_rigid() {
    // The link of a vertex is a closed spherical linkage: a triangle is a rigid
    // truss, so the joint angles are forced rather than chosen. Users need to be
    // told "this cannot fold at all", not "these angles conflict".
    let degree3 = fan(&[(0.0, 30.0), (120.0, 30.0), (240.0, 30.0)]);
    assert_eq!(vertex_dof(&degree3), 0);
}

// --------------------------------------------------------------- determinacy

fn crease(
    ax: f64,
    ay: f64,
    bx: f64,
    by: f64,
    color: LineColor,
    degrees: Option<f64>,
) -> LineSegment {
    LineSegment::from_coordinates(ax, ay, bx, by)
        .with_line_color(color)
        .with_fold_magnitude(degrees.and_then(FoldMagnitude::from_degrees))
}

#[test]
fn an_unassigned_crease_makes_the_vertex_indeterminate() {
    // Mapping unassigned to rho = 0 would fabricate an answer AND drop the crease
    // from the fan, which lets an odd-degree vertex close for the wrong reason.
    // Measured on the scraped corpus: degree-3 closure went 56% -> 0% once
    // unassigned creases were excluded.
    let lines = vec![
        crease(0.0, 0.0, 100.0, 0.0, LineColor::Red1, Some(90.0)),
        crease(0.0, 0.0, 0.0, 100.0, LineColor::None, None),
    ];
    let built = vertex_fan(ORIGIN, &lines, false);
    assert_eq!(built.indeterminate, Some(Indeterminate::UnassignedCrease));
}

#[test]
fn an_unsplit_junction_makes_the_vertex_indeterminate() {
    let lines = vec![crease(0.0, 0.0, 0.0, 100.0, LineColor::Red1, Some(90.0))];
    let built = vertex_fan(ORIGIN, &lines, true);
    assert_eq!(built.indeterminate, Some(Indeterminate::UnsplitJunction));
}

#[test]
fn an_unsplit_t_junction_is_detected_from_the_model_and_never_reported_as_a_violation() {
    // The failure this guards against is a FALSE POSITIVE: endpoint clustering
    // sees degree 2 instead of 4 and produces a 360-degree residual that is
    // indistinguishable from a real Maekawa violation.
    let mut model = CreasePatternModel::default();
    // One unbroken horizontal crease...
    model.add_line_segment(crease(-100.0, 0.0, 100.0, 0.0, LineColor::Blue2, None));
    // ...with a non-classic crease ending on its middle.
    model.add_line_segment(crease(0.0, 0.0, 0.0, 100.0, LineColor::Red1, Some(90.0)));

    let reports = spatial_vertex_reports(&model);
    let at_junction = reports
        .iter()
        .find(|report| report.point.distance(ORIGIN) < 1e-6)
        .expect("the T-junction is a spatial vertex");

    assert_eq!(
        at_junction.indeterminate,
        Some(Indeterminate::UnsplitJunction)
    );
    assert_eq!(
        at_junction.residual, None,
        "an indeterminate vertex must report no residual, never a violation"
    );
}

// ------------------------------------------------------------------ dispatch

#[test]
fn dispatch_is_per_vertex_so_flat_regions_keep_the_oriedita_check() {
    let classic = vec![
        crease(0.0, 0.0, 100.0, 0.0, LineColor::Red1, None),
        crease(0.0, 0.0, 0.0, 100.0, LineColor::Blue2, None),
    ];
    assert_eq!(vertex_regime(&classic), VertexRegime::Flat);

    let mixed = vec![
        crease(0.0, 0.0, 100.0, 0.0, LineColor::Red1, None),
        crease(0.0, 0.0, 0.0, 100.0, LineColor::Blue2, Some(90.0)),
    ];
    assert_eq!(vertex_regime(&mixed), VertexRegime::Spatial);
}

#[test]
fn a_wholly_classic_document_produces_no_spatial_reports() {
    // The flat pipeline keeps every Oriedita document entirely to itself.
    let mut model = CreasePatternModel::default();
    model.add_line_segment(crease(-100.0, 0.0, 100.0, 0.0, LineColor::Red1, None));
    model.add_line_segment(crease(0.0, -100.0, 0.0, 100.0, LineColor::Blue2, None));
    assert_eq!(spatial_vertex_reports(&model), vec![]);
}

#[test]
fn a_mixed_document_reports_only_the_non_flat_vertices() {
    let mut model = CreasePatternModel::default();
    // A classic crossing, far from anything else.
    model.add_line_segment(crease(-100.0, 500.0, 100.0, 500.0, LineColor::Red1, None));
    model.add_line_segment(crease(0.0, 400.0, 0.0, 600.0, LineColor::Blue2, None));
    // A non-classic crease elsewhere.
    model.add_line_segment(crease(-100.0, 0.0, 100.0, 0.0, LineColor::Red1, Some(90.0)));

    let reports = spatial_vertex_reports(&model);
    assert!(
        !reports.is_empty(),
        "the angled crease's vertices are spatial"
    );
    for report in &reports {
        assert!(
            report.point.y.abs() < 1e-6,
            "a purely classic vertex at y={} must stay with the flat checker",
            report.point.y
        );
    }
}

// ------------------------------------------------------ command-level dispatch

/// A classic vertex keeps Oriedita's verdict verbatim, and its non-flat
/// neighbour is answered by the closure check instead — in the same document.
#[test]
fn dispatched_camv_splits_a_mixed_document_between_the_two_checkers() {
    use oristudio_cp::checks_spatial::dispatched_camv;

    let mut model = CreasePatternModel::default();
    // A degree-3 all-valley crossing: Oriedita flags it (odd degree cannot
    // satisfy Maekawa), and it must keep doing so because it is fully classic.
    for theta in [0.0_f64, 120.0, 240.0] {
        let (sin, cos) = theta.to_radians().sin_cos();
        model.add_line_segment(crease(
            0.0,
            500.0,
            100.0 * cos,
            500.0 + 100.0 * sin,
            LineColor::Blue2,
            None,
        ));
    }
    // Elsewhere, a non-classic crease.
    model.add_line_segment(crease(-100.0, 0.0, 100.0, 0.0, LineColor::Red1, Some(90.0)));

    let dispatched = dispatched_camv(&model);

    assert!(
        dispatched
            .flat
            .iter()
            .any(|violation| violation.point.distance(Point::new(0.0, 500.0)) < 1e-6),
        "the classic degree-3 vertex must still get Oriedita's verdict"
    );
    assert!(
        dispatched
            .flat
            .iter()
            .all(|violation| violation.point.y.abs() > 1e-6),
        "no flat verdict may be issued at the non-classic vertices"
    );
    assert!(
        !dispatched.spatial.is_empty(),
        "the non-classic vertices go to the closure check"
    );
    assert!(
        dispatched
            .spatial
            .iter()
            .all(|report| report.point.y.abs() < 1e-6),
        "no spatial report may be issued at the classic vertex"
    );
}

/// A wholly classic document must produce exactly what the Oriedita check alone
/// produces — the port stays the authority for flat patterns.
#[test]
fn dispatched_camv_matches_check4_exactly_on_a_classic_document() {
    use oristudio_cp::checks::check4;
    use oristudio_cp::checks_spatial::dispatched_camv;

    let mut model = CreasePatternModel::default();
    for theta in [0.0_f64, 90.0, 180.0, 270.0] {
        let (sin, cos) = theta.to_radians().sin_cos();
        model.add_line_segment(crease(
            0.0,
            0.0,
            100.0 * cos,
            100.0 * sin,
            LineColor::Blue2,
            None,
        ));
    }
    model.add_line_segment(crease(-100.0, -100.0, 100.0, -100.0, LineColor::Red1, None));

    let dispatched = dispatched_camv(&model);
    assert_eq!(dispatched.flat, check4(&model));
    assert!(dispatched.spatial.is_empty());
}

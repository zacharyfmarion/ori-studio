//! Generalised vertex-closure checks.
//!
//! The cases here are the ones Phase 0 found by measurement, not by reasoning:
//! the `|w|` trap that silently accepts every Maekawa violation, and the two
//! independent ways a fan can be indeterminate while looking exactly like a
//! parity failure.

use oristudio_cp::checks_spatial::{
    Indeterminate, Unknowable, VertexFan, VertexRegime, VertexVerdict, dispatched_camv,
    interior_border_segments, spatial_vertex_reports, vertex_closure_residual, vertex_dof,
    vertex_fan, vertex_regime,
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

// ------------------------------------------------------------ boundary vertices

/// The closure condition applies only to **interior** vertices.
///
/// Regression for a real report: a hand-authored non-flat pattern that folds
/// fine produced eight "degree 1 is rigid" errors, all at points where a 90
/// degree crease meets the paper edge. Border segments contribute no rotation
/// and so are correctly absent from the fan — but that leaves a degree-1 fan,
/// which then looks rigid. The mistake was applying closure at all: at a point
/// on the paper edge there is no loop to walk, so there is no constraint.
#[test]
fn a_crease_meeting_the_paper_edge_is_not_a_closure_violation() {
    let mut model = CreasePatternModel::default();
    // The exact shape from the report: two border segments meeting at a corner,
    // with one 90-degree crease running inward from it.
    model.add_line_segment(crease(0.0, -300.0, 50.0, -250.0, LineColor::Black0, None));
    model.add_line_segment(crease(50.0, -250.0, 350.0, 50.0, LineColor::Black0, None));
    model.add_line_segment(crease(
        50.0,
        -250.0,
        50.0,
        50.0,
        LineColor::Blue2,
        Some(90.0),
    ));

    let at_edge = spatial_vertex_reports(&model)
        .into_iter()
        .find(|report| report.point.distance(Point::new(50.0, -250.0)) < 1e-6)
        .expect("a vertex on the paper boundary must still get a verdict");

    assert_eq!(
        at_edge.verdict,
        VertexVerdict::Unknowable(Unknowable::PaperEdge),
        "a vertex on the paper boundary has no closure constraint, so the verdict \
         must say there was nothing to check — never a violation"
    );
    assert_eq!(
        at_edge.residual, None,
        "and it must carry no residual: the quaternion product of a boundary fan \
         is a finite number that describes nothing"
    );
    assert!(
        !at_edge.is_rigid(),
        "a degree-1 crease running to the paper edge is unconstrained, not rigid"
    );
}

/// The gate must not silence genuine interior failures.
#[test]
fn removing_the_border_restores_the_closure_check() {
    let mut model = CreasePatternModel::default();
    // Same fan shape, but the two boundary segments are creases instead, so the
    // paper does wrap around the point and closure applies again.
    model.add_line_segment(crease(0.0, -300.0, 50.0, -250.0, LineColor::Red1, None));
    model.add_line_segment(crease(50.0, -250.0, 350.0, 50.0, LineColor::Red1, None));
    model.add_line_segment(crease(
        50.0,
        -250.0,
        50.0,
        50.0,
        LineColor::Blue2,
        Some(90.0),
    ));

    let at_vertex = spatial_vertex_reports(&model)
        .into_iter()
        .find(|report| report.point.distance(Point::new(50.0, -250.0)) < 1e-6);

    assert!(
        at_vertex.is_some(),
        "an interior vertex must still be checked"
    );
}

// --------------------------------------------------- borders inside the paper

/// A 200x200 ring: an outer square of border, an inner square of border, and
/// four radial creases joining them.
///
/// `calculate_faces` traces every positive-area bounded region, so the hole
/// comes back **filled** — 5 faces, past the Euler gate — and the eight vertices
/// where the creases meet the two borders are genuinely interior to the object
/// that gets folded. `is_interior_vertex` declines all eight anyway, for
/// touching a `Black0` segment, so the closure check examines nothing at all.
fn annulus(inner_angle_degrees: f64) -> CreasePatternModel {
    let mut model = CreasePatternModel::default();
    let outer = [
        (0.0, 0.0),
        (200.0, 0.0),
        (200.0, 200.0),
        (0.0, 200.0),
        (0.0, 0.0),
    ];
    let inner = [
        (50.0, 50.0),
        (150.0, 50.0),
        (150.0, 150.0),
        (50.0, 150.0),
        (50.0, 50.0),
    ];
    for ring in [outer, inner] {
        for pair in ring.windows(2) {
            model.add_line_segment(crease(
                pair[0].0,
                pair[0].1,
                pair[1].0,
                pair[1].1,
                LineColor::Black0,
                None,
            ));
        }
    }
    for (from, to) in [
        ((0.0, 0.0), (50.0, 50.0)),
        ((200.0, 0.0), (150.0, 50.0)),
        ((200.0, 200.0), (150.0, 150.0)),
        ((0.0, 200.0), (50.0, 150.0)),
    ] {
        model.add_line_segment(crease(
            from.0,
            from.1,
            to.0,
            to.1,
            LineColor::Red1,
            Some(inner_angle_degrees),
        ));
    }
    model
}

#[test]
fn the_closure_check_examines_nothing_on_an_annulus() {
    // Not the bug — the *reason* the bug is invisible, pinned so a later change
    // to `is_interior_vertex` cannot quietly move it.
    //
    // What changed with the verdicts is that "examines nothing" is now *said*
    // rather than left as an empty list. The count of checks is still zero; the
    // count of reports is not, and a report carrying `Unknowable(PaperEdge)` is
    // what keeps the empty error list from reading as a clean bill of health.
    let dispatched = dispatched_camv(&annulus(90.0));

    assert!(
        dispatched
            .spatial
            .iter()
            .all(|report| report.verdict == VertexVerdict::Unknowable(Unknowable::PaperEdge)),
        "every vertex here touches a border, so the closure check declines all of them: {:?}",
        dispatched.spatial
    );
    assert!(
        !dispatched.spatial.is_empty(),
        "and it must say so, rather than returning nothing at all"
    );
    assert!(
        dispatched.flat.is_empty(),
        "and the flat branch is not reached either"
    );
}

// ------------------------------------------- a vertex nothing can be said for

/// The failing vertex of `solve/failure_case.osf`, hand-built.
///
/// Six creases at one interior point: five decided, one with no assignment. The
/// decided five are two tetrahedral valleys at 109.4712206, one at 70.5287794,
/// and two 90-degree mountains — real design angles, not a synthesised
/// counterexample. The committed FOLD of this same fan is
/// `tests/fixtures/fold-angle/unreachable-undecided-vertex.fold`, and
/// `verify_fold_fixtures.rs` pins that the two agree.
///
/// The rim is a closed border through the six crease ends, for the same reason
/// the shipped fold-angle fixtures have one: without it every ray ends at a
/// degree-1 *interior* vertex, which is rigid, and the model reports six errors
/// that are about the drawing rather than about the vertex under test.
fn unreachable_undecided_vertex() -> CreasePatternModel {
    let mut model = CreasePatternModel::default();
    let mut rim: Vec<(f64, f64)> = Vec::new();
    for (theta_degrees, rho_degrees) in [
        (-90.0_f64, None),
        (0.0, Some(109.4712206_f64)),
        (45.0, Some(-90.0)),
        (90.0, Some(70.5287794)),
        (135.0, Some(-90.0)),
        (180.0, Some(109.4712206)),
    ] {
        let radians = theta_degrees.to_radians();
        let end = (100.0 * radians.cos(), 100.0 * radians.sin());
        let (color, magnitude) = match rho_degrees {
            None => (LineColor::None, None),
            Some(degrees) if degrees < 0.0 => (LineColor::Red1, Some(-degrees)),
            Some(degrees) => (LineColor::Blue2, Some(degrees)),
        };
        model.add_line_segment(crease(0.0, 0.0, end.0, end.1, color, magnitude));
        rim.push(end);
    }
    // The ends are already in ascending angular order, so joining them in order
    // gives a simple star-shaped polygon.
    for index in 0..rim.len() {
        let from = rim[index];
        let to = rim[(index + 1) % rim.len()];
        model.add_line_segment(crease(from.0, from.1, to.0, to.1, LineColor::Black0, None));
    }
    model
}

/// **The regression `implementation-plans/never-report-silence.md` exists for.**
///
/// One undecided crease, and no angle for it closes the vertex — so the pattern
/// cannot be folded whatever the user does next at this vertex. The checker used
/// to say nothing at all about it: `vertex_fan` flags the fan
/// `UnassignedCrease`, `report_for` set no residual, and `spatial_closure_diagnostics`
/// skipped every report without one. Zero errors, a clean HUD, and a folder that
/// refuses.
///
/// The two halves of the fix, both asserted here, because either alone is the
/// old bug in a new place:
///
/// 1. The vertex is **Broken**, at k = 1, which means the fan handed to the
///    solver kept the undecided crease. Dropping it instead — which is what the
///    flat check does — leaves a degree-5 fan whose residual is 70.53 degrees,
///    a number about a vertex that does not exist.
/// 2. It reaches the user, as a `CheckCamv` error entry carrying the bracket.
#[test]
fn a_vertex_no_angle_can_close_is_reported_rather_than_skipped() {
    use oristudio_cp::checks_spatial::Broken;

    let model = unreachable_undecided_vertex();
    let dispatched = dispatched_camv(&model);

    let broken: Vec<_> = dispatched
        .spatial
        .iter()
        .filter(|report| matches!(report.verdict, VertexVerdict::Broken(_)))
        .collect();
    assert_eq!(
        broken.len(),
        1,
        "exactly one vertex here cannot fold: {:?}",
        dispatched.spatial
    );
    let report = broken[0];
    assert!(report.point.distance(ORIGIN) < 1e-9);
    assert_eq!(
        report.residual, None,
        "there is no residual to report: the vertex has no state yet, which is \
         precisely why the residual-driven check said nothing"
    );

    let VertexVerdict::Broken(Broken::NoAngleCloses { unknowns, closest }) = report.verdict else {
        panic!(
            "expected an unreachable-closure verdict, got {:?}",
            report.verdict
        );
    };
    assert_eq!(unknowns, 1);
    let closest = closest.expect("the refusal must say how close the vertex can get");
    assert!(
        (closest - 65.9579).abs() < 1e-3,
        "swept independently over the whole range at 0.001 degrees, the best \
         achievable residual is 65.958 degrees; the solver reports {closest}"
    );
    assert!(
        (closest - 70.5288).abs() > 1.0,
        "70.53 is the residual of the fan with the undecided crease *dropped*. \
         Reporting it would be describing a vertex the document does not have"
    );
}

/// And it reaches the user, in the check they actually run.
#[test]
fn the_unreachable_vertex_produces_a_camv_error_entry() {
    use oristudio_cp::{CreasePatternCommand, CreasePatternDocument, OperationId, execute_command};

    let mut document = CreasePatternDocument {
        crease_pattern: unreachable_undecided_vertex(),
        ..CreasePatternDocument::default()
    };
    let result = execute_command(
        &mut document,
        CreasePatternCommand::new(OperationId::CheckCamv),
    )
    .expect("CheckCamv is supported");

    let errors: Vec<_> = result
        .diagnostic_entries
        .iter()
        .filter(|entry| entry.severity == "error")
        .collect();
    assert_eq!(
        errors.len(),
        1,
        "the check found {} errors; before the verdicts it found none at all: {:?}",
        errors.len(),
        result.diagnostic_entries
    );
    let entry = errors[0];
    assert_eq!(entry.rule.as_deref(), Some("ClosureUnreachable"));
    assert!(
        entry
            .point
            .is_some_and(|point| point.distance(ORIGIN) < 1e-9),
        "the entry must locate the vertex — 'which vertex?' is the question the \
         fold-blocked dialog could not answer"
    );
    assert!(
        entry
            .residual_degrees
            .is_some_and(|degrees| (degrees - 65.9579).abs() < 1e-3),
        "the bracket rides structurally, so the frontend can word it: {:?}",
        entry.residual_degrees
    );
}

#[test]
fn a_border_with_paper_on_both_sides_is_named() {
    let borders = interior_border_segments(&annulus(90.0));

    assert_eq!(
        borders.len(),
        4,
        "the four inner-square segments have paper on both sides; the four outer \
         ones are the real paper edge"
    );
    for border in &borders {
        assert!(
            (50.0..=150.0).contains(&border.point.x) && (50.0..=150.0).contains(&border.point.y),
            "an inner-ring midpoint, not an outer one: {:?}",
            border.point
        );
    }
}

#[test]
fn a_plain_square_has_no_interior_border() {
    let mut model = CreasePatternModel::default();
    for pair in [
        ((0.0, 0.0), (200.0, 0.0)),
        ((200.0, 0.0), (200.0, 200.0)),
        ((200.0, 200.0), (0.0, 200.0)),
        ((0.0, 200.0), (0.0, 0.0)),
    ] {
        model.add_line_segment(crease(
            pair.0.0,
            pair.0.1,
            pair.1.0,
            pair.1.1,
            LineColor::Black0,
            None,
        ));
    }
    model.add_line_segment(crease(0.0, 0.0, 200.0, 200.0, LineColor::Red1, Some(90.0)));

    assert!(interior_border_segments(&model).is_empty());
}

/// The dispatch pays for the arrangement only where the spatial branch is the
/// one making a claim. An all-classic document's `CheckCamv` output has to stay
/// byte-identical to Oriedita's, and that is what this pins.
#[test]
fn an_all_classic_annulus_reports_no_interior_border_through_the_dispatch() {
    let mut classic = annulus(90.0);
    for segment in &mut classic.line_segments {
        *segment = segment.clone().with_fold_magnitude(None);
    }

    let dispatched = dispatched_camv(&classic);

    assert!(
        dispatched.interior_borders.is_empty(),
        "no non-classic crease, so nothing consults it and nothing pays for it"
    );
    // The borders are still there; only the dispatch declines to look.
    assert_eq!(interior_border_segments(&classic).len(), 4);
}

/// The spatial half of `CheckCamv` speaks a fixed, four-word vocabulary of
/// `rule` codes, and the frontend has a translated sentence for each.
///
/// Neither language can see the other's table. The web side has its own
/// exhaustive switch over the same four literals
/// (`cp-workspace/diagnostics/foldabilityMessages.ts`, `SPATIAL_RULES`); this is
/// the other half of that pair. Renaming a code here without renaming it there
/// ships a blank message in eight locales, which is exactly the failure a gate
/// on one side alone cannot catch.
///
/// Asserted as a *superset containment plus a whitelist*: the corpus of shapes
/// below need not reach all five, but nothing it reaches may be outside them.
#[test]
fn the_spatial_check_emits_only_the_rules_the_frontend_words() {
    use oristudio_cp::{CreasePatternCommand, CreasePatternDocument, OperationId, execute_command};

    const SPATIAL_RULES: [&str; 5] = [
        "Closure",
        "ClosureUnreachable",
        "Rigid",
        "SelfIntersection",
        "InteriorBorder",
    ];

    // Every shape that has ever produced a spatial diagnostic in this suite:
    // an annulus whose inner ring is an interior border, a vertex whose creases
    // do not close, a degree-3 rigid vertex, and a vertex whose undecided crease
    // has no closing angle.
    let mut models = vec![annulus(90.0), unreachable_undecided_vertex()];

    let mut open = CreasePatternModel::default();
    for (theta, rho) in [(0.0_f64, 90.0), (90.0, 90.0), (200.0, 90.0), (300.0, 90.0)] {
        let radians = theta.to_radians();
        open.add_line_segment(crease(
            0.0,
            0.0,
            100.0 * radians.cos(),
            100.0 * radians.sin(),
            LineColor::Red1,
            Some(rho),
        ));
    }
    models.push(open);

    let mut rigid = CreasePatternModel::default();
    for theta in [0.0_f64, 120.0, 240.0] {
        let radians = theta.to_radians();
        rigid.add_line_segment(crease(
            0.0,
            0.0,
            100.0 * radians.cos(),
            100.0 * radians.sin(),
            LineColor::Red1,
            Some(45.0),
        ));
    }
    models.push(rigid);

    // A closed but genuinely self-intersecting degree-5 fan — the same fixture
    // `spherical_simplicity.rs` keeps, so this test reaches all four rules
    // rather than three. Sector widths sum to 360; the fold angles close.
    let mut crossing = CreasePatternModel::default();
    let sectors = [77.7_f64, 75.3, 76.3, 80.9, 49.8];
    let rhos = [
        143.2_f64,
        -144.987_466_057_566,
        139.510_617_226_054,
        107.692_082_841_218,
        70.045_325_473_205,
    ];
    let mut theta = 0.0_f64;
    for (sector, rho) in sectors.iter().zip(rhos) {
        let radians = theta.to_radians();
        crossing.add_line_segment(crease(
            0.0,
            0.0,
            100.0 * radians.cos(),
            100.0 * radians.sin(),
            if rho >= 0.0 {
                LineColor::Red1
            } else {
                LineColor::Blue2
            },
            Some(rho.abs()),
        ));
        theta += sector;
    }
    models.push(crossing);

    let mut seen: Vec<String> = Vec::new();
    for model in models {
        let mut document = CreasePatternDocument {
            crease_pattern: model,
            ..CreasePatternDocument::default()
        };
        let result = execute_command(
            &mut document,
            CreasePatternCommand::new(OperationId::CheckCamv),
        )
        .expect("CheckCamv is supported");
        for entry in result.diagnostic_entries {
            if !entry.kind.starts_with("Spatial") {
                continue;
            }
            let rule = entry
                .rule
                .clone()
                .expect("a spatial diagnostic names a rule");
            assert!(
                SPATIAL_RULES.contains(&rule.as_str()),
                "{rule} has no sentence on the frontend; add it to SPATIAL_RULES on both sides",
            );
            // The closure sentence needs the residual structurally: the frontend
            // has to word it, and a formatted string cannot be un-formatted.
            // `ClosureUnreachable`'s number is a different one — how close the
            // vertex can be brought rather than how far off it is — and it is
            // just as load-bearing, because "no angle helps" without a bracket
            // is a refusal the user cannot check.
            if rule == "Closure" || rule == "ClosureUnreachable" {
                assert!(
                    entry.residual_degrees.is_some(),
                    "{rule} must carry its residual, not only spell it",
                );
            } else {
                assert!(entry.residual_degrees.is_none());
            }
            if !seen.contains(&rule) {
                seen.push(rule);
            }
        }
    }
    // All four, not merely "some": a whitelist that nothing reaches asserts
    // nothing at all.
    seen.sort();
    let mut expected = SPATIAL_RULES.map(String::from);
    expected.sort();
    assert_eq!(seen, expected);
}

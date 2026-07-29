//! Local self-intersection at a non-flat vertex.
//!
//! Closure says the fold angles agree; this says the paper does not pass through
//! itself getting there. Two independent questions, and before this the second
//! went unasked for every non-flat vertex — a coverage regression against flat
//! vertices, which have had Oriedita's little-big-little check all along.
//!
//! There is no upstream to port from: Oriedita does not do this, and the
//! simulator has no intersection test of any kind. So the tests carry more of
//! the weight than usual, and are built on three things checkable without an
//! oracle:
//!
//! 1. a physical invariant (paper does not stretch) that pins the construction,
//! 2. synthetic polygons whose answer is obvious by inspection,
//! 3. **closed fixtures across their folding paths**, which must never be
//!    flagged — a false positive here is worse than having no check.
//!
//! Fold angles are solved offline and pasted at full precision. They are not
//! round numbers because a folding path is nonlinear: scaling every angle by a
//! constant breaks closure, which an earlier draft of this file did.

use oristudio_cp::checks_spatial::{
    LinkVerdict, VertexFan, vertex_closure_residual, vertex_link_polygon, vertex_link_verdict,
};
use oristudio_cp::geometry::Point;

/// Build a fan from sector angles and fold angles, both in degrees.
///
/// Sector `i` is the wedge *after* crease `i`, so creases sit at the running
/// sums. Sectors must total 360 — a developable vertex, the only kind this repo
/// represents.
fn fan(sectors_deg: &[f64], rho_deg: &[f64]) -> VertexFan {
    assert_eq!(
        sectors_deg.len(),
        rho_deg.len(),
        "one fold angle per crease"
    );
    let total: f64 = sectors_deg.iter().sum();
    assert!(
        (total - 360.0).abs() < 1e-9,
        "sectors must sum to 360, got {total}"
    );
    let mut theta = 0.0;
    let mut creases = Vec::with_capacity(sectors_deg.len());
    for (sector, rho) in sectors_deg.iter().zip(rho_deg) {
        creases.push((f64::to_radians(theta), f64::to_radians(*rho)));
        theta += sector;
    }
    VertexFan {
        point: Point::new(0.0, 0.0),
        creases,
        indeterminate: None,
    }
}

fn arc_length(a: [f64; 3], b: [f64; 3]) -> f64 {
    let cross = [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
    let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    (cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2])
        .sqrt()
        .atan2(dot)
}

// ---------------------------------------------------------------------------
// 1. The construction, pinned by physics
// ---------------------------------------------------------------------------

/// Paper does not stretch, so each arc of the folded link is exactly as long as
/// the planar sector it came from.
///
/// **This is the test that catches a wrong composition order.** The sector
/// frames multiply on the right while the closure product multiplies on the
/// left, and getting it backwards still produces a plausible-looking polygon —
/// it cannot be spotted by reading.
///
/// The fans are deliberately **asymmetric**: on a symmetric fan both orders
/// agree to 1e-14 and the bug hides completely, while on these the wrong order
/// is out by tens of degrees.
///
/// Only the arcs between consecutive creases are asserted. The wrap-around arc
/// closes the loop and so depends on the fan closing, which is a different
/// property tested elsewhere.
#[test]
fn vertex_link_preserves_arc_lengths() {
    let cases: [(&str, &[f64], &[f64]); 3] = [
        (
            "asymmetric degree 4",
            &[70.0, 105.0, 75.0, 110.0],
            &[140.0, -95.0, 63.0, -47.0],
        ),
        (
            "asymmetric degree 5",
            &[47.0, 74.0, 77.0, 91.0, 71.0],
            &[143.2, -145.1, 139.4, 107.7, 70.2],
        ),
        (
            "asymmetric degree 6",
            &[38.0, 57.0, 71.0, 65.0, 74.0, 55.0],
            &[100.0, -80.0, 60.0, -120.0, 30.0, -55.0],
        ),
    ];

    for (name, sectors, rho) in cases {
        let points = vertex_link_polygon(&fan(sectors, rho));
        assert_eq!(points.len(), sectors.len());
        for index in 0..points.len() - 1 {
            let measured = arc_length(points[index], points[index + 1]).to_degrees();
            assert!(
                (measured - sectors[index]).abs() < 1e-9,
                "{name}: sector {index} is {} degrees but its arc measures {measured}",
                sectors[index]
            );
        }
    }
}

/// At full fold the paper is flat, so the link collapses onto a single great
/// circle. Independent confirmation of the construction, and the reason the flat
/// case is degenerate and belongs to Oriedita's checker.
#[test]
fn a_fully_folded_link_is_planar() {
    let points = vertex_link_polygon(&fan(
        &[70.0, 110.0, 70.0, 110.0],
        &[180.0, -180.0, 180.0, -180.0],
    ));
    let normal = {
        let (a, b) = (points[0], points[1]);
        let raw = [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        ];
        let scale = (raw[0] * raw[0] + raw[1] * raw[1] + raw[2] * raw[2]).sqrt();
        [raw[0] / scale, raw[1] / scale, raw[2] / scale]
    };
    for point in &points {
        let out_of_plane =
            (point[0] * normal[0] + point[1] * normal[1] + point[2] * normal[2]).abs();
        assert!(
            out_of_plane < 1e-12,
            "point off the great circle by {out_of_plane}"
        );
    }
}

// ---------------------------------------------------------------------------
// 2. Valid folded states must never be flagged
// ---------------------------------------------------------------------------

/// Assert a closed fixture is both closed and clean.
///
/// The closure assertion is not ceremony: a fixture that drifted off the folding
/// path would describe no folded state at all, and the simplicity result would
/// be meaningless rather than wrong.
fn assert_valid_and_clean(name: &str, sectors: &[f64], states: &[&[f64]]) {
    for (index, rho) in states.iter().enumerate() {
        let fan = fan(sectors, rho);
        let residual = vertex_closure_residual(&fan).to_degrees();
        assert!(
            residual < 1e-6,
            "{name} state {index}: fixture does not close ({residual} degrees off)"
        );
        let verdict = vertex_link_verdict(&fan);
        assert!(
            !verdict.self_intersects(),
            "{name} state {index} (max |rho| {:.0}): {verdict:?} on a valid folded state",
            rho.iter().fold(0.0_f64, |a, r| a.max(r.abs()))
        );
    }
}

/// Degree-4 vertices with no collinear crease pair, so all four creases really
/// fold. Swept from barely-folded to 179 degrees.
#[test]
fn generic_degree_four_vertices_stay_clean_while_folding() {
    assert_valid_and_clean(
        "degree 4 (70/90/100/100)",
        &[70.0, 90.0, 100.0, 100.0],
        &[
            &[10.0, -1.740782035656, 9.693030280079, 1.713504803034],
            &[45.0, -8.208319975993, 43.550248529260, 8.079493888628],
            &[90.0, -19.425909101551, 86.542543750635, 19.118657685422],
            &[135.0, -42.433917056598, 127.168107191488, 41.737709050689],
            &[170.0, -90.305713812099, 149.895176710337, 88.514646248310],
            &[179.0, -108.342743242381, 151.551075750410, 105.892005472205],
        ],
    );
    assert_valid_and_clean(
        "degree 4 (55/95/115/95)",
        &[55.0, 95.0, 115.0, 95.0],
        &[
            &[10.0, -2.697215721207, 9.505856359888, 2.564225585406],
            &[90.0, -29.512350160551, 84.481582019106, 28.026900123776],
            &[135.0, -60.435518816644, 122.884113412826, 57.171923620979],
            &[179.0, -122.203371929200, 143.855390165945, 112.675475615825],
        ],
    );
}

/// A crease pair collinear through the vertex — a straight line crossing it — is
/// ubiquitous in real patterns and degenerate in exactly the way that breaks
/// naive reasoning. Here the closed state folds the straight line and leaves the
/// other two creases flat.
#[test]
fn a_straight_line_through_a_vertex_stays_clean() {
    assert_valid_and_clean(
        "Miura-style collinear degree 4",
        &[60.0, 120.0, 120.0, 60.0],
        &[
            &[10.0, 0.0, 10.0, 0.0],
            &[90.0, 0.0, 90.0, 0.0],
            &[179.0, 0.0, 179.0, 0.0],
        ],
    );
    assert_valid_and_clean(
        "box-pleat plus vertex",
        &[90.0, 90.0, 90.0, 90.0],
        &[&[45.0, 0.0, 45.0, 0.0], &[179.0, 0.0, 179.0, 0.0]],
    );
}

/// The waterbomb vertex, and regular degree-6 and degree-8 — where random fans
/// self-intersect most often, so a real one staying clean is worth pinning.
#[test]
fn higher_degree_canonical_vertices_stay_clean_while_folding() {
    assert_valid_and_clean(
        "waterbomb degree 6",
        &[90.0, 45.0, 45.0, 90.0, 45.0, 45.0],
        &[
            &[
                10.0,
                -5.258099272932,
                17.028229891589,
                -1.342909503843,
                6.127836389378,
                0.967354715403,
            ],
            &[
                90.0,
                -24.538330088158,
                58.279062709885,
                24.927123216496,
                44.482874849820,
                -38.307397526284,
            ],
            &[
                170.0,
                -22.369124082363,
                66.633047544945,
                73.840518392615,
                57.479463803606,
                -83.161736592620,
            ],
        ],
    );
    assert_valid_and_clean(
        "regular degree 6",
        &[60.0; 6],
        &[
            &[
                45.0,
                -1.857760205029,
                1.894869176801,
                42.492941241682,
                0.655028779701,
                -0.606981240819,
            ],
            &[
                135.0,
                -2.161419514051,
                2.134812822306,
                131.873106569371,
                1.002954845203,
                -0.955425692501,
            ],
        ],
    );
    assert_valid_and_clean(
        "regular degree 8",
        &[45.0; 8],
        &[
            &[
                45.0,
                -27.924472608026,
                56.298281253225,
                3.041447510501,
                -10.732589293160,
                30.892303235072,
                30.618506680342,
                -18.743169040241,
            ],
            &[
                135.0,
                -105.577877861341,
                113.786762217841,
                16.943026671230,
                3.131153730689,
                69.969882665337,
                52.574382956214,
                -46.171318226983,
            ],
        ],
    );
}

// ---------------------------------------------------------------------------
// 3. Touching is not crossing
// ---------------------------------------------------------------------------

/// The domain of the check, learned the hard way.
#[test]
fn a_vertex_with_stacked_layers_is_not_answered() {
    // Folding a sector flat puts the creases either side of it on the same
    // direction, so the link is non-injective by construction. Whether the
    // paper actually collides then depends on which layer is on top, and layer
    // ordering is not in the link.
    //
    // The first version answered anyway, and reported 30 crossings on a model
    // that had been folded out of real paper.
    // Unequal sectors either side of the folded crease: the neighbouring arcs
    // overlap rather than landing on one point.
    let flap = fan(&[90.0, 90.0, 90.0, 90.0], &[180.0, -89.0, 180.0, 89.0]);
    assert_eq!(
        vertex_link_verdict(&flap),
        LinkVerdict::StackedLayers,
        "a vertex with a flat-folded sector must decline, not guess"
    );

    let flat = fan(&[70.0, 110.0, 70.0, 110.0], &[180.0, -180.0, 180.0, -180.0]);
    assert_eq!(vertex_link_verdict(&flat), LinkVerdict::StackedLayers);
}

/// The box-pleat vertex from the model that exposed the false positives: three
/// creases at 180 and two at -90, closing exactly.
#[test]
fn the_reported_false_positive_declines() {
    let reported = fan(
        &[45.0, 90.0, 90.0, 45.0, 90.0],
        &[180.0, -90.0, 180.0, -90.0, 180.0],
    );
    assert!(
        vertex_closure_residual(&reported).to_degrees() < 1e-6,
        "fixture must close"
    );
    assert_eq!(
        vertex_link_verdict(&reported),
        LinkVerdict::StackedLayers,
        "a stacked-layer vertex must decline rather than report a crossing"
    );
}

// ---------------------------------------------------------------------------
// 4. The check has teeth
// ---------------------------------------------------------------------------

/// A closed, genuinely self-intersecting fan, found by sampling the closure
/// variety and kept as a fixture.
///
/// Without a case like this the suite would pass on a check that never fires.
#[test]
fn a_self_intersecting_vertex_is_detected() {
    let fan = fan(
        &[77.7, 75.3, 76.3, 80.9, 49.8],
        &[
            143.2,
            -144.987466057566,
            139.510617226054,
            107.692082841218,
            70.045325473205,
        ],
    );
    let residual = vertex_closure_residual(&fan).to_degrees();
    assert!(
        residual < 1e-6,
        "fixture must close, is {residual} degrees off"
    );
    assert!(
        vertex_link_verdict(&fan).self_intersects(),
        "known self-intersecting fixture was not detected"
    );
}

/// Detection must not thin out approaching flat, where the link is closest to
/// degenerate and the arithmetic worst conditioned. Continued from the fixture
/// above to `max |rho| = 179.999`.
#[test]
fn detection_survives_close_to_the_flat_limit() {
    let fan = fan(
        &[77.7, 75.3, 76.3, 80.9, 49.8],
        &[
            179.999,
            -152.018099778520,
            107.101145523990,
            127.688597434267,
            64.810381257281,
        ],
    );
    let residual = vertex_closure_residual(&fan).to_degrees();
    assert!(
        residual < 1e-6,
        "fixture must close, is {residual} degrees off"
    );
    assert!(
        vertex_link_verdict(&fan).self_intersects(),
        "a crossing went undetected at 179.999 degrees, where the link is nearly degenerate"
    );
}

/// Fewer than four creases has no non-adjacent arc pair, so nothing *can* cross.
/// Stated as a test because the early return looks like an optimisation and is
/// really a fact about spherical triangles.
#[test]
fn low_degree_vertices_cannot_self_intersect() {
    for sectors in [vec![180.0, 180.0], vec![120.0, 120.0, 120.0]] {
        let rho = vec![0.0; sectors.len()];
        assert_eq!(
            vertex_link_verdict(&fan(&sectors, &rho)),
            LinkVerdict::Simple
        );
    }
}

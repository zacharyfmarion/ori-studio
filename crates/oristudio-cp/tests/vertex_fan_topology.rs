//! Is Oriedita's endpoint-clustered segment soup a good enough topology source
//! for the generalised closure check?
//!
//! Answer (measured): yes for graph-shaped input, no for unsplit T-junctions.
//! Phase 6 consumes this via a determinacy gate rather than an arrangement.
//!
//! `checks::point_line_map` clusters segment ENDPOINTS at eps 1e-4. That is
//! exact for graph-shaped input (FOLD, and any CP whose segments are split at
//! intersections) but silently drops the through-rays of an unsplit T-junction.
//! This measures both cases.
use std::collections::HashMap;

use oristudio_cp::geometry::{LineColor, LineSegment, Point};

const EPS: f64 = 1e-4;

/// The candidate `VertexFan` seam: a vertex plus its incident creases sorted by
/// theta, with signed fold angles. Built the way `point_line_map` builds its
/// map, so it inherits exactly the same topology fidelity.
#[derive(Debug)]
struct VertexFan {
    creases: Vec<(f64, f64)>, // (theta, rho) radians
}

fn fans(segments: &[LineSegment]) -> Vec<VertexFan> {
    let mut map: Vec<(Point, Vec<(f64, f64)>)> = Vec::new();
    let mut cells: HashMap<(i64, i64), Vec<usize>> = HashMap::new();

    let push = |map: &mut Vec<(Point, Vec<(f64, f64)>)>,
                cells: &mut HashMap<(i64, i64), Vec<usize>>,
                at: Point,
                other: Point,
                color: LineColor| {
        let rho = match color {
            LineColor::Red1 => -std::f64::consts::PI,
            LineColor::Blue2 => std::f64::consts::PI,
            _ => return,
        };
        let theta = (other.y - at.y).atan2(other.x - at.x);
        let cell = ((at.x / EPS).floor() as i64, (at.y / EPS).floor() as i64);
        for dx in -1..=1 {
            for dy in -1..=1 {
                if let Some(idxs) = cells.get(&(cell.0 + dx, cell.1 + dy)) {
                    for &i in idxs {
                        let p = map[i].0;
                        if (p.x - at.x).powi(2) + (p.y - at.y).powi(2) <= EPS * EPS {
                            map[i].1.push((theta, rho));
                            return;
                        }
                    }
                }
            }
        }
        map.push((at, vec![(theta, rho)]));
        cells.entry(cell).or_default().push(map.len() - 1);
    };

    for s in segments {
        push(&mut map, &mut cells, s.a, s.b, s.color);
        push(&mut map, &mut cells, s.b, s.a, s.color);
    }

    map.into_iter()
        .map(|(_, mut creases)| {
            creases.sort_by(|a, b| a.0.partial_cmp(&b.0).expect("finite"));
            VertexFan { creases }
        })
        .collect()
}

/// quaternions.pdf eq. 13/14. Residual measured from the identity QUATERNION,
/// not from +/-1: at rho = +/-180 a mountain and a valley are the same rotation
/// and differ only in the lift, so |w| would silently accept every Maekawa
/// violation.
fn closure_residual(fan: &VertexFan) -> f64 {
    let mut q = (1.0f64, 0.0f64, 0.0f64, 0.0f64);
    for &(theta, rho) in &fan.creases {
        let (s, c) = (rho / 2.0).sin_cos();
        let r = (c, s * theta.cos(), s * theta.sin(), 0.0);
        q = (
            r.0 * q.0 - r.1 * q.1 - r.2 * q.2 - r.3 * q.3,
            r.0 * q.1 + r.1 * q.0 + r.2 * q.3 - r.3 * q.2,
            r.0 * q.2 - r.1 * q.3 + r.2 * q.0 + r.3 * q.1,
            r.0 * q.3 + r.1 * q.2 - r.2 * q.1 + r.3 * q.0,
        );
    }
    let vec_norm = (q.1 * q.1 + q.2 * q.2 + q.3 * q.3).sqrt();
    2.0 * vec_norm.atan2(q.0)
}

fn seg(ax: f64, ay: f64, bx: f64, by: f64, color: LineColor) -> LineSegment {
    LineSegment::with_color(Point::new(ax, ay), Point::new(bx, by), color)
}

/// Degree-4 flat-foldable vertex at the origin, drawn as four split creases.
fn split_degree4() -> Vec<LineSegment> {
    vec![
        seg(0.0, 0.0, 100.0, 0.0, LineColor::Blue2),
        seg(0.0, 0.0, 0.0, 100.0, LineColor::Blue2),
        seg(0.0, 0.0, -100.0, 0.0, LineColor::Blue2),
        seg(0.0, 0.0, 0.0, -100.0, LineColor::Red1),
    ]
}

#[test]
fn split_segments_give_an_exact_fan() {
    let fans = fans(&split_degree4());
    let center = fans
        .iter()
        .find(|f| f.creases.len() == 4)
        .expect("degree-4 vertex at the origin");
    let residual = closure_residual(center).to_degrees();
    println!("split degree-4 residual: {residual:.3e} deg");
    assert!(residual < 1e-9, "expected closure, got {residual}");
}

#[test]
fn unsplit_t_junction_loses_the_through_rays() {
    // Same geometry, but the horizontal crease is ONE unbroken segment instead
    // of two. Physically identical; topologically invisible to endpoint
    // clustering.
    let segments = vec![
        seg(-100.0, 0.0, 100.0, 0.0, LineColor::Blue2), // unbroken through-line
        seg(0.0, 0.0, 0.0, 100.0, LineColor::Blue2),
        seg(0.0, 0.0, 0.0, -100.0, LineColor::Red1),
    ];
    let fans = fans(&segments);
    let center = fans
        .iter()
        .max_by_key(|f| f.creases.len())
        .expect("some vertex");

    println!(
        "unsplit T-junction: best fan has degree {} (should be 4)",
        center.creases.len()
    );
    println!(
        "  residual: {:.3e} deg",
        closure_residual(center).to_degrees()
    );

    // The finding: endpoint clustering sees degree 2, not degree 4, so the
    // closure check would evaluate a vertex that does not exist as drawn.
    assert_eq!(
        center.creases.len(),
        2,
        "endpoint clustering should miss the two through-rays"
    );
}

// ---------------------------------------------------------------------------
// What residual does NATIVELY CONSTRUCTED geometry produce?
//
// The 1e-3 deg tolerance from A1 was measured on scraped/imported CPs and is
// absorbing THEIR coordinate imprecision. Geometry built by Ori Studio's own
// construction tools should be far tighter -- but "far tighter" needs a number,
// because the app's dominant idiom (22.5 deg radial snap) goes through f64 trig,
// not exact rationals.

/// Degree-4 Kawasaki-satisfying vertex on the 22.5 deg family:
/// theta = 0, 45, 112.5, 247.5 -> sectors 45, 67.5, 135, 112.5.
/// Opposite sectors sum to 180, so 2D Kawasaki holds exactly.
const RADIAL_22_5: [f64; 4] = [0.0, 45.0, 112.5, 247.5];

fn radial_vertex(colors: [LineColor; 4], radius: f64) -> Vec<LineSegment> {
    RADIAL_22_5
        .iter()
        .zip(colors)
        .map(|(deg, color)| {
            let t = deg.to_radians();
            seg(0.0, 0.0, radius * t.cos(), radius * t.sin(), color)
        })
        .collect()
}

fn center_residual_deg(segments: &[LineSegment]) -> f64 {
    let fans = fans(segments);
    let center = fans
        .iter()
        .max_by_key(|f| f.creases.len())
        .expect("some vertex");
    closure_residual(center).to_degrees()
}

#[test]
fn native_construction_residual_is_machine_epsilon() {
    use LineColor::{Blue2 as V, Red1 as M};

    // Find the flat-foldable assignment the way the checker would.
    let assignments = [[M, V, V, V], [V, M, V, V], [V, V, M, V], [V, V, V, M]];
    let mut closing = Vec::new();
    for colors in assignments {
        let r = center_residual_deg(&radial_vertex(colors, 100.0));
        if r < 1e-6 {
            closing.push(r);
        }
    }
    assert!(!closing.is_empty(), "no assignment closed the 22.5 vertex");

    println!("\n=== A3: natively constructed geometry ===");
    println!("22.5deg radial snap, f64 trig, radius 100:");
    for r in &closing {
        println!("  residual: {r:.3e} deg");
    }

    // Scale sensitivity: theta error goes as (position error / crease length),
    // so short creases are the stress case.
    println!("22.5deg radial snap across crease lengths:");
    let colors = assignments
        .into_iter()
        .find(|c| center_residual_deg(&radial_vertex(*c, 100.0)) < 1e-6)
        .expect("a closing assignment");
    for radius in [0.1, 1.0, 10.0, 100.0, 400.0] {
        let r = center_residual_deg(&radial_vertex(colors, radius));
        println!("  radius {radius:>6}: {r:.3e} deg");
        assert!(
            r < 1e-9,
            "native construction at radius {radius} gave {r:e} deg"
        );
    }

    // Grid-snapped geometry: exact rationals, the other native idiom.
    let grid = vec![
        seg(0.0, 0.0, 32.0, 0.0, V),
        seg(0.0, 0.0, 0.0, 32.0, V),
        seg(0.0, 0.0, -32.0, 0.0, V),
        seg(0.0, 0.0, 0.0, -32.0, M),
    ];
    let r = center_residual_deg(&grid);
    println!("grid snap (exact integers): {r:.3e} deg");
    assert!(r < 1e-12);
}

/// Free-hand dragging is the other native input path, and it is nothing like
/// snapped construction. Oriedita ships `fix_inaccurate` with a default
/// `fix_precision` of 0.05 units (in a 400-unit space) precisely because users
/// place points by mouse. This measures what that costs the closure residual.
#[test]
fn free_hand_drag_residual_dwarfs_snapped_construction() {
    use LineColor::{Blue2 as V, Red1 as M};

    let colors = [[M, V, V, V], [V, M, V, V], [V, V, M, V], [V, V, V, M]]
        .into_iter()
        .find(|c| center_residual_deg(&radial_vertex(*c, 100.0)) < 1e-6)
        .expect("a closing assignment");

    // Deterministic jitter, no rng dependency: offset each endpoint by +/-eps
    // in a fixed pattern, which is representative of mouse placement.
    let jitter = [(1.0, -1.0), (-1.0, 1.0), (1.0, 1.0), (-1.0, -1.0)];

    println!("\n=== A3b: free-hand drag ===");
    println!(
        "{:>12} {:>12} {:>16}",
        "drag (units)", "crease len", "residual (deg)"
    );
    for eps in [0.005, 0.05, 0.5] {
        for length in [10.0, 100.0] {
            let segments: Vec<LineSegment> = RADIAL_22_5
                .iter()
                .zip(colors)
                .zip(jitter)
                .map(|((deg, color), (jx, jy))| {
                    let t = deg.to_radians();
                    seg(
                        0.0,
                        0.0,
                        length * t.cos() + jx * eps,
                        length * t.sin() + jy * eps,
                        color,
                    )
                })
                .collect();
            println!(
                "{eps:>12} {length:>12} {:>16.3e}",
                center_residual_deg(&segments)
            );
        }
    }
}

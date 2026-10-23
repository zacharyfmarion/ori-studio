//! The swivel by its edge (`compound::swivel`): *swivel this edge onto that
//! line, pivoting at this point*, its creases computed and folded through
//! the swivel's fan. Each classic case lands with the creases, letters and
//! landing the module docs derive, is the same state its rays form lands,
//! and passes the full gate; a rabbit ear is the swivel at its incenter, two
//! make the fish base, and Beloch's `swivel-rabbit` — free hinges — stays
//! the rays form's. The ridge is a stored choice; the refusals are codes
//! naming the edge's faces; and a seeded campaign checks every swivel that
//! lands folds flat with its edge on the target.

mod beloch;
mod support;
mod vertex;

use std::f64::consts::PI;

use oristudio_fold::random::{self, Rng};
use oristudio_fold::{
    CompoundRefused, CreaseKind, Direction, Fix, FoldRefusal, Letter, RabbitEar, Seed, State,
    Swivel, SwivelByEdge, SwivelEdgeAnalysis, SwivelRay, SwivelWedge, VertexChoices, VertexFolded,
    VertexOutcome,
};
use oristudio_geometry::Line;
use vertex::cases::{self, EdgeSwivelCase, by_edge, inradius, landed};
use vertex::{assert_ear_letters, check, folded_segments, letters_at};

type Point = [f64; 2];

fn line(p: Point, q: Point) -> Line {
    Line::from_points(p, q).unwrap_or_else(|| panic!("{p:?} = {q:?}"))
}

fn case(name: &str) -> EdgeSwivelCase {
    cases::edge_swivel_cases()
        .into_iter()
        .find(|c| c.name == name)
        .unwrap_or_else(|| panic!("no case {name}"))
}

fn analysis(state: &State, op: &SwivelByEdge) -> SwivelEdgeAnalysis {
    state
        .analyse_swivel_by_edge(op)
        .unwrap_or_else(|e| panic!("{e} {e:?}"))
}

/// A direction in degrees, [0, 360), to a hundredth.
fn degrees(v: Point) -> f64 {
    (v[1].atan2(v[0]).to_degrees().rem_euclid(360.0) * 100.0).round() / 100.0
}

/// The four creases' directions, in degrees: meet, foot, end, hinge.
fn rays(a: &SwivelEdgeAnalysis) -> Vec<f64> {
    a.creases.iter().map(|c| degrees(c.direction)).collect()
}

fn refusal(outcome: Result<VertexOutcome, CompoundRefused>) -> oristudio_fold::Refused {
    match outcome {
        Err(CompoundRefused::Refused(refused)) => refused,
        Err(CompoundRefused::Broken(b)) => panic!("broken {b}"),
        Ok(_) => panic!("landed"),
    }
}

/// The parent vertex at a sheet point.
fn vertex_at(state: &State, p: Point) -> Point {
    let v = state
        .vertices()
        .iter()
        .position(|q| (q[0] - p[0]).hypot(q[1] - p[1]) < 1e-9)
        .unwrap_or_else(|| panic!("no vertex at {p:?}"));
    state
        .vertex_image(oristudio_fold::VertexId(v as u32))
        .unwrap_or_else(|| panic!("no image of {p:?}"))
}

/// Every vertex the landed state has along the edge's sheet segment `edge`
/// lies on the target once folded where the edge runs from where it meets
/// the target toward its far end, and stays where it was past that point.
/// Returns how many lie on the target.
fn assert_edge_on_target(
    parent: &State,
    folded: &VertexFolded,
    edge: [Point; 2],
    a: &SwivelEdgeAnalysis,
    label: &str,
) -> usize {
    let (ma, mb) = (vertex_at(parent, edge[0]), vertex_at(parent, edge[1]));
    let far = a.edge[1];
    let u = [far[0] - a.meet[0], far[1] - a.meet[1]];
    let length = u[0].hypot(u[1]);
    let u = [u[0] / length, u[1] / length];
    let run = [edge[1][0] - edge[0][0], edge[1][1] - edge[0][1]];
    let run2 = run[0] * run[0] + run[1] * run[1];
    let state = &folded.state;
    let mut on = 0;
    for (k, &s) in state.vertices().iter().enumerate() {
        let rel = [s[0] - edge[0][0], s[1] - edge[0][1]];
        let off = (rel[0] * run[1] - rel[1] * run[0]).abs() / run2.sqrt();
        let t = (rel[0] * run[0] + rel[1] * run[1]) / run2;
        if off > 1e-9 || !(-1e-9..=1.0 + 1e-9).contains(&t) {
            continue;
        }
        let before = [ma[0] + t * (mb[0] - ma[0]), ma[1] + t * (mb[1] - ma[1])];
        let along = (before[0] - a.meet[0]) * u[0] + (before[1] - a.meet[1]) * u[1];
        let after = state
            .vertex_image(oristudio_fold::VertexId(k as u32))
            .unwrap_or_else(|| panic!("{label}: no image"));
        if along > 1e-9 {
            let d = a.target.distance_to_point(after);
            assert!(d < 1e-9, "{label}: {s:?} lands {d} off the target");
            on += 1;
        } else if along < -1e-9 {
            let moved = (after[0] - before[0]).hypot(after[1] - before[1]);
            assert!(moved < 1e-9, "{label}: {s:?} past the meeting point moved");
        }
    }
    on
}

/// Kawasaki's theorem at the vertex: alternate sectors sum to a half turn.
fn assert_flat(a: &SwivelEdgeAnalysis, label: &str) {
    let mut angles: Vec<f64> = a
        .creases
        .iter()
        .map(|c| c.direction[1].atan2(c.direction[0]).rem_euclid(2.0 * PI))
        .collect();
    angles.sort_by(f64::total_cmp);
    let alternate = (angles[1] - angles[0]) + (angles[3] - angles[2]);
    assert!((alternate - PI).abs() < 1e-9, "{label}: {alternate}");
}

/// Land a swivel by its edge as it must land, and check it every way: the
/// full gate and its motion, Kawasaki at its vertex, the rabbit ear's
/// letters in every layer it cut (the three the direction's, the ridge the
/// other), its edge on the target, and the same state its rays form lands.
fn swivel_checked(
    parent: &State,
    op: &SwivelByEdge,
    edge: [Point; 2],
    label: &str,
) -> VertexFolded {
    let a = analysis(parent, op);
    assert_flat(&a, label);
    let folded = landed(parent.swivel_by_edge(op, &VertexChoices::default()));
    check(parent, &folded);
    let rays_form = parent
        .swivel_by_edge_as_rays(op)
        .unwrap_or_else(|e| panic!("{label}: {e}"));
    let fan = parent
        .analyse_swivel(&rays_form)
        .unwrap_or_else(|e| panic!("{label}: {e}"));
    assert_ear_letters(parent, &folded, &fan, label);
    let same = landed(parent.swivel(&rays_form, &VertexChoices::default()));
    assert_eq!(
        folded_segments(&same.state),
        folded_segments(&folded.state),
        "{label}: not its rays form's state"
    );
    assert!(
        assert_edge_on_target(parent, &folded, edge, &a, label) >= 2,
        "{label}: too few of the edge's vertices checked"
    );
    // The picture: drawn from the vertex, as every fan fold's.
    let action = parent
        .swivel_by_edge_action(op, Some(&folded.state))
        .unwrap_or_else(|e| panic!("{label}: {e}"));
    assert!(
        !action.moving.is_empty(),
        "{label}: a picture with nothing moving"
    );
    folded
}

/// The rabbit ear on the flat square's half a b c, by its corners (spike
/// case 3c's 270° ear), is the swivel by its edge at the incenter: the
/// bottom edge onto the diagonal. One crease pattern, one set of letters —
/// meet, end and hinge the bisectors to the corners, valley; the foot the
/// ridge, mountain — and so for the fish base's ear (case 3d's 180°).
#[test]
fn a_rabbit_ear_is_the_swivel_at_its_incenter() {
    let c = case("rabbit ear on the diagonal");
    let a = analysis(&c.state, &c.op);
    assert_eq!(rays(&a), vec![202.5, 270.0, 315.0, 67.5]);
    assert_eq!(
        a.creases.iter().map(|c| c.letter).collect::<Vec<_>>(),
        vec![
            Letter::Valley,
            Letter::Mountain,
            Letter::Valley,
            Letter::Valley
        ]
    );
    assert_eq!(a.creases[1].ray, SwivelRay::Foot);
    assert!(a.creases[1].ridge);
    // The hinge runs to the third corner, (1, 1): it is the ear's.
    assert!((a.creases[3].to[0] - 1.0).abs() < 1e-9 && (a.creases[3].to[1] - 1.0).abs() < 1e-9);
    // The far wedge turns 135° clockwise, laying the edge from its foot to
    // b on the diagonal, back over its near part: the ear's two layers.
    assert!((a.rotation + 0.75 * PI).abs() < 1e-12, "{}", a.rotation);
    let folded = swivel_checked(&c.state, &c.op, c.edge, c.name);
    let r = inradius();
    let ear = RabbitEar {
        corners: [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]],
        emergent: [0.0, -1.0],
        layers: Seed::All,
        stayer: [0.2, 0.8],
        direction: Direction::Valley,
    };
    let by_corners = landed(c.state.rabbit_ear(&ear, &VertexChoices::default()));
    assert_eq!(
        folded_segments(&folded.state),
        folded_segments(&by_corners.state)
    );
    assert_eq!(letters_at(&folded.state, [1.0 - r, r]), (1, 3));

    let fish = case("fish ear 1");
    let folded = swivel_checked(&fish.state, &fish.op, fish.edge, fish.name);
    let ear = RabbitEar {
        corners: [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]],
        emergent: [-1.0, 0.0],
        layers: Seed::All,
        stayer: [0.6, 0.6],
        direction: Direction::Valley,
    };
    let by_corners = landed(fish.state.rabbit_ear(&ear, &VertexChoices::default()));
    assert_eq!(
        folded_segments(&folded.state),
        folded_segments(&by_corners.state)
    );
}

/// The fish base by two swivels: the left edge onto b d at a b d's
/// incenter, then the top edge onto b d at b c d's — the rabbit ears'
/// route's crease pattern (spike case 3d), Maekawa's 3 : 1 at both
/// vertices, mirror-symmetric across b d, its two ridges (mountain) square
/// to the left and top edges.
#[test]
fn the_fish_base_is_two_swivels() {
    let first = case("fish ear 1");
    let one = swivel_checked(&first.state, &first.op, first.edge, "fish ear 1");
    let second = cases::fish_second();
    let two = swivel_checked(&one.state, &second, [[0.0, 1.0], [1.0, 1.0]], "fish ear 2");
    let r = inradius();
    assert_eq!(letters_at(&two.state, [r, r]), (1, 3));
    assert_eq!(letters_at(&two.state, [1.0 - r, 1.0 - r]), (1, 3));
    // The ears' route (`rabbit_ear.rs`, `the_fish_base_takes_two_ears`).
    let ear1 = RabbitEar {
        corners: [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]],
        emergent: [-1.0, 0.0],
        layers: Seed::All,
        stayer: [0.6, 0.6],
        direction: Direction::Valley,
    };
    let by_ears = landed(first.state.rabbit_ear(&ear1, &VertexChoices::default()));
    let ear2 = RabbitEar {
        corners: [[1.0, 1.0], [0.0, 1.0], [1.0, 0.0]],
        emergent: [0.0, 1.0],
        layers: Seed::Flaps {
            at: vec![[0.8, 0.8]],
        },
        stayer: cases::seen_bottom(&by_ears.state, [0.45, 0.45]),
        direction: Direction::Valley,
    };
    let by_ears = landed(by_ears.state.rabbit_ear(&ear2, &VertexChoices::default()));
    let segments = folded_segments(&two.state);
    assert_eq!(segments, folded_segments(&by_ears.state));
    // Symmetric across b d, (x, y) ↦ (1 − y, 1 − x), both ridges toward d.
    let one = 1_000_000;
    let mirrored: std::collections::BTreeSet<_> = segments
        .iter()
        .map(|&(l, p, q)| {
            let (p, q) = ([one - p[1], one - p[0]], [one - q[1], one - q[0]]);
            if p <= q { (l, p, q) } else { (l, q, p) }
        })
        .collect();
    assert_eq!(mirrored, segments);
    // Four creases from each vertex, b d left flat between them.
    assert_eq!(segments.len(), 8, "{segments:?}");
    let mountains: Vec<_> = segments
        .iter()
        .filter(|s| s.0 == Letter::Mountain)
        .map(|s| (s.1, s.2))
        .collect();
    let (lo, hi) = ((r * 1e6).round() as i64, ((1.0 - r) * 1e6).round() as i64);
    assert_eq!(mountains, vec![([0, lo], [lo, lo]), ([hi, hi], [hi, one])]);
}

/// The bottom edge onto the centre crease, pivoting past the incenter along
/// the bisector at x = 0.8: no rabbit ear — the hinge leaves through the
/// right edge, not the corner — yet flat by construction, its edge on the
/// diagonal. Both of the turning wedge's rays can rise here (foot → end is
/// narrower than meet → foot), so the ridge is a choice: two states,
/// letters swapped between foot and end.
#[test]
fn a_swivel_turns_the_edge_onto_the_centre_crease() {
    let c = case("bottom edge onto the centre crease");
    let a = analysis(&c.state, &c.op);
    assert_eq!(rays(&a), vec![202.5, 270.0, 301.11, 53.61]);
    assert_eq!(a.ridges.len(), 2);
    assert_eq!(a.ridge, 0);
    // The hinge reaches the right edge below the corner.
    let hinge = a.creases[3].to;
    assert!((hinge[0] - 1.0).abs() < 1e-9 && hinge[1] < 0.9, "{hinge:?}");
    let by_foot = swivel_checked(&c.state, &c.op, c.edge, c.name);
    let end = SwivelByEdge {
        ridge: Some(a.ridges[1]),
        ..c.op.clone()
    };
    let b = analysis(&c.state, &end);
    assert_eq!(b.ridge, 1);
    assert_eq!(
        b.creases.iter().map(|c| c.letter).collect::<Vec<_>>(),
        vec![
            Letter::Valley,
            Letter::Valley,
            Letter::Mountain,
            Letter::Valley
        ]
    );
    let by_end = swivel_checked(&c.state, &end, c.edge, "ridge at the end");
    assert_ne!(
        folded_segments(&by_foot.state),
        folded_segments(&by_end.state)
    );
    // The regions: the near wedge, the turning one and the one beyond.
    let wedges: std::collections::HashSet<_> = a.regions.iter().map(|r| r.wedge).collect();
    assert_eq!(
        wedges,
        [SwivelWedge::Near, SwivelWedge::Turn, SwivelWedge::Beyond]
            .into_iter()
            .collect()
    );
    // Mountain: the same creases the other way, each wedge behind.
    let behind = SwivelByEdge {
        direction: Direction::Mountain,
        ..c.op.clone()
    };
    swivel_checked(&c.state, &behind, c.edge, "behind");
}

/// Swivels on folded paper, through both layers: the two-layer triangle's
/// raw bottom edge onto its folded edge b d, and that folded edge onto the
/// bottom edge's line. Every layer is cut alike and takes the rule's
/// letters. On the second the turning wedge is wider than the near one, so
/// only the foot can rise: the end as ridge is refused, offering the foot.
#[test]
fn swivels_on_a_two_layer_flap() {
    let flap = case("two-layer flap");
    let a = analysis(&flap.state, &flap.op);
    assert_eq!(a.layers.len(), 2);
    swivel_checked(&flap.state, &flap.op, flap.edge, flap.name);

    let folded = case("folded edge onto a raw one");
    let a = analysis(&folded.state, &folded.op);
    assert_eq!(a.edge_faces.len(), 2, "a folded edge bounds two faces");
    swivel_checked(&folded.state, &folded.op, folded.edge, folded.name);
    let end = SwivelByEdge {
        ridge: Some(a.ridges[1]),
        ..folded.op.clone()
    };
    let refused = refusal(folded.state.swivel_by_edge(&end, &VertexChoices::default()));
    assert_eq!(refused.refusal, FoldRefusal::FanFourthCannotRise);
    assert_eq!(
        refused.fixes,
        vec![Fix::UseEmergent {
            direction: a.ridges[0]
        }]
    );
}

/// Beloch's `swivel-rabbit` hangs its two hinges from a and b at a height no
/// landmark fixes, so its ear crease is constructed by no axiom: the rays
/// form states it (spike case 3f), and the edge form cannot. At its pivot,
/// with its bottom edge onto the line it lands that edge on (a b reflected
/// across the hinge from b), the edge form computes its hinge instead — up
/// the spine — and lands that swivel: a b's halves fold up along the lines
/// to a and b, the paper above the vertex across the spine. Same pivot,
/// foot and landing; another crease pattern.
#[test]
fn beloch_s_swivel_rabbit_has_free_hinges() {
    let c = case("at Beloch's swivel-rabbit pivot");
    let a = analysis(&c.state, &c.op);
    assert_eq!(rays(&a), vec![329.04, 270.0, 210.96, 90.0]);
    let ours = swivel_checked(&c.state, &c.op, c.edge, c.name);
    let (square, beloch) = cases::swivel_case();
    let fan = square
        .analyse_swivel(&beloch)
        .unwrap_or_else(|e| panic!("{e}"));
    let ear = fan
        .candidates
        .iter()
        .copied()
        .find(|&d| degrees(d).round() == 332.0)
        .unwrap_or_else(|| panic!("no 332° ray"));
    let theirs = landed(square.swivel(
        &Swivel {
            emergent: ear,
            ..beloch
        },
        &VertexChoices::default(),
    ));
    assert_ne!(folded_segments(&ours.state), folded_segments(&theirs.state));
    // Both land the bottom edge's right half on the same line through b.
    let b = theirs
        .state
        .vertex_image(oristudio_fold::VertexId(1))
        .unwrap_or_default();
    assert!(a.target.distance_to_point(b) < 1e-9);
}

/// The vertex is the pivot moved square onto the nearer bisector of the
/// edge and the target, so a pivot near the bisector folds as one on it,
/// and the other bisector takes the other angle: there the edge's other
/// half swivels.
#[test]
fn the_vertex_is_the_pivot_moved_onto_the_bisector() {
    let c = case("bottom edge onto the centre crease");
    let on = analysis(&c.state, &c.op);
    let near = SwivelByEdge {
        pivot: [
            on.vertex[0] + 0.01,
            on.vertex[1] - 0.01 * (PI / 8.0).tan().recip(),
        ],
        ..c.op.clone()
    };
    let moved = analysis(&c.state, &near);
    // Off the bisector by a step square to it: the same vertex.
    let step = [near.pivot[0] - on.vertex[0], near.pivot[1] - on.vertex[1]];
    let bisector = [(PI / 8.0).cos(), (PI / 8.0).sin()];
    assert!((step[0] * bisector[0] + step[1] * bisector[1]).abs() < 1e-12);
    assert!((moved.vertex[0] - on.vertex[0]).hypot(moved.vertex[1] - on.vertex[1]) < 1e-12);
    assert_eq!(moved.pivot, near.pivot);
    // The bottom edge onto the vertical through its middle: a pivot right
    // of it lands on the bisector y = x − ½ and swivels the edge's right
    // half, ending at b; one left of it on y = ½ − x, the left half to a.
    let square = cases::square();
    let middle = line([0.5, 0.0], [0.5, 1.0]);
    let close = |p: Point, q: Point| (p[0] - q[0]).hypot(p[1] - q[1]) < 1e-12;
    let right = by_edge([0.7, 0.3], [0.5, 0.0], middle);
    let a = analysis(&square, &right);
    assert!(
        (a.vertex[1] - (a.vertex[0] - 0.5)).abs() < 1e-12,
        "{:?}",
        a.vertex
    );
    assert!(close(a.edge[1], [1.0, 0.0]), "{:?}", a.edge);
    swivel_checked(&square, &right, [[0.0, 0.0], [1.0, 0.0]], "right half");
    let left = by_edge([0.3, 0.3], [0.5, 0.0], middle);
    let a = analysis(&square, &left);
    assert!(
        (a.vertex[1] - (0.5 - a.vertex[0])).abs() < 1e-12,
        "{:?}",
        a.vertex
    );
    assert!(close(a.edge[1], [0.0, 0.0]), "{:?}", a.edge);
    swivel_checked(&square, &left, [[0.0, 0.0], [1.0, 0.0]], "left half");
}

/// The refusals, each a code naming the edge's faces: a point on no edge,
/// a target parallel to it, a vertex on its line, an edge that ends before
/// its foot (offering the plain fold along the bisector, which lands), an
/// edge whose layer the creases leave out, and a hinge into paper the fan
/// does not cut (a flat precrease is in its way).
#[test]
fn a_swivel_that_does_not_fit_is_refused_by_code() {
    let square = cases::square();
    let diagonal = line([0.0, 0.0], [1.0, 1.0]);
    let none = VertexChoices::default();
    // Inside the paper, and on the precreased diagonal: no edge.
    for edge in [[0.5, 0.5], [0.3, 0.3]] {
        let state = cases::diagonal_square();
        let op = by_edge([0.8, 0.3], edge, diagonal);
        let refused = refusal(state.swivel_by_edge(&op, &none));
        assert_eq!(
            refused.refusal,
            FoldRefusal::SwivelNotAnEdge { point: edge }
        );
        assert!(state.analyse_swivel_by_edge(&op).is_err());
    }
    // The top edge's line, parallel to the bottom edge.
    let op = by_edge([0.5, 0.5], [0.5, 0.0], line([0.0, 1.0], [1.0, 1.0]));
    let refused = refusal(square.swivel_by_edge(&op, &none));
    assert_eq!(refused.refusal.code(), "swivel_target_parallel");
    assert_eq!(refused.refusal.faces().len(), 1);
    // A pivot at the corner where the edge meets the target: its vertex
    // lies on the edge's line.
    let op = by_edge([0.0005, 0.0002], [0.5, 0.0], line([0.0, 0.0], [0.0, 1.0]));
    let refused = refusal(square.swivel_by_edge(&op, &none));
    assert_eq!(refused.refusal.code(), "swivel_pivot_on_edge");
    // The bottom edge onto the left edge's line, pivoting past its far
    // end: nothing of it swivels; the bisector from a lays it on the line.
    let op = by_edge([1.2, 1.2], [0.5, 0.0], line([0.0, 0.0], [0.0, 1.0]));
    let refused = refusal(square.swivel_by_edge(&op, &none));
    assert_eq!(refused.refusal.code(), "swivel_edge_short");
    let [
        Fix::UseLine {
            line: bisector,
            side,
        },
    ] = refused.fixes.as_slice()
    else {
        panic!("{:?}", refused.fixes);
    };
    assert!(bisector.distance_to_point([0.0, 0.0]) < 1e-12);
    assert!(bisector.distance_to_point([0.5, 0.5]) < 1e-12);
    let plain = oristudio_fold::PlainFold::new(*bisector, *side, Direction::Valley);
    let folded = square.fold(&plain).unwrap_or_else(|e| panic!("{e}"));
    let corner = folded
        .state
        .vertex_image(oristudio_fold::VertexId(1))
        .unwrap_or_default();
    assert!(
        corner[0].abs() < 1e-9,
        "b lands on the left edge: {corner:?}"
    );
    // The two-layer triangle through its top layer only, the edge the
    // bottom layer's: the layer cut lands its own edge, never that one.
    let tri = cases::valley(&square, [1.0, 0.0], [0.0, 1.0], [1.0, 1.0]);
    let top = cases::seen_top(&tri, [0.3, 0.3]);
    let r = inradius();
    let op = SwivelByEdge {
        layers: Seed::Depth { at: top, layers: 1 },
        ..by_edge([r, r], [0.5, 0.0], line([1.0, 0.0], [0.0, 1.0]))
    };
    let refused = refusal(tri.swivel_by_edge(&op, &none));
    assert_eq!(refused.refusal.code(), "swivel_edge_stays", "{refused:?}");
    // The diagonal square with its vertex nearer a than the incenter: the
    // hinge runs up across the precreased diagonal into paper not cut.
    let state = cases::diagonal_square();
    let t22 = (PI / 8.0).tan();
    let op = by_edge([0.5, 0.5 * t22], [0.5, 0.0], diagonal);
    let refused = refusal(state.swivel_by_edge(&op, &none));
    let FoldRefusal::FanRayBlocked { faces } = &refused.refusal else {
        panic!("{refused:?}");
    };
    assert_eq!(faces.len(), 1);
}

/// A step stores the ridge only when it is not the foot: absent, the op
/// reads back as it was; present, replay takes the nearer of the two.
#[test]
fn the_ridge_is_stored_as_its_result() {
    let c = case("bottom edge onto the centre crease");
    let json = serde_json::to_value(&c.op).unwrap_or_default();
    assert!(json.get("ridge").is_none(), "{json}");
    let read: SwivelByEdge = serde_json::from_value(json).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(read, c.op);
    let a = analysis(&c.state, &c.op);
    let end = SwivelByEdge {
        // Any direction nearer the end's ray than the foot's.
        ridge: Some([a.ridges[1][0] * 3.0 + 0.01, a.ridges[1][1] * 3.0]),
        ..c.op.clone()
    };
    assert_eq!(analysis(&c.state, &end).ridge, 1);
    let exact = SwivelByEdge {
        ridge: Some(a.ridges[1]),
        ..c.op.clone()
    };
    let one = landed(c.state.swivel_by_edge(&end, &VertexChoices::default()));
    let two = landed(c.state.swivel_by_edge(&exact, &VertexChoices::default()));
    assert_eq!(one.state.parts(), two.state.parts());
}

/// The seeded campaign: on drawn folded states, an edge (a raw or folded
/// crease's sheet midpoint), a target through two vertex images, and a
/// pivot anywhere on the paper's bounding box. Every swivel that lands is
/// flat at its vertex, passes the gate, takes the rule's letters, lands its
/// edge on the target and is its rays form's state.
#[test]
fn every_swivel_by_edge_that_lands_folds_flat_with_its_edge_on_the_target() {
    let (mut landed_count, mut tried) = (0, 0);
    for seed in 0..400u64 {
        let mut rng = Rng::new(9001 + seed);
        let Ok(state) = random::folded(&mut rng) else {
            continue;
        };
        if state.faces().len() > 24 {
            continue;
        }
        let edges: Vec<[Point; 2]> = state
            .creases()
            .iter()
            .filter(|c| matches!(c.kind, CreaseKind::Border | CreaseKind::Folded(_)))
            .map(|c| c.vertices.map(|v| state.vertices()[v.0 as usize]))
            .filter(|[p, q]| (q[0] - p[0]).hypot(q[1] - p[1]) > 0.05)
            .collect();
        let Some(edge) = rng.pick(&edges) else {
            continue;
        };
        let images: Vec<Point> = (0..state.vertices().len())
            .filter_map(|v| state.vertex_image(oristudio_fold::VertexId(v as u32)))
            .collect();
        let (Some(p), Some(q)) = (rng.pick(&images), rng.pick(&images)) else {
            continue;
        };
        let Some(target) = Line::from_points(p, q) else {
            continue;
        };
        let pivot = [rng.next_f64(), rng.next_f64()];
        let mid = [
            (edge[0][0] + edge[1][0]) / 2.0,
            (edge[0][1] + edge[1][1]) / 2.0,
        ];
        let op = SwivelByEdge {
            direction: if rng.chance(0.5) {
                Direction::Valley
            } else {
                Direction::Mountain
            },
            ..by_edge(pivot, mid, target)
        };
        tried += 1;
        let Ok(VertexOutcome::Landed(folded)) =
            state.swivel_by_edge(&op, &VertexChoices::default())
        else {
            continue;
        };
        let label = format!("seed {seed}");
        let a = analysis(&state, &op);
        assert_flat(&a, &label);
        check(&state, &folded);
        let rays_form = state
            .swivel_by_edge_as_rays(&op)
            .unwrap_or_else(|e| panic!("{label}: {e}"));
        let fan = state
            .analyse_swivel(&rays_form)
            .unwrap_or_else(|e| panic!("{label}: {e}"));
        assert_ear_letters(&state, &folded, &fan, &label);
        // The edge's own crease, and the run beyond it, on the target.
        assert_edge_on_target(&state, &folded, edge, &a, &label);
        landed_count += 1;
    }
    eprintln!("{landed_count} of {tried} drawn swivels landed");
    assert!(landed_count >= 25, "{landed_count} of {tried}");
}

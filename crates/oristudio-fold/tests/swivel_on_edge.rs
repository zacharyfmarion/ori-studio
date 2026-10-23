//! The swivel on a folded edge (`compound::swivel_on_edge`): the classic
//! swivel, its creases meeting where the line halfway between the edge and
//! the target crosses a folded edge. The owner's case — Abrashi's "What is
//! Swivel fold?" on the squashed preliminary base — lands as the diagram's
//! second picture shows; the kite base narrows at its tip, one side and
//! then both; every landing passes the full gate, Kawasaki and Maekawa at
//! its vertex, lays its edge on the target and takes the letters the module
//! docs derive; the refusals are codes; a free swivel is spelled and folded
//! as before; and a seeded campaign checks every one that lands. The inside
//! swivel — Abrashi's figure 2 — lands on the same case with the same lines,
//! its strip tucked out of sight between the two layers; it narrows the kite
//! base with a choice of two orders; it is refused at a free vertex; its
//! kind is spelled only when inside; and the campaign's draws check every
//! one of it that lands.

mod beloch;
mod support;
mod vertex;

use std::f64::consts::{FRAC_1_SQRT_2, PI};

use oristudio_fold::pattern::opposite;
use oristudio_fold::random::{self, Rng};
use oristudio_fold::{
    CompoundRefused, CreaseKind, Direction, FaceId, Fix, FoldRefusal, Letter, Seed, State,
    SwivelByEdge, SwivelEdgeAnalysis, SwivelKind, SwivelRay, SwivelWedge, VertexChoices,
    VertexFolded, VertexOutcome,
};
use oristudio_geometry::Line;
use vertex::cases::{self, FoldSwivelCase, landed};
use vertex::{check, folded_segments, letters_at, only_order_of_its_pattern};

type Point = [f64; 2];

fn case(name: &str) -> FoldSwivelCase {
    cases::fold_swivel_cases()
        .into_iter()
        .find(|c| c.name == name)
        .unwrap_or_else(|| panic!("no case {name}"))
}

fn analysis(state: &State, op: &SwivelByEdge) -> SwivelEdgeAnalysis {
    state
        .analyse_swivel_by_edge(op)
        .unwrap_or_else(|e| panic!("{e} {e:?}"))
}

#[test]
fn a_flat_precrease_through_the_swivel_pivot_does_not_change_its_location() {
    for name in ["kite narrowed at c, right", "kite narrowed at c, left"] {
        for turned in [false, true] {
            let mut c = case(name);
            if turned {
                c.state = c.state.turn_over();
                c.op.direction = Direction::Mountain;
            }
            let expected = analysis(&c.state, &c.op);
            let p = expected.vertex;
            let precreased = cases::precrease(
                &c.state,
                p,
                [p[0] + 0.2, p[1] - 0.1],
                [p[0] + 0.1, p[1] + 0.1],
                Seed::All,
            );
            let actual = analysis(&precreased, &c.op);
            assert!(close(actual.vertex, expected.vertex), "{name}: {actual:?}");
            assert_same_swivel_choices(&c.state, &precreased, &c.op);
        }
    }
}

/// Geometry, exposed sides, and local material stacks, independent of the
/// face subdivision introduced by flat precreases.
fn material_pose(state: &State) -> Vec<i64> {
    let mut key = Vec::new();
    let rounded = |x: f64| (x * 1e9).round() as i64;
    for i in 0..19 {
        for j in 0..19 {
            let sheet = [(f64::from(i) + 0.317) / 19.0, (f64::from(j) + 0.613) / 19.0];
            let p = state.resolve_point(sheet).unwrap();
            key.extend(p.map(rounded));
            let stack = state.stack_at(p).unwrap_or_default();
            key.push(stack.len() as i64);
            for face in stack {
                key.extend(
                    state
                        .isometry(face)
                        .unwrap()
                        .inverse()
                        .apply(p)
                        .map(rounded),
                );
                key.push(i64::from(state.seen_front_up(face).unwrap()));
            }
        }
    }
    key
}

fn assert_same_swivel_choices(before: &State, precreased: &State, op: &SwivelByEdge) {
    let expected = cases::every(before.swivel_by_edge(op, &VertexChoices::default()));
    let actual = cases::every(precreased.swivel_by_edge(op, &VertexChoices::default()));
    assert!(!expected.is_empty());
    let keys = |folds: &[VertexFolded]| {
        folds
            .iter()
            .map(|f| material_pose(&f.state))
            .collect::<std::collections::BTreeSet<_>>()
    };
    assert_eq!(keys(&expected), keys(&actual));
    for folded in actual {
        check(precreased, &folded);
        let replayed = landed(precreased.swivel_by_edge(op, &folded.report.stored));
        assert_eq!(replayed.state.order(), folded.state.order());
    }
}

#[test]
fn a_swivel_reuses_its_precreased_rays() {
    for (name, kind) in [
        ("kite narrowed at c, right", SwivelKind::Open),
        ("kite narrowed at c, left", SwivelKind::Open),
        ("Abrashi's swivel", SwivelKind::Inside),
    ] {
        let mut c = case(name);
        c.op.kind = kind;
        let a = analysis(&c.state, &c.op);
        let mut state = c.state.clone();
        for crease in &a.creases {
            let p = crease.from;
            let q = crease.to;
            if close(p, q) {
                continue;
            }
            let line = Line::from_points(p, q).unwrap();
            // Several visible rays name the same line in its two layers.
            if state
                .vertices()
                .iter()
                .any(|&v| state.resolve_point(v).is_some_and(|v| close(v, a.vertex)))
                && state.creases().iter().any(|edge| {
                    matches!(edge.kind, CreaseKind::Flat(_))
                        && edge
                            .vertices
                            .iter()
                            .all(|&v| line.distance_to_point(state.vertex_image(v).unwrap()) < 1e-9)
                })
            {
                continue;
            }
            let toward = [p[0] + line.n[0] * 0.1, p[1] + line.n[1] * 0.1];
            state = cases::precrease(&state, p, q, toward, Seed::All);
        }
        assert_same_swivel_choices(&c.state, &state, &c.op);
    }
}

fn refusal(outcome: Result<VertexOutcome, CompoundRefused>) -> oristudio_fold::Refused {
    match outcome {
        Err(CompoundRefused::Refused(refused)) => refused,
        Err(CompoundRefused::Broken(b)) => panic!("broken {b}"),
        Ok(_) => panic!("landed"),
    }
}

fn close(p: Point, q: Point) -> bool {
    (p[0] - q[0]).hypot(p[1] - q[1]) < 1e-9
}

/// A model point as the viewer sees it.
fn scene(state: &State, p: Point) -> Point {
    state.view().transform().apply(p)
}

/// The faces at a point the viewer sees, nearest first.
fn seen_stack(state: &State, at_scene: Point) -> Vec<FaceId> {
    let model = state.view().transform().inverse().apply(at_scene);
    let mut stack = state.stack_at(model).unwrap_or_default();
    if state.view().flipped {
        stack.reverse();
    }
    stack
}

/// The parent's face a landed face is, or is a piece of.
fn lineage(parent: &State, folded: &State, face: FaceId) -> FaceId {
    folded
        .face(face)
        .and_then(|f| f.parent)
        .filter(|p| parent.face(*p).is_some())
        .unwrap_or(face)
}

/// Kawasaki's theorem at a sheet vertex: alternate sectors between its
/// folded creases sum to a half turn.
fn assert_kawasaki(state: &State, at: Point, label: &str) {
    let mut angles: Vec<f64> = state
        .creases()
        .iter()
        .filter(|c| c.kind.is_folded())
        .filter_map(|c| {
            let [a, b] = c.vertices.map(|v| state.vertices()[v.0 as usize]);
            let other = if close(a, at) {
                b
            } else if close(b, at) {
                a
            } else {
                return None;
            };
            Some(
                (other[1] - at[1])
                    .atan2(other[0] - at[0])
                    .rem_euclid(2.0 * PI),
            )
        })
        .collect();
    angles.sort_by(f64::total_cmp);
    assert_eq!(angles.len(), 4, "{label}: {angles:?}");
    let alternate = (angles[1] - angles[0]) + (angles[3] - angles[2]);
    assert!((alternate - PI).abs() < 1e-9, "{label}: {alternate}");
}

/// The landed state's sheet point at the swivel's vertex: where its new
/// creases meet.
fn vertex_sheet(folded: &VertexFolded) -> Point {
    let state = &folded.state;
    let ends: Vec<Point> = folded
        .report
        .fold
        .created
        .iter()
        .filter_map(|&id| state.crease(id))
        .flat_map(|c| c.vertices.map(|v| state.vertices()[v.0 as usize]))
        .collect();
    *ends
        .iter()
        .max_by_key(|p| ends.iter().filter(|q| close(**p, **q)).count())
        .unwrap_or_else(|| panic!("no new creases"))
}

/// The parent's model point at a sheet vertex.
fn vertex_at(state: &State, p: Point) -> Point {
    let v = state
        .vertices()
        .iter()
        .position(|q| close(*q, p))
        .unwrap_or_else(|| panic!("no vertex at {p:?}"));
    state
        .vertex_image(oristudio_fold::VertexId(v as u32))
        .unwrap_or_else(|| panic!("no image of {p:?}"))
}

/// Every vertex the landed state has along the edge's sheet segment lies
/// on the target once folded where the edge runs from where it meets the
/// target on (the part that swivels), and stays where it was on the other
/// side of that point; returns how many lie on the target.
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
    let state = &folded.state;
    let run = [edge[1][0] - edge[0][0], edge[1][1] - edge[0][1]];
    let run2 = run[0] * run[0] + run[1] * run[1];
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

/// The faces joined to `faces` across flat creases, theirs included.
fn flat_closure(state: &State, faces: Vec<FaceId>) -> std::collections::BTreeSet<FaceId> {
    let mut out: std::collections::BTreeSet<FaceId> = faces.into_iter().collect();
    let holds = |f: &oristudio_fold::Face, a, b| {
        let n = f.ring.len();
        (0..n).any(|i| {
            let (p, q) = (f.ring[i], f.ring[(i + 1) % n]);
            (p, q) == (a, b) || (p, q) == (b, a)
        })
    };
    loop {
        let before = out.len();
        for c in state.creases() {
            if !matches!(c.kind, CreaseKind::Flat(_)) {
                continue;
            }
            let [a, b] = c.vertices;
            let sides: Vec<FaceId> = state
                .faces()
                .iter()
                .filter(|f| holds(f, a, b))
                .map(|f| f.id)
                .collect();
            if sides.iter().any(|f| out.contains(f)) {
                out.extend(sides);
            }
        }
        if out.len() == before {
            return out;
        }
    }
}

/// The letters the new creases fold as the viewer saw each one's layer in
/// the parent, by the ray they run along: (ray, letter) per created crease.
fn seen_letters(
    parent: &State,
    folded: &VertexFolded,
    a: &SwivelEdgeAnalysis,
) -> Vec<(SwivelRay, FaceId, Letter)> {
    let state = &folded.state;
    let mut out = Vec::new();
    for &id in &folded.report.fold.created {
        let Some(crease) = state.crease(id) else {
            continue;
        };
        let CreaseKind::Folded(letter) = crease.kind else {
            panic!("new crease {id} is not folded");
        };
        let [p, q] = crease.vertices;
        let face = state
            .faces()
            .iter()
            .find(|f| f.ring.contains(&p) && f.ring.contains(&q))
            .unwrap_or_else(|| panic!("no face holds crease {id}"));
        let layer = lineage(parent, state, face.id);
        let t = parent.isometry(layer).unwrap_or_default();
        let [mp, mq] = [p, q].map(|v| t.apply(state.vertices()[v.0 as usize]));
        let far = if close(mp, a.vertex) { mq } else { mp };
        let d = [far[0] - a.vertex[0], far[1] - a.vertex[1]];
        let ray = a
            .creases
            .iter()
            .find(|c| {
                (c.direction[0] * d[1] - c.direction[1] * d[0]).abs() < 1e-7 * d[0].hypot(d[1])
            })
            .map(|c| c.ray)
            .unwrap_or_else(|| panic!("crease {id} runs along no ray"));
        let seen_up = parent.seen_front_up(layer).unwrap_or(true);
        out.push((ray, layer, if seen_up { letter } else { opposite(letter) }));
    }
    out
}

/// Land a swivel on a folded edge as it must, and check it every way
/// ([`landing_checked`]).
fn swivel_checked(c: &FoldSwivelCase, op: &SwivelByEdge, label: &str) -> VertexFolded {
    let folded = cases::every(c.state.swivel_by_edge(op, &VertexChoices::default()));
    assert!(!folded.is_empty(), "{label}: no valid order");
    for candidate in &folded {
        landing_checked(c, op, candidate, label);
    }
    folded.into_iter().next().unwrap()
}

/// A swivel on a folded edge's landing, checked every way: the full gate and
/// its motion, Kawasaki and Maekawa (3 : 1) at its vertex, the folded edge's
/// half that opens lying flat, the letters as the viewer saw each layer
/// (the edge layer's swivel crease as the direction; open, the other
/// layer's second as the direction and its swivel crease the other way;
/// inside, the other way round), its edge on the target, the regions it
/// previews, and its picture.
fn landing_checked(c: &FoldSwivelCase, op: &SwivelByEdge, folded: &VertexFolded, label: &str) {
    let parent = &c.state;
    let a = analysis(parent, op);
    check(parent, folded);
    let at = vertex_sheet(folded);
    assert_kawasaki(&folded.state, at, label);
    let (m, v) = letters_at(&folded.state, at);
    assert!(
        (m, v) == (1, 3) || (m, v) == (3, 1),
        "{label}: {m} M, {v} V"
    );
    assert!(folded.report.fold.created.len() >= 3, "{label}");
    assert!(!folded.report.fold.unfolded.is_empty(), "{label}: h₋ opens");
    assert!(a.fold.is_some(), "{label}: no fold");
    let given = match op.direction {
        Direction::Valley => Letter::Valley,
        Direction::Mountain => Letter::Mountain,
    };
    // Open, the strip folds up across the second crease and the little
    // wedge back over it; inside, the strip folds under and the wedge
    // follows it in.
    let (second, others) = match op.kind {
        SwivelKind::Open => (given, opposite(given)),
        SwivelKind::Inside => (opposite(given), given),
    };
    // The other layer is the paper the second crease cuts, and all of it
    // joined flat (the edge's layer, folded to it, never is).
    let letters = seen_letters(parent, folded, &a);
    let other = flat_closure(
        parent,
        letters
            .iter()
            .filter(|(ray, _, _)| *ray == SwivelRay::Hinge)
            .map(|&(_, layer, _)| layer)
            .collect(),
    );
    // It lies on the direction's side of the edge's layer, so open is on top
    // and inside between the two (the module docs).
    assert!(
        other.contains(&a.layers[0]),
        "{label}: the other layer is the farther, {:?}",
        a.layers
    );
    for (ray, layer, letter) in letters {
        let expected = match ray {
            SwivelRay::Hinge => second,
            SwivelRay::Meet if other.contains(&layer) => others,
            SwivelRay::Meet => given,
            other => panic!("{label}: a {other:?} crease"),
        };
        assert_eq!(letter, expected, "{label}: {ray:?} in face {layer}");
    }
    // The preview says so too.
    let previewed: Vec<(SwivelRay, Letter)> = a.creases.iter().map(|c| (c.ray, c.letter)).collect();
    assert_eq!(
        previewed,
        vec![
            (SwivelRay::Meet, given),
            (SwivelRay::Meet, others),
            (SwivelRay::Hinge, second)
        ],
        "{label}"
    );
    assert!(
        assert_edge_on_target(parent, folded, c.edge, &a, label) >= 1,
        "{label}: too few of the edge's vertices checked"
    );
    let wedges: std::collections::HashSet<_> = a.regions.iter().map(|r| r.wedge).collect();
    assert_eq!(
        wedges,
        [SwivelWedge::Near, SwivelWedge::Turn, SwivelWedge::Beyond]
            .into_iter()
            .collect(),
        "{label}"
    );
    let action = parent
        .swivel_by_edge_action(op, Some(&folded.state))
        .unwrap_or_else(|e| panic!("{label}: {e}"));
    assert!(action.line.is_some(), "{label}: {action:?}");
    assert!(!action.moving.is_empty(), "{label}");
}

/// Abrashi's "What is Swivel fold?" on the owner's squashed preliminary
/// base: the kite's lower-left edge onto the centre line, the creases
/// meeting on its upper-left edge, where the line halfway between them
/// crosses it. The swivel turns about the bottom tip; the edge's layer
/// creases from there to the tip; the top layer creases along the same line
/// and along the one to the kite's right corner, and folds up along it.
/// The landing is the diagram's second picture: the edge on the centre
/// line, a narrow triangle beside it, the top layer's strip shown from
/// behind between the centre line and the right corner, the little
/// triangle by the left corner turned a quarter turn over it.
#[test]
fn abrashi_s_swivel_lands_as_the_diagram_shows() {
    let c = case("Abrashi's swivel");
    let parent = &c.state;
    let a = analysis(parent, &c.op);
    let k = FRAC_1_SQRT_2;
    // As the viewer sees it: the tip at the origin, the closed point at
    // (0, k), the kite's corners at (∓(k − ½), k − ½).
    let near = |p: Point, q: Point| (p[0] - q[0]).hypot(p[1] - q[1]) < 1e-9;
    let v = scene(parent, a.vertex);
    assert!(near(v, [-(1.0 - k) / 2.0, k / 2.0]), "{v:?}");
    assert!(near(scene(parent, a.meet), [0.0, 0.0]));
    assert!(
        (a.rotation.abs() - PI / 2.0).abs() < 1e-12,
        "{}",
        a.rotation
    );
    assert_eq!(
        a.creases
            .iter()
            .map(|c| (c.ray, c.letter, c.ridge))
            .collect::<Vec<_>>(),
        vec![
            (SwivelRay::Meet, Letter::Valley, false),
            (SwivelRay::Meet, Letter::Mountain, true),
            (SwivelRay::Hinge, Letter::Valley, false),
        ]
    );
    // The edge layer's crease runs to the tip; the top layer's second to
    // the kite's right corner.
    assert!(near(scene(parent, a.creases[0].to), [0.0, 0.0]));
    assert!(near(scene(parent, a.creases[2].to), [k - 0.5, k - 0.5]));
    // Seen from the top layer, its swivel crease shows from the vertex to
    // its raw edge, the edge layer's from there to the tip.
    assert!(near(a.creases[1].from, a.vertex));
    assert!(near(a.creases[0].from, a.creases[1].to));
    assert!(a.ridges.is_empty());
    let fold = a.fold.clone().unwrap_or_else(|| panic!("no fold"));
    assert!(near(scene(parent, fold.opens[1]), [-(k - 0.5), k - 0.5]));
    assert_eq!(fold.faces.len(), 2);
    assert_eq!(a.layers.len(), 2);

    let folded = swivel_checked(&c, &c.op, c.name);
    let state = &folded.state;
    // Pictured along the swivel crease from the vertex, the arrow from the
    // triangle that swivels to where it lands.
    let action = parent
        .swivel_by_edge_action(&c.op, Some(state))
        .unwrap_or_else(|e| panic!("{e}"));
    assert!(action.grip.is_some(), "{action:?}");
    // One order, which the crease pattern and its letters alone allow.
    assert!(only_order_of_its_pattern(state));
    // The kite's lower-left edge lies along the centre line, from the tip up
    // to (0, 1 − k).
    let edge_ends: Vec<Point> = state
        .vertices()
        .iter()
        .enumerate()
        .filter(|(_, s)| (s[0] - 1.0).abs() < 1e-9 && s[1] >= k - 1e-9)
        .filter_map(|(i, _)| state.vertex_image(oristudio_fold::VertexId(i as u32)))
        .map(|p| scene(state, p))
        .collect();
    assert!(edge_ends.iter().any(|&p| near(p, [0.0, 0.0])));
    assert!(edge_ends.iter().any(|&p| near(p, [0.0, 1.0 - k])));
    assert!(edge_ends.iter().all(|p| p[0].abs() < 1e-9), "{edge_ends:?}");

    // The second picture, as the viewer sees it, top layer first.
    let (top_layer, edge_layer) = (a.layers[0], a.layers[1]);
    let faces_of = |p: Point| -> Vec<(FaceId, bool)> {
        seen_stack(state, p)
            .into_iter()
            .map(|f| {
                let from = lineage(parent, state, f);
                let turned = state.seen_front_up(f) != parent.seen_front_up(from);
                (from, turned)
            })
            .collect()
    };
    // Between the vertex, the centre line and (0, √2 − 1): the top layer's
    // little triangle by the left corner, a quarter turn round as it was,
    // over its strip shown from behind, over the rest of the top layer.
    let little = faces_of([-0.05, 0.37]);
    assert_eq!(little[0], (top_layer, false), "{little:?}");
    assert_eq!(little[1], (top_layer, true), "{little:?}");
    assert_eq!(little[2], (top_layer, false), "{little:?}");
    assert_eq!(little[3], (edge_layer, false), "{little:?}");
    // Below it, the swivelled triangle of the edge's layer, turned over, on
    // the rest of that layer.
    let swung = faces_of([-0.03, 0.15]);
    assert_eq!(swung[0], (edge_layer, true), "{swung:?}");
    assert_eq!(swung[1], (edge_layer, false), "{swung:?}");
    // Right of the centre line, the strip folded up shows its back up to the
    // line from (0, √2 − 1) to the right corner; below that line the flap's
    // right half, as before.
    let strip = faces_of([0.06, 0.3]);
    assert!(strip[0].1, "{strip:?}");
    assert_ne!(strip[0].0, edge_layer);
    let below = faces_of([0.05, 0.12]);
    assert!(!below[0].1, "{below:?}");
    assert!(parent.faces().iter().any(|f| f.id == below[0].0));
    // The crease pattern: the four new creases and the half that opened,
    // on top of the squash's.
    let before = folded_segments(parent);
    let after = folded_segments(state);
    assert_eq!(after.difference(&before).count(), 4, "{after:?}");
}

/// The other direction, the paper behind: the edge's triangle would have
/// to pass behind the base's other flaps, which it is joined in front of.
/// Refused for want of an order, offering the valley.
#[test]
fn abrashi_s_swivel_as_a_mountain_offers_the_valley() {
    let c = case("Abrashi's swivel");
    let op = SwivelByEdge {
        direction: Direction::Mountain,
        ..c.op.clone()
    };
    let refused = refusal(c.state.swivel_by_edge(&op, &VertexChoices::default()));
    assert_eq!(refused.refusal.code(), "no_order", "{refused:?}");
    assert_eq!(refused.fixes, vec![Fix::OppositeDirection]);
}

/// The kite base narrowed at its tip: each side's edge q c onto the
/// diagonal, the creases meeting on that side's kite crease; then the other
/// side on the first's landing. The flap over the kite crease folds across
/// the diagonal, over the other flap.
#[test]
fn the_kite_base_narrows_at_its_tip() {
    let right = case("kite narrowed at c, right");
    let a = analysis(&right.state, &right.op);
    // The bisector from c meets a q₁ at (k, 1 − k): α = 45°.
    let k = FRAC_1_SQRT_2;
    assert!(close(a.vertex, [k, 1.0 - k]), "{:?}", a.vertex);
    assert!(close(a.meet, [1.0, 1.0]));
    let one = swivel_checked(&right, &right.op, right.name);
    let left = case("kite narrowed at c, left");
    swivel_checked(&left, &left.op, left.name);
    // Both sides, the second on the first.
    let second = cases::on_fold(
        &one.state,
        left.op.fold.unwrap_or_default(),
        left.op.edge,
        [0.5, 0.5],
    );
    let both = FoldSwivelCase {
        name: "kite narrowed at c, both",
        state: one.state.clone(),
        op: second.clone(),
        edge: left.edge,
        fold: left.fold,
    };
    let folded = swivel_checked(&both, &second, both.name);
    // Mirror-symmetric across a c, (x, y) ↦ (y, x).
    let segments = folded_segments(&folded.state);
    let mirrored: std::collections::BTreeSet<_> = segments
        .iter()
        .map(|&(l, p, q)| {
            let (p, q) = ([p[1], p[0]], [q[1], q[0]]);
            if p <= q { (l, p, q) } else { (l, q, p) }
        })
        .collect();
    assert_eq!(mirrored, segments);
}

#[test]
fn matching_swivels_offer_orders_without_reordering_stationary_paper() {
    for turned in [false, true] {
        let mut right = case("kite narrowed at c, right");
        if turned {
            right.state = right.state.turn_over();
            right.op.direction = Direction::Mountain;
        }
        let first = cases::every(
            right
                .state
                .swivel_by_edge(&right.op, &VertexChoices::default()),
        );
        assert_eq!(first.len(), 2);
        let left = case("kite narrowed at c, left");
        for first in first {
            let parent = &first.state;
            let mut op = cases::on_fold(parent, left.op.fold.unwrap(), left.op.edge, [0.5, 0.5]);
            op.direction = right.op.direction;
            let Ok(VertexOutcome::ChooseOrder(choice)) =
                parent.swivel_by_edge(&op, &VertexChoices::default())
            else {
                panic!("the matching swivel must expose the overlapping flap's orders");
            };
            assert!(choice.count().exact && choice.count().orders > 1);
            let candidates = cases::every(parent.swivel_by_edge(&op, &VertexChoices::default()));
            let case = FoldSwivelCase {
                state: parent.clone(),
                op: op.clone(),
                name: left.name,
                edge: left.edge,
                fold: left.fold,
            };
            let baseline = &candidates[0].state;
            let mut varies_against_stationary = false;
            for folded in &candidates {
                landing_checked(&case, &op, folded, "matching swivel");
                assert_eq!(folded_segments(&folded.state), folded_segments(baseline));
                let moving: std::collections::HashSet<_> = folded
                    .report
                    .fold
                    .blocks
                    .iter()
                    .flatten()
                    .copied()
                    .collect();
                for face in folded.state.faces() {
                    assert_eq!(
                        folded.state.face_image(face.id),
                        baseline.face_image(face.id)
                    );
                }
                for (pair, above) in folded.state.order().pairs() {
                    let (a, b) = (pair.lo(), pair.hi());
                    if !moving.contains(&a) && !moving.contains(&b) {
                        assert_eq!(
                            above,
                            parent.above(
                                lineage(parent, &folded.state, a),
                                lineage(parent, &folded.state, b)
                            )
                        );
                    } else if moving.contains(&a) != moving.contains(&b) {
                        varies_against_stationary |= above != baseline.above(a, b);
                    }
                }
                let stored = serde_json::to_string(&folded.report.stored).unwrap();
                let replayed =
                    landed(parent.swivel_by_edge(&op, &serde_json::from_str(&stored).unwrap()));
                assert_eq!(replayed.state.order(), folded.state.order());
            }
            assert!(
                varies_against_stationary,
                "orders must vary against the other flap"
            );
        }
    }
}

/// The refusals, each a code: a point on no folded crease, a bisector that
/// crosses the folded edge nowhere, a swivel crease meeting the folded edge
/// at a right angle, a crease running into a fold before the paper's edge,
/// and an edge the swivelling wedge does not hold.
#[test]
fn a_swivel_on_a_folded_edge_that_does_not_fit_is_refused_by_code() {
    let none = VertexChoices::default();
    let c = case("Abrashi's swivel");
    let state = &c.state;
    let k = FRAC_1_SQRT_2;
    // The centre line's precrease, and the kite's raw edge: no fold.
    for point in [[0.75, 0.5], [1.0, (k + 1.0) / 2.0]] {
        let op = SwivelByEdge {
            fold: Some(point),
            ..c.op.clone()
        };
        let refused = refusal(state.swivel_by_edge(&op, &none));
        assert_eq!(refused.refusal, FoldRefusal::SwivelNotAFold { point });
        assert!(state.analyse_swivel_by_edge(&op).is_err());
    }
    // The kite's upper-right edge: the bisector from the tip runs up the
    // left half, never crossing it.
    let op = SwivelByEdge {
        fold: Some([0.75, (0.5 + 1.0 - k) / 2.0]),
        ..c.op.clone()
    };
    let refused = refusal(state.swivel_by_edge(&op, &none));
    assert_eq!(refused.refusal.code(), "swivel_misses_fold", "{refused:?}");
    assert_eq!(refused.refusal.faces().len(), 2);
    // The square folded on b d: its bottom layer's left edge onto the
    // bottom edge's line meets b d at a right angle from a.
    let tri = cases::valley(&cases::square(), [1.0, 0.0], [0.0, 1.0], [1.0, 1.0]);
    let bottom = tri
        .crease_at([0.5, 0.0])
        .and_then(|c| tri.crease_line(c.id))
        .unwrap_or_else(|| panic!("no bottom edge"));
    let op = SwivelByEdge {
        pivot: [0.5, 0.5],
        edge: [0.0, 0.5],
        target: bottom,
        layers: Seed::All,
        ridge: None,
        direction: Direction::Valley,
        fold: Some([0.5, 0.5]),
        kind: SwivelKind::Open,
    };
    let refused = refusal(tri.swivel_by_edge(&op, &none));
    assert_eq!(refused.refusal.code(), "swivel_fold_wide", "{refused:?}");
    // The top layer's raw edge along the kite's middle onto the centre line:
    // the same vertex, but the edge's layer is now the top one, and the
    // creases in the layer under it run into the fold down the centre.
    let op = cases::on_fold(
        state,
        c.op.fold.unwrap_or_default(),
        [1.0, 0.6],
        [0.75, 0.5],
    );
    let refused = refusal(state.swivel_by_edge(&op, &none));
    assert_eq!(refused.refusal.code(), "fan_ray_blocked", "{refused:?}");
}

/// The edge names a line: the base flaps' lower-left edges lie behind the
/// kite's along the model's lower-left edge, and a click on any of them
/// names that line — the swivel is the same, its own triangle's edge laid
/// on the centre line.
#[test]
fn edges_stacked_on_one_line_name_one_swivel() {
    let c = case("Abrashi's swivel");
    let state = &c.state;
    let none = VertexChoices::default();
    let by_kite = landed(state.swivel_by_edge(&c.op, &none));
    for behind in [[0.0, 0.75], [0.75, 1.0]] {
        let op = cases::on_fold(state, c.op.fold.unwrap_or_default(), behind, [0.75, 0.5]);
        let by_base = landed(state.swivel_by_edge(&op, &none));
        assert_eq!(
            folded_segments(&by_base.state),
            folded_segments(&by_kite.state),
            "{behind:?}"
        );
        let a = analysis(state, &op);
        let [p, q] = a.landed[0];
        let k = FRAC_1_SQRT_2;
        let near = |x: Point, y: Point| (x[0] - y[0]).hypot(x[1] - y[1]) < 1e-9;
        // From the tip up the centre line to (0, 1 − k), as the viewer sees it.
        assert!(near(scene(state, p), [0.0, 0.0]), "{p:?}");
        assert!(near(scene(state, q), [0.0, 1.0 - k]), "{q:?}");
    }
}

/// An edge of a third flap: on a drawn state (the square's top two thirds
/// folded down, that flap's corner folded back up), the swivel's creases
/// meet on the first fold, but the edge clicked — the corner's, along the
/// line x ≈ 0.33 — is in neither layer that fold joins, and the swivelling
/// wedge has no side along its line: nothing would land on the target.
#[test]
fn an_edge_neither_layer_holds_stays() {
    let mut rng = Rng::new(77_319);
    let state = random::folded(&mut rng).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(state.faces().len(), 3);
    let fold = [0.5, 0.328_091_868_022_873_05];
    let op = SwivelByEdge {
        pivot: state.resolve_point(fold).unwrap_or_default(),
        edge: [0.664_020_994_937_064_8, 1.0],
        target: Line::new(
            [0.311_617_507_588_146_77, 0.950_207_624_135_141_9],
            0.311_617_507_588_146_77,
        )
        .unwrap_or_else(|| panic!("no target")),
        layers: Seed::All,
        ridge: None,
        direction: Direction::Valley,
        fold: Some(fold),
        kind: SwivelKind::Open,
    };
    let refused = refusal(state.swivel_by_edge(&op, &VertexChoices::default()));
    assert_eq!(refused.refusal.code(), "swivel_edge_stays", "{refused:?}");
}

/// A free swivel's op is spelled as it always was, with no `fold`; one on a
/// folded edge carries it, and reads back as it was.
#[test]
fn the_folded_edge_is_spelled_only_when_the_creases_meet_on_one() {
    let free = cases::by_edge(
        [0.8, 0.3],
        [0.5, 0.0],
        support::through([0.0, 0.0], [1.0, 1.0]),
    );
    let json = serde_json::to_value(&free).unwrap_or_default();
    assert!(json.get("fold").is_none(), "{json}");
    let c = case("Abrashi's swivel");
    let json = serde_json::to_value(&c.op).unwrap_or_default();
    assert!(json.get("fold").is_some(), "{json}");
    let read: SwivelByEdge = serde_json::from_value(json).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(read, c.op);
    // There is no rays form: the vertex lies on a crease.
    let refused = c
        .state
        .swivel_by_edge_as_rays(&c.op)
        .expect_err("a rays form");
    assert_eq!(refused.refusal.code(), "fan_center");
}

/// The seeded campaign's draws: on drawn folded states, a folded crease (its
/// sheet midpoint), an edge (a raw or folded crease's), a target through two
/// vertex images, valley or mountain; an open swivel on that folded edge,
/// each with the seed it was drawn from.
fn drawn_swivels() -> Vec<(u64, FoldSwivelCase)> {
    let mut out = Vec::new();
    for seed in 0..1500u64 {
        let mut rng = Rng::new(31_337 + seed);
        let Ok(state) = random::folded(&mut rng) else {
            continue;
        };
        if state.faces().len() > 24 {
            continue;
        }
        let sheet_of = |kind: fn(&CreaseKind) -> bool| -> Vec<[Point; 2]> {
            state
                .creases()
                .iter()
                .filter(|c| kind(&c.kind))
                .map(|c| c.vertices.map(|v| state.vertices()[v.0 as usize]))
                .filter(|[p, q]| (q[0] - p[0]).hypot(q[1] - p[1]) > 0.05)
                .collect()
        };
        let folds = sheet_of(|k| matches!(k, CreaseKind::Folded(_)));
        let edges = sheet_of(|k| matches!(k, CreaseKind::Border | CreaseKind::Folded(_)));
        let (Some(fold), Some(edge)) = (rng.pick(&folds), rng.pick(&edges)) else {
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
        let mid = |s: [Point; 2]| [(s[0][0] + s[1][0]) / 2.0, (s[0][1] + s[1][1]) / 2.0];
        let Some(pivot) = state.resolve_point(mid(fold)) else {
            continue;
        };
        let op = SwivelByEdge {
            pivot,
            edge: mid(edge),
            target,
            layers: Seed::All,
            ridge: None,
            direction: if rng.chance(0.5) {
                Direction::Valley
            } else {
                Direction::Mountain
            },
            fold: Some(mid(fold)),
            kind: SwivelKind::Open,
        };
        out.push((
            seed,
            FoldSwivelCase {
                name: "campaign",
                state,
                op,
                edge,
                fold,
            },
        ));
    }
    out
}

/// The seeded campaign ([`drawn_swivels`]): every open swivel on a folded
/// edge that lands passes the full gate, is flat at its vertex with
/// Maekawa's 3 : 1, and lays its edge on the target.
#[test]
fn every_swivel_on_a_folded_edge_that_lands_folds_flat_with_its_edge_on_the_target() {
    let drawn = drawn_swivels();
    let mut landed_count = 0;
    for (seed, c) in &drawn {
        let candidates = cases::every(c.state.swivel_by_edge(&c.op, &VertexChoices::default()));
        for folded in &candidates {
            landing_checked(c, &c.op, folded, &format!("seed {seed}"));
        }
        landed_count += usize::from(!candidates.is_empty());
    }
    let tried = drawn.len();
    eprintln!("{landed_count} of {tried} drawn swivels on folded edges landed");
    assert!(landed_count >= 30, "{landed_count} of {tried}");
}

// --- The inside swivel ------------------------------------------------------

/// A case's op made inside.
fn inside(op: &SwivelByEdge) -> SwivelByEdge {
    SwivelByEdge {
        kind: SwivelKind::Inside,
        ..op.clone()
    }
}

/// A folded state's crease pattern by its lines alone, letters aside.
fn lines_of(state: &State) -> std::collections::BTreeSet<([i64; 2], [i64; 2])> {
    folded_segments(state)
        .into_iter()
        .map(|(_, p, q)| (p, q))
        .collect()
}

/// The parent's faces the viewer sees at a point of a landing, nearest
/// first, each with whether it is turned over from how the parent showed it.
fn seen_faces(parent: &State, state: &State, at_scene: Point) -> Vec<(FaceId, bool)> {
    seen_stack(state, at_scene)
        .into_iter()
        .map(|f| {
            let from = lineage(parent, state, f);
            (from, state.seen_front_up(f) != parent.seen_front_up(from))
        })
        .collect()
}

/// Abrashi's figure 2, the closed or inside swivel, on the owner's squashed
/// preliminary base: the same creases as the open swivel's, but the line
/// from the vertex to the kite's right corner a mountain and the whole line
/// down to the bottom tip a valley, as the diagram's first picture draws
/// them. The edge's triangle still swings up onto the centre line; the top
/// layer's strip folds under the rest of its layer, between the two layers,
/// and the little triangle by the left corner follows it in. The second
/// picture: the strip hidden (its outline, the triangle from the vertex to
/// (0, √2 − 1) and the right corner, is the diagram's dashed one), the line
/// from the vertex to the right corner an edge, the right flap's white
/// below it.
#[test]
fn abrashi_s_inside_swivel_lands_as_figure_2_shows() {
    let c = case("Abrashi's swivel");
    let parent = &c.state;
    let op = inside(&c.op);
    let a = analysis(parent, &op);
    let open = analysis(parent, &c.op);
    // The same vertex, creases and landing as the open swivel's.
    assert_eq!(a.vertex, open.vertex);
    assert_eq!(a.landed, open.landed);
    assert_eq!(a.regions, open.regions);
    assert_eq!(a.layers, open.layers);
    for (i, o) in a.creases.iter().zip(&open.creases) {
        assert_eq!((i.ray, i.from, i.to), (o.ray, o.from, o.to));
    }
    // The letters as the viewer sees them: the swivel crease a valley in
    // both layers, the second crease the mountain, the odd one out.
    assert_eq!(
        a.creases
            .iter()
            .map(|c| (c.ray, c.letter, c.ridge))
            .collect::<Vec<_>>(),
        vec![
            (SwivelRay::Meet, Letter::Valley, false),
            (SwivelRay::Meet, Letter::Valley, false),
            (SwivelRay::Hinge, Letter::Mountain, true),
        ]
    );

    let folded = swivel_checked(&c, &op, "Abrashi's inside swivel");
    let state = &folded.state;
    // One order, which the crease pattern and its letters alone allow.
    assert!(only_order_of_its_pattern(state));
    // The crease pattern: the open swivel's lines, two of its letters
    // turned — the top layer's swivel crease and its second, both from the
    // vertex.
    let opened = landed(parent.swivel_by_edge(&c.op, &VertexChoices::default()));
    assert_eq!(lines_of(state), lines_of(&opened.state));
    let ours = folded_segments(state);
    let theirs = folded_segments(&opened.state);
    let turned: Vec<_> = ours.difference(&theirs).collect();
    assert_eq!(turned.len(), 2, "{turned:?}");
    let at = vertex_sheet(&folded);
    let at = [(at[0] * 1e6).round() as i64, (at[1] * 1e6).round() as i64];
    for &&(letter, p, q) in &turned {
        assert!(p == at || q == at, "{p:?} {q:?}");
        assert!(theirs.contains(&(opposite(letter), p, q)));
    }

    // The second picture, as the viewer sees it.
    let (top_layer, edge_layer) = (a.layers[0], a.layers[1]);
    let top = flat_closure(parent, vec![top_layer]);
    // Between the vertex, the centre line and (0, √2 − 1): the rest of the
    // top layer, over its strip folded under, over the little triangle
    // turned in place, over the edge's layer.
    let little = seen_faces(parent, state, [-0.05, 0.37]);
    assert_eq!(little[0], (top_layer, false), "{little:?}");
    assert_eq!(little[1], (top_layer, true), "{little:?}");
    assert_eq!(little[2], (top_layer, false), "{little:?}");
    assert_eq!(little[3], (edge_layer, false), "{little:?}");
    // Below it, the swivelled triangle of the edge's layer, turned over, on
    // the rest of that layer, as in the open swivel.
    let swung = seen_faces(parent, state, [-0.03, 0.15]);
    assert_eq!(swung[0], (edge_layer, true), "{swung:?}");
    assert_eq!(swung[1], (edge_layer, false), "{swung:?}");
    // Right of the centre line, above the line to the right corner: the top
    // layer as it was, its strip under it.
    let strip = seen_faces(parent, state, [0.06, 0.3]);
    assert!(top.contains(&strip[0].0) && !strip[0].1, "{strip:?}");
    assert!(top.contains(&strip[1].0) && strip[1].1, "{strip:?}");
    // Below that line, the right flap the strip uncovered, as it was.
    let below = seen_faces(parent, state, [0.05, 0.25]);
    assert!(!top.contains(&below[0].0) && !below[0].1, "{below:?}");
    // Nowhere does the strip show: no face of the top layer turned over is
    // the one the viewer sees (on a grid off the creases' lines).
    for i in -20..=20 {
        for j in 0..=40 {
            let p = [f64::from(i) * 0.02 + 0.0037, f64::from(j) * 0.02 + 0.0051];
            if let Some(&(face, turned)) = seen_faces(parent, state, p).first() {
                assert!(!(turned && top.contains(&face)), "the strip shows at {p:?}");
            }
        }
    }
    // The strip hidden under it is figure 2's dashed triangle: the vertex,
    // (0, √2 − 1) and the right corner — its pieces (cut where the centre
    // precrease crossed it) fill that triangle and no more.
    let k = FRAC_1_SQRT_2;
    let triangle = [
        scene(parent, a.vertex),
        [0.0, std::f64::consts::SQRT_2 - 1.0],
        [k - 0.5, k - 0.5],
    ];
    let area = |ring: &[Point]| -> f64 {
        let n = ring.len();
        (0..n)
            .map(|i| {
                let (p, q) = (ring[i], ring[(i + 1) % n]);
                p[0] * q[1] - p[1] * q[0]
            })
            .sum::<f64>()
            .abs()
            / 2.0
    };
    let (mut strip_area, mut corners) = (0.0, [false; 3]);
    for face in state.faces() {
        let from = lineage(parent, state, face.id);
        if !top.contains(&from) || state.seen_front_up(face.id) == parent.seen_front_up(from) {
            continue;
        }
        let ring: Vec<Point> = state
            .face_image(face.id)
            .unwrap_or_default()
            .iter()
            .map(|&p| scene(state, p))
            .collect();
        for &p in &ring {
            if let Some(i) = triangle.iter().position(|&q| close(p, q)) {
                corners[i] = true;
            } else {
                let inside = (0..3).all(|i| {
                    let (a, b) = (triangle[i], triangle[(i + 1) % 3]);
                    let c = triangle[(i + 2) % 3];
                    let side =
                        |q: Point| (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
                    side(p) * side(c) >= -1e-12
                });
                assert!(inside, "the strip reaches {p:?}, outside the triangle");
            }
        }
        strip_area += area(&ring);
    }
    assert_eq!(corners, [true; 3]);
    assert!((strip_area - area(&triangle)).abs() < 1e-9, "{strip_area}");
}

/// The inside swivel the other way, the paper behind: refused as the open
/// one is, for want of an order, offering the valley.
#[test]
fn abrashi_s_inside_swivel_as_a_mountain_offers_the_valley() {
    let c = case("Abrashi's swivel");
    let op = SwivelByEdge {
        direction: Direction::Mountain,
        ..inside(&c.op)
    };
    let refused = refusal(c.state.swivel_by_edge(&op, &VertexChoices::default()));
    assert_eq!(refused.refusal.code(), "no_order", "{refused:?}");
    assert_eq!(refused.fixes, vec![Fix::OppositeDirection]);
}

/// The kite base narrowed at its tip, inside: the flap's strip folds under
/// it, between the flap and the square, and reaches past the diagonal,
/// where the other flap lies — over it or under it, the two orders the step
/// chooses between. Each passes every check, with the open swivel's lines.
#[test]
fn the_kite_base_narrows_inside_its_strip_over_or_under_the_other_flap() {
    for name in ["kite narrowed at c, right", "kite narrowed at c, left"] {
        let c = case(name);
        let op = inside(&c.op);
        let outcome = c.state.swivel_by_edge(&op, &VertexChoices::default());
        let Ok(VertexOutcome::ChooseOrder(choice)) = &outcome else {
            panic!("{name}: {outcome:?}");
        };
        assert_eq!(choice.count().orders, 2, "{name}");
        let opened = swivel_checked(&c, &c.op, name);
        let every = cases::every(outcome);
        assert_eq!(every.len(), 2);
        for (k, folded) in every.iter().enumerate() {
            let label = format!("{name} inside, order {k}");
            landing_checked(&c, &op, folded, &label);
            assert_eq!(lines_of(&folded.state), lines_of(&opened.state), "{label}");
            // Replayed from what it stores, it lands the same.
            let replayed = landed(c.state.swivel_by_edge(&op, &folded.report.stored));
            assert_eq!(replayed.state.order(), folded.state.order(), "{label}");
        }
    }
}

/// An inside swivel needs a folded edge: at a free vertex the creases cut
/// every layer alike, which move as one, and there is no pocket to tuck the
/// strip into.
#[test]
fn an_inside_swivel_at_a_free_vertex_is_refused() {
    let free = cases::edge_swivel_cases()
        .into_iter()
        .find(|c| c.name == "two-layer flap")
        .unwrap_or_else(|| panic!("no two-layer flap"));
    let op = inside(&free.op);
    let none = VertexChoices::default();
    let refused = refusal(free.state.swivel_by_edge(&op, &none));
    assert_eq!(refused.refusal.code(), "swivel_inside_free", "{refused:?}");
    assert!(!refused.refusal.faces().is_empty());
    for result in [
        free.state.analyse_swivel_by_edge(&op).err(),
        free.state.swivel_by_edge_action(&op, None).err(),
        free.state.swivel_by_edge_as_rays(&op).err(),
    ] {
        let code = result.map(|r| r.refusal.code());
        assert_eq!(code, Some("swivel_inside_free"));
    }
    // Open, it lands as before.
    landed(free.state.swivel_by_edge(&free.op, &none));
}

/// The kind is spelled only when inside: every open swivel's op reads and
/// writes as it always did, and an inside one reads back as it was.
#[test]
fn the_kind_is_spelled_only_when_inside() {
    let c = case("Abrashi's swivel");
    let json = serde_json::to_value(&c.op).unwrap_or_default();
    assert!(json.get("kind").is_none(), "{json}");
    let op = inside(&c.op);
    let json = serde_json::to_value(&op).unwrap_or_default();
    assert_eq!(json["kind"], "inside", "{json}");
    let read: SwivelByEdge = serde_json::from_value(json).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(read, op);
    let open = serde_json::json!({ "kind": "open" });
    assert_eq!(
        serde_json::from_value::<SwivelKind>(open["kind"].clone()).ok(),
        Some(SwivelKind::Open)
    );
}

/// The seeded campaign's draws again ([`drawn_swivels`]), inside: every one
/// that lands — each order, when it leaves several — passes every check, the
/// inside letters among them; where the open swivel lands too, with the
/// same lines. An inside swivel that cannot fold is refused for want of an
/// order.
#[test]
fn every_inside_swivel_on_a_folded_edge_that_lands_tucks_its_strip_flat() {
    let drawn = drawn_swivels();
    let none = VertexChoices::default();
    let (mut landed_count, mut both, mut refused_count) = (0, 0, 0);
    for (seed, c) in &drawn {
        let op = inside(&c.op);
        let outcome = c.state.swivel_by_edge(&op, &none);
        if let Err(CompoundRefused::Refused(refused)) = &outcome {
            refused_count += 1;
            let open = c.state.swivel_by_edge(&c.op, &none);
            if matches!(open, Ok(VertexOutcome::Landed(_))) {
                assert_eq!(
                    refused.refusal.code(),
                    "no_order",
                    "seed {seed}: {refused:?}"
                );
            }
            continue;
        }
        let every = cases::every(outcome);
        assert!(!every.is_empty(), "seed {seed}");
        let open = c.state.swivel_by_edge(&c.op, &none);
        for (k, folded) in every.iter().enumerate() {
            let label = format!("seed {seed} inside, order {k}");
            landing_checked(c, &op, folded, &label);
            if let Ok(VertexOutcome::Landed(opened)) = &open {
                assert_eq!(lines_of(&folded.state), lines_of(&opened.state), "{label}");
            }
        }
        landed_count += 1;
        both += usize::from(matches!(open, Ok(VertexOutcome::Landed(_))));
    }
    eprintln!(
        "{landed_count} of {} drawn inside swivels landed ({both} with the open one too), \
         {refused_count} refused",
        drawn.len()
    );
    assert!(
        landed_count >= 20 && both >= 15,
        "{landed_count} landed, {both} both"
    );
}

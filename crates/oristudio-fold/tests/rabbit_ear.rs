//! The rabbit ear and the swivel through the compound pipeline (plan Phase
//! 11; research §5.3), on the vertex spike's case 3 (`cases.mjs`): each
//! emergent ray lands one ear whose three bisectors fold the direction's way
//! and whose fourth crease folds the other (Lang; Beloch's
//! `flatten-rabbit-ear-*`, "`--ear` is mountain"), in every layer it cuts,
//! valley and mountain; a fourth crease beside the paper that stays, a ray
//! that does not close and a fourth crease that cannot rise are refused
//! with the rays that land; an older step's ridge and order are moot; and
//! the fan's own refusals.

mod beloch;
mod support;
mod vertex;

use std::collections::BTreeMap;

use oristudio_fold::{
    CompoundRefused, Direction, Fix, FoldRefusal, RabbitEar, Seed, State, Swivel, VertexChoices,
    VertexOutcome, WitnessOrder,
};
use vertex::cases::{self, EarCase, candidates_of, every, landed};
use vertex::{assert_ear_letters, check};

/// What a vertex fold came to: one state, a choice of n, or a refusal's
/// code.
#[derive(Debug, PartialEq)]
enum Came {
    One,
    Choice(u64),
    Refused(&'static str),
}

fn came(outcome: &Result<VertexOutcome, CompoundRefused>) -> Came {
    match outcome {
        Ok(VertexOutcome::Landed(_)) => Came::One,
        Ok(VertexOutcome::ChooseOrder(c)) => Came::Choice(c.count().orders),
        Err(CompoundRefused::Refused(r)) => Came::Refused(r.refusal.code()),
        Err(CompoundRefused::Broken(b)) => panic!("broken {b}"),
    }
}

/// An ear's op with its emergent ray the candidate nearest `deg` degrees.
fn at_degree(state: &State, op: &RabbitEar, deg: i32) -> RabbitEar {
    let emergent = candidates_of(state, op)
        .into_iter()
        .find(|(d, _)| *d == deg)
        .map(|c| c.1)
        .unwrap_or_else(|| panic!("no {deg}° candidate"));
    RabbitEar {
        emergent,
        ..op.clone()
    }
}

/// Each case's outcome per emergent candidate, by its direction in whole
/// degrees; every state it lands checked, its letters with it. The second
/// value counts the states landed.
fn per_candidate(name: &str, state: &State, op: &RabbitEar) -> (BTreeMap<i32, Came>, usize) {
    let mut landed = 0;
    let outcomes = candidates_of(state, op)
        .into_iter()
        .map(|(deg, emergent)| {
            let op = RabbitEar {
                emergent,
                ..op.clone()
            };
            let outcome = state.rabbit_ear(&op, &VertexChoices::default());
            let result = came(&outcome);
            let fan = state
                .analyse_rabbit_ear(&op)
                .unwrap_or_else(|e| panic!("{name}: {e}"));
            for folded in every(outcome) {
                check(state, &folded);
                assert_ear_letters(state, &folded, &fan, &format!("{name} at {deg}°"));
                landed += 1;
            }
            (deg, result)
        })
        .collect();
    (outcomes, landed)
}

fn case(name: &str) -> EarCase {
    cases::ear_cases()
        .into_iter()
        .find(|c| c.name == name)
        .unwrap_or_else(|| panic!("no case {name}"))
}

/// Research §5.3's cases with the fourth crease as the ridge: every ray
/// that closes lands one ear (the direction alone left two), the
/// two-layer triangle's 45° ray, beside the paper that stays, is refused,
/// and a ray into a hinge to paper that stays does not close. Every ear
/// landed folds its bisectors the direction's way and its fourth crease
/// the other, in every layer.
#[test]
fn each_emergent_ray_lands_one_ear_with_the_rule_s_letters() {
    use Came::{One, Refused};
    let beside = Refused("fan_fourth_beside_stayer");
    let blocked = || Refused("fan_ray_blocked");
    let want: Vec<(&str, Vec<(i32, Came)>)> = vec![
        ("3a both layers", vec![(45, beside), (180, One), (270, One)]),
        (
            "3b top layer",
            vec![(45, blocked()), (180, One), (270, One)],
        ),
        (
            "3c flat square",
            vec![(0, One), (135, blocked()), (270, One)],
        ),
        (
            "3d fish ear 1",
            vec![(45, blocked()), (180, One), (270, One)],
        ),
        (
            "3e kite flap",
            vec![(45, One), (135, One), (292, blocked())],
        ),
        (
            "3a both layers, mountain",
            vec![
                (45, Refused("fan_fourth_beside_stayer")),
                (180, One),
                (270, One),
            ],
        ),
        (
            "3b bottom layer, mountain",
            vec![(45, blocked()), (180, One), (270, One)],
        ),
        (
            "3c flat square, mountain",
            vec![(0, One), (135, blocked()), (270, One)],
        ),
        (
            "3d fish ear 1, mountain",
            vec![(45, blocked()), (180, One), (270, One)],
        ),
    ];
    let cases: BTreeMap<&str, EarCase> = cases::ear_cases()
        .into_iter()
        .chain(cases::mountain_ear_cases())
        .map(|c| (c.name, c))
        .collect();
    let mut landed = 0;
    for (name, want) in want {
        let case = &cases[name];
        let (got, count) = per_candidate(name, &case.state, &case.op);
        landed += count;
        assert_eq!(got.len(), want.len(), "{name}: {got:?}");
        for (deg, came) in want {
            assert_eq!(got.get(&deg), Some(&came), "{name} at {deg}°: {got:?}");
        }
    }
    assert_eq!(landed, 18);
}

/// A ray that does not close is refused naming the paper it runs into, with
/// the candidates that land as fixes.
#[test]
fn a_blocked_ray_offers_the_rays_that_land() {
    let case = case("3b top layer");
    let op = at_degree(&case.state, &case.op, 45);
    let Err(CompoundRefused::Refused(refused)) =
        case.state.rabbit_ear(&op, &VertexChoices::default())
    else {
        panic!("the 45° ray landed");
    };
    let FoldRefusal::FanRayBlocked { faces } = &refused.refusal else {
        panic!("{refused:?}");
    };
    // The bottom layer, which the top one's ray runs into.
    assert_eq!(faces.len(), 1);
    assert_eq!(offered(&refused.fixes), vec![180, 270]);
}

/// The fixes' emergent rays, in whole degrees.
fn offered(fixes: &[Fix]) -> Vec<i32> {
    fixes
        .iter()
        .map(|fix| match fix {
            Fix::UseEmergent { direction } => {
                (direction[1].atan2(direction[0]).to_degrees().round() as i32).rem_euclid(360)
            }
            other => panic!("{other:?}"),
        })
        .collect()
}

/// The fourth crease rises as the ear's ridge, so it lies across from the
/// paper that stays: one beside it would fold the direction's way, and a
/// corner's crease the other, which is no rabbit ear (the owner's report:
/// corner creases V, V, M and the fourth V). Refused, offering the rays
/// that land, and its picture refused alike.
#[test]
fn a_fourth_crease_beside_the_paper_that_stays_is_refused() {
    // The two-layer triangle held inside it, across from its right angle:
    // the 45° ray splits the paper that stays.
    let tri = case("3a both layers");
    let op = at_degree(&tri.state, &tri.op, 45);
    let Err(CompoundRefused::Refused(refused)) =
        tri.state.rabbit_ear(&op, &VertexChoices::default())
    else {
        panic!("the 45° ray landed");
    };
    assert_eq!(refused.refusal, FoldRefusal::FanFourthBesideStayer);
    assert_eq!(offered(&refused.fixes), vec![180, 270]);
    assert!(matches!(
        tri.state.rabbit_ear_action(&op, None),
        Err(r) if r.refusal == FoldRefusal::FanFourthBesideStayer
    ));
    // The flat square held inside the triangle, beside the 270° ray: the
    // 0° ray lands, its letters the rule's.
    let flat = case("3c flat square");
    let inside = RabbitEar {
        stayer: [0.6, 0.1],
        ..flat.op.clone()
    };
    let down = at_degree(&flat.state, &inside, 270);
    let Err(CompoundRefused::Refused(refused)) =
        flat.state.rabbit_ear(&down, &VertexChoices::default())
    else {
        panic!("the 270° ray beside the stayer landed");
    };
    assert_eq!(refused.refusal, FoldRefusal::FanFourthBesideStayer);
    assert_eq!(offered(&refused.fixes), vec![0]);
    let across = at_degree(&flat.state, &inside, 0);
    let folded = landed(flat.state.rabbit_ear(&across, &VertexChoices::default()));
    check(&flat.state, &folded);
    let fan = flat
        .state
        .analyse_rabbit_ear(&across)
        .unwrap_or_else(|e| panic!("{e}"));
    assert_ear_letters(&flat.state, &folded, &fan, "flat square held inside");
}

/// A step stored before the fourth crease was seeded as the ridge kept a
/// `ridge` naming one of the far wedge's rays, and sometimes the order it
/// chose: the ridge is no longer read (an unknown field), and an ear that
/// lands alone lands whatever order was stored — either way round, or with
/// a witness off the paper.
#[test]
fn an_older_step_s_ridge_and_order_are_moot() {
    let case = case("3c flat square");
    let op = at_degree(&case.state, &case.op, 270);
    let ear = landed(case.state.rabbit_ear(&op, &VertexChoices::default()));
    assert_eq!(ear.report.stored, VertexChoices::default());
    // The owner's step: the ridge on the crease to corner 2, (1, 0).
    let mut json = serde_json::to_value(&op).unwrap_or_default();
    let toward = [1.0 - ear.report.vertices[0][0], -ear.report.vertices[0][1]];
    json["ridge"] = serde_json::json!(toward);
    let read: RabbitEar = serde_json::from_value(json).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(read, op);
    // An order stored over two faces that overlap, each way round.
    let state = &ear.state;
    let witness = |f| {
        let ring = &state.face(f).unwrap_or_else(|| unreachable!()).ring;
        let n = ring.len() as f64;
        ring.iter().fold([0.0, 0.0], |c, v| {
            let p = state.vertices()[v.0 as usize];
            [c[0] + p[0] / n, c[1] + p[1] / n]
        })
    };
    let (pair, _) = state
        .order()
        .pairs()
        .next()
        .unwrap_or_else(|| panic!("no pairs"));
    let [f, g] = pair.faces();
    for s in [1, -1] {
        for faces in [vec![witness(f), witness(g)], vec![[3.0, 3.0], witness(g)]] {
            let stored = VertexChoices {
                completion: Some(WitnessOrder {
                    faces,
                    orders: vec![(0, 1, s)],
                }),
            };
            let replayed = landed(case.state.rabbit_ear(&op, &stored));
            assert_eq!(replayed.state.parts(), ear.state.parts());
            assert_eq!(replayed.report.stored, VertexChoices::default());
        }
    }
}

/// Spike case 3d: the fish base's second ear, on the state the first one
/// landed, perpendicular to its edge: each one ear, the rule's.
#[test]
fn the_fish_base_takes_two_ears() {
    let case = case("3d fish ear 1");
    let op = at_degree(&case.state, &case.op, 180);
    let ear = landed(case.state.rabbit_ear(&op, &VertexChoices::default()));
    check(&case.state, &ear);
    let fan = case
        .state
        .analyse_rabbit_ear(&op)
        .unwrap_or_else(|e| panic!("{e}"));
    assert_ear_letters(&case.state, &ear, &fan, "fish ear 1");
    let state = &ear.state;
    let second = RabbitEar {
        corners: [[1.0, 1.0], [0.0, 1.0], [1.0, 0.0]],
        emergent: [1.0, 0.0],
        layers: Seed::Flaps {
            at: vec![[0.8, 0.8]],
        },
        stayer: cases::seen_bottom(state, [0.45, 0.45]),
        direction: Direction::Valley,
    };
    let second = at_degree(state, &second, 90);
    let outcome = state.rabbit_ear(&second, &VertexChoices::default());
    assert_eq!(came(&outcome), Came::One);
    let fan = state
        .analyse_rabbit_ear(&second)
        .unwrap_or_else(|e| panic!("{e}"));
    let folded = landed(outcome);
    check(state, &folded);
    assert_ear_letters(state, &folded, &fan, "fish ear 2");
}

/// Spike case 3f, Beloch's `swivel-rabbit` (a rabbit ear on free hinges,
/// its emergent "ear" crease a mountain): the two rays across from the
/// paper that stays each land one swivel with the rule's letters, valley
/// and mountain; the one beside it — which the direction seed alone landed
/// with a given crease the odd one out — is refused, offering them.
#[test]
fn every_swivel_ray_across_from_the_stayer_lands_one_way() {
    let (square, op) = cases::swivel_case();
    for direction in [Direction::Valley, Direction::Mountain] {
        let op = Swivel {
            direction,
            ..op.clone()
        };
        let analysis = square.analyse_swivel(&op).unwrap_or_else(|e| panic!("{e}"));
        let mut degrees = Vec::new();
        for &c in &analysis.candidates {
            let deg = c[1].atan2(c[0]).to_degrees().rem_euclid(360.0).round() as i32;
            let op = Swivel {
                emergent: c,
                ..op.clone()
            };
            match square.swivel(&op, &VertexChoices::default()) {
                Err(CompoundRefused::Refused(refused)) => {
                    assert_eq!(deg, 90, "{direction:?}");
                    assert_eq!(refused.refusal, FoldRefusal::FanFourthBesideStayer);
                    assert_eq!(offered(&refused.fixes), vec![208, 332]);
                }
                outcome => {
                    let folded = landed(outcome);
                    check(&square, &folded);
                    assert_eq!(folded.state.faces().len(), 4);
                    let fan = square.analyse_swivel(&op).unwrap_or_else(|e| panic!("{e}"));
                    assert_ear_letters(&square, &folded, &fan, &format!("swivel {deg}°"));
                    degrees.push(deg);
                }
            }
        }
        degrees.sort_unstable();
        assert_eq!(degrees, vec![208, 332], "{direction:?}");
    }
}

/// A free vertex whose rays run toward 0°, 270° and 300°: its one fourth
/// ray, at 150°, leaves the 30° between 270° and 300° the narrowest angle,
/// between two given creases, so they must fold opposite each other and the
/// fourth cannot be the odd one out (the direction seed alone landed it
/// with the 270° crease odd). Refused.
#[test]
fn a_fourth_crease_that_cannot_rise_is_refused() {
    let o = [0.5, 0.5];
    let at = |deg: f64, r: f64| {
        let (s, c) = deg.to_radians().sin_cos();
        [o[0] + r * c, o[1] + r * s]
    };
    let op = Swivel {
        vertex: o,
        toward: [at(0.0, 0.4), at(270.0, 0.4), at(300.0, 0.4)],
        emergent: [1.0, 0.0],
        layers: Seed::All,
        stayer: at(330.0, 0.3),
        direction: Direction::Valley,
    };
    let square = cases::square();
    let analysis = square.analyse_swivel(&op).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(analysis.candidates.len(), 1);
    let op = Swivel {
        emergent: analysis.candidates[0],
        ..op
    };
    let Err(CompoundRefused::Refused(refused)) = square.swivel(&op, &VertexChoices::default())
    else {
        panic!("a fourth crease that cannot rise landed");
    };
    assert_eq!(refused.refusal, FoldRefusal::FanFourthCannotRise);
    assert!(refused.fixes.is_empty());
}

/// A fan whose center lies on a crease is refused.
#[test]
fn the_fans_own_refusals() {
    // The incenter of a b d lies on the precreased diagonal a c.
    let square = cases::precrease(
        &cases::square(),
        [0.0, 0.0],
        [1.0, 1.0],
        [0.0, 1.0],
        Seed::All,
    );
    let op = RabbitEar {
        corners: [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]],
        emergent: [-1.0, 0.0],
        layers: Seed::All,
        stayer: [0.9, 0.95],
        direction: Direction::Valley,
    };
    let Err(CompoundRefused::Refused(refused)) = square.rabbit_ear(&op, &VertexChoices::default())
    else {
        panic!("a fan centred on a crease landed");
    };
    assert_eq!(refused.refusal.code(), "fan_center");
}

#[test]
fn rabbit_ears_reuse_precreased_triangular_layers() {
    for case in cases::ear_cases()
        .into_iter()
        .chain(cases::mountain_ear_cases())
        .filter(|case| !case.name.contains("kite"))
    {
        let name = case.name;
        let mut state = case.state.clone();
        let center = state.analyse_rabbit_ear(&case.op).unwrap().center;
        for corner in case.op.corners {
            let toward = [center[0] + 0.031, center[1] + 0.073];
            state = cases::precrease(&state, center, corner, toward, Seed::All);
        }
        let interior = |p: [f64; 2]| {
            if state.face_at(p).is_some() {
                return p;
            }
            let parent = case.state.face_at(p);
            (0..24)
                .map(|k| {
                    let a = 0.137 + k as f64 * 2.399963229728653;
                    [p[0] + a.cos() * 0.002, p[1] + a.sin() * 0.002]
                })
                .find(|q| state.face_at(*q).is_some() && case.state.face_at(*q) == parent)
                .unwrap()
        };
        let mut prepared_op = case.op.clone();
        prepared_op.stayer = interior(prepared_op.stayer);
        prepared_op.layers = match prepared_op.layers {
            Seed::All => Seed::All,
            Seed::Depth { at, layers } => Seed::Depth {
                at: interior(at),
                layers,
            },
            Seed::Flaps { at } => Seed::Flaps {
                at: at.into_iter().map(interior).collect(),
            },
        };
        for (_, ray) in candidates_of(&case.state, &case.op) {
            let op = RabbitEar {
                emergent: ray,
                ..prepared_op.clone()
            };
            let control = case.state.rabbit_ear(&op, &VertexChoices::default());
            if let Err(CompoundRefused::Refused(_)) = control {
                assert!(
                    state.rabbit_ear(&op, &VertexChoices::default()).is_err(),
                    "{name}: precreasing must not bypass an incompatible hinge"
                );
                continue;
            }
            let folded = landed(state.rabbit_ear(&op, &VertexChoices::default()));
            check(&state, &folded);
            assert!(folded.state.faces().len() >= state.faces().len());
            let clean = landed(case.state.rabbit_ear(&op, &VertexChoices::default()));
            assert_eq!(
                vertex::folded_segments(&folded.state),
                vertex::folded_segments(&clean.state),
                "{name}"
            );
            // At every shared interior sample the same sheet material must be
            // visible in the same stack order, not merely the same silhouette.
            for x in 1..30 {
                for y in 1..30 {
                    let p = [x as f64 / 30.0 + 0.00017, y as f64 / 30.0 + 0.00031];
                    if let (Some(a), Some(b)) = (folded.state.stack_at(p), clean.state.stack_at(p))
                    {
                        assert_eq!(a.len(), b.len(), "{name} layer count at {p:?}");
                        for (a, b) in a.into_iter().zip(b) {
                            let material_a = folded.state.isometry(a).unwrap().inverse().apply(p);
                            let material_b = clean.state.isometry(b).unwrap().inverse().apply(p);
                            assert!(
                                (material_a[0] - material_b[0])
                                    .hypot(material_a[1] - material_b[1])
                                    < 1e-6,
                                "{name} layer order at {p:?}"
                            );
                            assert_eq!(folded.state.front_up(a), clean.state.front_up(b));
                        }
                    }
                }
            }
            for x in 1..20 {
                for y in 1..20 {
                    let p = [x as f64 / 20.0 + 0.0013, y as f64 / 20.0 + 0.0021];
                    if let (Some(a), Some(b)) = (folded.state.face_at(p), clean.state.face_at(p)) {
                        let a = folded.state.isometry(a).unwrap().apply(p);
                        let b = clean.state.isometry(b).unwrap().apply(p);
                        assert!(
                            (a[0] - b[0]).hypot(a[1] - b[1]) < 1e-6,
                            "{name} material {p:?}: {a:?} != {b:?}"
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn a_rabbit_ear_crosses_unrelated_precreases_without_losing_their_history() {
    let case = case("3c flat square");
    let mut state = case.state.clone();
    for (p, q) in [([0.0, 0.23], [1.0, 0.23]), ([0.6, 0.0], [0.6, 1.0])] {
        state = cases::precrease(&state, p, q, [0.9, 0.1], Seed::All);
    }
    let op = at_degree(&case.state, &case.op, 0);
    let folded = landed(state.rabbit_ear(&op, &VertexChoices::default()));
    check(&state, &folded);
    let control = landed(case.state.rabbit_ear(&op, &VertexChoices::default()));
    assert_eq!(
        vertex::folded_segments(&folded.state),
        vertex::folded_segments(&control.state)
    );
    assert_eq!(
        &folded.state.vertices()[..state.vertices().len()],
        state.vertices()
    );
    for crease in folded.state.creases() {
        let [a, b] = crease
            .vertices
            .map(|v| folded.state.vertices()[v.0 as usize]);
        let mid = [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0];
        if let Some(old) = state.crease_at(mid) {
            assert_eq!(crease.made_at, old.made_at, "crease provenance at {mid:?}");
        }
    }
}

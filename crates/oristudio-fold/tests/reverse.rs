//! The reverse fold through the compound pipeline (plan D4, Phase 9;
//! research §5.2), on the reverse spike's named cases and its seeded campaign
//! (`r2-spike-reverse-crimp-tuck`, `cases.mjs` and `campaign-reverse.mjs`):
//! which kind lands, the openings and per-flap openings, the letter rules,
//! the plain-fold geometry, the motion's endpoints, stored choices and their
//! replay, refusals with their fixes, and the local completion against the
//! full one.

mod beloch;
mod compound;
mod support;

use std::collections::BTreeSet;

use oristudio_fold::complete::{complete, complete_around};
use oristudio_fold::{
    Broken, BrokenWitness, ChoiceCount, CompletionLimits, CompoundRefused, CreasePatternInput,
    Direction, FaceId, Fix, FixedKind, FixedPair, FoldRefusal, ImportTarget, ImportedPattern,
    NoOpening, ReverseChoices, ReverseFold, ReverseKind, ReverseOutcome, Seed, Sheet, StartSide,
    State, StoredOpening, WitnessOrder,
};
use oristudio_geometry::Line;
use support::*;

use compound::{check, landed};

const INSIDE: ReverseKind = ReverseKind::Inside;
const OUTSIDE: ReverseKind = ReverseKind::Outside;

fn square() -> State {
    State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"))
}

/// The square valley-folded along the diagonal bd, a = (0, 0) onto
/// c = (1, 1): the triangle b c d, its spine along bd (`cases.mjs` §1).
fn triangle() -> State {
    fold(
        &square(),
        &all(
            through([1.0, 0.0], [0.0, 1.0]),
            [0.0, 0.0],
            Direction::Valley,
        ),
    )
    .state
}

/// A reverse fold of the tip on `toward`'s side of `line`.
fn reverse(line: Line, toward: Point, anchor: Seed, kind: ReverseKind) -> ReverseFold {
    ReverseFold {
        line,
        side: side(&line, toward),
        anchor,
        kind,
    }
}

fn none() -> ReverseChoices {
    ReverseChoices::default()
}

fn refusal(state: &State, op: &ReverseFold) -> oristudio_fold::Refused {
    match state.reverse_fold(op, &none()) {
        Err(CompoundRefused::Refused(refused)) => refused,
        Err(CompoundRefused::Broken(broken)) => panic!("{op:?}: broken {broken}"),
        Ok(_) => panic!("{op:?} landed"),
    }
}

/// Whether two states order every pair of faces alike, matching faces by
/// their witnesses (numbering-free), with the same crease kinds.
fn same_state(a: &State, b: &State) -> bool {
    let face = |p: Option<Point>| p.and_then(|p| b.face_at(p));
    a.faces().len() == b.faces().len()
        && a.creases().len() == b.creases().len()
        && a.creases().iter().all(|c| {
            let [p, q] = c.vertices.map(|v| a.vertices()[v.0 as usize]);
            let mid = [(p[0] + q[0]) / 2.0, (p[1] + q[1]) / 2.0];
            b.crease_at(mid).map(|d| d.kind) == Some(c.kind)
        })
        && a.faces().iter().all(|f| {
            let Some(g) = face(a.face_witness(f.id)) else {
                return false;
            };
            a.faces().iter().all(|h| {
                let Some(k) = face(a.face_witness(h.id)) else {
                    return false;
                };
                a.above(f.id, h.id) == b.above(g, k)
            })
        })
}

// --- 1. The triangle -------------------------------------------------------

/// Spike cases 1a–1d: on a two-layer flap and a generic line exactly one kind
/// lands; with ℓ perpendicular to the spine both do. A kind that does not
/// fit is refused, offering the one that does.
#[test]
fn the_triangles_corner_reverses_one_way_or_both_when_perpendicular() {
    let tri = triangle();
    let perpendicular =
        Line::from_point_direction([0.75, 0.25], [1.0, 1.0]).unwrap_or_else(|| unreachable!());
    let cases: [(&str, Line, Point, &[ReverseKind]); 5] = [
        ("1a y = 0.5", y_eq(0.5), [0.9, 0.2], &[INSIDE]),
        ("1b x = 0.5", x_eq(0.5), [0.9, 0.5], &[OUTSIDE]),
        (
            "1c perpendicular",
            perpendicular,
            [0.95, 0.1],
            &[INSIDE, OUTSIDE],
        ),
        (
            "1d 100°",
            at_angle([0.7, 0.3], 100.0),
            [1.0, 0.0],
            &[OUTSIDE],
        ),
        (
            "1d 195°",
            at_angle([0.7, 0.3], 195.0),
            [1.0, 0.0],
            &[INSIDE],
        ),
    ];
    for (name, line, toward, kinds) in cases {
        let op = reverse(line, toward, Seed::All, INSIDE);
        assert_eq!(
            tri.reverse_kinds(&op, &none()).unwrap_or_default(),
            kinds.to_vec(),
            "{name}"
        );
        for kind in [INSIDE, OUTSIDE] {
            let op = ReverseFold { kind, ..op.clone() };
            if kinds.contains(&kind) {
                let folded = landed(&tri, &op, &none());
                let [kept, turned, at_spine] = check(&tri, &op, &folded);
                assert_eq!(folded.state.faces().len(), 4, "{name} {kind:?}");
                // The spine's tip half turns; the new creases at the spine
                // follow the body.
                assert_eq!((kept, turned), (1, 1), "{name} {kind:?}");
                assert!(at_spine >= 2, "{name} {kind:?}: {at_spine}");
                assert_eq!(folded.report.fold.reversed.len(), 1, "{name} {kind:?}");
                assert!(compound::assert_plain_fold_geometry(&tri, &op, &folded));
            } else {
                let refused = refusal(&tri, &op);
                assert_eq!(refused.refusal.code(), "reverse_kind_infeasible", "{name}");
                assert_eq!(
                    refused.fixes,
                    vec![Fix::OtherKind { kind: kind.other() }],
                    "{name}"
                );
                assert!(!refused.refusal.faces().is_empty());
            }
        }
    }
}

/// Spike case 1e: two inside reverses of the triangle are the preliminary
/// base, exactly Beloch's frames 2 and 3 of `bird-base-petal.fold`; and the
/// base is the only order its crease pattern and letters allow.
#[test]
fn two_inside_reverses_make_the_preliminary_base() {
    let doc = beloch::document("bird-base-petal.fold");
    let tri = triangle();
    let frame = |k| beloch::frame(&doc, Some(k)).unwrap_or_else(|e| panic!("{e}"));
    beloch::matches(&tri, &frame(1)).unwrap_or_else(|e| panic!("triangle: {e}"));
    let op = reverse(y_eq(0.5), [0.9, 0.2], Seed::All, INSIDE);
    let first = landed(&tri, &op, &none());
    check(&tri, &op, &first);
    beloch::matches(&first.state, &frame(2)).unwrap_or_else(|e| panic!("1a: {e}"));
    let op = reverse(x_eq(0.5), [0.2, 0.9], Seed::All, INSIDE);
    let base = landed(&first.state, &op, &none());
    check(&first.state, &op, &base);
    beloch::matches(&base.state, &frame(3)).unwrap_or_else(|e| panic!("1e: {e}"));
    assert_eq!(base.state.faces().len(), 6);
    // Every corner of the paper lands on c.
    for corner in [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0], [1.0, 1.0]] {
        let v = base
            .state
            .vertices()
            .iter()
            .position(|p| *p == corner)
            .unwrap_or_else(|| panic!("no vertex at {corner:?}"));
        let image = base
            .state
            .vertex_image(oristudio_fold::VertexId(v as u32))
            .unwrap_or_default();
        assert!(close(image, [1.0, 1.0]), "{corner:?} lands at {image:?}");
    }
    let pattern = ImportedPattern::new(
        &CreasePatternInput::of_state(&base.state),
        ImportTarget::Empty {
            start: StartSide::Front,
        },
    )
    .unwrap_or_else(|e| panic!("{e}"));
    let completions = pattern
        .complete(&CompletionLimits::default())
        .unwrap_or_else(|e| panic!("{e}"));
    assert!(completions.is_unique());
    let order = completions.order(&[]).unwrap_or_default();
    let imported = pattern.state(order).unwrap_or_else(|e| panic!("{e}"));
    assert!(same_state(&base.state, &imported));
}

// --- 2. Four layers --------------------------------------------------------

/// A book fold, then another: the strip [0, ¼] × [0, 1] in four layers
/// (spike case 2a, Beloch's fig-reverse-open).
fn strip() -> State {
    let book = fold(&square(), &all(x_eq(0.5), [0.9, 0.5], Direction::Valley)).state;
    fold(&book, &all(x_eq(0.25), [0.4, 0.5], Direction::Valley)).state
}

/// Spike case 2a: reversing the strip's lower half opens two ways, between
/// the inner layers or above the outer one; ℓ is perpendicular to the spine,
/// so both kinds land on each. The fold asks for the opening, and stores it.
#[test]
fn a_four_layer_strip_opens_two_ways() {
    let strip = strip();
    let op = reverse(y_eq(0.5), [0.1, 0.2], Seed::All, INSIDE);
    let analysis = strip.analyse_reverse(&op).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(analysis.tip.len(), 4);
    let [flap] = analysis.flaps.as_slice() else {
        panic!("{analysis:?}");
    };
    assert_eq!(flap.openings.len(), 2);
    assert!(!flap.truncated);
    // Fewest lower faces first.
    assert!(flap.openings[0].lower.len() <= flap.openings[1].lower.len());
    let Ok(ReverseOutcome::ChooseOpening(asked)) = strip.reverse_fold(&op, &none()) else {
        panic!("no choice of opening");
    };
    assert_eq!(*asked, analysis);
    for opening in &flap.openings {
        let choices = ReverseChoices {
            openings: vec![opening.stored.clone()],
            order: None,
        };
        assert_eq!(
            strip.reverse_kinds(&op, &choices).unwrap_or_default(),
            vec![INSIDE, OUTSIDE]
        );
        for kind in [INSIDE, OUTSIDE] {
            let op = ReverseFold { kind, ..op.clone() };
            let folded = landed(&strip, &op, &choices);
            let [_, turned, _] = check(&strip, &op, &folded);
            assert_eq!(turned, opening.across.len());
            assert_eq!(folded.report.openings, vec![opening.clone()]);
            assert_eq!(folded.report.stored.openings, choices.openings);
            assert_eq!(folded.state.faces().len(), 8);
        }
    }
}

/// The triangle folded in half again: two two-layer flaps stacked over the
/// corner b, each hinged along mb (spike case 2b).
fn four_layer_triangle() -> State {
    fold(
        &triangle(),
        &all(
            through([0.0, 0.0], [1.0, 1.0]),
            [0.4, 0.9],
            Direction::Valley,
        ),
    )
    .state
}

/// ℓ perpendicular to the spine mb at (0.75, 0.25).
fn across_the_spine() -> Line {
    Line::from_point_direction([0.75, 0.25], [1.0, 1.0]).unwrap_or_else(|| unreachable!())
}

/// Spike case 2b: each stacked flap opens at its own layers (four blocks),
/// which one opening per tip cannot express, and lands as the spike stacked
/// it: L1s < L1′ < L2′ < L2s < L3s < L3′ < L4′ < L4s, bottom to top, for
/// the layers L1–L4 at the corner, their pieces that stay (s) and that move
/// (′).
#[test]
fn stacked_flaps_reverse_each_into_its_own_pocket() {
    let tri4 = four_layer_triangle();
    let op = reverse(across_the_spine(), [0.95, 0.1], Seed::All, INSIDE);
    let analysis = tri4.analyse_reverse(&op).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(analysis.flaps.len(), 2);
    assert!(analysis.flaps.iter().all(|f| f.openings.len() == 1));
    let folded = landed(&tri4, &op, &none());
    check(&tri4, &op, &folded);
    assert_eq!(folded.report.fold.blocks.len(), 4);
    assert_eq!(folded.report.openings.len(), 2);
    assert!(folded.report.stored.openings.is_empty());

    // The layers at the corner, bottom first.
    let mut layers = tri4.stack_at([0.97, 0.06]).unwrap_or_default();
    layers.reverse();
    assert_eq!(layers.len(), 4);
    let state = &folded.state;
    let moved: BTreeSet<FaceId> = folded
        .report
        .fold
        .blocks
        .iter()
        .flatten()
        .copied()
        .collect();
    let name = |f: FaceId| -> String {
        let parent = state.face(f).and_then(|face| face.parent).unwrap_or(f);
        let i = layers
            .iter()
            .position(|&l| l == parent)
            .map_or(0, |i| i + 1);
        format!("L{i}{}", if moved.contains(&f) { "′" } else { "s" })
    };
    let mut stack: Vec<String> = state
        .stack_at([0.56, 0.47])
        .unwrap_or_default()
        .into_iter()
        .map(name)
        .collect();
    stack.reverse();
    assert_eq!(
        stack,
        ["L1s", "L1′", "L2′", "L2s", "L3s", "L3′", "L4′", "L4s"]
    );
    // The outside kind lands too, each flap around its own body.
    let outside = ReverseFold {
        kind: OUTSIDE,
        ..op.clone()
    };
    match tri4.reverse_fold(&outside, &none()) {
        Ok(ReverseOutcome::Landed(folded)) => {
            check(&tri4, &outside, &folded);
        }
        Ok(ReverseOutcome::ChooseOrder(choice)) => {
            for k in 0..choice.completions().components()[0].orders.len() {
                let folded = choice.pick(&[k]).unwrap_or_else(|e| panic!("{e}"));
                check(&tri4, &outside, &folded);
            }
        }
        other => panic!("{:?}", other.err()),
    }
}

/// Spike case 2c: reversing only one of the two stacked flaps, the other
/// staying where it is. The inside fold lands for either.
#[test]
fn one_of_two_stacked_flaps_reverses_alone() {
    let tri4 = four_layer_triangle();
    let stack = tri4.stack_at([0.97, 0.06]).unwrap_or_default();
    let sheet = |f: FaceId| {
        tri4.isometry(f)
            .unwrap_or_default()
            .inverse()
            .apply([0.97, 0.06])
    };
    let anchors = [
        (
            "top",
            Seed::Depth {
                at: sheet(stack[0]),
                layers: 2,
            },
        ),
        (
            "bottom",
            Seed::Flaps {
                at: vec![sheet(stack[3])],
            },
        ),
    ];
    for (name, anchor) in anchors {
        let op = reverse(across_the_spine(), [0.95, 0.1], anchor, INSIDE);
        let analysis = tri4.analyse_reverse(&op).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(analysis.tip.len(), 2, "{name}");
        let folded = landed(&tri4, &op, &none());
        check(&tri4, &op, &folded);
        assert_eq!(folded.report.fold.blocks.len(), 2, "{name}");
    }
}

// --- Refusals ----------------------------------------------------------------

#[test]
fn refusals_name_their_faces_and_offer_what_lands() {
    // A single layer has no spine to open along.
    let refused = refusal(
        &square(),
        &reverse(y_eq(0.5), [0.5, 0.2], Seed::All, INSIDE),
    );
    assert_eq!(
        refused.refusal,
        FoldRefusal::ReverseNoOpening {
            faces: vec![FaceId(0)],
            cause: NoOpening::NoSpine,
        }
    );
    assert!(refused.fixes.is_empty());
    // Everything on the tip side: nothing would stay.
    let tri = triangle();
    let refused = refusal(&tri, &reverse(x_eq(-0.1), [0.5, 0.5], Seed::All, INSIDE));
    assert_eq!(refused.refusal, FoldRefusal::NothingStays);
    // Through JSON, by code.
    let json = serde_json::to_value(CompoundRefused::Refused(refusal(
        &tri,
        &reverse(y_eq(0.5), [0.9, 0.2], Seed::All, OUTSIDE),
    )))
    .unwrap_or_default();
    assert_eq!(json["stage"], "refused");
    assert_eq!(json["refusal"]["code"], "reverse_kind_infeasible");
    assert_eq!(json["refusal"]["kind"], "outside");
    assert_eq!(json["fixes"][0]["fix"], "other_kind");
    assert_eq!(json["fixes"][0]["kind"], "inside");
}

/// A tip that is not free: a layer that is not part of it lies in its way.
/// The refusal names that layer's faces and offers to grow the tip over its
/// flap; grown, the fold lands, opened some way the grown fold asks for.
/// (Case s2-317 of the seeded campaign, its second opening.)
#[test]
fn a_tip_with_a_layer_in_its_way_is_not_free() {
    let (state, op) = campaign_case(2, 317).unwrap_or_else(|| panic!("case s2-317 is gone"));
    let analysis = state.analyse_reverse(&op).unwrap_or_else(|e| panic!("{e}"));
    let opened = ReverseChoices {
        openings: vec![analysis.flaps[0].openings[1].stored.clone()],
        order: None,
    };
    let Err(CompoundRefused::Refused(refused)) = state.reverse_fold(&op, &opened) else {
        panic!("case s2-317 lands");
    };
    let FoldRefusal::ReverseTipNotFree { blocking, faces } = &refused.refusal else {
        panic!("{refused}");
    };
    assert!(!blocking.is_empty() && blocking.iter().all(|f| faces.contains(f)));
    assert!(blocking.iter().all(|f| !analysis.tip.contains(f)));
    assert_eq!(refused.refusal.faces(), *blocking);
    let [Fix::IncludeFlaps { flaps }] = refused.fixes.as_slice() else {
        panic!("{:?}", refused.fixes);
    };
    // The blocking layers are in the flaps it offers.
    let section = state
        .cross_section(&op.line, op.side)
        .unwrap_or_else(|e| panic!("{e}"));
    assert!(
        blocking
            .iter()
            .all(|f| flaps.iter().any(|&k| section.flaps[k].faces.contains(f)))
    );
    // Grown over them, the fold lands for some way of opening its flaps.
    let mut at: Vec<Point> = analysis.flaps.iter().map(|f| f.flap.witness).collect();
    at.extend(flaps.iter().map(|&k| section.flaps[k].witness));
    let grown = ReverseFold {
        anchor: Seed::Flaps { at },
        ..op.clone()
    };
    let grown_analysis = state
        .analyse_reverse(&grown)
        .unwrap_or_else(|e| panic!("{e}"));
    let mut plans = vec![ReverseChoices::default()];
    for flap in grown_analysis.flaps.iter().filter(|f| f.openings.len() > 1) {
        plans = plans
            .into_iter()
            .flat_map(|choices| {
                flap.openings.iter().map(move |o| ReverseChoices {
                    openings: [choices.openings.clone(), vec![o.stored.clone()]].concat(),
                    order: None,
                })
            })
            .collect();
    }
    let landings = plans
        .iter()
        .filter(|choices| match state.reverse_fold(&grown, choices) {
            Ok(ReverseOutcome::Landed(folded)) => {
                check(&state, &grown, &folded);
                true
            }
            Ok(ReverseOutcome::ChooseOrder(_)) => true,
            _ => false,
        })
        .count();
    assert!(landings >= 1, "none of {} ways lands", plans.len());
}

/// Narrow overlaps are real ordering relations when geometry resolves them.
/// They may not disappear from the order merely because they are small.
#[test]
fn narrow_tip_overlaps_pass_the_full_gate_and_require_their_pairs() {
    let mut narrow = 0;
    for i in 0..160 {
        let Some((state, op)) = campaign_case(1, i) else {
            continue;
        };
        let analysis = state.analyse_reverse(&op).unwrap();
        for opening in &analysis.flaps[0].openings {
            let choices = ReverseChoices {
                openings: if analysis.flaps[0].openings.len() > 1 {
                    vec![opening.stored.clone()]
                } else {
                    vec![]
                },
                order: None,
            };
            let Ok(ReverseOutcome::Landed(folded)) = state.reverse_fold(&op, &choices) else {
                continue;
            };
            check(&state, &op, &folded);
            for (pair, _) in folded.state.order().pairs() {
                let depth = oristudio_geometry::convex::penetration(
                    folded.state.face_image(pair.lo()).unwrap(),
                    folded.state.face_image(pair.hi()).unwrap(),
                );
                if depth > 1e-6 && depth < 1e-3 {
                    let mut missing = folded.state.parts().clone();
                    missing.order.remove(pair.lo(), pair.hi());
                    assert!(
                        State::make(missing).is_err(),
                        "s1-{i}: narrow pair was optional"
                    );
                    narrow += 1;
                }
            }
        }
    }
    assert!(narrow > 0, "campaign must exercise narrow overlaps");
}

// --- Stored choices ----------------------------------------------------------

/// A reverse fold of the campaign that leaves two orders: a stationary layer
/// that can lie over or under the reversed tip.
fn ambiguous() -> (State, ReverseFold) {
    let (state, op) = campaign_case(1, 287).unwrap_or_else(|| panic!("case s1-287 is gone"));
    (state, op)
}

/// Plan D6: a choice is stored as the pairs it decided, keyed by witnesses,
/// never an index. Replay resolves to the same state; a witness off the
/// paper, a pair of faces that no longer overlap, or too little stored is
/// broken; and a stored choice that resolves to another state than the one
/// recorded is what the document calls changed.
#[test]
fn stored_choices_replay_or_break() {
    let (state, op) = ambiguous();
    let Ok(ReverseOutcome::ChooseOrder(choice)) = state.reverse_fold(&op, &none()) else {
        panic!("case s1-287 no longer leaves a choice");
    };
    assert_eq!(
        choice.count(),
        ChoiceCount {
            orders: 2,
            exact: true
        }
    );
    let picks: Vec<_> = (0..2)
        .map(|k| choice.pick(&[k]).unwrap_or_else(|e| panic!("{e}")))
        .collect();
    for folded in &picks {
        check(&state, &op, folded);
    }
    assert!(!same_state(&picks[0].state, &picks[1].state));
    assert!(matches!(
        choice.pick(&[2]),
        Err(FoldRefusal::NoSuchChoice { .. })
    ));

    // Resolves: the stored choice lands the state it was chosen as.
    let stored = picks[0].report.stored.clone();
    let Some(order) = stored.order.clone() else {
        panic!("no stored order");
    };
    let replayed = landed(&state, &op, &stored);
    assert_eq!(replayed.state.parts(), picks[0].state.parts());
    assert_eq!(replayed.report.stored, stored);
    // Through JSON, as a document stores it.
    let json = serde_json::to_string(&stored).unwrap_or_default();
    let back: ReverseChoices = serde_json::from_str(&json).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(
        landed(&state, &op, &back).state.parts(),
        picks[0].state.parts()
    );

    // Changed: the choice recorded with the other state resolves, but not to
    // it; the document's `expect` digest tells the two apart.
    assert!(!same_state(&replayed.state, &picks[1].state));

    // Broken.
    let broken = |order: WitnessOrder| match state.reverse_fold(
        &op,
        &ReverseChoices {
            openings: stored.openings.clone(),
            order: Some(order),
        },
    ) {
        Err(CompoundRefused::Broken(broken)) => broken,
        other => panic!("{:?}", other.map(|_| ())),
    };
    let mut off = order.clone();
    off.faces[0] = [2.0, 2.0];
    assert!(matches!(
        broken(off),
        Broken::Witness {
            witness: BrokenWitness::NoFace { witness: 0, .. }
        }
    ));
    let empty = WitnessOrder {
        faces: Vec::new(),
        orders: Vec::new(),
    };
    assert!(matches!(broken(empty), Broken::NotUnique { .. }));
    // A pair the seeds force, stored the other way round.
    let landed_state = &picks[0].state;
    let [upper, lower] = choice.completions().forced_pairs()[0];
    let against = WitnessOrder::new(
        &[[lower, upper]],
        |f| landed_state.face_witness(f),
        |f| landed_state.front_up(f),
    )
    .unwrap_or_else(|| unreachable!());
    assert!(matches!(broken(against), Broken::Completion { .. }));
}

/// A stored opening that names no opening of the tip breaks the step; one
/// that does picks it.
#[test]
fn stored_openings_replay_or_break() {
    let strip = strip();
    let op = reverse(y_eq(0.5), [0.1, 0.2], Seed::All, INSIDE);
    let analysis = strip.analyse_reverse(&op).unwrap_or_else(|e| panic!("{e}"));
    let every_face = StoredOpening {
        upper: analysis
            .tip
            .iter()
            .filter_map(|&f| strip.face_witness(f))
            .collect(),
    };
    for (stored, broken) in [
        (every_face, Broken::Opening { opening: 0 }),
        (
            StoredOpening {
                upper: vec![[3.0, 3.0]],
            },
            Broken::Witness {
                witness: BrokenWitness::NoFace {
                    witness: 0,
                    point: [3.0, 3.0],
                },
            },
        ),
    ] {
        let choices = ReverseChoices {
            openings: vec![stored],
            order: None,
        };
        assert_eq!(
            strip.reverse_fold(&op, &choices).map(|_| ()),
            Err(CompoundRefused::Broken(broken))
        );
    }
    // Two stored openings for one flap.
    let twice = ReverseChoices {
        openings: vec![
            analysis.flaps[0].openings[0].stored.clone(),
            analysis.flaps[0].openings[1].stored.clone(),
        ],
        order: None,
    };
    assert_eq!(
        strip.reverse_fold(&op, &twice).map(|_| ()),
        Err(CompoundRefused::Broken(Broken::Opening { opening: 1 }))
    );
}

/// The strip of [`strip`] folded from a sheet started `start` up: the same
/// steps, each the viewer's valley.
fn strip_from(start: StartSide) -> State {
    let sheet = State::flat(Sheet::square(), start).unwrap_or_else(|e| panic!("{e}"));
    let book = fold(&sheet, &all(x_eq(0.5), [0.9, 0.5], Direction::Valley)).state;
    fold(&book, &all(x_eq(0.25), [0.4, 0.5], Direction::Valley)).state
}

/// The Paper pane's Front up / Back up keeps every step and replays it on
/// the sheet started the other side up. Each step's direction is the
/// viewer's, so the model-frame stack comes out reversed and each opening's
/// blocks swap: a stored opening names its split by whichever block it
/// named, and lands the mirror image of the fold it was chosen for.
#[test]
fn a_stored_opening_survives_starting_the_sheet_the_other_side_up() {
    let (front, back) = (strip_from(StartSide::Front), strip_from(StartSide::Back));
    assert!(mirrored(&front, &back));
    let op = reverse(y_eq(0.5), [0.1, 0.2], Seed::All, INSIDE);
    let analysis = front.analyse_reverse(&op).unwrap_or_else(|e| panic!("{e}"));
    let openings = &analysis.flaps[0].openings;
    assert_eq!(openings.len(), 2);
    for opening in openings {
        let choices = ReverseChoices {
            openings: vec![opening.stored.clone()],
            order: None,
        };
        for kind in [INSIDE, OUTSIDE] {
            let op = ReverseFold { kind, ..op.clone() };
            let there = landed(&front, &op, &choices);
            let turned = landed(&back, &op, &choices);
            check(&back, &op, &turned);
            assert!(
                mirrored(&there.state, &turned.state),
                "{kind:?}: {:?}",
                opening.upper
            );
            // Its blocks are the other way round, and what it stores now
            // names the same split on the sheet it landed from.
            assert_eq!(turned.report.openings[0].lower, opening.upper);
            assert_eq!(turned.report.openings[0].upper, opening.lower);
            let again = landed(&back, &op, &turned.report.stored);
            assert_eq!(again.state.parts(), turned.state.parts());
            // And the stored split turned over twice is the one chosen.
            assert_eq!(
                landed(&front, &op, &turned.report.stored).state.parts(),
                there.state.parts()
            );
        }
    }
}

/// A stored opening names its upper block by one witness per face. A parent
/// whose faces were split since — the same strip folded from a sheet
/// precreased across it — still names it: each witness lies in one piece of
/// its face, and the pieces of a face are joined across the precrease, which
/// no split between blocks crosses.
#[test]
fn a_stored_opening_names_its_block_across_faces_split_since() {
    let strip = strip_from(StartSide::Front);
    let creased = {
        let sheet = precrease(&square(), &all(y_eq(0.25), [0.5, 0.1], Direction::Valley)).state;
        let book = fold(&sheet, &all(x_eq(0.5), [0.9, 0.5], Direction::Valley)).state;
        fold(&book, &all(x_eq(0.25), [0.4, 0.5], Direction::Valley)).state
    };
    assert_eq!(creased.faces().len(), 2 * strip.faces().len());
    let op = reverse(y_eq(0.5), [0.1, 0.2], Seed::All, INSIDE);
    let analysis = strip.analyse_reverse(&op).unwrap_or_else(|e| panic!("{e}"));
    for opening in &analysis.flaps[0].openings {
        let choices = ReverseChoices {
            openings: vec![opening.stored.clone()],
            order: None,
        };
        let folded = landed(&creased, &op, &choices);
        check(&creased, &op, &folded);
        // Every face of each block is a piece of a face of the block chosen.
        let [chosen] = folded.report.openings.as_slice() else {
            panic!("{:?}", folded.report.openings);
        };
        for (pieces, faces) in [
            (&chosen.upper, &opening.upper),
            (&chosen.lower, &opening.lower),
        ] {
            assert_eq!(pieces.len(), 2 * faces.len());
            for &piece in pieces {
                let at = creased.face_witness(piece).unwrap_or_default();
                let face = strip.face_at(at).unwrap_or_else(|| panic!("{at:?}"));
                assert!(faces.contains(&face), "{piece} is a piece of {face}");
            }
        }
    }
}

// --- The campaign --------------------------------------------------------------

/// Draw `i` of seed `seed` of the spike's campaign
/// ([`compound::reverse_case`]).
fn campaign_case(seed: u64, i: u64) -> Option<(State, ReverseFold)> {
    compound::reverse_case(seed, i)
}

#[derive(Debug, Default)]
struct Tally {
    ops: usize,
    folds: usize,
    unique: usize,
    ambiguous: usize,
    no_order: usize,
    other_refusals: usize,
    letters: [usize; 3],
    plain_compared: usize,
}

/// The spike's campaign: every admissible opening (four at most) of the
/// first flap folded inside. Every landed state passes the full gate and
/// the letter rules, has a plain fold's geometry, starts and ends its motion
/// exactly, and replays from what it stores; every order a choice offers
/// lands.
fn campaign(seeds: std::ops::RangeInclusive<u64>, setups: u64) -> Tally {
    let mut tally = Tally::default();
    for seed in seeds {
        for i in 0..setups {
            let Some((state, op)) = campaign_case(seed, i) else {
                continue;
            };
            tally.ops += 1;
            let analysis = state.analyse_reverse(&op).unwrap_or_else(|e| panic!("{e}"));
            let first = &analysis.flaps[0];
            for opening in first.openings.iter().take(4) {
                let choices = ReverseChoices {
                    openings: if first.openings.len() > 1 {
                        vec![opening.stored.clone()]
                    } else {
                        Vec::new()
                    },
                    order: None,
                };
                if analysis.flaps.iter().skip(1).any(|f| f.openings.len() > 1) {
                    continue;
                }
                tally.folds += 1;
                let mut landed: Vec<oristudio_fold::ReverseFolded> = Vec::new();
                match state.reverse_fold(&op, &choices) {
                    Ok(ReverseOutcome::Landed(folded)) => {
                        tally.unique += 1;
                        landed.push(*folded);
                    }
                    Ok(ReverseOutcome::ChooseOrder(choice)) => {
                        tally.ambiguous += 1;
                        let sizes: Vec<usize> = choice
                            .completions()
                            .components()
                            .iter()
                            .map(|c| c.orders.len())
                            .collect();
                        for pick in compound::picks(&sizes) {
                            landed.push(
                                choice
                                    .pick(&pick)
                                    .unwrap_or_else(|e| panic!("s{seed}-{i}: {e}")),
                            );
                        }
                    }
                    Ok(ReverseOutcome::ChooseOpening(_)) => panic!("s{seed}-{i}: asks again"),
                    Err(CompoundRefused::Refused(refused)) => match refused.refusal.code() {
                        "reverse_kind_infeasible" | "reverse_tip_not_free" => {
                            tally.no_order += 1;
                        }
                        "sliver" | "short_crease" | "thin_piece" => tally.other_refusals += 1,
                        code => panic!("s{seed}-{i}: refused as {code}: {refused}"),
                    },
                    Err(CompoundRefused::Broken(broken)) => panic!("s{seed}-{i}: {broken}"),
                }
                for folded in &landed {
                    let letters = check(&state, &op, folded);
                    for (t, l) in tally.letters.iter_mut().zip(letters) {
                        *t += l;
                    }
                    tally.plain_compared +=
                        usize::from(compound::assert_plain_fold_geometry(&state, &op, folded));
                    let again = compound::landed(&state, &op, &folded.report.stored);
                    assert_eq!(again.state.parts(), folded.state.parts(), "s{seed}-{i}");
                }
            }
        }
    }
    tally
}

#[test]
fn the_seeded_campaign_lands_valid_unique_reverse_folds() {
    let tally = campaign(1..=1, 160);
    eprintln!("{tally:?}");
    assert!(tally.ops >= 150 && tally.unique >= 90, "{tally:?}");
    assert!(tally.ambiguous >= 1 && tally.no_order >= 50, "{tally:?}");
    assert!(tally.letters.iter().all(|&n| n >= 80), "{tally:?}");
    assert!(tally.plain_compared >= tally.unique / 2, "{tally:?}");
    let feasible = tally.unique + tally.ambiguous;
    assert!(
        tally.unique as f64 >= 0.9 * feasible as f64,
        "{} unique of {feasible}",
        tally.unique
    );
}

/// The spike's campaign at its size: seeds 1–3, 1,500 states each. The spike
/// found the inside fold unique by these seeds and completion in 99.4% of
/// the cases where one landed (3,010 of 3,029).
///
/// `cargo test -p oristudio-fold --release --test reverse -- --ignored --nocapture`
#[test]
#[ignore = "the spike's full campaign; run with --release --ignored"]
fn the_spikes_campaign() {
    let start = std::time::Instant::now();
    let tally = campaign(1..=3, 1500);
    let feasible = tally.unique + tally.ambiguous;
    eprintln!(
        "{tally:?}\nunique {} of {feasible} feasible ({:.2}%), in {:.1} s",
        tally.unique,
        100.0 * tally.unique as f64 / feasible as f64,
        start.elapsed().as_secs_f64()
    );
}

// --- Local completion ------------------------------------------------------------

/// A completion around the faces a fold moved is the whole problem's: the
/// same forced pairs and the same ‹ n of m ›, with the landed order among
/// its choices, for every pair outside the moved faces carried.
#[test]
fn completing_around_the_moved_faces_is_completing_everything() {
    let mut compared = 0;
    for i in 0..80 {
        let Some((state, op)) = campaign_case(2, i) else {
            continue;
        };
        let Ok(ReverseOutcome::Landed(folded)) = state.reverse_fold(&op, &none()) else {
            continue;
        };
        let landed = &folded.state;
        let moved: BTreeSet<FaceId> = folded
            .report
            .fold
            .blocks
            .iter()
            .flatten()
            .copied()
            .collect();
        let fixed: Vec<FixedPair> = landed
            .order()
            .pairs()
            .filter(|(pair, _)| !moved.contains(&pair.lo()) && !moved.contains(&pair.hi()))
            .filter_map(|(pair, lo_above)| {
                let [upper, lower] = if lo_above? {
                    [pair.lo(), pair.hi()]
                } else {
                    [pair.hi(), pair.lo()]
                };
                Some(FixedPair {
                    upper,
                    lower,
                    kind: FixedKind::Carried,
                })
            })
            .collect();
        let limits = CompletionLimits::default();
        let view = landed.folded_view();
        let problem = landed.problem();
        let everything = complete(view, problem, &fixed, &limits).unwrap_or_else(|e| panic!("{e}"));
        let around = complete_around(view, problem, &fixed, &moved, &limits)
            .unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(around.count(), everything.count(), "s2-{i}");
        let forced =
            |c: &oristudio_fold::Completions| c.forced_pairs().into_iter().collect::<BTreeSet<_>>();
        assert_eq!(forced(&around), forced(&everything), "s2-{i}");
        assert!(around.choice_of(landed.order()).is_some(), "s2-{i}");
        compared += 1;
    }
    assert!(compared >= 30, "only {compared} compared");
}

// --- The picture, the summary and the orders to choose ----------------------

/// A reverse fold's picture is a plain fold's of the whole tip, a mountain
/// as the viewer sees an inside fold and a valley an outside one. An inside
/// fold pushes the spine in from the side with no paper, between ℓ and the
/// tip; an outside fold wraps round and is not pushed. Landed, the grip's
/// image has its cover, and the summary reverses the spine.
#[test]
fn a_reverse_folds_picture_pushes_the_spine_and_its_summary_reverses_it() {
    let tri = triangle();
    let inside = reverse(y_eq(0.5), [0.9, 0.2], Seed::All, INSIDE);
    let before = tri
        .reverse_action(&inside, &none())
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(before.direction, Direction::Mountain);
    let analysis = tri
        .analyse_reverse(&inside)
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(before.moving, analysis.tip);
    let push = before.push.unwrap_or_else(|| panic!("no push"));
    // The spine is the diagonal x + y = 1, reaching from ℓ at (½, ½) to the
    // corner b = (1, 0); the paper is on its c side, x + y > 1.
    let toward = [push.toward.x, push.toward.y];
    let at = [push.at.x, push.at.y];
    assert!(close(toward, [0.7, 0.3]), "{toward:?}");
    assert!(close(at, [0.45, 0.05]), "{at:?}");
    assert!(before.grip.is_some_and(|g| g.hidden_image.is_none()));

    let folded = landed(&tri, &inside, &none());
    let after = folded.action(&tri).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(after.push, before.push);
    assert_eq!(after.line, before.line);
    assert!(after.grip.is_some_and(|g| g.hidden_image.is_some()));
    let summary = folded.summary(&tri).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(summary.layers, Some(2));
    assert!(!summary.diff.reversed.is_empty());
    assert_eq!(summary.diff.reversed, folded.report.fold.reversed);

    let outside = reverse(x_eq(0.5), [0.9, 0.5], Seed::All, OUTSIDE);
    let wrapped = tri
        .reverse_action(&outside, &none())
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(wrapped.direction, Direction::Valley);
    assert_eq!(wrapped.push, None);

    // Turned over, the viewer sees an inside fold as a mountain still, and
    // the push mirrors with the view.
    let turned = tri.turn_over_about(oristudio_fold::TurnAxis::Vertical);
    let seen = turned
        .reverse_action(&inside, &none())
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(seen.direction, Direction::Mountain);
    let mirrored = seen.push.unwrap_or_else(|| panic!("no push"));
    assert!((mirrored.toward.y - push.toward.y).abs() < 1e-12);
}

/// The orders a choice lists are every pick it takes, one listed order per
/// component, capped; each lands a state of its own.
#[test]
fn a_choice_lists_its_orders_as_picks() {
    let (state, op) = ambiguous();
    let Ok(ReverseOutcome::ChooseOrder(choice)) = state.reverse_fold(&op, &none()) else {
        panic!("case s1-287 no longer leaves a choice");
    };
    let (all, more) = choice.choices(16);
    assert_eq!(all, vec![vec![0], vec![1]]);
    assert!(!more);
    let (one, more) = choice.choices(1);
    assert_eq!(one, vec![vec![0]]);
    assert!(more);
    let stored: Vec<_> = all
        .iter()
        .map(|pick| {
            let folded = choice.pick(pick).unwrap_or_else(|e| panic!("{e}"));
            folded
                .report
                .stored
                .order
                .unwrap_or_else(|| panic!("no order"))
        })
        .collect();
    assert_ne!(stored[0], stored[1]);
}

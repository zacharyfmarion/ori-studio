//! The crimp through the compound pipeline (plan Phase 11, research §5.2),
//! on the reverse spike's named crimps (`cases.mjs` §3) and its seeded
//! campaign (`campaign-crimp.mjs`): one operation, the same kind on both
//! lines, verified only at its end; which kind lands by the lines' angle;
//! openings per flap; the letter rules; the motion's endpoints; stored
//! choices and their replay; refusals with their fixes.

mod compound;
mod support;

use std::collections::BTreeMap;

use oristudio_fold::{
    CompoundRefused, CreaseKind, CrimpFold, CrimpFolded, CrimpOutcome, Direction, FaceId, Fix,
    LegName, Letter, MotionGroup, ReverseChoices, ReverseFold, ReverseKind, Seed, Sheet, Side,
    Stacking, StartSide, State,
};
use oristudio_geometry::Line;
use support::*;

const INSIDE: ReverseKind = ReverseKind::Inside;
const OUTSIDE: ReverseKind = ReverseKind::Outside;

fn square() -> State {
    State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"))
}

/// The square valley-folded along bd: the triangle b c d, its spine bd.
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

fn none() -> ReverseChoices {
    ReverseChoices::default()
}

fn crimp(first: Line, second: Line, toward: Point, kind: ReverseKind) -> CrimpFold {
    CrimpFold {
        first,
        second,
        side: side(&first, toward),
        anchor: Seed::All,
        kind,
    }
}

fn other(letter: Letter) -> Letter {
    match letter {
        Letter::Mountain => Letter::Valley,
        Letter::Valley => Letter::Mountain,
    }
}

/// The two faces a crease bounds.
fn crease_faces(state: &State, edge: oristudio_fold::EdgeId) -> Option<[FaceId; 2]> {
    compound::crease_faces(state, edge)
}

/// The letter rules on a landed crimp: a spine crease across the strip's
/// blocks turns M↔V, one across the tip's turns twice and keeps its letter,
/// and every crease within a block or that stays keeps its letter. Returns
/// how many strip and tip spine creases it checked.
fn assert_letters(parent: &State, folded: &CrimpFolded) -> [usize; 2] {
    let landed = &folded.state;
    let blocks = &folded.report.fold.blocks;
    let strip = blocks.len() / 2;
    let block: BTreeMap<FaceId, usize> = blocks
        .iter()
        .enumerate()
        .flat_map(|(b, faces)| faces.iter().map(move |&f| (f, b)))
        .collect();
    let mut counts = [0; 2];
    for crease in landed.creases() {
        let CreaseKind::Folded(letter) = crease.kind else {
            continue;
        };
        if folded.report.fold.created.contains(&crease.id) {
            continue;
        }
        // The parent's crease this is, or is a half of.
        let [p, q] = crease.vertices.map(|v| landed.vertices()[v.0 as usize]);
        let mid = [(p[0] + q[0]) / 2.0, (p[1] + q[1]) / 2.0];
        let Some(CreaseKind::Folded(before)) = parent.crease_at(mid).map(|c| c.kind) else {
            continue;
        };
        let Some([f, g]) = crease_faces(landed, crease.id) else {
            continue;
        };
        match (block.get(&f), block.get(&g)) {
            (Some(&x), Some(&y)) if x != y && x < strip && y < strip => {
                assert_eq!(letter, other(before), "strip spine {} kept", crease.id);
                counts[0] += 1;
            }
            (Some(&x), Some(&y)) if x != y && x >= strip && y >= strip => {
                assert_eq!(letter, before, "tip spine {} turned", crease.id);
                counts[1] += 1;
            }
            (Some(x), Some(y)) if x == y => assert_eq!(letter, before),
            (None, None) => assert_eq!(letter, before),
            _ => {}
        }
    }
    counts
}

/// The motion folds both lines together in one spread and one close: it
/// starts every face where the parent had it and ends it where it lands,
/// its close starts where its spread ended, ℓ2 joins each tip face to its
/// strip at every instant, and the tip never stands edge-on — seen from
/// above, a tip face keeps at least the cosine of the lines' angle of its
/// area all the way, and all of it along parallel lines.
fn assert_motion(parent: &State, folded: &CrimpFolded) {
    let landed = &folded.state;
    let motion = &folded.report.motion;
    let legs: Vec<_> = motion.legs.iter().map(|l| (l.name, l.stacking)).collect();
    assert_eq!(
        legs,
        [
            (LegName::Spread, Stacking::Parent),
            (LegName::Close, Stacking::Landed)
        ]
    );
    let mut appearances: BTreeMap<FaceId, Vec<MotionGroup>> = BTreeMap::new();
    for leg in &motion.legs {
        for group in &leg.groups {
            for &f in &group.faces {
                appearances.entry(f).or_default().push(group.clone());
            }
        }
    }
    let moved: usize = folded.report.fold.blocks.iter().map(Vec::len).sum();
    assert_eq!(appearances.len(), moved);
    let near = |a: [f64; 3], b: [f64; 3]| a.iter().zip(&b).all(|(x, y)| (x - y).abs() < 1e-9);
    // Where a face's turns have a landed point `t` of the way through the
    // step: the spread to ½, the close after.
    let at = |turns: &[MotionGroup], q: Point, t: f64| {
        let (leg, share) = if t < 0.5 {
            (0, 2.0 * t)
        } else {
            (1, 2.0 * t - 1.0)
        };
        turns[leg].pose(q, share)
    };
    let sweep: Vec<f64> = (0..=24).map(|k| f64::from(k) / 24.0).collect();
    // Each moving face's block, a tip block numbered as its strip's.
    let blocks = &folded.report.fold.blocks;
    let pair_of: BTreeMap<FaceId, usize> = blocks
        .iter()
        .enumerate()
        .flat_map(|(b, faces)| faces.iter().map(move |&f| (f, b % (blocks.len() / 2))))
        .collect();
    // Per landed vertex, its point and the block pair and turns of each
    // moving face it bounds.
    let mut corners: BTreeMap<u32, Corner> = BTreeMap::new();
    for (face, turns) in &appearances {
        assert_eq!(turns.len(), 2, "face {face}");
        let t = landed.isometry(*face).unwrap_or_default();
        let lineage = landed
            .face(*face)
            .and_then(|f| f.parent)
            .filter(|p| parent.face(*p).is_some())
            .unwrap_or(*face);
        let before = parent.isometry(lineage).unwrap_or_default();
        let ring = landed
            .face(*face)
            .map(|f| f.ring.clone())
            .unwrap_or_default();
        let mut points = Vec::new();
        for v in &ring {
            let sheet = landed.vertices()[v.0 as usize];
            let q = t.apply(sheet);
            let p = before.apply(sheet);
            assert!(
                near(turns[0].pose(q, 0.0), [p[0], p[1], 0.0]),
                "face {face} does not start where the parent had it"
            );
            assert!(near(turns[1].pose(q, 1.0), [q[0], q[1], 0.0]));
            assert!(near(turns[0].pose(q, 1.0), turns[1].pose(q, 0.0)));
            corners
                .entry(v.0)
                .or_insert((q, Vec::new()))
                .1
                .push((pair_of[face], turns));
            points.push(q);
        }
        // A tip face, carried by its strip's turn: never edge-on.
        let Some(carrier) = turns[0].carrier else {
            continue;
        };
        let oriented = |line: &Line, side: Side| match side {
            Side::Positive => line.n,
            Side::Negative => [-line.n[0], -line.n[1]],
        };
        let [a, b] = [
            oriented(&turns[0].axis, turns[0].side),
            oriented(&carrier.axis, carrier.side),
        ];
        let least = (a[0] * b[0] + a[1] * b[1]).min(1.0);
        let whole = area(&points);
        for &t in &sweep {
            let seen: Vec<Point> = points
                .iter()
                .map(|&q| {
                    let [x, y, _] = at(turns, q, t);
                    [x, y]
                })
                .collect();
            assert!(
                area(&seen) >= least * whole - 1e-9,
                "tip face {face} at {t}: {} of {whole}",
                area(&seen)
            );
        }
    }
    // ℓ2 joins each tip block to its strip block (and the faces of a block
    // to each other): a corner they share is where both put it, at every
    // instant. Blocks across the spine part, as a reverse fold's do.
    let mut joined = 0;
    for (v, (q, faces)) in &corners {
        for (k, (a, first)) in faces.iter().enumerate() {
            for (b, second) in &faces[k + 1..] {
                if a != b {
                    continue;
                }
                joined += 1;
                for &t in &sweep {
                    assert!(
                        near(at(first, *q, t), at(second, *q, t)),
                        "corner {v} parts at {t}"
                    );
                }
            }
        }
    }
    assert!(joined > 0, "no corner joins two moving faces");
}

/// A landed corner of moving paper: its point, and the block pair (a tip
/// block numbered as its strip's) and turns of each moving face it bounds.
type Corner<'a> = (Point, Vec<(usize, &'a Vec<MotionGroup>)>);

/// The area a ring of points bounds.
fn area(ring: &[Point]) -> f64 {
    let n = ring.len();
    (0..n)
        .map(|i| {
            let (p, q) = (ring[i], ring[(i + 1) % n]);
            p[0] * q[1] - q[0] * p[1]
        })
        .sum::<f64>()
        .abs()
        / 2.0
}

/// Every check on one landed crimp, with its replay from what it stores.
fn check(parent: &State, op: &CrimpFold, folded: &CrimpFolded) -> [usize; 2] {
    assert_valid(&folded.state);
    assert_motion(parent, folded);
    let again = match parent.crimp_fold(op, &folded.report.stored) {
        Ok(CrimpOutcome::Landed(again)) => again,
        other => panic!("replay: {:?}", other.err()),
    };
    assert_eq!(again.state.parts(), folded.state.parts());
    assert_letters(parent, folded)
}

fn landed(state: &State, op: &CrimpFold, choices: &ReverseChoices) -> CrimpFolded {
    match state.crimp_fold(op, choices) {
        Ok(CrimpOutcome::Landed(folded)) => {
            check(state, op, &folded);
            *folded
        }
        Ok(CrimpOutcome::ChooseOpening(a)) => panic!("{op:?}: choose an opening: {a:?}"),
        Ok(CrimpOutcome::ChooseOrder(c)) => panic!("{op:?}: choose an order of {:?}", c.count()),
        Err(e) => panic!("{op:?}: {e} {e:?}"),
    }
}

fn refusal(state: &State, op: &CrimpFold) -> oristudio_fold::Refused {
    match state.crimp_fold(op, &none()) {
        Err(CompoundRefused::Refused(refused)) => refused,
        Err(CompoundRefused::Broken(broken)) => panic!("{op:?}: broken {broken}"),
        Ok(_) => panic!("{op:?} landed"),
    }
}

// --- The triangle ----------------------------------------------------------------

/// Spike cases 3: ℓ1 perpendicular to the spine at (0.4, 0.6), ℓ2 through
/// (0.62, 0.38) at 36.87° (the lines meet beyond the spine: only the inside
/// crimp lands), at 53.13° (beyond the raw edges: only the outside), or
/// parallel to ℓ1 (both). Each lands uniquely, and the kind that does not
/// fit is refused offering the one that does.
#[test]
fn the_triangles_crimp_lands_by_the_lines_angle() {
    let tri = triangle();
    let first =
        Line::from_point_direction([0.4, 0.6], [1.0, 1.0]).unwrap_or_else(|| unreachable!());
    let parallel =
        Line::from_point_direction([0.6, 0.4], [1.0, 1.0]).unwrap_or_else(|| unreachable!());
    let cases: [(&str, Line, &[ReverseKind]); 3] = [
        ("perp", at_angle([0.62, 0.38], 36.87), &[INSIDE]),
        ("perp2", at_angle([0.62, 0.38], 53.13), &[OUTSIDE]),
        ("par", parallel, &[INSIDE, OUTSIDE]),
    ];
    for (name, second, kinds) in cases {
        let op = crimp(first, second, [0.97, 0.06], INSIDE);
        assert_eq!(
            tri.crimp_kinds(&op, &none()).unwrap_or_default(),
            kinds.to_vec(),
            "{name}"
        );
        let analysis = tri.analyse_crimp(&op).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(analysis.tip.tip.len(), 2, "{name}");
        assert_eq!(analysis.beyond.len(), 2, "{name}");
        for kind in [INSIDE, OUTSIDE] {
            let op = CrimpFold { kind, ..op.clone() };
            if kinds.contains(&kind) {
                let folded = landed(&tri, &op, &none());
                assert_eq!(folded.state.faces().len(), 6, "{name} {kind:?}");
                assert_eq!(folded.report.fold.blocks.len(), 4, "{name} {kind:?}");
                assert_eq!(folded.report.fold.created.len(), 4, "{name} {kind:?}");
                // Both lines fold together: one spread and one close
                // (`assert_motion` sweeps them).
                assert_eq!(folded.report.motion.legs.len(), 2);
                let [strip, tip] = assert_letters(&tri, &folded);
                assert_eq!((strip, tip), (1, 1), "{name} {kind:?}");
                // The spine's strip half turned; its tip half kept its letter.
                assert_eq!(folded.report.fold.reversed.len(), 1, "{name} {kind:?}");
            } else {
                let refused = refusal(&tri, &op);
                assert_eq!(refused.refusal.code(), "crimp_kind_infeasible", "{name}");
                assert_eq!(
                    refused.fixes,
                    vec![Fix::OtherKind { kind: kind.other() }],
                    "{name}"
                );
            }
        }
    }
}

/// The stacking the spike found for the triangle's crimps along parallel
/// lines, bottom to top, body B, strip S and tip P, b and t the bottom and
/// top layer: inside Bb < Sb < Pb < Pt < St < Bt, outside Pb < Sb < Bb <
/// Bt < St < Pt (`dbg-crimp.mjs`).
#[test]
fn the_crimped_triangle_stacks_as_the_spike_found() {
    let tri = triangle();
    let first =
        Line::from_point_direction([0.4, 0.6], [1.0, 1.0]).unwrap_or_else(|| unreachable!());
    let second =
        Line::from_point_direction([0.6, 0.4], [1.0, 1.0]).unwrap_or_else(|| unreachable!());
    // The layers at the corner b, bottom first, in the parent.
    let mut corner = tri.stack_at([0.97, 0.06]).unwrap_or_default();
    corner.reverse();
    for (kind, expected) in [
        (INSIDE, ["Bb", "Sb", "Pb", "Pt", "St", "Bt"]),
        (OUTSIDE, ["Pb", "Sb", "Bb", "Bt", "St", "Pt"]),
    ] {
        let op = crimp(first, second, [0.97, 0.06], kind);
        let folded = landed(&tri, &op, &none());
        let state = &folded.state;
        let blocks = &folded.report.fold.blocks;
        let zone = |f: FaceId| match blocks.iter().position(|b| b.contains(&f)) {
            None => "B",
            Some(b) if b < blocks.len() / 2 => "S",
            Some(_) => "P",
        };
        let layer = |f: FaceId| {
            let parent = state.face(f).and_then(|face| face.parent).unwrap_or(f);
            match corner.iter().position(|&l| l == parent) {
                Some(0) => "b",
                _ => "t",
            }
        };
        // Every layer overlaps the body near the spine's foot at ℓ1.
        let mut faces: Vec<FaceId> = state.faces().iter().map(|f| f.id).collect();
        faces.sort_by(|&f, &g| match state.above(f, g) {
            Some(true) => std::cmp::Ordering::Greater,
            Some(false) => std::cmp::Ordering::Less,
            None => std::cmp::Ordering::Equal,
        });
        let names: Vec<String> = faces
            .iter()
            .map(|&f| format!("{}{}", zone(f), layer(f)))
            .collect();
        assert_eq!(names, expected, "{kind:?}");
    }
}

/// A crimp is one operation: the reverse fold along ℓ1 alone may not land
/// where the crimp does (4.5% and 5.6% of the spike's valid crimps). The
/// first such crimp of the campaign.
#[test]
fn a_crimp_lands_where_its_first_reverse_alone_does_not() {
    let found = (0..600).find_map(|i| {
        let (state, op) = crimp_case(1, i)?;
        for kind in [INSIDE, OUTSIDE] {
            let op = CrimpFold { kind, ..op.clone() };
            let reverse = ReverseFold {
                line: op.first,
                side: op.side,
                anchor: op.anchor.clone(),
                kind,
            };
            let choices = first_openings(&state, &op)?;
            let crimp_lands =
                matches!(state.crimp_fold(&op, &choices), Ok(CrimpOutcome::Landed(_)));
            let reverse_refused = matches!(
                state.reverse_fold(&reverse, &choices),
                Err(CompoundRefused::Refused(_))
            );
            if crimp_lands && reverse_refused {
                return Some((state, op, choices));
            }
        }
        None
    });
    let Some((state, op, choices)) = found else {
        panic!("no crimp of the campaign's first 600 states lands without its first reverse");
    };
    landed(&state, &op, &choices);
}

// --- Openings, refusals, stored choices -------------------------------------------

/// Book fold, book fold again: the strip [0, ¼] × [0, 1] in four layers.
fn strip() -> State {
    let book = fold(&square(), &all(x_eq(0.5), [0.9, 0.5], Direction::Valley)).state;
    fold(&book, &all(x_eq(0.25), [0.4, 0.5], Direction::Valley)).state
}

/// A four-layer flap opens two ways at ℓ1, and the crimp asks which: the
/// same opening at both lines, stored by its upper block.
#[test]
fn a_four_layer_flap_crimps_through_the_opening_chosen() {
    let strip = strip();
    let op = crimp(y_eq(0.5), y_eq(0.3), [0.1, 0.2], INSIDE);
    let Ok(CrimpOutcome::ChooseOpening(asked)) = strip.crimp_fold(&op, &none()) else {
        panic!("no choice of opening");
    };
    let flap = &asked.tip.flaps[0];
    assert_eq!(flap.openings.len(), 2);
    let mut landings = 0;
    for opening in &flap.openings {
        let choices = ReverseChoices {
            openings: vec![opening.stored.clone()],
            order: None,
        };
        for kind in strip.crimp_kinds(&op, &choices).unwrap_or_default() {
            let op = CrimpFold { kind, ..op.clone() };
            let folded = match strip.crimp_fold(&op, &choices) {
                Ok(CrimpOutcome::Landed(folded)) => *folded,
                Ok(CrimpOutcome::ChooseOrder(choice)) => choice
                    .pick(&vec![0; choice.completions().components().len()])
                    .unwrap_or_else(|e| panic!("{e}")),
                other => panic!("{:?}", other.err()),
            };
            check(&strip, &op, &folded);
            assert_eq!(folded.report.openings, vec![opening.clone()]);
            assert_eq!(folded.report.stored.openings, choices.openings);
            assert_eq!(folded.state.faces().len(), 12);
            landings += 1;
        }
    }
    assert!(landings >= 2, "{landings}");
}

/// A crimp's stored opening names its split either way up, as a reverse
/// fold's does: the strip folded from a sheet started back up (the Paper
/// pane's Back up) crimps through it to the mirror image.
#[test]
fn a_stored_opening_crimps_the_sheet_started_the_other_side_up() {
    let strip = strip();
    let turned = {
        let sheet = State::flat(Sheet::square(), StartSide::Back).unwrap_or_else(|e| panic!("{e}"));
        let book = fold(&sheet, &all(x_eq(0.5), [0.9, 0.5], Direction::Valley)).state;
        fold(&book, &all(x_eq(0.25), [0.4, 0.5], Direction::Valley)).state
    };
    assert!(mirrored(&strip, &turned));
    let op = crimp(y_eq(0.5), y_eq(0.3), [0.1, 0.2], INSIDE);
    let analysis = strip.analyse_crimp(&op).unwrap_or_else(|e| panic!("{e}"));
    let mut landings = 0;
    for opening in &analysis.tip.flaps[0].openings {
        let choices = ReverseChoices {
            openings: vec![opening.stored.clone()],
            order: None,
        };
        for kind in strip.crimp_kinds(&op, &choices).unwrap_or_default() {
            let op = CrimpFold { kind, ..op.clone() };
            let (Ok(CrimpOutcome::Landed(there)), Ok(CrimpOutcome::Landed(mirror))) = (
                strip.crimp_fold(&op, &choices),
                turned.crimp_fold(&op, &choices),
            ) else {
                continue;
            };
            check(&turned, &op, &mirror);
            assert!(mirrored(&there.state, &mirror.state), "{kind:?}");
            landings += 1;
        }
    }
    assert!(landings >= 2, "{landings}");
}

#[test]
fn crimp_refusals_name_their_faces() {
    let tri = triangle();
    let first =
        Line::from_point_direction([0.4, 0.6], [1.0, 1.0]).unwrap_or_else(|| unreachable!());
    // ℓ2 crossing ℓ1 over the tip, at (0.6, 0.8).
    let crossing = crimp(first, through([0.6, 0.8], [0.9, 0.2]), [0.97, 0.06], INSIDE);
    let refused = refusal(&tri, &crossing);
    assert_eq!(refused.refusal.code(), "crimp_lines_meet");
    assert!(!refused.refusal.faces().is_empty());
    // Coincident hinges and a sub-minimum strip must not become endpoint
    // exceptions. Neither leaves a nondegenerate strip clear of ℓ2.
    for second in [first, through([0.4002, 0.6], [0.6002, 0.8])] {
        let refused = refusal(&tri, &crimp(first, second, [0.97, 0.06], INSIDE));
        assert_eq!(refused.refusal.code(), "crimp_lines_meet");
    }
    // ℓ2 beyond the paper.
    let missing = crimp(
        first,
        Line::from_point_direction([1.2, -0.2], [1.0, 1.0]).unwrap_or_else(|| unreachable!()),
        [0.97, 0.06],
        INSIDE,
    );
    assert_eq!(refusal(&tri, &missing).refusal.code(), "crimp_misses_tip");
    // A single layer has nothing to open.
    let flat = crimp(y_eq(0.5), y_eq(0.3), [0.5, 0.1], INSIDE);
    assert_eq!(
        refusal(&square(), &flat).refusal.code(),
        "reverse_no_opening"
    );
}

// --- The campaign ----------------------------------------------------------------

/// Draw `i` of seed `seed` of the spike's crimp campaign
/// ([`compound::crimp_case`]).
fn crimp_case(seed: u64, i: u64) -> Option<(State, CrimpFold)> {
    compound::crimp_case(seed, i)
}

/// Each flap's first opening, as the spike's campaign takes it.
fn first_openings(state: &State, op: &CrimpFold) -> Option<ReverseChoices> {
    compound::crimp_openings(state, op)
}

#[derive(Debug, Default, Clone, Copy)]
struct Kind {
    unique: usize,
    ambiguous: usize,
    no_order: usize,
    no_opening: usize,
    other_refusals: usize,
}

#[derive(Debug, Default)]
struct Tally {
    ops: usize,
    inside: Kind,
    outside: Kind,
    letters: [usize; 2],
}

fn campaign(seeds: std::ops::RangeInclusive<u64>, setups: u64) -> Tally {
    let mut tally = Tally::default();
    for seed in seeds {
        for i in 0..setups {
            let Some((state, op)) = crimp_case(seed, i) else {
                continue;
            };
            let Some(choices) = first_openings(&state, &op) else {
                continue;
            };
            tally.ops += 1;
            for kind in [INSIDE, OUTSIDE] {
                let op = CrimpFold { kind, ..op.clone() };
                let mut landed = Vec::new();
                let count = match kind {
                    ReverseKind::Inside => &mut tally.inside,
                    ReverseKind::Outside => &mut tally.outside,
                };
                match state.crimp_fold(&op, &choices) {
                    Ok(CrimpOutcome::Landed(folded)) => {
                        count.unique += 1;
                        landed.push(*folded);
                    }
                    Ok(CrimpOutcome::ChooseOrder(choice)) => {
                        count.ambiguous += 1;
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
                    Ok(CrimpOutcome::ChooseOpening(_)) => panic!("s{seed}-{i}: asks again"),
                    Err(CompoundRefused::Refused(refused)) => match refused.refusal.code() {
                        "crimp_kind_infeasible" | "crimp_tip_not_free" => count.no_order += 1,
                        "crimp_no_opening" | "crimp_lines_meet" | "crimp_misses_tip" => {
                            count.no_opening += 1;
                        }
                        "sliver" | "short_crease" | "thin_piece" | "near_miss"
                        | "degenerate_split" => count.other_refusals += 1,
                        code => panic!("s{seed}-{i}: refused as {code}: {refused}"),
                    },
                    Err(CompoundRefused::Broken(broken)) => panic!("s{seed}-{i}: {broken}"),
                }
                for folded in &landed {
                    let [strip, tip] = check(&state, &op, folded);
                    tally.letters[0] += strip;
                    tally.letters[1] += tip;
                }
            }
        }
    }
    tally
}

#[test]
fn the_seeded_campaign_lands_valid_crimps() {
    let tally = campaign(1..=1, 200);
    eprintln!("{tally:?}");
    assert!(tally.ops >= 100, "{tally:?}");
    for kind in [tally.inside, tally.outside] {
        let feasible = kind.unique + kind.ambiguous;
        assert!(feasible >= 20 && kind.no_order >= 10, "{tally:?}");
        assert!(
            kind.unique as f64 >= 0.9 * feasible as f64,
            "{} unique of {feasible}",
            kind.unique
        );
    }
    assert!(
        tally.letters[0] >= 20 && tally.letters[1] >= 10,
        "{tally:?}"
    );
}

/// The spike's campaign at its size: seeds 1–2, 1,500 states each. The spike
/// found a crimp of the kind asked for unique in 99.0% of feasible inside
/// crimps (1,535 of 1,551) and 98.9% of outside ones (1,449 of 1,465).
///
/// `cargo test -p oristudio-fold --release --test crimp -- --ignored --nocapture`
#[test]
#[ignore = "the spike's full campaign; run with --release --ignored"]
fn the_spikes_campaign() {
    let start = std::time::Instant::now();
    let tally = campaign(1..=2, 1500);
    eprintln!("{tally:?}");
    for (name, kind) in [("inside", tally.inside), ("outside", tally.outside)] {
        let feasible = kind.unique + kind.ambiguous;
        eprintln!(
            "{name}: unique {} of {feasible} feasible ({:.2}%)",
            kind.unique,
            100.0 * kind.unique as f64 / feasible as f64
        );
    }
    eprintln!("in {:.1} s", start.elapsed().as_secs_f64());
}

/// A crimp the completion leaves open stores the pairs it chose: each pick
/// lands and replays from what it stores (the campaign checks that too), and
/// a stored witness off the paper breaks the step.
#[test]
fn a_crimp_with_two_orders_stores_its_choice() {
    let found = (0..600).find_map(|i| {
        let (state, op) = crimp_case(1, i)?;
        let choices = first_openings(&state, &op)?;
        [INSIDE, OUTSIDE].into_iter().find_map(|kind| {
            let op = CrimpFold { kind, ..op.clone() };
            match state.crimp_fold(&op, &choices) {
                Ok(CrimpOutcome::ChooseOrder(choice)) => {
                    Some((state.clone(), op, choices.clone(), choice))
                }
                _ => None,
            }
        })
    });
    let Some((state, op, choices, choice)) = found else {
        panic!("no crimp of seed 1 leaves a choice");
    };
    let folded = choice
        .pick(&vec![0; choice.completions().components().len()])
        .unwrap_or_else(|e| panic!("{e}"));
    check(&state, &op, &folded);
    let Some(mut order) = folded.report.stored.order.clone() else {
        panic!("no stored order");
    };
    order.faces[0] = [7.0, 7.0];
    assert!(matches!(
        state.crimp_fold(
            &op,
            &ReverseChoices {
                openings: choices.openings,
                order: Some(order),
            }
        ),
        Err(CompoundRefused::Broken(_))
    ));
}

/// What the tools ask of a crimp before it lands (plan D12, D14): its tip at
/// ℓ1 as a plain fold's analysis reads it, the moving side's flaps the plain
/// fold's along ℓ1; and its picture — ℓ1 with the tip's spans, no grip, the
/// pleat arrow from beyond ℓ2 to short of ℓ1 — which the landed step's
/// picture is too.
#[test]
fn a_crimp_is_pictured_by_its_first_line_and_a_pleat_arrow() {
    let tri = triangle();
    let first =
        Line::from_point_direction([0.4, 0.6], [1.0, 1.0]).unwrap_or_else(|| unreachable!());
    let op = crimp(first, at_angle([0.62, 0.38], 36.87), [0.97, 0.06], INSIDE);
    let crimped = tri.analyse_crimp(&op).unwrap_or_else(|e| panic!("{e}"));
    let analysis = tri
        .analyse_crimp_fold(&op)
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(analysis.moving, crimped.tip.tip);
    assert_eq!(analysis.line, crimped.tip.line);
    assert_eq!(
        analysis.flaps,
        tri.analyse_fold(&op.plain())
            .unwrap_or_else(|e| panic!("{e}"))
            .flaps
    );
    let picked: Vec<usize> = crimped.tip.flaps.iter().map(|f| f.index).collect();
    assert_eq!(analysis.picked, picked);
    // The near layer turns as the inside reverse at ℓ1 turns it: a mountain.
    assert_eq!(analysis.direction, Direction::Mountain);

    let action = tri.crimp_action(&op).unwrap_or_else(|e| panic!("{e}"));
    assert!(action.line.is_some());
    assert!(!action.spans.is_empty());
    assert!(action.grip.is_none());
    assert_eq!(action.direction, Direction::Mountain);
    let Some(pleat) = action.pleat else {
        panic!("no pleat arrow");
    };
    assert_eq!(pleat.kinks, 1);
    // The triangle is seen as it lies, so the scene frame is the model's:
    // the arrow's tail beyond ℓ2, its head short of ℓ1, on the body's side.
    let (from, to) = ([pleat.from.x, pleat.from.y], [pleat.to.x, pleat.to.y]);
    assert_eq!(
        oristudio_fold::Side::of_point(&crimped.second, from),
        Some(crimped.second_side)
    );
    assert_eq!(
        oristudio_fold::Side::of_point(&first, to),
        Some(op.side.opposite())
    );

    let folded = landed(&tri, &op, &none());
    assert_eq!(
        folded.action(&tri).unwrap_or_else(|e| panic!("{e}")),
        action
    );
}

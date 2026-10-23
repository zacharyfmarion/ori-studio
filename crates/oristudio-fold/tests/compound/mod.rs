//! What every landed reverse fold is checked for (plan D4, research §5.2):
//! the full gate from scratch, the letter rules, the geometry and crease
//! pattern of a plain fold of the whole tip, and a motion whose endpoints
//! are the parent and the landed state.

#![allow(dead_code)]

use std::collections::BTreeMap;

use oristudio_fold::random::{self, Rng};
use oristudio_fold::{
    ClosurePolicy, CreaseKind, CrimpFold, Direction, EdgeId, FaceId, Letter, PlainFold,
    ReverseAnalysis, ReverseChoices, ReverseFold, ReverseFolded, ReverseKind, ReverseOutcome, Seed,
    State, StepMotion, TuckFold,
};

use crate::support::{Point, assert_valid};

/// The two faces a crease bounds, by their rings.
pub fn crease_faces(state: &State, edge: EdgeId) -> Option<[FaceId; 2]> {
    let crease = state.crease(edge)?;
    let [a, b] = crease.vertices;
    let faces: Vec<FaceId> = state
        .faces()
        .iter()
        .filter(|f| {
            let n = f.ring.len();
            (0..n).any(|i| {
                let (p, q) = (f.ring[i], f.ring[(i + 1) % n]);
                (p == a && q == b) || (p == b && q == a)
            })
        })
        .map(|f| f.id)
        .collect();
    <[FaceId; 2]>::try_from(faces).ok()
}

/// Per landed face in a block, its block.
pub fn blocks(folded: &ReverseFolded) -> BTreeMap<FaceId, usize> {
    folded
        .report
        .fold
        .blocks
        .iter()
        .enumerate()
        .flat_map(|(b, faces)| faces.iter().map(move |&f| (f, b)))
        .collect()
}

/// The parent's crease a landed crease is, or is a half of: the one whose
/// sheet segment holds both its ends. None for a new crease.
fn parent_crease(parent: &State, landed: &State, edge: EdgeId) -> Option<CreaseKind> {
    if let Some(c) = parent.crease(edge) {
        return Some(c.kind);
    }
    let crease = landed.crease(edge)?;
    let [p, q] = crease.vertices.map(|v| landed.vertices()[v.0 as usize]);
    parent.creases().iter().find_map(|c| {
        let [a, b] = c.vertices.map(|v| parent.vertices()[v.0 as usize]);
        let on = |x: Point| {
            let len = (b[0] - a[0]).hypot(b[1] - a[1]);
            let off = ((x[0] - a[0]) * (b[1] - a[1]) - (x[1] - a[1]) * (b[0] - a[0])) / len;
            let along = ((x[0] - a[0]) * (b[0] - a[0]) + (x[1] - a[1]) * (b[1] - a[1])) / len;
            off.abs() < 1e-9 && along > -1e-9 && along < len + 1e-9
        };
        (on(p) && on(q)).then_some(c.kind)
    })
}

fn other(letter: Letter) -> Letter {
    match letter {
        Letter::Mountain => Letter::Valley,
        Letter::Valley => Letter::Mountain,
    }
}

/// Research §5.2's letter rules on a landed reverse fold. Returns how many
/// creases each rule checked: (kept, turned, new creases where a spine
/// crosses ℓ).
pub fn assert_letter_rules(parent: &State, folded: &ReverseFolded) -> [usize; 3] {
    let landed = &folded.state;
    let block = blocks(folded);
    let created = &folded.report.fold.created;
    let mut counts = [0; 3];
    for crease in landed.creases() {
        let CreaseKind::Folded(letter) = crease.kind else {
            continue;
        };
        if created.contains(&crease.id) {
            continue;
        }
        let Some(CreaseKind::Folded(before)) = parent_crease(parent, landed, crease.id) else {
            continue;
        };
        let Some([f, g]) = crease_faces(landed, crease.id) else {
            panic!("crease {} bounds no two faces", crease.id);
        };
        match (block.get(&f), block.get(&g)) {
            // A spine crease across an opening turns.
            (Some(x), Some(y)) if x != y => {
                assert_eq!(letter, other(before), "spine crease {} kept", crease.id);
                counts[1] += 1;
            }
            // Every other tip crease, and every crease that stays, keeps.
            (Some(_), Some(_)) | (None, None) => {
                assert_eq!(letter, before, "crease {} turned", crease.id);
                counts[0] += 1;
            }
            _ => {}
        }
    }
    // A new crease where a spine crosses ℓ takes the body's spine letter for
    // an inside fold, the other for an outside one.
    for &chord in created {
        let Some(CreaseKind::Folded(letter)) = landed.crease(chord).map(|c| c.kind) else {
            panic!("new crease {chord} is not folded");
        };
        let Some(ends) = landed.crease(chord).map(|c| c.vertices) else {
            continue;
        };
        for v in ends {
            let (mut body, mut across) = (None, false);
            for c in landed.creases() {
                if created.contains(&c.id) || !c.vertices.contains(&v) {
                    continue;
                }
                let CreaseKind::Folded(l) = c.kind else {
                    continue;
                };
                let Some([f, g]) = crease_faces(landed, c.id) else {
                    continue;
                };
                match (block.get(&f), block.get(&g)) {
                    (None, None) => body = Some(l),
                    (Some(x), Some(y)) if x != y => across = true,
                    _ => {}
                }
            }
            if let (Some(body), true) = (body, across) {
                let want = match folded.report.kind {
                    ReverseKind::Inside => body,
                    ReverseKind::Outside => other(body),
                };
                assert_eq!(letter, want, "new crease {chord} at the spine");
                counts[2] += 1;
            }
        }
    }
    counts
}

/// The plain fold of the whole tip, when its closure moves exactly the tip:
/// the reverse fold's geometry and crease pattern must be its (research
/// §5.2: only the letters and the order differ). Returns whether it compared.
pub fn assert_plain_fold_geometry(
    parent: &State,
    op: &ReverseFold,
    folded: &ReverseFolded,
) -> bool {
    let analysis = parent.analyse_reverse(op).unwrap_or_else(|e| panic!("{e}"));
    let plain = PlainFold {
        line: op.line,
        side: op.side,
        direction: Direction::Valley,
        seed: Seed::Flaps {
            at: analysis.flaps.iter().map(|f| f.flap.witness).collect(),
        },
        placement: Default::default(),
        closure: ClosurePolicy::Include,
    };
    let Ok(plain) = parent.fold(&plain) else {
        return false;
    };
    if plain.report.analysis.moving != folded.report.fold.moving {
        return false;
    }
    let (a, b) = (plain.state.parts(), folded.state.parts());
    assert_eq!(a.vertices, b.vertices, "vertices");
    assert_eq!(a.faces, b.faces, "faces");
    assert_eq!(a.creases.len(), b.creases.len(), "creases");
    for (x, y) in a.creases.iter().zip(&b.creases) {
        assert_eq!((x.id, x.vertices, x.made_at), (y.id, y.vertices, y.made_at));
        assert_eq!(x.kind.is_folded(), y.kind.is_folded(), "crease {}", x.id);
    }
    for face in &a.faces {
        assert_eq!(
            plain.state.isometry(face.id),
            folded.state.isometry(face.id),
            "face {}",
            face.id
        );
    }
    true
}

/// The motion's legs start at the parent and end at the landed state, to
/// the bit for the landed end.
pub fn assert_motion_endpoints(parent: &State, folded: &ReverseFolded) {
    assert_motion(parent, &folded.state, &folded.report.motion);
}

/// A compound step's motion starts at `parent` and ends at `landed`: each
/// group's faces where the parent had them at its first leg's start, and
/// where they land at its last leg's end.
pub fn assert_motion(parent: &State, landed: &State, motion: &StepMotion) {
    let (Some(first), Some(last)) = (motion.legs.first(), motion.legs.last()) else {
        panic!("no legs");
    };
    for (start, end) in first.groups.iter().zip(&last.groups) {
        assert_eq!(start.faces, end.faces);
        for &face in &end.faces {
            let t = landed.isometry(face).unwrap_or_default();
            let lineage = landed
                .face(face)
                .and_then(|f| f.parent)
                .filter(|p| parent.face(*p).is_some())
                .unwrap_or(face);
            let before = parent.isometry(lineage).unwrap_or_default();
            for v in &landed
                .face(face)
                .map(|f| f.ring.clone())
                .unwrap_or_default()
            {
                let sheet = landed.vertices()[v.0 as usize];
                let q = t.apply(sheet);
                let [x, y, z] = end.pose(q, 1.0);
                assert!((x - q[0]).abs() < 1e-9 && (y - q[1]).abs() < 1e-9 && z.abs() < 1e-9);
                let p = before.apply(sheet);
                let [x, y, z] = start.pose(q, 0.0);
                assert!(
                    (x - p[0]).abs() < 1e-9 && (y - p[1]).abs() < 1e-9 && z.abs() < 1e-9,
                    "face {face} does not start where the parent had it"
                );
            }
        }
    }
}

/// Every check above on one landed reverse fold.
pub fn check(parent: &State, op: &ReverseFold, folded: &ReverseFolded) -> [usize; 3] {
    assert_valid(&folded.state);
    assert_motion_endpoints(parent, folded);
    assert_plain_fold_geometry(parent, op, folded);
    assert_letter_rules(parent, folded)
}

/// A reverse fold that must land as it is.
pub fn landed(state: &State, op: &ReverseFold, choices: &ReverseChoices) -> ReverseFolded {
    match state.reverse_fold(op, choices) {
        Ok(ReverseOutcome::Landed(folded)) => *folded,
        Ok(ReverseOutcome::ChooseOpening(a)) => panic!("{op:?}: choose an opening: {a:?}"),
        Ok(ReverseOutcome::ChooseOrder(c)) => panic!("{op:?}: choose an order of {:?}", c.count()),
        Err(e) => panic!("{op:?}: {e} {e:?}"),
    }
}

/// Draw `i` of seed `seed` of the reverse spike's campaign
/// (`campaign-reverse.mjs`): a random state of one to four plain folds of at
/// most 60 faces, then up to six draws of a reverse fold until one has a tip
/// whose every flap opens. Inside; a test asks for the other kind itself.
pub fn reverse_case(seed: u64, i: u64) -> Option<(State, ReverseFold)> {
    let mut rng = Rng::new(seed * 7777 + i);
    let state = random::folded(&mut rng).ok()?;
    if state.faces().len() > 60 {
        return None;
    }
    for _ in 0..6 {
        let Some(op) = random::reverse_fold(&state, &mut rng, 0.2) else {
            continue;
        };
        let Ok(analysis) = state.analyse_reverse(&op) else {
            continue;
        };
        if analysis.flaps.iter().all(|f| !f.openings.is_empty()) {
            return Some((state, op));
        }
    }
    None
}

/// Draw `i` of seed `seed` of the spike's crimp campaign
/// (`campaign-crimp.mjs`): a random state of one to four plain folds of at
/// most 60 faces, then up to eight draws of a crimp (parallel lines a fifth
/// of the time) until one has a tip whose every flap opens at ℓ1. Inside.
pub fn crimp_case(seed: u64, i: u64) -> Option<(State, CrimpFold)> {
    let mut rng = Rng::new(seed * 4243 + i);
    let state = random::folded(&mut rng).ok()?;
    if state.faces().len() > 60 {
        return None;
    }
    for _ in 0..8 {
        let Some(op) = random::crimp_fold(&state, &mut rng, 0.2) else {
            continue;
        };
        let Ok(analysis) = state.analyse_crimp(&op) else {
            continue;
        };
        if analysis.tip.flaps.iter().all(|f| !f.openings.is_empty()) {
            return Some((state, op));
        }
    }
    None
}

/// Each flap's first opening at a crimp's first line, as the spike's
/// campaign takes it.
pub fn crimp_openings(state: &State, op: &CrimpFold) -> Option<ReverseChoices> {
    let analysis = state.analyse_crimp(op).ok()?;
    Some(ReverseChoices {
        openings: analysis
            .tip
            .flaps
            .iter()
            .filter(|f| f.openings.len() > 1)
            .map(|f| f.openings[0].stored.clone())
            .collect(),
        order: None,
    })
}

/// Draw `i` of seed `seed` of the spike's tuck campaign
/// (`campaign-tuck.mjs`): a random state of two to four plain folds of at
/// most 60 faces, then a drawn tuck (`random::tuck_fold`).
pub fn tuck_case(seed: u64, i: u64) -> Option<(State, TuckFold)> {
    let mut rng = Rng::new(seed * 9001 + i);
    let state = random::folded_between(&mut rng, 2, 4).ok()?;
    if state.faces().len() > 60 {
        return None;
    }
    let op = random::tuck_fold(&state, &mut rng)?;
    Some((state, op))
}

/// Every choice of one order per component, given each component's count.
pub fn picks(sizes: &[usize]) -> Vec<Vec<usize>> {
    let mut picks = vec![Vec::new()];
    for &n in sizes {
        picks = picks
            .into_iter()
            .flat_map(|p: Vec<usize>| {
                (0..n).map(move |k| {
                    let mut q = p.clone();
                    q.push(k);
                    q
                })
            })
            .collect();
    }
    picks
}

/// The choices that open the campaign's first flap its `k`-th way: none
/// when it opens only one way.
pub fn first_flap_opened(analysis: &ReverseAnalysis, k: usize) -> Option<ReverseChoices> {
    let first = analysis.flaps.first()?;
    let opening = first.openings.get(k)?;
    Some(ReverseChoices {
        openings: if first.openings.len() > 1 {
            vec![opening.stored.clone()]
        } else {
            Vec::new()
        },
        order: None,
    })
}

//! Sinks through the compound pipeline (plan D4, Phase 11; research §5.4),
//! on the sink spike's named cases (`r2-spike-sinks`, `exp1`–`exp7`, shared
//! with the oracles in [`sinks`]): the preliminary and waterbomb bases
//! imported from the samples Fold ships, sunk open and closed at depths from
//! the tip to past half the point, tilted, precreased and sunk again; each
//! sink exactly one state, its letters and order as the spike derived them;
//! the unsink of each back to the base; the preconditions refused with their
//! fixes; and stored choices replayed or broken.

mod sinks;
mod support;

use oristudio_fold::{
    Broken, CompoundRefused, CreaseKind, Direction, FaceId, Fix, FoldRefusal, LegName, Letter,
    PlainFold, Refused, Seed, SinkChoices, SinkFold, SinkFolded, SinkKind, SinkOutcome, SinkPoint,
    SinkStep, State, StoredPocket, Unsink, WitnessOrder,
};
use oristudio_geometry::Line;
use sinks::*;
use support::{M, assert_valid, face, kind_at, mirrored, precrease, side};

const OPEN: SinkKind = SinkKind::Open;
const CLOSED: SinkKind = SinkKind::Closed;

fn none() -> SinkChoices {
    SinkChoices::default()
}

fn refused(outcome: Result<SinkOutcome, CompoundRefused>, what: &str) -> Refused {
    match outcome {
        Err(CompoundRefused::Refused(refused)) => refused,
        Err(CompoundRefused::Broken(broken)) => panic!("{what}: broken {broken}"),
        Ok(_) => panic!("{what}: landed"),
    }
}

fn analysis(state: &State, op: &SinkFold) -> SinkPoint {
    state
        .analyse_sink(op)
        .unwrap_or_else(|e| panic!("{e} {e:?}"))
}

/// What the step's ring creases are now, and, for each of the parent's
/// creases (the spokes), what it was and what it is now near the centre,
/// inside the point.
struct Creases {
    ring: Vec<CreaseKind>,
    inner: Vec<(CreaseKind, CreaseKind)>,
}

fn creases(parent: &State, folded: &SinkFolded) -> Creases {
    let landed = &folded.state;
    let ring = folded
        .report
        .ring
        .iter()
        .map(|&e| landed.crease(e).map_or(CreaseKind::Border, |c| c.kind))
        .collect();
    let mut inner = Vec::new();
    for crease in parent.creases() {
        if crease.kind == CreaseKind::Border {
            continue;
        }
        let [a, b] = crease.vertices.map(|v| parent.vertices()[v.0 as usize]);
        let (near, far) = if close_to(a, CENTRE, 1e-12) {
            (a, b)
        } else {
            (b, a)
        };
        let p = [
            near[0] + 0.02 * (far[0] - near[0]),
            near[1] + 0.02 * (far[1] - near[1]),
        ];
        inner.push((crease.kind, kind_at(landed, p)));
    }
    Creases { ring, inner }
}

fn other(letter: Letter) -> Letter {
    match letter {
        Letter::Mountain => Letter::Valley,
        Letter::Valley => Letter::Mountain,
    }
}

fn close_to(a: Point, b: Point, tol: f64) -> bool {
    (a[0] - b[0]).abs() < tol && (a[1] - b[1]).abs() < tol
}

/// The landed state is a valid flat folded state; every moved face lands
/// where the plain fold of the whole point puts it (R_ℓ ∘ T, forced); and
/// the report's motion starts at the parent and ends at the landed state.
fn check(parent: &State, folded: &SinkFolded) {
    assert_valid(&folded.state);
    let motion = &folded.report.motion;
    let (Some(first), Some(last)) = (motion.legs.first(), motion.legs.last()) else {
        panic!("no legs");
    };
    assert_eq!((first.name, last.name), (LegName::Spread, LegName::Close));
    let landed = &folded.state;
    for (start, end) in first.groups.iter().zip(&last.groups) {
        assert_eq!(start.faces, end.faces);
        for &face in &end.faces {
            let t = landed.isometry(face).unwrap_or_default();
            let lineage = landed
                .face(face)
                .and_then(|f| parent.face(f.id).map(|_| f.id).or(f.parent))
                .unwrap_or(face);
            let before = parent.isometry(lineage).unwrap_or_default();
            for v in landed
                .face(face)
                .map(|f| f.ring.clone())
                .unwrap_or_default()
            {
                let sheet = landed.vertices()[v.0 as usize];
                let q = t.apply(sheet);
                let p = before.apply(sheet);
                assert!(
                    close_to(q, folded.report.line.reflect_point(p), 1e-9),
                    "face {face} is not reflected across ℓ"
                );
                let [x, y, z] = end.pose(q, 1.0);
                assert!(close_to([x, y], q, 1e-9) && z.abs() < 1e-9);
                let [x, y, z] = start.pose(q, 0.0);
                assert!(
                    close_to([x, y], p, 1e-9) && z.abs() < 1e-9,
                    "face {face} does not start where the parent had it"
                );
            }
        }
    }
}

/// How many of the motion's groups turn up, and how many down.
fn turns(folded: &SinkFolded) -> (usize, usize) {
    let close = folded
        .report
        .motion
        .legs
        .last()
        .map_or(&[][..], |l| &l.groups[..]);
    let up = close.iter().filter(|g| g.to > 0.0).count();
    (up, close.len() - up)
}

/// The faces of `state` stacked at the model-frame point `p`, top first as
/// the spike orders them (seen from T1's front), each named by its triangle
/// and whether it moved (`t`) or stayed (`s`): "s1 t1 t2 s2 …".
fn stack_names(state: &State, p: Point, moved: &[FaceId], front: FaceId) -> String {
    let stack = state
        .stack_at(p)
        .unwrap_or_else(|| panic!("no stack at {p:?}"));
    let name = |f: FaceId| {
        let k = triangle(state.face_witness(f).unwrap_or_default());
        format!("{}{k}", if moved.contains(&f) { "t" } else { "s" })
    };
    let mut names: Vec<String> = stack.into_iter().map(name).collect();
    if state.front_up(front) == Some(false) {
        names.reverse();
    }
    names.join(" ")
}

/// The stack where T`k`'s tip piece lands: the image, once landed, of its
/// sheet point halfway from the centre to ℓ (`f` the sink's depth).
fn landed_stack(folded: &SinkFolded, k: usize, f: f64) -> String {
    let state = &folded.state;
    let q = in_triangle(k, f / 2.0);
    let image = state
        .image_of(q)
        .unwrap_or_else(|| panic!("no face at {q:?}"));
    let moved: Vec<FaceId> = folded
        .report
        .fold
        .blocks
        .iter()
        .flatten()
        .copied()
        .collect();
    let front = face(state, in_triangle(1, (f + 1.0) / 2.0));
    stack_names(state, image, &moved, front)
}

/// The landed state's letters are the open sink's: every ring crease the
/// outline's mountain, every inner folded crease turned, the flat ones flat.
fn assert_open_letters(parent: &State, folded: &SinkFolded, what: &str) {
    let Creases { ring, inner } = creases(parent, folded);
    assert_eq!(ring.len(), 8, "{what}");
    assert!(ring.iter().all(|&k| k == M), "{what}: {ring:?}");
    for (before, now) in inner {
        match before {
            CreaseKind::Folded(l) => assert_eq!(now, CreaseKind::Folded(other(l)), "{what}"),
            flat => assert_eq!(now, flat, "{what}"),
        }
    }
}

// --- 1. The open sink --------------------------------------------------------

/// Spike `exp2`/`exp3`: the open sink of the preliminary base at depths from
/// the tip to just short of half the point lands exactly one state, the
/// spike's completion #6: every ring crease takes the outline's letter (8 of
/// 8 M), every inner folded crease turns and the flat ones stay flat; the
/// left half stacks s1 > t1 > t2 > s2 > s3 > t3 > t4 > s4, the inverted
/// nest. Each of its six layers (the front and back flaps are one each,
/// across their precreases) turns toward its pocket, three up, three down.
#[test]
fn the_preliminary_base_open_sinks_to_one_state() {
    let base = preliminary();
    for f in [0.05, 0.3, 0.49] {
        let what = format!("open f = {f}");
        let op = sink_op(&base, PRELIMINARY_FOOT, f, 0.0, OPEN);
        let point = analysis(&base, &op);
        assert_eq!(point.exterior, Some(Letter::Mountain), "{what}");
        assert!(point.open.is_none(), "{what}: {:?}", point.open);
        assert_eq!(point.outline.len(), 4, "{what}");
        assert!(
            point
                .apex
                .is_some_and(|a| close_to(a, image_at(&base, CENTRE), 1e-9))
        );
        assert!(
            point.square.is_some_and(|l| l.approx_eq(&op.line)),
            "{what}"
        );
        let folded = landed(base.sink(&op, &none()), &what);
        check(&base, &folded);
        assert_eq!(folded.report.step, SinkStep::Open);
        assert_eq!(folded.report.stored, none(), "{what}");
        assert_eq!(folded.state.faces().len(), 16, "{what}");
        assert_open_letters(&base, &folded, &what);
        assert_eq!(
            landed_stack(&folded, 1, f),
            "s1 t1 t2 s2 s3 t3 t4 s4",
            "{what}"
        );
        assert_eq!(turns(&folded), (3, 3), "{what}");
    }
}

/// Spike `exp5` §3: the waterbomb base open-sinks to one state too, its
/// outline the four half-diagonals' mountains.
#[test]
fn the_waterbomb_base_open_sinks_to_one_state() {
    let base = waterbomb();
    for f in [0.2, 0.3, 0.45] {
        let what = format!("waterbomb open f = {f}");
        let op = sink_op(&base, WATERBOMB_FOOT, f, 0.0, OPEN);
        let folded = landed(base.sink(&op, &none()), &what);
        check(&base, &folded);
        assert_open_letters(&base, &folded, &what);
    }
}

// --- 2. The closed sink ------------------------------------------------------

/// Spike `exp2`: the preliminary base has two pockets, behind its front
/// flap and in front of its back flap, and no other (the gap between the
/// side flap's two layers is hinged on the axis, not the outline; the two
/// twisted pockets are not offered). A sink with none stored asks for one.
/// Each lands exactly one state, the spike's #8 and #1: an inside reverse of
/// the whole point — the ring 6 M and 2 V, only the two seams turning, the
/// left half s1 > t1 > t4 > t3 > t2 > s2 > s3 > s4 into the front pocket,
/// the lower block turning up and the upper down.
#[test]
fn the_preliminary_base_closed_sinks_into_its_two_pockets() {
    let base = preliminary();
    for f in [0.05, 0.3, 0.49] {
        let what = format!("closed f = {f}");
        let op = sink_op(&base, PRELIMINARY_FOOT, f, 0.0, CLOSED);
        let point = analysis(&base, &op);
        assert_eq!(point.pockets.len(), 2, "{what}: {:?}", point.pockets);
        assert!(!point.truncated);
        let names = |faces: &[FaceId]| {
            let mut k: Vec<usize> = faces
                .iter()
                .map(|&f| triangle(base.face_witness(f).unwrap_or_default()))
                .collect();
            k.sort_unstable();
            k
        };
        // Fewest lower faces first: the back pocket, then the front.
        assert_eq!(names(&point.pockets[0].lower), vec![4, 5], "{what}");
        assert_eq!(names(&point.pockets[1].upper), vec![1, 8], "{what}");
        assert!(matches!(
            base.sink(&op, &none()),
            Ok(SinkOutcome::ChoosePocket(_))
        ));
        let expected = ["s1 s2 s3 t3 t2 t1 t4 s4", "s1 t1 t4 t3 t2 s2 s3 s4"];
        for (folded, expected) in closed_sinks(&base, &op).iter().zip(expected) {
            check(&base, folded);
            assert_eq!(folded.report.step, SinkStep::Closed);
            assert!(folded.report.stored.pocket.is_some());
            assert_eq!(folded.report.stored.order, None, "{what}: one order");
            let Creases { ring, inner } = creases(&base, folded);
            let mountains = ring.iter().filter(|&&k| k == M).count();
            assert_eq!((ring.len(), mountains), (8, 6), "{what}: {ring:?}");
            let turned = inner.iter().filter(|(before, now)| before != now).count();
            assert_eq!(turned, 2, "{what}: only the seams turn");
            assert_eq!(folded.report.fold.reversed.len(), 2, "{what}");
            assert_eq!(landed_stack(folded, 1, f), expected, "{what}");
            assert_eq!(turns(folded), (1, 1), "{what}");
        }
    }
}

/// Spike `exp5` §3: the waterbomb base's two pockets each take one state.
#[test]
fn the_waterbomb_base_closed_sinks_into_its_two_pockets() {
    let base = waterbomb();
    for f in [0.2, 0.3, 0.45] {
        let op = sink_op(&base, WATERBOMB_FOOT, f, 0.0, CLOSED);
        let sinks = closed_sinks(&base, &op);
        assert_eq!(sinks.len(), 2, "f = {f}");
        for folded in &sinks {
            check(&base, folded);
            let Creases { ring, inner } = creases(&base, folded);
            assert_eq!(ring.iter().filter(|&&k| k == M).count(), 6, "f = {f}");
            assert_eq!(inner.iter().filter(|(b, n)| b != n).count(), 2, "f = {f}");
        }
    }
}

/// A stored pocket replays to its sink; one whose witness lands in no face,
/// or names faces no pocket separates, is broken.
#[test]
fn a_stored_pocket_replays_or_breaks() {
    let base = preliminary();
    let op = sink_op(&base, PRELIMINARY_FOOT, 0.3, 0.0, CLOSED);
    let point = analysis(&base, &op);
    for pocket in &point.pockets {
        let choices = SinkChoices {
            pocket: Some(pocket.stored.clone()),
            order: None,
        };
        let first = landed(base.sink(&op, &choices), "stored");
        assert_eq!(first.report.stored, choices);
        assert_eq!(first.report.pocket.as_ref(), Some(pocket));
        let again = landed(base.sink(&op, &first.report.stored), "replayed");
        assert_eq!(again.state.parts(), first.state.parts());
    }
    let broken = |pocket: StoredPocket| match base.sink(
        &op,
        &SinkChoices {
            pocket: Some(pocket),
            order: None,
        },
    ) {
        Err(CompoundRefused::Broken(broken)) => broken,
        other => panic!("not broken: {:?}", other.map(|_| ())),
    };
    let stored = point.pockets[0].stored.clone();
    assert!(matches!(
        broken(StoredPocket {
            above: [2.0, 2.0],
            ..stored.clone()
        }),
        Broken::Witness { .. }
    ));
    // Both sides of the pocket named by one face: no pocket separates it
    // from itself.
    assert_eq!(
        broken(StoredPocket {
            below: stored.above,
            ..stored
        }),
        Broken::Pocket
    );
}

/// The Paper pane's Front up / Back up replays every step on the sheet
/// started the other side up: each step's direction is the viewer's, so the
/// model-frame stack comes out reversed and the faces above and below each
/// pocket swap. A stored pocket names its gap either way round, and sinks
/// into the mirror image of the pocket chosen.
#[test]
fn a_stored_pocket_survives_starting_the_sheet_the_other_side_up() {
    let (base, turned) = (preliminary(), sample_turned_over("preliminary-base"));
    assert!(mirrored(&base, &turned));
    let op = sink_op(&base, PRELIMINARY_FOOT, 0.3, 0.0, CLOSED);
    let point = analysis(&base, &op);
    assert_eq!(point.pockets.len(), 2);
    for pocket in &point.pockets {
        let choices = SinkChoices {
            pocket: Some(pocket.stored.clone()),
            order: None,
        };
        let there = landed(base.sink(&op, &choices), "front up");
        let mirror = landed(turned.sink(&op, &choices), "back up");
        check(&turned, &mirror);
        assert!(mirrored(&there.state, &mirror.state), "{pocket:?}");
        let Some(sunk) = &mirror.report.pocket else {
            panic!("no pocket");
        };
        assert_eq!((&sunk.upper, &sunk.lower), (&pocket.lower, &pocket.upper));
        // What it stores now names the same gap on either sheet.
        let again = landed(turned.sink(&op, &mirror.report.stored), "replayed");
        assert_eq!(again.state.parts(), mirror.state.parts());
        let back = landed(base.sink(&op, &mirror.report.stored), "turned back");
        assert_eq!(back.state.parts(), there.state.parts());
    }
}

/// A stored order (plan D6) replays as fixed pairs beside the sink's seeds:
/// the landed state's own pairs land it again, and a pair turned the other
/// way breaks the step.
#[test]
fn a_stored_order_replays_or_breaks() {
    let base = preliminary();
    let op = sink_op(&base, PRELIMINARY_FOOT, 0.3, 0.0, OPEN);
    let folded = landed(base.sink(&op, &none()), "open");
    let order = WitnessOrder::of_state(&folded.state).unwrap_or_else(|| unreachable!());
    let stored = SinkChoices {
        pocket: None,
        order: Some(order.clone()),
    };
    let again = landed(base.sink(&op, &stored), "replayed");
    assert_eq!(again.state.parts(), folded.state.parts());
    assert_eq!(again.report.stored, stored);
    let mut turned = order;
    turned.orders[0].2 = -turned.orders[0].2;
    let turned = SinkChoices {
        pocket: None,
        order: Some(turned),
    };
    assert!(matches!(
        base.sink(&op, &turned),
        Err(CompoundRefused::Broken(Broken::Completion { .. }))
    ));
}

// --- 3. The unsink -----------------------------------------------------------

/// Spike `exp5` §1: the unsink of the open sink and of each closed sink, on
/// both bases, lands exactly one state: the base with the ring precreased,
/// remembering the letters the sink gave it. Every inner crease has its
/// letter back and every pair of faces the order their faces had in the
/// base.
#[test]
fn an_unsink_lands_the_base_again() {
    for (name, base, foot) in [
        ("preliminary", preliminary(), PRELIMINARY_FOOT),
        ("waterbomb", waterbomb(), WATERBOMB_FOOT),
    ] {
        let f = 0.3;
        let open = sink_op(&base, foot, f, 0.0, OPEN);
        let mut sunk = vec![landed(base.sink(&open, &none()), "open")];
        sunk.extend(closed_sinks(&base, &open));
        assert_eq!(sunk.len(), 3, "{name}");
        for folded in sunk {
            let what = format!("{name}: unsink of {:?}", folded.report.step);
            let back = landed(folded.state.unsink(&unsink_op(&folded, f), &none()), &what);
            check(&folded.state, &back);
            assert_eq!(back.report.step, SinkStep::Unsink);
            assert_eq!(back.report.stored, none(), "{what}: one order");
            assert_eq!(
                back.report.fold.unfolded.len(),
                8,
                "{what}: the ring lies flat"
            );
            // The ring remembers the sink's letters.
            for &edge in &back.report.ring {
                let was = folded.state.crease(edge).map(|c| c.kind);
                let now = back.state.crease(edge).map(|c| c.kind);
                match (was, now) {
                    (Some(CreaseKind::Folded(l)), Some(CreaseKind::Flat(r))) => {
                        assert_eq!(l, r, "{what}")
                    }
                    other => panic!("{what}: ring crease {edge} {other:?}"),
                }
            }
            // The inner letters back.
            for (before, now) in creases(&base, &back).inner {
                assert_eq!(before, now, "{what}");
            }
            // The base's order, face for face.
            let unsunk = &back.state;
            let parent = |id: FaceId| face(&base, unsunk.face_witness(id).unwrap_or_default());
            for f in unsunk.faces() {
                for g in unsunk.faces() {
                    if let Some(above) = unsunk.above(f.id, g.id) {
                        let (pf, pg) = (parent(f.id), parent(g.id));
                        assert_eq!(base.above(pf, pg), Some(above), "{what}: {} {}", f.id, g.id);
                    }
                }
            }
        }
    }
}

/// What an unsink refuses: a line through a point that is not sunk, and a
/// line no ring lies on.
#[test]
fn an_unsink_refuses_what_is_not_a_sunk_point() {
    let base = preliminary();
    let f = 0.3;
    let sunk = landed(
        base.sink(&sink_op(&base, PRELIMINARY_FOOT, f, 0.0, OPEN), &none()),
        "open",
    );
    // On the unsunk base the point reaches across the line.
    let (line, side) = sink_line(&base, PRELIMINARY_FOOT, f, 0.0);
    let on_base = Unsink {
        line,
        side,
        anchor: Seed::Flaps {
            at: vec![in_triangle(1, f / 2.0)],
        },
    };
    let refusal = refused(base.unsink(&on_base, &none()), "base");
    assert_eq!(refusal.refusal.code(), "unsink_not_sunk");
    assert!(!refusal.refusal.faces().is_empty());
    // Deeper down on the sunk state no ring lies on the line.
    let (deeper, deeper_side) = sink_line(&base, PRELIMINARY_FOOT, 0.8, 0.0);
    let off = Unsink {
        line: deeper,
        side: deeper_side.opposite(),
        anchor: Seed::All,
    };
    assert!(matches!(
        sunk.state.unsink(&off, &none()),
        Err(CompoundRefused::Refused(_))
    ));
}

// --- 4. Depth and tilt -------------------------------------------------------

/// Spike `exp3` (`prelim-sweep.json`, f = 0.5–0.8): depth is no
/// precondition. A deep sink, the tip poking out past the base's foot,
/// lands, open and into either pocket, each the one state its rule gives.
#[test]
fn deep_sinks_land_with_the_tip_poking_out() {
    let base = preliminary();
    for f in [0.5, 0.6, 0.7, 0.8] {
        let what = format!("deep open f = {f}");
        let open = sink_op(&base, PRELIMINARY_FOOT, f, 0.0, OPEN);
        let folded = landed(base.sink(&open, &none()), &what);
        check(&base, &folded);
        assert_open_letters(&base, &folded, &what);
        let closed = closed_sinks(&base, &open);
        assert_eq!(closed.len(), 2, "{what}");
        for folded in &closed {
            check(&base, folded);
        }
    }
}

/// Spike `exp3`: any tilt kills the open sink, from a thousandth of a degree
/// to 44°. The refusal says by how much, and offers the square line at the
/// same depth — along which the open sink lands — and the closed sink, which
/// survives tilt (into either pocket at 1°, 5° and 15°).
#[test]
fn a_tilted_line_kills_the_open_sink_but_not_the_closed() {
    let base = preliminary();
    let (square, square_side) = sink_line(&base, PRELIMINARY_FOOT, 0.3, 0.0);
    for tilt in [0.001, 0.01, 1.0, 5.0, 15.0, 30.0, 44.0] {
        let what = format!("tilt {tilt}");
        let op = sink_op(&base, PRELIMINARY_FOOT, 0.3, tilt, OPEN);
        let refusal = refused(base.sink(&op, &none()), &what);
        assert!(
            matches!(refusal.refusal, FoldRefusal::SinkLineTilted { offset, .. } if offset > 1e-6),
            "{what}: {:?}",
            refusal.refusal
        );
        let Some(Fix::UseLine { line, side }) = refusal.fixes.first() else {
            panic!("{what}: {:?}", refusal.fixes);
        };
        // Square to the axis through where ℓ crossed it: for a tilt about
        // that crossing, the untilted line.
        assert!(line.approx_eq(&square), "{what}: {line:?}");
        assert_eq!(*side, square_side, "{what}");
        let fixed = SinkFold {
            line: *line,
            side: *side,
            ..op.clone()
        };
        check(&base, &landed(base.sink(&fixed, &none()), "square"));
        if (1.0..=15.0).contains(&tilt) {
            assert!(
                refusal.fixes.contains(&Fix::OtherSink { kind: CLOSED }),
                "{what}: {:?}",
                refusal.fixes
            );
            let closed = closed_sinks(&base, &op);
            assert_eq!(closed.len(), 2, "{what}");
            for folded in &closed {
                check(&base, folded);
            }
        }
    }
}

// --- 5. Preconditions --------------------------------------------------------

/// Spike `exp5` §4: the base's open end, its four free corners, is no point:
/// all of it names four flaps, and one of them alone is open — raw edges on
/// its outline at its crown.
#[test]
fn an_open_point_is_refused() {
    let base = preliminary();
    let (a, b) = (image_at(&base, CENTRE), image_at(&base, PRELIMINARY_FOOT));
    let at = [a[0] + 0.8 * (b[0] - a[0]), a[1] + 0.8 * (b[1] - a[1])];
    let n = [b[0] - a[0], b[1] - a[1]];
    let line = Line::new(n, n[0] * at[0] + n[1] * at[1]).unwrap_or_else(|| unreachable!());
    let op = SinkFold {
        line,
        side: side(&line, b),
        anchor: Seed::All,
        kind: OPEN,
    };
    let several = refused(base.sink(&op, &none()), "the open end");
    assert!(
        matches!(
            several.refusal,
            FoldRefusal::SinkSeveralPoints { flaps: 4, .. }
        ),
        "{:?}",
        several.refusal
    );
    let [Fix::PickFlap { flaps }] = several.fixes.as_slice() else {
        panic!("{:?}", several.fixes);
    };
    for kind in [OPEN, CLOSED] {
        let one = SinkFold {
            anchor: Seed::Flaps {
                at: vec![flaps[0].witness],
            },
            kind,
            ..op.clone()
        };
        let refusal = refused(base.sink(&one, &none()), "a corner flap");
        assert_eq!(refusal.refusal.code(), "sink_point_open", "{kind:?}");
        assert!(!refusal.refusal.faces().is_empty());
        assert!(base.analyse_sink(&one).is_err());
    }
}

/// Spike `exp6`/`exp7`: the preliminary base folded in half is a fan point,
/// its eight layers hinged in turn on its two sides. Its outline carries
/// both letters, so it has no open sink — the refusal offers the closed one
/// — and every one of its seven gaps is a pocket, each sinking to one state.
#[test]
fn a_fan_point_has_no_open_sink_and_seven_pockets() {
    let half = fan();
    let op = sink_op(&half, PRELIMINARY_FOOT, 0.3, 0.0, OPEN);
    let refusal = refused(half.sink(&op, &none()), "fan open");
    assert_eq!(refusal.refusal.code(), "sink_outline_mixed");
    assert_eq!(refusal.fixes, vec![Fix::OtherSink { kind: CLOSED }]);
    let point = analysis(&half, &op);
    assert_eq!(point.exterior, None);
    assert!(point.open.is_some());
    assert_eq!(point.pockets.len(), 7, "{:?}", point.pockets);
    let closed = closed_sinks(&half, &op);
    assert_eq!(closed.len(), 7);
    for folded in &closed {
        check(&half, folded);
    }
}

/// A closed sink is an inside reverse fold along every seam, and the line's
/// angle to a reverse fold's spine decides which kind lands (research §5.2:
/// both only square to it). The fan's seams lie on both its sides. Leaning
/// from square to its straight side toward its slanted one, every pocket
/// lands; leaning the other way, along the straight side only the outside
/// reverse would, so no pocket's closed sink has an order.
#[test]
fn a_fan_point_closed_sinks_only_leaning_toward_its_slanted_side() {
    let half = fan();
    for tilt in [-3.0, -20.0, -40.0] {
        let op = sink_op(&half, PRELIMINARY_FOOT, 0.35, tilt, CLOSED);
        let closed = closed_sinks(&half, &op);
        assert_eq!(closed.len(), 7, "tilt {tilt}");
        for folded in &closed {
            check(&half, folded);
        }
    }
    let op = sink_op(&half, PRELIMINARY_FOOT, 0.35, 3.0, CLOSED);
    for pocket in analysis(&half, &op).pockets {
        let choices = SinkChoices {
            pocket: Some(pocket.stored),
            order: None,
        };
        let refusal = refused(half.sink(&op, &choices), "leaning the other way");
        assert_eq!(refusal.refusal.code(), "no_order");
        assert!(!refusal.refusal.faces().is_empty());
    }
}

// --- 6. Precreased rings and second sinks ------------------------------------

/// Whether two states have the same creases and order, faces matched by
/// their witnesses.
fn same_state(a: &State, b: &State) -> bool {
    let face_in = |p: Option<Point>| p.and_then(|p| b.face_at(p));
    a.faces().len() == b.faces().len()
        && a.creases().iter().all(|c| {
            let [p, q] = c.vertices.map(|v| a.vertices()[v.0 as usize]);
            let mid = [(p[0] + q[0]) / 2.0, (p[1] + q[1]) / 2.0];
            c.kind == CreaseKind::Border || b.crease_at(mid).map(|d| d.kind) == Some(c.kind)
        })
        && a.faces().iter().all(|f| {
            let Some(g) = face_in(a.face_witness(f.id)) else {
                return false;
            };
            a.faces().iter().all(|h| {
                let Some(k) = face_in(a.face_witness(h.id)) else {
                    return false;
                };
                a.above(f.id, h.id) == b.above(g, k)
            })
        })
}

/// Spike `exp5` §2: a ring precreased through every layer remembers its
/// letters layer by layer, valley and mountain in turn; the open sink
/// overwrites them all with the outline's mountain, landing the state the
/// sink of the unprecreased base does.
#[test]
fn a_precreased_ring_is_overwritten() {
    let base = preliminary();
    let f = 0.3;
    let (line, tip) = sink_line(&base, PRELIMINARY_FOOT, f, 0.0);
    let precreased = precrease(&base, &PlainFold::new(line, tip, Direction::Valley)).state;
    let remembered: Vec<Letter> = precreased
        .creases()
        .iter()
        .filter(|c| c.made_at == precreased.step())
        .filter_map(|c| match c.kind {
            CreaseKind::Flat(l) => Some(l),
            _ => None,
        })
        .collect();
    assert_eq!(remembered.len(), 8);
    assert!(remembered.contains(&Letter::Valley) && remembered.contains(&Letter::Mountain));
    let op = sink_op(&precreased, PRELIMINARY_FOOT, f, 0.0, OPEN);
    let folded = landed(precreased.sink(&op, &none()), "precreased open");
    check(&precreased, &folded);
    assert_eq!(
        folded.report.fold.created.len(),
        0,
        "the ring is refolded, not made"
    );
    assert_eq!(folded.report.fold.refolded.len(), 8);
    assert!(
        folded
            .report
            .fold
            .refolded
            .iter()
            .all(|r| r.letter == Letter::Mountain)
    );
    let direct = landed(
        base.sink(&sink_op(&base, PRELIMINARY_FOOT, f, 0.0, OPEN), &none()),
        "open",
    );
    assert!(same_state(&folded.state, &direct.state));
    assert!(same_state(&direct.state, &folded.state));
}

/// Spike `exp5` §5: the open-sunk base open-sinks again, deeper, to one
/// state of 32 faces: the sunk point has a flat top, and its two sides
/// still give its axis, meeting where the tip was.
#[test]
fn a_sunk_point_open_sinks_again() {
    let base = preliminary();
    let first = landed(
        base.sink(&sink_op(&base, PRELIMINARY_FOOT, 0.3, 0.0, OPEN), &none()),
        "first",
    );
    let sunk = &first.state;
    // The line from the base's tip: the sunk state's has moved.
    let op = sink_op(&base, PRELIMINARY_FOOT, 0.4, 0.0, OPEN);
    let point = analysis(sunk, &op);
    assert!(point.open.is_none(), "{:?}", point.open);
    assert!(
        point
            .apex
            .is_some_and(|apex| close_to(apex, image_at(&base, CENTRE), 1e-9))
    );
    let second = landed(sunk.sink(&op, &none()), "second");
    check(sunk, &second);
    assert_eq!(second.state.faces().len(), 32);
}

// --- 6. What the tools ask ---------------------------------------------------

/// What an unsink tool finds before the folder names anything: on the side
/// a sink left its tip, the one sunk point there — the faces the sink moved,
/// which an anchor of its witness unsinks; on the base, none on either side,
/// the point still reaching across the line.
#[test]
fn an_unsink_finds_the_one_sunk_point() {
    let base = preliminary();
    let f = 0.3;
    let open = sink_op(&base, PRELIMINARY_FOOT, f, 0.0, OPEN);
    let mut sunk = vec![landed(base.sink(&open, &none()), "open")];
    sunk.extend(closed_sinks(&base, &open));
    for folded in sunk {
        let what = format!("{:?}", folded.report.step);
        let (line, side) = (folded.report.line, folded.report.side.opposite());
        let found = folded
            .state
            .sunk_points(&line, side)
            .unwrap_or_else(|e| panic!("{what}: {e}"));
        let [point] = found.points.as_slice() else {
            panic!("{what}: {:?}", found.points);
        };
        let mut moved: Vec<FaceId> = folded.report.fold.blocks.concat();
        moved.sort_unstable();
        assert_eq!(point.faces, moved, "{what}");
        let op = Unsink {
            line,
            side,
            anchor: Seed::Flaps {
                at: vec![point.witness],
            },
        };
        let tip = folded
            .state
            .analyse_unsink(&op)
            .unwrap_or_else(|e| panic!("{what}: {e}"));
        assert_eq!(tip.faces, moved, "{what}");
        assert_eq!((tip.line, tip.side), (found.line, found.side), "{what}");
        let back = landed(folded.state.unsink(&op, &none()), &what);
        check(&folded.state, &back);
    }
    let (line, side) = sink_line(&base, PRELIMINARY_FOOT, f, 0.0);
    for side in [side, side.opposite()] {
        let found = base
            .sunk_points(&line, side)
            .unwrap_or_else(|e| panic!("{e}"));
        assert!(found.points.is_empty(), "{side:?}: {:?}", found.points);
    }
}

/// A sink's picture, before it lands and once it has: the plain fold's of
/// the whole point, seen as a mountain, with the push onto the tip from
/// beyond it along ℓ's normal. An unsink's is seen as a valley, and is
/// pulled, with no push.
#[test]
fn a_sink_is_pictured_pushed_in_at_its_tip() {
    let base = preliminary();
    let f = 0.3;
    let to_scene = base.view().transform();
    let tip = image_at(&base, CENTRE);
    let model = |p: oristudio_fold::ScenePoint| to_scene.inverse().apply([p.x, p.y]);
    for kind in [OPEN, CLOSED] {
        let op = sink_op(&base, PRELIMINARY_FOOT, f, 0.0, kind);
        let point = analysis(&base, &op);
        let before = base
            .sink_action(&op)
            .unwrap_or_else(|e| panic!("{kind:?}: {e}"));
        assert_eq!(before.direction, Direction::Mountain, "{kind:?}");
        assert!(before.line.is_some(), "{kind:?}");
        assert_eq!(before.moving, point.point.faces, "{kind:?}");
        let Some(push) = before.push else {
            panic!("{kind:?}: no push");
        };
        let (from, toward) = (model(push.at), model(push.toward));
        assert!(close_to(toward, tip, 1e-9), "{kind:?}: {toward:?}");
        let height = |p: Point| match op.side {
            oristudio_fold::Side::Positive => op.line.signed_distance(p),
            oristudio_fold::Side::Negative => -op.line.signed_distance(p),
        };
        assert!(
            height(from) > height(toward) + 1e-3,
            "{kind:?}: from beyond the tip"
        );
        let shaft = [from[0] - toward[0], from[1] - toward[1]];
        let across = shaft[0] * op.line.n[1] - shaft[1] * op.line.n[0];
        assert!(across.abs() < 1e-9, "{kind:?}: along ℓ's normal");
        let folded = match kind {
            OPEN => vec![landed(base.sink(&op, &none()), "open")],
            CLOSED => closed_sinks(&base, &op),
        };
        for folded in folded {
            let after = folded
                .action(&base)
                .unwrap_or_else(|e| panic!("{kind:?}: {e}"));
            assert_eq!(after.direction, Direction::Mountain);
            assert_eq!(
                after.push, before.push,
                "{kind:?}: the push the preview showed"
            );
            assert_eq!(after.moving, before.moving);

            let unsink = Unsink {
                line: folded.report.line,
                side: folded.report.side.opposite(),
                anchor: Seed::Flaps {
                    at: vec![in_triangle(1, f / 2.0)],
                },
            };
            let pulled = folded
                .state
                .unsink_action(&unsink)
                .unwrap_or_else(|e| panic!("{kind:?}: {e}"));
            assert_eq!(pulled.direction, Direction::Valley);
            assert_eq!(pulled.push, None);
            let back = landed(folded.state.unsink(&unsink, &none()), "unsink");
            let landed_picture = back
                .action(&folded.state)
                .unwrap_or_else(|e| panic!("{kind:?}: {e}"));
            assert_eq!(landed_picture.push, None);
            assert_eq!(landed_picture.moving, pulled.moving);
        }
    }
}

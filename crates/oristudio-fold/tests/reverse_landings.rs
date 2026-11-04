//! Which ways a reverse fold's tip lands, and a crimp's at its first line,
//! before an opening is chosen (`State::reverse_landings`,
//! `State::crimp_landings`): every way's kinds as folding it says, the
//! budget leaving ways undecided, and the flaps a tip cannot be folded
//! without.

mod compound;
mod support;

use oristudio_fold::complete::Deadline;
use oristudio_fold::{
    CompletionLimits, CrimpFold, Direction, ReverseChoices, ReverseFold, ReverseKind,
    ReverseLandings, Seed, Sheet, StartSide, State, StoredOpening, TipFlap,
};
use oristudio_geometry::Line;
use support::*;

const INSIDE: ReverseKind = ReverseKind::Inside;
const OUTSIDE: ReverseKind = ReverseKind::Outside;

fn square() -> State {
    State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"))
}

/// The square book-folded `n` times, each fold halving the strip from the
/// right: `2^n` layers over [0, 2^-n] × [0, 1].
fn books(n: i32) -> State {
    let mut paper = square();
    for k in 1..=n {
        let width = 0.5f64.powi(k);
        paper = fold(
            &paper,
            &all(x_eq(width), [width + 0.01, 0.5], Direction::Valley),
        )
        .state;
    }
    paper
}

fn reverse(line: Line, toward: Point, anchor: Seed) -> ReverseFold {
    ReverseFold {
        line,
        side: side(&line, toward),
        anchor,
        kind: INSIDE,
    }
}

fn unlimited() -> ReverseLandings {
    ReverseLandings::default()
}

/// What a step stores for a way: each choosing flap's opening at its index.
fn stored(flaps: &[TipFlap], way: &[usize]) -> Vec<StoredOpening> {
    flaps
        .iter()
        .filter(|f| f.openings.len() > 1)
        .zip(way)
        .map(|(f, &j)| f.openings[j].stored.clone())
        .collect()
}

/// The kinds a way's landings say land, as `reverse_kinds` lists them.
fn kinds_of(inside: Option<bool>, outside: Option<bool>) -> Vec<ReverseKind> {
    [(INSIDE, inside), (OUTSIDE, outside)]
        .into_iter()
        .filter(|(_, lands)| *lands == Some(true))
        .map(|(kind, _)| kind)
        .collect()
}

/// A deadline that has already passed.
fn passed() -> CompletionLimits {
    CompletionLimits {
        deadline: Some(Deadline {
            now_ms: || 1.0,
            at_ms: 0.0,
        }),
        ..CompletionLimits::default()
    }
}

/// Eight layers of book folds open three ways, fewest lower faces first: a
/// line square across the spine lands both kinds at every one; a slanted one
/// lands one kind, the same one at every opening, as folding each says.
#[test]
fn every_way_of_a_book_folded_strip_lands_as_folding_it_says() {
    let paper = books(3);
    let w = 0.125;
    for (line, kinds) in [
        (y_eq(0.5), vec![INSIDE, OUTSIDE]),
        (through([0.0, 0.4], [w, 0.6]), vec![INSIDE]),
        (through([0.0, 0.6], [w, 0.4]), vec![OUTSIDE]),
    ] {
        let op = reverse(line, [w / 2.0, 0.1], Seed::All);
        let analysis = paper.analyse_reverse(&op).unwrap_or_else(|e| panic!("{e}"));
        let [flap] = analysis.flaps.as_slice() else {
            panic!("{analysis:?}");
        };
        let splits: Vec<_> = flap
            .openings
            .iter()
            .map(|o| (o.lower.len(), o.upper.len()))
            .collect();
        assert_eq!(splits, [(1, 7), (2, 6), (4, 4)]);
        let landings = paper
            .reverse_landings(&op, &CompletionLimits::default())
            .unwrap_or_else(|e| panic!("{e}"));
        assert!(!landings.more);
        assert!(landings.locked.is_empty(), "one flap locks nothing");
        let ways: Vec<_> = landings.ways.iter().map(|w| w.openings.clone()).collect();
        assert_eq!(ways, [vec![0], vec![1], vec![2]], "in the openings' order");
        for way in &landings.ways {
            assert_eq!(kinds_of(way.inside, way.outside), kinds, "{way:?}");
            let choices = ReverseChoices {
                openings: stored(&analysis.flaps, &way.openings),
                order: None,
            };
            assert_eq!(
                paper.reverse_kinds(&op, &choices).unwrap_or_default(),
                kinds
            );
        }
    }
}

/// The reverse spike's seeded campaign: on every tip with a flap that opens
/// several ways, every way is decided under the default limits, and lands
/// exactly the kinds folding it with that opening lands. Some tips land
/// different kinds at different openings, or none at some: what the tools
/// filter by.
#[test]
fn the_campaign_lands_every_way_as_its_kinds_say() {
    let (mut tips, mut mixed, mut neither) = (0, 0, 0);
    for seed in 1..=8 {
        for i in 0..24 {
            let Some((state, op)) = compound::reverse_case(seed, i) else {
                continue;
            };
            let analysis = state.analyse_reverse(&op).unwrap_or_else(|e| panic!("{e}"));
            if !analysis.flaps.iter().any(|f| f.openings.len() > 1) {
                continue;
            }
            let Ok(landings) = state.reverse_landings(&op, &CompletionLimits::default()) else {
                continue;
            };
            tips += 1;
            let product: usize = analysis
                .flaps
                .iter()
                .map(|f| f.openings.len().max(1))
                .product();
            assert_eq!(landings.ways.len(), product.min(oristudio_fold::MAX_WAYS));
            assert_eq!(landings.more, product > oristudio_fold::MAX_WAYS);
            let mut seen = Vec::new();
            for way in &landings.ways {
                assert!(way.inside.is_some() && way.outside.is_some(), "s{seed}-{i}");
                let choices = ReverseChoices {
                    openings: stored(&analysis.flaps, &way.openings),
                    order: None,
                };
                let kinds = state.reverse_kinds(&op, &choices).unwrap_or_default();
                assert_eq!(
                    kinds_of(way.inside, way.outside),
                    kinds,
                    "s{seed}-{i} {way:?}"
                );
                seen.push(kinds);
            }
            mixed += usize::from(seen.iter().any(|k| *k != seen[0]));
            neither += usize::from(seen.iter().any(Vec::is_empty));
        }
    }
    assert!(tips >= 10, "{tips} tips with a choice of opening");
    assert!(
        mixed > 0 && neither > 0,
        "{mixed} mixed, {neither} with a way that lands neither"
    );
}

/// A deadline that has passed decides nothing: every way undecided, and
/// nothing locked.
#[test]
fn ways_the_budget_leaves_are_undecided() {
    let paper = books(3);
    let op = reverse(through([0.0, 0.4], [0.125, 0.6]), [0.06, 0.1], Seed::All);
    let landings = paper
        .reverse_landings(&op, &passed())
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(landings.ways.len(), 3);
    assert!(
        landings
            .ways
            .iter()
            .all(|w| w.inside.is_none() && w.outside.is_none())
    );
    assert!(landings.locked.is_empty());
}

/// A tip whose flaps open one way each lists no ways; one flap locks
/// nothing either.
#[test]
fn a_tip_that_opens_one_way_lists_none() {
    let triangle = fold(
        &square(),
        &all(
            through([1.0, 0.0], [0.0, 1.0]),
            [0.0, 0.0],
            Direction::Valley,
        ),
    )
    .state;
    let line =
        Line::from_point_direction([0.75, 0.25], [1.0, 1.0]).unwrap_or_else(|| unreachable!());
    let op = reverse(line, [0.95, 0.1], Seed::All);
    let landings = triangle
        .reverse_landings(&op, &CompletionLimits::default())
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(landings, unlimited());
}

/// Two two-layer flaps stacked over a corner each reverse into their own
/// pocket, and each alone does too: neither is locked.
#[test]
fn stacked_flaps_that_reverse_alone_are_not_locked() {
    let triangle = fold(
        &square(),
        &all(
            through([1.0, 0.0], [0.0, 1.0]),
            [0.0, 0.0],
            Direction::Valley,
        ),
    )
    .state;
    let tri4 = fold(
        &triangle,
        &all(
            through([0.0, 0.0], [1.0, 1.0]),
            [0.4, 0.9],
            Direction::Valley,
        ),
    )
    .state;
    let line =
        Line::from_point_direction([0.75, 0.25], [1.0, 1.0]).unwrap_or_else(|| unreachable!());
    let op = reverse(line, [0.95, 0.1], Seed::All);
    let analysis = tri4.analyse_reverse(&op).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(analysis.flaps.len(), 2);
    let landings = tri4
        .reverse_landings(&op, &CompletionLimits::default())
        .unwrap_or_else(|e| panic!("{e}"));
    assert!(landings.ways.is_empty());
    assert!(landings.locked.is_empty(), "{landings:?}");
    // As a folder unpicking either flap folds it.
    for flap in &analysis.flaps {
        let alone = ReverseFold {
            anchor: Seed::Flaps {
                at: vec![flap.flap.witness],
            },
            ..op.clone()
        };
        assert!(
            !tri4
                .reverse_kinds(&alone, &ReverseChoices::default())
                .unwrap_or_default()
                .is_empty()
        );
    }
}

/// A corner of eight plies, two halves of a fold in half each closed by two
/// wraps nested on it (`reverse_multi_ply.rs`): its two flaps interleave in
/// both halves, and reverse only together, as one packet per half. Both are
/// locked: without either, no way of opening the other lands.
#[test]
fn the_interleaved_corner_locks_both_flaps() {
    let mut corner = square();
    for (line, toward) in [
        (y_eq(0.5), [0.5, 0.25]),
        (y_eq(0.75), [0.5, 0.9]),
        (x_eq(0.5), [0.25, 0.6]),
    ] {
        corner = fold(&corner, &all(line, toward, Direction::Valley)).state;
    }
    let op = reverse(through([0.5, 0.65], [0.6, 0.75]), [0.51, 0.74], Seed::All);
    let analysis = corner
        .analyse_reverse(&op)
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(analysis.flaps.len(), 2);
    let landings = corner
        .reverse_landings(&op, &CompletionLimits::default())
        .unwrap_or_else(|e| panic!("{e}"));
    assert!(landings.ways.is_empty(), "each flap opens one way");
    let mut flaps: Vec<usize> = analysis.flaps.iter().map(|f| f.index).collect();
    flaps.sort_unstable();
    assert_eq!(landings.locked, flaps);
    for flap in &analysis.flaps {
        let alone = ReverseFold {
            anchor: Seed::Flaps {
                at: vec![flap.flap.witness],
            },
            ..op.clone()
        };
        let lands = match corner.analyse_reverse(&alone) {
            Ok(_) => !corner
                .reverse_kinds(&alone, &ReverseChoices::default())
                .unwrap_or_default()
                .is_empty(),
            Err(_) => false,
        };
        assert!(!lands, "flap {} lands alone", flap.index);
    }
    // Under a deadline already passed, nothing is decided: nothing locked.
    let landings = corner
        .reverse_landings(&op, &passed())
        .unwrap_or_else(|e| panic!("{e}"));
    assert!(landings.locked.is_empty());
}

/// A crimp's tip at ℓ1 lands each way as crimping it with that opening
/// says: on the four-layer strip, both openings of both kinds.
#[test]
fn a_crimp_lands_each_way_as_crimping_it_says() {
    let strip = books(2);
    let op = CrimpFold {
        first: y_eq(0.5),
        second: y_eq(0.3),
        side: side(&y_eq(0.5), [0.1, 0.2]),
        anchor: Seed::All,
        kind: INSIDE,
    };
    let analysis = strip.analyse_crimp(&op).unwrap_or_else(|e| panic!("{e}"));
    let landings = strip
        .crimp_landings(&op, &CompletionLimits::default())
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(landings.ways.len(), 2);
    for way in &landings.ways {
        let choices = ReverseChoices {
            openings: stored(&analysis.tip.flaps, &way.openings),
            order: None,
        };
        assert_eq!(
            kinds_of(way.inside, way.outside),
            strip.crimp_kinds(&op, &choices).unwrap_or_default(),
            "{way:?}"
        );
    }
    let mut decided = 0;
    for seed in 1..=8 {
        for i in 0..24 {
            let Some((state, op)) = compound::crimp_case(seed, i) else {
                continue;
            };
            let Ok(analysis) = state.analyse_crimp(&op) else {
                continue;
            };
            let Ok(landings) = state.crimp_landings(&op, &CompletionLimits::default()) else {
                continue;
            };
            for way in &landings.ways {
                let choices = ReverseChoices {
                    openings: stored(&analysis.tip.flaps, &way.openings),
                    order: None,
                };
                let kinds = state.crimp_kinds(&op, &choices).unwrap_or_default();
                assert_eq!(
                    kinds_of(way.inside, way.outside),
                    kinds,
                    "s{seed}-{i} {way:?}"
                );
                decided += 1;
            }
        }
    }
    assert!(decided > 0);
}

//! Other ways to fold a step: constructions of the same crease, from the
//! paper as it stands when the step is reached, that leave the paper as the
//! plan has it — so the reader can take one in place of the pick and nothing
//! else in the sequence changes (`implementation-plans/references-step-ways.md`).
//!
//! Read off the physical replay ([`crate::quality::replay`]) rather than the
//! ordering pass's own paper: a way names only marks the steps before it
//! really left, and vouches for every pinch the pick vouched for, so the
//! paper after the step — and so every later step — is the plan's.

use std::cmp::Ordering;

use super::*;
use crate::direction::Direction;
use crate::judge::MAX_PINCH_ERROR;
use crate::pinch::{Extent, PinchVerdict};
use crate::quality::{self, ReplayAt};
use crate::sequence::{Criterion, Way, witness_is_exact};

/// At most this many ways on a card, the presented one included: a
/// different motion each, not the same motion with other marks.
pub const MAX_WAYS: usize = 4;

/// What kind of fold `w` is: its axiom and the kinds of reference it lines
/// up — `e` edge, `c` corner, `l` crease, `p` mark — with interchangeable
/// inputs in a fixed order, so `O2:cp` is a corner onto a mark either way
/// round. A card keeps one way of each kind, and the analytics name a fold
/// by it.
pub fn kind(w: &Witness) -> String {
    let mut codes: Vec<char> = w.inputs.iter().map(Ref::kind_code).collect();
    if (1..=3).contains(&w.axiom) {
        codes.sort_unstable();
    } else if let [p1, m1, p2, m2] = codes[..]
        && w.axiom == 6
        && (p2, m2) < (p1, m1)
    {
        codes = vec![p2, m2, p1, m1];
    }
    format!("O{}:{}", w.axiom, codes.into_iter().collect::<String>())
}

/// The ways of every placed entry, parallel to `placed`: the presented
/// witness first, then the best of each other kind — or none for a press, a
/// fold with nothing presented, and a fold with no second way. A twin
/// pair's two lists are index-aligned mirrors, switched together.
/// `verdicts` is the pinch pass over `placed`.
pub fn of(closure: &Closure, placed: &[Placed], verdicts: &[PinchVerdict]) -> Vec<Vec<Way>> {
    let state = closure.state();
    let folded = closure.folded();
    // The fold each press shows, when it shows its fold's witness: a way of
    // the fold is a way of the press, and has to vouch for its pinch too.
    let shows: Vec<Option<usize>> = placed
        .iter()
        .enumerate()
        .map(|(k, p)| {
            if p.press.is_none() || p.chosen.is_some() {
                return None;
            }
            placed[..k]
                .iter()
                .position(|q| q.folded == p.folded && q.press.is_none())
        })
        .collect();
    let mut snapshots: Vec<Option<Snapshot>> = placed.iter().map(|_| None).collect();
    quality::replay(closure, placed, |k, at| {
        let p = &placed[k];
        let shown = p.press.is_none() && p.presented(&folded[p.folded]).is_some();
        if shown || shows[k].is_some() {
            snapshots[k] = Some(Snapshot::of(at));
        }
    });
    let aux = AuxPinches::of(closure, placed, verdicts);
    let offers: Vec<Option<Offer>> = (0..placed.len())
        .map(|k| {
            if placed[k].press.is_some() {
                return None;
            }
            let own = snapshots[k].as_ref()?;
            let sighted = sighting(placed, &snapshots, k)?;
            offer(
                closure, placed, verdicts, &aux, &shows, &snapshots, k, sighted, own,
            )
        })
        .collect();

    let mut ways: Vec<Vec<Way>> = placed.iter().map(|_| Vec::new()).collect();
    for k in 0..placed.len() {
        let (Some(first), Some(sighted)) = (&offers[k], sighting(placed, &snapshots, k)) else {
            continue;
        };
        if placed[k].twin_of.is_some() {
            continue;
        }
        let twin = placed
            .get(k + 1)
            .is_some_and(|q| q.twin_of == Some(placed[k].folded))
            .then_some(k + 1);
        match twin {
            None => {
                let kept = one_of_each_kind(first, 0..first.order.len());
                let also = |w: &Witness| {
                    mirror_witness(state, &sighted.paper, &first.fold, w, &first.pool)
                        .filter(|m| aux.keeps(state, k, m))
                };
                ways[k] = describe(state, &placed[k], &sighted.paper, first, &kept, also);
            }
            Some(t) => {
                let Some(second) = &offers[t] else {
                    continue;
                };
                let pairs = paired(state, first, second);
                let kept = one_of_each_kind(first, pairs.iter().map(|&(i, _)| i));
                let mirrored: Vec<usize> = kept
                    .iter()
                    .filter_map(|i| pairs.iter().find(|(a, _)| a == i).map(|&(_, b)| b))
                    .collect();
                // A twin card shows no mirror alignment beside a way, as it
                // shows none beside the pick: the twin is the mirror.
                let none = |_: &Witness| None;
                ways[k] = describe(state, &placed[k], &sighted.paper, first, &kept, none);
                ways[t] = describe(state, &placed[t], &sighted.paper, second, &mirrored, none);
            }
        }
    }
    ways
}

/// The paper a replayed entry was reached with, kept for the second pass.
struct Snapshot {
    paper: Creased,
    direction: Vec<Option<Direction>>,
    exact_lines: Vec<bool>,
}

impl Snapshot {
    fn of(at: &ReplayAt) -> Self {
        Self {
            paper: at.paper.clone(),
            direction: at.direction.to_vec(),
            exact_lines: at.exact_lines.to_vec(),
        }
    }
}

/// What the auxiliary pinch pass creases of each auxiliary line
/// (`pinch::placed_pinch_pass`), by line id, with where the line was folded.
///
/// The pass creases an auxiliary line whole when a later step lines it up
/// as a line, and pinches it at each mark a later step names on it. A way
/// that asked more of an earlier auxiliary line than the plan's steps do
/// would crease more of that fold than its card says; so it may name a mark
/// on one only where the line is pinched or whole already, and line one up
/// only where it is whole.
struct AuxPinches<'a> {
    by_line: std::collections::HashMap<usize, (usize, &'a PinchVerdict)>,
}

impl<'a> AuxPinches<'a> {
    fn of(closure: &Closure, placed: &[Placed], verdicts: &'a [PinchVerdict]) -> Self {
        let by_line = placed
            .iter()
            .enumerate()
            .filter(|(_, p)| p.press.is_none())
            .filter_map(|(j, p)| {
                let f = &closure.folded()[p.folded];
                matches!(f.tag, LineTag::Aux | LineTag::RfAux)
                    .then_some((f.line_id, (j, &verdicts[j])))
            })
            .collect();
        Self { by_line }
    }

    /// Whether `w`, made at placed entry `k`, leaves the pass as it is.
    fn keeps(&self, state: &State, k: usize, w: &Witness) -> bool {
        let earlier = |line: usize| {
            self.by_line
                .get(&line)
                .filter(|(j, _)| *j < k)
                .map(|(_, v)| *v)
        };
        w.inputs.iter().all(|r| {
            if r.is_line() {
                earlier(r.id()).is_none_or(|v| matches!(v.extent, Extent::Full))
            } else {
                state.points()[r.id()].lines.iter().all(|&line| {
                    earlier(line)
                        .is_none_or(|v| v.used_as_line || v.used_at_points.contains(&r.id()))
                })
            }
        })
    }
}

/// The paper entry `k` is sighted on: its own, or for the second of a twin
/// pair the first's — the two are made at once, as the ordering pass sights
/// them.
fn sighting<'a>(
    placed: &[Placed],
    snapshots: &'a [Option<Snapshot>],
    k: usize,
) -> Option<&'a Snapshot> {
    if placed[k].twin_of.is_some() && k > 0 {
        snapshots[k - 1].as_ref()
    } else {
        snapshots[k].as_ref()
    }
}

/// Everything a fold's paper offers that may stand in for its pick.
struct Offer {
    fold: Line,
    pool: Vec<Witness>,
    /// Indices into `pool`: the pick first, then every other witness that
    /// qualifies, best first by the card key.
    order: Vec<usize>,
    /// Parallel to `order`.
    keys: Vec<CardKey>,
    errors: Vec<Option<f64>>,
}

/// How a fold's alignment covers a pinch made while it is made (R10), as
/// the replay counts it.
#[derive(Clone, Copy, PartialEq, Eq)]
enum PinchClass {
    Within,
    Beyond,
    Unknown,
}

impl PinchClass {
    fn of(error: Option<f64>) -> Self {
        match error {
            Some(e) if e > MAX_PINCH_ERROR => Self::Beyond,
            Some(_) => Self::Within,
            None => Self::Unknown,
        }
    }
}

/// What placed fold `k` could be made with instead of its pick, on the paper
/// `sighted`: every witness that is free and practical there, as exact as
/// the pick, leaves the crease as it is and the auxiliary pinches as they
/// are, and vouches for every pinch the pick vouched for — each on the paper
/// the replay checks it on, `own` for the pinches made while this fold is
/// and each press's own for the presses that show this fold's witness.
/// `None` when the pick itself is not a fold on that paper.
#[allow(clippy::too_many_arguments)]
fn offer(
    closure: &Closure,
    placed: &[Placed],
    verdicts: &[PinchVerdict],
    aux: &AuxPinches,
    shows: &[Option<usize>],
    snapshots: &[Option<Snapshot>],
    k: usize,
    sighted: &Snapshot,
    own: &Snapshot,
) -> Option<Offer> {
    let state = closure.state();
    let p = &placed[k];
    let f = &closure.folded()[p.folded];
    let pick = p.presented(f)?;
    let fold = f.constructed();
    let spans = f
        .target
        .map_or(&[][..], |t| closure.targets()[t].spans.as_slice());
    let made = made_by(state, p, &f.line, spans, &verdicts[k]);
    let direction_of_line = |id: usize| sighted.direction.get(id).copied().flatten();
    let mut pool = candidates(state, &sighted.paper, &fold, f.line_id, &made, &f.witnesses);
    let pick_at = match pool.iter().position(|w| same(w, pick)) {
        Some(i) => i,
        None => {
            pool.push(pick.clone());
            pool.len() - 1
        }
    };
    // Judged as the pick judges ([`score_witnesses`]), but only once the
    // cheap tests pass: a way is free, so no press is ever priced for one.
    let direction = p.side.direction();
    let judged = |index: usize, cost: usize| {
        let judgement = judge(
            state,
            &sighted.paper,
            &fold,
            &made,
            spans,
            direction,
            &direction_of_line,
            &pool[index],
        );
        Scored {
            index,
            cost,
            one_motion: judgement.one_motion,
            judgement,
        }
    };
    let pick_scored = judged(pick_at, witness_cost(state, &sighted.paper, &fold, pick)?);
    let vouched: Vec<(&Creased, [[f64; 2]; 2])> = p
        .pressed_on
        .iter()
        .map(|&span| (&own.paper, span))
        .chain(
            shows
                .iter()
                .enumerate()
                .filter(|&(_, shown)| *shown == Some(k))
                .filter_map(|(q, _)| {
                    Some((
                        &snapshots[q].as_ref()?.paper,
                        placed[q].press.as_ref()?.span,
                    ))
                }),
        )
        .collect();
    let pinch = |w: &Witness, paper: &Creased, span: [[f64; 2]; 2]| {
        PinchClass::of(Vouch::of(state, paper, &fold, w).error_at(span))
    };
    let pick_pinches: Vec<PinchClass> = vouched
        .iter()
        .map(|&(paper, span)| pinch(pick, paper, span))
        .collect();
    let exact = witness_is_exact(state, &sighted.exact_lines, pick);
    let mut rest: Vec<Scored> = (0..pool.len())
        .filter(|&i| {
            let w = &pool[i];
            i != pick_at
                && witness_is_exact(state, &sighted.exact_lines, w) == exact
                && marks_within(state, &f.line, &made, w)
                && aux.keeps(state, k, w)
                && sightable(state, &sighted.paper, &fold, w)
                && vouched
                    .iter()
                    .zip(&pick_pinches)
                    .all(|(&(paper, span), was)| {
                        let now = pinch(w, paper, span);
                        now == PinchClass::Within || now == *was
                    })
        })
        .map(|i| judged(i, 0))
        .filter(|s| s.judgement.practical)
        .collect();
    let key = |s: &Scored| card_key(state, &fold, spans, &pool[s.index], s);
    rest.sort_by_key(|s| (key(s), s.index));
    let entries: Vec<&Scored> = std::iter::once(&pick_scored).chain(&rest).collect();
    let order = entries.iter().map(|s| s.index).collect();
    let keys = entries.iter().map(|s| key(s)).collect();
    let errors = entries.iter().map(|s| s.judgement.error).collect();
    Some(Offer {
        fold,
        pool,
        order,
        keys,
        errors,
    })
}

/// The crease placed entry `p` leaves on its line, as the replay records it:
/// the auxiliary pinch pass's pinches, else the crease the plan made, else
/// the pattern's own, else the whole chord.
fn made_by(
    state: &State,
    p: &Placed,
    line: &Line,
    spans: &[[[f64; 2]; 2]],
    verdict: &PinchVerdict,
) -> Vec<[[f64; 2]; 2]> {
    match &verdict.extent {
        Extent::Pinches { spans: pinches } => pinches.clone(),
        Extent::Full if !p.made.is_empty() => p.made.clone(),
        Extent::Full if !spans.is_empty() => spans.to_vec(),
        Extent::Full => state
            .sheet()
            .clip(line)
            .map(|(a, b)| vec![[a, b]])
            .unwrap_or_default(),
    }
}

/// Whether `w` leaves the crease `made` as it is. A fold through two marks
/// is creased from one to the other (`through_marks`), so both have to be
/// on it already; any other fold is creased where the plan creases it.
fn marks_within(state: &State, line: &Line, made: &[[[f64; 2]; 2]], w: &Witness) -> bool {
    w.axiom != 1
        || w.inputs
            .iter()
            .filter(|r| r.is_point())
            .all(|r| crate::marks::runs_reach(line, made, state.point(r.id())))
}

fn same(a: &Witness, b: &Witness) -> bool {
    a.axiom == b.axiom && a.inputs == b.inputs && a.root == b.root
}

/// The ways of a twin pair, as positions in each fold's offer: the picks,
/// then each way of the first whose mirror image under the pair's symmetry
/// is a way of the second, of a kind a card holds at once ([`one_card`]).
fn paired(state: &State, first: &Offer, second: &Offer) -> Vec<(usize, usize)> {
    let (pick_first, pick_second) = (&first.pool[first.order[0]], &second.pool[second.order[0]]);
    let Some(sym) = Symmetry::of(state.sheet())
        .into_iter()
        .find(|s| s.maps_witness(state, pick_first, pick_second))
    else {
        return Vec::new();
    };
    let mut pairs = vec![(0, 0)];
    for (i, &a) in first.order.iter().enumerate().skip(1) {
        let w = &first.pool[a];
        if !one_card(w) {
            continue;
        }
        if let Some(j) = second
            .order
            .iter()
            .skip(1)
            .position(|&b| sym.maps_witness(state, w, &second.pool[b]))
        {
            pairs.push((i, j + 1));
        }
    }
    pairs
}

/// Positions in `offer.order` of the ways a card offers, out of `positions`:
/// the first of each kind, at most [`MAX_WAYS`] in all.
fn one_of_each_kind(offer: &Offer, positions: impl Iterator<Item = usize>) -> Vec<usize> {
    let mut kinds: Vec<String> = Vec::new();
    let mut kept = Vec::new();
    for i in positions {
        let k = kind(&offer.pool[offer.order[i]]);
        if kinds.contains(&k) {
            continue;
        }
        kinds.push(k);
        kept.push(i);
        if kept.len() == MAX_WAYS {
            break;
        }
    }
    kept
}

/// The ways at `kept` (positions in `offer.order`, the pick first) as the
/// card presents them, or none when there is only the pick. The pick keeps
/// the alignment and the mirror alignment the plan gave it; every other way
/// gets its own alignment, and `also` for its mirror.
fn describe(
    state: &State,
    p: &Placed,
    paper: &Creased,
    offer: &Offer,
    kept: &[usize],
    also: impl Fn(&Witness) -> Option<Witness>,
) -> Vec<Way> {
    if kept.len() < 2 {
        return Vec::new();
    }
    kept.iter()
        .map(|&i| {
            let w = &offer.pool[offer.order[i]];
            let (also, alignment) = if i == 0 {
                (p.also.clone(), p.alignment)
            } else {
                (also(w), witness_alignment(state, paper, &offer.fold, w))
            };
            Way {
                witness: w.clone(),
                also,
                alignment,
                kind: kind(w),
                decided_by: (i > 0).then(|| {
                    decided_by(
                        &offer.keys[0],
                        offer.errors[0],
                        &offer.keys[i],
                        offer.errors[i],
                    )
                }),
            }
        })
        .collect()
}

/// The criterion the pick won on against `way`: the first of the card key
/// on which the way ranks below it. Where the key prefers the way, the pick
/// was chosen against the key — by the three-times-as-accurate override
/// ([`Criterion::Accuracy`]), or for the plan as a whole ([`Criterion::Plan`]).
fn decided_by(
    pick: &CardKey,
    pick_error: Option<f64>,
    way: &CardKey,
    way_error: Option<f64>,
) -> Criterion {
    let criteria: [(u64, u64, Criterion); 16] = [
        (
            pick.impractical.into(),
            way.impractical.into(),
            Criterion::Plan,
        ),
        (
            pick.press_tier as u64,
            way.press_tier as u64,
            Criterion::Visible,
        ),
        (
            pick.not_corner_to_corner.into(),
            way.not_corner_to_corner.into(),
            Criterion::CornerToCorner,
        ),
        (
            pick.overlong.into(),
            way.overlong.into(),
            Criterion::Overlong,
        ),
        (pick.hidden.into(), way.hidden.into(), Criterion::Visible),
        (
            pick.imprecise.into(),
            way.imprecise.into(),
            Criterion::Precise,
        ),
        (
            pick.not_local.into(),
            way.not_local.into(),
            Criterion::Local,
        ),
        (
            pick.no_crossing.into(),
            way.no_crossing.into(),
            Criterion::Crossing,
        ),
        (
            pick.marks_unreal.into(),
            way.marks_unreal.into(),
            Criterion::Plan,
        ),
        (
            pick.two_hands.into(),
            way.two_hands.into(),
            Criterion::OneMotion,
        ),
        (pick.ease.into(), way.ease.into(), Criterion::Ease),
        (pick.skinny.into(), way.skinny.into(), Criterion::ThinFlap),
        (pick.error, way.error, Criterion::Accuracy),
        (pick.mark_offset, way.mark_offset, Criterion::Accuracy),
        (pick.residual, way.residual, Criterion::Accuracy),
        (pick.edge_gap, way.edge_gap, Criterion::Accuracy),
    ];
    for (p, w, criterion) in criteria {
        match w.cmp(&p) {
            Ordering::Greater => return criterion,
            Ordering::Less => {
                let accurate = pick_error
                    .zip(way_error)
                    .is_some_and(|(pe, we)| pe <= we / MAX_ERROR);
                return if accurate {
                    Criterion::Accuracy
                } else {
                    Criterion::Plan
                };
            }
            Ordering::Equal => {}
        }
    }
    Criterion::Plan
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::{Deadline, frozen_clock};
    use crate::closure::Target;
    use crate::sheet::Sheet;
    use crate::state::DEFAULT_POINT_CAP;

    fn plan(targets: Vec<Target>) -> (Closure, Vec<Placed>) {
        let mut c = Closure::new(Sheet::unit_square(), targets, DEFAULT_POINT_CAP);
        c.close(&Deadline::unbounded(frozen_clock())).unwrap();
        let placed = order_with(&c, false, true);
        (c, placed)
    }

    /// A valley the whole way across the unit square.
    fn whole(line: Line, id: u32) -> Target {
        let (a, b) = Sheet::unit_square().clip(&line).unwrap();
        Target::new(line, vec![id], vec![[a, b]], 0.0, 1.0)
    }

    fn ways_of(c: &Closure, placed: &[Placed]) -> Vec<Vec<Way>> {
        let verdicts = crate::pinch::placed_pinch_pass(c, placed);
        of(c, placed, &verdicts)
    }

    fn kinds(ways: &[Way]) -> Vec<(&str, Option<Criterion>)> {
        ways.iter()
            .map(|w| (w.kind.as_str(), w.decided_by))
            .collect()
    }

    fn diagonal() -> Line {
        Line::from_points([0., 0.], [1., 1.]).unwrap()
    }

    #[test]
    fn a_diagonal_is_offered_bisected_and_through_its_corners_beside_corner_to_corner() {
        let (c, placed) = plan(vec![whole(diagonal(), 1)]);
        let ways = &ways_of(&c, &placed)[0];
        assert_eq!(ways[0].kind, "O2:cc");
        assert_eq!(ways[0].decided_by, None);
        let offered = kinds(ways);
        assert!(
            offered.contains(&("O1:cc", Some(Criterion::OneMotion))),
            "{offered:?}"
        );
        assert!(
            offered.contains(&("O3:ee", Some(Criterion::CornerToCorner))),
            "{offered:?}"
        );
    }

    #[test]
    fn a_midline_is_offered_edge_onto_edge() {
        let (c, placed) = plan(vec![whole(Line::new([1., 0.], 0.5).unwrap(), 1)]);
        let ways = &ways_of(&c, &placed)[0];
        assert_eq!(ways[0].kind, "O2:cc");
        assert!(
            kinds(ways).contains(&("O3:ee", Some(Criterion::CornerToCorner))),
            "{:?}",
            kinds(ways)
        );
    }

    #[test]
    fn a_card_offers_one_way_of_each_kind_and_at_most_four() {
        let (c, placed) = plan(vec![
            whole(diagonal(), 1),
            whole(Line::from_points([1., 0.], [0., 1.]).unwrap(), 2),
            whole(Line::new([1., 0.], 0.5).unwrap(), 3),
            whole(Line::new([1., 0.], 0.25).unwrap(), 4),
        ]);
        for ways in ways_of(&c, &placed) {
            assert!(ways.len() <= MAX_WAYS);
            assert_ne!(ways.len(), 1, "a single way is no choice");
            let mut seen: Vec<&str> = ways.iter().map(|w| w.kind.as_str()).collect();
            seen.sort_unstable();
            seen.dedup();
            assert_eq!(seen.len(), ways.len(), "{:?}", kinds(&ways));
        }
    }

    #[test]
    fn a_twin_pairs_ways_are_mirror_images_way_for_way() {
        // The two midlines are each other's image about a diagonal of the
        // square, folded at once on one card.
        let (c, placed) = plan(vec![
            whole(Line::new([1., 0.], 0.5).unwrap(), 1),
            whole(Line::new([0., 1.], 0.5).unwrap(), 2),
        ]);
        let second = placed
            .iter()
            .position(|p| p.twin_of.is_some())
            .expect("a twin pair");
        let offered = ways_of(&c, &placed);
        let (a, b) = (&offered[second - 1], &offered[second]);
        assert!(a.len() >= 2, "{:?}", kinds(a));
        assert_eq!(a.len(), b.len());
        let state = c.state();
        let sym = Symmetry::of(state.sheet())
            .into_iter()
            .find(|s| s.maps_witness(state, &a[0].witness, &b[0].witness))
            .expect("the pair's symmetry");
        for (x, y) in a.iter().zip(b) {
            assert!(
                sym.maps_witness(state, &x.witness, &y.witness),
                "{x:?} / {y:?}"
            );
            assert_eq!(x.also, None);
            assert_eq!(y.also, None);
        }
    }

    #[test]
    fn a_kind_does_not_depend_on_which_of_two_like_inputs_comes_first() {
        let w = |inputs: Vec<Ref>, axiom| Witness {
            axiom,
            inputs,
            root: 0,
            who_moves: vec![0],
            hard: false,
            visible: true,
            skinny: false,
            ease: 0,
            err: 0.0,
        };
        let corner = Ref::Corner {
            id: 0,
            corner: crate::sheet::CornerName::Sw,
        };
        let mark = Ref::Point { id: 9 };
        assert_eq!(kind(&w(vec![corner, mark], 2)), "O2:cp");
        assert_eq!(kind(&w(vec![mark, corner], 2)), "O2:cp");
        // O7 is [point, landing line, line kept on itself]: order is meaning.
        let edge = Ref::Edge {
            id: 1,
            side: crate::sheet::EdgeSide::Bottom,
        };
        let crease = Ref::Line { id: 7 };
        assert_eq!(kind(&w(vec![mark, crease, edge], 7)), "O7:ple");
    }
}

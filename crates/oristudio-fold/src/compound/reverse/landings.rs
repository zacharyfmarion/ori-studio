//! Which ways a reverse fold's tip lands — and a crimp's, at its first line
//! — before one is chosen, so a tool can offer only the openings that do.
//!
//! - **Every way.** The tip is computed once. Its ways are the product of the
//!   openings of each flap that opens several, the last flap advancing
//!   fastest, as the tools step them; the first [`MAX_WAYS`] are decided,
//!   the rest left undecided. Each way is a plan, prepared once of the inside
//!   kind: the outside kind is the same fold with its placements turned
//!   (`Prepared::landing_flipped`), so a way costs one preparation and two
//!   searches for a first order.
//! - **Undecided.** A caller's deadline is read before each way, and each
//!   search stops at it: a kind it leaves undecided is `None`, as a tuck's
//!   target is. The ways are decided most even first — the fewest more faces
//!   in one block than the other — since that is the split a folder usually
//!   means (42 of 44 multi-opening reverse folds and crimps in real tutorial
//!   models), and reported in product order.
//! - **Locked flaps.** A tip of several flaps that lands some way may still
//!   land only with all of them: a corner of interleaved plies reverses
//!   between its halves only as one packet. Each flap is left out in turn —
//!   the tip without it, as a folder unpicking it would fold — and its ways
//!   are tried until one lands either kind. A flap none of whose ways lands
//!   is locked; one the deadline leaves undecided is not.

use serde::Serialize;

use crate::complete::CompletionLimits;
use crate::compound::{CompoundRefused, Prepared};
use crate::refusal::FoldRefusal;
use crate::state::State;

use super::{Plan, ReverseFold, ReverseKind, Tip};

/// The most ways of opening a tip one ask decides: each costs a preparation
/// and two searches, and a tool steps through a handful.
pub const MAX_WAYS: usize = 256;

/// One way a tip opens, and which kinds land it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ReverseWay {
    /// Per flap that opens several ways, in the tip's flap order, its
    /// opening: an index into that flap's [`super::TipFlap::openings`].
    pub openings: Vec<usize>,
    /// Whether the inside kind lands; none when the budget ran out before it
    /// was decided.
    pub inside: Option<bool>,
    /// Whether the outside kind lands; none when it was not decided.
    pub outside: Option<bool>,
}

impl ReverseWay {
    /// Whether `kind` lands this way; none while undecided.
    pub fn lands(&self, kind: ReverseKind) -> Option<bool> {
        match kind {
            ReverseKind::Inside => self.inside,
            ReverseKind::Outside => self.outside,
        }
    }
}

/// How a tip lands before its opening is chosen (see the module docs).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
pub struct ReverseLandings {
    /// When a flap opens several ways, each way with the kinds that land,
    /// the first [`MAX_WAYS`] in product order; empty when every flap opens
    /// one way.
    pub ways: Vec<ReverseWay>,
    /// The tip opens more ways than are listed: those are undecided.
    pub more: bool,
    /// The tip's flaps (moving-side flap indices, as
    /// [`super::TipFlap::index`]) without which no way lands for either
    /// kind, ascending. Empty for a tip of one flap, and for one that lands
    /// no way.
    pub locked: Vec<usize>,
}

/// A fold whose tip opens as a reverse fold's does: the reverse fold, or a
/// crimp at its first line.
pub(in crate::compound) trait Opens: Sized {
    fn tip(&self) -> &Tip;

    /// The fold of `plan`, of the inside kind: the outside kind is it with
    /// its placements turned.
    fn prepare_inside(&self, state: &State, plan: &Plan) -> Result<Prepared, FoldRefusal>;

    /// The same fold with the tip's flap `flap` (a moving-side flap index)
    /// left out; none when that is refused.
    fn without(&self, state: &State, flap: usize) -> Option<Self>;
}

impl Opens for Tip {
    fn tip(&self) -> &Tip {
        self
    }

    fn prepare_inside(&self, state: &State, plan: &Plan) -> Result<Prepared, FoldRefusal> {
        self.prepare(state, plan, ReverseKind::Inside)
    }

    fn without(&self, state: &State, flap: usize) -> Option<Tip> {
        self.leaving_out(state, flap)
    }
}

impl State {
    /// How the reverse fold `op` lands each way its tip opens, and the
    /// flaps it cannot be folded without (see the module docs), under
    /// `limits` — a deadline leaves the rest undecided. `op.kind` is not
    /// read: the answer is both kinds'. Refused as [`State::reverse_kinds`]
    /// is when the tip cannot be asked about.
    pub fn reverse_landings(
        &self,
        op: &ReverseFold,
        limits: &CompletionLimits,
    ) -> Result<ReverseLandings, CompoundRefused> {
        let tip = self.tip(op).map_err(CompoundRefused::Refused)?;
        landings_of(self, &tip, limits)
    }
}

impl Tip {
    /// The same tip with its flap `flap` (a moving-side flap index, as
    /// [`super::TipFlap::index`]) left out; none when nothing is left, or
    /// the tip without it is refused.
    pub(in crate::compound) fn leaving_out(&self, state: &State, flap: usize) -> Option<Tip> {
        let flaps: Vec<usize> = self.flaps.iter().copied().filter(|&k| k != flap).collect();
        if flaps.is_empty() {
            return None;
        }
        Tip::new(state, self.classified.clone(), self.side.clone(), flaps).ok()
    }

    /// The ways the tip opens, the first `cap` and whether there are more
    /// ([`product`] of the openings of each flap that opens several).
    fn ways(&self, cap: usize) -> (Vec<Vec<usize>>, bool) {
        let counts: Vec<usize> = self
            .openings
            .iter()
            .map(|o| o.openings.len())
            .filter(|&n| n > 1)
            .collect();
        product(&counts, cap)
    }

    /// Per flap of the tip, its opening in `way` (see [`Tip::ways`]): a flap
    /// that opens one way takes it, one with none has none.
    fn picked(&self, way: &[usize]) -> Vec<Option<usize>> {
        let mut way = way.iter();
        self.openings
            .iter()
            .map(|o| match o.openings.len() {
                0 => None,
                1 => Some(0),
                _ => way.next().copied(),
            })
            .collect()
    }

    /// How unevenly `way` splits the tip: over the flaps that open several
    /// ways, how many more faces one block of the opening has than the
    /// other.
    fn unevenness(&self, way: &[usize]) -> usize {
        self.openings
            .iter()
            .filter(|o| o.openings.len() > 1)
            .zip(way)
            .filter_map(|(o, &j)| o.openings.get(j))
            .map(|opening| opening.lower.len().abs_diff(opening.upper.len()))
            .sum()
    }
}

/// Every choice of one of `counts[k]` per position, in order with the last
/// position advancing fastest — the first `cap` of them, and whether there
/// are more. One empty choice for no positions.
fn product(counts: &[usize], cap: usize) -> (Vec<Vec<usize>>, bool) {
    let mut ways: Vec<Vec<usize>> = vec![Vec::new()];
    let mut more = false;
    for &n in counts {
        // The first `cap` of the product have their prefixes among the first
        // `cap` prefixes, so it is cut at every position.
        let mut next = Vec::with_capacity(cap.min(ways.len().saturating_mul(n)));
        'ways: for way in &ways {
            for j in 0..n {
                if next.len() == cap {
                    more = true;
                    break 'ways;
                }
                let mut longer = way.clone();
                longer.push(j);
                next.push(longer);
            }
        }
        ways = next;
    }
    (ways, more)
}

/// How `opens` lands each way its tip opens, and its locked flaps.
pub(in crate::compound) fn landings_of<O: Opens>(
    state: &State,
    opens: &O,
    limits: &CompletionLimits,
) -> Result<ReverseLandings, CompoundRefused> {
    let tip = opens.tip();
    tip.movable().map_err(CompoundRefused::Refused)?;
    let several = tip.openings.iter().any(|o| o.openings.len() > 1);
    // A tip of one flap that opens one way has nothing to list or lock.
    if !several && tip.flaps.len() < 2 {
        return Ok(ReverseLandings::default());
    }
    let (ways, more) = tip.ways(MAX_WAYS);
    let decided = decide(state, opens, &ways, limits, false);
    let lands = decided
        .iter()
        .any(|way| way.inside == Some(true) || way.outside == Some(true));
    let locked = if lands && tip.flaps.len() >= 2 {
        locked(state, opens, limits)
    } else {
        Vec::new()
    };
    Ok(ReverseLandings {
        ways: if several { decided } else { Vec::new() },
        more,
        locked,
    })
}

/// Which kinds land each of `ways`, decided most even first until the
/// deadline passes — or, with `first_landing`, until one lands either kind.
fn decide<O: Opens>(
    state: &State,
    opens: &O,
    ways: &[Vec<usize>],
    limits: &CompletionLimits,
    first_landing: bool,
) -> Vec<ReverseWay> {
    let tip = opens.tip();
    let mut decided: Vec<ReverseWay> = ways
        .iter()
        .map(|openings| ReverseWay {
            openings: openings.clone(),
            inside: None,
            outside: None,
        })
        .collect();
    let mut order: Vec<usize> = (0..ways.len()).collect();
    order.sort_by_key(|&w| (tip.unevenness(&ways[w]), w));
    for w in order {
        if limits.out_of_time() {
            break;
        }
        let [inside, outside] = match tip.plan(state, &tip.picked(&ways[w])) {
            Some(plan) => match opens.prepare_inside(state, &plan) {
                Ok(prepared) => {
                    let inside = prepared.landing(limits);
                    let outside = if limits.out_of_time() {
                        None
                    } else {
                        prepared.landing_flipped(limits)
                    };
                    [inside, outside]
                }
                Err(_) => [Some(false); 2],
            },
            None => [Some(false); 2],
        };
        decided[w].inside = inside;
        decided[w].outside = outside;
        if first_landing && (inside == Some(true) || outside == Some(true)) {
            break;
        }
    }
    decided
}

/// The tip's flaps without which no way lands, for either kind: each left
/// out in turn, its ways tried until one lands. Undecided is not locked.
fn locked<O: Opens>(state: &State, opens: &O, limits: &CompletionLimits) -> Vec<usize> {
    opens
        .tip()
        .flaps
        .iter()
        .copied()
        .filter(|&flap| {
            if limits.out_of_time() {
                return false;
            }
            let Some(without) = opens.without(state, flap) else {
                return true;
            };
            let tip = without.tip();
            if tip.movable().is_err() {
                return true;
            }
            let (ways, more) = tip.ways(MAX_WAYS);
            !more
                && decide(state, &without, &ways, limits, true)
                    .iter()
                    .all(|way| way.inside == Some(false) && way.outside == Some(false))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::product;

    #[test]
    fn the_product_runs_the_last_position_fastest() {
        let (ways, more) = product(&[2, 3], 16);
        assert!(!more);
        assert_eq!(
            ways,
            vec![
                vec![0, 0],
                vec![0, 1],
                vec![0, 2],
                vec![1, 0],
                vec![1, 1],
                vec![1, 2]
            ]
        );
        assert_eq!(product(&[], 16), (vec![Vec::new()], false));
    }

    #[test]
    fn the_product_is_cut_at_the_cap_in_order() {
        let (whole, _) = product(&[3, 4, 5], 1000);
        for cap in [1, 7, 12, 59, 60] {
            let (ways, more) = product(&[3, 4, 5], cap);
            assert_eq!(ways, whole[..cap], "cap {cap}");
            assert_eq!(more, cap < 60, "cap {cap}");
        }
        let (ways, more) = product(&[20, 20], 256);
        assert_eq!((ways.len(), more), (256, true));
        assert_eq!(ways[255], vec![12, 15]);
    }
}

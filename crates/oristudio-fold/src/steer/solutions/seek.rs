//! The stepper without the count: the next or the previous solution in the
//! count's own order, found by search from the order on screen
//! (`implementation-plans/layer-order-dialog.md` row E9; decision D7, "‹ ›
//! still steps").
//!
//! The stepper of [`super::Solutions`] steps through what its count lists.
//! Before the count has listed everything a step goes through (above the
//! size where the dialog starts no count, D7, or while it still runs), that
//! list is partial, and a step that waited for it would never move on the
//! largest figures. So until then a step searches for the solution the count
//! would list next instead, starting from the order on screen.
//!
//! - **By picture.** The count's order is lexicographic in the tops of the
//!   side's open spots, spot by spot, faces by number, a spot with no top
//!   ([`NO_TOP`]) last. The next picture after P is therefore the smallest
//!   above it: at the last spot x where some top above P's fits with P's
//!   tops before x, the smallest such top, then at each later spot the
//!   smallest top that still fits. "Fits" is the session's own check, a
//!   preview's ([`Check`]), with the tops as seeds: a face above each of the
//!   spot's other candidates (from the back, below them), on top of the
//!   committed constraints. A fit is an order and a can't-fit a proof, so
//!   every answer is exact; an order that fits also answers each later spot
//!   whose top it already shows, with no other check. The previous picture
//!   is the same in the reverse order. A spot that can show no top (its
//!   candidates in a cycle, never where they share one of the solver's
//!   cells) is asked as its tournaments with no top, once a 3-cycle of its
//!   candidates is seen to survive propagation. The step then shows, as a
//!   counted step does, the layer order closest to the one on screen within
//!   that picture.
//! - **By layer order (X-ray, D5).** The count's order is lexicographic by
//!   variable, the smaller face above first. Each component's next order in
//!   it comes from Flat-Folder's own search over the component's variables
//!   in ascending order, placed on the order on screen
//!   ([`treemaker_flatfold::Enumeration::lexical`] and
//!   [`treemaker_flatfold::Enumeration::after`]). The components combine as
//!   the count's views do: the one whose next order changes the latest pair
//!   takes it, and each other one's pairs after that one go to the smallest
//!   (stepping back, the largest) that its pairs before it allow.
//!
//! **What a step finds is kept** as long as the count is good: each
//! solution the stepper stood on, and, between two it stepped from one to
//! the other, that nothing lies between them. A step back to a solution
//! already seen asks one check (by picture) or none (X-ray), and an index
//! counts the solutions found ([`super::Position`]): "Solution 3" once two
//! found lie before it. Once every one has been found, from a first with
//! nothing before it to a last with nothing after, the total is exact. What
//! is kept is held within the count's stored bits, counted apart from the
//! count's own so the count never depends on what was stepped: past them a
//! solution keeps its key and not its order, or is not kept, and a step
//! searches again where it would have looked. Once the count has every
//! solution for a way of stepping, what was kept for it goes.
//!
//! **Every check shares the step's limits.** Each check's and each
//! search's nodes come out of one budget, and every guess that places a
//! lexical walk is a node of it, so the limits alone bound a step. One that
//! runs out leaves the step undecided ([`Sought::Undecided`]). What was
//! proved stays: each check's answer is kept by the tops it asked about, and
//! an X-ray search that stopped resumes where it stopped, so the same step
//! asked again with longer limits ("Keep trying") goes on from there.
//!
//! Ori Studio original work, not a port.

use std::cmp::Reverse;
use std::collections::{BTreeMap, HashMap};
use std::ops::Bound;

use treemaker_flatfold::{self as flatfold, Deduction, EnumerationStep, PairOrder};

use super::super::session::{
    ConstraintSession, Limits, Seed, SessionRefusal, Solved, Steer, TimedOut, internal_search,
};
use super::{
    FRONT, NO_TOP, OpenSpot, Position, Solutions, StepBy, StepDirection, Tally, get_bit,
    order_of_bit, set_bit, side_index, top_of,
};
use crate::complete::{self, BudgetLimit, Deadline};

/// What the session's check answered.
pub(crate) enum Fits {
    /// An order that fits, one value per variable.
    Fit(Vec<PairOrder>),
    /// A proof that none does.
    No,
    /// Neither, within the limits: the one that ran out.
    Unknown(BudgetLimit),
}

/// A search that ran out of its limits first: the one that ran out.
struct OutOfTime(BudgetLimit);

/// What a step asks: whether the committed constraints and `extra` leave an
/// order, and one that does, steered by the order on screen, with the
/// search nodes the answer took. The session's own check (a preview's)
/// answers it.
pub(crate) trait Check {
    fn fits(&self, extra: &[Seed], limits: &Limits) -> Result<(Fits, u64), SessionRefusal>;
}

impl Check for ConstraintSession {
    fn fits(&self, extra: &[Seed], limits: &Limits) -> Result<(Fits, u64), SessionRefusal> {
        let (solved, nodes) =
            self.solve_counted(self.constraints(), extra, Steer::Shown, limits)?;
        let fits = match solved {
            Solved::Fit(fit) => Fits::Fit(fit.into_values()),
            Solved::CantFit(_) => Fits::No,
            Solved::TimedOut(out) => Fits::Unknown(out.limit),
        };
        Ok((fits, nodes))
    }
}

/// What a search for the next or previous solution found.
pub(crate) enum Sought {
    /// The order to show: the solution the count lists next that way.
    Found(Vec<PairOrder>),
    /// None lies that way: proved.
    End,
    /// The limits ran out first: the one that did, and the nodes spent.
    Undecided(TimedOut),
}

/// What [`Solutions::seek`] answered, and whether it searched for it: an
/// answer what earlier steps proved gave did not.
pub(crate) struct Answer {
    pub(crate) sought: Sought,
    pub(crate) searched: bool,
}

/// What one step may still spend: nodes, shared by every check and search
/// it makes, and its deadline.
struct Budget {
    left: Option<u64>,
    spent: u64,
    fast_nodes: u64,
    deadline: Option<Deadline>,
}

impl Budget {
    fn of(limits: &Limits) -> Budget {
        Budget {
            left: limits.max_nodes,
            spent: 0,
            fast_nodes: limits.fast_nodes,
            deadline: limits.deadline,
        }
    }

    /// The limits of the next check: what is left.
    fn limits(&self) -> Limits {
        Limits {
            max_nodes: self.left,
            fast_nodes: self.fast_nodes,
            deadline: self.deadline,
        }
    }

    fn search(&self) -> flatfold::SearchBudget {
        complete::search_budget(self.left, self.deadline)
    }

    fn charge(&mut self, nodes: u64) {
        self.spent += nodes;
        if let Some(left) = self.left.as_mut() {
            *left = left.saturating_sub(nodes);
        }
    }

    /// The limit already reached, if one is: nothing more may be asked.
    fn reached(&self) -> Option<BudgetLimit> {
        if self.left == Some(0) {
            Some(BudgetLimit::Nodes)
        } else if self.deadline.is_some_and(|d| d.passed()) {
            Some(BudgetLimit::Deadline)
        } else {
            None
        }
    }

    fn timed_out(&self, limit: BudgetLimit) -> TimedOut {
        TimedOut {
            limit,
            nodes: self.spent,
        }
    }
}

/// A complete order as bits, one per variable, set where the larger face
/// lies above, most significant first: comparing two compares the orders as
/// X-ray steps through them.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) struct Packed(Vec<u64>);

impl Packed {
    pub(crate) fn of(values: &[PairOrder]) -> Packed {
        let mut words = vec![0u64; values.len().div_ceil(64)];
        for (v, value) in values.iter().enumerate() {
            if *value == PairOrder::SecondAbove {
                set_bit(&mut words, v);
            }
        }
        Packed(words)
    }

    fn values(&self, n: usize) -> Vec<PairOrder> {
        (0..n).map(|v| order_of_bit(get_bit(&self.0, v))).collect()
    }

    fn bits(&self) -> u64 {
        64 * self.0.len() as u64
    }
}

/// What keeping a key costs: its own bits, and an entry's bookkeeping.
fn key_bits(len: usize, per: u64) -> u64 {
    64 + per * len as u64
}

/// The solutions a stepper has stood on, for one way of stepping, by key
/// (a picture's tops, or a whole layer order), ascending.
#[derive(Debug, Clone)]
struct Found<K> {
    entries: BTreeMap<K, Entry>,
    /// Nothing lies before the smallest.
    first: bool,
    /// Nothing lies after the largest.
    last: bool,
    /// What its entries cost.
    bits: u64,
}

impl<K> Default for Found<K> {
    fn default() -> Found<K> {
        Found {
            entries: BTreeMap::new(),
            first: false,
            last: false,
            bits: 0,
        }
    }
}

#[derive(Debug, Clone)]
struct Entry {
    /// The order last shown for it, where the key is not the order and
    /// there was room to keep it.
    order: Option<Packed>,
    /// Nothing lies between it and the next one up.
    next: bool,
}

/// What is known of the solution beside one, one way.
enum Known<K> {
    /// The very next that way, and the order last shown for it, if kept.
    Neighbour(K, Option<Packed>),
    /// None lies that way.
    End,
    Unknown,
}

impl<K: Ord + Clone> Found<K> {
    /// `key` (costing `cost`) is a solution; `order` the order shown for it
    /// now, kept if there is room. Within `room` bits; past it, a new key is
    /// not kept, and an old one keeps no order.
    fn note(&mut self, key: &K, cost: u64, order: Option<Packed>, room: u64) {
        let wanted = order.as_ref().map_or(0, Packed::bits);
        match self.entries.get_mut(key) {
            Some(entry) => {
                if order.is_none() {
                    return;
                }
                let held = entry.order.as_ref().map_or(0, Packed::bits);
                self.bits -= held;
                if wanted <= room + held {
                    entry.order = order;
                    self.bits += wanted;
                } else {
                    entry.order = None;
                }
            }
            None if cost > room => {}
            None => {
                let (order, spent) = if cost + wanted <= room {
                    (order, cost + wanted)
                } else {
                    (None, cost)
                };
                self.entries
                    .insert(key.clone(), Entry { order, next: false });
                self.bits += spent;
            }
        }
    }

    fn known(&self, key: &K, direction: StepDirection) -> Known<K> {
        if !self.entries.contains_key(key) {
            return Known::Unknown;
        }
        match direction {
            StepDirection::Next => {
                if self.entries.get(key).is_some_and(|e| e.next)
                    && let Some((k, e)) = self
                        .entries
                        .range((Bound::Excluded(key), Bound::Unbounded))
                        .next()
                {
                    return Known::Neighbour(k.clone(), e.order.clone());
                }
                if self.last && self.entries.keys().next_back() == Some(key) {
                    return Known::End;
                }
            }
            StepDirection::Previous => {
                if let Some((k, e)) = self.entries.range(..key).next_back()
                    && e.next
                {
                    return Known::Neighbour(k.clone(), e.order.clone());
                }
                if self.first && self.entries.keys().next() == Some(key) {
                    return Known::End;
                }
            }
        }
        Known::Unknown
    }

    /// `a` and `b` are neighbours: nothing lies between. Kept only when
    /// both are, so a link never skips a solution that was not kept.
    fn link(&mut self, a: &K, b: &K) {
        if self.entries.contains_key(a.max(b))
            && let Some(entry) = self.entries.get_mut(a.min(b))
        {
            entry.next = true;
        }
    }

    /// Nothing lies past `key` that way, so nothing kept may; kept only
    /// when `key` is.
    fn end(&mut self, key: &K, direction: StepDirection) -> Result<(), SessionRefusal> {
        if !self.entries.contains_key(key) {
            return Ok(());
        }
        let extreme = match direction {
            StepDirection::Next => self.entries.keys().next_back(),
            StepDirection::Previous => self.entries.keys().next(),
        };
        if extreme != Some(key) {
            return Err(SessionRefusal::internal(
                "a solution was found past the one proved the end",
            ));
        }
        match direction {
            StepDirection::Next => self.last = true,
            StepDirection::Previous => self.first = true,
        }
        Ok(())
    }

    /// From 1, one more than the solutions found before `key`; how many are
    /// found, `key` among them; and whether that is every one.
    fn position(&self, key: &K) -> (u64, u64, bool) {
        let before = self.entries.range(..key).count() as u64;
        let noted = self.entries.contains_key(key);
        let n = self.entries.len() as u64 + u64::from(!noted);
        let every =
            noted && self.first && self.last && self.entries.values().rev().skip(1).all(|e| e.next);
        (before + 1, n, every)
    }
}

/// Every check's answer for one side, by the tops it asked of the open
/// spots from the first: an order that fits them, or `None` when none does.
#[derive(Debug, Clone, Default)]
struct Asked {
    answers: HashMap<Vec<u32>, Option<Packed>>,
    bits: u64,
}

impl Asked {
    /// Keep an answer, within `room` bits.
    fn keep(&mut self, prefix: &[u32], order: Option<Packed>, room: u64) {
        let cost = key_bits(prefix.len(), 32) + order.as_ref().map_or(0, Packed::bits);
        if cost <= room && !self.answers.contains_key(prefix) {
            self.answers.insert(prefix.to_vec(), order);
            self.bits += cost;
        }
    }
}

/// One component's next (or previous) order, kept beside the order it was
/// found from.
#[derive(Debug, Clone)]
struct Beside {
    /// The component's values it was found from, by its variables ascending.
    from: Vec<PairOrder>,
    /// The order after it, the same way; `None` for none.
    next: Option<Vec<PairOrder>>,
}

/// A lexical search of one component, standing on `at` (its values, by its
/// variables ascending) or stopped on its way from there.
#[derive(Debug, Clone)]
struct Standing {
    component: usize,
    at: Vec<PairOrder>,
    cursor: flatfold::Enumeration,
}

/// The ways of stepping, as [`Seek`] keeps them apart.
const XRAY: usize = 2;

fn way_of(by: StepBy) -> usize {
    match by {
        StepBy::Picture(side) => side_index(side),
        StepBy::LayerOrder => XRAY,
    }
}

/// What the stepper found by searching (see the module docs), beside the
/// count it steps with.
#[derive(Debug, Clone, Default)]
pub(crate) struct Seek {
    /// Per side, the pictures stood on, by their tops.
    pictures: [Found<Vec<u32>>; 2],
    /// Per side, every check's answer.
    asked: [Asked; 2],
    /// Per side and open spot, whether an order that fits can leave it with
    /// no top, once asked.
    no_top: [Vec<Option<bool>>; 2],
    /// The layer orders stood on.
    orders: Found<Packed>,
    /// Per direction (next, previous) and component, what came after its
    /// values on screen, once found: one component's worth each, never more.
    beside: [Vec<Option<Beside>>; 2],
    /// Per direction, the search of the component that moved last, or that
    /// ran out of time, kept to go on from.
    standing: [Option<Standing>; 2],
}

impl Seek {
    /// The bits of what is kept, past which nothing more is.
    pub(crate) fn held(&self) -> u64 {
        self.pictures.iter().map(|f| f.bits).sum::<u64>()
            + self.asked.iter().map(|a| a.bits).sum::<u64>()
            + self.orders.bits
    }

    /// What is kept for stepping `way`, gone: the count has every solution
    /// it goes through.
    fn release(&mut self, way: usize) {
        if way == XRAY {
            self.orders = Found::default();
            self.beside = Default::default();
            self.standing = Default::default();
        } else {
            self.pictures[way] = Found::default();
            self.asked[way] = Asked::default();
            self.no_top[way] = Vec::new();
        }
    }
}

/// What a search beside one solution found.
enum Neighbour<K> {
    /// The key of the solution, and an order that shows it.
    Found(K, Vec<PairOrder>),
    End,
    Undecided(BudgetLimit),
}

/// Every seed of `base` and `extra`, or `None` when they ask a pair both
/// ways.
pub(crate) fn merged(base: &[Seed], extra: &[Seed]) -> Option<Vec<Seed>> {
    let mut wanted: HashMap<usize, PairOrder> = HashMap::with_capacity(base.len() + extra.len());
    let mut all = Vec::with_capacity(base.len() + extra.len());
    for &(v, value) in base.iter().chain(extra) {
        match wanted.insert(v, value) {
            Some(other) if other != value => return None,
            Some(_) => {}
            None => all.push((v, value)),
        }
    }
    Some(all)
}

impl Solutions {
    /// Whether the count has every solution stepping `by` goes through, so
    /// the stepper follows it: every look group of the side walked, or with
    /// X-ray every component's layer orders listed (to the end or a cap).
    pub(crate) fn counted(&self, by: StepBy) -> bool {
        match by {
            StepBy::Picture(side) => self.sides[side_index(side)].groups.iter().all(|g| g.walked),
            StepBy::LayerOrder => self.components.iter().all(|c| c.orders_finished),
        }
    }

    /// Let go of what a search kept for each way of stepping the count now
    /// has every solution of.
    pub(crate) fn release_counted(&mut self) {
        for by in [
            StepBy::Picture(super::ViewSide::Front),
            StepBy::Picture(super::ViewSide::Back),
            StepBy::LayerOrder,
        ] {
            if self.counted(by) {
                self.seek.release(way_of(by));
            }
        }
    }

    /// The bits a search may still keep.
    fn room(&self) -> u64 {
        self.caps.stored_bits.saturating_sub(self.seek.held())
    }

    /// The tops of side `s`'s open spots for `values`, spot by spot: what
    /// the count's order compares pictures by.
    pub(crate) fn picture_key(&self, s: usize, values: &[PairOrder]) -> Vec<u32> {
        let mut wins = Vec::new();
        self.sides[s]
            .spots
            .iter()
            .map(|spot| {
                top_of(
                    spot,
                    s,
                    |pair| values[pair.variable as usize] == PairOrder::FirstAbove,
                    &mut wins,
                )
            })
            .collect()
    }

    /// The solution after (before) `values` in the count's order, by search
    /// (see the module docs), within `limits` all told, and what it proved
    /// kept.
    pub(crate) fn seek(
        &mut self,
        search: &flatfold::CompletionSession,
        check: &dyn Check,
        by: StepBy,
        values: &[PairOrder],
        direction: StepDirection,
        limits: &Limits,
    ) -> Result<Answer, SessionRefusal> {
        if values.len() != self.variables.len() {
            return Err(SessionRefusal::internal("an order of the wrong length"));
        }
        let mut budget = Budget::of(limits);
        match by {
            StepBy::Picture(side) => self.seek_picture(
                search,
                check,
                side_index(side),
                values,
                direction,
                &mut budget,
            ),
            StepBy::LayerOrder => self.seek_order(search, values, direction, &mut budget),
        }
    }

    /// Where `values` lies among the solutions the stepper found: an index
    /// among them, and the total at least as many as it or the count found,
    /// exact once it found every one.
    pub(crate) fn seek_position(&self, by: StepBy, values: &[PairOrder]) -> Position {
        let count = self.count();
        let ((index, n, every), counted) = match by {
            StepBy::Picture(side) => {
                let s = side_index(side);
                let key = self.picture_key(s, values);
                let tally = if s == FRONT { count.front } else { count.back };
                (self.seek.pictures[s].position(&key), tally)
            }
            StepBy::LayerOrder => (self.seek.orders.position(&Packed::of(values)), count.orders),
        };
        let total = if every {
            Tally { n, exact: true }
        } else {
            Tally {
                n: n.max(counted.n),
                exact: false,
            }
        };
        Position { index, total }
    }

    fn seek_picture(
        &mut self,
        search: &flatfold::CompletionSession,
        check: &dyn Check,
        s: usize,
        values: &[PairOrder],
        direction: StepDirection,
        budget: &mut Budget,
    ) -> Result<Answer, SessionRefusal> {
        let n = values.len();
        let key = self.picture_key(s, values);
        let cost = key_bits(key.len(), 32);
        let room = self.room();
        self.seek.pictures[s].note(&key, cost, Some(Packed::of(values)), room);
        // What the side's answers may grow to: what they hold, and the room.
        let answers = self.room() + self.seek.asked[s].bits;
        let (target, standby, searched) = match self.seek.pictures[s].known(&key, direction) {
            Known::End => {
                return Ok(Answer {
                    sought: Sought::End,
                    searched: false,
                });
            }
            Known::Neighbour(target, Some(order)) => (target, order.values(n), false),
            // A neighbour kept with no order searches again for one.
            Known::Neighbour(_, None) | Known::Unknown => {
                let Solutions {
                    sides, seek, seeds, ..
                } = &mut *self;
                let side = &sides[s];
                if seek.no_top[s].len() != side.spots.len() {
                    seek.no_top[s] = vec![None; side.spots.len()];
                }
                let mut tops = Tops {
                    s,
                    spots: &side.spots,
                    search,
                    seeds,
                    check,
                    budget,
                    asked: &mut seek.asked[s],
                    answers,
                    no_top: &mut seek.no_top[s],
                    n,
                };
                let found = tops.neighbour(&key, direction)?;
                match found {
                    Neighbour::Found(target, order) => {
                        let room = self.room();
                        let found = &mut self.seek.pictures[s];
                        found.note(&target, cost, Some(Packed::of(&order)), room);
                        found.link(&key, &target);
                        (target, order, true)
                    }
                    Neighbour::End => {
                        self.seek.pictures[s].end(&key, direction)?;
                        return Ok(Answer {
                            sought: Sought::End,
                            searched: true,
                        });
                    }
                    Neighbour::Undecided(limit) => {
                        return Ok(Answer {
                            sought: Sought::Undecided(budget.timed_out(limit)),
                            searched: true,
                        });
                    }
                }
            }
        };
        // Within that picture, the layer order closest to the one on screen,
        // as a counted step finds it, if the limits leave room to ask; the
        // order found stands in for it.
        let mut shown = standby;
        if budget.reached().is_none() {
            let mut seeds = Vec::new();
            for (spot, &top) in self.sides[s].spots.iter().zip(&target) {
                top_seeds(spot, s, top, &mut seeds);
            }
            let (fits, nodes) = check.fits(&seeds, &budget.limits())?;
            budget.charge(nodes);
            if let Fits::Fit(order) = fits
                && self.picture_key(s, &order) == target
            {
                shown = order;
            }
        }
        let room = self.room();
        self.seek.pictures[s].note(&target, cost, Some(Packed::of(&shown)), room);
        Ok(Answer {
            sought: Sought::Found(shown),
            searched,
        })
    }

    fn seek_order(
        &mut self,
        search: &flatfold::CompletionSession,
        values: &[PairOrder],
        direction: StepDirection,
        budget: &mut Budget,
    ) -> Result<Answer, SessionRefusal> {
        let n = values.len();
        let key = Packed::of(values);
        let cost = key_bits(0, 0) + key.bits();
        let room = self.room();
        self.seek.orders.note(&key, cost, None, room);
        match self.seek.orders.known(&key, direction) {
            Known::Neighbour(target, _) => {
                return Ok(Answer {
                    sought: Sought::Found(target.values(n)),
                    searched: false,
                });
            }
            Known::End => {
                return Ok(Answer {
                    sought: Sought::End,
                    searched: false,
                });
            }
            Known::Unknown => {}
        }
        let sought = match self.order_neighbour(search, values, direction, budget)? {
            Neighbour::Found(target, order) => {
                let room = self.room();
                self.seek.orders.note(&target, cost, None, room);
                self.seek.orders.link(&key, &target);
                Sought::Found(order)
            }
            Neighbour::End => {
                self.seek.orders.end(&key, direction)?;
                Sought::End
            }
            Neighbour::Undecided(limit) => Sought::Undecided(budget.timed_out(limit)),
        };
        Ok(Answer {
            sought,
            searched: true,
        })
    }

    /// The layer order after (before) `values`, by variable: the product
    /// rule over each component's own next order (see the module docs).
    fn order_neighbour(
        &mut self,
        search: &flatfold::CompletionSession,
        values: &[PairOrder],
        direction: StepDirection,
        budget: &mut Budget,
    ) -> Result<Neighbour<Packed>, SessionRefusal> {
        let way = usize::from(direction == StepDirection::Previous);
        for beside in &mut self.seek.beside {
            beside.resize(self.components.len(), None);
        }
        // The components by their last variable, latest first: once one
        // ends before the latest change found, none after it can change a
        // later pair.
        let mut latest: Vec<usize> = (0..self.components.len())
            .filter(|&k| !self.components[k].variables.is_empty())
            .collect();
        latest.sort_by_key(|&k| Reverse(self.components[k].variables.last().copied()));
        let mut best: Option<(u32, usize, Vec<PairOrder>)> = None;
        for k in latest {
            let last = self.components[k].variables.last().copied().unwrap_or(0);
            if best.as_ref().is_some_and(|b| last < b.0) {
                break;
            }
            let next = match self.component_beside(search, k, values, way, budget)? {
                Ok(next) => next,
                Err(OutOfTime(limit)) => return Ok(Neighbour::Undecided(limit)),
            };
            let Some(own) = next else {
                continue;
            };
            let variables = &self.components[k].variables;
            let Some(at) = variables
                .iter()
                .zip(&own)
                .find(|(v, o)| values[**v as usize] != **o)
                .map(|(v, _)| *v)
            else {
                return Err(SessionRefusal::internal(
                    "a component's next order is its order",
                ));
            };
            if best.as_ref().is_none_or(|b| at > b.0) {
                best = Some((at, k, own));
            }
        }
        let Some((at, moved, own)) = best else {
            return Ok(Neighbour::End);
        };
        let mut order = values.to_vec();
        for (&v, &o) in self.components[moved].variables.iter().zip(&own) {
            order[v as usize] = o;
        }
        let mut changed = vec![moved];
        for h in 0..self.components.len() {
            let tail = self.components[h].variables.last().is_some_and(|&l| l > at);
            if h == moved || !tail {
                continue;
            }
            let own = match self.extreme_after(search, h, &order, at, way, budget)? {
                Ok(own) => own,
                Err(OutOfTime(limit)) => return Ok(Neighbour::Undecided(limit)),
            };
            let variables = &self.components[h].variables;
            if variables
                .iter()
                .zip(&own)
                .any(|(v, o)| order[*v as usize] != *o)
            {
                for (&v, &o) in variables.iter().zip(&own) {
                    order[v as usize] = o;
                }
                changed.push(h);
            }
        }
        // What was found beside the components that changed is beside
        // their old orders. The moved one's search, if still kept, stands on
        // its new order, and goes on from there.
        for k in changed {
            for beside in &mut self.seek.beside {
                beside[k] = None;
            }
            for (w, standing) in self.seek.standing.iter_mut().enumerate() {
                let stands = w == way && standing.as_ref().is_some_and(|p| p.at == own);
                if standing.as_ref().is_some_and(|p| p.component == k) && !(k == moved && stands) {
                    *standing = None;
                }
            }
        }
        Ok(Neighbour::Found(Packed::of(&order), order))
    }

    /// Component `k`'s order after (before, `way` 1) its values in `values`,
    /// by its variables ascending: `None` when it has none that way.
    fn component_beside(
        &mut self,
        search: &flatfold::CompletionSession,
        k: usize,
        values: &[PairOrder],
        way: usize,
        budget: &mut Budget,
    ) -> Result<Result<Option<Vec<PairOrder>>, OutOfTime>, SessionRefusal> {
        let from: Vec<PairOrder> = self.components[k]
            .variables
            .iter()
            .map(|&v| values[v as usize])
            .collect();
        if let Some(beside) = &self.seek.beside[way][k]
            && beside.from == from
        {
            return Ok(Ok(beside.next.clone()));
        }
        if !self.seek.standing[way]
            .as_ref()
            .is_some_and(|p| p.component == k && p.at == from)
        {
            if let Some(limit) = budget.reached() {
                return Ok(Err(OutOfTime(limit)));
            }
            let walk = self
                .base
                .clone()
                .lexical(&[k], values, way == 1)
                .map_err(internal_search)?;
            let cursor = match walk
                .after(search, values, budget.search())
                .map_err(internal_search)?
            {
                flatfold::Placed::On(cursor) => {
                    budget.charge(cursor.nodes());
                    *cursor
                }
                flatfold::Placed::Stopped { limit, nodes } => {
                    budget.charge(nodes);
                    return Ok(Err(OutOfTime(complete::budget_limit(limit))));
                }
                flatfold::Placed::NotListed => {
                    return Err(SessionRefusal::internal(
                        "the order on screen is none of its component's",
                    ));
                }
            };
            self.seek.standing[way] = Some(Standing {
                component: k,
                at: from.clone(),
                cursor,
            });
        }
        let Some(standing) = self.seek.standing[way].as_mut() else {
            return Err(SessionRefusal::internal("a search placed nowhere"));
        };
        let before = standing.cursor.nodes();
        let step = standing
            .cursor
            .next(search, budget.search())
            .map_err(internal_search)?;
        budget.charge(standing.cursor.nodes() - before);
        let next = match step {
            EnumerationStep::Order => {
                let own = standing
                    .cursor
                    .component_order(k)
                    .ok_or_else(|| SessionRefusal::internal("an order step with no order"))?;
                // It stands on what it just found.
                standing.at = own.clone();
                Some(own)
            }
            EnumerationStep::Exhausted => None,
            // Kept, to go on from here.
            EnumerationStep::Stopped(limit) => {
                return Ok(Err(OutOfTime(complete::budget_limit(limit))));
            }
            EnumerationStep::Unsatisfied(_) => {
                return Err(SessionRefusal::internal(
                    "a component placed on an order has none",
                ));
            }
        };
        if next.is_none() {
            self.seek.standing[way] = None;
        }
        self.seek.beside[way][k] = Some(Beside {
            from,
            next: next.clone(),
        });
        Ok(Ok(next))
    }

    /// Component `h`'s smallest order (largest, `way` 1) that keeps its
    /// values in `order` on its variables before `at`, by its variables
    /// ascending.
    fn extreme_after(
        &self,
        search: &flatfold::CompletionSession,
        h: usize,
        order: &[PairOrder],
        at: u32,
        way: usize,
        budget: &mut Budget,
    ) -> Result<Result<Vec<PairOrder>, OutOfTime>, SessionRefusal> {
        if let Some(limit) = budget.reached() {
            return Ok(Err(OutOfTime(limit)));
        }
        let variables = &self.components[h].variables;
        let kept: Vec<Seed> = variables
            .iter()
            .filter(|&&v| v < at)
            .map(|&v| (v as usize, order[v as usize]))
            .collect();
        let seeds = merged(&self.seeds, &kept)
            .ok_or_else(|| SessionRefusal::internal("the order on screen opposes a constraint"))?;
        let deduced = match search
            .deduce(&seeds, budget.search().deadline)
            .map_err(internal_search)?
        {
            Deduction::Deduced(deduced) => deduced,
            Deduction::Undecided { limit } => {
                return Ok(Err(OutOfTime(complete::budget_limit(limit))));
            }
            other => {
                return Err(SessionRefusal::internal(format!(
                    "the order on screen does not deduce: {other:?}"
                )));
            }
        };
        let cursor = search.enumerate(&deduced).map_err(internal_search)?;
        let vary: Vec<usize> = cursor
            .components()
            .iter()
            .enumerate()
            .filter(|(_, part)| {
                part.first()
                    .is_some_and(|&v| variables.binary_search(&(v as u32)).is_ok())
            })
            .map(|(i, _)| i)
            .collect();
        let mut cursor = cursor
            .lexical(&vary, order, way == 1)
            .map_err(internal_search)?;
        let step = cursor
            .next(search, budget.search())
            .map_err(internal_search)?;
        budget.charge(cursor.nodes());
        match step {
            EnumerationStep::Order => {
                let whole = cursor
                    .order()
                    .ok_or_else(|| SessionRefusal::internal("an order step with no order"))?;
                Ok(Ok(variables.iter().map(|&v| whole[v as usize]).collect()))
            }
            EnumerationStep::Stopped(limit) => Ok(Err(OutOfTime(complete::budget_limit(limit)))),
            EnumerationStep::Exhausted | EnumerationStep::Unsatisfied(_) => Err(
                SessionRefusal::internal("the order on screen's own part has no order"),
            ),
        }
    }
}

/// The seeds that make `top` a spot's top from side `s`: it above (from the
/// back, below) each of the spot's other candidates. None for [`NO_TOP`] or
/// a face that is no candidate.
fn top_seeds(spot: &OpenSpot, s: usize, top: u32, out: &mut Vec<Seed>) -> bool {
    let Some(t) = spot.candidates.iter().position(|&c| c == top) else {
        return false;
    };
    let t = t as u32;
    for pair in spot.pairs.iter().filter(|p| p.lo == t || p.hi == t) {
        // From the front the top lies above the rest; from the back, below.
        let lo_above = (pair.lo == t) == (s == FRONT);
        out.push((pair.variable as usize, order_of_bit(!lo_above)));
    }
    true
}

/// The seed that puts candidate `x` of a spot above candidate `y`.
fn above(spot: &OpenSpot, x: u32, y: u32) -> Option<Seed> {
    spot.pairs
        .iter()
        .find(|p| (p.lo, p.hi) == (x, y) || (p.lo, p.hi) == (y, x))
        .map(|p| (p.variable as usize, order_of_bit(p.lo != x)))
}

/// Most pairs a spot's candidates may have for its tournaments with no top
/// to be listed: six candidates.
const TOURNAMENT_PAIRS: usize = 15;
/// Most combinations of them asked at once, across spots with no top.
const TOURNAMENT_COMBINATIONS: usize = 4096;

/// One side's open spots, searched by their tops (see the module docs).
struct Tops<'a> {
    s: usize,
    spots: &'a [OpenSpot],
    search: &'a flatfold::CompletionSession,
    seeds: &'a [Seed],
    check: &'a dyn Check,
    budget: &'a mut Budget,
    asked: &'a mut Asked,
    /// The bits the side's answers may hold in all.
    answers: u64,
    no_top: &'a mut Vec<Option<bool>>,
    /// Variables.
    n: usize,
}

impl Tops<'_> {
    /// The picture after (before) `key`, and an order that shows it.
    fn neighbour(
        &mut self,
        key: &[u32],
        direction: StepDirection,
    ) -> Result<Neighbour<Vec<u32>>, SessionRefusal> {
        let next = direction == StepDirection::Next;
        let mut prefix: Vec<u32> = Vec::with_capacity(key.len());
        for x in (0..key.len()).rev() {
            prefix.clear();
            prefix.extend_from_slice(&key[..x]);
            let mut options = self.candidates(x);
            if next {
                options.retain(|&c| c > key[x]);
                // No top comes after every face.
                if key[x] != NO_TOP {
                    options.push(NO_TOP);
                }
            } else {
                options.retain(|&c| c < key[x]);
                options.reverse();
            }
            for top in options {
                if top == NO_TOP {
                    match self.can_show_no_top(x)? {
                        Ok(true) => {}
                        Ok(false) => continue,
                        Err(OutOfTime(limit)) => return Ok(Neighbour::Undecided(limit)),
                    }
                }
                prefix.push(top);
                match self.fits(&prefix)? {
                    Fits::Fit(order) => return self.complete(prefix, order, next),
                    Fits::No => {
                        prefix.pop();
                    }
                    Fits::Unknown(limit) => return Ok(Neighbour::Undecided(limit)),
                }
            }
        }
        Ok(Neighbour::End)
    }

    /// `prefix`, which `order` shows, completed spot by spot with the
    /// smallest top that fits (the largest, stepping back).
    fn complete(
        &mut self,
        mut prefix: Vec<u32>,
        mut order: Vec<PairOrder>,
        next: bool,
    ) -> Result<Neighbour<Vec<u32>>, SessionRefusal> {
        let mut wins = Vec::new();
        for y in prefix.len()..self.spots.len() {
            let shows = top_of(
                &self.spots[y],
                self.s,
                |pair| order[pair.variable as usize] == PairOrder::FirstAbove,
                &mut wins,
            );
            let mut options = self.candidates(y);
            if next {
                options.push(NO_TOP);
            } else {
                options.reverse();
                options.insert(0, NO_TOP);
            }
            let mut chosen = None;
            for top in options {
                if top == shows {
                    chosen = Some(top);
                    break;
                }
                if top == NO_TOP {
                    match self.can_show_no_top(y)? {
                        Ok(false) => continue,
                        Ok(true) => {}
                        Err(OutOfTime(limit)) => return Ok(Neighbour::Undecided(limit)),
                    }
                }
                prefix.push(top);
                let fits = self.fits(&prefix)?;
                prefix.pop();
                match fits {
                    Fits::Fit(other) => {
                        order = other;
                        chosen = Some(top);
                        break;
                    }
                    Fits::No => {}
                    Fits::Unknown(limit) => return Ok(Neighbour::Undecided(limit)),
                }
            }
            let Some(top) = chosen else {
                return Err(SessionRefusal::internal(
                    "an order shows a top none of its spot's",
                ));
            };
            prefix.push(top);
        }
        Ok(Neighbour::Found(prefix, order))
    }

    /// Spot `i`'s candidates by face.
    fn candidates(&self, i: usize) -> Vec<u32> {
        let mut faces = self.spots[i].candidates.clone();
        faces.sort_unstable();
        faces
    }

    /// One check of `extra`, out of the step's budget: none once it is
    /// spent.
    fn ask(&mut self, extra: &[Seed]) -> Result<Fits, SessionRefusal> {
        if let Some(limit) = self.budget.reached() {
            return Ok(Fits::Unknown(limit));
        }
        let (fits, nodes) = self.check.fits(extra, &self.budget.limits())?;
        self.budget.charge(nodes);
        Ok(fits)
    }

    /// Whether the tops `prefix`, of the open spots from the first, fit
    /// with the committed constraints, and an order that shows them.
    /// Remembered.
    fn fits(&mut self, prefix: &[u32]) -> Result<Fits, SessionRefusal> {
        if let Some(known) = self.asked.answers.get(prefix) {
            return Ok(match known {
                Some(order) => Fits::Fit(order.values(self.n)),
                None => Fits::No,
            });
        }
        let mut seeds = Vec::new();
        let mut none = Vec::new();
        for (i, &top) in prefix.iter().enumerate() {
            if top == NO_TOP {
                none.push(i);
            } else if !top_seeds(&self.spots[i], self.s, top, &mut seeds) {
                return Err(SessionRefusal::internal("a top that is no candidate"));
            }
        }
        let answer = if none.is_empty() {
            self.ask(&seeds)?
        } else {
            self.fits_with_no_top(&seeds, &none)?
        };
        let room = self.answers.saturating_sub(self.asked.bits);
        match &answer {
            Fits::Fit(order) => {
                let mut wins = Vec::new();
                let shows = prefix.iter().enumerate().all(|(i, &top)| {
                    top_of(
                        &self.spots[i],
                        self.s,
                        |pair| order[pair.variable as usize] == PairOrder::FirstAbove,
                        &mut wins,
                    ) == top
                });
                if !shows {
                    return Err(SessionRefusal::internal(
                        "a check's order does not show the tops it was asked",
                    ));
                }
                self.asked.keep(prefix, Some(Packed::of(order)), room);
            }
            Fits::No => self.asked.keep(prefix, None, room),
            Fits::Unknown(_) => {}
        }
        Ok(answer)
    }

    /// [`Self::fits`] where the spots `none` show no top: each combination
    /// of their tournaments with no top, asked in turn. Too many to ask is
    /// no answer.
    fn fits_with_no_top(&mut self, seeds: &[Seed], none: &[usize]) -> Result<Fits, SessionRefusal> {
        let Some(lists) = none
            .iter()
            .map(|&i| self.tournaments(i))
            .collect::<Option<Vec<_>>>()
        else {
            return Ok(Fits::Unknown(BudgetLimit::Nodes));
        };
        let combinations = lists
            .iter()
            .try_fold(1usize, |n, list| n.checked_mul(list.len()));
        if combinations.is_none_or(|n| n > TOURNAMENT_COMBINATIONS) {
            return Ok(Fits::Unknown(BudgetLimit::Nodes));
        }
        let mut digits = vec![0usize; lists.len()];
        let mut unknown = None;
        'combinations: loop {
            let mut asked = seeds.to_vec();
            for (list, &d) in lists.iter().zip(&digits) {
                asked.extend_from_slice(&list[d]);
            }
            match self.ask(&asked)? {
                Fits::Fit(order) => return Ok(Fits::Fit(order)),
                Fits::No => {}
                Fits::Unknown(limit) => unknown = Some(limit),
            }
            for i in (0..digits.len()).rev() {
                digits[i] += 1;
                if digits[i] < lists[i].len() {
                    continue 'combinations;
                }
                digits[i] = 0;
            }
            break;
        }
        Ok(unknown.map_or(Fits::No, Fits::Unknown))
    }

    /// Spot `i`'s tournaments that leave it no top from this side, each as
    /// seeds on its candidates' pairs; `None` past [`TOURNAMENT_PAIRS`].
    fn tournaments(&self, i: usize) -> Option<Vec<Vec<Seed>>> {
        let spot = &self.spots[i];
        let m = spot.pairs.len();
        if m > TOURNAMENT_PAIRS {
            return None;
        }
        let mut wins = Vec::new();
        let mut list = Vec::new();
        for mask in 0u32..1 << m {
            let bit = |variable: u32| {
                spot.pairs
                    .iter()
                    .position(|p| p.variable == variable)
                    .is_some_and(|b| mask & (1 << b) != 0)
            };
            if top_of(spot, self.s, |pair| bit(pair.variable), &mut wins) == NO_TOP {
                list.push(
                    spot.pairs
                        .iter()
                        .enumerate()
                        .map(|(b, p)| (p.variable as usize, order_of_bit(mask & (1 << b) == 0)))
                        .collect(),
                );
            }
        }
        Some(list)
    }

    /// Whether an order that fits can leave spot `i` with no top: only if
    /// some 3-cycle of its candidates survives propagation with the
    /// committed constraints, since a tournament with no top has one, and
    /// candidates that share a cell never do. Remembered.
    fn can_show_no_top(&mut self, i: usize) -> Result<Result<bool, OutOfTime>, SessionRefusal> {
        if let Some(known) = self.no_top[i] {
            return Ok(Ok(known));
        }
        let spot = &self.spots[i];
        let k = spot.candidates.len() as u32;
        let deadline = self.budget.search().deadline;
        let mut can = false;
        'cycles: for a in 0..k {
            for b in a + 1..k {
                for c in b + 1..k {
                    for [x, y, z] in [[a, b, c], [a, c, b]] {
                        let cycle: Option<Vec<Seed>> =
                            [above(spot, x, y), above(spot, y, z), above(spot, z, x)]
                                .into_iter()
                                .collect();
                        let Some(cycle) = cycle else {
                            return Err(SessionRefusal::internal("a spot misses a pair"));
                        };
                        let Some(seeds) = merged(self.seeds, &cycle) else {
                            continue;
                        };
                        match self
                            .search
                            .deduce(&seeds, deadline)
                            .map_err(internal_search)?
                        {
                            Deduction::Deduced(_) => {
                                can = true;
                                break 'cycles;
                            }
                            Deduction::Undecided { limit } => {
                                return Ok(Err(OutOfTime(complete::budget_limit(limit))));
                            }
                            Deduction::Forced { .. } | Deduction::Conflict(_) => {}
                        }
                    }
                }
            }
        }
        self.no_top[i] = Some(can);
        Ok(Ok(can))
    }
}

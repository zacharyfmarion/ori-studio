//! A completion kept open for many questions about one problem: what the
//! Layer order dialog asks ("can X be on top here?", "can A be above B?").
//!
//! [`complete_layer_order`](crate::complete_layer_order) answers a question
//! from scratch: it validates the problem, propagates every fixed order,
//! splits what is left into components and searches each, past the first
//! order to tell a truncated count. Asked again with one more seed, it
//! repeats all of it. [`CompletionSession::open`] does the part that every
//! question shares once: the validated tables, the propagation of the
//! problem's own fixed orders with its parent pointers, the components of
//! what is left, and a first order. [`CompletionSession::check`] then
//! answers one question, the problem's fixed orders plus a few seeds, from
//! that state.
//!
//! # What a check does, and why its verdicts are the same
//!
//! 1. A seed against a pair the open already forced is refused before any
//!    work, with the faces that pair traces back to.
//! 2. The other seeds are propagated from the open's state, through
//!    Flat-Folder's own propagation, with parent pointers continuing the
//!    open's, so a conflict traces back through both to the letters and the
//!    seeds (upstream `error_faces`). Unit propagation reaches the same
//!    closure in any order, and finds a conflict exactly when the closure
//!    has one, so this agrees with propagating everything from scratch.
//! 3. The open's components are independent: every constraint that joins
//!    variables of two of them is dead (all its completions are valid), and
//!    stays dead whatever else is assigned. A seed's propagation therefore
//!    stays inside its component, and only the components it reached are
//!    searched again; the others keep their order. This rests on every
//!    constraint being listed in the bucket of every variable it reads, as
//!    upstream lists it: a constraint missing from one variable's bucket is
//!    never seen from that variable, and could join two components that
//!    look independent. The open refuses such a problem
//!    ([`VariableConstraints`](crate::VariableConstraints)).
//! 4. Each reached component is searched for one order, first with its new
//!    seeds' faces' pairs first, then in the open's order, each within a
//!    small node budget, and each with the preferred order's values and then
//!    with upstream's (1 first). Exhausting any of them is a proof that the
//!    component, and so the question, has no order.
//! 5. If neither answers within its budget, the check falls back to exactly
//!    Flat-Folder's procedure on what is left of those components: split
//!    into components, smallest first, each searched in its own order with
//!    upstream's value order, within the caller's node budget. That uses at
//!    most the nodes a fresh `complete_layer_order` would (it skips the
//!    components nothing reached, and stops at one order instead of two), so
//!    whenever a fresh completion decides within a budget, so does a check.
//!    Only when that budget runs out too is the answer
//!    [`CheckOutcome::Undecided`], never a verdict.
//!
//! A preferred order ([`CheckOptions::prefer`], the order on screen) only
//! changes which value each guess of step 4 tries first, so the order found
//! changes as little as possible. Every step-4 search it steers is followed
//! by the same search without it, and step 5 never uses it, so within the
//! same node budgets a check with a preference decides every question the
//! check without one decides, the same way (a deadline can still run out
//! sooner, since it searches more). The components nothing reached keep the preferred order
//! where it is the open's, and are searched with it otherwise.
//!
//! # What the Layer order dialog adds (ours, beside the port)
//!
//! - [`CompletionSession::deduce`] is steps 1–2 alone: what the problem's
//!   fixed orders and the seeds force, with no search. Removing a constraint
//!   needs nothing more, since the order on screen already satisfies every
//!   subset of the constraints.
//! - [`CompletionSession::enumerate`] lists every complete order a deduction
//!   leaves, one at a time, through a cursor ([`Enumeration`]) that a node
//!   budget or a deadline stops and the next call resumes. It splits what is
//!   left exactly as completing from scratch with those seeds does, searches
//!   each component with upstream's search, and walks their product, the
//!   first component slowest, so its orders are
//!   [`complete_layer_order`](crate::complete_layer_order)'s, every one
//!   listed, in that order.
//! - [`CheckOptions::prefer_fits`]: when the caller vouches that the
//!   preferred order is a complete order that fits (an earlier check's fit),
//!   every component on which it agrees with what the seeds force keeps it
//!   with no search, the components the seeds did not reach among them. The
//!   components are independent, so the order kept there still fits; without
//!   the option a component nothing reached is searched again unless the
//!   preference is the open's first order there, and can fall back to that
//!   first order when its quick search runs out of nodes.
//! - Every "no" names its roots ([`CompletionConflict::roots`],
//!   [`CheckNoOrder::roots`], [`CheckOutcome::Forced`]): the fixed orders and
//!   seeds its trace leads back to, as variables. Those alone, with the
//!   constraints, already have no order, so a smallest clashing set of seeds
//!   is among them.

use std::collections::BTreeMap;

use crate::CompletionError;
use crate::completion::{
    BudgetLimit, BudgetMeter, CompletionConflict, CompletionProblem, CompletionResult, Deadline,
    PairOrder, SearchBudget, SearchInput, UnsatisfiedComponent, fixed_orders, group_faces, invalid,
    public_conflict,
};
use crate::constraints::{
    self, ImplicationMaps, Parent, Propagated, Search, SearchTables, Traced, TransitivityCounts,
    TransitivitySource,
};
use crate::tables::Scratch;

/// What opening a session found.
#[derive(Debug, Clone)]
pub enum SessionStart {
    Open(Box<CompletionSession>),
    /// The problem's own fixed orders conflict: no question has an order.
    Conflict(CompletionConflict),
    /// A component has no order under the problem's own fixed orders.
    UnsatisfiedComponent(UnsatisfiedComponent),
}

/// See the module docs.
#[derive(Debug, Clone)]
pub struct CompletionSession {
    faces_cells: Vec<Vec<usize>>,
    cells_faces: Vec<Vec<usize>>,
    input: SearchInput,
    /// After propagating the problem's own fixed orders.
    base: Propagated,
    /// Per variable, whether the open's propagation visited it: a seed or
    /// an implied order. A carried pair is assigned but never visited.
    visited: Vec<bool>,
    /// What the propagation leaves, in independent components, smallest
    /// first, each in its breadth-first order (upstream `get_components`).
    components: Vec<Vec<usize>>,
    /// Per variable, its component, or `u32::MAX` when the open forced it.
    component_of: Vec<u32>,
    /// The open's first order: one solution per component, every variable
    /// 1 or 2.
    first: Vec<u8>,
    nodes: u64,
}

/// What a check may spend and which order it prefers.
#[derive(Debug, Clone, Copy)]
pub struct CheckOptions<'a> {
    /// `max_nodes` bounds the exhaustive fallback (step 5 of the module
    /// docs); the deadline bounds the whole check.
    pub budget: SearchBudget,
    /// Search nodes for each quick attempt (step 4): two, or four with a
    /// preferred order.
    pub fast_nodes: u64,
    /// One order per variable: each guess tries this order's value first.
    pub prefer: Option<&'a [PairOrder]>,
    /// The caller vouches that [`Self::prefer`] is a complete order that
    /// fits the problem, such as an earlier check's fit (ours). Every
    /// component on which it agrees with what the seeds force then keeps it
    /// without a search, every component the seeds did not reach among
    /// them. Read only with a preference. An order that does not fit can
    /// make the answer wrong, so it is set only for one known to fit.
    pub prefer_fits: bool,
}

impl CheckOptions<'_> {
    /// Quick attempts' nodes unless the caller says otherwise: enough for
    /// every "on top here" check the iguana profile sampled (26 nodes with
    /// the seeds' pairs first), and a few seconds at most on its deepest
    /// stack, where one node costs 15–55 ms.
    pub const DEFAULT_FAST_NODES: u64 = 128;
}

impl Default for CheckOptions<'_> {
    fn default() -> Self {
        CheckOptions {
            budget: SearchBudget {
                max_nodes: Some(200_000),
                deadline: None,
            },
            fast_nodes: Self::DEFAULT_FAST_NODES,
            prefer: None,
            prefer_fits: false,
        }
    }
}

/// Which step of a check settled it (the module docs' numbering).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum CheckStage {
    /// Nothing new to search: every seed was already forced, or reached no
    /// component, or reached only components the vouched-for preference
    /// already agreed with ([`CheckOptions::prefer_fits`]).
    Unchanged,
    /// Step 4 with the seeds' pairs first.
    SeedsFirst,
    /// Step 4 in the open's order.
    OpenOrder,
    /// Step 5: Flat-Folder's own split and order.
    Exhaustive,
}

/// An order that fits the problem and the seeds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckFit {
    /// One order per variable.
    pub order: Vec<PairOrder>,
    /// What the problem's fixed orders and the seeds force, before any
    /// search: what a dialog shows as decided.
    pub forced: Vec<Option<PairOrder>>,
    pub nodes: u64,
    /// The last step that had to search.
    pub stage: CheckStage,
}

/// A search proved that no order fits.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckNoOrder {
    /// The faces of the component with no order, in its search order.
    pub faces: Vec<usize>,
    /// The faces that component's constraints read through assigned pairs,
    /// traced back through the propagation to the letters and seeds that
    /// decided them, ascending.
    pub error_faces: Vec<usize>,
    /// The fixed orders and seeds that trace reaches, as variables,
    /// ascending (ours): the component has no order with them alone.
    pub roots: Vec<usize>,
    pub nodes: u64,
    pub stage: CheckStage,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CheckOutcome {
    Fits(CheckFit),
    /// A seed asks the opposite of what the open forced. `error_faces` are
    /// the faces that pair traces back to, and `roots` the problem's fixed
    /// orders that force it, as variables, ascending (ours).
    Forced {
        variable: usize,
        error_faces: Vec<usize>,
        roots: Vec<usize>,
    },
    /// Propagating the seeds broke a constraint.
    Conflict(CompletionConflict),
    NoOrder(CheckNoOrder),
    /// No answer within the budget: neither a fit nor a proof.
    Undecided {
        limit: BudgetLimit,
        nodes: u64,
    },
}

/// What [`CompletionSession::deduce`] found: a check's steps 1–2 (ours).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Deduction {
    /// The seeds propagate without a conflict.
    Deduced(Deduced),
    /// As [`CheckOutcome::Forced`].
    Forced {
        variable: usize,
        error_faces: Vec<usize>,
        roots: Vec<usize>,
    },
    /// As [`CheckOutcome::Conflict`].
    Conflict(CompletionConflict),
    /// The deadline ran out first.
    Undecided { limit: BudgetLimit },
}

/// What the problem's fixed orders and some seeds force, by propagation
/// alone (ours): what a check's [`CheckFit::forced`] holds, and what an
/// [`Enumeration`] starts from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Deduced {
    /// Per variable, its forced value (1 or 2), or 0 where it is open.
    assignments: Vec<u8>,
}

impl Deduced {
    /// Each variable's forced order, `None` where it is open.
    pub fn forced(&self) -> Vec<Option<PairOrder>> {
        self.assignments
            .iter()
            .map(|&v| PairOrder::from_value(v))
            .collect()
    }
}

/// A cursor over every complete order a [`Deduced`] state leaves (ours; see
/// the module docs). It keeps the search's stack between calls, so a call
/// its budget stops resumes where it stopped.
#[derive(Debug, Clone)]
pub struct Enumeration {
    /// The deduced orders, and each component's current order once found.
    assignments: Vec<u8>,
    /// What the deduction leaves, split as completing from scratch splits
    /// it, smallest first.
    components: Vec<Vec<usize>>,
    /// Per component, its search so far.
    searches: Vec<Search>,
    /// The component whose search runs next.
    at: usize,
    /// Complete orders yielded so far.
    yielded: u64,
    /// Whether the last call yielded one, so [`Self::order`] reads it.
    current: bool,
    /// Once reached, the end every later call returns.
    end: Option<EnumerationStep>,
    nodes: u64,
    scratch: Scratch,
}

/// What one [`Enumeration::next`] call reached.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EnumerationStep {
    /// The next complete order: read it with [`Enumeration::order`].
    Order,
    /// Every complete order has been yielded.
    Exhausted,
    /// A component has no order, so none fits, found before any order is
    /// yielded: as [`Completion::UnsatisfiedComponent`](crate::Completion)
    /// reports it from scratch.
    Unsatisfied(UnsatisfiedComponent),
    /// The call's budget ran out; the next call resumes here.
    Stopped(BudgetLimit),
}

impl Enumeration {
    /// Search on to the next complete order within `budget`, which bounds
    /// this call alone.
    ///
    /// `session` must be the one the deduction came from.
    pub fn next(
        &mut self,
        session: &CompletionSession,
        budget: SearchBudget,
    ) -> CompletionResult<EnumerationStep> {
        use EnumerationStep as Step;
        self.current = false;
        if let Some(end) = &self.end {
            return Ok(end.clone());
        }
        if self.assignments.len() != session.base.assignments.len() {
            return Err(invalid(format!(
                "an enumeration of {} variables resumed on a session of {}",
                self.assignments.len(),
                session.base.assignments.len()
            )));
        }
        if self.components.is_empty() {
            // Everything is forced: one order.
            if self.yielded == 0 {
                self.yielded = 1;
                self.current = true;
                return Ok(Step::Order);
            }
            self.end = Some(Step::Exhausted);
            return Ok(Step::Exhausted);
        }
        let tables = session.tables();
        let mut meter = BudgetMeter::new(budget);
        let step = loop {
            let k = self.at;
            let searched = self.searches[k].run(
                &tables,
                &self.components[k],
                &mut self.assignments,
                1,
                &mut meter,
                |_| 1,
                &mut self.scratch,
                |_| {},
            )?;
            match searched {
                Err(limit) => break Step::Stopped(limit),
                // Exhausted before a first order of its own: the components
                // are independent, so none fits.
                Ok(0) if self.yielded == 0 => {
                    let end = Step::Unsatisfied(UnsatisfiedComponent {
                        component: k,
                        faces: group_faces(&session.input.data, &self.components[k]),
                    });
                    self.end = Some(end.clone());
                    break end;
                }
                Ok(0) if k == 0 => {
                    self.end = Some(Step::Exhausted);
                    break Step::Exhausted;
                }
                // Every order of this component has been walked with the
                // ones before it as they are: the one before moves on.
                Ok(0) => self.at -= 1,
                Ok(_) if k + 1 == self.components.len() => {
                    if let Some(v) = self.assignments.iter().position(|&a| a == 0) {
                        return Err(invalid(format!("an enumeration left variable {v} open")));
                    }
                    self.yielded += 1;
                    self.current = true;
                    break Step::Order;
                }
                // The next component starts again from its first order.
                Ok(_) => {
                    self.at += 1;
                    self.searches[self.at] = Search::default();
                }
            }
        };
        self.nodes += meter.nodes;
        Ok(step)
    }

    /// The complete order the last call yielded, one per variable; `None`
    /// unless it yielded one.
    pub fn order(&self) -> Option<Vec<PairOrder>> {
        self.current.then(|| orders_of(&self.assignments))
    }

    /// What the deduction leaves, in independent components, smallest
    /// first, each in its search order: as completing from scratch with the
    /// same seeds splits it.
    pub fn components(&self) -> &[Vec<usize>] {
        &self.components
    }

    /// Search nodes used over every call so far.
    pub fn nodes(&self) -> u64 {
        self.nodes
    }
}

/// How one search attempt ended.
enum Attempt {
    Found,
    Exhausted,
    Stopped(BudgetLimit),
}

/// What a check's steps 1–2 reached.
enum Seeded {
    /// The closure, and each seed's value by variable.
    Closure {
        state: Propagated,
        wanted: BTreeMap<usize, u8>,
    },
    Forced {
        variable: usize,
        error_faces: Vec<usize>,
        roots: Vec<usize>,
    },
    Conflict(CompletionConflict),
    Undecided(BudgetLimit),
}

impl CompletionSession {
    /// Validate `problem`, propagate its fixed orders, split what is left
    /// and find a first order, one per component, within `budget`.
    ///
    /// Besides what [`complete_layer_order`](crate::complete_layer_order)
    /// validates, refuses a constraint missing from the bucket of a variable
    /// it reads (the module docs, step 3).
    pub fn open(
        problem: CompletionProblem,
        budget: SearchBudget,
    ) -> CompletionResult<SessionStart> {
        Self::open_with_tables(problem, budget, crate::tables::DENSE_FACE_LIMIT)
    }

    /// [`Self::open`] with its tables dense up to `dense_limit` faces.
    fn open_with_tables(
        problem: CompletionProblem,
        budget: SearchBudget,
        dense_limit: usize,
    ) -> CompletionResult<SessionStart> {
        let input = SearchInput::with_dense_limit(&problem, dense_limit)?;
        input.check_every_bucket()?;
        let fixed = fixed_orders(&problem)?;
        let CompletionProblem {
            faces_cells,
            cells_faces,
            ..
        } = problem;
        let tables = tables_of(&input, &faces_cells, &cells_faces);
        let mut meter = BudgetMeter::new(budget);
        let mut counts = TransitivityCounts::default();
        let mut scratch = tables.scratch();
        let mut base = Propagated {
            parents: constraints::roots(&fixed.assignments),
            assignments: fixed.assignments,
        };
        let mut visited = vec![false; base.assignments.len()];
        for &(variable, _) in &fixed.seeds {
            visited[variable] = true;
        }
        match constraints::propagate_levels(
            &tables,
            &mut base,
            fixed.seeds,
            &mut counts,
            &mut meter,
            &mut scratch,
        )? {
            Err(limit) => {
                return Err(CompletionError::BudgetExceeded {
                    limit,
                    nodes: meter.nodes,
                });
            }
            Ok(Some(conflict)) => return Ok(SessionStart::Conflict(public_conflict(conflict))),
            Ok(None) => {}
        }
        for (seen, parent) in visited.iter_mut().zip(&base.parents) {
            *seen |= matches!(parent, Some(Parent::Implied { .. }));
        }
        let components: Vec<Vec<usize>> =
            constraints::variable_groups(&tables, &base.assignments, None)
                .into_iter()
                .skip(1)
                .collect();
        let mut component_of = vec![u32::MAX; base.assignments.len()];
        for (k, component) in components.iter().enumerate() {
            let k = u32::try_from(k).map_err(|_| invalid("too many components".to_string()))?;
            for &v in component {
                component_of[v] = k;
            }
        }
        // The components are independent, so searching them one after the
        // other in one assignment finds what searching each from the
        // propagation would.
        let mut first = base.assignments.clone();
        for (k, component) in components.iter().enumerate() {
            match constraints::search(
                &tables,
                component,
                &mut first,
                1,
                &mut meter,
                |_| 1,
                &mut scratch,
                |_| {},
            )? {
                Err(limit) => {
                    return Err(CompletionError::BudgetExceeded {
                        limit,
                        nodes: meter.nodes,
                    });
                }
                Ok(0) => {
                    return Ok(SessionStart::UnsatisfiedComponent(UnsatisfiedComponent {
                        component: k,
                        faces: group_faces(&input.data, component),
                    }));
                }
                Ok(_) => {}
            }
        }
        let nodes = meter.nodes;
        Ok(SessionStart::Open(Box::new(CompletionSession {
            faces_cells,
            cells_faces,
            input,
            base,
            visited,
            components,
            component_of,
            first,
            nodes,
        })))
    }

    fn tables(&self) -> SearchTables<'_> {
        tables_of(&self.input, &self.faces_cells, &self.cells_faces)
    }

    /// Each variable's order as the problem's fixed orders force it.
    pub fn forced(&self) -> Vec<Option<PairOrder>> {
        self.base
            .assignments
            .iter()
            .map(|&v| PairOrder::from_value(v))
            .collect()
    }

    /// The open's first order, one per variable: the first order of each
    /// component, as [`crate::complete_layer_order`] lists it.
    pub fn first(&self) -> Vec<PairOrder> {
        orders_of(&self.first)
    }

    /// What the propagation left, in independent components, smallest
    /// first.
    pub fn components(&self) -> &[Vec<usize>] {
        &self.components
    }

    /// Search nodes the open used.
    pub fn nodes(&self) -> u64 {
        self.nodes
    }

    /// The faces a forced variable traces back to through the open's
    /// propagation: why it is forced.
    pub fn forced_by(&self, variable: usize) -> Vec<usize> {
        if self.base.assignments.get(variable).is_none_or(|&v| v == 0) {
            return Vec::new();
        }
        constraints::traced_faces(
            &self.tables(),
            vec![variable],
            &self.base.assignments,
            &self.base.parents,
        )
    }

    /// What the problem's fixed orders and `seeds` force, by propagation
    /// alone, with no search (ours): a check's steps 1–2, so its refusals
    /// are a check's, and a [`Deduction::Deduced`] holds what that check's
    /// fit would call forced. Only a search finds a component with no
    /// order, so a deduction can leave open what a check refuses.
    pub fn deduce(
        &self,
        seeds: &[(usize, PairOrder)],
        deadline: Option<Deadline>,
    ) -> CompletionResult<Deduction> {
        let tables = self.tables();
        let mut scratch = tables.scratch();
        Ok(match self.seeded(&tables, seeds, deadline, &mut scratch)? {
            Seeded::Closure { state, .. } => Deduction::Deduced(Deduced {
                assignments: state.assignments,
            }),
            Seeded::Forced {
                variable,
                error_faces,
                roots,
            } => Deduction::Forced {
                variable,
                error_faces,
                roots,
            },
            Seeded::Conflict(conflict) => Deduction::Conflict(conflict),
            Seeded::Undecided(limit) => Deduction::Undecided { limit },
        })
    }

    /// A cursor over every complete order `deduced` leaves, which must come
    /// from this session's [`Self::deduce`] (ours; see the module docs).
    /// Nothing is searched until [`Enumeration::next`].
    pub fn enumerate(&self, deduced: &Deduced) -> CompletionResult<Enumeration> {
        let n = self.base.assignments.len();
        if deduced.assignments.len() != n {
            return Err(invalid(format!(
                "a deduction of {} variables for a session of {n}",
                deduced.assignments.len()
            )));
        }
        let tables = self.tables();
        // Upstream's split of the closure, as completing from scratch
        // splits it: what the module docs promise rests on it.
        let components: Vec<Vec<usize>> =
            constraints::variable_groups(&tables, &deduced.assignments, None)
                .into_iter()
                .skip(1)
                .collect();
        Ok(Enumeration {
            assignments: deduced.assignments.clone(),
            searches: vec![Search::default(); components.len()],
            components,
            at: 0,
            yielded: 0,
            current: false,
            end: None,
            nodes: 0,
            scratch: tables.scratch(),
        })
    }

    /// Steps 1–2 of a check: each seed once, by variable, one against a
    /// pair the open forced refused at once, and the others propagated from
    /// the open's state within `deadline`.
    fn seeded(
        &self,
        tables: &SearchTables<'_>,
        seeds: &[(usize, PairOrder)],
        deadline: Option<Deadline>,
        scratch: &mut Scratch,
    ) -> CompletionResult<Seeded> {
        let n = self.base.assignments.len();
        let deadline_only = SearchBudget {
            max_nodes: None,
            deadline,
        };
        if BudgetMeter::new(deadline_only).past_deadline() {
            return Ok(Seeded::Undecided(BudgetLimit::Deadline));
        }

        // 1. Each seed once, by variable; one against a forced pair is
        // refused at once.
        let mut wanted = BTreeMap::new();
        for &(variable, order) in seeds {
            if variable >= n {
                return Err(invalid(format!(
                    "a seed names variable {variable}, but there are {n}"
                )));
            }
            if wanted.insert(variable, order.value()) == Some(3 - order.value()) {
                return Err(invalid(format!(
                    "variable {variable} is fixed to both orders"
                )));
            }
        }
        let mut level = Vec::new();
        for (&variable, &value) in &wanted {
            match self.base.assignments[variable] {
                0 => level.push((variable, value)),
                // Already visited with this order: nothing new to propagate.
                forced if forced == value && self.visited[variable] => {}
                // Carried with this order: a seed now, so propagated, as
                // completing from scratch would.
                carried if carried == value => level.push((variable, value)),
                _ => {
                    let Traced { faces, roots } = constraints::traced(
                        tables,
                        vec![variable],
                        &self.base.assignments,
                        &self.base.parents,
                    );
                    return Ok(Seeded::Forced {
                        variable,
                        error_faces: faces,
                        roots,
                    });
                }
            }
        }

        // 2. Propagate the new seeds from the open's state.
        let mut state = self.base.clone();
        for &(variable, _) in &level {
            state.parents[variable] = Some(Parent::Root);
        }
        let mut counts = TransitivityCounts::default();
        let mut meter = BudgetMeter::new(deadline_only);
        Ok(
            match constraints::propagate_levels(
                tables,
                &mut state,
                level,
                &mut counts,
                &mut meter,
                scratch,
            )? {
                Err(limit) => Seeded::Undecided(limit),
                Ok(Some(conflict)) => Seeded::Conflict(public_conflict(conflict)),
                Ok(None) => Seeded::Closure { state, wanted },
            },
        )
    }

    /// Whether the problem's fixed orders and `seeds` allow an order, and
    /// one that fits (see the module docs).
    pub fn check(
        &self,
        seeds: &[(usize, PairOrder)],
        options: &CheckOptions<'_>,
    ) -> CompletionResult<CheckOutcome> {
        let tables = self.tables();
        let n = self.base.assignments.len();
        let prefer = match options.prefer {
            Some(prefer) if prefer.len() != n => {
                return Err(invalid(format!(
                    "the preferred order has {} pairs for {n} variables",
                    prefer.len()
                )));
            }
            Some(prefer) => Some(prefer),
            None => None,
        };

        // 1–2. The seeds' closure.
        let mut scratch = tables.scratch();
        let (state, wanted) =
            match self.seeded(&tables, seeds, options.budget.deadline, &mut scratch)? {
                Seeded::Closure { state, wanted } => (state, wanted),
                Seeded::Forced {
                    variable,
                    error_faces,
                    roots,
                } => {
                    return Ok(CheckOutcome::Forced {
                        variable,
                        error_faces,
                        roots,
                    });
                }
                Seeded::Conflict(conflict) => return Ok(CheckOutcome::Conflict(conflict)),
                Seeded::Undecided(limit) => {
                    return Ok(CheckOutcome::Undecided { limit, nodes: 0 });
                }
            };
        let post = state.assignments.clone();

        // 3. The components the seeds reached.
        let mut touched = vec![false; self.components.len()];
        let reached = post
            .iter()
            .zip(&self.base.assignments)
            .enumerate()
            .filter(|(_, (now, before))| **now != 0 && **before == 0);
        for (v, _) in reached {
            let k = self.component_of[v];
            let Some(slot) = touched.get_mut(k as usize) else {
                return Err(invalid(format!(
                    "variable {v} was open after the open but in no component"
                )));
            };
            *slot = true;
        }

        // 4. Search the reached components quickly; keep the others.
        let mut focus = vec![false; self.faces_cells.len()];
        for &variable in wanted.keys() {
            for face in self.input.data.faces(variable) {
                focus[face] = true;
            }
        }
        let first_value = |v: usize| prefer.map_or(1, |p| p[v].value());
        let mut assignments = post.clone();
        let mut nodes = 0u64;
        let mut stage = CheckStage::Unchanged;
        let mut pending = Vec::new();
        let no_order = |group: &[usize], nodes: u64, stage: CheckStage| {
            let Traced {
                faces: error_faces,
                roots,
            } = constraints::traced(
                &tables,
                constraints::assigned_reads(&tables, group, &post),
                &post,
                &state.parents,
            );
            CheckOutcome::NoOrder(CheckNoOrder {
                faces: group_faces(&self.input.data, group),
                error_faces,
                roots,
                nodes,
                stage,
            })
        };
        let vouched = prefer.filter(|_| options.prefer_fits);
        for (k, component) in self.components.iter().enumerate() {
            let remaining: Vec<usize> = component
                .iter()
                .copied()
                .filter(|&v| assignments[v] == 0)
                .collect();
            if remaining.is_empty() {
                continue;
            }
            // A complete order that fits, and agrees with everything the
            // seeds force here, still fits here: the component's
            // constraints read only its own pairs and ones the open forced,
            // and those joining it to another component are dead.
            if let Some(p) = vouched
                && component
                    .iter()
                    .all(|&v| post[v] == 0 || post[v] == p[v].value())
            {
                for &v in &remaining {
                    assignments[v] = p[v].value();
                }
                continue;
            }
            if !touched[k] {
                // Unchanged: the open's order, or the preferred one where it
                // still fits. Where the preferred order is the open's, it
                // is known to fit without a search.
                let keeps_first =
                    prefer.is_none_or(|p| remaining.iter().all(|&v| p[v].value() == self.first[v]));
                if keeps_first {
                    for &v in &remaining {
                        assignments[v] = self.first[v];
                    }
                    continue;
                }
                match self.attempt(
                    &tables,
                    &remaining,
                    &mut assignments,
                    &first_value,
                    options.fast_nodes,
                    options,
                    &mut nodes,
                    &mut scratch,
                )? {
                    Attempt::Found => {}
                    Attempt::Exhausted => {
                        return Err(invalid(format!(
                            "component {k} lost the order the open found"
                        )));
                    }
                    Attempt::Stopped(BudgetLimit::Nodes) => {
                        for &v in &remaining {
                            assignments[v] = self.first[v];
                        }
                    }
                    Attempt::Stopped(limit) => {
                        return Ok(CheckOutcome::Undecided { limit, nodes });
                    }
                }
                continue;
            }
            let rank = |v: usize| {
                let [a, b] = self.input.data.faces(v);
                2 - usize::from(focus[a]) - usize::from(focus[b])
            };
            let mut seeds_first = remaining.clone();
            seeds_first.sort_by_key(|&v| rank(v));
            // Each order with the preferred values, then, when there are
            // any, with upstream's: a preference can mislead a quick search,
            // and must never lose an answer the check without it finds.
            let preferred: &dyn Fn(usize) -> u8 = &first_value;
            let upstream: &dyn Fn(usize) -> u8 = &|_| 1;
            let mut tries = Vec::with_capacity(4);
            for (order, attempt_stage) in [
                (&seeds_first, CheckStage::SeedsFirst),
                (&remaining, CheckStage::OpenOrder),
            ] {
                tries.push((order, preferred, attempt_stage));
                if prefer.is_some() {
                    tries.push((order, upstream, attempt_stage));
                }
            }
            let mut settled = false;
            for (order, values, attempt_stage) in tries {
                match self.attempt(
                    &tables,
                    order,
                    &mut assignments,
                    values,
                    options.fast_nodes,
                    options,
                    &mut nodes,
                    &mut scratch,
                )? {
                    Attempt::Found => {
                        stage = stage.max(attempt_stage);
                        settled = true;
                        break;
                    }
                    Attempt::Exhausted => return Ok(no_order(&remaining, nodes, attempt_stage)),
                    Attempt::Stopped(BudgetLimit::Nodes) => {}
                    Attempt::Stopped(limit) => {
                        return Ok(CheckOutcome::Undecided { limit, nodes });
                    }
                }
            }
            if !settled {
                pending.push(k);
            }
        }

        // 5. Flat-Folder's own split and order over what is left.
        if !pending.is_empty() {
            stage = CheckStage::Exhaustive;
            let mut seen = vec![false; n];
            let mut groups = Vec::new();
            for &k in &pending {
                let mut members: Vec<usize> = self.components[k]
                    .iter()
                    .copied()
                    .filter(|&v| assignments[v] == 0)
                    .collect();
                members.sort_unstable();
                for v in members {
                    if !seen[v] {
                        groups.push(constraints::group_from(
                            &tables,
                            &assignments,
                            v,
                            &mut seen,
                            None,
                            &mut scratch,
                        ));
                    }
                }
            }
            // Upstream sorts every group by size, keeping the order they
            // were found in, which is by their first variable.
            groups.sort_by_key(|group| (group.len(), group[0]));
            let mut meter = BudgetMeter::new(options.budget);
            for group in &groups {
                match constraints::search(
                    &tables,
                    group,
                    &mut assignments,
                    1,
                    &mut meter,
                    |_| 1,
                    &mut scratch,
                    |_| {},
                )? {
                    Err(limit) => {
                        return Ok(CheckOutcome::Undecided {
                            limit,
                            nodes: nodes + meter.nodes,
                        });
                    }
                    Ok(0) => {
                        return Ok(no_order(group, nodes + meter.nodes, stage));
                    }
                    Ok(_) => {}
                }
            }
            nodes += meter.nodes;
        }
        if let Some(v) = assignments.iter().position(|&a| a == 0) {
            return Err(invalid(format!("a check left variable {v} open")));
        }
        Ok(CheckOutcome::Fits(CheckFit {
            order: orders_of(&assignments),
            forced: post.iter().map(|&v| PairOrder::from_value(v)).collect(),
            nodes,
            stage,
        }))
    }

    /// One search for one order over `order` within `max_nodes`, undoing
    /// itself unless it found one.
    #[allow(clippy::too_many_arguments)]
    fn attempt(
        &self,
        tables: &SearchTables<'_>,
        order: &[usize],
        assignments: &mut Vec<u8>,
        first_value: &dyn Fn(usize) -> u8,
        max_nodes: u64,
        options: &CheckOptions<'_>,
        nodes: &mut u64,
        scratch: &mut Scratch,
    ) -> CompletionResult<Attempt> {
        let snapshot = assignments.clone();
        let mut meter = BudgetMeter::new(SearchBudget {
            max_nodes: Some(max_nodes),
            deadline: options.budget.deadline,
        });
        let searched = constraints::search(
            tables,
            order,
            assignments,
            1,
            &mut meter,
            first_value,
            scratch,
            |_| {},
        )?;
        *nodes += meter.nodes;
        Ok(match searched {
            Ok(found) if found > 0 => Attempt::Found,
            Ok(_) => Attempt::Exhausted,
            Err(limit) => {
                *assignments = snapshot;
                Attempt::Stopped(limit)
            }
        })
    }
}

fn tables_of<'a>(
    input: &'a SearchInput,
    faces_cells: &'a [Vec<usize>],
    cells_faces: &'a [Vec<usize>],
) -> SearchTables<'a> {
    SearchTables {
        data: &input.data,
        transitivity: TransitivitySource {
            faces_cells,
            cells_faces,
        },
        implications: ImplicationMaps::shared(),
    }
}

/// A full assignment, every value 1 or 2, as orders.
fn orders_of(assignments: &[u8]) -> Vec<PairOrder> {
    assignments
        .iter()
        .map(|&v| PairOrder::from_value(v).unwrap_or(PairOrder::FirstAbove))
        .collect()
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;
    use crate::completion::{
        Completion, CompletionOptions, FixedAssignment, FixedKind, VariableConstraints,
        complete_layer_order,
    };
    use crate::{AnalyzeOptions, SolutionLimit, analyze_flat_fold, flat_folder_completion_problem};

    /// Faces `0..n` stacked in one cell.
    fn one_cell(n: usize) -> CompletionProblem {
        let variables = (0..n)
            .flat_map(|a| (a + 1..n).map(move |b| [a, b]))
            .collect::<Vec<_>>();
        CompletionProblem {
            constraints: vec![VariableConstraints::default(); variables.len()],
            variables,
            faces_cells: vec![vec![0]; n],
            cells_faces: vec![(0..n).collect()],
            fixed: Vec::new(),
        }
    }

    /// Two stacks of three, faces 0–2 in cell 0 and 3–5 in cell 1, tied by
    /// a tortilla-tortilla: 0–2 stacks like 3–5.
    fn two_stacks() -> CompletionProblem {
        let mut variables = Vec::new();
        for base in [0, 3] {
            for a in base..base + 3 {
                for b in a + 1..base + 3 {
                    variables.push([a, b]);
                }
            }
        }
        let mut constraints = vec![VariableConstraints::default(); variables.len()];
        let tie = [0, 3, 2, 5];
        for (v, pair) in variables.iter().enumerate() {
            if *pair == [0, 2] || *pair == [3, 5] {
                constraints[v].tortilla_tortilla.push(tie);
            }
        }
        CompletionProblem {
            variables,
            constraints,
            faces_cells: vec![vec![0], vec![0], vec![0], vec![1], vec![1], vec![1]],
            cells_faces: vec![vec![0, 1, 2], vec![3, 4, 5]],
            fixed: Vec::new(),
        }
    }

    fn kabuto() -> CompletionProblem {
        let document: treemaker_fold::FoldDocument = serde_json::from_str(include_str!(
            "../../../tests/fixtures/flat-folder/kabuto.fold"
        ))
        .unwrap_or_else(|e| panic!("{e}"));
        let analysis = analyze_flat_fold(&document, AnalyzeOptions::default())
            .unwrap_or_else(|e| panic!("{e}"));
        flat_folder_completion_problem(&analysis).unwrap_or_else(|e| panic!("{e}"))
    }

    fn open(problem: &CompletionProblem, dense_limit: usize) -> CompletionSession {
        match CompletionSession::open_with_tables(
            problem.clone(),
            SearchBudget::default(),
            dense_limit,
        ) {
            Ok(SessionStart::Open(session)) => *session,
            other => panic!("expected an open session, got {other:?}"),
        }
    }

    /// `problem` with `seeds` added, completed from scratch with up to
    /// `limit` orders per component; `None` when the seeds and fixed orders
    /// ask both orders of one variable.
    fn from_scratch(
        problem: &CompletionProblem,
        seeds: &[(usize, PairOrder)],
        limit: SolutionLimit,
    ) -> Option<Completion> {
        let mut with = problem.clone();
        with.fixed
            .extend(seeds.iter().map(|&(variable, order)| FixedAssignment {
                variable,
                order,
                kind: FixedKind::Seed,
            }));
        let options = CompletionOptions {
            solution_limit: limit,
            ..CompletionOptions::default()
        };
        match complete_layer_order(&with, &options) {
            Ok(completion) => Some(completion),
            // Both orders of one variable.
            Err(crate::CompletionError::InvalidProblem(message)) if message.contains("both") => {
                None
            }
            Err(e) => panic!("{e}"),
        }
    }

    /// Whether `problem` with `seeds` added has an order, from scratch.
    fn feasible_from_scratch(problem: &CompletionProblem, seeds: &[(usize, PairOrder)]) -> bool {
        matches!(
            from_scratch(problem, seeds, SolutionLimit::Count(1)),
            Some(Completion::Solved(_))
        )
    }

    /// Every complete order a from-scratch completion lists, the first
    /// component stepping slowest.
    fn every_order(solution: &crate::CompletionSolution) -> Vec<Vec<PairOrder>> {
        let mut choices: Vec<Vec<usize>> = vec![Vec::new()];
        for component in &solution.components {
            choices = choices
                .into_iter()
                .flat_map(|choice| {
                    (0..component.solutions.len()).map(move |pick| {
                        let mut grown = choice.clone();
                        grown.push(pick);
                        grown
                    })
                })
                .collect();
        }
        choices
            .iter()
            .map(|choice| {
                solution
                    .assignment(choice)
                    .unwrap_or_else(|| panic!("no order for {choice:?}"))
            })
            .collect()
    }

    /// Every order an enumeration yields, each call within `budget`, and
    /// how it ended. Counts the calls a budget stopped.
    fn enumerate_all(
        session: &CompletionSession,
        deduced: &Deduced,
        budget: SearchBudget,
        stops: &mut usize,
    ) -> (Vec<Vec<PairOrder>>, EnumerationStep, u64) {
        let mut cursor = session.enumerate(deduced).unwrap_or_else(|e| panic!("{e}"));
        let mut orders = Vec::new();
        for _ in 0..1_000_000 {
            match cursor.next(session, budget) {
                Ok(EnumerationStep::Order) => orders.push(
                    cursor
                        .order()
                        .unwrap_or_else(|| panic!("an order step with no order")),
                ),
                Ok(EnumerationStep::Stopped(_)) => *stops += 1,
                Ok(end) => {
                    // The end is final.
                    assert_eq!(cursor.next(session, budget), Ok(end.clone()));
                    assert_eq!(cursor.order(), None);
                    return (orders, end, cursor.nodes());
                }
                Err(e) => panic!("{e}"),
            }
        }
        panic!("the enumeration did not end");
    }

    fn deduced(session: &CompletionSession, seeds: &[(usize, PairOrder)]) -> Deduced {
        match session.deduce(seeds, None) {
            Ok(Deduction::Deduced(deduced)) => deduced,
            other => panic!("expected a deduction, got {other:?}"),
        }
    }

    fn bits(order: &[PairOrder]) -> Vec<bool> {
        order.iter().map(|o| *o == PairOrder::FirstAbove).collect()
    }

    /// Every constraint holds: seeding every pair with `order` propagates
    /// without a conflict.
    fn valid(problem: &CompletionProblem, order: &[PairOrder]) -> bool {
        let all: Vec<(usize, PairOrder)> = order.iter().copied().enumerate().collect();
        let mut bare = problem.clone();
        bare.fixed.clear();
        feasible_from_scratch(&bare, &all)
    }

    struct Rng(u64);

    impl Rng {
        fn below(&mut self, n: usize) -> usize {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            (self.0 % n as u64) as usize
        }
    }

    /// `one_cell(n)` with some pairs fixed as carried: `0 > 1 > 2`, and in the
    /// cyclic variant `2 > 0` too, which nothing checks until a seed
    /// propagates through it.
    fn carried(n: usize, cyclic: bool) -> CompletionProblem {
        let mut problem = one_cell(n);
        let mut fix = |a: usize, b: usize, order| {
            let variable = problem
                .variables
                .iter()
                .position(|p| *p == [a, b])
                .unwrap_or_else(|| panic!("no [{a}, {b}]"));
            problem.fixed.push(FixedAssignment {
                variable,
                order,
                kind: FixedKind::Carried,
            });
        };
        fix(0, 1, PairOrder::FirstAbove);
        fix(1, 2, PairOrder::FirstAbove);
        if cyclic {
            fix(0, 2, PairOrder::SecondAbove);
        }
        problem
    }

    #[test]
    fn checks_agree_with_completing_from_scratch() {
        let mut problems = vec![
            one_cell(4),
            one_cell(5),
            two_stacks(),
            kabuto(),
            carried(4, false),
            carried(4, true),
            split_gadget(),
        ];
        let mut rng = Rng(0x9e37_79b9_7f4a_7c15);
        // Stacks tied at random: the problems among them that have an
        // order.
        let mut tied = 0;
        while tied < 6 {
            let problem = tied_stacks(&mut rng);
            if matches!(
                CompletionSession::open(problem.clone(), SearchBudget::default()),
                Ok(SessionStart::Open(_))
            ) {
                problems.push(problem);
                tied += 1;
            }
        }
        let mut verdicts = BTreeMap::new();
        let mut tally = |kind: &'static str| *verdicts.entry(kind).or_insert(0) += 1;
        let mut stops = 0;
        for problem in &problems {
            for dense_limit in [usize::MAX, 0] {
                let session = open(problem, dense_limit);
                // Carried pairs are never checked, so an order is only valid
                // as a whole where none are.
                let checkable = problem.fixed.iter().all(|f| f.kind == FixedKind::Seed);
                assert!(!checkable || valid(problem, &session.first()));
                // Every order the problem allows: where a stepper moves to.
                let (allowed, _, _) = enumerate_all(
                    &session,
                    &deduced(&session, &[]),
                    SearchBudget::default(),
                    &mut stops,
                );
                for _ in 0..150 {
                    let seeds: Vec<(usize, PairOrder)> = (0..1 + rng.below(4))
                        .map(|_| {
                            let order = if rng.below(2) == 0 {
                                PairOrder::FirstAbove
                            } else {
                                PairOrder::SecondAbove
                            };
                            (rng.below(problem.variables.len()), order)
                        })
                        .collect();
                    let scratch = from_scratch(problem, &seeds, SolutionLimit::All);
                    let expected = matches!(scratch, Some(Completion::Solved(_)));
                    let deduction = match session.deduce(&seeds, None) {
                        Ok(deduction) => Some(deduction),
                        Err(crate::CompletionError::InvalidProblem(message))
                            if message.contains("both") =>
                        {
                            assert!(scratch.is_none());
                            None
                        }
                        Err(e) => panic!("{e}"),
                    };
                    if let Some(Deduction::Deduced(deduced)) = &deduction {
                        let end = check_enumeration(
                            problem,
                            &session,
                            &seeds,
                            deduced,
                            scratch.as_ref(),
                            checkable,
                            &mut rng,
                            &mut stops,
                        );
                        tally(match end {
                            EnumerationStep::Unsatisfied(_) => "enumerated none",
                            _ => "enumerated",
                        });
                    }
                    // A stepper move: an order the problem allows, vouched
                    // for, often not the open's.
                    let moved = allowed[rng.below(allowed.len())].clone();
                    for (prefer, fits) in [
                        (None, false),
                        (Some(session.first()), false),
                        (Some(moved.clone()), true),
                    ] {
                        let options = CheckOptions {
                            prefer: prefer.as_deref(),
                            prefer_fits: fits,
                            fast_nodes: 1 + rng.below(4) as u64,
                            ..CheckOptions::default()
                        };
                        let outcome = match session.check(&seeds, &options) {
                            Ok(outcome) => outcome,
                            Err(crate::CompletionError::InvalidProblem(message))
                                if message.contains("both") =>
                            {
                                assert!(!expected);
                                assert!(deduction.is_none());
                                continue;
                            }
                            Err(e) => panic!("{e}"),
                        };
                        // A deduction is the check's steps 1–2.
                        match (&outcome, &deduction) {
                            (CheckOutcome::Fits(fit), Some(Deduction::Deduced(deduced))) => {
                                assert_eq!(fit.forced, deduced.forced());
                            }
                            (CheckOutcome::NoOrder(_), Some(Deduction::Deduced(_))) => {}
                            (
                                CheckOutcome::Forced {
                                    variable,
                                    error_faces,
                                    roots,
                                },
                                Some(Deduction::Forced {
                                    variable: v,
                                    error_faces: e,
                                    roots: r,
                                }),
                            ) => assert_eq!((variable, error_faces, roots), (v, e, r)),
                            (CheckOutcome::Conflict(c), Some(Deduction::Conflict(d))) => {
                                assert_eq!(c, d);
                            }
                            other => panic!("{seeds:?}: {other:?}"),
                        }
                        let kind = match &outcome {
                            CheckOutcome::Fits(fit) => {
                                assert!(expected, "{seeds:?}: fits, but not from scratch");
                                assert!(!checkable || valid(problem, &fit.order));
                                for &(variable, order) in &seeds {
                                    assert_eq!(fit.order[variable], order);
                                }
                                if fits {
                                    // Wherever the move agrees with what the
                                    // seeds force, it is kept.
                                    for component in session.components() {
                                        let agrees = component
                                            .iter()
                                            .all(|&v| fit.forced[v].is_none_or(|o| o == moved[v]));
                                        if agrees {
                                            for &v in component {
                                                assert_eq!(fit.order[v], moved[v], "{seeds:?}");
                                            }
                                        }
                                    }
                                    if fit.order == moved && moved != session.first() {
                                        tally("kept a move");
                                    }
                                }
                                "fits"
                            }
                            CheckOutcome::Forced {
                                variable,
                                error_faces,
                                roots,
                            } => {
                                assert!(!expected);
                                assert!(!error_faces.is_empty());
                                // What forced it: the problem's own orders.
                                assert!(roots.iter().all(|r| fixed_in(problem, *r)));
                                let asked: Vec<_> =
                                    seeds.iter().filter(|(v, _)| v == variable).collect();
                                assert!(!feasible_from_scratch(problem, &[*asked[0]]));
                                "forced"
                            }
                            CheckOutcome::Conflict(conflict) => {
                                assert!(!expected);
                                assert!(!conflict.error_faces.is_empty());
                                assert_roots_suffice(problem, &seeds, &conflict.roots);
                                "conflict"
                            }
                            CheckOutcome::NoOrder(none) => {
                                assert!(!expected);
                                assert!(!none.faces.is_empty());
                                assert_roots_suffice(problem, &seeds, &none.roots);
                                "no order"
                            }
                            CheckOutcome::Undecided { .. } => panic!("undecided"),
                        };
                        tally(kind);
                    }
                }
            }
        }
        // Each kind of answer is exercised, and so are a budget's stops and
        // a kept move.
        for kind in [
            "fits",
            "forced",
            "conflict",
            "no order",
            "enumerated",
            "enumerated none",
            "kept a move",
        ] {
            assert!(verdicts.get(kind).copied().unwrap_or(0) > 0, "{verdicts:?}");
        }
        assert!(stops > 0);
    }

    /// Four stacks of three. Stack i's faces are 3i, 3i + 1 and 3i + 2; call
    /// its pairs `a` (the first two), `b` (the last two) and `c` (first and
    /// last). Its transitivity triple is a not-all-equal over `a`, `b` and
    /// `c` reversed. Tortilla-tortillas tie `a₁ = a₀` (call it `p`),
    /// `a₃ = a₂` (`q`), `b₁ = b₀` (`x`), `b₂ = b₃ = ¬x`, `c₁ = ¬c₀` and
    /// `c₃ = ¬c₂`. Stacks 0 and 1 then leave `x = p` no order, and stacks 2
    /// and 3 leave `x = ¬q` none, so `p` and `q` seeded the same way have no
    /// order. Propagation sees neither: each is a case split, which only a
    /// search makes. Either seed alone fits.
    fn split_gadget() -> CompletionProblem {
        let mut problem = stacks(&[3, 3, 3, 3]);
        // Stack i's variables: a is 3i, c is 3i + 1 and b is 3i + 2. Each
        // tie makes A–C stack like B–D; a tie's pair written high face
        // first stacks the other way.
        let ties: [([usize; 4], [usize; 2]); 7] = [
            ([0, 3, 1, 4], [0, 3]),    // a₁ = a₀
            ([6, 9, 7, 10], [6, 9]),   // a₃ = a₂
            ([1, 4, 2, 5], [2, 5]),    // b₁ = b₀
            ([1, 8, 2, 7], [2, 8]),    // b₂ = ¬b₀
            ([1, 11, 2, 10], [2, 11]), // b₃ = ¬b₀
            ([0, 5, 2, 3], [1, 4]),    // c₁ = ¬c₀
            ([6, 11, 8, 9], [7, 10]),  // c₃ = ¬c₂
        ];
        for (tie, variables) in ties {
            for v in variables {
                problem.constraints[v].tortilla_tortilla.push(tie);
            }
        }
        problem
    }

    /// Two or three stacks of three or four faces with a few random
    /// tortilla-tortillas between them, each tying a pair of one stack to
    /// stack like, or opposite to, a pair of another.
    fn tied_stacks(rng: &mut Rng) -> CompletionProblem {
        let sizes: Vec<usize> = (0..2 + rng.below(2)).map(|_| 3 + rng.below(2)).collect();
        let mut problem = stacks(&sizes);
        let stack_of = |face: usize| {
            let mut base = 0;
            sizes
                .iter()
                .position(|&size| {
                    base += size;
                    face < base
                })
                .unwrap_or(0)
        };
        for _ in 0..3 + rng.below(4) {
            let u = rng.below(problem.variables.len());
            let w = rng.below(problem.variables.len());
            let ([a, c], [b, d]) = (problem.variables[u], problem.variables[w]);
            if stack_of(a) == stack_of(b) {
                continue;
            }
            // A–C and B–D stack the same way; with B and D swapped, opposite.
            let tie = if rng.below(2) == 0 {
                [a, b, c, d]
            } else {
                [a, d, c, b]
            };
            for v in [u, w] {
                problem.constraints[v].tortilla_tortilla.push(tie);
            }
        }
        problem
    }

    /// Whether `variable` is one of the problem's fixed orders.
    fn fixed_in(problem: &CompletionProblem, variable: usize) -> bool {
        problem.fixed.iter().any(|f| f.variable == variable)
    }

    /// The seeds among `roots`, with the problem's fixed orders, already
    /// have no order; every root is one or the other.
    fn assert_roots_suffice(
        problem: &CompletionProblem,
        seeds: &[(usize, PairOrder)],
        roots: &[usize],
    ) {
        assert!(!roots.is_empty());
        assert!(
            roots
                .iter()
                .all(|r| fixed_in(problem, *r) || seeds.iter().any(|(v, _)| v == r)),
            "{roots:?} for {seeds:?}"
        );
        let needed: Vec<(usize, PairOrder)> = seeds
            .iter()
            .copied()
            .filter(|(v, _)| roots.contains(v))
            .collect();
        assert!(
            !feasible_from_scratch(problem, &needed),
            "{needed:?} of {seeds:?} has an order"
        );
    }

    /// An enumeration of `deduced` against completing from scratch with the
    /// same seeds (`scratch`, every order listed): the same forced pairs,
    /// components and orders, in order; every order valid, distinct and
    /// with the seeds; and the same again resumed in slices of a node or
    /// three, with the same nodes spent.
    #[allow(clippy::too_many_arguments)]
    fn check_enumeration(
        problem: &CompletionProblem,
        session: &CompletionSession,
        seeds: &[(usize, PairOrder)],
        deduced: &Deduced,
        scratch: Option<&Completion>,
        checkable: bool,
        rng: &mut Rng,
        stops: &mut usize,
    ) -> EnumerationStep {
        let cursor = session.enumerate(deduced).unwrap_or_else(|e| panic!("{e}"));
        let (orders, end, nodes) = enumerate_all(session, deduced, SearchBudget::default(), stops);
        match scratch {
            Some(Completion::Solved(solution)) => {
                assert_eq!(deduced.forced(), solution.forced);
                let variables: Vec<Vec<usize>> = solution
                    .components
                    .iter()
                    .map(|c| c.variables.clone())
                    .collect();
                assert_eq!(cursor.components(), variables.as_slice());
                assert_eq!(orders, every_order(solution), "{seeds:?}");
                assert_eq!(end, EnumerationStep::Exhausted);
            }
            Some(Completion::UnsatisfiedComponent(unsatisfied)) => {
                assert!(orders.is_empty());
                assert_eq!(end, EnumerationStep::Unsatisfied(unsatisfied.clone()));
            }
            other => panic!("{seeds:?} deduced, but from scratch {other:?}"),
        }
        let distinct: BTreeSet<Vec<bool>> = orders.iter().map(|o| bits(o)).collect();
        assert_eq!(distinct.len(), orders.len());
        for order in &orders {
            for &(variable, asked) in seeds {
                assert_eq!(order[variable], asked);
            }
            assert!(!checkable || valid(problem, order));
        }
        let slices = SearchBudget {
            max_nodes: Some(1 + rng.below(3) as u64),
            deadline: None,
        };
        let sliced = enumerate_all(session, deduced, slices, stops);
        assert_eq!(sliced, (orders, end.clone(), nodes));
        end
    }

    #[test]
    fn the_open_finds_the_first_order_complete_lists() {
        for problem in [one_cell(4), two_stacks(), kabuto()] {
            let session = open(&problem, usize::MAX);
            let Ok(Completion::Solved(solution)) = complete_layer_order(
                &problem,
                &CompletionOptions {
                    solution_limit: SolutionLimit::Count(1),
                    ..CompletionOptions::default()
                },
            ) else {
                panic!("expected a solution");
            };
            let choice = vec![0; solution.components.len()];
            assert_eq!(Some(session.first()), solution.assignment(&choice));
            assert_eq!(session.forced(), solution.forced);
            assert_eq!(
                session.components(),
                solution
                    .components
                    .iter()
                    .map(|c| c.variables.clone())
                    .collect::<Vec<_>>()
            );
        }
    }

    #[test]
    fn a_seed_against_a_forced_pair_is_refused_with_its_trace() {
        let mut problem = one_cell(3);
        // 0 over 1 and 1 over 2 force 0 over 2.
        for (variable, order) in [(0, PairOrder::FirstAbove), (2, PairOrder::FirstAbove)] {
            problem.fixed.push(FixedAssignment {
                variable,
                order,
                kind: FixedKind::Seed,
            });
        }
        let session = open(&problem, usize::MAX);
        assert_eq!(session.forced()[1], Some(PairOrder::FirstAbove));
        let outcome = session
            .check(&[(1, PairOrder::SecondAbove)], &CheckOptions::default())
            .unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(
            outcome,
            CheckOutcome::Forced {
                variable: 1,
                error_faces: vec![0, 1, 2],
                // The two fixed orders that force it.
                roots: vec![0, 2],
            }
        );
        // The same order again is no change at all.
        let same = session
            .check(&[(1, PairOrder::FirstAbove)], &CheckOptions::default())
            .unwrap_or_else(|e| panic!("{e}"));
        assert!(matches!(
            same,
            CheckOutcome::Fits(CheckFit {
                stage: CheckStage::Unchanged,
                nodes: 0,
                ..
            })
        ));
    }

    #[test]
    fn the_preferred_order_is_kept_where_nothing_changes_it() {
        let problem = two_stacks();
        let session = open(&problem, usize::MAX);
        // Another valid order than the open's: reverse both stacks.
        let reversed: Vec<PairOrder> = session
            .first()
            .iter()
            .map(|o| match o {
                PairOrder::FirstAbove => PairOrder::SecondAbove,
                PairOrder::SecondAbove => PairOrder::FirstAbove,
            })
            .collect();
        assert!(valid(&problem, &reversed));
        let options = CheckOptions {
            prefer: Some(&reversed),
            ..CheckOptions::default()
        };
        let Ok(CheckOutcome::Fits(fit)) = session.check(&[], &options) else {
            panic!("expected a fit");
        };
        assert_eq!(fit.order, reversed);
        // Seeding one pair the way the preferred order has it changes
        // nothing else.
        let Ok(CheckOutcome::Fits(fit)) = session.check(&[(0, reversed[0])], &options) else {
            panic!("expected a fit");
        };
        assert_eq!(fit.order, reversed);
        let Ok(CheckOutcome::Fits(cold)) = session.check(&[], &CheckOptions::default()) else {
            panic!("expected a fit");
        };
        assert_eq!(cold.order, session.first());
    }

    /// `problem` with every constraint also listed in the bucket of each
    /// variable it reads.
    fn in_every_bucket(problem: &CompletionProblem) -> CompletionProblem {
        fn spread<const N: usize>(
            variables: &[[usize; 2]],
            family: usize,
            constraints: &mut [VariableConstraints],
            bucket: fn(&mut VariableConstraints) -> &mut Vec<[usize; N]>,
        ) {
            let listed: Vec<[usize; N]> = constraints
                .iter_mut()
                .flat_map(|buckets| bucket(buckets).clone())
                .collect();
            for faces in listed {
                for &[a, b] in crate::tables::pairs_for_type(family, &faces).as_slice() {
                    let pair = [a.min(b), a.max(b)];
                    let variable = variables
                        .iter()
                        .position(|p| *p == pair)
                        .unwrap_or_else(|| panic!("no {pair:?}"));
                    let into = bucket(&mut constraints[variable]);
                    if !into.contains(&faces) {
                        into.push(faces);
                    }
                }
            }
        }
        let mut whole = problem.clone();
        let variables = whole.variables.clone();
        let buckets = &mut whole.constraints;
        spread(&variables, constraints::TACO_TACO, buckets, |b| {
            &mut b.taco_taco
        });
        spread(&variables, constraints::TACO_TORTILLA, buckets, |b| {
            &mut b.taco_tortilla
        });
        spread(&variables, constraints::TORTILLA_TORTILLA, buckets, |b| {
            &mut b.tortilla_tortilla
        });
        whole
    }

    /// The independent review's smallest case (`review/fold-solver-perf`,
    /// `asym` mode): each constraint listed only in the bucket of the last
    /// variable it reads. Opened anyway, a session took the two stacks for
    /// independent and answered "no" to seeding variable 3, where completing
    /// from scratch over the same buckets finds an order.
    #[test]
    fn a_constraint_missing_from_a_bucket_it_reads_is_refused() {
        let problem: CompletionProblem = serde_json::from_str(
            r#"{
                "variables": [[0, 1], [0, 2], [1, 2], [3, 4], [3, 5], [3, 6], [4, 5], [4, 6], [5, 6]],
                "constraints": [
                    {"taco_taco": [], "taco_tortilla": [], "tortilla_tortilla": []},
                    {"taco_taco": [], "taco_tortilla": [[2, 1, 0]], "tortilla_tortilla": []},
                    {"taco_taco": [], "taco_tortilla": [[0, 1, 2]], "tortilla_tortilla": []},
                    {"taco_taco": [], "taco_tortilla": [], "tortilla_tortilla": []},
                    {"taco_taco": [], "taco_tortilla": [], "tortilla_tortilla": []},
                    {"taco_taco": [], "taco_tortilla": [], "tortilla_tortilla": []},
                    {"taco_taco": [], "taco_tortilla": [],
                     "tortilla_tortilla": [[0, 5, 2, 4], [5, 1, 4, 2]]},
                    {"taco_taco": [], "taco_tortilla": [],
                     "tortilla_tortilla": [[1, 6, 0, 4], [4, 4, 3, 6], [5, 4, 3, 6]]},
                    {"taco_taco": [[6, 5, 4, 3], [3, 6, 5, 4], [5, 4, 6, 3], [4, 3, 6, 5]],
                     "taco_tortilla": [[6, 3, 5]],
                     "tortilla_tortilla": [[6, 2, 5, 0], [0, 5, 2, 6]]}
                ],
                "faces_cells": [[0], [0], [0], [1], [1], [1], [1]],
                "cells_faces": [[0, 1, 2], [3, 4, 5, 6]],
                "fixed": []
            }"#,
        )
        .unwrap_or_else(|e| panic!("{e}"));
        let seed = [(3, PairOrder::FirstAbove)];
        // Completing runs upstream's procedure over the buckets as given,
        // as before.
        assert!(feasible_from_scratch(&problem, &seed));
        for dense_limit in [usize::MAX, 0] {
            match CompletionSession::open_with_tables(
                problem.clone(),
                SearchBudget::default(),
                dense_limit,
            ) {
                Err(CompletionError::InvalidProblem(message)) => assert!(
                    message.starts_with("taco-taco [3, 6, 5, 4] reads variable 5 ([3, 6])"),
                    "{message}"
                ),
                other => panic!("expected a refusal, got {other:?}"),
            }
        }
        // A constraint listed twice in one bucket is still listed in each.
        let mut twice = two_stacks();
        let zero_two = twice.variables.iter().position(|p| *p == [0, 2]);
        let bucket = &mut twice.constraints[zero_two.unwrap_or_else(|| panic!("no [0, 2]"))];
        bucket.tortilla_tortilla.push(bucket.tortilla_tortilla[0]);
        open(&twice, usize::MAX);
        // Listed in every bucket they read, the same constraints open, and a
        // check agrees with completing from scratch on every seed.
        let whole = in_every_bucket(&problem);
        let session = open(&whole, usize::MAX);
        for variable in 0..whole.variables.len() {
            for order in [PairOrder::FirstAbove, PairOrder::SecondAbove] {
                let fits = matches!(
                    session.check(&[(variable, order)], &CheckOptions::default()),
                    Ok(CheckOutcome::Fits(_))
                );
                assert_eq!(
                    fits,
                    feasible_from_scratch(&whole, &[(variable, order)]),
                    "{variable} {order:?}"
                );
            }
        }
    }

    #[test]
    fn the_budget_gives_no_verdict() {
        // Five faces in one cell: two seeds leave the rest to the search.
        let problem = one_cell(5);
        let session = open(&problem, usize::MAX);
        let options = CheckOptions {
            budget: SearchBudget {
                max_nodes: Some(0),
                deadline: None,
            },
            fast_nodes: 0,
            prefer: None,
            prefer_fits: false,
        };
        let outcome = session
            .check(&[(0, PairOrder::SecondAbove)], &options)
            .unwrap_or_else(|e| panic!("{e}"));
        assert!(matches!(
            outcome,
            CheckOutcome::Undecided {
                limit: BudgetLimit::Nodes,
                ..
            }
        ));
        fn late() -> f64 {
            1.0
        }
        let options = CheckOptions {
            budget: SearchBudget {
                max_nodes: None,
                deadline: Some(crate::Deadline {
                    now_ms: late,
                    at_ms: 0.0,
                }),
            },
            ..CheckOptions::default()
        };
        assert_eq!(
            session.check(&[], &options),
            Ok(CheckOutcome::Undecided {
                limit: BudgetLimit::Deadline,
                nodes: 0
            })
        );
    }

    /// Stacks of the given sizes, each alone in its cell, faces numbered
    /// across them: one independent component per stack.
    fn stacks(sizes: &[usize]) -> CompletionProblem {
        let mut problem = CompletionProblem::default();
        let mut base = 0;
        for (cell, &size) in sizes.iter().enumerate() {
            for a in base..base + size {
                for b in a + 1..base + size {
                    problem.variables.push([a, b]);
                }
                problem.faces_cells.push(vec![cell]);
            }
            problem.cells_faces.push((base..base + size).collect());
            base += size;
        }
        problem.constraints = vec![VariableConstraints::default(); problem.variables.len()];
        problem
    }

    /// Gate 2 of the plan's E3: after a stepper move (a vouched-for order
    /// other than the open's first), a preview changes no cell outside the
    /// components the seeds reached. Without `prefer_fits`, a quick search
    /// that runs out of nodes put the open's first order back there.
    #[test]
    fn a_stepper_move_changes_no_cell_the_seeds_did_not_reach() {
        let mut rng = Rng(0x2545_f491_4f6c_dd1d);
        let mut problems = vec![kabuto(), stacks(&[3, 3, 4]), two_stacks()];
        for _ in 0..12 {
            let sizes: Vec<usize> = (0..2 + rng.below(3)).map(|_| 2 + rng.below(3)).collect();
            problems.push(stacks(&sizes));
        }
        let (mut previews, mut resets) = (0, 0);
        for problem in &problems {
            let session = open(problem, usize::MAX);
            let mut stops = 0;
            let (allowed, _, _) = enumerate_all(
                &session,
                &deduced(&session, &[]),
                SearchBudget::default(),
                &mut stops,
            );
            let open_forced = session.forced();
            // Each cell's variables.
            let cells: Vec<Vec<usize>> = problem
                .cells_faces
                .iter()
                .map(|faces| {
                    (0..problem.variables.len())
                        .filter(|&v| {
                            let [a, b] = problem.variables[v];
                            faces.contains(&a) && faces.contains(&b)
                        })
                        .collect()
                })
                .collect();
            for moved in allowed.iter().filter(|o| **o != session.first()) {
                for _ in 0..8 {
                    let variable = rng.below(problem.variables.len());
                    let order = if rng.below(2) == 0 {
                        PairOrder::FirstAbove
                    } else {
                        PairOrder::SecondAbove
                    };
                    let seeds = [(variable, order)];
                    let Ok(Deduction::Deduced(deduction)) = session.deduce(&seeds, None) else {
                        continue;
                    };
                    let forced = deduction.forced();
                    let reached: Vec<bool> = session
                        .components()
                        .iter()
                        .map(|c| {
                            c.iter()
                                .any(|&v| forced[v].is_some() && open_forced[v].is_none())
                        })
                        .collect();
                    let unreached = |cell: &[usize]| {
                        cell.iter().all(|&v| {
                            session
                                .components()
                                .iter()
                                .zip(&reached)
                                .all(|(c, &r)| !r || !c.contains(&v))
                        })
                    };
                    for fast_nodes in [0, CheckOptions::DEFAULT_FAST_NODES] {
                        for prefer_fits in [true, false] {
                            let options = CheckOptions {
                                prefer: Some(moved.as_slice()),
                                prefer_fits,
                                fast_nodes,
                                ..CheckOptions::default()
                            };
                            let Ok(CheckOutcome::Fits(fit)) = session.check(&seeds, &options)
                            else {
                                continue;
                            };
                            let kept = cells
                                .iter()
                                .filter(|cell| unreached(cell))
                                .all(|cell| cell.iter().all(|&v| fit.order[v] == moved[v]));
                            if prefer_fits {
                                previews += 1;
                                assert!(kept, "{seeds:?} moved a cell it did not reach");
                            } else if !kept {
                                resets += 1;
                            }
                        }
                    }
                }
            }
        }
        assert!(previews > 100, "{previews}");
        // The bug the option fixes is real: where a quick search runs out of
        // nodes (given none here, standing in for a component too big for
        // 128), faraway cells went back to the open's first order.
        assert!(resets > 0);
    }

    #[test]
    fn a_deduction_is_propagation_alone() {
        let problem = one_cell(3);
        let session = open(&problem, usize::MAX);
        // 0 over 1 and 1 over 2 force 0 over 2; nothing is searched.
        let seeds = [(0, PairOrder::FirstAbove), (2, PairOrder::FirstAbove)];
        assert_eq!(
            deduced(&session, &seeds).forced(),
            vec![Some(PairOrder::FirstAbove); 3]
        );
        assert_eq!(
            deduced(&session, &[(0, PairOrder::FirstAbove)]).forced(),
            vec![Some(PairOrder::FirstAbove), None, None]
        );
        fn late() -> f64 {
            1.0
        }
        let deadline = crate::Deadline {
            now_ms: late,
            at_ms: 0.0,
        };
        assert_eq!(
            session.deduce(&seeds, Some(deadline)),
            Ok(Deduction::Undecided {
                limit: BudgetLimit::Deadline
            })
        );
    }

    #[test]
    fn an_enumeration_lists_kabutos_nine_orders_and_resumes() {
        let problem = kabuto();
        let session = open(&problem, usize::MAX);
        let all = deduced(&session, &[]);
        let mut stops = 0;
        let (orders, end, nodes) =
            enumerate_all(&session, &all, SearchBudget::default(), &mut stops);
        let Some(Completion::Solved(solution)) = from_scratch(&problem, &[], SolutionLimit::All)
        else {
            panic!("kabuto did not solve");
        };
        assert_eq!(solution.solution_counts(), vec![1, 3, 3]);
        assert_eq!(orders, every_order(&solution));
        assert_eq!(orders[0], session.first());
        assert_eq!(end, EnumerationStep::Exhausted);
        assert_eq!(stops, 0);
        // One node a call: every node is spent once, whatever stops it.
        let one = SearchBudget {
            max_nodes: Some(1),
            deadline: None,
        };
        assert_eq!(
            enumerate_all(&session, &all, one, &mut stops),
            (orders, end, nodes)
        );
        assert!(stops > 0);
        // A deadline already past stops it before any node, and it resumes.
        fn late() -> f64 {
            1.0
        }
        let past = SearchBudget {
            max_nodes: None,
            deadline: Some(crate::Deadline {
                now_ms: late,
                at_ms: 0.0,
            }),
        };
        let mut cursor = session.enumerate(&all).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(
            cursor.next(&session, past),
            Ok(EnumerationStep::Stopped(BudgetLimit::Deadline))
        );
        assert_eq!(cursor.order(), None);
        assert_eq!(
            cursor.next(&session, SearchBudget::default()),
            Ok(EnumerationStep::Order)
        );
        assert_eq!(cursor.order(), Some(session.first()));
    }

    #[test]
    fn a_conflict_names_the_seeds_it_traces_back_to() {
        // A cycle in a stack of three, beside a seed in a stack of two.
        let problem = stacks(&[3, 2]);
        let session = open(&problem, usize::MAX);
        let seeds = [
            (0, PairOrder::FirstAbove),  // 0 over 1
            (2, PairOrder::FirstAbove),  // 1 over 2
            (1, PairOrder::SecondAbove), // 2 over 0
            (3, PairOrder::FirstAbove),  // 3 over 4, elsewhere
        ];
        let Ok(CheckOutcome::Conflict(conflict)) = session.check(&seeds, &CheckOptions::default())
        else {
            panic!("expected a conflict");
        };
        assert_eq!(conflict.roots, vec![0, 1, 2]);
        let Some(Completion::Conflict(scratch)) =
            from_scratch(&problem, &seeds, SolutionLimit::Count(1))
        else {
            panic!("expected a conflict from scratch");
        };
        assert_eq!(scratch.roots, vec![0, 1, 2]);
    }

    #[test]
    fn a_search_proof_names_the_seeds_it_needs() {
        let problem = split_gadget();
        let session = open(&problem, usize::MAX);
        // p and q the same way.
        let seeds = [(0, PairOrder::FirstAbove), (6, PairOrder::FirstAbove)];
        let Ok(CheckOutcome::NoOrder(none)) = session.check(&seeds, &CheckOptions::default())
        else {
            panic!("expected a search to find no order");
        };
        assert_eq!(none.roots, vec![0, 6]);
        // Propagation alone finds nothing wrong; the enumeration's search
        // finds what completing from scratch does.
        let deduction = deduced(&session, &seeds);
        let Some(Completion::UnsatisfiedComponent(unsatisfied)) =
            from_scratch(&problem, &seeds, SolutionLimit::Count(1))
        else {
            panic!("expected no order from scratch");
        };
        let mut stops = 0;
        let (orders, end, _) =
            enumerate_all(&session, &deduction, SearchBudget::default(), &mut stops);
        assert!(orders.is_empty());
        assert_eq!(end, EnumerationStep::Unsatisfied(unsatisfied));
        // p and q the other way round fit.
        let fits = [(0, PairOrder::FirstAbove), (6, PairOrder::SecondAbove)];
        assert!(matches!(
            session.check(&fits, &CheckOptions::default()),
            Ok(CheckOutcome::Fits(_))
        ));
    }
}

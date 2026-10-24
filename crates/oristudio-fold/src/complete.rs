//! Completing a layer order (plan D4 *complete*, D8): the pairs that fixed
//! orders leave open, through Flat-Folder's propagation and search
//! (`treemaker_flatfold::complete_layer_order`) over the constraint problem
//! `oristudio-layer-order` builds from the state's own face images.
//!
//! This is the engine's one "complete the rest" entry. Import CP fixes the
//! imported letters ([`crate::import`]); a compound fold will fix the pairs
//! its blocks carry and the cross-block orders it places
//! ([`crate::Unordered`] is where both start). A plain fold leaves nothing to
//! complete and never calls it.
//!
//! # The adapter
//!
//! - Faces are numbered by ascending [`FaceId`], so every variable lists its
//!   faces in increasing order, as the search requires.
//! - Variables, constraint buckets and cells are the problem's own. Its
//!   constraint tuples are already Flat-Folder's (`ConstraintProblem` stores
//!   them so), and transitivity is derived inside the search from the
//!   overlay's cells, as the checker derives it.
//! - "Above" is the model frame's: the search's `FirstAbove` for a pair is its
//!   smaller face nearer +z. Every constraint table is symmetric under
//!   reversing the direction, so no other convention is needed.
//! - A problem with ambiguities is refused before the search: a cell pair
//!   that is no variable would be a transitivity triple over a missing one.
//!
//! # Counts
//!
//! The constraints are built from this state's geometry, not from
//! Flat-Folder's heuristic arrangement, so a count is a true ‹ n of m ›
//! (PORTING.md, Flat-Folder: on a validated arrangement the search finds
//! every order). Each component lists at most
//! [`CompletionLimits::per_component`] orders; more is reported as
//! truncation, never hidden.

use std::collections::{BTreeMap, BTreeSet};

use oristudio_layer_order::{
    Ambiguity, Constraint, ConstraintProblem, FacePair, FoldedView, LayerOrder,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use treemaker_flatfold::{
    self as flatfold, Completion, CompletionError, CompletionOptions, CompletionProblem,
    FixedAssignment, PairOrder, SearchBudget, SolutionLimit, VariableConstraints,
};

use crate::pattern::FaceId;

/// How a fixed pair enters the search (plan D8).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FixedKind {
    /// Known to agree with everything around it, such as a pair an operation
    /// carried from a valid state: assigned but never propagated, so a
    /// constraint made only of carried pairs is not checked here.
    /// [`crate::State::make`] is the backstop.
    Carried,
    /// New information (a letter, a seed, a stored choice): propagated with
    /// everything it implies, so a contradiction is found before the search.
    Seed,
}

/// One fixed order: `upper` lies above `lower` in the model frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct FixedPair {
    pub upper: FaceId,
    pub lower: FaceId,
    pub kind: FixedKind,
}

/// A wall-clock limit read through the caller's clock (wasm32 has no
/// `Instant`): milliseconds on any monotonic clock, such as
/// `performance.now()`.
#[derive(Debug, Clone, Copy)]
pub struct Deadline {
    pub now_ms: fn() -> f64,
    /// Stop once `now_ms()` reaches this.
    pub at_ms: f64,
}

impl Deadline {
    /// Whether the clock has reached it.
    pub fn passed(&self) -> bool {
        (self.now_ms)() >= self.at_ms
    }
}

/// What a completion may spend. The search over each component is what can
/// blow up, and what the node count meters; propagating the fixed orders is
/// polynomial, but through a deep stack it is most of a completion, so the
/// deadline meters it too. Splitting the rest into components always runs to
/// the end.
#[derive(Debug, Clone, Copy)]
pub struct CompletionLimits {
    /// Orders listed per component, at least one. A component with more
    /// reports [`ComponentChoices::truncated`].
    pub per_component: usize,
    /// Search nodes (a guess and its propagation) across every component;
    /// `None` is unbounded.
    pub max_nodes: Option<u64>,
    /// Read before each search node and every few variables the
    /// propagation visits. A completion that reaches it is
    /// [`CompletionRefusal::BudgetExceeded`], whatever it had found: an
    /// interactive caller's bound, never a replay's, since a slower machine
    /// would break a stored step.
    pub deadline: Option<Deadline>,
}

impl CompletionLimits {
    /// Whether the deadline, when there is one, has passed: what a caller
    /// that runs several completions reads between them.
    pub fn out_of_time(&self) -> bool {
        self.deadline.is_some_and(|d| d.passed())
    }

    /// Orders listed per component unless the caller asks for fewer. For
    /// scale: the preliminary base without its letters has 18 orders in all.
    pub const DEFAULT_PER_COMPONENT: usize = 1000;
    /// A bound for interactive use, not a measured one: a search that needs
    /// more reports [`CompletionRefusal::BudgetExceeded`] rather than
    /// running on.
    pub const DEFAULT_MAX_NODES: u64 = 200_000;
}

impl Default for CompletionLimits {
    fn default() -> CompletionLimits {
        CompletionLimits {
            per_component: CompletionLimits::DEFAULT_PER_COMPONENT,
            max_nodes: Some(CompletionLimits::DEFAULT_MAX_NODES),
            deadline: None,
        }
    }
}

/// The search's constraint families, as a conflict names them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConstraintFamily {
    TacoTaco,
    TacoTortilla,
    TortillaTortilla,
    Transitivity,
}

/// Which limit stopped the search.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BudgetLimit {
    Nodes,
    Deadline,
}

/// Why no order was completed.
#[derive(Debug, Clone, PartialEq, Serialize, Error)]
#[serde(rename_all = "snake_case", tag = "code")]
pub enum CompletionRefusal {
    #[error("the tolerance cannot decide {} overlapping pair(s)", ambiguities.len())]
    AmbiguousOverlap { ambiguities: Vec<Ambiguity> },
    #[error("faces {pair} are given an order but do not overlap")]
    FixedNotOverlapping { pair: FacePair },
    #[error("faces {pair} are given both orders")]
    FixedContradictory { pair: FacePair },
    /// Propagating the seeds broke a constraint. `traced` is every face the
    /// conflict traces back to (Flat-Folder's `error_faces`).
    #[error("the fixed orders break a {family:?} constraint on faces {faces:?}")]
    Conflict {
        family: ConstraintFamily,
        faces: Vec<FaceId>,
        traced: Vec<FaceId>,
    },
    #[error("faces {faces:?} have no valid order")]
    NoOrder { faces: Vec<FaceId> },
    #[error("the search hit its {limit:?} budget after {nodes} nodes")]
    BudgetExceeded { limit: BudgetLimit, nodes: u64 },
    /// The problem does not match its view, or the search refused it: a
    /// defect, never the user's input.
    #[error("the completion problem is malformed: {message}")]
    InvalidProblem { message: String },
}

impl CompletionRefusal {
    /// The stable snake_case code.
    pub fn code(&self) -> &'static str {
        match self {
            CompletionRefusal::AmbiguousOverlap { .. } => "ambiguous_overlap",
            CompletionRefusal::FixedNotOverlapping { .. } => "fixed_not_overlapping",
            CompletionRefusal::FixedContradictory { .. } => "fixed_contradictory",
            CompletionRefusal::Conflict { .. } => "conflict",
            CompletionRefusal::NoOrder { .. } => "no_order",
            CompletionRefusal::BudgetExceeded { .. } => "budget_exceeded",
            CompletionRefusal::InvalidProblem { .. } => "invalid_problem",
        }
    }

    /// The faces the refusal names, ascending.
    pub fn faces(&self) -> Vec<FaceId> {
        let mut faces: Vec<FaceId> = match self {
            CompletionRefusal::AmbiguousOverlap { ambiguities } => {
                ambiguities.iter().flat_map(|a| a.pair.faces()).collect()
            }
            CompletionRefusal::FixedNotOverlapping { pair }
            | CompletionRefusal::FixedContradictory { pair } => pair.faces().to_vec(),
            CompletionRefusal::Conflict { traced, .. } => traced.clone(),
            CompletionRefusal::NoOrder { faces } => faces.clone(),
            CompletionRefusal::BudgetExceeded { .. } | CompletionRefusal::InvalidProblem { .. } => {
                Vec::new()
            }
        };
        faces.sort_unstable();
        faces.dedup();
        faces
    }
}

/// One independent group of open pairs and every order it allows.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ComponentChoices {
    /// The pairs this component decides, in the order the search assigned
    /// them.
    pub pairs: Vec<FacePair>,
    /// Each order gives, per pair, whether its smaller face lies above.
    pub orders: Vec<Vec<bool>>,
    /// More orders exist than are listed.
    pub truncated: bool,
}

/// How many complete orders a completion offers.
///
/// Serialized for JavaScript, whose numbers are exact only up to
/// [`ChoiceCount::MAX_SENT`]: a count past it is sent as that bound and
/// inexact, "at least". (The bridge's JSON-compatible serializer refuses a
/// larger integer outright, so an import whose count passed it threw: real
/// designs with 10¹⁷ and more orders do.)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChoiceCount {
    /// The product of the components' listed counts, saturating.
    pub orders: u64,
    /// Whether that is every order: no component truncated and nothing
    /// saturated. Otherwise it is a lower bound.
    pub exact: bool,
}

impl ChoiceCount {
    /// JavaScript's `Number.MAX_SAFE_INTEGER`, 2^53 − 1.
    pub const MAX_SENT: u64 = (1 << 53) - 1;
}

impl Serialize for ChoiceCount {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut out = serializer.serialize_struct("ChoiceCount", 2)?;
        out.serialize_field("orders", &self.orders.min(ChoiceCount::MAX_SENT))?;
        out.serialize_field(
            "exact",
            &(self.exact && self.orders <= ChoiceCount::MAX_SENT),
        )?;
        out.end()
    }
}

/// Every order the fixed pairs and the constraints allow: the pairs they
/// force, and per independent component the orders to choose from (plan D4:
/// more than one completion is offered as a choice).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Completions {
    /// The problem's variables, ascending.
    variables: Vec<FacePair>,
    /// Per variable, whether its smaller face lies above, as fixed or
    /// forced; `None` for the pairs a component decides.
    forced: Vec<Option<bool>>,
    components: Vec<ComponentChoices>,
    nodes: u64,
}

impl Completions {
    /// The independent choices, smallest first.
    pub fn components(&self) -> &[ComponentChoices] {
        &self.components
    }

    /// The true ‹ n of m ›: the product of the components' counts.
    pub fn count(&self) -> ChoiceCount {
        let mut orders: u64 = 1;
        let mut exact = true;
        for component in &self.components {
            exact &= !component.truncated;
            match orders.checked_mul(component.orders.len() as u64) {
                Some(product) => orders = product,
                None => {
                    orders = u64::MAX;
                    exact = false;
                }
            }
        }
        ChoiceCount { orders, exact }
    }

    /// Exactly one order.
    pub fn is_unique(&self) -> bool {
        self.count()
            == ChoiceCount {
                orders: 1,
                exact: true,
            }
    }

    /// Search nodes used.
    pub fn nodes(&self) -> u64 {
        self.nodes
    }

    /// The pairs the fixed orders and propagation decide, each as
    /// `[upper, lower]`.
    pub fn forced_pairs(&self) -> Vec<[FaceId; 2]> {
        self.variables
            .iter()
            .zip(&self.forced)
            .filter_map(|(pair, lo_above)| lo_above.map(|a| upper_lower(*pair, a)))
            .collect()
    }

    /// The pairs a choice decides beyond the forced ones, each as
    /// `[upper, lower]`: what a step stores for its pick (plan D6).
    /// `choice[k]` picks component `k`'s order; `None` unless it names one
    /// listed order per component.
    pub fn chosen_pairs(&self, choice: &[usize]) -> Option<Vec<[FaceId; 2]>> {
        if choice.len() != self.components.len() {
            return None;
        }
        let mut out = Vec::new();
        for (component, &pick) in self.components.iter().zip(choice) {
            let order = component.orders.get(pick)?;
            out.extend(
                component
                    .pairs
                    .iter()
                    .zip(order)
                    .map(|(pair, &lo_above)| upper_lower(*pair, lo_above)),
            );
        }
        Some(out)
    }

    /// One complete order: the forced pairs and a choice's.
    pub fn order(&self, choice: &[usize]) -> Option<LayerOrder> {
        let chosen = self.chosen_pairs(choice)?;
        let mut order = LayerOrder::new();
        for [upper, lower] in self.forced_pairs().into_iter().chain(chosen) {
            order.set_above(upper, lower).ok()?;
        }
        Some(order)
    }

    /// The first `cap` complete choices — one listed order per component,
    /// the first component stepping slowest, each a `choice` as
    /// [`Completions::order`] takes it — and whether there are more: what a
    /// chooser lists of a compound fold's orders.
    pub fn picks(&self, cap: usize) -> (Vec<Vec<usize>>, bool) {
        let mut out: Vec<Vec<usize>> = vec![Vec::new()];
        let mut more = false;
        for component in &self.components {
            let size = component.orders.len();
            let mut next = Vec::with_capacity(out.len().saturating_mul(size).min(cap));
            'grow: for choice in &out {
                for k in 0..size {
                    if next.len() >= cap {
                        more = true;
                        break 'grow;
                    }
                    let mut grown = choice.clone();
                    grown.push(k);
                    next.push(grown);
                }
            }
            out = next;
        }
        (out, more)
    }

    /// The choice that gives `order` on every open pair; `None` when no
    /// listed order of some component agrees with it.
    pub fn choice_of(&self, order: &LayerOrder) -> Option<Vec<usize>> {
        self.components
            .iter()
            .map(|component| {
                component.orders.iter().position(|listed| {
                    component.pairs.iter().zip(listed).all(|(pair, &lo_above)| {
                        order.above(pair.lo(), pair.hi()) == Some(lo_above)
                    })
                })
            })
            .collect()
    }
}

fn upper_lower(pair: FacePair, lo_above: bool) -> [FaceId; 2] {
    if lo_above {
        [pair.lo(), pair.hi()]
    } else {
        [pair.hi(), pair.lo()]
    }
}

/// Complete the order of `view`, whose constraint problem is `problem`, from
/// the `fixed` pairs.
pub fn complete(
    view: &FoldedView,
    problem: &ConstraintProblem,
    fixed: &[FixedPair],
    limits: &CompletionLimits,
) -> Result<Completions, CompletionRefusal> {
    complete_in(view, problem, fixed, None, limits)
}

/// [`complete`], searching only where an order can still change: around the
/// `focus` faces, such as the faces a compound fold moved (plan D4: local
/// completion, only the cells the moved faces cover).
///
/// The search sees the cells that cover a focus face, the faces in them and
/// every face of a constraint on a focus face's pair, with the pairs among
/// those faces and their constraints. That loses nothing when every pair it
/// leaves out is fixed as [`FixedKind::Carried`], which an operation's carry
/// gives it: such a pair is never propagated, so its constraints and its
/// cells' transitivity are never read. A pair with no fixed order adds its
/// faces to the focus, so it is never left out. The result is the whole
/// problem's: its forced pairs, components and ‹ n of m ›.
pub fn complete_around(
    view: &FoldedView,
    problem: &ConstraintProblem,
    fixed: &[FixedPair],
    focus: &BTreeSet<FaceId>,
    limits: &CompletionLimits,
) -> Result<Completions, CompletionRefusal> {
    complete_in(view, problem, fixed, Some(focus), limits)
}

fn complete_in(
    view: &FoldedView,
    problem: &ConstraintProblem,
    fixed: &[FixedPair],
    focus: Option<&BTreeSet<FaceId>>,
    limits: &CompletionLimits,
) -> Result<Completions, CompletionRefusal> {
    if !problem.is_for(view) {
        return Err(invalid("the problem was built from another view"));
    }
    if !problem.ambiguities().is_empty() {
        return Err(CompletionRefusal::AmbiguousOverlap {
            ambiguities: problem.ambiguities().to_vec(),
        });
    }
    if limits.per_component == 0 {
        return Err(invalid("a component must list at least one order"));
    }
    // The search reads the clock only every few dozen nodes, after the
    // region and the problem are built: a completion asked for after its
    // deadline would run whole before it noticed.
    if limits.out_of_time() {
        return Err(CompletionRefusal::BudgetExceeded {
            limit: BudgetLimit::Deadline,
            nodes: 0,
        });
    }
    let assignments = fixed_assignments(problem, fixed)?;
    let region = match focus {
        Some(focus) => Region::around(view, problem, &assignments, focus),
        None => Region::whole(view, problem),
    };
    let (search, faces) = search_problem(problem, &region, &assignments)?;
    let options = CompletionOptions {
        solution_limit: SolutionLimit::Count(limits.per_component),
        budget: search_budget(limits.max_nodes, limits.deadline),
    };
    let solution = match flatfold::complete_layer_order(&search, &options) {
        Ok(Completion::Solved(solution)) => solution,
        Ok(Completion::Conflict(conflict)) => return Err(conflict_refusal(&conflict, &faces)?),
        Ok(Completion::UnsatisfiedComponent(component)) => {
            return Err(CompletionRefusal::NoOrder {
                faces: faces.ids_of(&component.faces)?,
            });
        }
        Err(e) => return Err(search_refusal(e)),
    };
    let variables = problem.variables().to_vec();
    let lo_above = |order: PairOrder| order == PairOrder::FirstAbove;
    let global = |v: usize| {
        region
            .variables
            .get(v)
            .and_then(|&g| variables.get(g).copied())
            .ok_or_else(|| invalid("the search named a variable out of range"))
    };
    let components = solution
        .components
        .iter()
        .map(|component| {
            let pairs = component
                .variables
                .iter()
                .map(|&v| global(v))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(ComponentChoices {
                pairs,
                orders: component
                    .solutions
                    .iter()
                    .map(|s| s.iter().map(|&o| lo_above(o)).collect())
                    .collect(),
                truncated: component.truncated,
            })
        })
        .collect::<Result<Vec<_>, CompletionRefusal>>()?;
    // A pair outside the region keeps the order it was fixed to.
    let mut forced: Vec<Option<bool>> = vec![None; variables.len()];
    for a in &assignments {
        forced[a.variable] = Some(a.order == PairOrder::FirstAbove);
    }
    for (&g, order) in region.variables.iter().zip(&solution.forced) {
        forced[g] = order.map(lo_above);
    }
    Ok(Completions {
        forced,
        variables,
        components,
        nodes: solution.nodes,
    })
}

/// The search's problem over `region`, with the `assignments` that fall in
/// it, and the search's face numbers.
fn search_problem(
    problem: &ConstraintProblem,
    region: &Region,
    assignments: &[FixedAssignment],
) -> Result<(CompletionProblem, FaceIndex), CompletionRefusal> {
    let faces = FaceIndex {
        ids: region.faces.clone(),
    };
    let local_variable = region.local_variables(problem);
    let search = CompletionProblem {
        variables: region
            .variables
            .iter()
            .map(|&v| faces.pair(problem.variables()[v]))
            .collect::<Result<_, _>>()?,
        constraints: region
            .variables
            .iter()
            .map(|&v| buckets(problem, v, &faces, region))
            .collect::<Result<_, _>>()?,
        faces_cells: region.faces_cells(problem),
        cells_faces: region
            .cells
            .iter()
            .map(|&c| {
                problem.overlay().cells()[c]
                    .faces
                    .iter()
                    .map(|&f| faces.of(f))
                    .collect()
            })
            .collect::<Result<_, _>>()?,
        fixed: assignments
            .iter()
            .filter_map(|a| {
                local_variable[a.variable].map(|variable| FixedAssignment { variable, ..*a })
            })
            .collect(),
    };
    Ok((search, faces))
}

fn search_budget(max_nodes: Option<u64>, deadline: Option<Deadline>) -> SearchBudget {
    SearchBudget {
        max_nodes,
        deadline: deadline.map(|d| flatfold::Deadline {
            now_ms: d.now_ms,
            at_ms: d.at_ms,
        }),
    }
}

fn budget_limit(limit: flatfold::BudgetLimit) -> BudgetLimit {
    match limit {
        flatfold::BudgetLimit::Nodes => BudgetLimit::Nodes,
        flatfold::BudgetLimit::Deadline => BudgetLimit::Deadline,
    }
}

fn conflict_refusal(
    conflict: &flatfold::CompletionConflict,
    faces: &FaceIndex,
) -> Result<CompletionRefusal, CompletionRefusal> {
    Ok(CompletionRefusal::Conflict {
        family: match conflict.constraint {
            flatfold::ConstraintKind::TacoTaco => ConstraintFamily::TacoTaco,
            flatfold::ConstraintKind::TacoTortilla => ConstraintFamily::TacoTortilla,
            flatfold::ConstraintKind::TortillaTortilla => ConstraintFamily::TortillaTortilla,
            flatfold::ConstraintKind::Transitivity => ConstraintFamily::Transitivity,
        },
        faces: faces.ids_of(&conflict.faces)?,
        traced: faces.ids_of(&conflict.error_faces)?,
    })
}

fn search_refusal(error: CompletionError) -> CompletionRefusal {
    match error {
        CompletionError::BudgetExceeded { limit, nodes } => CompletionRefusal::BudgetExceeded {
            limit: budget_limit(limit),
            nodes,
        },
        e => invalid(&e.to_string()),
    }
}

/// The part of a problem a search runs over: faces by ascending id (the
/// search's face numbers), variables ascending, cells.
struct Region {
    faces: Vec<FaceId>,
    /// Indices into the problem's variables, ascending: so each lists its
    /// faces in increasing search numbers, as the search requires.
    variables: Vec<usize>,
    /// Indices into the overlay's cells, ascending.
    cells: Vec<usize>,
    /// The region is the whole problem.
    whole: bool,
}

impl Region {
    /// Everything.
    fn whole(view: &FoldedView, problem: &ConstraintProblem) -> Region {
        let mut faces: Vec<FaceId> = view.faces().iter().map(|f| f.id).collect();
        faces.sort_unstable();
        Region {
            faces,
            variables: (0..problem.variables().len()).collect(),
            cells: (0..problem.overlay().cells().len()).collect(),
            whole: true,
        }
    }

    /// Around `focus` and the faces of every pair `assignments` leave open
    /// (see [`complete_around`]).
    fn around(
        view: &FoldedView,
        problem: &ConstraintProblem,
        assignments: &[FixedAssignment],
        focus: &BTreeSet<FaceId>,
    ) -> Region {
        let variables = problem.variables();
        let mut fixed = vec![false; variables.len()];
        for a in assignments {
            fixed[a.variable] = true;
        }
        let position = |f: FaceId| view.index_of(f);
        let mut in_focus = vec![false; view.faces().len()];
        for p in focus.iter().filter_map(|&f| position(f)) {
            in_focus[p] = true;
        }
        for (v, pair) in variables.iter().enumerate() {
            if !fixed[v] {
                for p in pair.faces().into_iter().filter_map(position) {
                    in_focus[p] = true;
                }
            }
        }
        let mut inside = in_focus.clone();
        let overlay = problem.overlay();
        let mut cells: Vec<usize> = view
            .faces()
            .iter()
            .zip(&in_focus)
            .filter(|(_, f)| **f)
            .flat_map(|(face, _)| overlay.faces_cells(face.id).iter().copied())
            .collect();
        cells.sort_unstable();
        cells.dedup();
        for &c in &cells {
            for p in overlay.cells()[c].faces.iter().filter_map(|&f| position(f)) {
                inside[p] = true;
            }
        }
        for (v, pair) in variables.iter().enumerate() {
            let touches_focus = pair
                .faces()
                .into_iter()
                .filter_map(position)
                .any(|p| in_focus[p]);
            let Some(buckets) = touches_focus.then(|| problem.buckets(v)).flatten() else {
                continue;
            };
            for &k in buckets
                .taco_taco
                .iter()
                .chain(&buckets.taco_tortilla)
                .chain(&buckets.tortilla_tortilla)
            {
                let Some(constraint) = problem.constraints().get(k) else {
                    continue;
                };
                for p in constraint.faces().iter().filter_map(|&f| position(f)) {
                    inside[p] = true;
                }
            }
        }
        let mut faces: Vec<FaceId> = view
            .faces()
            .iter()
            .zip(&inside)
            .filter(|(_, i)| **i)
            .map(|(face, _)| face.id)
            .collect();
        faces.sort_unstable();
        if faces.len() == view.faces().len() {
            return Region::whole(view, problem);
        }
        let variables = (0..variables.len())
            .filter(|&v| {
                variables[v]
                    .faces()
                    .into_iter()
                    .all(|f| position(f).is_some_and(|p| inside[p]))
            })
            .collect();
        Region {
            faces,
            variables,
            cells,
            whole: false,
        }
    }

    /// Per problem variable, its index in the region.
    fn local_variables(&self, problem: &ConstraintProblem) -> Vec<Option<usize>> {
        let mut out = vec![None; problem.variables().len()];
        for (local, &v) in self.variables.iter().enumerate() {
            out[v] = Some(local);
        }
        out
    }

    /// Per region face, its cells in the region, by region cell number.
    fn faces_cells(&self, problem: &ConstraintProblem) -> Vec<Vec<usize>> {
        self.faces
            .iter()
            .map(|&id| {
                problem
                    .overlay()
                    .faces_cells(id)
                    .iter()
                    .filter_map(|c| self.cells.binary_search(c).ok())
                    .collect()
            })
            .collect()
    }

    /// Whether every face of a constraint is in the region, so every pair it
    /// reads is one of the region's variables.
    fn holds(&self, faces: &[FaceId]) -> bool {
        self.whole || faces.iter().all(|f| self.faces.binary_search(f).is_ok())
    }
}

/// The search's face numbers: a region's faces by ascending id.
#[derive(Debug, Clone)]
struct FaceIndex {
    ids: Vec<FaceId>,
}

impl FaceIndex {
    fn of(&self, id: FaceId) -> Result<usize, CompletionRefusal> {
        self.ids
            .binary_search(&id)
            .map_err(|_| invalid(&format!("face {id} is not in the view")))
    }

    fn pair(&self, pair: FacePair) -> Result<[usize; 2], CompletionRefusal> {
        Ok([self.of(pair.lo())?, self.of(pair.hi())?])
    }

    fn tuple<const N: usize>(&self, faces: &[FaceId; N]) -> Result<[usize; N], CompletionRefusal> {
        let mut out = [0; N];
        for (slot, &face) in out.iter_mut().zip(faces) {
            *slot = self.of(face)?;
        }
        Ok(out)
    }

    fn ids_of(&self, faces: &[usize]) -> Result<Vec<FaceId>, CompletionRefusal> {
        faces
            .iter()
            .map(|&f| {
                self.ids
                    .get(f)
                    .copied()
                    .ok_or_else(|| invalid("the search named a face out of range"))
            })
            .collect()
    }
}

/// Variable `v`'s constraints in the search's form: the same tuples, by face
/// number.
fn buckets(
    problem: &ConstraintProblem,
    v: usize,
    faces: &FaceIndex,
    region: &Region,
) -> Result<VariableConstraints, CompletionRefusal> {
    let buckets = problem
        .buckets(v)
        .ok_or_else(|| invalid("a variable has no buckets"))?;
    // The constraint, or none when one of its faces is outside the region.
    let constraint = |k: usize| -> Result<Option<Constraint>, CompletionRefusal> {
        let c = problem
            .constraints()
            .get(k)
            .copied()
            .ok_or_else(|| invalid("a bucket names a constraint out of range"))?;
        Ok(region.holds(c.faces()).then_some(c))
    };
    let mut out = VariableConstraints::default();
    for &k in &buckets.taco_taco {
        if let Some(Constraint::TacoTaco(f)) = constraint(k)? {
            out.taco_taco.push(faces.tuple(&f)?);
        }
    }
    for &k in &buckets.taco_tortilla {
        if let Some(Constraint::TacoTortilla(f)) = constraint(k)? {
            out.taco_tortilla.push(faces.tuple(&f)?);
        }
    }
    for &k in &buckets.tortilla_tortilla {
        if let Some(Constraint::TortillaTortilla(f)) = constraint(k)? {
            out.tortilla_tortilla.push(faces.tuple(&f)?);
        }
    }
    Ok(out)
}

/// The fixed pairs as variable assignments, refusing a pair that is no
/// variable or that is given both orders.
fn fixed_assignments(
    problem: &ConstraintProblem,
    fixed: &[FixedPair],
) -> Result<Vec<FixedAssignment>, CompletionRefusal> {
    let mut seen: BTreeMap<usize, bool> = BTreeMap::new();
    let mut out = Vec::with_capacity(fixed.len());
    for f in fixed {
        let Some(pair) = FacePair::new(f.upper, f.lower) else {
            return Err(invalid(&format!(
                "face {} is ordered against itself",
                f.upper
            )));
        };
        let Some(variable) = problem.variable(pair) else {
            return Err(CompletionRefusal::FixedNotOverlapping { pair });
        };
        let lo_above = pair.lo() == f.upper;
        if seen.insert(variable, lo_above) == Some(!lo_above) {
            return Err(CompletionRefusal::FixedContradictory { pair });
        }
        out.push(FixedAssignment {
            variable,
            order: if lo_above {
                PairOrder::FirstAbove
            } else {
                PairOrder::SecondAbove
            },
            kind: match f.kind {
                FixedKind::Carried => flatfold::FixedKind::Carried,
                FixedKind::Seed => flatfold::FixedKind::Seed,
            },
        });
    }
    Ok(out)
}

fn invalid(message: &str) -> CompletionRefusal {
    CompletionRefusal::InvalidProblem {
        message: message.to_string(),
    }
}

/// What one check may spend (the Layer order dialog's bound per choice).
#[derive(Debug, Clone, Copy)]
pub struct CheckLimits {
    /// Nodes for the exhaustive fallback, Flat-Folder's own search over what
    /// the quick attempts left; `None` is unbounded.
    pub max_nodes: Option<u64>,
    /// Nodes for each of the two quick attempts (the new pairs' faces
    /// first, then the open's order).
    pub fast_nodes: u64,
    /// Read before each search node and every few propagated pairs, over the
    /// whole check.
    pub deadline: Option<Deadline>,
}

impl Default for CheckLimits {
    fn default() -> CheckLimits {
        CheckLimits {
            max_nodes: Some(CompletionLimits::DEFAULT_MAX_NODES),
            fast_nodes: flatfold::CheckOptions::DEFAULT_FAST_NODES,
            deadline: None,
        }
    }
}

/// Which part of a check settled it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckStage {
    /// Nothing new to search.
    Unchanged,
    /// A quick search with the new pairs' faces first.
    SeedsFirst,
    /// A quick search in the open's order.
    OpenOrder,
    /// Flat-Folder's own split and search, what a fresh completion runs.
    Exhaustive,
}

/// A check's answer. Only [`Check::Undecided`] is not a verdict.
#[derive(Debug, Clone, PartialEq)]
pub enum Check {
    /// An order fits the fixed pairs and the checked ones. `forced` is what
    /// they force before any search, each `[upper, lower]`.
    Fits {
        order: LayerOrder,
        forced: Vec<[FaceId; 2]>,
        nodes: u64,
        stage: CheckStage,
    },
    /// The pair `[upper, lower]` asks the opposite of a pair the fixed pairs
    /// force; `traced` is what that pair traces back to.
    Forced {
        pair: [FaceId; 2],
        traced: Vec<FaceId>,
    },
    /// The checked pairs break a constraint as they propagate; `traced` is
    /// every face it traces back to (Flat-Folder's `error_faces`).
    Conflict {
        family: ConstraintFamily,
        faces: Vec<FaceId>,
        traced: Vec<FaceId>,
    },
    /// A search proved no order fits: `faces` have no order, given the
    /// pairs `traced` leads back to.
    NoOrder {
        faces: Vec<FaceId>,
        traced: Vec<FaceId>,
        nodes: u64,
    },
    /// No answer within the limits: neither a fit nor a proof.
    Undecided { limit: BudgetLimit, nodes: u64 },
}

impl Check {
    /// Whether an order fits, when the check decided it.
    pub fn verdict(&self) -> Option<bool> {
        match self {
            Check::Fits { .. } => Some(true),
            Check::Undecided { .. } => None,
            _ => Some(false),
        }
    }
}

/// A completion kept open for many checks (the Layer order dialog): the
/// fixed pairs' propagation, what they force and a first order are found
/// once by [`CompletionSession::open`]; each [`CompletionSession::check`]
/// then asks whether some more pairs leave an order, from that state
/// (`treemaker_flatfold::CompletionSession`). A check's verdict is the one
/// [`complete`] gives with the same pairs added, and it decides whenever
/// `complete` would within the same node budget.
#[derive(Debug, Clone)]
pub struct CompletionSession {
    /// The problem's variables, ascending: the search's variable `k` is
    /// `variables[k]`.
    variables: Vec<FacePair>,
    faces: FaceIndex,
    search: Box<flatfold::CompletionSession>,
}

impl CompletionSession {
    /// Propagate `fixed`, find what it forces and a first order, within
    /// `limits.max_nodes` and its deadline (`per_component` is not read).
    pub fn open(
        view: &FoldedView,
        problem: &ConstraintProblem,
        fixed: &[FixedPair],
        limits: &CompletionLimits,
    ) -> Result<CompletionSession, CompletionRefusal> {
        if !problem.is_for(view) {
            return Err(invalid("the problem was built from another view"));
        }
        if !problem.ambiguities().is_empty() {
            return Err(CompletionRefusal::AmbiguousOverlap {
                ambiguities: problem.ambiguities().to_vec(),
            });
        }
        if limits.out_of_time() {
            return Err(CompletionRefusal::BudgetExceeded {
                limit: BudgetLimit::Deadline,
                nodes: 0,
            });
        }
        let assignments = fixed_assignments(problem, fixed)?;
        let region = Region::whole(view, problem);
        let (search, faces) = search_problem(problem, &region, &assignments)?;
        let budget = search_budget(limits.max_nodes, limits.deadline);
        match flatfold::CompletionSession::open(search, budget) {
            Ok(flatfold::SessionStart::Open(search)) => Ok(CompletionSession {
                variables: problem.variables().to_vec(),
                faces,
                search,
            }),
            Ok(flatfold::SessionStart::Conflict(conflict)) => {
                Err(conflict_refusal(&conflict, &faces)?)
            }
            Ok(flatfold::SessionStart::UnsatisfiedComponent(component)) => {
                Err(CompletionRefusal::NoOrder {
                    faces: faces.ids_of(&component.faces)?,
                })
            }
            Err(e) => Err(search_refusal(e)),
        }
    }

    /// The pairs the fixed pairs force, each `[upper, lower]`: what a
    /// dialog greys out.
    pub fn forced_pairs(&self) -> Vec<[FaceId; 2]> {
        self.variables
            .iter()
            .zip(self.search.forced())
            .filter_map(|(&pair, order)| {
                order.map(|o| upper_lower(pair, o == PairOrder::FirstAbove))
            })
            .collect()
    }

    /// Whether `upper` is forced above `lower` (`Some(true)`), forced below
    /// it (`Some(false)`), or open or not overlapping (`None`).
    pub fn forced(&self, upper: FaceId, lower: FaceId) -> Option<bool> {
        let pair = FacePair::new(upper, lower)?;
        let v = self.variables.binary_search(&pair).ok()?;
        let lo_above = self.search.forced()[v]? == PairOrder::FirstAbove;
        Some(lo_above == (pair.lo() == upper))
    }

    /// Why a pair is forced: the faces it traces back to through the fixed
    /// pairs' propagation. Empty when it is not forced.
    pub fn forced_by(&self, a: FaceId, b: FaceId) -> Vec<FaceId> {
        let Some(v) = FacePair::new(a, b).and_then(|p| self.variables.binary_search(&p).ok())
        else {
            return Vec::new();
        };
        self.faces
            .ids_of(&self.search.forced_by(v))
            .unwrap_or_default()
    }

    /// The first order the open found: each component's first, as
    /// [`complete`] lists it.
    pub fn first_order(&self) -> LayerOrder {
        self.order_of(&self.search.first())
    }

    /// Search nodes the open used.
    pub fn nodes(&self) -> u64 {
        self.search.nodes()
    }

    fn order_of(&self, orders: &[PairOrder]) -> LayerOrder {
        let mut order = LayerOrder::new();
        for (&pair, &o) in self.variables.iter().zip(orders) {
            let [upper, lower] = upper_lower(pair, o == PairOrder::FirstAbove);
            // Every pair once, so no pair is set both ways.
            let _ = order.set_above(upper, lower);
        }
        order
    }

    /// Whether the fixed pairs and `pairs` (seeds, each `upper` above
    /// `lower`) leave an order, and one, as close to `prefer` as the quick
    /// searches find (the order on screen, so the preview changes as little
    /// as possible). `prefer` never changes a verdict.
    pub fn check(
        &self,
        pairs: &[FixedPair],
        prefer: Option<&LayerOrder>,
        limits: &CheckLimits,
    ) -> Result<Check, CompletionRefusal> {
        let mut seen: BTreeMap<usize, bool> = BTreeMap::new();
        let mut seeds = Vec::with_capacity(pairs.len());
        for p in pairs {
            if p.kind != FixedKind::Seed {
                return Err(invalid("a check adds seeds, not carried pairs"));
            }
            let Some(pair) = FacePair::new(p.upper, p.lower) else {
                return Err(invalid(&format!(
                    "face {} is ordered against itself",
                    p.upper
                )));
            };
            let Ok(variable) = self.variables.binary_search(&pair) else {
                return Err(CompletionRefusal::FixedNotOverlapping { pair });
            };
            let lo_above = pair.lo() == p.upper;
            if seen.insert(variable, lo_above) == Some(!lo_above) {
                return Err(CompletionRefusal::FixedContradictory { pair });
            }
            seeds.push((
                variable,
                if lo_above {
                    PairOrder::FirstAbove
                } else {
                    PairOrder::SecondAbove
                },
            ));
        }
        let preferred: Option<Vec<PairOrder>> = prefer.map(|order| {
            let first = self.search.first();
            self.variables
                .iter()
                .zip(first)
                .map(|(pair, first)| match order.above(pair.lo(), pair.hi()) {
                    Some(true) => PairOrder::FirstAbove,
                    Some(false) => PairOrder::SecondAbove,
                    None => first,
                })
                .collect()
        });
        let options = flatfold::CheckOptions {
            budget: search_budget(limits.max_nodes, limits.deadline),
            fast_nodes: limits.fast_nodes,
            prefer: preferred.as_deref(),
            // `prefer` can leave pairs out, which take the open's first
            // order, so what is passed is not known to fit.
            prefer_fits: false,
        };
        let outcome = self
            .search
            .check(&seeds, &options)
            .map_err(search_refusal)?;
        let stage = |stage: flatfold::CheckStage| match stage {
            flatfold::CheckStage::Unchanged => CheckStage::Unchanged,
            flatfold::CheckStage::SeedsFirst => CheckStage::SeedsFirst,
            flatfold::CheckStage::OpenOrder => CheckStage::OpenOrder,
            flatfold::CheckStage::Exhaustive => CheckStage::Exhaustive,
        };
        Ok(match outcome {
            flatfold::CheckOutcome::Fits(fit) => Check::Fits {
                order: self.order_of(&fit.order),
                forced: self
                    .variables
                    .iter()
                    .zip(&fit.forced)
                    .filter_map(|(&pair, order)| {
                        order.map(|o| upper_lower(pair, o == PairOrder::FirstAbove))
                    })
                    .collect(),
                nodes: fit.nodes,
                stage: stage(fit.stage),
            },
            flatfold::CheckOutcome::Forced {
                variable,
                error_faces,
                ..
            } => {
                let pair = self.variables[variable];
                let asked = seeds
                    .iter()
                    .find(|(v, _)| *v == variable)
                    .map_or(PairOrder::FirstAbove, |&(_, o)| o);
                Check::Forced {
                    pair: upper_lower(pair, asked == PairOrder::FirstAbove),
                    traced: self.faces.ids_of(&error_faces)?,
                }
            }
            flatfold::CheckOutcome::Conflict(conflict) => {
                let CompletionRefusal::Conflict {
                    family,
                    faces,
                    traced,
                } = conflict_refusal(&conflict, &self.faces)?
                else {
                    return Err(invalid("a conflict mapped to another refusal"));
                };
                Check::Conflict {
                    family,
                    faces,
                    traced,
                }
            }
            flatfold::CheckOutcome::NoOrder(none) => Check::NoOrder {
                faces: self.faces.ids_of(&none.faces)?,
                traced: self.faces.ids_of(&none.error_faces)?,
                nodes: none.nodes,
            },
            flatfold::CheckOutcome::Undecided { limit, nodes } => Check::Undecided {
                limit: budget_limit(limit),
                nodes,
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oristudio_layer_order::{Edge, EdgeKind, Face, Letter};

    fn square(x0: f64, x1: f64) -> Vec<[f64; 2]> {
        vec![[x0, 0.0], [x1, 0.0], [x1, 1.0], [x0, 1.0]]
    }

    /// `n` coincident unit squares, alternately front-up, joined by folded
    /// creases along x = 1 and x = 0 in turn (a zigzag of `n` layers), with
    /// their letters given or not.
    fn zigzag(n: u32, letters: Option<Letter>) -> FoldedView {
        let faces = (0..n)
            .map(|i| Face {
                id: FaceId(i),
                polygon: square(0.0, 1.0),
                front_up: i.is_multiple_of(2),
            })
            .collect();
        let edges = (1..n)
            .map(|i| {
                let x = if i.is_multiple_of(2) { 0.0 } else { 1.0 };
                Edge {
                    faces: [FaceId(i - 1), FaceId(i)],
                    segment: [[x, 0.0], [x, 1.0]],
                    kind: EdgeKind::Folded(letters),
                }
            })
            .collect();
        FoldedView::new(faces, edges).unwrap_or_else(|e| panic!("{e}"))
    }

    fn seed(upper: u32, lower: u32) -> FixedPair {
        FixedPair {
            upper: FaceId(upper),
            lower: FaceId(lower),
            kind: FixedKind::Seed,
        }
    }

    #[test]
    fn a_single_fold_has_two_orders_until_one_is_fixed() {
        let view = zigzag(2, None);
        let problem = ConstraintProblem::build(&view);
        let open = complete(&view, &problem, &[], &CompletionLimits::default())
            .unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(
            open.count(),
            ChoiceCount {
                orders: 2,
                exact: true
            }
        );
        assert!(!open.is_unique());
        let fixed = complete(&view, &problem, &[seed(1, 0)], &CompletionLimits::default())
            .unwrap_or_else(|e| panic!("{e}"));
        assert!(fixed.is_unique());
        assert!(fixed.components().is_empty());
        assert_eq!(fixed.forced_pairs(), vec![[FaceId(1), FaceId(0)]]);
        let order = fixed.order(&[]).unwrap_or_default();
        assert_eq!(order.above(FaceId(1), FaceId(0)), Some(true));
        assert_eq!(fixed.choice_of(&order), Some(Vec::new()));
    }

    #[test]
    fn three_coincident_layers_stack_in_six_ways() {
        // Each crease lies on the third layer's boundary, so nothing but
        // transitivity in their one shared cell orders them: 3! of the 2³
        // assignments.
        let view = zigzag(3, None);
        let problem = ConstraintProblem::build(&view);
        let open = complete(&view, &problem, &[], &CompletionLimits::default())
            .unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(
            open.count(),
            ChoiceCount {
                orders: 6,
                exact: true
            }
        );
        assert_eq!(open.components().len(), 1);
        // Every listed choice is a complete, valid order, and found again
        // from its order.
        for pick in 0..6 {
            let order = open.order(&[pick]).unwrap_or_default();
            assert_eq!(order.len(), 3);
            assert!(oristudio_layer_order::check(&view, &order).is_valid());
            assert_eq!(open.choice_of(&order), Some(vec![pick]));
            assert_eq!(open.chosen_pairs(&[pick]).map(|p| p.len()), Some(3));
        }
        assert_eq!(open.order(&[6]), None);
        assert_eq!(open.chosen_pairs(&[]), None);
    }

    #[test]
    fn contradictions_and_strangers_are_refused() {
        let view = zigzag(3, None);
        let problem = ConstraintProblem::build(&view);
        let limits = CompletionLimits::default();
        assert_eq!(
            complete(&view, &problem, &[seed(1, 0), seed(0, 1)], &limits).map(|_| ()),
            Err(CompletionRefusal::FixedContradictory {
                pair: FacePair::new(FaceId(0), FaceId(1)).unwrap_or_else(|| unreachable!())
            })
        );
        assert!(matches!(
            complete(&view, &problem, &[seed(0, 7)], &limits),
            Err(CompletionRefusal::FixedNotOverlapping { .. })
        ));
        // A cycle in their shared cell breaks transitivity.
        let conflict = complete(
            &view,
            &problem,
            &[seed(0, 1), seed(1, 2), seed(2, 0)],
            &limits,
        );
        match conflict {
            Err(e @ CompletionRefusal::Conflict { .. }) => {
                assert_eq!(e.code(), "conflict");
                assert_eq!(e.faces(), vec![FaceId(0), FaceId(1), FaceId(2)]);
            }
            other => panic!("expected a conflict, got {other:?}"),
        }
    }

    /// A completion asked for after its deadline does not run: the search
    /// reads the clock only every few dozen nodes, so a small one would
    /// otherwise finish whole, and a large one build its problem first.
    #[test]
    fn a_completion_after_its_deadline_does_not_run() {
        fn epoch() -> f64 {
            0.0
        }
        let view = zigzag(2, None);
        let problem = ConstraintProblem::build(&view);
        let late = CompletionLimits {
            deadline: Some(Deadline {
                now_ms: epoch,
                at_ms: 0.0,
            }),
            ..CompletionLimits::default()
        };
        assert!(late.out_of_time());
        assert_eq!(
            complete(&view, &problem, &[], &late).map(|_| ()),
            Err(CompletionRefusal::BudgetExceeded {
                limit: BudgetLimit::Deadline,
                nodes: 0
            })
        );
        let early = CompletionLimits {
            deadline: Some(Deadline {
                now_ms: epoch,
                at_ms: 1.0,
            }),
            ..CompletionLimits::default()
        };
        assert!(!early.out_of_time());
        assert!(complete(&view, &problem, &[], &early).is_ok());
    }

    #[test]
    fn the_budget_and_the_listing_limit_are_reported() {
        let view = zigzag(4, None);
        let problem = ConstraintProblem::build(&view);
        let all = complete(&view, &problem, &[], &CompletionLimits::default())
            .unwrap_or_else(|e| panic!("{e}"));
        assert!(all.count().exact);
        assert!(all.nodes() > 1);
        let short = CompletionLimits {
            max_nodes: Some(1),
            ..CompletionLimits::default()
        };
        assert_eq!(
            complete(&view, &problem, &[], &short).map(|_| ()),
            Err(CompletionRefusal::BudgetExceeded {
                limit: BudgetLimit::Nodes,
                nodes: 1
            })
        );
        let one = CompletionLimits {
            per_component: 1,
            ..CompletionLimits::default()
        };
        let listed = complete(&view, &problem, &[], &one).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(
            listed.count(),
            ChoiceCount {
                orders: 1,
                exact: false
            }
        );
        assert!(!listed.is_unique());
        let none = CompletionLimits {
            per_component: 0,
            ..CompletionLimits::default()
        };
        assert!(matches!(
            complete(&view, &problem, &[], &none),
            Err(CompletionRefusal::InvalidProblem { .. })
        ));
    }

    #[test]
    fn a_session_checks_choices_as_completing_them_would() {
        let view = zigzag(4, None);
        let problem = ConstraintProblem::build(&view);
        let limits = CompletionLimits::default();
        let session = CompletionSession::open(&view, &problem, &[seed(1, 0)], &limits)
            .unwrap_or_else(|e| panic!("{e}"));
        let completed = complete(
            &view,
            &problem,
            &[seed(1, 0)],
            &CompletionLimits {
                per_component: 1,
                ..limits
            },
        )
        .unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(session.forced_pairs(), completed.forced_pairs());
        assert_eq!(
            Some(session.first_order()),
            completed.order(&vec![0; completed.components().len()])
        );
        assert_eq!(session.forced(FaceId(1), FaceId(0)), Some(true));
        assert_eq!(session.forced(FaceId(0), FaceId(1)), Some(false));
        assert_eq!(session.forced(FaceId(2), FaceId(3)), None);
        assert_eq!(
            session.forced_by(FaceId(0), FaceId(1)),
            vec![FaceId(0), FaceId(1)]
        );

        let checks = CheckLimits::default();
        // Every single choice and pair of choices: the session's verdict is
        // completing's, and a fitting order has the choices and is valid.
        let pairs: Vec<FixedPair> = (0..4)
            .flat_map(|a| (0..4).filter(move |&b| b != a).map(move |b| seed(a, b)))
            .collect();
        let mut asked = 0;
        for (i, a) in pairs.iter().enumerate() {
            for b in pairs.iter().skip(i) {
                let chosen = [*a, *b];
                let mut all = vec![seed(1, 0)];
                all.extend(chosen);
                let expected = complete(&view, &problem, &all, &limits);
                let checked = session.check(&chosen, None, &checks);
                match (&expected, &checked) {
                    (Ok(_), Ok(Check::Fits { order, .. })) => {
                        assert!(oristudio_layer_order::check(&view, order).is_valid());
                        for p in &chosen {
                            assert_eq!(order.above(p.upper, p.lower), Some(true));
                        }
                    }
                    (Err(_), Ok(check)) => assert_eq!(check.verdict(), Some(false), "{chosen:?}"),
                    (
                        Err(CompletionRefusal::FixedContradictory { .. }),
                        Err(CompletionRefusal::FixedContradictory { .. }),
                    ) => {}
                    other => panic!("{chosen:?}: {other:?}"),
                }
                asked += 1;
            }
        }
        assert!(asked > 50);
        // The preferred order is kept when nothing asks to change it.
        let other =
            complete(&view, &problem, &[seed(1, 0)], &limits).unwrap_or_else(|e| panic!("{e}"));
        let last = vec![other.components()[0].orders.len() - 1];
        let preferred = other.order(&last).unwrap_or_default();
        match session.check(&[], Some(&preferred), &checks) {
            Ok(Check::Fits { order, .. }) => assert_eq!(order, preferred),
            other => panic!("{other:?}"),
        }
        assert!(matches!(
            session.check(&[seed(0, 7)], None, &checks),
            Err(CompletionRefusal::FixedNotOverlapping { .. })
        ));
        let carried = FixedPair {
            kind: FixedKind::Carried,
            ..seed(2, 3)
        };
        assert!(matches!(
            session.check(&[carried], None, &checks),
            Err(CompletionRefusal::InvalidProblem { .. })
        ));
    }

    #[test]
    fn a_count_past_javascripts_integers_is_sent_as_at_least_that() {
        let sent = |orders, exact| {
            serde_json::to_value(ChoiceCount { orders, exact }).unwrap_or_else(|e| panic!("{e}"))
        };
        assert_eq!(
            sent(6, true),
            serde_json::json!({ "orders": 6, "exact": true })
        );
        let max = ChoiceCount::MAX_SENT;
        assert_eq!(
            sent(max, true),
            serde_json::json!({ "orders": max, "exact": true })
        );
        for orders in [max + 1, 65_302_194_596_872_192, u64::MAX] {
            assert_eq!(
                sent(orders, true),
                serde_json::json!({ "orders": max, "exact": false })
            );
        }
    }

    #[test]
    fn a_problem_from_another_view_is_refused() {
        let problem = ConstraintProblem::build(&zigzag(2, None));
        assert!(matches!(
            complete(
                &zigzag(3, None),
                &problem,
                &[],
                &CompletionLimits::default()
            ),
            Err(CompletionRefusal::InvalidProblem { .. })
        ));
    }
}

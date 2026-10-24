//! Completion over a caller-built layer-order problem.
//!
//! Flat-Folder builds its variables and constraints from its own arrangement
//! of the folded crease pattern. That arrangement picks its ε by a heuristic
//! and depends on face numbering, so a caller with its own geometry builds the
//! problem itself and runs only upstream's propagation and search over it
//! (`solver.js`: `initial_assignment`, `get_components`, `guess_vars`,
//! `error_faces`). Transitivity is still derived inside the search, from the
//! caller's cells, exactly as Flat-Folder derives it from its own.

use std::collections::BTreeSet;
use std::fmt;

use serde::{Deserialize, Serialize};

use crate::constraints::{
    self, ImplicationMaps, InitialPropagation, Key, NodeMeter, SearchTables, SeedConflict,
    TACO_TACO, TACO_TORTILLA, TORTILLA_TORTILLA, TransitivityCounts, TransitivitySource,
};
use crate::tables::{DENSE_FACE_LIMIT, OneSided, SearchData, SearchDataBuilder, faces_vec};
use crate::{Analysis, FlatFoldError, SolutionLimit, math};

/// Which of Flat-Folder's constraint families a constraint belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConstraintKind {
    TacoTaco,
    TacoTortilla,
    TortillaTortilla,
    Transitivity,
}

impl ConstraintKind {
    /// The solver's type index; transitivity is the last of the four.
    pub(crate) fn from_type(constraint_type: usize) -> Self {
        match constraint_type {
            TACO_TACO => Self::TacoTaco,
            TACO_TORTILLA => Self::TacoTortilla,
            TORTILLA_TORTILLA => Self::TortillaTortilla,
            _ => Self::Transitivity,
        }
    }

    /// Upstream's name for the family (`CON.names`).
    pub fn name(self) -> &'static str {
        match self {
            Self::TacoTaco => "taco-taco",
            Self::TacoTortilla => "taco-tortilla",
            Self::TortillaTortilla => "tortilla-tortilla",
            Self::Transitivity => "transitivity",
        }
    }
}

/// The order of a variable's two faces: Flat-Folder's assignment values 1
/// and 2.
///
/// "Above" is one viewing direction the caller fixes for the whole problem.
/// Every constraint table is symmetric under reversing it, so any consistent
/// choice works, and the solutions come back in the same convention.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PairOrder {
    /// The first (smaller) face of the variable lies above the second.
    FirstAbove,
    /// The second face lies above the first.
    SecondAbove,
}

impl PairOrder {
    pub(crate) fn value(self) -> u8 {
        match self {
            Self::FirstAbove => 1,
            Self::SecondAbove => 2,
        }
    }

    pub(crate) fn from_value(value: u8) -> Option<Self> {
        match value {
            1 => Some(Self::FirstAbove),
            2 => Some(Self::SecondAbove),
            _ => None,
        }
    }
}

/// How a fixed order enters the search.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FixedKind {
    /// Already known to be consistent with everything around it, such as a
    /// pair a fold left in place. It is assigned but never propagated, so a
    /// constraint whose variables are all carried is never checked here.
    Carried,
    /// New information, propagated with everything it implies.
    Seed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct FixedAssignment {
    /// Index into [`CompletionProblem::variables`].
    pub variable: usize,
    pub order: PairOrder,
    pub kind: FixedKind,
}

/// The constraints one variable takes part in, by family, in Flat-Folder's
/// face conventions (`constraints.js` `pair_maps`). A constraint is listed in
/// the bucket of every variable it reads, as upstream's `add_constraint`
/// lists it. [`complete_layer_order`] runs upstream's procedure over the
/// buckets as given and does not check this;
/// [`CompletionSession::open`](crate::CompletionSession::open) refuses a
/// problem that breaks it, because its components are only independent when
/// it holds.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct VariableConstraints {
    /// `[A, B, C, D]`: tacos A–B and C–D whose creases cross. Reads A–B, C–D,
    /// C–B, A–D, A–C and B–D.
    pub taco_taco: Vec<[usize; 4]>,
    /// `[A, B, C]`: taco A–B whose crease crosses face C, so C is not between
    /// A and B. Reads A–C and C–B.
    pub taco_tortilla: Vec<[usize; 3]>,
    /// `[A, B, C, D]`: A–C and B–D must stack the same way. Reads A–C and B–D.
    pub tortilla_tortilla: Vec<[usize; 4]>,
}

/// A layer-order problem in Flat-Folder's variable form.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompletionProblem {
    /// Overlapping face pairs `[f, g]` with `f < g`.
    pub variables: Vec<[usize; 2]>,
    /// One entry per variable.
    pub constraints: Vec<VariableConstraints>,
    /// Per face, the cells it covers. Faces are `0..faces_cells.len()`.
    pub faces_cells: Vec<Vec<usize>>,
    /// Per cell, the faces covering it. Every two faces that share a cell
    /// must be a variable: transitivity is derived from these.
    pub cells_faces: Vec<Vec<usize>>,
    pub fixed: Vec<FixedAssignment>,
}

/// A wall-clock limit read through the caller's clock: wasm32 has no
/// `Instant`, so the crate never reads one itself.
#[derive(Debug, Clone, Copy)]
pub struct Deadline {
    /// Milliseconds on any monotonic clock (`performance.now()` in a page).
    pub now_ms: fn() -> f64,
    /// Stop once `now_ms()` reaches this.
    pub at_ms: f64,
}

/// Limits on the search. The search over each component is what can blow up,
/// and what the node count meters; propagating the seeds is polynomial, but
/// through a deep stack it is most of a completion, so the deadline meters it
/// too. Splitting the rest into components always runs to the end.
#[derive(Debug, Clone, Copy, Default)]
pub struct SearchBudget {
    /// Search nodes (a guess and its propagation) allowed across every
    /// component. `None` is unbounded.
    pub max_nodes: Option<u64>,
    /// Read before each search node, and every few variables the seeds'
    /// propagation visits.
    pub deadline: Option<Deadline>,
}

#[derive(Debug, Clone, Default)]
pub struct CompletionOptions {
    /// Solutions kept per component.
    pub solution_limit: SolutionLimit,
    pub budget: SearchBudget,
}

/// Every order the constraints allow.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompletionSolution {
    /// Each variable's order after propagating the seeds, fixed orders
    /// included; `None` for a variable the components below decide. A
    /// variable that only carried pairs determine is not propagated to, so it
    /// is decided by its component, which then has one solution.
    pub forced: Vec<Option<PairOrder>>,
    /// The independent components of the undecided variables, smallest first.
    pub components: Vec<ComponentSolutions>,
    /// Search nodes used.
    pub nodes: u64,
}

impl CompletionSolution {
    /// Whether any component has more solutions than it lists.
    pub fn truncated(&self) -> bool {
        self.components.iter().any(|component| component.truncated)
    }

    /// Flat-Folder's `solution_counts`: 1 for the forced group, then each
    /// component's count.
    pub fn solution_counts(&self) -> Vec<usize> {
        std::iter::once(1)
            .chain(
                self.components
                    .iter()
                    .map(|component| component.solutions.len()),
            )
            .collect()
    }

    /// Flat-Folder's `states`: the product of the counts, in decimal. A lower
    /// bound when [`Self::truncated`].
    pub fn states(&self) -> String {
        constraints::product_decimal(&self.solution_counts())
    }

    /// One complete order: `choice[k]` picks component `k`'s solution. `None`
    /// when `choice` does not name one solution per component.
    pub fn assignment(&self, choice: &[usize]) -> Option<Vec<PairOrder>> {
        if choice.len() != self.components.len() {
            return None;
        }
        let mut orders = self.forced.clone();
        for (component, pick) in self.components.iter().zip(choice) {
            let solution = component.solutions.get(*pick)?;
            for (variable, order) in component.variables.iter().zip(solution) {
                *orders.get_mut(*variable)? = Some(*order);
            }
        }
        orders.into_iter().collect()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ComponentSolutions {
    /// Variable indices, in the order the search assigned them.
    pub variables: Vec<usize>,
    /// Each solution lists one order per entry of `variables`.
    pub solutions: Vec<Vec<PairOrder>>,
    /// More solutions exist than the limit kept.
    pub truncated: bool,
}

/// Propagating the seeds broke a constraint (upstream `initial_assignment`'s
/// `[type, F, E]`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompletionConflict {
    pub constraint: ConstraintKind,
    /// The constraint's faces, in its family's convention.
    pub faces: Vec<usize>,
    /// Upstream `error_faces`: every face the conflict traces back to through
    /// the propagation, ascending.
    pub error_faces: Vec<usize>,
    /// The fixed orders and seeds the conflict traces back to, as variables,
    /// ascending (ours): they and the constraints conflict with no other
    /// seed.
    #[serde(default)]
    pub roots: Vec<usize>,
}

/// A component with no valid order (upstream `solve` returning a component
/// index).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnsatisfiedComponent {
    /// Index among the free components (upstream's group `component + 1`).
    pub component: usize,
    /// The faces of its variables, in the order upstream's `compute.js`
    /// reports them.
    pub faces: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Completion {
    Solved(CompletionSolution),
    Conflict(CompletionConflict),
    UnsatisfiedComponent(UnsatisfiedComponent),
}

/// Which limit of a [`SearchBudget`] stopped the search.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BudgetLimit {
    Nodes,
    Deadline,
}

impl fmt::Display for BudgetLimit {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Nodes => "node",
            Self::Deadline => "deadline",
        })
    }
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum CompletionError {
    #[error("invalid completion problem: {0}")]
    InvalidProblem(String),
    #[error("completion search hit its {limit} budget after {nodes} nodes")]
    BudgetExceeded { limit: BudgetLimit, nodes: u64 },
    #[error(transparent)]
    Solver(#[from] FlatFoldError),
}

pub(crate) type CompletionResult<T> = std::result::Result<T, CompletionError>;

/// Propagate the seeds, then enumerate each independent component of what is
/// left, through Flat-Folder's own propagation and search.
pub fn complete_layer_order(
    problem: &CompletionProblem,
    options: &CompletionOptions,
) -> CompletionResult<Completion> {
    complete_with_tables(problem, options, DENSE_FACE_LIMIT)
}

/// [`complete_layer_order`] with its tables dense up to `dense_limit` faces.
fn complete_with_tables(
    problem: &CompletionProblem,
    options: &CompletionOptions,
    dense_limit: usize,
) -> CompletionResult<Completion> {
    let limit = match options.solution_limit {
        SolutionLimit::All => None,
        SolutionLimit::Count(0) => {
            return Err(invalid("solution limit must be positive".to_string()));
        }
        SolutionLimit::Count(limit) => Some(limit),
    };
    let input = SearchInput::with_dense_limit(problem, dense_limit)?;
    let FixedOrders {
        assignments: fixed,
        seeds,
    } = fixed_orders(problem)?;
    let tables = input.tables(problem, ImplicationMaps::shared());
    let mut counts = TransitivityCounts::default();
    let mut meter = BudgetMeter {
        budget: options.budget,
        nodes: 0,
        ticks: 0,
    };
    let assignments = match constraints::propagate_initial_assignments(
        &tables,
        fixed,
        seeds,
        &mut counts,
        &mut meter,
    )? {
        Ok(InitialPropagation::Assigned(assignments)) => assignments,
        Ok(InitialPropagation::Conflict(conflict)) => {
            return Ok(Completion::Conflict(public_conflict(conflict)));
        }
        Err(stop) => {
            return Err(CompletionError::BudgetExceeded {
                limit: stop,
                nodes: meter.nodes,
            });
        }
    };
    // Nothing here reports the transitivity counts.
    let groups = constraints::variable_groups(&tables, &assignments, None);
    // One solution past the limit tells a truncated component from one that
    // has exactly `limit` solutions.
    let search_limit = limit.map_or(usize::MAX, |limit| limit.saturating_add(1));
    let mut components = Vec::with_capacity(groups.len().saturating_sub(1));
    for (component, group) in groups.iter().skip(1).enumerate() {
        let mut scratch = assignments.clone();
        let mut solutions = match constraints::guess_vars(
            &tables,
            group,
            &mut scratch,
            search_limit,
            &mut meter,
        )? {
            Ok(solutions) => solutions,
            Err(stop) => {
                return Err(CompletionError::BudgetExceeded {
                    limit: stop,
                    nodes: meter.nodes,
                });
            }
        };
        if solutions.is_empty() {
            return Ok(Completion::UnsatisfiedComponent(UnsatisfiedComponent {
                component,
                faces: group_faces(&input.data, group),
            }));
        }
        let truncated = limit.is_some_and(|limit| solutions.len() > limit);
        if let Some(limit) = limit {
            solutions.truncate(limit);
        }
        components.push(ComponentSolutions {
            variables: group.clone(),
            solutions: solutions
                .iter()
                .map(|solution| decode_solution(solution, group.len()))
                .collect(),
            truncated,
        });
    }
    Ok(Completion::Solved(CompletionSolution {
        forced: assignments
            .iter()
            .map(|value| PairOrder::from_value(*value))
            .collect(),
        components,
        nodes: meter.nodes,
    }))
}

/// Flat-Folder's own problem for an analysed crease pattern: its variables,
/// constraint buckets and cells, with the M/V letters as seeds. Solving it
/// reproduces `solve_flat_fold`, so tests can seed Flat-Folder's own
/// constraints with an order of their choosing. Faces are numbered as in
/// `analysis.normalized`, and orders follow Flat-Folder's frame:
/// [`PairOrder::FirstAbove`] for `[f, g]` is the FOLD order
/// `[f, g, faces_flip[g] ? 1 : -1]`.
pub fn flat_folder_completion_problem(analysis: &Analysis) -> crate::Result<CompletionProblem> {
    let overlap = analysis
        .overlap
        .as_ref()
        .ok_or(FlatFoldError::Unimplemented("overlap graph"))?;
    let tables = constraints::build_constraint_tables(analysis)?;
    let fold = &analysis.normalized.document;
    let letters = constraints::initial_assignments(
        &fold.edges_faces,
        &fold.edges_assignment,
        &analysis.faces_flip,
        &tables.variables,
        &tables.variable_index,
    );
    let variables = tables
        .variables
        .iter()
        .map(|key| decode_faces::<2>(key))
        .collect::<crate::Result<Vec<_>>>()?;
    let constraints = tables
        .constraints
        .iter()
        .map(|buckets| {
            Ok(VariableConstraints {
                taco_taco: decode_bucket(&buckets[TACO_TACO])?,
                taco_tortilla: decode_bucket(&buckets[TACO_TORTILLA])?,
                tortilla_tortilla: decode_bucket(&buckets[TORTILLA_TORTILLA])?,
            })
        })
        .collect::<crate::Result<Vec<_>>>()?;
    let fixed = letters
        .iter()
        .enumerate()
        .filter_map(|(variable, value)| {
            PairOrder::from_value(*value).map(|order| FixedAssignment {
                variable,
                order,
                kind: FixedKind::Seed,
            })
        })
        .collect();
    Ok(CompletionProblem {
        variables,
        constraints,
        faces_cells: overlap.faces_cells.clone(),
        cells_faces: overlap.cells_faces.clone(),
        fixed,
    })
}

/// A validated problem's tables in the solver's encoding.
#[derive(Debug, Clone)]
pub(crate) struct SearchInput {
    pub(crate) data: SearchData,
}

/// The fixed orders in the solver's encoding.
pub(crate) struct FixedOrders {
    /// Every variable's fixed value, 0 where none is.
    pub(crate) assignments: Vec<u8>,
    /// The seeds among them in index order, as upstream's first propagation
    /// level visits them.
    pub(crate) seeds: Vec<(usize, u8)>,
}

/// A variable fixed twice to the same order is a seed if either entry is.
pub(crate) fn fixed_orders(problem: &CompletionProblem) -> CompletionResult<FixedOrders> {
    let mut assignments = vec![0u8; problem.variables.len()];
    let mut seeded = vec![false; problem.variables.len()];
    for fixed in &problem.fixed {
        let Some(value) = assignments.get_mut(fixed.variable) else {
            return Err(invalid(format!(
                "a fixed order names variable {}, but there are {}",
                fixed.variable,
                problem.variables.len()
            )));
        };
        if *value != 0 && *value != fixed.order.value() {
            return Err(invalid(format!(
                "variable {} is fixed to both orders",
                fixed.variable
            )));
        }
        *value = fixed.order.value();
        seeded[fixed.variable] |= fixed.kind == FixedKind::Seed;
    }
    let seeds = constraints::assigned_level(&assignments)
        .into_iter()
        .filter(|(variable, _)| seeded[*variable])
        .collect();
    Ok(FixedOrders { assignments, seeds })
}

impl SearchInput {
    /// Validate `problem` and build its tables, dense up to `dense_limit`
    /// faces (`DENSE_FACE_LIMIT` outside tests, which run both forms).
    pub(crate) fn with_dense_limit(
        problem: &CompletionProblem,
        dense_limit: usize,
    ) -> CompletionResult<Self> {
        let face_count = problem.faces_cells.len();
        check_incidence(problem)?;
        let mut builder = SearchDataBuilder::new(face_count, problem.variables.len(), dense_limit);
        for (index, &[a, b]) in problem.variables.iter().enumerate() {
            if a >= b {
                return Err(invalid(format!(
                    "variable {index} is [{a}, {b}]; a variable lists two faces in increasing order"
                )));
            }
            if b >= face_count {
                return Err(invalid(format!(
                    "variable {index} names face {b}, but faces_cells has {face_count} faces"
                )));
            }
            if u32::try_from(b).is_err() {
                return Err(invalid(format!("variable {index} names face {b}")));
            }
            if let Some(previous) = builder.variable(a, b) {
                return Err(invalid(format!(
                    "variables {previous} and {index} are both [{a}, {b}]"
                )));
            }
        }
        if problem.constraints.len() != problem.variables.len() {
            return Err(invalid(format!(
                "constraints has {} entries for {} variables",
                problem.constraints.len(),
                problem.variables.len()
            )));
        }
        for (cell, faces) in problem.cells_faces.iter().enumerate() {
            for (offset, &a) in faces.iter().enumerate() {
                for &b in &faces[offset + 1..] {
                    if a != b && builder.pair(a, b).is_none() {
                        return Err(invalid(format!(
                            "faces {a} and {b} share cell {cell} but are not a variable; \
                             transitivity needs every such pair"
                        )));
                    }
                }
            }
        }
        for (index, buckets) in problem.constraints.iter().enumerate() {
            let owner = problem.variables[index];
            encode_bucket(&mut builder, TACO_TACO, &buckets.taco_taco, index, owner)?;
            encode_bucket(
                &mut builder,
                TACO_TORTILLA,
                &buckets.taco_tortilla,
                index,
                owner,
            )?;
            encode_bucket(
                &mut builder,
                TORTILLA_TORTILLA,
                &buckets.tortilla_tortilla,
                index,
                owner,
            )?;
        }
        Ok(Self {
            data: builder.finish(),
        })
    }

    /// Refuse a constraint missing from the bucket of a variable it reads
    /// (see [`VariableConstraints`]): what a session needs on top of what
    /// [`complete_layer_order`] checks.
    pub(crate) fn check_every_bucket(&self) -> CompletionResult<()> {
        let Some(OneSided {
            family,
            faces,
            variable,
        }) = self.data.one_sided_constraint()
        else {
            return Ok(());
        };
        let [a, b] = self.data.faces(variable);
        Err(invalid(format!(
            "{} {:?} reads variable {variable} ([{a}, {b}]) but is not in its bucket; \
             a session needs every constraint in the bucket of every variable it reads",
            ConstraintKind::from_type(family).name(),
            faces_vec(family, &faces),
        )))
    }

    pub(crate) fn tables<'a>(
        &'a self,
        problem: &'a CompletionProblem,
        implications: &'a ImplicationMaps,
    ) -> SearchTables<'a> {
        SearchTables {
            data: &self.data,
            transitivity: TransitivitySource {
                faces_cells: &problem.faces_cells,
                cells_faces: &problem.cells_faces,
            },
            implications,
        }
    }
}

/// Every index in range, and the two incidence maps describing the same
/// relation: transitivity reads a face's cells from one and a cell's faces
/// from the other.
fn check_incidence(problem: &CompletionProblem) -> CompletionResult<()> {
    let face_count = problem.faces_cells.len();
    let cell_count = problem.cells_faces.len();
    let mut by_face = Vec::new();
    for (face, cells) in problem.faces_cells.iter().enumerate() {
        for &cell in cells {
            if cell >= cell_count {
                return Err(invalid(format!(
                    "face {face} names cell {cell}, but cells_faces has {cell_count} cells"
                )));
            }
            by_face.push((face, cell));
        }
    }
    let mut by_cell = Vec::new();
    for (cell, faces) in problem.cells_faces.iter().enumerate() {
        for &face in faces {
            if face >= face_count {
                return Err(invalid(format!(
                    "cell {cell} names face {face}, but faces_cells has {face_count} faces"
                )));
            }
            by_cell.push((face, cell));
        }
    }
    // As sets: the smallest (face, cell) in one and not the other.
    by_face.sort_unstable();
    by_face.dedup();
    by_cell.sort_unstable();
    by_cell.dedup();
    if let Some((face, cell)) = first_difference(&by_face, &by_cell) {
        return Err(invalid(format!(
            "faces_cells and cells_faces disagree on whether face {face} covers cell {cell}"
        )));
    }
    Ok(())
}

/// The smallest element of two sorted, deduplicated lists' symmetric
/// difference: what `BTreeSet::symmetric_difference` yields first.
fn first_difference(a: &[(usize, usize)], b: &[(usize, usize)]) -> Option<(usize, usize)> {
    let (mut i, mut j) = (0, 0);
    loop {
        match (a.get(i), b.get(j)) {
            (Some(x), Some(y)) if x == y => {
                i += 1;
                j += 1;
            }
            (Some(x), Some(y)) => return Some(*x.min(y)),
            (Some(x), None) => return Some(*x),
            (None, Some(y)) => return Some(*y),
            (None, None) => return None,
        }
    }
}

/// One bucket into the solver's tables, after checking that every
/// constraint reads only variables and reads the variable whose bucket it is
/// in.
fn encode_bucket<const N: usize>(
    builder: &mut SearchDataBuilder,
    constraint_type: usize,
    bucket: &[[usize; N]],
    index: usize,
    owner: [usize; 2],
) -> CompletionResult<()> {
    let name = ConstraintKind::from_type(constraint_type).name();
    for faces in bucket {
        let mut reads_owner = false;
        for &[a, b] in constraints::pairs_for_type(constraint_type, faces).as_slice() {
            let pair = [a.min(b), a.max(b)];
            if builder.pair(a, b).is_none() {
                return Err(invalid(format!(
                    "{name} {faces:?} in variable {index}'s bucket reads faces {a} and {b}, \
                     which are not a variable"
                )));
            }
            reads_owner |= pair == owner;
        }
        if !reads_owner {
            return Err(invalid(format!(
                "{name} {faces:?} is in variable {index}'s bucket but does not read it"
            )));
        }
        builder.push_constraint(faces);
    }
    builder.end_family();
    Ok(())
}

/// Search nodes against a [`SearchBudget`], and the propagation before the
/// search against its deadline.
pub(crate) struct BudgetMeter {
    pub(crate) budget: SearchBudget,
    pub(crate) nodes: u64,
    /// Variables the initial propagation has visited.
    pub(crate) ticks: u64,
}

impl BudgetMeter {
    pub(crate) fn new(budget: SearchBudget) -> BudgetMeter {
        BudgetMeter {
            budget,
            nodes: 0,
            ticks: 0,
        }
    }

    /// How many propagated variables share one reading of the clock: a
    /// variable costs microseconds, a reading in a browser a call into
    /// JavaScript.
    const TICKS_PER_READING: u64 = 32;

    pub(crate) fn past_deadline(&self) -> bool {
        self.budget
            .deadline
            .is_some_and(|deadline| (deadline.now_ms)() >= deadline.at_ms)
    }
}

impl NodeMeter for BudgetMeter {
    type Stop = BudgetLimit;

    fn enter(&mut self) -> std::result::Result<(), BudgetLimit> {
        if self
            .budget
            .max_nodes
            .is_some_and(|max_nodes| self.nodes >= max_nodes)
        {
            return Err(BudgetLimit::Nodes);
        }
        if self.past_deadline() {
            return Err(BudgetLimit::Deadline);
        }
        self.nodes += 1;
        Ok(())
    }

    fn tick(&mut self) -> std::result::Result<(), BudgetLimit> {
        self.ticks += 1;
        if self.ticks.is_multiple_of(Self::TICKS_PER_READING) && self.past_deadline() {
            return Err(BudgetLimit::Deadline);
        }
        Ok(())
    }
}

pub(crate) fn public_conflict(conflict: SeedConflict) -> CompletionConflict {
    CompletionConflict {
        constraint: ConstraintKind::from_type(conflict.constraint_type),
        faces: conflict.faces,
        error_faces: conflict.error_faces,
        roots: conflict.roots,
    }
}

/// The faces of a component's variables, deduplicated in first-seen order
/// (upstream `compute.js` `solve`).
pub(crate) fn group_faces(data: &SearchData, group: &[usize]) -> Vec<usize> {
    let mut seen = BTreeSet::new();
    group
        .iter()
        .flat_map(|&variable| data.faces(variable))
        .filter(|face| seen.insert(*face))
        .collect()
}

/// A component solution from the search's bit encoding, which holds one bit
/// per variable and so only ever decodes to 1 or 2.
fn decode_solution(solution: &[u16], len: usize) -> Vec<PairOrder> {
    math::bit_decode(solution, len)
        .into_iter()
        .map(|value| {
            if value == 1 {
                PairOrder::FirstAbove
            } else {
                PairOrder::SecondAbove
            }
        })
        .collect()
}

fn decode_faces<const N: usize>(key: &[u16]) -> crate::Result<[usize; N]> {
    let faces = math::decode(key);
    <[usize; N]>::try_from(faces.as_slice()).map_err(|_| {
        FlatFoldError::InvalidInput(format!(
            "expected {N} faces in a Flat-Folder key, found {faces:?}"
        ))
    })
}

fn decode_bucket<const N: usize>(bucket: &[Key]) -> crate::Result<Vec<[usize; N]>> {
    bucket.iter().map(|key| decode_faces::<N>(key)).collect()
}

pub(crate) fn invalid(message: String) -> CompletionError {
    CompletionError::InvalidProblem(message)
}

#[cfg(test)]
mod tests {
    use super::*;

    const UNLIMITED: CompletionOptions = CompletionOptions {
        solution_limit: SolutionLimit::All,
        budget: SearchBudget {
            max_nodes: None,
            deadline: None,
        },
    };

    /// Faces `0..n` stacked in one cell: every pair a variable, no other
    /// constraint, so only transitivity orders them.
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

    fn variable(problem: &CompletionProblem, a: usize, b: usize) -> usize {
        problem
            .variables
            .iter()
            .position(|pair| *pair == [a, b])
            .unwrap_or_else(|| panic!("no variable [{a}, {b}]"))
    }

    fn fix(problem: &mut CompletionProblem, a: usize, b: usize, order: PairOrder, kind: FixedKind) {
        let variable = variable(problem, a, b);
        problem.fixed.push(FixedAssignment {
            variable,
            order,
            kind,
        });
    }

    fn solved(completion: Completion) -> CompletionSolution {
        match completion {
            Completion::Solved(solution) => solution,
            other => panic!("expected a solution, got {other:?}"),
        }
    }

    #[test]
    fn transitivity_is_derived_from_the_callers_cells() {
        // Three faces in one cell stack in 3! = 6 ways: transitivity removes
        // the two cyclic assignments of the 2^3.
        let stacked = solved(complete_layer_order(&one_cell(3), &UNLIMITED).unwrap());
        assert_eq!(stacked.solution_counts(), vec![1, 6]);

        // The same three pairs overlapping in three different cells may
        // weave, so all eight assignments are valid.
        let mut woven = one_cell(3);
        woven.faces_cells = vec![vec![0, 2], vec![0, 1], vec![1, 2]];
        woven.cells_faces = vec![vec![0, 1], vec![1, 2], vec![0, 2]];
        let woven = solved(complete_layer_order(&woven, &UNLIMITED).unwrap());
        assert_eq!(woven.solution_counts(), vec![1, 2, 2, 2]);
        assert_eq!(woven.states(), "8");
    }

    #[test]
    fn seeds_propagate_and_carried_pairs_do_not() {
        let mut seeded = one_cell(3);
        fix(&mut seeded, 0, 1, PairOrder::FirstAbove, FixedKind::Seed);
        fix(&mut seeded, 1, 2, PairOrder::FirstAbove, FixedKind::Seed);
        let seeded = solved(complete_layer_order(&seeded, &UNLIMITED).unwrap());
        assert_eq!(seeded.forced, vec![Some(PairOrder::FirstAbove); 3]);
        assert!(seeded.components.is_empty());

        // Carried, the same two orders imply nothing by propagation: the
        // third pair is left to the search, which finds its one order.
        let mut carried = one_cell(3);
        fix(
            &mut carried,
            0,
            1,
            PairOrder::FirstAbove,
            FixedKind::Carried,
        );
        fix(
            &mut carried,
            1,
            2,
            PairOrder::FirstAbove,
            FixedKind::Carried,
        );
        let carried = solved(complete_layer_order(&carried, &UNLIMITED).unwrap());
        let free = variable(&one_cell(3), 0, 2);
        assert_eq!(carried.forced[free], None);
        assert_eq!(carried.solution_counts(), vec![1, 1]);
        assert_eq!(
            carried.assignment(&[0]),
            Some(vec![PairOrder::FirstAbove; 3])
        );
    }

    #[test]
    fn a_constraint_made_only_of_carried_pairs_is_not_checked() {
        // 0 over 1, 1 over 2 and 2 over 0 is a cycle inside one cell.
        let cyclic = |kind| {
            let mut problem = one_cell(3);
            fix(&mut problem, 0, 1, PairOrder::FirstAbove, kind);
            fix(&mut problem, 1, 2, PairOrder::FirstAbove, kind);
            fix(&mut problem, 0, 2, PairOrder::SecondAbove, kind);
            complete_layer_order(&problem, &UNLIMITED).unwrap()
        };
        assert_eq!(solved(cyclic(FixedKind::Carried)).states(), "1");
        assert_eq!(
            cyclic(FixedKind::Seed),
            Completion::Conflict(CompletionConflict {
                constraint: ConstraintKind::Transitivity,
                faces: vec![0, 1, 2],
                error_faces: vec![0, 1, 2],
                roots: vec![0, 1, 2],
            })
        );
    }

    /// Faces 0, 1 and 2 share cell 0; faces 3 and 4 share cell 1; and a
    /// tortilla-tortilla ties 0–2 to 3–4.
    fn chain() -> CompletionProblem {
        let variables = vec![[0, 1], [0, 2], [1, 2], [3, 4]];
        let tortilla = VariableConstraints {
            tortilla_tortilla: vec![[0, 3, 2, 4]],
            ..VariableConstraints::default()
        };
        CompletionProblem {
            constraints: vec![
                VariableConstraints::default(),
                tortilla.clone(),
                VariableConstraints::default(),
                tortilla,
            ],
            variables,
            faces_cells: vec![vec![0], vec![0], vec![0], vec![1], vec![1]],
            cells_faces: vec![vec![0, 1, 2], vec![3, 4]],
            fixed: Vec::new(),
        }
    }

    #[test]
    fn error_faces_walk_back_through_the_propagation() {
        // The seeds imply 0 over 2 by transitivity; one level later that
        // meets the carried 4 over 3 across the tortilla-tortilla.
        let mut problem = chain();
        fix(&mut problem, 0, 1, PairOrder::FirstAbove, FixedKind::Seed);
        fix(&mut problem, 1, 2, PairOrder::FirstAbove, FixedKind::Seed);
        fix(
            &mut problem,
            3,
            4,
            PairOrder::SecondAbove,
            FixedKind::Carried,
        );
        assert_eq!(
            complete_layer_order(&problem, &UNLIMITED).unwrap(),
            Completion::Conflict(CompletionConflict {
                constraint: ConstraintKind::TortillaTortilla,
                faces: vec![0, 3, 2, 4],
                error_faces: vec![0, 1, 2, 3, 4],
                // The two seeds and the carried pair.
                roots: vec![0, 2, 3],
            })
        );
    }

    #[test]
    fn error_faces_stop_at_orders_implied_in_the_conflicting_level() {
        // Seeded rather than carried, 4 over 3 implies 2 over 0 in the same
        // level transitivity implies 0 over 2. Upstream only follows applied
        // orders, so face 1 is not named.
        let mut problem = chain();
        fix(&mut problem, 0, 1, PairOrder::FirstAbove, FixedKind::Seed);
        fix(&mut problem, 1, 2, PairOrder::FirstAbove, FixedKind::Seed);
        fix(&mut problem, 3, 4, PairOrder::SecondAbove, FixedKind::Seed);
        assert_eq!(
            complete_layer_order(&problem, &UNLIMITED).unwrap(),
            Completion::Conflict(CompletionConflict {
                constraint: ConstraintKind::TortillaTortilla,
                faces: vec![0, 3, 2, 4],
                error_faces: vec![0, 2, 3, 4],
                // The roots walk on where the faces stop, to the two seeds
                // that implied 0 over 2: 4 over 3 alone has an order.
                roots: vec![0, 2, 3],
            })
        );
    }

    #[test]
    fn a_component_without_a_valid_order_names_its_faces() {
        // 0–1 must stack like 2–3 and also opposite to it.
        let ties = VariableConstraints {
            tortilla_tortilla: vec![[0, 2, 1, 3], [0, 3, 1, 2]],
            ..VariableConstraints::default()
        };
        let problem = CompletionProblem {
            variables: vec![[0, 1], [2, 3]],
            constraints: vec![ties.clone(), ties],
            faces_cells: vec![vec![0], vec![0], vec![1], vec![1]],
            cells_faces: vec![vec![0, 1], vec![2, 3]],
            fixed: Vec::new(),
        };
        assert_eq!(
            complete_layer_order(&problem, &UNLIMITED).unwrap(),
            Completion::UnsatisfiedComponent(UnsatisfiedComponent {
                component: 0,
                faces: vec![0, 1, 2, 3],
            })
        );
    }

    #[test]
    fn truncation_is_reported_only_when_solutions_are_left_out() {
        let options = |limit| CompletionOptions {
            solution_limit: SolutionLimit::Count(limit),
            ..CompletionOptions::default()
        };
        let problem = one_cell(3);
        let five = solved(complete_layer_order(&problem, &options(5)).unwrap());
        assert_eq!(five.solution_counts(), vec![1, 5]);
        assert!(five.truncated());
        let six = solved(complete_layer_order(&problem, &options(6)).unwrap());
        assert_eq!(six.solution_counts(), vec![1, 6]);
        assert!(!six.truncated());
        assert_eq!(
            complete_layer_order(&problem, &options(0)),
            Err(CompletionError::InvalidProblem(
                "solution limit must be positive".to_string()
            ))
        );
    }

    #[test]
    fn the_node_budget_stops_the_search() {
        let problem = one_cell(4);
        let used = solved(complete_layer_order(&problem, &UNLIMITED).unwrap()).nodes;
        assert!(used > 1);
        let within = CompletionOptions {
            budget: SearchBudget {
                max_nodes: Some(used),
                deadline: None,
            },
            ..UNLIMITED
        };
        assert_eq!(
            solved(complete_layer_order(&problem, &within).unwrap()).states(),
            "24"
        );
        let short = CompletionOptions {
            budget: SearchBudget {
                max_nodes: Some(used - 1),
                deadline: None,
            },
            ..UNLIMITED
        };
        assert_eq!(
            complete_layer_order(&problem, &short),
            Err(CompletionError::BudgetExceeded {
                limit: BudgetLimit::Nodes,
                nodes: used - 1,
            })
        );
    }

    #[test]
    fn the_deadline_is_read_through_the_callers_clock() {
        fn late() -> f64 {
            10.0
        }
        let options = CompletionOptions {
            budget: SearchBudget {
                max_nodes: None,
                deadline: Some(Deadline {
                    now_ms: late,
                    at_ms: 5.0,
                }),
            },
            ..UNLIMITED
        };
        assert_eq!(
            complete_layer_order(&one_cell(3), &options),
            Err(CompletionError::BudgetExceeded {
                limit: BudgetLimit::Deadline,
                nodes: 0,
            })
        );
        // Nothing left to search, so nothing to stop.
        let mut decided = one_cell(2);
        fix(&mut decided, 0, 1, PairOrder::SecondAbove, FixedKind::Seed);
        assert_eq!(
            solved(complete_layer_order(&decided, &options).unwrap()).forced,
            vec![Some(PairOrder::SecondAbove)]
        );
    }

    #[test]
    fn the_deadline_also_stops_the_propagation() {
        fn late() -> f64 {
            10.0
        }
        // Ten faces in one cell, seeded in a chain: propagating the nine
        // seeds and the 36 pairs transitivity implies decides everything,
        // so the search has nothing to do.
        let mut chain = one_cell(10);
        for a in 0..9 {
            fix(&mut chain, a, a + 1, PairOrder::FirstAbove, FixedKind::Seed);
        }
        let all = solved(complete_layer_order(&chain, &UNLIMITED).unwrap());
        assert!(all.components.is_empty());
        assert_eq!(all.nodes, 0);
        let past = CompletionOptions {
            budget: SearchBudget {
                max_nodes: None,
                deadline: Some(Deadline {
                    now_ms: late,
                    at_ms: 5.0,
                }),
            },
            ..UNLIMITED
        };
        assert_eq!(
            complete_layer_order(&chain, &past),
            Err(CompletionError::BudgetExceeded {
                limit: BudgetLimit::Deadline,
                nodes: 0,
            })
        );
    }

    /// The hashed tables a problem above `DENSE_FACE_LIMIT` faces gets give
    /// the dense tables' answers, on kabuto with every single seed.
    #[test]
    fn dense_and_hashed_tables_give_the_same_completions() {
        let document: treemaker_fold::FoldDocument = serde_json::from_str(include_str!(
            "../../../tests/fixtures/flat-folder/kabuto.fold"
        ))
        .unwrap_or_else(|e| panic!("{e}"));
        let analysis = crate::analyze_flat_fold(&document, crate::AnalyzeOptions::default())
            .unwrap_or_else(|e| panic!("{e}"));
        let kabuto = flat_folder_completion_problem(&analysis).unwrap_or_else(|e| panic!("{e}"));
        let options = CompletionOptions {
            solution_limit: SolutionLimit::Count(100),
            ..CompletionOptions::default()
        };
        let mut problems = vec![one_cell(4), chain(), kabuto.clone()];
        for variable in 0..kabuto.variables.len() {
            for order in [PairOrder::FirstAbove, PairOrder::SecondAbove] {
                let mut seeded = kabuto.clone();
                seeded.fixed.push(FixedAssignment {
                    variable,
                    order,
                    kind: FixedKind::Seed,
                });
                problems.push(seeded);
            }
        }
        for problem in &problems {
            assert_eq!(
                complete_with_tables(problem, &options, usize::MAX),
                complete_with_tables(problem, &options, 0)
            );
        }
    }

    #[test]
    fn malformed_problems_are_refused() {
        let refused = |problem: &CompletionProblem| match complete_layer_order(problem, &UNLIMITED)
        {
            Err(CompletionError::InvalidProblem(message)) => message,
            other => panic!("expected a refusal, got {other:?}"),
        };

        let mut reversed = one_cell(2);
        reversed.variables[0] = [1, 0];
        assert!(refused(&reversed).contains("increasing order"));

        let mut duplicate = one_cell(3);
        duplicate.variables[1] = [0, 1];
        assert!(refused(&duplicate).contains("both [0, 1]"));

        let mut missing_pair = one_cell(3);
        missing_pair.variables.pop();
        missing_pair.constraints.pop();
        assert!(refused(&missing_pair).contains("share cell 0"));

        let mut disagree = one_cell(2);
        disagree.faces_cells[1].clear();
        assert!(refused(&disagree).contains("disagree"));

        let mut stray = chain();
        stray.constraints[0] = stray.constraints[1].clone();
        assert!(refused(&stray).contains("does not read it"));

        let mut unknown = chain();
        unknown.constraints[1].taco_tortilla.push([0, 3, 2]);
        assert!(refused(&unknown).contains("not a variable"));

        let mut both = one_cell(2);
        fix(&mut both, 0, 1, PairOrder::FirstAbove, FixedKind::Seed);
        fix(&mut both, 0, 1, PairOrder::SecondAbove, FixedKind::Carried);
        assert!(refused(&both).contains("both orders"));
    }
}

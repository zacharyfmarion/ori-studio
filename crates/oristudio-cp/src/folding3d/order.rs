//! Layer ordering: which face is above which, per connected component.
//!
//! **Ori Studio native.** See [`crate::folding3d`].
//!
//! # The solving unit is the constraint component, never the plane
//!
//! Ordering *variables* are coplanar overlapping pairs, so they do group by
//! plane. The *constraints* over them do not: two creases can fold onto the same
//! 3D line while their faces occupy different planes, and then the two planes'
//! variables are coupled and neither can be solved alone. The measured
//! counterexample is a 1x4 strip at (-90, +180, +90), where per-plane solving
//! returns a definite answer and is wrong half the time. So the unit here is the
//! connected component of the constraint graph, and it may span every plane in
//! the model.
//!
//! Two things follow that are easy to get backwards:
//!
//! - **The decomposition comes from propagation, not from structure.** Measured
//!   on the corpus, the raw constraint graph is a single dominant component on
//!   most admitted models — 100% on Kabuto, 100% on the 1x4 strip. Per-component
//!   solving is still worth having, but the reason is the residual left after the
//!   determinations below, not any property of the graph itself.
//! - **A cyclic panel order is legal.** He and Guest name the classical square
//!   twist at `a > b > c > d > a`. [`Fold3dOrdering::relations`] is a bag of
//!   pairwise relations and may contain a cycle; it must never be topologically
//!   sorted and no acyclicity may be asserted. What *is* required is
//!   antisymmetry and per-cell determinacy, and an undecided pair is reported in
//!   [`Fold3dOrdering::undetermined`] rather than tie-broken.
//!
//! # Local face ids are a correctness requirement, not an optimisation
//!
//! A face id at or past `faces_total` makes
//! [`possible_overlap_search_for_subfaces`] report `found = true` with that face
//! **absent from every stack and no error**: `cell_index` returns `None` and
//! `set_above` treats that as a no-op. So every component is renumbered into
//! `0..global_faces.len()` and every id is bounds-checked before the search is
//! called. `the_face_id_range_check_fires` is the test that the guard is not
//! dead code.
//!
//! Renumbering is also required for cost: `set_guide_map` builds an
//! `O(faces_total^2)` table per subface, which on a 2,637-face model is 7 MB per
//! subface at global ids.
//!
//! # Enumeration is an odometer, and the first press must move the biggest wheel
//!
//! Each component's [`WorkerOverlapEnumerator`] is its own forward-only stream
//! with no count method, so the total is a product nobody can know in advance and
//! `discovered_cases` stays a high-water mark. Components are ordered by variable
//! count **descending** and [`Fold3dOrderEnumerator::advance`] moves digit 0
//! first — stated that way because the natural reading, "advance the last digit",
//! advances the *smallest* component, leaves the silhouette identical, and reads
//! as a broken button.

use std::collections::{BTreeMap, BTreeSet};

use crate::folding::AdditionalEstimationError;
use crate::folding::{
    EquivalenceCondition, EquivalenceConditionSet, HierarchyRelation, InitialHierarchy, SubFace,
    WorkerOverlapEnumerator, WorkerOverlapSearchError, validate_initial_hierarchy,
};
use crate::folding3d::Fold3dTolerances;
use crate::folding3d::cells::{CellError, CellIndex, cell_index};
use crate::folding3d::census::{Fold3dCensus, census_placement, folded_line_index};
use crate::folding3d::constraints::{
    Coupling, Fold3dCrossing, Fold3dSeed, SeedKind, build_constraints,
};
use crate::folding3d::placement::Placement3d;
use crate::folding3d::planes::{PlaneId, PlaneIndex};

/// One ordering variable: two coplanar faces whose footprints overlap.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct OrderVariable {
    /// Global face indices, `(min, max)`.
    pub faces: (usize, usize),
    pub plane: PlaneId,
}

/// Why a placement has no computable layer order.
///
/// Stable **codes**, never sentences. `NoLayerOrder` is not a refusal of the
/// placement: the figure still draws, only the stacking is unknown, so it is the
/// third arm of the three-way verdict rather than an error.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fold3dOrderError {
    /// The arrangement and the census disagree about which faces share paper.
    Cells(CellError),
    /// Two geometric rules demanded opposite orders for one pair.
    ///
    /// Caught before any table is built, because the shipped builder discards
    /// the contradiction and keeps whichever relation appeared first. Both rules
    /// and both creases are named: a bare face pair is not actionable.
    ContradictorySeeds {
        upper: usize,
        lower: usize,
        first: (SeedKind, usize),
        second: (SeedKind, usize),
    },
    /// A component admits no stacking at all.
    NoLayerOrder {
        component: usize,
        faces: usize,
        variables: usize,
    },
    /// An internal invariant: a local id escaped its component's range.
    ///
    /// Impossible in shipped code, and present because the measured alternative
    /// is `found = true` with the face missing from every stack.
    FaceIdOutOfRange {
        component: usize,
        face: usize,
        faces_total: usize,
    },
    /// The search failed for a reason that is neither of the above.
    SearchFailed { component: usize },
}

impl std::fmt::Display for Fold3dOrderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Cells(error) => error.fmt(f),
            Self::ContradictorySeeds {
                upper,
                lower,
                first,
                second,
            } => write!(
                f,
                "face {upper} is forced above face {lower} by {:?} at crease {}, \
                 and below it by {:?} at crease {}",
                first.0, first.1, second.0, second.1
            ),
            Self::NoLayerOrder {
                component,
                faces,
                variables,
            } => write!(
                f,
                "component {component} ({faces} faces, {variables} ordering variables) \
                 admits no layer order"
            ),
            Self::FaceIdOutOfRange {
                component,
                face,
                faces_total,
            } => write!(
                f,
                "component {component} names face {face} with only {faces_total} faces"
            ),
            Self::SearchFailed { component } => {
                write!(f, "the search over component {component} failed")
            }
        }
    }
}

impl std::error::Error for Fold3dOrderError {}

impl From<CellError> for Fold3dOrderError {
    fn from(error: CellError) -> Self {
        Self::Cells(error)
    }
}

/// One solution's layer order.
#[derive(Debug, Clone, PartialEq)]
pub struct Fold3dOrdering {
    /// Pairwise relations in **global** face ids. Never a total order, and it
    /// may be cyclic.
    pub relations: Vec<HierarchyRelation>,
    /// Ordering variables the search left undecided, ascending.
    pub undetermined: Vec<(usize, usize)>,
    /// Variable count per component, descending — the odometer's digit order.
    pub component_sizes: Vec<usize>,
    /// Self-intersections no layer order repairs, capped; `crossing_count` is
    /// exact.
    pub crossings: Vec<Fold3dCrossing>,
    pub crossing_count: usize,
    pub variables: Vec<OrderVariable>,
    /// Which component each variable belongs to, aligned with `variables` and
    /// indexing `component_sizes` — so "the largest component" is answerable
    /// without re-deriving the constraint graph, which is what the odometer's
    /// first-press invariant has to be stated against.
    pub component_of: Vec<usize>,
    /// Cross-plane couplings the constraints carried.
    pub couplings: usize,
    /// 1-based, and equal to `discovered_cases` on a forward step.
    pub current_case: usize,
    /// Forward-only high-water mark. Never an eager product: per-component
    /// totals are not knowable in advance.
    pub discovered_cases: usize,
    pub has_next: bool,
}

/// What one press of "another solution" did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Advance {
    Next,
    /// Every component exhausted and restarted, so this is solution 1 again.
    WrappedToFirst,
}

/// Solve the layer order for a placement, returning the first solution.
pub fn order_placement(
    placement: &Placement3d,
    index: &PlaneIndex,
    census: &Fold3dCensus,
    tolerances: Fold3dTolerances,
) -> Result<Fold3dOrdering, Fold3dOrderError> {
    Fold3dOrderEnumerator::new(placement, index, census, tolerances)
        .map(|enumerator| enumerator.current().clone())
}

/// The forward-only, restartable stream of layer orders.
#[derive(Debug, Clone)]
pub struct Fold3dOrderEnumerator {
    components: Vec<ComponentSolver>,
    variables: Vec<OrderVariable>,
    component_of: Vec<usize>,
    crossings: Vec<Fold3dCrossing>,
    crossing_count: usize,
    couplings: usize,
    /// Forward-only high-water mark of solutions reached.
    discovered: usize,
    /// Which solution the stream is showing, 1-based. Reset to 1 by a wrap,
    /// where `discovered` is not.
    position: usize,
    /// Whether [`Self::advance`] will step rather than wrap, answered by a dry
    /// run and cached so the answer costs one probe per press rather than one
    /// per read. See [`Self::lookahead`].
    has_next: bool,
    current: Fold3dOrdering,
}

impl Fold3dOrderEnumerator {
    pub fn new(
        placement: &Placement3d,
        index: &PlaneIndex,
        census: &Fold3dCensus,
        tolerances: Fold3dTolerances,
    ) -> Result<Self, Fold3dOrderError> {
        let cells = cell_index(index, census, placement.span, tolerances)?;
        Self::with_cells(placement, index, census, &cells, tolerances)
    }

    /// Same, over a cell decomposition the caller already has.
    ///
    /// The arrangement tracing is the expensive half of this phase and the
    /// render model needs the same cells, so the engine boundary builds them
    /// once and hands them to both. Two `cell_index` calls would also be two
    /// chances to disagree about which faces share a cell.
    pub fn with_cells(
        placement: &Placement3d,
        index: &PlaneIndex,
        census: &Fold3dCensus,
        cells: &CellIndex,
        tolerances: Fold3dTolerances,
    ) -> Result<Self, Fold3dOrderError> {
        let plan = plan(placement, index, census, cells, tolerances)?;
        let mut components = Vec::with_capacity(plan.components.len());
        for (position, component) in plan.components.into_iter().enumerate() {
            components.push(ComponentSolver::new(position, component)?);
        }
        let mut out = Self {
            components,
            variables: plan.variables,
            component_of: plan.component_of,
            crossings: plan.crossings,
            crossing_count: plan.crossing_count,
            couplings: plan.couplings,
            discovered: 1,
            position: 1,
            has_next: false,
            current: Fold3dOrdering {
                relations: Vec::new(),
                undetermined: Vec::new(),
                component_sizes: Vec::new(),
                crossings: Vec::new(),
                crossing_count: 0,
                variables: Vec::new(),
                component_of: Vec::new(),
                couplings: 0,
                current_case: 1,
                discovered_cases: 1,
                has_next: false,
            },
        };
        out.has_next = Self::lookahead(&out.components);
        out.current = out.assemble();
        Ok(out)
    }

    pub fn current(&self) -> &Fold3dOrdering {
        &self.current
    }

    pub fn can_advance(&self) -> bool {
        self.has_next
    }

    /// Whether [`Self::advance`] will land on another solution rather than wrap.
    ///
    /// **Answered by dry run, not by asking the digits.** `ComponentSolver`'s own
    /// `has_next` is the shipped enumerator's signal and it is *optimistic*: it
    /// says the permutation state moved, not that another solution is there. A
    /// digit can therefore say yes and then find nothing, at which point
    /// [`Self::advance`] treats it as exhausted and carries. OR-ing the
    /// optimistic flag across digits consequently claims a next solution at the
    /// very end of the stream — measured on `penguin_freeform`, which reported
    /// `find_another_overlap_valid` on solution 8 of 8.
    ///
    /// That is visible, not cosmetic. The flat path reports `false` on its last
    /// solution (`folding.rs`'s `overlap.found && next_subface > 0`), and the
    /// cycling UI labels a press "Back to first solution" off exactly this flag —
    /// so a 3D figure said "Another solution" and then silently wrapped.
    ///
    /// The odometer wraps iff **no** digit can really step, and the digits are
    /// independent solvers, so probing each in turn answers it. Only a digit
    /// whose optimistic flag is already set is cloned: an unset flag cannot step,
    /// and the usual case is that digit 0 can, so the usual cost is one component
    /// clone and one search per press.
    ///
    /// A probe that errors reads as "no next". The real [`Self::advance`] would
    /// surface the same error, and reporting a solution we cannot reach is the
    /// worse of the two wrong answers.
    fn lookahead(components: &[ComponentSolver]) -> bool {
        components
            .iter()
            .any(|component| component.has_next() && component.clone().step().unwrap_or(false))
    }

    /// Move to the next solution, wrapping to the first when exhausted.
    ///
    /// Digit 0 is the component with the most variables, and it moves first: the
    /// alternative leaves the largest stack untouched and looks like nothing
    /// happened.
    ///
    /// A digit's `has_next` is the shipped enumerator's own signal and it is
    /// *optimistic* — it says the permutation state moved, not that another
    /// solution is there — so a digit that says yes and then finds nothing is
    /// exhausted rather than broken, and carries like any other. Which is
    /// exactly why the stream's own `has_next` cannot be the OR of them; see
    /// [`Self::lookahead`].
    ///
    /// Where you **are** and how many have been **seen** are two counters, and
    /// only the second is monotone. Deriving the first from the second gets the
    /// first lap right and every later one wrong: after a wrap the stream is
    /// showing solution 1 again, so the next press is solution 2, not solution
    /// 9. `the_solution_stream_wraps_and_keeps_wrapping` is the test, and it
    /// takes two laps to see it.
    pub fn advance(&mut self) -> Result<Advance, Fold3dOrderError> {
        let mut wrapped = true;
        for digit in 0..self.components.len() {
            if self.components[digit].has_next() && self.components[digit].step()? {
                wrapped = false;
                break;
            }
            self.components[digit].restart()?;
        }
        if wrapped {
            self.position = 1;
        } else {
            self.position += 1;
            self.discovered = self.discovered.max(self.position);
        }
        self.has_next = Self::lookahead(&self.components);
        self.current = self.assemble();
        Ok(if wrapped {
            Advance::WrappedToFirst
        } else {
            Advance::Next
        })
    }

    /// Each variable's answer, taken from the component that owns it.
    ///
    /// Two filters, and they are different questions. A relation over a pair that
    /// is **not** an ordering variable is cross-plane scaffolding — a cut carries
    /// no layer meaning and drawing it would be an invented stacking. A relation
    /// over a variable some **other** component happens to name is a relation
    /// derived without that variable's own constraints, and the owning component
    /// always decides it: the variable's pair sits in a subface (the census-cell
    /// postcondition), every pair of that subface is joined, so the subface lands
    /// in the owner and the search totally orders it.
    fn assemble(&self) -> Fold3dOrdering {
        let owner_of: BTreeMap<(usize, usize), usize> = self
            .variables
            .iter()
            .zip(&self.component_of)
            .map(|(variable, &component)| (variable.faces, component))
            .collect();
        let mut relations: BTreeMap<(usize, usize), bool> = BTreeMap::new();
        for component in &self.components {
            for relation in &component.current.relations {
                let (Some(&upper), Some(&lower)) = (
                    component.global_faces.get(relation.upper_face),
                    component.global_faces.get(relation.lower_face),
                ) else {
                    continue;
                };
                let key = (upper.min(lower), upper.max(lower));
                if owner_of.get(&key) != Some(&component.position) {
                    continue;
                }
                relations.insert(key, upper == key.0);
            }
        }
        let known: BTreeSet<(usize, usize)> = owner_of.keys().copied().collect();
        let mut out = Vec::new();
        for (&key, &upper_first) in &relations {
            out.push(if upper_first {
                HierarchyRelation {
                    upper_face: key.0,
                    lower_face: key.1,
                }
            } else {
                HierarchyRelation {
                    upper_face: key.1,
                    lower_face: key.0,
                }
            });
        }
        let undetermined: Vec<(usize, usize)> = known
            .iter()
            .filter(|pair| !relations.contains_key(pair))
            .copied()
            .collect();
        Fold3dOrdering {
            relations: out,
            undetermined,
            component_sizes: self
                .components
                .iter()
                .map(|component| component.variables)
                .collect(),
            crossings: self.crossings.clone(),
            crossing_count: self.crossing_count,
            variables: self.variables.clone(),
            component_of: self.component_of.clone(),
            couplings: self.couplings,
            current_case: self.position,
            discovered_cases: self.discovered,
            has_next: self.can_advance(),
        }
    }
}

/// One component's search state.
#[derive(Debug, Clone)]
struct ComponentSolver {
    position: usize,
    global_faces: Vec<usize>,
    variables: usize,
    input: ComponentInput,
    enumerator: WorkerOverlapEnumerator,
    current: InitialHierarchy,
    has_next: bool,
    first: bool,
}

impl ComponentSolver {
    fn new(position: usize, input: ComponentInput) -> Result<Self, Fold3dOrderError> {
        let enumerator = build_enumerator(position, &input)?;
        let mut out = Self {
            position,
            global_faces: input.global_faces.clone(),
            variables: input.variables,
            input,
            enumerator,
            current: InitialHierarchy {
                faces_total: 0,
                relations: Vec::new(),
            },
            has_next: false,
            first: true,
        };
        if !out.step()? {
            return Err(Fold3dOrderError::NoLayerOrder {
                component: out.position,
                faces: out.global_faces.len(),
                variables: out.variables,
            });
        }
        Ok(out)
    }

    fn has_next(&self) -> bool {
        self.has_next
    }

    /// Advance to the next solution, reporting whether there was one.
    fn step(&mut self) -> Result<bool, Fold3dOrderError> {
        let first = self.first;
        self.first = false;
        let overlap = self
            .enumerator
            .possible_overlapping_search(first)
            .map_err(|error| search_error(self.position, error))?;
        if !overlap.found {
            self.has_next = false;
            return Ok(false);
        }
        let next = self
            .enumerator
            .next(self.enumerator.valid_count())
            .map_err(|_| Fold3dOrderError::SearchFailed {
                component: self.position,
            })?;
        self.has_next = next > 0;
        self.current = overlap.hierarchy;
        Ok(true)
    }

    fn restart(&mut self) -> Result<(), Fold3dOrderError> {
        self.enumerator = build_enumerator(self.position, &self.input)?;
        self.first = true;
        if self.step()? {
            return Ok(());
        }
        // The first pass found this solution, so replaying the same
        // deterministic stream has to find it again.
        Err(Fold3dOrderError::SearchFailed {
            component: self.position,
        })
    }
}

fn build_enumerator(
    position: usize,
    input: &ComponentInput,
) -> Result<WorkerOverlapEnumerator, Fold3dOrderError> {
    let reduced: Vec<usize> = (0..input.subfaces.len()).collect();
    WorkerOverlapEnumerator::from_subfaces(
        &input.subfaces,
        &reduced,
        &input.hierarchy,
        Some(&input.conditions),
    )
    .map_err(|error| search_error(position, error))
}

fn search_error(component: usize, error: WorkerOverlapSearchError) -> Fold3dOrderError {
    match error {
        WorkerOverlapSearchError::AdditionalEstimation(
            AdditionalEstimationError::Contradiction {
                upper_face,
                lower_face,
            },
        ) => Fold3dOrderError::NoLayerOrder {
            component,
            faces: upper_face,
            variables: lower_face,
        },
        _ => Fold3dOrderError::SearchFailed { component },
    }
}

/// One component, already renumbered into local face ids.
#[derive(Debug, Clone)]
struct ComponentInput {
    global_faces: Vec<usize>,
    variables: usize,
    subfaces: Vec<SubFace>,
    hierarchy: InitialHierarchy,
    conditions: EquivalenceConditionSet,
}

struct Plan {
    components: Vec<ComponentInput>,
    variables: Vec<OrderVariable>,
    component_of: Vec<usize>,
    crossings: Vec<Fold3dCrossing>,
    crossing_count: usize,
    couplings: usize,
}

/// Build every component's search input from the placed geometry.
fn plan(
    placement: &Placement3d,
    index: &PlaneIndex,
    census: &Fold3dCensus,
    cells: &CellIndex,
    tolerances: Fold3dTolerances,
) -> Result<Plan, Fold3dOrderError> {
    let lines = folded_line_index(placement, index, tolerances);
    let constraints = build_constraints(placement, index, &lines, tolerances);

    let variables: Vec<OrderVariable> = census
        .pairs
        .iter()
        .map(|pair| OrderVariable {
            faces: pair.faces,
            plane: pair.plane,
        })
        .collect();
    let slot: BTreeMap<(usize, usize), usize> = variables
        .iter()
        .enumerate()
        .map(|(index, variable)| (variable.faces, index))
        .collect();

    // A coupling is only real when both of its sides are ordering variables.
    // Two faces meeting a folded line on the same side normally overlap beside
    // it, but "normally" is not "always", and a condition over a pair the census
    // does not carry would order faces that share no paper.
    let couplings: Vec<&Coupling> = constraints
        .couplings
        .iter()
        .filter(|coupling| {
            slot.contains_key(&ordered(coupling.first))
                && slot.contains_key(&ordered(coupling.second))
        })
        .collect();

    let mut union = UnionFind::new(variables.len());
    let join = |union: &mut UnionFind, faces: &[usize]| {
        let mut anchor: Option<usize> = None;
        for i in 0..faces.len() {
            for j in (i + 1)..faces.len() {
                let key = ordered((faces[i], faces[j]));
                let Some(&variable) = slot.get(&key) else {
                    continue;
                };
                match anchor {
                    None => anchor = Some(variable),
                    Some(first) => union.union(first, variable),
                }
            }
        }
    };
    for subface in &cells.subfaces {
        join(&mut union, &subface.face_ids);
    }
    for condition in &constraints.conditions.triple_conditions {
        join(&mut union, &[condition.a, condition.b, condition.d]);
    }
    for condition in &constraints.conditions.quadruple_conditions {
        join(
            &mut union,
            &[condition.a, condition.b, condition.c, condition.d],
        );
    }
    for coupling in &couplings {
        let (first, second) = (ordered(coupling.first), ordered(coupling.second));
        union.union(slot[&first], slot[&second]);
    }

    let (label, count) = union.labels();
    let mut members: Vec<Vec<usize>> = vec![Vec::new(); count];
    for (variable, &group) in label.iter().enumerate() {
        members[group].push(variable);
    }

    // Which faces each component carries. A face can be in **more than one** —
    // one panel with two flaps folded onto different parts of it is the everyday
    // case, and its two stacks share that face and touch nowhere else — so this
    // is a per-component membership set and never a face-to-component map.
    let mut component_faces: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); count];
    for (variable, &group) in label.iter().enumerate() {
        component_faces[group].insert(variables[variable].faces.0);
        component_faces[group].insert(variables[variable].faces.1);
    }

    let mut builders: Vec<Builder> = component_faces
        .iter()
        .enumerate()
        .map(|(group, faces)| Builder {
            global_faces: faces.iter().copied().collect(),
            variables: members[group].len(),
            subfaces: Vec::new(),
            relations: Vec::new(),
            cut_relations: Vec::new(),
            conditions: EquivalenceConditionSet {
                triple_conditions: Vec::new(),
                quadruple_conditions: Vec::new(),
            },
        })
        .collect();

    // An item belongs to the component of the **ordering variables it
    // constrains**, which `join` above has already put in one component. Finding
    // it by looking each face up instead is the defect
    // `two_stacks_sharing_one_face_are_both_decided` exists for: a face shared by
    // two components resolves to whichever is found first, every item of the
    // other one then fails to match, and that component is handed no subfaces at
    // all — its search succeeds vacuously and its variable comes back
    // undetermined under a `Folded` verdict.
    //
    // The faces are still checked, but against the chosen component's membership
    // rather than used to choose it: an item naming a face that carries no
    // variable here constrains nothing this component can decide, and localising
    // it would trip the range check.
    let owner = |faces: &[usize]| -> Option<usize> {
        let mut found: Option<usize> = None;
        for i in 0..faces.len() {
            for j in (i + 1)..faces.len() {
                let Some(&variable) = slot.get(&ordered((faces[i], faces[j]))) else {
                    continue;
                };
                match found {
                    None => found = Some(label[variable]),
                    Some(first) if first == label[variable] => {}
                    // Unreachable while every item kind below is also passed to
                    // `join`. It refuses the item rather than picking a side,
                    // because picking one is how the defect above stayed silent.
                    Some(_) => return None,
                }
            }
        }
        let group = found?;
        faces
            .iter()
            .all(|face| component_faces[group].contains(face))
            .then_some(group)
    };

    for subface in &cells.subfaces {
        if let Some(group) = owner(&subface.face_ids) {
            builders[group].subfaces.push(subface.clone());
        }
    }
    for seed in &constraints.seeds {
        let pair = [seed.relation.upper_face, seed.relation.lower_face];
        if !slot.contains_key(&ordered((pair[0], pair[1]))) {
            continue;
        }
        if let Some(group) = owner(&pair) {
            builders[group].relations.push(*seed);
        }
    }
    for condition in &constraints.conditions.triple_conditions {
        if let Some(group) = owner(&[condition.a, condition.b, condition.d]) {
            builders[group]
                .conditions
                .triple_conditions
                .push(*condition);
        }
    }
    for condition in &constraints.conditions.quadruple_conditions {
        if let Some(group) = owner(&[condition.a, condition.b, condition.c, condition.d]) {
            builders[group]
                .conditions
                .quadruple_conditions
                .push(*condition);
        }
    }
    for coupling in &couplings {
        let faces = [
            coupling.first.0,
            coupling.first.1,
            coupling.second.0,
            coupling.second.1,
        ];
        let Some(group) = owner(&faces) else {
            continue;
        };
        let mut merged: Vec<usize> = faces.to_vec();
        merged.sort_unstable();
        merged.dedup();
        builders[group].subfaces.push(SubFace { face_ids: merged });
        for &upper in &[coupling.first.0, coupling.first.1] {
            for &lower in &[coupling.second.0, coupling.second.1] {
                builders[group].cut_relations.push(HierarchyRelation {
                    upper_face: upper,
                    lower_face: lower,
                });
            }
        }
        builders[group]
            .conditions
            .quadruple_conditions
            .push(coupling.condition);
    }

    let mut order: Vec<usize> = (0..builders.len()).collect();
    order.sort_by_key(|&group| {
        (
            std::cmp::Reverse(builders[group].variables),
            builders[group].global_faces.first().copied().unwrap_or(0),
        )
    });

    let mut position_of = vec![0usize; builders.len()];
    let mut components = Vec::with_capacity(order.len());
    for (position, group) in order.iter().copied().enumerate() {
        position_of[group] = position;
        components.push(builders[group].localise(position)?);
    }
    let component_of: Vec<usize> = label.iter().map(|&group| position_of[group]).collect();
    Ok(Plan {
        components,
        variables,
        component_of,
        crossings: constraints.crossings.clone(),
        crossing_count: constraints.crossing_count,
        couplings: couplings.len(),
    })
}

struct Builder {
    global_faces: Vec<usize>,
    variables: usize,
    subfaces: Vec<SubFace>,
    relations: Vec<Fold3dSeed>,
    cut_relations: Vec<HierarchyRelation>,
    conditions: EquivalenceConditionSet,
}

impl Builder {
    fn localise(&self, position: usize) -> Result<ComponentInput, Fold3dOrderError> {
        let faces_total = self.global_faces.len();
        let local: BTreeMap<usize, usize> = self
            .global_faces
            .iter()
            .enumerate()
            .map(|(index, &face)| (face, index))
            .collect();
        let map = |face: usize| -> Result<usize, Fold3dOrderError> {
            local
                .get(&face)
                .copied()
                .ok_or(Fold3dOrderError::FaceIdOutOfRange {
                    component: position,
                    face,
                    faces_total,
                })
        };

        let mut subfaces = Vec::with_capacity(self.subfaces.len());
        for subface in &self.subfaces {
            let mut face_ids = Vec::with_capacity(subface.face_ids.len());
            for &face in &subface.face_ids {
                face_ids.push(map(face)?);
            }
            face_ids.sort_unstable();
            subfaces.push(SubFace { face_ids });
        }

        // Determinations first, and each pair checked against the rules that
        // already decided it. The shipped table builder discards `infer_above`'s
        // error, so two rules that disagree would otherwise leave whichever came
        // first in the vector standing — a definite, silent, order-dependent
        // answer — and `normalized_pair`-style role assignment would inherit it.
        let mut relations = Vec::with_capacity(self.relations.len() + self.cut_relations.len());
        let mut decided: BTreeMap<(usize, usize), (bool, SeedKind, usize)> = BTreeMap::new();
        for seed in &self.relations {
            let (upper, lower) = (
                map(seed.relation.upper_face)?,
                map(seed.relation.lower_face)?,
            );
            let key = (upper.min(lower), upper.max(lower));
            let upper_first = upper == key.0;
            match decided.get(&key) {
                Some(&(existing, kind, line)) if existing != upper_first => {
                    return Err(Fold3dOrderError::ContradictorySeeds {
                        upper: seed.relation.upper_face,
                        lower: seed.relation.lower_face,
                        first: (seed.kind, seed.line),
                        second: (kind, line),
                    });
                }
                Some(_) => {}
                None => {
                    decided.insert(key, (upper_first, seed.kind, seed.line));
                }
            }
            relations.push(HierarchyRelation {
                upper_face: upper,
                lower_face: lower,
            });
        }
        for relation in &self.cut_relations {
            relations.push(HierarchyRelation {
                upper_face: map(relation.upper_face)?,
                lower_face: map(relation.lower_face)?,
            });
        }
        let hierarchy = InitialHierarchy {
            faces_total,
            relations,
        };
        // The cross-slot scaffolding can only disagree with itself or with a
        // determination, and neither names a geometric rule, so this arm reports
        // the pair alone.
        validate_initial_hierarchy(&hierarchy).map_err(|error| match error {
            AdditionalEstimationError::Contradiction {
                upper_face,
                lower_face,
            } => Fold3dOrderError::ContradictorySeeds {
                upper: self
                    .global_faces
                    .get(upper_face)
                    .copied()
                    .unwrap_or(upper_face),
                lower: self
                    .global_faces
                    .get(lower_face)
                    .copied()
                    .unwrap_or(lower_face),
                first: (SeedKind::Cut, usize::MAX),
                second: (SeedKind::Cut, usize::MAX),
            },
            AdditionalEstimationError::Setup(_) => Fold3dOrderError::SearchFailed {
                component: position,
            },
        })?;

        let mut conditions = EquivalenceConditionSet {
            triple_conditions: Vec::with_capacity(self.conditions.triple_conditions.len()),
            quadruple_conditions: Vec::with_capacity(self.conditions.quadruple_conditions.len()),
        };
        for condition in &self.conditions.triple_conditions {
            conditions.triple_conditions.push(EquivalenceCondition {
                a: map(condition.a)?,
                b: map(condition.b)?,
                c: map(condition.c)?,
                d: map(condition.d)?,
            });
        }
        for condition in &self.conditions.quadruple_conditions {
            conditions.quadruple_conditions.push(EquivalenceCondition {
                a: map(condition.a)?,
                b: map(condition.b)?,
                c: map(condition.c)?,
                d: map(condition.d)?,
            });
        }

        Ok(ComponentInput {
            global_faces: self.global_faces.clone(),
            variables: self.variables,
            subfaces,
            hierarchy,
            conditions,
        })
    }
}

fn ordered(pair: (usize, usize)) -> (usize, usize) {
    (pair.0.min(pair.1), pair.0.max(pair.1))
}

/// Union-find whose labels are assigned in ascending order of each component's
/// lowest member, so nothing downstream depends on a hash iteration order.
struct UnionFind {
    parent: Vec<usize>,
}

impl UnionFind {
    fn new(size: usize) -> Self {
        Self {
            parent: (0..size).collect(),
        }
    }

    fn find(&mut self, mut node: usize) -> usize {
        while self.parent[node] != node {
            self.parent[node] = self.parent[self.parent[node]];
            node = self.parent[node];
        }
        node
    }

    fn union(&mut self, a: usize, b: usize) {
        let (a, b) = (self.find(a), self.find(b));
        if a != b {
            self.parent[a.max(b)] = a.min(b);
        }
    }

    fn labels(&mut self) -> (Vec<usize>, usize) {
        let mut label_of: BTreeMap<usize, usize> = BTreeMap::new();
        let mut out = Vec::with_capacity(self.parent.len());
        for node in 0..self.parent.len() {
            let root = self.find(node);
            let next = label_of.len();
            out.push(*label_of.entry(root).or_insert(next));
        }
        (out, label_of.len())
    }
}

/// Solve a segment set's layer order end to end, applying no admission gate.
///
/// The measurement path, mirroring [`census_placement`]: it takes a placement
/// rather than an admission so the ordering is reachable on fixtures the gate
/// refuses, which is where several of these errors actually fire.
pub fn order_segments(
    placement: &Placement3d,
    tolerances: Fold3dTolerances,
) -> Result<Fold3dOrdering, Fold3dOrderError> {
    let (index, census) = census_placement(placement, tolerances);
    order_placement(placement, &index, &census, tolerances)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn builder(global_faces: Vec<usize>, subface: Vec<usize>) -> Builder {
        Builder {
            global_faces,
            variables: 1,
            subfaces: vec![SubFace { face_ids: subface }],
            relations: Vec::new(),
            cut_relations: Vec::new(),
            conditions: EquivalenceConditionSet {
                triple_conditions: Vec::new(),
                quadruple_conditions: Vec::new(),
            },
        }
    }

    /// The range check fires rather than being dead code.
    ///
    /// It exists because the measured alternative is silent: the shipped search
    /// reports `found = true` with the out-of-range face missing from every
    /// stack and no error at all (see
    /// `an_out_of_range_face_id_makes_the_shipped_search_lie` in
    /// `tests/folding3d_order.rs`). A guard against a hazard nobody has
    /// demonstrated is worth nothing, and one nothing exercises is worth less.
    #[test]
    fn the_face_id_range_check_fires() {
        let good = builder(vec![4, 9], vec![4, 9]);
        assert!(good.localise(0).is_ok());

        let bad = builder(vec![4, 9], vec![4, 11]);
        assert_eq!(
            bad.localise(0).err(),
            Some(Fold3dOrderError::FaceIdOutOfRange {
                component: 0,
                face: 11,
                faces_total: 2,
            })
        );
    }

    /// Local ids are dense from zero, which is what `faces_total` has to mean.
    #[test]
    fn localising_renumbers_into_a_dense_range() {
        let component = builder(vec![7, 20, 41], vec![7, 41])
            .localise(0)
            .expect("localised");
        assert_eq!(component.hierarchy.faces_total, 3);
        assert_eq!(component.subfaces[0].face_ids, vec![0, 2]);
        assert_eq!(component.global_faces, vec![7, 20, 41]);
    }

    /// Two rules that disagree are caught before any table is built, and the
    /// error names both of them.
    #[test]
    fn opposed_determinations_are_refused_with_both_rules_named() {
        let mut component = builder(vec![0, 1], vec![0, 1]);
        component.relations = vec![
            Fold3dSeed {
                relation: HierarchyRelation {
                    upper_face: 0,
                    lower_face: 1,
                },
                kind: SeedKind::FullFold,
                line: 3,
            },
            Fold3dSeed {
                relation: HierarchyRelation {
                    upper_face: 1,
                    lower_face: 0,
                },
                kind: SeedKind::Wall,
                line: 8,
            },
        ];
        assert_eq!(
            component.localise(0).err(),
            Some(Fold3dOrderError::ContradictorySeeds {
                upper: 1,
                lower: 0,
                first: (SeedKind::Wall, 8),
                second: (SeedKind::FullFold, 3),
            })
        );
    }
}

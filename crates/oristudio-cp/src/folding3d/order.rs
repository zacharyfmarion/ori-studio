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

use crate::folding::{AdditionalEstimationError, SubFaceSearchError};
use crate::folding::{
    EquivalenceCondition, EquivalenceConditionSet, HierarchyRelation, InitialHierarchy, SubFace,
    WorkerOverlapEnumerator, WorkerOverlapSearchError, validate_initial_hierarchy,
};
use crate::folding3d::Fold3dTolerances;
use crate::folding3d::cells::{CellError, cell_index};
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
    /// A subface needs the combination generator the port does not have.
    ///
    /// A backtracking guard rather than a depth guard: measured, an
    /// unconstrained subface at ply 12 finds its answer in microseconds and
    /// never reaches the 2000-permutation cap.
    StackTooDeep {
        component: usize,
        permutations: usize,
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
            Self::StackTooDeep {
                component,
                permutations,
            } => write!(
                f,
                "a stack in component {component} needs {permutations} permutations"
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
    crossings: Vec<Fold3dCrossing>,
    crossing_count: usize,
    couplings: usize,
    discovered: usize,
    current: Fold3dOrdering,
}

impl Fold3dOrderEnumerator {
    pub fn new(
        placement: &Placement3d,
        index: &PlaneIndex,
        census: &Fold3dCensus,
        tolerances: Fold3dTolerances,
    ) -> Result<Self, Fold3dOrderError> {
        let plan = plan(placement, index, census, tolerances)?;
        let mut components = Vec::with_capacity(plan.components.len());
        for (position, component) in plan.components.into_iter().enumerate() {
            components.push(ComponentSolver::new(position, component)?);
        }
        let mut out = Self {
            components,
            variables: plan.variables,
            crossings: plan.crossings,
            crossing_count: plan.crossing_count,
            couplings: plan.couplings,
            discovered: 1,
            current: Fold3dOrdering {
                relations: Vec::new(),
                undetermined: Vec::new(),
                component_sizes: Vec::new(),
                crossings: Vec::new(),
                crossing_count: 0,
                variables: Vec::new(),
                couplings: 0,
                current_case: 1,
                discovered_cases: 1,
                has_next: false,
            },
        };
        out.current = out.assemble();
        Ok(out)
    }

    pub fn current(&self) -> &Fold3dOrdering {
        &self.current
    }

    pub fn can_advance(&self) -> bool {
        self.components.iter().any(ComponentSolver::has_next)
    }

    /// Move to the next solution, wrapping to the first when exhausted.
    ///
    /// Digit 0 is the component with the most variables, and it moves first: the
    /// alternative leaves the largest stack untouched and looks like nothing
    /// happened.
    ///
    /// `has_next` is the shipped enumerator's own signal and it is *optimistic* —
    /// it says the permutation state moved, not that another solution is there —
    /// so a digit that says yes and then finds nothing is exhausted rather than
    /// broken, and carries like any other.
    pub fn advance(&mut self) -> Result<Advance, Fold3dOrderError> {
        let mut wrapped = true;
        for digit in 0..self.components.len() {
            if self.components[digit].has_next() && self.components[digit].step()? {
                wrapped = false;
                break;
            }
            self.components[digit].restart()?;
        }
        if !wrapped {
            self.discovered += 1;
        } else {
            self.discovered = self.discovered.max(1);
        }
        self.current = self.assemble();
        if wrapped {
            self.current.current_case = 1;
        }
        Ok(if wrapped {
            Advance::WrappedToFirst
        } else {
            Advance::Next
        })
    }

    fn assemble(&self) -> Fold3dOrdering {
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
                relations.insert(key, upper == key.0);
            }
        }
        let known: BTreeSet<(usize, usize)> = self
            .variables
            .iter()
            .map(|variable| variable.faces)
            .collect();
        let mut out = Vec::new();
        for (&key, &upper_first) in &relations {
            if !known.contains(&key) {
                // Cross-plane scaffolding: a cut relation carries no layer
                // meaning and must never be reported as one.
                continue;
            }
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
            couplings: self.couplings,
            current_case: self.discovered,
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
        WorkerOverlapSearchError::SubFace(SubFaceSearchError::CombinationGeneratorRequired {
            permutation_count,
        }) => Fold3dOrderError::StackTooDeep {
            component,
            permutations: permutation_count,
        },
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
    crossings: Vec<Fold3dCrossing>,
    crossing_count: usize,
    couplings: usize,
}

/// Build every component's search input from the placed geometry.
fn plan(
    placement: &Placement3d,
    index: &PlaneIndex,
    census: &Fold3dCensus,
    tolerances: Fold3dTolerances,
) -> Result<Plan, Fold3dOrderError> {
    let cells = cell_index(index, census, placement.span, tolerances)?;
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

    // Which component a face belongs to. A face can carry variables in only one
    // component, because every pair of its variables that shares it lives in a
    // common subface and is therefore already joined.
    let mut component_faces: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); count];
    for (variable, &group) in label.iter().enumerate() {
        component_faces[group].insert(variables[variable].faces.0);
        component_faces[group].insert(variables[variable].faces.1);
    }
    let component_of_face = |face: usize| -> Option<usize> {
        component_faces
            .iter()
            .position(|faces| faces.contains(&face))
    };

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

    let owner = |faces: &[usize]| -> Option<usize> {
        let mut found: Option<usize> = None;
        for &face in faces {
            let group = component_of_face(face)?;
            match found {
                None => found = Some(group),
                Some(first) if first == group => {}
                Some(_) => return None,
            }
        }
        found
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

    let mut components = Vec::with_capacity(order.len());
    for (position, group) in order.into_iter().enumerate() {
        components.push(builders[group].localise(position)?);
    }
    Ok(Plan {
        components,
        variables,
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

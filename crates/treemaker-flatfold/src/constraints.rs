use std::collections::{BTreeMap, BTreeSet};
use std::convert::Infallible;
use std::sync::OnceLock;

use crate::math;
use crate::tables::{
    DENSE_FACE_LIMIT, Faces, PairList, PairLookup, Scratch, SearchData, SearchDataBuilder,
    TacoComponents, faces_vec, pairs_of,
};
use crate::{Analysis, ConstraintSummary, FlatFoldError, OverlapGraph, Result, SolutionLimit};
use treemaker_fold::Assignment;

pub(crate) use crate::tables::pairs_for_type;

pub(crate) type Key = Vec<u16>;
pub(crate) type ConstraintBuckets = [Vec<Key>; 3];

pub(crate) const TACO_TACO: usize = 0;
pub(crate) const TACO_TORTILLA: usize = 1;
pub(crate) const TORTILLA_TORTILLA: usize = 2;
pub(crate) const TRANSITIVITY: usize = 3;
const TYPES: [usize; 4] = [TACO_TACO, TACO_TORTILLA, TORTILLA_TORTILLA, TRANSITIVITY];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct ConstraintCounts {
    pub taco_taco: usize,
    pub taco_tortilla: usize,
    pub tortilla_tortilla: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct TransitivityCounts {
    pub all: usize,
    pub reduced: usize,
}

#[derive(Debug, Clone)]
pub(crate) struct ConstraintState {
    pub variables: Vec<Key>,
    /// The variables, their constraints and the taco-tortilla components as
    /// the search reads them.
    pub data: SearchData,
    pub assignments: Vec<u8>,
    pub groups: Vec<Vec<usize>>,
    pub constraint_counts: ConstraintCounts,
    pub transitivity_counts: TransitivityCounts,
}

impl ConstraintState {
    pub(crate) fn summary(&self) -> ConstraintSummary {
        ConstraintSummary {
            variables: self.variables.len(),
            taco_taco: self.constraint_counts.taco_taco,
            taco_tortilla: self.constraint_counts.taco_tortilla,
            tortilla_tortilla: self.constraint_counts.tortilla_tortilla,
            transitivity: self.transitivity_counts.all / 3,
            reduced_transitivity: self.transitivity_counts.reduced / 3,
        }
    }

    fn tables<'a>(
        &'a self,
        overlap: &'a OverlapGraph,
        implications: &'a ImplicationMaps,
    ) -> SearchTables<'a> {
        SearchTables {
            data: &self.data,
            transitivity: TransitivitySource {
                faces_cells: &overlap.faces_cells,
                cells_faces: &overlap.cells_faces,
            },
            implications,
        }
    }
}

/// Flat-Folder's variables (`BF`, `BI`) and constraint buckets (`BT`) for one
/// arrangement, before anything is assigned.
#[derive(Debug, Clone)]
pub(crate) struct ConstraintTables {
    pub variables: Vec<Key>,
    pub variable_index: BTreeMap<Key, usize>,
    pub constraints: Vec<ConstraintBuckets>,
}

/// Where the search derives transitivity from, upstream's `FC` and `CF`:
/// three faces sharing a cell must stack consistently, unless a taco-tortilla
/// component already orders them (`FC_CF_CC_Bf_2_Bt3`; the components, `CC`,
/// are in [`SearchData`]). Flat-Folder passes its own arrangement; the
/// completion entry point passes the caller's cells.
#[derive(Debug, Clone, Copy)]
pub(crate) struct TransitivitySource<'a> {
    pub faces_cells: &'a [Vec<usize>],
    pub cells_faces: &'a [Vec<usize>],
}

/// Everything propagation and the search read.
#[derive(Clone, Copy)]
pub(crate) struct SearchTables<'a> {
    pub data: &'a SearchData,
    pub transitivity: TransitivitySource<'a>,
    pub implications: &'a ImplicationMaps,
}

impl SearchTables<'_> {
    /// Marks sized for this problem's faces and cells.
    pub(crate) fn scratch(&self) -> Scratch {
        Scratch::new(
            self.transitivity.faces_cells.len(),
            self.transitivity.cells_faces.len(),
        )
    }
}

/// Flat-Folder's own variables and buckets in the search's form.
fn search_data(
    face_count: usize,
    variables: &[Key],
    constraints: &[ConstraintBuckets],
) -> SearchData {
    let faces: Vec<Vec<usize>> = variables.iter().map(|key| math::decode(key)).collect();
    let face_count = faces
        .iter()
        .flatten()
        .map(|&f| f + 1)
        .max()
        .unwrap_or(0)
        .max(face_count);
    let mut builder = SearchDataBuilder::new(face_count, variables.len(), DENSE_FACE_LIMIT);
    for (pair, buckets) in faces.iter().zip(constraints) {
        builder.variable(
            pair.first().copied().unwrap_or_default(),
            pair.get(1).copied().unwrap_or_default(),
        );
        for bucket in buckets {
            for key in bucket {
                builder.push_constraint(&math::decode(key));
            }
            builder.end_family();
        }
    }
    builder.finish()
}

/// Why propagation stopped: upstream `initial_assignment` returns
/// `[type, F, E]` for both, and only the Rust error message tells them apart.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ConflictCause {
    /// The constraint has no valid state under the current assignments.
    Unsatisfiable,
    /// Two constraints implied opposite orders for one variable in a level.
    ImpliedTwice,
}

/// A constraint propagation could not satisfy, with upstream's `error_faces`:
/// the faces of every variable the conflict traces back to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SeedConflict {
    pub constraint_type: usize,
    pub faces: Vec<usize>,
    pub error_faces: Vec<usize>,
    pub cause: ConflictCause,
}

impl SeedConflict {
    /// The error `solve_flat_fold` has always returned for this conflict.
    fn into_flat_fold_error(self) -> FlatFoldError {
        FlatFoldError::AssignmentConflict(match self.cause {
            ConflictCause::Unsatisfiable => format!(
                "unable to resolve constraint type {} on faces {:?}",
                self.constraint_type, self.faces
            ),
            ConflictCause::ImpliedTwice => "conflicting implied assignments".to_string(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum InitialPropagation {
    Assigned(Vec<u8>),
    Conflict(SeedConflict),
}

/// How a variable got its value during initial propagation (upstream `BP`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Parent {
    /// Assigned before propagation started.
    Root,
    /// Implied by constraint `index` of type `constraint_type` in the unpacked
    /// list of `variable`.
    Implied {
        constraint_type: usize,
        variable: usize,
        index: usize,
    },
}

/// Counts search nodes for `guess_vars`, which asks before each propagation.
pub(crate) trait NodeMeter {
    type Stop;
    fn enter(&mut self) -> std::result::Result<(), Self::Stop>;

    /// Asked once per variable the initial propagation visits, which no node
    /// counts: a meter that stops on a clock stops there too.
    fn tick(&mut self) -> std::result::Result<(), Self::Stop> {
        Ok(())
    }
}

/// Flat-Folder's own search has no budget.
pub(crate) struct Unmetered;

impl NodeMeter for Unmetered {
    type Stop = Infallible;

    fn enter(&mut self) -> std::result::Result<(), Infallible> {
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ConstraintSolution {
    pub component_sizes: Vec<usize>,
    pub solution_counts: Vec<usize>,
    pub states: String,
    pub face_orders: Vec<[i64; 3]>,
}

/// What a constraint's state implies (upstream `CON.state` or a list of
/// implied orders).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Inference {
    Conflict,
    Alive,
    Dead,
    Implied(Implied),
}

/// Up to six `(index, order)` pairs, held inline: a constraint reads at
/// most six variables. In the tables the index is the pair's position in
/// the constraint; in an inference it is the variable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Implied {
    items: [(usize, u8); 6],
    len: u8,
}

impl Implied {
    fn of(items: &[(usize, u8)]) -> Implied {
        let mut out = Implied {
            items: [(0, 0); 6],
            len: 0,
        };
        for &item in items.iter().take(6) {
            out.items[usize::from(out.len)] = item;
            out.len += 1;
        }
        out
    }

    fn as_slice(&self) -> &[(usize, u8)] {
        &self.items[..usize::from(self.len)]
    }
}

pub(crate) fn build_constraint_tables(analysis: &Analysis) -> Result<ConstraintTables> {
    let overlap = analysis
        .overlap
        .as_ref()
        .ok_or(FlatFoldError::Unimplemented("overlap graph"))?;
    let fold = &analysis.normalized.document;
    let variables = build_variables(
        &fold.edges_faces,
        &overlap.segments_points,
        &overlap.segments_edges,
        &overlap.cells_points,
        &overlap.cells_faces,
        &overlap.segments_cells,
    );
    let variable_index = variables
        .iter()
        .enumerate()
        .map(|(index, key)| (key.clone(), index))
        .collect::<BTreeMap<_, _>>();
    let constraints = build_constraints(
        &variables,
        &variable_index,
        &fold.edges_faces,
        &overlap.segments_edges,
        &overlap.cells_faces,
        &overlap.segments_cells,
    )?;
    Ok(ConstraintTables {
        variables,
        variable_index,
        constraints,
    })
}

pub(crate) fn build_constraint_state(analysis: &Analysis) -> Result<ConstraintState> {
    let overlap = analysis
        .overlap
        .as_ref()
        .ok_or(FlatFoldError::Unimplemented("overlap graph"))?;
    let fold = &analysis.normalized.document;
    let ConstraintTables {
        variables,
        variable_index,
        constraints,
    } = build_constraint_tables(analysis)?;
    let constraint_counts = count_constraints(&constraints);
    let data = search_data(overlap.faces_cells.len(), &variables, &constraints);
    let initial = initial_assignments(
        &fold.edges_faces,
        &fold.edges_assignment,
        &analysis.faces_flip,
        &variables,
        &variable_index,
    );
    let tables = SearchTables {
        data: &data,
        transitivity: TransitivitySource {
            faces_cells: &overlap.faces_cells,
            cells_faces: &overlap.cells_faces,
        },
        implications: ImplicationMaps::shared(),
    };
    let mut transitivity_counts = TransitivityCounts::default();
    let level = assigned_level(&initial);
    let assignments = match propagate_initial_assignments(
        &tables,
        initial,
        level,
        &mut transitivity_counts,
        &mut Unmetered,
    )? {
        Ok(InitialPropagation::Assigned(assignments)) => assignments,
        Ok(InitialPropagation::Conflict(conflict)) => {
            return Err(conflict.into_flat_fold_error());
        }
        Err(never) => match never {},
    };
    let groups = variable_groups(&tables, &assignments, Some(&mut transitivity_counts));
    Ok(ConstraintState {
        variables,
        data,
        assignments,
        groups,
        constraint_counts,
        transitivity_counts,
    })
}

pub(crate) fn solve_constraint_state(
    analysis: &Analysis,
    state: &ConstraintState,
    limit: &SolutionLimit,
) -> Result<ConstraintSolution> {
    let limit = match limit {
        SolutionLimit::All => usize::MAX,
        SolutionLimit::Count(0) => {
            return Err(FlatFoldError::InvalidInput(
                "solution limit must be positive".to_string(),
            ));
        }
        SolutionLimit::Count(limit) => *limit,
    };
    let overlap = analysis
        .overlap
        .as_ref()
        .ok_or(FlatFoldError::Unimplemented("overlap graph"))?;
    let tables = state.tables(overlap, ImplicationMaps::shared());
    let mut group_solutions = Vec::with_capacity(state.groups.len());
    let assigned_orders = state.groups.first().map_or_else(Vec::new, |group| {
        group
            .iter()
            .map(|variable| state.assignments[*variable])
            .collect::<Vec<_>>()
    });
    group_solutions.push(vec![math::bit_encode(&assigned_orders)]);
    for (component, group) in state.groups.iter().enumerate().skip(1) {
        let mut assignments = state.assignments.clone();
        let solutions = match guess_vars(&tables, group, &mut assignments, limit, &mut Unmetered)? {
            Ok(solutions) => solutions,
            Err(never) => match never {},
        };
        if solutions.is_empty() {
            return Err(FlatFoldError::UnsatisfiedComponent(format!(
                "component {component} has no valid assignments"
            )));
        }
        group_solutions.push(solutions);
    }
    let solution_counts = group_solutions.iter().map(Vec::len).collect::<Vec<_>>();
    let face_orders = first_solution_face_orders(state, &group_solutions, &analysis.faces_flip)?;
    Ok(ConstraintSolution {
        component_sizes: state.groups.iter().map(Vec::len).collect(),
        states: product_decimal(&solution_counts),
        solution_counts,
        face_orders,
    })
}

fn build_variables(
    edges_faces: &[Vec<usize>],
    segments_points: &[[usize; 2]],
    segments_edges: &[Vec<usize>],
    cells_points: &[Vec<usize>],
    cells_faces: &[Vec<usize>],
    _segments_cells: &[Vec<usize>],
) -> Vec<Key> {
    let mut segment_faces = BTreeMap::new();
    for (segment_index, segment) in segments_points.iter().copied().enumerate() {
        let mut faces = Vec::new();
        for edge_index in &segments_edges[segment_index] {
            if let Some(edge_faces) = edges_faces.get(*edge_index) {
                faces.extend(edge_faces.iter().copied());
            }
        }
        segment_faces.insert(math::encode_order_pair(segment[0], segment[1]), faces);
    }
    let mut cell_from_directed_segment = BTreeMap::new();
    for (cell_index, cell) in cells_points.iter().enumerate() {
        if cell.is_empty() {
            continue;
        }
        let mut v1 = cell[cell.len() - 1];
        for v2 in cell {
            cell_from_directed_segment.insert(math::encode(&[*v2, v1]), cell_index);
            v1 = *v2;
        }
    }
    let mut variables = BTreeSet::new();
    if let Some(faces) = cells_faces.first() {
        for j in 1..faces.len() {
            for i in 0..j {
                variables.insert(math::encode_order_pair(faces[i], faces[j]));
            }
        }
    }
    let mut seen = BTreeSet::new();
    let mut queue = vec![0usize];
    let mut next = 0usize;
    let cells_face_sets = cells_faces
        .iter()
        .map(|faces| faces.iter().copied().collect::<BTreeSet<_>>())
        .collect::<Vec<_>>();
    while next < queue.len() {
        let cell_index = queue[next];
        next += 1;
        let Some(cell) = cells_points.get(cell_index) else {
            continue;
        };
        if cell.is_empty() {
            continue;
        }
        let mut v1 = cell[cell.len() - 1];
        for v2 in cell {
            if let Some(neighbor) = cell_from_directed_segment
                .get(&math::encode(&[v1, *v2]))
                .copied()
                && !seen.contains(&neighbor)
            {
                queue.push(neighbor);
                seen.insert(neighbor);
                let source = &cells_face_sets[cell_index];
                let target = &cells_face_sets[neighbor];
                let key = math::encode_order_pair(v1, *v2);
                if let Some(boundary_faces) = segment_faces.get(&key) {
                    for face in boundary_faces {
                        if source.contains(face) || !target.contains(face) {
                            continue;
                        }
                        for other in target {
                            if face != other {
                                variables.insert(math::encode_order_pair(*face, *other));
                            }
                        }
                    }
                }
            }
            v1 = *v2;
        }
    }
    variables.into_iter().collect()
}

fn build_constraints(
    variables: &[Key],
    variable_index: &BTreeMap<Key, usize>,
    edges_faces: &[Vec<usize>],
    segments_edges: &[Vec<usize>],
    cells_faces: &[Vec<usize>],
    segments_cells: &[Vec<usize>],
) -> Result<Vec<ConstraintBuckets>> {
    let mut constraints = vec![empty_buckets(); variables.len()];
    fill_edge_edge_constraints(
        &mut constraints,
        variable_index,
        edges_faces,
        segments_edges,
    )?;
    fill_edge_face_constraints(
        &mut constraints,
        variable_index,
        edges_faces,
        segments_edges,
        cells_faces,
        segments_cells,
    )?;
    Ok(constraints)
}

fn empty_buckets() -> ConstraintBuckets {
    [Vec::new(), Vec::new(), Vec::new()]
}

fn fill_edge_edge_constraints(
    constraints: &mut [ConstraintBuckets],
    variable_index: &BTreeMap<Key, usize>,
    edges_faces: &[Vec<usize>],
    segments_edges: &[Vec<usize>],
) -> Result<()> {
    let mut edge_overlaps = vec![Vec::<usize>::new(); edges_faces.len()];
    for edges in segments_edges {
        for (j, e1) in edges.iter().enumerate() {
            for e2 in edges.iter().skip(j + 1) {
                let (a, b) = if e1 < e2 { (*e1, *e2) } else { (*e2, *e1) };
                if !edge_overlaps[a].contains(&b) {
                    edge_overlaps[a].push(b);
                }
            }
        }
    }
    for (e1, overlaps) in edge_overlaps.iter().enumerate() {
        for e2 in overlaps {
            if edges_faces[e1].len() != 2 || edges_faces[*e2].len() != 2 {
                continue;
            }
            let f1 = edges_faces[e1][0];
            let f2 = edges_faces[e1][1];
            let f3 = edges_faces[*e2][0];
            let f4 = edges_faces[*e2][1];
            // Two distinct edges of the same rigid face cannot fold onto the
            // same segment; when the folded-graph epsilon merges a sliver
            // face's borders this pair shows up anyway and the 3-bit choice
            // table below (which assumes four distinct faces) derives
            // degenerate self-pair constraints. Skip, matching the upstream
            // flat-folder assumption that the face quadruple is distinct.
            if f1 == f3 || f1 == f4 || f2 == f3 || f2 == f4 {
                continue;
            }
            let f1f2 = check_overlap(f1, f2, variable_index);
            let f1f3 = check_overlap(f1, f3, variable_index);
            let f1f4 = check_overlap(f1, f4, variable_index);
            let choice = (f1f2 << 2) | (f1f3 << 1) | f1f4;
            let constraint = match choice {
                0 => Some((TACO_TORTILLA, vec![f3, f4, f2])),
                1 => Some((TORTILLA_TORTILLA, vec![f1, f2, f4, f3])),
                2 => Some((TORTILLA_TORTILLA, vec![f1, f2, f3, f4])),
                3 => Some((TACO_TORTILLA, vec![f3, f4, f1])),
                4 => None,
                5 => Some((TACO_TORTILLA, vec![f1, f2, f4])),
                6 => Some((TACO_TORTILLA, vec![f1, f2, f3])),
                7 => Some((TACO_TACO, vec![f1, f2, f3, f4])),
                _ => None,
            };
            if let Some((constraint_type, faces)) = constraint {
                add_constraint(constraints, variable_index, constraint_type, &faces)?;
            }
        }
    }
    Ok(())
}

fn fill_edge_face_constraints(
    constraints: &mut [ConstraintBuckets],
    variable_index: &BTreeMap<Key, usize>,
    edges_faces: &[Vec<usize>],
    segments_edges: &[Vec<usize>],
    cells_faces: &[Vec<usize>],
    segments_cells: &[Vec<usize>],
) -> Result<()> {
    let mut edge_faces = vec![Vec::<usize>::new(); edges_faces.len()];
    for (segment_index, cells) in segments_cells.iter().enumerate() {
        if cells.len() != 2 {
            continue;
        }
        let [c1, c2] = [cells[0], cells[1]];
        let source = cells_faces[c1].iter().copied().collect::<BTreeSet<_>>();
        let common = cells_faces[c2]
            .iter()
            .copied()
            .filter(|face| source.contains(face))
            .collect::<Vec<_>>();
        for edge in &segments_edges[segment_index] {
            for face in &common {
                if !edge_faces[*edge].contains(face) {
                    edge_faces[*edge].push(*face);
                }
            }
        }
    }
    for (edge, faces) in edge_faces.iter().enumerate() {
        for f3 in faces {
            if edges_faces[edge].len() != 2 {
                continue;
            }
            let f1 = edges_faces[edge][0];
            let f2 = edges_faces[edge][1];
            if f1 == *f3 || f2 == *f3 {
                continue;
            }
            let constraint = if check_overlap(f1, f2, variable_index) == 1 {
                (TACO_TORTILLA, vec![f1, f2, *f3])
            } else {
                (TORTILLA_TORTILLA, vec![f1, f2, *f3, *f3])
            };
            add_constraint(constraints, variable_index, constraint.0, &constraint.1)?;
        }
    }
    Ok(())
}

fn check_overlap(a: usize, b: usize, variable_index: &BTreeMap<Key, usize>) -> u8 {
    u8::from(variable_index.contains_key(&math::encode_order_pair(a, b)))
}

fn add_constraint(
    constraints: &mut [ConstraintBuckets],
    variable_index: &BTreeMap<Key, usize>,
    constraint_type: usize,
    faces: &[usize],
) -> Result<()> {
    for pair in pairs_for_type(constraint_type, faces).as_slice() {
        let key = math::encode_order_pair(pair[0], pair[1]);
        let Some(index) = variable_index.get(&key).copied() else {
            return Err(FlatFoldError::InvalidInput(format!(
                "constraint references a non-overlapping face pair: type={constraint_type} faces={faces:?} missing_pair=({},{})",
                pair[0], pair[1]
            )));
        };
        constraints[index][constraint_type].push(math::encode(faces));
    }
    Ok(())
}

fn count_constraints(constraints: &[ConstraintBuckets]) -> ConstraintCounts {
    let mut counts = ConstraintCounts::default();
    for buckets in constraints {
        counts.taco_taco += buckets[TACO_TACO].len();
        counts.taco_tortilla += buckets[TACO_TORTILLA].len();
        counts.tortilla_tortilla += buckets[TORTILLA_TORTILLA].len();
    }
    counts.taco_taco /= 6;
    counts.taco_tortilla /= 2;
    counts.tortilla_tortilla /= 2;
    counts
}

pub(crate) fn initial_assignments(
    edges_faces: &[Vec<usize>],
    assignments: &[Assignment],
    faces_flip: &[bool],
    variables: &[Key],
    variable_index: &BTreeMap<Key, usize>,
) -> Vec<u8> {
    let mut out = vec![0; variables.len()];
    for (edge_index, assignment) in assignments.iter().enumerate() {
        if !matches!(assignment, Assignment::Mountain | Assignment::Valley) {
            continue;
        }
        let Some(faces) = edges_faces.get(edge_index) else {
            continue;
        };
        if faces.len() != 2 {
            continue;
        }
        let key = math::encode_order_pair(faces[0], faces[1]);
        let Some(variable) = variable_index.get(&key).copied() else {
            continue;
        };
        let f1 = math::decode(&key)[0];
        let order = if (!faces_flip[f1] && *assignment == Assignment::Mountain)
            || (faces_flip[f1] && *assignment == Assignment::Valley)
        {
            2
        } else {
            1
        };
        out[variable] = order;
    }
    out
}

/// Every assigned variable, in index order: upstream's first propagation level.
pub(crate) fn assigned_level(assignments: &[u8]) -> Vec<(usize, u8)> {
    assignments
        .iter()
        .copied()
        .enumerate()
        .filter_map(|(index, assignment)| (assignment != 0).then_some((index, assignment)))
        .collect()
}

/// Upstream `initial_assignment`: breadth-first unit propagation from `level`.
///
/// Every variable already assigned in `assignments` is a root of the conflict
/// explanation, but only the variables in `level` are propagated. Flat-Folder
/// passes every assigned variable; the completion entry point passes its seeds
/// and leaves carried pairs out. Each level is visited in insertion order, as
/// upstream's `Map` is, so a conflict names the same constraint upstream does.
/// `meter` is ticked once per variable visited, and its stop ends the
/// propagation without an answer.
pub(crate) fn propagate_initial_assignments<M: NodeMeter>(
    tables: &SearchTables<'_>,
    assignments: Vec<u8>,
    level: Vec<(usize, u8)>,
    transitivity_counts: &mut TransitivityCounts,
    meter: &mut M,
) -> Result<std::result::Result<InitialPropagation, M::Stop>> {
    let parents = roots(&assignments);
    let mut state = Propagated {
        assignments,
        parents,
    };
    let mut scratch = tables.scratch();
    Ok(
        match propagate_levels(
            tables,
            &mut state,
            level,
            transitivity_counts,
            meter,
            &mut scratch,
        )? {
            Err(stop) => Err(stop),
            Ok(Some(conflict)) => Ok(InitialPropagation::Conflict(conflict)),
            Ok(None) => Ok(InitialPropagation::Assigned(state.assignments)),
        },
    )
}

/// Every variable's order after a propagation (0 where none) and how each
/// got it (upstream's `BA` and `BP`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Propagated {
    pub assignments: Vec<u8>,
    pub parents: Vec<Option<Parent>>,
}

/// Every assigned variable as a root of the explanation, the others none.
pub(crate) fn roots(assignments: &[u8]) -> Vec<Option<Parent>> {
    assignments
        .iter()
        .map(|assignment| (*assignment != 0).then_some(Parent::Root))
        .collect()
}

/// [`propagate_initial_assignments`] continuing from a propagated `state`:
/// `level` is applied and propagated, its implications recorded beside the
/// parents already there, so a conflict traces back through both. `None`
/// when no constraint broke; `state` then holds the closure. On a conflict
/// `state` holds what was applied when it broke.
pub(crate) fn propagate_levels<M: NodeMeter>(
    tables: &SearchTables<'_>,
    state: &mut Propagated,
    mut level: Vec<(usize, u8)>,
    transitivity_counts: &mut TransitivityCounts,
    meter: &mut M,
    scratch: &mut Scratch,
) -> Result<std::result::Result<Option<SeedConflict>, M::Stop>> {
    let Propagated {
        assignments,
        parents,
    } = state;
    let mut pending = vec![0u8; assignments.len()];
    while !level.is_empty() {
        for (index, assignment) in &level {
            assignments[*index] = *assignment;
        }
        let mut new_level = Vec::new();
        for &(index, _) in &level {
            if let Err(stop) = meter.tick() {
                return Ok(Err(stop));
            }
            let [f1, f2] = tables.data.faces(index);
            for constraint_type in TYPES {
                let constraints_for_type = unpack(
                    tables.data,
                    tables.transitivity,
                    constraint_type,
                    index,
                    f1,
                    f2,
                    transitivity_counts,
                    scratch,
                );
                for (constraint_index, constraint_faces) in constraints_for_type.iter().enumerate()
                {
                    let cause = match tables.implications.infer(
                        constraint_type,
                        constraint_faces,
                        tables.data.lookup(),
                        assignments,
                        known_first(constraint_type, index),
                    )? {
                        Inference::Conflict => Some(ConflictCause::Unsatisfiable),
                        Inference::Alive | Inference::Dead => None,
                        Inference::Implied(implied) => {
                            let mut cause = None;
                            for &(implied_index, implied_assignment) in implied.as_slice() {
                                match pending[implied_index] {
                                    0 => {
                                        parents[implied_index] = Some(Parent::Implied {
                                            constraint_type,
                                            variable: index,
                                            index: constraint_index,
                                        });
                                        pending[implied_index] = implied_assignment;
                                        new_level.push((implied_index, implied_assignment));
                                    }
                                    existing if existing == implied_assignment => {}
                                    _ => {
                                        cause = Some(ConflictCause::ImpliedTwice);
                                        break;
                                    }
                                }
                            }
                            cause
                        }
                    };
                    if let Some(cause) = cause {
                        let faces = *constraint_faces;
                        return Ok(Ok(Some(SeedConflict {
                            constraint_type,
                            faces: faces_vec(constraint_type, &faces),
                            error_faces: error_faces(
                                tables,
                                pairs_of(constraint_type, &faces),
                                assignments,
                                parents,
                            ),
                            cause,
                        })));
                    }
                }
            }
        }
        for (index, _) in &new_level {
            pending[*index] = 0;
        }
        level = new_level;
    }
    Ok(Ok(None))
}

/// Upstream `error_faces`: the faces of every variable a conflict depends on,
/// found by walking parent pointers back from the pairs the conflicting
/// constraint reads to the roots. Like upstream, it follows only variables
/// already applied; ones implied in the level that conflicted are not
/// expanded.
pub(crate) fn error_faces(
    tables: &SearchTables<'_>,
    pairs: PairList,
    assignments: &[u8],
    parents: &[Option<Parent>],
) -> Vec<usize> {
    let lookup = tables.data.lookup();
    let variable_of = |[a, b]: [usize; 2]| lookup.get(a, b);
    let stack = pairs
        .as_slice()
        .iter()
        .copied()
        .filter_map(variable_of)
        .collect::<Vec<_>>();
    traced_faces(tables, stack, assignments, parents)
}

/// The walk behind [`error_faces`], from any variables: the faces of every
/// variable reached, ascending.
pub(crate) fn traced_faces(
    tables: &SearchTables<'_>,
    mut stack: Vec<usize>,
    assignments: &[u8],
    parents: &[Option<Parent>],
) -> Vec<usize> {
    let lookup = tables.data.lookup();
    let mut scratch = tables.scratch();
    let mut seen = vec![false; assignments.len()];
    while let Some(variable) = stack.pop() {
        seen[variable] = true;
        if assignments[variable] == 0 {
            continue;
        }
        let Some(Parent::Implied {
            constraint_type,
            variable: parent,
            index,
        }) = parents[variable]
        else {
            continue;
        };
        let [f1, f2] = tables.data.faces(parent);
        let mut counts = TransitivityCounts::default();
        let Some(constraint) = unpack(
            tables.data,
            tables.transitivity,
            constraint_type,
            parent,
            f1,
            f2,
            &mut counts,
            &mut scratch,
        )
        .get(index)
        .copied() else {
            continue;
        };
        for &[a, b] in pairs_of(constraint_type, &constraint).as_slice() {
            if let Some(next) = lookup.get(a, b)
                && !seen[next]
            {
                stack.push(next);
            }
        }
    }
    seen.iter()
        .enumerate()
        .filter(|(_, seen)| **seen)
        .flat_map(|(variable, _)| tables.data.faces(variable))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

/// Upstream `get_components`. `transitivity_counts`, when given, counts
/// every transitivity triple met (Flat-Folder's summary reports them);
/// without it the triples that could not join anything are not filtered.
pub(crate) fn variable_groups(
    tables: &SearchTables<'_>,
    assignments: &[u8],
    mut transitivity_counts: Option<&mut TransitivityCounts>,
) -> Vec<Vec<usize>> {
    let assigned = assignments
        .iter()
        .enumerate()
        .filter_map(|(index, assignment)| (*assignment != 0).then_some(index))
        .collect::<Vec<_>>();
    let mut seen = vec![false; assignments.len()];
    let mut scratch = tables.scratch();
    let mut groups = Vec::new();
    for (variable, assignment) in assignments.iter().enumerate() {
        if seen[variable] || *assignment != 0 {
            continue;
        }
        groups.push(group_from(
            tables,
            assignments,
            variable,
            &mut seen,
            transitivity_counts.as_deref_mut(),
            &mut scratch,
        ));
    }
    groups.sort_by_key(Vec::len);
    let mut with_assigned = Vec::with_capacity(groups.len() + 1);
    with_assigned.push(assigned);
    with_assigned.extend(groups);
    with_assigned
}

/// One of [`variable_groups`]' components: breadth first from `start`
/// through every constraint that is not dead, marking what it reaches in
/// `seen`, in the order reached.
///
/// Only an open pair not yet reached is ever added, so a constraint without
/// one adds nothing, whatever it infers, and is skipped before its
/// inference. Unless the transitivity triples are being counted, a triple
/// without one is also skipped before the taco-tortilla filter.
pub(crate) fn group_from(
    tables: &SearchTables<'_>,
    assignments: &[u8],
    start: usize,
    seen: &mut [bool],
    mut transitivity_counts: Option<&mut TransitivityCounts>,
    scratch: &mut Scratch,
) -> Vec<usize> {
    let lookup = tables.data.lookup();
    let components = tables.data.components();
    let mut stack = vec![start];
    seen[start] = true;
    // Add a constraint's open pairs not yet reached, unless it is dead.
    let reach = |constraint_type: usize,
                 faces: &Faces,
                 first: Option<usize>,
                 stack: &mut Vec<usize>,
                 seen: &mut [bool]| {
        let pairs = pairs_of(constraint_type, faces);
        let adds = |seen: &[bool]| {
            pairs.as_slice().iter().any(|&[a, b]| {
                lookup
                    .get(a, b)
                    .is_some_and(|v| !seen[v] && assignments[v] == 0)
            })
        };
        if !adds(seen) {
            return;
        }
        let Ok(inference) =
            tables
                .implications
                .infer(constraint_type, faces, lookup, assignments, first)
        else {
            return;
        };
        if inference == Inference::Dead {
            return;
        }
        for &[a, b] in pairs.as_slice() {
            if let Some(next_variable) = lookup.get(a, b)
                && !seen[next_variable]
                && assignments[next_variable] == 0
            {
                stack.push(next_variable);
                seen[next_variable] = true;
            }
        }
    };
    let mut next = 0usize;
    while next < stack.len() {
        let current = stack[next];
        next += 1;
        let [f1, f2] = tables.data.faces(current);
        for constraint_type in [TACO_TACO, TACO_TORTILLA, TORTILLA_TORTILLA] {
            for constraint_faces in tables.data.bucket(current, constraint_type) {
                reach(constraint_type, constraint_faces, None, &mut stack, seen);
            }
        }
        match transitivity_counts.as_deref_mut() {
            Some(counts) => {
                transitivity_constraints(tables.data, f1, f2, tables.transitivity, counts, scratch);
                for constraint_faces in &scratch.out {
                    reach(
                        TRANSITIVITY,
                        constraint_faces,
                        Some(current),
                        &mut stack,
                        seen,
                    );
                }
            }
            None => {
                transitivity_candidates(f1, f2, tables.transitivity, scratch);
                let (c12, c21) = (components.get(f1, f2), components.get(f2, f1));
                for &f3 in &scratch.candidates {
                    // The triple's first pair is `current`, already reached.
                    let adds = |a: usize, b: usize| {
                        lookup
                            .get(a, b)
                            .is_some_and(|v| !seen[v] && assignments[v] == 0)
                    };
                    if !adds(f2, f3) && !adds(f3, f1) {
                        continue;
                    }
                    if taco_ordered(components, f1, f2, f3, c12, c21) {
                        continue;
                    }
                    let faces = [f1 as u32, f2 as u32, f3 as u32, f3 as u32];
                    reach(TRANSITIVITY, &faces, Some(current), &mut stack, seen);
                }
            }
        }
    }
    stack
}

/// The assigned variables that constraints on `group`'s variables read: where
/// an explanation of `group` having no order starts.
pub(crate) fn assigned_reads(
    tables: &SearchTables<'_>,
    group: &[usize],
    assignments: &[u8],
) -> Vec<usize> {
    let lookup = tables.data.lookup();
    let mut scratch = tables.scratch();
    let mut counts = TransitivityCounts::default();
    let mut marked = vec![false; assignments.len()];
    let mut reads = Vec::new();
    for &variable in group {
        let [f1, f2] = tables.data.faces(variable);
        for constraint_type in TYPES {
            let constraints_for_type = unpack(
                tables.data,
                tables.transitivity,
                constraint_type,
                variable,
                f1,
                f2,
                &mut counts,
                &mut scratch,
            );
            for constraint_faces in constraints_for_type {
                for &[a, b] in pairs_of(constraint_type, constraint_faces).as_slice() {
                    if let Some(read) = lookup.get(a, b)
                        && assignments[read] != 0
                        && !marked[read]
                    {
                        marked[read] = true;
                        reads.push(read);
                    }
                }
            }
        }
    }
    reads
}

/// A transitivity triple `[f1, f2, f3]` unpacked for variable `variable`
/// reads that variable first (its faces are `f1 < f2`), so its inference
/// need not look it up; the other families' first pair can be any of theirs.
#[inline]
fn known_first(constraint_type: usize, variable: usize) -> Option<usize> {
    (constraint_type == TRANSITIVITY).then_some(variable)
}

/// Upstream `unpack_cons`: variable `variable`'s constraints of one family,
/// faces `f1 < f2` being its pair. Transitivity is derived into `scratch`.
#[allow(clippy::too_many_arguments)]
#[inline]
fn unpack<'s>(
    data: &'s SearchData,
    transitivity: TransitivitySource<'_>,
    constraint_type: usize,
    variable: usize,
    f1: usize,
    f2: usize,
    transitivity_counts: &mut TransitivityCounts,
    scratch: &'s mut Scratch,
) -> &'s [Faces] {
    if constraint_type == TRANSITIVITY {
        transitivity_constraints(data, f1, f2, transitivity, transitivity_counts, scratch);
        &scratch.out
    } else {
        data.bucket(variable, constraint_type)
    }
}

/// Upstream `FC_CF_CC_Bf_2_Bt3`: the third faces of every cell `f1` and `f2`
/// share, each once in the order first met, less those a taco-tortilla
/// component already orders, as triples `[f1, f2, f3]` in `scratch.out`.
fn transitivity_constraints(
    data: &SearchData,
    f1: usize,
    f2: usize,
    source: TransitivitySource<'_>,
    transitivity_counts: &mut TransitivityCounts,
    scratch: &mut Scratch,
) {
    transitivity_candidates(f1, f2, source, scratch);
    let Scratch {
        candidates, out, ..
    } = scratch;
    out.clear();
    transitivity_counts.all += candidates.len();
    let components = data.components();
    let (c12, c21) = (components.get(f1, f2), components.get(f2, f1));
    for &f3 in candidates.iter() {
        if !taco_ordered(components, f1, f2, f3, c12, c21) {
            out.push([f1 as u32, f2 as u32, f3 as u32, f3 as u32]);
        }
    }
    transitivity_counts.reduced += out.len();
}

/// Whether a taco-tortilla component already orders the triple `f1, f2,
/// f3`, so it is no transitivity constraint: for some face of the three,
/// the other two are in one of its components. `c12` and `c21` are
/// `f2`'s component around `f1` and `f1`'s around `f2`.
#[inline]
fn taco_ordered(
    components: &TacoComponents,
    f1: usize,
    f2: usize,
    f3: usize,
    c12: u32,
    c21: u32,
) -> bool {
    // A component is a number from 1, and 0 none: upstream's `undefined`.
    let c31 = components.get(f3, f1);
    (c12 != 0 && c12 == components.get(f1, f3))
        || (c21 != 0 && c21 == components.get(f2, f3))
        || (c31 != 0 && c31 == components.get(f3, f2))
}

/// The third faces of every cell `f1` and `f2` share, each once, in the
/// order upstream meets them, into `scratch.candidates`.
fn transitivity_candidates(
    f1: usize,
    f2: usize,
    source: TransitivitySource<'_>,
    scratch: &mut Scratch,
) {
    let TransitivitySource {
        faces_cells,
        cells_faces,
    } = source;
    let Scratch {
        met,
        shared,
        candidates,
        ..
    } = scratch;
    candidates.clear();
    if met.len() < faces_cells.len() {
        met.resize(faces_cells.len(), false);
    }
    if shared.len() < cells_faces.len() {
        shared.resize(cells_faces.len(), false);
    }
    // Upstream keeps f1's cells in a set; marks on the cells answer the same
    // membership, and are cleared again below.
    for &cell in &faces_cells[f1] {
        if let Some(mark) = shared.get_mut(cell) {
            *mark = true;
        }
    }
    for &cell in &faces_cells[f2] {
        if !shared.get(cell).copied().unwrap_or(false) {
            continue;
        }
        for &face in &cells_faces[cell] {
            if face == f1 || face == f2 {
                continue;
            }
            match met.get_mut(face) {
                Some(seen) if *seen => {}
                Some(seen) => {
                    *seen = true;
                    candidates.push(face);
                }
                None if !candidates.contains(&face) => candidates.push(face),
                None => {}
            }
        }
    }
    for &cell in &faces_cells[f1] {
        if let Some(mark) = shared.get_mut(cell) {
            *mark = false;
        }
    }
    for &face in candidates.iter() {
        if let Some(seen) = met.get_mut(face) {
            *seen = false;
        }
    }
}

/// Upstream's `CON.implied`: per constraint family, what each assignment of
/// its pairs (0 for unassigned, 1, 2) implies.
pub(crate) struct ImplicationMaps {
    /// Per family, indexed by the assignment read as a base-3 number, its
    /// first pair the least significant digit. Upstream keys the same table
    /// by the assignment's string, which every inference built and looked
    /// up in the propagation's innermost loop.
    tables: Vec<Vec<Inference>>,
}

impl ImplicationMaps {
    /// The tables built once per process and shared by every completion:
    /// they depend on nothing but the families' valid states, and building
    /// them took about 0.65 ms of each call.
    pub(crate) fn shared() -> &'static Self {
        static SHARED: OnceLock<ImplicationMaps> = OnceLock::new();
        SHARED.get_or_init(Self::build)
    }

    pub(crate) fn build() -> Self {
        /// An inference while the tables are built, its implied orders by
        /// pair position.
        #[derive(Debug, Clone, PartialEq, Eq)]
        enum Built {
            Conflict,
            Alive,
            Dead,
            Implied(Vec<(usize, u8)>),
        }
        let mut maps = Vec::new();
        for valid in valid_states() {
            let n = valid[0].len();
            let mut by_zero_count = (0..=n).map(|_| BTreeMap::new()).collect::<Vec<_>>();
            for i in 0..3usize.pow(n as u32) {
                let mut k = i;
                let mut zero_count = 0usize;
                let mut assignment = Vec::with_capacity(n);
                for _ in 0..n {
                    let value = (k % 3) as u8;
                    if value == 0 {
                        zero_count += 1;
                    }
                    assignment.push(value);
                    k = (k - value as usize) / 3;
                }
                by_zero_count[zero_count].insert(tuple_key(&assignment), Built::Conflict);
            }
            for state in valid {
                by_zero_count[0].insert(state.to_string(), Built::Dead);
            }
            for zero_count in 1..=n {
                let keys = by_zero_count[zero_count]
                    .keys()
                    .cloned()
                    .collect::<Vec<_>>();
                for key in keys {
                    let mut assignment = key.bytes().map(|byte| byte - b'0').collect::<Vec<_>>();
                    let mut implied = Vec::new();
                    let mut conflict = true;
                    let mut dead = true;
                    for index in 0..n {
                        if assignment[index] != 0 {
                            continue;
                        }
                        let mut possible = 0u8;
                        for candidate in [1u8, 2] {
                            assignment[index] = candidate;
                            let state = by_zero_count[zero_count - 1]
                                .get(&tuple_key(&assignment))
                                .cloned()
                                .unwrap_or(Built::Conflict);
                            if state != Built::Dead {
                                dead = false;
                            }
                            if state != Built::Conflict {
                                possible |= candidate;
                            }
                        }
                        assignment[index] = 0;
                        if possible != 0 {
                            conflict = false;
                            if possible < 3 {
                                implied.push((index, possible));
                            }
                        }
                    }
                    let state = if conflict {
                        Built::Conflict
                    } else if !implied.is_empty() {
                        Built::Implied(implied)
                    } else if dead {
                        Built::Dead
                    } else {
                        Built::Alive
                    };
                    by_zero_count[zero_count].insert(key, state);
                }
            }
            let mut map = BTreeMap::new();
            for zero_count in (0..=n).rev() {
                map.extend(by_zero_count[zero_count].clone());
            }
            maps.push(map);
        }
        // Every one of the 3^n assignments is a key; an index the table
        // lacks would read as a conflict, as a key the map lacked did.
        let tables = maps
            .into_iter()
            .map(|map| {
                let mut table = vec![Inference::Conflict; map.len()];
                for (key, built) in map {
                    let code = key
                        .bytes()
                        .rev()
                        .fold(0usize, |code, digit| 3 * code + usize::from(digit - b'0'));
                    if let Some(slot) = table.get_mut(code) {
                        *slot = match built {
                            Built::Conflict => Inference::Conflict,
                            Built::Alive => Inference::Alive,
                            Built::Dead => Inference::Dead,
                            Built::Implied(implied) => Inference::Implied(Implied::of(&implied)),
                        };
                    }
                }
                table
            })
            .collect();
        Self { tables }
    }

    /// Upstream `infer`. `first` is the variable of the constraint's first
    /// pair when the caller already knows it.
    #[inline]
    fn infer(
        &self,
        constraint_type: usize,
        faces: &Faces,
        lookup: &PairLookup,
        assignments: &[u8],
        first: Option<usize>,
    ) -> Result<Inference> {
        let pairs = pairs_of(constraint_type, faces);
        let pairs = pairs.as_slice();
        // Each pair's variable, kept for the implied orders.
        let mut variables = [0usize; 6];
        for (position, (slot, &[x, y])) in variables.iter_mut().zip(pairs).enumerate() {
            let known = if position == 0 { first } else { None };
            debug_assert!(known.is_none() || known == lookup.get(x, y));
            let Some(variable) = known.or_else(|| lookup.get(x, y)) else {
                return Err(FlatFoldError::InvalidInput(
                    "inference references missing variable".to_string(),
                ));
            };
            *slot = variable;
        }
        self.infer_resolved(constraint_type, pairs, &variables, assignments)
    }

    /// [`Self::infer`] once each pair's variable is known: `variables[k]` is
    /// the variable of `pairs[k]`.
    #[inline]
    fn infer_resolved(
        &self,
        constraint_type: usize,
        pairs: &[[usize; 2]],
        variables: &[usize],
        assignments: &[u8],
    ) -> Result<Inference> {
        const FLIP: [[u8; 3]; 2] = [[0, 1, 2], [0, 2, 1]];
        let (mut code, mut place) = (0usize, 1usize);
        for (&variable, &[x, y]) in variables.iter().zip(pairs) {
            code +=
                place * usize::from(FLIP[usize::from(y < x)][usize::from(assignments[variable])]);
            place *= 3;
        }
        let inference = self
            .tables
            .get(constraint_type)
            .and_then(|table| table.get(code));
        Ok(match inference {
            Some(Inference::Implied(implied)) => {
                let mut out = Implied {
                    items: [(0, 0); 6],
                    len: 0,
                };
                for &(pair_index, assignment) in implied.as_slice() {
                    let (Some(&[x, y]), Some(&variable)) =
                        (pairs.get(pair_index), variables.get(pair_index))
                    else {
                        return Err(FlatFoldError::InvalidInput(
                            "implied assignment references missing variable".to_string(),
                        ));
                    };
                    out.items[usize::from(out.len)] =
                        (variable, FLIP[usize::from(y < x)][usize::from(assignment)]);
                    out.len += 1;
                }
                Inference::Implied(out)
            }
            Some(other) => *other,
            None => Inference::Conflict,
        })
    }
}

/// Upstream `propagate`: assign `assignment` to `variable` and everything it
/// implies, breadth first. Returns what it assigned, the guess first; when a
/// constraint breaks, everything is undone and the list is empty.
fn propagate_assignment(
    tables: &SearchTables<'_>,
    variable: usize,
    assignment: u8,
    assignments: &mut [u8],
    scratch: &mut Scratch,
) -> Result<Vec<usize>> {
    let lookup = tables.data.lookup();
    let components = tables.data.components();
    let mut assigned = vec![variable];
    assignments[variable] = assignment;
    let mut next = 0usize;
    // Apply what one constraint infers; false when it breaks.
    fn apply(inference: Inference, assigned: &mut Vec<usize>, assignments: &mut [u8]) -> bool {
        match inference {
            Inference::Conflict => false,
            Inference::Alive | Inference::Dead => true,
            Inference::Implied(implied) => {
                for &(implied_variable, implied_assignment) in implied.as_slice() {
                    match assignments[implied_variable] {
                        0 => {
                            assigned.push(implied_variable);
                            assignments[implied_variable] = implied_assignment;
                        }
                        existing if existing == implied_assignment => {}
                        _ => return false,
                    }
                }
                true
            }
        }
    }
    while next < assigned.len() {
        let current = assigned[next];
        next += 1;
        let [f1, f2] = tables.data.faces(current);
        let mut holds = true;
        'families: for constraint_type in [TACO_TACO, TACO_TORTILLA, TORTILLA_TORTILLA] {
            for constraint_faces in tables.data.bucket(current, constraint_type) {
                let inference = tables.implications.infer(
                    constraint_type,
                    constraint_faces,
                    lookup,
                    assignments,
                    None,
                )?;
                if !apply(inference, &mut assigned, assignments) {
                    holds = false;
                    break 'families;
                }
            }
        }
        if holds {
            // Transitivity, as `unpack` derives it, with one shortcut: a
            // triple whose other two pairs are both open is alive whatever
            // its taco-tortilla components say (every `x00` state of the
            // family's table is), so it is neither filtered nor inferred.
            // Nothing is counted and no constraint is named here, so
            // skipping it changes nothing.
            transitivity_candidates(f1, f2, tables.transitivity, scratch);
            let (c12, c21) = (components.get(f1, f2), components.get(f2, f1));
            for &f3 in &scratch.candidates {
                if taco_ordered(components, f1, f2, f3, c12, c21) {
                    continue;
                }
                let (v23, v31) = (lookup.get(f2, f3), lookup.get(f3, f1));
                if let (Some(v23), Some(v31)) = (v23, v31)
                    && assignments[v23] == 0
                    && assignments[v31] == 0
                {
                    continue;
                }
                let (Some(v23), Some(v31)) = (v23, v31) else {
                    return Err(FlatFoldError::InvalidInput(
                        "inference references missing variable".to_string(),
                    ));
                };
                let inference = tables.implications.infer_resolved(
                    TRANSITIVITY,
                    &[[f1, f2], [f2, f3], [f3, f1]],
                    &[current, v23, v31],
                    assignments,
                )?;
                if !apply(inference, &mut assigned, assignments) {
                    holds = false;
                    break;
                }
            }
        }
        if !holds {
            for variable in assigned {
                assignments[variable] = 0;
            }
            return Ok(Vec::new());
        }
    }
    Ok(assigned)
}

/// Upstream `guess_vars`: depth-first search over one component, up to `limit`
/// solutions. `meter` is asked before every propagation; when it stops the
/// search, the solutions found so far are dropped and its stop is returned.
pub(crate) fn guess_vars<M: NodeMeter>(
    tables: &SearchTables<'_>,
    group: &[usize],
    assignments: &mut [u8],
    limit: usize,
    meter: &mut M,
) -> Result<std::result::Result<Vec<Key>, M::Stop>> {
    let mut solutions = Vec::new();
    let mut solution = vec![0u8; group.len()];
    let mut scratch = tables.scratch();
    let searched = search(
        tables,
        group,
        assignments,
        limit,
        meter,
        |_| 1,
        &mut scratch,
        |assignments| {
            for (solution_index, variable) in group.iter().enumerate() {
                solution[solution_index] = assignments[*variable];
            }
            solutions.push(math::bit_encode(&solution));
        },
    )?;
    Ok(searched.map(|_| solutions))
}

/// [`guess_vars`]' search with each guess trying `first(variable)` before
/// the other order (upstream always tries 1 first), calling `found` on
/// every solution until `limit` of them. Returns how many it found. When it
/// returns `limit`, `assignments` holds the last solution; otherwise every
/// guess is undone.
#[allow(clippy::too_many_arguments)]
pub(crate) fn search<M: NodeMeter>(
    tables: &SearchTables<'_>,
    group: &[usize],
    assignments: &mut [u8],
    limit: usize,
    meter: &mut M,
    first: impl Fn(usize) -> u8,
    scratch: &mut Scratch,
    mut found: impl FnMut(&[u8]),
) -> Result<std::result::Result<usize, M::Stop>> {
    let mut guesses: Vec<Vec<usize>> = Vec::new();
    let mut solutions = 0usize;
    let mut index = 0usize;
    let mut backtracking = false;
    loop {
        if backtracking {
            let Some(guess) = guesses.pop() else {
                break;
            };
            let previous_assignment = assignments[guess[0]];
            while index >= group.len() || group[index] != guess[0] {
                if index == 0 {
                    return Err(FlatFoldError::PrecisionFailure(
                        "solver backtracking index escaped component".to_string(),
                    ));
                }
                index -= 1;
            }
            for variable in &guess {
                assignments[*variable] = 0;
            }
            let tried = first(group[index]);
            if previous_assignment == tried {
                if let Err(stop) = meter.enter() {
                    return Ok(Err(stop));
                }
                let other = 3 - tried;
                let assigned =
                    propagate_assignment(tables, group[index], other, assignments, scratch)?;
                if assigned.is_empty() {
                    guesses.push(vec![group[index]]);
                    assignments[group[index]] = other;
                } else {
                    guesses.push(assigned);
                    backtracking = false;
                    index += 1;
                }
            }
        } else if index == group.len() {
            found(assignments);
            solutions += 1;
            if solutions >= limit {
                return Ok(Ok(solutions));
            }
            backtracking = true;
        } else {
            if assignments[group[index]] == 0 {
                if let Err(stop) = meter.enter() {
                    return Ok(Err(stop));
                }
                let tried = first(group[index]);
                let assigned =
                    propagate_assignment(tables, group[index], tried, assignments, scratch)?;
                if assigned.is_empty() {
                    guesses.push(vec![group[index]]);
                    assignments[group[index]] = tried;
                    backtracking = true;
                } else {
                    guesses.push(assigned);
                }
            }
            index += 1;
        }
    }
    Ok(Ok(solutions))
}

fn first_solution_face_orders(
    state: &ConstraintState,
    group_solutions: &[Vec<Key>],
    faces_flip: &[bool],
) -> Result<Vec<[i64; 3]>> {
    let mut edges = Vec::new();
    for (group_index, group) in state.groups.iter().enumerate() {
        let Some(first_solution) = group_solutions
            .get(group_index)
            .and_then(|solutions| solutions.first())
        else {
            return Err(FlatFoldError::UnsatisfiedComponent(format!(
                "component {group_index} has no first solution"
            )));
        };
        let orders = math::bit_decode(first_solution, group.len());
        for (offset, variable) in group.iter().enumerate() {
            let faces = math::decode(&state.variables[*variable]);
            if faces.len() != 2 {
                return Err(FlatFoldError::InvalidInput(
                    "face-order variable does not contain exactly two faces".to_string(),
                ));
            }
            let edge = if orders[offset] == 1 {
                math::encode(&[faces[0], faces[1]])
            } else {
                math::encode(&[faces[1], faces[0]])
            };
            edges.push(edge);
        }
    }
    let mut face_orders = Vec::with_capacity(edges.len());
    for edge in edges {
        let faces = math::decode(&edge);
        let orientation = if faces_flip[faces[1]] { 1 } else { -1 };
        face_orders.push([faces[0] as i64, faces[1] as i64, orientation]);
    }
    Ok(face_orders)
}

pub(crate) fn product_decimal(counts: &[usize]) -> String {
    counts.iter().fold("1".to_string(), |product, count| {
        multiply_decimal(&product, *count)
    })
}

fn multiply_decimal(value: &str, factor: usize) -> String {
    if factor == 0 {
        return "0".to_string();
    }
    let mut carry = 0u128;
    let factor = factor as u128;
    let mut digits = Vec::new();
    for byte in value.bytes().rev() {
        let digit = u128::from(byte - b'0');
        let product = digit * factor + carry;
        digits.push(char::from(b'0' + (product % 10) as u8));
        carry = product / 10;
    }
    while carry > 0 {
        digits.push(char::from(b'0' + (carry % 10) as u8));
        carry /= 10;
    }
    digits.iter().rev().collect()
}

fn tuple_key(values: &[u8]) -> String {
    values
        .iter()
        .map(|value| char::from(b'0' + *value))
        .collect()
}

fn valid_states() -> Vec<Vec<&'static str>> {
    vec![
        vec![
            "111112", "111121", "111222", "112111", "121112", "121222", "122111", "122212",
            "211121", "211222", "212111", "212221", "221222", "222111", "222212", "222221",
        ],
        vec!["12", "21"],
        vec!["11", "22"],
        vec!["112", "121", "122", "211", "212", "221"],
    ]
}

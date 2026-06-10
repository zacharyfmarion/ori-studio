use std::collections::{BTreeMap, BTreeSet};

use crate::math;
use crate::{Analysis, ConstraintSummary, FlatFoldError, Result, SolutionLimit};
use treemaker_fold::Assignment;

type Key = Vec<u16>;
type ConstraintBuckets = [Vec<Key>; 3];

const TACO_TACO: usize = 0;
const TACO_TORTILLA: usize = 1;
const TORTILLA_TORTILLA: usize = 2;
const TRANSITIVITY: usize = 3;
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
    pub variable_index: BTreeMap<Key, usize>,
    pub constraints: Vec<ConstraintBuckets>,
    pub connected_components: Vec<BTreeMap<usize, usize>>,
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
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ConstraintSolution {
    pub component_sizes: Vec<usize>,
    pub solution_counts: Vec<usize>,
    pub states: String,
    pub face_orders: Vec<[i64; 3]>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Inference {
    Conflict,
    Alive,
    Dead,
    Implied(Vec<(usize, u8)>),
}

pub(crate) fn build_constraint_state(analysis: &Analysis) -> Result<ConstraintState> {
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
    let constraint_counts = count_constraints(&constraints);
    let connected_components = build_connected_components(
        &overlap.faces_cells,
        &variables,
        &variable_index,
        &constraints,
    );
    let implications = ImplicationMaps::build();
    let initial = initial_assignments(
        &fold.edges_faces,
        &fold.edges_assignment,
        &analysis.faces_flip,
        &variables,
        &variable_index,
    );
    let mut transitivity_counts = TransitivityCounts::default();
    let assignments = propagate_initial_assignments(
        initial,
        &variables,
        &constraints,
        &variable_index,
        &overlap.faces_cells,
        &overlap.cells_faces,
        &connected_components,
        &implications,
        &mut transitivity_counts,
    )?;
    let groups = variable_groups(
        &variable_index,
        &variables,
        &constraints,
        &assignments,
        &overlap.faces_cells,
        &overlap.cells_faces,
        &connected_components,
        &implications,
        &mut transitivity_counts,
    );
    Ok(ConstraintState {
        variables,
        variable_index,
        constraints,
        connected_components,
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
    let implications = ImplicationMaps::build();
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
        let solutions = guess_vars(
            group,
            state,
            &overlap.faces_cells,
            &overlap.cells_faces,
            &implications,
            &mut assignments,
            limit,
        )?;
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
    for pair in pairs_for_type(constraint_type, faces) {
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

fn build_connected_components(
    faces_cells: &[Vec<usize>],
    variables: &[Key],
    _variable_index: &BTreeMap<Key, usize>,
    constraints: &[ConstraintBuckets],
) -> Vec<BTreeMap<usize, usize>> {
    let mut face_graphs = vec![BTreeMap::<usize, BTreeSet<usize>>::new(); faces_cells.len()];
    for buckets in constraints {
        for key in &buckets[TACO_TORTILLA] {
            let faces = math::decode(key);
            let [a, b, c] = [faces[0], faces[1], faces[2]];
            face_graphs[c].entry(a).or_default().insert(b);
            face_graphs[c].entry(b).or_default().insert(a);
        }
    }
    let mut components = Vec::with_capacity(face_graphs.len());
    for graph in face_graphs {
        let mut component_by_face = BTreeMap::new();
        let mut component_index = 0usize;
        for face in graph.keys() {
            if component_by_face.contains_key(face) {
                continue;
            }
            let mut queue = vec![*face];
            component_by_face.insert(*face, component_index);
            let mut next = 0usize;
            while next < queue.len() {
                let current = queue[next];
                next += 1;
                if let Some(neighbors) = graph.get(&current) {
                    for neighbor in neighbors {
                        if component_by_face.contains_key(neighbor) {
                            continue;
                        }
                        queue.push(*neighbor);
                        component_by_face.insert(*neighbor, component_index);
                    }
                }
            }
            component_index += 1;
        }
        components.push(component_by_face);
    }
    let _ = variables;
    components
}

fn initial_assignments(
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

#[allow(clippy::too_many_arguments)]
fn propagate_initial_assignments(
    mut assignments: Vec<u8>,
    variables: &[Key],
    constraints: &[ConstraintBuckets],
    variable_index: &BTreeMap<Key, usize>,
    faces_cells: &[Vec<usize>],
    cells_faces: &[Vec<usize>],
    connected_components: &[BTreeMap<usize, usize>],
    implications: &ImplicationMaps,
    transitivity_counts: &mut TransitivityCounts,
) -> Result<Vec<u8>> {
    let mut level = assignments
        .iter()
        .copied()
        .enumerate()
        .filter_map(|(index, assignment)| (assignment != 0).then_some((index, assignment)))
        .collect::<Vec<_>>();
    while !level.is_empty() {
        for (index, assignment) in &level {
            assignments[*index] = *assignment;
        }
        let mut new_level = BTreeMap::new();
        for (index, _) in &level {
            let faces = math::decode(&variables[*index]);
            for constraint_type in TYPES {
                let constraints_for_type = unpack_constraints(
                    constraint_type,
                    &constraints[*index],
                    faces[0],
                    faces[1],
                    faces_cells,
                    cells_faces,
                    connected_components,
                    transitivity_counts,
                );
                for constraint_faces in constraints_for_type {
                    match implications.infer(
                        constraint_type,
                        &constraint_faces,
                        variable_index,
                        &assignments,
                    )? {
                        Inference::Conflict => {
                            return Err(FlatFoldError::AssignmentConflict(format!(
                                "unable to resolve constraint type {constraint_type} on faces {constraint_faces:?}"
                            )));
                        }
                        Inference::Alive | Inference::Dead => {}
                        Inference::Implied(implied) => {
                            for (implied_index, implied_assignment) in implied {
                                if let Some(existing) = new_level.get(&implied_index).copied() {
                                    if existing != implied_assignment {
                                        return Err(FlatFoldError::AssignmentConflict(
                                            "conflicting implied assignments".to_string(),
                                        ));
                                    }
                                } else {
                                    new_level.insert(implied_index, implied_assignment);
                                }
                            }
                        }
                    }
                }
            }
        }
        level = new_level.into_iter().collect();
    }
    Ok(assignments)
}

#[allow(clippy::too_many_arguments)]
fn variable_groups(
    variable_index: &BTreeMap<Key, usize>,
    variables: &[Key],
    constraints: &[ConstraintBuckets],
    assignments: &[u8],
    faces_cells: &[Vec<usize>],
    cells_faces: &[Vec<usize>],
    connected_components: &[BTreeMap<usize, usize>],
    implications: &ImplicationMaps,
    transitivity_counts: &mut TransitivityCounts,
) -> Vec<Vec<usize>> {
    let assigned = assignments
        .iter()
        .enumerate()
        .filter_map(|(index, assignment)| (*assignment != 0).then_some(index))
        .collect::<Vec<_>>();
    let mut groups = Vec::new();
    let mut seen = BTreeSet::new();
    for (variable, assignment) in assignments.iter().enumerate() {
        if seen.contains(&variable) || *assignment != 0 {
            continue;
        }
        let mut stack = vec![variable];
        seen.insert(variable);
        let mut next = 0usize;
        while next < stack.len() {
            let current = stack[next];
            next += 1;
            let faces = math::decode(&variables[current]);
            for constraint_type in TYPES {
                let constraints_for_type = unpack_constraints(
                    constraint_type,
                    &constraints[current],
                    faces[0],
                    faces[1],
                    faces_cells,
                    cells_faces,
                    connected_components,
                    transitivity_counts,
                );
                for constraint_faces in constraints_for_type {
                    let Ok(inference) = implications.infer(
                        constraint_type,
                        &constraint_faces,
                        variable_index,
                        assignments,
                    ) else {
                        continue;
                    };
                    if inference == Inference::Dead {
                        continue;
                    }
                    for pair in pairs_for_type(constraint_type, &constraint_faces) {
                        let key = math::encode_order_pair(pair[0], pair[1]);
                        if let Some(next_variable) = variable_index.get(&key).copied()
                            && !seen.contains(&next_variable)
                            && assignments[next_variable] == 0
                        {
                            stack.push(next_variable);
                            seen.insert(next_variable);
                        }
                    }
                }
            }
        }
        groups.push(stack);
    }
    groups.sort_by_key(Vec::len);
    let mut with_assigned = Vec::with_capacity(groups.len() + 1);
    with_assigned.push(assigned);
    with_assigned.extend(groups);
    with_assigned
}

#[allow(clippy::too_many_arguments)]
fn unpack_constraints(
    constraint_type: usize,
    buckets: &ConstraintBuckets,
    f1: usize,
    f2: usize,
    faces_cells: &[Vec<usize>],
    cells_faces: &[Vec<usize>],
    connected_components: &[BTreeMap<usize, usize>],
    transitivity_counts: &mut TransitivityCounts,
) -> Vec<Vec<usize>> {
    if constraint_type == TRANSITIVITY {
        transitivity_constraints(
            f1,
            f2,
            faces_cells,
            cells_faces,
            connected_components,
            transitivity_counts,
        )
        .into_iter()
        .map(|f3| vec![f1, f2, f3])
        .collect()
    } else {
        buckets[constraint_type]
            .iter()
            .map(|key| math::decode(key))
            .collect()
    }
}

fn transitivity_constraints(
    f1: usize,
    f2: usize,
    faces_cells: &[Vec<usize>],
    cells_faces: &[Vec<usize>],
    connected_components: &[BTreeMap<usize, usize>],
    transitivity_counts: &mut TransitivityCounts,
) -> Vec<usize> {
    let f1_cells = faces_cells[f1].iter().copied().collect::<BTreeSet<_>>();
    let mut candidates = Vec::new();
    for cell in &faces_cells[f2] {
        if !f1_cells.contains(cell) {
            continue;
        }
        for face in &cells_faces[*cell] {
            if *face != f1 && *face != f2 && !candidates.contains(face) {
                candidates.push(*face);
            }
        }
    }
    transitivity_counts.all += candidates.len();
    let cc1 = &connected_components[f1];
    let cc2 = &connected_components[f2];
    let c12 = cc1.get(&f2).copied();
    let c21 = cc2.get(&f1).copied();
    let out = candidates
        .into_iter()
        .filter(|f3| {
            let cc3 = &connected_components[*f3];
            let c31 = cc3.get(&f1).copied();
            !((c12.is_some() && c12 == cc1.get(f3).copied())
                || (c21.is_some() && c21 == cc2.get(f3).copied())
                || (c31.is_some() && c31 == cc3.get(&f2).copied()))
        })
        .collect::<Vec<_>>();
    transitivity_counts.reduced += out.len();
    out
}

fn pairs_for_type(constraint_type: usize, faces: &[usize]) -> Vec<[usize; 2]> {
    match constraint_type {
        TACO_TACO => vec![
            [faces[0], faces[1]],
            [faces[2], faces[3]],
            [faces[2], faces[1]],
            [faces[0], faces[3]],
            [faces[0], faces[2]],
            [faces[1], faces[3]],
        ],
        TACO_TORTILLA => vec![[faces[0], faces[2]], [faces[2], faces[1]]],
        TORTILLA_TORTILLA => vec![[faces[0], faces[2]], [faces[1], faces[3]]],
        TRANSITIVITY => vec![
            [faces[0], faces[1]],
            [faces[1], faces[2]],
            [faces[2], faces[0]],
        ],
        _ => Vec::new(),
    }
}

struct ImplicationMaps {
    maps: Vec<BTreeMap<String, Inference>>,
}

impl ImplicationMaps {
    fn build() -> Self {
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
                by_zero_count[zero_count].insert(tuple_key(&assignment), Inference::Conflict);
            }
            for state in valid {
                by_zero_count[0].insert(state.to_string(), Inference::Dead);
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
                                .unwrap_or(Inference::Conflict);
                            if state != Inference::Dead {
                                dead = false;
                            }
                            if state != Inference::Conflict {
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
                        Inference::Conflict
                    } else if !implied.is_empty() {
                        Inference::Implied(implied)
                    } else if dead {
                        Inference::Dead
                    } else {
                        Inference::Alive
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
        Self { maps }
    }

    fn infer(
        &self,
        constraint_type: usize,
        faces: &[usize],
        variable_index: &BTreeMap<Key, usize>,
        assignments: &[u8],
    ) -> Result<Inference> {
        const FLIP: [[u8; 3]; 2] = [[0, 1, 2], [0, 2, 1]];
        let pairs = pairs_for_type(constraint_type, faces);
        let mut tuple = Vec::with_capacity(pairs.len());
        for [x, y] in &pairs {
            let key = math::encode_order_pair(*x, *y);
            let Some(index) = variable_index.get(&key).copied() else {
                return Err(FlatFoldError::InvalidInput(
                    "inference references missing variable".to_string(),
                ));
            };
            tuple.push(FLIP[usize::from(y < x)][assignments[index] as usize]);
        }
        let key = tuple_key(&tuple);
        let inference = self.maps[constraint_type]
            .get(&key)
            .cloned()
            .unwrap_or(Inference::Conflict);
        Ok(match inference {
            Inference::Implied(implied) => {
                let mut out = Vec::new();
                for (pair_index, assignment) in implied {
                    let [x, y] = pairs[pair_index];
                    let key = math::encode_order_pair(x, y);
                    let Some(variable) = variable_index.get(&key).copied() else {
                        return Err(FlatFoldError::InvalidInput(
                            "implied assignment references missing variable".to_string(),
                        ));
                    };
                    out.push((variable, FLIP[usize::from(y < x)][assignment as usize]));
                }
                Inference::Implied(out)
            }
            other => other,
        })
    }
}

#[allow(clippy::too_many_arguments)]
fn propagate_assignment(
    variable: usize,
    assignment: u8,
    state: &ConstraintState,
    faces_cells: &[Vec<usize>],
    cells_faces: &[Vec<usize>],
    implications: &ImplicationMaps,
    assignments: &mut [u8],
) -> Result<Vec<usize>> {
    let mut assigned = vec![variable];
    assignments[variable] = assignment;
    let mut next = 0usize;
    while next < assigned.len() {
        let current = assigned[next];
        next += 1;
        let faces = math::decode(&state.variables[current]);
        let buckets = &state.constraints[current];
        for constraint_type in TYPES {
            let mut transitivity_counts = TransitivityCounts::default();
            let constraints_for_type = unpack_constraints(
                constraint_type,
                buckets,
                faces[0],
                faces[1],
                faces_cells,
                cells_faces,
                &state.connected_components,
                &mut transitivity_counts,
            );
            for constraint_faces in constraints_for_type {
                match implications.infer(
                    constraint_type,
                    &constraint_faces,
                    &state.variable_index,
                    assignments,
                )? {
                    Inference::Conflict => {
                        for variable in assigned {
                            assignments[variable] = 0;
                        }
                        return Ok(Vec::new());
                    }
                    Inference::Alive | Inference::Dead => {}
                    Inference::Implied(implied) => {
                        for (implied_variable, implied_assignment) in implied {
                            match assignments[implied_variable] {
                                0 => {
                                    assigned.push(implied_variable);
                                    assignments[implied_variable] = implied_assignment;
                                }
                                existing if existing == implied_assignment => {}
                                _ => {
                                    for variable in assigned {
                                        assignments[variable] = 0;
                                    }
                                    return Ok(Vec::new());
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(assigned)
}

#[allow(clippy::too_many_arguments)]
fn guess_vars(
    group: &[usize],
    state: &ConstraintState,
    faces_cells: &[Vec<usize>],
    cells_faces: &[Vec<usize>],
    implications: &ImplicationMaps,
    assignments: &mut [u8],
    limit: usize,
) -> Result<Vec<Key>> {
    let mut guesses: Vec<Vec<usize>> = Vec::new();
    let mut solutions = Vec::new();
    let mut solution = vec![0u8; group.len()];
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
            if previous_assignment == 1 {
                let assigned = propagate_assignment(
                    group[index],
                    2,
                    state,
                    faces_cells,
                    cells_faces,
                    implications,
                    assignments,
                )?;
                if assigned.is_empty() {
                    guesses.push(vec![group[index]]);
                    assignments[group[index]] = 2;
                } else {
                    guesses.push(assigned);
                    backtracking = false;
                    index += 1;
                }
            }
        } else if index == group.len() {
            for (solution_index, variable) in group.iter().enumerate() {
                solution[solution_index] = assignments[*variable];
            }
            solutions.push(math::bit_encode(&solution));
            if solutions.len() >= limit {
                return Ok(solutions);
            }
            backtracking = true;
        } else {
            if assignments[group[index]] == 0 {
                let assigned = propagate_assignment(
                    group[index],
                    1,
                    state,
                    faces_cells,
                    cells_faces,
                    implications,
                    assignments,
                )?;
                if assigned.is_empty() {
                    guesses.push(vec![group[index]]);
                    assignments[group[index]] = 1;
                    backtracking = true;
                } else {
                    guesses.push(assigned);
                }
            }
            index += 1;
        }
    }
    Ok(solutions)
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

fn product_decimal(counts: &[usize]) -> String {
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

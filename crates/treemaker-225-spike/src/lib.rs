//! Research primitives for a target-conditioned 22.5-degree synthesis spike.
//!
//! This crate intentionally models only the target metric tree and the folded
//! axial component representation. It does not claim crease-pattern
//! realizability.

use std::collections::{HashMap, VecDeque};

use thiserror::Error;

const LENGTH_EPSILON: f64 = 1.0e-12;

#[derive(Debug, Error, Clone, PartialEq)]
pub enum SpikeError {
    #[error("a metric tree must contain at least one node")]
    EmptyTree,
    #[error("node label '{0}' is duplicated")]
    DuplicateNodeLabel(String),
    #[error("edge {edge} references node {node}, but the tree has {node_count} nodes")]
    InvalidEndpoint {
        edge: usize,
        node: usize,
        node_count: usize,
    },
    #[error("edge {edge} is a self-loop at node {node}")]
    SelfLoop { edge: usize, node: usize },
    #[error("edge {edge} has invalid length {length}")]
    InvalidLength { edge: usize, length: f64 },
    #[error("graph has {nodes} nodes and {edges} edges, so it is not a tree")]
    WrongEdgeCount { nodes: usize, edges: usize },
    #[error("graph is disconnected")]
    Disconnected,
    #[error("root node {root} is outside a tree with {node_count} nodes")]
    InvalidRoot { root: usize, node_count: usize },
    #[error("expected {expected} axial signs but received {actual}")]
    WrongSignCount { expected: usize, actual: usize },
    #[error("axial sign for edge {edge} must be -1 or +1, received {sign}")]
    InvalidSign { edge: usize, sign: i8 },
    #[error("requested schedule limit {limit} exceeds the supported maximum of {maximum}")]
    ScheduleLimitExceeded { limit: usize, maximum: usize },
}

#[derive(Debug, Clone, PartialEq)]
pub struct MetricEdge {
    pub nodes: [usize; 2],
    pub length: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MetricTree {
    labels: Vec<String>,
    edges: Vec<MetricEdge>,
    incident_edges: Vec<Vec<usize>>,
}

impl MetricTree {
    pub fn new(labels: Vec<String>, edges: Vec<MetricEdge>) -> Result<Self, SpikeError> {
        if labels.is_empty() {
            return Err(SpikeError::EmptyTree);
        }

        let mut label_indices = HashMap::with_capacity(labels.len());
        for (index, label) in labels.iter().enumerate() {
            if label_indices.insert(label.clone(), index).is_some() {
                return Err(SpikeError::DuplicateNodeLabel(label.clone()));
            }
        }

        if edges.len() + 1 != labels.len() {
            return Err(SpikeError::WrongEdgeCount {
                nodes: labels.len(),
                edges: edges.len(),
            });
        }

        let mut incident_edges = vec![Vec::new(); labels.len()];
        for (edge_index, edge) in edges.iter().enumerate() {
            for node in edge.nodes {
                if node >= labels.len() {
                    return Err(SpikeError::InvalidEndpoint {
                        edge: edge_index,
                        node,
                        node_count: labels.len(),
                    });
                }
            }
            if edge.nodes[0] == edge.nodes[1] {
                return Err(SpikeError::SelfLoop {
                    edge: edge_index,
                    node: edge.nodes[0],
                });
            }
            if !edge.length.is_finite() || edge.length <= LENGTH_EPSILON {
                return Err(SpikeError::InvalidLength {
                    edge: edge_index,
                    length: edge.length,
                });
            }
            incident_edges[edge.nodes[0]].push(edge_index);
            incident_edges[edge.nodes[1]].push(edge_index);
        }

        let mut seen = vec![false; labels.len()];
        let mut queue = VecDeque::from([0]);
        seen[0] = true;
        while let Some(node) = queue.pop_front() {
            for edge_index in &incident_edges[node] {
                let edge = &edges[*edge_index];
                let other = if edge.nodes[0] == node {
                    edge.nodes[1]
                } else {
                    edge.nodes[0]
                };
                if !seen[other] {
                    seen[other] = true;
                    queue.push_back(other);
                }
            }
        }
        if seen.iter().any(|visited| !visited) {
            return Err(SpikeError::Disconnected);
        }

        Ok(Self {
            labels,
            edges,
            incident_edges,
        })
    }

    pub fn labels(&self) -> &[String] {
        &self.labels
    }

    pub fn edges(&self) -> &[MetricEdge] {
        &self.edges
    }

    pub fn degree(&self, node: usize) -> usize {
        self.incident_edges[node].len()
    }

    fn edge_between(&self, node1: usize, node2: usize) -> Option<usize> {
        self.incident_edges[node1]
            .iter()
            .copied()
            .find(|edge_index| {
                let edge = &self.edges[*edge_index];
                edge.nodes.contains(&node2)
            })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MatchMode {
    Labeled,
    Unlabeled,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TreeMatch {
    /// Maps each target node index to a candidate node index.
    pub node_map: Vec<usize>,
    pub rms_normalized_length_error: f64,
    pub max_normalized_length_error: f64,
}

pub fn match_metric_trees(
    target: &MetricTree,
    candidate: &MetricTree,
    mode: MatchMode,
) -> Option<TreeMatch> {
    if target.labels.len() != candidate.labels.len() || target.edges.len() != candidate.edges.len()
    {
        return None;
    }

    let node_map = match mode {
        MatchMode::Labeled => labeled_node_map(target, candidate)?,
        MatchMode::Unlabeled => unlabeled_node_map(target, candidate)?,
    };
    length_match(target, candidate, node_map)
}

fn labeled_node_map(target: &MetricTree, candidate: &MetricTree) -> Option<Vec<usize>> {
    let candidate_labels: HashMap<&str, usize> = candidate
        .labels
        .iter()
        .enumerate()
        .map(|(index, label)| (label.as_str(), index))
        .collect();
    let node_map: Vec<usize> = target
        .labels
        .iter()
        .map(|label| candidate_labels.get(label.as_str()).copied())
        .collect::<Option<_>>()?;
    topology_matches(target, candidate, &node_map).then_some(node_map)
}

fn unlabeled_node_map(target: &MetricTree, candidate: &MetricTree) -> Option<Vec<usize>> {
    let mut node_map = vec![usize::MAX; target.labels.len()];
    let mut candidate_used = vec![false; candidate.labels.len()];
    let mut best: Option<(f64, Vec<usize>)> = None;

    fn search(
        target: &MetricTree,
        candidate: &MetricTree,
        node_map: &mut [usize],
        candidate_used: &mut [bool],
        assigned: usize,
        best: &mut Option<(f64, Vec<usize>)>,
    ) {
        if assigned == target.labels.len() {
            if topology_matches(target, candidate, node_map)
                && let Some(tree_match) = length_match(target, candidate, node_map.to_vec())
            {
                let error = tree_match.rms_normalized_length_error;
                if best
                    .as_ref()
                    .is_none_or(|(best_error, _)| error < *best_error)
                {
                    *best = Some((error, node_map.to_vec()));
                }
            }
            return;
        }

        let Some(target_node) = (0..target.labels.len())
            .filter(|node| node_map[*node] == usize::MAX)
            .max_by_key(|node| {
                let assigned_neighbors = target.incident_edges[*node]
                    .iter()
                    .filter(|edge_index| {
                        let edge = &target.edges[**edge_index];
                        let other = if edge.nodes[0] == *node {
                            edge.nodes[1]
                        } else {
                            edge.nodes[0]
                        };
                        node_map[other] != usize::MAX
                    })
                    .count();
                (assigned_neighbors, target.degree(*node))
            })
        else {
            return;
        };

        for candidate_node in 0..candidate.labels.len() {
            if candidate_used[candidate_node]
                || target.degree(target_node) != candidate.degree(candidate_node)
            {
                continue;
            }
            let consistent = target.incident_edges[target_node].iter().all(|edge_index| {
                let edge = &target.edges[*edge_index];
                let other = if edge.nodes[0] == target_node {
                    edge.nodes[1]
                } else {
                    edge.nodes[0]
                };
                node_map[other] == usize::MAX
                    || candidate
                        .edge_between(candidate_node, node_map[other])
                        .is_some()
            });
            if !consistent {
                continue;
            }

            node_map[target_node] = candidate_node;
            candidate_used[candidate_node] = true;
            search(
                target,
                candidate,
                node_map,
                candidate_used,
                assigned + 1,
                best,
            );
            node_map[target_node] = usize::MAX;
            candidate_used[candidate_node] = false;
        }
    }

    search(
        target,
        candidate,
        &mut node_map,
        &mut candidate_used,
        0,
        &mut best,
    );
    best.map(|(_, node_map)| node_map)
}

fn topology_matches(target: &MetricTree, candidate: &MetricTree, node_map: &[usize]) -> bool {
    target.edges.iter().all(|edge| {
        candidate
            .edge_between(node_map[edge.nodes[0]], node_map[edge.nodes[1]])
            .is_some()
    })
}

fn length_match(
    target: &MetricTree,
    candidate: &MetricTree,
    node_map: Vec<usize>,
) -> Option<TreeMatch> {
    let target_total: f64 = target.edges.iter().map(|edge| edge.length).sum();
    let candidate_total: f64 = candidate.edges.iter().map(|edge| edge.length).sum();
    let mut squared_error = 0.0;
    let mut max_error: f64 = 0.0;

    for target_edge in &target.edges {
        let candidate_edge_index = candidate.edge_between(
            node_map[target_edge.nodes[0]],
            node_map[target_edge.nodes[1]],
        )?;
        let target_length = target_edge.length / target_total;
        let candidate_length = candidate.edges[candidate_edge_index].length / candidate_total;
        let error = (target_length - candidate_length).abs();
        squared_error += error * error;
        max_error = max_error.max(error);
    }

    Some(TreeMatch {
        node_map,
        rms_normalized_length_error: (squared_error / target.edges.len() as f64).sqrt(),
        max_normalized_length_error: max_error,
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct AxialSchedule {
    pub root: usize,
    pub edge_signs: Vec<i8>,
    pub node_positions: Vec<f64>,
}

impl AxialSchedule {
    pub fn from_signs(
        tree: &MetricTree,
        root: usize,
        edge_signs: Vec<i8>,
    ) -> Result<Self, SpikeError> {
        if root >= tree.labels.len() {
            return Err(SpikeError::InvalidRoot {
                root,
                node_count: tree.labels.len(),
            });
        }
        if edge_signs.len() != tree.edges.len() {
            return Err(SpikeError::WrongSignCount {
                expected: tree.edges.len(),
                actual: edge_signs.len(),
            });
        }
        for (edge, sign) in edge_signs.iter().copied().enumerate() {
            if !matches!(sign, -1 | 1) {
                return Err(SpikeError::InvalidSign { edge, sign });
            }
        }

        let mut node_positions = vec![f64::NAN; tree.labels.len()];
        node_positions[root] = 0.0;
        let mut queue = VecDeque::from([root]);
        while let Some(node) = queue.pop_front() {
            for edge_index in &tree.incident_edges[node] {
                let edge = &tree.edges[*edge_index];
                let other = if edge.nodes[0] == node {
                    edge.nodes[1]
                } else {
                    edge.nodes[0]
                };
                if node_positions[other].is_nan() {
                    node_positions[other] =
                        node_positions[node] + f64::from(edge_signs[*edge_index]) * edge.length;
                    queue.push_back(other);
                }
            }
        }

        Ok(Self {
            root,
            edge_signs,
            node_positions,
        })
    }

    /// Enumerate schedules up to global axial reflection by fixing the first
    /// edge sign positive.
    pub fn enumerate(
        tree: &MetricTree,
        root: usize,
        limit: usize,
    ) -> Result<Vec<Self>, SpikeError> {
        const MAX_ENUMERATED_SCHEDULES: usize = 1 << 20;
        if limit > MAX_ENUMERATED_SCHEDULES {
            return Err(SpikeError::ScheduleLimitExceeded {
                limit,
                maximum: MAX_ENUMERATED_SCHEDULES,
            });
        }
        if root >= tree.labels.len() {
            return Err(SpikeError::InvalidRoot {
                root,
                node_count: tree.labels.len(),
            });
        }

        let variable_edges = tree.edges.len().saturating_sub(1);
        let possible = 1usize
            .checked_shl(variable_edges as u32)
            .unwrap_or(usize::MAX);
        let count = possible.min(limit);
        let mut schedules = Vec::with_capacity(count);
        for mask in 0..count {
            let mut signs = vec![1; tree.edges.len()];
            for (offset, sign) in signs.iter_mut().enumerate().skip(1) {
                *sign = if mask & (1 << (offset - 1)) == 0 {
                    -1
                } else {
                    1
                };
            }
            schedules.push(Self::from_signs(tree, root, signs)?);
        }
        Ok(schedules)
    }

    pub fn coincident_node_groups(&self, tolerance: f64) -> Vec<Vec<usize>> {
        let mut consumed = vec![false; self.node_positions.len()];
        let mut groups = Vec::new();
        for node in 0..self.node_positions.len() {
            if consumed[node] {
                continue;
            }
            let group: Vec<usize> = (node..self.node_positions.len())
                .filter(|other| {
                    !consumed[*other]
                        && (self.node_positions[node] - self.node_positions[*other]).abs()
                            <= tolerance
                })
                .collect();
            for member in &group {
                consumed[*member] = true;
            }
            if group.len() > 1 {
                groups.push(group);
            }
        }
        groups
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RibbonComponent {
    pub source_edge: usize,
    pub junctions: [usize; 2],
    pub axial_interval: [f64; 2],
}

#[derive(Debug, Clone, PartialEq)]
pub struct RibbonComplex {
    labels: Vec<String>,
    components: Vec<RibbonComponent>,
}

impl RibbonComplex {
    pub fn from_schedule(tree: &MetricTree, schedule: &AxialSchedule) -> Self {
        let components = tree
            .edges
            .iter()
            .enumerate()
            .map(|(source_edge, edge)| {
                let first = schedule.node_positions[edge.nodes[0]];
                let second = schedule.node_positions[edge.nodes[1]];
                RibbonComponent {
                    source_edge,
                    junctions: edge.nodes,
                    axial_interval: [first.min(second), first.max(second)],
                }
            })
            .collect();
        Self {
            labels: tree.labels.clone(),
            components,
        }
    }

    pub fn components(&self) -> &[RibbonComponent] {
        &self.components
    }

    pub fn extract_tree(&self) -> Result<MetricTree, SpikeError> {
        MetricTree::new(
            self.labels.clone(),
            self.components
                .iter()
                .map(|component| MetricEdge {
                    nodes: component.junctions,
                    length: component.axial_interval[1] - component.axial_interval[0],
                })
                .collect(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree(labels: &[&str], edges: &[([usize; 2], f64)]) -> MetricTree {
        MetricTree::new(
            labels.iter().map(|label| (*label).to_owned()).collect(),
            edges
                .iter()
                .map(|(nodes, length)| MetricEdge {
                    nodes: *nodes,
                    length: *length,
                })
                .collect(),
        )
        .unwrap()
    }

    #[test]
    fn labeled_match_reports_swapped_flap_length_error() {
        let target = tree(
            &["body", "head", "tail", "wing"],
            &[([0, 1], 2.0), ([0, 2], 1.0), ([0, 3], 3.0)],
        );
        let candidate = tree(
            &["body", "head", "tail", "wing"],
            &[([0, 1], 1.0), ([0, 2], 2.0), ([0, 3], 3.0)],
        );

        let result = match_metric_trees(&target, &candidate, MatchMode::Labeled).unwrap();
        assert!(result.max_normalized_length_error > 0.1);
    }

    #[test]
    fn unlabeled_match_finds_a_permuted_tree() {
        let target = tree(
            &["center", "a", "b", "c"],
            &[([0, 1], 1.0), ([0, 2], 2.0), ([0, 3], 3.0)],
        );
        let candidate = tree(
            &["x", "y", "z", "q"],
            &[([2, 0], 6.0), ([2, 1], 2.0), ([2, 3], 4.0)],
        );

        let result = match_metric_trees(&target, &candidate, MatchMode::Unlabeled).unwrap();
        assert!(result.rms_normalized_length_error < LENGTH_EPSILON);
    }

    #[test]
    fn topology_mismatch_is_rejected() {
        let path = tree(
            &["a", "b", "c", "d"],
            &[([0, 1], 1.0), ([1, 2], 1.0), ([2, 3], 1.0)],
        );
        let star = tree(
            &["w", "x", "y", "z"],
            &[([0, 1], 1.0), ([0, 2], 1.0), ([0, 3], 1.0)],
        );

        assert!(match_metric_trees(&path, &star, MatchMode::Unlabeled).is_none());
    }

    #[test]
    fn ribbon_round_trip_preserves_distinct_coincident_junctions() {
        let target = tree(
            &["root", "left_joint", "right_joint", "left_tip", "right_tip"],
            &[([0, 1], 1.0), ([0, 2], 1.0), ([1, 3], 2.0), ([2, 4], 2.0)],
        );
        let schedule = AxialSchedule::from_signs(&target, 0, vec![1, 1, 1, -1]).unwrap();
        assert_eq!(
            schedule.coincident_node_groups(LENGTH_EPSILON),
            vec![vec![1, 2]]
        );

        let extracted = RibbonComplex::from_schedule(&target, &schedule)
            .extract_tree()
            .unwrap();
        let result = match_metric_trees(&target, &extracted, MatchMode::Labeled).unwrap();
        assert!(result.max_normalized_length_error < LENGTH_EPSILON);
    }

    #[test]
    fn schedule_enumeration_removes_global_reflection_duplicates() {
        let target = tree(
            &["root", "a", "b", "c"],
            &[([0, 1], 1.0), ([0, 2], 1.0), ([0, 3], 1.0)],
        );

        let schedules = AxialSchedule::enumerate(&target, 0, 100).unwrap();
        assert_eq!(schedules.len(), 4);
        assert!(schedules.iter().all(|schedule| schedule.edge_signs[0] == 1));
    }
}

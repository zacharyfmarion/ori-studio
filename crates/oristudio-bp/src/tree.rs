use crate::error::{BpError, BpResult};
use crate::model::{Edge, Edit, Flap, NodeId};
use crate::shared::MAX_TREE_HEIGHT;
use crate::sweep::{ArcPath, RoundedRect};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq)]
pub struct Aabb {
    values: [f64; 4],
    margin: f64,
    pub points: [crate::math::geometry::PathPoint; 4],
}

#[derive(Debug, Clone, PartialEq)]
pub struct AreaNode {
    pub id: NodeId,
    pub parent: Option<NodeId>,
    pub children: Vec<NodeId>,
    pub length: f64,
    pub dist: f64,
    pub area: f64,
}

impl AreaNode {
    fn new(id: NodeId, length: f64, parent: Option<NodeId>, area: f64, dist: f64) -> Self {
        Self {
            id,
            parent,
            children: Vec::new(),
            length,
            dist,
            area,
        }
    }

    pub fn is_leaf(&self) -> bool {
        self.children.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ParentMap {
    pub id: NodeId,
    pub radius: f64,
    pub children: Vec<NodeId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Hierarchy {
    pub leaves: Vec<NodeId>,
    #[serde(rename = "distMap")]
    pub dist_map: Vec<(NodeId, NodeId, f64)>,
    pub parents: Vec<ParentMap>,
}

#[derive(Debug, Clone, PartialEq)]
struct PartialTree {
    nodes: Vec<NodeId>,
    leaves: Vec<NodeId>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AreaTree {
    nodes: Vec<Option<AreaNode>>,
    root: NodeId,
    node_count: usize,
}

impl AreaTree {
    pub fn new(tree: &BpTree, use_dimension: bool) -> BpResult<Self> {
        let mut area_tree = Self {
            nodes: vec![None; tree.nodes().len()],
            root: tree.root_id(),
            node_count: 0,
        };
        area_tree.root = area_tree.build(tree, use_dimension)?;
        area_tree.update_all_areas(area_tree.root)?;
        area_tree.balance()?;
        area_tree.update_area_dist_recursive(area_tree.root, 0.0)?;
        Ok(area_tree)
    }

    pub fn nodes(&self) -> &[Option<AreaNode>] {
        &self.nodes
    }

    pub fn root(&self) -> &AreaNode {
        self.node(self.root)
            .expect("area tree root should exist after construction")
    }

    pub fn root_id(&self) -> NodeId {
        self.root
    }

    pub fn create_hierarchy(&self) -> BpResult<Vec<Hierarchy>> {
        let mut current_partial_tree = self.collect_partial_tree(self.root)?;
        let mut result = vec![Hierarchy {
            leaves: current_partial_tree.leaves.clone(),
            dist_map: self.partial_dist_map(&current_partial_tree)?,
            parents: Vec::new(),
        }];

        while current_partial_tree.nodes.len() < self.node_count {
            let mut new_leaves = Vec::new();
            let mut parents = Vec::new();
            for leaf in current_partial_tree.leaves.clone() {
                let Some(leaf_node) = self.node(leaf) else {
                    continue;
                };
                if leaf_node.is_leaf() {
                    new_leaves.push(leaf);
                } else {
                    let mut sub_hierarchy = self.collect_partial_tree(leaf)?;
                    if !sub_hierarchy.nodes.is_empty() {
                        sub_hierarchy.nodes.remove(0);
                    }
                    parents.push(ParentMap {
                        id: leaf,
                        radius: leaf_node.area.sqrt(),
                        children: sub_hierarchy.nodes.clone(),
                    });
                    current_partial_tree.nodes.extend(sub_hierarchy.nodes);
                    new_leaves.extend(sub_hierarchy.leaves);
                }
            }
            current_partial_tree.leaves = new_leaves;
            result.push(Hierarchy {
                leaves: current_partial_tree.leaves.clone(),
                dist_map: self.partial_dist_map(&current_partial_tree)?,
                parents,
            });
        }
        Ok(result)
    }

    fn node(&self, id: NodeId) -> Option<&AreaNode> {
        self.nodes.get(id as usize)?.as_ref()
    }

    fn node_mut(&mut self, id: NodeId) -> Option<&mut AreaNode> {
        self.nodes.get_mut(id as usize)?.as_mut()
    }

    fn ensure_capacity(&mut self, id: NodeId) {
        let index = id as usize;
        if index >= self.nodes.len() {
            self.nodes.resize_with(index + 1, || None);
        }
    }

    fn build(&mut self, tree: &BpTree, use_dimension: bool) -> BpResult<NodeId> {
        let mut queue = vec![tree.root_id()];
        let mut root = tree.root_id();
        let mut cursor = 0;
        while cursor < queue.len() {
            let mut node_id = queue[cursor];
            cursor += 1;
            let mut length = tree
                .node(node_id)
                .ok_or_else(|| BpError::InvalidInput(format!("missing tree node {node_id}")))?
                .length;
            let parent = tree
                .node(node_id)
                .and_then(|node| node.parent)
                .and_then(|parent| self.node(parent).map(|node| node.id));

            while tree
                .node(node_id)
                .is_some_and(|node| node.children.len() == 1)
            {
                let next = tree.node(node_id).unwrap().children[0];
                node_id = next;
                length += tree
                    .node(node_id)
                    .ok_or_else(|| BpError::InvalidInput(format!("missing tree node {node_id}")))?
                    .length;
            }

            let tree_node = tree
                .node(node_id)
                .ok_or_else(|| BpError::InvalidInput(format!("missing tree node {node_id}")))?;
            let area = get_area(tree_node, length, use_dimension);
            let dist = parent
                .and_then(|id| self.node(id).map(|node| node.dist + length))
                .unwrap_or(0.0);
            self.ensure_capacity(node_id);
            self.nodes[node_id as usize] = Some(AreaNode::new(node_id, length, parent, area, dist));
            self.node_count += 1;
            if parent.is_none() {
                root = node_id;
            } else if let Some(parent) = parent
                && let Some(parent_node) = self.node_mut(parent)
            {
                parent_node.children.push(node_id);
            }
            queue.extend(tree_node.children.iter().copied());
        }
        Ok(root)
    }

    fn update_all_areas(&mut self, id: NodeId) -> BpResult<()> {
        let children = self
            .node(id)
            .ok_or_else(|| BpError::InvalidInput(format!("missing area node {id}")))?
            .children
            .clone();
        for child in &children {
            self.update_all_areas(*child)?;
        }
        if children.is_empty() {
            return Ok(());
        }
        let children_area = children
            .iter()
            .filter_map(|child| self.node(*child).map(|node| node.area))
            .sum::<f64>();
        let length = self.node(id).map(|node| node.length).unwrap_or_default();
        let radius = children_area.sqrt() + length;
        if let Some(node) = self.node_mut(id) {
            node.area = radius * radius;
        }
        Ok(())
    }

    fn balance(&mut self) -> BpResult<()> {
        loop {
            let Some(first_child) = self.first_area_child(self.root) else {
                return Ok(());
            };
            if self.node(first_child).is_some_and(AreaNode::is_leaf) {
                return Ok(());
            }
            let Some(next_first_child_area) = self
                .first_area_child(first_child)
                .and_then(|child| self.node(child).map(|node| node.area))
            else {
                return Ok(());
            };
            let root_children = self
                .node(self.root)
                .map(|node| node.children.clone())
                .unwrap_or_default();
            let mut next_rest_area = root_children
                .iter()
                .filter(|child| **child != first_child)
                .filter_map(|child| self.node(*child).map(|node| node.area))
                .sum::<f64>();
            let first_length = self
                .node(first_child)
                .map(|node| node.length)
                .unwrap_or_default();
            let radius = next_rest_area.sqrt() + first_length;
            next_rest_area = radius * radius;
            if next_first_child_area <= next_rest_area {
                return Ok(());
            }

            let old_root = self.root;
            self.root = first_child;
            self.remove_area_child(old_root, first_child);
            self.update_area_after_children_change(old_root)?;
            if let Some(first) = self.node_mut(first_child) {
                first.parent = None;
                let length = first.length;
                first.dist = 0.0;
                first.length = 0.0;
                if !first.children.contains(&old_root) {
                    first.children.push(old_root);
                }
                if let Some(old) = self.node_mut(old_root) {
                    old.parent = Some(first_child);
                    old.dist = length;
                    old.length = length;
                }
            }
        }
    }

    fn first_area_child(&self, id: NodeId) -> Option<NodeId> {
        let mut children = self.node(id)?.children.clone();
        children.sort_by(|a, b| {
            let aa = self.node(*a).map(|node| node.area).unwrap_or_default();
            let ba = self.node(*b).map(|node| node.area).unwrap_or_default();
            ba.partial_cmp(&aa).unwrap_or(std::cmp::Ordering::Equal)
        });
        children.first().copied()
    }

    fn remove_area_child(&mut self, parent: NodeId, child: NodeId) {
        if let Some(parent) = self.node_mut(parent) {
            parent.children.retain(|candidate| *candidate != child);
        }
    }

    fn update_area_after_children_change(&mut self, id: NodeId) -> BpResult<()> {
        let children = self
            .node(id)
            .ok_or_else(|| BpError::InvalidInput(format!("missing area node {id}")))?
            .children
            .clone();
        if children.is_empty() {
            return Ok(());
        }
        let children_area = children
            .iter()
            .filter_map(|child| self.node(*child).map(|node| node.area))
            .sum::<f64>();
        let length = self.node(id).map(|node| node.length).unwrap_or_default();
        if let Some(node) = self.node_mut(id) {
            node.area = (children_area.sqrt() + length).powi(2);
        }
        Ok(())
    }

    fn update_area_dist_recursive(&mut self, id: NodeId, dist: f64) -> BpResult<()> {
        let children = {
            let Some(node) = self.node_mut(id) else {
                return Err(BpError::InvalidInput(format!("missing area node {id}")));
            };
            node.dist = dist;
            node.children.clone()
        };
        for child in children {
            let length = self.node(child).map(|node| node.length).unwrap_or_default();
            self.update_area_dist_recursive(child, dist + length)?;
        }
        Ok(())
    }

    fn collect_partial_tree(&self, root: NodeId) -> BpResult<PartialTree> {
        let mut result = vec![root];
        let mut leaf_heap = vec![root];
        let mut leaf_set = vec![root];
        while let Some(parent) = pop_max_children(&mut leaf_heap, self) {
            let children = self
                .node(parent)
                .ok_or_else(|| BpError::InvalidInput(format!("missing area node {parent}")))?
                .children
                .clone();
            let leaves = children
                .iter()
                .filter(|child| self.node(**child).is_some_and(AreaNode::is_leaf))
                .copied()
                .collect::<Vec<_>>();
            if result.len() > 1 && (leaves.len() == children.len() || leaves.len() > 2) {
                continue;
            }
            let add_to_heap = !leaves.is_empty();
            leaf_set.retain(|candidate| *candidate != parent);
            for child in children {
                if add_to_heap {
                    leaf_heap.push(child);
                }
                if !leaf_set.contains(&child) {
                    leaf_set.push(child);
                }
                result.push(child);
            }
        }
        Ok(PartialTree {
            nodes: result,
            leaves: leaf_set,
        })
    }

    fn partial_dist_map(&self, data: &PartialTree) -> BpResult<Vec<(NodeId, NodeId, f64)>> {
        let leaves = data.leaves.iter().copied().collect::<HashSet<_>>();
        let mut partial_nodes: Vec<Option<AreaNode>> = vec![None; self.nodes.len()];
        for id in &data.nodes {
            let node = self
                .node(*id)
                .ok_or_else(|| BpError::InvalidInput(format!("missing area node {id}")))?;
            let length = if leaves.contains(id) {
                node.area.sqrt()
            } else {
                node.length
            };
            let parent = node.parent.filter(|parent| {
                partial_nodes
                    .get(*parent as usize)
                    .is_some_and(Option::is_some)
            });
            let dist = parent
                .and_then(|parent| {
                    partial_nodes[parent as usize]
                        .as_ref()
                        .map(|parent| parent.dist + length)
                })
                .unwrap_or(0.0);
            partial_nodes[*id as usize] = Some(AreaNode::new(*id, length, parent, node.area, dist));
        }
        let leaf_ids = data.leaves.clone();
        let mut result = Vec::new();
        for i in 0..leaf_ids.len() {
            for j in i + 1..leaf_ids.len() {
                let distance = area_dist(&partial_nodes, leaf_ids[i], leaf_ids[j])?;
                result.push((leaf_ids[i], leaf_ids[j], distance));
            }
        }
        Ok(result)
    }
}

fn get_area(node: &TreeNode, radius: f64, use_dimension: bool) -> f64 {
    let base_area = radius * radius;
    if !use_dimension {
        return base_area;
    }
    let [top, right, bottom, left] = node.aabb.to_values();
    let width = right - left;
    let height = top - bottom;
    (width * height + 2.0 * (width + height) * radius) / std::f64::consts::PI + base_area
}

fn pop_max_children(heap: &mut Vec<NodeId>, tree: &AreaTree) -> Option<NodeId> {
    if heap.is_empty() {
        return None;
    }
    let mut best = 0;
    for index in 1..heap.len() {
        let best_size = tree
            .node(heap[best])
            .map(|node| node.children.len())
            .unwrap_or_default();
        let candidate_size = tree
            .node(heap[index])
            .map(|node| node.children.len())
            .unwrap_or_default();
        if candidate_size > best_size {
            best = index;
        }
    }
    Some(heap.swap_remove(best))
}

fn area_dist(nodes: &[Option<AreaNode>], n1: NodeId, n2: NodeId) -> BpResult<f64> {
    let lca = area_lca(nodes, n1, n2)?;
    let a = nodes
        .get(n1 as usize)
        .and_then(Option::as_ref)
        .ok_or_else(|| BpError::InvalidInput(format!("missing area node {n1}")))?;
    let b = nodes
        .get(n2 as usize)
        .and_then(Option::as_ref)
        .ok_or_else(|| BpError::InvalidInput(format!("missing area node {n2}")))?;
    let lca = nodes
        .get(lca as usize)
        .and_then(Option::as_ref)
        .ok_or_else(|| BpError::InvalidInput("missing area lca node".to_string()))?;
    Ok(a.dist + b.dist - 2.0 * lca.dist)
}

fn area_lca(nodes: &[Option<AreaNode>], n1: NodeId, n2: NodeId) -> BpResult<NodeId> {
    let mut n1 = n1;
    let mut n2 = n2;
    while n1 != n2 {
        let d1 = nodes
            .get(n1 as usize)
            .and_then(Option::as_ref)
            .ok_or_else(|| BpError::InvalidInput(format!("missing area node {n1}")))?
            .dist;
        let d2 = nodes
            .get(n2 as usize)
            .and_then(Option::as_ref)
            .ok_or_else(|| BpError::InvalidInput(format!("missing area node {n2}")))?
            .dist;
        if d1 >= d2 {
            n1 = nodes
                .get(n1 as usize)
                .and_then(Option::as_ref)
                .and_then(|node| node.parent)
                .ok_or_else(|| BpError::InvalidInput("missing area lca parent".to_string()))?;
        }
        let d1 = nodes
            .get(n1 as usize)
            .and_then(Option::as_ref)
            .ok_or_else(|| BpError::InvalidInput(format!("missing area node {n1}")))?
            .dist;
        let d2 = nodes
            .get(n2 as usize)
            .and_then(Option::as_ref)
            .ok_or_else(|| BpError::InvalidInput(format!("missing area node {n2}")))?
            .dist;
        if d2 > d1 {
            n2 = nodes
                .get(n2 as usize)
                .and_then(Option::as_ref)
                .and_then(|node| node.parent)
                .ok_or_else(|| BpError::InvalidInput("missing area lca parent".to_string()))?;
        }
    }
    Ok(n1)
}

impl Default for Aabb {
    fn default() -> Self {
        Self::new()
    }
}

impl Aabb {
    pub fn new() -> Self {
        Self {
            values: [0.0; 4],
            margin: 0.0,
            points: to_corners([0.0; 4]),
        }
    }

    pub fn intersects(&self, that: &Aabb, gap: f64) -> bool {
        self.base_left() - gap < that.base_right()
            && self.base_right() + gap > that.base_left()
            && self.base_top() + gap > that.base_bottom()
            && self.base_bottom() - gap < that.base_top()
    }

    pub fn update(&mut self, top: f64, right: f64, bottom: f64, left: f64) {
        self.values = [top, right, bottom, left];
        self.points = to_corners(self.values);
    }

    pub fn set_margin(&mut self, margin: f64) {
        self.margin = margin;
    }

    pub fn to_array(&self) -> [f64; 4] {
        [
            self.values[0] + self.margin,
            self.values[1] + self.margin,
            self.values[2] - self.margin,
            self.values[3] - self.margin,
        ]
    }

    pub fn to_values(&self) -> [f64; 4] {
        self.values
    }

    pub fn to_rounded_rect(&self, extra_units: f64) -> RoundedRect {
        let radius = self.margin + extra_units;
        let [top, right, bottom, left] = self.values;
        RoundedRect {
            x: left,
            y: bottom,
            width: right - left,
            height: top - bottom,
            radius,
        }
    }

    pub fn to_path(&self) -> ArcPath {
        to_corners(self.to_array())
            .into_iter()
            .map(|point| crate::sweep::ArcPoint {
                point,
                arc: None,
                radius: None,
            })
            .collect()
    }

    fn base_top(&self) -> f64 {
        self.values[0]
    }

    fn base_right(&self) -> f64 {
        self.values[1]
    }

    fn base_bottom(&self) -> f64 {
        self.values[2]
    }

    fn base_left(&self) -> f64 {
        self.values[3]
    }
}

pub fn to_corners([top, right, bottom, left]: [f64; 4]) -> [crate::math::geometry::PathPoint; 4] {
    [
        crate::math::geometry::PathPoint::new(right, top),
        crate::math::geometry::PathPoint::new(left, top),
        crate::math::geometry::PathPoint::new(left, bottom),
        crate::math::geometry::PathPoint::new(right, bottom),
    ]
}

#[derive(Debug, Clone, PartialEq)]
pub struct TreeNode {
    pub id: NodeId,
    pub parent: Option<NodeId>,
    pub children: Vec<NodeId>,
    pub dist: f64,
    pub height: i32,
    pub length: f64,
    pub aabb: Aabb,
    pub leaves: Vec<NodeId>,
}

impl TreeNode {
    fn new(id: NodeId) -> Self {
        Self {
            id,
            parent: None,
            children: Vec::new(),
            dist: 0.0,
            height: -1,
            length: 0.0,
            aabb: Aabb::new(),
            leaves: Vec::new(),
        }
    }

    pub fn is_leaf(&self) -> bool {
        self.children.is_empty()
    }

    pub fn is_leaf_like(&self) -> bool {
        self.parent.is_none() && self.children.len() == 1 || self.children.is_empty()
    }

    pub fn tag(&self) -> String {
        if self.is_leaf() {
            return format!("f{}", self.id);
        }
        let Some(parent) = self.parent else {
            return "root".to_string();
        };
        if self.id < parent {
            format!("re{},{}", self.id, parent)
        } else {
            format!("re{},{}", parent, self.id)
        }
    }

    pub fn data(&self) -> TreeNodeData {
        TreeNodeData {
            id: self.id,
            dist: self.dist,
            height: self.height,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TreeNodeData {
    pub id: NodeId,
    pub dist: f64,
    pub height: i32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TreeData {
    pub edges: Vec<Edge>,
    pub nodes: Vec<TreeNodeData>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BpTree {
    nodes: Vec<Option<TreeNode>>,
    root: NodeId,
    pending_remove: Vec<NodeId>,
}

impl BpTree {
    pub fn new(edges: &[Edge], flaps: &[Flap]) -> BpResult<Self> {
        Self::new_with_update_events(edges, flaps).map(|(tree, _, _)| tree)
    }

    pub fn new_with_update_events(
        edges: &[Edge],
        flaps: &[Flap],
    ) -> BpResult<(Self, Vec<NodeId>, Vec<Edit>)> {
        let max_id = edges
            .iter()
            .flat_map(|edge| [edge.n1, edge.n2])
            .chain(flaps.iter().map(|flap| flap.id))
            .max()
            .unwrap_or(0);
        let mut tree = Self {
            nodes: vec![None; max_id as usize + 1],
            root: 0,
            pending_remove: Vec::new(),
        };

        let mut remaining = edges.to_vec();
        let mut added_nodes = Vec::new();
        let mut edits = Vec::new();
        while !remaining.is_empty() {
            let mut next = Vec::new();
            let mut new_edge_added = false;
            for edge in remaining {
                if tree.set_edge_with_events(
                    edge.n1,
                    edge.n2,
                    edge.length,
                    Some((&mut added_nodes, &mut edits)),
                )? {
                    new_edge_added = true;
                } else {
                    next.push(edge);
                }
            }
            if !new_edge_added {
                break;
            }
            remaining = next;
        }

        tree.set_flaps_raw(flaps);
        tree.recompute()?;
        Ok((tree, added_nodes, edits))
    }

    pub fn root_id(&self) -> NodeId {
        self.root
    }

    pub fn nodes(&self) -> &[Option<TreeNode>] {
        &self.nodes
    }

    pub fn node_ids(&self) -> Vec<NodeId> {
        self.nodes.iter().flatten().map(|node| node.id).collect()
    }

    pub fn node(&self, id: NodeId) -> Option<&TreeNode> {
        self.nodes.get(id as usize)?.as_ref()
    }

    pub fn node_mut(&mut self, id: NodeId) -> Option<&mut TreeNode> {
        self.nodes.get_mut(id as usize)?.as_mut()
    }

    pub fn to_json(&self) -> TreeData {
        let mut result = TreeData {
            edges: Vec::new(),
            nodes: Vec::new(),
        };
        let mut queue = vec![self.root];
        let mut cursor = 0;
        while cursor < queue.len() {
            let id = queue[cursor];
            cursor += 1;
            let Some(node) = self.node(id) else {
                continue;
            };
            for child_id in &node.children {
                let Some(child) = self.node(*child_id) else {
                    continue;
                };
                result.edges.push(Edge {
                    n1: id,
                    n2: child.id,
                    length: child.length,
                });
                result.nodes.push(child.data());
                if !child.is_leaf() {
                    queue.push(child.id);
                }
            }
        }
        result
    }

    pub fn add_edge(&mut self, n1: NodeId, n2: NodeId, length: f64) -> BpResult<TreeNode> {
        let result = self.add_edge_raw(n1, n2, length)?;
        self.recompute()?;
        Ok(result)
    }

    pub fn remove_edge(&mut self, n1: NodeId, n2: NodeId) -> BpResult<()> {
        self.remove_edge_raw(n1, n2)?;
        self.flush_remove()
    }

    pub fn remove_leaf(&mut self, id: NodeId) -> BpResult<bool> {
        let Some(node) = self.node(id) else {
            return Ok(false);
        };
        if !node.is_leaf_like() {
            return Ok(false);
        }

        if let Some(parent) = node.parent {
            self.remove_edge_raw(id, parent)?;
        } else {
            let Some(child) = node.children.first().copied() else {
                return Ok(false);
            };
            self.remove_edge_raw(id, child)?;
            self.root = child;
        }
        self.recompute()?;
        Ok(true)
    }

    pub fn set_flaps(&mut self, flaps: &[Flap]) -> BpResult<()> {
        self.set_flaps_raw(flaps);
        self.recompute()
    }

    fn set_flaps_raw(&mut self, flaps: &[Flap]) {
        for flap in flaps {
            if let Some(node) = self.node_mut(flap.id)
                && node.is_leaf_like()
            {
                node.aabb
                    .update(flap.y + flap.height, flap.x + flap.width, flap.y, flap.x);
            }
        }
    }

    pub fn set_aabb(
        &mut self,
        id: NodeId,
        top: f64,
        right: f64,
        bottom: f64,
        left: f64,
    ) -> BpResult<()> {
        let Some(node) = self.node_mut(id) else {
            return Err(BpError::InvalidInput(format!("missing tree node {id}")));
        };
        node.aabb.update(top, right, bottom, left);
        self.recompute()
    }

    pub fn join(&mut self, id: NodeId) -> BpResult<()> {
        let Some(node) = self.node(id).cloned() else {
            return Err(BpError::InvalidInput(format!("missing tree node {id}")));
        };
        let Some(child) = node.children.first().copied() else {
            return Err(BpError::InvalidInput(format!(
                "tree node {id} has no child to join"
            )));
        };

        if let Some(parent) = node.parent {
            let child_length = self.node(child).map(|n| n.length).unwrap_or_default();
            let length = child_length + node.length;
            self.remove_edge_raw(child, id)?;
            self.remove_edge_raw(id, parent)?;
            self.add_edge_raw(child, parent, length)?;
        } else {
            let Some(second) = self.second_child(id) else {
                return Err(BpError::InvalidInput(format!(
                    "root node {id} has no second child to join"
                )));
            };
            let child_length = self.node(child).map(|n| n.length).unwrap_or_default();
            let second_length = self.node(second).map(|n| n.length).unwrap_or_default();
            let length = child_length + second_length;
            self.remove_edge_raw(second, id)?;
            self.root = child;
            self.add_edge_raw(second, child, length)?;
        }
        self.flush_remove_raw();
        self.recompute()
    }

    pub fn split(&mut self, new_id: NodeId, at_id: NodeId) -> BpResult<()> {
        let Some(node) = self.node(at_id).cloned() else {
            return Err(BpError::InvalidInput(format!("missing tree node {at_id}")));
        };
        let Some(parent) = node.parent else {
            return Err(BpError::InvalidInput(format!(
                "cannot split root node {at_id}"
            )));
        };
        let length = node.length;
        self.remove_edge_raw(at_id, parent)?;
        self.add_edge_raw(parent, new_id, (length / 2.0).ceil())?;
        self.add_edge_raw(new_id, at_id, (length / 2.0).floor().max(1.0))?;
        self.flush_remove_raw();
        self.recompute()
    }

    pub fn merge(&mut self, id: NodeId) -> BpResult<()> {
        let Some(node) = self.node(id).cloned() else {
            return Err(BpError::InvalidInput(format!("missing tree node {id}")));
        };
        let Some(parent) = node.parent else {
            return Err(BpError::InvalidInput(format!(
                "cannot merge root node {id}"
            )));
        };
        let children = node.children.clone();
        for child in children {
            let length = self.node(child).map(|n| n.length).unwrap_or_default();
            self.remove_edge_raw(id, child)?;
            self.add_edge_raw(child, parent, length)?;
        }
        self.remove_edge_raw(id, parent)?;
        self.flush_remove_raw();
        self.recompute()
    }

    pub fn set_length(&mut self, id: NodeId, length: f64) -> BpResult<()> {
        let Some(node) = self.node_mut(id) else {
            return Err(BpError::InvalidInput(format!("missing tree node {id}")));
        };
        node.length = length;
        node.aabb.set_margin(length);
        self.recompute()
    }

    pub fn edit(&mut self, edits: &[Edit], root_id: NodeId, flaps: &[Flap]) -> BpResult<()> {
        for edit in edits {
            if edit.0 {
                self.add_edge_raw(edit.1.n1, edit.1.n2, edit.1.length)?;
            } else {
                self.remove_edge_raw(edit.1.n1, edit.1.n2)?;
            }
        }
        self.flush_remove_raw();
        self.set_flaps_raw(flaps);
        self.recompute_with_expected_root(Some(root_id))
    }

    pub fn child_id_for_edge(&self, edge: &Edge) -> BpResult<NodeId> {
        let n1 = self
            .node(edge.n1)
            .ok_or_else(|| BpError::InvalidInput(format!("missing tree node {}", edge.n1)))?;
        self.node(edge.n2)
            .ok_or_else(|| BpError::InvalidInput(format!("missing tree node {}", edge.n2)))?;
        if n1.parent == Some(edge.n2) {
            Ok(edge.n1)
        } else {
            Ok(edge.n2)
        }
    }

    pub fn children_by_priority(&self, id: NodeId) -> Vec<NodeId> {
        self.children_by_heap_priority(id)
    }

    pub fn flush_remove(&mut self) -> BpResult<()> {
        self.flush_remove_raw();
        self.recompute()
    }

    fn flush_remove_raw(&mut self) {
        if self.pending_remove.contains(&self.root)
            && self
                .node(self.root)
                .is_some_and(|node| node.children.is_empty())
            && let Some(new_root) = self
                .nodes
                .iter()
                .flatten()
                .find(|node| node.parent.is_none() && !node.children.is_empty())
                .map(|node| node.id)
        {
            self.root = new_root;
        }

        let pending = self.pending_remove.drain(..).collect::<Vec<_>>();
        for id in pending {
            let should_remove = self
                .node(id)
                .is_some_and(|node| node.parent.is_none() && node.id != self.root);
            if should_remove && let Some(slot) = self.nodes.get_mut(id as usize) {
                *slot = None;
            }
        }
    }

    pub fn dist(&self, n1: NodeId, n2: NodeId) -> BpResult<f64> {
        let lca = self.lca(n1, n2)?;
        let a = self
            .node(n1)
            .ok_or_else(|| BpError::InvalidInput(format!("missing tree node {n1}")))?;
        let b = self
            .node(n2)
            .ok_or_else(|| BpError::InvalidInput(format!("missing tree node {n2}")))?;
        let lca = self
            .node(lca)
            .ok_or_else(|| BpError::InvalidInput("missing lca node".to_string()))?;
        Ok(a.dist + b.dist - 2.0 * lca.dist)
    }

    pub fn dist_map(&self) -> Vec<(NodeId, NodeId, f64)> {
        let leaves = self
            .nodes
            .iter()
            .flatten()
            .filter(|node| node.is_leaf())
            .map(|node| node.id)
            .collect::<Vec<_>>();
        let mut result = Vec::new();
        for i in 0..leaves.len() {
            for j in i + 1..leaves.len() {
                if let Ok(distance) = self.dist(leaves[i], leaves[j]) {
                    result.push((leaves[i], leaves[j], distance));
                }
            }
        }
        result
    }

    pub fn recompute(&mut self) -> BpResult<()> {
        self.recompute_with_expected_root(None)
    }

    pub fn recompute_with_expected_root(&mut self, expected_root: Option<NodeId>) -> BpResult<()> {
        loop {
            self.update_dist_recursive(self.root, 0.0)?;
            self.update_heights(self.root)?;
            let Some(new_root) = self.try_balance(expected_root)? else {
                break;
            };
            self.root = new_root;
        }
        self.update_dist_recursive(self.root, 0.0)?;
        self.update_heights(self.root)?;
        self.update_leaves(self.root)?;
        self.update_aabb(self.root)?;
        Ok(())
    }

    fn ensure_node(&mut self, id: NodeId) {
        let index = id as usize;
        if index >= self.nodes.len() {
            self.nodes.resize_with(index + 1, || None);
        }
        if self.nodes[index].is_none() {
            self.nodes[index] = Some(TreeNode::new(id));
        }
    }

    fn ensure_node_with_event(&mut self, id: NodeId, added_nodes: &mut Vec<NodeId>) {
        let existed = self.node(id).is_some();
        self.ensure_node(id);
        if !existed && !added_nodes.contains(&id) {
            added_nodes.push(id);
        }
    }

    fn add_edge_raw(&mut self, n1: NodeId, n2: NodeId, length: f64) -> BpResult<TreeNode> {
        self.ensure_node(n1);
        self.ensure_node(n2);
        let n1_parent = self.node(n1).and_then(|node| node.parent);
        if n1_parent.is_none() && n1 != self.root {
            self.paste_to(n1, n2)?;
            self.set_length_raw(n1, length)?;
        } else {
            self.paste_to(n2, n1)?;
            self.set_length_raw(n2, length)?;
        }
        self.node(n1)
            .cloned()
            .ok_or_else(|| BpError::InvalidInput(format!("missing tree node {n1}")))
    }

    fn remove_edge_raw(&mut self, n1: NodeId, n2: NodeId) -> BpResult<()> {
        let child = if self.node(n1).and_then(|node| node.parent) == Some(n2) {
            n1
        } else {
            n2
        };
        self.cut(child)?;
        if !self.pending_remove.contains(&n1) {
            self.pending_remove.push(n1);
        }
        if !self.pending_remove.contains(&n2) {
            self.pending_remove.push(n2);
        }
        Ok(())
    }

    fn set_edge_with_events(
        &mut self,
        n1: NodeId,
        n2: NodeId,
        length: f64,
        mut events: Option<(&mut Vec<NodeId>, &mut Vec<Edit>)>,
    ) -> BpResult<bool> {
        self.ensure_capacity(n1.max(n2));
        let n1_exists = self.node(n1).is_some();
        let n2_exists = self.node(n2).is_some();

        if self.root_exists() && !n1_exists && !n2_exists {
            return Ok(false);
        }

        if n1_exists && n2_exists {
            if self.node(n1).and_then(|node| node.parent) == Some(n2) {
                self.set_length_raw(n1, length)?;
            } else if self.node(n2).and_then(|node| node.parent) == Some(n1) {
                self.set_length_raw(n2, length)?;
            }
            return Ok(false);
        }

        if n2_exists {
            if let Some((added_nodes, _)) = events.as_mut() {
                self.ensure_node_with_event(n1, added_nodes);
            } else {
                self.ensure_node(n1);
            }
            self.paste_to(n1, n2)?;
            self.set_length_raw(n1, length)?;
        } else {
            if !n1_exists {
                if let Some((added_nodes, _)) = events.as_mut() {
                    self.ensure_node_with_event(n1, added_nodes);
                } else {
                    self.ensure_node(n1);
                }
                self.root = n1;
            }
            if let Some((added_nodes, _)) = events.as_mut() {
                self.ensure_node_with_event(n2, added_nodes);
            } else {
                self.ensure_node(n2);
            }
            self.paste_to(n2, n1)?;
            self.set_length_raw(n2, length)?;
        }
        if let Some((_, edits)) = events {
            edits.push((true, Edge { n1, n2, length }));
        }
        Ok(true)
    }

    fn ensure_capacity(&mut self, id: NodeId) {
        let index = id as usize;
        if index >= self.nodes.len() {
            self.nodes.resize_with(index + 1, || None);
        }
    }

    fn root_exists(&self) -> bool {
        self.node(self.root).is_some()
    }

    fn paste_to(&mut self, id: NodeId, parent: NodeId) -> BpResult<()> {
        if self.node(id).is_none() || self.node(parent).is_none() {
            return Err(BpError::InvalidInput(format!(
                "cannot connect missing tree nodes {id} and {parent}"
            )));
        }
        if let Some(old_parent) = self.node(id).and_then(|node| node.parent) {
            self.remove_child(old_parent, id);
        }
        if let Some(node) = self.node_mut(id) {
            node.parent = Some(parent);
        }
        if let Some(parent_node) = self.node_mut(parent)
            && !parent_node.children.contains(&id)
        {
            parent_node.children.push(id);
        }
        Ok(())
    }

    fn cut(&mut self, id: NodeId) -> BpResult<()> {
        let Some(parent) = self.node(id).and_then(|node| node.parent) else {
            return Ok(());
        };
        self.remove_child(parent, id);
        if let Some(node) = self.node_mut(id) {
            node.parent = None;
        }
        Ok(())
    }

    fn remove_child(&mut self, parent: NodeId, child: NodeId) {
        if let Some(parent) = self.node_mut(parent) {
            parent.children.retain(|candidate| *candidate != child);
        }
    }

    fn set_length_raw(&mut self, id: NodeId, length: f64) -> BpResult<()> {
        let Some(node) = self.node_mut(id) else {
            return Err(BpError::InvalidInput(format!("missing tree node {id}")));
        };
        node.length = length;
        node.aabb.set_margin(length);
        Ok(())
    }

    fn try_balance(&mut self, expected_root: Option<NodeId>) -> BpResult<Option<NodeId>> {
        let root = self.root;
        let Some(first) = self.first_child(root) else {
            return Ok(None);
        };
        let second_height = self
            .second_child(root)
            .and_then(|id| self.node(id).map(|node| node.height + 1))
            .unwrap_or(0);
        let first_height = self.node(first).map(|node| node.height).unwrap_or(-1);
        if first_height <= second_height && Some(first) != expected_root {
            return Ok(None);
        }

        let first_length = self.node(first).map(|node| node.length).unwrap_or_default();
        if let Some(root_node) = self.node_mut(root) {
            root_node.height = second_height;
        }
        self.cut(first)?;
        self.set_length_raw(root, first_length)?;
        self.paste_to(root, first)?;
        self.set_length_raw(first, 0.0)?;
        Ok(Some(first))
    }

    fn first_child(&self, id: NodeId) -> Option<NodeId> {
        self.children_by_heap_priority(id).first().copied()
    }

    fn second_child(&self, id: NodeId) -> Option<NodeId> {
        self.children_by_heap_priority(id).get(1).copied()
    }

    fn children_by_heap_priority(&self, id: NodeId) -> Vec<NodeId> {
        let Some(node) = self.node(id) else {
            return Vec::new();
        };
        let mut children = node.children.clone();
        children.sort_by(|a, b| {
            let ah = self.node(*a).map(|node| node.height).unwrap_or(-1);
            let bh = self.node(*b).map(|node| node.height).unwrap_or(-1);
            bh.partial_cmp(&ah).unwrap_or(std::cmp::Ordering::Equal)
        });
        children
    }

    fn update_dist_recursive(&mut self, id: NodeId, value: f64) -> BpResult<()> {
        let Some(node) = self.node_mut(id) else {
            return Err(BpError::InvalidInput(format!("missing tree node {id}")));
        };
        node.dist = value;
        if value > MAX_TREE_HEIGHT as f64 {
            return Err(BpError::InvalidInput("tree overflow".to_string()));
        }
        let children = node.children.clone();
        for child in children {
            let length = self.node(child).map(|node| node.length).unwrap_or_default();
            self.update_dist_recursive(child, value + length)?;
        }
        Ok(())
    }

    fn update_heights(&mut self, id: NodeId) -> BpResult<i32> {
        let children = self
            .node(id)
            .ok_or_else(|| BpError::InvalidInput(format!("missing tree node {id}")))?
            .children
            .clone();
        let mut max_child = -1;
        for child in children {
            max_child = max_child.max(self.update_heights(child)?);
        }
        let height = 1 + max_child;
        if let Some(node) = self.node_mut(id) {
            node.height = height;
        }
        Ok(height)
    }

    fn update_leaves(&mut self, id: NodeId) -> BpResult<Vec<NodeId>> {
        let children = self
            .node(id)
            .ok_or_else(|| BpError::InvalidInput(format!("missing tree node {id}")))?
            .children
            .clone();
        let leaves = if children.is_empty() {
            vec![id]
        } else {
            let mut leaves = Vec::new();
            for child in children {
                leaves.extend(self.update_leaves(child)?);
            }
            leaves
        };
        if let Some(node) = self.node_mut(id) {
            node.leaves = leaves.clone();
        }
        Ok(leaves)
    }

    fn update_aabb(&mut self, id: NodeId) -> BpResult<[f64; 4]> {
        let children = self
            .node(id)
            .ok_or_else(|| BpError::InvalidInput(format!("missing tree node {id}")))?
            .children
            .clone();
        if children.is_empty() {
            return self
                .node(id)
                .map(|node| node.aabb.to_values())
                .ok_or_else(|| BpError::InvalidInput(format!("missing tree node {id}")));
        }

        let mut top = f64::NEG_INFINITY;
        let mut right = f64::NEG_INFINITY;
        let mut bottom = f64::INFINITY;
        let mut left = f64::INFINITY;
        for child in children {
            self.update_aabb(child)?;
            let Some(child_node) = self.node(child) else {
                continue;
            };
            let [child_top, child_right, child_bottom, child_left] = child_node.aabb.to_array();
            top = top.max(child_top);
            right = right.max(child_right);
            bottom = bottom.min(child_bottom);
            left = left.min(child_left);
        }
        let values = [top, right, bottom, left];
        if let Some(node) = self.node_mut(id) {
            node.aabb.update(top, right, bottom, left);
        }
        Ok(values)
    }

    fn lca(&self, n1: NodeId, n2: NodeId) -> BpResult<NodeId> {
        let mut n1 = n1;
        let mut n2 = n2;
        while n1 != n2 {
            let d1 = self
                .node(n1)
                .ok_or_else(|| BpError::InvalidInput(format!("missing tree node {n1}")))?
                .dist;
            let d2 = self
                .node(n2)
                .ok_or_else(|| BpError::InvalidInput(format!("missing tree node {n2}")))?
                .dist;
            if d1 >= d2 {
                n1 = self
                    .node(n1)
                    .and_then(|node| node.parent)
                    .ok_or_else(|| BpError::InvalidInput("missing lca parent".to_string()))?;
            }
            let d1 = self
                .node(n1)
                .ok_or_else(|| BpError::InvalidInput(format!("missing tree node {n1}")))?
                .dist;
            let d2 = self
                .node(n2)
                .ok_or_else(|| BpError::InvalidInput(format!("missing tree node {n2}")))?
                .dist;
            if d2 > d1 {
                n2 = self
                    .node(n2)
                    .and_then(|node| node.parent)
                    .ok_or_else(|| BpError::InvalidInput("missing lca parent".to_string()))?;
            }
        }
        Ok(n1)
    }
}

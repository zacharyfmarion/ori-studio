use crate::engine::{EngineState, UpdateModel, UpdateResult, UpdateTreeData};
use crate::error::{BpError, BpResult};
use crate::model::{Design, Edge, Flap, NodeId, Stretch};
use crate::tree::{AreaTree, BpTree, Hierarchy};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DesignUpdateRequest {
    pub flaps: Vec<Flap>,
    pub edges: Vec<Edge>,
    pub stretches: Vec<Stretch>,
    pub dragging: bool,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct BpSession {
    state: EngineState,
    update_result: UpdateResult,
}

impl BpSession {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_design(design: &Design) -> BpResult<(Self, UpdateModel)> {
        let mut session = Self::new();
        let update = session.init_design(design)?;
        Ok((session, update))
    }

    pub fn state(&self) -> &EngineState {
        &self.state
    }

    pub fn init_design(&mut self, design: &Design) -> BpResult<UpdateModel> {
        let (tree, added_nodes, edits) =
            BpTree::new_with_update_events(&design.tree.edges, &design.layout.flaps)?;
        self.state = EngineState::default();
        self.update_result.flush();
        self.state.tree = Some(tree);
        self.state.tree_structure_changed = true;
        self.state.root_changed = true;
        self.set_stretch_prototypes(&design.layout.stretches);
        for id in added_nodes {
            self.update_result.add_node(id);
        }
        for edit in edits {
            self.update_result.edit(edit);
        }
        self.export_tree_if_needed()?;
        self.state.reset();
        Ok(self.update_result.flush())
    }

    pub fn update_design(&mut self, request: DesignUpdateRequest) -> BpResult<UpdateModel> {
        let before = self.node_id_set()?;
        self.state.is_dragging = request.dragging;
        let should_export_tree = !request.edges.is_empty();
        {
            let tree = self.tree_mut()?;
            tree.set_flaps(&request.flaps)?;
            for edge in &request.edges {
                let child = tree.child_id_for_edge(edge)?;
                tree.set_length(child, edge.length)?;
            }
        }
        self.set_stretch_prototypes(&request.stretches);
        self.finish_tree_round(before, should_export_tree)
    }

    pub fn edit_tree(
        &mut self,
        edits: Vec<(bool, Edge)>,
        root_id: NodeId,
        flaps: Vec<Flap>,
        stretches: Vec<Stretch>,
    ) -> BpResult<UpdateModel> {
        let before = self.node_id_set()?;
        self.tree_mut()?.edit(&edits, root_id, &flaps)?;
        for edit in edits {
            self.update_result.edit(edit);
        }
        self.set_stretch_prototypes(&stretches);
        self.finish_tree_round(before, true)
    }

    pub fn add_leaf(
        &mut self,
        id: NodeId,
        at: NodeId,
        length: f64,
        flap: Flap,
    ) -> BpResult<UpdateModel> {
        let before = self.node_id_set()?;
        self.tree_mut()?.add_edge(id, at, length)?;
        self.tree_mut()?.set_aabb(
            id,
            flap.y + flap.height,
            flap.x + flap.width,
            flap.y,
            flap.x,
        )?;
        self.update_result.edit((
            true,
            Edge {
                n1: id,
                n2: at,
                length,
            },
        ));
        self.finish_tree_round(before, true)
    }

    pub fn remove_leaf(
        &mut self,
        ids: Vec<NodeId>,
        prototypes: Vec<Flap>,
    ) -> BpResult<UpdateModel> {
        let before = self.node_id_set()?;
        for id in ids {
            if let Some(edit) = self.remove_leaf_edit(id)?
                && self.tree_mut()?.remove_leaf(id)?
            {
                self.update_result.edit(edit);
            }
        }
        self.tree_mut()?.flush_remove()?;
        self.tree_mut()?.set_flaps(&prototypes)?;
        self.finish_tree_round(before, true)
    }

    pub fn join(&mut self, id: NodeId) -> BpResult<UpdateModel> {
        let before = self.node_id_set()?;
        let edits = self.join_edits(id)?;
        self.tree_mut()?.join(id)?;
        for edit in edits {
            self.update_result.edit(edit);
        }
        self.finish_tree_round(before, true)
    }

    pub fn split(&mut self, edge: Edge, id: NodeId) -> BpResult<UpdateModel> {
        let before = self.node_id_set()?;
        let edits = self.split_edits(&edge, id)?;
        let child = self.tree()?.child_id_for_edge(&edge)?;
        self.tree_mut()?.split(id, child)?;
        for edit in edits {
            self.update_result.edit(edit);
        }
        self.finish_tree_round(before, true)
    }

    pub fn merge(&mut self, edge: Edge) -> BpResult<UpdateModel> {
        let before = self.node_id_set()?;
        let edits = self.merge_edits(&edge)?;
        let child = self.tree()?.child_id_for_edge(&edge)?;
        self.tree_mut()?.merge(child)?;
        for edit in edits {
            self.update_result.edit(edit);
        }
        self.finish_tree_round(before, true)
    }

    pub fn get_hierarchy(&self, random: bool, use_dimension: bool) -> BpResult<Vec<Hierarchy>> {
        let tree = self.tree()?;
        if !random {
            return Ok(vec![Hierarchy {
                leaves: tree
                    .nodes()
                    .iter()
                    .flatten()
                    .filter(|node| node.is_leaf())
                    .map(|node| node.id)
                    .collect(),
                dist_map: tree.dist_map(),
                parents: Vec::new(),
            }]);
        }
        AreaTree::new(tree, use_dimension)?.create_hierarchy()
    }

    fn set_stretch_prototypes(&mut self, stretches: &[Stretch]) {
        for stretch in stretches {
            self.state
                .stretch_prototypes
                .insert(stretch.id.clone(), stretch.clone());
        }
    }

    fn finish_tree_round(
        &mut self,
        before: BTreeSet<NodeId>,
        export_tree: bool,
    ) -> BpResult<UpdateModel> {
        self.record_node_delta(before)?;
        if export_tree {
            self.state.tree_structure_changed = true;
        }
        self.export_tree_if_needed()?;
        self.state.reset();
        Ok(self.update_result.flush())
    }

    fn record_node_delta(&mut self, before: BTreeSet<NodeId>) -> BpResult<()> {
        let after = self.node_id_set()?;
        for id in after.difference(&before) {
            self.update_result.add_node(*id);
        }
        for id in before.difference(&after) {
            self.update_result.remove_node(*id);
        }
        Ok(())
    }

    fn export_tree_if_needed(&mut self) -> BpResult<()> {
        if self.state.tree_structure_changed {
            let tree = UpdateTreeData::from_tree(self.tree()?);
            self.update_result.export_tree_data(tree);
        }
        Ok(())
    }

    fn node_id_set(&self) -> BpResult<BTreeSet<NodeId>> {
        Ok(self.tree()?.node_ids().into_iter().collect())
    }

    fn tree(&self) -> BpResult<&BpTree> {
        self.state
            .tree
            .as_ref()
            .ok_or_else(|| BpError::InvalidInput("BP session has no initialized tree".to_string()))
    }

    fn tree_mut(&mut self) -> BpResult<&mut BpTree> {
        self.state
            .tree
            .as_mut()
            .ok_or_else(|| BpError::InvalidInput("BP session has no initialized tree".to_string()))
    }

    fn remove_leaf_edit(&self, id: NodeId) -> BpResult<Option<(bool, Edge)>> {
        let tree = self.tree()?;
        let Some(node) = tree.node(id) else {
            return Ok(None);
        };
        if !node.is_leaf_like() {
            return Ok(None);
        }
        let edge = if let Some(parent) = node.parent {
            Edge {
                n1: id,
                n2: parent,
                length: node.length,
            }
        } else {
            let Some(child) = tree.children_by_priority(id).first().copied() else {
                return Ok(None);
            };
            let length = tree.node(child).map(|node| node.length).unwrap_or_default();
            Edge {
                n1: id,
                n2: child,
                length,
            }
        };
        Ok(Some((false, edge)))
    }

    fn join_edits(&self, id: NodeId) -> BpResult<Vec<(bool, Edge)>> {
        let tree = self.tree()?;
        let node = tree
            .node(id)
            .ok_or_else(|| BpError::InvalidInput(format!("missing tree node {id}")))?;
        let children = tree.children_by_priority(id);
        let child = children
            .first()
            .copied()
            .ok_or_else(|| BpError::InvalidInput(format!("tree node {id} has no child to join")))?;
        let child_length = tree.node(child).map(|node| node.length).unwrap_or_default();
        let mut result = vec![(
            false,
            Edge {
                n1: child,
                n2: id,
                length: child_length,
            },
        )];
        if let Some(parent) = node.parent {
            result.push((
                false,
                Edge {
                    n1: id,
                    n2: parent,
                    length: node.length,
                },
            ));
            result.push((
                true,
                Edge {
                    n1: child,
                    n2: parent,
                    length: child_length + node.length,
                },
            ));
        } else {
            let second = children.get(1).copied().ok_or_else(|| {
                BpError::InvalidInput(format!("root node {id} has no second child to join"))
            })?;
            let second_length = tree
                .node(second)
                .map(|node| node.length)
                .unwrap_or_default();
            result.push((
                false,
                Edge {
                    n1: second,
                    n2: id,
                    length: second_length,
                },
            ));
            result.push((
                true,
                Edge {
                    n1: second,
                    n2: child,
                    length: child_length + second_length,
                },
            ));
        }
        Ok(result)
    }

    fn split_edits(&self, edge: &Edge, id: NodeId) -> BpResult<Vec<(bool, Edge)>> {
        let tree = self.tree()?;
        let child = tree.child_id_for_edge(edge)?;
        let node = tree
            .node(child)
            .ok_or_else(|| BpError::InvalidInput(format!("missing tree node {child}")))?;
        let parent = node
            .parent
            .ok_or_else(|| BpError::InvalidInput(format!("cannot split root node {child}")))?;
        let length = node.length;
        Ok(vec![
            (
                false,
                Edge {
                    n1: child,
                    n2: parent,
                    length,
                },
            ),
            (
                true,
                Edge {
                    n1: parent,
                    n2: id,
                    length: (length / 2.0).ceil(),
                },
            ),
            (
                true,
                Edge {
                    n1: id,
                    n2: child,
                    length: (length / 2.0).floor().max(1.0),
                },
            ),
        ])
    }

    fn merge_edits(&self, edge: &Edge) -> BpResult<Vec<(bool, Edge)>> {
        let tree = self.tree()?;
        let id = tree.child_id_for_edge(edge)?;
        let node = tree
            .node(id)
            .ok_or_else(|| BpError::InvalidInput(format!("missing tree node {id}")))?;
        let parent = node
            .parent
            .ok_or_else(|| BpError::InvalidInput(format!("cannot merge root node {id}")))?;
        let mut result = Vec::new();
        for child in &node.children {
            let length = tree
                .node(*child)
                .map(|node| node.length)
                .unwrap_or_default();
            result.push((
                false,
                Edge {
                    n1: id,
                    n2: *child,
                    length,
                },
            ));
            result.push((
                true,
                Edge {
                    n1: *child,
                    n2: parent,
                    length,
                },
            ));
        }
        result.push((
            false,
            Edge {
                n1: id,
                n2: parent,
                length: node.length,
            },
        ));
        Ok(result)
    }
}

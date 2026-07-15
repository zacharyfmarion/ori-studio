use crate::data::{DiffDoubleSet, DiffSet, IntDoubleMap};
use crate::engine::{OrderedRecord, UpdateResult};
use crate::model::{NodeId, Stretch};
use crate::tree::BpTree;

#[derive(Debug, Clone, PartialEq, Default)]
pub struct EngineState {
    pub tree: Option<BpTree>,
    pub is_dragging: bool,
    pub root_changed: bool,
    pub tree_structure_changed: bool,
    pub junctions: IntDoubleMap<serde_json::Value>,
    pub stretches: OrderedRecord<Stretch>,
    pub invalid_junction_diff: DiffDoubleSet,
    pub stretch_diff: DiffSet<String>,
    pub stretch_cache: OrderedRecord<Stretch>,
    pub children_changed: Vec<NodeId>,
    pub parent_changed: Vec<NodeId>,
    pub length_changed: Vec<NodeId>,
    pub subtree_aabb_changed: Vec<NodeId>,
    pub node_aabb_changed: Vec<NodeId>,
    pub flap_changed: Vec<NodeId>,
    pub new_repositories: Vec<String>,
    pub repo_to_process: Vec<String>,
    pub repo_to_partially_process: OrderedRecord<Vec<NodeId>>,
    pub repo_with_node_set_changed: Vec<String>,
    pub stretch_prototypes: OrderedRecord<Stretch>,
    pub rough_contour_changed: Vec<NodeId>,
    pub contour_will_change: Vec<NodeId>,
    pub patterned_quadrants: Vec<u8>,
    pub moved_devices: Vec<String>,
}

impl EngineState {
    pub fn reset(&mut self) {
        self.children_changed.clear();
        self.parent_changed.clear();
        self.length_changed.clear();
        self.subtree_aabb_changed.clear();
        self.node_aabb_changed.clear();
        self.flap_changed.clear();
        self.new_repositories.clear();
        self.repo_to_process.clear();
        self.repo_to_partially_process.clear();
        self.repo_with_node_set_changed.clear();
        self.stretch_prototypes.clear();
        self.rough_contour_changed.clear();
        self.contour_will_change.clear();
        self.patterned_quadrants.clear();
        self.moved_devices.clear();
        self.tree_structure_changed = false;
        self.root_changed = false;
    }

    pub fn full_reset(&mut self, update_result: &mut UpdateResult) {
        self.reset();
        update_result.flush();
        self.junctions.clear();
        self.stretches.clear();
        self.invalid_junction_diff.clear();
        self.stretch_diff.clear();
        self.stretch_cache.clear();
    }

    pub fn mark_children_changed(&mut self, id: NodeId) {
        insert_unique(&mut self.children_changed, id);
    }

    pub fn mark_parent_changed(&mut self, id: NodeId) {
        insert_unique(&mut self.parent_changed, id);
    }

    pub fn mark_length_changed(&mut self, id: NodeId) {
        insert_unique(&mut self.length_changed, id);
    }
}

fn insert_unique<T>(values: &mut Vec<T>, value: T)
where
    T: Copy + Eq,
{
    if !values.contains(&value) {
        values.push(value);
    }
}

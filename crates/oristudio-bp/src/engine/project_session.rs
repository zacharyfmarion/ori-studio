use crate::engine::{
    BpSession, HistoryCommand, HistoryManager, OperationResult, Step, UpdateModel, UpdateTreeData,
};
use crate::error::{BpError, BpResult};
use crate::grid::{
    BpGrid, DiagonalGrid, RectangularGrid, TransformationMatrix, constrain_flap, flip_sheet,
    get_dots, rotate_sheet, subdivide_sheet,
};
use crate::layout::{LayoutRepository, active_layout_repositories};
use crate::model::{
    Edge, Flap, GridType, Memento, NodeId, Point, Project, Repository, Sheet, Stretch, Vertex,
};
use crate::shared::{MAX_TREE_HEIGHT, MAX_VERTICES};
use crate::tree::BpTree;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

const MIN_VERTICES: usize = 3;
const X_DISPLACEMENT: f64 = 0.125;
const Y_DISPLACEMENT: f64 = 0.0625;

#[derive(Debug, Clone, PartialEq)]
pub struct BpProjectSession {
    project: Project,
    history: HistoryManager,
    new_vertices: BTreeSet<NodeId>,
}

impl BpProjectSession {
    pub fn new(mut project: Project) -> BpResult<Self> {
        let new_vertices = project
            .design
            .tree
            .nodes
            .iter_mut()
            .filter_map(|vertex| {
                if vertex.is_new.unwrap_or(false) {
                    vertex.is_new = None;
                    Some(vertex.id)
                } else {
                    None
                }
            })
            .collect();
        // BP Studio invariant: every leaf node has a flap. A design may arrive
        // with tree leaves that have no `layout.flaps` entry (e.g. the starter,
        // or a tree-only import); BP Studio's Core seeds each such leaf a default
        // flap at the origin (width/height 0). Mirror that so those leaves render
        // and are draggable instead of being missing + stuck.
        Self::seed_missing_leaf_flaps(&mut project)?;
        let mut history = match &project.history {
            Some(history) => HistoryManager::from_history(history)?,
            None => HistoryManager::new(),
        };
        history.flush(project.design.mode, Vec::new());
        Ok(Self {
            project,
            history,
            new_vertices,
        })
    }

    pub fn project(&self) -> &Project {
        &self.project
    }

    pub fn replace_project(&mut self, project: Project) -> BpResult<()> {
        *self = Self::new(project)?;
        Ok(())
    }

    pub fn project_for_export(&self) -> Project {
        let mut project = self.project.clone();
        for vertex in &mut project.design.tree.nodes {
            vertex.is_new = None;
        }
        project.history = self.history.to_history().ok();
        project
    }

    pub fn history(&self) -> &HistoryManager {
        &self.history
    }

    pub fn notify_save(&mut self) {
        self.history.notify_save();
    }

    pub fn undo(&mut self) -> BpResult<Vec<String>> {
        if !self.history.can_undo() {
            return Ok(Vec::new());
        }
        let step = self
            .history
            .steps()
            .get(self.history.index().saturating_sub(1))
            .cloned()
            .ok_or_else(|| BpError::InvalidInput("missing BP undo history step".to_string()))?;
        let before = step.before().to_vec();
        let project_before = self.project.clone();
        match self.apply_history_step(&step, true) {
            Ok(()) => self.history.apply_undo_result(OperationResult::Success),
            Err(error) => {
                self.project = project_before;
                self.history.apply_undo_result(OperationResult::Failed);
                return Err(error);
            }
        }
        Ok(before)
    }

    pub fn redo(&mut self) -> BpResult<Vec<String>> {
        if !self.history.can_redo() {
            return Ok(Vec::new());
        }
        let step = self
            .history
            .steps()
            .get(self.history.index())
            .cloned()
            .ok_or_else(|| BpError::InvalidInput("missing BP redo history step".to_string()))?;
        let after = step.after().to_vec();
        let project_before = self.project.clone();
        match self.apply_history_step(&step, false) {
            Ok(()) => self.history.apply_redo_result(OperationResult::Success),
            Err(error) => {
                self.project = project_before;
                self.history.apply_redo_result(OperationResult::Failed);
                return Err(error);
            }
        }
        Ok(after)
    }

    pub fn tree_data(&self) -> BpResult<UpdateTreeData> {
        let (_session, update) = BpSession::from_design(&self.project.design)?;
        update.tree.ok_or_else(|| {
            BpError::InvalidInput("BP tree update did not include tree data".to_string())
        })
    }

    pub fn move_vertex(
        &mut self,
        id: NodeId,
        target: Point,
        dragging: bool,
    ) -> BpResult<UpdateModel> {
        let grid = BpGrid::new(self.project.design.tree.sheet.clone());
        let next = grid.constrain(target);
        let old = {
            let vertex = self.vertex(id)?;
            Point {
                x: vertex.x,
                y: vertex.y,
            }
        };
        if old == next {
            return self.empty_tree_update();
        }

        {
            let vertex = self.vertex_mut(id)?;
            vertex.x = next.x;
            vertex.y = next.y;
        }

        if self.new_vertices.contains(&id)
            && let Some(relative) = self.relative_layout_point(next)
        {
            if let Some(flap) = self.flap_mut(id) {
                flap.x = relative.x;
                flap.y = relative.y;
            } else {
                self.new_vertices.remove(&id);
            }
        }

        self.history.set_dragging(dragging);
        self.history.move_command(
            format!("v{id}"),
            old,
            Point {
                x: next.x,
                y: next.y,
            },
        );
        self.history
            .flush(self.project.design.mode, vec![format!("v{id}")]);
        self.history.set_dragging(false);
        self.empty_tree_update()
    }

    pub fn rename_vertex(&mut self, id: NodeId, name: String) -> BpResult<UpdateModel> {
        let old = self.vertex(id)?.name.clone();
        if old == name {
            return self.empty_tree_update();
        }
        self.vertex_mut(id)?.name = name.clone();
        self.history.field_change_flush(
            format!("v{id}"),
            "name",
            json!(old),
            json!(name),
            self.project.design.mode,
            vec![format!("v{id}")],
        );
        self.empty_tree_update()
    }

    pub fn update_edge_length(
        &mut self,
        n1: NodeId,
        n2: NodeId,
        length: f64,
        dragging: bool,
    ) -> BpResult<UpdateModel> {
        if !length.is_finite() || length < 1.0 {
            return Err(BpError::InvalidInput(format!(
                "BP edge length must be at least 1: {length}"
            )));
        }
        let edge_index = self.edge_index(n1, n2)?;
        let edge = self.project.design.tree.edges[edge_index].clone();
        let max_length = self.edge_max_length(&edge)?;
        if length > max_length {
            return Err(BpError::InvalidInput(format!(
                "BP edge length {length} exceeds max {max_length}"
            )));
        }
        if edge.length == length {
            return self.empty_tree_update();
        }

        let mut session = self.core_session()?;
        let update = session.update_design(crate::engine::DesignUpdateRequest {
            flaps: Vec::new(),
            edges: vec![Edge {
                length,
                ..edge.clone()
            }],
            stretches: self.project.design.layout.stretches.clone(),
            dragging,
        })?;
        self.project.design.tree.edges[edge_index].length = length;
        self.apply_tree_update(&update);
        self.history.set_dragging(dragging);
        self.history.field_change_flush(
            edge_tag(edge.n1, edge.n2),
            "length",
            json!(edge.length),
            json!(length),
            self.project.design.mode,
            vec![edge_tag(edge.n1, edge.n2)],
        );
        self.history.set_dragging(false);
        Ok(update)
    }

    pub fn add_leaf(&mut self, at: NodeId, length: f64) -> BpResult<UpdateModel> {
        if !length.is_finite() || length < 1.0 {
            return Err(BpError::InvalidInput(format!(
                "new BP leaf length must be at least 1: {length}"
            )));
        }
        let max_length = self.vertex_max_new_leaf_length(at)?;
        if length > max_length {
            return Err(BpError::InvalidInput(format!(
                "new BP leaf length {length} exceeds max {max_length}"
            )));
        }
        let id = self.next_available_node_id()?;
        let at_vertex = self.vertex(at)?.clone();
        let loc = self.closest_empty_spot(Point {
            x: at_vertex.x,
            y: at_vertex.y,
        });
        let flap = self.create_flap_prototype(id, loc);
        let mut session = self.core_session()?;
        let old_root = root_id(&self.project.design.tree.edges);
        let update = session.add_leaf(id, at, length, flap.clone())?;

        self.project.design.tree.nodes.push(Vertex {
            id,
            x: loc.x,
            y: loc.y,
            name: String::new(),
            is_new: None,
        });
        // The parent `at` just gained a child, so it is no longer a leaf. Uphold
        // BP Studio's flap ⟺ leaf invariant by dropping any flap it carried.
        self.project.design.layout.flaps.retain(|f| f.id != at);
        self.project.design.layout.flaps.push(flap);
        self.new_vertices.insert(id);
        self.apply_tree_update(&update);
        self.record_structural_history(&update, old_root, vec![format!("v{id}")]);
        Ok(update)
    }

    pub fn remove_leaf(&mut self, ids: Vec<NodeId>) -> BpResult<UpdateModel> {
        let (remove_ids, parent_ids) = self.simulate_delete(&ids)?;
        if remove_ids.is_empty() {
            return self.empty_tree_update();
        }
        let prototypes = parent_ids
            .iter()
            .filter_map(|id| {
                self.vertex(*id).ok().map(|vertex| {
                    self.create_flap_prototype(
                        *id,
                        Point {
                            x: vertex.x,
                            y: vertex.y,
                        },
                    )
                })
            })
            .collect::<Vec<_>>();
        let mut session = self.core_session()?;
        let old_root = root_id(&self.project.design.tree.edges);
        let update = session.remove_leaf(remove_ids.clone(), prototypes.clone())?;
        let remove_set = remove_ids.iter().copied().collect::<BTreeSet<_>>();
        self.project
            .design
            .tree
            .nodes
            .retain(|vertex| !remove_set.contains(&vertex.id));
        self.project
            .design
            .layout
            .flaps
            .retain(|flap| !remove_set.contains(&flap.id));
        self.project.design.layout.flaps.extend(prototypes);
        for id in &remove_ids {
            self.new_vertices.remove(id);
        }
        self.apply_tree_update(&update);
        self.record_structural_history(&update, old_root, Vec::new());
        Ok(update)
    }

    pub fn join_vertex(&mut self, id: NodeId) -> BpResult<UpdateModel> {
        if self.degree_map().get(&id).copied().unwrap_or_default() != 2 {
            return Err(BpError::InvalidInput(format!(
                "BP vertex {id} must have degree 2 to join"
            )));
        }
        let mut session = self.core_session()?;
        let old_root = root_id(&self.project.design.tree.edges);
        let update = session.join(id)?;
        self.project
            .design
            .tree
            .nodes
            .retain(|vertex| vertex.id != id);
        self.new_vertices.remove(&id);
        self.apply_tree_update(&update);
        self.record_structural_history(&update, old_root, Vec::new());
        Ok(update)
    }

    pub fn split_edge(&mut self, n1: NodeId, n2: NodeId) -> BpResult<UpdateModel> {
        let edge = self.edge(n1, n2)?.clone();
        if self.edge_max_length(&edge)? == 1.0 {
            return Err(BpError::InvalidInput(format!(
                "BP edge {}-{} cannot be split at max tree height",
                edge.n1, edge.n2
            )));
        }
        let id = self.next_available_node_id()?;
        let v1 = self.vertex(edge.n1)?.clone();
        let v2 = self.vertex(edge.n2)?.clone();
        let loc = Point {
            x: ((v1.x + v2.x) / 2.0).round(),
            y: ((v1.y + v2.y) / 2.0).round(),
        };
        let mut session = self.core_session()?;
        let old_root = root_id(&self.project.design.tree.edges);
        let update = session.split(edge, id)?;
        self.project.design.tree.nodes.push(Vertex {
            id,
            x: loc.x,
            y: loc.y,
            name: String::new(),
            is_new: None,
        });
        self.new_vertices.insert(id);
        self.apply_tree_update(&update);
        self.record_structural_history(&update, old_root, vec![format!("v{id}")]);
        Ok(update)
    }

    pub fn merge_edge(&mut self, n1: NodeId, n2: NodeId) -> BpResult<UpdateModel> {
        let edge = self.edge(n1, n2)?.clone();
        if self.leaf_for_edge(&edge).is_some() {
            let leaf = self.leaf_for_edge(&edge).unwrap();
            return self.remove_leaf(vec![leaf]);
        }
        let mut session = self.core_session()?;
        let old_root = root_id(&self.project.design.tree.edges);
        let update = session.merge(edge)?;
        for id in &update.remove.nodes {
            self.project
                .design
                .tree
                .nodes
                .retain(|vertex| vertex.id != *id);
            self.new_vertices.remove(id);
        }
        self.apply_tree_update(&update);
        self.record_structural_history(&update, old_root, Vec::new());
        Ok(update)
    }

    pub fn move_flap(
        &mut self,
        id: NodeId,
        target: Point,
        dragging: bool,
    ) -> BpResult<UpdateModel> {
        self.move_flaps(&[id], target, dragging)
    }

    pub fn move_flaps(
        &mut self,
        ids: &[NodeId],
        target: Point,
        dragging: bool,
    ) -> BpResult<UpdateModel> {
        let ids = unique_node_ids(ids);
        let Some(reference_id) = ids.first().copied() else {
            return Err(BpError::InvalidInput(
                "BP flap group move requires at least one flap".to_string(),
            ));
        };
        let mut moving_flaps = Vec::with_capacity(ids.len());
        for id in ids {
            let flap_index = self.flap_index(id)?;
            moving_flaps.push((
                flap_index,
                self.project.design.layout.flaps[flap_index].clone(),
            ));
        }
        let reference_flap = moving_flaps
            .iter()
            .find(|(_, flap)| flap.id == reference_id)
            .map(|(_, flap)| flap)
            .ok_or_else(|| {
                BpError::InvalidInput(format!("missing BP layout flap {reference_id}"))
            })?;
        let reference_old = Point {
            x: reference_flap.x,
            y: reference_flap.y,
        };
        let vector = Point {
            x: target.x - reference_old.x,
            y: target.y - reference_old.y,
        };
        let grid = BpGrid::new(self.project.design.layout.sheet.clone());
        let constrained = moving_flaps.iter().fold(vector, |current, (_, flap)| {
            constrain_flap(
                |point| grid.constrain(point),
                Point {
                    x: flap.x,
                    y: flap.y,
                },
                flap.width,
                flap.height,
                current,
            )
        });
        if constrained.x == 0.0 && constrained.y == 0.0 {
            return Ok(UpdateModel::default());
        }

        let mut next_flaps = Vec::with_capacity(moving_flaps.len());
        for (_, old_flap) in &moving_flaps {
            let mut next_flap = old_flap.clone();
            next_flap.x += constrained.x;
            next_flap.y += constrained.y;
            self.validate_flap(&next_flap)?;
            next_flaps.push(next_flap);
        }

        let mut session = self.core_session()?;
        let update = session.update_design(crate::engine::DesignUpdateRequest {
            flaps: next_flaps.clone(),
            edges: Vec::new(),
            stretches: self.project.design.layout.stretches.clone(),
            dragging,
        })?;
        let mut selection = Vec::with_capacity(next_flaps.len());
        self.history.set_dragging(dragging);
        for ((flap_index, old_flap), next_flap) in moving_flaps.into_iter().zip(next_flaps) {
            let old = Point {
                x: old_flap.x,
                y: old_flap.y,
            };
            let next = Point {
                x: next_flap.x,
                y: next_flap.y,
            };
            self.project.design.layout.flaps[flap_index] = next_flap;
            let tag = flap_tag(old_flap.id);
            self.history.move_command(tag.clone(), old, next);
            selection.push(tag);
        }
        self.history.flush(self.project.design.mode, selection);
        self.history.set_dragging(false);
        Ok(update)
    }

    pub fn resize_flap(&mut self, id: NodeId, width: f64, height: f64) -> BpResult<UpdateModel> {
        if !width.is_finite() || !height.is_finite() || width < 0.0 || height < 0.0 {
            return Err(BpError::InvalidInput(format!(
                "BP flap dimensions must be finite and non-negative: {width} x {height}"
            )));
        }
        let flap_index = self.flap_index(id)?;
        let old_flap = self.project.design.layout.flaps[flap_index].clone();
        if old_flap.width == width && old_flap.height == height {
            return Ok(UpdateModel::default());
        }

        let mut next_flap = old_flap.clone();
        next_flap.width = width;
        next_flap.height = height;
        self.validate_flap(&next_flap)?;

        let mut session = self.core_session()?;
        let update = session.update_design(crate::engine::DesignUpdateRequest {
            flaps: vec![next_flap.clone()],
            edges: Vec::new(),
            stretches: self.project.design.layout.stretches.clone(),
            dragging: false,
        })?;
        self.project.design.layout.flaps[flap_index] = next_flap.clone();
        let tag = flap_tag(id);
        if old_flap.width != next_flap.width {
            self.history.field_change(
                tag.clone(),
                "width",
                json!(old_flap.width),
                json!(next_flap.width),
            );
        }
        if old_flap.height != next_flap.height {
            self.history.field_change(
                tag.clone(),
                "height",
                json!(old_flap.height),
                json!(next_flap.height),
            );
        }
        self.history.flush(self.project.design.mode, vec![tag]);
        Ok(update)
    }

    pub fn subdivide_layout_sheet(&mut self) -> BpResult<UpdateModel> {
        let grid = BpGrid::new(self.project.design.layout.sheet.clone());
        let Some(transform) = subdivide_sheet(grid)? else {
            return Ok(UpdateModel::default());
        };
        self.apply_layout_sheet_transform(transform.grid.to_sheet(), transform.matrix)
    }

    pub fn rotate_layout_sheet(&mut self, clockwise: bool) -> BpResult<UpdateModel> {
        let grid = BpGrid::new(self.project.design.layout.sheet.clone());
        let transform = rotate_sheet(grid, if clockwise { 1.0 } else { -1.0 })?;
        self.apply_layout_sheet_transform(transform.grid.to_sheet(), transform.matrix)
    }

    pub fn flip_layout_sheet(&mut self, horizontal: bool) -> BpResult<UpdateModel> {
        let grid = BpGrid::new(self.project.design.layout.sheet.clone());
        self.apply_layout_sheet_transform(grid.to_sheet(), flip_sheet(&grid, horizontal))
    }

    pub fn update_layout_sheet(
        &mut self,
        grid_type: GridType,
        width: f64,
        height: f64,
    ) -> BpResult<UpdateModel> {
        if !width.is_finite() || !height.is_finite() {
            return Err(BpError::InvalidInput(format!(
                "BP layout sheet dimensions must be finite: {width} x {height}"
            )));
        }

        let current = BpGrid::new(self.project.design.layout.sheet.clone());
        let anchors = self.layout_flap_anchors();
        let mut shift = None;
        let next_grid = match (self.project.design.layout.sheet.grid_type, grid_type) {
            (GridType::Rectangular, GridType::Rectangular) => {
                let BpGrid::Rectangular(mut grid) = current else {
                    unreachable!("grid type checked above")
                };
                if let Some(resize) = grid.set_width_checked(width, &anchors) {
                    shift = combine_shift(shift, resize.shift);
                }
                let shifted = shifted_points(&anchors, shift);
                if let Some(resize) = grid.set_height_checked(height, &shifted) {
                    shift = combine_shift(shift, resize.shift);
                }
                BpGrid::Rectangular(grid)
            }
            (GridType::Diagonal, GridType::Diagonal) => {
                let BpGrid::Diagonal(mut grid) = current else {
                    unreachable!("grid type checked above")
                };
                if let Some(resize) = grid.set_size_checked(width, &anchors) {
                    shift = combine_shift(shift, resize.shift);
                }
                BpGrid::Diagonal(grid)
            }
            (_, GridType::Rectangular) => BpGrid::Rectangular(RectangularGrid::new(
                current.render_height(),
                current.render_width(),
            )),
            (_, GridType::Diagonal) => {
                let (grid, grid_shift) = DiagonalGrid::new_fitted(
                    current.render_height(),
                    current.render_width(),
                    &anchors,
                );
                shift = combine_shift(shift, grid_shift);
                BpGrid::Diagonal(grid)
            }
        };

        self.apply_layout_sheet_resize(next_grid.to_sheet(), shift)
    }

    pub fn complete_stretch(&mut self, id: &str) -> BpResult<UpdateModel> {
        let (tree, mut repository) = self.active_layout_repository(id)?;
        repository.complete_with_tree(&tree)?;
        let repo = repository.to_json().ok_or_else(|| {
            BpError::InvalidInput(format!("BP stretch {id} did not complete a repository"))
        })?;
        self.replace_stretch(
            Stretch {
                id: id.to_string(),
                configuration: None,
                pattern: None,
                repo: Some(repo.clone()),
            },
            "repo",
            serde_json::to_value(
                self.project
                    .design
                    .layout
                    .stretches
                    .iter()
                    .find(|stretch| stretch.id == id)
                    .and_then(|stretch| stretch.repo.clone()),
            )?,
            serde_json::to_value(repo)?,
        )?;
        Ok(UpdateModel::default())
    }

    pub fn switch_stretch_config(&mut self, id: &str, delta: isize) -> BpResult<UpdateModel> {
        let (tree, mut repository) = self.completed_layout_repository(id)?;
        let count = repository.configuration_count().unwrap_or(0);
        if count == 0 {
            return Err(BpError::InvalidInput(format!(
                "BP stretch {id} has no configurations"
            )));
        }
        let old = repository.index();
        let next = wrapped_index(old, delta, count);
        if old == next {
            return Ok(UpdateModel::default());
        }
        repository.set_index(next);
        repository.initialize_selected_pattern_with_tree(&tree)?;
        self.replace_repository_stretch(id, repository, "configIndex", old, next)?;
        Ok(UpdateModel::default())
    }

    pub fn switch_stretch_pattern(&mut self, id: &str, delta: isize) -> BpResult<UpdateModel> {
        let (tree, mut repository) = self.completed_layout_repository(id)?;
        let Some(configuration) = repository.configuration() else {
            return Err(BpError::InvalidInput(format!(
                "BP stretch {id} has no selected configuration"
            )));
        };
        let count = configuration.pattern_count();
        if count == 0 {
            return Err(BpError::InvalidInput(format!(
                "BP stretch {id} has no patterns"
            )));
        }
        let old = configuration.index();
        let next = wrapped_index(old, delta, count);
        if old == next {
            return Ok(UpdateModel::default());
        }
        repository.set_pattern_index(next)?;
        repository.initialize_selected_pattern_with_tree(&tree)?;
        self.replace_repository_stretch(id, repository, "patternIndex", old, next)?;
        Ok(UpdateModel::default())
    }

    pub fn move_device(
        &mut self,
        id: &str,
        device_index: usize,
        location: Point,
        dragging: bool,
    ) -> BpResult<UpdateModel> {
        let (tree, mut repository) = self.completed_layout_repository(id)?;
        let old = repository.move_selected_device(device_index, location, &tree)?;
        if old == location {
            return Ok(UpdateModel::default());
        }
        let repo = repository.to_json().ok_or_else(|| {
            BpError::InvalidInput(format!("BP stretch {id} did not complete a repository"))
        })?;
        let next_stretch = Stretch {
            id: id.to_string(),
            configuration: None,
            pattern: None,
            repo: Some(repo),
        };
        if let Some(index) = self
            .project
            .design
            .layout
            .stretches
            .iter()
            .position(|candidate| candidate.id == id)
        {
            self.project.design.layout.stretches[index] = next_stretch;
        } else {
            self.project.design.layout.stretches.push(next_stretch);
        }
        let tag = device_tag(id, device_index);
        self.history.set_dragging(dragging);
        self.history.move_command(tag.clone(), old, location);
        self.history.flush(self.project.design.mode, vec![tag]);
        self.history.set_dragging(false);
        Ok(UpdateModel::default())
    }

    pub fn apply_optimizer_layout(
        &mut self,
        next_sheet: Sheet,
        next_flaps: Vec<Flap>,
    ) -> BpResult<UpdateModel> {
        let old_sheet = self.project.design.layout.sheet.clone();
        let old_flaps = self.project.design.layout.flaps.clone();
        let old_edges = self.project.design.tree.edges.clone();
        let update = self.update_layout_after_sheet_change(
            next_sheet.clone(),
            next_flaps.clone(),
            Vec::new(),
        )?;
        self.record_layout_sheet_history(
            &old_sheet,
            &next_sheet,
            &old_flaps,
            &next_flaps,
            &old_edges,
            &[],
        );
        Ok(update)
    }

    fn apply_layout_sheet_transform(
        &mut self,
        next_sheet: Sheet,
        matrix: TransformationMatrix,
    ) -> BpResult<UpdateModel> {
        let scale = matrix_scale(matrix);
        let old_sheet = self.project.design.layout.sheet.clone();
        let old_flaps = self.project.design.layout.flaps.clone();
        let old_edges = self.project.design.tree.edges.clone();
        let next_flaps = old_flaps
            .iter()
            .map(|flap| transform_flap(flap, matrix))
            .collect::<Vec<_>>();
        let next_edges = if scale != 1.0 {
            old_edges
                .iter()
                .map(|edge| Edge {
                    length: edge.length * scale,
                    ..edge.clone()
                })
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        };

        let update = self.update_layout_after_sheet_change(
            next_sheet.clone(),
            next_flaps.clone(),
            next_edges.clone(),
        )?;
        self.record_layout_sheet_history(
            &old_sheet,
            &next_sheet,
            &old_flaps,
            &next_flaps,
            &old_edges,
            &next_edges,
        );
        Ok(update)
    }

    fn apply_layout_sheet_resize(
        &mut self,
        next_sheet: Sheet,
        shift: Option<Point>,
    ) -> BpResult<UpdateModel> {
        let old_sheet = self.project.design.layout.sheet.clone();
        if old_sheet == next_sheet && shift.is_none() {
            return Ok(UpdateModel::default());
        }
        let old_flaps = self.project.design.layout.flaps.clone();
        let next_flaps = if let Some(shift) = shift {
            old_flaps
                .iter()
                .map(|flap| shift_flap(flap, shift))
                .collect::<Vec<_>>()
        } else {
            old_flaps.clone()
        };
        let update = self.update_layout_after_sheet_change(
            next_sheet.clone(),
            next_flaps.clone(),
            Vec::new(),
        )?;
        self.record_layout_sheet_history(
            &old_sheet,
            &next_sheet,
            &old_flaps,
            &next_flaps,
            &[],
            &[],
        );
        Ok(update)
    }

    fn update_layout_after_sheet_change(
        &mut self,
        next_sheet: Sheet,
        next_flaps: Vec<Flap>,
        next_edges: Vec<Edge>,
    ) -> BpResult<UpdateModel> {
        for flap in &next_flaps {
            validate_flap_with_sheet(flap, &next_sheet)?;
        }

        let mut next_project = self.project.clone();
        next_project.design.layout.sheet = next_sheet;
        next_project.design.layout.flaps = next_flaps.clone();
        for next_edge in &next_edges {
            if let Some(edge) = next_project
                .design
                .tree
                .edges
                .iter_mut()
                .find(|edge| same_edge(edge, next_edge.n1, next_edge.n2))
            {
                edge.length = next_edge.length;
            }
        }

        let mut session = BpSession::from_design(&next_project.design)?.0;
        let update = session.update_design(crate::engine::DesignUpdateRequest {
            flaps: next_flaps,
            edges: next_edges,
            stretches: next_project.design.layout.stretches.clone(),
            dragging: false,
        })?;
        self.project = next_project;
        Ok(update)
    }

    fn record_layout_sheet_history(
        &mut self,
        old_sheet: &Sheet,
        next_sheet: &Sheet,
        old_flaps: &[Flap],
        next_flaps: &[Flap],
        old_edges: &[Edge],
        next_edges: &[Edge],
    ) {
        let mut selection = vec!["layout.g".to_string()];
        if old_sheet.grid_type != next_sheet.grid_type {
            self.history.field_change(
                "layout.g",
                "type",
                json!(old_sheet.grid_type),
                json!(next_sheet.grid_type),
            );
        }
        if old_sheet.width != next_sheet.width {
            self.history.field_change(
                "layout.g",
                "width",
                json!(old_sheet.width),
                json!(next_sheet.width),
            );
        }
        if old_sheet.height != next_sheet.height {
            let prop = if next_sheet.grid_type == GridType::Diagonal {
                "size"
            } else {
                "height"
            };
            self.history.field_change(
                "layout.g",
                prop,
                json!(old_sheet.height),
                json!(next_sheet.height),
            );
        }
        for next in next_flaps {
            let Some(old) = old_flaps.iter().find(|flap| flap.id == next.id) else {
                continue;
            };
            let old_point = Point { x: old.x, y: old.y };
            let next_point = Point {
                x: next.x,
                y: next.y,
            };
            if old_point != next_point {
                let tag = flap_tag(old.id);
                self.history
                    .move_command(tag.clone(), old_point, next_point);
                selection.push(tag);
            }
            let tag = flap_tag(old.id);
            if old.width != next.width {
                self.history.field_change(
                    tag.clone(),
                    "width",
                    json!(old.width),
                    json!(next.width),
                );
            }
            if old.height != next.height {
                self.history.field_change(
                    tag.clone(),
                    "height",
                    json!(old.height),
                    json!(next.height),
                );
            }
        }
        for next in next_edges {
            if let Some(old) = old_edges
                .iter()
                .find(|edge| same_edge(edge, next.n1, next.n2))
                && old.length != next.length
            {
                self.history.field_change(
                    edge_tag(old.n1, old.n2),
                    "length",
                    json!(old.length),
                    json!(next.length),
                );
            }
        }
        self.history.flush(self.project.design.mode, selection);
    }

    fn layout_flap_anchors(&self) -> Vec<Point> {
        self.project
            .design
            .layout
            .flaps
            .iter()
            .flat_map(|flap| {
                get_dots(
                    Point {
                        x: flap.x,
                        y: flap.y,
                    },
                    flap.width,
                    flap.height,
                )
            })
            .collect()
    }

    fn layout_tree(&self) -> BpResult<BpTree> {
        BpTree::new(
            &self.project.design.tree.edges,
            &self.project.design.layout.flaps,
        )
    }

    fn active_layout_repository(&self, id: &str) -> BpResult<(BpTree, LayoutRepository)> {
        let tree = self.layout_tree()?;
        let repository = active_layout_repositories(&tree, &self.project.design.layout.stretches)?
            .into_iter()
            .find(|repository| repository.stretch_id == id)
            .ok_or_else(|| BpError::InvalidInput(format!("missing BP stretch {id}")))?;
        Ok((tree, repository))
    }

    fn completed_layout_repository(&self, id: &str) -> BpResult<(BpTree, LayoutRepository)> {
        let (tree, mut repository) = self.active_layout_repository(id)?;
        repository.complete_with_tree(&tree)?;
        Ok((tree, repository))
    }

    fn replace_repository_stretch(
        &mut self,
        id: &str,
        repository: LayoutRepository,
        prop: &str,
        old: usize,
        new: usize,
    ) -> BpResult<()> {
        let repo = repository.to_json().ok_or_else(|| {
            BpError::InvalidInput(format!("BP stretch {id} did not complete a repository"))
        })?;
        self.replace_stretch(
            Stretch {
                id: id.to_string(),
                configuration: None,
                pattern: None,
                repo: Some(repo),
            },
            prop,
            json!(old),
            json!(new),
        )
    }

    fn replace_stretch(
        &mut self,
        stretch: Stretch,
        prop: &str,
        old_value: serde_json::Value,
        new_value: serde_json::Value,
    ) -> BpResult<()> {
        let old = self
            .project
            .design
            .layout
            .stretches
            .iter()
            .find(|candidate| candidate.id == stretch.id)
            .cloned();
        let tag = stretch_tag(&stretch.id);
        if old.as_ref() == Some(&stretch) {
            return Ok(());
        }
        if let Some(index) = self
            .project
            .design
            .layout
            .stretches
            .iter()
            .position(|candidate| candidate.id == stretch.id)
        {
            self.project.design.layout.stretches[index] = stretch.clone();
        } else {
            self.project.design.layout.stretches.push(stretch.clone());
        }
        self.history.field_change_flush(
            tag.clone(),
            prop,
            old_value,
            new_value,
            self.project.design.mode,
            vec![tag],
        );
        Ok(())
    }

    fn core_session(&self) -> BpResult<BpSession> {
        Ok(BpSession::from_design(&self.project.design)?.0)
    }

    fn empty_tree_update(&self) -> BpResult<UpdateModel> {
        Ok(UpdateModel {
            tree: Some(self.tree_data()?),
            ..Default::default()
        })
    }

    fn apply_tree_update(&mut self, update: &UpdateModel) {
        if let Some(tree) = &update.tree {
            self.project.design.tree.edges = tree.edges.clone();
        }
    }

    fn record_structural_history(
        &mut self,
        update: &UpdateModel,
        old_root: NodeId,
        selection: Vec<String>,
    ) {
        if update.edit.is_empty() {
            return;
        }
        let new_root = root_id(&self.project.design.tree.edges);
        self.history.edit(update.edit.clone(), old_root, new_root);
        self.history.flush(self.project.design.mode, selection);
    }

    fn apply_history_step(&mut self, step: &Step, undo: bool) -> BpResult<()> {
        if undo {
            for memento in step.destruct().iter().rev() {
                self.apply_memento(memento)?;
            }
            for command in step.commands().iter().rev() {
                self.apply_history_command(command, true)?;
            }
        } else {
            for memento in step.construct() {
                self.apply_memento(memento)?;
            }
            for command in step.commands() {
                self.apply_history_command(command, false)?;
            }
        }
        self.project.design.mode = step.mode();
        self.refresh_after_history_navigation()
    }

    fn apply_history_command(&mut self, command: &HistoryCommand, undo: bool) -> BpResult<()> {
        match command {
            HistoryCommand::Field {
                tag,
                prop,
                old,
                new,
            } => self.apply_history_field(tag, prop, if undo { old } else { new }),
            HistoryCommand::Move { tag, old, new } => {
                self.apply_history_move(tag, if undo { *old } else { *new })
            }
            HistoryCommand::Edit {
                old, new, edits, ..
            } => {
                let next_edits = if undo {
                    edits
                        .iter()
                        .rev()
                        .map(|(add, edge)| (!*add, edge.clone()))
                        .collect()
                } else {
                    edits.clone()
                };
                self.apply_history_tree_edit(next_edits, if undo { *old } else { *new })
            }
        }
    }

    fn apply_memento(&mut self, memento: &Memento) -> BpResult<()> {
        let (tag, value) = memento;
        if tag == "layout" {
            self.project.design.layout.sheet = value_from_history(value, "layout sheet")?;
            return Ok(());
        }
        if tag == "tree" {
            self.project.design.tree.sheet = value_from_history(value, "tree sheet")?;
            return Ok(());
        }
        if let Some(id) = parse_prefixed_node_tag(tag, 'f')? {
            let flap: Flap = value_from_history(value, "flap memento")?;
            replace_or_push_flap(&mut self.project.design.layout.flaps, id, flap);
            return Ok(());
        }
        if let Some(id) = parse_prefixed_node_tag(tag, 'v')? {
            let vertex: Vertex = value_from_history(value, "vertex memento")?;
            if vertex.is_new.unwrap_or(false) {
                self.new_vertices.insert(id);
            } else {
                self.new_vertices.remove(&id);
            }
            replace_or_push_vertex(&mut self.project.design.tree.nodes, id, vertex);
            return Ok(());
        }
        if let Some(id) = tag.strip_prefix('s') {
            let stretch: Stretch = value_from_history(value, "stretch memento")?;
            replace_or_push_stretch(&mut self.project.design.layout.stretches, id, stretch);
            return Ok(());
        }
        Err(BpError::UnsupportedOperation {
            upstream: "src/client/project/design.ts#$addMementos",
            reason: "unmapped BP history memento tag",
        })
    }

    fn apply_history_field(&mut self, tag: &str, prop: &str, value: &Value) -> BpResult<()> {
        if tag == "layout.g" {
            let mut sheet = self.project.design.layout.sheet.clone();
            apply_sheet_field(&mut sheet, prop, value)?;
            self.project.design.layout.sheet = sheet;
            return Ok(());
        }
        if tag == "tree.g" {
            let mut sheet = self.project.design.tree.sheet.clone();
            apply_sheet_field(&mut sheet, prop, value)?;
            self.project.design.tree.sheet = sheet;
            return Ok(());
        }
        if let Some(id) = parse_prefixed_node_tag(tag, 'v')? {
            if prop == "name" {
                self.vertex_mut(id)?.name = value_from_history(value, "vertex name")?;
                return Ok(());
            }
        }
        if let Some(id) = parse_prefixed_node_tag(tag, 'f')? {
            let index = self.flap_index(id)?;
            match prop {
                "width" => {
                    self.project.design.layout.flaps[index].width =
                        value_from_history(value, "flap width")?;
                    return Ok(());
                }
                "height" => {
                    self.project.design.layout.flaps[index].height =
                        value_from_history(value, "flap height")?;
                    return Ok(());
                }
                _ => {}
            }
        }
        if tag.starts_with('e') {
            let (n1, n2) = parse_edge_tag(tag)?;
            if prop == "length" {
                let index = self.edge_index(n1, n2)?;
                self.project.design.tree.edges[index].length =
                    value_from_history(value, "edge length")?;
                return Ok(());
            }
        }
        if let Some(id) = tag.strip_prefix('s') {
            match prop {
                "repo" => {
                    self.set_stretch_repo(id, value_from_history(value, "stretch repo")?)?;
                    return Ok(());
                }
                "configIndex" => {
                    self.set_stretch_config_index(id, value_from_history(value, "config index")?)?;
                    return Ok(());
                }
                "patternIndex" => {
                    self.set_stretch_pattern_index(
                        id,
                        value_from_history(value, "pattern index")?,
                    )?;
                    return Ok(());
                }
                _ => {}
            }
        }
        Err(BpError::UnsupportedOperation {
            upstream: "src/client/project/changes/commands/fieldCommand.ts",
            reason: "unmapped BP history field command",
        })
    }

    fn apply_history_move(&mut self, tag: &str, point: Point) -> BpResult<()> {
        if let Some(id) = parse_prefixed_node_tag(tag, 'v')? {
            self.vertex_mut(id)?.x = point.x;
            self.vertex_mut(id)?.y = point.y;
            if self.new_vertices.contains(&id)
                && let Some(relative) = self.relative_layout_point(point)
                && let Some(flap) = self.flap_mut(id)
            {
                flap.x = relative.x;
                flap.y = relative.y;
            }
            return Ok(());
        }
        if let Some(id) = parse_prefixed_node_tag(tag, 'f')? {
            let index = self.flap_index(id)?;
            self.project.design.layout.flaps[index].x = point.x;
            self.project.design.layout.flaps[index].y = point.y;
            return Ok(());
        }
        if let Some((stretch_id, device_index)) = parse_device_tag(tag)? {
            self.set_device_location(stretch_id, device_index, point)?;
            return Ok(());
        }
        Err(BpError::UnsupportedOperation {
            upstream: "src/client/project/changes/commands/moveCommand.ts",
            reason: "unmapped BP history move command",
        })
    }

    fn apply_history_tree_edit(&mut self, edits: Vec<(bool, Edge)>, root: NodeId) -> BpResult<()> {
        let mut session = self.core_session()?;
        let update = session.edit_tree(
            edits,
            root,
            self.project.design.layout.flaps.clone(),
            self.project.design.layout.stretches.clone(),
        )?;
        let remove_set = update.remove.nodes.iter().copied().collect::<BTreeSet<_>>();
        if !remove_set.is_empty() {
            self.project
                .design
                .tree
                .nodes
                .retain(|vertex| !remove_set.contains(&vertex.id));
            self.project
                .design
                .layout
                .flaps
                .retain(|flap| !remove_set.contains(&flap.id));
            for id in &remove_set {
                self.new_vertices.remove(id);
            }
        }
        self.apply_tree_update(&update);
        Ok(())
    }

    fn refresh_after_history_navigation(&mut self) -> BpResult<()> {
        let (_session, update) = BpSession::from_design(&self.project.design)?;
        self.apply_tree_update(&update);
        for flap in &self.project.design.layout.flaps {
            self.validate_flap(flap)?;
        }
        Ok(())
    }

    fn set_stretch_repo(&mut self, id: &str, repo: Option<Repository>) -> BpResult<()> {
        if let Some(stretch) = self
            .project
            .design
            .layout
            .stretches
            .iter_mut()
            .find(|candidate| candidate.id == id)
        {
            stretch.repo = repo;
            stretch.configuration = None;
            stretch.pattern = None;
            return Ok(());
        }
        self.project.design.layout.stretches.push(Stretch {
            id: id.to_string(),
            configuration: None,
            pattern: None,
            repo,
        });
        Ok(())
    }

    fn set_stretch_config_index(&mut self, id: &str, index: usize) -> BpResult<()> {
        let (tree, mut repository) = self.completed_layout_repository(id)?;
        repository.set_index(index);
        repository.initialize_selected_pattern_with_tree(&tree)?;
        let repo = repository.to_json().ok_or_else(|| {
            BpError::InvalidInput(format!("BP stretch {id} did not complete a repository"))
        })?;
        self.set_stretch_repo(id, Some(repo))
    }

    fn set_stretch_pattern_index(&mut self, id: &str, index: usize) -> BpResult<()> {
        let (tree, mut repository) = self.completed_layout_repository(id)?;
        repository.set_pattern_index(index)?;
        repository.initialize_selected_pattern_with_tree(&tree)?;
        let repo = repository.to_json().ok_or_else(|| {
            BpError::InvalidInput(format!("BP stretch {id} did not complete a repository"))
        })?;
        self.set_stretch_repo(id, Some(repo))
    }

    fn set_device_location(
        &mut self,
        id: &str,
        device_index: usize,
        location: Point,
    ) -> BpResult<()> {
        let (tree, mut repository) = self.completed_layout_repository(id)?;
        repository.move_selected_device(device_index, location, &tree)?;
        let repo = repository.to_json().ok_or_else(|| {
            BpError::InvalidInput(format!("BP stretch {id} did not complete a repository"))
        })?;
        self.set_stretch_repo(id, Some(repo))
    }

    fn vertex(&self, id: NodeId) -> BpResult<&Vertex> {
        self.project
            .design
            .tree
            .nodes
            .iter()
            .find(|vertex| vertex.id == id)
            .ok_or_else(|| BpError::InvalidInput(format!("missing BP tree vertex {id}")))
    }

    fn vertex_mut(&mut self, id: NodeId) -> BpResult<&mut Vertex> {
        self.project
            .design
            .tree
            .nodes
            .iter_mut()
            .find(|vertex| vertex.id == id)
            .ok_or_else(|| BpError::InvalidInput(format!("missing BP tree vertex {id}")))
    }

    fn flap_mut(&mut self, id: NodeId) -> Option<&mut Flap> {
        self.project
            .design
            .layout
            .flaps
            .iter_mut()
            .find(|flap| flap.id == id)
    }

    fn flap_index(&self, id: NodeId) -> BpResult<usize> {
        self.project
            .design
            .layout
            .flaps
            .iter()
            .position(|flap| flap.id == id)
            .ok_or_else(|| BpError::InvalidInput(format!("missing BP layout flap {id}")))
    }

    fn validate_flap(&self, flap: &Flap) -> BpResult<()> {
        validate_flap_with_sheet(flap, &self.project.design.layout.sheet)
    }

    fn edge(&self, n1: NodeId, n2: NodeId) -> BpResult<&Edge> {
        self.project
            .design
            .tree
            .edges
            .iter()
            .find(|edge| same_edge(edge, n1, n2))
            .ok_or_else(|| BpError::InvalidInput(format!("missing BP tree edge {n1}-{n2}")))
    }

    fn edge_index(&self, n1: NodeId, n2: NodeId) -> BpResult<usize> {
        self.project
            .design
            .tree
            .edges
            .iter()
            .position(|edge| same_edge(edge, n1, n2))
            .ok_or_else(|| BpError::InvalidInput(format!("missing BP tree edge {n1}-{n2}")))
    }

    fn next_available_node_id(&self) -> BpResult<NodeId> {
        if self.project.design.tree.nodes.len() >= MAX_VERTICES {
            return Err(BpError::InvalidInput(format!(
                "BP trees cannot exceed {MAX_VERTICES} vertices"
            )));
        }
        let used = self
            .project
            .design
            .tree
            .nodes
            .iter()
            .map(|vertex| vertex.id as usize)
            .collect::<BTreeSet<_>>();
        let max_plus_one = used.iter().next_back().copied().map_or(0, |id| id + 1);
        for id in (0..max_plus_one).rev() {
            if !used.contains(&id) {
                return Ok(id as NodeId);
            }
        }
        Ok(max_plus_one as NodeId)
    }

    /// Seed a default flap (`{id, 0, 0, 0, 0}`) for every tree leaf that has no
    /// `layout.flaps` entry, matching BP Studio's per-leaf default AABB. No-op
    /// when the tree is empty or every leaf already has a flap.
    fn seed_missing_leaf_flaps(project: &mut Project) -> BpResult<()> {
        if project.design.tree.edges.is_empty() {
            return Ok(());
        }
        let existing: BTreeSet<NodeId> = project
            .design
            .layout
            .flaps
            .iter()
            .map(|flap| flap.id)
            .collect();
        let tree = BpTree::new(&project.design.tree.edges, &project.design.layout.flaps)?;
        let mut missing: Vec<NodeId> = tree
            .nodes()
            .iter()
            .flatten()
            .filter(|node| node.is_leaf() && !existing.contains(&node.id))
            .map(|node| node.id)
            .collect();
        missing.sort_unstable();
        for id in missing {
            project.design.layout.flaps.push(Flap {
                id,
                x: 0.0,
                y: 0.0,
                width: 0.0,
                height: 0.0,
            });
        }
        Ok(())
    }

    fn closest_empty_spot(&self, at: Point) -> Point {
        let grid = BpGrid::new(self.project.design.tree.sheet.clone());
        let reference = Point {
            x: at.x + X_DISPLACEMENT,
            y: at.y + Y_DISPLACEMENT,
        };
        let occupied = self
            .project
            .design
            .tree
            .nodes
            .iter()
            .map(|vertex| ordered_location_key(vertex.x, vertex.y))
            .collect::<BTreeSet<_>>();
        let mut spot = None;
        let mut min_distance = f64::INFINITY;
        let mut radius = 1;
        let mut off_bound = false;
        while spot.is_none() && !off_bound {
            off_bound = true;
            for point in chebyshev(radius) {
                let candidate = Point {
                    x: at.x + point.x,
                    y: at.y + point.y,
                };
                if !grid.contains(candidate) {
                    continue;
                }
                off_bound = false;
                if occupied.contains(&ordered_location_key(candidate.x, candidate.y)) {
                    continue;
                }
                let dx = candidate.x - reference.x;
                let dy = candidate.y - reference.y;
                let distance = dx * dx + dy * dy;
                if distance < min_distance {
                    min_distance = distance;
                    spot = Some(candidate);
                }
            }
            radius += 1;
        }
        spot.unwrap_or(at)
    }

    fn create_flap_prototype(&self, id: NodeId, vertex_location: Point) -> Flap {
        let p = self
            .relative_layout_point(vertex_location)
            .unwrap_or(vertex_location);
        Flap {
            id,
            x: p.x,
            y: p.y,
            width: 0.0,
            height: 0.0,
        }
    }

    fn relative_layout_point(&self, point: Point) -> Option<Point> {
        let from_grid = BpGrid::new(self.project.design.tree.sheet.clone());
        let to_grid = BpGrid::new(self.project.design.layout.sheet.clone());
        let from_width = from_grid.render_width();
        let from_height = from_grid.render_height();
        if from_width == 0.0 || from_height == 0.0 {
            return None;
        }
        let p = Point {
            x: (point.x * to_grid.render_width() / from_width).round(),
            y: (point.y * to_grid.render_height() / from_height).round(),
        };
        Some(to_grid.constrain(p))
    }

    fn degree_map(&self) -> BTreeMap<NodeId, usize> {
        let mut degrees = BTreeMap::new();
        for edge in &self.project.design.tree.edges {
            *degrees.entry(edge.n1).or_default() += 1;
            *degrees.entry(edge.n2).or_default() += 1;
        }
        degrees
    }

    fn simulate_delete(&self, ids: &[NodeId]) -> BpResult<(Vec<NodeId>, Vec<NodeId>)> {
        let mut result = Vec::new();
        let mut map = self.neighbor_map();
        let mut parents = BTreeSet::<NodeId>::new();
        let mut vertices = ids.to_vec();
        let mut found = true;
        while found && map.len() > MIN_VERTICES {
            let mut next_round = Vec::new();
            found = false;
            for id in vertices {
                let Some(neighbors) = map.get(&id).cloned() else {
                    continue;
                };
                if neighbors.len() == 1 {
                    map.remove(&id);
                    parents.remove(&id);
                    result.push(id);
                    let parent = *neighbors.iter().next().ok_or_else(|| {
                        BpError::InvalidInput(format!("BP vertex {id} has no parent"))
                    })?;
                    parents.insert(parent);
                    if let Some(parent_neighbors) = map.get_mut(&parent) {
                        parent_neighbors.remove(&id);
                    }
                    found = true;
                } else {
                    next_round.push(id);
                }
                if map.len() == MIN_VERTICES {
                    break;
                }
            }
            vertices = next_round;
        }
        let parent_ids = parents
            .into_iter()
            .filter(|id| map.get(id).map(|set| set.len() == 1).unwrap_or(false))
            .collect();
        Ok((result, parent_ids))
    }

    fn neighbor_map(&self) -> BTreeMap<NodeId, BTreeSet<NodeId>> {
        let mut map = self
            .project
            .design
            .tree
            .nodes
            .iter()
            .map(|vertex| (vertex.id, BTreeSet::new()))
            .collect::<BTreeMap<_, _>>();
        for edge in &self.project.design.tree.edges {
            map.entry(edge.n1).or_default().insert(edge.n2);
            map.entry(edge.n2).or_default().insert(edge.n1);
        }
        map
    }

    fn vertex_max_new_leaf_length(&self, id: NodeId) -> BpResult<f64> {
        let tree = BpTree::new(
            &self.project.design.tree.edges,
            &self.project.design.layout.flaps,
        )?;
        let node = tree
            .node(id)
            .ok_or_else(|| BpError::InvalidInput(format!("missing BP tree vertex {id}")))?;
        Ok(MAX_TREE_HEIGHT as f64 - node.dist)
    }

    fn edge_max_length(&self, edge: &Edge) -> BpResult<f64> {
        let tree = BpTree::new(
            &self.project.design.tree.edges,
            &self.project.design.layout.flaps,
        )?;
        let a = tree
            .node(edge.n1)
            .ok_or_else(|| BpError::InvalidInput(format!("missing BP tree vertex {}", edge.n1)))?;
        let b = tree
            .node(edge.n2)
            .ok_or_else(|| BpError::InvalidInput(format!("missing BP tree vertex {}", edge.n2)))?;
        let child = if a.dist > b.dist { a } else { b };
        let branch_height = child.dist + f64::from(child.height);
        Ok(MAX_TREE_HEIGHT as f64 - branch_height + edge.length)
    }

    fn leaf_for_edge(&self, edge: &Edge) -> Option<NodeId> {
        let degrees = self.degree_map();
        if degrees.get(&edge.n1).copied().unwrap_or_default() == 1 {
            Some(edge.n1)
        } else if degrees.get(&edge.n2).copied().unwrap_or_default() == 1 {
            Some(edge.n2)
        } else {
            None
        }
    }
}

fn same_edge(edge: &Edge, n1: NodeId, n2: NodeId) -> bool {
    (edge.n1 == n1 && edge.n2 == n2) || (edge.n1 == n2 && edge.n2 == n1)
}

fn validate_flap_with_sheet(flap: &Flap, sheet: &Sheet) -> BpResult<()> {
    let grid = BpGrid::new(sheet.clone());
    let off_sheet = get_dots(
        Point {
            x: flap.x,
            y: flap.y,
        },
        flap.width,
        flap.height,
    )
    .into_iter()
    .filter(|point| !grid.contains(*point))
    .count();
    if off_sheet > 1 {
        return Err(BpError::InvalidInput(format!(
            "BP flap {} dimensions place more than one tip outside the sheet",
            flap.id
        )));
    }
    Ok(())
}

fn combine_shift(current: Option<Point>, next: Option<Point>) -> Option<Point> {
    match (current, next) {
        (Some(a), Some(b)) => Some(Point {
            x: a.x + b.x,
            y: a.y + b.y,
        }),
        (Some(point), None) | (None, Some(point)) => Some(point),
        (None, None) => None,
    }
}

fn shifted_points(points: &[Point], shift: Option<Point>) -> Vec<Point> {
    let Some(shift) = shift else {
        return points.to_vec();
    };
    points
        .iter()
        .map(|point| Point {
            x: point.x + shift.x,
            y: point.y + shift.y,
        })
        .collect()
}

fn matrix_scale(matrix: TransformationMatrix) -> f64 {
    let [a, b, c, d, _, _] = matrix;
    ((a.hypot(c) + b.hypot(d)) / 2.0).round()
}

fn transform_flap(flap: &Flap, matrix: TransformationMatrix) -> Flap {
    let lower_left = transform_point(
        Point {
            x: flap.x,
            y: flap.y,
        },
        matrix,
    );
    let upper_right = transform_point(
        Point {
            x: flap.x + flap.width,
            y: flap.y + flap.height,
        },
        matrix,
    );
    Flap {
        id: flap.id,
        x: lower_left.x.min(upper_right.x),
        y: lower_left.y.min(upper_right.y),
        width: (upper_right.x - lower_left.x).abs(),
        height: (upper_right.y - lower_left.y).abs(),
    }
}

fn shift_flap(flap: &Flap, shift: Point) -> Flap {
    Flap {
        x: flap.x + shift.x,
        y: flap.y + shift.y,
        ..flap.clone()
    }
}

fn transform_point(point: Point, matrix: TransformationMatrix) -> Point {
    let [a, b, c, d, x, y] = matrix;
    Point {
        x: a * point.x + b * point.y + x,
        y: c * point.x + d * point.y + y,
    }
}

fn root_id(edges: &[Edge]) -> NodeId {
    edges.first().map(|edge| edge.n1).unwrap_or_default()
}

fn edge_tag(n1: NodeId, n2: NodeId) -> String {
    format!("e{n1},{n2}")
}

fn flap_tag(id: NodeId) -> String {
    format!("f{id}")
}

fn stretch_tag(id: &str) -> String {
    format!("s{id}")
}

fn device_tag(stretch_id: &str, device_index: usize) -> String {
    format!("s{stretch_id}.{device_index}")
}

fn wrapped_index(index: usize, delta: isize, len: usize) -> usize {
    (index as isize + delta).rem_euclid(len as isize) as usize
}

fn unique_node_ids(ids: &[NodeId]) -> Vec<NodeId> {
    let mut seen = BTreeSet::new();
    ids.iter().copied().filter(|id| seen.insert(*id)).collect()
}

fn value_from_history<T>(value: &Value, label: &str) -> BpResult<T>
where
    T: for<'de> serde::Deserialize<'de>,
{
    serde_json::from_value(value.clone())
        .map_err(|error| BpError::InvalidInput(format!("invalid BP history {label}: {error}")))
}

fn apply_sheet_field(sheet: &mut Sheet, prop: &str, value: &Value) -> BpResult<()> {
    match prop {
        "type" => {
            sheet.grid_type = value_from_history(value, "sheet grid type")?;
            Ok(())
        }
        "width" => {
            sheet.width = value_from_history(value, "sheet width")?;
            Ok(())
        }
        "height" => {
            sheet.height = value_from_history(value, "sheet height")?;
            Ok(())
        }
        "size" => {
            let size = value_from_history(value, "diagonal sheet size")?;
            sheet.width = size;
            sheet.height = size;
            Ok(())
        }
        _ => Err(BpError::UnsupportedOperation {
            upstream: "src/client/project/components/grid/*",
            reason: "unmapped BP sheet history field",
        }),
    }
}

fn replace_or_push_flap(flaps: &mut Vec<Flap>, id: NodeId, flap: Flap) {
    if let Some(slot) = flaps.iter_mut().find(|candidate| candidate.id == id) {
        *slot = flap;
    } else {
        flaps.push(flap);
    }
}

fn replace_or_push_vertex(vertices: &mut Vec<Vertex>, id: NodeId, vertex: Vertex) {
    if let Some(slot) = vertices.iter_mut().find(|candidate| candidate.id == id) {
        *slot = vertex;
    } else {
        vertices.push(vertex);
    }
}

fn replace_or_push_stretch(stretches: &mut Vec<Stretch>, id: &str, stretch: Stretch) {
    if let Some(slot) = stretches.iter_mut().find(|candidate| candidate.id == id) {
        *slot = stretch;
    } else {
        stretches.push(stretch);
    }
}

fn parse_prefixed_node_tag(tag: &str, prefix: char) -> BpResult<Option<NodeId>> {
    let Some(id) = tag.strip_prefix(prefix) else {
        return Ok(None);
    };
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
        return Ok(None);
    }
    id.parse::<NodeId>()
        .map(Some)
        .map_err(|error| BpError::InvalidInput(format!("invalid BP history tag {tag}: {error}")))
}

fn parse_edge_tag(tag: &str) -> BpResult<(NodeId, NodeId)> {
    let Some(ids) = tag.strip_prefix('e') else {
        return Err(BpError::InvalidInput(format!(
            "invalid BP edge history tag {tag}"
        )));
    };
    let Some((a, b)) = ids.split_once(',') else {
        return Err(BpError::InvalidInput(format!(
            "invalid BP edge history tag {tag}"
        )));
    };
    let n1 = a.parse::<NodeId>().map_err(|error| {
        BpError::InvalidInput(format!("invalid BP edge history tag {tag}: {error}"))
    })?;
    let n2 = b.parse::<NodeId>().map_err(|error| {
        BpError::InvalidInput(format!("invalid BP edge history tag {tag}: {error}"))
    })?;
    Ok((n1, n2))
}

fn parse_device_tag(tag: &str) -> BpResult<Option<(&str, usize)>> {
    let Some(rest) = tag.strip_prefix('s') else {
        return Ok(None);
    };
    let Some((stretch_id, device_index)) = rest.rsplit_once('.') else {
        return Ok(None);
    };
    if stretch_id.is_empty() {
        return Ok(None);
    }
    let device_index = device_index.parse::<usize>().map_err(|error| {
        BpError::InvalidInput(format!("invalid BP device history tag {tag}: {error}"))
    })?;
    Ok(Some((stretch_id, device_index)))
}

fn ordered_location_key(x: f64, y: f64) -> String {
    format!("{}:{}", x.trunc(), y.trunc())
}

fn chebyshev(radius: i32) -> Vec<Point> {
    let mut result = Vec::new();
    for i in 0..4 {
        for j in 0..2 * radius {
            let f = if i % 2 == 1 { 1.0 } else { -1.0 };
            let j = f64::from(j - radius);
            let radius = f64::from(radius);
            result.push(if i < 2 {
                Point {
                    x: f * j,
                    y: f * radius,
                }
            } else {
                Point {
                    x: f * radius,
                    y: f * -j,
                }
            });
        }
    }
    result
}

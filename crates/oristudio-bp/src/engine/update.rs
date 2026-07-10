use crate::model::{Edge, Edit, NodeId, Point, Stretch};
use crate::tree::BpTree;
use serde::de::{MapAccess, Visitor};
use serde::ser::SerializeMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;

pub type LineData = [Point; 2];
pub type ArcPolygonData = Vec<Vec<ArcPointData>>;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ArcPointData {
    pub x: f64,
    pub y: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arc: Option<Point>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContourData {
    pub outer: Vec<Point>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub inner: Vec<Vec<Point>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GraphicsData {
    pub contours: Vec<ContourData>,
    pub ridges: Vec<LineData>,
    #[serde(rename = "axisParallel", skip_serializing_if = "Option::is_none")]
    pub axis_parallel: Option<Vec<LineData>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<[f64; 2]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<Point>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forward: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrderedRecord<T> {
    entries: Vec<(String, T)>,
}

impl<T> Default for OrderedRecord<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T> OrderedRecord<T> {
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    pub fn insert(&mut self, key: impl Into<String>, value: T) {
        let key = key.into();
        if let Some((_, existing)) = self
            .entries
            .iter_mut()
            .find(|(entry_key, _)| *entry_key == key)
        {
            *existing = value;
            return;
        }
        self.entries.push((key, value));
    }

    pub fn get(&self, key: &str) -> Option<&T> {
        self.entries
            .iter()
            .find(|(entry_key, _)| entry_key == key)
            .map(|(_, value)| value)
    }

    pub fn remove(&mut self, key: &str) -> Option<T> {
        let index = self
            .entries
            .iter()
            .position(|(entry_key, _)| entry_key == key)?;
        Some(self.entries.remove(index).1)
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn entries(&self) -> &[(String, T)] {
        &self.entries
    }
}

impl<T> Serialize for OrderedRecord<T>
where
    T: Serialize,
{
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut map = serializer.serialize_map(Some(self.entries.len()))?;
        for (key, value) in &self.entries {
            map.serialize_entry(key, value)?;
        }
        map.end()
    }
}

impl<'de, T> Deserialize<'de> for OrderedRecord<T>
where
    T: Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct OrderedRecordVisitor<T> {
            marker: std::marker::PhantomData<T>,
        }

        impl<'de, T> Visitor<'de> for OrderedRecordVisitor<T>
        where
            T: Deserialize<'de>,
        {
            type Value = OrderedRecord<T>;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("an object preserving entry order")
            }

            fn visit_map<A>(self, mut access: A) -> Result<Self::Value, A::Error>
            where
                A: MapAccess<'de>,
            {
                let mut result = OrderedRecord::new();
                while let Some((key, value)) = access.next_entry::<String, T>()? {
                    result.insert(key, value);
                }
                Ok(result)
            }
        }

        deserializer.deserialize_map(OrderedRecordVisitor {
            marker: std::marker::PhantomData,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct UpdateModel {
    pub add: UpdateAdd,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tree: Option<UpdateTreeData>,
    pub update: UpdatePatch,
    pub remove: UpdateRemove,
    #[serde(rename = "patternNotFound")]
    pub pattern_not_found: bool,
    pub edit: Vec<Edit>,
    pub graphics: OrderedRecord<GraphicsData>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct UpdateAdd {
    pub nodes: Vec<NodeId>,
    pub junctions: OrderedRecord<ArcPolygonData>,
    pub stretches: OrderedRecord<Stretch>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct UpdatePatch {
    pub stretches: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct UpdateRemove {
    pub nodes: Vec<NodeId>,
    pub junctions: Vec<String>,
    pub stretches: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpdateTreeData {
    pub edges: Vec<Edge>,
    pub nodes: Vec<UpdateNode>,
}

impl UpdateTreeData {
    pub fn from_tree(tree: &BpTree) -> Self {
        let data = tree.to_json();
        Self {
            edges: data.edges,
            nodes: data
                .nodes
                .into_iter()
                .map(|node| UpdateNode {
                    id: node.id,
                    dist: node.dist,
                    height: node.height,
                })
                .collect(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct UpdateNode {
    pub id: NodeId,
    pub dist: f64,
    pub height: i32,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct UpdateResult {
    model: UpdateModel,
}

impl UpdateResult {
    pub fn new() -> Self {
        Self {
            model: UpdateModel::default(),
        }
    }

    pub fn model(&self) -> &UpdateModel {
        &self.model
    }

    pub fn edit(&mut self, edit: Edit) {
        self.model.edit.push(edit);
    }

    pub fn add_node(&mut self, id: NodeId) {
        self.model.add.nodes.push(id);
    }

    pub fn remove_node(&mut self, id: NodeId) {
        self.model.remove.nodes.push(id);
    }

    pub fn add_junction(&mut self, id: impl Into<String>, polygon: ArcPolygonData) {
        self.model.add.junctions.insert(id, polygon);
    }

    pub fn remove_junction(&mut self, id: impl Into<String>) {
        self.model.remove.junctions.push(id.into());
    }

    pub fn add_stretch(&mut self, id: impl Into<String>, stretch: Stretch) {
        self.model.add.stretches.insert(id, stretch);
    }

    pub fn update_stretch(&mut self, id: impl Into<String>) {
        self.model.update.stretches.push(id.into());
    }

    pub fn remove_stretch(&mut self, id: impl Into<String>) {
        self.model.remove.stretches.push(id.into());
    }

    pub fn add_graphics(&mut self, tag: impl Into<String>, data: GraphicsData) {
        self.model.graphics.insert(tag, data);
    }

    pub fn set_pattern_not_found(&mut self) {
        self.model.pattern_not_found = true;
    }

    pub fn export_tree(&mut self, tree: &BpTree) {
        self.export_tree_data(UpdateTreeData::from_tree(tree));
    }

    pub fn export_tree_data(&mut self, tree: UpdateTreeData) {
        self.model.tree = Some(tree);
    }

    pub fn flush(&mut self) -> UpdateModel {
        std::mem::take(&mut self.model)
    }
}

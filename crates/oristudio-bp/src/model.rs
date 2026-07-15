use serde::{Deserialize, Serialize};

pub const CURRENT_VERSION: &str = "0.7";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Project {
    pub version: String,
    pub design: Design,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<CoreError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub history: Option<History>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<State>,
}

impl Project {
    pub fn sample() -> Self {
        Self {
            version: CURRENT_VERSION.to_string(),
            design: Design {
                title: String::new(),
                description: None,
                mode: DesignMode::Tree,
                layout: Layout {
                    sheet: Sheet {
                        grid_type: GridType::Rectangular,
                        width: 16.0,
                        height: 16.0,
                    },
                    flaps: Vec::new(),
                    stretches: Vec::new(),
                },
                tree: Tree {
                    sheet: Sheet {
                        grid_type: GridType::Rectangular,
                        width: 20.0,
                        height: 20.0,
                    },
                    nodes: Vec::new(),
                    edges: Vec::new(),
                },
            },
            error: None,
            history: None,
            state: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Design {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub mode: DesignMode,
    pub layout: Layout,
    pub tree: Tree,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DesignMode {
    Layout,
    Tree,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Layout {
    pub sheet: Sheet,
    pub flaps: Vec<Flap>,
    pub stretches: Vec<Stretch>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Tree {
    pub sheet: Sheet,
    pub nodes: Vec<Vertex>,
    pub edges: Vec<Edge>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Sheet {
    #[serde(rename = "type", default = "default_grid_type")]
    pub grid_type: GridType,
    pub width: f64,
    pub height: f64,
}

fn default_grid_type() -> GridType {
    GridType::Rectangular
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GridType {
    #[serde(rename = "rect")]
    Rectangular,
    #[serde(rename = "diag")]
    Diagonal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Flap {
    pub id: NodeId,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Vertex {
    pub id: NodeId,
    pub x: f64,
    pub y: f64,
    pub name: String,
    #[serde(rename = "isNew", skip_serializing_if = "Option::is_none")]
    pub is_new: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Edge {
    pub n1: NodeId,
    pub n2: NodeId,
    pub length: f64,
}

pub type Edit = (bool, Edge);

pub type NodeId = u32;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Stretch {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub configuration: Option<Configuration>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern: Option<Pattern>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo: Option<Repository>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Repository {
    pub configurations: Vec<Configuration>,
    pub index: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Configuration {
    pub partitions: Vec<Partition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub patterns: Option<Vec<Pattern>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Partition {
    pub overlaps: Vec<Overlap>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub strategy: Option<Strategy>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Strategy {
    #[serde(rename = "HALFINTEGRAL")]
    HalfIntegral,
    #[serde(rename = "UNIVERSAL")]
    Universal,
    #[serde(rename = "BASE_JOIN")]
    BaseJoin,
    #[serde(rename = "STANDARD_JOIN")]
    StandardJoin,
    #[serde(rename = "PERFECT")]
    Perfect,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Overlap {
    pub c: Vec<Corner>,
    pub ox: f64,
    pub oy: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<i64>,
    pub parent: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shift: Option<Point>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Junction {
    pub c: Vec<Corner>,
    pub f: Point,
    pub ox: f64,
    pub oy: f64,
    pub sx: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Corner {
    #[serde(rename = "type")]
    pub corner_type: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub e: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub q: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dynamic: Option<[Connection; 2]>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Connection {
    pub e: i64,
    pub q: u8,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Pattern {
    pub devices: Vec<Device>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Device {
    pub gadgets: Vec<Gadget>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<f64>,
    #[serde(rename = "addOns", skip_serializing_if = "Option::is_none")]
    pub add_ons: Option<Vec<AddOn>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AddOn {
    pub contour: Path,
    pub dir: Point,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Gadget {
    pub pieces: Vec<Piece>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<Point>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchors: Option<Vec<Option<Anchor>>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Anchor {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slack: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<Point>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Piece {
    pub ox: f64,
    pub oy: f64,
    pub u: f64,
    pub v: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detours: Option<Vec<Path>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shift: Option<Point>,
}

pub type Path = Vec<Point>;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct History {
    pub index: usize,
    #[serde(rename = "savedIndex")]
    pub saved_index: isize,
    pub steps: Vec<HistoryStep>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HistoryStep {
    pub commands: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub construct: Option<Vec<Memento>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destruct: Option<Vec<Memento>>,
    pub mode: DesignMode,
    pub before: Vec<String>,
    pub after: Vec<String>,
}

pub type Memento = (String, serde_json::Value);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct State {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout: Option<Viewport>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tree: Option<Viewport>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Viewport {
    pub zoom: f64,
    pub scroll: Point,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CoreError {
    pub message: String,
    #[serde(rename = "coreTrace")]
    pub core_trace: String,
    #[serde(rename = "clientTrace")]
    pub client_trace: String,
    pub request: serde_json::Value,
    pub build: String,
    #[serde(rename = "userAgent")]
    pub user_agent: String,
}

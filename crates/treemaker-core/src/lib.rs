//! Headless TreeMaker 5.0.1 model engine.
//!
//! `treemaker-core` is a Rust port of the model-only TreeMaker engine: stream
//! I/O, tree/path feasibility, ALM optimization, polygon construction, crease
//! pattern construction, and CP diagnostics. It does not include GUI,
//! wxWidgets, printing, menus, or proprietary optimizer backends.
//!
//! The primary entry point is [`Tree`].
//!
//! ```no_run
//! use treemaker_core::Tree;
//!
//! # fn main() -> Result<(), Box<dyn std::error::Error>> {
//! let text = std::fs::read_to_string("model.tmd5")?;
//! let mut tree = Tree::from_tmd_str(&text)?;
//!
//! let summary = tree.summary();
//! println!("nodes={}, paths={}", summary.nodes, summary.paths);
//!
//! tree.optimize_scale()?;
//! tree.build_polys_and_crease_pattern()?;
//!
//! std::fs::write("out.tmd5", tree.to_tmd5_string())?;
//! # Ok(())
//! # }
//! ```
//!
//! Numeric optimization parity is tolerance-based. The behavioral baseline is
//! TreeMaker 5.0.1 with the distributable ALM backend.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};

mod nlco;

/// Floating-point type used by TreeMaker geometry and optimization.
pub type TmFloat = f64;

const DIST_TOL: TmFloat = 1.0e-4;
const MIN_EDGE_LENGTH: TmFloat = 0.01;
const DEPTH_NOT_SET: TmFloat = -999.0;
const DEGREES: TmFloat = 0.017453292519943296;
const PI: TmFloat = std::f64::consts::PI;
const TWO_PI: TmFloat = 2.0 * std::f64::consts::PI;
const CONVEXITY_TOL: TmFloat = 1.0e-4;
const MOVE_TOL: TmFloat = 1.0e-6;
const VERTEX_TOL: TmFloat = 0.003;
const CREASE_AXIAL: i32 = 0;
const CREASE_GUSSET: i32 = 1;
const CREASE_RIDGE: i32 = 2;
const CREASE_UNFOLDED_HINGE: i32 = 3;
const CREASE_FOLDED_HINGE: i32 = 4;
const CREASE_PSEUDOHINGE: i32 = 5;
const FOLD_FLAT: i32 = 0;
const FOLD_MOUNTAIN: i32 = 1;
const FOLD_VALLEY: i32 = 2;
const FOLD_BORDER: i32 = 3;
const FACET_NOT_ORIENTED: i32 = 0;
const FACET_WHITE_UP: i32 = 1;
const FACET_COLOR_UP: i32 = 2;
const ROOT_FLAG_INELIGIBLE: i32 = 0;
const ROOT_FLAG_NOT_YET: i32 = 1;
const ROOT_FLAG_ALREADY_ADDED: i32 = 2;

/// Structured error returned by parsing, validation, optimization, and build operations.
#[derive(Debug, thiserror::Error)]
pub enum TreeError {
    #[error("parse error at byte {offset}: {message}")]
    Parse { offset: usize, message: String },
    #[error("bad {kind} reference index {index}; valid range is 1..={max}")]
    BadReference {
        kind: &'static str,
        index: usize,
        max: usize,
    },
    #[error("unsupported TreeMaker document version {0}")]
    UnsupportedVersion(String),
    #[error("unsupported operation: {0}")]
    UnsupportedOperation(&'static str),
    #[error("optimizer failed to converge: {0}")]
    OptimizerConvergence(String),
    #[error("invalid operation: {0}")]
    InvalidOperation(&'static str),
    #[error("fold artifact error: {0}")]
    FoldArtifact(String),
}

impl TreeError {
    /// Stable machine-readable code for CLI, wasm, and API consumers.
    pub fn code(&self) -> &'static str {
        match self {
            TreeError::Parse { .. } => "parse",
            TreeError::BadReference { .. } => "bad_reference",
            TreeError::UnsupportedVersion(_) => "unsupported_version",
            TreeError::UnsupportedOperation(_) => "unsupported_operation",
            TreeError::OptimizerConvergence(_) => "optimizer_convergence",
            TreeError::InvalidOperation(_) => "invalid_operation",
            TreeError::FoldArtifact(_) => "fold_artifact",
        }
    }
}

/// Crate-local result type.
pub type Result<T> = std::result::Result<T, TreeError>;

/// Two-dimensional point in paper coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: TmFloat,
    pub y: TmFloat,
}

impl Point {
    pub fn distance(self, other: Self) -> TmFloat {
        let dx = self.x - other.x;
        let dy = self.y - other.y;
        (dx * dx + dy * dy).sqrt()
    }
}

/// Owner reference using TreeMaker's 1-based external indices.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum OwnerRef {
    Tree,
    Node(usize),
    Path(usize),
    Poly(usize),
}

/// TreeMaker node record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub index: usize,
    pub label: String,
    pub loc: Point,
    pub depth: TmFloat,
    pub elevation: TmFloat,
    pub is_leaf: bool,
    pub is_sub: bool,
    pub is_border: bool,
    pub is_pinned: bool,
    pub is_polygon: bool,
    pub is_junction: bool,
    pub is_conditioned: bool,
    pub owned_vertices: Vec<usize>,
    pub edges: Vec<usize>,
    pub leaf_paths: Vec<usize>,
    pub owner: OwnerRef,
}

/// TreeMaker edge record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Edge {
    pub index: usize,
    pub label: String,
    pub length: TmFloat,
    pub strain: TmFloat,
    pub stiffness: TmFloat,
    pub is_pinned: bool,
    pub is_conditioned: bool,
    pub nodes: Vec<usize>,
}

impl Edge {
    /// Edge length after applying TreeMaker strain.
    pub fn strained_length(&self) -> TmFloat {
        self.length * (1.0 + self.strain)
    }
}

/// TreeMaker path record between a pair of nodes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Path {
    pub index: usize,
    pub min_tree_length: TmFloat,
    pub min_paper_length: TmFloat,
    pub act_tree_length: TmFloat,
    pub act_paper_length: TmFloat,
    pub is_leaf: bool,
    pub is_sub: bool,
    pub is_feasible: bool,
    pub is_active: bool,
    pub is_border: bool,
    pub is_polygon: bool,
    pub is_conditioned: bool,
    pub fwd_poly: Option<usize>,
    pub bkd_poly: Option<usize>,
    pub nodes: Vec<usize>,
    pub edges: Vec<usize>,
    pub outset_path: Option<usize>,
    pub front_reduction: TmFloat,
    pub back_reduction: TmFloat,
    pub min_depth: TmFloat,
    pub min_depth_dist: TmFloat,
    pub owned_vertices: Vec<usize>,
    pub owned_creases: Vec<usize>,
    pub owner: OwnerRef,
}

/// Polygon or subpolygon generated during crease-pattern construction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Poly {
    pub index: usize,
    pub centroid: Point,
    pub is_sub_poly: bool,
    pub ring_nodes: Vec<usize>,
    pub ring_paths: Vec<usize>,
    pub cross_paths: Vec<usize>,
    pub inset_nodes: Vec<usize>,
    pub spoke_paths: Vec<usize>,
    pub ridge_path: Option<usize>,
    pub node_locs: Vec<Point>,
    pub local_root_vertices: Vec<usize>,
    pub local_root_creases: Vec<usize>,
    pub owned_nodes: Vec<usize>,
    pub owned_paths: Vec<usize>,
    pub owned_polys: Vec<usize>,
    pub owned_creases: Vec<usize>,
    pub owned_facets: Vec<usize>,
    pub owner: OwnerRef,
}

/// Crease-pattern vertex.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vertex {
    pub index: usize,
    pub loc: Point,
    pub elevation: TmFloat,
    pub is_border: bool,
    pub tree_node: Option<usize>,
    pub left_pseudohinge_mate: Option<usize>,
    pub right_pseudohinge_mate: Option<usize>,
    pub creases: Vec<usize>,
    pub depth: TmFloat,
    pub discrete_depth: usize,
    pub cc_flag: i32,
    pub st_flag: i32,
    pub owner: OwnerRef,
}

/// Crease-pattern crease.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Crease {
    pub index: usize,
    pub kind: i32,
    pub vertices: Vec<usize>,
    pub fwd_facet: Option<usize>,
    pub bkd_facet: Option<usize>,
    pub fold: i32,
    pub cc_flag: i32,
    pub st_flag: i32,
    pub owner: OwnerRef,
}

/// Crease-pattern facet.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Facet {
    pub index: usize,
    pub centroid: Point,
    pub is_well_formed: bool,
    pub vertices: Vec<usize>,
    pub creases: Vec<usize>,
    pub corridor_edge: Option<usize>,
    pub head_facets: Vec<usize>,
    pub tail_facets: Vec<usize>,
    pub order: usize,
    pub color: i32,
    pub owner: OwnerRef,
}

/// TreeMaker condition wrapper.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Condition {
    pub index: usize,
    pub is_feasible: bool,
    pub kind: ConditionKind,
}

/// Supported TreeMaker condition variants.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ConditionKind {
    NodeCombo {
        node: usize,
        to_symmetry_line: bool,
        to_paper_edge: bool,
        to_paper_corner: bool,
        x_fixed: bool,
        x_fix_value: TmFloat,
        y_fixed: bool,
        y_fix_value: TmFloat,
    },
    NodeFixed {
        node: usize,
        x_fixed: bool,
        y_fixed: bool,
        x_fix_value: TmFloat,
        y_fix_value: TmFloat,
    },
    NodeOnCorner {
        node: usize,
    },
    NodeOnEdge {
        node: usize,
    },
    NodeSymmetric {
        node: usize,
    },
    NodesPaired {
        node1: usize,
        node2: usize,
    },
    NodesCollinear {
        node1: usize,
        node2: usize,
        node3: usize,
    },
    EdgeLengthFixed {
        edge: usize,
    },
    EdgesSameStrain {
        edge1: usize,
        edge2: usize,
    },
    PathCombo {
        node1: usize,
        node2: usize,
        is_angle_fixed: bool,
        angle: TmFloat,
        is_angle_quant: bool,
        quant: usize,
        quant_offset: TmFloat,
    },
    PathActive {
        node1: usize,
        node2: usize,
    },
    PathAngleFixed {
        node1: usize,
        node2: usize,
        angle: TmFloat,
    },
    PathAngleQuant {
        node1: usize,
        node2: usize,
        quant: usize,
        quant_offset: TmFloat,
    },
}

/// Complete TreeMaker model state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tree {
    pub source_version: String,
    pub paper_width: TmFloat,
    pub paper_height: TmFloat,
    pub scale: TmFloat,
    pub has_symmetry: bool,
    pub sym_loc: Point,
    pub sym_angle: TmFloat,
    pub is_feasible: bool,
    pub is_polygon_valid: bool,
    pub is_polygon_filled: bool,
    pub is_vertex_depth_valid: bool,
    pub is_facet_data_valid: bool,
    pub is_local_root_connectable: bool,
    pub needs_cleanup: bool,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    pub paths: Vec<Path>,
    pub polys: Vec<Poly>,
    pub vertices: Vec<Vertex>,
    pub creases: Vec<Crease>,
    pub facets: Vec<Facet>,
    pub conditions: Vec<Condition>,
    pub owned_nodes: Vec<usize>,
    pub owned_edges: Vec<usize>,
    pub owned_paths: Vec<usize>,
    pub owned_polys: Vec<usize>,
}

/// High-level crease-pattern status, matching TreeMaker's `GetCPStatus()`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CPStatus {
    HasFullCp,
    EdgesTooShort,
    PolysNotValid,
    PolysNotFilled,
    PolysMultipleIbps,
    VerticesLackDepth,
    FacetsNotValid,
    NotLocalRootConnectable,
}

fn cp_status_label(status: &CPStatus) -> &'static str {
    match status {
        CPStatus::HasFullCp => "has_full_cp",
        CPStatus::EdgesTooShort => "edges_too_short",
        CPStatus::PolysNotValid => "polys_not_valid",
        CPStatus::PolysNotFilled => "polys_not_filled",
        CPStatus::PolysMultipleIbps => "polys_multiple_ibps",
        CPStatus::VerticesLackDepth => "vertices_lack_depth",
        CPStatus::FacetsNotValid => "facets_not_valid",
        CPStatus::NotLocalRootConnectable => "not_local_root_connectable",
    }
}

/// Detailed crease-pattern status report with offending part IDs when available.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CPStatusReport {
    pub status: CPStatus,
    pub bad_edges: Vec<usize>,
    pub bad_polys: Vec<usize>,
    pub bad_vertices: Vec<usize>,
    pub bad_creases: Vec<usize>,
    pub bad_facets: Vec<usize>,
}

/// Stable summary of a [`Tree`] suitable for CLI/wasm output and regression tests.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TreeSummary {
    pub source_version: String,
    pub paper_width: TmFloat,
    pub paper_height: TmFloat,
    pub scale: TmFloat,
    pub has_symmetry: bool,
    pub is_feasible: bool,
    pub cp_status: CPStatus,
    pub nodes: usize,
    pub edges: usize,
    pub paths: usize,
    pub polys: usize,
    pub vertices: usize,
    pub creases: usize,
    pub facets: usize,
    pub conditions: usize,
    pub leaf_nodes: usize,
    pub leaf_paths: usize,
    pub feasible_paths: usize,
    pub active_paths: usize,
    pub border_nodes: usize,
    pub border_paths: usize,
    pub polygon_nodes: usize,
    pub polygon_paths: usize,
    pub pinned_nodes: usize,
    pub pinned_edges: usize,
    pub conditioned_nodes: usize,
    pub conditioned_edges: usize,
    pub conditioned_paths: usize,
    pub conditions_by_tag: BTreeMap<String, usize>,
}

/// User-editable document settings for a TreeMaker design.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PaperSettings {
    pub width: TmFloat,
    pub height: TmFloat,
    pub scale: TmFloat,
    pub has_symmetry: bool,
    pub sym_loc: Point,
    pub sym_angle: TmFloat,
}

/// User-editable tree node input.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DesignNode {
    pub id: usize,
    pub label: String,
    pub loc: Point,
}

/// User-editable tree edge input.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DesignEdge {
    pub id: usize,
    pub label: String,
    pub nodes: [usize; 2],
    pub length: TmFloat,
    pub strain: TmFloat,
    pub stiffness: TmFloat,
}

/// Minimal design-level input used by GUI and wasm consumers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TreeDesign {
    pub paper: PaperSettings,
    pub nodes: Vec<DesignNode>,
    pub edges: Vec<DesignEdge>,
    pub conditions: Vec<ConditionKind>,
}

/// Render/inspection snapshot of the complete current tree state.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TreeSnapshot {
    pub summary: TreeSummary,
    pub cp_status_report: CPStatusReport,
    pub paper: PaperSettings,
    pub nodes: Vec<NodeSnapshot>,
    pub edges: Vec<EdgeSnapshot>,
    pub paths: Vec<PathSnapshot>,
    pub polys: Vec<PolySnapshot>,
    pub vertices: Vec<VertexSnapshot>,
    pub creases: Vec<CreaseSnapshot>,
    pub facets: Vec<FacetSnapshot>,
    pub conditions: Vec<Condition>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NodeSnapshot {
    pub id: usize,
    pub label: String,
    pub loc: Point,
    pub depth: TmFloat,
    pub elevation: TmFloat,
    pub is_leaf: bool,
    pub is_sub: bool,
    pub is_border: bool,
    pub is_pinned: bool,
    pub is_polygon: bool,
    pub is_junction: bool,
    pub is_conditioned: bool,
    pub edges: Vec<usize>,
    pub leaf_paths: Vec<usize>,
    pub owner: OwnerRef,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EdgeSnapshot {
    pub id: usize,
    pub label: String,
    pub nodes: Vec<usize>,
    pub length: TmFloat,
    pub strain: TmFloat,
    pub stiffness: TmFloat,
    pub strained_length: TmFloat,
    pub is_pinned: bool,
    pub is_conditioned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PathSnapshot {
    pub id: usize,
    pub nodes: Vec<usize>,
    pub edges: Vec<usize>,
    pub min_tree_length: TmFloat,
    pub min_paper_length: TmFloat,
    pub act_tree_length: TmFloat,
    pub act_paper_length: TmFloat,
    pub is_leaf: bool,
    pub is_sub: bool,
    pub is_feasible: bool,
    pub is_active: bool,
    pub is_border: bool,
    pub is_polygon: bool,
    pub is_conditioned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PolySnapshot {
    pub id: usize,
    pub centroid: Point,
    pub is_sub_poly: bool,
    pub ring_nodes: Vec<usize>,
    pub ring_paths: Vec<usize>,
    pub owned_nodes: Vec<usize>,
    pub owned_paths: Vec<usize>,
    pub owned_polys: Vec<usize>,
    pub owned_creases: Vec<usize>,
    pub owned_facets: Vec<usize>,
    pub owner: OwnerRef,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VertexSnapshot {
    pub id: usize,
    pub loc: Point,
    pub elevation: TmFloat,
    pub is_border: bool,
    pub tree_node: Option<usize>,
    pub creases: Vec<usize>,
    pub depth: TmFloat,
    pub discrete_depth: usize,
    pub owner: OwnerRef,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CreaseSnapshot {
    pub id: usize,
    pub kind: i32,
    pub vertices: Vec<usize>,
    pub fwd_facet: Option<usize>,
    pub bkd_facet: Option<usize>,
    pub fold: i32,
    pub owner: OwnerRef,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FacetSnapshot {
    pub id: usize,
    pub centroid: Point,
    pub is_well_formed: bool,
    pub vertices: Vec<usize>,
    pub creases: Vec<usize>,
    pub corridor_edge: Option<usize>,
    pub head_facets: Vec<usize>,
    pub tail_facets: Vec<usize>,
    pub order: usize,
    pub color: i32,
    pub owner: OwnerRef,
}

/// Folded-base vertex projected into TreeMaker's uniaxial base coordinates.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FoldedBaseVertex {
    pub id: usize,
    pub source_vertex: usize,
    pub loc: Point,
    pub paper_loc: Point,
    pub depth: TmFloat,
    pub elevation: TmFloat,
    pub is_border: bool,
}

/// Folded-base crease projected into TreeMaker's uniaxial base coordinates.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FoldedBaseCrease {
    pub id: usize,
    pub source_crease: usize,
    pub vertices: [usize; 2],
    pub kind: i32,
    pub fold: i32,
}

/// Folded-base facet projected into TreeMaker's uniaxial base coordinates.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FoldedBaseFacet {
    pub id: usize,
    pub source_facet: usize,
    pub vertices: Vec<usize>,
    pub color: i32,
    pub order: usize,
}

/// TreeMaker folded-form geometry, matching the original app's side-view base.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FoldedBaseSnapshot {
    pub vertices: Vec<FoldedBaseVertex>,
    pub creases: Vec<FoldedBaseCrease>,
    pub facets: Vec<FoldedBaseFacet>,
}

/// Complete folded-form/export artifacts for UI and simulator consumers.
///
/// The triangulated simulation mesh is *not* here: it is built from `fold` by
/// `packages/origami-simulator`, which is the only implementation of that step
/// and the one the solver actually runs on. What survives is
/// `simulation_model_error`, which answers a question only this engine can:
/// whether TreeMaker has produced a complete enough crease pattern to simulate
/// at all.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FoldArtifacts {
    pub fold: treemaker_fold::FoldDocument,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folded_base: Option<FoldedBaseSnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folded_base_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub simulation_model_error: Option<String>,
}

/// User-intent edit operation for GUI and wasm consumers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TreeEdit {
    MoveNode {
        id: usize,
        loc: Point,
    },
    AddNode {
        loc: Point,
        label: Option<String>,
        connect_to: Option<usize>,
        edge_length: Option<TmFloat>,
    },
    DeleteNode {
        id: usize,
    },
    UpdateNodeLabel {
        id: usize,
        label: String,
    },
    AddEdge {
        node1: usize,
        node2: usize,
        label: Option<String>,
        length: Option<TmFloat>,
    },
    DeleteEdge {
        id: usize,
    },
    UpdateEdge {
        id: usize,
        label: Option<String>,
        length: Option<TmFloat>,
        strain: Option<TmFloat>,
        stiffness: Option<TmFloat>,
    },
    UpdatePaper {
        width: TmFloat,
        height: TmFloat,
        scale: Option<TmFloat>,
    },
    SetSymmetry {
        has_symmetry: bool,
        sym_loc: Option<Point>,
        sym_angle: Option<TmFloat>,
    },
    AddCondition {
        kind: ConditionKind,
    },
    UpdateCondition {
        id: usize,
        kind: ConditionKind,
    },
    DeleteCondition {
        id: usize,
    },
    MakeRoot {
        node: usize,
    },
    SplitEdge {
        edge: usize,
        distance: TmFloat,
    },
    SetEdgeLengths {
        edges: Vec<usize>,
        length: TmFloat,
    },
    ScaleEdgeLengths {
        edges: Vec<usize>,
        factor: TmFloat,
    },
    RenormalizeToEdge {
        edge: usize,
    },
    RenormalizeToUnitScale,
    AbsorbNodes {
        nodes: Vec<usize>,
    },
    AbsorbRedundantNodes,
    AbsorbEdges {
        edges: Vec<usize>,
    },
    PerturbNodes {
        nodes: Vec<usize>,
    },
    PerturbAllNodes,
    RemoveStrain {
        edges: Vec<usize>,
    },
    RemoveAllStrain,
    RelieveStrain {
        edges: Vec<usize>,
    },
    RelieveAllStrain,
    AddLargestStubForNodes {
        nodes: Vec<usize>,
    },
    AddLargestStubForPoly {
        poly: usize,
    },
    TriangulateTree,
}

/// Result of applying a user-intent edit.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EditReport {
    pub snapshot: TreeSnapshot,
    pub created_node: Option<usize>,
    pub created_edge: Option<usize>,
}

/// Report returned by optimization operations.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OptimizationReport {
    pub kind: OptimizationKind,
    pub converged: bool,
    pub old_scale: TmFloat,
    pub new_scale: TmFloat,
    pub is_feasible: bool,
    pub message: String,
}

/// Optimizer kind used for an [`OptimizationReport`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OptimizationKind {
    Scale,
    Edge,
    Strain,
}

#[derive(Debug, Clone)]
struct RootNetwork {
    discrete_depth: usize,
    is_connectable: bool,
    cc_vertices: Vec<usize>,
    cc_creases: Vec<usize>,
    cc_polys: Vec<usize>,
    st_vertices: Vec<usize>,
    st_creases: Vec<usize>,
    cc0: Vec<usize>,
    cc1: Vec<usize>,
    cc2_st1: Vec<usize>,
    cc2_st2: Vec<usize>,
}

impl RootNetwork {
    fn new(discrete_depth: usize) -> Self {
        Self {
            discrete_depth,
            is_connectable: false,
            cc_vertices: Vec::new(),
            cc_creases: Vec::new(),
            cc_polys: Vec::new(),
            st_vertices: Vec::new(),
            st_creases: Vec::new(),
            cc0: Vec::new(),
            cc1: Vec::new(),
            cc2_st1: Vec::new(),
            cc2_st2: Vec::new(),
        }
    }
}

impl CPStatusReport {
    fn new(status: CPStatus) -> Self {
        Self {
            status,
            bad_edges: Vec::new(),
            bad_polys: Vec::new(),
            bad_vertices: Vec::new(),
            bad_creases: Vec::new(),
            bad_facets: Vec::new(),
        }
    }

    fn with_bad_edges(mut self, bad_edges: Vec<usize>) -> Self {
        self.bad_edges = bad_edges;
        self
    }

    fn with_bad_polys(mut self, bad_polys: Vec<usize>) -> Self {
        self.bad_polys = bad_polys;
        self
    }

    fn with_bad_vertices(mut self, bad_vertices: Vec<usize>) -> Self {
        self.bad_vertices = bad_vertices;
        self
    }

    fn with_bad_creases(mut self, bad_creases: Vec<usize>) -> Self {
        self.bad_creases = bad_creases;
        self
    }

    fn with_bad_facets(mut self, bad_facets: Vec<usize>) -> Self {
        self.bad_facets = bad_facets;
        self
    }
}

impl Tree {
    /// Parse a TreeMaker v3, v4, or v5 document from its ASCII stream format.
    pub fn from_tmd_str(input: &str) -> Result<Self> {
        let mut reader = Reader::new(input);
        reader.expect_tag("tree")?;
        let version = reader.read_token("version")?;
        let tree = match version.as_str() {
            "4.0" => {
                let mut tree = Self::read_v4(&mut reader, version)?;
                tree.validate()?;
                tree.cleanup_after_edit();
                tree
            }
            "5.0" => {
                let tree = Self::read_v5(&mut reader, version)?;
                tree.validate()?;
                tree
            }
            "3.0" => {
                let mut tree = Self::read_v3(&mut reader, version)?;
                tree.validate()?;
                tree.cleanup_after_edit();
                tree
            }
            _ => return Err(TreeError::UnsupportedVersion(version)),
        };
        Ok(tree)
    }

    /// Create a new empty editable design with TreeMaker defaults.
    pub fn new_design(paper_width: TmFloat, paper_height: TmFloat) -> Result<Self> {
        Self::from_design(TreeDesign {
            paper: PaperSettings {
                width: paper_width,
                height: paper_height,
                scale: 0.1,
                has_symmetry: false,
                sym_loc: Point { x: 0.5, y: 0.0 },
                sym_angle: 90.0,
            },
            nodes: Vec::new(),
            edges: Vec::new(),
            conditions: Vec::new(),
        })
    }

    /// Build a complete TreeMaker model from user-editable design input.
    pub fn from_design(design: TreeDesign) -> Result<Self> {
        validate_paper_settings(&design.paper)?;
        validate_contiguous_ids("node", design.nodes.iter().map(|node| node.id))?;
        validate_contiguous_ids("edge", design.edges.iter().map(|edge| edge.id))?;

        let nodes = design
            .nodes
            .into_iter()
            .map(|node| Node {
                index: node.id,
                label: node.label,
                loc: node.loc,
                depth: DEPTH_NOT_SET,
                elevation: 0.0,
                is_leaf: false,
                is_sub: false,
                is_border: false,
                is_pinned: false,
                is_polygon: false,
                is_junction: false,
                is_conditioned: false,
                owned_vertices: Vec::new(),
                edges: Vec::new(),
                leaf_paths: Vec::new(),
                owner: OwnerRef::Tree,
            })
            .collect::<Vec<_>>();
        let edges = design
            .edges
            .into_iter()
            .map(|edge| Edge {
                index: edge.id,
                label: edge.label,
                length: edge.length,
                strain: edge.strain,
                stiffness: edge.stiffness,
                is_pinned: false,
                is_conditioned: false,
                nodes: edge.nodes.to_vec(),
            })
            .collect::<Vec<_>>();
        let conditions = design
            .conditions
            .into_iter()
            .enumerate()
            .map(|(index, kind)| Condition {
                index: index + 1,
                is_feasible: true,
                kind,
            })
            .collect::<Vec<_>>();

        let mut tree = Self {
            source_version: "5.0".to_string(),
            paper_width: design.paper.width,
            paper_height: design.paper.height,
            scale: design.paper.scale,
            has_symmetry: design.paper.has_symmetry,
            sym_loc: design.paper.sym_loc,
            sym_angle: design.paper.sym_angle,
            is_feasible: false,
            is_polygon_valid: false,
            is_polygon_filled: false,
            is_vertex_depth_valid: false,
            is_facet_data_valid: false,
            is_local_root_connectable: false,
            needs_cleanup: true,
            nodes,
            edges,
            paths: Vec::new(),
            polys: Vec::new(),
            vertices: Vec::new(),
            creases: Vec::new(),
            facets: Vec::new(),
            conditions,
            owned_nodes: Vec::new(),
            owned_edges: Vec::new(),
            owned_paths: Vec::new(),
            owned_polys: Vec::new(),
        };
        tree.rebuild_tree_paths()?;
        tree.validate()?;
        tree.cleanup_after_edit();
        Ok(tree)
    }

    /// Return only the user-editable design inputs for this tree.
    pub fn to_design(&self) -> TreeDesign {
        TreeDesign {
            paper: self.paper_settings(),
            nodes: self
                .owned_nodes
                .iter()
                .copied()
                .filter_map(|id| self.nodes.get(id.saturating_sub(1)))
                .map(|node| DesignNode {
                    id: node.index,
                    label: node.label.clone(),
                    loc: node.loc,
                })
                .collect(),
            edges: self
                .owned_edges
                .iter()
                .copied()
                .filter_map(|id| self.edges.get(id.saturating_sub(1)))
                .filter_map(|edge| {
                    let nodes: [usize; 2] = edge.nodes.as_slice().try_into().ok()?;
                    Some(DesignEdge {
                        id: edge.index,
                        label: edge.label.clone(),
                        nodes,
                        length: edge.length,
                        strain: edge.strain,
                        stiffness: edge.stiffness,
                    })
                })
                .collect(),
            conditions: self
                .conditions
                .iter()
                .map(|condition| condition.kind.clone())
                .collect(),
        }
    }

    /// Return a render-friendly snapshot of user input and generated state.
    pub fn snapshot(&self) -> TreeSnapshot {
        TreeSnapshot {
            summary: self.summary(),
            cp_status_report: self.cp_status_report(),
            paper: self.paper_settings(),
            nodes: self
                .nodes
                .iter()
                .map(|node| NodeSnapshot {
                    id: node.index,
                    label: node.label.clone(),
                    loc: node.loc,
                    depth: node.depth,
                    elevation: node.elevation,
                    is_leaf: node.is_leaf,
                    is_sub: node.is_sub,
                    is_border: node.is_border,
                    is_pinned: node.is_pinned,
                    is_polygon: node.is_polygon,
                    is_junction: node.is_junction,
                    is_conditioned: node.is_conditioned,
                    edges: node.edges.clone(),
                    leaf_paths: node.leaf_paths.clone(),
                    owner: node.owner.clone(),
                })
                .collect(),
            edges: self
                .edges
                .iter()
                .map(|edge| EdgeSnapshot {
                    id: edge.index,
                    label: edge.label.clone(),
                    nodes: edge.nodes.clone(),
                    length: edge.length,
                    strain: edge.strain,
                    stiffness: edge.stiffness,
                    strained_length: edge.strained_length(),
                    is_pinned: edge.is_pinned,
                    is_conditioned: edge.is_conditioned,
                })
                .collect(),
            paths: self
                .paths
                .iter()
                .map(|path| PathSnapshot {
                    id: path.index,
                    nodes: path.nodes.clone(),
                    edges: path.edges.clone(),
                    min_tree_length: path.min_tree_length,
                    min_paper_length: path.min_paper_length,
                    act_tree_length: path.act_tree_length,
                    act_paper_length: path.act_paper_length,
                    is_leaf: path.is_leaf,
                    is_sub: path.is_sub,
                    is_feasible: path.is_feasible,
                    is_active: path.is_active,
                    is_border: path.is_border,
                    is_polygon: path.is_polygon,
                    is_conditioned: path.is_conditioned,
                })
                .collect(),
            polys: self
                .polys
                .iter()
                .map(|poly| PolySnapshot {
                    id: poly.index,
                    centroid: poly.centroid,
                    is_sub_poly: poly.is_sub_poly,
                    ring_nodes: poly.ring_nodes.clone(),
                    ring_paths: poly.ring_paths.clone(),
                    owned_nodes: poly.owned_nodes.clone(),
                    owned_paths: poly.owned_paths.clone(),
                    owned_polys: poly.owned_polys.clone(),
                    owned_creases: poly.owned_creases.clone(),
                    owned_facets: poly.owned_facets.clone(),
                    owner: poly.owner.clone(),
                })
                .collect(),
            vertices: self
                .vertices
                .iter()
                .map(|vertex| VertexSnapshot {
                    id: vertex.index,
                    loc: vertex.loc,
                    elevation: vertex.elevation,
                    is_border: vertex.is_border,
                    tree_node: vertex.tree_node,
                    creases: vertex.creases.clone(),
                    depth: vertex.depth,
                    discrete_depth: vertex.discrete_depth,
                    owner: vertex.owner.clone(),
                })
                .collect(),
            creases: self
                .creases
                .iter()
                .map(|crease| CreaseSnapshot {
                    id: crease.index,
                    kind: crease.kind,
                    vertices: crease.vertices.clone(),
                    fwd_facet: crease.fwd_facet,
                    bkd_facet: crease.bkd_facet,
                    fold: crease.fold,
                    owner: crease.owner.clone(),
                })
                .collect(),
            facets: self
                .facets
                .iter()
                .map(|facet| FacetSnapshot {
                    id: facet.index,
                    centroid: facet.centroid,
                    is_well_formed: facet.is_well_formed,
                    vertices: facet.vertices.clone(),
                    creases: facet.creases.clone(),
                    corridor_edge: facet.corridor_edge,
                    head_facets: facet.head_facets.clone(),
                    tail_facets: facet.tail_facets.clone(),
                    order: facet.order,
                    color: facet.color,
                    owner: facet.owner.clone(),
                })
                .collect(),
            conditions: self.conditions.clone(),
        }
    }

    /// Export the current crease pattern as a generic FOLD document.
    pub fn to_fold_document(&self) -> Result<treemaker_fold::FoldDocument> {
        if self.vertices.is_empty() || self.creases.is_empty() || self.facets.is_empty() {
            return Err(TreeError::InvalidOperation(
                "build a crease pattern before exporting FOLD artifacts",
            ));
        }

        let vertices_coords = self
            .vertices
            .iter()
            .map(|vertex| vec![vertex.loc.x, self.paper_height - vertex.loc.y])
            .collect::<Vec<_>>();
        let edges_vertices = self
            .creases
            .iter()
            .map(|crease| {
                [
                    crease.vertices[0].saturating_sub(1),
                    crease.vertices[1].saturating_sub(1),
                ]
            })
            .collect::<Vec<_>>();
        let edges_assignment = self
            .creases
            .iter()
            .map(|crease| match crease.fold {
                FOLD_MOUNTAIN => treemaker_fold::Assignment::Mountain,
                FOLD_VALLEY => treemaker_fold::Assignment::Valley,
                FOLD_BORDER => treemaker_fold::Assignment::Boundary,
                FOLD_FLAT => treemaker_fold::Assignment::Flat,
                _ => treemaker_fold::Assignment::Unassigned,
            })
            .collect::<Vec<_>>();
        let edges_fold_angle = edges_assignment
            .iter()
            .copied()
            .map(treemaker_fold::FoldAngle::default_for_assignment)
            .collect::<Vec<_>>();
        let faces_vertices = self
            .facets
            .iter()
            .map(|facet| {
                facet
                    .vertices
                    .iter()
                    .map(|vertex| vertex.saturating_sub(1))
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();

        let mut fold = treemaker_fold::FoldDocument::new(vertices_coords, edges_vertices);
        fold.file_creator = Some("treemaker-rs".to_string());
        fold.frame_title = Some("TreeMaker crease pattern".to_string());
        fold.frame_classes = vec!["creasePattern".to_string()];
        fold.edges_assignment = edges_assignment;
        fold.edges_fold_angle = edges_fold_angle;
        fold.faces_vertices = faces_vertices;
        fold.face_orders = self
            .facets
            .iter()
            .flat_map(|facet| {
                facet
                    .head_facets
                    .iter()
                    .map(move |head| [(facet.index - 1) as i64, (head - 1) as i64, 1])
            })
            .collect();
        fold.extra.insert(
            "tm:vertexSourceIds".to_string(),
            serde_json::to_value(self.vertices.iter().map(|v| v.index).collect::<Vec<_>>())
                .map_err(|error| TreeError::FoldArtifact(error.to_string()))?,
        );
        fold.extra.insert(
            "tm:creaseSourceIds".to_string(),
            serde_json::to_value(self.creases.iter().map(|c| c.index).collect::<Vec<_>>())
                .map_err(|error| TreeError::FoldArtifact(error.to_string()))?,
        );
        fold.extra.insert(
            "tm:facetSourceIds".to_string(),
            serde_json::to_value(self.facets.iter().map(|f| f.index).collect::<Vec<_>>())
                .map_err(|error| TreeError::FoldArtifact(error.to_string()))?,
        );
        fold.extra.insert(
            "tm:creaseKinds".to_string(),
            serde_json::to_value(self.creases.iter().map(|c| c.kind).collect::<Vec<_>>())
                .map_err(|error| TreeError::FoldArtifact(error.to_string()))?,
        );
        fold.extra.insert(
            "tm:facetColors".to_string(),
            serde_json::to_value(self.facets.iter().map(|f| f.color).collect::<Vec<_>>())
                .map_err(|error| TreeError::FoldArtifact(error.to_string()))?,
        );
        fold.extra.insert(
            "tm:facetOrder".to_string(),
            serde_json::to_value(self.facets.iter().map(|f| f.order).collect::<Vec<_>>())
                .map_err(|error| TreeError::FoldArtifact(error.to_string()))?,
        );

        fold.faces_edges = treemaker_fold::build_faces_edges(&fold)
            .map_err(|error| TreeError::FoldArtifact(error.to_string()))?;
        fold.edges_faces = treemaker_fold::build_edges_faces(&fold)
            .map_err(|error| TreeError::FoldArtifact(error.to_string()))?;
        Ok(fold)
    }

    /// Return the folded base in TreeMaker's original side-view coordinates.
    pub fn folded_base_snapshot(&self) -> Result<FoldedBaseSnapshot> {
        if !self.is_vertex_depth_valid {
            return Err(TreeError::InvalidOperation(
                "build a crease pattern with valid vertex depths before viewing the folded base",
            ));
        }

        Ok(FoldedBaseSnapshot {
            vertices: self
                .vertices
                .iter()
                .map(|vertex| FoldedBaseVertex {
                    id: vertex.index,
                    source_vertex: vertex.index,
                    loc: Point {
                        x: vertex.elevation,
                        y: vertex.depth,
                    },
                    paper_loc: vertex.loc,
                    depth: vertex.depth,
                    elevation: vertex.elevation,
                    is_border: vertex.is_border,
                })
                .collect(),
            creases: self
                .creases
                .iter()
                .filter_map(|crease| {
                    if crease.vertices.len() != 2 {
                        return None;
                    }
                    Some(FoldedBaseCrease {
                        id: crease.index,
                        source_crease: crease.index,
                        vertices: [crease.vertices[0], crease.vertices[1]],
                        kind: crease.kind,
                        fold: crease.fold,
                    })
                })
                .collect(),
            facets: self
                .facets
                .iter()
                .map(|facet| FoldedBaseFacet {
                    id: facet.index,
                    source_facet: facet.index,
                    vertices: facet.vertices.clone(),
                    color: facet.color,
                    order: facet.order,
                })
                .collect(),
        })
    }

    /// Return all fold-related artifacts used by UI, export, and simulation surfaces.
    pub fn fold_artifacts(&self) -> Result<FoldArtifacts> {
        let fold = self.to_fold_document()?;
        let (folded_base, folded_base_error) = match self.folded_base_snapshot() {
            Ok(snapshot) => (Some(snapshot), None),
            Err(error) => (None, Some(error.to_string())),
        };
        // Whether the mesh itself can be built is the simulator's question, and
        // it answers it from `fold`. This one is ours: a partial crease pattern
        // has nothing worth handing over.
        let simulation_model_error =
            (self.cp_status() != CPStatus::HasFullCp).then(|| self.simulation_unavailable_error());
        Ok(FoldArtifacts {
            fold,
            folded_base,
            folded_base_error,
            simulation_model_error,
        })
    }

    fn simulation_unavailable_error(&self) -> String {
        let report = self.cp_status_report();
        let mut parts = vec![format!(
            "simulation requires a full crease pattern; current status is {}",
            cp_status_label(&report.status)
        )];
        if !report.bad_vertices.is_empty() {
            parts.push(format!("bad vertices {:?}", report.bad_vertices));
        }
        if !report.bad_facets.is_empty() {
            parts.push(format!("bad facets {:?}", report.bad_facets));
        }
        if !report.bad_creases.is_empty() {
            parts.push(format!("bad creases {:?}", report.bad_creases));
        }
        if !report.bad_polys.is_empty() {
            parts.push(format!("bad polygons {:?}", report.bad_polys));
        }
        if !report.bad_edges.is_empty() {
            parts.push(format!("bad edges {:?}", report.bad_edges));
        }
        parts.join("; ")
    }

    /// Apply a user-intent edit while preserving TreeMaker invariants.
    pub fn apply_edit(&mut self, edit: TreeEdit) -> Result<EditReport> {
        let before = self.clone();
        let mut created_node = None;
        let mut created_edge = None;
        let mut topology_changed = false;
        let mut generated_geometry_stale = false;
        let requires_design_only = matches!(
            edit,
            TreeEdit::AddNode { .. }
                | TreeEdit::DeleteNode { .. }
                | TreeEdit::AddEdge { .. }
                | TreeEdit::DeleteEdge { .. }
                | TreeEdit::MakeRoot { .. }
                | TreeEdit::SplitEdge { .. }
                | TreeEdit::SetEdgeLengths { .. }
                | TreeEdit::ScaleEdgeLengths { .. }
                | TreeEdit::RenormalizeToEdge { .. }
                | TreeEdit::RenormalizeToUnitScale
                | TreeEdit::AbsorbNodes { .. }
                | TreeEdit::AbsorbRedundantNodes
                | TreeEdit::AbsorbEdges { .. }
                | TreeEdit::PerturbNodes { .. }
                | TreeEdit::PerturbAllNodes
                | TreeEdit::RemoveStrain { .. }
                | TreeEdit::RemoveAllStrain
                | TreeEdit::RelieveStrain { .. }
                | TreeEdit::RelieveAllStrain
                | TreeEdit::AddLargestStubForNodes { .. }
                | TreeEdit::AddLargestStubForPoly { .. }
                | TreeEdit::TriangulateTree
        );

        let result = (|| -> Result<()> {
            if requires_design_only && self.has_generated_parts() {
                self.reset_to_design_state()?;
            }

            match edit {
                TreeEdit::MoveNode { id, loc } => {
                    let node = self.node_mut(id)?;
                    node.loc = loc;
                    generated_geometry_stale = true;
                }
                TreeEdit::AddNode {
                    loc,
                    label,
                    connect_to,
                    edge_length,
                } => {
                    if self.nodes.is_empty() && connect_to.is_some() {
                        return Err(TreeError::InvalidOperation(
                            "cannot connect the first node to another node",
                        ));
                    }
                    if !self.nodes.is_empty() && connect_to.is_none() {
                        return Err(TreeError::InvalidOperation(
                            "new nodes after the first must connect to an existing node",
                        ));
                    }
                    let node_id = self.nodes.len() + 1;
                    self.nodes.push(Node {
                        index: node_id,
                        label: label.unwrap_or_else(|| format!("n{node_id}")),
                        loc,
                        depth: DEPTH_NOT_SET,
                        elevation: 0.0,
                        is_leaf: false,
                        is_sub: false,
                        is_border: false,
                        is_pinned: false,
                        is_polygon: false,
                        is_junction: false,
                        is_conditioned: false,
                        owned_vertices: Vec::new(),
                        edges: Vec::new(),
                        leaf_paths: Vec::new(),
                        owner: OwnerRef::Tree,
                    });
                    self.owned_nodes.push(node_id);
                    created_node = Some(node_id);
                    if let Some(connect_to) = connect_to {
                        self.check_ref("node", connect_to, self.nodes.len())?;
                        let edge_id = self.edges.len() + 1;
                        self.edges.push(Edge {
                            index: edge_id,
                            label: format!("e{edge_id}"),
                            length: edge_length.unwrap_or(1.0),
                            strain: 0.0,
                            stiffness: 1.0,
                            is_pinned: false,
                            is_conditioned: false,
                            nodes: vec![connect_to, node_id],
                        });
                        self.owned_edges.push(edge_id);
                        created_edge = Some(edge_id);
                    }
                    topology_changed = true;
                }
                TreeEdit::DeleteNode { id } => {
                    self.check_ref("node", id, self.nodes.len())?;
                    self.delete_design_node(id);
                    topology_changed = true;
                }
                TreeEdit::UpdateNodeLabel { id, label } => {
                    self.node_mut(id)?.label = label;
                }
                TreeEdit::AddEdge {
                    node1,
                    node2,
                    label,
                    length,
                } => {
                    self.check_ref("node", node1, self.nodes.len())?;
                    self.check_ref("node", node2, self.nodes.len())?;
                    if node1 == node2 {
                        return Err(TreeError::InvalidOperation(
                            "edge endpoints must be different nodes",
                        ));
                    }
                    let edge_id = self.edges.len() + 1;
                    self.edges.push(Edge {
                        index: edge_id,
                        label: label.unwrap_or_else(|| format!("e{edge_id}")),
                        length: length.unwrap_or(1.0),
                        strain: 0.0,
                        stiffness: 1.0,
                        is_pinned: false,
                        is_conditioned: false,
                        nodes: vec![node1, node2],
                    });
                    self.owned_edges.push(edge_id);
                    created_edge = Some(edge_id);
                    topology_changed = true;
                }
                TreeEdit::DeleteEdge { id } => {
                    self.check_ref("edge", id, self.edges.len())?;
                    self.delete_design_edge(id);
                    topology_changed = true;
                }
                TreeEdit::UpdateEdge {
                    id,
                    label,
                    length,
                    strain,
                    stiffness,
                } => {
                    let edge = self.edge_mut(id)?;
                    if let Some(label) = label {
                        edge.label = label;
                    }
                    if let Some(length) = length {
                        validate_positive("edge length", length)?;
                        edge.length = length;
                        generated_geometry_stale = true;
                    }
                    if let Some(strain) = strain {
                        edge.strain = strain;
                        generated_geometry_stale = true;
                    }
                    if let Some(stiffness) = stiffness {
                        edge.stiffness = stiffness;
                        generated_geometry_stale = true;
                    }
                }
                TreeEdit::UpdatePaper {
                    width,
                    height,
                    scale,
                } => {
                    validate_positive("paper width", width)?;
                    validate_positive("paper height", height)?;
                    if let Some(scale) = scale {
                        validate_positive("scale", scale)?;
                        self.scale = scale;
                    }
                    self.paper_width = width;
                    self.paper_height = height;
                    generated_geometry_stale = true;
                }
                TreeEdit::SetSymmetry {
                    has_symmetry,
                    sym_loc,
                    sym_angle,
                } => {
                    self.has_symmetry = has_symmetry;
                    if let Some(sym_loc) = sym_loc {
                        self.sym_loc = sym_loc;
                    }
                    if let Some(sym_angle) = sym_angle {
                        self.sym_angle = sym_angle;
                    }
                    generated_geometry_stale = true;
                }
                TreeEdit::AddCondition { kind } => {
                    push_condition(&mut self.conditions, kind);
                    generated_geometry_stale = true;
                }
                TreeEdit::UpdateCondition { id, kind } => {
                    let max = self.conditions.len();
                    let condition = self.conditions.get_mut(id.saturating_sub(1)).ok_or(
                        TreeError::BadReference {
                            kind: "condition",
                            index: id,
                            max,
                        },
                    )?;
                    condition.kind = kind;
                    generated_geometry_stale = true;
                }
                TreeEdit::DeleteCondition { id } => {
                    if id == 0 || id > self.conditions.len() {
                        return Err(TreeError::BadReference {
                            kind: "condition",
                            index: id,
                            max: self.conditions.len(),
                        });
                    }
                    self.conditions.remove(id - 1);
                    generated_geometry_stale = true;
                }
                TreeEdit::MakeRoot { node } => {
                    self.make_node_root(node)?;
                    topology_changed = true;
                }
                TreeEdit::SplitEdge { edge, distance } => {
                    created_node = Some(self.split_design_edge(edge, distance)?);
                    created_edge = Some(self.edges.len());
                    topology_changed = true;
                }
                TreeEdit::SetEdgeLengths { edges, length } => {
                    validate_positive("edge length", length)?;
                    for edge_id in &edges {
                        let edge = self.edge_mut(*edge_id)?;
                        edge.length = length;
                        edge.strain = 0.0;
                    }
                    generated_geometry_stale = true;
                }
                TreeEdit::ScaleEdgeLengths { edges, factor } => {
                    validate_positive("scale factor", factor)?;
                    for edge_id in &edges {
                        self.edge_mut(*edge_id)?.length *= factor;
                    }
                    generated_geometry_stale = true;
                }
                TreeEdit::RenormalizeToEdge { edge } => {
                    let length = self.edge_mut(edge)?.length;
                    validate_positive("edge length", length)?;
                    self.scale_tree_lengths(1.0 / length)?;
                    generated_geometry_stale = true;
                }
                TreeEdit::RenormalizeToUnitScale => {
                    self.scale_tree_lengths(self.scale)?;
                    generated_geometry_stale = true;
                }
                TreeEdit::AbsorbNodes { nodes } => {
                    let mut ids = nodes;
                    ids.sort_unstable_by(|a, b| b.cmp(a));
                    for node in ids {
                        self.absorb_design_node(node)?;
                        self.rebuild_tree_paths()?;
                        self.cleanup_after_edit();
                    }
                    topology_changed = true;
                }
                TreeEdit::AbsorbRedundantNodes => {
                    loop {
                        self.rebuild_tree_paths()?;
                        self.cleanup_after_edit();
                        let node = self
                            .nodes
                            .iter()
                            .rev()
                            .find(|node| !node.is_leaf && node.edges.len() == 2)
                            .map(|node| node.index);
                        let Some(node) = node else { break };
                        self.absorb_design_node(node)?;
                    }
                    topology_changed = true;
                }
                TreeEdit::AbsorbEdges { edges } => {
                    let mut ids = edges;
                    ids.sort_unstable_by(|a, b| b.cmp(a));
                    for edge in ids {
                        self.absorb_design_edge(edge)?;
                        self.rebuild_tree_paths()?;
                        self.cleanup_after_edit();
                    }
                    topology_changed = true;
                }
                TreeEdit::PerturbNodes { nodes } => {
                    self.perturb_design_nodes(&nodes)?;
                    generated_geometry_stale = true;
                }
                TreeEdit::PerturbAllNodes => {
                    let nodes = self.owned_nodes.clone();
                    self.perturb_design_nodes(&nodes)?;
                    generated_geometry_stale = true;
                }
                TreeEdit::RemoveStrain { edges } => {
                    for edge in edges {
                        self.edge_mut(edge)?.strain = 0.0;
                    }
                    generated_geometry_stale = true;
                }
                TreeEdit::RemoveAllStrain => {
                    for edge in &mut self.edges {
                        edge.strain = 0.0;
                    }
                    generated_geometry_stale = true;
                }
                TreeEdit::RelieveStrain { edges } => {
                    for edge_id in edges {
                        let edge = self.edge_mut(edge_id)?;
                        edge.length = edge.strained_length();
                        edge.strain = 0.0;
                    }
                    generated_geometry_stale = true;
                }
                TreeEdit::RelieveAllStrain => {
                    for edge in &mut self.edges {
                        edge.length = edge.strained_length();
                        edge.strain = 0.0;
                    }
                    generated_geometry_stale = true;
                }
                TreeEdit::AddLargestStubForNodes { .. }
                | TreeEdit::AddLargestStubForPoly { .. }
                | TreeEdit::TriangulateTree => {
                    return Err(TreeError::UnsupportedOperation(
                        "TreeMaker stub-finder triangulation has not been ported yet",
                    ));
                }
            }

            if topology_changed || generated_geometry_stale {
                self.reset_to_design_state()?;
            } else {
                self.validate()?;
                self.cleanup_after_edit();
            }
            Ok(())
        })();

        if let Err(error) = result {
            *self = before;
            return Err(error);
        }

        Ok(EditReport {
            snapshot: self.snapshot(),
            created_node,
            created_edge,
        })
    }

    /// Serialize this tree to canonical TreeMaker v5 text.
    pub fn to_tmd5_string(&self) -> String {
        let mut out = Writer::new(10, "\n");
        out.s("tree");
        out.s("5.0");
        out.f(self.paper_width);
        out.f(self.paper_height);
        out.f(self.scale);
        out.b(self.has_symmetry);
        out.point(self.sym_loc);
        out.f(self.sym_angle);
        out.b(self.is_feasible);
        out.b(self.is_polygon_valid);
        out.b(self.is_polygon_filled);
        out.b(self.is_vertex_depth_valid);
        out.b(self.is_facet_data_valid);
        out.b(self.is_local_root_connectable);
        out.b(self.needs_cleanup);
        out.u(self.nodes.len());
        out.u(self.edges.len());
        out.u(self.paths.len());
        out.u(self.polys.len());
        out.u(self.vertices.len());
        out.u(self.creases.len());
        out.u(self.facets.len());
        out.u(self.conditions.len());

        for node in &self.nodes {
            out.node_v5(node);
        }
        for edge in &self.edges {
            out.edge(edge);
        }
        for path in &self.paths {
            out.path_v5(path);
        }
        for poly in &self.polys {
            out.poly_v5(poly);
        }
        for vertex in &self.vertices {
            out.vertex_v5(vertex);
        }
        for crease in &self.creases {
            out.crease_v5(crease);
        }
        for facet in &self.facets {
            out.facet_v5(facet);
        }
        for condition in &self.conditions {
            out.condition_v5(condition);
        }
        out.array(&self.owned_nodes);
        out.array(&self.owned_edges);
        out.array(&self.owned_paths);
        out.array(&self.owned_polys);
        out.finish()
    }

    /// Export this tree to TreeMaker v4 text for compatibility.
    pub fn export_v4_string(&self) -> String {
        let mut out = Writer::new(6, "\r");
        out.s("tree");
        out.s("4.0");
        out.f(self.paper_width);
        out.f(self.paper_height);
        out.f(self.scale);
        out.b(self.has_symmetry);
        out.point(self.sym_loc);
        out.f(self.sym_angle);
        out.u(self.nodes.len());
        out.u(self.edges.len());
        out.u(self.paths.len());
        out.u(0);
        out.u(0);
        out.u(0);
        out.u(self.conditions.len());
        for node in &self.nodes {
            out.node_v4(node);
        }
        for edge in &self.edges {
            out.edge(edge);
        }
        for path in &self.paths {
            out.path_v4(path);
        }
        for condition in &self.conditions {
            out.condition_v4(condition);
        }
        out.array(&self.owned_nodes);
        out.array(&self.owned_edges);
        out.array(&self.owned_paths);
        out.u(0);
        out.finish()
    }

    /// Return a stable structural and status summary.
    pub fn summary(&self) -> TreeSummary {
        let mut conditions_by_tag = BTreeMap::new();
        for condition in &self.conditions {
            *conditions_by_tag
                .entry(condition.kind.tag().to_string())
                .or_insert(0) += 1;
        }
        TreeSummary {
            source_version: self.source_version.clone(),
            paper_width: self.paper_width,
            paper_height: self.paper_height,
            scale: self.scale,
            has_symmetry: self.has_symmetry,
            is_feasible: self.is_feasible,
            cp_status: self.cp_status(),
            nodes: self.nodes.len(),
            edges: self.edges.len(),
            paths: self.paths.len(),
            polys: self.polys.len(),
            vertices: self.vertices.len(),
            creases: self.creases.len(),
            facets: self.facets.len(),
            conditions: self.conditions.len(),
            leaf_nodes: self.nodes.iter().filter(|n| n.is_leaf).count(),
            leaf_paths: self.paths.iter().filter(|p| p.is_leaf).count(),
            feasible_paths: self.paths.iter().filter(|p| p.is_feasible).count(),
            active_paths: self.paths.iter().filter(|p| p.is_active).count(),
            border_nodes: self.nodes.iter().filter(|n| n.is_border).count(),
            border_paths: self.paths.iter().filter(|p| p.is_border).count(),
            polygon_nodes: self.nodes.iter().filter(|n| n.is_polygon).count(),
            polygon_paths: self.paths.iter().filter(|p| p.is_polygon).count(),
            pinned_nodes: self.nodes.iter().filter(|n| n.is_pinned).count(),
            pinned_edges: self.edges.iter().filter(|e| e.is_pinned).count(),
            conditioned_nodes: self.nodes.iter().filter(|n| n.is_conditioned).count(),
            conditioned_edges: self.edges.iter().filter(|e| e.is_conditioned).count(),
            conditioned_paths: self.paths.iter().filter(|p| p.is_conditioned).count(),
            conditions_by_tag,
        }
    }

    /// Return the current feasibility flag.
    pub fn is_feasible(&self) -> bool {
        self.is_feasible
    }

    /// Return the current high-level crease-pattern status.
    pub fn cp_status(&self) -> CPStatus {
        if self
            .edges
            .iter()
            .any(|edge| edge.strained_length() < MIN_EDGE_LENGTH)
        {
            return CPStatus::EdgesTooShort;
        }
        if !self.is_polygon_valid {
            return CPStatus::PolysNotValid;
        }
        if !self.is_polygon_filled {
            return CPStatus::PolysNotFilled;
        }
        if self.owned_polys.iter().copied().any(|poly_id| {
            self.polys[poly_id - 1]
                .ring_paths
                .iter()
                .filter(|path_id| !self.paths[**path_id - 1].is_active)
                .count()
                > 1
        }) {
            return CPStatus::PolysMultipleIbps;
        }
        if !self.is_vertex_depth_valid {
            return CPStatus::VerticesLackDepth;
        }
        if !self.is_facet_data_valid {
            return CPStatus::FacetsNotValid;
        }
        if !self.is_local_root_connectable {
            return CPStatus::NotLocalRootConnectable;
        }
        CPStatus::HasFullCp
    }

    /// Return crease-pattern status plus bad part IDs where TreeMaker reports them.
    pub fn cp_status_report(&self) -> CPStatusReport {
        let bad_edges: Vec<_> = self
            .edges
            .iter()
            .filter(|edge| edge.strained_length() < MIN_EDGE_LENGTH)
            .map(|edge| edge.index)
            .collect();
        if !bad_edges.is_empty() {
            return CPStatusReport::new(CPStatus::EdgesTooShort).with_bad_edges(bad_edges);
        }

        if !self.is_polygon_valid {
            return CPStatusReport::new(CPStatus::PolysNotValid);
        }

        if !self.is_polygon_filled {
            let bad_polys = self
                .owned_polys
                .iter()
                .copied()
                .filter(|poly_id| self.polys[*poly_id - 1].owned_nodes.is_empty())
                .collect();
            return CPStatusReport::new(CPStatus::PolysNotFilled).with_bad_polys(bad_polys);
        }

        let bad_polys: Vec<_> = self
            .owned_polys
            .iter()
            .copied()
            .filter(|poly_id| {
                self.polys[*poly_id - 1]
                    .ring_paths
                    .iter()
                    .filter(|path_id| !self.paths[**path_id - 1].is_active)
                    .count()
                    > 1
            })
            .collect();
        if !bad_polys.is_empty() {
            return CPStatusReport::new(CPStatus::PolysMultipleIbps).with_bad_polys(bad_polys);
        }

        if !self.is_vertex_depth_valid {
            let bad_vertices = self
                .vertices
                .iter()
                .filter(|vertex| vertex.depth == DEPTH_NOT_SET)
                .map(|vertex| vertex.index)
                .collect();
            return CPStatusReport::new(CPStatus::VerticesLackDepth)
                .with_bad_vertices(bad_vertices);
        }

        if !self.is_facet_data_valid {
            let bad_vertices = self
                .vertices
                .iter()
                .filter(|vertex| !vertex.is_border && vertex.creases.len() % 2 != 0)
                .map(|vertex| vertex.index)
                .collect();
            let bad_facets = self
                .facets
                .iter()
                .filter(|facet| !facet.is_well_formed)
                .map(|facet| facet.index)
                .collect();
            return CPStatusReport::new(CPStatus::FacetsNotValid)
                .with_bad_vertices(bad_vertices)
                .with_bad_facets(bad_facets);
        }

        if !self.is_local_root_connectable {
            let (bad_vertices, bad_creases) = self.why_not_local_root_connectable();
            return CPStatusReport::new(CPStatus::NotLocalRootConnectable)
                .with_bad_vertices(bad_vertices)
                .with_bad_creases(bad_creases);
        }

        CPStatusReport::new(CPStatus::HasFullCp)
    }

    /// Run TreeMaker's ALM scale optimizer.
    pub fn optimize_scale(&mut self) -> Result<OptimizationReport> {
        let old_scale = self.scale;
        let leaf_nodes = self.leaf_nodes_in_owned_order();
        let num_vars = 1 + 2 * leaf_nodes.len();

        let mut state = vec![0.0; num_vars];
        state[0] = self.scale;
        let mut node_offsets = vec![None; self.nodes.len() + 1];
        for (i, node_id) in leaf_nodes.iter().copied().enumerate() {
            let offset = 1 + 2 * i;
            node_offsets[node_id] = Some(offset);
            let loc = self.nodes[node_id - 1].loc;
            state[offset] = loc.x;
            state[offset + 1] = loc.y;
        }

        let mut optimizer = nlco::NlcoAlm::new(num_vars);
        let mut lower_bounds = vec![0.0; num_vars];
        let mut upper_bounds = vec![0.0; num_vars];
        upper_bounds[0] = 2.0;
        for i in 0..leaf_nodes.len() {
            lower_bounds[1 + 2 * i] = 0.0;
            lower_bounds[2 + 2 * i] = 0.0;
            upper_bounds[1 + 2 * i] = self.paper_width;
            upper_bounds[2 + 2 * i] = self.paper_height;
        }
        optimizer.set_bounds(lower_bounds, upper_bounds);
        optimizer.set_objective(Box::new(ScaleObjective));
        optimizer.add_linear_inequality(Box::new(nlco::OneVarFn::new(0, -1.0, 0.1 * self.scale)));

        for path_id in &self.owned_paths {
            let path = &self.paths[*path_id - 1];
            if !path.is_leaf || self.has_path_active_base_condition(path) {
                continue;
            }
            self.add_scale_path_constraint(
                &mut optimizer,
                &node_offsets,
                path.nodes[0],
                *path.nodes.last().unwrap(),
                path.min_tree_length,
                false,
            );
        }

        for condition in &self.conditions {
            self.add_scale_condition_constraints(&mut optimizer, &node_offsets, &condition.kind);
        }

        let inform = optimizer.minimize(&mut state);
        if inform != 0 {
            return Err(TreeError::OptimizerConvergence(format!(
                "ALM returned result code {inform}"
            )));
        }

        self.scale = state[0];
        for (i, node_id) in leaf_nodes.into_iter().enumerate() {
            let offset = 1 + 2 * i;
            self.nodes[node_id - 1].loc = Point {
                x: state[offset],
                y: state[offset + 1],
            };
        }
        self.cleanup_after_edit();

        Ok(OptimizationReport {
            kind: OptimizationKind::Scale,
            converged: true,
            old_scale,
            new_scale: self.scale,
            is_feasible: self.is_feasible,
            message: "ALM scale optimization converged".to_string(),
        })
    }

    /// Run TreeMaker's ALM edge-strain maximization optimizer.
    pub fn optimize_edges(&mut self) -> Result<OptimizationReport> {
        let old_scale = self.scale;
        let moving_nodes = self.moving_nodes_for_edge_optimizer();
        let stretchy_edges = self.stretchy_edges_for_edge_optimizer();
        if moving_nodes.is_empty() {
            return Err(TreeError::InvalidOperation(
                "edge optimization has no moving leaf nodes",
            ));
        }
        if stretchy_edges.is_empty() {
            return Err(TreeError::InvalidOperation(
                "edge optimization has no stretchy edges",
            ));
        }

        let num_vars = 1 + 2 * moving_nodes.len();
        let mut state = vec![0.0; num_vars];
        let mut node_offsets = vec![None; self.nodes.len() + 1];
        for (i, node_id) in moving_nodes.iter().copied().enumerate() {
            let offset = 1 + 2 * i;
            node_offsets[node_id] = Some(offset);
            let loc = self.nodes[node_id - 1].loc;
            state[offset] = loc.x;
            state[offset + 1] = loc.y;
        }
        let stretchy_lookup = self.edge_lookup(&stretchy_edges);

        let mut optimizer = nlco::NlcoAlm::new(num_vars);
        let mut lower_bounds = vec![0.0; num_vars];
        let mut upper_bounds = vec![0.0; num_vars];
        lower_bounds[0] = -0.999;
        upper_bounds[0] = 10.0;
        for i in 0..moving_nodes.len() {
            upper_bounds[1 + 2 * i] = self.paper_width;
            upper_bounds[2 + 2 * i] = self.paper_height;
        }
        optimizer.set_bounds(lower_bounds, upper_bounds);
        optimizer.set_objective(Box::new(ScaleObjective));

        for path_id in &self.owned_paths {
            let path = &self.paths[*path_id - 1];
            if !path.is_leaf || self.has_path_active_base_condition(path) {
                continue;
            }
            self.add_edge_path_constraint(
                &mut optimizer,
                &node_offsets,
                &stretchy_lookup,
                path,
                false,
            );
        }
        for condition in &self.conditions {
            self.add_edge_condition_constraints(
                &mut optimizer,
                &node_offsets,
                &stretchy_lookup,
                &condition.kind,
            );
        }

        let inform = optimizer.minimize(&mut state);
        if inform != 0 {
            return Err(TreeError::OptimizerConvergence(format!(
                "ALM returned result code {inform}"
            )));
        }

        for (i, node_id) in moving_nodes.into_iter().enumerate() {
            let offset = 1 + 2 * i;
            self.nodes[node_id - 1].loc = Point {
                x: state[offset],
                y: state[offset + 1],
            };
        }
        for edge_id in stretchy_edges {
            self.edges[edge_id - 1].strain = state[0];
        }
        self.cleanup_after_edit();

        Ok(OptimizationReport {
            kind: OptimizationKind::Edge,
            converged: true,
            old_scale,
            new_scale: self.scale,
            is_feasible: self.is_feasible,
            message: "ALM edge strain optimization converged".to_string(),
        })
    }

    /// Run TreeMaker's ALM strain minimization optimizer.
    pub fn optimize_strain(&mut self) -> Result<OptimizationReport> {
        let old_scale = self.scale;
        let moving_nodes = self.moving_nodes_for_strain_optimizer();
        let stretchy_edges = self.owned_edges.clone();
        if moving_nodes.is_empty() && stretchy_edges.is_empty() {
            return Err(TreeError::InvalidOperation(
                "strain optimization has no moving nodes or edges",
            ));
        }

        let edge_offset = 2 * moving_nodes.len();
        let num_vars = edge_offset + stretchy_edges.len();
        let mut state = vec![0.0; num_vars];
        let mut node_offsets = vec![None; self.nodes.len() + 1];
        let mut edge_offsets = vec![None; self.edges.len() + 1];

        for (i, node_id) in moving_nodes.iter().copied().enumerate() {
            let offset = 2 * i;
            node_offsets[node_id] = Some(offset);
            let loc = self.nodes[node_id - 1].loc;
            state[offset] = loc.x;
            state[offset + 1] = loc.y;
        }
        let mut stiffness = Vec::with_capacity(stretchy_edges.len());
        for (i, edge_id) in stretchy_edges.iter().copied().enumerate() {
            let offset = edge_offset + i;
            edge_offsets[edge_id] = Some(offset);
            state[offset] = self.edges[edge_id - 1].strain;
            let edge_stiffness = self.edges[edge_id - 1].stiffness;
            stiffness.push(if edge_stiffness <= 0.0 {
                1.0
            } else {
                edge_stiffness
            });
        }

        let mut optimizer = nlco::NlcoAlm::new(num_vars);
        let mut lower_bounds = vec![0.0; num_vars];
        let mut upper_bounds = vec![0.0; num_vars];
        for i in 0..moving_nodes.len() {
            upper_bounds[2 * i] = self.paper_width;
            upper_bounds[2 * i + 1] = self.paper_height;
        }
        for i in edge_offset..num_vars {
            lower_bounds[i] = -0.999;
            upper_bounds[i] = 2.0;
        }
        optimizer.set_bounds(lower_bounds, upper_bounds);
        optimizer.set_objective(Box::new(StrainObjective {
            edge_offset,
            stiffness,
        }));

        for path_id in &self.owned_paths {
            let path = &self.paths[*path_id - 1];
            if !path.is_leaf || self.has_path_active_base_condition(path) {
                continue;
            }
            self.add_strain_path_constraint(
                &mut optimizer,
                &node_offsets,
                &edge_offsets,
                path,
                false,
            );
        }
        for condition in &self.conditions {
            self.add_strain_condition_constraints(
                &mut optimizer,
                &node_offsets,
                &edge_offsets,
                &condition.kind,
            );
        }

        let inform = optimizer.minimize(&mut state);
        if inform != 0 {
            return Err(TreeError::OptimizerConvergence(format!(
                "ALM returned result code {inform}"
            )));
        }

        for (i, node_id) in moving_nodes.into_iter().enumerate() {
            let offset = 2 * i;
            self.nodes[node_id - 1].loc = Point {
                x: state[offset],
                y: state[offset + 1],
            };
        }
        for (i, edge_id) in stretchy_edges.into_iter().enumerate() {
            self.edges[edge_id - 1].strain = state[edge_offset + i];
        }
        self.cleanup_after_edit();

        Ok(OptimizationReport {
            kind: OptimizationKind::Strain,
            converged: true,
            old_scale,
            new_scale: self.scale,
            is_feasible: self.is_feasible,
            message: "ALM strain optimization converged".to_string(),
        })
    }

    /// Build TreeMaker polygons without building full crease-pattern contents.
    pub fn build_tree_polys(&mut self) -> Result<()> {
        let leaf_paths = self.leaf_paths_in_owned_order();
        let border_nodes: Vec<usize> = self
            .owned_nodes
            .iter()
            .copied()
            .filter(|id| self.nodes[*id - 1].is_border)
            .collect();
        self.build_polys_from_paths(&leaf_paths, &border_nodes, OwnerRef::Tree)?;

        let leaf_nodes = self.leaf_nodes_in_owned_order();
        let doomed: Vec<usize> = self
            .owned_polys
            .iter()
            .copied()
            .filter(|poly_id| {
                let Some(poly) = self.polys.get(poly_id.saturating_sub(1)) else {
                    return true;
                };
                !self.poly_is_convex(poly) || self.poly_encloses_leaf_node(poly, &leaf_nodes)
            })
            .collect();
        self.delete_polys(&doomed);
        self.cleanup_after_edit();
        Ok(())
    }

    /// Build polygons, vertices, creases, facets, facet order, color, and fold data.
    pub fn build_polys_and_crease_pattern(&mut self) -> Result<()> {
        self.build_tree_polys()?;
        if self
            .edges
            .iter()
            .any(|edge| edge.strained_length() < MIN_EDGE_LENGTH)
        {
            return Ok(());
        }

        let owned_polys = self.owned_polys.clone();
        for poly_id in owned_polys {
            self.build_poly_contents_geometry(poly_id)?;
        }
        self.cleanup_after_edit();
        Ok(())
    }

    #[doc(hidden)]
    #[doc(hidden)]
    pub fn build_polygon_contents_for_oracle_tests(&mut self) -> Result<()> {
        self.build_tree_polys()?;
        if self
            .edges
            .iter()
            .any(|edge| edge.strained_length() < MIN_EDGE_LENGTH)
        {
            return Ok(());
        }

        let owned_polys = self.owned_polys.clone();
        for poly_id in owned_polys {
            self.build_poly_contents_geometry(poly_id)?;
        }
        self.cleanup_after_edit();
        Ok(())
    }

    fn read_v3(reader: &mut Reader<'_>, source_version: String) -> Result<Self> {
        let paper_width = reader.read_f64("paper width")?;
        let paper_height = reader.read_f64("paper height")?;
        let scale = reader.read_f64("scale")?;
        let has_symmetry = reader.read_bool("has symmetry")?;
        let sym_loc = reader.read_point("symmetry location")?;
        let sym_angle = reader.read_f64("symmetry angle")?;
        let num_nodes = reader.read_usize("node count")?;
        let num_edges = reader.read_usize("edge count")?;
        let num_paths = reader.read_usize("path count")?;
        let _num_polys = reader.read_usize("poly count")?;

        let mut nodes = Vec::with_capacity(num_nodes);
        let mut edges = Vec::with_capacity(num_edges);
        let mut paths = Vec::with_capacity(num_paths);
        let mut conditions = Vec::new();

        for _ in 0..num_nodes {
            nodes.push(reader.read_node_v3(&mut conditions)?);
        }
        for _ in 0..num_edges {
            edges.push(reader.read_edge_v3()?);
        }
        for _ in 0..num_paths {
            paths.push(reader.read_path_v3(&mut conditions)?);
        }

        Ok(Self {
            source_version,
            paper_width,
            paper_height,
            scale,
            has_symmetry,
            sym_loc,
            sym_angle,
            is_feasible: false,
            is_polygon_valid: false,
            is_polygon_filled: false,
            is_vertex_depth_valid: false,
            is_facet_data_valid: false,
            is_local_root_connectable: false,
            needs_cleanup: false,
            nodes,
            edges,
            paths,
            polys: Vec::new(),
            vertices: Vec::new(),
            creases: Vec::new(),
            facets: Vec::new(),
            conditions,
            owned_nodes: (1..=num_nodes).collect(),
            owned_edges: (1..=num_edges).collect(),
            owned_paths: (1..=num_paths).collect(),
            owned_polys: Vec::new(),
        })
    }

    fn read_v4(reader: &mut Reader<'_>, source_version: String) -> Result<Self> {
        let paper_width = reader.read_f64("paper width")?;
        let paper_height = reader.read_f64("paper height")?;
        let scale = reader.read_f64("scale")?;
        let has_symmetry = reader.read_bool("has symmetry")?;
        let sym_loc = reader.read_point("symmetry location")?;
        let sym_angle = reader.read_f64("symmetry angle")?;
        let num_nodes = reader.read_usize("node count")?;
        let num_edges = reader.read_usize("edge count")?;
        let num_paths = reader.read_usize("path count")?;
        let num_polys = reader.read_usize("poly count")?;
        let num_vertices = reader.read_usize("vertex count")?;
        let num_creases = reader.read_usize("crease count")?;
        let num_conditions = reader.read_usize("condition count")?;

        let mut nodes = Vec::with_capacity(num_nodes);
        let mut edges = Vec::with_capacity(num_edges);
        let mut paths = Vec::with_capacity(num_paths);
        let mut polys = Vec::with_capacity(num_polys);
        let mut vertices = Vec::with_capacity(num_vertices);
        let mut creases = Vec::with_capacity(num_creases);

        for _ in 0..num_nodes {
            nodes.push(reader.read_node_v4()?);
        }
        for _ in 0..num_edges {
            edges.push(reader.read_edge(true)?);
        }
        for _ in 0..num_paths {
            paths.push(reader.read_path_v4(num_polys)?);
        }
        for _ in 0..num_polys {
            polys.push(reader.read_poly_v4(num_paths)?);
        }
        for index in 1..=num_vertices {
            vertices.push(reader.read_vertex_v4(index)?);
        }
        for index in 1..=num_creases {
            creases.push(reader.read_crease_v4(index)?);
        }

        let mut conditions = Vec::with_capacity(num_conditions);
        for i in 0..num_conditions {
            conditions.push(reader.read_condition_v4(i + 1)?);
        }

        let owned_nodes = reader.read_index_array("owned nodes")?;
        let owned_edges = reader.read_index_array("owned edges")?;
        let owned_paths = reader.read_index_array("owned paths")?;
        let _owned_polys = reader.read_index_array("owned polys")?;

        kill_v4_crease_pattern_refs(&mut nodes, &mut paths);

        Ok(Self {
            source_version,
            paper_width,
            paper_height,
            scale,
            has_symmetry,
            sym_loc,
            sym_angle,
            is_feasible: false,
            is_polygon_valid: false,
            is_polygon_filled: false,
            is_vertex_depth_valid: false,
            is_facet_data_valid: false,
            is_local_root_connectable: false,
            needs_cleanup: false,
            nodes,
            edges,
            paths,
            polys: Vec::new(),
            vertices: Vec::new(),
            creases: Vec::new(),
            facets: Vec::new(),
            conditions,
            owned_nodes,
            owned_edges,
            owned_paths,
            owned_polys: Vec::new(),
        })
    }

    fn read_v5(reader: &mut Reader<'_>, source_version: String) -> Result<Self> {
        let paper_width = reader.read_f64("paper width")?;
        let paper_height = reader.read_f64("paper height")?;
        let scale = reader.read_f64("scale")?;
        let has_symmetry = reader.read_bool("has symmetry")?;
        let sym_loc = reader.read_point("symmetry location")?;
        let sym_angle = reader.read_f64("symmetry angle")?;
        let is_feasible = reader.read_bool("feasible flag")?;
        let is_polygon_valid = reader.read_bool("polygon valid flag")?;
        let is_polygon_filled = reader.read_bool("polygon filled flag")?;
        let is_vertex_depth_valid = reader.read_bool("vertex depth valid flag")?;
        let is_facet_data_valid = reader.read_bool("facet data valid flag")?;
        let is_local_root_connectable = reader.read_bool("local root connectable flag")?;
        let needs_cleanup = reader.read_bool("needs cleanup flag")?;
        let num_nodes = reader.read_usize("node count")?;
        let num_edges = reader.read_usize("edge count")?;
        let num_paths = reader.read_usize("path count")?;
        let num_polys = reader.read_usize("poly count")?;
        let num_vertices = reader.read_usize("vertex count")?;
        let num_creases = reader.read_usize("crease count")?;
        let num_facets = reader.read_usize("facet count")?;
        let num_conditions = reader.read_usize("condition count")?;

        let mut nodes = Vec::with_capacity(num_nodes);
        let mut edges = Vec::with_capacity(num_edges);
        let mut paths = Vec::with_capacity(num_paths);
        let mut polys = Vec::with_capacity(num_polys);
        let mut vertices = Vec::with_capacity(num_vertices);
        let mut creases = Vec::with_capacity(num_creases);
        let mut facets = Vec::with_capacity(num_facets);

        for _ in 0..num_nodes {
            nodes.push(reader.read_node_v5()?);
        }
        for _ in 0..num_edges {
            edges.push(reader.read_edge(false)?);
        }
        for _ in 0..num_paths {
            paths.push(reader.read_path_v5(num_polys, num_paths)?);
        }
        for _ in 0..num_polys {
            polys.push(reader.read_poly_v5(num_paths)?);
        }
        for _ in 0..num_vertices {
            vertices.push(reader.read_vertex_v5(num_nodes, num_vertices)?);
        }
        for _ in 0..num_creases {
            creases.push(reader.read_crease_v5(num_facets)?);
        }
        for _ in 0..num_facets {
            facets.push(reader.read_facet_v5(num_edges)?);
        }

        let mut conditions = Vec::with_capacity(num_conditions);
        for _ in 0..num_conditions {
            conditions.push(reader.read_condition_v5()?);
        }

        let owned_nodes = reader.read_index_array("owned nodes")?;
        let owned_edges = reader.read_index_array("owned edges")?;
        let owned_paths = reader.read_index_array("owned paths")?;
        let owned_polys = reader.read_index_array("owned polys")?;

        Ok(Self {
            source_version,
            paper_width,
            paper_height,
            scale,
            has_symmetry,
            sym_loc,
            sym_angle,
            is_feasible,
            is_polygon_valid,
            is_polygon_filled,
            is_vertex_depth_valid,
            is_facet_data_valid,
            is_local_root_connectable,
            needs_cleanup,
            nodes,
            edges,
            paths,
            polys,
            vertices,
            creases,
            facets,
            conditions,
            owned_nodes,
            owned_edges,
            owned_paths,
            owned_polys,
        })
    }

    fn validate(&self) -> Result<()> {
        for id in &self.owned_nodes {
            self.check_ref("node", *id, self.nodes.len())?;
        }
        for id in &self.owned_edges {
            self.check_ref("edge", *id, self.edges.len())?;
        }
        for id in &self.owned_paths {
            self.check_ref("path", *id, self.paths.len())?;
        }
        for id in &self.owned_polys {
            self.check_ref("poly", *id, self.polys.len())?;
        }
        for node in &self.nodes {
            for id in &node.edges {
                self.check_ref("edge", *id, self.edges.len())?;
            }
            for id in &node.leaf_paths {
                self.check_ref("path", *id, self.paths.len())?;
            }
            for id in &node.owned_vertices {
                self.check_ref("vertex", *id, self.vertices.len())?;
            }
            self.check_owner(&node.owner)?;
        }
        for edge in &self.edges {
            for id in &edge.nodes {
                self.check_ref("node", *id, self.nodes.len())?;
            }
        }
        for path in &self.paths {
            for id in &path.nodes {
                self.check_ref("node", *id, self.nodes.len())?;
            }
            for id in &path.edges {
                self.check_ref("edge", *id, self.edges.len())?;
            }
            if let Some(id) = path.fwd_poly {
                self.check_ref("poly", id, self.polys.len())?;
            }
            if let Some(id) = path.bkd_poly {
                self.check_ref("poly", id, self.polys.len())?;
            }
            if let Some(id) = path.outset_path {
                self.check_ref("path", id, self.paths.len())?;
            }
            for id in &path.owned_vertices {
                self.check_ref("vertex", *id, self.vertices.len())?;
            }
            for id in &path.owned_creases {
                self.check_ref("crease", *id, self.creases.len())?;
            }
            self.check_owner(&path.owner)?;
        }
        for poly in &self.polys {
            for id in &poly.ring_nodes {
                self.check_ref("node", *id, self.nodes.len())?;
            }
            for id in &poly.inset_nodes {
                self.check_ref("node", *id, self.nodes.len())?;
            }
            for id in &poly.owned_nodes {
                self.check_ref("node", *id, self.nodes.len())?;
            }
            for id in poly
                .ring_paths
                .iter()
                .chain(&poly.cross_paths)
                .chain(&poly.spoke_paths)
                .chain(&poly.owned_paths)
            {
                self.check_ref("path", *id, self.paths.len())?;
            }
            if let Some(id) = poly.ridge_path {
                self.check_ref("path", id, self.paths.len())?;
            }
            for id in &poly.local_root_vertices {
                self.check_ref("vertex", *id, self.vertices.len())?;
            }
            for id in poly.local_root_creases.iter().chain(&poly.owned_creases) {
                self.check_ref("crease", *id, self.creases.len())?;
            }
            for id in &poly.owned_polys {
                self.check_ref("poly", *id, self.polys.len())?;
            }
            for id in &poly.owned_facets {
                self.check_ref("facet", *id, self.facets.len())?;
            }
            self.check_owner(&poly.owner)?;
        }
        for vertex in &self.vertices {
            if let Some(id) = vertex.tree_node {
                self.check_ref("node", id, self.nodes.len())?;
            }
            if let Some(id) = vertex.left_pseudohinge_mate {
                self.check_ref("vertex", id, self.vertices.len())?;
            }
            if let Some(id) = vertex.right_pseudohinge_mate {
                self.check_ref("vertex", id, self.vertices.len())?;
            }
            for id in &vertex.creases {
                self.check_ref("crease", *id, self.creases.len())?;
            }
            self.check_owner(&vertex.owner)?;
        }
        for crease in &self.creases {
            for id in &crease.vertices {
                self.check_ref("vertex", *id, self.vertices.len())?;
            }
            if let Some(id) = crease.fwd_facet {
                self.check_ref("facet", id, self.facets.len())?;
            }
            if let Some(id) = crease.bkd_facet {
                self.check_ref("facet", id, self.facets.len())?;
            }
            self.check_owner(&crease.owner)?;
        }
        for facet in &self.facets {
            for id in &facet.vertices {
                self.check_ref("vertex", *id, self.vertices.len())?;
            }
            for id in &facet.creases {
                self.check_ref("crease", *id, self.creases.len())?;
            }
            if let Some(id) = facet.corridor_edge {
                self.check_ref("edge", id, self.edges.len())?;
            }
            for id in facet.head_facets.iter().chain(&facet.tail_facets) {
                self.check_ref("facet", *id, self.facets.len())?;
            }
            self.check_owner(&facet.owner)?;
        }
        for condition in &self.conditions {
            condition.kind.validate_refs(self)?;
        }
        Ok(())
    }

    fn check_ref(&self, kind: &'static str, index: usize, max: usize) -> Result<()> {
        if index == 0 || index > max {
            return Err(TreeError::BadReference { kind, index, max });
        }
        Ok(())
    }

    fn check_owner(&self, owner: &OwnerRef) -> Result<()> {
        match *owner {
            OwnerRef::Tree => Ok(()),
            OwnerRef::Node(id) => self.check_ref("node", id, self.nodes.len()),
            OwnerRef::Path(id) => self.check_ref("path", id, self.paths.len()),
            OwnerRef::Poly(id) => self.check_ref("poly", id, self.polys.len()),
        }
    }

    fn paper_settings(&self) -> PaperSettings {
        PaperSettings {
            width: self.paper_width,
            height: self.paper_height,
            scale: self.scale,
            has_symmetry: self.has_symmetry,
            sym_loc: self.sym_loc,
            sym_angle: self.sym_angle,
        }
    }

    fn node_mut(&mut self, id: usize) -> Result<&mut Node> {
        let max = self.nodes.len();
        self.nodes
            .get_mut(id.saturating_sub(1))
            .ok_or(TreeError::BadReference {
                kind: "node",
                index: id,
                max,
            })
    }

    fn edge_mut(&mut self, id: usize) -> Result<&mut Edge> {
        let max = self.edges.len();
        self.edges
            .get_mut(id.saturating_sub(1))
            .ok_or(TreeError::BadReference {
                kind: "edge",
                index: id,
                max,
            })
    }

    fn clear_generated_state(&mut self) {
        for node in &mut self.nodes {
            node.owned_vertices.clear();
        }
        for path in &mut self.paths {
            path.fwd_poly = None;
            path.bkd_poly = None;
            path.outset_path = None;
            path.front_reduction = 0.0;
            path.back_reduction = 0.0;
            path.min_depth = DEPTH_NOT_SET;
            path.min_depth_dist = DEPTH_NOT_SET;
            path.owned_vertices.clear();
            path.owned_creases.clear();
        }
        self.polys.clear();
        self.vertices.clear();
        self.creases.clear();
        self.facets.clear();
        self.owned_polys.clear();
        self.is_polygon_valid = false;
        self.is_polygon_filled = false;
        self.is_vertex_depth_valid = false;
        self.is_facet_data_valid = false;
        self.is_local_root_connectable = false;
        self.needs_cleanup = true;
    }

    fn has_generated_parts(&self) -> bool {
        self.nodes.len() != self.owned_nodes.len()
            || self.edges.len() != self.owned_edges.len()
            || self.paths.len() != self.owned_paths.len()
            || !self.polys.is_empty()
            || !self.vertices.is_empty()
            || !self.creases.is_empty()
            || !self.facets.is_empty()
    }

    fn reset_to_design_state(&mut self) -> Result<()> {
        let design = self.to_design();
        *self = Self::from_design(design)?;
        Ok(())
    }

    fn rebuild_tree_paths(&mut self) -> Result<()> {
        self.clear_generated_state();
        self.renumber_part_indices();
        self.owned_nodes = (1..=self.nodes.len()).collect();
        self.owned_edges = (1..=self.edges.len()).collect();
        self.paths.clear();
        self.owned_paths.clear();

        for node in &mut self.nodes {
            node.edges.clear();
            node.leaf_paths.clear();
            node.is_leaf = false;
            node.is_sub = false;
            node.owner = OwnerRef::Tree;
        }

        for edge_id in 1..=self.edges.len() {
            let edge = &self.edges[edge_id - 1];
            validate_positive("edge length", edge.length)?;
            if edge.nodes.len() != 2 {
                return Err(TreeError::InvalidOperation(
                    "tree edges must have exactly two endpoints",
                ));
            }
            let a = edge.nodes[0];
            let b = edge.nodes[1];
            if a == b {
                return Err(TreeError::InvalidOperation(
                    "edge endpoints must be different nodes",
                ));
            }
            self.check_ref("node", a, self.nodes.len())?;
            self.check_ref("node", b, self.nodes.len())?;
            self.nodes[a - 1].edges.push(edge_id);
            self.nodes[b - 1].edges.push(edge_id);
        }

        if self.nodes.is_empty() {
            return Ok(());
        }
        if self.edges.len() != self.nodes.len().saturating_sub(1) {
            return Err(TreeError::InvalidOperation(
                "tree topology must be connected and acyclic",
            ));
        }
        self.validate_connected_tree()?;

        for node_id in 1..=self.nodes.len() {
            let degree = self.nodes[node_id - 1].edges.len();
            self.nodes[node_id - 1].is_leaf = if self.nodes.len() == 1 {
                true
            } else {
                degree == 1
            };
        }

        for node1 in 1..=self.nodes.len() {
            for node2 in node1 + 1..=self.nodes.len() {
                let (path_nodes, path_edges) = self.tree_path_between(node1, node2)?;
                let path_id = self.paths.len() + 1;
                let is_leaf = self.nodes[node1 - 1].is_leaf && self.nodes[node2 - 1].is_leaf;
                if is_leaf {
                    self.nodes[node1 - 1].leaf_paths.push(path_id);
                    self.nodes[node2 - 1].leaf_paths.push(path_id);
                }
                self.paths.push(Path {
                    index: path_id,
                    min_tree_length: 0.0,
                    min_paper_length: 0.0,
                    act_tree_length: 0.0,
                    act_paper_length: 0.0,
                    is_leaf,
                    is_sub: false,
                    is_feasible: false,
                    is_active: false,
                    is_border: false,
                    is_polygon: false,
                    is_conditioned: false,
                    fwd_poly: None,
                    bkd_poly: None,
                    nodes: path_nodes,
                    edges: path_edges,
                    outset_path: None,
                    front_reduction: 0.0,
                    back_reduction: 0.0,
                    min_depth: DEPTH_NOT_SET,
                    min_depth_dist: DEPTH_NOT_SET,
                    owned_vertices: Vec::new(),
                    owned_creases: Vec::new(),
                    owner: OwnerRef::Tree,
                });
            }
        }
        self.owned_paths = (1..=self.paths.len()).collect();
        Ok(())
    }

    fn validate_connected_tree(&self) -> Result<()> {
        let mut visited = vec![false; self.nodes.len() + 1];
        let mut queue = VecDeque::from([1usize]);
        visited[1] = true;
        while let Some(node_id) = queue.pop_front() {
            for edge_id in self.nodes[node_id - 1].edges.iter().copied() {
                let edge = &self.edges[edge_id - 1];
                let next = if edge.nodes[0] == node_id {
                    edge.nodes[1]
                } else {
                    edge.nodes[0]
                };
                if !visited[next] {
                    visited[next] = true;
                    queue.push_back(next);
                }
            }
        }
        if visited.iter().skip(1).any(|visited| !visited) {
            return Err(TreeError::InvalidOperation(
                "tree topology must be connected and acyclic",
            ));
        }
        Ok(())
    }

    fn tree_path_between(&self, start: usize, end: usize) -> Result<(Vec<usize>, Vec<usize>)> {
        let mut parent = vec![None::<(usize, usize)>; self.nodes.len() + 1];
        let mut queue = VecDeque::from([start]);
        parent[start] = Some((0, 0));
        while let Some(node_id) = queue.pop_front() {
            if node_id == end {
                break;
            }
            for edge_id in self.nodes[node_id - 1].edges.iter().copied() {
                let edge = &self.edges[edge_id - 1];
                let next = if edge.nodes[0] == node_id {
                    edge.nodes[1]
                } else {
                    edge.nodes[0]
                };
                if parent[next].is_none() {
                    parent[next] = Some((node_id, edge_id));
                    queue.push_back(next);
                }
            }
        }
        if parent[end].is_none() {
            return Err(TreeError::InvalidOperation(
                "tree topology must be connected and acyclic",
            ));
        }

        let mut nodes = vec![end];
        let mut edges = Vec::new();
        let mut cur = end;
        while cur != start {
            let (prev, edge_id) = parent[cur].expect("parent checked");
            nodes.push(prev);
            edges.push(edge_id);
            cur = prev;
        }
        nodes.reverse();
        edges.reverse();
        Ok((nodes, edges))
    }

    fn delete_design_node(&mut self, id: usize) {
        let old_node_len = self.nodes.len();
        self.nodes.remove(id - 1);
        let mut node_map = vec![None; old_node_len + 1];
        let mut next_node = 1usize;
        for (old_id, slot) in node_map.iter_mut().enumerate().skip(1) {
            if old_id == id {
                continue;
            }
            *slot = Some(next_node);
            next_node += 1;
        }
        for node in &mut self.nodes {
            if let Some(mapped) = node_map.get(node.index).copied().flatten() {
                node.index = mapped;
            }
        }
        self.conditions
            .retain(|condition| condition.kind.node_refs_survive(&node_map));
        for condition in &mut self.conditions {
            condition.kind.remap_nodes(&node_map);
        }

        let old_edges = std::mem::take(&mut self.edges);
        let mut edge_map = vec![None; old_edges.len() + 1];
        for edge in old_edges {
            if edge.nodes.contains(&id) {
                continue;
            }
            let old_id = edge.index;
            let mut remapped = edge;
            remap_vec(&mut remapped.nodes, &node_map);
            remapped.index = self.edges.len() + 1;
            edge_map[old_id] = Some(remapped.index);
            self.edges.push(remapped);
        }
        self.conditions
            .retain(|condition| condition.kind.edge_refs_survive(&edge_map));
        for condition in &mut self.conditions {
            condition.kind.remap_edges(&edge_map);
        }
        for (i, condition) in self.conditions.iter_mut().enumerate() {
            condition.index = i + 1;
        }
        self.owned_nodes = (1..=self.nodes.len()).collect();
        self.owned_edges = (1..=self.edges.len()).collect();
    }

    fn delete_design_edge(&mut self, id: usize) {
        let old_edges = std::mem::take(&mut self.edges);
        let mut edge_map = vec![None; old_edges.len() + 1];
        for edge in old_edges {
            if edge.index == id {
                continue;
            }
            let old_id = edge.index;
            let mut remapped = edge;
            remapped.index = self.edges.len() + 1;
            edge_map[old_id] = Some(remapped.index);
            self.edges.push(remapped);
        }
        self.conditions
            .retain(|condition| condition.kind.edge_refs_survive(&edge_map));
        for condition in &mut self.conditions {
            condition.kind.remap_edges(&edge_map);
        }
        for (i, condition) in self.conditions.iter_mut().enumerate() {
            condition.index = i + 1;
        }
        self.owned_edges = (1..=self.edges.len()).collect();
    }

    fn make_node_root(&mut self, id: usize) -> Result<()> {
        self.check_ref("node", id, self.nodes.len())?;
        if id == 1 {
            return Ok(());
        }

        let old_node_len = self.nodes.len();
        let mut node_map = vec![None; old_node_len + 1];
        node_map[id] = Some(1);
        let mut next = 2usize;
        for (old_id, slot) in node_map
            .iter_mut()
            .enumerate()
            .take(old_node_len + 1)
            .skip(1)
        {
            if old_id == id {
                continue;
            }
            *slot = Some(next);
            next += 1;
        }

        for node in &mut self.nodes {
            remap_value(&mut node.index, &node_map);
        }
        self.nodes.sort_by_key(|node| node.index);
        for edge in &mut self.edges {
            remap_vec(&mut edge.nodes, &node_map);
        }
        for condition in &mut self.conditions {
            condition.kind.remap_nodes(&node_map);
        }
        self.owned_nodes = (1..=self.nodes.len()).collect();
        Ok(())
    }

    fn split_design_edge(&mut self, edge_id: usize, distance: TmFloat) -> Result<usize> {
        self.check_ref("edge", edge_id, self.edges.len())?;
        let edge = self.edges[edge_id - 1].clone();
        let strained_length = edge.strained_length();
        if !distance.is_finite() || distance <= 0.0 || distance >= strained_length {
            return Err(TreeError::InvalidOperation(
                "split distance must be inside the strained edge length",
            ));
        }
        let strain_factor = 1.0 + edge.strain;
        if strain_factor <= 0.0 {
            return Err(TreeError::InvalidOperation(
                "cannot split an edge with nonpositive strained length",
            ));
        }

        let node1 = edge.nodes[0];
        let node2 = edge.nodes[1];
        let loc1 = self.nodes[node1 - 1].loc;
        let loc2 = self.nodes[node2 - 1].loc;
        let t = distance / strained_length;
        let new_node_id = self.nodes.len() + 1;
        self.nodes.push(Node {
            index: new_node_id,
            label: format!("n{new_node_id}"),
            loc: Point {
                x: loc1.x + (loc2.x - loc1.x) * t,
                y: loc1.y + (loc2.y - loc1.y) * t,
            },
            depth: DEPTH_NOT_SET,
            elevation: 0.0,
            is_leaf: false,
            is_sub: false,
            is_border: false,
            is_pinned: false,
            is_polygon: false,
            is_junction: false,
            is_conditioned: false,
            owned_vertices: Vec::new(),
            edges: Vec::new(),
            leaf_paths: Vec::new(),
            owner: OwnerRef::Tree,
        });

        self.edges[edge_id - 1] = Edge {
            index: edge_id,
            label: edge.label,
            length: distance / strain_factor,
            strain: edge.strain,
            stiffness: edge.stiffness,
            is_pinned: false,
            is_conditioned: false,
            nodes: vec![node1, new_node_id],
        };
        let new_edge_id = self.edges.len() + 1;
        self.edges.push(Edge {
            index: new_edge_id,
            label: format!("e{new_edge_id}"),
            length: (strained_length - distance) / strain_factor,
            strain: edge.strain,
            stiffness: edge.stiffness,
            is_pinned: false,
            is_conditioned: false,
            nodes: vec![new_node_id, node2],
        });

        let mut edge_map = (0..=self.edges.len()).map(Some).collect::<Vec<_>>();
        edge_map[edge_id] = None;
        self.conditions
            .retain(|condition| condition.kind.edge_refs_survive(&edge_map));
        for (i, condition) in self.conditions.iter_mut().enumerate() {
            condition.index = i + 1;
        }
        self.owned_nodes = (1..=self.nodes.len()).collect();
        self.owned_edges = (1..=self.edges.len()).collect();
        Ok(new_node_id)
    }

    fn absorb_design_node(&mut self, id: usize) -> Result<()> {
        self.check_ref("node", id, self.nodes.len())?;
        let incident = self.nodes[id - 1].edges.clone();
        if incident.len() != 2 || self.nodes[id - 1].is_leaf {
            return Err(TreeError::InvalidOperation(
                "absorbed nodes must be internal nodes with exactly two incident edges",
            ));
        }
        let edge1 = self.edges[incident[0] - 1].clone();
        let edge2 = self.edges[incident[1] - 1].clone();
        let other1 = other_edge_node(&edge1, id)?;
        let other2 = other_edge_node(&edge2, id)?;
        let new_length = edge1.strained_length() + edge2.strained_length();

        let old_node_len = self.nodes.len();
        self.nodes.remove(id - 1);
        let mut node_map = vec![None; old_node_len + 1];
        let mut next_node = 1usize;
        for (old_id, slot) in node_map.iter_mut().enumerate().skip(1) {
            if old_id == id {
                continue;
            }
            *slot = Some(next_node);
            next_node += 1;
        }
        for node in &mut self.nodes {
            remap_value(&mut node.index, &node_map);
        }

        let mut edge_map = vec![None; self.edges.len() + 1];
        let old_edges = std::mem::take(&mut self.edges);
        for edge in old_edges {
            if incident.contains(&edge.index) {
                continue;
            }
            let old_id = edge.index;
            let mut remapped = edge;
            remap_vec(&mut remapped.nodes, &node_map);
            remapped.index = self.edges.len() + 1;
            edge_map[old_id] = Some(remapped.index);
            self.edges.push(remapped);
        }
        let new_edge_id = self.edges.len() + 1;
        self.edges.push(Edge {
            index: new_edge_id,
            label: format!("e{new_edge_id}"),
            length: new_length,
            strain: 0.0,
            stiffness: 1.0,
            is_pinned: false,
            is_conditioned: false,
            nodes: vec![
                node_map[other1].ok_or(TreeError::InvalidOperation("bad absorbed node"))?,
                node_map[other2].ok_or(TreeError::InvalidOperation("bad absorbed node"))?,
            ],
        });

        self.conditions
            .retain(|condition| condition.kind.node_refs_survive(&node_map));
        self.conditions
            .retain(|condition| condition.kind.edge_refs_survive(&edge_map));
        for condition in &mut self.conditions {
            condition.kind.remap_nodes(&node_map);
            condition.kind.remap_edges(&edge_map);
        }
        for (i, condition) in self.conditions.iter_mut().enumerate() {
            condition.index = i + 1;
        }
        self.owned_nodes = (1..=self.nodes.len()).collect();
        self.owned_edges = (1..=self.edges.len()).collect();
        Ok(())
    }

    fn absorb_design_edge(&mut self, id: usize) -> Result<()> {
        self.check_ref("edge", id, self.edges.len())?;
        let edge = self.edges[id - 1].clone();
        let keep_node = edge.nodes[0];
        let kill_node = edge.nodes[1];

        let old_node_len = self.nodes.len();
        self.nodes.remove(kill_node - 1);
        let mut node_map = vec![None; old_node_len + 1];
        let mut next_node = 1usize;
        for (old_id, slot) in node_map.iter_mut().enumerate().skip(1) {
            if old_id == kill_node {
                continue;
            }
            *slot = Some(next_node);
            next_node += 1;
        }
        for node in &mut self.nodes {
            remap_value(&mut node.index, &node_map);
        }

        let mut edge_map = vec![None; self.edges.len() + 1];
        let old_edges = std::mem::take(&mut self.edges);
        for mut edge in old_edges {
            if edge.index == id {
                continue;
            }
            let old_id = edge.index;
            for node in &mut edge.nodes {
                if *node == kill_node {
                    *node = keep_node;
                }
            }
            remap_vec(&mut edge.nodes, &node_map);
            if edge.nodes.len() != 2 || edge.nodes[0] == edge.nodes[1] {
                continue;
            }
            edge.index = self.edges.len() + 1;
            edge_map[old_id] = Some(edge.index);
            self.edges.push(edge);
        }

        self.conditions
            .retain(|condition| condition.kind.node_refs_survive(&node_map));
        self.conditions
            .retain(|condition| condition.kind.edge_refs_survive(&edge_map));
        for condition in &mut self.conditions {
            condition.kind.remap_nodes(&node_map);
            condition.kind.remap_edges(&edge_map);
        }
        for (i, condition) in self.conditions.iter_mut().enumerate() {
            condition.index = i + 1;
        }
        self.owned_nodes = (1..=self.nodes.len()).collect();
        self.owned_edges = (1..=self.edges.len()).collect();
        Ok(())
    }

    fn scale_tree_lengths(&mut self, scale_factor: TmFloat) -> Result<()> {
        validate_positive("scale factor", scale_factor)?;
        self.scale /= scale_factor;
        for edge in &mut self.edges {
            edge.length *= scale_factor;
        }
        Ok(())
    }

    fn perturb_design_nodes(&mut self, nodes: &[usize]) -> Result<()> {
        let mut rng = PerturbRng::new();
        for id in nodes {
            self.check_ref("node", *id, self.nodes.len())?;
        }
        for id in nodes {
            let node = &mut self.nodes[*id - 1];
            node.loc.x += 1.0e-2 * rng.next_delta();
            node.loc.y += 1.0e-2 * rng.next_delta();
        }
        Ok(())
    }

    fn find_leaf_path_between(&self, node1: usize, node2: usize) -> Option<&Path> {
        self.paths.iter().find(|path| {
            path.is_leaf
                && matches!(
                    path.nodes.first().copied().zip(path.nodes.last().copied()),
                    Some((a, b)) if (a == node1 && b == node2) || (a == node2 && b == node1)
                )
        })
    }

    fn leaf_nodes_in_owned_order(&self) -> Vec<usize> {
        self.owned_nodes
            .iter()
            .copied()
            .filter(|id| self.nodes[id - 1].is_leaf)
            .collect()
    }

    fn has_path_active_base_condition(&self, path: &Path) -> bool {
        let Some((node1, node2)) = path.nodes.first().copied().zip(path.nodes.last().copied())
        else {
            return false;
        };
        self.conditions
            .iter()
            .any(|condition| match condition.kind {
                ConditionKind::PathActive { node1: a, node2: b }
                | ConditionKind::PathAngleFixed {
                    node1: a, node2: b, ..
                }
                | ConditionKind::PathAngleQuant {
                    node1: a, node2: b, ..
                } => (a == node1 && b == node2) || (a == node2 && b == node1),
                _ => false,
            })
    }

    fn scale_offset(node_offsets: &[Option<usize>], node: usize) -> Option<usize> {
        node_offsets.get(node).copied().flatten()
    }

    fn add_scale_path_constraint(
        &self,
        optimizer: &mut nlco::NlcoAlm,
        node_offsets: &[Option<usize>],
        node1: usize,
        node2: usize,
        min_tree_length: TmFloat,
        equality: bool,
    ) {
        let (Some(ix), Some(jx)) = (
            Self::scale_offset(node_offsets, node1),
            Self::scale_offset(node_offsets, node2),
        ) else {
            return;
        };
        let constraint = Box::new(nlco::PathFn1::new(ix, ix + 1, jx, jx + 1, min_tree_length));
        if equality {
            optimizer.add_nonlinear_equality(constraint);
        } else {
            optimizer.add_nonlinear_inequality(constraint);
        }
    }

    fn add_scale_path_active_constraint(
        &self,
        optimizer: &mut nlco::NlcoAlm,
        node_offsets: &[Option<usize>],
        node1: usize,
        node2: usize,
    ) {
        if let Some(path) = self.find_leaf_path_between(node1, node2) {
            self.add_scale_path_constraint(
                optimizer,
                node_offsets,
                node1,
                node2,
                path.min_tree_length,
                true,
            );
        }
    }

    fn add_scale_condition_constraints(
        &self,
        optimizer: &mut nlco::NlcoAlm,
        node_offsets: &[Option<usize>],
        kind: &ConditionKind,
    ) {
        match *kind {
            ConditionKind::NodeCombo {
                node,
                to_symmetry_line,
                to_paper_edge,
                to_paper_corner,
                x_fixed,
                x_fix_value,
                y_fixed,
                y_fix_value,
            } => {
                let Some(ix) = Self::scale_offset(node_offsets, node) else {
                    return;
                };
                let iy = ix + 1;
                if self.has_symmetry && to_symmetry_line {
                    optimizer.add_linear_equality(Box::new(nlco::StickToLineFn::new(
                        ix,
                        iy,
                        self.sym_loc.x,
                        self.sym_loc.y,
                        self.sym_angle,
                    )));
                }
                if to_paper_edge {
                    optimizer.add_nonlinear_equality(Box::new(nlco::StickToEdgeFn::new(
                        ix,
                        iy,
                        self.paper_width,
                        self.paper_height,
                    )));
                }
                if to_paper_corner {
                    optimizer.add_nonlinear_equality(Box::new(nlco::CornerFn::new(
                        ix,
                        self.paper_width,
                    )));
                    optimizer.add_nonlinear_equality(Box::new(nlco::CornerFn::new(
                        iy,
                        self.paper_height,
                    )));
                }
                if x_fixed {
                    optimizer.add_linear_equality(Box::new(nlco::OneVarFn::new(
                        ix,
                        -1.0,
                        x_fix_value,
                    )));
                }
                if y_fixed {
                    optimizer.add_linear_equality(Box::new(nlco::OneVarFn::new(
                        iy,
                        -1.0,
                        y_fix_value,
                    )));
                }
            }
            ConditionKind::NodeFixed {
                node,
                x_fixed,
                y_fixed,
                x_fix_value,
                y_fix_value,
            } => {
                let Some(ix) = Self::scale_offset(node_offsets, node) else {
                    return;
                };
                let iy = ix + 1;
                if x_fixed {
                    optimizer.add_linear_equality(Box::new(nlco::OneVarFn::new(
                        ix,
                        -1.0,
                        x_fix_value,
                    )));
                }
                if y_fixed {
                    optimizer.add_linear_equality(Box::new(nlco::OneVarFn::new(
                        iy,
                        -1.0,
                        y_fix_value,
                    )));
                }
            }
            ConditionKind::NodeOnCorner { node } => {
                if let Some(ix) = Self::scale_offset(node_offsets, node) {
                    optimizer.add_nonlinear_equality(Box::new(nlco::CornerFn::new(
                        ix,
                        self.paper_width,
                    )));
                    optimizer.add_nonlinear_equality(Box::new(nlco::CornerFn::new(
                        ix + 1,
                        self.paper_height,
                    )));
                }
            }
            ConditionKind::NodeOnEdge { node } => {
                if let Some(ix) = Self::scale_offset(node_offsets, node) {
                    optimizer.add_nonlinear_equality(Box::new(nlco::StickToEdgeFn::new(
                        ix,
                        ix + 1,
                        self.paper_width,
                        self.paper_height,
                    )));
                }
            }
            ConditionKind::NodeSymmetric { node } => {
                if !self.has_symmetry {
                    return;
                }
                if let Some(ix) = Self::scale_offset(node_offsets, node) {
                    optimizer.add_linear_equality(Box::new(nlco::StickToLineFn::new(
                        ix,
                        ix + 1,
                        self.sym_loc.x,
                        self.sym_loc.y,
                        self.sym_angle,
                    )));
                }
            }
            ConditionKind::NodesPaired { node1, node2 } => {
                if !self.has_symmetry {
                    return;
                }
                let (Some(ix), Some(jx)) = (
                    Self::scale_offset(node_offsets, node1),
                    Self::scale_offset(node_offsets, node2),
                ) else {
                    return;
                };
                optimizer.add_linear_equality(Box::new(nlco::PairFn1A::new(
                    ix,
                    ix + 1,
                    jx,
                    jx + 1,
                    self.sym_angle,
                )));
                optimizer.add_linear_equality(Box::new(nlco::PairFn1B::new(
                    ix,
                    ix + 1,
                    jx,
                    jx + 1,
                    self.sym_loc.x,
                    self.sym_loc.y,
                    self.sym_angle,
                )));
            }
            ConditionKind::NodesCollinear {
                node1,
                node2,
                node3,
            } => {
                let (Some(ix), Some(jx), Some(kx)) = (
                    Self::scale_offset(node_offsets, node1),
                    Self::scale_offset(node_offsets, node2),
                    Self::scale_offset(node_offsets, node3),
                ) else {
                    return;
                };
                optimizer.add_nonlinear_equality(Box::new(nlco::CollinearFn1::new(
                    ix,
                    ix + 1,
                    jx,
                    jx + 1,
                    kx,
                    kx + 1,
                )));
            }
            ConditionKind::EdgeLengthFixed { .. } | ConditionKind::EdgesSameStrain { .. } => {}
            ConditionKind::PathCombo {
                node1,
                node2,
                is_angle_fixed,
                angle,
                is_angle_quant,
                quant,
                quant_offset,
            } => {
                let (Some(ix), Some(jx)) = (
                    Self::scale_offset(node_offsets, node1),
                    Self::scale_offset(node_offsets, node2),
                ) else {
                    return;
                };
                self.add_scale_path_active_constraint(optimizer, node_offsets, node1, node2);
                if is_angle_fixed {
                    optimizer.add_linear_equality(Box::new(nlco::PathAngleFn1::new(
                        ix,
                        ix + 1,
                        jx,
                        jx + 1,
                        angle,
                    )));
                }
                if is_angle_quant {
                    optimizer.add_nonlinear_equality(Box::new(nlco::QuantizeAngleFn1::new(
                        ix,
                        ix + 1,
                        jx,
                        jx + 1,
                        quant,
                        quant_offset,
                    )));
                }
            }
            ConditionKind::PathActive { node1, node2 } => {
                self.add_scale_path_active_constraint(optimizer, node_offsets, node1, node2);
            }
            ConditionKind::PathAngleFixed {
                node1,
                node2,
                angle,
            } => {
                self.add_scale_path_active_constraint(optimizer, node_offsets, node1, node2);
                let (Some(ix), Some(jx)) = (
                    Self::scale_offset(node_offsets, node1),
                    Self::scale_offset(node_offsets, node2),
                ) else {
                    return;
                };
                optimizer.add_linear_equality(Box::new(nlco::PathAngleFn1::new(
                    ix,
                    ix + 1,
                    jx,
                    jx + 1,
                    angle,
                )));
            }
            ConditionKind::PathAngleQuant {
                node1,
                node2,
                quant,
                quant_offset,
            } => {
                self.add_scale_path_active_constraint(optimizer, node_offsets, node1, node2);
                let (Some(ix), Some(jx)) = (
                    Self::scale_offset(node_offsets, node1),
                    Self::scale_offset(node_offsets, node2),
                ) else {
                    return;
                };
                optimizer.add_nonlinear_equality(Box::new(nlco::QuantizeAngleFn1::new(
                    ix,
                    ix + 1,
                    jx,
                    jx + 1,
                    quant,
                    quant_offset,
                )));
            }
        }
    }

    fn moving_nodes_for_edge_optimizer(&self) -> Vec<usize> {
        self.owned_nodes
            .iter()
            .copied()
            .filter(|id| {
                let node = &self.nodes[id - 1];
                node.is_leaf && !node.is_pinned
            })
            .collect()
    }

    fn edge_has_length_fixed_condition(&self, edge: usize) -> bool {
        self.conditions.iter().any(|condition| {
            matches!(condition.kind, ConditionKind::EdgeLengthFixed { edge: e } if e == edge)
        })
    }

    fn stretchy_edges_for_edge_optimizer(&self) -> Vec<usize> {
        self.owned_edges
            .iter()
            .copied()
            .filter(|id| {
                let edge = &self.edges[id - 1];
                !edge.is_pinned && !self.edge_has_length_fixed_condition(*id)
            })
            .collect()
    }

    fn edge_lookup(&self, edge_ids: &[usize]) -> Vec<bool> {
        let mut lookup = vec![false; self.edges.len() + 1];
        for id in edge_ids {
            lookup[*id] = true;
        }
        lookup
    }

    fn node_loc(&self, node: usize) -> Point {
        self.nodes[node - 1].loc
    }

    fn edge_fix_var_lengths(&self, path: &Path, stretchy_lookup: &[bool]) -> (TmFloat, TmFloat) {
        let mut lfix = 0.0;
        let mut lvar = 0.0;
        for edge_id in &path.edges {
            let edge = &self.edges[*edge_id - 1];
            let temp = edge.length * self.scale;
            if stretchy_lookup[*edge_id] {
                lfix += temp;
                lvar += temp;
            } else {
                lfix += (1.0 + edge.strain) * temp;
            }
        }
        (lfix, lvar)
    }

    fn add_edge_path_constraint(
        &self,
        optimizer: &mut nlco::NlcoAlm,
        node_offsets: &[Option<usize>],
        stretchy_lookup: &[bool],
        path: &Path,
        equality: bool,
    ) {
        let node1 = path.nodes[0];
        let node2 = *path.nodes.last().unwrap();
        let ix = Self::scale_offset(node_offsets, node1);
        let jx = Self::scale_offset(node_offsets, node2);
        let (lfix, lvar) = self.edge_fix_var_lengths(path, stretchy_lookup);
        let constraint: Option<Box<dyn nlco::DifferentiableFn>> = match (ix, jx) {
            (Some(ix), Some(jx)) => Some(Box::new(nlco::StrainPathFn1::new(
                ix,
                ix + 1,
                jx,
                jx + 1,
                lfix,
                lvar,
            ))),
            (Some(ix), None) => {
                let loc = self.node_loc(node2);
                Some(Box::new(nlco::StrainPathFn2::new(
                    ix,
                    ix + 1,
                    loc.x,
                    loc.y,
                    lfix,
                    lvar,
                )))
            }
            (None, Some(jx)) => {
                let loc = self.node_loc(node1);
                Some(Box::new(nlco::StrainPathFn2::new(
                    jx,
                    jx + 1,
                    loc.x,
                    loc.y,
                    lfix,
                    lvar,
                )))
            }
            (None, None) if lvar != 0.0 => {
                let loc1 = self.node_loc(node1);
                let loc2 = self.node_loc(node2);
                Some(Box::new(nlco::StrainPathFn3::new(
                    loc1.x, loc1.y, loc2.x, loc2.y, lfix, lvar,
                )))
            }
            (None, None) => None,
        };
        if let Some(constraint) = constraint {
            if equality {
                optimizer.add_nonlinear_equality(constraint);
            } else {
                optimizer.add_nonlinear_inequality(constraint);
            }
        }
    }

    fn add_edge_path_active_constraint(
        &self,
        optimizer: &mut nlco::NlcoAlm,
        node_offsets: &[Option<usize>],
        stretchy_lookup: &[bool],
        node1: usize,
        node2: usize,
    ) {
        if let Some(path) = self.find_leaf_path_between(node1, node2) {
            self.add_edge_path_constraint(optimizer, node_offsets, stretchy_lookup, path, true);
        }
    }

    fn add_edge_angle_constraints(
        &self,
        optimizer: &mut nlco::NlcoAlm,
        node_offsets: &[Option<usize>],
        node1: usize,
        node2: usize,
        fixed_angle: Option<TmFloat>,
        quant: Option<(usize, TmFloat)>,
    ) {
        let ix = Self::scale_offset(node_offsets, node1);
        let jx = Self::scale_offset(node_offsets, node2);
        if let Some(angle) = fixed_angle {
            match (ix, jx) {
                (Some(ix), Some(jx)) => optimizer.add_nonlinear_equality(Box::new(
                    nlco::PathAngleFn1::new(ix, ix + 1, jx, jx + 1, angle),
                )),
                (Some(ix), None) => {
                    let loc = self.node_loc(node2);
                    optimizer.add_nonlinear_equality(Box::new(nlco::PathAngleFn2::new(
                        ix,
                        ix + 1,
                        loc.x,
                        loc.y,
                        angle,
                    )));
                }
                (None, Some(jx)) => {
                    let loc = self.node_loc(node1);
                    optimizer.add_nonlinear_equality(Box::new(nlco::PathAngleFn2::new(
                        jx,
                        jx + 1,
                        loc.x,
                        loc.y,
                        angle,
                    )));
                }
                (None, None) => {}
            }
        }
        if let Some((quant, quant_offset)) = quant {
            match (ix, jx) {
                (Some(ix), Some(jx)) => optimizer.add_nonlinear_equality(Box::new(
                    nlco::QuantizeAngleFn1::new(ix, ix + 1, jx, jx + 1, quant, quant_offset),
                )),
                (Some(ix), None) => {
                    let loc = self.node_loc(node2);
                    optimizer.add_nonlinear_equality(Box::new(nlco::QuantizeAngleFn2::new(
                        ix,
                        ix + 1,
                        loc.x,
                        loc.y,
                        quant,
                        quant_offset,
                    )));
                }
                (None, Some(jx)) => {
                    let loc = self.node_loc(node1);
                    optimizer.add_nonlinear_equality(Box::new(nlco::QuantizeAngleFn2::new(
                        jx,
                        jx + 1,
                        loc.x,
                        loc.y,
                        quant,
                        quant_offset,
                    )));
                }
                (None, None) => {}
            }
        }
    }

    fn add_pair_constraints(
        &self,
        optimizer: &mut nlco::NlcoAlm,
        node_offsets: &[Option<usize>],
        node1: usize,
        node2: usize,
    ) {
        if !self.has_symmetry {
            return;
        }
        let ix = Self::scale_offset(node_offsets, node1);
        let jx = Self::scale_offset(node_offsets, node2);
        match (ix, jx) {
            (Some(ix), Some(jx)) => {
                optimizer.add_linear_equality(Box::new(nlco::PairFn1A::new(
                    ix,
                    ix + 1,
                    jx,
                    jx + 1,
                    self.sym_angle,
                )));
                optimizer.add_linear_equality(Box::new(nlco::PairFn1B::new(
                    ix,
                    ix + 1,
                    jx,
                    jx + 1,
                    self.sym_loc.x,
                    self.sym_loc.y,
                    self.sym_angle,
                )));
            }
            (Some(ix), None) => {
                let loc = self.node_loc(node2);
                optimizer.add_linear_equality(Box::new(nlco::PairFn2A::new(
                    ix,
                    ix + 1,
                    loc.x,
                    loc.y,
                    self.sym_angle,
                )));
                optimizer.add_linear_equality(Box::new(nlco::PairFn2B::new(
                    ix,
                    ix + 1,
                    loc.x,
                    loc.y,
                    self.sym_loc.x,
                    self.sym_loc.y,
                    self.sym_angle,
                )));
            }
            (None, Some(jx)) => {
                let loc = self.node_loc(node1);
                optimizer.add_linear_equality(Box::new(nlco::PairFn2A::new(
                    jx,
                    jx + 1,
                    loc.x,
                    loc.y,
                    self.sym_angle,
                )));
                optimizer.add_linear_equality(Box::new(nlco::PairFn2B::new(
                    jx,
                    jx + 1,
                    loc.x,
                    loc.y,
                    self.sym_loc.x,
                    self.sym_loc.y,
                    self.sym_angle,
                )));
            }
            (None, None) => {}
        }
    }

    fn add_collinear_constraints(
        &self,
        optimizer: &mut nlco::NlcoAlm,
        node_offsets: &[Option<usize>],
        node1: usize,
        node2: usize,
        node3: usize,
    ) {
        let ix = Self::scale_offset(node_offsets, node1);
        let jx = Self::scale_offset(node_offsets, node2);
        let kx = Self::scale_offset(node_offsets, node3);
        match (ix, jx, kx) {
            (Some(ix), Some(jx), Some(kx)) => {
                optimizer.add_nonlinear_equality(Box::new(nlco::CollinearFn1::new(
                    ix,
                    ix + 1,
                    jx,
                    jx + 1,
                    kx,
                    kx + 1,
                )));
            }
            (Some(ix), Some(jx), None) => {
                let loc = self.node_loc(node3);
                optimizer.add_nonlinear_equality(Box::new(nlco::CollinearFn2::new(
                    ix,
                    ix + 1,
                    jx,
                    jx + 1,
                    loc.x,
                    loc.y,
                )));
            }
            (Some(ix), None, Some(kx)) => {
                let loc = self.node_loc(node2);
                optimizer.add_nonlinear_equality(Box::new(nlco::CollinearFn2::new(
                    ix,
                    ix + 1,
                    kx,
                    kx + 1,
                    loc.x,
                    loc.y,
                )));
            }
            (None, Some(jx), Some(kx)) => {
                let loc = self.node_loc(node1);
                optimizer.add_nonlinear_equality(Box::new(nlco::CollinearFn2::new(
                    jx,
                    jx + 1,
                    kx,
                    kx + 1,
                    loc.x,
                    loc.y,
                )));
            }
            (Some(ix), None, None) => {
                let loc2 = self.node_loc(node2);
                let loc3 = self.node_loc(node3);
                optimizer.add_nonlinear_equality(Box::new(nlco::CollinearFn3::new(
                    ix,
                    ix + 1,
                    loc2.x,
                    loc2.y,
                    loc3.x,
                    loc3.y,
                )));
            }
            (None, Some(jx), None) => {
                let loc1 = self.node_loc(node1);
                let loc3 = self.node_loc(node3);
                optimizer.add_nonlinear_equality(Box::new(nlco::CollinearFn3::new(
                    jx,
                    jx + 1,
                    loc1.x,
                    loc1.y,
                    loc3.x,
                    loc3.y,
                )));
            }
            (None, None, Some(kx)) => {
                let loc1 = self.node_loc(node1);
                let loc2 = self.node_loc(node2);
                optimizer.add_nonlinear_equality(Box::new(nlco::CollinearFn3::new(
                    kx,
                    kx + 1,
                    loc1.x,
                    loc1.y,
                    loc2.x,
                    loc2.y,
                )));
            }
            (None, None, None) => {}
        }
    }

    fn add_edge_condition_constraints(
        &self,
        optimizer: &mut nlco::NlcoAlm,
        node_offsets: &[Option<usize>],
        stretchy_lookup: &[bool],
        kind: &ConditionKind,
    ) {
        match *kind {
            ConditionKind::NodeCombo {
                node,
                to_symmetry_line,
                to_paper_edge,
                to_paper_corner,
                x_fixed,
                x_fix_value,
                y_fixed,
                y_fix_value,
            } => {
                let Some(ix) = Self::scale_offset(node_offsets, node) else {
                    return;
                };
                let iy = ix + 1;
                if self.has_symmetry && to_symmetry_line {
                    optimizer.add_linear_equality(Box::new(nlco::StickToLineFn::new(
                        ix,
                        iy,
                        self.sym_loc.x,
                        self.sym_loc.y,
                        self.sym_angle,
                    )));
                }
                if to_paper_edge {
                    optimizer.add_nonlinear_equality(Box::new(nlco::StickToEdgeFn::new(
                        ix,
                        iy,
                        self.paper_width,
                        self.paper_height,
                    )));
                }
                if to_paper_corner {
                    optimizer.add_nonlinear_equality(Box::new(nlco::CornerFn::new(
                        ix,
                        self.paper_width,
                    )));
                    optimizer.add_nonlinear_equality(Box::new(nlco::CornerFn::new(
                        iy,
                        self.paper_height,
                    )));
                }
                if x_fixed {
                    optimizer.add_linear_equality(Box::new(nlco::OneVarFn::new(
                        ix,
                        -1.0,
                        x_fix_value,
                    )));
                }
                if y_fixed {
                    optimizer.add_linear_equality(Box::new(nlco::OneVarFn::new(
                        iy,
                        -1.0,
                        y_fix_value,
                    )));
                }
            }
            ConditionKind::NodeFixed {
                node,
                x_fixed,
                y_fixed,
                x_fix_value,
                y_fix_value,
            } => {
                let Some(ix) = Self::scale_offset(node_offsets, node) else {
                    return;
                };
                if x_fixed {
                    optimizer.add_linear_equality(Box::new(nlco::OneVarFn::new(
                        ix,
                        -1.0,
                        x_fix_value,
                    )));
                }
                if y_fixed {
                    optimizer.add_linear_equality(Box::new(nlco::OneVarFn::new(
                        ix + 1,
                        -1.0,
                        y_fix_value,
                    )));
                }
            }
            ConditionKind::NodeOnCorner { node } => {
                if let Some(ix) = Self::scale_offset(node_offsets, node) {
                    optimizer.add_nonlinear_equality(Box::new(nlco::CornerFn::new(
                        ix,
                        self.paper_width,
                    )));
                    optimizer.add_nonlinear_equality(Box::new(nlco::CornerFn::new(
                        ix + 1,
                        self.paper_height,
                    )));
                }
            }
            ConditionKind::NodeOnEdge { node } => {
                if let Some(ix) = Self::scale_offset(node_offsets, node) {
                    optimizer.add_nonlinear_equality(Box::new(nlco::StickToEdgeFn::new(
                        ix,
                        ix + 1,
                        self.paper_width,
                        self.paper_height,
                    )));
                }
            }
            ConditionKind::NodeSymmetric { node } => {
                if !self.has_symmetry {
                    return;
                }
                if let Some(ix) = Self::scale_offset(node_offsets, node) {
                    optimizer.add_linear_equality(Box::new(nlco::StickToLineFn::new(
                        ix,
                        ix + 1,
                        self.sym_loc.x,
                        self.sym_loc.y,
                        self.sym_angle,
                    )));
                }
            }
            ConditionKind::NodesPaired { node1, node2 } => {
                self.add_pair_constraints(optimizer, node_offsets, node1, node2);
            }
            ConditionKind::NodesCollinear {
                node1,
                node2,
                node3,
            } => self.add_collinear_constraints(optimizer, node_offsets, node1, node2, node3),
            ConditionKind::EdgeLengthFixed { edge } => {
                if stretchy_lookup[edge] {
                    optimizer.add_linear_equality(Box::new(nlco::OneVarFn::new(0, 1.0, 0.0)));
                }
            }
            ConditionKind::EdgesSameStrain { .. } => {}
            ConditionKind::PathCombo {
                node1,
                node2,
                is_angle_fixed,
                angle,
                is_angle_quant,
                quant,
                quant_offset,
            } => {
                self.add_edge_path_active_constraint(
                    optimizer,
                    node_offsets,
                    stretchy_lookup,
                    node1,
                    node2,
                );
                self.add_edge_angle_constraints(
                    optimizer,
                    node_offsets,
                    node1,
                    node2,
                    is_angle_fixed.then_some(angle),
                    is_angle_quant.then_some((quant, quant_offset)),
                );
            }
            ConditionKind::PathActive { node1, node2 } => {
                self.add_edge_path_active_constraint(
                    optimizer,
                    node_offsets,
                    stretchy_lookup,
                    node1,
                    node2,
                );
            }
            ConditionKind::PathAngleFixed {
                node1,
                node2,
                angle,
            } => {
                self.add_edge_path_active_constraint(
                    optimizer,
                    node_offsets,
                    stretchy_lookup,
                    node1,
                    node2,
                );
                self.add_edge_angle_constraints(
                    optimizer,
                    node_offsets,
                    node1,
                    node2,
                    Some(angle),
                    None,
                );
            }
            ConditionKind::PathAngleQuant {
                node1,
                node2,
                quant,
                quant_offset,
            } => {
                self.add_edge_path_active_constraint(
                    optimizer,
                    node_offsets,
                    stretchy_lookup,
                    node1,
                    node2,
                );
                self.add_edge_angle_constraints(
                    optimizer,
                    node_offsets,
                    node1,
                    node2,
                    None,
                    Some((quant, quant_offset)),
                );
            }
        }
    }

    fn moving_nodes_for_strain_optimizer(&self) -> Vec<usize> {
        self.owned_nodes
            .iter()
            .copied()
            .filter(|id| self.nodes[id - 1].is_leaf)
            .collect()
    }

    fn strain_fix_var_lengths(
        &self,
        path: &Path,
        edge_offsets: &[Option<usize>],
    ) -> (TmFloat, Vec<usize>, Vec<TmFloat>) {
        let mut lfix = 0.0;
        let mut vi = Vec::new();
        let mut vf = Vec::new();
        for edge_id in &path.edges {
            let edge = &self.edges[*edge_id - 1];
            if let Some(offset) = edge_offsets[*edge_id] {
                vi.push(offset);
                let scaled_length = edge.length * self.scale;
                vf.push(scaled_length);
                lfix += scaled_length;
            } else {
                lfix += edge.strained_length() * self.scale;
            }
        }
        (lfix, vi, vf)
    }

    fn add_strain_path_constraint(
        &self,
        optimizer: &mut nlco::NlcoAlm,
        node_offsets: &[Option<usize>],
        edge_offsets: &[Option<usize>],
        path: &Path,
        equality: bool,
    ) {
        let node1 = path.nodes[0];
        let node2 = *path.nodes.last().unwrap();
        let ix = Self::scale_offset(node_offsets, node1);
        let jx = Self::scale_offset(node_offsets, node2);
        let (lfix, vi, vf) = self.strain_fix_var_lengths(path, edge_offsets);
        let constraint: Option<Box<dyn nlco::DifferentiableFn>> = match (ix, jx) {
            (Some(ix), Some(jx)) => Some(Box::new(nlco::MultiStrainPathFn1::new(
                ix,
                ix + 1,
                jx,
                jx + 1,
                lfix,
                vi,
                vf,
            ))),
            (Some(ix), None) => {
                let loc = self.node_loc(node2);
                Some(Box::new(nlco::MultiStrainPathFn2::new(
                    ix,
                    ix + 1,
                    loc.x,
                    loc.y,
                    lfix,
                    vi,
                    vf,
                )))
            }
            (None, Some(jx)) => {
                let loc = self.node_loc(node1);
                Some(Box::new(nlco::MultiStrainPathFn2::new(
                    jx,
                    jx + 1,
                    loc.x,
                    loc.y,
                    lfix,
                    vi,
                    vf,
                )))
            }
            (None, None) if !vi.is_empty() => {
                let loc1 = self.node_loc(node1);
                let loc2 = self.node_loc(node2);
                Some(Box::new(nlco::MultiStrainPathFn3::new(
                    loc1.x, loc1.y, loc2.x, loc2.y, lfix, vi, vf,
                )))
            }
            (None, None) => None,
        };
        if let Some(constraint) = constraint {
            if equality {
                optimizer.add_nonlinear_equality(constraint);
            } else {
                optimizer.add_nonlinear_inequality(constraint);
            }
        }
    }

    fn add_strain_path_active_constraint(
        &self,
        optimizer: &mut nlco::NlcoAlm,
        node_offsets: &[Option<usize>],
        edge_offsets: &[Option<usize>],
        node1: usize,
        node2: usize,
    ) {
        if let Some(path) = self.find_leaf_path_between(node1, node2) {
            self.add_strain_path_constraint(optimizer, node_offsets, edge_offsets, path, true);
        }
    }

    fn add_strain_condition_constraints(
        &self,
        optimizer: &mut nlco::NlcoAlm,
        node_offsets: &[Option<usize>],
        edge_offsets: &[Option<usize>],
        kind: &ConditionKind,
    ) {
        match *kind {
            ConditionKind::EdgeLengthFixed { edge } => {
                if let Some(offset) = edge_offsets[edge] {
                    optimizer.add_linear_equality(Box::new(nlco::OneVarFn::new(offset, 1.0, 0.0)));
                }
            }
            ConditionKind::EdgesSameStrain { edge1, edge2 } => {
                if let (Some(offset1), Some(offset2)) = (edge_offsets[edge1], edge_offsets[edge2]) {
                    optimizer.add_linear_equality(Box::new(nlco::TwoVarFn::new(
                        offset1, 1.0, offset2, -1.0, 0.0,
                    )));
                }
            }
            ConditionKind::PathCombo {
                node1,
                node2,
                is_angle_fixed,
                angle,
                is_angle_quant,
                quant,
                quant_offset,
            } => {
                self.add_strain_path_active_constraint(
                    optimizer,
                    node_offsets,
                    edge_offsets,
                    node1,
                    node2,
                );
                self.add_edge_angle_constraints(
                    optimizer,
                    node_offsets,
                    node1,
                    node2,
                    is_angle_fixed.then_some(angle),
                    is_angle_quant.then_some((quant, quant_offset)),
                );
            }
            ConditionKind::PathActive { node1, node2 } => {
                self.add_strain_path_active_constraint(
                    optimizer,
                    node_offsets,
                    edge_offsets,
                    node1,
                    node2,
                );
            }
            ConditionKind::PathAngleFixed {
                node1,
                node2,
                angle,
            } => {
                self.add_strain_path_active_constraint(
                    optimizer,
                    node_offsets,
                    edge_offsets,
                    node1,
                    node2,
                );
                self.add_edge_angle_constraints(
                    optimizer,
                    node_offsets,
                    node1,
                    node2,
                    Some(angle),
                    None,
                );
            }
            ConditionKind::PathAngleQuant {
                node1,
                node2,
                quant,
                quant_offset,
            } => {
                self.add_strain_path_active_constraint(
                    optimizer,
                    node_offsets,
                    edge_offsets,
                    node1,
                    node2,
                );
                self.add_edge_angle_constraints(
                    optimizer,
                    node_offsets,
                    node1,
                    node2,
                    None,
                    Some((quant, quant_offset)),
                );
            }
            _ => self.add_edge_condition_constraints(
                optimizer,
                node_offsets,
                &self.edge_lookup(&[]),
                kind,
            ),
        }
    }

    fn build_polys_from_paths(
        &mut self,
        path_list: &[usize],
        border_nodes: &[usize],
        owner: OwnerRef,
    ) -> Result<()> {
        let mut polygon_paths = Vec::new();
        for path_id in path_list.iter().copied() {
            if !self.paths[path_id - 1].is_polygon {
                continue;
            }
            for existing_path in polygon_paths.iter().copied() {
                if self.paths_intersect_interior(path_id, existing_path) {
                    self.paths[path_id - 1].is_polygon = false;
                    break;
                }
            }
            if self.paths[path_id - 1].is_polygon {
                polygon_paths.push(path_id);
            }
        }

        if polygon_paths.is_empty() || border_nodes.is_empty() {
            return Ok(());
        }

        let centroid = self.node_centroid(border_nodes);
        for path_id in polygon_paths.iter().copied() {
            if self.can_start_poly_fwd(path_id, centroid) {
                self.build_poly_ring(path_id, true, owner.clone())?;
            }
            if self.can_start_poly_bkd(path_id, centroid) {
                self.build_poly_ring(path_id, false, owner.clone())?;
            }
        }

        let owned_polys = self.owned_polys_for_owner(&owner);
        for poly_id in owned_polys {
            if self.polys[poly_id - 1].cross_paths.is_empty() {
                self.calc_poly_cross_paths(poly_id);
            }
        }
        Ok(())
    }

    fn owned_polys_for_owner(&self, owner: &OwnerRef) -> Vec<usize> {
        match *owner {
            OwnerRef::Tree => self.owned_polys.clone(),
            OwnerRef::Poly(poly_id) => self
                .polys
                .get(poly_id.saturating_sub(1))
                .map(|poly| poly.owned_polys.clone())
                .unwrap_or_default(),
            _ => Vec::new(),
        }
    }

    fn can_start_poly_fwd(&self, path_id: usize, centroid: Point) -> bool {
        let path = &self.paths[path_id - 1];
        if path.fwd_poly.is_some() {
            return false;
        }
        if !path.is_border {
            return true;
        }
        let (Some(front), Some(back)) = (path.nodes.first(), path.nodes.last()) else {
            return false;
        };
        are_ccw(
            self.nodes[*front - 1].loc,
            self.nodes[*back - 1].loc,
            centroid,
        )
    }

    fn can_start_poly_bkd(&self, path_id: usize, centroid: Point) -> bool {
        let path = &self.paths[path_id - 1];
        if path.bkd_poly.is_some() {
            return false;
        }
        if !path.is_border {
            return true;
        }
        let (Some(front), Some(back)) = (path.nodes.first(), path.nodes.last()) else {
            return false;
        };
        are_cw(
            self.nodes[*front - 1].loc,
            self.nodes[*back - 1].loc,
            centroid,
        )
    }

    fn build_poly_ring(&mut self, path_id: usize, fwd: bool, owner: OwnerRef) -> Result<()> {
        let poly_id = self.create_poly(owner);
        if fwd {
            self.paths[path_id - 1].fwd_poly = Some(poly_id);
        } else {
            self.paths[path_id - 1].bkd_poly = Some(poly_id);
        }

        let path = &self.paths[path_id - 1];
        let first_node = if fwd {
            path.nodes[0]
        } else {
            *path
                .nodes
                .last()
                .ok_or(TreeError::InvalidOperation("polygon path has no nodes"))?
        };
        let mut this_node = if fwd {
            *path
                .nodes
                .last()
                .ok_or(TreeError::InvalidOperation("polygon path has no nodes"))?
        } else {
            path.nodes[0]
        };
        let mut this_path = path_id;
        let mut ring_nodes = vec![first_node];
        let mut ring_paths = vec![this_path];

        let mut too_many = 0;
        loop {
            let (next_path, next_node) = self.next_polygon_path_and_node(this_path, this_node)?;
            ring_nodes.push(this_node);
            ring_paths.push(next_path);
            if self.paths[next_path - 1].nodes.first().copied() == Some(this_node) {
                self.paths[next_path - 1].fwd_poly = Some(poly_id);
            } else {
                self.paths[next_path - 1].bkd_poly = Some(poly_id);
            }
            this_path = next_path;
            this_node = next_node;
            too_many += 1;
            if next_node == first_node {
                break;
            }
            if too_many >= 100 {
                return Err(TreeError::InvalidOperation(
                    "polygon ring walk exceeded TreeMaker guard",
                ));
            }
        }

        self.polys[poly_id - 1].ring_nodes = ring_nodes;
        self.polys[poly_id - 1].ring_paths = ring_paths;
        self.calc_poly_contents(poly_id);
        Ok(())
    }

    fn create_poly(&mut self, owner: OwnerRef) -> usize {
        let index = self.polys.len() + 1;
        self.polys.push(Poly {
            index,
            centroid: Point { x: 0.0, y: 0.0 },
            is_sub_poly: matches!(owner, OwnerRef::Poly(_)),
            ring_nodes: Vec::new(),
            ring_paths: Vec::new(),
            cross_paths: Vec::new(),
            inset_nodes: Vec::new(),
            spoke_paths: Vec::new(),
            ridge_path: None,
            node_locs: Vec::new(),
            local_root_vertices: Vec::new(),
            local_root_creases: Vec::new(),
            owned_nodes: Vec::new(),
            owned_paths: Vec::new(),
            owned_polys: Vec::new(),
            owned_creases: Vec::new(),
            owned_facets: Vec::new(),
            owner: owner.clone(),
        });
        match owner {
            OwnerRef::Tree => self.owned_polys.push(index),
            OwnerRef::Poly(poly_id) => {
                if let Some(poly) = self.polys.get_mut(poly_id.saturating_sub(1)) {
                    poly.owned_polys.push(index);
                }
            }
            _ => {}
        }
        index
    }

    fn next_polygon_path_and_node(
        &self,
        this_path: usize,
        this_node: usize,
    ) -> Result<(usize, usize)> {
        let path = &self.paths[this_path - 1];
        let mut that_node = path.nodes[0];
        if that_node == this_node {
            that_node = *path
                .nodes
                .last()
                .ok_or(TreeError::InvalidOperation("polygon path has no nodes"))?;
        }
        let this_angle = angle(point_sub(
            self.nodes[that_node - 1].loc,
            self.nodes[this_node - 1].loc,
        ));

        let mut delta = TWO_PI;
        let mut next_path = None;
        let mut next_node = None;
        for candidate_path in self.nodes[this_node - 1].leaf_paths.iter().copied() {
            if candidate_path == this_path || !self.paths[candidate_path - 1].is_polygon {
                continue;
            }
            let candidate = &self.paths[candidate_path - 1];
            let mut candidate_node = candidate.nodes[0];
            if candidate_node == this_node {
                candidate_node = *candidate
                    .nodes
                    .last()
                    .ok_or(TreeError::InvalidOperation("polygon path has no nodes"))?;
            }
            let candidate_angle = angle(point_sub(
                self.nodes[candidate_node - 1].loc,
                self.nodes[this_node - 1].loc,
            ));
            let mut new_delta = this_angle - candidate_angle;
            while new_delta < 0.0 {
                new_delta += TWO_PI;
            }
            while new_delta >= TWO_PI {
                new_delta -= TWO_PI;
            }
            if new_delta < delta {
                delta = new_delta;
                next_path = Some(candidate_path);
                next_node = Some(candidate_node);
            }
        }

        match (next_path, next_node) {
            (Some(path), Some(node)) => Ok((path, node)),
            _ => Err(TreeError::InvalidOperation(
                "polygon path walk could not advance",
            )),
        }
    }

    fn calc_poly_contents(&mut self, poly_id: usize) {
        let ring_nodes = self.polys[poly_id - 1].ring_nodes.clone();
        let mut centroid = Point { x: 0.0, y: 0.0 };
        let mut node_locs = Vec::with_capacity(ring_nodes.len());
        for node_id in ring_nodes {
            let loc = self.nodes[node_id - 1].loc;
            node_locs.push(loc);
            centroid.x += loc.x;
            centroid.y += loc.y;
        }
        if !node_locs.is_empty() {
            centroid.x /= node_locs.len() as TmFloat;
            centroid.y /= node_locs.len() as TmFloat;
        }
        let poly = &mut self.polys[poly_id - 1];
        poly.node_locs = node_locs;
        poly.centroid = centroid;
    }

    fn calc_poly_cross_paths(&mut self, poly_id: usize) {
        let ring_nodes = self.polys[poly_id - 1].ring_nodes.clone();
        let owner_paths = match self.polys[poly_id - 1].owner {
            OwnerRef::Tree => self.owned_paths.clone(),
            OwnerRef::Poly(owner_id) => self
                .polys
                .get(owner_id.saturating_sub(1))
                .map(|poly| poly.owned_paths.clone())
                .unwrap_or_default(),
            _ => Vec::new(),
        };
        let mut cross_paths = Vec::new();
        let nn = ring_nodes.len();
        for i in 2..nn {
            for j in 0..i - 1 {
                if i == nn - 1 && j == 0 {
                    continue;
                }
                if let Some(path_id) =
                    self.find_any_path_in(&owner_paths, ring_nodes[i], ring_nodes[j])
                {
                    push_unique(&mut cross_paths, path_id);
                }
            }
        }
        self.polys[poly_id - 1].cross_paths = cross_paths;
    }

    fn build_poly_contents_geometry(&mut self, poly_id: usize) -> Result<()> {
        if !self.polys[poly_id - 1].owned_nodes.is_empty() {
            return Ok(());
        }

        let ring_nodes = self.polys[poly_id - 1].ring_nodes.clone();
        let nn = ring_nodes.len();
        if nn < 3 {
            return Err(TreeError::InvalidOperation(
                "polygon contents require at least three ring nodes",
            ));
        }

        if nn == 3 {
            let p1 = self.nodes[ring_nodes[0] - 1].loc;
            let p2 = self.nodes[ring_nodes[1] - 1].loc;
            let p3 = self.nodes[ring_nodes[2] - 1].loc;
            let node_id = self.create_sub_node(poly_id, incenter(p1, p2, p3));
            self.nodes[node_id - 1].is_junction = true;
            self.nodes[node_id - 1].elevation =
                self.nodes[ring_nodes[0] - 1].elevation + inradius(p1, p2, p3);
            self.polys[poly_id - 1].inset_nodes = vec![node_id, node_id, node_id];

            for ring_node in ring_nodes {
                let path_id = self.create_sub_path(poly_id, ring_node, node_id, false);
                self.polys[poly_id - 1].spoke_paths.push(path_id);
            }
        } else {
            self.build_inset_poly_contents(poly_id)?;
        }

        self.build_poly_creases_and_facets(poly_id)?;
        Ok(())
    }

    fn build_inset_poly_contents(&mut self, poly_id: usize) -> Result<()> {
        let ring_nodes = self.polys[poly_id - 1].ring_nodes.clone();
        let nn = ring_nodes.len();
        let mut r = vec![Point { x: 0.0, y: 0.0 }; nn];
        let mut rp = vec![Point { x: 0.0, y: 0.0 }; nn];
        let mut rn = vec![Point { x: 0.0, y: 0.0 }; nn];
        let mut mr = vec![0.0; nn];

        for i in 0..nn {
            let ip = (i + nn - 1) % nn;
            let inext = (i + 1) % nn;
            let nip = self.nodes[ring_nodes[ip] - 1].loc;
            let nii = self.nodes[ring_nodes[i] - 1].loc;
            let nin = self.nodes[ring_nodes[inext] - 1].loc;
            rp[i] = normalize(point_sub(nip, nii));
            rn[i] = normalize(point_sub(nin, nii));
            let bis = normalize(rotate_ccw90(point_sub(rn[i], rp[i])));
            r[i] = point_div(bis, inner(bis, rotate_ccw90(rn[i])));
            mr[i] = inner(r[i], rp[i]);
        }

        let owner_paths = self.owner_paths_for_poly(poly_id);
        let h = self.calc_poly_inset_distance(poly_id, &owner_paths, &r, &rn, &mr)?;

        let mut inset_nodes = Vec::with_capacity(nn);
        for i in 0..nn {
            let p = point_add(self.nodes[ring_nodes[i] - 1].loc, point_mul(r[i], h));
            inset_nodes.push(self.get_or_make_inset_node(poly_id, p));
        }
        self.polys[poly_id - 1].inset_nodes = inset_nodes.clone();

        let owned_nodes = self.polys[poly_id - 1].owned_nodes.clone();
        for node_id in owned_nodes.iter().copied() {
            self.nodes[node_id - 1].elevation = self.nodes[ring_nodes[0] - 1].elevation + h;
        }

        match owned_nodes.len() {
            0 => {
                return Err(TreeError::InvalidOperation(
                    "polygon inset produced no owned nodes",
                ));
            }
            1 | 2 => {
                self.create_spoke_paths(poly_id, &ring_nodes, &inset_nodes);
                if owned_nodes.len() == 2 {
                    let ridge =
                        self.create_sub_path(poly_id, owned_nodes[0], owned_nodes[1], false);
                    self.polys[poly_id - 1].ridge_path = Some(ridge);
                }
            }
            _ => {
                for dij in 1..nn {
                    for i in 0..=nn - dij {
                        let j = (i + dij) % nn;
                        let ni = ring_nodes[i];
                        let nj = ring_nodes[j];
                        let rni = inset_nodes[i];
                        let rnj = inset_nodes[j];
                        if rni == rnj || self.find_leaf_path_between_any(rni, rnj).is_some() {
                            continue;
                        }

                        let outset_path = self
                            .find_any_path_in(&owner_paths, ni, nj)
                            .ok_or(TreeError::InvalidOperation("missing outset path"))?;
                        let i_reduction = h * mr[i];
                        let j_reduction = h * mr[j];

                        let (front, back, front_reduction, back_reduction) =
                            if self.paths[outset_path - 1].nodes.first().copied() == Some(ni) {
                                (rni, rnj, i_reduction, j_reduction)
                            } else {
                                (rnj, rni, j_reduction, i_reduction)
                            };
                        let path_id = self.create_sub_path(poly_id, front, back, true);
                        let min_paper_length = self.paths[outset_path - 1].min_paper_length
                            - (front_reduction + back_reduction);
                        let act_paper_length =
                            self.nodes[rni - 1].loc.distance(self.nodes[rnj - 1].loc);
                        let outset_active = self.paths[outset_path - 1].is_active;
                        let path = &mut self.paths[path_id - 1];
                        path.outset_path = Some(outset_path);
                        path.front_reduction = front_reduction;
                        path.back_reduction = back_reduction;
                        path.min_paper_length = min_paper_length;
                        path.act_paper_length = act_paper_length;
                        path.min_tree_length = min_paper_length / self.scale;
                        path.act_tree_length = act_paper_length / self.scale;
                        path.is_active =
                            outset_active || is_tiny(act_paper_length - min_paper_length);
                        path.is_border = dij == 1;
                        path.is_polygon = path.is_active || path.is_border;
                    }
                }

                let owned_paths = self.polys[poly_id - 1].owned_paths.clone();
                self.build_polys_from_paths(&owned_paths, &inset_nodes, OwnerRef::Poly(poly_id))?;

                let owned_polys = self.polys[poly_id - 1].owned_polys.clone();
                for sub_poly_id in owned_polys {
                    self.build_poly_contents_geometry(sub_poly_id)?;
                }

                self.create_spoke_paths(poly_id, &ring_nodes, &inset_nodes);
            }
        }

        Ok(())
    }

    fn calc_poly_inset_distance(
        &self,
        poly_id: usize,
        owner_paths: &[usize],
        r: &[Point],
        rn: &[Point],
        mr: &[TmFloat],
    ) -> Result<TmFloat> {
        let ring_nodes = &self.polys[poly_id - 1].ring_nodes;
        let nn = ring_nodes.len();
        let mut h = 1.0e10;

        for i in 0..nn - 1 {
            for j in i + 1..nn {
                if are_parallel(r[i], r[j]) && inner(r[i], r[j]) > 0.0 {
                    continue;
                }

                let ni = self.nodes[ring_nodes[i] - 1].loc;
                let nj = self.nodes[ring_nodes[j] - 1].loc;
                if j == i + 1 || (i == 0 && j == nn - 1) {
                    let Some(bi) = line_intersection_point_exact(ni, r[i], nj, r[j]) else {
                        return Err(TreeError::InvalidOperation(
                            "adjacent inset bisectors are parallel",
                        ));
                    };
                    let h1 = inner(point_sub(bi, ni), rotate_ccw90(rn[i]));
                    if h1 > 0.0 && h > h1 {
                        h = h1;
                    }
                } else {
                    let path_id = self
                        .find_any_path_in(owner_paths, ring_nodes[i], ring_nodes[j])
                        .ok_or(TreeError::InvalidOperation("missing poly cross path"))?;
                    let lij = self.paths[path_id - 1].min_paper_length;
                    let u = point_sub(ni, nj);
                    let v = point_sub(r[i], r[j]);
                    let w = mr[i] + mr[j];
                    let a = mag2(v) - w.powi(2);
                    let b = inner(u, v) + lij * w;
                    let c = mag2(u) - lij.powi(2);
                    let d = b.powi(2) - a * c;
                    if d < 0.0 {
                        continue;
                    }

                    let sd = d.sqrt();
                    for h1 in [(-b + sd) / a, (-b - sd) / a] {
                        let lijp = lij - h1 * w;
                        if lijp > 0.0 && h1 > 0.0 && h > h1 {
                            h = h1;
                        }
                    }
                }
            }
        }

        if h == 1.0e10 {
            return Err(TreeError::InvalidOperation(
                "polygon inset distance was not found",
            ));
        }
        Ok(h)
    }

    fn create_spoke_paths(&mut self, poly_id: usize, ring_nodes: &[usize], inset_nodes: &[usize]) {
        for (ring_node, inset_node) in ring_nodes.iter().copied().zip(inset_nodes.iter().copied()) {
            let path_id = self.create_sub_path(poly_id, ring_node, inset_node, false);
            self.polys[poly_id - 1].spoke_paths.push(path_id);
        }
    }

    fn create_sub_node(&mut self, poly_id: usize, loc: Point) -> usize {
        let index = self.nodes.len() + 1;
        self.nodes.push(Node {
            index,
            label: String::new(),
            loc,
            depth: DEPTH_NOT_SET,
            elevation: 0.0,
            is_leaf: false,
            is_sub: true,
            is_border: false,
            is_pinned: false,
            is_polygon: false,
            is_junction: false,
            is_conditioned: false,
            owned_vertices: Vec::new(),
            edges: Vec::new(),
            leaf_paths: Vec::new(),
            owner: OwnerRef::Poly(poly_id),
        });
        self.polys[poly_id - 1].owned_nodes.push(index);
        index
    }

    fn get_or_make_inset_node(&mut self, poly_id: usize, loc: Point) -> usize {
        let owned_nodes = self.polys[poly_id - 1].owned_nodes.clone();
        for node_id in owned_nodes {
            if self.nodes[node_id - 1].loc.distance(loc) < DIST_TOL {
                self.nodes[node_id - 1].is_junction = true;
                return node_id;
            }
        }
        self.create_sub_node(poly_id, loc)
    }

    fn create_sub_path(
        &mut self,
        poly_id: usize,
        front_node: usize,
        back_node: usize,
        connect_leaf_path: bool,
    ) -> usize {
        let index = self.paths.len() + 1;
        self.paths.push(Path {
            index,
            min_tree_length: 0.0,
            min_paper_length: 0.0,
            act_tree_length: 0.0,
            act_paper_length: 0.0,
            is_leaf: false,
            is_sub: true,
            is_feasible: false,
            is_active: false,
            is_border: false,
            is_polygon: false,
            is_conditioned: false,
            fwd_poly: None,
            bkd_poly: None,
            nodes: vec![front_node, back_node],
            edges: Vec::new(),
            outset_path: None,
            front_reduction: 0.0,
            back_reduction: 0.0,
            min_depth: DEPTH_NOT_SET,
            min_depth_dist: DEPTH_NOT_SET,
            owned_vertices: Vec::new(),
            owned_creases: Vec::new(),
            owner: OwnerRef::Poly(poly_id),
        });
        self.polys[poly_id - 1].owned_paths.push(index);
        if connect_leaf_path {
            self.nodes[front_node - 1].leaf_paths.push(index);
            self.nodes[back_node - 1].leaf_paths.push(index);
        }
        index
    }

    fn owner_paths_for_poly(&self, poly_id: usize) -> Vec<usize> {
        match self.polys[poly_id - 1].owner {
            OwnerRef::Tree => self.owned_paths.clone(),
            OwnerRef::Poly(owner_id) => self
                .polys
                .get(owner_id.saturating_sub(1))
                .map(|poly| poly.owned_paths.clone())
                .unwrap_or_default(),
            _ => Vec::new(),
        }
    }

    fn find_leaf_path_between_any(&self, node1: usize, node2: usize) -> Option<usize> {
        self.nodes[node1 - 1]
            .leaf_paths
            .iter()
            .copied()
            .find(|path_id| {
                self.paths
                    .get(path_id.saturating_sub(1))
                    .and_then(|path| path.nodes.first().copied().zip(path.nodes.last().copied()))
                    .is_some_and(|(a, b)| a == node2 || b == node2)
            })
    }

    fn build_poly_creases_and_facets(&mut self, poly_id: usize) -> Result<()> {
        let nn = self.polys[poly_id - 1].ring_nodes.len();

        for i in 0..nn {
            let front_node = self.polys[poly_id - 1].ring_nodes[i];
            let back_node = self.polys[poly_id - 1].ring_nodes[(i + 1) % nn];
            let path_id = self.polys[poly_id - 1].ring_paths[i];

            if self.path_is_axial(path_id) || self.path_is_gusset(path_id) {
                self.build_self_vertices(path_id)?;
            }

            if self.path_is_active_axial(path_id) || self.path_is_gusset(path_id) {
                let (_, ridge_paths) =
                    self.get_ridgeline_nodes_and_paths(poly_id, front_node, back_node)?;
                let bottom_vertices = self.paths[path_id - 1].owned_vertices.clone();
                let p1 = self.nodes[front_node - 1].loc;
                let p2 = self.nodes[back_node - 1].loc;
                for bottom_vertex in bottom_vertices {
                    let bottom_loc = self.vertices[bottom_vertex - 1].loc;
                    let tree_node = self.vertices[bottom_vertex - 1].tree_node;
                    for ridge_path in ridge_paths.iter().copied() {
                        let q1 = self.nodes[self.paths[ridge_path - 1].nodes[0] - 1].loc;
                        let q2 =
                            self.nodes[*self.paths[ridge_path - 1].nodes.last().unwrap() - 1].loc;
                        if let Some(q) = project_p_to_q(p1, p2, bottom_loc, q1, q2) {
                            let top_vertex = self.get_or_make_path_vertex(ridge_path, q, tree_node);
                            let outermost_poly = self.outermost_poly(poly_id);
                            self.get_or_make_crease(
                                OwnerRef::Poly(outermost_poly),
                                bottom_vertex,
                                top_vertex,
                                CREASE_UNFOLDED_HINGE,
                            )?;
                        }
                    }
                }
            }
        }

        for i in 0..nn {
            let front_node = self.polys[poly_id - 1].ring_nodes[i];
            let back_node = self.polys[poly_id - 1].ring_nodes[(i + 1) % nn];
            let path_id = self.polys[poly_id - 1].ring_paths[i];

            if self.path_is_axial(path_id) || self.path_is_gusset(path_id) {
                let ridge_vertices = self.get_ridgeline_vertices(poly_id, front_node, back_node)?;
                if let Some((&first, rest)) = ridge_vertices.split_first() {
                    let outermost_poly = self.outermost_poly(poly_id);
                    let mut ridge_vertex = first;
                    for next_ridge_vertex in rest.iter().copied() {
                        self.get_or_make_crease(
                            OwnerRef::Poly(outermost_poly),
                            ridge_vertex,
                            next_ridge_vertex,
                            CREASE_RIDGE,
                        )?;
                        ridge_vertex = next_ridge_vertex;
                    }
                }

                if self.path_is_axial(path_id) && !self.paths[path_id - 1].is_active {
                    self.propagate_inactive_axial_hinges(poly_id, path_id, &ridge_vertices)?;
                }
            }

            if self.path_is_axial(path_id) || self.path_is_gusset(path_id) {
                let crease_kind = if self.path_is_axial(path_id) {
                    CREASE_AXIAL
                } else {
                    CREASE_GUSSET
                };
                self.connect_self_vertices(path_id, crease_kind)?;
            }
        }

        if self.polys[poly_id - 1].is_sub_poly {
            return Ok(());
        }

        let mut facet_creases = self.polys[poly_id - 1].owned_creases.clone();
        for path_id in self.polys[poly_id - 1].ring_paths.clone() {
            for crease_id in self.paths[path_id - 1].owned_creases.iter().copied() {
                push_unique(&mut facet_creases, crease_id);
            }
        }
        self.build_facets_from_creases(poly_id, &facet_creases)
    }

    fn path_is_axial(&self, path_id: usize) -> bool {
        let path = &self.paths[path_id - 1];
        path.is_leaf && path.is_polygon
    }

    fn path_is_active_axial(&self, path_id: usize) -> bool {
        let path = &self.paths[path_id - 1];
        path.is_active && path.is_leaf
    }

    fn path_is_gusset(&self, path_id: usize) -> bool {
        let path = &self.paths[path_id - 1];
        path.is_active && !path.is_border
    }

    fn get_or_make_node_vertex(&mut self, node_id: usize) -> usize {
        if let Some(vertex_id) = self.nodes[node_id - 1].owned_vertices.first().copied() {
            return vertex_id;
        }
        let index = self.vertices.len() + 1;
        let node = &self.nodes[node_id - 1];
        self.vertices.push(Vertex {
            index,
            loc: node.loc,
            elevation: node.elevation,
            is_border: node.is_border,
            tree_node: (!node.is_sub).then_some(node_id),
            left_pseudohinge_mate: None,
            right_pseudohinge_mate: None,
            creases: Vec::new(),
            depth: DEPTH_NOT_SET,
            discrete_depth: usize::MAX,
            cc_flag: 0,
            st_flag: 0,
            owner: OwnerRef::Node(node_id),
        });
        self.nodes[node_id - 1].owned_vertices.push(index);
        index
    }

    fn get_or_make_path_vertex(
        &mut self,
        path_id: usize,
        loc: Point,
        tree_node: Option<usize>,
    ) -> usize {
        let front_node = self.paths[path_id - 1].nodes[0];
        let back_node = *self.paths[path_id - 1].nodes.last().unwrap();
        let vertex_id = if vertices_same_loc(loc, self.nodes[front_node - 1].loc) {
            self.get_or_make_node_vertex(front_node)
        } else if vertices_same_loc(loc, self.nodes[back_node - 1].loc) {
            self.get_or_make_node_vertex(back_node)
        } else if let Some(vertex_id) = self.paths[path_id - 1]
            .owned_vertices
            .iter()
            .copied()
            .find(|vertex_id| vertices_same_loc(loc, self.vertices[*vertex_id - 1].loc))
        {
            vertex_id
        } else {
            self.make_path_vertex(path_id, loc, tree_node)
        };

        if self.vertices[vertex_id - 1].tree_node.is_none() && tree_node.is_some() {
            self.vertices[vertex_id - 1].tree_node = tree_node;
        }
        vertex_id
    }

    fn make_path_vertex(&mut self, path_id: usize, loc: Point, tree_node: Option<usize>) -> usize {
        let front_node = self.paths[path_id - 1].nodes[0];
        let back_node = *self.paths[path_id - 1].nodes.last().unwrap();
        let p1 = self.nodes[front_node - 1].loc;
        let p2 = self.nodes[back_node - 1].loc;
        let dist_p = loc.distance(p1);
        let x = dist_p / p2.distance(p1);
        let elevation = (1.0 - x) * self.nodes[front_node - 1].elevation
            + x * self.nodes[back_node - 1].elevation;

        let index = self.vertices.len() + 1;
        self.vertices.push(Vertex {
            index,
            loc,
            elevation,
            is_border: self.paths[path_id - 1].is_border,
            tree_node,
            left_pseudohinge_mate: None,
            right_pseudohinge_mate: None,
            creases: Vec::new(),
            depth: DEPTH_NOT_SET,
            discrete_depth: usize::MAX,
            cc_flag: 0,
            st_flag: 0,
            owner: OwnerRef::Path(path_id),
        });

        let insert_at = self.paths[path_id - 1]
            .owned_vertices
            .iter()
            .position(|vertex_id| dist_p < self.vertices[*vertex_id - 1].loc.distance(p1));
        if let Some(pos) = insert_at {
            self.paths[path_id - 1].owned_vertices.insert(pos, index);
        } else {
            self.paths[path_id - 1].owned_vertices.push(index);
        }

        let split = self.paths[path_id - 1]
            .owned_creases
            .iter()
            .copied()
            .find_map(|crease_id| {
                let crease = &self.creases[crease_id - 1];
                let front_vertex = crease.vertices[0];
                let back_vertex = crease.vertices[1];
                let pc1 = self.vertices[front_vertex - 1].loc;
                let pc2 = self.vertices[back_vertex - 1].loc;
                let pc21 = point_sub(pc2, pc1);
                let x = inner(point_sub(loc, pc1), pc21) / mag2(pc21);
                (x > 0.0 && x < 1.0).then_some((crease_id, front_vertex, back_vertex, crease.kind))
            });
        if let Some((crease_id, front_vertex, back_vertex, kind)) = split {
            let _ = self.create_crease(OwnerRef::Path(path_id), front_vertex, index, kind);
            let _ = self.create_crease(OwnerRef::Path(path_id), index, back_vertex, kind);
            self.delete_creases(&[crease_id]);
        }

        index
    }

    fn build_self_vertices(&mut self, path_id: usize) -> Result<()> {
        let front_node = self.paths[path_id - 1].nodes[0];
        let back_node = *self.paths[path_id - 1].nodes.last().unwrap();
        let front_vertex = self.get_or_make_node_vertex(front_node);
        let back_vertex = self.get_or_make_node_vertex(back_node);

        if !self.paths[path_id - 1].owned_vertices.is_empty() {
            return Ok(());
        }
        if !self.paths[path_id - 1].is_active {
            return Ok(());
        }

        let q1 = self.vertices[front_vertex - 1].loc;
        let q2 = self.vertices[back_vertex - 1].loc;
        let act_paper_length = self.paths[path_id - 1].act_paper_length;
        if act_paper_length == 0.0 {
            return Ok(());
        }
        let qu = point_div(point_sub(q2, q1), act_paper_length);
        let (max_outset_path, max_front_reduction, _) = self.max_outset_path(path_id);
        let mut cur_pos = -max_front_reduction;
        let edge_ids = self.paths[max_outset_path - 1].edges.clone();
        let node_ids = self.paths[max_outset_path - 1].nodes.clone();
        for (i, edge_id) in edge_ids.iter().copied().enumerate() {
            let cur_node = node_ids[i + 1];
            cur_pos += self.edges[edge_id - 1].strained_length() * self.scale;
            if cur_pos <= 0.0 {
                continue;
            }
            if cur_pos >= act_paper_length {
                break;
            }
            self.get_or_make_path_vertex(
                path_id,
                point_add(q1, point_mul(qu, cur_pos)),
                Some(cur_node),
            );
        }
        Ok(())
    }

    fn max_outset_path(&self, path_id: usize) -> (usize, TmFloat, TmFloat) {
        if let Some(outset_path) = self.paths[path_id - 1].outset_path {
            let (max_path, front, back) = self.max_outset_path(outset_path);
            (
                max_path,
                front + self.paths[path_id - 1].front_reduction,
                back + self.paths[path_id - 1].back_reduction,
            )
        } else {
            (path_id, 0.0, 0.0)
        }
    }

    fn connect_self_vertices(&mut self, path_id: usize, kind: i32) -> Result<()> {
        let front_node = self.paths[path_id - 1].nodes[0];
        let back_node = *self.paths[path_id - 1].nodes.last().unwrap();
        let mut front_vertex = self
            .nodes
            .get(front_node - 1)
            .and_then(|node| node.owned_vertices.first().copied())
            .ok_or(TreeError::InvalidOperation("path front vertex missing"))?;
        for back_vertex in self.paths[path_id - 1].owned_vertices.clone() {
            self.get_or_make_crease(OwnerRef::Path(path_id), front_vertex, back_vertex, kind)?;
            front_vertex = back_vertex;
        }
        let back_vertex = self
            .nodes
            .get(back_node - 1)
            .and_then(|node| node.owned_vertices.first().copied())
            .ok_or(TreeError::InvalidOperation("path back vertex missing"))?;
        self.get_or_make_crease(OwnerRef::Path(path_id), front_vertex, back_vertex, kind)?;
        Ok(())
    }

    fn get_ridgeline_nodes_and_paths(
        &self,
        poly_id: usize,
        front_node: usize,
        back_node: usize,
    ) -> Result<(Vec<usize>, Vec<usize>)> {
        let poly = &self.polys[poly_id - 1];
        let front_offset = poly
            .ring_nodes
            .iter()
            .position(|node| *node == front_node)
            .ok_or(TreeError::InvalidOperation(
                "ridgeline front node not in poly",
            ))?;
        let back_offset = poly
            .ring_nodes
            .iter()
            .position(|node| *node == back_node)
            .ok_or(TreeError::InvalidOperation(
                "ridgeline back node not in poly",
            ))?;

        let mut ridge_nodes = vec![front_node];
        let mut ridge_paths = vec![poly.spoke_paths[front_offset]];
        match poly.owned_nodes.len() {
            1 => ridge_nodes.push(poly.owned_nodes[0]),
            2 => {
                let front_inset = poly.inset_nodes[front_offset];
                let back_inset = poly.inset_nodes[back_offset];
                ridge_nodes.push(front_inset);
                if front_inset != back_inset {
                    ridge_paths.push(
                        poly.ridge_path
                            .ok_or(TreeError::InvalidOperation("ridgeline path missing"))?,
                    );
                    ridge_nodes.push(back_inset);
                }
            }
            _ => {
                let front_inset = poly.inset_nodes[front_offset];
                let back_inset = poly.inset_nodes[back_offset];
                if front_inset == back_inset {
                    ridge_nodes.push(front_inset);
                } else {
                    let sub_poly = poly
                        .owned_polys
                        .iter()
                        .copied()
                        .find(|sub_poly_id| {
                            let sub_poly = &self.polys[*sub_poly_id - 1];
                            sub_poly.ring_nodes.contains(&front_inset)
                                && sub_poly.ring_nodes.contains(&back_inset)
                        })
                        .ok_or(TreeError::InvalidOperation("ridgeline subpoly missing"))?;
                    let (sub_nodes, sub_paths) =
                        self.get_ridgeline_nodes_and_paths(sub_poly, front_inset, back_inset)?;
                    ridge_nodes.extend(sub_nodes);
                    ridge_paths.extend(sub_paths);
                }
            }
        }
        ridge_paths.push(poly.spoke_paths[back_offset]);
        ridge_nodes.push(back_node);
        Ok((ridge_nodes, ridge_paths))
    }

    fn get_ridgeline_vertices(
        &mut self,
        poly_id: usize,
        front_node: usize,
        back_node: usize,
    ) -> Result<Vec<usize>> {
        let (ridge_nodes, ridge_paths) =
            self.get_ridgeline_nodes_and_paths(poly_id, front_node, back_node)?;
        let p1 = self.nodes[front_node - 1].loc;
        let p2 = self.nodes[back_node - 1].loc;
        let mut vertices = Vec::new();
        for ridge_node in ridge_nodes {
            if self.nodes[ridge_node - 1].is_junction {
                self.get_or_make_node_vertex(ridge_node);
            }
            if let Some(vertex_id) = self.nodes[ridge_node - 1].owned_vertices.first().copied() {
                vertices.push(vertex_id);
            }
        }
        for ridge_path in ridge_paths {
            vertices.extend(self.paths[ridge_path - 1].owned_vertices.iter().copied());
        }
        vertices.sort_by(|a, b| {
            sortable_ridge_vertex_value(self.vertices[*a - 1].loc, p1, p2).total_cmp(
                &sortable_ridge_vertex_value(self.vertices[*b - 1].loc, p1, p2),
            )
        });
        Ok(vertices)
    }

    fn propagate_inactive_axial_hinges(
        &mut self,
        poly_id: usize,
        path_id: usize,
        ridge_vertices: &[usize],
    ) -> Result<()> {
        if ridge_vertices.len() < 3 {
            return Ok(());
        }
        let front_node = self.paths[path_id - 1].nodes[0];
        let back_node = *self.paths[path_id - 1].nodes.last().unwrap();
        let front_vertex = self
            .nodes
            .get(front_node - 1)
            .and_then(|node| node.owned_vertices.first().copied())
            .ok_or(TreeError::InvalidOperation(
                "inactive axial front vertex missing",
            ))?;
        let back_vertex = self
            .nodes
            .get(back_node - 1)
            .and_then(|node| node.owned_vertices.first().copied())
            .ok_or(TreeError::InvalidOperation(
                "inactive axial back vertex missing",
            ))?;
        let p1 = self.vertices[front_vertex - 1].loc;
        let p2 = self.vertices[back_vertex - 1].loc;
        let mut crease0 = None;
        let mut crease1 = None;
        let mut crease2 = None;

        for m in 1..ridge_vertices.len() - 1 {
            let ridge_vertex = ridge_vertices[m];
            let tree_node = self.vertices[ridge_vertex - 1].tree_node;
            let mut needs_crease = tree_node.is_some();
            let mut kind = CREASE_UNFOLDED_HINGE;
            if !needs_crease {
                let prev_tree_node = self.vertices[ridge_vertices[m - 1] - 1].tree_node;
                let next_tree_node = self.vertices[ridge_vertices[m + 1] - 1].tree_node;
                if prev_tree_node.is_some() && prev_tree_node == next_tree_node {
                    needs_crease = true;
                    kind = CREASE_PSEUDOHINGE;
                }
            }
            if !needs_crease {
                continue;
            }
            if let Some(p) = project_q_to_p(self.vertices[ridge_vertex - 1].loc, p1, p2) {
                let bottom_vertex = self.get_or_make_path_vertex(path_id, p, tree_node);
                crease2 = crease1;
                crease1 = crease0;
                crease0 = Some(self.get_or_make_crease(
                    OwnerRef::Poly(self.outermost_poly(poly_id)),
                    bottom_vertex,
                    ridge_vertex,
                    kind,
                )?);
            }
            if let (Some(c0), Some(c1), Some(c2)) = (crease0, crease1, crease2)
                && self.creases[c0 - 1].kind == CREASE_UNFOLDED_HINGE
                && self.creases[c1 - 1].kind == CREASE_PSEUDOHINGE
                && self.creases[c2 - 1].kind == CREASE_UNFOLDED_HINGE
            {
                let mate0 = self.lower_crease_vertex(c0);
                let mate2 = self.lower_crease_vertex(c2);
                self.vertices[mate0 - 1].right_pseudohinge_mate = Some(mate2);
                self.vertices[mate2 - 1].left_pseudohinge_mate = Some(mate0);
            }
        }
        Ok(())
    }

    fn outermost_poly(&self, mut poly_id: usize) -> usize {
        while let OwnerRef::Poly(owner_id) = self.polys[poly_id - 1].owner {
            poly_id = owner_id;
        }
        poly_id
    }

    fn lower_crease_vertex(&self, crease_id: usize) -> usize {
        let crease = &self.creases[crease_id - 1];
        let v1 = crease.vertices[0];
        let v2 = crease.vertices[1];
        if self.vertices[v1 - 1].elevation < self.vertices[v2 - 1].elevation {
            v1
        } else {
            v2
        }
    }

    fn get_or_make_crease(
        &mut self,
        owner: OwnerRef,
        vertex1: usize,
        vertex2: usize,
        kind: i32,
    ) -> Result<usize> {
        let owned_creases = self.owned_creases_for_owner(&owner);
        if let Some(crease_id) = owned_creases.into_iter().find(|crease_id| {
            let crease = &self.creases[*crease_id - 1];
            matches!(
                crease.vertices.first().copied().zip(crease.vertices.last().copied()),
                Some((a, b)) if (a == vertex1 && b == vertex2) || (a == vertex2 && b == vertex1)
            )
        }) {
            return Ok(crease_id);
        }
        self.create_crease(owner, vertex1, vertex2, kind)
    }

    fn create_crease(
        &mut self,
        owner: OwnerRef,
        vertex1: usize,
        vertex2: usize,
        kind: i32,
    ) -> Result<usize> {
        if vertex1 == vertex2 {
            return Err(TreeError::InvalidOperation(
                "crease endpoints must be distinct vertices",
            ));
        }
        let index = self.creases.len() + 1;
        self.creases.push(Crease {
            index,
            kind,
            vertices: vec![vertex1, vertex2],
            fwd_facet: None,
            bkd_facet: None,
            fold: FOLD_FLAT,
            cc_flag: 0,
            st_flag: 0,
            owner: owner.clone(),
        });
        match owner {
            OwnerRef::Path(path_id) => self.paths[path_id - 1].owned_creases.push(index),
            OwnerRef::Poly(poly_id) => self.polys[poly_id - 1].owned_creases.push(index),
            _ => {}
        }
        self.vertices[vertex1 - 1].creases.push(index);
        self.vertices[vertex2 - 1].creases.push(index);
        Ok(index)
    }

    fn owned_creases_for_owner(&self, owner: &OwnerRef) -> Vec<usize> {
        match *owner {
            OwnerRef::Path(path_id) => self
                .paths
                .get(path_id.saturating_sub(1))
                .map(|path| path.owned_creases.clone())
                .unwrap_or_default(),
            OwnerRef::Poly(poly_id) => self
                .polys
                .get(poly_id.saturating_sub(1))
                .map(|poly| poly.owned_creases.clone())
                .unwrap_or_default(),
            _ => Vec::new(),
        }
    }

    fn build_facets_from_creases(&mut self, poly_id: usize, crease_list: &[usize]) -> Result<()> {
        if crease_list.is_empty() {
            return Ok(());
        }
        for crease_id in crease_list.iter().copied() {
            if self.can_start_facet_fwd(poly_id, crease_id) {
                self.build_facet_ring(poly_id, crease_id, true)?;
            }
            if self.can_start_facet_bkd(poly_id, crease_id) {
                self.build_facet_ring(poly_id, crease_id, false)?;
            }
        }
        Ok(())
    }

    fn can_start_facet_fwd(&self, poly_id: usize, crease_id: usize) -> bool {
        let crease = &self.creases[crease_id - 1];
        if crease.fwd_facet.is_some() {
            return false;
        }
        if crease.kind != CREASE_AXIAL {
            return true;
        }
        are_ccw(
            self.vertices[crease.vertices[0] - 1].loc,
            self.vertices[crease.vertices[1] - 1].loc,
            self.polys[poly_id - 1].centroid,
        )
    }

    fn can_start_facet_bkd(&self, poly_id: usize, crease_id: usize) -> bool {
        let crease = &self.creases[crease_id - 1];
        if crease.bkd_facet.is_some() {
            return false;
        }
        if crease.kind != CREASE_AXIAL {
            return true;
        }
        are_cw(
            self.vertices[crease.vertices[0] - 1].loc,
            self.vertices[crease.vertices[1] - 1].loc,
            self.polys[poly_id - 1].centroid,
        )
    }

    fn build_facet_ring(&mut self, poly_id: usize, crease_id: usize, fwd: bool) -> Result<()> {
        let facet_id = self.create_facet(poly_id);
        if fwd {
            self.creases[crease_id - 1].fwd_facet = Some(facet_id);
        } else {
            self.creases[crease_id - 1].bkd_facet = Some(facet_id);
        }

        let first_vertex = if fwd {
            self.creases[crease_id - 1].vertices[0]
        } else {
            self.creases[crease_id - 1].vertices[1]
        };
        let mut this_vertex = if fwd {
            self.creases[crease_id - 1].vertices[1]
        } else {
            self.creases[crease_id - 1].vertices[0]
        };
        let mut this_crease = crease_id;
        let mut vertices = vec![first_vertex];
        let mut creases = vec![this_crease];
        let mut too_many = 0;

        loop {
            let (next_crease, next_vertex) =
                self.next_crease_and_vertex(this_crease, this_vertex)?;
            vertices.push(this_vertex);
            creases.push(next_crease);
            if self.creases[next_crease - 1].vertices.first().copied() == Some(this_vertex) {
                self.creases[next_crease - 1].fwd_facet = Some(facet_id);
            } else {
                self.creases[next_crease - 1].bkd_facet = Some(facet_id);
            }
            this_crease = next_crease;
            this_vertex = next_vertex;
            too_many += 1;
            if next_vertex == first_vertex {
                break;
            }
            if too_many >= 100 {
                return Err(TreeError::InvalidOperation(
                    "facet ring walk exceeded TreeMaker guard",
                ));
            }
        }

        self.facets[facet_id - 1].vertices = vertices;
        self.facets[facet_id - 1].creases = creases;
        self.calc_facet_contents(facet_id);
        Ok(())
    }

    fn create_facet(&mut self, poly_id: usize) -> usize {
        let index = self.facets.len() + 1;
        self.facets.push(Facet {
            index,
            centroid: Point { x: 0.0, y: 0.0 },
            is_well_formed: true,
            vertices: Vec::new(),
            creases: Vec::new(),
            corridor_edge: None,
            head_facets: Vec::new(),
            tail_facets: Vec::new(),
            order: usize::MAX,
            color: 0,
            owner: OwnerRef::Poly(poly_id),
        });
        self.polys[poly_id - 1].owned_facets.push(index);
        index
    }

    fn next_crease_and_vertex(
        &self,
        this_crease: usize,
        this_vertex: usize,
    ) -> Result<(usize, usize)> {
        let crease = &self.creases[this_crease - 1];
        let mut that_vertex = crease.vertices[0];
        if that_vertex == this_vertex {
            that_vertex = crease.vertices[1];
        }
        let this_angle = angle(point_sub(
            self.vertices[that_vertex - 1].loc,
            self.vertices[this_vertex - 1].loc,
        ));

        let mut delta = TWO_PI;
        let mut next_crease = None;
        let mut next_vertex = None;
        for candidate_crease in self.vertices[this_vertex - 1].creases.iter().copied() {
            if candidate_crease == this_crease {
                continue;
            }
            let candidate = &self.creases[candidate_crease - 1];
            let mut candidate_vertex = candidate.vertices[0];
            if candidate_vertex == this_vertex {
                candidate_vertex = candidate.vertices[1];
            }
            let next_angle = angle(point_sub(
                self.vertices[candidate_vertex - 1].loc,
                self.vertices[this_vertex - 1].loc,
            ));
            let mut new_delta = this_angle - next_angle;
            while new_delta < 0.0 {
                new_delta += TWO_PI;
            }
            while new_delta >= TWO_PI {
                new_delta -= TWO_PI;
            }
            if new_delta < delta {
                delta = new_delta;
                next_crease = Some(candidate_crease);
                next_vertex = Some(candidate_vertex);
            }
        }

        match (next_crease, next_vertex) {
            (Some(crease), Some(vertex)) => Ok((crease, vertex)),
            _ => Err(TreeError::InvalidOperation(
                "facet crease walk could not advance",
            )),
        }
    }

    fn calc_facet_contents(&mut self, facet_id: usize) {
        let mut centroid = Point { x: 0.0, y: 0.0 };
        let vertices = self.facets[facet_id - 1].vertices.clone();
        for vertex_id in vertices.iter().copied() {
            centroid = point_add(centroid, self.vertices[vertex_id - 1].loc);
        }
        if !vertices.is_empty() {
            centroid = point_div(centroid, vertices.len() as TmFloat);
        }
        self.facets[facet_id - 1].centroid = centroid;
        self.facets[facet_id - 1].is_well_formed = true;

        let num_vertices = self.facets[facet_id - 1].vertices.len();
        let mut rotations = 0;
        while self.facets[facet_id - 1]
            .creases
            .first()
            .is_some_and(|crease_id| !self.crease_is_axial_or_gusset(*crease_id))
        {
            self.facets[facet_id - 1].vertices.rotate_left(1);
            self.facets[facet_id - 1].creases.rotate_left(1);
            rotations += 1;
            if rotations >= num_vertices {
                self.facets[facet_id - 1].is_well_formed = false;
                break;
            }
        }
    }

    fn crease_is_axial_or_gusset(&self, crease_id: usize) -> bool {
        matches!(
            self.creases[crease_id - 1].kind,
            CREASE_AXIAL | CREASE_GUSSET
        )
    }

    fn find_any_path_in(&self, path_ids: &[usize], node1: usize, node2: usize) -> Option<usize> {
        path_ids.iter().copied().find(|path_id| {
            self.paths
                .get(path_id.saturating_sub(1))
                .and_then(|path| path.nodes.first().copied().zip(path.nodes.last().copied()))
                .is_some_and(|(a, b)| (a == node1 && b == node2) || (a == node2 && b == node1))
        })
    }

    fn paths_intersect_interior(&self, path1: usize, path2: usize) -> bool {
        let path1 = &self.paths[path1 - 1];
        let path2 = &self.paths[path2 - 1];
        let Some((path1_front, path1_back)) = path1
            .nodes
            .first()
            .copied()
            .zip(path1.nodes.last().copied())
        else {
            return false;
        };
        let Some((path2_front, path2_back)) = path2
            .nodes
            .first()
            .copied()
            .zip(path2.nodes.last().copied())
        else {
            return false;
        };
        if path1_front == path2_front
            || path1_front == path2_back
            || path1_back == path2_front
            || path1_back == path2_back
        {
            return false;
        }

        let p = self.nodes[path1_front - 1].loc;
        let rp = point_sub(self.nodes[path1_back - 1].loc, p);
        let q = self.nodes[path2_front - 1].loc;
        let rq = point_sub(self.nodes[path2_back - 1].loc, q);
        let Some((tp, tq)) = line_intersection_params(p, rp, q, rq) else {
            return false;
        };
        if tp <= 0.0 || tp >= 1.0 || tq <= 0.0 || tq >= 1.0 {
            return false;
        }
        true
    }

    fn node_centroid(&self, node_ids: &[usize]) -> Point {
        let mut centroid = Point { x: 0.0, y: 0.0 };
        for node_id in node_ids {
            let loc = self.nodes[*node_id - 1].loc;
            centroid.x += loc.x;
            centroid.y += loc.y;
        }
        centroid.x /= node_ids.len() as TmFloat;
        centroid.y /= node_ids.len() as TmFloat;
        centroid
    }

    fn cleanup_after_edit(&mut self) {
        self.is_feasible = false;
        self.is_polygon_valid = false;
        self.is_polygon_filled = false;
        self.is_vertex_depth_valid = false;
        self.is_facet_data_valid = false;
        self.is_local_root_connectable = false;

        self.kill_invalid_conditions();

        if self.owned_nodes.is_empty() {
            self.needs_cleanup = false;
            return;
        }

        for node_id in self.owned_nodes.iter().copied() {
            let node = &mut self.nodes[node_id - 1];
            node.loc.x = node.loc.x.clamp(0.0, self.paper_width);
            node.loc.y = node.loc.y.clamp(0.0, self.paper_height);
            node.is_border = false;
            node.is_pinned = false;
            node.is_polygon = false;
            node.is_conditioned = false;
        }

        for edge_id in self.owned_edges.iter().copied() {
            let edge = &mut self.edges[edge_id - 1];
            edge.is_pinned = false;
            edge.is_conditioned = false;
        }

        let node_locs: Vec<Point> = self.nodes.iter().map(|n| n.loc).collect();
        let edge_lengths: Vec<TmFloat> = self.edges.iter().map(Edge::strained_length).collect();
        for path_id in self.owned_paths.iter().copied() {
            let path = &mut self.paths[path_id - 1];
            path.min_tree_length = path
                .edges
                .iter()
                .filter_map(|id| edge_lengths.get(id.saturating_sub(1)))
                .sum();
            path.min_paper_length = path.min_tree_length * self.scale;
            if path.is_leaf && path.nodes.len() >= 2 {
                let a = node_locs[path.nodes[0] - 1];
                let b = node_locs[*path.nodes.last().unwrap() - 1];
                path.act_paper_length = a.distance(b);
                path.act_tree_length = path.act_paper_length / self.scale;
                path.is_feasible = path.act_paper_length >= path.min_paper_length - DIST_TOL;
                path.is_active = (path.act_paper_length - path.min_paper_length).abs() < DIST_TOL;
            } else {
                path.act_paper_length = 0.0;
                path.act_tree_length = 0.0;
                path.is_feasible = false;
                path.is_active = false;
            }
            path.is_border = false;
            path.is_polygon = false;
            path.is_conditioned = false;
        }

        let leaf_nodes = self.leaf_nodes_in_owned_order();
        let leaf_paths = self.leaf_paths_in_owned_order();
        let leaf_paths_feasible = leaf_paths
            .iter()
            .copied()
            .all(|path_id| self.paths[path_id - 1].is_feasible);
        let condition_feasibilities: Vec<bool> = self
            .conditions
            .iter()
            .map(|condition| condition.kind.calc_feasibility(self))
            .collect();
        for (condition, feasible) in self
            .conditions
            .iter_mut()
            .zip(condition_feasibilities.iter().copied())
        {
            condition.is_feasible = feasible;
        }
        let conditions_feasible = condition_feasibilities.into_iter().all(|feasible| feasible);
        self.is_feasible = leaf_paths_feasible && conditions_feasible;
        self.rebuild_conditioned_flags();
        self.calc_border_nodes_and_paths(&leaf_nodes);
        self.calc_pinned_nodes_and_edges(&leaf_nodes, &leaf_paths);
        self.calc_polygon_network(&leaf_nodes, &leaf_paths);
        self.calc_polygon_validity(&leaf_nodes);
        self.kill_orphan_vertices_and_creases();
        self.promote_first_tree_node_to_root();
        self.renumber_part_indices();
        self.clear_crease_pattern_cleanup_data();
        self.calc_polygon_filled();
        if !self.is_polygon_filled {
            self.needs_cleanup = false;
            return;
        }
        self.calc_depth_and_bend();
        self.calc_vertex_depth_validity();
        if !self.is_vertex_depth_valid {
            self.needs_cleanup = false;
            return;
        }
        self.calc_facet_data_validity();
        if !self.is_facet_data_valid {
            self.needs_cleanup = false;
            return;
        }
        self.calc_facet_corridor_edges();
        self.calc_facet_order();
        if !self.is_local_root_connectable {
            self.needs_cleanup = false;
            return;
        }
        self.calc_facet_color();
        self.calc_fold_directions();
        self.needs_cleanup = false;
    }

    fn kill_invalid_conditions(&mut self) {
        let mut conditions = std::mem::take(&mut self.conditions);
        conditions.retain(|condition| self.condition_is_valid(&condition.kind));
        for (i, condition) in conditions.iter_mut().enumerate() {
            condition.index = i + 1;
        }
        self.conditions = conditions;
    }

    fn condition_is_valid(&self, kind: &ConditionKind) -> bool {
        let node_is_leaf = |node: usize| {
            node.checked_sub(1)
                .and_then(|index| self.nodes.get(index))
                .is_some_and(|node| node.is_leaf)
        };
        let node_exists = |node: usize| node > 0 && node <= self.nodes.len();
        let edge_exists = |edge: usize| edge > 0 && edge <= self.edges.len();
        let path_exists_between =
            |node1: usize, node2: usize| self.find_leaf_path_between(node1, node2).is_some();

        match *kind {
            ConditionKind::NodeCombo { node, .. }
            | ConditionKind::NodeFixed { node, .. }
            | ConditionKind::NodeOnCorner { node }
            | ConditionKind::NodeOnEdge { node }
            | ConditionKind::NodeSymmetric { node } => node_is_leaf(node),
            ConditionKind::NodesPaired { node1, node2 } => {
                node_is_leaf(node1) && node_is_leaf(node2)
            }
            ConditionKind::NodesCollinear {
                node1,
                node2,
                node3,
            } => node_is_leaf(node1) && node_is_leaf(node2) && node_is_leaf(node3),
            ConditionKind::EdgeLengthFixed { edge } => edge_exists(edge),
            ConditionKind::EdgesSameStrain { edge1, edge2 } => {
                edge_exists(edge1) && edge_exists(edge2)
            }
            ConditionKind::PathActive { node1, node2 }
            | ConditionKind::PathAngleFixed { node1, node2, .. }
            | ConditionKind::PathAngleQuant { node1, node2, .. } => {
                node_exists(node1) && node_exists(node2) && path_exists_between(node1, node2)
            }
            ConditionKind::PathCombo { node1, node2, .. } => {
                node_exists(node1) && node_exists(node2) && path_exists_between(node1, node2)
            }
        }
    }

    fn leaf_paths_in_owned_order(&self) -> Vec<usize> {
        self.owned_paths
            .iter()
            .copied()
            .filter(|id| self.paths[id - 1].is_leaf)
            .collect()
    }

    fn calc_border_nodes_and_paths(&mut self, leaf_nodes: &[usize]) {
        if leaf_nodes.len() < 3 {
            return;
        }

        let start_pt = Point { x: -1.0, y: -1.0 };
        let Some((&start_node, _)) = leaf_nodes
            .iter()
            .map(|id| (id, angle(point_sub(self.nodes[*id - 1].loc, start_pt))))
            .min_by(|(_, a), (_, b)| a.total_cmp(b))
        else {
            return;
        };

        let mut border_nodes = vec![start_node];
        let mut prev_node = start_node;
        let mut prev_pt = start_pt;
        let mut this_node = start_node;
        let mut this_pt = self.nodes[this_node - 1].loc;

        loop {
            let mut best_node = None;
            let mut best_angle = TWO_PI;
            let mut best_dist = TmFloat::INFINITY;

            for node_id in leaf_nodes.iter().copied() {
                if node_id == prev_node || node_id == this_node {
                    continue;
                }
                let the_pt = self.nodes[node_id - 1].loc;
                let the_angle = angle_change(prev_pt, this_pt, the_pt);
                if the_angle < -PI / 2.0 {
                    continue;
                }
                let the_dist = this_pt.distance(the_pt);
                if the_angle < best_angle - CONVEXITY_TOL
                    || ((the_angle - best_angle).abs() < CONVEXITY_TOL && the_dist < best_dist)
                {
                    best_node = Some(node_id);
                    best_angle = the_angle;
                    best_dist = the_dist;
                }
            }

            let Some(next_node) = best_node else {
                return;
            };
            if next_node == start_node {
                break;
            }
            border_nodes.push(next_node);
            prev_node = this_node;
            prev_pt = this_pt;
            this_node = next_node;
            this_pt = self.nodes[this_node - 1].loc;
        }

        if let Some(first) = border_nodes.first().copied() {
            self.nodes[first - 1].is_border = true;
        }
        for i in 1..border_nodes.len() {
            let prev = border_nodes[i - 1];
            let next = border_nodes[i];
            self.nodes[next - 1].is_border = true;
            if let Some(path_id) = self.leaf_path_id_between(prev, next) {
                self.paths[path_id - 1].is_border = true;
            }
        }
        if let Some(path_id) = self.leaf_path_id_between(
            *border_nodes.last().unwrap(),
            *border_nodes.first().unwrap(),
        ) {
            self.paths[path_id - 1].is_border = true;
        }
    }

    fn calc_pinned_nodes_and_edges(&mut self, leaf_nodes: &[usize], leaf_paths: &[usize]) {
        for node_id in leaf_nodes.iter().copied() {
            self.nodes[node_id - 1].is_pinned = self.calc_is_pinned_node(node_id);
        }

        for path_id in leaf_paths.iter().copied() {
            let path = &self.paths[path_id - 1];
            if !path.is_active || path.nodes.len() < 2 {
                continue;
            }
            let node1 = path.nodes[0];
            let node2 = *path.nodes.last().unwrap();
            if self.nodes[node1 - 1].is_pinned && self.nodes[node2 - 1].is_pinned {
                let edge_ids = path.edges.clone();
                for edge_id in edge_ids {
                    self.edges[edge_id - 1].is_pinned = true;
                }
            }
        }
    }

    fn calc_is_pinned_node(&self, node_id: usize) -> bool {
        let node = &self.nodes[node_id - 1];
        let mut angles = Vec::new();
        for path_id in &node.leaf_paths {
            let path = &self.paths[*path_id - 1];
            if !path.is_active || path.nodes.len() < 2 {
                continue;
            }
            let other = if path.nodes[0] == node_id {
                *path.nodes.last().unwrap()
            } else {
                path.nodes[0]
            };
            angles.push(angle(point_sub(self.nodes[other - 1].loc, node.loc)));
        }

        if is_tiny(node.loc.x) {
            angles.push(-PI);
        }
        if is_tiny(node.loc.x - self.paper_width) {
            angles.push(0.0);
        }
        if is_tiny(node.loc.y - self.paper_height) {
            angles.push(PI / 2.0);
        }
        if is_tiny(node.loc.y) {
            angles.push(-PI / 2.0);
        }

        if angles.len() < 2 {
            return false;
        }
        angles.sort_by(TmFloat::total_cmp);
        for i in 0..angles.len() - 1 {
            if angles[i + 1] - angles[i] > PI + CONVEXITY_TOL {
                return false;
            }
        }
        angles[0] - angles[angles.len() - 1] + PI <= CONVEXITY_TOL
    }

    fn calc_polygon_network(&mut self, leaf_nodes: &[usize], leaf_paths: &[usize]) {
        for path_id in leaf_paths.iter().copied() {
            let path = &mut self.paths[path_id - 1];
            path.is_polygon = path.is_active || (path.is_border && path.is_feasible);
        }

        for node_id in leaf_nodes.iter().copied() {
            let node = &mut self.nodes[node_id - 1];
            if node.is_pinned || node.is_border {
                node.is_polygon = true;
            }
        }

        for path_id in leaf_paths.iter().copied() {
            let path = &self.paths[path_id - 1];
            if path.is_feasible || path.nodes.len() < 2 {
                continue;
            }
            let node1 = path.nodes[0];
            let node2 = *path.nodes.last().unwrap();
            self.nodes[node1 - 1].is_polygon = false;
            self.nodes[node1 - 1].is_pinned = false;
            self.nodes[node2 - 1].is_polygon = false;
            self.nodes[node2 - 1].is_pinned = false;
        }

        loop {
            let mut something_changed = false;

            for path_id in leaf_paths.iter().copied() {
                let path = &self.paths[path_id - 1];
                if !path.is_polygon || path.nodes.len() < 2 {
                    continue;
                }
                let node1 = path.nodes[0];
                let node2 = *path.nodes.last().unwrap();
                if !(self.nodes[node1 - 1].is_polygon && self.nodes[node2 - 1].is_polygon) {
                    self.paths[path_id - 1].is_polygon = false;
                    something_changed = true;
                }
            }

            for node_id in leaf_nodes.iter().copied() {
                if !self.nodes[node_id - 1].is_polygon {
                    continue;
                }
                let poly_paths = self.nodes[node_id - 1]
                    .leaf_paths
                    .iter()
                    .filter(|path_id| self.paths[**path_id - 1].is_polygon)
                    .count();
                if poly_paths < 2 {
                    self.nodes[node_id - 1].is_polygon = false;
                    something_changed = true;
                }
            }

            if !something_changed {
                break;
            }
        }

        let doomed_polys: Vec<usize> = self
            .polys
            .iter()
            .filter(|poly| !self.calc_poly_is_valid(poly.index, leaf_nodes))
            .map(|poly| poly.index)
            .collect();
        if !doomed_polys.is_empty() {
            self.delete_polys(&doomed_polys);
        }
    }

    fn calc_polygon_validity(&mut self, leaf_nodes: &[usize]) {
        self.is_polygon_valid = true;
        for node_id in leaf_nodes.iter().copied() {
            let polygon_paths = self.nodes[node_id - 1]
                .leaf_paths
                .iter()
                .filter(|path_id| self.paths[**path_id - 1].is_polygon)
                .count();
            if polygon_paths < 2 {
                self.is_polygon_valid = false;
                return;
            }
        }

        for path_id in self.owned_paths.iter().copied() {
            let path = &self.paths[path_id - 1];
            if !path.is_polygon {
                continue;
            }
            if path.is_border {
                if path.fwd_poly.is_none() && path.bkd_poly.is_none() {
                    self.is_polygon_valid = false;
                    return;
                }
            } else if path.fwd_poly.is_none() || path.bkd_poly.is_none() {
                self.is_polygon_valid = false;
                return;
            }
        }
    }

    fn calc_poly_is_valid(&self, poly_id: usize, leaf_nodes: &[usize]) -> bool {
        let Some(poly) = self.polys.get(poly_id.saturating_sub(1)) else {
            return false;
        };
        if poly.is_sub_poly {
            return true;
        }
        if poly.node_locs.len() != poly.ring_nodes.len() {
            return false;
        }
        for (i, node_id) in poly.ring_nodes.iter().copied().enumerate() {
            let Some(node) = self.nodes.get(node_id.saturating_sub(1)) else {
                return false;
            };
            if poly.node_locs[i].distance(node.loc) > MOVE_TOL {
                return false;
            }
        }
        for path_id in poly.ring_paths.iter().copied() {
            let Some(path) = self.paths.get(path_id.saturating_sub(1)) else {
                return false;
            };
            if !path.is_polygon {
                return false;
            }
        }
        if !self.poly_is_convex(poly) {
            return false;
        }
        !self.poly_encloses_leaf_node(poly, leaf_nodes)
    }

    fn poly_is_convex(&self, poly: &Poly) -> bool {
        let n = poly.ring_nodes.len();
        if n < 3 {
            return false;
        }
        for i in 0..n - 2 {
            let Some(p1) = self
                .nodes
                .get(poly.ring_nodes[i].saturating_sub(1))
                .map(|node| node.loc)
            else {
                return false;
            };
            let Some(p2) = self
                .nodes
                .get(poly.ring_nodes[(i + 1) % n].saturating_sub(1))
                .map(|node| node.loc)
            else {
                return false;
            };
            let Some(p3) = self
                .nodes
                .get(poly.ring_nodes[(i + 2) % n].saturating_sub(1))
                .map(|node| node.loc)
            else {
                return false;
            };
            if angle_change(p1, p2, p3) < -CONVEXITY_TOL {
                return false;
            }
        }
        true
    }

    fn poly_encloses_leaf_node(&self, poly: &Poly, leaf_nodes: &[usize]) -> bool {
        for node_id in leaf_nodes.iter().copied() {
            if poly.ring_nodes.contains(&node_id) {
                continue;
            }
            let Some(node) = self.nodes.get(node_id.saturating_sub(1)) else {
                continue;
            };
            if self.poly_convex_encloses(poly, node.loc) {
                return true;
            }
        }
        false
    }

    fn poly_convex_encloses(&self, poly: &Poly, point: Point) -> bool {
        for path_id in poly.ring_paths.iter().copied() {
            let Some(path) = self.paths.get(path_id.saturating_sub(1)) else {
                return false;
            };
            let Some((node1, node2)) = path.nodes.first().zip(path.nodes.last()) else {
                return false;
            };
            let Some(p1) = self.nodes.get(node1.saturating_sub(1)).map(|node| node.loc) else {
                return false;
            };
            let Some(p2) = self.nodes.get(node2.saturating_sub(1)).map(|node| node.loc) else {
                return false;
            };
            let mut q = rotate_ccw90(point_sub(p2, p1));
            if inner(point_sub(poly.centroid, p1), q) < 0.0 {
                q.x *= -1.0;
                q.y *= -1.0;
            }
            if inner(point_sub(point, p1), q) < 0.0 {
                return false;
            }
        }
        true
    }

    fn kill_orphan_vertices_and_creases(&mut self) {
        let mut doomed_creases: Vec<usize> = self
            .creases
            .iter()
            .filter(|crease| self.crease_is_orphan(crease))
            .map(|crease| crease.index)
            .collect();

        let doomed_vertices: Vec<usize> = self
            .vertices
            .iter()
            .filter(|vertex| self.vertex_is_orphan(vertex))
            .map(|vertex| vertex.index)
            .collect();

        for crease in &self.creases {
            if crease
                .vertices
                .iter()
                .any(|vertex_id| doomed_vertices.contains(vertex_id))
            {
                doomed_creases.push(crease.index);
            }
        }
        doomed_creases.sort_unstable();
        doomed_creases.dedup();

        self.delete_creases(&doomed_creases);
        self.delete_vertices(&doomed_vertices);
    }

    fn crease_is_orphan(&self, crease: &Crease) -> bool {
        match crease.owner {
            OwnerRef::Poly(poly_id) => poly_id == 0 || poly_id > self.polys.len(),
            OwnerRef::Path(path_id) => self
                .paths
                .get(path_id.saturating_sub(1))
                .is_none_or(|path| !path.is_sub && !self.path_is_incident_to_filled_poly(path_id)),
            _ => true,
        }
    }

    fn vertex_is_orphan(&self, vertex: &Vertex) -> bool {
        match vertex.owner {
            OwnerRef::Node(node_id) => {
                let Some(node) = self.nodes.get(node_id.saturating_sub(1)) else {
                    return true;
                };
                if node.is_sub {
                    return false;
                }
                if !node.is_leaf {
                    return true;
                }
                !node
                    .leaf_paths
                    .iter()
                    .copied()
                    .any(|path_id| self.path_is_incident_to_filled_poly(path_id))
            }
            OwnerRef::Path(path_id) => self
                .paths
                .get(path_id.saturating_sub(1))
                .is_none_or(|path| !path.is_sub && !self.path_is_incident_to_filled_poly(path_id)),
            _ => true,
        }
    }

    fn path_is_incident_to_filled_poly(&self, path_id: usize) -> bool {
        let Some(path) = self.paths.get(path_id.saturating_sub(1)) else {
            return false;
        };
        path.fwd_poly
            .and_then(|poly_id| self.polys.get(poly_id.saturating_sub(1)))
            .is_some_and(|poly| !poly.owned_nodes.is_empty())
            || path
                .bkd_poly
                .and_then(|poly_id| self.polys.get(poly_id.saturating_sub(1)))
                .is_some_and(|poly| !poly.owned_nodes.is_empty())
    }

    fn delete_polys(&mut self, doomed: &[usize]) {
        if doomed.is_empty() {
            return;
        }

        let mut doomed_flags = ids_to_flags(doomed, self.polys.len());
        loop {
            let mut changed = false;
            for poly in &self.polys {
                if doomed_flags[poly.index] {
                    continue;
                }
                if let OwnerRef::Poly(owner) = poly.owner
                    && doomed_flags.get(owner).copied().unwrap_or(false)
                {
                    doomed_flags[poly.index] = true;
                    changed = true;
                }
            }
            if !changed {
                break;
            }
        }

        let doomed_polys: Vec<usize> = doomed_flags
            .iter()
            .enumerate()
            .skip(1)
            .filter_map(|(id, doomed)| doomed.then_some(id))
            .collect();
        let doomed_facets: Vec<usize> = self
            .facets
            .iter()
            .filter_map(|facet| match facet.owner {
                OwnerRef::Poly(poly_id) if doomed_flags.get(poly_id).copied().unwrap_or(false) => {
                    Some(facet.index)
                }
                _ => None,
            })
            .collect();
        let doomed_creases: Vec<usize> = self
            .creases
            .iter()
            .filter_map(|crease| match crease.owner {
                OwnerRef::Poly(poly_id) if doomed_flags.get(poly_id).copied().unwrap_or(false) => {
                    Some(crease.index)
                }
                _ => None,
            })
            .collect();

        self.delete_facets(&doomed_facets);
        self.delete_creases(&doomed_creases);

        let map = keep_map(self.polys.len(), &doomed_polys);
        for path in &mut self.paths {
            remap_option(&mut path.fwd_poly, &map);
            remap_option(&mut path.bkd_poly, &map);
        }
        for poly in &mut self.polys {
            remap_vec(&mut poly.owned_polys, &map);
            remap_owner(&mut poly.owner, PartKind::Poly, &map);
        }
        for node in &mut self.nodes {
            remap_owner(&mut node.owner, PartKind::Poly, &map);
        }
        for path in &mut self.paths {
            remap_owner(&mut path.owner, PartKind::Poly, &map);
        }
        for crease in &mut self.creases {
            remap_owner(&mut crease.owner, PartKind::Poly, &map);
        }
        for facet in &mut self.facets {
            remap_owner(&mut facet.owner, PartKind::Poly, &map);
        }
        remap_vec(&mut self.owned_polys, &map);

        self.polys = self
            .polys
            .drain(..)
            .filter(|poly| map[poly.index].is_some())
            .enumerate()
            .map(|(i, mut poly)| {
                poly.index = i + 1;
                poly
            })
            .collect();
    }

    fn delete_facets(&mut self, doomed: &[usize]) {
        if doomed.is_empty() {
            return;
        }
        let map = keep_map(self.facets.len(), doomed);
        for crease in &mut self.creases {
            remap_option(&mut crease.fwd_facet, &map);
            remap_option(&mut crease.bkd_facet, &map);
        }
        for poly in &mut self.polys {
            remap_vec(&mut poly.owned_facets, &map);
        }
        for facet in &mut self.facets {
            remap_vec(&mut facet.head_facets, &map);
            remap_vec(&mut facet.tail_facets, &map);
        }
        self.facets = self
            .facets
            .drain(..)
            .filter(|facet| map[facet.index].is_some())
            .enumerate()
            .map(|(i, mut facet)| {
                facet.index = i + 1;
                facet
            })
            .collect();
    }

    fn delete_creases(&mut self, doomed: &[usize]) {
        if doomed.is_empty() {
            return;
        }
        let map = keep_map(self.creases.len(), doomed);
        for vertex in &mut self.vertices {
            remap_vec(&mut vertex.creases, &map);
        }
        for path in &mut self.paths {
            remap_vec(&mut path.owned_creases, &map);
        }
        for poly in &mut self.polys {
            remap_vec(&mut poly.local_root_creases, &map);
            remap_vec(&mut poly.owned_creases, &map);
        }
        for facet in &mut self.facets {
            remap_vec(&mut facet.creases, &map);
        }
        self.creases = self
            .creases
            .drain(..)
            .filter(|crease| map[crease.index].is_some())
            .enumerate()
            .map(|(i, mut crease)| {
                crease.index = i + 1;
                crease
            })
            .collect();
    }

    fn delete_vertices(&mut self, doomed: &[usize]) {
        if doomed.is_empty() {
            return;
        }
        let map = keep_map(self.vertices.len(), doomed);
        for node in &mut self.nodes {
            remap_vec(&mut node.owned_vertices, &map);
        }
        for path in &mut self.paths {
            remap_vec(&mut path.owned_vertices, &map);
        }
        for poly in &mut self.polys {
            remap_vec(&mut poly.local_root_vertices, &map);
        }
        for vertex in &mut self.vertices {
            remap_option(&mut vertex.left_pseudohinge_mate, &map);
            remap_option(&mut vertex.right_pseudohinge_mate, &map);
        }
        for crease in &mut self.creases {
            remap_vec(&mut crease.vertices, &map);
        }
        for facet in &mut self.facets {
            remap_vec(&mut facet.vertices, &map);
        }
        self.vertices = self
            .vertices
            .drain(..)
            .filter(|vertex| map[vertex.index].is_some())
            .enumerate()
            .map(|(i, mut vertex)| {
                vertex.index = i + 1;
                vertex
            })
            .collect();
    }

    fn promote_first_tree_node_to_root(&mut self) {
        let Some(pos) = self.nodes.iter().position(|node| !node.is_sub) else {
            return;
        };
        if pos == 0 {
            return;
        }
        let old_order: Vec<usize> = std::iter::once(pos + 1)
            .chain((1..=self.nodes.len()).filter(|id| *id != pos + 1))
            .collect();
        let mut map = vec![None; self.nodes.len() + 1];
        for (new_index, old_index) in old_order.iter().copied().enumerate() {
            map[old_index] = Some(new_index + 1);
        }

        let old_nodes = self.nodes.clone();
        self.nodes = old_order
            .iter()
            .map(|old_index| old_nodes[*old_index - 1].clone())
            .collect();

        for node in &mut self.nodes {
            node.index = map[node.index].expect("node reorder map");
            remap_owner(&mut node.owner, PartKind::Node, &map);
        }
        for edge in &mut self.edges {
            remap_vec(&mut edge.nodes, &map);
        }
        for path in &mut self.paths {
            remap_vec(&mut path.nodes, &map);
        }
        for poly in &mut self.polys {
            remap_vec(&mut poly.ring_nodes, &map);
            remap_vec(&mut poly.inset_nodes, &map);
            remap_vec(&mut poly.owned_nodes, &map);
        }
        for vertex in &mut self.vertices {
            remap_option(&mut vertex.tree_node, &map);
            remap_owner(&mut vertex.owner, PartKind::Node, &map);
        }
        for condition in &mut self.conditions {
            condition.kind.remap_nodes(&map);
        }
        remap_vec(&mut self.owned_nodes, &map);
    }

    fn renumber_part_indices(&mut self) {
        for (i, node) in self.nodes.iter_mut().enumerate() {
            node.index = i + 1;
        }
        for (i, edge) in self.edges.iter_mut().enumerate() {
            edge.index = i + 1;
        }
        for (i, path) in self.paths.iter_mut().enumerate() {
            path.index = i + 1;
        }
        for (i, poly) in self.polys.iter_mut().enumerate() {
            poly.index = i + 1;
        }
        for (i, vertex) in self.vertices.iter_mut().enumerate() {
            vertex.index = i + 1;
        }
        for (i, crease) in self.creases.iter_mut().enumerate() {
            crease.index = i + 1;
        }
        for (i, facet) in self.facets.iter_mut().enumerate() {
            facet.index = i + 1;
        }
        for (i, condition) in self.conditions.iter_mut().enumerate() {
            condition.index = i + 1;
        }
    }

    fn clear_crease_pattern_cleanup_data(&mut self) {
        for vertex in &mut self.vertices {
            vertex.depth = DEPTH_NOT_SET;
            vertex.discrete_depth = usize::MAX;
        }
        for crease in &mut self.creases {
            crease.fold = 0;
        }
        for facet in &mut self.facets {
            facet.corridor_edge = None;
            facet.head_facets.clear();
            facet.tail_facets.clear();
            facet.order = usize::MAX;
            facet.color = 0;
        }
    }

    fn calc_polygon_filled(&mut self) {
        self.is_polygon_filled = false;
        if self.owned_polys.is_empty() {
            return;
        }
        for poly_id in self.owned_polys.iter().copied() {
            let Some(poly) = self.polys.get(poly_id.saturating_sub(1)) else {
                return;
            };
            if poly.owned_nodes.is_empty() {
                return;
            }
        }
        self.is_polygon_filled = true;
    }

    fn calc_depth_and_bend(&mut self) {
        if !self.is_polygon_valid || self.nodes.is_empty() {
            return;
        }

        let root_node = self
            .nodes
            .iter()
            .position(|node| !node.is_sub)
            .map(|i| i + 1);
        let Some(root_node) = root_node else {
            return;
        };
        self.nodes[root_node - 1].depth = 0.0;
        for path_id in self.owned_paths.iter().copied() {
            let path = &self.paths[path_id - 1];
            if path.nodes.first().copied() == Some(root_node) {
                if let Some(back_node) = path.nodes.last().copied() {
                    self.nodes[back_node - 1].depth = path.min_paper_length;
                }
            } else if path.nodes.last().copied() == Some(root_node)
                && let Some(front_node) = path.nodes.first().copied()
            {
                self.nodes[front_node - 1].depth = path.min_paper_length;
            }
        }

        for path in &mut self.paths {
            path.min_depth = DEPTH_NOT_SET;
            path.min_depth_dist = 0.0;
        }

        for path_id in 1..=self.paths.len() {
            if !self.paths[path_id - 1].is_leaf {
                continue;
            }
            let node_ids = self.paths[path_id - 1].nodes.clone();
            let edge_ids = self.paths[path_id - 1].edges.clone();
            if node_ids.is_empty() {
                continue;
            }
            let mut min_depth = self.nodes[node_ids[0] - 1].depth;
            let mut min_depth_dist = 0.0;
            for j in 1..node_ids.len() {
                let node_depth = self.nodes[node_ids[j] - 1].depth;
                if min_depth > node_depth {
                    min_depth = node_depth;
                    min_depth_dist +=
                        self.edges[edge_ids[j - 1] - 1].strained_length() * self.scale;
                }
            }
            self.paths[path_id - 1].min_depth = min_depth;
            self.paths[path_id - 1].min_depth_dist = min_depth_dist;
        }

        for path_id in 1..=self.paths.len() {
            if !self.path_is_gusset(path_id) {
                continue;
            }
            let (max_outset_path, max_front_reduction, _) = self.max_outset_path(path_id);
            self.paths[path_id - 1].min_depth = self.paths[max_outset_path - 1].min_depth;
            self.paths[path_id - 1].min_depth_dist =
                self.paths[max_outset_path - 1].min_depth_dist - max_front_reduction;
        }

        for vertex in &mut self.vertices {
            vertex.depth = DEPTH_NOT_SET;
        }

        for poly_id in 1..=self.polys.len() {
            let nn = self.polys[poly_id - 1].ring_nodes.len();
            for j in 0..nn {
                let front_node = self.polys[poly_id - 1].ring_nodes[j];
                let back_node = self.polys[poly_id - 1].ring_nodes[(j + 1) % nn];
                let path_id = self.polys[poly_id - 1].ring_paths[j];
                if !(self.path_is_active_axial(path_id) || self.path_is_gusset(path_id)) {
                    continue;
                }
                if let Ok(ridge_vertices) =
                    self.get_ridgeline_vertices(poly_id, front_node, back_node)
                {
                    for vertex_id in ridge_vertices {
                        self.set_vertex_depth_from_path(path_id, vertex_id);
                    }
                }
                for vertex_id in self.paths[path_id - 1].owned_vertices.clone() {
                    self.set_vertex_depth_from_path(path_id, vertex_id);
                }
            }
        }

        for path_id in self.owned_paths.clone() {
            if !self.paths[path_id - 1].is_border || self.paths[path_id - 1].is_active {
                continue;
            }
            for vertex_id in self.paths[path_id - 1].owned_vertices.clone() {
                for crease_id in self.vertices[vertex_id - 1].creases.clone() {
                    if self.crease_is_hinge(crease_id) {
                        let ridge_vertex = self.other_crease_vertex(crease_id, vertex_id);
                        self.vertices[vertex_id - 1].depth = self.vertices[ridge_vertex - 1].depth;
                        break;
                    }
                }
            }
        }

        for vertex_id in 1..=self.vertices.len() {
            if let Some(tree_node) = self.vertices[vertex_id - 1].tree_node {
                self.vertices[vertex_id - 1].discrete_depth = self.calc_discrete_depth(tree_node);
            } else {
                self.vertices[vertex_id - 1].discrete_depth = usize::MAX;
            }
        }

        if self
            .vertices
            .iter()
            .any(|vertex| vertex.depth == DEPTH_NOT_SET)
        {
            return;
        }

        for poly_id in self.owned_polys.clone() {
            self.calc_poly_bend(poly_id);
        }
    }

    fn set_vertex_depth_from_path(&mut self, path_id: usize, vertex_id: usize) {
        let path = &self.paths[path_id - 1];
        let p = self.vertices[vertex_id - 1].loc;
        let p1 = self.nodes[path.nodes[0] - 1].loc;
        let p2 = self.nodes[*path.nodes.last().unwrap() - 1].loc;
        let d = inner(point_sub(p, p1), point_sub(p2, p1)) / p2.distance(p1);
        self.vertices[vertex_id - 1].depth = if d < path.min_depth_dist {
            path.min_depth + path.min_depth_dist - d
        } else {
            path.min_depth + d - path.min_depth_dist
        };
    }

    fn calc_discrete_depth(&self, node_id: usize) -> usize {
        let root_node = self
            .nodes
            .iter()
            .position(|node| !node.is_sub)
            .map(|i| i + 1);
        if root_node == Some(node_id) {
            return 0;
        }
        let Some(root_node) = root_node else {
            return usize::MAX;
        };
        self.find_any_path_in(&self.owned_paths, root_node, node_id)
            .map(|path_id| self.paths[path_id - 1].edges.len())
            .unwrap_or(usize::MAX)
    }

    fn calc_poly_bend(&mut self, poly_id: usize) {
        for crease_id in self.polys[poly_id - 1].owned_creases.clone() {
            self.calc_crease_bend(crease_id);
        }

        let mut all_vertices = Vec::new();
        for crease_id in self.polys[poly_id - 1].owned_creases.clone() {
            for vertex_id in self.creases[crease_id - 1].vertices.clone() {
                push_unique(&mut all_vertices, vertex_id);
            }
        }
        for node_id in self.polys[poly_id - 1].ring_nodes.clone() {
            if let Some(vertex_id) = self.nodes[node_id - 1].owned_vertices.first().copied() {
                push_unique(&mut all_vertices, vertex_id);
            }
        }

        self.polys[poly_id - 1].local_root_vertices.clear();
        self.polys[poly_id - 1].local_root_creases.clear();
        let mut min_discrete_depth = usize::MAX;
        for vertex_id in all_vertices {
            let discrete_depth = self.vertices[vertex_id - 1].discrete_depth;
            if min_discrete_depth > discrete_depth {
                min_discrete_depth = discrete_depth;
                self.polys[poly_id - 1].local_root_vertices.clear();
                self.polys[poly_id - 1].local_root_creases.clear();
            }
            if min_discrete_depth == discrete_depth {
                push_unique(&mut self.polys[poly_id - 1].local_root_vertices, vertex_id);
                for crease_id in self.vertices[vertex_id - 1].creases.clone() {
                    if self.crease_is_hinge(crease_id)
                        && self.polys[poly_id - 1].owned_creases.contains(&crease_id)
                    {
                        push_unique(&mut self.polys[poly_id - 1].local_root_creases, crease_id);
                    }
                }
            }
        }
    }

    fn calc_crease_bend(&mut self, crease_id: usize) {
        if !self.crease_is_hinge(crease_id)
            || self.creases[crease_id - 1].kind == CREASE_PSEUDOHINGE
        {
            return;
        }
        let v0 = self.creases[crease_id - 1].vertices[0];
        let v1 = self.creases[crease_id - 1].vertices[1];
        let bottom = if self.vertices[v0 - 1].elevation > self.vertices[v1 - 1].elevation {
            v1
        } else {
            v0
        };
        let ag_creases: Vec<usize> = self.vertices[bottom - 1]
            .creases
            .iter()
            .copied()
            .filter(|id| self.crease_is_axial_or_gusset(*id))
            .take(2)
            .collect();
        if ag_creases.len() < 2 {
            return;
        }
        let vertex1 = self.other_crease_vertex(ag_creases[0], bottom);
        let vertex3 = self.other_crease_vertex(ag_creases[1], bottom);
        let depth1 = self.vertices[vertex1 - 1].depth;
        let depth2 = self.vertices[bottom - 1].depth;
        let depth3 = self.vertices[vertex3 - 1].depth;
        if (depth1 > depth2 && depth2 < depth3) || (depth1 < depth2 && depth2 > depth3) {
            self.creases[crease_id - 1].kind = CREASE_FOLDED_HINGE;
        } else {
            self.creases[crease_id - 1].kind = CREASE_UNFOLDED_HINGE;
        }
    }

    fn calc_vertex_depth_validity(&mut self) {
        self.is_vertex_depth_valid = false;
        if self.vertices.is_empty() {
            return;
        }
        if self
            .vertices
            .iter()
            .any(|vertex| vertex.depth == DEPTH_NOT_SET)
        {
            return;
        }
        self.is_vertex_depth_valid = true;
    }

    fn calc_facet_data_validity(&mut self) {
        self.is_facet_data_valid = false;
        if self.facets.is_empty() {
            return;
        }
        if self.facets.iter().any(|facet| !facet.is_well_formed) {
            return;
        }
        if self
            .vertices
            .iter()
            .any(|vertex| !vertex.is_border && vertex.creases.len() % 2 != 0)
        {
            return;
        }
        self.is_facet_data_valid = true;
    }

    fn calc_facet_corridor_edges(&mut self) {
        for poly_id in self.owned_polys.clone() {
            self.calc_poly_facet_corridor_edges(poly_id);
        }
    }

    fn calc_poly_facet_corridor_edges(&mut self, poly_id: usize) {
        for facet_id in self.polys[poly_id - 1].owned_facets.clone() {
            if self.facets[facet_id - 1].corridor_edge.is_some() {
                continue;
            }
            if !self.facet_is_axial(facet_id) {
                continue;
            }
            let Some(bottom_crease) = self.facet_bottom_crease(facet_id) else {
                continue;
            };
            let vertices = self.creases[bottom_crease - 1].vertices.clone();
            if vertices.len() < 2 {
                continue;
            }
            let (Some(node1), Some(node2)) = (
                self.vertices[vertices[0] - 1].tree_node,
                self.vertices[vertices[1] - 1].tree_node,
            ) else {
                continue;
            };
            let Some(edge_id) = self.edge_between_nodes(node1, node2) else {
                continue;
            };
            self.set_facet_corridor_edge(poly_id, facet_id, edge_id);
        }
    }

    fn set_facet_corridor_edge(&mut self, poly_id: usize, facet_id: usize, edge_id: usize) {
        self.facets[facet_id - 1].corridor_edge = Some(edge_id);
        let crease_ids = self.facets[facet_id - 1].creases.clone();
        for crease_id in crease_ids {
            if self.crease_is_regular_hinge(crease_id) {
                continue;
            }
            let Some(other_facet) = self.crease_other_facet(crease_id, facet_id) else {
                continue;
            };
            if !self.polys[poly_id - 1].owned_facets.contains(&other_facet) {
                continue;
            }
            if self.facets[other_facet - 1].corridor_edge.is_some() {
                continue;
            }
            self.set_facet_corridor_edge(poly_id, other_facet, edge_id);
        }
    }

    fn edge_between_nodes(&self, node1: usize, node2: usize) -> Option<usize> {
        self.nodes
            .get(node1.saturating_sub(1))?
            .edges
            .iter()
            .copied()
            .find(|edge_id| {
                self.edges
                    .get(edge_id.saturating_sub(1))
                    .is_some_and(|edge| edge.nodes.contains(&node2))
            })
    }

    fn calc_facet_order(&mut self) {
        let mut root_networks = self.calc_root_networks();
        let num_depth_zero = root_networks
            .iter()
            .filter(|network| network.discrete_depth == 0)
            .count();

        self.is_local_root_connectable = true;
        for network in &root_networks {
            if network.discrete_depth != 0 && !network.is_connectable {
                self.is_local_root_connectable = false;
            }
        }
        self.is_local_root_connectable &= num_depth_zero == 1;
        if !self.is_local_root_connectable {
            return;
        }

        for network in &root_networks {
            self.connect_facet_graph(network);
        }

        let Some(global_index) = root_networks
            .iter()
            .position(|network| network.discrete_depth == 0)
        else {
            self.is_local_root_connectable = false;
            return;
        };
        let mut global_root_network = root_networks.remove(global_index);

        while !root_networks.is_empty() {
            let mut absorbed_index = None;
            let mut absorbed_vertex = None;
            for (i, network) in root_networks.iter().enumerate() {
                if let Some(vertex_id) = self.root_network_can_absorb(&global_root_network, network)
                {
                    absorbed_index = Some(i);
                    absorbed_vertex = Some(vertex_id);
                    break;
                }
            }
            let (Some(index), Some(vertex_id)) = (absorbed_index, absorbed_vertex) else {
                self.is_local_root_connectable = false;
                return;
            };
            self.vertex_swap_links(vertex_id);
            let network = root_networks.remove(index);
            for poly_id in network.cc_polys {
                push_unique(&mut global_root_network.cc_polys, poly_id);
            }
        }

        self.root_network_break_one_link(&global_root_network);

        for facet in &mut self.facets {
            facet.order = usize::MAX;
        }
        let source_facet = self
            .facets
            .iter()
            .find(|facet| self.facet_is_source(facet.index))
            .map(|facet| facet.index);
        let Some(source_facet) = source_facet else {
            self.is_local_root_connectable = false;
            return;
        };
        let mut next_order = 0;
        self.calc_facet_order_recursive(source_facet, &mut next_order);
    }

    fn calc_root_networks(&mut self) -> Vec<RootNetwork> {
        for poly_id in self.owned_polys.clone() {
            self.calc_local_facet_order(poly_id);
        }

        let mut local_root_vertices = Vec::new();
        let mut local_root_creases = Vec::new();
        for poly_id in self.owned_polys.clone() {
            for vertex_id in self.polys[poly_id - 1].local_root_vertices.clone() {
                push_unique(&mut local_root_vertices, vertex_id);
            }
            for crease_id in self.polys[poly_id - 1].local_root_creases.clone() {
                push_unique(&mut local_root_creases, crease_id);
            }
        }

        for vertex in &mut self.vertices {
            vertex.cc_flag = ROOT_FLAG_INELIGIBLE;
            vertex.st_flag = ROOT_FLAG_INELIGIBLE;
        }
        for crease in &mut self.creases {
            crease.cc_flag = ROOT_FLAG_INELIGIBLE;
            crease.st_flag = ROOT_FLAG_INELIGIBLE;
        }

        for vertex_id in local_root_vertices.iter().copied() {
            self.vertices[vertex_id - 1].cc_flag = ROOT_FLAG_NOT_YET;
            self.vertices[vertex_id - 1].st_flag = ROOT_FLAG_NOT_YET;
        }
        for crease_id in local_root_creases.iter().copied() {
            self.creases[crease_id - 1].cc_flag = ROOT_FLAG_NOT_YET;
            self.creases[crease_id - 1].st_flag = ROOT_FLAG_NOT_YET;
        }

        let mut root_networks = Vec::new();
        for vertex_id in local_root_vertices {
            if root_networks
                .iter()
                .any(|network: &RootNetwork| network.cc_vertices.contains(&vertex_id))
            {
                continue;
            }
            let discrete_depth = self.vertices[vertex_id - 1].discrete_depth;
            let mut network = RootNetwork::new(discrete_depth);
            self.try_add_vertex_to_connected_component(&mut network, vertex_id);
            root_networks.push(network);
        }

        for network in &mut root_networks {
            if let Some(vertex_id) = network.cc_vertices.first().copied() {
                self.try_add_vertex_to_spanning_tree(network, vertex_id);
            }
        }

        for network in &mut root_networks {
            self.classify_root_network_vertices(network);
        }

        root_networks
    }

    fn why_not_local_root_connectable(&self) -> (Vec<usize>, Vec<usize>) {
        let mut tree = self.clone();
        let root_networks = tree.calc_root_networks();
        let mut bad_vertices = Vec::new();
        let mut bad_creases = Vec::new();
        let mut zero_depth_network: Option<usize> = None;

        for (network_index, network) in root_networks.iter().enumerate() {
            if network.discrete_depth == 0 {
                if let Some(zero_index) = zero_depth_network {
                    let zero_network = &root_networks[zero_index];
                    for vertex_id in network.cc_vertices.iter().copied() {
                        push_unique(&mut bad_vertices, vertex_id);
                    }
                    for crease_id in network.cc_creases.iter().copied() {
                        push_unique(&mut bad_creases, crease_id);
                    }
                    for vertex_id in zero_network.cc_vertices.iter().copied() {
                        push_unique(&mut bad_vertices, vertex_id);
                    }
                    for crease_id in zero_network.cc_creases.iter().copied() {
                        push_unique(&mut bad_creases, crease_id);
                    }
                } else {
                    zero_depth_network = Some(network_index);
                }
            } else if !network.is_connectable {
                for vertex_id in network.cc_vertices.iter().copied() {
                    push_unique(&mut bad_vertices, vertex_id);
                }
                for crease_id in network.cc_creases.iter().copied() {
                    push_unique(&mut bad_creases, crease_id);
                }
            }
        }

        (bad_vertices, bad_creases)
    }

    fn calc_local_facet_order(&mut self, poly_id: usize) {
        for facet_id in self.polys[poly_id - 1].owned_facets.clone() {
            self.facets[facet_id - 1].head_facets.clear();
            self.facets[facet_id - 1].tail_facets.clear();
        }

        let Some(start_vertex) = self.polys[poly_id - 1]
            .local_root_vertices
            .iter()
            .copied()
            .find(|vertex_id| self.vertex_is_axial(*vertex_id))
        else {
            return;
        };
        let Some(start_crease) = self.incident_interior_crease(poly_id, start_vertex) else {
            return;
        };
        let Some(start_facet) = self.crease_right_non_pseudohinge_facet(start_crease) else {
            return;
        };

        let mut cur_facet = start_facet;
        let mut guard = 0;
        loop {
            let Some(next_facet) = self.facet_right_non_pseudohinge_facet(cur_facet) else {
                return;
            };
            self.facet_link_to(cur_facet, next_facet);
            let Some(bottom_crease) = self.facet_bottom_crease(cur_facet) else {
                return;
            };
            self.build_corridor_links(bottom_crease, cur_facet);
            cur_facet = next_facet;
            if cur_facet == start_facet {
                break;
            }
            guard += 1;
            if guard > self.facets.len().saturating_mul(4).max(100) {
                return;
            }
        }
    }

    fn incident_interior_crease(&self, poly_id: usize, vertex_id: usize) -> Option<usize> {
        self.vertices[vertex_id - 1]
            .creases
            .iter()
            .copied()
            .find(|crease_id| {
                (self.crease_is_hinge(*crease_id)
                    || self.creases[*crease_id - 1].kind == CREASE_RIDGE)
                    && self.polys[poly_id - 1].owned_creases.contains(crease_id)
            })
    }

    fn build_corridor_links(&mut self, from_crease: usize, from_facet: usize) {
        let Some(bottom_crease) = self.facet_bottom_crease(from_facet) else {
            return;
        };
        if bottom_crease == from_crease {
            for next_crease in self.facets[from_facet - 1].creases.clone() {
                if self.creases[next_crease - 1].kind != CREASE_RIDGE {
                    continue;
                }
                let Some(next_facet) = self.crease_other_facet(next_crease, from_facet) else {
                    continue;
                };
                if self.creases[bottom_crease - 1].kind == CREASE_AXIAL {
                    if self.facet_left_facet(from_facet) == Some(next_facet) {
                        continue;
                    }
                    if self.facet_right_facet(from_facet) == Some(next_facet) {
                        continue;
                    }
                }
                if self.facets_are_linked(from_facet, next_facet) {
                    continue;
                }
                self.facet_link_to(from_facet, next_facet);
                self.build_corridor_links(next_crease, next_facet);
            }
        } else if self.creases[bottom_crease - 1].kind == CREASE_GUSSET {
            let Some(next_facet) = self.crease_other_facet(bottom_crease, from_facet) else {
                return;
            };
            self.facet_link_to(from_facet, next_facet);
            self.build_corridor_links(bottom_crease, next_facet);
        } else {
            if !self.facet_is_pseudohinge(from_facet) {
                return;
            }
            let Some(mut ph_crease) = self.facet_left_crease(from_facet) else {
                return;
            };
            let next_facet = if self.creases[ph_crease - 1].kind == CREASE_PSEUDOHINGE {
                self.crease_left_facet(ph_crease)
            } else {
                let Some(right_crease) = self.facet_right_crease(from_facet) else {
                    return;
                };
                ph_crease = right_crease;
                if self.creases[ph_crease - 1].kind != CREASE_PSEUDOHINGE {
                    return;
                }
                self.crease_right_facet(ph_crease)
            };
            let Some(next_facet) = next_facet else {
                return;
            };
            self.facet_link_to(from_facet, next_facet);
            let Some(next_bottom) = self.facet_bottom_crease(next_facet) else {
                return;
            };
            self.build_corridor_links(next_bottom, next_facet);
        }
    }

    fn try_add_vertex_to_connected_component(
        &mut self,
        network: &mut RootNetwork,
        vertex_id: usize,
    ) {
        if self.vertices[vertex_id - 1].cc_flag == ROOT_FLAG_INELIGIBLE {
            return;
        }
        if self.vertices[vertex_id - 1].cc_flag == ROOT_FLAG_ALREADY_ADDED {
            return;
        }
        self.vertices[vertex_id - 1].cc_flag = ROOT_FLAG_ALREADY_ADDED;
        network.cc_vertices.push(vertex_id);

        for crease_id in self.vertices[vertex_id - 1].creases.clone() {
            self.try_add_crease_to_connected_component(network, crease_id);
        }
        if let Some(mate_vertex) = self.vertices[vertex_id - 1].left_pseudohinge_mate {
            self.try_add_vertex_to_connected_component(network, mate_vertex);
        }
        if let Some(mate_vertex) = self.vertices[vertex_id - 1].right_pseudohinge_mate {
            self.try_add_vertex_to_connected_component(network, mate_vertex);
        }

        if let Some(node_id) = self.vertices[vertex_id - 1].tree_node
            && self.nodes[node_id - 1].is_leaf
        {
            for crease_id in self.vertices[vertex_id - 1].creases.clone() {
                if self.creases[crease_id - 1].kind != CREASE_RIDGE {
                    continue;
                }
                if let OwnerRef::Poly(poly_id) = self.creases[crease_id - 1].owner {
                    push_unique(&mut network.cc_polys, poly_id);
                }
            }
        }
    }

    fn try_add_crease_to_connected_component(
        &mut self,
        network: &mut RootNetwork,
        crease_id: usize,
    ) {
        if !self.crease_is_hinge(crease_id) {
            return;
        }
        if self.creases[crease_id - 1].cc_flag == ROOT_FLAG_INELIGIBLE {
            return;
        }
        if self.creases[crease_id - 1].cc_flag == ROOT_FLAG_ALREADY_ADDED {
            return;
        }
        self.creases[crease_id - 1].cc_flag = ROOT_FLAG_ALREADY_ADDED;
        network.cc_creases.push(crease_id);
        if let OwnerRef::Poly(poly_id) = self.creases[crease_id - 1].owner {
            push_unique(&mut network.cc_polys, poly_id);
        }
        let vertices = self.creases[crease_id - 1].vertices.clone();
        for vertex_id in vertices {
            self.try_add_vertex_to_connected_component(network, vertex_id);
        }
    }

    fn try_add_vertex_to_spanning_tree(&mut self, network: &mut RootNetwork, vertex_id: usize) {
        if self.vertices[vertex_id - 1].st_flag == ROOT_FLAG_INELIGIBLE {
            return;
        }
        if self.vertices[vertex_id - 1].st_flag == ROOT_FLAG_ALREADY_ADDED {
            return;
        }
        self.vertices[vertex_id - 1].st_flag = ROOT_FLAG_ALREADY_ADDED;
        network.st_vertices.push(vertex_id);

        for crease_id in self.vertices[vertex_id - 1].creases.clone() {
            self.try_add_crease_to_spanning_tree(network, crease_id);
        }
        if let Some(mate_vertex) = self.vertices[vertex_id - 1].left_pseudohinge_mate {
            self.try_add_vertex_to_spanning_tree(network, mate_vertex);
        }
        if let Some(mate_vertex) = self.vertices[vertex_id - 1].right_pseudohinge_mate {
            self.try_add_vertex_to_spanning_tree(network, mate_vertex);
        }
    }

    fn try_add_crease_to_spanning_tree(&mut self, network: &mut RootNetwork, crease_id: usize) {
        if !self.crease_is_hinge(crease_id) {
            return;
        }
        if self.creases[crease_id - 1].cc_flag == ROOT_FLAG_INELIGIBLE {
            return;
        }
        if self.creases[crease_id - 1].st_flag == ROOT_FLAG_ALREADY_ADDED {
            return;
        }
        let v1 = self.creases[crease_id - 1].vertices[0];
        let v2 = self.creases[crease_id - 1].vertices[1];
        let c1 = self.vertices[v1 - 1].st_flag == ROOT_FLAG_ALREADY_ADDED;
        let c2 = self.vertices[v2 - 1].st_flag == ROOT_FLAG_ALREADY_ADDED;
        if c1 && c2 {
            return;
        }
        self.creases[crease_id - 1].st_flag = ROOT_FLAG_ALREADY_ADDED;
        network.st_creases.push(crease_id);
        if !c1 {
            self.try_add_vertex_to_spanning_tree(network, v1);
        }
        if !c2 {
            self.try_add_vertex_to_spanning_tree(network, v2);
        }
    }

    fn classify_root_network_vertices(&self, network: &mut RootNetwork) {
        for vertex_id in network.cc_vertices.iter().copied() {
            if !self.vertex_is_axial(vertex_id) {
                continue;
            }
            let cc_degree = self.vertex_degree(vertex_id, &network.cc_creases);
            let st_degree = self.vertex_degree(vertex_id, &network.st_creases);
            match cc_degree {
                0 => network.cc0.push(vertex_id),
                1 => network.cc1.push(vertex_id),
                2 if st_degree == 1 => network.cc2_st1.push(vertex_id),
                2 if st_degree == 2 => network.cc2_st2.push(vertex_id),
                _ => {}
            }
            let axial_degree = self.vertex_num_hinge_creases(vertex_id);
            network.is_connectable |= axial_degree == 2 && cc_degree == 1;
        }
    }

    fn connect_facet_graph(&mut self, network: &RootNetwork) {
        if let Some(vertex_id) = network.cc0.first().copied() {
            for crease_id in self.vertices[vertex_id - 1].creases.clone() {
                if self.creases[crease_id - 1].kind == CREASE_RIDGE
                    && let (Some(fwd), Some(bkd)) = (
                        self.creases[crease_id - 1].fwd_facet,
                        self.creases[crease_id - 1].bkd_facet,
                    )
                {
                    self.facet_unlink(fwd, bkd);
                }
            }

            let mut needs_skip = !self.vertices[vertex_id - 1].is_border;
            for crease_id in self.vertices[vertex_id - 1].creases.clone() {
                if self.crease_is_border(crease_id)
                    || self.creases[crease_id - 1].kind != CREASE_AXIAL
                {
                    continue;
                }
                if needs_skip {
                    needs_skip = false;
                } else if let (Some(fwd), Some(bkd)) = (
                    self.creases[crease_id - 1].fwd_facet,
                    self.creases[crease_id - 1].bkd_facet,
                ) {
                    self.facet_link(fwd, bkd);
                }
            }
            return;
        }

        for vertex_id in network.cc2_st2.iter().copied() {
            self.vertex_swap_links(vertex_id);
        }
    }

    fn root_network_can_absorb(
        &self,
        global_network: &RootNetwork,
        network: &RootNetwork,
    ) -> Option<usize> {
        for poly_id in global_network.cc_polys.iter().copied() {
            for path_id in self.polys[poly_id - 1].ring_paths.iter().copied() {
                for vertex_id in self.paths[path_id - 1].owned_vertices.iter().copied() {
                    if self.vertices[vertex_id - 1].discrete_depth != network.discrete_depth {
                        continue;
                    }
                    if network.cc1.contains(&vertex_id) {
                        return Some(vertex_id);
                    }
                }
            }
        }
        None
    }

    fn root_network_break_one_link(&mut self, network: &RootNetwork) {
        if !network.cc0.is_empty() {
            return;
        }
        if let Some(vertex_id) = network.cc1.first().copied() {
            let Some(crease_id) = self.vertex_hinge_crease(vertex_id) else {
                return;
            };
            let (Some(left), Some(right)) = (
                self.crease_left_non_pseudohinge_facet(crease_id),
                self.crease_right_non_pseudohinge_facet(crease_id),
            ) else {
                return;
            };
            self.facet_unlink(left, right);
            return;
        }

        let Some(vertex_id) = network.cc2_st1.first().copied() else {
            return;
        };
        let hinges = self.vertex_hinge_creases(vertex_id);
        let Some(crease_id) = hinges.first().copied() else {
            return;
        };
        if let (Some(fwd), Some(bkd)) = (
            self.creases[crease_id - 1].fwd_facet,
            self.creases[crease_id - 1].bkd_facet,
        ) {
            self.facet_unlink(fwd, bkd);
        }
    }

    fn calc_facet_order_recursive(&mut self, facet_id: usize, next_order: &mut usize) {
        if self.facets[facet_id - 1].order != usize::MAX {
            return;
        }
        if self.facets[facet_id - 1]
            .tail_facets
            .iter()
            .any(|tail| self.facets[*tail - 1].order == usize::MAX)
        {
            return;
        }
        self.facets[facet_id - 1].order = *next_order;
        *next_order += 1;
        for head_facet in self.facets[facet_id - 1].head_facets.clone() {
            self.calc_facet_order_recursive(head_facet, next_order);
        }
    }

    fn calc_facet_color(&mut self) {
        let mut source_facet = None;
        for facet_id in 1..=self.facets.len() {
            self.facets[facet_id - 1].color = FACET_NOT_ORIENTED;
            if self.facet_is_source(facet_id) {
                source_facet = Some(facet_id);
            }
        }
        if let Some(source_facet) = source_facet {
            self.calc_facet_color_recursive(source_facet, FACET_COLOR_UP);
        }
    }

    fn calc_facet_color_recursive(&mut self, facet_id: usize, color: i32) {
        if self.facets[facet_id - 1].color != FACET_NOT_ORIENTED {
            return;
        }
        self.facets[facet_id - 1].color = color;
        for crease_id in self.facets[facet_id - 1].creases.clone() {
            let Some(other_facet) = self.crease_other_facet(crease_id, facet_id) else {
                continue;
            };
            if self.facets[other_facet - 1].color != FACET_NOT_ORIENTED {
                continue;
            }
            let other_color = match self.creases[crease_id - 1].kind {
                CREASE_AXIAL | CREASE_GUSSET | CREASE_RIDGE | CREASE_FOLDED_HINGE
                | CREASE_PSEUDOHINGE => opposite_facet_color(color),
                CREASE_UNFOLDED_HINGE => color,
                _ => continue,
            };
            self.calc_facet_color_recursive(other_facet, other_color);
        }
    }

    fn calc_fold_directions(&mut self) {
        for crease_id in 1..=self.creases.len() {
            self.calc_crease_fold(crease_id);
        }
    }

    fn calc_crease_fold(&mut self, crease_id: usize) {
        let (Some(fwd), Some(bkd)) = (
            self.creases[crease_id - 1].fwd_facet,
            self.creases[crease_id - 1].bkd_facet,
        ) else {
            self.creases[crease_id - 1].fold = FOLD_BORDER;
            return;
        };
        let fwd_facet = &self.facets[fwd - 1];
        let bkd_facet = &self.facets[bkd - 1];
        self.creases[crease_id - 1].fold = if fwd_facet.color == bkd_facet.color {
            FOLD_FLAT
        } else if fwd_facet.color == FACET_COLOR_UP {
            if fwd_facet.order > bkd_facet.order {
                FOLD_MOUNTAIN
            } else {
                FOLD_VALLEY
            }
        } else if fwd_facet.order > bkd_facet.order {
            FOLD_VALLEY
        } else {
            FOLD_MOUNTAIN
        };
    }

    fn other_crease_vertex(&self, crease_id: usize, vertex_id: usize) -> usize {
        let crease = &self.creases[crease_id - 1];
        if crease.vertices[0] == vertex_id {
            crease.vertices[1]
        } else {
            crease.vertices[0]
        }
    }

    fn crease_is_hinge(&self, crease_id: usize) -> bool {
        matches!(
            self.creases[crease_id - 1].kind,
            CREASE_UNFOLDED_HINGE | CREASE_FOLDED_HINGE | CREASE_PSEUDOHINGE
        )
    }

    fn crease_is_regular_hinge(&self, crease_id: usize) -> bool {
        matches!(
            self.creases[crease_id - 1].kind,
            CREASE_UNFOLDED_HINGE | CREASE_FOLDED_HINGE
        )
    }

    fn crease_is_border(&self, crease_id: usize) -> bool {
        let crease = &self.creases[crease_id - 1];
        crease.fwd_facet.is_none() || crease.bkd_facet.is_none()
    }

    fn crease_other_facet(&self, crease_id: usize, facet_id: usize) -> Option<usize> {
        let crease = &self.creases[crease_id - 1];
        if crease.fwd_facet == Some(facet_id) {
            crease.bkd_facet
        } else if crease.bkd_facet == Some(facet_id) {
            crease.fwd_facet
        } else {
            None
        }
    }

    fn crease_left_facet(&self, crease_id: usize) -> Option<usize> {
        let crease = &self.creases[crease_id - 1];
        if let Some(fwd) = crease.fwd_facet
            && self.facet_right_crease(fwd) == Some(crease_id)
        {
            return Some(fwd);
        }
        if let Some(bkd) = crease.bkd_facet
            && self.facet_right_crease(bkd) == Some(crease_id)
        {
            return Some(bkd);
        }
        None
    }

    fn crease_right_facet(&self, crease_id: usize) -> Option<usize> {
        let crease = &self.creases[crease_id - 1];
        if let Some(fwd) = crease.fwd_facet
            && self.facet_left_crease(fwd) == Some(crease_id)
        {
            return Some(fwd);
        }
        if let Some(bkd) = crease.bkd_facet
            && self.facet_left_crease(bkd) == Some(crease_id)
        {
            return Some(bkd);
        }
        None
    }

    fn crease_left_non_pseudohinge_facet(&self, crease_id: usize) -> Option<usize> {
        let mut facet_id = self.crease_left_facet(crease_id)?;
        let mut guard = 0;
        while self.facet_is_pseudohinge(facet_id) {
            facet_id = self.facet_left_facet(facet_id)?;
            guard += 1;
            if guard > self.facets.len() {
                return None;
            }
        }
        Some(facet_id)
    }

    fn crease_right_non_pseudohinge_facet(&self, crease_id: usize) -> Option<usize> {
        let mut facet_id = self.crease_right_facet(crease_id)?;
        let mut guard = 0;
        while self.facet_is_pseudohinge(facet_id) {
            facet_id = self.facet_right_facet(facet_id)?;
            guard += 1;
            if guard > self.facets.len() {
                return None;
            }
        }
        Some(facet_id)
    }

    fn facet_bottom_crease(&self, facet_id: usize) -> Option<usize> {
        self.facets
            .get(facet_id.saturating_sub(1))?
            .creases
            .first()
            .copied()
    }

    fn facet_left_crease(&self, facet_id: usize) -> Option<usize> {
        self.facets
            .get(facet_id.saturating_sub(1))?
            .creases
            .last()
            .copied()
    }

    fn facet_right_crease(&self, facet_id: usize) -> Option<usize> {
        self.facets
            .get(facet_id.saturating_sub(1))?
            .creases
            .get(1)
            .copied()
    }

    fn facet_is_axial(&self, facet_id: usize) -> bool {
        self.facet_bottom_crease(facet_id)
            .is_some_and(|crease_id| self.creases[crease_id - 1].kind == CREASE_AXIAL)
    }

    fn facet_is_pseudohinge(&self, facet_id: usize) -> bool {
        self.facet_left_crease(facet_id)
            .is_some_and(|crease_id| self.creases[crease_id - 1].kind == CREASE_PSEUDOHINGE)
            || self
                .facet_right_crease(facet_id)
                .is_some_and(|crease_id| self.creases[crease_id - 1].kind == CREASE_PSEUDOHINGE)
    }

    fn facet_left_facet(&self, facet_id: usize) -> Option<usize> {
        self.crease_left_facet(self.facet_left_crease(facet_id)?)
    }

    fn facet_right_facet(&self, facet_id: usize) -> Option<usize> {
        self.crease_right_facet(self.facet_right_crease(facet_id)?)
    }

    fn facet_right_non_pseudohinge_facet(&self, facet_id: usize) -> Option<usize> {
        let mut other_facet = self.facet_right_facet(facet_id)?;
        let mut guard = 0;
        while self.facet_is_pseudohinge(other_facet) {
            other_facet = self.facet_right_facet(other_facet)?;
            guard += 1;
            if guard > self.facets.len() {
                return None;
            }
        }
        Some(other_facet)
    }

    fn facet_is_source(&self, facet_id: usize) -> bool {
        let facet = &self.facets[facet_id - 1];
        !facet.head_facets.is_empty() && facet.tail_facets.is_empty()
    }

    fn facet_is_sink(&self, facet_id: usize) -> bool {
        let facet = &self.facets[facet_id - 1];
        !facet.tail_facets.is_empty() && facet.head_facets.is_empty()
    }

    fn facet_link_to(&mut self, tail_facet: usize, head_facet: usize) {
        self.facets[tail_facet - 1].head_facets.push(head_facet);
        self.facets[head_facet - 1].tail_facets.push(tail_facet);
    }

    fn facets_are_linked(&self, facet1: usize, facet2: usize) -> bool {
        self.facets[facet1 - 1].head_facets.contains(&facet2)
            || self.facets[facet2 - 1].head_facets.contains(&facet1)
    }

    fn facet_link(&mut self, facet1: usize, facet2: usize) {
        if self.facet_is_sink(facet1) {
            self.facet_link_to(facet1, facet2);
        } else {
            self.facet_link_to(facet2, facet1);
        }
    }

    fn facet_unlink(&mut self, facet1: usize, facet2: usize) {
        if let Some(pos) = self.facets[facet1 - 1]
            .head_facets
            .iter()
            .position(|id| *id == facet2)
        {
            self.facets[facet1 - 1].head_facets.remove(pos);
            if let Some(pos) = self.facets[facet2 - 1]
                .tail_facets
                .iter()
                .position(|id| *id == facet1)
            {
                self.facets[facet2 - 1].tail_facets.remove(pos);
            }
            return;
        }

        if let Some(pos) = self.facets[facet1 - 1]
            .tail_facets
            .iter()
            .position(|id| *id == facet2)
        {
            self.facets[facet1 - 1].tail_facets.remove(pos);
            if let Some(pos) = self.facets[facet2 - 1]
                .head_facets
                .iter()
                .position(|id| *id == facet1)
            {
                self.facets[facet2 - 1].head_facets.remove(pos);
            }
        }
    }

    fn vertex_is_axial(&self, vertex_id: usize) -> bool {
        self.vertices[vertex_id - 1]
            .creases
            .iter()
            .any(|crease_id| self.creases[*crease_id - 1].kind == CREASE_AXIAL)
    }

    fn vertex_degree(&self, vertex_id: usize, crease_list: &[usize]) -> usize {
        self.vertices[vertex_id - 1]
            .creases
            .iter()
            .filter(|crease_id| crease_list.contains(crease_id))
            .count()
    }

    fn vertex_num_hinge_creases(&self, vertex_id: usize) -> usize {
        self.vertices[vertex_id - 1]
            .creases
            .iter()
            .filter(|crease_id| self.crease_is_hinge(**crease_id))
            .count()
    }

    fn vertex_hinge_crease(&self, vertex_id: usize) -> Option<usize> {
        self.vertices[vertex_id - 1]
            .creases
            .iter()
            .copied()
            .find(|crease_id| self.crease_is_hinge(*crease_id))
    }

    fn vertex_hinge_creases(&self, vertex_id: usize) -> Vec<usize> {
        self.vertices[vertex_id - 1]
            .creases
            .iter()
            .copied()
            .filter(|crease_id| self.crease_is_hinge(*crease_id))
            .take(2)
            .collect()
    }

    fn vertex_swap_links(&mut self, vertex_id: usize) {
        if !self.vertex_is_axial(vertex_id) || self.vertex_num_hinge_creases(vertex_id) < 2 {
            return;
        }
        let hinge_creases = self.vertex_hinge_creases(vertex_id);
        if hinge_creases.len() < 2 {
            return;
        }
        let crease1 = hinge_creases[0];
        let crease2 = hinge_creases[1];
        let (Some(facet_a), Some(facet_b), Some(facet_c), Some(facet_d)) = (
            self.crease_left_facet(crease1),
            self.crease_right_facet(crease1),
            self.crease_right_facet(crease2),
            self.crease_left_facet(crease2),
        ) else {
            return;
        };
        self.facet_unlink(facet_a, facet_b);
        self.facet_unlink(facet_c, facet_d);
        self.facet_link_to(facet_a, facet_c);
        self.facet_link_to(facet_d, facet_b);
    }

    fn leaf_path_id_between(&self, node1: usize, node2: usize) -> Option<usize> {
        self.paths
            .iter()
            .find(|path| {
                path.is_leaf
                    && matches!(
                        path.nodes.first().copied().zip(path.nodes.last().copied()),
                        Some((a, b)) if (a == node1 && b == node2) || (a == node2 && b == node1)
                    )
            })
            .map(|path| path.index)
    }

    fn rebuild_conditioned_flags(&mut self) {
        let mut conditioned_nodes = vec![false; self.nodes.len()];
        let mut conditioned_edges = vec![false; self.edges.len()];
        let mut conditioned_paths = vec![false; self.paths.len()];

        for condition in &self.conditions {
            condition.kind.collect_conditioned_parts(
                self,
                &mut conditioned_nodes,
                &mut conditioned_edges,
                &mut conditioned_paths,
            );
        }

        for (node, conditioned) in self.nodes.iter_mut().zip(conditioned_nodes) {
            node.is_conditioned = conditioned;
        }
        for (edge, conditioned) in self.edges.iter_mut().zip(conditioned_edges) {
            edge.is_conditioned = conditioned;
        }
        for (path, conditioned) in self.paths.iter_mut().zip(conditioned_paths) {
            path.is_conditioned = conditioned;
        }
    }
}

struct Reader<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(input: &'a str) -> Self {
        Self {
            bytes: input.as_bytes(),
            pos: 0,
        }
    }

    fn expect_tag(&mut self, expected: &'static str) -> Result<()> {
        let tag = self.read_token("tag")?;
        if tag != expected {
            return Err(self.err(format!("expected tag {expected:?}, found {tag:?}")));
        }
        Ok(())
    }

    fn read_token(&mut self, label: &'static str) -> Result<String> {
        self.skip_leading_ws();
        if self.pos >= self.bytes.len() {
            return Err(self.err(format!("expected {label}, found end of input")));
        }
        let start = self.pos;
        while self.pos < self.bytes.len() && !self.bytes[self.pos].is_ascii_whitespace() {
            self.pos += 1;
        }
        if start == self.pos {
            return Err(self.err(format!("expected {label}")));
        }
        let token = std::str::from_utf8(&self.bytes[start..self.pos])
            .map_err(|_| self.err(format!("{label} was not UTF-8")))?
            .to_string();
        self.consume_trailing_space();
        Ok(token)
    }

    fn read_line_field(&mut self, label: &'static str) -> Result<String> {
        if self.pos >= self.bytes.len() {
            return Err(self.err(format!("expected {label}, found end of input")));
        }
        let mut out = Vec::new();
        while self.pos < self.bytes.len() {
            let b = self.bytes[self.pos];
            self.pos += 1;
            match b {
                b'\r' => {
                    if self.pos < self.bytes.len() && self.bytes[self.pos] == b'\n' {
                        self.pos += 1;
                    }
                    break;
                }
                b'\n' => break,
                b'\\' => {
                    let Some(next) = self.bytes.get(self.pos).copied() else {
                        return Err(self.err("dangling escape in C string".to_string()));
                    };
                    self.pos += 1;
                    match next {
                        b'n' => out.push(b'\n'),
                        b'r' => out.push(b'\r'),
                        b'\\' => out.push(b'\\'),
                        other => {
                            return Err(self.err(format!(
                                "bad escape sequence \\{} in {label}",
                                other as char
                            )));
                        }
                    }
                }
                other => out.push(other),
            }
        }
        String::from_utf8(out).map_err(|_| self.err(format!("{label} was not UTF-8")))
    }

    fn read_raw_line(&mut self, label: &'static str) -> Result<String> {
        if self.pos >= self.bytes.len() {
            return Err(self.err(format!("expected {label}, found end of input")));
        }
        let start = self.pos;
        while self.pos < self.bytes.len() {
            match self.bytes[self.pos] {
                b'\r' => {
                    let end = self.pos;
                    self.pos += 1;
                    if self.pos < self.bytes.len() && self.bytes[self.pos] == b'\n' {
                        self.pos += 1;
                    }
                    return std::str::from_utf8(&self.bytes[start..end])
                        .map(|s| s.to_string())
                        .map_err(|_| self.err(format!("{label} was not UTF-8")));
                }
                b'\n' => {
                    let end = self.pos;
                    self.pos += 1;
                    return std::str::from_utf8(&self.bytes[start..end])
                        .map(|s| s.to_string())
                        .map_err(|_| self.err(format!("{label} was not UTF-8")));
                }
                _ => self.pos += 1,
            }
        }
        std::str::from_utf8(&self.bytes[start..self.pos])
            .map(|s| s.to_string())
            .map_err(|_| self.err(format!("{label} was not UTF-8")))
    }

    fn read_usize(&mut self, label: &'static str) -> Result<usize> {
        let offset = self.pos;
        let token = self.read_token(label)?;
        token.parse::<usize>().map_err(|_| TreeError::Parse {
            offset,
            message: format!("expected unsigned integer for {label}, found {token:?}"),
        })
    }

    fn read_i32(&mut self, label: &'static str) -> Result<i32> {
        let offset = self.pos;
        let token = self.read_token(label)?;
        token.parse::<i32>().map_err(|_| TreeError::Parse {
            offset,
            message: format!("expected integer for {label}, found {token:?}"),
        })
    }

    fn read_f64(&mut self, label: &'static str) -> Result<TmFloat> {
        let offset = self.pos;
        let token = self.read_token(label)?;
        if token.starts_with("NAN") {
            return Ok(0.0);
        }
        token.parse::<TmFloat>().map_err(|_| TreeError::Parse {
            offset,
            message: format!("expected float for {label}, found {token:?}"),
        })
    }

    fn read_bool(&mut self, label: &'static str) -> Result<bool> {
        Ok(self.read_token(label)? == "true")
    }

    fn read_point(&mut self, label: &'static str) -> Result<Point> {
        Ok(Point {
            x: self.read_f64(label)?,
            y: self.read_f64(label)?,
        })
    }

    fn read_index_array(&mut self, label: &'static str) -> Result<Vec<usize>> {
        let n = self.read_usize(label)?;
        let mut values = Vec::with_capacity(n);
        for _ in 0..n {
            values.push(self.read_usize(label)?);
        }
        Ok(values)
    }

    fn read_optional_index_in_range(
        &mut self,
        label: &'static str,
        max: usize,
    ) -> Result<Option<usize>> {
        match self.read_usize(label)? {
            0 => Ok(None),
            n if n <= max => Ok(Some(n)),
            _ => Ok(None),
        }
    }

    fn read_point_array(&mut self, label: &'static str) -> Result<Vec<Point>> {
        let n = self.read_usize(label)?;
        let mut points = Vec::with_capacity(n);
        for _ in 0..n {
            points.push(self.read_point(label)?);
        }
        Ok(points)
    }

    fn read_node_v3(&mut self, conditions: &mut Vec<Condition>) -> Result<Node> {
        self.expect_tag("node")?;
        let index = self.read_usize("node index")?;
        let label = self.read_line_field("node label")?;
        let loc = self.read_point("node location")?;

        let node_is_symmetric = self.read_bool("node symmetric flag")?;
        if node_is_symmetric {
            push_condition(conditions, ConditionKind::NodeSymmetric { node: index });
        }

        let node_is_paired = self.read_bool("node paired flag")?;
        let paired_node = self.read_usize("paired node")?;
        if node_is_paired && index > paired_node {
            push_condition(
                conditions,
                ConditionKind::NodesPaired {
                    node1: index,
                    node2: paired_node,
                },
            );
        }

        let x_fixed = self.read_bool("node x fixed flag")?;
        let y_fixed = self.read_bool("node y fixed flag")?;
        let x_fix_value = self.read_f64("node x fixed value")?;
        let y_fix_value = self.read_f64("node y fixed value")?;
        if x_fixed || y_fixed {
            push_condition(
                conditions,
                ConditionKind::NodeFixed {
                    node: index,
                    x_fixed,
                    y_fixed,
                    x_fix_value: if x_fixed { x_fix_value } else { 0.0 },
                    y_fix_value: if y_fixed { y_fix_value } else { 0.0 },
                },
            );
        }

        let node_stick_to_edge = self.read_bool("node stick-to-edge flag")?;
        if node_stick_to_edge {
            push_condition(conditions, ConditionKind::NodeOnEdge { node: index });
        }

        let node_is_collinear = self.read_bool("node collinear flag")?;
        let collinear_node1 = self.read_usize("collinear node 1")?;
        let collinear_node2 = self.read_usize("collinear node 2")?;
        if node_is_collinear && index > collinear_node1 && index > collinear_node2 {
            push_condition(
                conditions,
                ConditionKind::NodesCollinear {
                    node1: index,
                    node2: collinear_node1,
                    node3: collinear_node2,
                },
            );
        }

        Ok(Node {
            index,
            label,
            loc,
            depth: DEPTH_NOT_SET,
            elevation: 0.0,
            is_leaf: self.read_bool("node leaf flag")?,
            is_sub: false,
            is_border: self.read_bool("node border flag")?,
            is_pinned: self.read_bool("node pinned flag")?,
            is_polygon: self.read_bool("node polygon flag")?,
            is_junction: false,
            is_conditioned: false,
            owned_vertices: Vec::new(),
            edges: self.read_index_array("node edges")?,
            leaf_paths: self.read_index_array("node leaf paths")?,
            owner: OwnerRef::Tree,
        })
    }

    fn read_node_v4(&mut self) -> Result<Node> {
        self.expect_tag("node")?;
        Ok(Node {
            index: self.read_usize("node index")?,
            label: self.read_line_field("node label")?,
            loc: self.read_point("node location")?,
            depth: DEPTH_NOT_SET,
            elevation: 0.0,
            is_leaf: self.read_bool("node leaf flag")?,
            is_sub: self.read_bool("node sub flag")?,
            is_border: self.read_bool("node border flag")?,
            is_pinned: self.read_bool("node pinned flag")?,
            is_polygon: self.read_bool("node polygon flag")?,
            is_junction: false,
            is_conditioned: self.read_bool("node conditioned flag")?,
            owned_vertices: self.read_index_array("node owned vertices")?,
            edges: self.read_index_array("node edges")?,
            leaf_paths: self.read_index_array("node leaf paths")?,
            owner: self.read_node_owner()?,
        })
    }

    fn read_node_v5(&mut self) -> Result<Node> {
        self.expect_tag("node")?;
        Ok(Node {
            index: self.read_usize("node index")?,
            label: self.read_line_field("node label")?,
            loc: self.read_point("node location")?,
            depth: self.read_f64("node depth")?,
            elevation: self.read_f64("node elevation")?,
            is_leaf: self.read_bool("node leaf flag")?,
            is_sub: self.read_bool("node sub flag")?,
            is_border: self.read_bool("node border flag")?,
            is_pinned: self.read_bool("node pinned flag")?,
            is_polygon: self.read_bool("node polygon flag")?,
            is_junction: self.read_bool("node junction flag")?,
            is_conditioned: self.read_bool("node conditioned flag")?,
            edges: self.read_index_array("node edges")?,
            leaf_paths: self.read_index_array("node leaf paths")?,
            owned_vertices: self.read_index_array("node owned vertices")?,
            owner: self.read_node_owner()?,
        })
    }

    fn read_edge_v3(&mut self) -> Result<Edge> {
        self.expect_tag("edge")?;
        Ok(Edge {
            index: self.read_usize("edge index")?,
            label: self.read_line_field("edge label")?,
            length: self.read_f64("edge length")?,
            strain: 0.0,
            stiffness: 0.0,
            is_pinned: self.read_bool("edge pinned flag")?,
            is_conditioned: false,
            nodes: self.read_index_array("edge nodes")?,
        })
    }

    fn read_edge(&mut self, repair_zero_stiffness: bool) -> Result<Edge> {
        self.expect_tag("edge")?;
        let index = self.read_usize("edge index")?;
        let label = self.read_line_field("edge label")?;
        let length = self.read_f64("edge length")?;
        let strain = self.read_f64("edge strain")?;
        let mut stiffness = self.read_f64("edge stiffness")?;
        if repair_zero_stiffness && stiffness == 0.0 {
            stiffness = 1.0;
        }
        let edge = Edge {
            index,
            label,
            length,
            strain,
            stiffness,
            is_pinned: self.read_bool("edge pinned flag")?,
            is_conditioned: self.read_bool("edge conditioned flag")?,
            nodes: self.read_index_array("edge nodes")?,
        };
        Ok(edge)
    }

    fn read_path_v3(&mut self, conditions: &mut Vec<Condition>) -> Result<Path> {
        self.expect_tag("path")?;
        let index = self.read_usize("path index")?;
        let min_tree_length = self.read_f64("path min tree length")?;
        let path_fixed_length = self.read_bool("path fixed length flag")?;
        let path_fixed_length_value = self.read_f64("path fixed length value")?;
        let path_fixed_angle = self.read_bool("path fixed angle flag")?;
        let _path_fixed_angle_value = self.read_f64("path fixed angle value")?;
        let is_leaf = self.read_bool("path leaf flag")?;
        let is_active = self.read_bool("path active flag")?;
        let is_border = self.read_bool("path border flag")?;
        let is_polygon = self.read_bool("path polygon flag")?;
        let _legacy_fwd_poly = self.read_usize("path fwd poly")?;
        let _legacy_bkd_poly = self.read_usize("path bkd poly")?;
        let nodes = self.read_index_array("path nodes")?;
        let edges = self.read_index_array("path edges")?;

        if let Some((node1, node2)) = nodes.first().copied().zip(nodes.last().copied()) {
            if path_fixed_length && min_tree_length == path_fixed_length_value {
                push_condition(conditions, ConditionKind::PathActive { node1, node2 });
            }
            if path_fixed_angle {
                // TreeMaker 5.0.1 reads the serialized angle value, but assigns
                // the fixed-angle boolean to the condition angle in v3 import.
                push_condition(
                    conditions,
                    ConditionKind::PathAngleFixed {
                        node1,
                        node2,
                        angle: 1.0,
                    },
                );
            }
        }

        Ok(Path {
            index,
            min_tree_length,
            min_paper_length: 0.0,
            act_tree_length: 0.0,
            act_paper_length: 0.0,
            is_leaf,
            is_sub: false,
            is_feasible: false,
            is_active,
            is_border,
            is_polygon,
            is_conditioned: false,
            fwd_poly: None,
            bkd_poly: None,
            nodes,
            edges,
            outset_path: None,
            front_reduction: 0.0,
            back_reduction: 0.0,
            min_depth: DEPTH_NOT_SET,
            min_depth_dist: DEPTH_NOT_SET,
            owned_vertices: Vec::new(),
            owned_creases: Vec::new(),
            owner: OwnerRef::Tree,
        })
    }

    fn read_path_v4(&mut self, poly_count: usize) -> Result<Path> {
        self.expect_tag("path")?;
        Ok(Path {
            index: self.read_usize("path index")?,
            min_tree_length: self.read_f64("path min tree length")?,
            min_paper_length: self.read_f64("path min paper length")?,
            act_tree_length: 0.0,
            act_paper_length: 0.0,
            is_leaf: self.read_bool("path leaf flag")?,
            is_sub: self.read_bool("path sub flag")?,
            is_feasible: false,
            is_active: self.read_bool("path active flag")?,
            is_border: self.read_bool("path border flag")?,
            is_polygon: self.read_bool("path polygon flag")?,
            is_conditioned: self.read_bool("path conditioned flag")?,
            owned_vertices: self.read_index_array("path owned vertices")?,
            fwd_poly: self.read_optional_index_in_range("path fwd poly", poly_count)?,
            bkd_poly: self.read_optional_index_in_range("path bkd poly", poly_count)?,
            nodes: self.read_index_array("path nodes")?,
            edges: self.read_index_array("path edges")?,
            owner: self.read_path_owner()?,
            outset_path: None,
            front_reduction: 0.0,
            back_reduction: 0.0,
            min_depth: DEPTH_NOT_SET,
            min_depth_dist: DEPTH_NOT_SET,
            owned_creases: Vec::new(),
        })
    }

    fn read_path_v5(&mut self, poly_count: usize, path_count: usize) -> Result<Path> {
        self.expect_tag("path")?;
        Ok(Path {
            index: self.read_usize("path index")?,
            min_tree_length: self.read_f64("path min tree length")?,
            min_paper_length: self.read_f64("path min paper length")?,
            act_tree_length: self.read_f64("path actual tree length")?,
            act_paper_length: self.read_f64("path actual paper length")?,
            is_leaf: self.read_bool("path leaf flag")?,
            is_sub: self.read_bool("path sub flag")?,
            is_feasible: self.read_bool("path feasible flag")?,
            is_active: self.read_bool("path active flag")?,
            is_border: self.read_bool("path border flag")?,
            is_polygon: self.read_bool("path polygon flag")?,
            is_conditioned: self.read_bool("path conditioned flag")?,
            fwd_poly: self.read_optional_index_in_range("path fwd poly", poly_count)?,
            bkd_poly: self.read_optional_index_in_range("path bkd poly", poly_count)?,
            nodes: self.read_index_array("path nodes")?,
            edges: self.read_index_array("path edges")?,
            outset_path: self.read_optional_index_in_range("path outset", path_count)?,
            front_reduction: self.read_f64("path front reduction")?,
            back_reduction: self.read_f64("path back reduction")?,
            min_depth: self.read_f64("path min depth")?,
            min_depth_dist: self.read_f64("path min depth distance")?,
            owned_vertices: self.read_index_array("path owned vertices")?,
            owned_creases: self.read_index_array("path owned creases")?,
            owner: self.read_path_owner()?,
        })
    }

    fn read_poly_v4(&mut self, path_count: usize) -> Result<Poly> {
        self.expect_tag("poly")?;
        let index = self.read_usize("poly index")?;
        let centroid = self.read_point("poly centroid")?;
        let node_locs = self.read_point_array("poly node locations")?;
        let is_sub_poly = self.read_bool("poly sub flag")?;
        let owned_nodes = self.read_index_array("poly owned nodes")?;
        let owned_paths = self.read_index_array("poly owned paths")?;
        let owned_polys = self.read_index_array("poly owned polys")?;
        let owned_creases = self.read_index_array("poly owned creases")?;
        let ring_nodes = self.read_index_array("poly ring nodes")?;
        let ring_paths = self.read_index_array("poly ring paths")?;
        let cross_paths = self.read_index_array("poly cross paths")?;
        let inset_nodes = self.read_index_array("poly inset nodes")?;
        let spoke_paths = self.read_index_array("poly spoke paths")?;
        let ridge_path = self.read_optional_index_in_range("poly ridge path", path_count)?;
        let owner = self.read_poly_owner()?;
        Ok(Poly {
            index,
            centroid,
            is_sub_poly,
            ring_nodes,
            ring_paths,
            cross_paths,
            inset_nodes,
            spoke_paths,
            ridge_path,
            node_locs,
            local_root_vertices: Vec::new(),
            local_root_creases: Vec::new(),
            owned_nodes,
            owned_paths,
            owned_polys,
            owned_creases,
            owned_facets: Vec::new(),
            owner,
        })
    }

    fn read_poly_v5(&mut self, path_count: usize) -> Result<Poly> {
        self.expect_tag("poly")?;
        let index = self.read_usize("poly index")?;
        let centroid = self.read_point("poly centroid")?;
        let is_sub_poly = self.read_bool("poly sub flag")?;
        Ok(Poly {
            index,
            centroid,
            is_sub_poly,
            ring_nodes: self.read_index_array("poly ring nodes")?,
            ring_paths: self.read_index_array("poly ring paths")?,
            cross_paths: self.read_index_array("poly cross paths")?,
            inset_nodes: self.read_index_array("poly inset nodes")?,
            spoke_paths: self.read_index_array("poly spoke paths")?,
            ridge_path: self.read_optional_index_in_range("poly ridge path", path_count)?,
            node_locs: self.read_point_array("poly node locations")?,
            local_root_vertices: self.read_index_array("poly local root vertices")?,
            local_root_creases: self.read_index_array("poly local root creases")?,
            owned_nodes: self.read_index_array("poly owned nodes")?,
            owned_paths: self.read_index_array("poly owned paths")?,
            owned_polys: self.read_index_array("poly owned polys")?,
            owned_creases: self.read_index_array("poly owned creases")?,
            owned_facets: self.read_index_array("poly owned facets")?,
            owner: self.read_poly_owner()?,
        })
    }

    fn read_vertex_v4(&mut self, index: usize) -> Result<Vertex> {
        self.expect_tag("vrtx")?;
        Ok(Vertex {
            index,
            loc: self.read_point("vertex location")?,
            elevation: 0.0,
            is_border: false,
            tree_node: None,
            left_pseudohinge_mate: None,
            right_pseudohinge_mate: None,
            creases: self.read_index_array("vertex creases")?,
            depth: DEPTH_NOT_SET,
            discrete_depth: 0,
            cc_flag: 0,
            st_flag: 0,
            owner: self.read_vertex_owner()?,
        })
    }

    fn read_vertex_v5(&mut self, node_count: usize, vertex_count: usize) -> Result<Vertex> {
        self.expect_tag("vrtx")?;
        let index = self.read_usize("vertex index")?;
        Ok(Vertex {
            index,
            loc: self.read_point("vertex location")?,
            elevation: self.read_f64("vertex elevation")?,
            is_border: self.read_bool("vertex border flag")?,
            tree_node: self.read_optional_index_in_range("vertex tree node", node_count)?,
            left_pseudohinge_mate: self
                .read_optional_index_in_range("vertex left pseudohinge mate", vertex_count)?,
            right_pseudohinge_mate: self
                .read_optional_index_in_range("vertex right pseudohinge mate", vertex_count)?,
            creases: self.read_index_array("vertex creases")?,
            depth: self.read_f64("vertex depth")?,
            discrete_depth: self.read_usize("vertex discrete depth")?,
            cc_flag: self.read_i32("vertex cc flag")?,
            st_flag: self.read_i32("vertex st flag")?,
            owner: self.read_vertex_owner()?,
        })
    }

    fn read_crease_v4(&mut self, index: usize) -> Result<Crease> {
        self.expect_tag("crse")?;
        Ok(Crease {
            index,
            kind: self.read_i32("crease kind")?,
            vertices: self.read_index_array("crease vertices")?,
            fwd_facet: None,
            bkd_facet: None,
            fold: 0,
            cc_flag: 0,
            st_flag: 0,
            owner: self.read_crease_owner()?,
        })
    }

    fn read_crease_v5(&mut self, facet_count: usize) -> Result<Crease> {
        self.expect_tag("crse")?;
        let index = self.read_usize("crease index")?;
        Ok(Crease {
            index,
            kind: self.read_i32("crease kind")?,
            vertices: self.read_index_array("crease vertices")?,
            fwd_facet: self.read_optional_index_in_range("crease fwd facet", facet_count)?,
            bkd_facet: self.read_optional_index_in_range("crease bkd facet", facet_count)?,
            fold: self.read_i32("crease fold")?,
            cc_flag: self.read_i32("crease cc flag")?,
            st_flag: self.read_i32("crease st flag")?,
            owner: self.read_crease_owner()?,
        })
    }

    fn read_facet_v5(&mut self, edge_count: usize) -> Result<Facet> {
        self.expect_tag("fact")?;
        let index = self.read_usize("facet index")?;
        Ok(Facet {
            index,
            centroid: self.read_point("facet centroid")?,
            is_well_formed: self.read_bool("facet well-formed flag")?,
            vertices: self.read_index_array("facet vertices")?,
            creases: self.read_index_array("facet creases")?,
            corridor_edge: self.read_optional_index_in_range("facet corridor edge", edge_count)?,
            head_facets: self.read_index_array("facet head facets")?,
            tail_facets: self.read_index_array("facet tail facets")?,
            order: self.read_usize("facet order")?,
            color: self.read_i32("facet color")?,
            owner: self.read_facet_owner()?,
        })
    }

    fn read_condition_v4(&mut self, index: usize) -> Result<Condition> {
        let tag = self.read_token("condition tag")?;
        if tag.len() > 4 {
            return Err(self.err(format!("bad condition tag {tag:?}")));
        }
        let n = self.read_usize("condition line count")?;
        validate_condition_rest_len(&tag, n)?;
        let mut raw_lines = Vec::with_capacity(n);
        for _ in 0..n {
            raw_lines.push(self.read_raw_line("condition field")?);
        }
        let kind = ConditionKind::from_stream(&tag, &raw_lines)?;
        Ok(Condition {
            index,
            is_feasible: true,
            kind,
        })
    }

    fn read_condition_v5(&mut self) -> Result<Condition> {
        let tag = self.read_token("condition tag")?;
        if tag.len() > 4 {
            return Err(self.err(format!("bad condition tag {tag:?}")));
        }
        let index = self.read_usize("condition index")?;
        let is_feasible = self.read_bool("condition feasibility")?;
        let n = self.read_usize("condition line count")?;
        validate_condition_rest_len(&tag, n)?;
        let mut raw_lines = Vec::with_capacity(n);
        for _ in 0..n {
            raw_lines.push(self.read_raw_line("condition field")?);
        }
        let kind = ConditionKind::from_stream(&tag, &raw_lines)?;
        Ok(Condition {
            index,
            is_feasible,
            kind,
        })
    }

    fn read_node_owner(&mut self) -> Result<OwnerRef> {
        if self.read_usize("node owner is poly")? == 1 {
            Ok(OwnerRef::Poly(self.read_usize("node owner poly")?))
        } else {
            Ok(OwnerRef::Tree)
        }
    }

    fn read_path_owner(&mut self) -> Result<OwnerRef> {
        if self.read_usize("path owner is poly")? == 1 {
            Ok(OwnerRef::Poly(self.read_usize("path owner poly")?))
        } else {
            Ok(OwnerRef::Tree)
        }
    }

    fn read_poly_owner(&mut self) -> Result<OwnerRef> {
        if self.read_usize("poly owner is poly")? == 1 {
            Ok(OwnerRef::Poly(self.read_usize("poly owner poly")?))
        } else {
            Ok(OwnerRef::Tree)
        }
    }

    fn read_vertex_owner(&mut self) -> Result<OwnerRef> {
        if self.read_usize("vertex owner is node")? == 1 {
            Ok(OwnerRef::Node(self.read_usize("vertex owner node")?))
        } else {
            Ok(OwnerRef::Path(self.read_usize("vertex owner path")?))
        }
    }

    fn read_crease_owner(&mut self) -> Result<OwnerRef> {
        if self.read_usize("crease owner is poly")? == 1 {
            Ok(OwnerRef::Poly(self.read_usize("crease owner poly")?))
        } else {
            Ok(OwnerRef::Path(self.read_usize("crease owner path")?))
        }
    }

    fn read_facet_owner(&mut self) -> Result<OwnerRef> {
        Ok(OwnerRef::Poly(self.read_usize("facet owner poly")?))
    }

    fn skip_leading_ws(&mut self) {
        while self.pos < self.bytes.len() && self.bytes[self.pos].is_ascii_whitespace() {
            self.pos += 1;
        }
    }

    fn consume_trailing_space(&mut self) {
        while self.pos < self.bytes.len()
            && (self.bytes[self.pos] == b' ' || self.bytes[self.pos] == b'\t')
        {
            self.pos += 1;
        }
        if self.pos < self.bytes.len() {
            match self.bytes[self.pos] {
                b'\n' => self.pos += 1,
                b'\r' => {
                    self.pos += 1;
                    if self.pos < self.bytes.len() && self.bytes[self.pos] == b'\n' {
                        self.pos += 1;
                    }
                }
                _ => {}
            }
        }
    }

    fn err(&self, message: String) -> TreeError {
        TreeError::Parse {
            offset: self.pos,
            message,
        }
    }
}

struct Writer {
    precision: usize,
    eol: &'static str,
    out: String,
}

impl Writer {
    fn new(precision: usize, eol: &'static str) -> Self {
        Self {
            precision,
            eol,
            out: String::new(),
        }
    }

    fn finish(self) -> String {
        self.out
    }

    fn line(&mut self, value: impl AsRef<str>) {
        self.out.push_str(value.as_ref());
        self.out.push_str(self.eol);
    }

    fn s(&mut self, value: &str) {
        self.line(value);
    }

    fn cstr(&mut self, value: &str) {
        let mut escaped = String::new();
        for ch in value.chars() {
            match ch {
                '\n' => escaped.push_str("\\n"),
                '\r' => escaped.push_str("\\r"),
                '\\' => escaped.push_str("\\\\"),
                _ => escaped.push(ch),
            }
        }
        self.line(escaped);
    }

    fn u(&mut self, value: usize) {
        self.line(value.to_string());
    }

    fn i(&mut self, value: i32) {
        self.line(value.to_string());
    }

    fn f(&mut self, value: TmFloat) {
        self.line(fmt_float(value, self.precision));
    }

    fn b(&mut self, value: bool) {
        self.line(if value { "true" } else { "false" });
    }

    fn point(&mut self, value: Point) {
        self.f(value.x);
        self.f(value.y);
    }

    fn array(&mut self, values: &[usize]) {
        self.u(values.len());
        for value in values {
            self.u(*value);
        }
    }

    fn point_array(&mut self, values: &[Point]) {
        self.u(values.len());
        for value in values {
            self.point(*value);
        }
    }

    fn owner_node_or_tree(&mut self, owner: &OwnerRef) {
        match owner {
            OwnerRef::Poly(id) => {
                self.u(1);
                self.u(*id);
            }
            _ => self.u(0),
        }
    }

    fn owner_vertex(&mut self, owner: &OwnerRef) {
        match owner {
            OwnerRef::Node(id) => {
                self.u(1);
                self.u(*id);
            }
            OwnerRef::Path(id) => {
                self.u(0);
                self.u(*id);
            }
            _ => {
                self.u(0);
                self.u(0);
            }
        }
    }

    fn owner_crease(&mut self, owner: &OwnerRef) {
        match owner {
            OwnerRef::Poly(id) => {
                self.u(1);
                self.u(*id);
            }
            OwnerRef::Path(id) => {
                self.u(0);
                self.u(*id);
            }
            _ => {
                self.u(0);
                self.u(0);
            }
        }
    }

    fn owner_facet(&mut self, owner: &OwnerRef) {
        match owner {
            OwnerRef::Poly(id) => self.u(*id),
            _ => self.u(0),
        }
    }

    fn node_v4(&mut self, node: &Node) {
        self.s("node");
        self.u(node.index);
        self.cstr(&node.label);
        self.point(node.loc);
        self.b(node.is_leaf);
        self.b(node.is_sub);
        self.b(node.is_border);
        self.b(node.is_pinned);
        self.b(node.is_polygon);
        self.b(node.is_conditioned);
        self.array(&node.owned_vertices);
        self.array(&node.edges);
        self.array(&node.leaf_paths);
        self.owner_node_or_tree(&node.owner);
    }

    fn node_v5(&mut self, node: &Node) {
        self.s("node");
        self.u(node.index);
        self.cstr(&node.label);
        self.point(node.loc);
        self.f(node.depth);
        self.f(node.elevation);
        self.b(node.is_leaf);
        self.b(node.is_sub);
        self.b(node.is_border);
        self.b(node.is_pinned);
        self.b(node.is_polygon);
        self.b(node.is_junction);
        self.b(node.is_conditioned);
        self.array(&node.edges);
        self.array(&node.leaf_paths);
        self.array(&node.owned_vertices);
        self.owner_node_or_tree(&node.owner);
    }

    fn edge(&mut self, edge: &Edge) {
        self.s("edge");
        self.u(edge.index);
        self.cstr(&edge.label);
        self.f(edge.length);
        self.f(edge.strain);
        self.f(edge.stiffness);
        self.b(edge.is_pinned);
        self.b(edge.is_conditioned);
        self.array(&edge.nodes);
    }

    fn path_v4(&mut self, path: &Path) {
        self.s("path");
        self.u(path.index);
        self.f(path.min_tree_length);
        self.f(path.min_paper_length);
        self.b(path.is_leaf);
        self.b(path.is_sub);
        self.b(path.is_active);
        self.b(path.is_border);
        self.b(path.is_polygon);
        self.b(path.is_conditioned);
        self.array(&path.owned_vertices);
        self.u(path.fwd_poly.unwrap_or(0));
        self.u(path.bkd_poly.unwrap_or(0));
        self.array(&path.nodes);
        self.array(&path.edges);
        self.owner_node_or_tree(&path.owner);
    }

    fn path_v5(&mut self, path: &Path) {
        self.s("path");
        self.u(path.index);
        self.f(path.min_tree_length);
        self.f(path.min_paper_length);
        self.f(path.act_tree_length);
        self.f(path.act_paper_length);
        self.b(path.is_leaf);
        self.b(path.is_sub);
        self.b(path.is_feasible);
        self.b(path.is_active);
        self.b(path.is_border);
        self.b(path.is_polygon);
        self.b(path.is_conditioned);
        self.u(path.fwd_poly.unwrap_or(0));
        self.u(path.bkd_poly.unwrap_or(0));
        self.array(&path.nodes);
        self.array(&path.edges);
        self.u(path.outset_path.unwrap_or(0));
        self.f(path.front_reduction);
        self.f(path.back_reduction);
        self.f(path.min_depth);
        self.f(path.min_depth_dist);
        self.array(&path.owned_vertices);
        self.array(&path.owned_creases);
        self.owner_node_or_tree(&path.owner);
    }

    fn poly_v5(&mut self, poly: &Poly) {
        self.s("poly");
        self.u(poly.index);
        self.point(poly.centroid);
        self.b(poly.is_sub_poly);
        self.array(&poly.ring_nodes);
        self.array(&poly.ring_paths);
        self.array(&poly.cross_paths);
        self.array(&poly.inset_nodes);
        self.array(&poly.spoke_paths);
        self.u(poly.ridge_path.unwrap_or(0));
        self.point_array(&poly.node_locs);
        self.array(&poly.local_root_vertices);
        self.array(&poly.local_root_creases);
        self.array(&poly.owned_nodes);
        self.array(&poly.owned_paths);
        self.array(&poly.owned_polys);
        self.array(&poly.owned_creases);
        self.array(&poly.owned_facets);
        self.owner_node_or_tree(&poly.owner);
    }

    fn vertex_v5(&mut self, vertex: &Vertex) {
        self.s("vrtx");
        self.u(vertex.index);
        self.point(vertex.loc);
        self.f(vertex.elevation);
        self.b(vertex.is_border);
        self.u(vertex.tree_node.unwrap_or(0));
        self.u(vertex.left_pseudohinge_mate.unwrap_or(0));
        self.u(vertex.right_pseudohinge_mate.unwrap_or(0));
        self.array(&vertex.creases);
        self.f(vertex.depth);
        self.u(vertex.discrete_depth);
        self.i(vertex.cc_flag);
        self.i(vertex.st_flag);
        self.owner_vertex(&vertex.owner);
    }

    fn crease_v5(&mut self, crease: &Crease) {
        self.s("crse");
        self.u(crease.index);
        self.i(crease.kind);
        self.array(&crease.vertices);
        self.u(crease.fwd_facet.unwrap_or(0));
        self.u(crease.bkd_facet.unwrap_or(0));
        self.i(crease.fold);
        self.i(crease.cc_flag);
        self.i(crease.st_flag);
        self.owner_crease(&crease.owner);
    }

    fn facet_v5(&mut self, facet: &Facet) {
        self.s("fact");
        self.u(facet.index);
        self.point(facet.centroid);
        self.b(facet.is_well_formed);
        self.array(&facet.vertices);
        self.array(&facet.creases);
        self.u(facet.corridor_edge.unwrap_or(0));
        self.array(&facet.head_facets);
        self.array(&facet.tail_facets);
        self.u(facet.order);
        self.i(facet.color);
        self.owner_facet(&facet.owner);
    }

    fn condition_v4(&mut self, condition: &Condition) {
        self.s(condition.kind.tag());
        let lines = condition.kind.stream_lines(self.precision);
        self.u(lines.len());
        for line in &lines {
            self.line(line);
        }
    }

    fn condition_v5(&mut self, condition: &Condition) {
        self.s(condition.kind.tag());
        self.u(condition.index);
        self.b(condition.is_feasible);
        let lines = condition.kind.stream_lines(self.precision);
        self.u(lines.len());
        for line in &lines {
            self.line(line);
        }
    }
}

struct ScaleObjective;

impl nlco::DifferentiableFn for ScaleObjective {
    fn func(&self, x: &[f64]) -> f64 {
        -x[0]
    }

    fn grad(&self, _x: &[f64], grad: &mut [f64]) {
        grad.fill(0.0);
        grad[0] = -1.0;
    }
}

struct StrainObjective {
    edge_offset: usize,
    stiffness: Vec<TmFloat>,
}

impl nlco::DifferentiableFn for StrainObjective {
    fn func(&self, x: &[f64]) -> f64 {
        let mut value = 0.0;
        for (i, x_i) in x.iter().enumerate().skip(self.edge_offset) {
            value += self.stiffness[i - self.edge_offset] * x_i.powi(2);
        }
        value
    }

    fn grad(&self, x: &[f64], grad: &mut [f64]) {
        grad.fill(0.0);
        for (i, x_i) in x.iter().enumerate().skip(self.edge_offset) {
            grad[i] = 2.0 * self.stiffness[i - self.edge_offset] * *x_i;
        }
    }
}

impl ConditionKind {
    fn from_stream(tag: &str, lines: &[String]) -> Result<Self> {
        validate_condition_rest_len(tag, lines.len())?;
        let kind = match tag {
            "CNxn" => Self::NodeCombo {
                node: parse_condition_usize(&lines[0], "condition node")?,
                to_symmetry_line: parse_condition_bool(&lines[1]),
                to_paper_edge: parse_condition_bool(&lines[2]),
                to_paper_corner: parse_condition_bool(&lines[3]),
                x_fixed: parse_condition_bool(&lines[4]),
                x_fix_value: parse_condition_f64(&lines[5], "condition x fixed value")?,
                y_fixed: parse_condition_bool(&lines[6]),
                y_fix_value: parse_condition_f64(&lines[7], "condition y fixed value")?,
            },
            "CNfn" => Self::NodeFixed {
                node: parse_condition_usize(&lines[0], "condition node")?,
                x_fixed: parse_condition_bool(&lines[1]),
                y_fixed: parse_condition_bool(&lines[2]),
                x_fix_value: parse_condition_f64(&lines[3], "condition x fixed value")?,
                y_fix_value: parse_condition_f64(&lines[4], "condition y fixed value")?,
            },
            "CNkn" => Self::NodeOnCorner {
                node: parse_condition_usize(&lines[0], "condition node")?,
            },
            "CNen" => Self::NodeOnEdge {
                node: parse_condition_usize(&lines[0], "condition node")?,
            },
            "CNsn" => Self::NodeSymmetric {
                node: parse_condition_usize(&lines[0], "condition node")?,
            },
            "CNpn" => Self::NodesPaired {
                node1: parse_condition_usize(&lines[0], "condition node 1")?,
                node2: parse_condition_usize(&lines[1], "condition node 2")?,
            },
            "CNcn" => Self::NodesCollinear {
                node1: parse_condition_usize(&lines[0], "condition node 1")?,
                node2: parse_condition_usize(&lines[1], "condition node 2")?,
                node3: parse_condition_usize(&lines[2], "condition node 3")?,
            },
            "CNfe" => Self::EdgeLengthFixed {
                edge: parse_condition_usize(&lines[0], "condition edge")?,
            },
            "CNes" => Self::EdgesSameStrain {
                edge1: parse_condition_usize(&lines[0], "condition edge 1")?,
                edge2: parse_condition_usize(&lines[1], "condition edge 2")?,
            },
            "CNap" => Self::PathActive {
                node1: parse_condition_usize(&lines[0], "condition node 1")?,
                node2: parse_condition_usize(&lines[1], "condition node 2")?,
            },
            "CNfp" => Self::PathAngleFixed {
                node1: parse_condition_usize(&lines[0], "condition node 1")?,
                node2: parse_condition_usize(&lines[1], "condition node 2")?,
                angle: parse_condition_f64(&lines[2], "condition angle")?,
            },
            "CNqp" => Self::PathAngleQuant {
                node1: parse_condition_usize(&lines[0], "condition node 1")?,
                node2: parse_condition_usize(&lines[1], "condition node 2")?,
                quant: parse_condition_usize(&lines[2], "condition quantization")?,
                quant_offset: parse_condition_f64(&lines[3], "condition quantization offset")?,
            },
            "CNxp" => Self::PathCombo {
                node1: parse_condition_usize(&lines[0], "condition node 1")?,
                node2: parse_condition_usize(&lines[1], "condition node 2")?,
                is_angle_fixed: parse_condition_bool(&lines[2]),
                angle: parse_condition_f64(&lines[3], "condition angle")?,
                is_angle_quant: parse_condition_bool(&lines[4]),
                quant: parse_condition_usize(&lines[5], "condition quantization")?,
                quant_offset: parse_condition_f64(&lines[6], "condition quantization offset")?,
            },
            _ => unreachable!("validate_condition_rest_len accepted an unrecognized tag"),
        };
        Ok(kind)
    }

    fn tag(&self) -> &'static str {
        match self {
            Self::NodeCombo { .. } => "CNxn",
            Self::NodeFixed { .. } => "CNfn",
            Self::NodeOnCorner { .. } => "CNkn",
            Self::NodeOnEdge { .. } => "CNen",
            Self::NodeSymmetric { .. } => "CNsn",
            Self::NodesPaired { .. } => "CNpn",
            Self::NodesCollinear { .. } => "CNcn",
            Self::EdgeLengthFixed { .. } => "CNfe",
            Self::EdgesSameStrain { .. } => "CNes",
            Self::PathCombo { .. } => "CNxp",
            Self::PathActive { .. } => "CNap",
            Self::PathAngleFixed { .. } => "CNfp",
            Self::PathAngleQuant { .. } => "CNqp",
        }
    }

    fn stream_lines(&self, precision: usize) -> Vec<String> {
        match self {
            Self::NodeCombo {
                node,
                to_symmetry_line,
                to_paper_edge,
                to_paper_corner,
                x_fixed,
                x_fix_value,
                y_fixed,
                y_fix_value,
            } => vec![
                node.to_string(),
                bool_stream(*to_symmetry_line),
                bool_stream(*to_paper_edge),
                bool_stream(*to_paper_corner),
                bool_stream(*x_fixed),
                fmt_float(*x_fix_value, precision),
                bool_stream(*y_fixed),
                fmt_float(*y_fix_value, precision),
            ],
            Self::NodeFixed {
                node,
                x_fixed,
                y_fixed,
                x_fix_value,
                y_fix_value,
            } => vec![
                node.to_string(),
                bool_stream(*x_fixed),
                bool_stream(*y_fixed),
                fmt_float(*x_fix_value, precision),
                fmt_float(*y_fix_value, precision),
            ],
            Self::NodeOnCorner { node }
            | Self::NodeOnEdge { node }
            | Self::NodeSymmetric { node } => vec![node.to_string()],
            Self::NodesPaired { node1, node2 } | Self::PathActive { node1, node2 } => {
                vec![node1.to_string(), node2.to_string()]
            }
            Self::NodesCollinear {
                node1,
                node2,
                node3,
            } => vec![node1.to_string(), node2.to_string(), node3.to_string()],
            Self::EdgeLengthFixed { edge } => vec![edge.to_string()],
            Self::EdgesSameStrain { edge1, edge2 } => {
                vec![edge1.to_string(), edge2.to_string()]
            }
            Self::PathCombo {
                node1,
                node2,
                is_angle_fixed,
                angle,
                is_angle_quant,
                quant,
                quant_offset,
            } => vec![
                node1.to_string(),
                node2.to_string(),
                bool_stream(*is_angle_fixed),
                fmt_float(*angle, precision),
                bool_stream(*is_angle_quant),
                quant.to_string(),
                fmt_float(*quant_offset, precision),
            ],
            Self::PathAngleFixed {
                node1,
                node2,
                angle,
            } => vec![
                node1.to_string(),
                node2.to_string(),
                fmt_float(*angle, precision),
            ],
            Self::PathAngleQuant {
                node1,
                node2,
                quant,
                quant_offset,
            } => vec![
                node1.to_string(),
                node2.to_string(),
                quant.to_string(),
                fmt_float(*quant_offset, precision),
            ],
        }
    }

    fn validate_refs(&self, tree: &Tree) -> Result<()> {
        match self {
            Self::NodeCombo { node, .. }
            | Self::NodeFixed { node, .. }
            | Self::NodeOnCorner { node }
            | Self::NodeOnEdge { node }
            | Self::NodeSymmetric { node } => tree.check_ref("node", *node, tree.nodes.len()),
            Self::NodesPaired { node1, node2 }
            | Self::PathActive { node1, node2 }
            | Self::PathAngleFixed { node1, node2, .. }
            | Self::PathAngleQuant { node1, node2, .. }
            | Self::PathCombo { node1, node2, .. } => {
                tree.check_ref("node", *node1, tree.nodes.len())?;
                tree.check_ref("node", *node2, tree.nodes.len())
            }
            Self::NodesCollinear {
                node1,
                node2,
                node3,
            } => {
                tree.check_ref("node", *node1, tree.nodes.len())?;
                tree.check_ref("node", *node2, tree.nodes.len())?;
                tree.check_ref("node", *node3, tree.nodes.len())
            }
            Self::EdgeLengthFixed { edge } => tree.check_ref("edge", *edge, tree.edges.len()),
            Self::EdgesSameStrain { edge1, edge2 } => {
                tree.check_ref("edge", *edge1, tree.edges.len())?;
                tree.check_ref("edge", *edge2, tree.edges.len())
            }
        }
    }

    fn calc_feasibility(&self, tree: &Tree) -> bool {
        match self {
            Self::NodeCombo {
                node,
                to_symmetry_line,
                to_paper_edge,
                to_paper_corner,
                x_fixed,
                x_fix_value,
                y_fixed,
                y_fix_value,
            } => {
                let Some(loc) = node_loc(tree, *node) else {
                    return false;
                };
                if tree.has_symmetry
                    && *to_symmetry_line
                    && !is_tiny(stick_to_line(loc, tree.sym_loc, tree.sym_angle))
                {
                    return false;
                }
                if *to_paper_edge
                    && !is_tiny(stick_to_edge(loc, tree.paper_width, tree.paper_height))
                {
                    return false;
                }
                if *to_paper_corner {
                    if !is_tiny(corner_coord(loc.x, tree.paper_width)) {
                        return false;
                    }
                    // TreeMaker 5.0.1's CNxn feasibility check uses paper width
                    // for the y corner coordinate; preserve that behavior.
                    if !is_tiny(corner_coord(loc.y, tree.paper_width)) {
                        return false;
                    }
                }
                if *x_fixed && !is_tiny(*x_fix_value - loc.x) {
                    return false;
                }
                !*y_fixed || is_tiny(*y_fix_value - loc.y)
            }
            Self::NodeFixed {
                node,
                x_fixed,
                y_fixed,
                x_fix_value,
                y_fix_value,
            } => {
                let Some(loc) = node_loc(tree, *node) else {
                    return false;
                };
                if *x_fixed && !is_tiny(*x_fix_value - loc.x) {
                    return false;
                }
                !*y_fixed || is_tiny(*y_fix_value - loc.y)
            }
            Self::NodeOnCorner { node } => node_loc(tree, *node).is_some_and(|loc| {
                is_tiny(corner_coord(loc.x, tree.paper_width))
                    && is_tiny(corner_coord(loc.y, tree.paper_height))
            }),
            Self::NodeOnEdge { node } => node_loc(tree, *node).is_some_and(|loc| {
                is_tiny(stick_to_edge(loc, tree.paper_width, tree.paper_height))
            }),
            Self::NodeSymmetric { node } => {
                tree.has_symmetry
                    && node_loc(tree, *node).is_some_and(|loc| {
                        is_tiny(stick_to_line(loc, tree.sym_loc, tree.sym_angle))
                    })
            }
            Self::NodesPaired { node1, node2 } => {
                if !tree.has_symmetry {
                    return false;
                }
                let (Some(a), Some(b)) = (node_loc(tree, *node1), node_loc(tree, *node2)) else {
                    return false;
                };
                is_tiny(pair_fn_1a(a, b, tree.sym_angle))
                    && is_tiny(pair_fn_1b(a, b, tree.sym_loc, tree.sym_angle))
            }
            Self::NodesCollinear {
                node1,
                node2,
                node3,
            } => {
                let (Some(a), Some(b), Some(c)) = (
                    node_loc(tree, *node1),
                    node_loc(tree, *node2),
                    node_loc(tree, *node3),
                ) else {
                    return false;
                };
                is_tiny(collinear_fn_1(a, b, c))
            }
            Self::EdgeLengthFixed { edge } => {
                edge_ref(tree, *edge).is_some_and(|edge| is_tiny(edge.strain))
            }
            Self::EdgesSameStrain { edge1, edge2 } => {
                let (Some(a), Some(b)) = (edge_ref(tree, *edge1), edge_ref(tree, *edge2)) else {
                    return false;
                };
                is_tiny(a.strain - b.strain)
            }
            Self::PathActive { node1, node2 } => tree
                .find_leaf_path_between(*node1, *node2)
                .is_some_and(|path| path.is_active),
            Self::PathAngleFixed {
                node1,
                node2,
                angle,
            } => path_active_with_nodes(tree, *node1, *node2)
                .is_some_and(|(a, b)| is_tiny(path_angle_fn_1(a, b, *angle))),
            Self::PathAngleQuant {
                node1,
                node2,
                quant,
                quant_offset,
            } => path_active_with_nodes(tree, *node1, *node2)
                .is_some_and(|(a, b)| is_tiny(quantize_angle_fn_1(a, b, *quant, *quant_offset))),
            Self::PathCombo {
                node1,
                node2,
                is_angle_fixed,
                angle,
                is_angle_quant,
                quant,
                quant_offset,
            } => {
                let Some((a, b)) = path_active_with_nodes(tree, *node1, *node2) else {
                    return false;
                };
                if *is_angle_fixed && !is_tiny(path_angle_fn_1(a, b, *angle)) {
                    return false;
                }
                !*is_angle_quant || is_tiny(quantize_angle_fn_1(a, b, *quant, *quant_offset))
            }
        }
    }

    fn collect_conditioned_parts(
        &self,
        tree: &Tree,
        nodes: &mut [bool],
        edges: &mut [bool],
        paths: &mut [bool],
    ) {
        match *self {
            Self::NodeCombo { node, .. }
            | Self::NodeFixed { node, .. }
            | Self::NodeOnCorner { node }
            | Self::NodeOnEdge { node }
            | Self::NodeSymmetric { node } => mark_1_based(nodes, node),
            Self::NodesPaired { node1, node2 } => {
                mark_1_based(nodes, node1);
                mark_1_based(nodes, node2);
            }
            Self::PathActive { node1, node2 }
            | Self::PathAngleFixed { node1, node2, .. }
            | Self::PathAngleQuant { node1, node2, .. }
            | Self::PathCombo { node1, node2, .. } => {
                mark_1_based(nodes, node1);
                mark_1_based(nodes, node2);
                if let Some(path) = tree.find_leaf_path_between(node1, node2) {
                    mark_1_based(paths, path.index);
                }
            }
            Self::NodesCollinear {
                node1,
                node2,
                node3,
            } => {
                mark_1_based(nodes, node1);
                mark_1_based(nodes, node2);
                mark_1_based(nodes, node3);
            }
            Self::EdgeLengthFixed { edge } => mark_1_based(edges, edge),
            Self::EdgesSameStrain { edge1, edge2 } => {
                mark_1_based(edges, edge1);
                mark_1_based(edges, edge2);
            }
        }
    }

    fn node_refs_survive(&self, map: &[Option<usize>]) -> bool {
        let survives = |id: usize| map.get(id).copied().flatten().is_some();
        match *self {
            Self::NodeCombo { node, .. }
            | Self::NodeFixed { node, .. }
            | Self::NodeOnCorner { node }
            | Self::NodeOnEdge { node }
            | Self::NodeSymmetric { node } => survives(node),
            Self::NodesPaired { node1, node2 }
            | Self::PathActive { node1, node2 }
            | Self::PathAngleFixed { node1, node2, .. }
            | Self::PathAngleQuant { node1, node2, .. }
            | Self::PathCombo { node1, node2, .. } => survives(node1) && survives(node2),
            Self::NodesCollinear {
                node1,
                node2,
                node3,
            } => survives(node1) && survives(node2) && survives(node3),
            Self::EdgeLengthFixed { .. } | Self::EdgesSameStrain { .. } => true,
        }
    }

    fn remap_nodes(&mut self, map: &[Option<usize>]) {
        match self {
            Self::NodeCombo { node, .. }
            | Self::NodeFixed { node, .. }
            | Self::NodeOnCorner { node }
            | Self::NodeOnEdge { node }
            | Self::NodeSymmetric { node } => remap_value(node, map),
            Self::NodesPaired { node1, node2 }
            | Self::PathActive { node1, node2 }
            | Self::PathAngleFixed { node1, node2, .. }
            | Self::PathAngleQuant { node1, node2, .. }
            | Self::PathCombo { node1, node2, .. } => {
                remap_value(node1, map);
                remap_value(node2, map);
            }
            Self::NodesCollinear {
                node1,
                node2,
                node3,
            } => {
                remap_value(node1, map);
                remap_value(node2, map);
                remap_value(node3, map);
            }
            Self::EdgeLengthFixed { .. } | Self::EdgesSameStrain { .. } => {}
        }
    }

    fn edge_refs_survive(&self, map: &[Option<usize>]) -> bool {
        let survives = |id: usize| map.get(id).copied().flatten().is_some();
        match *self {
            Self::EdgeLengthFixed { edge } => survives(edge),
            Self::EdgesSameStrain { edge1, edge2 } => survives(edge1) && survives(edge2),
            _ => true,
        }
    }

    fn remap_edges(&mut self, map: &[Option<usize>]) {
        match self {
            Self::EdgeLengthFixed { edge } => remap_value(edge, map),
            Self::EdgesSameStrain { edge1, edge2 } => {
                remap_value(edge1, map);
                remap_value(edge2, map);
            }
            _ => {}
        }
    }
}

fn push_condition(conditions: &mut Vec<Condition>, kind: ConditionKind) {
    conditions.push(Condition {
        index: conditions.len() + 1,
        is_feasible: true,
        kind,
    });
}

fn validate_paper_settings(paper: &PaperSettings) -> Result<()> {
    validate_positive("paper width", paper.width)?;
    validate_positive("paper height", paper.height)?;
    validate_positive("scale", paper.scale)
}

fn validate_positive(name: &'static str, value: TmFloat) -> Result<()> {
    if value.is_finite() && value > 0.0 {
        Ok(())
    } else {
        Err(TreeError::InvalidOperation(name))
    }
}

fn validate_contiguous_ids(kind: &'static str, ids: impl Iterator<Item = usize>) -> Result<()> {
    for (offset, id) in ids.enumerate() {
        if id != offset + 1 {
            return Err(TreeError::InvalidOperation(match kind {
                "node" => "design node IDs must be contiguous and 1-based",
                "edge" => "design edge IDs must be contiguous and 1-based",
                _ => "design IDs must be contiguous and 1-based",
            }));
        }
    }
    Ok(())
}

fn kill_v4_crease_pattern_refs(nodes: &mut [Node], paths: &mut [Path]) {
    for node in nodes {
        node.owned_vertices.clear();
        if matches!(node.owner, OwnerRef::Poly(_)) {
            node.owner = OwnerRef::Tree;
        }
    }
    for path in paths {
        path.owned_vertices.clear();
        path.owned_creases.clear();
        path.fwd_poly = None;
        path.bkd_poly = None;
        path.outset_path = None;
        if matches!(path.owner, OwnerRef::Poly(_)) {
            path.owner = OwnerRef::Tree;
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PartKind {
    Node,
    Path,
    Poly,
}

fn ids_to_flags(ids: &[usize], len: usize) -> Vec<bool> {
    let mut flags = vec![false; len + 1];
    for id in ids {
        if *id > 0 && *id <= len {
            flags[*id] = true;
        }
    }
    flags
}

fn keep_map(len: usize, doomed: &[usize]) -> Vec<Option<usize>> {
    let doomed = ids_to_flags(doomed, len);
    let mut map = vec![None; len + 1];
    let mut next = 1;
    for old in 1..=len {
        if !doomed[old] {
            map[old] = Some(next);
            next += 1;
        }
    }
    map
}

fn remap_value(value: &mut usize, map: &[Option<usize>]) {
    if let Some(Some(mapped)) = map.get(*value) {
        *value = *mapped;
    }
}

fn remap_option(value: &mut Option<usize>, map: &[Option<usize>]) {
    *value = value.and_then(|id| map.get(id).copied().flatten());
}

fn remap_vec(values: &mut Vec<usize>, map: &[Option<usize>]) {
    let mapped = values
        .iter()
        .filter_map(|id| map.get(*id).copied().flatten())
        .collect();
    *values = mapped;
}

fn remap_owner(owner: &mut OwnerRef, kind: PartKind, map: &[Option<usize>]) {
    match owner {
        OwnerRef::Node(id) if kind == PartKind::Node => {
            if let Some(mapped) = map.get(*id).copied().flatten() {
                *id = mapped;
            } else {
                *owner = OwnerRef::Tree;
            }
        }
        OwnerRef::Path(id) if kind == PartKind::Path => {
            if let Some(mapped) = map.get(*id).copied().flatten() {
                *id = mapped;
            } else {
                *owner = OwnerRef::Tree;
            }
        }
        OwnerRef::Poly(id) if kind == PartKind::Poly => {
            if let Some(mapped) = map.get(*id).copied().flatten() {
                *id = mapped;
            } else {
                *owner = OwnerRef::Tree;
            }
        }
        _ => {}
    }
}

fn mark_1_based(flags: &mut [bool], index: usize) {
    if let Some(flag) = index.checked_sub(1).and_then(|pos| flags.get_mut(pos)) {
        *flag = true;
    }
}

fn bool_stream(value: bool) -> String {
    (if value { "true" } else { "false" }).to_string()
}

fn parse_condition_usize(value: &str, label: &'static str) -> Result<usize> {
    value.parse::<usize>().map_err(|_| TreeError::Parse {
        offset: 0,
        message: format!("expected unsigned integer for {label}, found {value:?}"),
    })
}

fn parse_condition_f64(value: &str, label: &'static str) -> Result<TmFloat> {
    if value.starts_with("NAN") {
        return Ok(0.0);
    }
    value.parse::<TmFloat>().map_err(|_| TreeError::Parse {
        offset: 0,
        message: format!("expected float for {label}, found {value:?}"),
    })
}

fn parse_condition_bool(value: &str) -> bool {
    value == "true"
}

fn is_tiny(value: TmFloat) -> bool {
    value.abs() < DIST_TOL
}

fn point_sub(a: Point, b: Point) -> Point {
    Point {
        x: a.x - b.x,
        y: a.y - b.y,
    }
}

fn point_add(a: Point, b: Point) -> Point {
    Point {
        x: a.x + b.x,
        y: a.y + b.y,
    }
}

fn point_mul(a: Point, scale: TmFloat) -> Point {
    Point {
        x: a.x * scale,
        y: a.y * scale,
    }
}

fn point_div(a: Point, scale: TmFloat) -> Point {
    Point {
        x: a.x / scale,
        y: a.y / scale,
    }
}

fn rotate_ccw90(p: Point) -> Point {
    Point { x: -p.y, y: p.x }
}

fn inner(a: Point, b: Point) -> TmFloat {
    a.x * b.x + a.y * b.y
}

fn mag2(p: Point) -> TmFloat {
    p.x.powi(2) + p.y.powi(2)
}

fn mag(p: Point) -> TmFloat {
    mag2(p).sqrt()
}

fn normalize(p: Point) -> Point {
    point_div(p, mag(p))
}

fn orientation_2d(p1: Point, p2: Point, p3: Point) -> TmFloat {
    let p13 = point_sub(p1, p3);
    let p23 = point_sub(p2, p3);
    p13.x * p23.y - p13.y * p23.x
}

fn are_cw(p1: Point, p2: Point, p3: Point) -> bool {
    orientation_2d(p1, p2, p3) < 0.0
}

fn are_ccw(p1: Point, p2: Point, p3: Point) -> bool {
    orientation_2d(p1, p2, p3) > 0.0
}

fn are_parallel(p: Point, q: Point) -> bool {
    inner(p, rotate_ccw90(q)) == 0.0
}

fn line_intersection_params(
    p: Point,
    rp: Point,
    q: Point,
    rq: Point,
) -> Option<(TmFloat, TmFloat)> {
    let eps = TmFloat::EPSILON.sqrt();
    let rrpq = inner(rotate_ccw90(rp), rq);
    if rrpq.abs() < eps {
        return None;
    }
    let rqp = rotate_ccw90(point_sub(q, p));
    Some((inner(rqp, rq) / rrpq, inner(rqp, rp) / rrpq))
}

fn line_intersection_point_exact(p: Point, rp: Point, q: Point, rq: Point) -> Option<Point> {
    let rrpq = inner(rotate_ccw90(rp), rq);
    if rrpq == 0.0 {
        return None;
    }
    let tp = inner(rotate_ccw90(point_sub(q, p)), rq) / rrpq;
    Some(point_add(p, point_mul(rp, tp)))
}

fn incenter(p1: Point, p2: Point, p3: Point) -> Point {
    let l12 = p1.distance(p2);
    let l23 = p2.distance(p3);
    let l31 = p3.distance(p1);
    point_div(
        point_add(
            point_add(point_mul(p3, l12), point_mul(p1, l23)),
            point_mul(p2, l31),
        ),
        l12 + l23 + l31,
    )
}

fn inradius(p1: Point, p2: Point, p3: Point) -> TmFloat {
    let a = p1.distance(p2);
    let b = p2.distance(p3);
    let c = p3.distance(p1);
    0.5 * (((b + c - a) * (c + a - b) * (a + b - c)) / (a + b + c)).sqrt()
}

fn vertices_same_loc(p1: Point, p2: Point) -> bool {
    p1.distance(p2) < VERTEX_TOL
}

fn project_p_to_q(p1: Point, p2: Point, p: Point, q1: Point, q2: Point) -> Option<Point> {
    let rq = point_sub(q2, q1);
    let dq = mag(rq);
    let up = normalize(point_sub(p2, p1));
    let denom = inner(up, rq);
    if denom == 0.0 {
        return None;
    }
    let d = dq * inner(up, point_sub(p, q1)) / denom;
    let q = point_add(q1, point_mul(normalize(rq), d));
    (d > -0.9 * DIST_TOL && d < dq + 0.9 * DIST_TOL).then_some(q)
}

fn project_q_to_p(q: Point, p1: Point, p2: Point) -> Option<Point> {
    let rp = point_sub(p2, p1);
    let up = normalize(rp);
    let d = inner(up, point_sub(q, p1));
    let dp = inner(up, rp);
    let p = point_add(p1, point_mul(up, d));
    (d > -0.9 * DIST_TOL && d < dp + 0.9 * DIST_TOL).then_some(p)
}

fn sortable_ridge_vertex_value(vertex: Point, front: Point, back: Point) -> TmFloat {
    let pu = normalize(point_sub(back, front));
    let pv = rotate_ccw90(pu);
    let dm = point_mul(point_add(back, front), 0.5);
    let dp = point_sub(vertex, dm);
    let du = inner(dp, pu);
    let dv = inner(dp, pv);
    du.atan2(dv)
}

fn push_unique(values: &mut Vec<usize>, value: usize) {
    if !values.contains(&value) {
        values.push(value);
    }
}

fn other_edge_node(edge: &Edge, node: usize) -> Result<usize> {
    if edge.nodes.len() != 2 {
        return Err(TreeError::InvalidOperation(
            "tree edges must have exactly two endpoints",
        ));
    }
    if edge.nodes[0] == node {
        Ok(edge.nodes[1])
    } else if edge.nodes[1] == node {
        Ok(edge.nodes[0])
    } else {
        Err(TreeError::InvalidOperation("edge is not incident to node"))
    }
}

struct PerturbRng {
    state: u64,
}

impl PerturbRng {
    fn new() -> Self {
        Self { state: 0 }
    }

    fn next_delta(&mut self) -> TmFloat {
        self.state = self
            .state
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1);
        let unit = ((self.state >> 33) as TmFloat) / ((1u64 << 31) as TmFloat);
        2.0 * unit - 0.5
    }
}

fn angle(p: Point) -> TmFloat {
    p.y.atan2(p.x)
}

fn angle_change(p1: Point, p2: Point, p3: Point) -> TmFloat {
    let a = angle(point_sub(p3, p2)) - angle(point_sub(p2, p1));
    if a < -PI {
        a + TWO_PI
    } else if a >= PI {
        a - TWO_PI
    } else {
        a
    }
}

fn node_loc(tree: &Tree, index: usize) -> Option<Point> {
    tree.nodes.get(index.checked_sub(1)?).map(|node| node.loc)
}

fn edge_ref(tree: &Tree, index: usize) -> Option<&Edge> {
    tree.edges.get(index.checked_sub(1)?)
}

fn path_active_with_nodes(tree: &Tree, node1: usize, node2: usize) -> Option<(Point, Point)> {
    tree.find_leaf_path_between(node1, node2)
        .filter(|path| path.is_active)?;
    Some((node_loc(tree, node1)?, node_loc(tree, node2)?))
}

fn corner_coord(value: TmFloat, width_or_height: TmFloat) -> TmFloat {
    value * (value - width_or_height)
}

fn stick_to_edge(loc: Point, width: TmFloat, height: TmFloat) -> TmFloat {
    10.0 * loc.x * (loc.x - width) * loc.y * (loc.y - height)
}

fn stick_to_line(loc: Point, point: Point, angle: TmFloat) -> TmFloat {
    let radians = angle * DEGREES;
    (-loc.x + point.x) * radians.sin() + (loc.y - point.y) * radians.cos()
}

fn pair_fn_1a(a: Point, b: Point, angle: TmFloat) -> TmFloat {
    let radians = angle * DEGREES;
    (a.x - b.x) * radians.cos() + (a.y - b.y) * radians.sin()
}

fn pair_fn_1b(a: Point, b: Point, point: Point, angle: TmFloat) -> TmFloat {
    let radians = angle * DEGREES;
    (-a.x - b.x + 2.0 * point.x) * radians.sin() + (a.y + b.y - 2.0 * point.y) * radians.cos()
}

fn collinear_fn_1(a: Point, b: Point, c: Point) -> TmFloat {
    (b.y - a.y) * (c.x - b.x) - (c.y - b.y) * (b.x - a.x)
}

fn path_angle_fn_1(a: Point, b: Point, angle: TmFloat) -> TmFloat {
    let radians = angle * DEGREES;
    (a.x - b.x) * radians.sin() + (b.y - a.y) * radians.cos()
}

fn quantize_angle_fn_1(a: Point, b: Point, quant: usize, quant_offset: TmFloat) -> TmFloat {
    if quant == 0 {
        return TmFloat::NAN;
    }
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    let r2 = dx * dx + dy * dy;
    let f1 = r2.powf(-0.5 * quant as TmFloat);
    let offset = quant_offset * DEGREES;
    let step = 180.0 * DEGREES / quant as TmFloat;
    let mut f2 = 1.0;
    for k in 0..quant {
        let angle = k as TmFloat * step - offset;
        f2 *= dx * angle.sin() - dy * angle.cos();
    }
    2.0_f64.powi(quant as i32 - 1) * f1 * f2
}

fn fmt_float(value: TmFloat, precision: usize) -> String {
    format!("{value:.precision$}")
}

fn validate_condition_rest_len(tag: &str, got: usize) -> Result<()> {
    let expected = match tag {
        "CNxn" => 8,
        "CNfn" => 5,
        "CNkn" | "CNen" | "CNsn" | "CNfe" => 1,
        "CNpn" | "CNes" | "CNap" => 2,
        "CNcn" | "CNfp" => 3,
        "CNqp" => 4,
        "CNxp" => 7,
        _ => {
            return Err(TreeError::UnsupportedOperation(
                "unrecognized condition tags are not preserved until condition parsing is ported",
            ));
        }
    };
    if got != expected {
        return Err(TreeError::Parse {
            offset: 0,
            message: format!("condition {tag} expected {expected} rest lines, found {got}"),
        });
    }
    Ok(())
}

fn opposite_facet_color(color: i32) -> i32 {
    if color == FACET_WHITE_UP {
        FACET_COLOR_UP
    } else {
        FACET_WHITE_UP
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE_1: &str = include_str!("../testdata/tmModelTester_1.tmd5");
    const FIXTURE_2: &str = include_str!("../testdata/tmModelTester_2.tmd5");
    const FIXTURE_4: &str = include_str!("../testdata/tmModelTester_4.tmd5");
    const FIXTURE_5: &str = include_str!("../testdata/tmModelTester_5.tmd5");
    const FIXTURE_V3: &str = include_str!("../testdata/minimal_v3.tmd");
    const FIXTURE_CP_V4: &str = include_str!("../testdata/minimal_cp_v4.tmd4");
    const FIXTURE_CP_V5: &str = include_str!("../testdata/minimal_cp_v5.tmd5");

    #[test]
    fn parses_v4_fixture_summary() {
        let tree = Tree::from_tmd_str(FIXTURE_1).unwrap();
        let summary = tree.summary();
        assert_eq!(summary.source_version, "4.0");
        assert_eq!(summary.nodes, 4);
        assert_eq!(summary.edges, 3);
        assert_eq!(summary.paths, 6);
        assert_eq!(summary.leaf_nodes, 3);
        assert_eq!(summary.leaf_paths, 3);
        assert!(summary.is_feasible);
    }

    #[test]
    fn parses_larger_fixtures() {
        let tree2 = Tree::from_tmd_str(FIXTURE_2).unwrap();
        let tree5 = Tree::from_tmd_str(FIXTURE_5).unwrap();
        assert!(tree2.summary().nodes > 10);
        assert!(tree5.summary().conditions > 0);
    }

    #[test]
    fn parses_v3_and_translates_legacy_conditions() {
        let tree = Tree::from_tmd_str(FIXTURE_V3).unwrap();
        let summary = tree.summary();
        assert_eq!(summary.source_version, "3.0");
        assert_eq!(summary.nodes, 2);
        assert_eq!(summary.edges, 1);
        assert_eq!(summary.paths, 1);
        assert_eq!(summary.conditions, 3);
        assert_eq!(summary.conditioned_nodes, 2);
        assert_eq!(summary.conditioned_paths, 1);
        assert_eq!(summary.conditions_by_tag.get("CNfn"), Some(&2));
        assert_eq!(summary.conditions_by_tag.get("CNap"), Some(&1));
        assert!(summary.is_feasible);
    }

    #[test]
    fn v3_fixed_angle_preserves_501_import_behavior() {
        // Normalized first: this builds its input by string surgery against
        // hard-coded `\n`, so on a checkout with CRLF fixtures the pattern
        // matches nothing, `replacen` silently returns the text unchanged, and
        // the assertion below fails with `None` — describing a parser bug that
        // does not exist. `.gitattributes` keeps fixtures LF everywhere, and
        // this makes the test independent of that.
        let fixture = FIXTURE_V3.replace("\r\n", "\n");
        let text = fixture.replacen("false\n0.0000000000\ntrue", "true\n45.0000000000\ntrue", 1);
        assert_ne!(text, fixture, "the fixed-angle substitution did not apply");
        let tree = Tree::from_tmd_str(&text).unwrap();
        let angle = tree.conditions.iter().find_map(|condition| {
            if let ConditionKind::PathAngleFixed { angle, .. } = condition.kind {
                Some(angle)
            } else {
                None
            }
        });
        assert_eq!(angle, Some(1.0));
    }

    #[test]
    fn parses_and_round_trips_v5_crease_pattern_payload() {
        let tree = Tree::from_tmd_str(FIXTURE_CP_V5).unwrap();
        let summary = tree.summary();
        assert_eq!(summary.source_version, "5.0");
        assert_eq!(summary.polys, 1);
        assert_eq!(summary.vertices, 2);
        assert_eq!(summary.creases, 1);
        assert_eq!(summary.facets, 1);
        assert_eq!(tree.polys[0].ring_nodes, vec![1, 2]);
        assert_eq!(tree.vertices[0].owner, OwnerRef::Node(1));
        assert_eq!(tree.creases[0].owner, OwnerRef::Path(1));
        assert_eq!(tree.facets[0].owner, OwnerRef::Poly(1));

        let reparsed = Tree::from_tmd_str(&tree.to_tmd5_string()).unwrap();
        assert_eq!(reparsed.summary().polys, 1);
        assert_eq!(reparsed.summary().vertices, 2);
        assert_eq!(reparsed.summary().creases, 1);
        assert_eq!(reparsed.summary().facets, 1);
    }

    #[test]
    fn cleanup_after_optimizer_removes_stale_crease_pattern_payload() {
        let mut tree = Tree::from_tmd_str(FIXTURE_CP_V5).unwrap();
        assert_eq!(tree.summary().polys, 1);

        tree.optimize_scale().unwrap();
        let summary = tree.summary();
        assert_eq!(summary.polys, 0);
        assert_eq!(summary.vertices, 0);
        assert_eq!(summary.creases, 0);
        assert_eq!(summary.facets, 0);
        assert!(!tree.is_polygon_valid);
        assert!(!tree.is_polygon_filled);
        assert!(!tree.is_vertex_depth_valid);
        assert!(!tree.is_facet_data_valid);
    }

    #[test]
    fn consumes_and_discards_v4_crease_pattern_payload() {
        let tree = Tree::from_tmd_str(FIXTURE_CP_V4).unwrap();
        let summary = tree.summary();
        assert_eq!(summary.source_version, "4.0");
        assert_eq!(summary.nodes, 2);
        assert_eq!(summary.edges, 1);
        assert_eq!(summary.paths, 1);
        assert_eq!(summary.polys, 0);
        assert_eq!(summary.vertices, 0);
        assert_eq!(summary.creases, 0);
        assert_eq!(tree.nodes[0].owned_vertices.len(), 0);
        assert_eq!(tree.paths[0].fwd_poly, None);
        assert_eq!(tree.paths[0].owned_vertices.len(), 0);
    }

    #[test]
    fn round_trips_through_v5_writer() {
        let tree = Tree::from_tmd_str(FIXTURE_1).unwrap();
        let serialized = tree.to_tmd5_string();
        let reparsed = Tree::from_tmd_str(&serialized).unwrap();
        assert_eq!(tree.summary().nodes, reparsed.summary().nodes);
        assert_eq!(tree.summary().edges, reparsed.summary().edges);
        assert_eq!(tree.summary().paths, reparsed.summary().paths);
        assert_eq!(tree.summary().leaf_paths, reparsed.summary().leaf_paths);
    }

    #[test]
    fn scale_optimizer_uses_alm_port() {
        let mut tree = Tree::from_tmd_str(FIXTURE_1).unwrap();
        let report = tree.optimize_scale().unwrap();
        assert!(report.converged);
        assert!(tree.is_feasible());
        assert!((report.new_scale - 0.517637).abs() < 1.0e-4);
    }

    #[test]
    fn edge_optimizer_uses_alm_port() {
        let mut tree = Tree::from_tmd_str(FIXTURE_4).unwrap();
        let report = tree.optimize_edges().unwrap();
        assert!(report.converged);
        assert!(tree.is_feasible());
        let max_strain = tree
            .edges
            .iter()
            .map(|edge| edge.strain)
            .fold(TmFloat::NEG_INFINITY, TmFloat::max);
        assert!((max_strain - 0.573142).abs() < 1.0e-4);
    }

    #[test]
    fn strain_optimizer_uses_alm_port() {
        let mut tree = Tree::from_tmd_str(FIXTURE_5).unwrap();
        let report = tree.optimize_strain().unwrap();
        assert!(report.converged);
        assert!(tree.is_feasible());
        let weighted = tree
            .edges
            .iter()
            .map(|edge| edge.stiffness * edge.strain.powi(2))
            .sum::<TmFloat>()
            / tree.edges.len() as TmFloat;
        assert!((100.0 * weighted.sqrt() - 3.580266).abs() < 1.0e-4);
    }

    #[test]
    fn builds_polys_and_crease_pattern_payload() {
        let mut tree = Tree::from_tmd_str(FIXTURE_1).unwrap();
        tree.build_polys_and_crease_pattern().unwrap();
        assert!(!tree.vertices.is_empty());
        assert!(!tree.creases.is_empty());
        assert!(!tree.facets.is_empty());
    }

    #[test]
    fn exports_fold_artifacts_for_generated_crease_pattern() {
        let mut tree = triad_design();
        tree.optimize_scale().unwrap();
        tree.build_polys_and_crease_pattern().unwrap();

        let fold = tree.to_fold_document().unwrap();
        assert_eq!(fold.vertices_coords.len(), tree.vertices.len());
        assert_eq!(fold.edges_vertices.len(), tree.creases.len());
        assert_eq!(fold.faces_vertices.len(), tree.facets.len());
        for (fold_vertex, tree_vertex) in fold.vertices_coords.iter().zip(&tree.vertices) {
            assert_eq!(fold_vertex[0], tree_vertex.loc.x);
            assert_eq!(fold_vertex[1], tree.paper_height - tree_vertex.loc.y);
        }
        assert!(fold.frame_classes.contains(&"creasePattern".to_string()));
        assert!(fold.extra.contains_key("tm:creaseKinds"));

        let folded_base = tree.folded_base_snapshot().unwrap();
        assert_eq!(folded_base.vertices.len(), tree.vertices.len());
        assert_eq!(folded_base.vertices[0].loc.x, tree.vertices[0].elevation);
        assert_eq!(folded_base.vertices[0].loc.y, tree.vertices[0].depth);

        let artifacts = tree.fold_artifacts().unwrap();
        assert_eq!(artifacts.fold.edges_vertices.len(), tree.creases.len());
        assert!(artifacts.folded_base.is_some());
        assert!(artifacts.folded_base_error.is_none());
        // The simulator triangulates `fold` itself; a full CP just has to arrive
        // with faces and no unavailability reason attached.
        assert!(!artifacts.fold.faces_vertices.is_empty());
        assert!(artifacts.simulation_model_error.is_none());
    }

    #[test]
    fn fold_artifacts_keep_folded_base_when_simulation_requires_full_cp() {
        let mut tree = triad_design();
        tree.optimize_scale().unwrap();
        tree.build_polys_and_crease_pattern().unwrap();
        tree.is_facet_data_valid = false;
        tree.facets[0].is_well_formed = false;

        let artifacts = tree.fold_artifacts().unwrap();

        assert!(artifacts.folded_base.is_some());
        assert!(artifacts.folded_base_error.is_none());
        assert!(
            artifacts
                .simulation_model_error
                .as_deref()
                .unwrap()
                .contains("facets_not_valid")
        );
    }

    fn triad_design() -> Tree {
        Tree::from_design(TreeDesign {
            paper: PaperSettings {
                width: 1.0,
                height: 1.0,
                scale: 0.1,
                has_symmetry: false,
                sym_loc: Point { x: 0.5, y: 0.0 },
                sym_angle: 90.0,
            },
            nodes: vec![
                DesignNode {
                    id: 1,
                    label: "root".to_string(),
                    loc: Point { x: 0.5, y: 0.5 },
                },
                DesignNode {
                    id: 2,
                    label: "t0".to_string(),
                    loc: Point { x: 0.14, y: 0.16 },
                },
                DesignNode {
                    id: 3,
                    label: "t1".to_string(),
                    loc: Point { x: 0.86, y: 0.17 },
                },
                DesignNode {
                    id: 4,
                    label: "t2".to_string(),
                    loc: Point { x: 0.5, y: 0.88 },
                },
            ],
            edges: vec![
                DesignEdge {
                    id: 1,
                    label: "e1".to_string(),
                    nodes: [1, 2],
                    length: 1.0,
                    strain: 0.0,
                    stiffness: 1.0,
                },
                DesignEdge {
                    id: 2,
                    label: "e2".to_string(),
                    nodes: [1, 3],
                    length: 1.0,
                    strain: 0.0,
                    stiffness: 1.0,
                },
                DesignEdge {
                    id: 3,
                    label: "e3".to_string(),
                    nodes: [1, 4],
                    length: 1.0,
                    strain: 0.0,
                    stiffness: 1.0,
                },
            ],
            conditions: Vec::new(),
        })
        .unwrap()
    }

    #[test]
    fn cp_status_report_identifies_bad_parts() {
        let mut tree = Tree::from_tmd_str(FIXTURE_1).unwrap();
        tree.build_polys_and_crease_pattern().unwrap();
        let report = tree.cp_status_report();
        assert_eq!(report.status, CPStatus::PolysMultipleIbps);
        assert_eq!(report.bad_polys, vec![1]);
        assert!(report.bad_edges.is_empty());
        assert!(report.bad_vertices.is_empty());
        assert!(report.bad_creases.is_empty());
        assert!(report.bad_facets.is_empty());
    }

    #[test]
    fn editable_design_builds_paths_optimizes_and_invalidates_cp() {
        let mut tree = Tree::new_design(1.0, 1.0).unwrap();
        let root = tree
            .apply_edit(TreeEdit::AddNode {
                loc: Point { x: 0.5, y: 0.5 },
                label: Some("root".to_string()),
                connect_to: None,
                edge_length: None,
            })
            .unwrap();
        assert_eq!(root.created_node, Some(1));

        for (x, y) in [(0.18, 0.18), (0.82, 0.2), (0.5, 0.86)] {
            tree.apply_edit(TreeEdit::AddNode {
                loc: Point { x, y },
                label: None,
                connect_to: Some(1),
                edge_length: Some(1.0),
            })
            .unwrap();
        }

        let snapshot = tree.snapshot();
        assert_eq!(snapshot.summary.nodes, 4);
        assert_eq!(snapshot.summary.edges, 3);
        assert_eq!(snapshot.summary.paths, 6);
        assert_eq!(snapshot.summary.leaf_nodes, 3);
        assert_eq!(tree.to_design().edges.len(), 3);

        tree.apply_edit(TreeEdit::UpdateEdge {
            id: 1,
            label: Some("head".to_string()),
            length: Some(0.85),
            strain: None,
            stiffness: None,
        })
        .unwrap();
        assert_eq!(tree.to_design().edges[0].label, "head");
        assert_eq!(tree.to_design().edges[0].length, 0.85);

        tree.optimize_scale().unwrap();
        assert!(tree.is_feasible());
        tree.build_polys_and_crease_pattern().unwrap();
        assert!(!tree.snapshot().creases.is_empty());

        tree.apply_edit(TreeEdit::MoveNode {
            id: 2,
            loc: Point { x: 0.2, y: 0.25 },
        })
        .unwrap();
        assert_eq!(tree.snapshot().summary.creases, 0);
        assert_eq!(tree.snapshot().summary.polys, 0);
    }

    #[test]
    fn delete_design_node_renumbers_survivors_and_conditions() {
        let mut tree = triad_design();
        tree.apply_edit(TreeEdit::AddCondition {
            kind: ConditionKind::NodeFixed {
                node: 3,
                x_fixed: true,
                y_fixed: false,
                x_fix_value: 0.86,
                y_fix_value: 0.0,
            },
        })
        .unwrap();
        tree.apply_edit(TreeEdit::AddCondition {
            kind: ConditionKind::NodeFixed {
                node: 2,
                x_fixed: true,
                y_fixed: false,
                x_fix_value: 0.14,
                y_fix_value: 0.0,
            },
        })
        .unwrap();

        let report = tree.apply_edit(TreeEdit::DeleteNode { id: 2 }).unwrap();

        assert_eq!(
            report
                .snapshot
                .nodes
                .iter()
                .map(|node| (node.id, node.label.as_str()))
                .collect::<Vec<_>>(),
            vec![(1, "root"), (2, "t1"), (3, "t2")]
        );
        assert_eq!(
            report
                .snapshot
                .edges
                .iter()
                .map(|edge| (edge.id, edge.nodes.clone()))
                .collect::<Vec<_>>(),
            vec![(1, vec![1, 2]), (2, vec![1, 3])]
        );
        assert_eq!(report.snapshot.conditions.len(), 1);
        match &report.snapshot.conditions[0].kind {
            ConditionKind::NodeFixed { node, .. } => assert_eq!(*node, 2),
            other => panic!("unexpected condition kind {other:?}"),
        }

        let design = tree.to_design();
        assert_eq!(
            design.nodes.iter().map(|node| node.id).collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        assert_eq!(
            design
                .edges
                .iter()
                .map(|edge| (edge.id, edge.nodes))
                .collect::<Vec<_>>(),
            vec![(1, [1, 2]), (2, [1, 3])]
        );
    }

    #[test]
    fn core_tree_edit_commands_update_design_state() {
        let mut tree = triad_design();

        tree.apply_edit(TreeEdit::MakeRoot { node: 3 }).unwrap();
        assert_eq!(tree.nodes[0].label, "t1");

        tree.apply_edit(TreeEdit::SetEdgeLengths {
            edges: vec![1, 2],
            length: 2.0,
        })
        .unwrap();
        assert_eq!(tree.edges[0].length, 2.0);
        assert_eq!(tree.edges[1].length, 2.0);

        tree.apply_edit(TreeEdit::ScaleEdgeLengths {
            edges: vec![1],
            factor: 0.5,
        })
        .unwrap();
        assert_eq!(tree.edges[0].length, 1.0);

        tree.apply_edit(TreeEdit::UpdateEdge {
            id: 1,
            label: None,
            length: None,
            strain: Some(0.25),
            stiffness: None,
        })
        .unwrap();
        tree.apply_edit(TreeEdit::RelieveStrain { edges: vec![1] })
            .unwrap();
        assert_eq!(tree.edges[0].strain, 0.0);
        assert_eq!(tree.edges[0].length, 1.25);

        tree.apply_edit(TreeEdit::RenormalizeToEdge { edge: 1 })
            .unwrap();
        assert!((tree.edges[0].length - 1.0).abs() < 1.0e-12);

        tree.apply_edit(TreeEdit::RenormalizeToUnitScale).unwrap();
        assert!((tree.scale - 1.0).abs() < 1.0e-12);

        let before = tree.nodes[0].loc;
        tree.apply_edit(TreeEdit::PerturbNodes { nodes: vec![1] })
            .unwrap();
        assert_ne!(tree.nodes[0].loc, before);
    }

    #[test]
    fn split_edge_adds_node_and_rebuilds_paths() {
        let mut tree = triad_design();
        let report = tree
            .apply_edit(TreeEdit::SplitEdge {
                edge: 1,
                distance: 0.4,
            })
            .unwrap();

        assert_eq!(report.created_node, Some(5));
        assert_eq!(report.created_edge, Some(4));
        assert_eq!(tree.summary().nodes, 5);
        assert_eq!(tree.summary().edges, 4);
        assert_eq!(tree.summary().paths, 10);
        assert!((tree.edges[0].length - 0.4).abs() < 1.0e-12);
        assert!((tree.edges[3].length - 0.6).abs() < 1.0e-12);
    }

    #[test]
    fn absorb_node_and_edge_contract_tree_topology() {
        let mut chain = Tree::from_design(TreeDesign {
            paper: PaperSettings {
                width: 1.0,
                height: 1.0,
                scale: 0.1,
                has_symmetry: false,
                sym_loc: Point { x: 0.5, y: 0.0 },
                sym_angle: 90.0,
            },
            nodes: vec![
                DesignNode {
                    id: 1,
                    label: "a".to_string(),
                    loc: Point { x: 0.1, y: 0.5 },
                },
                DesignNode {
                    id: 2,
                    label: "b".to_string(),
                    loc: Point { x: 0.5, y: 0.5 },
                },
                DesignNode {
                    id: 3,
                    label: "c".to_string(),
                    loc: Point { x: 0.9, y: 0.5 },
                },
            ],
            edges: vec![
                DesignEdge {
                    id: 1,
                    label: "ab".to_string(),
                    nodes: [1, 2],
                    length: 1.0,
                    strain: 0.0,
                    stiffness: 1.0,
                },
                DesignEdge {
                    id: 2,
                    label: "bc".to_string(),
                    nodes: [2, 3],
                    length: 1.0,
                    strain: 0.0,
                    stiffness: 1.0,
                },
            ],
            conditions: Vec::new(),
        })
        .unwrap();

        chain
            .apply_edit(TreeEdit::AbsorbNodes { nodes: vec![2] })
            .unwrap();
        assert_eq!(chain.summary().nodes, 2);
        assert_eq!(chain.summary().edges, 1);
        assert_eq!(chain.edges[0].nodes, vec![1, 2]);
        assert_eq!(chain.edges[0].length, 2.0);

        let mut tree = triad_design();
        tree.apply_edit(TreeEdit::AbsorbEdges { edges: vec![1] })
            .unwrap();
        assert_eq!(tree.summary().nodes, 3);
        assert_eq!(tree.summary().edges, 2);
        assert!(tree.is_feasible());
    }

    #[test]
    fn stub_finder_edits_remain_explicitly_unsupported() {
        let mut tree = triad_design();
        let err = tree
            .apply_edit(TreeEdit::TriangulateTree)
            .expect_err("triangulation solver is not ported");
        assert_eq!(err.code(), "unsupported_operation");
    }

    #[test]
    fn invalid_topology_edit_rolls_back() {
        let mut tree = Tree::from_design(TreeDesign {
            paper: PaperSettings {
                width: 1.0,
                height: 1.0,
                scale: 0.1,
                has_symmetry: false,
                sym_loc: Point { x: 0.5, y: 0.0 },
                sym_angle: 90.0,
            },
            nodes: vec![
                DesignNode {
                    id: 1,
                    label: "root".to_string(),
                    loc: Point { x: 0.5, y: 0.5 },
                },
                DesignNode {
                    id: 2,
                    label: "a".to_string(),
                    loc: Point { x: 0.2, y: 0.2 },
                },
                DesignNode {
                    id: 3,
                    label: "b".to_string(),
                    loc: Point { x: 0.8, y: 0.2 },
                },
            ],
            edges: vec![
                DesignEdge {
                    id: 1,
                    label: "e1".to_string(),
                    nodes: [1, 2],
                    length: 1.0,
                    strain: 0.0,
                    stiffness: 1.0,
                },
                DesignEdge {
                    id: 2,
                    label: "e2".to_string(),
                    nodes: [1, 3],
                    length: 1.0,
                    strain: 0.0,
                    stiffness: 1.0,
                },
            ],
            conditions: Vec::new(),
        })
        .unwrap();
        let before = tree.snapshot();
        let err = tree
            .apply_edit(TreeEdit::AddEdge {
                node1: 2,
                node2: 3,
                label: None,
                length: Some(1.0),
            })
            .expect_err("cycle should be rejected");
        assert_eq!(err.code(), "invalid_operation");
        assert_eq!(tree.snapshot(), before);
    }
}

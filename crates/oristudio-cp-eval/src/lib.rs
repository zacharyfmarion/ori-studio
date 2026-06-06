//! Evaluation metrics for crease-pattern detection and compiler output.
//!
//! The crate is product-side and Rust/WASM-friendly. It deliberately does not
//! depend on Python training code, so benchmark results reflect the pipeline
//! that ships in Ori Studio.

mod graph;
mod strict_topology;

pub use graph::{EvalAssignment, EvalBoundaryRole, EvalEdge, EvalGraph, EvalGraphError, EvalPoint};
pub use strict_topology::{
    AssignmentMismatchDiagnostic, EdgeDiagnostic, EdgeMatchMetrics, MergedEdgeDiagnostic,
    SplitEdgeDiagnostic, StrictTopologyAggregate, StrictTopologyMetrics, StrictTopologyOptions,
    VertexMatchMetrics, strict_topology_metrics,
};

//! Evaluation metrics for crease-pattern detection and compiler output.
//!
//! The crate is product-side and Rust/WASM-friendly. It deliberately does not
//! depend on Python training code, so benchmark results reflect the pipeline
//! that ships in Ori Studio.

mod candidate_coverage;
mod graph;
mod strict_topology;

pub use candidate_coverage::{
    CandidateCoverageAggregate, CandidateCoverageOptions, CandidateCoverageReport,
    CandidateCoverageSummary, CoverageCandidate, CoverageCandidateSet, CoverageCarrier,
    CoverageDenseEvidence, CoverageEdgeMatch, CoverageEndpointAvailability, CoverageRootCause,
    GtEdgeCoverageRecord, candidate_coverage_metrics,
};
pub use graph::{EvalAssignment, EvalBoundaryRole, EvalEdge, EvalGraph, EvalGraphError, EvalPoint};
pub use strict_topology::{
    AssignmentMismatchDiagnostic, EdgeDiagnostic, EdgeMatchMetrics, MergedEdgeDiagnostic,
    SplitEdgeDiagnostic, StrictTopologyAggregate, StrictTopologyMetrics, StrictTopologyOptions,
    VertexMatchMetrics, strict_topology_metrics,
};

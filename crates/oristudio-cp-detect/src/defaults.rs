//! Canonical default decode sources for the CP-detect pipeline.
//!
//! Single source of truth so the benchmark bins, the stage inspector, the wasm
//! bindings, and the browser TypeScript constants cannot silently diverge.
//! Divergence here is not hypothetical: the `compare_exact_solve_benchmark`
//! defaults used to be a *weaker* path than production (`legacy` candidate
//! source + `model` line evidence), so a bare benchmark run measured a
//! different pipeline than the shipped product and produced misleading
//! "baseline" numbers.
//!
//! Consumers must read these constants instead of hardcoding string literals.

use crate::candidate_generation::JUNCTION_FIRST_V1_STRATEGY_ID;

/// Product candidate-graph strategy. In the browser this is the `dense-model`
/// junction source; in the benchmark/inspector it is the `--candidate-source`
/// value. (The `legacy` source is retained as an explicit, opt-in historical
/// baseline, but must never be the default.)
pub const DEFAULT_CANDIDATE_SOURCE: &str = JUNCTION_FIRST_V1_STRATEGY_ID;

/// Browser junction-source label. Maps to the dense-head + junction-first path
/// (the V3 vertex refiner is deprecated).
pub const DEFAULT_JUNCTION_SOURCE: &str = "dense-model";

/// Line-evidence source used by the product decode.
pub const DEFAULT_LINE_EVIDENCE_SOURCE: &str = "source-image";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_candidate_source_is_never_legacy() {
        // The legacy path is a weaker historical baseline; guard against it
        // silently becoming the default again.
        assert_ne!(DEFAULT_CANDIDATE_SOURCE, "legacy");
        assert_eq!(DEFAULT_CANDIDATE_SOURCE, JUNCTION_FIRST_V1_STRATEGY_ID);
    }

    #[test]
    fn default_line_evidence_matches_product() {
        assert_eq!(DEFAULT_LINE_EVIDENCE_SOURCE, "source-image");
    }
}

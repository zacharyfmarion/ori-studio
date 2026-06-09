use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceSource {
    ObservedStrong,
    ObservedWeak,
    Inferred,
    Border,
    Legacy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Provenance {
    ObservedStrong,
    ObservedWeak,
    InferredByKawasaki,
    InferredByEvenDegree,
    InferredByBoundaryContact,
    DeletedLowSupport,
    AssignmentObserved,
    AssignmentFlipped,
    AssignmentInferred,
    AssignmentAmbiguous,
    CarrierReconciled,
    LegacyDecoder,
    BorderPrior,
}

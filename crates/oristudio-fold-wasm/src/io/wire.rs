//! What Import CP, Send to Edit and the FOLD export put across the bridge,
//! in the conventions of [`crate::wire`]: inputs spelled as the document and
//! the tools spell them (camelCase), outputs as the engine's serde types
//! (snake_case) in the `status` envelope, refusals as values with a stable
//! `code` and no sentence, and only a caller's mistake thrown.
//!
//! The one document shape here is the `cp-jump` op ([`CpJump`]), which a
//! pick returns ready to store and every replay hands back unchanged.

use oristudio_fold::complete::{BudgetLimit, CheckLimits, CompletionLimits, ConstraintFamily};
use oristudio_fold::{
    Broken, CheckStage, ChoiceCount, FaceId, ImportRefusal, ImportSummary, SheetShape, StartSide,
};
use serde::ser::Error as _;
use serde::{Deserialize, Serialize, Serializer};
use serde_json::{Value, json};
use thiserror::Error;

use crate::wire::{BridgeError, BridgeRefusal, Refusal, Summary};

// ---------------------------------------------------------------------------
// Inputs

/// The formats the kernel's loaders read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CpFormat {
    Cp,
    Fold,
    Ori,
    Orh,
}

/// Where an imported crease pattern came from (the document's
/// `FoldCpOrigin`): a closed enum, never a file name (plan D16, D18).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CpOrigin {
    Cp,
    Fold,
    Ori,
    Orh,
    /// One of the samples that ship with Fold (`tests/fixtures/fold-samples`).
    Sample,
    EditFoldedFigure,
    ProjectCp,
}

impl From<CpFormat> for CpOrigin {
    fn from(format: CpFormat) -> CpOrigin {
        match format {
            CpFormat::Cp => CpOrigin::Cp,
            CpFormat::Fold => CpOrigin::Fold,
            CpFormat::Ori => CpOrigin::Ori,
            CpFormat::Orh => CpOrigin::Orh,
        }
    }
}

/// What a file to import is: its format, and whether it is one of the
/// samples that ship with Fold, which its step records as its origin
/// instead of the format.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub struct CpFile {
    pub format: CpFormat,
    #[serde(default)]
    pub sample: bool,
}

impl CpFile {
    pub fn of(format: CpFormat) -> CpFile {
        CpFile {
            format,
            sample: false,
        }
    }

    /// The origin its step stores.
    pub fn origin(&self) -> CpOrigin {
        if self.sample {
            CpOrigin::Sample
        } else {
            self.format.into()
        }
    }
}

/// Import CP's step (`FoldCpJumpOp` without its `kind`): see [`crate::io`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CpJump {
    /// The crease pattern, as the kernel's FOLD writer writes it
    /// ([`crate::io::kernel::cp_json`]).
    pub cp_json: String,
    /// The order, as a [`oristudio_fold::WitnessOrder`].
    pub order_json: String,
    pub origin: CpOrigin,
}

/// Where an import lands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Target {
    /// A sequence with no steps. It adopts the pattern's square or rectangle
    /// ([`Opened::paper`]), seen from `startSide` as its flat sheet would be;
    /// the caller sets the sequence's paper to it before the step is stored.
    Empty {
        #[serde(default, rename = "startSide")]
        start_side: StartSide,
    },
    /// After the state this handle names, which must fit the pattern's sheet
    /// and must still be held when an order is picked. The view is kept and
    /// the root continues (plan D16).
    After { state: u32 },
}

/// What a completion may spend: at most `perComponent` orders listed per
/// independent component (at least one), and `maxNodes` search nodes in all.
/// Each defaults to the engine's interactive bound
/// ([`CompletionLimits::default`]); a search that needs more is refused as
/// `import_budget_exceeded`, and may be asked again with more.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Limits {
    #[serde(default)]
    pub per_component: Option<usize>,
    #[serde(default)]
    pub max_nodes: Option<u64>,
}

impl Limits {
    pub fn completion(&self) -> CompletionLimits {
        let defaults = CompletionLimits::default();
        CompletionLimits {
            per_component: self
                .per_component
                .map_or(defaults.per_component, |n| n.max(1)),
            max_nodes: self.max_nodes.or(defaults.max_nodes),
            deadline: None,
        }
    }
}

// ---------------------------------------------------------------------------
// Outputs

/// "Import starting sheet"'s answer: the sheet a crease pattern's border
/// outlines, as a sequence's paper names it — a square, a rectangle, or a
/// polygon counter-clockwise in the unit sheet frame.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SheetFound {
    pub sheet: SheetShape,
}

/// A crease pattern imported and its orders completed, held until an order
/// is picked ([`crate::io::Imports::pick`]).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Opened {
    /// The handle that names the import in `import_pick`.
    pub import: u32,
    pub summary: ImportSummary,
    /// For an empty target, the shape the sequence adopts, as the document
    /// stores it; none after a state, whose sheet the pattern fits.
    pub paper: Option<AdoptedPaper>,
    /// The true ‹ n of m ›: every order the letters allow, when `exact`.
    pub count: ChoiceCount,
    /// Per independent component, how many orders it lists. A choice picks
    /// one index below each; the first order of each is the default.
    pub components: Vec<ComponentCount>,
    /// Search nodes the completion used.
    pub nodes: u64,
}

#[derive(Debug, Serialize)]
pub struct Searched {
    pub opened: Opened,
    pub choice: Vec<usize>,
}

/// What a check on a held import may spend: `maxNodes` search nodes for
/// the exhaustive search a fresh completion would run, `fastNodes` for each
/// of the two quick searches before it. Each defaults to the engine's
/// ([`CheckLimits::default`]). A check that needs more answers `undecided`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckWireLimits {
    #[serde(default)]
    pub max_nodes: Option<u64>,
    #[serde(default)]
    pub fast_nodes: Option<u64>,
}

impl CheckWireLimits {
    pub fn check(&self) -> CheckLimits {
        let defaults = CheckLimits::default();
        CheckLimits {
            max_nodes: self.max_nodes.or(defaults.max_nodes),
            fast_nodes: self.fast_nodes.unwrap_or(defaults.fast_nodes),
            deadline: None,
        }
    }
}

/// A held import's checking session, opened: how many pairs its letters
/// force, and the search nodes its first order took. That order is the one
/// shown, which the next check prefers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SessionOpened {
    pub import: u32,
    pub forced: usize,
    pub nodes: u64,
}

/// A check's answer. Every verdict but `undecided` is final.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "verdict", rename_all = "snake_case")]
pub enum Checked {
    /// An order fits; it is now the order shown. `changed` is how many pairs
    /// differ from the order shown before, `forced` how many pairs the
    /// letters and the checked pairs force.
    Fits {
        nodes: u64,
        stage: CheckStage,
        changed: usize,
        forced: usize,
    },
    /// A checked pair, `[upper, lower]`, is forced the other way; `traced`
    /// is what forces it.
    Forced {
        pair: [FaceId; 2],
        traced: Vec<FaceId>,
    },
    /// Two checked pairs order the same faces both ways.
    Contradictory { pair: [FaceId; 2] },
    /// The checked pairs break a constraint as they propagate.
    Conflict {
        family: ConstraintFamily,
        faces: Vec<FaceId>,
        traced: Vec<FaceId>,
    },
    /// A search proved that no order fits.
    NoOrder {
        faces: Vec<FaceId>,
        traced: Vec<FaceId>,
        nodes: u64,
    },
    /// No answer within the limits.
    Undecided { limit: BudgetLimit, nodes: u64 },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ComponentCount {
    /// Local face pairs decided by this independent region.
    pub pairs: Vec<[oristudio_fold::FaceId; 2]>,
    pub orders: usize,
    /// More orders exist than are listed.
    pub truncated: bool,
}

/// `FoldPaperShape` for the square and rectangle sheets an import adopts.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AdoptedPaper {
    Square,
    Rectangle { aspect: [f64; 2] },
}

impl AdoptedPaper {
    /// The document's spelling of a sheet an import recovered: only ever a
    /// square or a rectangle (V0).
    pub fn of(shape: &SheetShape) -> Option<AdoptedPaper> {
        match shape {
            SheetShape::Square => Some(AdoptedPaper::Square),
            SheetShape::Rectangle { width, height } => Some(AdoptedPaper::Rectangle {
                aspect: [*width, *height],
            }),
            SheetShape::Regular { .. } | SheetShape::Polygon { .. } => None,
        }
    }

    /// The bridge's input spelling of the same shape.
    pub fn paper_shape(&self) -> crate::wire::PaperShape {
        match *self {
            AdoptedPaper::Square => crate::wire::PaperShape::Square,
            AdoptedPaper::Rectangle { aspect } => crate::wire::PaperShape::Rectangle { aspect },
        }
    }
}

/// A `cp-jump` op as the document stores it: `{ kind: 'cp-jump', … }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind")]
pub enum JumpOp {
    #[serde(rename = "cp-jump")]
    CpJump(CpJump),
}

/// An import landed: the state, held like any step's, and the op that lands
/// it, to store as the step.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Landed {
    pub state: u32,
    pub summary: Summary,
    pub op: JumpOp,
}

/// A FOLD file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Exported {
    pub text: String,
}

// ---------------------------------------------------------------------------
// Refusals

/// Which stored field of a `cp-jump` no longer reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StoredField {
    CpJson,
    OrderJson,
}

/// What Edit's folded figure lacks for an import.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case", tag = "gap")]
pub enum FigureGap {
    /// No faces: nothing was folded.
    Faces,
    /// A scene older than schema 3, which does not say where the faces lie
    /// on the sheet.
    SheetPoints,
    /// A face whose ring the kernel could not name, or names a point it does
    /// not have.
    FaceRing { face: usize },
    /// A stack names a face the scene does not have.
    Stack { subface: usize },
}

/// Everything Import CP and the FOLD export refuse. Serialized flat, tagged
/// by `code`, with every nested `message` (a diagnostic sentence from the
/// engine's layers below) left out: the UI words a refusal from its code.
#[derive(Debug, Clone, PartialEq, Error)]
pub enum IoRefusal {
    /// The engine's own (`import_*`): the sheet, the faces, flat-foldability
    /// and the completion. Points are in the input's coordinates.
    #[error(transparent)]
    Import(ImportRefusal),
    #[error("the kernel cannot read this {format:?} file")]
    Unreadable { format: CpFormat },
    #[error("the FOLD file describes a folded form, not a crease pattern")]
    FoldedForm,
    #[error("the step's stored {field:?} no longer reads")]
    StoredUnreadable { field: StoredField },
    /// The stored order no longer resolves: its witnesses name no faces, or
    /// it conflicts with the pattern, or it no longer decides one order.
    #[error("the step's stored order no longer resolves: {broken}")]
    OrderBroken { broken: Broken },
    #[error("Edit's folded figure lacks {gap:?}")]
    FigureIncomplete { gap: FigureGap },
    #[error("the FOLD file would hold {elements} elements, over the {cap} cap")]
    ExportTooLarge { elements: usize, cap: usize },
}

impl IoRefusal {
    /// The stable snake_case code.
    pub fn code(&self) -> &'static str {
        match self {
            IoRefusal::Import(refusal) => refusal.code(),
            IoRefusal::Unreadable { .. } => "import_unreadable",
            IoRefusal::FoldedForm => "import_folded_form",
            IoRefusal::StoredUnreadable { .. } => "import_stored_unreadable",
            IoRefusal::OrderBroken { .. } => "import_order_broken",
            IoRefusal::FigureIncomplete { .. } => "import_figure_incomplete",
            IoRefusal::ExportTooLarge { .. } => "fold_export_too_large",
        }
    }

    fn to_value(&self) -> serde_json::Result<Value> {
        let code = self.code();
        Ok(match self {
            IoRefusal::Import(refusal) => serde_json::to_value(refusal)?,
            IoRefusal::Unreadable { format } => json!({ "code": code, "format": format }),
            IoRefusal::FoldedForm => json!({ "code": code }),
            IoRefusal::StoredUnreadable { field } => json!({ "code": code, "field": field }),
            IoRefusal::OrderBroken { broken } => json!({ "code": code, "broken": broken }),
            IoRefusal::FigureIncomplete { gap } => {
                let mut value = serde_json::to_value(gap)?;
                if let Value::Object(fields) = &mut value {
                    fields.insert("code".to_string(), json!(code));
                }
                value
            }
            IoRefusal::ExportTooLarge { elements, cap } => {
                json!({ "code": code, "elements": elements, "cap": cap })
            }
        })
    }
}

impl Serialize for IoRefusal {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut value = self.to_value().map_err(S::Error::custom)?;
        drop_sentences(&mut value);
        value.serialize(serializer)
    }
}

/// Every `message` field, at any depth: the engine's diagnostic sentences
/// (a folded image's, a defect's), which never cross the bridge.
fn drop_sentences(value: &mut Value) {
    match value {
        Value::Object(fields) => {
            fields.remove("message");
            fields.values_mut().for_each(drop_sentences);
        }
        Value::Array(items) => items.iter_mut().for_each(drop_sentences),
        _ => {}
    }
}

impl From<ImportRefusal> for IoRefusal {
    fn from(refusal: ImportRefusal) -> IoRefusal {
        IoRefusal::Import(refusal)
    }
}

impl From<IoRefusal> for Refusal {
    fn from(refusal: IoRefusal) -> Refusal {
        BridgeRefusal::Io(refusal).into()
    }
}

/// What an io call throws, as `{ code, message }` like [`BridgeError`]: a
/// caller's mistake, or a defect that is no one's input.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum IoCallError {
    #[error(transparent)]
    Bridge(#[from] BridgeError),
    #[error("no import {0}: it was released, or never made by this engine")]
    UnknownImport(u32),
    /// The kernel's writer failed on a state the engine made.
    #[error("{message}")]
    Defect { code: &'static str, message: String },
}

impl IoCallError {
    pub fn code(&self) -> &'static str {
        match self {
            IoCallError::Bridge(error) => error.code(),
            IoCallError::UnknownImport(_) => "unknown_import",
            IoCallError::Defect { code, .. } => code,
        }
    }

    pub(crate) fn invalid(message: impl Into<String>) -> IoCallError {
        IoCallError::Bridge(BridgeError::InvalidInput(message.into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oristudio_fold::complete::BudgetLimit;

    #[test]
    fn refusals_are_flat_codes_without_sentences() {
        let internal = IoRefusal::Import(ImportRefusal::Internal {
            message: "a defect".to_string(),
        });
        assert_eq!(
            serde_json::to_value(&internal).unwrap_or_default(),
            json!({ "code": "import_internal" })
        );
        let budget = IoRefusal::from(ImportRefusal::BudgetExceeded {
            limit: BudgetLimit::Nodes,
            nodes: 7,
        });
        assert_eq!(
            serde_json::to_value(&budget).unwrap_or_default(),
            json!({ "code": "import_budget_exceeded", "limit": "nodes", "nodes": 7 })
        );
        let gap = IoRefusal::FigureIncomplete {
            gap: FigureGap::FaceRing { face: 3 },
        };
        assert_eq!(
            serde_json::to_value(&gap).unwrap_or_default(),
            json!({ "code": "import_figure_incomplete", "gap": "face_ring", "face": 3 })
        );
        for refusal in [
            IoRefusal::Unreadable {
                format: CpFormat::Orh,
            },
            IoRefusal::FoldedForm,
            IoRefusal::StoredUnreadable {
                field: StoredField::OrderJson,
            },
            IoRefusal::ExportTooLarge {
                elements: 9,
                cap: 8,
            },
        ] {
            let value = serde_json::to_value(&refusal).unwrap_or_default();
            assert_eq!(value["code"], refusal.code(), "{value}");
        }
    }

    #[test]
    fn limits_default_to_the_engines_and_list_at_least_one_order() {
        let defaults = CompletionLimits::default();
        let none = Limits::default().completion();
        assert_eq!(none.per_component, defaults.per_component);
        assert_eq!(none.max_nodes, defaults.max_nodes);
        let zero: Limits =
            serde_json::from_value(json!({ "perComponent": 0, "maxNodes": 5 })).unwrap_or_default();
        assert_eq!(zero.completion().per_component, 1);
        assert_eq!(zero.completion().max_nodes, Some(5));
    }

    #[test]
    fn the_op_is_spelled_as_the_document_stores_it() {
        let op = JumpOp::CpJump(CpJump {
            cp_json: "{}".to_string(),
            order_json: "[]".to_string(),
            origin: CpOrigin::EditFoldedFigure,
        });
        assert_eq!(
            serde_json::to_value(&op).unwrap_or_default(),
            json!({
                "kind": "cp-jump", "cpJson": "{}", "orderJson": "[]",
                "origin": "edit_folded_figure"
            })
        );
        let target: Target = serde_json::from_value(json!({ "kind": "empty" }))
            .unwrap_or(Target::After { state: 0 });
        assert_eq!(
            target,
            Target::Empty {
                start_side: StartSide::Front
            }
        );
    }
}

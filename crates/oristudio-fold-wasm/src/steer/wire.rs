//! What the Layer order dialog's calls put across the bridge, in the
//! conventions of [`crate::wire`]: inputs spelled as the web app spells them
//! (camelCase), outputs as the engine's serde types (snake_case), refusals as
//! values with a stable `code` and no sentence, and only a caller's mistake
//! thrown.
//!
//! Everything here is plain Rust, so `tests/layer_session.rs` reads exactly
//! what crosses, natively. Large data is a flat list of numbers, which
//! [`super::bindings`] hands over as a typed array: face pairs as
//! `[a, b, a, b, …]`, constraints as `[subject, object, sign, …]`, stacks as
//! offsets and faces, statuses as one byte each.

use oristudio_cp::folding::HierarchyRelation;
use oristudio_cp::session::{FoldSource, relations_from_flat_pairs};
use oristudio_fold::complete::{BudgetLimit, Deadline};
use oristudio_fold::steer::{
    CarriedConstraint, ChangedSpots, Clash, Constraint, ConstraintFault, ConstraintStatus,
    Explanation, FaceStatus, FoldSign, Limits, OpenedOn, Position, RecordDamage, RecordFace,
    RestoreOutcome, SavedPairStatus, SessionRefusal, SolutionCaps, SourceRefusal, Stacks, StepBy,
    StepDirection, TimedOut, ViewSide,
};
use oristudio_fold::{CheckStage, FaceId};
use oristudio_layer_order::FacePair;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thiserror::Error;

// ---------------------------------------------------------------------------
// Inputs

/// What one call that searches may spend (the open, a preview, a commit, a
/// restore). Every field may be left out.
///
/// The deadline is **relative**: `deadlineMs` milliseconds after the call
/// starts, measured inside the wasm by the worker's own clock
/// (`performance.now()`), so the page's clock and the worker's never need to
/// agree. It is read before each search node and every few propagated pairs;
/// building a source (the CP kernel's arrangement of the creases) runs to its
/// end before the first read. **"Keep trying" is the same call again with a
/// larger `deadlineMs`** (or more `maxNodes`): a call that timed out changed
/// nothing, so nothing else needs undoing first.
#[derive(Debug, Clone, Copy, PartialEq, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LayerLimits {
    /// Search nodes for the open's first order and for a check's exhaustive
    /// search. Left out, the engine's default (200,000).
    #[serde(default)]
    pub max_nodes: Option<u64>,
    /// Nodes for each of a check's quick attempts, the ones steered by the
    /// order on screen. Left out, the engine's default (128).
    #[serde(default)]
    pub fast_nodes: Option<u64>,
    /// Milliseconds from the call's start; left out, no deadline (the node
    /// budget alone bounds the call).
    #[serde(default)]
    pub deadline_ms: Option<f64>,
}

/// [`LayerLimits`]' fields as the web app spells them. Any other field is the
/// caller's mistake (`invalid_input`), checked at the boundary because
/// `serde-wasm-bindgen` reads only the fields a struct names.
pub const LAYER_LIMITS_FIELDS: [&str; 3] = ["maxNodes", "fastNodes", "deadlineMs"];

impl LayerLimits {
    /// The engine's limits, the deadline `deadline_ms` after `now_ms()` now.
    pub fn limits(&self, now_ms: fn() -> f64) -> Result<Limits, LayerCallError> {
        let defaults = Limits::default();
        let deadline = match self.deadline_ms {
            None => None,
            Some(ms) if ms.is_finite() && ms >= 0.0 => Some(Deadline {
                now_ms,
                at_ms: now_ms() + ms,
            }),
            Some(ms) => {
                return Err(LayerCallError::invalid(format!(
                    "limits: deadlineMs {ms} is not a finite number of at least 0"
                )));
            }
        };
        Ok(Limits {
            max_nodes: self.max_nodes.or(defaults.max_nodes),
            fast_nodes: self.fast_nodes.unwrap_or(defaults.fast_nodes),
            deadline,
        })
    }
}

/// A host's fold, exactly as the CP kernel's bridge hands it over
/// (`folded_figure_source`, `fold_source_of_selection`): `{ segments,
/// starting_face_id, aux_segments, digest }`, the shape the CP bridge's
/// `folded_figure_fold_with_order` takes back at Apply. The host passes the
/// CP bridge's value through unchanged.
pub type LayerFoldSource = FoldSource;

/// Constraints as they cross: `[subject, object, sign, …]`, three numbers
/// each, faces by the source's index, `sign` FOLD's (`1` when the subject
/// lies on the object's front side, `-1` on its back), as the saved record
/// writes them. A list that is not triples, a negative face, or a sign that
/// is not ±1 is the caller's mistake.
pub fn constraints_of(triples: &[i32]) -> Result<Vec<Constraint>, LayerCallError> {
    if !triples.len().is_multiple_of(3) {
        return Err(LayerCallError::invalid(format!(
            "constraints: {} numbers are not [subject, object, sign] triples",
            triples.len()
        )));
    }
    triples
        .chunks_exact(3)
        .enumerate()
        .map(|(index, triple)| {
            let face = |value: i32| {
                u32::try_from(value).map(FaceId).map_err(|_| {
                    LayerCallError::invalid(format!("constraint {index}: face {value} is negative"))
                })
            };
            let sign = i8::try_from(triple[2])
                .ok()
                .and_then(FoldSign::of_value)
                .ok_or_else(|| {
                    LayerCallError::invalid(format!(
                        "constraint {index}: sign {} is not 1 or -1",
                        triple[2]
                    ))
                })?;
            Ok(Constraint {
                subject: face(triple[0])?,
                object: face(triple[1])?,
                sign,
            })
        })
        .collect()
}

/// One constraint, a candidate: exactly one triple.
pub fn candidate_of(triple: &[i32]) -> Result<Constraint, LayerCallError> {
    match constraints_of(triple)?.as_slice() {
        [candidate] => Ok(*candidate),
        _ => Err(LayerCallError::invalid(format!(
            "candidate: {} numbers are not one [subject, object, sign]",
            triple.len()
        ))),
    }
}

/// Constraints as [`constraints_of`] reads them.
pub fn triples_of(constraints: &[Constraint]) -> Vec<i32> {
    constraints
        .iter()
        .flat_map(|c| {
            [
                face_number(c.subject),
                face_number(c.object),
                i32::from(c.sign.value()),
            ]
        })
        .collect()
}

/// A face as a signed number: below the face cap, so it always fits.
fn face_number(face: FaceId) -> i32 {
    i32::try_from(face.0).unwrap_or(i32::MAX)
}

/// The order a host shows, as Oriedita's relations: `[upper, lower, …]`,
/// each `upper` nearer a viewer of the starting face's front, the shape
/// `layer_oriedita_relations` answers and the CP bridge's
/// `folded_figure_fold_with_order` takes, read by the CP kernel's own
/// reader. An odd length is the caller's mistake; a pair naming no
/// overlapping faces is not, and the open counts it as ignored.
pub fn relations_of(flat: &[u32]) -> Result<Vec<HierarchyRelation>, LayerCallError> {
    relations_from_flat_pairs(flat)
        .map_err(|error| LayerCallError::invalid(format!("relations: {}", error.message)))
}

/// How far a solution count goes before it reads "at least" (E6's
/// `SolutionCaps`), and whether a step counts on (E9). Every field may be
/// left out, for the defaults (100,000 orders per component, 1,000,000
/// combinations per look group, 4 MiB of stored orders, steps that count);
/// every cap is a count, never a time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LayerSolutionCaps {
    #[serde(default)]
    pub orders_per_component: Option<u64>,
    #[serde(default)]
    pub combinations_per_group: Option<u64>,
    #[serde(default)]
    pub stored_bits: Option<u64>,
    #[serde(default)]
    pub count_in_steps: Option<bool>,
}

/// [`LayerSolutionCaps`]' fields as the web app spells them.
pub const LAYER_SOLUTION_CAPS_FIELDS: [&str; 4] = [
    "ordersPerComponent",
    "combinationsPerGroup",
    "storedBits",
    "countInSteps",
];

impl LayerSolutionCaps {
    pub fn caps(&self) -> SolutionCaps {
        let defaults = SolutionCaps::default();
        SolutionCaps {
            orders_per_component: self
                .orders_per_component
                .unwrap_or(defaults.orders_per_component),
            combinations_per_group: self
                .combinations_per_group
                .unwrap_or(defaults.combinations_per_group),
            stored_bits: self.stored_bits.unwrap_or(defaults.stored_bits),
            count_in_steps: self.count_in_steps.unwrap_or(defaults.count_in_steps),
        }
    }
}

/// What the stepper steps through, as the web app spells it:
/// `{ picture: 'front' | 'back' }` (distinct pictures from a side, X-ray
/// off) or `'layer_order'` (every layer order, X-ray on, decision D5).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(untagged)]
pub enum LayerStepBy {
    Word(String),
    Picture { picture: String },
}

impl LayerStepBy {
    pub fn step_by(&self) -> Result<StepBy, LayerCallError> {
        match self {
            LayerStepBy::Word(word) if word == "layer_order" => Ok(StepBy::LayerOrder),
            LayerStepBy::Picture { picture } => side_of(picture).map(StepBy::Picture),
            LayerStepBy::Word(other) => Err(LayerCallError::invalid(format!(
                "by: {other:?} is not 'layer_order' or {{ picture: side }}"
            ))),
        }
    }
}

/// `"next"` or `"previous"`.
pub fn direction_of(word: &str) -> Result<StepDirection, LayerCallError> {
    match word {
        "next" => Ok(StepDirection::Next),
        "previous" => Ok(StepDirection::Previous),
        other => Err(LayerCallError::invalid(format!(
            "direction: {other:?} is not \"next\" or \"previous\""
        ))),
    }
}

/// `"front"` or `"back"`: the side the folded paper is seen from.
pub fn side_of(word: &str) -> Result<ViewSide, LayerCallError> {
    match word {
        "front" => Ok(ViewSide::Front),
        "back" => Ok(ViewSide::Back),
        other => Err(LayerCallError::invalid(format!(
            "side: {other:?} is not \"front\" or \"back\""
        ))),
    }
}

// ---------------------------------------------------------------------------
// Outputs

/// Face pairs as one flat list, `[a, b, a, b, …]`, in the order given.
pub fn flat_pairs(pairs: &[FacePair]) -> Vec<u32> {
    pairs.iter().flat_map(|p| [p.lo().0, p.hi().0]).collect()
}

/// The stack on every spot (the paper scene's subfaces, in its order), top
/// first from the side asked: spot `i`'s faces are
/// `faces[offsets[i]..offsets[i + 1]]`. The back's are the front's reversed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PackedStacks {
    pub offsets: Vec<u32>,
    pub faces: Vec<u32>,
}

impl From<&Stacks> for PackedStacks {
    fn from(stacks: &Stacks) -> PackedStacks {
        PackedStacks {
            offsets: stacks.offsets().to_vec(),
            faces: stacks.faces().to_vec(),
        }
    }
}

/// One value per side.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Sides<T> {
    pub front: T,
    pub back: T,
}

/// What an open (or the open under a restore) reports about the session it
/// holds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LayerOpened {
    /// The handle the other `layer_*` calls take.
    pub session: u32,
    /// How many faces: face *k* is the host's face *k*.
    pub faces: u32,
    /// Per face, 1 when it shows its front from the front side (the
    /// starting face's parity), else 0: what turns a sentence into a sign
    /// (`sign = 1` exactly when "the subject is nearer a viewer of the
    /// front" equals the object's `front_up`).
    pub front_up: Vec<u8>,
    /// The pairs deduction leaves open, flat, each smaller face first,
    /// ascending: the subjects the user can pick, and each one's objects.
    pub open_pairs: Vec<u32>,
    /// How many spots the stacks list (the paper scene's subfaces).
    pub spots: u32,
    /// Where the order on screen came from.
    pub opened_on: OpenedOnWire,
}

/// Where the order a session shows at open, or after its last restore, came
/// from (`OpenedOn`, tagged by `kind`). Commits do not change it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OpenedOnWire {
    /// The solver's first order: what `layer_open` shows, and what is left
    /// when holding an order and the search toward it both ran out
    /// (`timed_out`, else null).
    First { timed_out: Option<TimedOut> },
    /// The order given, held whole: the host's relations, or the saved
    /// pairs that still resolve. `ignored` relations named no overlapping
    /// pair, or both orders of one.
    Held { ignored: usize },
    /// The order given does not all fit: the fitting order closest to it,
    /// with `moved` of its relations the other way. `inside` (else null) is a
    /// face the order given put inside a fold at a crease through it.
    Closest {
        moved: usize,
        ignored: usize,
        inside: Option<FoldInsideWire>,
    },
}

/// A face an order put inside a fold it can't be in (`FoldInside`): `face`
/// between `crease`'s two faces, the crease running through it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct FoldInsideWire {
    pub face: u32,
    pub crease: [u32; 2],
}

impl From<&OpenedOn> for OpenedOnWire {
    fn from(opened_on: &OpenedOn) -> OpenedOnWire {
        match *opened_on {
            OpenedOn::First { timed_out } => OpenedOnWire::First { timed_out },
            OpenedOn::Held { ignored } => OpenedOnWire::Held { ignored },
            OpenedOn::Closest {
                moved,
                ignored,
                inside,
            } => OpenedOnWire::Closest {
                moved,
                ignored,
                inside: inside.map(|inside| FoldInsideWire {
                    face: inside.face.0,
                    crease: [inside.crease[0].0, inside.crease[1].0],
                }),
            },
        }
    }
}

/// An open's answer.
#[derive(Debug, Clone, PartialEq)]
pub enum Opening {
    Opened(LayerOpened),
    Refused(LayerRefusal),
}

/// A restore's answer.
#[derive(Debug, Clone, PartialEq)]
pub enum Restoring {
    Restored(Box<LayerRestored>),
    Refused(LayerRefusal),
}

/// [`SavedFaces::status`]: the saved face's point lies in one face of the
/// saved area.
pub const FACE_INTACT: u8 = 0;
/// That face's area differs: the saved face was split or merged.
pub const FACE_AMBIGUOUS: u8 = 1;
/// The point lies on a crease or off the paper.
pub const FACE_GONE: u8 = 2;

/// [`LayerRestored::order_status`]: the order shown keeps the saved pair.
pub const PAIR_KEPT: u8 = 0;
/// The order shown has the pair the other way.
pub const PAIR_MOVED: u8 = 1;
/// The pair no longer resolves.
pub const PAIR_UNRESOLVED: u8 = 2;

/// Each of a record's faces, found again: three lists in the record's face
/// order.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SavedFaces {
    /// [`FACE_INTACT`], [`FACE_AMBIGUOUS`] or [`FACE_GONE`].
    pub status: Vec<u8>,
    /// The face its point lies in now; -1 when gone.
    pub face: Vec<i32>,
    /// That face's paper area now (crease-pattern units squared); NaN when
    /// gone.
    pub area: Vec<f64>,
}

impl SavedFaces {
    pub(crate) fn of(faces: &[FaceStatus]) -> SavedFaces {
        let mut saved = SavedFaces::default();
        for status in faces {
            let (code, face, area) = match *status {
                FaceStatus::Intact { face } => (FACE_INTACT, face_number(face), f64::NAN),
                FaceStatus::Ambiguous { face, area } => (FACE_AMBIGUOUS, face_number(face), area),
                FaceStatus::Gone => (FACE_GONE, -1, f64::NAN),
            };
            saved.status.push(code);
            saved.face.push(face);
            saved.area.push(area);
        }
        saved
    }
}

/// What a restore applied (`RestoreOutcome`, tagged by `kind`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RestoredOutcome {
    /// Every intact constraint is committed; the order shown is the fitting
    /// one closest to the saved one.
    Applied,
    /// The intact constraints have no order together: `constraints` are the
    /// record's indices of those the proof names. None is committed.
    Clash { constraints: Vec<usize> },
    /// The check ran out of nodes or time: none is committed. Keep trying is
    /// the same restore with a larger `deadlineMs`.
    TimedOut { limit: BudgetLimit, nodes: u64 },
}

impl From<RestoreOutcome> for RestoredOutcome {
    fn from(outcome: RestoreOutcome) -> RestoredOutcome {
        match outcome {
            RestoreOutcome::Applied => RestoredOutcome::Applied,
            RestoreOutcome::Clash { constraints } => RestoredOutcome::Clash { constraints },
            RestoreOutcome::TimedOut(TimedOut { limit, nodes }) => {
                RestoredOutcome::TimedOut { limit, nodes }
            }
        }
    }
}

/// A record restored onto a source: the session it opened (with what the
/// outcome says committed), and how each part of the record was found again.
#[derive(Debug, Clone, PartialEq)]
pub struct LayerRestored {
    pub opened: LayerOpened,
    /// The constraints committed, as triples: the intact ones when applied,
    /// none otherwise.
    pub constraints: Vec<i32>,
    pub outcome: RestoredOutcome,
    /// Per record face.
    pub faces: SavedFaces,
    /// Per record constraint: `{ status: 'intact' | 'ambiguous' | 'clashing' }`
    /// or `{ status: 'gone', cause: 'face_gone' | 'same_face' | 'no_overlap' }`.
    pub constraint_status: Vec<ConstraintStatus>,
    /// Per record order pair: [`PAIR_KEPT`], [`PAIR_MOVED`] or
    /// [`PAIR_UNRESOLVED`].
    pub order_status: Vec<u8>,
    /// Every saved constraint the restore did not apply, in record order,
    /// carried to the next save ([`CarriedRow`]).
    pub carried: Vec<CarriedRow>,
}

/// A record face as a carried row names it: its point and area as saved.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct SavedFace {
    pub at: [f64; 2],
    pub area: f64,
}

impl From<RecordFace> for SavedFace {
    fn from(face: RecordFace) -> SavedFace {
        SavedFace {
            at: face.at,
            area: face.area,
        }
    }
}

/// A saved constraint a restore did not apply (`CarriedConstraint`): a row
/// the dialog shows by its status, and that `layer_save` writes back as
/// saved, after the committed constraints, unless the save's `keep` leaves
/// its `index` out, until it is removed (`layer_remove_carried` by `index`,
/// `layer_clear_carried`) or a commit applies it.
/// Its status is flattened in: `{ status: 'intact' | 'ambiguous' |
/// 'clashing' }` or `{ status: 'gone', cause }`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct CarriedRow {
    /// Its index among the constraints of the record restored.
    pub index: usize,
    /// Its faces as the record saved them.
    pub subject: SavedFace,
    pub object: SavedFace,
    /// FOLD's sign, as saved.
    pub sign: i8,
    #[serde(flatten)]
    pub status: ConstraintStatus,
    /// `[subject, object, sign]` on today's faces, when both are intact and
    /// overlap: a commit whose list holds it applies the row. Null otherwise.
    pub constraint: Option<[i32; 3]>,
}

impl From<&CarriedConstraint> for CarriedRow {
    fn from(row: &CarriedConstraint) -> CarriedRow {
        CarriedRow {
            index: row.index,
            subject: row.subject.into(),
            object: row.object.into(),
            sign: row.sign.value(),
            status: row.status,
            constraint: row.constraint.map(|c| {
                [
                    face_number(c.subject),
                    face_number(c.object),
                    i32::from(c.sign.value()),
                ]
            }),
        }
    }
}

/// A session's carried rows, as they cross.
pub fn carried_rows(carried: &[CarriedConstraint]) -> Vec<CarriedRow> {
    carried.iter().map(CarriedRow::from).collect()
}

pub(crate) fn order_status(order: &[SavedPairStatus]) -> Vec<u8> {
    order
        .iter()
        .map(|status| match status {
            SavedPairStatus::Kept => PAIR_KEPT,
            SavedPairStatus::Moved => PAIR_MOVED,
            SavedPairStatus::Unresolved => PAIR_UNRESOLVED,
        })
        .collect()
}

/// A preview that fits: the fitting order closest to the one on screen,
/// which the session does not adopt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreviewFits {
    /// What `layer_commit_preview` adopts it by: the session keeps its last
    /// preview that fit under this token, until the next preview, commit or
    /// restore. Never 0.
    pub token: u32,
    /// The spots whose top face would change, per side, ascending.
    pub changed: ChangedSpots,
    /// The previewed order's stacks.
    pub stacks: Sides<PackedStacks>,
    pub stage: CheckStage,
    pub nodes: u64,
}

/// A no: a proof that the constraints have no order, never a timeout. Faces
/// ascending; `constraints` are indices into the list checked (for a
/// preview, the committed constraints and then the candidate, last), a set
/// that with the creases already has no order (the smallest one lies
/// within it; E6's `explain` finds it).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CantFitWire {
    pub proof: CantFitKind,
    /// The faces a search proved have no order (only for
    /// [`CantFitKind::NoOrder`]; empty otherwise).
    pub proof_faces: Vec<u32>,
    /// Every face the proof traces back to.
    pub faces: Vec<u32>,
    pub constraints: Vec<u32>,
}

/// How a no was proved (`CantFitProof`, its faces apart).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CantFitKind {
    /// Two constraints of the list order one pair both ways.
    Opposed,
    /// A constraint asks the opposite of what the creases force.
    Forced,
    /// The constraints break one of the fold's constraint families.
    Conflict {
        family: oristudio_fold::complete::ConstraintFamily,
    },
    /// A search proved that some faces have no order.
    NoOrder,
}

impl From<oristudio_fold::steer::CantFit> for CantFitWire {
    fn from(cant: oristudio_fold::steer::CantFit) -> CantFitWire {
        use oristudio_fold::steer::CantFitProof;
        let (proof, proof_faces) = match cant.proof {
            CantFitProof::Opposed => (CantFitKind::Opposed, Vec::new()),
            CantFitProof::Forced => (CantFitKind::Forced, Vec::new()),
            CantFitProof::Conflict { family } => (CantFitKind::Conflict { family }, Vec::new()),
            CantFitProof::NoOrder { faces } => {
                (CantFitKind::NoOrder, faces.iter().map(|f| f.0).collect())
            }
        };
        CantFitWire {
            proof,
            proof_faces,
            faces: cant.faces.iter().map(|f| f.0).collect(),
            constraints: cant
                .constraints
                .iter()
                .map(|&i| u32::try_from(i).unwrap_or(u32::MAX))
                .collect(),
        }
    }
}

/// A preview's verdict.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Previewed {
    Fits(PreviewFits),
    CantFit(CantFitWire),
    /// Out of nodes or time: no verdict ("couldn't check in time").
    TimedOut(TimedOut),
}

/// A commit that fit: the session now shows its order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitDone {
    /// The spots whose top face changed, per side, ascending: what the
    /// dialog flashes.
    pub changed: ChangedSpots,
    /// The order on screen's stacks now.
    pub stacks: Sides<PackedStacks>,
    /// The open pairs now, flat, as [`LayerOpened::open_pairs`].
    pub open_pairs: Vec<u32>,
    /// `stage` is how far the check had to search (`unchanged`: no search,
    /// not no change; read `changed` for that). A commit that adopted its
    /// preview reports the preview's.
    pub stage: CheckStage,
    pub nodes: u64,
    /// Whether the commit adopted a stored preview with no search
    /// (`layer_commit_preview` with the token of the session's last preview
    /// and the list it checked); false for every other commit.
    pub adopted: bool,
}

/// A commit's verdict. Only [`Committing::Committed`] changed the session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Committing {
    Committed(CommitDone),
    CantFit(CantFitWire),
    TimedOut(TimedOut),
}

/// A show's verdict (`layer_show`: undo and redo putting back an exact
/// order). Only [`Showing::Shown`] changed the session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Showing {
    /// The order given is on screen, with the constraints given committed.
    Shown(CommitDone),
    /// Not a complete order of the session's that fits the creases and the
    /// constraints: nothing changed.
    Refused,
    /// Checking the order ran out of time: nothing changed.
    TimedOut(TimedOut),
}

/// The smallest set of constraints that clash (E6's `Clash`): every member
/// necessary, dropping any one leaves an order, unless `minimal` is false
/// (the limits ran out first; the set still can't fit). Indices into the
/// list explained (for `layer_explain`, the committed constraints and then
/// the candidate, last), ascending.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClashWire {
    pub constraints: Vec<u32>,
    pub minimal: bool,
    /// The faces the clashing constraints name: the danger tints.
    pub faces: Vec<u32>,
    /// How the last check proved the set can't fit.
    pub proof: CantFitKind,
    /// The faces a search proved have no order, for [`CantFitKind::NoOrder`].
    pub proof_faces: Vec<u32>,
    /// Every face that proof traces back to, the creases' included.
    pub traced: Vec<u32>,
}

/// What an explain found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Explained {
    /// The list fits: nothing to explain.
    Fits,
    Clash(ClashWire),
    /// The first check, of the whole list, ran out: no proof yet.
    TimedOut(TimedOut),
}

impl From<Explanation> for Explained {
    fn from(explanation: Explanation) -> Explained {
        match explanation {
            Explanation::Fits => Explained::Fits,
            Explanation::TimedOut(out) => Explained::TimedOut(out),
            Explanation::Clash(Clash {
                constraints,
                minimal,
                faces,
                proof,
                traced,
            }) => {
                let proof = CantFitWire::from(oristudio_fold::steer::CantFit {
                    proof,
                    faces: traced,
                    constraints,
                });
                Explained::Clash(ClashWire {
                    constraints: proof.constraints,
                    minimal,
                    faces: faces.iter().map(|f| f.0).collect(),
                    proof: proof.proof,
                    proof_faces: proof.proof_faces,
                    traced: proof.faces,
                })
            }
        }
    }
}

/// A step that moved the order on screen to another solution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SteppedTo {
    /// The spots whose top face changed, per side: what a pane flashes.
    pub changed: ChangedSpots,
    /// Where the order on screen now lies ("3 of 12"; final once the
    /// total is exact).
    pub position: Position,
    /// The order on screen's stacks now.
    pub stacks: Sides<PackedStacks>,
}

/// What a step did (E6's `Stepped`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Stepping {
    Moved(SteppedTo),
    /// No solution lies that way among those counted: final once the count
    /// is done.
    End,
    /// The check within the next solution ran out, with no counted order
    /// to fall back on: nothing changed. Keep trying with a later deadline.
    TimedOut(TimedOut),
}

/// A save's answer.
#[derive(Debug, Clone, PartialEq)]
pub enum Saving {
    /// The record as one compact JSON string, byte for byte what the
    /// TypeScript codec (`layerOrderRecord.ts`) writes for it.
    Saved {
        json: String,
    },
    Refused(LayerRefusal),
}

// ---------------------------------------------------------------------------
// Refusals

/// Every answer that is a refusal rather than a result: the source's (the
/// creases cannot be ordered here), the session's (no order, or no first
/// order in time), and the record's. Serialized flat, tagged by `code`, with
/// every `message` left out: the dialog words a refusal from its code.
#[derive(Debug, Clone, PartialEq, Error)]
pub enum LayerRefusal {
    /// `source_*`: see `oristudio_fold::steer::SourceRefusal`.
    #[error(transparent)]
    Source(SourceRefusal),
    /// `session_no_order`, `session_timed_out` (keep trying: the same call
    /// with a larger `deadlineMs`), `session_bad_record`.
    #[error(transparent)]
    Session(SessionRefusal),
    /// `record_newer`: a later build's record, carried and never read.
    #[error("the record is a newer build's")]
    RecordNewer,
    /// `record_damaged`, with the part, by the TypeScript codec's word.
    #[error("the record is damaged: {}", damage.word())]
    RecordDamaged { damage: RecordDamage },
    /// `record_over_budget`: the record would be more than the budget.
    #[error("the record is {bytes} bytes, over the {budget}-byte budget")]
    RecordOverBudget { bytes: usize, budget: usize },
}

impl LayerRefusal {
    /// The stable code.
    pub fn code(&self) -> &'static str {
        match self {
            LayerRefusal::Source(refusal) => refusal.code(),
            LayerRefusal::Session(refusal) => refusal.code(),
            LayerRefusal::RecordNewer => "record_newer",
            LayerRefusal::RecordDamaged { .. } => "record_damaged",
            LayerRefusal::RecordOverBudget { .. } => "record_over_budget",
        }
    }

    /// The body, `{ code, … }`, without any `message`.
    pub fn to_value(&self) -> Value {
        let code = self.code();
        let mut value = match self {
            LayerRefusal::Source(refusal) => serde_json::to_value(refusal),
            LayerRefusal::Session(refusal) => serde_json::to_value(refusal),
            LayerRefusal::RecordNewer => Ok(json!({ "code": code })),
            LayerRefusal::RecordDamaged { damage } => {
                Ok(json!({ "code": code, "damage": damage.word() }))
            }
            LayerRefusal::RecordOverBudget { bytes, budget } => {
                Ok(json!({ "code": code, "bytes": bytes, "budget": budget }))
            }
        }
        .unwrap_or_else(|_| json!({ "code": code }));
        drop_sentences(&mut value);
        value
    }
}

/// Every `message` field, at any depth: the engine's diagnostic sentences,
/// which never cross the bridge.
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

/// What a layer call throws, as `{ code, message }` like the bridge's other
/// calls: a caller's mistake, or a defect that is no one's input.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum LayerCallError {
    /// `invalid_input`: malformed limits, constraints, a side or a source.
    #[error("{0}")]
    InvalidInput(String),
    /// `unknown_layer_session`: closed, or never opened by this engine (a
    /// worker that was terminated holds none of its old sessions).
    #[error("no layer session {0}: it was closed, or never opened by this engine")]
    UnknownSession(u32),
    /// `session_bad_constraint`: constraint `index` of the list is no
    /// question the figure can answer (an unknown face, a face against
    /// itself, faces that do not overlap, or a pair the dialog never
    /// offers). The dialog only offers open pairs, so this is its mistake.
    #[error("constraint {index} is not one the figure can take: {fault:?}")]
    BadConstraint {
        index: usize,
        fault: ConstraintFault,
    },
    /// `unknown_layer_cursor`: a solutions cursor closed, never started on
    /// this session, or whose session was closed.
    #[error("no solutions cursor {cursor} on layer session {session}")]
    UnknownCursor { session: u32, cursor: u32 },
    /// `session_stale_solutions`: the cursor counted other committed
    /// constraints than the session's now (a commit or a restore since; a
    /// step keeps it). Close it and start another.
    #[error("the solutions were counted for other constraints than the session's")]
    StaleSolutions,
    /// `session_internal`, `source_internal`: a defect.
    #[error("{message}")]
    Defect { code: &'static str, message: String },
}

impl LayerCallError {
    pub fn code(&self) -> &'static str {
        match self {
            LayerCallError::InvalidInput(_) => "invalid_input",
            LayerCallError::UnknownSession(_) => "unknown_layer_session",
            LayerCallError::BadConstraint { .. } => "session_bad_constraint",
            LayerCallError::UnknownCursor { .. } => "unknown_layer_cursor",
            LayerCallError::StaleSolutions => "session_stale_solutions",
            LayerCallError::Defect { code, .. } => code,
        }
    }

    pub(crate) fn invalid(message: impl Into<String>) -> LayerCallError {
        LayerCallError::InvalidInput(message.into())
    }
}

/// A session's refusal as an answer, or as what is thrown: only "no order"
/// and "no first order in time" (and a record that would not encode) are
/// answers; a bad constraint is the caller's mistake and anything else a
/// defect.
pub(crate) fn session_refusal(refusal: SessionRefusal) -> Result<LayerRefusal, LayerCallError> {
    match refusal {
        SessionRefusal::NoOrder { .. }
        | SessionRefusal::TimedOut { .. }
        | SessionRefusal::BadRecord { .. } => Ok(LayerRefusal::Session(refusal)),
        SessionRefusal::BadConstraint { index, fault } => {
            Err(LayerCallError::BadConstraint { index, fault })
        }
        SessionRefusal::StaleSolutions => Err(LayerCallError::StaleSolutions),
        SessionRefusal::Internal { message } => Err(LayerCallError::Defect {
            code: "session_internal",
            message,
        }),
    }
}

/// A source's refusal as an answer; a malformed wireframe is a defect.
pub(crate) fn source_refusal(refusal: SourceRefusal) -> Result<LayerRefusal, LayerCallError> {
    match refusal {
        SourceRefusal::Internal { message } => Err(LayerCallError::Defect {
            code: "source_internal",
            message,
        }),
        other => Ok(LayerRefusal::Source(other)),
    }
}

/// A session's refusal on a call that is not an open: never an answer.
pub(crate) fn thrown(refusal: SessionRefusal) -> LayerCallError {
    match session_refusal(refusal) {
        Ok(answer) => LayerCallError::Defect {
            code: "session_internal",
            message: format!("an open's refusal on a later call: {answer}"),
        },
        Err(error) => error,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn now() -> f64 {
        1_000.0
    }

    #[test]
    fn limits_default_to_the_engine_s_and_the_deadline_is_relative() {
        let defaults = Limits::default();
        let none = LayerLimits::default().limits(now).unwrap_or_default();
        assert_eq!(none.max_nodes, defaults.max_nodes);
        assert_eq!(none.fast_nodes, defaults.fast_nodes);
        assert!(none.deadline.is_none());
        let given: LayerLimits = serde_json::from_value(json!({
            "maxNodes": 0, "fastNodes": 3, "deadlineMs": 250
        }))
        .unwrap_or_default();
        let limits = given.limits(now).unwrap_or_default();
        assert_eq!(limits.max_nodes, Some(0));
        assert_eq!(limits.fast_nodes, 3);
        assert_eq!(limits.deadline.map(|d| d.at_ms), Some(1_250.0));
        for bad in [-1.0, f64::NAN, f64::INFINITY] {
            let limits = LayerLimits {
                deadline_ms: Some(bad),
                ..LayerLimits::default()
            };
            assert_eq!(
                limits.limits(now).map(|_| ()).map_err(|e| e.code()),
                Err("invalid_input")
            );
        }
        // A misspelt field is a mistake, not a default; the boundary checks
        // the same list (`bindings::limits_of`).
        assert!(serde_json::from_value::<LayerLimits>(json!({ "deadline": 5 })).is_err());
        let every = json!({ "maxNodes": 1, "fastNodes": 1, "deadlineMs": 1 });
        let names: Vec<&str> = every
            .as_object()
            .map(|fields| fields.keys().map(String::as_str).collect())
            .unwrap_or_default();
        assert_eq!(names.len(), LAYER_LIMITS_FIELDS.len());
        assert!(names.iter().all(|n| LAYER_LIMITS_FIELDS.contains(n)));
        assert!(serde_json::from_value::<LayerLimits>(every).is_ok());
    }

    #[test]
    fn constraints_cross_as_triples() {
        let list = vec![
            Constraint {
                subject: FaceId(3),
                object: FaceId(1),
                sign: FoldSign::Front,
            },
            Constraint {
                subject: FaceId(0),
                object: FaceId(7),
                sign: FoldSign::Back,
            },
        ];
        let triples = triples_of(&list);
        assert_eq!(triples, vec![3, 1, 1, 0, 7, -1]);
        assert_eq!(constraints_of(&triples), Ok(list));
        assert_eq!(constraints_of(&[]), Ok(Vec::new()));
        for bad in [&[1, 2][..], &[1, 2, 0], &[1, 2, 2], &[-1, 2, 1]] {
            assert_eq!(
                constraints_of(bad).map_err(|e| e.code()),
                Err("invalid_input"),
                "{bad:?}"
            );
        }
        assert!(candidate_of(&[1, 2, 1]).is_ok());
        assert!(candidate_of(&[1, 2, 1, 2, 1, 1]).is_err());
        assert!(candidate_of(&[]).is_err());
    }

    #[test]
    fn refusals_are_flat_codes_without_sentences() {
        let kernel = LayerRefusal::Source(SourceRefusal::Kernel {
            kernel_code: "invalid_segments",
            message: "a sentence".to_string(),
        });
        assert_eq!(
            kernel.to_value(),
            json!({ "code": "source_kernel", "kernel_code": "invalid_segments" })
        );
        let timed_out = LayerRefusal::Session(SessionRefusal::TimedOut {
            limit: BudgetLimit::Deadline,
            nodes: 4,
        });
        assert_eq!(
            timed_out.to_value(),
            json!({ "code": "session_timed_out", "limit": "deadline", "nodes": 4 })
        );
        assert_eq!(
            LayerRefusal::RecordDamaged {
                damage: RecordDamage::NotJson
            }
            .to_value(),
            json!({ "code": "record_damaged", "damage": "not-json" })
        );
        assert_eq!(
            LayerRefusal::RecordOverBudget {
                bytes: 9,
                budget: 8
            }
            .to_value(),
            json!({ "code": "record_over_budget", "bytes": 9, "budget": 8 })
        );
        assert_eq!(
            LayerRefusal::RecordNewer.to_value(),
            json!({ "code": "record_newer" })
        );
        // Only a bad constraint and a defect are thrown.
        assert_eq!(
            session_refusal(SessionRefusal::BadConstraint {
                index: 2,
                fault: ConstraintFault::SameFace
            })
            .map_err(|e| e.code()),
            Err("session_bad_constraint")
        );
        assert_eq!(
            session_refusal(SessionRefusal::Internal {
                message: "x".to_string()
            })
            .map_err(|e| e.code()),
            Err("session_internal")
        );
        assert_eq!(
            source_refusal(SourceRefusal::Internal {
                message: "x".to_string()
            })
            .map_err(|e| e.code()),
            Err("source_internal")
        );
    }

    #[test]
    fn where_the_order_came_from_and_carried_rows_are_flat_objects() {
        let first = OpenedOnWire::from(&OpenedOn::First {
            timed_out: Some(TimedOut {
                limit: BudgetLimit::Deadline,
                nodes: 3,
            }),
        });
        assert_eq!(
            serde_json::to_value(first).unwrap_or_default(),
            json!({ "kind": "first", "timed_out": { "limit": "deadline", "nodes": 3 } })
        );
        assert_eq!(
            serde_json::to_value(OpenedOnWire::from(&OpenedOn::First { timed_out: None }))
                .unwrap_or_default(),
            json!({ "kind": "first", "timed_out": null })
        );
        assert_eq!(
            serde_json::to_value(OpenedOnWire::from(&OpenedOn::Closest {
                moved: 2,
                ignored: 1,
                inside: None,
            }))
            .unwrap_or_default(),
            json!({ "kind": "closest", "moved": 2, "ignored": 1, "inside": null })
        );
        assert_eq!(
            serde_json::to_value(OpenedOnWire::from(&OpenedOn::Closest {
                moved: 1,
                ignored: 0,
                inside: Some(oristudio_fold::steer::FoldInside {
                    face: oristudio_fold::FaceId(7),
                    crease: [oristudio_fold::FaceId(2), oristudio_fold::FaceId(5)],
                }),
            }))
            .unwrap_or_default(),
            json!({
                "kind": "closest",
                "moved": 1,
                "ignored": 0,
                "inside": { "face": 7, "crease": [2, 5] },
            })
        );
        let face = RecordFace {
            at: [0.25, 0.5],
            area: 0.125,
        };
        let row = CarriedRow::from(&CarriedConstraint {
            index: 4,
            subject: face,
            object: face,
            sign: FoldSign::Back,
            status: ConstraintStatus::Gone {
                cause: oristudio_fold::steer::GoneCause::FaceGone,
            },
            constraint: None,
        });
        assert_eq!(
            serde_json::to_value(row).unwrap_or_default(),
            json!({
                "index": 4,
                "subject": { "at": [0.25, 0.5], "area": 0.125 },
                "object": { "at": [0.25, 0.5], "area": 0.125 },
                "sign": -1, "status": "gone", "cause": "face_gone", "constraint": null
            })
        );
        assert_eq!(
            relations_of(&[1, 2, 3]).map(|_| ()).map_err(|e| e.code()),
            Err("invalid_input")
        );
        assert_eq!(relations_of(&[3, 1]).map(|r| r.len()), Ok(1));
    }

    #[test]
    fn the_stepper_s_words_read_as_e6_s() {
        let by = |value: Value| {
            serde_json::from_value::<LayerStepBy>(value)
                .map_err(|_| "parse")
                .and_then(|by| by.step_by().map_err(|e| e.code()))
        };
        assert_eq!(by(json!("layer_order")), Ok(StepBy::LayerOrder));
        assert_eq!(
            by(json!({ "picture": "back" })),
            Ok(StepBy::Picture(ViewSide::Back))
        );
        assert_eq!(by(json!("picture")), Err("invalid_input"));
        assert_eq!(by(json!({ "picture": "up" })), Err("invalid_input"));
        assert_eq!(direction_of("previous"), Ok(StepDirection::Previous));
        assert_eq!(
            direction_of("back").map_err(|e| e.code()),
            Err("invalid_input")
        );
        let caps: LayerSolutionCaps =
            serde_json::from_value(json!({ "storedBits": 64 })).unwrap_or_default();
        let defaults = SolutionCaps::default();
        assert_eq!(
            caps.caps(),
            SolutionCaps {
                stored_bits: 64,
                ..defaults
            }
        );
        let quiet: LayerSolutionCaps =
            serde_json::from_value(json!({ "countInSteps": false })).unwrap_or_default();
        assert_eq!(
            quiet.caps(),
            SolutionCaps {
                count_in_steps: false,
                ..defaults
            }
        );
        assert!(serde_json::from_value::<LayerSolutionCaps>(json!({ "orders": 1 })).is_err());
        assert_eq!(
            session_refusal(SessionRefusal::StaleSolutions).map_err(|e| e.code()),
            Err("session_stale_solutions")
        );
        let clash = Explained::from(Explanation::Clash(Clash {
            constraints: vec![0, 2],
            minimal: true,
            faces: vec![FaceId(1), FaceId(4)],
            proof: oristudio_fold::steer::CantFitProof::NoOrder {
                faces: vec![FaceId(4), FaceId(1)],
            },
            traced: vec![FaceId(1), FaceId(3), FaceId(4)],
        }));
        assert_eq!(
            clash,
            Explained::Clash(ClashWire {
                constraints: vec![0, 2],
                minimal: true,
                faces: vec![1, 4],
                proof: CantFitKind::NoOrder,
                proof_faces: vec![4, 1],
                traced: vec![1, 3, 4],
            })
        );
    }

    #[test]
    fn statuses_are_one_byte_each() {
        let faces = SavedFaces::of(&[
            FaceStatus::Intact { face: FaceId(4) },
            FaceStatus::Ambiguous {
                face: FaceId(2),
                area: 0.5,
            },
            FaceStatus::Gone,
        ]);
        assert_eq!(faces.status, vec![FACE_INTACT, FACE_AMBIGUOUS, FACE_GONE]);
        assert_eq!(faces.face, vec![4, 2, -1]);
        assert!(faces.area[0].is_nan() && faces.area[2].is_nan());
        assert_eq!(faces.area[1], 0.5);
        assert_eq!(
            order_status(&[
                SavedPairStatus::Kept,
                SavedPairStatus::Moved,
                SavedPairStatus::Unresolved
            ]),
            vec![PAIR_KEPT, PAIR_MOVED, PAIR_UNRESOLVED]
        );
        assert_eq!(
            serde_json::to_value(RestoredOutcome::from(RestoreOutcome::TimedOut(TimedOut {
                limit: BudgetLimit::Nodes,
                nodes: 0
            })))
            .unwrap_or_default(),
            json!({ "kind": "timed_out", "limit": "nodes", "nodes": 0 })
        );
    }
}

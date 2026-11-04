//! The constraint session: what the Layer order dialog asks of one folded
//! figure while the user builds constraints (`implementation-plans/layer-order-dialog.md`,
//! approach 1; engine research §1.3).
//!
//! A [`ConstraintSession`] holds three things over a [`LayerSource`]:
//!
//! - **the committed constraints**, as built ([`Constraint`]);
//! - **the order on screen**: a complete order that fits the creases and
//!   every committed constraint, and its stacks per spot;
//! - **the forced pairs**: what the creases' letters and the committed
//!   constraints decide by deduction alone. Every other overlapping pair is
//!   *open* ([`ConstraintSession::open_pairs`]), and only an open pair is
//!   offered to the user.
//!
//! Every question is one of these, and only a commit, a show or a restore
//! changes the session:
//!
//! | Call | Searches | Changes the session |
//! | --- | --- | --- |
//! | [`open`](ConstraintSession::open) | one deduction pass, and one order per independent part | – (it opens one, on the solver's first order) |
//! | [`open_showing`](ConstraintSession::open_showing) | the same, then the order the host shows, held | – (it opens one, on the host's order) |
//! | [`preview`](ConstraintSession::preview) | the committed constraints plus one candidate | never |
//! | [`preview_list`](ConstraintSession::preview_list) | any list, such as the dialog's own rows plus one | never |
//! | [`commit`](ConstraintSession::commit) | the whole new list | only when it fits |
//! | [`commit_preview`](ConstraintSession::commit_preview) | nothing, when the preview is still current | yes, to the previewed order |
//! | [`show`](ConstraintSession::show) | nothing: an order it showed before, checked by deduction | yes, to exactly that order (undo, redo) |
//! | [`restore`](ConstraintSession::restore) | a saved record on (possibly edited) creases | – (it opens one) |
//! | [`restore_record`](ConstraintSession::restore_record) | the same, on a session already open | yes |
//!
//! Every call takes [`Limits`], and an interactive caller always gives them a
//! deadline: `Limits::default()` has none, and a check on a deep stack can
//! run for seconds.
//!
//! # The order on screen moves as little as it can
//!
//! A preview or a commit looks for the fitting order closest to the one on
//! screen. When the order on screen already fits the new list (any list that
//! only lost constraints, or a candidate the order already satisfies), it is
//! kept exactly, and only the forced pairs are deduced again. Otherwise the
//! search is steered by it (`treemaker_flatfold::CheckOptions::prefer`, with
//! `prefer_fits`: the session vouches that the order on screen fits, so
//! every independent part the new constraints do not change keeps it with
//! no search). "Closest" is a warm start, not a proven minimum (the plan's
//! risks): what the new constraints reach can change more than it must.
//!
//! A preview and the commit of the same list, with the same `fast_nodes`,
//! find the same order: the search is deterministic and a deadline only ever
//! stops it. Add need not search again at all: [`ConstraintSession::commit_preview`]
//! adopts the preview's order while the session is as it was when the
//! preview ran, so it cannot run out of time right after a preview that fit.
//!
//! # Verdicts and time
//!
//! Every check has three outcomes: it fits, it cannot fit (a proof, which
//! names the faces and a set of the constraints it traces back to,
//! [`CantFit`]), or it ran out of nodes or time ([`TimedOut`]), which is
//! never a verdict and never reported as "can't fit". A constraint that is
//! not a question at all (a face the figure lacks, a face against itself, two
//! faces that do not overlap, or a pair only the solver's view overlaps) is a
//! [`SessionRefusal::BadConstraint`].
//!
//! # Faces and sides
//!
//! Face *k* is Oriedita face *k* ([`LayerSource`]). A constraint is stored
//! as FOLD's sign of its subject against its object ([`FoldSign`]), so it is
//! relative to the paper: from the front, "in front of" is nearer a viewer
//! at +z, and from the back the same constraint reads "behind"
//! ([`Constraint::seen`], [`Constraint::verb`]).
//!
//! Ori Studio original work, not a port.

use std::collections::{BTreeMap, HashSet};
use std::hash::{DefaultHasher, Hasher};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};

use oristudio_cp::folding::{
    FoldedFigureModel, FoldedFigureState, FoldedPaperScene, HierarchyRelation,
    folded_paper_scene_with_order,
};
use oristudio_cp::session::EngineError;
use oristudio_layer_order::{FacePair, FoldedView, LayerOrder, LayerOrderBuilder};
use serde::Serialize;
use thiserror::Error;
use treemaker_flatfold::{
    self as flatfold, CheckOptions, CheckOutcome, CompletionError, Deduction, PairOrder,
};

use super::record::{FoldSign, LayerOrderRecord, RecordFace, RecordPair, RecordPart};
use super::restore::CarriedConstraint;
use super::showing::OpenedOn;
use super::source::LayerSource;
use super::stacks::{ChangedSpots, Spots, Stacks, ViewSide};
use crate::complete::{
    self, BudgetLimit, CheckLimits, CheckStage, CompletionLimits, CompletionRefusal,
    CompletionSession, ConstraintFamily, Deadline,
};
use crate::pattern::FaceId;

/// What one call may spend: a node budget and a deadline, for the open, a
/// preview, a commit and a restore alike.
///
/// **Always give an interactive call a deadline.** The default has none, so
/// a check is bounded by its nodes alone, and a node on a deep stack can cost
/// tens of milliseconds (the iguana's preview takes about half a second). The
/// dialog's preview deadline is about 3 s (the plan's approach 5); a timeout
/// is a [`TimedOut`], and "keep trying" is the same call with a later
/// deadline.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    /// Search nodes for the open's first order, and for a check's exhaustive
    /// fallback (Flat-Folder's own search over what its quick attempts
    /// left); `None` is unbounded.
    pub max_nodes: Option<u64>,
    /// Nodes for each of a check's quick attempts, the ones steered by the
    /// order on screen.
    pub fast_nodes: u64,
    /// Read before each search node and every few propagated pairs.
    pub deadline: Option<Deadline>,
}

/// 200,000 nodes, 128 quick nodes and **no deadline**: for tests and batch
/// runs. An interactive caller sets [`Limits::deadline`].
impl Default for Limits {
    fn default() -> Limits {
        let check = CheckLimits::default();
        Limits {
            max_nodes: check.max_nodes,
            fast_nodes: check.fast_nodes,
            deadline: None,
        }
    }
}

impl Limits {
    fn completion(&self) -> CompletionLimits {
        CompletionLimits {
            per_component: 1,
            max_nodes: self.max_nodes,
            deadline: self.deadline,
        }
    }

    fn flatfold_deadline(&self) -> Option<flatfold::Deadline> {
        complete::search_budget(None, self.deadline).deadline
    }
}

/// The verb of a constraint, as the sentence reads from the side shown.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Verb {
    /// The subject is nearer the viewer wherever the two overlap.
    InFrontOf,
    /// The subject is farther from the viewer.
    Behind,
}

/// One constraint: `subject` lies on `object`'s `sign` side wherever the two
/// overlap. Relative to the paper, so turning the view over never changes it
/// (see the module docs).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Constraint {
    pub subject: FaceId,
    pub object: FaceId,
    pub sign: FoldSign,
}

impl Constraint {
    /// "`subject` `verb` `object`", read from `side`; `None` when `object` is
    /// not a face of `view`.
    pub fn seen(
        subject: FaceId,
        verb: Verb,
        object: FaceId,
        side: ViewSide,
        view: &FoldedView,
    ) -> Option<Constraint> {
        let subject_above = (verb == Verb::InFrontOf) == (side == ViewSide::Front);
        Some(Constraint {
            subject,
            object,
            sign: FoldSign::of_above(subject_above, view.front_up(object)?),
        })
    }

    /// Whether the subject lies above the object in the solver's frame
    /// (nearer a viewer of the front, at +z).
    pub fn subject_above(&self, view: &FoldedView) -> Option<bool> {
        Some(self.sign.above(view.front_up(self.object)?))
    }

    /// How the constraint reads from `side`.
    pub fn verb(&self, side: ViewSide, view: &FoldedView) -> Option<Verb> {
        let nearer = self.subject_above(view)? == (side == ViewSide::Front);
        Some(if nearer {
            Verb::InFrontOf
        } else {
            Verb::Behind
        })
    }
}

/// Why a constraint is not a question the session can answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "fault", rename_all = "snake_case")]
pub enum ConstraintFault {
    /// A face the figure lacks.
    UnknownFace { face: FaceId },
    /// The subject is the object.
    SameFace,
    /// The two faces do not overlap.
    NotOverlapping,
    /// The two faces overlap only in the solver's view, sharing no spot
    /// Edit draws: an order on them could not be shown, so they are never
    /// offered (`LayerSource::fold_only_pairs`).
    NotOffered,
}

/// Why a session cannot be opened or a call cannot be answered. None of these
/// is a verdict on a constraint list; see [`CantFit`] and [`TimedOut`].
#[derive(Debug, Clone, PartialEq, Serialize, Error)]
#[serde(tag = "code")]
pub enum SessionRefusal {
    /// The creases alone admit no order: their letters conflict, or some part
    /// of the fold has none. Edit could not have folded them flat.
    #[serde(rename = "session_no_order")]
    #[error("the creases admit no layer order (faces {faces:?})")]
    NoOrder { faces: Vec<FaceId> },
    /// The open ran out of nodes or time before it had a first order.
    #[serde(rename = "session_timed_out")]
    #[error("the open ran out of {limit:?} after {nodes} nodes")]
    TimedOut { limit: BudgetLimit, nodes: u64 },
    /// Constraint `index` of the list is not a question (see
    /// [`ConstraintFault`]).
    #[serde(rename = "session_bad_constraint")]
    #[error("constraint {index} is not one the figure can take: {fault:?}")]
    BadConstraint {
        index: usize,
        fault: ConstraintFault,
    },
    /// A record to restore whose `part` would not encode: a face index out
    /// of range, a face against itself, a point that is not finite, an area
    /// not above 0. A record read through [`super::read_record`] never is.
    #[serde(rename = "session_bad_record")]
    #[error("the record's {} would not read back", part.word())]
    BadRecord { part: RecordPart },
    /// A solution count asked about a session it was not started on, or
    /// after the committed constraints changed: start a new one
    /// ([`ConstraintSession::solutions`]).
    #[serde(rename = "session_stale_solutions")]
    #[error("the solutions were counted for another session or other constraints")]
    StaleSolutions,
    /// A defect, never the user's input.
    #[serde(rename = "session_internal")]
    #[error("the constraint session failed: {message}")]
    Internal { message: String },
}

impl SessionRefusal {
    /// The stable code, as the wire spells it.
    pub fn code(&self) -> &'static str {
        match self {
            SessionRefusal::NoOrder { .. } => "session_no_order",
            SessionRefusal::TimedOut { .. } => "session_timed_out",
            SessionRefusal::BadConstraint { .. } => "session_bad_constraint",
            SessionRefusal::BadRecord { .. } => "session_bad_record",
            SessionRefusal::StaleSolutions => "session_stale_solutions",
            SessionRefusal::Internal { .. } => "session_internal",
        }
    }

    pub(crate) fn internal(message: impl Into<String>) -> SessionRefusal {
        SessionRefusal::Internal {
            message: message.into(),
        }
    }
}

/// How a check proved that no order fits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CantFitProof {
    /// Two constraints of the list order one pair both ways.
    Opposed,
    /// A constraint asks the opposite of what the creases alone force.
    Forced,
    /// The constraints, propagated with the creases, break a constraint of
    /// the fold (Flat-Folder's families, or transitivity in a spot).
    Conflict { family: ConstraintFamily },
    /// A search proved that the faces `faces` have no order.
    NoOrder { faces: Vec<FaceId> },
}

/// No order fits the constraints checked: a proof, never a timeout.
///
/// The seam for the smallest clashing set (the plan's E6, `explain`):
/// [`CantFit::constraints`] is a set of the checked constraints that, with
/// the creases, already has no order, the proof's roots. It need not be the
/// smallest; a smallest one lies within it, which a deletion filter over it
/// finds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CantFit {
    pub proof: CantFitProof,
    /// Every face the proof traces back to through the propagation
    /// (Flat-Folder's `error_faces`), ascending; the creases' faces included.
    pub faces: Vec<FaceId>,
    /// Indices into the list checked (for a preview: the committed
    /// constraints, then the candidate, last), ascending.
    pub constraints: Vec<usize>,
}

/// A check that ran out of its nodes or its deadline: neither a fit nor a
/// proof ("couldn't check in time").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct TimedOut {
    pub limit: BudgetLimit,
    pub nodes: u64,
}

/// A complete order and its stacks.
#[derive(Debug, Clone, PartialEq)]
struct Arrangement {
    /// The problem's variables, ascending, shared with the session.
    variables: Arc<[FacePair]>,
    /// One per variable.
    values: Vec<PairOrder>,
    /// The front stacks of every spot.
    stacks: Stacks,
}

impl Arrangement {
    fn order(&self) -> LayerOrder {
        let mut order = LayerOrderBuilder::with_capacity(self.values.len());
        for (pair, value) in self.variables.iter().zip(&self.values) {
            let (upper, lower) = upper_lower(*pair, *value);
            // Distinct faces, every pair once.
            let _ = order.set_above(upper, lower);
        }
        order.build()
    }
}

pub(crate) fn upper_lower(pair: FacePair, value: PairOrder) -> (FaceId, FaceId) {
    match value {
        PairOrder::FirstAbove => (pair.lo(), pair.hi()),
        PairOrder::SecondAbove => (pair.hi(), pair.lo()),
    }
}

/// A preview that fits: the fitting order closest to the one on screen.
///
/// It also carries what a commit of its list needs, so Add can adopt it with
/// [`ConstraintSession::commit_preview`] rather than search again.
#[derive(Debug, Clone, PartialEq)]
pub struct PreviewFit {
    arrangement: Arrangement,
    /// The spots whose top face would change, per side. What a pane
    /// flashes: never infer a change, or its absence, from [`Self::stage`].
    pub changed: ChangedSpots,
    /// How far the check had to search: [`CheckStage::Unchanged`] means no
    /// search was needed, not that the order is unchanged (what the new
    /// constraints force by deduction alone can still move it).
    pub stage: CheckStage,
    pub nodes: u64,
    /// The list it checked.
    list: Vec<Constraint>,
    /// What the creases and the list force.
    forced: Vec<Option<PairOrder>>,
    /// The session it ran on, and that session's generation then.
    session: u64,
    generation: u64,
}

impl PreviewFit {
    /// The order the preview shows.
    pub fn order(&self) -> LayerOrder {
        self.arrangement.order()
    }

    /// Its stacks per spot, from `side`.
    pub fn stacks(&self, side: ViewSide) -> Stacks {
        self.arrangement.stacks.seen_from(side)
    }

    /// The constraint list it checked: the committed constraints and the
    /// candidate, for [`ConstraintSession::preview`]; the list given, for
    /// [`ConstraintSession::preview_list`].
    pub fn constraints(&self) -> &[Constraint] {
        &self.list
    }

    /// The order the preview shows as Oriedita relations, as
    /// [`ConstraintSession::oriedita_relations`] gives the order on screen.
    pub fn oriedita_relations(&self, session: &ConstraintSession) -> Vec<HierarchyRelation> {
        session.relations_of(&self.arrangement.values)
    }
}

/// What a [`ConstraintSession::preview`] found.
#[derive(Debug, Clone, PartialEq)]
pub enum Preview {
    Fits(PreviewFit),
    CantFit(CantFit),
    TimedOut(TimedOut),
}

/// A commit that fit, and moved the session to it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Committed {
    /// The spots whose top face changed, per side: what a pane flashes.
    pub changed: ChangedSpots,
    /// How far the check had to search: [`CheckStage::Unchanged`] means no
    /// search, not no change; read [`Self::changed`] for that. A commit that
    /// adopted its preview ([`ConstraintSession::commit_preview`]) reports
    /// the preview's.
    pub stage: CheckStage,
    pub nodes: u64,
}

/// What a [`ConstraintSession::commit`] did. Only [`Commit::Committed`]
/// changed the session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Commit {
    Committed(Committed),
    CantFit(CantFit),
    TimedOut(TimedOut),
}

/// What a [`ConstraintSession::show`] did. Only [`Show::Shown`] changed the
/// session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Show {
    /// The session now shows the order given, with the constraints given
    /// committed. `changed` is the spots whose top face changed; there was
    /// no search (`stage` is [`CheckStage::Unchanged`]).
    Shown(Committed),
    /// The order is not a complete order of this session's that fits the
    /// creases and the constraints: nothing changed.
    Refused,
    /// Checking the order ran out of time: nothing changed.
    TimedOut(TimedOut),
}

/// Which order a check is steered toward.
#[derive(Debug, Clone, Copy)]
pub(crate) enum Steer<'a> {
    /// The order on screen, which fits, so the search may keep it wherever the
    /// seeds do not change it.
    Shown,
    /// Another order, one value per variable, not known to fit: only tried
    /// first.
    Toward(&'a [PairOrder]),
}

/// A check's fitting order, and what its seeds force.
#[derive(Debug, Clone)]
pub(crate) struct Fit {
    arrangement: Arrangement,
    forced: Vec<Option<PairOrder>>,
    stage: CheckStage,
    nodes: u64,
}

impl Fit {
    /// The same order, with what other seeds force.
    pub(crate) fn with_forced(self, forced: Vec<Option<PairOrder>>) -> Fit {
        Fit { forced, ..self }
    }

    /// The order, one value per variable.
    pub(crate) fn into_values(self) -> Vec<PairOrder> {
        self.arrangement.values
    }
}

/// What a check found.
#[derive(Debug, Clone)]
pub(crate) enum Solved {
    Fit(Fit),
    CantFit(CantFit),
    TimedOut(TimedOut),
}

/// One variable's order asked for.
pub(crate) type Seed = (usize, PairOrder);

/// See the module docs.
#[derive(Debug)]
pub struct ConstraintSession {
    source: LayerSource,
    solver: CompletionSession,
    variables: Arc<[FacePair]>,
    /// Per variable, whether its faces share a spot Edit draws: the pairs
    /// offered, and the only ones an order goes back to Edit on.
    offered: Vec<bool>,
    spots: Spots,
    constraints: Vec<Constraint>,
    shown: Arrangement,
    /// Per variable, what the letters and the committed constraints force.
    forced: Vec<Option<PairOrder>>,
    /// Saved constraints a restore did not apply, carried to the next save
    /// unless removed or committed.
    carried: Vec<CarriedConstraint>,
    /// Where the order shown at open or restore came from.
    opened_on: OpenedOn,
    /// This session, among every session of the process, so a preview is
    /// adopted only by the session it ran on.
    id: u64,
    /// Bumped whenever the constraints, the order on screen or what they
    /// force change: a preview of an older generation is out of date.
    generation: u64,
    /// Every order the session has shown, by fingerprint ([`fingerprint`]):
    /// each fit the creases, so [`Self::show`] puts one back with no proof
    /// of the whole order (most of a second on the iguana, 65,851 open
    /// pairs). A few bytes per order shown.
    seen: HashSet<u64>,
}

/// Each session's own number, for [`PreviewFit`]'s guard.
static SESSIONS: AtomicU64 = AtomicU64::new(0);

/// A complete order's fingerprint, for [`ConstraintSession::show`].
fn fingerprint(values: &[PairOrder]) -> u64 {
    let mut hasher = DefaultHasher::new();
    for value in values {
        hasher.write_u8(u8::from(*value == PairOrder::FirstAbove));
    }
    hasher.finish()
}

impl ConstraintSession {
    /// Open a session over `source`: the letters' deduction, a first order of
    /// every independent part (the order shown first), no constraints.
    ///
    /// The first order is the solver's, not necessarily the one the host is
    /// showing: a host opening the dialog on a figure uses
    /// [`Self::open_showing`].
    pub fn open(source: LayerSource, limits: &Limits) -> Result<ConstraintSession, SessionRefusal> {
        let solver = source.session(&limits.completion()).map_err(open_refusal)?;
        let variables: Arc<[FacePair]> = solver.variables().into();
        if variables.as_ref() != source.problem().variables() {
            return Err(SessionRefusal::internal(
                "the session's variables are not the problem's",
            ));
        }
        let offered = variables
            .iter()
            .map(|pair| source.shares_subface(pair.lo(), pair.hi()))
            .collect();
        let spots = Spots::of(source.render_inputs(), source.view().faces().len());
        if !spots.faces_in_range() {
            return Err(SessionRefusal::internal("a spot names a face out of range"));
        }
        let values = solver.search().first();
        let stacks = spots.stacks(&variables, &values);
        let forced = solver.search().forced();
        let seen = HashSet::from([fingerprint(&values)]);
        Ok(ConstraintSession {
            shown: Arrangement {
                variables: variables.clone(),
                values,
                stacks,
            },
            source,
            solver,
            variables,
            offered,
            spots,
            constraints: Vec::new(),
            forced,
            carried: Vec::new(),
            opened_on: OpenedOn::First { timed_out: None },
            id: SESSIONS.fetch_add(1, AtomicOrdering::Relaxed),
            generation: 0,
            seen,
        })
    }

    /// Where the order shown at open or at the last restore came from: the
    /// solver's first order, the host's or the saved one held whole, or the
    /// closest fitting order the search found to it. Commits do not change
    /// it.
    pub fn opened_on(&self) -> &OpenedOn {
        &self.opened_on
    }

    /// Hand the source back, for a caller done with the session that wants
    /// to open another on the same creases without building it again.
    pub fn into_source(self) -> LayerSource {
        self.source
    }

    /// What the session orders.
    pub fn source(&self) -> &LayerSource {
        &self.source
    }

    /// The committed constraints, as built, in the order made.
    pub fn constraints(&self) -> &[Constraint] {
        &self.constraints
    }

    /// The order on screen: every overlapping pair.
    pub fn shown_order(&self) -> LayerOrder {
        self.shown.order()
    }

    /// Whether `upper` is forced above `lower` (`Some(true)`), forced below
    /// it (`Some(false)`), or open or not overlapping (`None`), by the
    /// letters and the committed constraints.
    pub fn forced(&self, upper: FaceId, lower: FaceId) -> Option<bool> {
        let v = self.variable_of(upper, lower)?;
        let value = self.forced[v]?;
        Some(upper_lower(self.variables[v], value).0 == upper)
    }

    /// The pairs whose order is still open, by deduction from the letters and
    /// the committed constraints, ascending; never a pair only the solver's
    /// view overlaps. A subject can be picked when it is in one; its objects
    /// are its partners in them ([`Self::open_partners`]).
    pub fn open_pairs(&self) -> Vec<FacePair> {
        self.variables
            .iter()
            .zip(&self.forced)
            .zip(&self.offered)
            .filter(|((_, forced), offered)| forced.is_none() && **offered)
            .map(|((pair, _), _)| *pair)
            .collect()
    }

    /// The faces whose order with `face` is still open, ascending.
    pub fn open_partners(&self, face: FaceId) -> Vec<FaceId> {
        let mut partners: Vec<FaceId> = self
            .open_pairs()
            .into_iter()
            .filter(|pair| pair.contains(face))
            .map(|pair| {
                if pair.lo() == face {
                    pair.hi()
                } else {
                    pair.lo()
                }
            })
            .collect();
        partners.sort_unstable();
        partners
    }

    /// How many spots the stacks list: the paper scene's subfaces.
    pub fn spot_count(&self) -> usize {
        self.spots.len()
    }

    /// The order on screen's stack on every spot, from `side`: the paper
    /// scene's `faces_top_to_bottom`, spot for subface, for the panes' hit
    /// tests and X-ray between scenes.
    pub fn stacks(&self, side: ViewSide) -> Stacks {
        self.shown.stacks.seen_from(side)
    }

    /// The paper scene of the order on screen from `side`, with the host's
    /// `model` (its colours, scale and rotation; its state is set by
    /// `side`), through the kernel's own builder, so the dialog draws what
    /// Apply's new handle will. `None` when the figure has no subfaces.
    pub fn scene(
        &self,
        side: ViewSide,
        model: &FoldedFigureModel,
    ) -> Result<Option<FoldedPaperScene>, SessionRefusal> {
        let model = FoldedFigureModel {
            state: match side {
                ViewSide::Front => FoldedFigureState::Front0,
                ViewSide::Back => FoldedFigureState::Back1,
            },
            ..model.clone()
        };
        folded_paper_scene_with_order(
            self.source.render_inputs(),
            &self.oriedita_relations(),
            &self.source.fold_source().aux_segments,
            &model,
        )
        .map_err(|error| SessionRefusal::internal(EngineError::from(error).message))
    }

    /// The order on screen as Oriedita's relations, for a host's
    /// `fold_with_order`: every pair sharing a spot Edit draws, ascending,
    /// `upper_face` the face above (the starting face is front-up, so
    /// Oriedita's upper is the solver's above;
    /// [`LayerSource::oriedita_relations`]).
    pub fn oriedita_relations(&self) -> Vec<HierarchyRelation> {
        self.relations_of(&self.shown.values)
    }

    /// A complete order, one value per variable, as Oriedita's relations.
    pub(crate) fn relations_of(&self, values: &[PairOrder]) -> Vec<HierarchyRelation> {
        self.variables
            .iter()
            .zip(values)
            .zip(&self.offered)
            .filter(|(_, offered)| **offered)
            .map(|((pair, value), _)| {
                let (upper, lower) = upper_lower(*pair, *value);
                HierarchyRelation {
                    upper_face: upper.0 as usize,
                    lower_face: lower.0 as usize,
                }
            })
            .collect()
    }

    /// Whether the committed constraints and `candidate` leave an order, and
    /// the fitting order closest to the one on screen with the spots it would
    /// change. Never changes the session.
    pub fn preview(
        &self,
        candidate: Constraint,
        limits: &Limits,
    ) -> Result<Preview, SessionRefusal> {
        let mut list = self.constraints.clone();
        list.push(candidate);
        self.preview_list(&list, limits)
    }

    /// Whether `list`, whatever is committed, leaves an order with the
    /// creases, and the fitting order closest to the one on screen with the
    /// spots it would change. Never changes the session. The dialog previews
    /// its own rows plus a new one this way when they are not what the
    /// session has committed, as after a restore whose constraints clashed
    /// (nothing is committed then). [`CantFit::constraints`] indexes `list`.
    pub fn preview_list(
        &self,
        list: &[Constraint],
        limits: &Limits,
    ) -> Result<Preview, SessionRefusal> {
        Ok(match self.solve(list, &[], Steer::Shown, limits)? {
            Solved::Fit(fit) => Preview::Fits(PreviewFit {
                changed: ChangedSpots::between(&self.shown.stacks, &fit.arrangement.stacks),
                arrangement: fit.arrangement,
                stage: fit.stage,
                nodes: fit.nodes,
                list: list.to_vec(),
                forced: fit.forced,
                session: self.id,
                generation: self.generation,
            }),
            Solved::CantFit(cant) => Preview::CantFit(cant),
            Solved::TimedOut(out) => Preview::TimedOut(out),
        })
    }

    /// Make `constraints` the committed list (Add, remove, undo, redo and
    /// Clear all are each a new list) and show the fitting order closest to
    /// the one on screen. A list the order on screen still fits, as any list
    /// that only lost constraints does, keeps it exactly. When the list
    /// cannot fit, or the check runs out of time, nothing changes.
    ///
    /// A carried row ([`Self::carried`]) whose constraint the list holds is
    /// applied by it, and leaves the carried rows.
    pub fn commit(
        &mut self,
        constraints: Vec<Constraint>,
        limits: &Limits,
    ) -> Result<Commit, SessionRefusal> {
        Ok(match self.solve(&constraints, &[], Steer::Shown, limits)? {
            Solved::Fit(fit) => {
                let committed = Committed {
                    changed: ChangedSpots::between(&self.shown.stacks, &fit.arrangement.stacks),
                    stage: fit.stage,
                    nodes: fit.nodes,
                };
                self.adopt(constraints, fit);
                Commit::Committed(committed)
            }
            Solved::CantFit(cant) => Commit::CantFit(cant),
            Solved::TimedOut(out) => Commit::TimedOut(out),
        })
    }

    /// Commit the list `fit` previewed, adopting its order with no search,
    /// when nothing has changed the session since the preview ran (Add after
    /// a preview that fit, which so cannot time out). A preview from another
    /// session, or one the session has moved on from, is committed as
    /// [`Self::commit`] commits its list, within `limits`.
    pub fn commit_preview(
        &mut self,
        fit: PreviewFit,
        limits: &Limits,
    ) -> Result<Commit, SessionRefusal> {
        if fit.session != self.id || fit.generation != self.generation {
            return self.commit(fit.list, limits);
        }
        let committed = Committed {
            changed: fit.changed,
            stage: fit.stage,
            nodes: fit.nodes,
        };
        self.adopt(
            fit.list,
            Fit {
                arrangement: fit.arrangement,
                forced: fit.forced,
                stage: fit.stage,
                nodes: fit.nodes,
            },
        );
        Ok(Commit::Committed(committed))
    }

    /// The order on screen, packed: one bit per variable in ascending order
    /// (bit `v % 8` of byte `v / 8`), set when the pair's smaller face is
    /// above. What [`Self::show`] takes back, so an undo can put an order
    /// back exactly; it means nothing to another session.
    pub fn shown_bits(&self) -> Vec<u8> {
        let mut bits = vec![0u8; self.shown.values.len().div_ceil(8)];
        for (v, value) in self.shown.values.iter().enumerate() {
            if *value == PairOrder::FirstAbove {
                bits[v / 8] |= 1 << (v % 8);
            }
        }
        bits
    }

    /// Make `constraints` the committed list and `bits` ([`Self::shown_bits`])
    /// the order on screen, exactly: the dialog's undo and redo, putting back
    /// an order the session showed with those constraints. No search: the
    /// order must satisfy every constraint, and be one the session has shown
    /// or pass a deduction with every pair seeded with its order, so one that
    /// breaks the creases or a constraint is [`Show::Refused`]. What the
    /// constraints force is deduced again. The solutions cursor stays good when
    /// the constraints are the ones committed. A carried row the list holds
    /// leaves the carried rows, as [`Self::commit`] has it.
    pub fn show(
        &mut self,
        constraints: Vec<Constraint>,
        bits: &[u8],
        limits: &Limits,
    ) -> Result<Show, SessionRefusal> {
        let n = self.variables.len();
        if bits.len() != n.div_ceil(8) {
            return Ok(Show::Refused);
        }
        let values: Vec<PairOrder> = (0..n)
            .map(|v| {
                if bits[v / 8] >> (v % 8) & 1 == 1 {
                    PairOrder::FirstAbove
                } else {
                    PairOrder::SecondAbove
                }
            })
            .collect();
        let Ok(seeds) = self.seeds_of(&constraints)? else {
            return Ok(Show::Refused);
        };
        if seeds.iter().any(|&(v, value)| values[v] != value) {
            return Ok(Show::Refused);
        }
        let deadline = limits.flatfold_deadline();
        let undecided = |limit| {
            Show::TimedOut(TimedOut {
                limit: complete::budget_limit(limit),
                nodes: 0,
            })
        };
        // The whole order fits the creases: one the session has shown, or every pair seeded with its
        // order closes with no conflict.
        if !self.seen.contains(&fingerprint(&values)) {
            let whole: Vec<Seed> = values.iter().copied().enumerate().collect();
            match self
                .solver
                .search()
                .deduce(&whole, deadline)
                .map_err(internal_search)?
            {
                Deduction::Deduced(_) => {}
                Deduction::Undecided { limit } => return Ok(undecided(limit)),
                Deduction::Forced { .. } | Deduction::Conflict(_) => return Ok(Show::Refused),
            }
        }
        // What the constraints force, as a commit of them would leave it.
        let forced = match self
            .solver
            .search()
            .deduce(&seeds, deadline)
            .map_err(internal_search)?
        {
            Deduction::Deduced(deduced) => deduced.forced(),
            Deduction::Undecided { limit } => return Ok(undecided(limit)),
            Deduction::Forced { .. } | Deduction::Conflict(_) => return Ok(Show::Refused),
        };
        let stacks = if values == self.shown.values {
            self.shown.stacks.clone()
        } else {
            self.spots.stacks(&self.variables, &values)
        };
        let committed = Committed {
            changed: ChangedSpots::between(&self.shown.stacks, &stacks),
            stage: CheckStage::Unchanged,
            nodes: 0,
        };
        self.adopt(
            constraints,
            Fit {
                arrangement: Arrangement {
                    variables: self.variables.clone(),
                    values,
                    stacks,
                },
                forced,
                stage: CheckStage::Unchanged,
                nodes: 0,
            },
        );
        Ok(Show::Shown(committed))
    }

    /// The saved form of the session (approach 6): the faces the constraints
    /// and the order name, ascending, by an interior paper point
    /// ([`LayerSource::interior_point`], the face's centroid unless the face
    /// is too thin to find it there) and their paper area; the constraints as
    /// built, then the carried rows a restore did not apply
    /// ([`Self::carried`]), each with the faces the record it came from
    /// saved, so nothing the user made is dropped; and the order on screen's
    /// pairs the creases leave free (the letters do not force them), each
    /// with its smaller face first. A host encodes it with
    /// [`super::encode_record`].
    pub fn save(&self) -> Result<LayerOrderRecord, SessionRefusal> {
        self.save_carrying(None)
    }

    /// [`Self::save`], writing back only the carried rows whose record index
    /// ([`CarriedConstraint::index`]) `keep` names: the rows a dialog still
    /// lists. The session is left as it was, so a save the host refuses
    /// leaves every carried row there for an undo to show again.
    pub fn save_keeping(&self, keep: &[usize]) -> Result<LayerOrderRecord, SessionRefusal> {
        self.save_carrying(Some(keep))
    }

    fn save_carrying(&self, keep: Option<&[usize]>) -> Result<LayerOrderRecord, SessionRefusal> {
        let letters = self.solver.search().forced();
        let free: Vec<usize> = (0..self.variables.len())
            .filter(|&v| letters[v].is_none())
            .collect();
        let mut named: Vec<FaceId> = self
            .constraints
            .iter()
            .flat_map(|c| [c.subject, c.object])
            .chain(free.iter().flat_map(|&v| self.variables[v].faces()))
            .collect();
        named.sort_unstable();
        named.dedup();
        let index = |face: FaceId| -> Result<u32, SessionRefusal> {
            named
                .binary_search(&face)
                .map(|i| i as u32)
                .map_err(|_| SessionRefusal::internal("a face the record names is unlisted"))
        };
        let mut faces = named
            .iter()
            .map(|&face| {
                Ok(RecordFace {
                    at: self.source.interior_point(face).ok_or_else(|| {
                        SessionRefusal::internal(format!("face {face} has no paper point"))
                    })?,
                    area: self.source.paper_area(face).ok_or_else(|| {
                        SessionRefusal::internal(format!("face {face} has no paper area"))
                    })?,
                })
            })
            .collect::<Result<Vec<_>, SessionRefusal>>()?;
        let mut constraints = self
            .constraints
            .iter()
            .map(|c| {
                Ok(RecordPair {
                    f: index(c.subject)?,
                    g: index(c.object)?,
                    sign: c.sign,
                })
            })
            .collect::<Result<Vec<_>, SessionRefusal>>()?;
        // The carried rows, after the faces this session names, by the faces
        // their record saved.
        let mut listed = |face: RecordFace| -> u32 {
            match faces.iter().position(|f| *f == face) {
                Some(i) => i as u32,
                None => {
                    faces.push(face);
                    (faces.len() - 1) as u32
                }
            }
        };
        let kept = self
            .carried
            .iter()
            .filter(|row| keep.is_none_or(|keep| keep.contains(&row.index)));
        for row in kept {
            let f = listed(row.subject);
            let g = listed(row.object);
            constraints.push(RecordPair {
                f,
                g,
                sign: row.sign,
            });
        }
        let view = self.source.view();
        let order = free
            .iter()
            .map(|&v| {
                let pair = self.variables[v];
                let lo_above = self.shown.values[v] == PairOrder::FirstAbove;
                let hi_up = view.front_up(pair.hi()).ok_or_else(|| {
                    SessionRefusal::internal(format!("face {} has no side", pair.hi()))
                })?;
                Ok(RecordPair {
                    f: index(pair.lo())?,
                    g: index(pair.hi())?,
                    sign: FoldSign::of_above(lo_above, hi_up),
                })
            })
            .collect::<Result<Vec<_>, SessionRefusal>>()?;
        Ok(LayerOrderRecord {
            faces,
            constraints,
            order,
            attention: None,
        })
    }

    // The engine below the calls.

    pub(crate) fn variable_of(&self, a: FaceId, b: FaceId) -> Option<usize> {
        let pair = FacePair::new(a, b)?;
        self.variables.binary_search(&pair).ok()
    }

    pub(crate) fn variables(&self) -> &[FacePair] {
        &self.variables
    }

    /// The variables, shared: one allocation per open session, which is
    /// how a solution count knows the session it counted.
    pub(crate) fn shared_variables(&self) -> &Arc<[FacePair]> {
        &self.variables
    }

    pub(crate) fn spots(&self) -> &Spots {
        &self.spots
    }

    pub(crate) fn is_offered(&self, v: usize) -> bool {
        self.offered[v]
    }

    /// The open's first order, one value per variable.
    pub(crate) fn first_values(&self) -> Vec<PairOrder> {
        self.solver.search().first()
    }

    /// The order on screen, one value per variable.
    pub(crate) fn shown_values(&self) -> &[PairOrder] {
        &self.shown.values
    }

    /// What the letters alone force, per variable.
    pub(crate) fn letter_forced(&self) -> Vec<Option<PairOrder>> {
        self.solver.search().forced()
    }

    /// The search opened over the letters.
    pub(crate) fn letter_search(&self) -> &flatfold::CompletionSession {
        self.solver.search()
    }

    /// Show `values`, a complete order that fits the committed constraints,
    /// keeping them and what they force: a stepper's move. The spots whose
    /// top face changes, per side.
    pub(crate) fn show_values(&mut self, values: Vec<PairOrder>) -> ChangedSpots {
        let stacks = self.spots.stacks(&self.variables, &values);
        let changed = ChangedSpots::between(&self.shown.stacks, &stacks);
        self.seen.insert(fingerprint(&values));
        self.shown = Arrangement {
            variables: self.variables.clone(),
            values,
            stacks,
        };
        self.generation += 1;
        changed
    }

    /// This session, among every session of the process.
    pub(crate) fn id(&self) -> u64 {
        self.id
    }

    /// Make `constraints` committed with the order `fit` found for them. A
    /// carried row they hold is applied, and leaves the carried rows.
    pub(crate) fn adopt(&mut self, constraints: Vec<Constraint>, fit: Fit) {
        self.carried
            .retain(|row| row.constraint.is_none_or(|c| !constraints.contains(&c)));
        self.constraints = constraints;
        self.seen.insert(fingerprint(&fit.arrangement.values));
        self.shown = fit.arrangement;
        self.forced = fit.forced;
        self.generation += 1;
    }

    /// The carried rows, for the restore that sets them.
    pub(crate) fn carried_mut(&mut self) -> &mut Vec<CarriedConstraint> {
        &mut self.carried
    }

    pub(crate) fn carried_rows(&self) -> &[CarriedConstraint] {
        &self.carried
    }

    /// Where the order shown came from, for the open or restore that sets it.
    pub(crate) fn set_opened_on(&mut self, opened_on: OpenedOn) {
        self.opened_on = opened_on;
    }

    /// Commit no constraints and show `values`, a complete order that fits
    /// the letters, with `forced` what the letters force: a restore whose
    /// constraints clashed or ran out of time commits none.
    pub(crate) fn show_unconstrained(
        &mut self,
        values: Vec<PairOrder>,
        forced: Vec<Option<PairOrder>>,
    ) {
        self.seen.insert(fingerprint(&values));
        self.shown = Arrangement {
            stacks: self.spots.stacks(&self.variables, &values),
            variables: self.variables.clone(),
            values,
        };
        self.forced = forced;
        self.constraints = Vec::new();
        self.generation += 1;
    }

    /// One seed per constraint, in list order, or why the list is no
    /// question, or the two constraints that order one pair both ways.
    pub(crate) fn seeds_of(
        &self,
        list: &[Constraint],
    ) -> Result<Result<Vec<Seed>, CantFit>, SessionRefusal> {
        let view = self.source.view();
        let mut seeds: Vec<Seed> = Vec::with_capacity(list.len());
        for (index, c) in list.iter().enumerate() {
            let bad = |fault| SessionRefusal::BadConstraint { index, fault };
            for face in [c.subject, c.object] {
                if view.front_up(face).is_none() {
                    return Err(bad(ConstraintFault::UnknownFace { face }));
                }
            }
            if c.subject == c.object {
                return Err(bad(ConstraintFault::SameFace));
            }
            let Some(v) = self.variable_of(c.subject, c.object) else {
                return Err(bad(ConstraintFault::NotOverlapping));
            };
            if !self.offered[v] {
                return Err(bad(ConstraintFault::NotOffered));
            }
            let subject_above = c
                .subject_above(view)
                .ok_or_else(|| SessionRefusal::internal("a face has no side"))?;
            let lo_above = subject_above == (c.subject == self.variables[v].lo());
            let value = if lo_above {
                PairOrder::FirstAbove
            } else {
                PairOrder::SecondAbove
            };
            if let Some(other) = seeds.iter().position(|&(w, x)| w == v && x != value) {
                return Ok(Err(CantFit {
                    proof: CantFitProof::Opposed,
                    faces: self.variables[v].faces().to_vec(),
                    constraints: vec![other, index],
                }));
            }
            seeds.push((v, value));
        }
        Ok(Ok(seeds))
    }

    /// Check the constraints `list` (with `extra` seeds after them, which are
    /// asked for but never reported as constraints) and find the fitting
    /// order closest to `steer`'s. An extra seed the other way from a
    /// constraint on its pair is a [`CantFitProof::Opposed`] naming that
    /// constraint; one the other way from another extra names none.
    pub(crate) fn solve(
        &self,
        list: &[Constraint],
        extra: &[Seed],
        steer: Steer<'_>,
        limits: &Limits,
    ) -> Result<Solved, SessionRefusal> {
        Ok(self.solve_counted(list, extra, steer, limits)?.0)
    }

    /// [`Self::solve`], and the search nodes it spent (none for an answer
    /// propagation alone gave), so a caller asking many can take each one's
    /// out of one budget.
    pub(crate) fn solve_counted(
        &self,
        list: &[Constraint],
        extra: &[Seed],
        steer: Steer<'_>,
        limits: &Limits,
    ) -> Result<(Solved, u64), SessionRefusal> {
        let mut seeds = match self.seeds_of(list)? {
            Ok(seeds) => seeds,
            Err(cant) => return Ok((Solved::CantFit(cant), 0)),
        };
        let asked = seeds.len();
        // An extra seed against a constraint, or against another extra, on
        // one pair has no order: the search would refuse both orders of one
        // variable as malformed input.
        let mut wanted: BTreeMap<usize, (PairOrder, Option<usize>)> = seeds
            .iter()
            .enumerate()
            .map(|(i, &(v, value))| (v, (value, Some(i))))
            .collect();
        for &(v, value) in extra {
            match wanted.get(&v) {
                Some(&(other, by)) if other != value => {
                    let faces = self
                        .variables
                        .get(v)
                        .map_or_else(Vec::new, |pair| pair.faces().to_vec());
                    let opposed = CantFit {
                        proof: CantFitProof::Opposed,
                        faces,
                        constraints: by.into_iter().collect(),
                    };
                    return Ok((Solved::CantFit(opposed), 0));
                }
                Some(_) => {}
                None => {
                    wanted.insert(v, (value, None));
                }
            }
        }
        seeds.extend_from_slice(extra);
        // The order on screen already fits: keep it, and only deduce.
        if matches!(steer, Steer::Shown)
            && seeds
                .iter()
                .all(|&(v, value)| self.shown.values[v] == value)
        {
            let deduced = self
                .solver
                .search()
                .deduce(&seeds, limits.flatfold_deadline())
                .map_err(internal_search)?;
            let solved = match deduced {
                Deduction::Deduced(deduced) => Solved::Fit(Fit {
                    arrangement: self.shown.clone(),
                    forced: deduced.forced(),
                    stage: CheckStage::Unchanged,
                    nodes: 0,
                }),
                Deduction::Forced {
                    variable,
                    error_faces,
                    ..
                } => Solved::CantFit(self.forced_cant_fit(
                    variable,
                    &error_faces,
                    &seeds[..asked],
                )?),
                Deduction::Conflict(conflict) => Solved::CantFit(CantFit {
                    proof: CantFitProof::Conflict {
                        family: complete::constraint_family(conflict.constraint),
                    },
                    faces: self.face_ids(&conflict.error_faces)?,
                    constraints: self.rooted(&conflict.roots, &seeds[..asked]),
                }),
                Deduction::Undecided { limit } => Solved::TimedOut(TimedOut {
                    limit: complete::budget_limit(limit),
                    nodes: 0,
                }),
            };
            return Ok((solved, 0));
        }
        let (prefer, prefer_fits) = match steer {
            Steer::Shown => (self.shown.values.as_slice(), true),
            Steer::Toward(values) => (values, false),
        };
        let options = CheckOptions {
            budget: complete::search_budget(limits.max_nodes, limits.deadline),
            fast_nodes: limits.fast_nodes,
            prefer: Some(prefer),
            prefer_fits,
        };
        let outcome = self
            .solver
            .search()
            .check(&seeds, &options)
            .map_err(internal_search)?;
        let nodes = match &outcome {
            CheckOutcome::Fits(fit) => fit.nodes,
            CheckOutcome::NoOrder(none) => none.nodes,
            CheckOutcome::Undecided { nodes, .. } => *nodes,
            CheckOutcome::Forced { .. } | CheckOutcome::Conflict(_) => 0,
        };
        let solved = match outcome {
            CheckOutcome::Fits(fit) => {
                let stacks = if fit.order == self.shown.values {
                    self.shown.stacks.clone()
                } else {
                    self.spots.stacks(&self.variables, &fit.order)
                };
                Solved::Fit(Fit {
                    arrangement: Arrangement {
                        variables: self.variables.clone(),
                        values: fit.order,
                        stacks,
                    },
                    forced: fit.forced,
                    stage: complete::check_stage(fit.stage),
                    nodes: fit.nodes,
                })
            }
            CheckOutcome::Forced {
                variable,
                error_faces,
                ..
            } => Solved::CantFit(self.forced_cant_fit(variable, &error_faces, &seeds[..asked])?),
            CheckOutcome::Conflict(conflict) => Solved::CantFit(CantFit {
                proof: CantFitProof::Conflict {
                    family: complete::constraint_family(conflict.constraint),
                },
                faces: self.face_ids(&conflict.error_faces)?,
                constraints: self.rooted(&conflict.roots, &seeds[..asked]),
            }),
            CheckOutcome::NoOrder(none) => Solved::CantFit(CantFit {
                proof: CantFitProof::NoOrder {
                    faces: sorted(self.face_ids(&none.faces)?),
                },
                faces: self.face_ids(&none.error_faces)?,
                constraints: self.rooted(&none.roots, &seeds[..asked]),
            }),
            CheckOutcome::Undecided { limit, nodes } => Solved::TimedOut(TimedOut {
                limit: complete::budget_limit(limit),
                nodes,
            }),
        };
        Ok((solved, nodes))
    }

    /// A seed against what the letters force: the constraints on that pair.
    fn forced_cant_fit(
        &self,
        variable: usize,
        error_faces: &[usize],
        asked: &[Seed],
    ) -> Result<CantFit, SessionRefusal> {
        Ok(CantFit {
            proof: CantFitProof::Forced,
            faces: self.face_ids(error_faces)?,
            constraints: asked
                .iter()
                .enumerate()
                .filter(|(_, (v, _))| *v == variable)
                .map(|(i, _)| i)
                .collect(),
        })
    }

    /// The constraints among a proof's roots. A constraint on a pair the
    /// letters already force its way adds nothing to a proof, so it is never
    /// named.
    fn rooted(&self, roots: &[usize], asked: &[Seed]) -> Vec<usize> {
        let letters = self.solver.search().forced();
        asked
            .iter()
            .enumerate()
            .filter(|(_, (v, _))| letters[*v].is_none() && roots.binary_search(v).is_ok())
            .map(|(i, _)| i)
            .collect()
    }

    fn face_ids(&self, faces: &[usize]) -> Result<Vec<FaceId>, SessionRefusal> {
        self.solver
            .face_ids(faces)
            .map_err(|refusal| SessionRefusal::internal(refusal.to_string()))
    }
}

fn sorted(mut faces: Vec<FaceId>) -> Vec<FaceId> {
    faces.sort_unstable();
    faces
}

/// A refusal of the letters' own completion as the session's.
fn open_refusal(refusal: CompletionRefusal) -> SessionRefusal {
    match refusal {
        CompletionRefusal::Conflict { traced, .. } => SessionRefusal::NoOrder {
            faces: sorted(traced),
        },
        CompletionRefusal::NoOrder { faces } => SessionRefusal::NoOrder {
            faces: sorted(faces),
        },
        CompletionRefusal::BudgetExceeded { limit, nodes } => {
            SessionRefusal::TimedOut { limit, nodes }
        }
        other => SessionRefusal::internal(other.to_string()),
    }
}

/// The search refused its input: the session asked it something malformed.
pub(crate) fn internal_search(error: CompletionError) -> SessionRefusal {
    SessionRefusal::internal(complete::search_refusal(error).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use oristudio_cp::session::CpSession;

    fn kabuto() -> ConstraintSession {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/fixtures/flat-folder/kabuto.fold");
        let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{e}"));
        let mut cp = CpSession::new();
        let document = cp.load_fold(&text, "").unwrap_or_else(|e| panic!("{e:?}"));
        let lines: Vec<usize> = (1..=cp
            .document_summary(document)
            .map(|s| s.line_segments)
            .unwrap_or(0))
            .collect();
        let fold = cp
            .fold_source_of_selection(document, &lines, 1)
            .unwrap_or_else(|e| panic!("{e:?}"));
        let source = LayerSource::from_oriedita(&fold).unwrap_or_else(|e| panic!("{e}"));
        ConstraintSession::open(source, &Limits::default()).unwrap_or_else(|e| panic!("{e}"))
    }

    /// An extra seed the other way from a constraint, or from another extra,
    /// on one pair is a can't-fit naming the constraint, not a malformed
    /// question for the search.
    #[test]
    fn an_extra_seed_against_a_constraint_cannot_fit() {
        let session = kabuto();
        let pair = session.open_pairs()[0];
        let v = session.variable_of(pair.lo(), pair.hi()).unwrap_or(0);
        let view = session.source().view();
        let lo_above =
            Constraint::seen(pair.lo(), Verb::InFrontOf, pair.hi(), ViewSide::Front, view)
                .unwrap_or_else(|| panic!("faces"));
        let against = (v, PairOrder::SecondAbove);
        for (list, extra, named) in [
            (vec![lo_above], vec![against], vec![0]),
            (
                Vec::new(),
                vec![(v, PairOrder::FirstAbove), against],
                Vec::new(),
            ),
        ] {
            match session.solve(&list, &extra, Steer::Shown, &Limits::default()) {
                Ok(Solved::CantFit(cant)) => {
                    assert_eq!(cant.proof, CantFitProof::Opposed);
                    assert_eq!(cant.constraints, named);
                }
                other => panic!("{other:?}"),
            }
        }
        // The same way is no clash.
        let agreeing = session.solve(
            &[lo_above],
            &[(v, PairOrder::FirstAbove)],
            Steer::Shown,
            &Limits::default(),
        );
        assert!(matches!(agreeing, Ok(Solved::Fit(_))));
    }
}

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
//! Every question is one of four, and only [`ConstraintSession::commit`]
//! changes the session:
//!
//! | Call | Searches | Changes the session |
//! | --- | --- | --- |
//! | [`open`](ConstraintSession::open) | one deduction pass, and one order per independent part | – |
//! | [`preview`](ConstraintSession::preview) | the committed constraints plus one candidate | never |
//! | [`commit`](ConstraintSession::commit) | the whole new list | only when it fits |
//! | [`restore`](ConstraintSession::restore) | a saved record on (possibly edited) creases | – (it opens one) |
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
//! stops it. So Add commits exactly the order its preview showed.
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

use std::sync::Arc;

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
use super::source::LayerSource;
use super::stacks::{ChangedSpots, Spots, Stacks, ViewSide};
use crate::complete::{
    self, BudgetLimit, CheckLimits, CheckStage, CompletionLimits, CompletionRefusal,
    CompletionSession, ConstraintFamily, Deadline,
};
use crate::pattern::FaceId;

/// What one call may spend: a node budget and a deadline, for the open, a
/// preview, a commit and a restore alike.
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
            SessionRefusal::Internal { .. } => "session_internal",
        }
    }

    fn internal(message: impl Into<String>) -> SessionRefusal {
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

fn upper_lower(pair: FacePair, value: PairOrder) -> (FaceId, FaceId) {
    match value {
        PairOrder::FirstAbove => (pair.lo(), pair.hi()),
        PairOrder::SecondAbove => (pair.hi(), pair.lo()),
    }
}

/// A preview that fits: the fitting order closest to the one on screen.
#[derive(Debug, Clone, PartialEq)]
pub struct PreviewFit {
    arrangement: Arrangement,
    /// The spots whose top face would change, per side.
    pub changed: ChangedSpots,
    /// The last step of the check that had to search.
    pub stage: CheckStage,
    pub nodes: u64,
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
    /// The spots whose top face changed, per side.
    pub changed: ChangedSpots,
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
}

impl ConstraintSession {
    /// Open a session over `source`: the letters' deduction, a first order of
    /// every independent part (the order shown first), no constraints.
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
        })
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
        self.variables
            .iter()
            .zip(&self.shown.values)
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
        Ok(match self.solve(&list, &[], Steer::Shown, limits)? {
            Solved::Fit(fit) => Preview::Fits(PreviewFit {
                changed: ChangedSpots::between(&self.shown.stacks, &fit.arrangement.stacks),
                arrangement: fit.arrangement,
                stage: fit.stage,
                nodes: fit.nodes,
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

    /// The saved form of the session (approach 6): the faces the constraints
    /// and the order name, ascending, by an interior paper point and their
    /// paper area; the constraints as built; and the order on screen's pairs
    /// the creases leave free (the letters do not force them), each with
    /// its smaller face first. A host encodes it with
    /// [`super::encode_record`].
    pub fn save(&self) -> Result<LayerOrderRecord, SessionRefusal> {
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
        let faces = named
            .iter()
            .map(|&face| {
                Ok(RecordFace {
                    at: self.source.paper_point(face).ok_or_else(|| {
                        SessionRefusal::internal(format!("face {face} has no paper point"))
                    })?,
                    area: self.source.paper_area(face).ok_or_else(|| {
                        SessionRefusal::internal(format!("face {face} has no paper area"))
                    })?,
                })
            })
            .collect::<Result<Vec<_>, SessionRefusal>>()?;
        let constraints = self
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

    /// Make `constraints` committed with the order `fit` found for them.
    pub(crate) fn adopt(&mut self, constraints: Vec<Constraint>, fit: Fit) {
        self.constraints = constraints;
        self.shown = fit.arrangement;
        self.forced = fit.forced;
    }

    /// Commit no constraints and show `values`, a complete order that fits
    /// the letters, with `forced` what the letters force: a restore whose
    /// constraints clashed or ran out of time commits none.
    pub(crate) fn show_unconstrained(
        &mut self,
        values: Vec<PairOrder>,
        forced: Vec<Option<PairOrder>>,
    ) {
        self.shown = Arrangement {
            stacks: self.spots.stacks(&self.variables, &values),
            variables: self.variables.clone(),
            values,
        };
        self.forced = forced;
        self.constraints = Vec::new();
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
    /// order closest to `steer`'s.
    pub(crate) fn solve(
        &self,
        list: &[Constraint],
        extra: &[Seed],
        steer: Steer<'_>,
        limits: &Limits,
    ) -> Result<Solved, SessionRefusal> {
        let mut seeds = match self.seeds_of(list)? {
            Ok(seeds) => seeds,
            Err(cant) => return Ok(Solved::CantFit(cant)),
        };
        let asked = seeds.len();
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
            return Ok(match deduced {
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
            });
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
        Ok(match outcome {
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
        })
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
fn internal_search(error: CompletionError) -> SessionRefusal {
    SessionRefusal::internal(complete::search_refusal(error).to_string())
}

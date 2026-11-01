//! The Layer order dialog's constraint sessions, held by handle
//! ([`LayerSessions`]), and every call on them in plain Rust: what
//! [`super::bindings`] puts on `FoldEngine` and `tests/layer_session.rs`
//! drives natively.
//!
//! A session is `oristudio_fold::steer::ConstraintSession` over the solver's
//! view of exactly what the host folded (`LayerSource::from_oriedita`). It
//! stays here, by handle, until it is closed or its worker is terminated; a
//! worker that is respawned starts with none.
//!
//! **Add adopts its preview.** Beside each session the store keeps the last
//! preview that fit, under the token that preview answered with
//! ([`PreviewFits::token`]), until the next preview, commit or restore. A
//! commit by that token and the list it checked
//! ([`LayerSessions::commit_preview`]) adopts the previewed order with no
//! search, so Add cannot run out of time right after a preview that fit; any
//! other token commits the list by a search, as [`LayerSessions::commit`]
//! does.
//!
//! **The count lives beside the session.** There is no count worker: the
//! dialog's one worker advances a solutions cursor
//! ([`LayerSessions::solutions_start`]) in short slices between its other
//! calls, and the same cursor serves the count, the index and the stepper.
//! A step drops the kept preview, as it moves the order on screen.

use std::collections::HashMap;

use oristudio_cp::folding::{FoldedFigureModel, FoldedPaperScene};
use oristudio_cp::session::FoldSource;
use oristudio_fold::steer::{
    Commit, Committed, ConstraintSession, ConstraintStatus, EncodeRefusal, FaceStatus,
    LayerOrderRecord, LayerSource, Position, Preview, PreviewFit, RecordRead, RestoreOutcome,
    Restored, SavedPairStatus, Show, SolutionCount, Solutions, StepBy, StepDirection, Stepped,
    ViewSide, encode_record, read_record,
};

use super::wire::{
    CarriedRow, CommitDone, Committing, Explained, LayerCallError, LayerLimits, LayerOpened,
    LayerRefusal, LayerRestored, LayerSolutionCaps, OpenedOnWire, Opening, PackedStacks,
    PreviewFits, Previewed, Restoring, SavedFaces, Saving, Showing, Sides, SteppedTo, Stepping,
    candidate_of, carried_rows, constraints_of, flat_pairs, order_status, relations_of,
    session_refusal, source_refusal, thrown, triples_of,
};
use crate::ops_crimp_tuck::clock;

/// Every constraint session the caller still holds. Handles start at 1 and
/// are never reused while this store lives; nor are preview tokens or
/// solutions cursors.
#[derive(Debug, Default)]
pub struct LayerSessions {
    held: HashMap<u32, Held>,
    last: u32,
    tokens: u32,
    cursors: u32,
}

/// A session, its last preview that fit, and its solutions cursors.
#[derive(Debug)]
struct Held {
    session: ConstraintSession,
    preview: Option<(u32, PreviewFit)>,
    /// E6's counts, by cursor. A cursor is good for the committed
    /// constraints it started on: after a commit or a restore to other
    /// constraints every call on it is refused (`session_stale_solutions`),
    /// and a commit back to those constraints makes it good again, as E6
    /// decides. A step keeps it. Closed with the session.
    cursors: HashMap<u32, Solutions>,
}

impl Held {
    fn new(session: ConstraintSession) -> Held {
        Held {
            session,
            preview: None,
            cursors: HashMap::new(),
        }
    }
}

impl LayerSessions {
    pub fn new() -> LayerSessions {
        LayerSessions::default()
    }

    /// Open a session on what a host folded: the letters' deduction and the
    /// solver's first order of every independent part, with no constraints.
    pub fn open(
        &mut self,
        source: &FoldSource,
        limits: &LayerLimits,
    ) -> Result<Opening, LayerCallError> {
        let limits = limits.limits(clock::now_ms)?;
        let layer = match LayerSource::from_oriedita(source) {
            Ok(layer) => layer,
            Err(refusal) => return source_refusal(refusal).map(Opening::Refused),
        };
        match ConstraintSession::open(layer, &limits) {
            Ok(session) => Ok(Opening::Opened(self.hold(session))),
            Err(refusal) => session_refusal(refusal).map(Opening::Refused),
        }
    }

    /// Open a session on what a host folded, showing the order the host
    /// shows: `relations`, flat `[upper, lower, …]` in Oriedita's frame, held
    /// whole when they fit, else the fitting order closest to them
    /// ([`LayerOpened::opened_on`] says which).
    pub fn open_showing(
        &mut self,
        source: &FoldSource,
        relations: &[u32],
        limits: &LayerLimits,
    ) -> Result<Opening, LayerCallError> {
        let limits = limits.limits(clock::now_ms)?;
        let relations = relations_of(relations)?;
        let layer = match LayerSource::from_oriedita(source) {
            Ok(layer) => layer,
            Err(refusal) => return source_refusal(refusal).map(Opening::Refused),
        };
        match ConstraintSession::open_showing(layer, &relations, &limits) {
            Ok(session) => Ok(Opening::Opened(self.hold(session))),
            Err(refusal) => session_refusal(refusal).map(Opening::Refused),
        }
    }

    /// Open a session on what a host folded and restore a saved record onto
    /// it (decision D10): the record as the host stores it, one JSON string.
    /// The session is held whatever the outcome; a clash or a timeout
    /// commits no constraint, the rows say why, and every saved constraint
    /// not applied is carried.
    pub fn restore(
        &mut self,
        source: &FoldSource,
        record: &str,
        limits: &LayerLimits,
    ) -> Result<Restoring, LayerCallError> {
        let limits = limits.limits(clock::now_ms)?;
        let record = match readable(record) {
            Ok(record) => record,
            Err(refusal) => return Ok(Restoring::Refused(refusal)),
        };
        let layer = match LayerSource::from_oriedita(source) {
            Ok(layer) => layer,
            Err(refusal) => return source_refusal(refusal).map(Restoring::Refused),
        };
        let Restored {
            session,
            faces,
            constraints,
            order,
            outcome,
        } = match ConstraintSession::restore(layer, &record, &limits) {
            Ok(restored) => restored,
            Err(refusal) => return session_refusal(refusal).map(Restoring::Refused),
        };
        let found = Found {
            faces: &faces,
            constraints,
            order: &order,
            outcome,
        };
        let handle = self.next_handle();
        let restored = restored_of(opened_of(handle, &session), &session, found);
        self.held.insert(handle, Held::new(session));
        Ok(Restoring::Restored(Box::new(restored)))
    }

    /// Restore `record` again on an open session (a retry after "couldn't
    /// check in time", or the host engine's next try), without building the
    /// source or opening again: the session is put back as it opened and
    /// restored as a fresh one would be. Answers as [`Self::restore`] does,
    /// under the same handle. A record that does not read leaves the session
    /// as it was.
    pub fn restore_record(
        &mut self,
        session: u32,
        record: &str,
        limits: &LayerLimits,
    ) -> Result<Restoring, LayerCallError> {
        let limits = limits.limits(clock::now_ms)?;
        let held = self.held_mut(session)?;
        let record = match readable(record) {
            Ok(record) => record,
            Err(refusal) => return Ok(Restoring::Refused(refusal)),
        };
        let report = match held.session.restore_record(&record, &limits) {
            Ok(report) => report,
            Err(refusal) => return session_refusal(refusal).map(Restoring::Refused),
        };
        held.preview = None;
        let found = Found {
            faces: &report.faces,
            constraints: report.constraints,
            order: &report.order,
            outcome: report.outcome,
        };
        let opened = opened_of(session, &held.session);
        Ok(Restoring::Restored(Box::new(restored_of(
            opened,
            &held.session,
            found,
        ))))
    }

    /// Where the order on screen came from at open or the last restore.
    pub fn opened_on(&self, session: u32) -> Result<OpenedOnWire, LayerCallError> {
        Ok(self.session(session)?.opened_on().into())
    }

    /// The pairs deduction leaves open, flat (see [`LayerOpened::open_pairs`]).
    pub fn open_pairs(&self, session: u32) -> Result<Vec<u32>, LayerCallError> {
        Ok(flat_pairs(&self.session(session)?.open_pairs()))
    }

    /// The committed constraints, as triples, in the order made.
    pub fn constraints(&self, session: u32) -> Result<Vec<i32>, LayerCallError> {
        Ok(triples_of(self.session(session)?.constraints()))
    }

    /// Whether the committed constraints and `candidate` (one triple) leave
    /// an order, and the fitting one closest to the order on screen. Never
    /// changes what the session shows or commits; a fit is kept under its
    /// token for [`Self::commit_preview`]. A timeout is no verdict: keep
    /// trying is the same call with a larger `deadlineMs`.
    pub fn preview(
        &mut self,
        session: u32,
        candidate: &[i32],
        limits: &LayerLimits,
    ) -> Result<Previewed, LayerCallError> {
        let limits = limits.limits(clock::now_ms)?;
        let candidate = candidate_of(candidate)?;
        let LayerSessions { held, tokens, .. } = self;
        let held = held
            .get_mut(&session)
            .ok_or(LayerCallError::UnknownSession(session))?;
        let preview = held.session.preview(candidate, &limits).map_err(thrown)?;
        Ok(keep(held, tokens, preview))
    }

    /// Whether `constraints` (triples), whatever is committed, leave an
    /// order with the creases: the dialog's own rows plus a new one, when
    /// they are not what the session committed (after a restore whose
    /// constraints clashed, nothing is). Never commits; a fit is kept under
    /// its token, as [`Self::preview`]'s is. A no's `constraints` index this
    /// list.
    pub fn preview_list(
        &mut self,
        session: u32,
        constraints: &[i32],
        limits: &LayerLimits,
    ) -> Result<Previewed, LayerCallError> {
        let limits = limits.limits(clock::now_ms)?;
        let list = constraints_of(constraints)?;
        let LayerSessions { held, tokens, .. } = self;
        let held = held
            .get_mut(&session)
            .ok_or(LayerCallError::UnknownSession(session))?;
        let preview = held.session.preview_list(&list, &limits).map_err(thrown)?;
        Ok(keep(held, tokens, preview))
    }

    /// Make `constraints` (triples) the committed list: Add, remove, undo,
    /// redo and Clear all are each a new list. A list that cannot fit, or
    /// runs out of time, changes nothing. A carried row whose constraint the
    /// list holds is applied, and leaves the carried rows.
    pub fn commit(
        &mut self,
        session: u32,
        constraints: &[i32],
        limits: &LayerLimits,
    ) -> Result<Committing, LayerCallError> {
        let limits = limits.limits(clock::now_ms)?;
        let list = constraints_of(constraints)?;
        let held = self.held_mut(session)?;
        held.preview = None;
        let commit = held.session.commit(list, &limits).map_err(thrown)?;
        Ok(committing(&held.session, commit, false))
    }

    /// Add by a preview: when `token` is the session's last preview that fit
    /// and `constraints` (triples) is the list it checked, its order is
    /// adopted with no search (`adopted`), so it cannot run out of time.
    /// Otherwise (a stale or unknown token, or another list) the list is
    /// committed by a search within `limits`, as [`Self::commit`] does.
    pub fn commit_preview(
        &mut self,
        session: u32,
        token: u32,
        constraints: &[i32],
        limits: &LayerLimits,
    ) -> Result<Committing, LayerCallError> {
        let limits = limits.limits(clock::now_ms)?;
        let list = constraints_of(constraints)?;
        let held = self.held_mut(session)?;
        let (commit, adopted) = match held.preview.take() {
            Some((kept, fit)) if kept == token && fit.constraints() == list.as_slice() => {
                (held.session.commit_preview(fit, &limits), true)
            }
            _ => (held.session.commit(list, &limits), false),
        };
        let commit = commit.map_err(thrown)?;
        Ok(committing(&held.session, commit, adopted))
    }

    /// The order on screen, packed one bit per variable
    /// ([`ConstraintSession::shown_bits`]): what [`Self::show`] puts back.
    pub fn order(&self, session: u32) -> Result<Vec<u8>, LayerCallError> {
        Ok(self.session(session)?.shown_bits())
    }

    /// Undo and redo: make `constraints` (triples) the committed list and
    /// `order` ([`Self::order`]'s, from earlier) the order on screen,
    /// exactly, with no search ([`ConstraintSession::show`]). A cursor
    /// counting the same constraints stays good.
    pub fn show(
        &mut self,
        session: u32,
        constraints: &[i32],
        order: &[u8],
        limits: &LayerLimits,
    ) -> Result<Showing, LayerCallError> {
        let limits = limits.limits(clock::now_ms)?;
        let list = constraints_of(constraints)?;
        let held = self.held_mut(session)?;
        Ok(
            match held.session.show(list, order, &limits).map_err(thrown)? {
                Show::Shown(done) => {
                    held.preview = None;
                    Showing::Shown(commit_done(&held.session, done, false))
                }
                Show::Refused => Showing::Refused,
                Show::TimedOut(out) => Showing::TimedOut(out),
            },
        )
    }

    /// The saved constraints the last restore did not apply, and nothing has
    /// committed or removed since, in record order.
    pub fn carried(&self, session: u32) -> Result<Vec<CarriedRow>, LayerCallError> {
        Ok(carried_rows(self.session(session)?.carried()))
    }

    /// Remove the carried row of record index `index` (its `index`, never its
    /// place in [`Self::carried`]), so a save no longer writes it; whether
    /// there was one.
    pub fn remove_carried(&mut self, session: u32, index: usize) -> Result<bool, LayerCallError> {
        Ok(self
            .held_mut(session)?
            .session
            .remove_carried(index)
            .is_some())
    }

    /// Remove every carried row, as Clear all does with the committed ones.
    pub fn clear_carried(&mut self, session: u32) -> Result<(), LayerCallError> {
        self.held_mut(session)?.session.clear_carried();
        Ok(())
    }

    /// Why the committed constraints and `candidate` (one triple) can't
    /// fit: the smallest set of them that clash (E6). `maxNodes` bounds each
    /// check the deletion filter makes and the deadline the whole call; out
    /// of time it answers the set it has, not minimal. Never changes the
    /// session.
    pub fn explain(
        &self,
        session: u32,
        candidate: &[i32],
        limits: &LayerLimits,
    ) -> Result<Explained, LayerCallError> {
        let limits = limits.limits(clock::now_ms)?;
        let candidate = candidate_of(candidate)?;
        let explanation = self
            .session(session)?
            .explain(candidate, &limits)
            .map_err(thrown)?;
        Ok(explanation.into())
    }

    /// [`Self::explain`] for any list (triples): a restored record's rows
    /// that clash. Indices are into the list.
    pub fn explain_list(
        &self,
        session: u32,
        constraints: &[i32],
        limits: &LayerLimits,
    ) -> Result<Explained, LayerCallError> {
        let limits = limits.limits(clock::now_ms)?;
        let list = constraints_of(constraints)?;
        let explanation = self
            .session(session)?
            .explain_list(&list, &limits)
            .map_err(thrown)?;
        Ok(explanation.into())
    }

    /// Start counting the solutions the committed constraints leave, and
    /// the stepper's order through them (E6): a cursor beside the session,
    /// counted only when advanced. The dialog's one worker advances it in
    /// short slices between its other calls.
    pub fn solutions_start(
        &mut self,
        session: u32,
        caps: &LayerSolutionCaps,
    ) -> Result<u32, LayerCallError> {
        let LayerSessions { held, cursors, .. } = self;
        let held = held
            .get_mut(&session)
            .ok_or(LayerCallError::UnknownSession(session))?;
        let solutions = held.session.solutions_with(caps.caps()).map_err(thrown)?;
        let cursor = loop {
            *cursors = cursors.wrapping_add(1);
            if *cursors != 0 && !held.cursors.contains_key(cursors) {
                break *cursors;
            }
        };
        held.cursors.insert(cursor, solutions);
        Ok(cursor)
    }

    /// Count on within `limits` (a slice: a small `maxNodes`, one per node
    /// of a component's search and one per combination walked, and a short
    /// `deadlineMs`), resuming where the last slice stopped, and say what is
    /// counted so far. Any slicing ends equal to a one-shot count. Refused
    /// on a stale cursor.
    pub fn solutions_advance(
        &mut self,
        session: u32,
        cursor: u32,
        limits: &LayerLimits,
    ) -> Result<SolutionCount, LayerCallError> {
        let limits = limits.limits(clock::now_ms)?;
        let held = self.held_mut(session)?;
        let solutions = held
            .cursors
            .get_mut(&cursor)
            .ok_or(LayerCallError::UnknownCursor { session, cursor })?;
        solutions.advance(&held.session, &limits).map_err(thrown)
    }

    /// Where the order on screen lies in the stepper's fixed order ("3 of
    /// 12"): from 1, final once `total` is exact. Refused on a stale cursor.
    pub fn solutions_position(
        &self,
        session: u32,
        cursor: u32,
        by: StepBy,
    ) -> Result<Position, LayerCallError> {
        let held = self
            .held
            .get(&session)
            .ok_or(LayerCallError::UnknownSession(session))?;
        let solutions = held
            .cursors
            .get(&cursor)
            .ok_or(LayerCallError::UnknownCursor { session, cursor })?;
        held.session.position(solutions, by).map_err(thrown)
    }

    /// Show the next or the previous solution (E6): with a picture from a
    /// side, the closest layer order within the next picture; with
    /// `layer_order` (X-ray), the next layer order. Only the order on
    /// screen changes: the cursor stays good, and a preview kept from
    /// before is dropped (Add then commits from the stepped order). Before
    /// the count has every solution it steps through, the step searches for
    /// the one the count would list next (E9) and then counts on for a
    /// tenth of its limits; once it has, it counts on within half its
    /// limits first.
    pub fn step(
        &mut self,
        session: u32,
        cursor: u32,
        by: StepBy,
        direction: StepDirection,
        limits: &LayerLimits,
    ) -> Result<Stepping, LayerCallError> {
        let limits = limits.limits(clock::now_ms)?;
        let held = self.held_mut(session)?;
        let solutions = held
            .cursors
            .get_mut(&cursor)
            .ok_or(LayerCallError::UnknownCursor { session, cursor })?;
        let stepped = held
            .session
            .step(solutions, by, direction, &limits)
            .map_err(thrown)?;
        Ok(match stepped {
            Stepped::Moved(moved) => {
                held.preview = None;
                Stepping::Moved(SteppedTo {
                    changed: moved.changed,
                    position: moved.position,
                    stacks: Sides {
                        front: PackedStacks::from(&held.session.stacks(ViewSide::Front)),
                        back: PackedStacks::from(&held.session.stacks(ViewSide::Back)),
                    },
                })
            }
            Stepped::End => Stepping::End,
            Stepped::TimedOut(out) => Stepping::TimedOut(out),
        })
    }

    /// Let a cursor go; whether it was held.
    pub fn solutions_close(&mut self, session: u32, cursor: u32) -> Result<bool, LayerCallError> {
        Ok(self.held_mut(session)?.cursors.remove(&cursor).is_some())
    }

    /// The order on screen's stacks from `side`.
    pub fn stacks(&self, session: u32, side: ViewSide) -> Result<PackedStacks, LayerCallError> {
        Ok(PackedStacks::from(&self.session(session)?.stacks(side)))
    }

    /// The paper scene of the order on screen from `side`, with the host's
    /// model, through the CP kernel's own builder: what Apply's new handle
    /// will draw. `None` when the figure has no subfaces.
    pub fn scene(
        &self,
        session: u32,
        side: ViewSide,
        model: &FoldedFigureModel,
    ) -> Result<Option<FoldedPaperScene>, LayerCallError> {
        self.session(session)?.scene(side, model).map_err(thrown)
    }

    /// The order on screen as Oriedita's relations, flat
    /// `[upper, lower, …]`: what the CP bridge's
    /// `folded_figure_fold_with_order` takes at Apply.
    pub fn oriedita_relations(&self, session: u32) -> Result<Vec<u32>, LayerCallError> {
        Ok(self
            .session(session)?
            .oriedita_relations()
            .iter()
            .flat_map(|r| [face_index(r.upper_face), face_index(r.lower_face)])
            .collect())
    }

    /// The saved record, encoded: the committed constraints, then the
    /// carried rows as their record saved them: every one, or with `keep`
    /// only those whose record index it names (the session keeps them all).
    /// Refused only when it would be over the record budget (1 MB).
    pub fn save(&self, session: u32, keep: Option<&[usize]>) -> Result<Saving, LayerCallError> {
        let held = self.session(session)?;
        let record = match keep {
            Some(keep) => held.save_keeping(keep),
            None => held.save(),
        }
        .map_err(thrown)?;
        match encode_record(&record) {
            Ok(json) => Ok(Saving::Saved { json }),
            Err(EncodeRefusal::OverBudget { bytes, budget }) => {
                Ok(Saving::Refused(LayerRefusal::RecordOverBudget {
                    bytes,
                    budget,
                }))
            }
            Err(EncodeRefusal::Invalid { part }) => Err(LayerCallError::Defect {
                code: "session_internal",
                message: format!(
                    "the session saved a record whose {} would not read back",
                    part.word()
                ),
            }),
        }
    }

    /// Let a session go; whether it was held.
    pub fn close(&mut self, session: u32) -> bool {
        self.held.remove(&session).is_some()
    }

    /// Let every session go.
    pub fn clear(&mut self) {
        self.held.clear();
    }

    /// How many sessions are held.
    pub fn len(&self) -> usize {
        self.held.len()
    }

    pub fn is_empty(&self) -> bool {
        self.held.is_empty()
    }

    fn session(&self, session: u32) -> Result<&ConstraintSession, LayerCallError> {
        self.held
            .get(&session)
            .map(|held| &held.session)
            .ok_or(LayerCallError::UnknownSession(session))
    }

    fn held_mut(&mut self, session: u32) -> Result<&mut Held, LayerCallError> {
        self.held
            .get_mut(&session)
            .ok_or(LayerCallError::UnknownSession(session))
    }

    /// A handle no session holds. As `Bridge`'s handles: wrapping skips 0
    /// and every handle held.
    fn next_handle(&mut self) -> u32 {
        loop {
            self.last = self.last.wrapping_add(1);
            if self.last != 0 && !self.held.contains_key(&self.last) {
                return self.last;
            }
        }
    }

    /// Hold `session` under a new handle, and what an open reports of it.
    fn hold(&mut self, session: ConstraintSession) -> LayerOpened {
        let handle = self.next_handle();
        let opened = opened_of(handle, &session);
        self.held.insert(handle, Held::new(session));
        opened
    }
}

/// What an open, or a restore, reports of the session under `handle`.
fn opened_of(handle: u32, session: &ConstraintSession) -> LayerOpened {
    let front_up: Vec<u8> = session
        .source()
        .view()
        .faces()
        .iter()
        .map(|face| u8::from(face.front_up))
        .collect();
    LayerOpened {
        session: handle,
        faces: u32::try_from(front_up.len()).unwrap_or(u32::MAX),
        front_up,
        open_pairs: flat_pairs(&session.open_pairs()),
        spots: u32::try_from(session.spot_count()).unwrap_or(u32::MAX),
        opened_on: session.opened_on().into(),
    }
}

/// How a restore found a record again.
struct Found<'a> {
    faces: &'a [FaceStatus],
    constraints: Vec<ConstraintStatus>,
    order: &'a [SavedPairStatus],
    outcome: RestoreOutcome,
}

fn restored_of(
    opened: LayerOpened,
    session: &ConstraintSession,
    found: Found<'_>,
) -> LayerRestored {
    LayerRestored {
        opened,
        constraints: triples_of(session.constraints()),
        outcome: found.outcome.into(),
        faces: SavedFaces::of(found.faces),
        constraint_status: found.constraints,
        order_status: order_status(found.order),
        carried: carried_rows(session.carried()),
    }
}

/// A stored record read, or why it is not one to restore.
fn readable(record: &str) -> Result<LayerOrderRecord, LayerRefusal> {
    match read_record(record) {
        RecordRead::Read { record, .. } => Ok(record),
        RecordRead::Newer => Err(LayerRefusal::RecordNewer),
        RecordRead::Damaged(damage) => Err(LayerRefusal::RecordDamaged { damage }),
    }
}

/// A preview's verdict as it crosses; a fit is kept under a new token, and
/// anything else drops the one kept.
fn keep(held: &mut Held, tokens: &mut u32, preview: Preview) -> Previewed {
    match preview {
        Preview::Fits(fit) => {
            *tokens = tokens.wrapping_add(1).max(1);
            let token = *tokens;
            let fits = PreviewFits {
                token,
                stacks: Sides {
                    front: PackedStacks::from(&fit.stacks(ViewSide::Front)),
                    back: PackedStacks::from(&fit.stacks(ViewSide::Back)),
                },
                changed: fit.changed.clone(),
                stage: fit.stage,
                nodes: fit.nodes,
            };
            held.preview = Some((token, fit));
            Previewed::Fits(fits)
        }
        Preview::CantFit(cant) => {
            held.preview = None;
            Previewed::CantFit(cant.into())
        }
        Preview::TimedOut(out) => {
            held.preview = None;
            Previewed::TimedOut(out)
        }
    }
}

/// A commit's verdict as it crosses.
fn committing(session: &ConstraintSession, commit: Commit, adopted: bool) -> Committing {
    match commit {
        Commit::Committed(done) => Committing::Committed(commit_done(session, done, adopted)),
        Commit::CantFit(cant) => Committing::CantFit(cant.into()),
        Commit::TimedOut(out) => Committing::TimedOut(out),
    }
}

/// What a commit or a show that landed answers: the session as it now is.
fn commit_done(session: &ConstraintSession, done: Committed, adopted: bool) -> CommitDone {
    CommitDone {
        changed: done.changed,
        stacks: Sides {
            front: PackedStacks::from(&session.stacks(ViewSide::Front)),
            back: PackedStacks::from(&session.stacks(ViewSide::Back)),
        },
        open_pairs: flat_pairs(&session.open_pairs()),
        stage: done.stage,
        nodes: done.nodes,
        adopted,
    }
}

/// An Oriedita face index, below the face cap, as the wire's number.
fn face_index(face: usize) -> u32 {
    u32::try_from(face).unwrap_or(u32::MAX)
}

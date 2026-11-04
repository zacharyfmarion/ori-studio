//! A saved record opened again on creases that may have changed since it was
//! saved: after a refold, a reopen, a Diagram refresh or a crease edit
//! (`implementation-plans/layer-order-dialog.md`, approach 6 and decision
//! D10; engine research §4.2).
//!
//! Nothing is applied greedily and nothing is dropped:
//!
//! 1. **Faces** are found again one by one, by their paper point and area
//!    ([`FaceStatus`]): *intact* when the point lies inside one face whose
//!    area is the saved one and whose own point ([`LayerSource::interior_point`],
//!    what the record saved) is the saved point; *ambiguous* when the face
//!    found differs in either (the saved face was split, or merged with a
//!    neighbour, or the point now lies in another face of the same area, as
//!    on a grid; it is never guessed which face was meant); *gone* when the
//!    point lies on a crease or off the paper.
//! 2. **Constraints** follow their faces ([`ConstraintStatus`]): intact when
//!    both faces are and still overlap, ambiguous when one is ambiguous, gone
//!    when one is gone, both are now one face, or they no longer overlap.
//! 3. **The intact constraints are applied together, or not at all.** When
//!    they fit, the order shown is the fitting one closest to the saved one:
//!    first with every saved pair that still resolves held as asked (on
//!    unchanged creases that is exactly the saved order), and when those no
//!    longer fit with the constraints, the fitting order the search finds
//!    steered toward them. When the intact constraints clash, the ones the
//!    proof names are *clashing* ([`RestoreOutcome::Clash`]) and none is
//!    applied; when the check runs out of time none is applied either
//!    ([`RestoreOutcome::TimedOut`]). In both cases the host keeps its old
//!    picture and flags the figure, and the dialog opens on the rows.
//!    [`ConstraintSession::opened_on`] says where the order shown came from.
//! 4. **Each saved order pair** is reported kept, moved or unresolved
//!    ([`SavedPairStatus`]).
//! 5. **Every saved constraint not applied is carried**
//!    ([`CarriedConstraint`], [`ConstraintSession::carried`]) as the record
//!    had it, and the next [`ConstraintSession::save`] writes it back
//!    unless the dialog removed it or committed it.
//!
//! `WitnessOrder::resolve`, which fails a whole stored choice on its first
//! missing face, is not used; only its sign rule is
//! ([`crate::witness::above_by_side`], through
//! [`FoldSign::above`](super::FoldSign::above)).
//!
//! # The rows a dialog shows after a restore (U9)
//!
//! The rows are the committed constraints ([`ConstraintSession::constraints`])
//! and the carried ones ([`ConstraintSession::carried`]), each carried row
//! with its [`ConstraintStatus`] and, when its faces are intact today, the
//! [`Constraint`] it would be. A dialog removes a carried row from what it
//! saves by leaving its record index out of
//! [`ConstraintSession::save_keeping`], so a save that is refused has changed
//! nothing an undo would need back ([`ConstraintSession::remove_carried`]
//! removes one from the session itself); a committed row goes by a commit
//! without it. Applying carried rows is a commit of a list that holds
//! their constraints: each one committed leaves the carried rows. After a
//! clash nothing is committed, so the builder previews against the rows it
//! shows ([`ConstraintSession::preview_list`]), and Apply waits until the
//! list fits.
//!
//! Ori Studio original work, not a port.

use serde::Serialize;
use treemaker_flatfold::{Deduction, PairOrder};

use super::record::{self, FoldSign, LayerOrderRecord, RecordFace};
use super::session::{
    CantFit, Constraint, ConstraintSession, Limits, Seed, SessionRefusal, Solved, Steer, TimedOut,
};
use super::showing::OpenedOn;
use super::source::LayerSource;
use crate::complete;
use crate::pattern::FaceId;

/// How far a face's paper area may differ from the saved one, relative to
/// it, and still be the same face.
pub const AREA_TOLERANCE: f64 = 1e-6;

/// How far a face's own point may lie from the saved one, relative to the
/// paper's longer side, and still be the same face: the solver's tolerance.
pub const POINT_TOLERANCE: f64 = 1e-6;

/// A saved face, found again.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum FaceStatus {
    /// Its point lies inside `face`, whose area and own point are the saved
    /// ones.
    Intact { face: FaceId },
    /// Its point lies inside `face`, whose area (`area`, now) or own point is
    /// not the saved one: the saved face was split, merged with a
    /// neighbour, or another face of the same area now holds the point.
    Ambiguous { face: FaceId, area: f64 },
    /// Its point lies on a crease or off the paper.
    Gone,
}

impl FaceStatus {
    fn intact(&self) -> Option<FaceId> {
        match self {
            FaceStatus::Intact { face } => Some(*face),
            _ => None,
        }
    }

    fn found(&self) -> Option<FaceId> {
        match self {
            FaceStatus::Intact { face } | FaceStatus::Ambiguous { face, .. } => Some(*face),
            FaceStatus::Gone => None,
        }
    }
}

/// Why a saved constraint no longer names a question.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GoneCause {
    /// One of its faces is gone.
    FaceGone,
    /// Its subject and its object are now one face.
    SameFace,
    /// Its faces no longer overlap where Edit draws them.
    NoOverlap,
}

/// A saved constraint, found again.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ConstraintStatus {
    /// Both faces are intact and overlap: applied, unless the outcome says
    /// otherwise.
    Intact,
    /// A face is ambiguous: never applied, never guessed.
    Ambiguous,
    /// Never applied: see the cause.
    Gone { cause: GoneCause },
    /// Intact, but the intact constraints clash and this one is among those
    /// the proof names.
    Clashing,
}

/// A saved order pair, found again.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SavedPairStatus {
    /// Both faces are intact and overlap, and the order shown has the saved
    /// order of them.
    Kept,
    /// Both faces are intact and overlap, and the order shown has the other
    /// order: the creases or the constraints moved it.
    Moved,
    /// A face is not intact, both are one face, the faces no longer overlap,
    /// or the record orders the pair both ways; and every pair of a restore
    /// that ran out of time ([`RestoreOutcome::TimedOut`]), which checked
    /// none of them.
    Unresolved,
}

/// What a restore applied.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum RestoreOutcome {
    /// Every intact constraint is committed, and the order shown is the
    /// fitting order closest to the saved one.
    Applied,
    /// The intact constraints have no order together; `constraints` are the
    /// record's indices of those the proof names (each [`ConstraintStatus::Clashing`]).
    /// None is committed; the order shown is the closest to the saved one
    /// that the creases alone allow, or, when finding it ran out of time, the
    /// open's first ([`ConstraintSession::opened_on`] says which).
    Clash { constraints: Vec<usize> },
    /// The check ran out of nodes or time: none is committed, and the order
    /// shown is the open's first.
    TimedOut(TimedOut),
}

/// A record restored onto a source (see the module docs).
#[derive(Debug)]
pub struct Restored {
    /// The session, open on the source, with what the outcome says.
    pub session: ConstraintSession,
    /// Per saved face.
    pub faces: Vec<FaceStatus>,
    /// Per saved constraint.
    pub constraints: Vec<ConstraintStatus>,
    /// Per saved order pair.
    pub order: Vec<SavedPairStatus>,
    pub outcome: RestoreOutcome,
}

/// What [`ConstraintSession::restore_record`] found: a [`Restored`] without
/// the session, which it changed in place.
#[derive(Debug, Clone, PartialEq)]
pub struct RestoreReport {
    /// Per saved face.
    pub faces: Vec<FaceStatus>,
    /// Per saved constraint.
    pub constraints: Vec<ConstraintStatus>,
    /// Per saved order pair.
    pub order: Vec<SavedPairStatus>,
    pub outcome: RestoreOutcome,
}

/// A saved constraint a restore did not apply, as its record had it (see
/// the module docs).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CarriedConstraint {
    /// Its index among the constraints of the record restored.
    pub index: usize,
    /// Its faces as the record saved them, which a save writes back.
    pub subject: RecordFace,
    pub object: RecordFace,
    pub sign: FoldSign,
    /// Why it is not applied: ambiguous, gone or clashing, or intact in a
    /// restore that applied none (a clash elsewhere, or out of time).
    pub status: ConstraintStatus,
    /// The constraint on today's faces, when both are intact and overlap: a
    /// commit whose list holds it applies the row.
    pub constraint: Option<Constraint>,
}

impl ConstraintSession {
    /// Open a session on `source` and restore `record` onto it (see the
    /// module docs). A record that would not encode is refused
    /// ([`SessionRefusal::BadRecord`]); one that resolves badly is not, it is
    /// reported.
    pub fn restore(
        source: LayerSource,
        record: &LayerOrderRecord,
        limits: &Limits,
    ) -> Result<Restored, SessionRefusal> {
        if let Some(part) = record::invalid_part(record) {
            return Err(SessionRefusal::BadRecord { part });
        }
        let mut session = ConstraintSession::open(source, limits)?;
        let report = session.restore_record(record, limits)?;
        Ok(Restored {
            session,
            faces: report.faces,
            constraints: report.constraints,
            order: report.order,
            outcome: report.outcome,
        })
    }

    /// [`Self::restore`] on this session, open already: what a retry after
    /// "couldn't check in time" or the host engine's next try runs, without
    /// building the source and opening again (about a second on the
    /// iguana). The session is first put back as it opened, on the solver's
    /// first order with nothing committed or carried, and then restored as a
    /// fresh one would be. A record that would not encode is refused and
    /// leaves the session as it was.
    pub fn restore_record(
        &mut self,
        record: &LayerOrderRecord,
        limits: &Limits,
    ) -> Result<RestoreReport, SessionRefusal> {
        if let Some(part) = record::invalid_part(record) {
            return Err(SessionRefusal::BadRecord { part });
        }
        self.show_unconstrained(self.first_values(), self.letter_forced());
        self.carried_mut().clear();
        self.set_opened_on(OpenedOn::First { timed_out: None });

        let side = self.source().frame().side;
        let faces: Vec<FaceStatus> = record
            .faces
            .iter()
            .map(|saved| {
                let source = self.source();
                let Some(face) = source.face_at_paper(saved.at) else {
                    return FaceStatus::Gone;
                };
                let area = source.paper_area(face).unwrap_or(0.0);
                let same_area = (area - saved.area).abs() <= AREA_TOLERANCE * saved.area;
                let same_point = source.interior_point(face).is_some_and(|p| {
                    (p[0] - saved.at[0]).hypot(p[1] - saved.at[1]) <= POINT_TOLERANCE * side
                });
                if same_area && same_point {
                    FaceStatus::Intact { face }
                } else {
                    FaceStatus::Ambiguous { face, area }
                }
            })
            .collect();

        // The constraints, and the intact ones in record order.
        let mut statuses = Vec::with_capacity(record.constraints.len());
        let mut rows: Vec<Option<Constraint>> = Vec::with_capacity(record.constraints.len());
        let mut intact: Vec<Constraint> = Vec::new();
        let mut intact_index: Vec<usize> = Vec::new();
        for (i, saved) in record.constraints.iter().enumerate() {
            let (subject, object) = (faces[saved.f as usize], faces[saved.g as usize]);
            let mut row = None;
            let status = match (subject.found(), object.found()) {
                (None, _) | (_, None) => ConstraintStatus::Gone {
                    cause: GoneCause::FaceGone,
                },
                (Some(a), Some(b)) if a == b => ConstraintStatus::Gone {
                    cause: GoneCause::SameFace,
                },
                _ => match (subject.intact(), object.intact()) {
                    (Some(a), Some(b)) if self.offered_pair(a, b).is_some() => {
                        let c = Constraint {
                            subject: a,
                            object: b,
                            sign: saved.sign,
                        };
                        intact.push(c);
                        intact_index.push(i);
                        row = Some(c);
                        ConstraintStatus::Intact
                    }
                    (Some(_), Some(_)) => ConstraintStatus::Gone {
                        cause: GoneCause::NoOverlap,
                    },
                    _ => ConstraintStatus::Ambiguous,
                },
            };
            statuses.push(status);
            rows.push(row);
        }

        // The saved order pairs that resolve: a preference, one value per
        // variable, the open's first order where nothing resolves. Any pair
        // of the order does, as `save` writes every free pair, a pair only the
        // solver's view overlaps among them.
        let view = self.source().view();
        let mut resolved: Vec<Option<Seed>> = record
            .order
            .iter()
            .map(|saved| {
                let (f, g) = (
                    faces[saved.f as usize].intact()?,
                    faces[saved.g as usize].intact()?,
                );
                let v = self.variable_of(f, g)?;
                let f_above = saved.sign.above(view.front_up(g)?);
                let lo_above = f_above == (f == self.variables()[v].lo());
                Some((v, value_of(lo_above)))
            })
            .collect();
        // A record that orders one pair both ways resolves neither.
        let mut asked: Vec<Option<PairOrder>> = vec![None; self.variables().len()];
        let mut opposed = vec![false; asked.len()];
        for &(v, value) in resolved.iter().flatten() {
            match asked[v] {
                Some(other) if other != value => opposed[v] = true,
                _ => asked[v] = Some(value),
            }
        }
        for slot in &mut resolved {
            if slot.is_some_and(|(v, _)| opposed[v]) {
                *slot = None;
            }
        }
        let mut prefer = self.first_values();
        let mut saved_seeds: Vec<Seed> = Vec::new();
        for (v, value) in asked.iter().enumerate() {
            if let Some(value) = *value
                && !opposed[v]
            {
                prefer[v] = value;
                saved_seeds.push((v, value));
            }
        }

        let outcome = match self.restore_constraints(&intact, &saved_seeds, &prefer, limits)? {
            Restoring::Applied => RestoreOutcome::Applied,
            Restoring::Clash(cant) => {
                let constraints: Vec<usize> =
                    cant.constraints.iter().map(|&k| intact_index[k]).collect();
                for &i in &constraints {
                    statuses[i] = ConstraintStatus::Clashing;
                }
                RestoreOutcome::Clash { constraints }
            }
            Restoring::TimedOut(out) => RestoreOutcome::TimedOut(out),
        };

        // Every saved constraint not applied is carried, as saved.
        let applied = outcome == RestoreOutcome::Applied;
        let carried: Vec<CarriedConstraint> = record
            .constraints
            .iter()
            .enumerate()
            .filter(|(i, _)| !(applied && statuses[*i] == ConstraintStatus::Intact))
            .map(|(i, saved)| CarriedConstraint {
                index: i,
                subject: record.faces[saved.f as usize],
                object: record.faces[saved.g as usize],
                sign: saved.sign,
                status: statuses[i],
                constraint: rows[i],
            })
            .collect();
        *self.carried_mut() = carried;

        let timed_out = matches!(outcome, RestoreOutcome::TimedOut(_));
        let shown = self.shown_values();
        let order = resolved
            .iter()
            .map(|slot| match slot {
                _ if timed_out => SavedPairStatus::Unresolved,
                Some((v, value)) if shown[*v] == *value => SavedPairStatus::Kept,
                Some(_) => SavedPairStatus::Moved,
                None => SavedPairStatus::Unresolved,
            })
            .collect();
        Ok(RestoreReport {
            faces,
            constraints: statuses,
            order,
            outcome,
        })
    }

    /// The saved constraints the last restore did not apply and nothing has
    /// committed or removed since, in record order: rows the dialog shows by
    /// their status, and that a save writes back as saved (see the module
    /// docs).
    pub fn carried(&self) -> &[CarriedConstraint] {
        self.carried_rows()
    }

    /// Remove the carried row of record index `index`
    /// ([`CarriedConstraint::index`], its place among the record's
    /// constraints, which a removal never shifts), so a save no longer
    /// writes it; `None` when no carried row has it. A dialog that can still
    /// take a removal back (undo) leaves the session alone and names the
    /// rows to keep at the save instead ([`Self::save_keeping`]).
    pub fn remove_carried(&mut self, index: usize) -> Option<CarriedConstraint> {
        let carried = self.carried_mut();
        let at = carried.iter().position(|row| row.index == index)?;
        Some(carried.remove(at))
    }

    /// Remove every carried row, as Clear all does with the committed ones.
    pub fn clear_carried(&mut self) {
        self.carried_mut().clear();
    }

    /// The variable of `a` and `b` when they share a spot Edit draws.
    fn offered_pair(&self, a: FaceId, b: FaceId) -> Option<usize> {
        self.variable_of(a, b).filter(|&v| self.is_offered(v))
    }

    /// Step 3 of the module docs, on a session showing the open's order with
    /// nothing committed.
    fn restore_constraints(
        &mut self,
        intact: &[Constraint],
        saved: &[Seed],
        prefer: &[PairOrder],
        limits: &Limits,
    ) -> Result<Restoring, SessionRefusal> {
        // The saved pairs a constraint does not decide, held as asked.
        let mut constrained = vec![false; self.variables().len()];
        match self.seeds_of(intact)? {
            Ok(seeds) => {
                for (v, _) in seeds {
                    constrained[v] = true;
                }
            }
            Err(cant) => return self.restore_clash(cant, saved, prefer, limits),
        }
        let held: Vec<Seed> = saved
            .iter()
            .copied()
            .filter(|(v, _)| !constrained[*v])
            .collect();
        match self.solve(intact, &held, Steer::Toward(prefer), limits)? {
            Solved::Fit(fit) => {
                // What the constraints alone force, not the saved pairs.
                let Ok(seeds) = self.seeds_of(intact)? else {
                    return Err(SessionRefusal::Internal {
                        message: "the intact constraints fit once and oppose next".to_string(),
                    });
                };
                return Ok(
                    match self
                        .letter_search()
                        .deduce(&seeds, limits_deadline(limits))
                        .map_err(|e| SessionRefusal::Internal {
                            message: complete::search_refusal(e).to_string(),
                        })? {
                        Deduction::Deduced(deduced) => {
                            self.adopt(intact.to_vec(), fit.with_forced(deduced.forced()));
                            // A saved pair a constraint decided the other way
                            // is moved, though none ever is in a record a save
                            // wrote: its order fitted its constraints.
                            let moved = moved(saved, self.shown_values());
                            self.set_opened_on(if moved == 0 {
                                OpenedOn::Held { ignored: 0 }
                            } else {
                                OpenedOn::Closest {
                                    moved,
                                    ignored: 0,
                                    inside: self.fold_inside(saved),
                                }
                            });
                            Restoring::Applied
                        }
                        Deduction::Undecided { limit } => {
                            let out = TimedOut {
                                limit: complete::budget_limit(limit),
                                nodes: 0,
                            };
                            self.set_opened_on(OpenedOn::First {
                                timed_out: Some(out),
                            });
                            Restoring::TimedOut(out)
                        }
                        Deduction::Forced { .. } | Deduction::Conflict(_) => {
                            return Err(SessionRefusal::Internal {
                                message: "the intact constraints fit and do not deduce".to_string(),
                            });
                        }
                    },
                );
            }
            Solved::TimedOut(out) => {
                self.set_opened_on(OpenedOn::First {
                    timed_out: Some(out),
                });
                return Ok(Restoring::TimedOut(out));
            }
            Solved::CantFit(_) => {}
        }
        // The saved pairs no longer fit with the constraints: the fitting
        // order the search finds steered toward them.
        match self.solve(intact, &[], Steer::Toward(prefer), limits)? {
            Solved::Fit(fit) => {
                self.adopt(intact.to_vec(), fit);
                let moved = moved(saved, self.shown_values());
                let inside = self.fold_inside(saved);
                self.set_opened_on(OpenedOn::Closest {
                    moved,
                    ignored: 0,
                    inside,
                });
                Ok(Restoring::Applied)
            }
            Solved::CantFit(cant) => self.restore_clash(cant, saved, prefer, limits),
            Solved::TimedOut(out) => {
                self.set_opened_on(OpenedOn::First {
                    timed_out: Some(out),
                });
                Ok(Restoring::TimedOut(out))
            }
        }
    }

    /// The intact constraints clash: none is committed, and the order shown
    /// is the closest to the saved one the creases alone allow: the saved
    /// pairs held, else the search steered toward them, else (both out of
    /// time) the open's first, which [`Self::opened_on`] reports.
    fn restore_clash(
        &mut self,
        cant: CantFit,
        saved: &[Seed],
        prefer: &[PairOrder],
        limits: &Limits,
    ) -> Result<Restoring, SessionRefusal> {
        let mut opened_on = OpenedOn::First { timed_out: None };
        for (held, extra) in [(true, saved), (false, &[][..])] {
            match self.solve(&[], extra, Steer::Toward(prefer), limits)? {
                Solved::Fit(fit) => {
                    let values = fit.into_values();
                    opened_on = if held {
                        OpenedOn::Held { ignored: 0 }
                    } else {
                        OpenedOn::Closest {
                            moved: moved(saved, &values),
                            ignored: 0,
                            inside: self.fold_inside(saved),
                        }
                    };
                    let letters = self.letter_forced();
                    self.show_unconstrained(values, letters);
                    break;
                }
                Solved::TimedOut(out) => {
                    opened_on = OpenedOn::First {
                        timed_out: Some(out),
                    }
                }
                Solved::CantFit(_) => {}
            }
        }
        self.set_opened_on(opened_on);
        Ok(Restoring::Clash(cant))
    }
}

/// What applying the intact constraints came to.
enum Restoring {
    Applied,
    Clash(CantFit),
    TimedOut(TimedOut),
}

/// How many of `seeds` the complete order `values` has the other way.
fn moved(seeds: &[Seed], values: &[PairOrder]) -> usize {
    seeds
        .iter()
        .filter(|&&(v, value)| values.get(v) != Some(&value))
        .count()
}

fn value_of(lo_above: bool) -> PairOrder {
    if lo_above {
        PairOrder::FirstAbove
    } else {
        PairOrder::SecondAbove
    }
}

fn limits_deadline(limits: &Limits) -> Option<treemaker_flatfold::Deadline> {
    complete::search_budget(None, limits.deadline).deadline
}

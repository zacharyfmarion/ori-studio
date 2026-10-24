//! A saved record opened again on creases that may have changed since it was
//! saved: after a refold, a reopen, a Diagram refresh or a crease edit
//! (`implementation-plans/layer-order-dialog.md`, approach 6 and decision
//! D10; engine research §4.2).
//!
//! Nothing is applied greedily and nothing is dropped:
//!
//! 1. **Faces** are found again one by one, by their paper point and area
//!    ([`FaceStatus`]): *intact* when the point lies inside one face of the
//!    saved area, *ambiguous* when that face's area differs (the saved face
//!    was split, or merged with a neighbour; it is never guessed which piece
//!    was meant), *gone* when the point lies on a crease or off the paper.
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
//! 4. **Each saved order pair** is reported kept, moved or unresolved
//!    ([`SavedPairStatus`]).
//!
//! `WitnessOrder::resolve`, which fails a whole stored choice on its first
//! missing face, is not used; only its sign rule is
//! ([`crate::witness::above_by_side`], through
//! [`FoldSign::above`](super::FoldSign::above)).
//!
//! Ori Studio original work, not a port.

use serde::Serialize;
use treemaker_flatfold::{Deduction, PairOrder};

use super::record::{self, LayerOrderRecord};
use super::session::{
    CantFit, Constraint, ConstraintSession, Limits, Seed, SessionRefusal, Solved, Steer, TimedOut,
};
use super::source::LayerSource;
use crate::complete;
use crate::pattern::FaceId;

/// How far a face's paper area may differ from the saved one, relative to
/// it, and still be the same face.
pub const AREA_TOLERANCE: f64 = 1e-6;

/// A saved face, found again.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum FaceStatus {
    /// Its point lies inside `face`, whose area is the saved one.
    Intact { face: FaceId },
    /// Its point lies inside `face`, whose area is not the saved one
    /// (`area`, now): the saved face was split, or merged with a neighbour.
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
    /// or the record orders the pair both ways.
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
    /// that the creases alone allow.
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
        let faces: Vec<FaceStatus> = record
            .faces
            .iter()
            .map(|saved| {
                let source = session.source();
                let Some(face) = source.face_at_paper(saved.at) else {
                    return FaceStatus::Gone;
                };
                let area = source.paper_area(face).unwrap_or(0.0);
                if (area - saved.area).abs() <= AREA_TOLERANCE * saved.area {
                    FaceStatus::Intact { face }
                } else {
                    FaceStatus::Ambiguous { face, area }
                }
            })
            .collect();

        // The constraints, and the intact ones in record order.
        let mut statuses = Vec::with_capacity(record.constraints.len());
        let mut intact: Vec<Constraint> = Vec::new();
        let mut intact_index: Vec<usize> = Vec::new();
        for (i, saved) in record.constraints.iter().enumerate() {
            let (subject, object) = (faces[saved.f as usize], faces[saved.g as usize]);
            let status = match (subject.found(), object.found()) {
                (None, _) | (_, None) => ConstraintStatus::Gone {
                    cause: GoneCause::FaceGone,
                },
                (Some(a), Some(b)) if a == b => ConstraintStatus::Gone {
                    cause: GoneCause::SameFace,
                },
                _ => match (subject.intact(), object.intact()) {
                    (Some(a), Some(b)) if session.offered_pair(a, b).is_some() => {
                        intact.push(Constraint {
                            subject: a,
                            object: b,
                            sign: saved.sign,
                        });
                        intact_index.push(i);
                        ConstraintStatus::Intact
                    }
                    (Some(_), Some(_)) => ConstraintStatus::Gone {
                        cause: GoneCause::NoOverlap,
                    },
                    _ => ConstraintStatus::Ambiguous,
                },
            };
            statuses.push(status);
        }

        // The saved order pairs that resolve: a preference, one value per
        // variable, the open's first order where nothing resolves. Any pair
        // of the order does, as `save` writes every free pair, a pair only the
        // solver's view overlaps among them.
        let view = session.source().view();
        let mut resolved: Vec<Option<Seed>> = record
            .order
            .iter()
            .map(|saved| {
                let (f, g) = (
                    faces[saved.f as usize].intact()?,
                    faces[saved.g as usize].intact()?,
                );
                let v = session.variable_of(f, g)?;
                let f_above = saved.sign.above(view.front_up(g)?);
                let lo_above = f_above == (f == session.variables()[v].lo());
                Some((v, value_of(lo_above)))
            })
            .collect();
        // A record that orders one pair both ways resolves neither.
        let mut asked: Vec<Option<PairOrder>> = vec![None; session.variables().len()];
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
        let mut prefer = session.first_values();
        let mut saved_seeds: Vec<Seed> = Vec::new();
        for (v, value) in asked.iter().enumerate() {
            if let Some(value) = *value
                && !opposed[v]
            {
                prefer[v] = value;
                saved_seeds.push((v, value));
            }
        }

        let outcome = session.restore_constraints(&intact, &saved_seeds, &prefer, limits)?;
        let outcome = match outcome {
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
        let shown = session.shown_values();
        let order = resolved
            .iter()
            .map(|slot| match slot {
                Some((v, value)) if shown[*v] == *value => SavedPairStatus::Kept,
                Some(_) => SavedPairStatus::Moved,
                None => SavedPairStatus::Unresolved,
            })
            .collect();
        Ok(Restored {
            session,
            faces,
            constraints: statuses,
            order,
            outcome,
        })
    }

    /// The variable of `a` and `b` when they share a spot Edit draws.
    fn offered_pair(&self, a: FaceId, b: FaceId) -> Option<usize> {
        self.variable_of(a, b).filter(|&v| self.is_offered(v))
    }

    /// Step 3 of the module docs, on a freshly opened session.
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
                            Restoring::Applied
                        }
                        Deduction::Undecided { limit } => Restoring::TimedOut(TimedOut {
                            limit: complete::budget_limit(limit),
                            nodes: 0,
                        }),
                        Deduction::Forced { .. } | Deduction::Conflict(_) => {
                            return Err(SessionRefusal::Internal {
                                message: "the intact constraints fit and do not deduce".to_string(),
                            });
                        }
                    },
                );
            }
            Solved::TimedOut(out) => return Ok(Restoring::TimedOut(out)),
            Solved::CantFit(_) => {}
        }
        // The saved pairs no longer fit with the constraints: the fitting
        // order the search finds steered toward them.
        match self.solve(intact, &[], Steer::Toward(prefer), limits)? {
            Solved::Fit(fit) => {
                self.adopt(intact.to_vec(), fit);
                Ok(Restoring::Applied)
            }
            Solved::CantFit(cant) => self.restore_clash(cant, saved, prefer, limits),
            Solved::TimedOut(out) => Ok(Restoring::TimedOut(out)),
        }
    }

    /// The intact constraints clash: none is committed, and the order shown
    /// is the closest to the saved one the creases alone allow.
    fn restore_clash(
        &mut self,
        cant: CantFit,
        saved: &[Seed],
        prefer: &[PairOrder],
        limits: &Limits,
    ) -> Result<Restoring, SessionRefusal> {
        for extra in [saved, &[]] {
            if let Solved::Fit(fit) = self.solve(&[], extra, Steer::Toward(prefer), limits)? {
                let letters = self.letter_forced();
                self.show_unconstrained(fit.into_values(), letters);
                break;
            }
        }
        Ok(Restoring::Clash(cant))
    }
}

/// What applying the intact constraints came to.
enum Restoring {
    Applied,
    Clash(CantFit),
    TimedOut(TimedOut),
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

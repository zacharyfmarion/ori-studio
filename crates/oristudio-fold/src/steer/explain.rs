//! Why a sentence can't fit: the smallest set of constraints that clash
//! (`implementation-plans/layer-order-dialog.md` row E6; spec §6.4, "Can't
//! fit: with the creases, C in front of F clashes with C behind E").
//!
//! A check that can't fit already names a clashing set ([`CantFit::constraints`]:
//! the constraints its proof traces back to, which with the creases alone
//! have no order). That set can hold more than it needs. [`ConstraintSession::explain`]
//! shrinks it with a **deletion filter**: each member is dropped in turn and
//! the rest checked again. When the rest fits, the member is necessary and
//! stays; when the rest still can't fit, the member goes, and so does
//! everything the new proof does not name. A member found necessary stays
//! necessary as the set shrinks (a subset of constraints that fit still
//! fits), so at the end every member is necessary: dropping any one of them
//! leaves an order. That is a smallest set in the sense that matters for
//! the dialog (no member can be spared), not the smallest of all clashing
//! sets, which can be another set altogether.
//!
//! Every set the filter holds can't fit, so a call whose limits run out
//! still answers: it returns the set it has, flagged as not minimal. The
//! dialog shows "can't fit" from the preview at once and refines it with
//! this call.
//!
//! Ori Studio original work, not a port.

use serde::Serialize;

use super::session::{
    CantFit, CantFitProof, Constraint, ConstraintSession, Limits, SessionRefusal, Solved, Steer,
    TimedOut,
};
use crate::pattern::FaceId;

/// A set of constraints that, with the creases, has no order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Clash {
    /// Indices into the list explained (for [`ConstraintSession::explain`]:
    /// the committed constraints, then the candidate, last), ascending: the
    /// rows the dialog marks. A candidate's explanation always holds the
    /// candidate, since the committed constraints fit.
    pub constraints: Vec<usize>,
    /// Every member is necessary: dropping any one leaves an order. `false`
    /// when the limits ran out first, or a member's check did: the set still
    /// can't fit, but may hold more than it needs.
    pub minimal: bool,
    /// The faces the clashing constraints name, subjects and objects,
    /// ascending: the dialog's danger tints and labels.
    pub faces: Vec<FaceId>,
    /// How the last check proved that the set can't fit.
    pub proof: CantFitProof,
    /// Every face that proof traces back to through the propagation
    /// (Flat-Folder's `error_faces`), the creases' faces included,
    /// ascending.
    pub traced: Vec<FaceId>,
}

/// What [`ConstraintSession::explain`] found.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Explanation {
    /// The list fits: there is nothing to explain.
    Fits,
    Clash(Clash),
    /// The first check, of the whole list, ran out of its limits: no proof
    /// yet, so no set ("couldn't check in time").
    TimedOut(TimedOut),
}

impl ConstraintSession {
    /// Why the committed constraints and `candidate` can't fit: the smallest
    /// clashing set (see the module docs). `limits.max_nodes` bounds each
    /// check the filter makes; the deadline bounds the whole call. Never
    /// changes the session.
    pub fn explain(
        &self,
        candidate: Constraint,
        limits: &Limits,
    ) -> Result<Explanation, SessionRefusal> {
        let mut list = self.constraints().to_vec();
        list.push(candidate);
        self.explain_list(&list, limits)
    }

    /// [`Self::explain`] for any list of constraints, such as a restored
    /// record's whose intact constraints clash (decision D10): indices are
    /// into `list`.
    pub fn explain_list(
        &self,
        list: &[Constraint],
        limits: &Limits,
    ) -> Result<Explanation, SessionRefusal> {
        let first = match self.solve(list, &[], Steer::Shown, limits)? {
            Solved::Fit(_) => return Ok(Explanation::Fits),
            Solved::TimedOut(out) => return Ok(Explanation::TimedOut(out)),
            Solved::CantFit(cant) => cant,
        };
        if first.constraints.is_empty() {
            // The creases alone have an order (the session opened), so a
            // proof always traces back to a constraint.
            return Err(SessionRefusal::Internal {
                message: "a proof that names no constraint".to_string(),
            });
        }
        let mut set = first.constraints.clone();
        let mut proof = first;
        // `set[..kept]` are necessary; the rest are still to be tried.
        let mut kept = 0;
        let mut minimal = true;
        while kept < set.len() {
            if limits.deadline.is_some_and(|d| d.passed()) {
                minimal = false;
                break;
            }
            let dropped = set[kept];
            let rest: Vec<usize> = set.iter().copied().filter(|&i| i != dropped).collect();
            // A list of committed constraints fits: the order on screen
            // satisfies it. So a candidate is necessary with no check.
            if rest.iter().all(|&i| self.constraints().contains(&list[i])) {
                kept += 1;
                continue;
            }
            let without: Vec<Constraint> = rest.iter().map(|&i| list[i]).collect();
            match self.solve(&without, &[], Steer::Shown, limits)? {
                Solved::Fit(_) => kept += 1,
                Solved::TimedOut(_) => {
                    // Unknown: kept, and the set is no longer known to be
                    // smallest.
                    minimal = false;
                    kept += 1;
                }
                Solved::CantFit(cant) => {
                    let named: Vec<usize> = cant.constraints.iter().map(|&j| rest[j]).collect();
                    // Every member found necessary is in any clashing subset
                    // of the set, so in what the proof names; the members
                    // kept go first, the others after in ascending order.
                    let mut shrunk = set[..kept].to_vec();
                    if named.is_empty() || !shrunk.iter().all(|i| named.contains(i)) {
                        // Not what E3's roots promise; the rest still clashes,
                        // so keep all of it rather than trust the names.
                        shrunk = rest;
                    } else {
                        shrunk.extend(named.iter().filter(|i| !set[..kept].contains(i)));
                    }
                    set = shrunk;
                    proof = cant;
                }
            }
        }
        set.sort_unstable();
        let mut faces: Vec<FaceId> = set
            .iter()
            .flat_map(|&i| [list[i].subject, list[i].object])
            .collect();
        faces.sort_unstable();
        faces.dedup();
        let CantFit {
            proof,
            faces: traced,
            ..
        } = proof;
        Ok(Explanation::Clash(Clash {
            constraints: set,
            minimal,
            faces,
            proof,
            traced,
        }))
    }
}

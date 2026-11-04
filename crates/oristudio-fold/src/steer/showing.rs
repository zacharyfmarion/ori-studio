//! Opening the dialog on the order its host is showing (product spec §6.1:
//! the host hands the dialog "the order currently shown").
//!
//! [`ConstraintSession::open`] shows the solver's first order, which is
//! seldom the one Oriedita drew: on kabuto 14 of its 22 spots have another
//! top face. [`ConstraintSession::open_showing`] opens on the host's order
//! instead, as a restore opens on a saved one: its relations are held as
//! seeds, and when they do not all fit the creases as the solver sees them,
//! the fitting order closest to them is shown, and [`OpenedOn`] says which
//! happened.
//!
//! A host reads the order it shows off its handle's paper scene
//! ([`scene_relations`]): every pair of faces stacked on one of its subfaces,
//! upper first, in Oriedita's frame.
//!
//! Ori Studio original work, not a port.

use std::collections::BTreeMap;

use oristudio_cp::folding::{FoldedPaperScene, HierarchyRelation};
use oristudio_layer_order::Constraint as Condition;
use serde::Serialize;
use treemaker_flatfold::PairOrder;

use super::session::{ConstraintSession, Limits, Seed, SessionRefusal, Solved, Steer, TimedOut};
use super::source::LayerSource;
use crate::pattern::FaceId;

/// Why an order given can't fold, when one face says it (plan D19): the
/// order puts `face` between the two faces of a folded crease, `crease`,
/// which runs through it, so `face` sits inside a fold it can't be in. A
/// flat-foldability condition on three faces (Flat-Folder's taco-tortilla),
/// the kind Edit can miss and show an order that breaks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct FoldInside {
    pub face: FaceId,
    pub crease: [FaceId; 2],
}

/// Where the order a session showed at open, or after its last restore,
/// came from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "opened_on", rename_all = "snake_case")]
pub enum OpenedOn {
    /// The solver's first order: what [`ConstraintSession::open`] shows, and
    /// what is left when holding an order and the search toward it both ran
    /// out of nodes or time (`timed_out`).
    First { timed_out: Option<TimedOut> },
    /// The order given, held whole: every relation the host gave
    /// ([`ConstraintSession::open_showing`]) or every saved pair that still
    /// resolves (a restore) is the order on screen's. `ignored` relations
    /// named no pair the solver orders, or both orders of one; a restore
    /// reports none, its saved pairs having statuses of their own.
    Held { ignored: usize },
    /// The order given does not all fit (the creases, or the constraints,
    /// differ from what made it): the fitting order closest to it the search
    /// found, which has `moved` of its relations the other way. `inside` is
    /// a face the order given put inside a fold it can't be in, when its own
    /// relations say so ([`FoldInside`]); else the misfit is spread wider.
    Closest {
        moved: usize,
        ignored: usize,
        inside: Option<FoldInside>,
    },
}

impl ConstraintSession {
    /// Open a session over `source` on the order the host is showing:
    /// `shown`, its relations in Oriedita's frame (each `upper_face` nearer a
    /// viewer of the starting face's front), such as [`scene_relations`]
    /// reads off the host's paper scene. They are held as seeds; when they do
    /// not all fit, the order shown is the fitting one the search finds
    /// steered toward them, and when that runs out of time too, the solver's
    /// first. [`Self::opened_on`] says which. A relation naming no
    /// overlapping pair of the source, or a pair another relation orders the
    /// other way, is ignored and counted.
    pub fn open_showing(
        source: LayerSource,
        shown: &[HierarchyRelation],
        limits: &Limits,
    ) -> Result<ConstraintSession, SessionRefusal> {
        let mut session = ConstraintSession::open(source, limits)?;
        let n = session.source().view().faces().len();
        let mut asked: BTreeMap<usize, Option<PairOrder>> = BTreeMap::new();
        let mut ignored = 0;
        for relation in shown {
            let (upper, lower) = (relation.upper_face, relation.lower_face);
            let v = (upper < n && lower < n)
                .then(|| session.variable_of(FaceId(upper as u32), FaceId(lower as u32)))
                .flatten();
            let Some(v) = v else {
                ignored += 1;
                continue;
            };
            let lo_above = session.variables()[v].lo() == FaceId(upper as u32);
            let value = if lo_above {
                PairOrder::FirstAbove
            } else {
                PairOrder::SecondAbove
            };
            match asked.get(&v) {
                // Both ways: neither is held.
                Some(Some(other)) if *other != value => {
                    asked.insert(v, None);
                    ignored += 2;
                }
                Some(None) => ignored += 1,
                _ => {
                    asked.insert(v, Some(value));
                }
            }
        }
        let held: Vec<Seed> = asked
            .iter()
            .filter_map(|(&v, value)| value.map(|value| (v, value)))
            .collect();
        let mut prefer = session.first_values();
        for &(v, value) in &held {
            prefer[v] = value;
        }
        let opened_on = match session.solve(&[], &held, Steer::Toward(&prefer), limits)? {
            Solved::Fit(fit) => {
                session.show_unconstrained(fit.into_values(), session.letter_forced());
                OpenedOn::Held { ignored }
            }
            Solved::TimedOut(out) => OpenedOn::First {
                timed_out: Some(out),
            },
            Solved::CantFit(_) => match session.solve(&[], &[], Steer::Toward(&prefer), limits)? {
                Solved::Fit(fit) => {
                    let values = fit.into_values();
                    let moved = held
                        .iter()
                        .filter(|&&(v, value)| values[v] != value)
                        .count();
                    let inside = session.fold_inside(&held);
                    session.show_unconstrained(values, session.letter_forced());
                    OpenedOn::Closest {
                        moved,
                        ignored,
                        inside,
                    }
                }
                Solved::TimedOut(out) => OpenedOn::First {
                    timed_out: Some(out),
                },
                // No seeds: the creases alone always have the open's order.
                Solved::CantFit(_) => OpenedOn::First { timed_out: None },
            },
        };
        session.set_opened_on(opened_on);
        Ok(session)
    }

    /// The first three-face condition of the creases that `held` breaks on
    /// its own: both its pairs held, and the face the crease runs through
    /// above one of the crease's faces and below the other.
    pub(crate) fn fold_inside(&self, held: &[Seed]) -> Option<FoldInside> {
        let mut values: Vec<Option<PairOrder>> = vec![None; self.variables().len()];
        for &(v, value) in held {
            if let Some(slot) = values.get_mut(v) {
                *slot = Some(value);
            }
        }
        let above = |upper: FaceId, lower: FaceId| -> Option<bool> {
            let v = self.variable_of(upper, lower)?;
            let value = (*values.get(v)?)?;
            let lo_above = value == PairOrder::FirstAbove;
            Some((self.variables()[v].lo() == upper) == lo_above)
        };
        self.source()
            .problem()
            .constraints()
            .iter()
            .find_map(|condition| match *condition {
                Condition::TacoTortilla([a, b, face]) => (above(face, a)? != above(face, b)?)
                    .then_some(FoldInside {
                        face,
                        crease: [a, b],
                    }),
                _ => None,
            })
    }
}

/// The order a paper scene draws, as Oriedita's relations: for every subface,
/// each face above each face below it, `upper_face` nearer a viewer of the
/// starting face's front (a scene of the rear pass, `flipped`, reads its
/// stacks the other way up). Each pair once, ascending by `(upper, lower)`;
/// a pair two subfaces stack both ways (never, for an order) is listed both
/// ways, which [`ConstraintSession::open_showing`] ignores.
pub fn scene_relations(scene: &FoldedPaperScene) -> Vec<HierarchyRelation> {
    let mut pairs = std::collections::BTreeSet::new();
    for subface in &scene.subfaces {
        let stack = &subface.faces_top_to_bottom;
        let k = stack.len();
        for i in 0..k {
            for j in i + 1..k {
                let (upper, lower) = if scene.flipped {
                    (stack[j], stack[i])
                } else {
                    (stack[i], stack[j])
                };
                pairs.insert((upper, lower));
            }
        }
    }
    pairs
        .into_iter()
        .map(|(upper_face, lower_face)| HierarchyRelation {
            upper_face,
            lower_face,
        })
        .collect()
}

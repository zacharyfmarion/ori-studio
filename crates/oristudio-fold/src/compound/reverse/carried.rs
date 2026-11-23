//! Where the reverse hinge passes through a pleat vertex, the moving-side
//! flood can separate a pleat from the wall that carries it. The two still
//! share a *material* vertex on the hinge. Opening the pleat independently
//! would keep its plies in absolute order against a wall that turns over.

use std::collections::BTreeSet;

use super::{Bodies, Plan, RawOpening, Tip, separated};
use crate::numerics::TOL;
use crate::pattern::VertexId;
use crate::state::State;

impl Tip {
    /// Extend a single pocket's walls over attached pleats. Require a ply
    /// sandwiched inside one wall: the independent plan cannot land either
    /// kind, since reversing the wall while keeping both its orders against
    /// that ply makes a cycle. Existing independent landings keep their plan.
    pub(super) fn carried_opening(&self, state: &State, plan: &Plan) -> Option<RawOpening> {
        if plan.openings.len() < 2 {
            return None;
        }
        // Only one selected spine continues through the reverse hinge. All
        // other openings must be automatic and end at a wall of this one.
        let mut through = plan
            .openings
            .iter()
            .enumerate()
            .filter(|(_, o)| self.spine_continues(state, o));
        let (host_index, host) = through.next()?;
        if through.next().is_some() {
            return None;
        }
        let mut joined = host.clone();
        let mut trapped = false;
        let flaps = self.openings.iter().filter(|f| !f.openings.is_empty());
        for (index, (rider, flap)) in plan.openings.iter().zip(flaps).enumerate() {
            if index == host_index {
                continue;
            }
            if flap.openings.len() != 1 || rider.spine.is_none() {
                return None;
            }
            let upper = self.attached_wall(state, host, rider)?;
            let (wall, faces, body) = if upper {
                (&host.upper, &mut joined.upper, &mut joined.upper_body)
            } else {
                (&host.lower, &mut joined.lower, &mut joined.lower_body)
            };
            trapped |=
                self.between(state, wall, &rider.lower) || self.between(state, wall, &rider.upper);
            faces.extend(&rider.lower);
            faces.extend(&rider.upper);
            body.extend(&rider.lower_body);
            body.extend(&rider.upper_body);
        }
        if !trapped || !separated(state, &self.side.pieces, &joined.lower, &joined.upper) {
            return None;
        }
        let stationary = Bodies::stationary_pieces(state, self);
        if !separated(state, &stationary, &joined.lower_body, &joined.upper_body) {
            return None;
        }
        for list in [
            &mut joined.lower,
            &mut joined.upper,
            &mut joined.lower_body,
            &mut joined.upper_body,
        ] {
            list.sort_unstable();
            list.dedup();
        }
        joined.named_upper = Some(host.upper.clone());
        Some(joined)
    }

    /// The folded spine enters the stationary side, possibly across a
    /// subdivision exactly on the new hinge.
    fn spine_continues(&self, state: &State, opening: &RawOpening) -> bool {
        let Some(spine) = opening.spine else {
            return false;
        };
        let class = |v: VertexId| self.classified.classes[v.index()];
        let vertices = opening
            .across
            .iter()
            .flat_map(|&k| state.creases()[k].vertices);
        if vertices.clone().any(|v| class(v) < 0) {
            return true;
        }
        let ends: BTreeSet<_> = vertices.filter(|&v| class(v) == 0).collect();
        !ends.is_empty()
            && state.creases().iter().any(|c| {
                c.kind.is_folded()
                    && c.vertices.iter().any(|v| ends.contains(v))
                    && c.vertices.iter().any(|&v| {
                        class(v) < 0
                            && spine.distance_to_point(state.geometry().vertex_images[v.index()])
                                <= TOL
                    })
            })
    }

    /// The entire pleat meets one wall at its hinge vertex. Coincident
    /// folded coordinates on different parts of the sheet do not join them.
    fn attached_wall(&self, state: &State, host: &RawOpening, rider: &RawOpening) -> Option<bool> {
        let spine = host.spine?;
        let touches =
            |wall: &[usize], v: VertexId| wall.iter().any(|&f| state.faces()[f].ring.contains(&v));
        let class = |v: VertexId| self.classified.classes[v.index()];
        let ends = rider
            .across
            .iter()
            .flat_map(|&k| state.creases()[k].vertices)
            .filter(|&v| class(v) == 0);
        let mut wall = None;
        for end in ends {
            // A shared spine is handled by packet_pairs (nested or
            // interleaved openings), not by carrying a whole pleat.
            if spine
                .signed_distance(state.geometry().vertex_images[end.index()])
                .abs()
                <= TOL
            {
                return None;
            }
            let upper = touches(&host.upper, end);
            if upper == touches(&host.lower, end) || wall.is_some_and(|w| w != upper) {
                return None;
            }
            wall = Some(upper);
        }
        let upper = wall?;
        let opposite = if upper { &host.lower } else { &host.upper };
        let crosses_gap = rider
            .lower
            .iter()
            .chain(&rider.upper)
            .flat_map(|&f| &state.faces()[f].ring)
            .any(|&v| class(v) == 0 && touches(opposite, v));
        (!crosses_gap).then_some(upper)
    }
}

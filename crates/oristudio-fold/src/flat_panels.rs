//! Exact convex panel boundaries for the image–image guard. Flat creases
//! subdivide material without adding a physical edge. They must not turn a
//! broad panel overlap into a narrow face-pair overlap. Keep concave panels
//! conservative: their convex hull would fill notches and hide real slivers.

use std::collections::BTreeMap;

use oristudio_geometry::convex::{self, HalfPlane};

use crate::numerics::{EXACT, MIN_FEATURE, TOL};
use crate::pattern::CreaseKind;
use crate::refusal::FoldRefusal;
use crate::state::{Geometry, StateParts, Topology};

type Point = [f64; 2];

pub(crate) struct FlatPanels {
    component: Vec<usize>,
    /// None for a non-convex or non-simple boundary; use its original faces.
    outlines: Vec<Option<Vec<Point>>>,
}

impl FlatPanels {
    pub(crate) fn new(
        parts: &StateParts,
        geometry: &Geometry,
        same_motion: impl Fn(usize, usize) -> bool,
    ) -> Result<Self, FoldRefusal> {
        let topology = Topology::build(parts)?;
        let mut component = vec![usize::MAX; parts.faces.len()];
        let mut outlines = Vec::new();
        for first in 0..parts.faces.len() {
            if component[first] != usize::MAX {
                continue;
            }
            let id = outlines.len();
            component[first] = id;
            let mut members = vec![first];
            let mut at = 0;
            while at < members.len() {
                let f = members[at];
                for &k in &topology.face_creases[f] {
                    if !matches!(parts.creases[k].kind, CreaseKind::Flat(_)) {
                        continue;
                    }
                    if let Some(g) = topology.across(k, f)
                        && component[g] == usize::MAX
                        && same_motion(first, g)
                    {
                        component[g] = id;
                        members.push(g);
                    }
                }
                at += 1;
            }
            outlines.push(boundary(
                parts, &topology, geometry, &component, &members, id,
            ));
        }
        Ok(Self {
            component,
            outlines,
        })
    }

    /// Called only for a face pair that already failed the ordinary guard.
    /// Return its panel penetration if it is still a sliver. Faces remain
    /// untouched: this outline is used only to decide guard admission.
    pub(crate) fn sliver(&self, geometry: &Geometry, a: usize, b: usize) -> Option<f64> {
        let polygon = |f: usize| {
            self.outlines[self.component[f]]
                .as_deref()
                .unwrap_or(&geometry.images[f])
        };
        let (p, q) = (polygon(a), polygon(b));
        let depth = convex::penetration(p, q);
        (depth > TOL && depth < MIN_FEATURE && depth < convex::width(p).min(convex::width(q)) - TOL)
            .then_some(depth)
    }
}

fn boundary(
    parts: &StateParts,
    topology: &Topology,
    geometry: &Geometry,
    component: &[usize],
    members: &[usize],
    id: usize,
) -> Option<Vec<Point>> {
    let first = *members.first()?;
    if members.len() == 1 {
        return Some(geometry.images[first].clone());
    }
    // Original sheet rings are CCW. Cancel only actual flat adjacency;
    // disconnected paper at the same image position is never combined.
    let mut next = BTreeMap::new();
    for &f in members {
        let ring = &parts.faces[f].ring;
        for (i, &k) in topology.face_creases[f].iter().enumerate() {
            if topology.across(k, f).is_some_and(|g| component[g] == id) {
                continue;
            }
            if next.insert(ring[i], ring[(i + 1) % ring.len()]).is_some() {
                return None;
            }
        }
    }
    let start = *next.keys().next()?;
    let mut vertex = start;
    let mut outline = Vec::with_capacity(next.len());
    for _ in 0..next.len() {
        outline.push(geometry.isometries[first].apply(parts.vertices[vertex.index()]));
        vertex = *next.get(&vertex)?;
        if vertex == start {
            break;
        }
    }
    if vertex != start || outline.len() != next.len() {
        return None; // Multiple loops, including holes, are not convex panels.
    }
    if !geometry.isometries[first].front_up() {
        outline.reverse();
    }
    for i in 0..outline.len() {
        let plane = HalfPlane::left_of(outline[i], outline[(i + 1) % outline.len()])?;
        if outline.iter().any(|&p| plane.signed_distance(p) < -EXACT) {
            return None;
        }
    }
    Some(outline)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Direction, PlainFold, Sheet, Side, StartSide, State};
    use oristudio_geometry::Line;

    fn grid() -> State {
        let mut state = State::flat(Sheet::square(), StartSide::Front).unwrap();
        for normal in [[1., 0.], [0., 1.]] {
            let op = PlainFold::new(
                Line::new(normal, 0.5).unwrap(),
                Side::Positive,
                Direction::Valley,
            );
            state = state.precrease(&op).unwrap().state;
        }
        state
    }

    #[test]
    fn convex_flat_panels_ignore_internal_subdivisions() {
        let s = grid();
        let panels = FlatPanels::new(s.parts(), s.geometry(), |_, _| true).unwrap();
        assert_eq!(panels.outlines.len(), 1);
        let outline = panels.outlines[0].as_ref().unwrap();
        assert!((convex::width(outline) - 1.).abs() < EXACT);
    }

    #[test]
    fn concave_panels_are_not_replaced_by_their_convex_hull() {
        let s = grid();
        let corner = s.face_position(s.face_at([0.75, 0.75]).unwrap()).unwrap();
        let panels = FlatPanels::new(s.parts(), s.geometry(), |a, b| {
            (a == corner) == (b == corner)
        })
        .unwrap();
        assert_eq!(panels.outlines.len(), 2);
        assert_eq!(panels.outlines.iter().filter(|p| p.is_none()).count(), 1);
        assert!(panels.outlines[panels.component[corner]].is_some());
    }

    #[test]
    fn different_motions_remain_distinct_even_across_flat_edges() {
        let s = grid();
        let panels = FlatPanels::new(s.parts(), s.geometry(), |a, b| a == b).unwrap();
        assert_eq!(panels.outlines.len(), 4);
        for outline in panels.outlines.iter().flatten() {
            assert!((convex::width(outline) - 0.5).abs() < EXACT);
        }
    }
}

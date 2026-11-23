//! The squash of a closed pocket ([`State::squash_closed_reading`]): a
//! pocket whose walls are joined along two lines through one corner — a hat
//! or a triangle opened from its open edge and pressed flat the other way,
//! into a square. One joint is the squash's spine and the other its hinge,
//! the corner its vertex. The motions are the squash's own
//! (`super::squash`): the lower wall's spine side turns across the crease
//! between the joints, the upper wall's spine side across the spine and
//! then with it, its hinge side across the hinge; the lower wall's hinge
//! side stays.
//!
//! - **The walls** start from the layers at the flap point above and below
//!   the opening asked. Each grows across every crease off the spine and
//!   the hinge — flat or folded, so a wall carries what is folded flat on
//!   it (a brim, a corner flap, the wall's own far half folded under) —
//!   and the joints on the spine and the hinge are where the walls part.
//! - **The rest of the paper** is joined to the walls only on those lines;
//!   each such piece joins the wall it stacks with across the opening:
//!   never under the lower wall's paper, it is the upper wall's; never over
//!   the upper wall's, the lower's. A piece that could be either, or
//!   neither, is no closed pocket. The opening must part the walls
//!   everywhere: the upper wall over the lower wherever they overlap.
//! - **The vertex** is an end of the spine where the lower wall folds over
//!   a hinge, as for every squash, and the walls must be joined on that
//!   hinge too: closed on both lines. The half clicked folds over (the flap
//!   point on the spine side of the crease).
//!
//! Read only where the squash as it always read the flap is refused, and
//! only for an opening asked: which layers part is the folder's choice, a
//! deeper opening than the first flap at the point has. Exactly one reading
//! must hold, or none is taken.

use oristudio_geometry::Line;

use crate::compound::squash::{Base, Flap, Growth, Squash, spine_ends};
use crate::compound::vertex::toward;
use crate::numerics::TOL;
use crate::pattern::CreaseKind;
use crate::state::State;
use crate::view::Direction;

impl State {
    /// `op`'s flap read as a closed pocket (see the module docs); none when
    /// it is not one, or reads more than one way.
    pub(super) fn squash_closed_reading(&self, op: &Squash, direction: Direction) -> Option<Flap> {
        let opening = op.opening?;
        if op.hinge.is_some() || op.target.is_some() {
            return None;
        }
        let (at, stack) = self.squash_stack(op, direction).ok()?;
        if opening == 0 || opening >= stack.len() {
            return None;
        }
        // The layers above the opening and below it, each across flat creases.
        let nf = self.faces().len();
        let regions: Vec<Vec<bool>> = stack.iter().map(|&f| self.squash_flat_region(f)).collect();
        let union = |set: &[Vec<bool>]| -> Vec<bool> {
            (0..nf)
                .map(|f| set.iter().any(|region| region[f]))
                .collect()
        };
        let (upper, lower) = (union(&regions[..opening]), union(&regions[opening..]));
        if (0..nf).any(|f| upper[f] && lower[f]) {
            return None;
        }
        // The folded creases joining them, by line: each a spine to read.
        let creases = self.creases();
        let topology = self.topology();
        let images = &self.geometry().vertex_images;
        let mut joints: Vec<(Line, Vec<usize>)> = Vec::new();
        for (k, incident) in topology.crease_faces.iter().enumerate() {
            if !creases[k].kind.is_folded()
                || !incident.iter().any(|&f| upper[f])
                || !incident.iter().any(|&f| lower[f])
            {
                continue;
            }
            let [a, b] = creases[k].vertices.map(|v| images[v.index()]);
            let Some(line) = Line::from_points(a, b) else {
                continue;
            };
            match joints.iter_mut().find(|(other, _)| other.approx_eq(&line)) {
                Some((_, spine)) => spine.push(k),
                None => joints.push((line, vec![k])),
            }
        }
        let mut found = Vec::new();
        for (spine_line, spine) in joints {
            let Some(ends) = spine_ends(self, &spine, &spine_line) else {
                continue;
            };
            let base = Base {
                plies: stack.clone(),
                layers: stack.len(),
                opening,
                lower_region: lower.clone(),
                spine,
                spine_line,
                ends,
                at,
                direction,
            };
            let Ok(vertices) = self.squash_vertices(op, &base) else {
                continue;
            };
            for vertex in vertices {
                let Ok(reading) = self.squash_reading(op, &base, vertex, Growth::Folded) else {
                    continue;
                };
                // Closed on both lines: the walls are joined on the hinge too.
                // And the half clicked folds over.
                let walls = reading.walls();
                let hinge = reading.hinge_line();
                let closed = (0..creases.len()).any(|k| {
                    let incident = &topology.crease_faces[k];
                    creases[k].kind.is_folded()
                        && creases[k]
                            .vertices
                            .iter()
                            .all(|v| hinge.distance_to_point(images[v.index()]) <= TOL)
                        && incident.iter().any(|&f| walls[f] == Some(true))
                        && incident.iter().any(|&f| walls[f] == Some(false))
                });
                if !closed || reading.moving_lower().signed_distance(at) <= TOL {
                    continue;
                }
                if let Ok(flap) = self.squash_checked(vec![reading], direction) {
                    found.push(flap);
                }
            }
        }
        (found.len() == 1).then(|| found.remove(0))
    }

    /// Which wall each face of a closed pocket is in (see the module docs):
    /// none when the plies' paper reaches both walls, or a piece stacks
    /// with both or with neither.
    pub(super) fn squash_closed_walls(
        &self,
        base: &Base,
        hinge: &Line,
    ) -> Option<Vec<Option<bool>>> {
        let nf = self.faces().len();
        let topology = self.topology();
        let creases = self.creases();
        let images = &self.geometry().vertex_images;
        let on = |line: &Line, k: usize| {
            creases[k]
                .vertices
                .iter()
                .all(|v| line.distance_to_point(images[v.index()]) <= TOL)
        };
        let joint = |k: usize| {
            matches!(creases[k].kind, CreaseKind::Border) || on(&base.spine_line, k) || on(hinge, k)
        };
        // The paper in pieces across every crease off the spine and the hinge.
        let mut piece = vec![usize::MAX; nf];
        let mut pieces = 0;
        for seed in 0..nf {
            if piece[seed] != usize::MAX {
                continue;
            }
            piece[seed] = pieces;
            let mut queue = vec![seed];
            while let Some(f) = queue.pop() {
                for &k in &topology.face_creases[f] {
                    if joint(k) {
                        continue;
                    }
                    if let Some(g) = topology.across(k, f)
                        && piece[g] == usize::MAX
                    {
                        piece[g] = pieces;
                        queue.push(g);
                    }
                }
            }
            pieces += 1;
        }
        // The plies' pieces are the walls.
        let mut side: Vec<Option<bool>> = vec![None; pieces];
        for (i, &f) in base.plies.iter().enumerate() {
            let upper = i < base.opening;
            match side[piece[f]] {
                None => side[piece[f]] = Some(upper),
                Some(other) if other != upper => return None,
                Some(_) => {}
            }
        }
        // Every other piece, by how it stacks with the walls' paper.
        loop {
            let mut open = false;
            let mut placed = false;
            for p in 0..pieces {
                if side[p].is_some() {
                    continue;
                }
                open = true;
                let (mut upper, mut lower, mut touches) = (true, true, false);
                for f in (0..nf).filter(|&f| piece[f] == p) {
                    for g in 0..nf {
                        let (Some(wall), Some(above)) =
                            (side[piece[g]], toward(self, f, g, base.direction))
                        else {
                            continue;
                        };
                        touches = true;
                        if !wall && !above {
                            upper = false;
                        }
                        if wall && above {
                            lower = false;
                        }
                    }
                }
                if !touches {
                    continue;
                }
                match (upper, lower) {
                    (true, false) => side[p] = Some(true),
                    (false, true) => side[p] = Some(false),
                    _ => return None,
                }
                placed = true;
            }
            if !open {
                break;
            }
            if !placed {
                return None;
            }
        }
        let wall: Vec<Option<bool>> = (0..nf).map(|f| side[piece[f]]).collect();
        // The opening parts them everywhere: the upper wall over the lower
        // wherever they overlap.
        let parted = (0..nf).all(|f| {
            wall[f] != Some(true)
                || (0..nf).all(|g| {
                    wall[g] != Some(false) || toward(self, f, g, base.direction) != Some(false)
                })
        });
        parted.then_some(wall)
    }
}

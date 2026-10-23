//! Landing the fold (plan D3 steps 4–8, research §4.2 steps 5–9): split the
//! moving faces, change the hinges, re-derive the isometries, carry and place
//! the order, derive the letters, and pass the gate.
//!
//! - **Split** the moving faces that cross ℓ, through the one scoring step
//!   every fold shares (`super::score`): one new vertex per crossed crease,
//!   two transitions per split ring.
//! - **Hinges on ℓ** between a moving and a stationary face toggle: flat to
//!   folded is a refold (the remembered letter is reported beside the new
//!   one), folded to flat an unfold (the letter is remembered). Any other
//!   boundary between moving and stationary faces would contradict rule (i),
//!   and is refused.
//! - **Isometries** are derived from a stationary root that keeps its
//!   isometry, then checked against the prediction: R_ℓ ∘ T_old for moving
//!   faces, T_old for the rest.
//! - **Order.** Pairs of untouched faces stay as they are. Children of an old
//!   pair in the same class keep its order if stationary and reverse it if
//!   moving (U is one block, so this is a block carry, never a carry because
//!   two isometries happen to agree). Each newly overlapping moving ×
//!   stationary pair takes the placement: moving on top for a valley,
//!   underneath for a mountain, or around a tuck's target. A moving ×
//!   stationary overlap thinner than the minimum feature must also pass the
//!   complete arrangement check; width alone is not a physical constraint.
//! - **Letters**, for the new creases and the refolds, from the order: valley
//!   iff the front-up face lies below. Every other letter is checked by the
//!   gate, so a drifted letter is refused there.
//! - **Crease marks** are carried, less what a new crease along one covers
//!   (`crate::crease_marks::carry`).

use std::collections::BTreeSet;

use oristudio_geometry::convex::{self, HalfPlane};
use oristudio_layer_order::{FacePair, LayerOrder, LayerOrderBuilder, Letter, Violation};

use crate::crease_marks;
use crate::flat_panels::FlatPanels;
use crate::fold::closure::Analysis;
use crate::fold::score::{self, Piece};
use crate::index::BoxIndex;
use crate::numerics::{MIN_FEATURE, TOL};
use crate::pattern::{CreaseKind, EdgeId, Face, FaceId, VertexId};
use crate::refusal::FoldRefusal;
use crate::state::{Geometry, State, StateParts, Topology, ring_position};
use crate::view::Direction;

type Point = [f64; 2];

/// A refolded precrease: what it remembered and what it is now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct Refold {
    pub edge: EdgeId,
    pub remembered: Letter,
    pub letter: Letter,
}

/// What landing changed.
#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct Landed {
    /// The new state's faces that moved.
    pub(crate) moving_faces: Vec<FaceId>,
    /// The new creases (chords), in id order.
    pub(crate) created: Vec<EdgeId>,
    pub(crate) unfolded: Vec<EdgeId>,
    pub(crate) refolded: Vec<Refold>,
    /// How many faces were split.
    pub(crate) split: usize,
}

/// A new face and where it came from.
struct NewFace {
    face: Face,
    moving: bool,
    /// The old face's position.
    old: usize,
}

/// Land the analysed fold as step `step`.
pub(crate) fn land(
    state: &State,
    analysis: &Analysis,
    step: u32,
) -> Result<(State, Landed), FoldRefusal> {
    let parts = state.parts();
    let geometry = state.geometry();
    let classes = &analysis.classified.classes;
    let nf = parts.faces.len();
    let split: Vec<bool> = (0..nf)
        .map(|f| analysis.moving[f] && analysis.has_stationary[f])
        .collect();

    // Split the moving faces that cross ℓ; a whole face moves with U, a
    // piece with its side.
    let scored = score::score(
        parts,
        state.topology(),
        classes,
        &analysis.classified.distances,
        &split,
        step,
        state.next_ids(),
    )?;
    let new_faces: Vec<NewFace> = scored
        .faces
        .iter()
        .map(|s| NewFace {
            face: s.face.clone(),
            moving: match s.piece {
                Piece::Whole => analysis.moving[s.old],
                Piece::Positive => true,
                Piece::Negative => false,
            },
            old: s.old,
        })
        .collect();
    let pending_from = scored.chords_from();
    let class_of = |v: VertexId| score::class_of(classes, v);
    let score::Scored {
        vertices,
        child_of,
        creases,
        created,
        split: split_count,
        ..
    } = scored;
    let root = {
        let r = state
            .face_position(parts.root)
            .ok_or(FoldRefusal::UnknownRoot { face: parts.root })?;
        child_of[r]
            .iter()
            .copied()
            .find(|&a| !new_faces[a].moving)
            .or_else(|| new_faces.iter().position(|n| !n.moving))
            .ok_or(FoldRefusal::NothingStays)?
    };
    let marks = crease_marks::carry(&parts.marks, &vertices, &creases);
    let mut next = StateParts {
        sheet: parts.sheet.clone(),
        vertices,
        creases,
        faces: new_faces.iter().map(|n| n.face.clone()).collect(),
        root: new_faces[root].face.id,
        root_isometry: geometry.isometries[new_faces[root].old],
        order: LayerOrder::new(),
        view: parts.view,
        step,
        marks,
    };
    let new_topology = Topology::build(&next)?;

    // Hinges: creases between a moving and a stationary face.
    let mut unfolded = Vec::new();
    let mut refolds: Vec<(usize, Letter)> = Vec::new();
    for k in 0..next.creases.len() {
        let [f, g] = match new_topology.crease_faces[k][..] {
            [f, g] => [f, g],
            _ => continue,
        };
        if new_faces[f].moving == new_faces[g].moving || k >= pending_from {
            continue;
        }
        let crease = &mut next.creases[k];
        let on_line = crease.vertices.iter().all(|&v| class_of(v) == 0);
        match (on_line, crease.kind) {
            (true, CreaseKind::Flat(remembered)) => {
                crease.kind = CreaseKind::Folded(remembered);
                refolds.push((k, remembered));
            }
            (true, CreaseKind::Folded(letter)) => {
                crease.kind = CreaseKind::Flat(letter);
                unfolded.push(crease.id);
            }
            _ => {
                return Err(FoldRefusal::DegenerateSplit {
                    face: new_faces[f].face.id,
                });
            }
        }
    }

    // Isometries, derived and checked against the prediction.
    let new_geometry = Geometry::derive(&next, &new_topology, root, TOL)?;
    let reflection = analysis.axis().reflection();
    for (a, nfce) in new_faces.iter().enumerate() {
        let old = geometry.isometries[nfce.old];
        let predicted = if nfce.moving {
            reflection.after(&old)
        } else {
            old
        };
        let points = nfce.face.ring.iter().map(|v| next.vertices[v.index()]);
        let residual = new_geometry.isometries[a].distance_on(&predicted, points);
        if residual > TOL || residual.is_nan() {
            return Err(FoldRefusal::PredictionMismatch {
                face: nfce.face.id,
                residual,
            });
        }
    }

    next.order = carry_and_place(state, analysis, &new_faces, &child_of, &next, &new_geometry)?;

    // Letters of the new creases and the refolds.
    let mut refolded = Vec::with_capacity(refolds.len());
    let pending: Vec<usize> = (pending_from..next.creases.len())
        .chain(refolds.iter().map(|&(k, _)| k))
        .collect();
    for k in pending {
        let letter = derived_letter(&next, &new_topology, &new_geometry, k)?;
        next.creases[k].kind = CreaseKind::Folded(letter);
    }
    for (k, remembered) in refolds {
        if let CreaseKind::Folded(letter) = next.creases[k].kind {
            refolded.push(Refold {
                edge: next.creases[k].id,
                remembered,
                letter,
            });
        }
    }

    let moving_faces: Vec<FaceId> = new_faces
        .iter()
        .filter(|n| n.moving)
        .map(|n| n.face.id)
        .collect();
    let touched: BTreeSet<FaceId> = new_faces
        .iter()
        .filter(|n| n.moving || split[n.old])
        .map(|n| n.face.id)
        .collect();
    let landed = State::make_after(next, state, &touched)?;
    unfolded.sort_unstable();
    Ok((
        landed,
        Landed {
            moving_faces,
            created,
            unfolded,
            refolded,
            split: split_count,
        },
    ))
}

/// The new order: untouched pairs kept, children of old pairs carried by
/// class, moving × stationary pairs placed.
fn carry_and_place(
    state: &State,
    analysis: &Analysis,
    new_faces: &[NewFace],
    child_of: &[Vec<usize>],
    next: &StateParts,
    geometry: &Geometry,
) -> Result<LayerOrder, FoldRefusal> {
    let faces = state.faces();
    let touched_old: Vec<bool> = (0..faces.len())
        .map(|f| analysis.moving[f] || child_of[f].len() > 1)
        .collect();
    // Each new face meets many others: its edges' planes once, not per test.
    let planes: Vec<Vec<HalfPlane>> = geometry
        .images
        .iter()
        .map(|image| convex::edge_planes(image))
        .collect();
    let depth = |a: usize, b: usize| {
        convex::penetration_with_planes(
            &geometry.images[a],
            &planes[a],
            &geometry.images[b],
            &planes[b],
        )
    };
    let overlap = |a: usize, b: usize| {
        convex::boxes_overlap(&geometry.boxes[a], &geometry.boxes[b], 0.0)
            && convex::overlaps_with_planes(
                &geometry.images[a],
                &planes[a],
                &geometry.images[b],
                &planes[b],
                TOL,
            )
    };
    let id = |a: usize| next.faces[a].id;
    let set = |order: &mut LayerOrderBuilder, upper: usize, lower: usize| {
        order
            .set_above(id(upper), id(lower))
            .map_err(|_| FoldRefusal::DuplicateId {
                what: "face",
                id: id(upper).0,
            })
    };

    let mut order = LayerOrderBuilder::with_capacity(state.order().len());
    for (pair, lo_above) in state.order().pairs() {
        let Some(lo_above) = lo_above else {
            continue;
        };
        let (Some(f), Some(g)) = (
            state.face_position(pair.lo()),
            state.face_position(pair.hi()),
        ) else {
            continue;
        };
        if !touched_old[f] && !touched_old[g] {
            let (a, b) = (child_of[f][0], child_of[g][0]);
            if lo_above {
                set(&mut order, a, b)?;
            } else {
                set(&mut order, b, a)?;
            }
            continue;
        }
        for &a in &child_of[f] {
            for &b in &child_of[g] {
                if new_faces[a].moving != new_faces[b].moving || !overlap(a, b) {
                    continue;
                }
                // A moving block turns over, so its inner order reverses.
                let a_above = lo_above != new_faces[a].moving;
                if a_above {
                    set(&mut order, a, b)?;
                } else {
                    set(&mut order, b, a)?;
                }
            }
        }
    }

    let stationary_boxes: Vec<[f64; 4]> = new_faces
        .iter()
        .zip(&geometry.boxes)
        .map(|(n, b)| {
            if n.moving {
                convex::bounding_box(&[])
            } else {
                *b
            }
        })
        .collect();
    let index = BoxIndex::new(stationary_boxes);
    let on_top = analysis.direction == Direction::Valley;
    let mut panels = None;
    let mut narrow_geometry = None;
    for a in (0..new_faces.len()).filter(|&a| new_faces[a].moving) {
        for b in index.query(&geometry.boxes[a], 0.0) {
            let penetration = depth(a, b);
            if penetration <= TOL {
                continue;
            }
            if penetration < MIN_FEATURE && penetration < thinner(geometry, a, b) - TOL {
                if panels.is_none() {
                    panels = Some(FlatPanels::new(next, geometry, |x, y| {
                        new_faces[x].moving == new_faces[y].moving
                    })?);
                }
                if let Some(depth) = panels.as_ref().and_then(|p| p.sliver(geometry, a, b)) {
                    // Width alone does not make an overlap invalid. Ask the
                    // actual layer-order arrangement whether its pair, cells,
                    // hinges and constraints agree at TOL. The final state
                    // still has to pass every ordering constraint below.
                    if narrow_geometry.is_none() {
                        narrow_geometry = Some(crate::Unordered::new(next.clone(), [])?);
                    }
                    if narrow_geometry
                        .as_ref()
                        .is_some_and(|u| !u.problem().ambiguities().is_empty())
                    {
                        return Err(sliver(state, new_faces, next, geometry, a, b, depth));
                    }
                }
            }
            let moving_above = match &analysis.tuck {
                Some(tuck) => !tuck.ends_above[new_faces[b].old],
                None => on_top,
            };
            if moving_above {
                set(&mut order, a, b)?;
            } else {
                set(&mut order, b, a)?;
            }
        }
    }
    Ok(order.build())
}

/// The lesser width of two faces' images.
///
/// A face between μ/2 and μ wide is allowed (the thin-piece rule), and lying
/// across another face it overlaps by its own width, less than μ. That
/// overlap is the face, not a sliver between two faces, so the sliver rule
/// only refuses an overlap thinner than both faces. On the random campaign
/// this exempted 31 of 685 sliver refusals; the rest were overlaps of 1e-4 to
/// 1e-3 between faces several times wider.
pub(crate) fn thinner(geometry: &Geometry, a: usize, b: usize) -> f64 {
    convex::width(&geometry.images[a]).min(convex::width(&geometry.images[b]))
}

/// A sliver between the moving face at position `a` and the stationary face
/// at `b`, named in the parent state the user is looking at: the moving
/// vertex that lands deepest inside the stationary face, and that face (the
/// parent's face, should the fold have split it).
fn sliver(
    state: &State,
    new_faces: &[NewFace],
    next: &StateParts,
    geometry: &Geometry,
    a: usize,
    b: usize,
    penetration: f64,
) -> FoldRefusal {
    let (at, _) = deepest(&geometry.images[a], &geometry.images[b]);
    let ring = &next.faces[a].ring;
    let front_up = geometry.isometries[a].front_up();
    FoldRefusal::Sliver {
        vertex: ring[ring_position(at, ring.len(), front_up)],
        face: state.faces()[new_faces[b].old].id,
        penetration,
    }
}

/// The vertex of `p` deepest inside `q` (the least distance to `q`'s edge
/// lines), and that depth.
pub(crate) fn deepest(p: &[Point], q: &[Point]) -> (usize, f64) {
    let planes: Vec<HalfPlane> = (0..q.len())
        .filter_map(|i| HalfPlane::left_of(q[i], q[(i + 1) % q.len()]))
        .collect();
    let mut best = (0, f64::NEG_INFINITY);
    for (i, &x) in p.iter().enumerate() {
        let depth = planes
            .iter()
            .map(|h| h.signed_distance(x))
            .fold(f64::INFINITY, f64::min);
        if depth > best.1 {
            best = (i, depth);
        }
    }
    best
}

/// A folded crease's letter from the order: valley iff its front-up face lies
/// below the other.
fn derived_letter(
    next: &StateParts,
    topology: &Topology,
    geometry: &Geometry,
    k: usize,
) -> Result<Letter, FoldRefusal> {
    let crease = &next.creases[k];
    let [f, g] = match topology.crease_faces[k][..] {
        [f, g] => [f, g],
        _ => {
            return Err(FoldRefusal::CreaseFaceCount {
                edge: crease.id,
                faces: topology.crease_faces[k].len(),
            });
        }
    };
    let (f_up, g_up) = (
        geometry.isometries[f].front_up(),
        geometry.isometries[g].front_up(),
    );
    let ids = [next.faces[f].id, next.faces[g].id];
    if f_up == g_up {
        return Err(FoldRefusal::HingeOrientation {
            edge: crease.id,
            faces: ids,
            kind: "folded",
        });
    }
    let (up, other) = if f_up {
        (ids[0], ids[1])
    } else {
        (ids[1], ids[0])
    };
    match next.order.above(other, up) {
        Some(true) => Ok(Letter::Valley),
        Some(false) => Ok(Letter::Mountain),
        None => Err(FoldRefusal::LayerOrder {
            violations: FacePair::new(up, other)
                .map(|pair| Violation::MissingPair { pair })
                .into_iter()
                .collect(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_deepest_vertex_names_the_sliver() {
        let q = vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];
        let p = vec![[0.9999, 0.5], [2.0, 0.0], [2.0, 1.0]];
        let (i, depth) = deepest(&p, &q);
        assert_eq!(i, 0);
        assert!((depth - 1e-4).abs() < 1e-12);
    }
}

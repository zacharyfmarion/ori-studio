//! The pipeline's steps 3–7 for paper scored any way (plan D4, research
//! §5.1): the hinge diff the blocks' motions imply, the derivation from the
//! stayer, the gate, the carry and the seeds.
//!
//! How the paper is scored is the macro's. A fold along one line scores
//! through [`super::prepare`]; a fold whose layers crease on lines of their
//! own (the squash: one line per layer, research §5.3) scores along each in
//! turn ([`score_cuts`]); a fold whose creases meet inside the paper (the
//! rabbit ear and the swivel) scores through a fan (`super::fan`). Each hands
//! over its [`Pieces`]: every scored face with the parent face it came from
//! and the block it moves with. From there the steps are one implementation.

use std::collections::BTreeSet;

use oristudio_geometry::convex;
use oristudio_layer_order::{LayerOrder, Violation};

use crate::complete::{FixedKind, FixedPair};
use crate::compound::{Across, Against, Prepared};
use crate::flat_panels::FlatPanels;
use crate::fold::apply::{deepest, thinner};
use crate::fold::line::{self, Axis};
use crate::fold::score;
use crate::isometry::Isometry;
use crate::numerics::{MIN_FEATURE, TOL};
use crate::pattern::{Crease, CreaseKind, EdgeId, Face, FaceId, VertexId};
use crate::refusal::{FoldRefusal, Refused};
use crate::state::{State, StateParts, Topology, ring_position};
use crate::unordered::Unordered;

type Point = [f64; 2];

/// The parent's paper after scoring, before any hinge changes.
#[derive(Debug, Clone)]
pub(crate) struct Scoring {
    /// The parent's vertices, then the new ones.
    pub(crate) vertices: Vec<Point>,
    /// In id order: the faces kept, with their ids, then the pieces.
    pub(crate) faces: Vec<Face>,
    /// Per face, the position of the parent face it is or is a piece of.
    pub(crate) old: Vec<usize>,
    /// In id order.
    pub(crate) creases: Vec<Crease>,
    /// The new creases, ascending: each folded, its letter a placeholder.
    pub(crate) created: Vec<EdgeId>,
    /// How many faces the scores split.
    pub(crate) split: usize,
}

impl Scoring {
    /// The parent's paper as it is: nothing scored (a petal fold over its
    /// precreases).
    pub(crate) fn unscored(state: &State) -> Scoring {
        let parts = state.parts();
        Scoring {
            vertices: parts.vertices.clone(),
            faces: parts.faces.clone(),
            old: (0..parts.faces.len()).collect(),
            creases: parts.creases.clone(),
            created: Vec::new(),
            split: 0,
        }
    }

    /// One line's scoring.
    pub(crate) fn of(scored: score::Scored) -> Scoring {
        let score::Scored {
            vertices,
            faces,
            creases,
            created,
            split,
            ..
        } = scored;
        let old = faces.iter().map(|s| s.old).collect();
        Scoring {
            vertices,
            faces: faces.into_iter().map(|s| s.face).collect(),
            old,
            creases,
            created,
            split,
        }
    }

    /// Per parent face position (of `parents` faces), its faces' positions.
    pub(crate) fn child_of(&self, parents: usize) -> Vec<Vec<usize>> {
        let mut child_of = vec![Vec::new(); parents];
        for (a, &o) in self.old.iter().enumerate() {
            if let Some(children) = child_of.get_mut(o) {
                children.push(a);
            }
        }
        child_of
    }

    /// A face's sheet polygon.
    pub(crate) fn polygon(&self, a: usize) -> Vec<Point> {
        self.faces[a]
            .ring
            .iter()
            .map(|v| self.vertices[v.index()])
            .collect()
    }
}

/// A line to score along, and the parent's faces it may split: those of
/// them it crosses.
#[derive(Debug, Clone)]
pub(crate) struct Cut {
    pub(crate) axis: Axis,
    /// Per parent face position.
    pub(crate) faces: Vec<bool>,
}

/// The parent scored along each cut in turn, every split through the one
/// scoring step every fold shares (`fold::score`). A cut classifies only
/// the vertices of the faces it may split: paper elsewhere near its line is
/// no near miss, since the line folds nothing there.
pub(crate) fn score_cuts(state: &State, cuts: &[Cut]) -> Result<Scoring, Refused> {
    let step = state.step() + 1;
    let mut parts = state.parts().clone();
    let mut topology = state.topology().clone();
    let mut isometries = state.geometry().isometries.clone();
    let mut images = state.geometry().vertex_images.clone();
    let mut old: Vec<usize> = (0..parts.faces.len()).collect();
    let mut created: Vec<EdgeId> = Vec::new();
    let mut split = 0;
    for cut in cuts {
        let may: Vec<bool> = old
            .iter()
            .map(|&o| cut.faces.get(o).copied().unwrap_or(false))
            .collect();
        let mut among: Vec<usize> = parts
            .faces
            .iter()
            .zip(&may)
            .filter(|(_, may)| **may)
            .flat_map(|(face, _)| face.ring.iter().map(|v| v.index()))
            .collect();
        among.sort_unstable();
        among.dedup();
        if among.is_empty() {
            continue;
        }
        let compact: Vec<Point> = among.iter().map(|&v| images[v]).collect();
        let classified = line::classify(&compact, cut.axis).map_err(|mut refused| {
            if let FoldRefusal::NearMiss { vertex, .. } = &mut refused.refusal {
                *vertex = VertexId(among[vertex.index()] as u32);
            }
            refused
        })?;
        let mut classes = vec![0_i8; parts.vertices.len()];
        let mut distances = vec![0.0; parts.vertices.len()];
        for (j, &v) in among.iter().enumerate() {
            classes[v] = classified.classes[j];
            distances[v] = classified.distances[j];
        }
        let has = |f: usize, class: i8| {
            parts.faces[f]
                .ring
                .iter()
                .any(|v| classes[v.index()] == class)
        };
        let splits: Vec<bool> = (0..parts.faces.len())
            .map(|f| may[f] && has(f, 1) && has(f, -1))
            .collect();
        if !splits.contains(&true) {
            continue;
        }
        let next_ids = (
            parts.faces.iter().map(|f| f.id.0 + 1).max().unwrap_or(0),
            parts.creases.iter().map(|c| c.id.0 + 1).max().unwrap_or(0),
        );
        let scored = score::score_with_boundary_vertices(
            &parts, &topology, &classes, &distances, &splits, step, next_ids,
        )?;

        // An earlier cut's crease this one crossed is its two halves now.
        let mut kept_created = Vec::with_capacity(created.len());
        for id in created {
            if scored.creases.binary_search_by_key(&id, |c| c.id).is_ok() {
                kept_created.push(id);
                continue;
            }
            let Some([a, b]) = parts
                .creases
                .binary_search_by_key(&id, |c| c.id)
                .ok()
                .map(|k| parts.creases[k].vertices)
            else {
                continue;
            };
            let halves = scored.creases.windows(2).find(|pair| {
                pair[0].id.0 >= next_ids.1
                    && pair[1].id.0 == pair[0].id.0 + 1
                    && pair[0].vertices[0] == a
                    && pair[1].vertices[1] == b
                    && pair[0].vertices[1] == pair[1].vertices[0]
            });
            if let Some(pair) = halves {
                kept_created.extend([pair[0].id, pair[1].id]);
            }
        }
        kept_created.extend(scored.created.iter().copied());
        kept_created.sort_unstable();
        created = kept_created;
        split += scored.split;

        // The pieces keep their face's isometry: nothing has moved yet.
        let old_count = parts.vertices.len();
        let next_isometries: Vec<Isometry> =
            scored.faces.iter().map(|s| isometries[s.old]).collect();
        images.resize(scored.vertices.len(), [0.0, 0.0]);
        for (s, t) in scored.faces.iter().zip(&next_isometries) {
            for v in s.face.ring.iter().filter(|v| v.index() >= old_count) {
                images[v.index()] = t.apply(scored.vertices[v.index()]);
            }
        }
        old = scored.faces.iter().map(|s| old[s.old]).collect();
        isometries = next_isometries;
        parts.vertices = scored.vertices;
        parts.creases = scored.creases;
        parts.faces = scored.faces.into_iter().map(|s| s.face).collect();
        topology = Topology::build(&parts)?;
    }
    // Every piece names the parent's face as its own, numbered afresh in
    // order from the parent's next id: a piece one cut made and a later one
    // split again never was (the crimp's rule). Pieces cut once keep theirs.
    let next_face = state.faces().iter().map(|f| f.id.0 + 1).max().unwrap_or(0);
    let mut fresh = next_face;
    for (face, &o) in parts.faces.iter_mut().zip(&old) {
        if face.id.0 >= next_face {
            face.id = FaceId(fresh);
            face.parent = Some(state.faces()[o].id);
            fresh += 1;
        }
    }
    Ok(Scoring {
        vertices: parts.vertices,
        faces: parts.faces,
        old,
        creases: parts.creases,
        created,
        split,
    })
}

/// A compound fold with its paper scored and its faces in blocks (steps 1
/// and 2 done).
#[derive(Debug, Clone)]
pub(crate) struct Pieces {
    pub(crate) scoring: Scoring,
    /// Per scored face, the block it moves with; none for a face that stays.
    pub(crate) block_of: Vec<Option<usize>>,
    /// Each block's motion in the parent's model frame: a face's isometry
    /// becomes `motion ∘ T`.
    pub(crate) blocks: Vec<Isometry>,
    pub(crate) against: Vec<Against>,
    pub(crate) across: Across,
}

/// Steps 3–7 of a scored compound fold on `state`, as its next step.
pub(crate) fn prepare_pieces(state: &State, pieces: Pieces) -> Result<Prepared, FoldRefusal> {
    let parts = state.parts();
    let geometry = state.geometry();
    let nf = parts.faces.len();
    let step = state.step() + 1;
    let Pieces {
        scoring,
        block_of,
        blocks,
        against,
        across,
    } = pieces;
    let child_of = scoring.child_of(nf);
    let split: Vec<bool> = child_of.iter().map(|c| c.len() > 1).collect();
    let predicted: Vec<Isometry> = scoring
        .old
        .iter()
        .zip(&block_of)
        .map(|(&o, block)| {
            let old = geometry.isometries[o];
            match block {
                Some(b) => blocks[*b].after(&old),
                None => old,
            }
        })
        .collect();
    let root = {
        let r = state
            .face_position(parts.root)
            .ok_or(FoldRefusal::UnknownRoot { face: parts.root })?;
        child_of[r]
            .iter()
            .copied()
            .find(|&a| block_of[a].is_none())
            .or_else(|| block_of.iter().position(Option::is_none))
            .ok_or(FoldRefusal::NothingStays)?
    };
    let Scoring {
        vertices,
        faces,
        old: old_of,
        creases,
        created,
        split: split_count,
    } = scoring;
    // Crease marks ride along, less what a new crease along one covers.
    let marks = crate::crease_marks::carry(&parts.marks, &vertices, &creases);
    let mut next = StateParts {
        sheet: parts.sheet.clone(),
        vertices,
        creases,
        faces,
        root: FaceId(0),
        root_isometry: geometry.isometries[old_of[root]],
        order: LayerOrder::new(),
        view: parts.view,
        step,
        marks,
    };
    next.root = next.faces[root].id;
    let topology = Topology::build(&next)?;

    // 3. The hinge diff the motions imply.
    let mut unknown = Vec::new();
    let mut unfolded = Vec::new();
    let mut refolds = Vec::new();
    let mut relettered = Vec::new();
    for k in 0..next.creases.len() {
        let [f, g] = match topology.crease_faces[k][..] {
            [f, g] => [f, g],
            _ => continue,
        };
        let folds = predicted[f].front_up() != predicted[g].front_up();
        let crease = &mut next.creases[k];
        if created.binary_search(&crease.id).is_ok() {
            if !folds {
                return Err(FoldRefusal::HingeOrientation {
                    edge: crease.id,
                    faces: [next.faces[f].id, next.faces[g].id],
                    kind: "folded",
                });
            }
            unknown.push(crease.id);
            continue;
        }
        match (crease.kind, folds) {
            (CreaseKind::Folded(letter), true) if block_of[f] != block_of[g] => {
                unknown.push(crease.id);
                relettered.push((k, letter));
            }
            (CreaseKind::Folded(letter), false) => {
                crease.kind = CreaseKind::Flat(letter);
                unfolded.push(crease.id);
            }
            (CreaseKind::Flat(letter), true) => {
                crease.kind = CreaseKind::Folded(letter);
                unknown.push(crease.id);
                refolds.push((k, letter));
            }
            _ => {}
        }
    }

    // 4–5. Derive from the stayer and gate the geometry.
    let ids: Vec<FaceId> = next.faces.iter().map(|f| f.id).collect();
    let touched: BTreeSet<FaceId> = (0..ids.len())
        .filter(|&a| block_of[a].is_some() || split[old_of[a]])
        .map(|a| ids[a])
        .collect();
    let focus: BTreeSet<FaceId> = (0..ids.len())
        .filter(|&a| block_of[a].is_some())
        .map(|a| ids[a])
        .collect();
    let rings: Vec<Vec<Point>> = next
        .faces
        .iter()
        .map(|f| f.ring.iter().map(|v| next.vertices[v.index()]).collect())
        .collect();
    let unordered = Unordered::after(next, unknown, state, touched, focus)?;
    // The parts keep their id order, so positions are the scored ones.
    let landed = unordered.geometry();
    for (a, ring) in rings.iter().enumerate() {
        let residual = landed.isometries[a].distance_on(&predicted[a], ring.iter().copied());
        if residual > TOL || residual.is_nan() {
            return Err(FoldRefusal::PredictionMismatch {
                face: ids[a],
                residual,
            });
        }
    }
    let position = |id: FaceId| ids.binary_search(&id).ok();
    image_guard(state, &unordered, &blocks, &block_of, &old_of, &position)?;
    if !unordered.problem().ambiguities().is_empty() {
        return Err(FoldRefusal::LayerOrder {
            violations: unordered
                .problem()
                .ambiguities()
                .iter()
                .map(|&ambiguity| Violation::AmbiguousOverlap { ambiguity })
                .collect(),
        });
    }

    // 6–7. Carry and seed.
    let problem = unordered.problem();
    let mut fixed = Vec::new();
    let pair = |upper: usize, lower: usize, kind: FixedKind| {
        problem
            .is_variable(ids[upper], ids[lower])
            .then_some(FixedPair {
                upper: ids[upper],
                lower: ids[lower],
                kind,
            })
    };
    for (old, lo_above) in state.order().pairs() {
        let Some(lo_above) = lo_above else {
            continue;
        };
        let (Some(f), Some(g)) = (state.face_position(old.lo()), state.face_position(old.hi()))
        else {
            continue;
        };
        for &a in &child_of[f] {
            for &b in &child_of[g] {
                let (a_above, kind) = match (block_of[a], block_of[b]) {
                    (None, None) => (lo_above, FixedKind::Carried),
                    // A block turns over under a reflection: its inner order
                    // reverses.
                    (Some(x), Some(y)) if x == y => {
                        (lo_above == blocks[x].front_up(), FixedKind::Carried)
                    }
                    (Some(x), Some(y)) => match &across {
                        Across::Keep => (lo_above, FixedKind::Seed),
                        Across::Alike if alike(&blocks, x, y) => (lo_above, FixedKind::Seed),
                        Across::Packets {
                            coupled,
                            alike_only,
                        } => {
                            if coupled.contains(&[x.min(y), x.max(y)]) {
                                (lo_above == blocks[x].front_up(), FixedKind::Seed)
                            } else if !alike_only || alike(&blocks, x, y) {
                                (lo_above, FixedKind::Seed)
                            } else {
                                continue;
                            }
                        }
                        Across::Alike | Across::Free => continue,
                    },
                    _ => continue,
                };
                fixed.extend(if a_above {
                    pair(a, b, kind)
                } else {
                    pair(b, a, kind)
                });
            }
        }
    }
    // Every pair from here on places a block against paper it lands on.
    let placed = fixed.len();
    for against in &against {
        let body: Vec<usize> = against
            .faces
            .iter()
            .flat_map(|&p| child_of[p].iter().copied())
            .filter(|&s| block_of[s].is_none())
            .collect();
        for a in (0..ids.len()).filter(|&a| block_of[a] == Some(against.block)) {
            for &s in &body {
                fixed.extend(if against.above {
                    pair(a, s, FixedKind::Seed)
                } else {
                    pair(s, a, FixedKind::Seed)
                });
            }
        }
    }

    let moving = (0..nf)
        .filter(|&f| child_of[f].iter().any(|&a| block_of[a].is_some()))
        .map(|f| parts.faces[f].id)
        .collect();
    unfolded.sort_unstable();
    Ok(Prepared {
        unordered,
        fixed,
        placed,
        block_of,
        blocks: blocks.len(),
        moving,
        created,
        unfolded,
        refolds,
        relettered,
        split: split_count,
    })
}

/// Whether blocks `x` and `y` move by the same motion.
fn alike(blocks: &[Isometry], x: usize, y: usize) -> bool {
    let (p, q) = (blocks[x].0, blocks[y].0);
    p.iter().zip(&q).all(|(a, b)| (a - b).abs() <= 1e-12)
}

/// The image–image guard (plan D5, research §6): every pair whose relative
/// motion changed — a moving face against one that stays, and faces of two
/// blocks that move differently — that overlaps by more than the tolerance
/// but less than the minimum feature is a sliver, named by the moving vertex
/// deepest inside the other face and that face in the parent.
fn image_guard(
    state: &State,
    unordered: &Unordered,
    blocks: &[Isometry],
    block_of: &[Option<usize>],
    old_of: &[usize],
    position: &impl Fn(FaceId) -> Option<usize>,
) -> Result<(), FoldRefusal> {
    // A small overlap is allowed when the real arrangement represents it
    // consistently. Completion and the final state gate still check its order.
    if unordered.problem().ambiguities().is_empty() {
        return Ok(());
    }
    let geometry = unordered.geometry();
    let mut panels = None;
    for pair in unordered.problem().variables() {
        let (Some(a), Some(b)) = (position(pair.lo()), position(pair.hi())) else {
            continue;
        };
        let changed = match (block_of[a], block_of[b]) {
            (None, None) => false,
            (Some(x), Some(y)) => x != y && !alike(blocks, x, y),
            _ => true,
        };
        if !changed {
            continue;
        }
        let penetration = convex::penetration(&geometry.images[a], &geometry.images[b]);
        if penetration < MIN_FEATURE && penetration < thinner(geometry, a, b) - TOL {
            if panels.is_none() {
                panels = Some(FlatPanels::new(
                    unordered.parts(),
                    geometry,
                    |x, y| match (block_of[x], block_of[y]) {
                        (None, None) => true,
                        (Some(x), Some(y)) => x == y || alike(blocks, x, y),
                        _ => false,
                    },
                )?);
            }
            let Some(penetration) = panels.as_ref().and_then(|p| p.sliver(geometry, a, b)) else {
                continue;
            };
            let (mover, other) = if block_of[a].is_some() {
                (a, b)
            } else {
                (b, a)
            };
            let (at, _) = deepest(&geometry.images[mover], &geometry.images[other]);
            let ring = &unordered.parts().faces[mover].ring;
            let front_up = geometry.isometries[mover].front_up();
            return Err(FoldRefusal::Sliver {
                vertex: ring[ring_position(at, ring.len(), front_up)],
                face: state.faces()[old_of[other]].id,
                penetration,
            });
        }
    }
    Ok(())
}

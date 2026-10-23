//! What moves (plan D3 step 3, research §4.2 steps 2–4): the moving-side
//! pieces, the seed, the flaps, and the closure U.
//!
//! The closure grows the seed by two rules until nothing joins:
//!
//! - **(i) adjacency** across a crease with at least one end on the moving
//!   side. A crease with both ends on ℓ is a hinge, not adjacency; a crease
//!   entirely on the stationary side, or touching ℓ at one end only, connects
//!   nothing that moves. Without that qualifier a layer folded earlier on the
//!   stationary side would drag the layer it is hinged to along (the unit
//!   test folds a strip at y = 0.2, then its top layer at y = 0.3).
//! - **(ii) overlap**: a moving-side piece overlapping a member of U by more
//!   than [`TOL`] and lying above it (valley) or below it (mountain) joins U,
//!   because the member cannot rotate through it.
//!
//! **Flaps** are the components of rule (i) alone. U is always a union of
//! flaps, so "which flaps did the closure add" has an exact answer.
//!
//! "Everything would move" is a refusal from U, never from where ℓ sits; its
//! remedy is to pick a flap.

use std::collections::{BTreeMap, VecDeque};

use oristudio_geometry::convex;
use oristudio_layer_order::{FacePair, Violation};

use crate::fold::line::{Axis, Classified};
use crate::fold::{ClosurePolicy, Placement, ResolvedSeed};
use crate::index::BoxIndex;
use crate::numerics::TOL;
use crate::pattern::FaceId;
use crate::refusal::{Fix, Flap, FoldRefusal, Refused};
use crate::state::{State, sort_top_first};
use crate::view::Direction;

type Point = [f64; 2];

/// A tuck's placement: the stationary faces that end above the moving block.
#[derive(Debug, Clone)]
pub(crate) struct Tuck {
    /// The named face's position.
    target: usize,
    /// Per face position.
    pub(crate) ends_above: Vec<bool>,
    /// Faces rule (ii) leaves in place: they end on the side the block would
    /// otherwise sweep them from.
    keep: Vec<bool>,
}

/// Everything decided before the paper is cut.
#[derive(Debug, Clone)]
pub(crate) struct Analysis {
    pub(crate) classified: Classified,
    /// The direction in the model frame.
    pub(crate) direction: Direction,
    /// Per face position: whether it has a vertex on the stationary side.
    pub(crate) has_stationary: Vec<bool>,
    /// Per face position: whether it is in U.
    pub(crate) moving: Vec<bool>,
    pub(crate) flaps: Vec<Flap>,
    pub(crate) picked: Vec<usize>,
    pub(crate) added: Vec<usize>,
    pub(crate) tuck: Option<Tuck>,
}

impl Analysis {
    pub(crate) fn axis(&self) -> &Axis {
        &self.classified.axis
    }

    pub(crate) fn moved_faces(&self, state: &State) -> Vec<FaceId> {
        moved(state, &self.moving)
    }
}

fn moved(state: &State, moving: &[bool]) -> Vec<FaceId> {
    state
        .faces()
        .iter()
        .zip(moving)
        .filter(|(_, m)| **m)
        .map(|(f, _)| f.id)
        .collect()
}

/// Pieces, seed, flaps and closure for one fold of `state` along the
/// classified line.
pub(crate) fn analyse(
    state: &State,
    classified: Classified,
    direction: Direction,
    seed: &ResolvedSeed,
    placement: &Placement,
    policy: ClosurePolicy,
) -> Result<Analysis, Refused> {
    let side = moving_side(state, &classified)?;
    let seed_faces = resolve_seed(state, &side.pieces, direction, seed, &classified.axis)?;
    let mut closure = Closure::new(state, classified, direction, side, placement)?;
    closure.grow(&seed_faces)?;
    if let Some(refused) = closure.refusal() {
        return Err(refused);
    }
    let picked = closure.picked(&seed_faces);
    let added = closure.added(&picked);
    if policy == ClosurePolicy::Refuse && !added.is_empty() {
        return Err(Refused {
            refusal: FoldRefusal::ClosureAddsFlaps {
                added: added.clone(),
            },
            fixes: vec![Fix::IncludeFlaps { flaps: added }],
        });
    }
    let Closure {
        classified,
        direction,
        side,
        has_stationary,
        tuck,
        moving,
        ..
    } = closure;
    Ok(Analysis {
        classified,
        direction,
        has_stationary,
        moving,
        flaps: side.flaps,
        picked,
        added,
        tuck,
    })
}

/// U while it grows: the moving side, the tuck, and the faces in U so far.
///
/// [`analyse`] closes it once from a seed. The closure is monotone and
/// idempotent: both rules only ever add faces, and what a tuck keeps in place
/// does not depend on U. So the closure of a larger seed contains that of a
/// smaller one, and growing U by more faces from where it stopped gives the
/// closure of the larger seed from scratch. The depth preview
/// (`State::depth_choices`) grows it one layer at a time on that account.
pub(crate) struct Closure<'s> {
    state: &'s State,
    classified: Classified,
    direction: Direction,
    side: MovingSide,
    /// Per face position: whether it has a vertex on the stationary side.
    has_stationary: Vec<bool>,
    tuck: Option<Tuck>,
    /// Per face position, its piece's box (an empty box for no piece).
    boxes: Vec<[f64; 4]>,
    index: BoxIndex,
    /// Per face position: whether it is in U.
    moving: Vec<bool>,
}

impl<'s> Closure<'s> {
    /// An empty U on `side`, the moving side of `classified`. Refused when a
    /// tuck's target is in no face.
    pub(crate) fn new(
        state: &'s State,
        classified: Classified,
        direction: Direction,
        side: MovingSide,
        placement: &Placement,
    ) -> Result<Closure<'s>, Refused> {
        let has_stationary: Vec<bool> = state
            .faces()
            .iter()
            .map(|face| {
                face.ring
                    .iter()
                    .any(|v| classified.classes[v.index()] == -1)
            })
            .collect();
        let tuck = match placement {
            Placement::OnTop => None,
            Placement::Over { at } | Placement::Under { at } => {
                let target = state
                    .face_at(*at)
                    .and_then(|id| state.face_position(id))
                    .ok_or(FoldRefusal::WitnessNotInFace { point: *at })
                    .map_err(Refused::from)?;
                Some(tuck(
                    state,
                    target,
                    matches!(placement, Placement::Under { .. }),
                    direction,
                ))
            }
        };
        let boxes: Vec<[f64; 4]> = side
            .pieces
            .iter()
            .map(|p| match p {
                Some(p) => convex::bounding_box(p),
                None => convex::bounding_box(&[]),
            })
            .collect();
        let index = BoxIndex::new(boxes.clone());
        Ok(Closure {
            state,
            moving: vec![false; has_stationary.len()],
            classified,
            direction,
            side,
            has_stationary,
            tuck,
            boxes,
            index,
        })
    }

    /// Put `faces` (positions with a moving piece) in U and close it under
    /// both rules; whether U grew. Refused when a piece overlaps a member of
    /// U with their pair missing from the order, which a state that passed
    /// the gate never has (pieces overlap no more than their faces do).
    pub(crate) fn grow(&mut self, faces: &[usize]) -> Result<bool, Refused> {
        let state = self.state;
        let ids = state.faces();
        let wants_above = self.direction == Direction::Valley;
        let mut queue = VecDeque::new();
        for &f in faces {
            if !self.moving[f] {
                self.moving[f] = true;
                queue.push_back(f);
            }
        }
        let grew = !queue.is_empty();
        while let Some(q) = queue.pop_front() {
            for &p in &self.side.adjacent[q] {
                if !self.moving[p] {
                    self.moving[p] = true;
                    queue.push_back(p);
                }
            }
            let Some(piece_q) = &self.side.pieces[q] else {
                continue;
            };
            for p in self.index.query(&self.boxes[q], TOL) {
                if self.moving[p] || self.tuck.as_ref().is_some_and(|t| t.keep[p]) {
                    continue;
                }
                let Some(piece_p) = &self.side.pieces[p] else {
                    continue;
                };
                if convex::penetration(piece_p, piece_q) <= TOL {
                    continue;
                }
                let Some(above) = state.above(ids[p].id, ids[q].id) else {
                    return Err(missing_pair(ids[p].id, ids[q].id));
                };
                if above == wants_above {
                    self.moving[p] = true;
                    queue.push_back(p);
                }
            }
        }
        Ok(grew)
    }

    /// Why U cannot be folded: participating paper has a near miss,
    /// everything moves, or a tuck's target does. All stay true as U grows.
    pub(crate) fn refusal(&self) -> Option<Refused> {
        let faces = self.state.faces();
        let moving = &self.moving;
        if let Some(refused) = self.classified.refusal_for(
            faces
                .iter()
                .zip(moving)
                .filter(|(_, m)| **m)
                .flat_map(|(face, _)| face.ring.iter().copied()),
        ) {
            return Some(refused);
        }
        if (0..faces.len()).all(|f| moving[f] && !self.has_stationary[f]) {
            let flaps = &self.side.flaps;
            let fixes = if flaps.len() > 1 {
                vec![Fix::PickFlap {
                    flaps: flaps.clone(),
                }]
            } else {
                Vec::new()
            };
            return Some(Refused {
                refusal: FoldRefusal::NothingStays,
                fixes,
            });
        }
        // A target the fold splits keeps its stationary part, which is what
        // the block lands against; one that moves entirely is no target.
        if let Some(t) = &self.tuck
            && moving[t.target]
            && !self.has_stationary[t.target]
        {
            return Some(
                FoldRefusal::TuckTargetMoves {
                    face: faces[t.target].id,
                }
                .into(),
            );
        }
        None
    }

    /// The flaps of the seed's faces, ascending.
    pub(crate) fn picked(&self, seed_faces: &[usize]) -> Vec<usize> {
        let mut picked: Vec<usize> = seed_faces
            .iter()
            .filter_map(|&f| self.side.flap_of[f])
            .collect();
        picked.sort_unstable();
        picked.dedup();
        picked
    }

    /// The flaps in U beyond `picked`, ascending.
    pub(crate) fn added(&self, picked: &[usize]) -> Vec<usize> {
        let mut moving_flaps: Vec<usize> = (0..self.moving.len())
            .filter(|&f| self.moving[f])
            .filter_map(|f| self.side.flap_of[f])
            .collect();
        moving_flaps.sort_unstable();
        moving_flaps.dedup();
        moving_flaps
            .into_iter()
            .filter(|f| picked.binary_search(f).is_err())
            .collect()
    }

    /// U's faces, in id order.
    pub(crate) fn moved_faces(&self) -> Vec<FaceId> {
        moved(self.state, &self.moving)
    }
}

/// The moving side of a classified line before any seed: its pieces, rule
/// (i) and the flaps. [`analyse`] closes it from a seed; the cross-section
/// (plan D14) reads it as it is, so the two report the same flaps.
#[derive(Debug, Clone)]
pub(crate) struct MovingSide {
    /// Per face position, its image clipped to the moving side; none for a
    /// face with no vertex there.
    pub(crate) pieces: Vec<Option<Vec<Point>>>,
    /// Per face position, the faces rule (i) joins it to: across a crease
    /// with an end on the moving side.
    pub(crate) adjacent: Vec<Vec<usize>>,
    pub(crate) flaps: Vec<Flap>,
    /// Per face position, its flap; none for a face without a piece.
    pub(crate) flap_of: Vec<Option<usize>>,
}

/// The pieces, adjacency and flaps of `classified`'s moving side. Refused
/// when no face has a piece there.
pub(crate) fn moving_side(state: &State, classified: &Classified) -> Result<MovingSide, Refused> {
    let faces = state.faces();
    let geometry = state.geometry();
    let classes = &classified.classes;
    let axis = classified.axis;
    let half = axis
        .moving_half_plane()
        .ok_or(FoldRefusal::NoMovingSide)
        .map_err(Refused::from)?;
    // Pieces: each face with a vertex on the moving side, clipped to it.
    let pieces: Vec<Option<Vec<Point>>> = faces
        .iter()
        .enumerate()
        .map(|(f, face)| {
            face.ring
                .iter()
                .any(|v| classes[v.index()] == 1)
                .then(|| convex::split(&geometry.images[f], &half, TOL).inside)
                .filter(|piece| piece.len() >= 3)
        })
        .collect();
    if pieces.iter().all(Option::is_none) {
        return Err(FoldRefusal::NoMovingSide.into());
    }
    // Rule (i): creases with an end on the moving side.
    let mut adjacent: Vec<Vec<usize>> = vec![Vec::new(); faces.len()];
    for (k, crease) in state.creases().iter().enumerate() {
        let [a, b] = crease.vertices;
        if classes[a.index()].max(classes[b.index()]) < 1 {
            continue;
        }
        if let [f, g] = state.topology().crease_faces[k][..] {
            adjacent[f].push(g);
            adjacent[g].push(f);
        }
    }
    let (flaps, flap_of) = flaps_of(state, &pieces, &adjacent, &axis);
    Ok(MovingSide {
        pieces,
        adjacent,
        flaps,
        flap_of,
    })
}

/// The components of rule (i) among the faces with a moving piece, ordered
/// by their least face id, each with a witness; and each face's flap.
fn flaps_of(
    state: &State,
    pieces: &[Option<Vec<Point>>],
    adjacent: &[Vec<usize>],
    axis: &Axis,
) -> (Vec<Flap>, Vec<Option<usize>>) {
    let nf = pieces.len();
    let mut flap_of: Vec<Option<usize>> = vec![None; nf];
    let mut flaps = Vec::new();
    for start in 0..nf {
        if pieces[start].is_none() || flap_of[start].is_some() {
            continue;
        }
        let id = flaps.len();
        let mut members = vec![start];
        flap_of[start] = Some(id);
        let mut k = 0;
        while k < members.len() {
            let f = members[k];
            k += 1;
            for &g in &adjacent[f] {
                if pieces[g].is_some() && flap_of[g].is_none() {
                    flap_of[g] = Some(id);
                    members.push(g);
                }
            }
        }
        members.sort_unstable();
        flaps.push(Flap {
            faces: members.iter().map(|&f| state.faces()[f].id).collect(),
            witness: witness(state, members[0], pieces, axis),
        });
    }
    // Faces are in id order and each flap starts at its least position, so
    // the flaps are already ordered by their least face id.
    (flaps, flap_of)
}

/// An interior sheet point of face `f` whose image is on the moving side: its
/// moving piece's centroid, taken back to the sheet.
fn witness(state: &State, f: usize, pieces: &[Option<Vec<Point>>], axis: &Axis) -> Point {
    let geometry = state.geometry();
    let centroid = pieces[f]
        .as_deref()
        .and_then(convex::centroid)
        .filter(|c| axis.distance(*c) > TOL)
        .unwrap_or_else(|| {
            let image = &geometry.images[f];
            let n = image.len() as f64;
            let sum = image
                .iter()
                .fold([0.0, 0.0], |s, p| [s[0] + p[0], s[1] + p[1]]);
            [sum[0] / n, sum[1] / n]
        });
    geometry.isometries[f].inverse().apply(centroid)
}

/// The seed's face positions, each with a moving piece.
pub(crate) fn resolve_seed(
    state: &State,
    pieces: &[Option<Vec<Point>>],
    direction: Direction,
    seed: &ResolvedSeed,
    axis: &Axis,
) -> Result<Vec<usize>, Refused> {
    let in_face = |p: Point| -> Result<usize, Refused> {
        state
            .face_at(p)
            .and_then(|id| state.face_position(id))
            .ok_or(FoldRefusal::WitnessNotInFace { point: p }.into())
    };
    let faces: Vec<usize> = match seed {
        ResolvedSeed::All => (0..pieces.len()).filter(|&f| pieces[f].is_some()).collect(),
        ResolvedSeed::Faces(ids) => ids
            .iter()
            .filter_map(|&id| state.face_position(id))
            .filter(|&f| pieces[f].is_some())
            .collect(),
        ResolvedSeed::Flaps(points) => {
            let mut out = Vec::with_capacity(points.len());
            for &p in points {
                let f = in_face(p)?;
                let image = state.geometry().isometries[f].apply(p);
                if pieces[f].is_none() || axis.distance(image) <= TOL {
                    return Err(FoldRefusal::SeedNotOnMovingSide { point: p }.into());
                }
                out.push(f);
            }
            out
        }
        ResolvedSeed::Depth { at, layers } => {
            let f = in_face(*at)?;
            let image = state.geometry().isometries[f].apply(*at);
            if axis.distance(image) <= TOL {
                return Err(FoldRefusal::SeedNotOnMovingSide { point: *at }.into());
            }
            let ids: Vec<FaceId> = (0..pieces.len())
                .filter(|&g| {
                    pieces[g].is_some()
                        && convex::contains_point(&state.geometry().images[g], image, TOL)
                })
                .map(|g| state.faces()[g].id)
                .collect();
            let stack = sort_top_first(&ids, state.order()).ok_or_else(|| {
                Refused::from(FoldRefusal::LayerOrder {
                    violations: unstacked(state, &ids),
                })
            })?;
            let k = (*layers).min(stack.len());
            let chosen: Vec<FaceId> = match direction {
                Direction::Valley => stack[..k].to_vec(),
                Direction::Mountain => stack[stack.len() - k..].to_vec(),
            };
            chosen
                .into_iter()
                .filter_map(|id| state.face_position(id))
                .collect()
        }
    };
    if faces.is_empty() {
        return Err(FoldRefusal::EmptySeed.into());
    }
    Ok(faces)
}

/// Why a set of faces at one point has no stack: its absent pairs.
fn unstacked(state: &State, faces: &[FaceId]) -> Vec<Violation> {
    let mut out = Vec::new();
    for (i, &f) in faces.iter().enumerate() {
        for &g in &faces[i + 1..] {
            if state.above(f, g).is_none()
                && let Some(pair) = FacePair::new(f, g)
            {
                out.push(Violation::MissingPair { pair });
            }
        }
    }
    out
}

fn missing_pair(f: FaceId, g: FaceId) -> Refused {
    FoldRefusal::LayerOrder {
        violations: FacePair::new(f, g)
            .map(|pair| Violation::MissingPair { pair })
            .into_iter()
            .collect(),
    }
    .into()
}

/// A tuck over or under the face at position `target`: the faces that end
/// above the block are the target's upward chain (with the target itself for
/// "under"); rule (ii) leaves alone the faces on the side the block would
/// otherwise sweep (upward for a valley, downward for a mountain).
fn tuck(state: &State, target: usize, under: bool, direction: Direction) -> Tuck {
    let nf = state.faces().len();
    let mut over_of: BTreeMap<FaceId, Vec<FaceId>> = BTreeMap::new();
    let mut under_of: BTreeMap<FaceId, Vec<FaceId>> = BTreeMap::new();
    for (pair, lo_above) in state.order().pairs() {
        let Some(lo_above) = lo_above else {
            continue;
        };
        let (upper, lower) = if lo_above {
            (pair.lo(), pair.hi())
        } else {
            (pair.hi(), pair.lo())
        };
        over_of.entry(lower).or_default().push(upper);
        under_of.entry(upper).or_default().push(lower);
    }
    let chain = |next: &BTreeMap<FaceId, Vec<FaceId>>| {
        let mut seen = vec![false; nf];
        let mut stack = vec![state.faces()[target].id];
        while let Some(x) = stack.pop() {
            for &y in next.get(&x).map_or(&[][..], Vec::as_slice) {
                if let Some(p) = state.face_position(y)
                    && p != target
                    && !seen[p]
                {
                    seen[p] = true;
                    stack.push(y);
                }
            }
        }
        seen
    };
    let mut up = chain(&over_of);
    let mut down = chain(&under_of);
    if under {
        up[target] = true;
    } else {
        down[target] = true;
    }
    let keep = match direction {
        Direction::Valley => up.clone(),
        Direction::Mountain => down,
    };
    Tuck {
        target,
        ends_above: up,
        keep,
    }
}

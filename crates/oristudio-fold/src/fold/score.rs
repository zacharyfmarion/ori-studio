//! Scoring faces along a line (plan D3 step 4, D4 *score*; research §4.2
//! step 5, §5.1 step 2): the one split every fold makes, plain or compound.
//!
//! - Each crossed crease gets exactly one new vertex, at its sheet parameter,
//!   so the two faces it bounds cannot disagree about where it is.
//! - Each split ring has exactly two transitions between the line's sides,
//!   each through one vertex on the line; anything else is refused.
//! - A new crease shorter than the minimum feature, or a piece thinner than
//!   half of it, is refused.
//!
//! Which faces split is the caller's: a plain fold splits the moving faces
//! that cross ℓ, a compound fold the faces its macro scores. What the pieces
//! do next — which move, which creases fold — is the caller's too.

use std::collections::HashMap;

use oristudio_geometry::convex;

use crate::numerics::MIN_FEATURE;
use crate::pattern::{Crease, CreaseKind, EdgeId, Face, FaceId, Letter, VertexId};
use crate::refusal::FoldRefusal;
use crate::state::{StateParts, Topology};

type Point = [f64; 2];

/// Which part of an old face a new face is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Piece {
    /// Not split: the old face itself, with its id.
    Whole,
    /// The piece on the line's positive side (the moving side).
    Positive,
    /// The piece on its negative side.
    Negative,
}

/// A face after scoring and where it came from.
#[derive(Debug, Clone)]
pub(crate) struct ScoredFace {
    pub(crate) face: Face,
    /// The old face's position.
    pub(crate) old: usize,
    pub(crate) piece: Piece,
}

/// The parts after scoring, before any hinge changes.
#[derive(Debug, Clone)]
pub(crate) struct Scored {
    /// The old vertices, then one per crossed crease.
    pub(crate) vertices: Vec<Point>,
    /// In id order: the faces kept, in their old order, then each split
    /// face's positive and negative pieces.
    pub(crate) faces: Vec<ScoredFace>,
    /// Per old face position, its new face positions.
    pub(crate) child_of: Vec<Vec<usize>>,
    /// In id order: the creases kept, the halves of crossed ones, then the
    /// chords, each a new folded crease whose letter is still a placeholder.
    pub(crate) creases: Vec<Crease>,
    /// The chords' ids, the last of `creases`.
    pub(crate) created: Vec<EdgeId>,
    /// How many faces were split.
    pub(crate) split: usize,
}

impl Scored {
    /// The position of the first chord among `creases`.
    pub(crate) fn chords_from(&self) -> usize {
        self.creases.len() - self.created.len()
    }
}

/// A vertex's class against the line after scoring: an old vertex's from
/// `classes` (one per old vertex), a new one on the line.
pub(crate) fn class_of(classes: &[i8], v: VertexId) -> i8 {
    classes.get(v.index()).copied().unwrap_or(0)
}

/// Split the faces at the positions `split` marks along the line that
/// `classes` (per vertex: +1, −1, 0 on it) and `distances` (signed, positive
/// side +) describe, as step `step`, with fresh ids from `next_ids` (faces,
/// creases).
pub(crate) fn score(
    parts: &StateParts,
    topology: &Topology,
    classes: &[i8],
    distances: &[f64],
    split: &[bool],
    step: u32,
    next_ids: (u32, u32),
) -> Result<Scored, FoldRefusal> {
    score_inner(
        parts, topology, classes, distances, split, step, next_ids, false,
    )
}

/// Compound operations score different axes on adjacent material layers in
/// succession. A cut may therefore insert a collinear vertex on the boundary
/// of a face that this particular axis does not split. Preserve its identity
/// and refine its ring; a later cut and the final continuity gate determine
/// its motion. Plain-fold closure retains the stricter scoring contract.
pub(crate) fn score_with_boundary_vertices(
    parts: &StateParts,
    topology: &Topology,
    classes: &[i8],
    distances: &[f64],
    split: &[bool],
    step: u32,
    next_ids: (u32, u32),
) -> Result<Scored, FoldRefusal> {
    score_inner(
        parts, topology, classes, distances, split, step, next_ids, true,
    )
}

#[allow(clippy::too_many_arguments)]
fn score_inner(
    parts: &StateParts,
    topology: &Topology,
    classes: &[i8],
    distances: &[f64],
    split: &[bool],
    step: u32,
    next_ids: (u32, u32),
    refine_boundary: bool,
) -> Result<Scored, FoldRefusal> {
    let nf = parts.faces.len();
    let (mut next_face, mut next_crease) = next_ids;

    // One new vertex per crossed crease, by its sheet parameter.
    let mut vertices = parts.vertices.clone();
    let mut cut: HashMap<usize, VertexId> = HashMap::new();
    for f in (0..nf).filter(|&f| split[f]) {
        for (i, &k) in topology.face_creases[f].iter().enumerate() {
            if cut.contains_key(&k) {
                continue;
            }
            let ring = &parts.faces[f].ring;
            let (a, b) = (ring[i], ring[(i + 1) % ring.len()]);
            if classes[a.index()] * classes[b.index()] != -1 {
                continue;
            }
            let [lo, hi] = parts.creases[k].vertices;
            let (dl, dh) = (distances[lo.index()], distances[hi.index()]);
            let t = dl / (dl - dh);
            let (p, q) = (vertices[lo.index()], vertices[hi.index()]);
            let length = (q[0] - p[0]).hypot(q[1] - p[1]);
            for (end, part) in [(lo, t * length), (hi, (1.0 - t) * length)] {
                if part < MIN_FEATURE {
                    return Err(FoldRefusal::ShortCrease {
                        vertices: [end, VertexId(vertices.len() as u32)],
                        length: part,
                    });
                }
            }
            cut.insert(k, VertexId(vertices.len() as u32));
            vertices.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
        }
    }
    let old_vertices = parts.vertices.len();
    let class_of = |v: VertexId| class_of(classes, v);

    // Rings: unsplit faces keep theirs (and their ids), split faces become
    // a positive and a negative child.
    let mut kept: Vec<ScoredFace> = Vec::with_capacity(nf);
    let mut children: Vec<ScoredFace> = Vec::new();
    let mut chords: Vec<[VertexId; 2]> = Vec::new();
    for (f, face) in parts.faces.iter().enumerate() {
        let mut ring = Vec::with_capacity(face.ring.len() + 2);
        for (i, &v) in face.ring.iter().enumerate() {
            ring.push(v);
            if let Some(&x) = cut.get(&topology.face_creases[f][i]) {
                ring.push(x);
            }
        }
        if !split[f] {
            if !refine_boundary && ring.len() != face.ring.len() {
                return Err(FoldRefusal::DegenerateSplit { face: face.id });
            }
            kept.push(ScoredFace {
                face: Face {
                    ring,
                    ..face.clone()
                },
                old: f,
                piece: Piece::Whole,
            });
            continue;
        }
        let (positive_ring, negative_ring) =
            split_ring(&ring, &class_of).ok_or(FoldRefusal::DegenerateSplit { face: face.id })?;
        let chord = [positive_ring[0], negative_ring[0]];
        if chord.iter().all(|v| v.index() < old_vertices)
            && topology.crease_between(chord[0], chord[1]).is_some()
        {
            return Err(FoldRefusal::DegenerateSplit { face: face.id });
        }
        let [p, q] = chord.map(|v| vertices[v.index()]);
        let length = (q[0] - p[0]).hypot(q[1] - p[1]);
        if length < MIN_FEATURE {
            return Err(FoldRefusal::ShortCrease {
                vertices: chord,
                length,
            });
        }
        for piece in [&positive_ring, &negative_ring] {
            let polygon: Vec<Point> = piece.iter().map(|v| vertices[v.index()]).collect();
            let width = convex::width(&polygon);
            if width < MIN_FEATURE / 2.0 {
                return Err(FoldRefusal::ThinPiece {
                    face: face.id,
                    width,
                });
            }
        }
        chords.push(chord);
        for (ring, piece) in [
            (positive_ring, Piece::Positive),
            (negative_ring, Piece::Negative),
        ] {
            children.push(ScoredFace {
                face: Face {
                    id: FaceId(next_face),
                    ring,
                    parent: Some(face.id),
                    born: step,
                },
                old: f,
                piece,
            });
            next_face += 1;
        }
    }
    // Kept faces in old (id) order, then the children: id order.
    let faces: Vec<ScoredFace> = kept.into_iter().chain(children).collect();
    let mut child_of: Vec<Vec<usize>> = vec![Vec::new(); nf];
    for (a, scored) in faces.iter().enumerate() {
        child_of[scored.old].push(a);
    }

    // Creases: split halves, then the chords, after the kept ones (id
    // order).
    let mut kept_creases = Vec::with_capacity(parts.creases.len());
    let mut new_creases = Vec::new();
    for (k, crease) in parts.creases.iter().enumerate() {
        match cut.get(&k) {
            None => kept_creases.push(crease.clone()),
            Some(&x) => {
                let [a, b] = crease.vertices;
                for vertices in [[a, x], [x, b]] {
                    new_creases.push(Crease {
                        id: EdgeId(next_crease),
                        vertices,
                        ..crease.clone()
                    });
                    next_crease += 1;
                }
            }
        }
    }
    let mut created = Vec::with_capacity(chords.len());
    for chord in &chords {
        created.push(EdgeId(next_crease));
        new_creases.push(Crease {
            id: EdgeId(next_crease),
            vertices: *chord,
            // Its letter is derived from the order.
            kind: CreaseKind::Folded(Letter::Valley),
            made_at: step,
        });
        next_crease += 1;
    }
    Ok(Scored {
        vertices,
        faces,
        child_of,
        creases: kept_creases.into_iter().chain(new_creases).collect(),
        created,
        split: chords.len(),
    })
}

/// Split an augmented ring at its two transitions between the positive (+1)
/// and negative (−1) runs, each through exactly one vertex on the line.
/// Returns the positive ring, then the negative ring; each starts at the
/// other's last vertex, so `[positive[0], negative[0]]` is the chord.
fn split_ring(
    ring: &[VertexId],
    class_of: &impl Fn(VertexId) -> i8,
) -> Option<(Vec<VertexId>, Vec<VertexId>)> {
    let n = ring.len();
    let nonzero: Vec<usize> = (0..n).filter(|&j| class_of(ring[j]) != 0).collect();
    let (mut enter, mut leave, mut cuts) = (None, None, 0);
    for (k, &i) in nonzero.iter().enumerate() {
        let j = nonzero[(k + 1) % nonzero.len()];
        let (ci, cj) = (class_of(ring[i]), class_of(ring[j]));
        if ci == cj {
            continue;
        }
        if (j + n - i - 1) % n != 1 {
            return None;
        }
        cuts += 1;
        let at = (i + 1) % n;
        if ci == -1 {
            enter = Some(at);
        } else {
            leave = Some(at);
        }
    }
    let (enter, leave) = (enter?, leave?);
    if cuts != 2 {
        return None;
    }
    let arc = |from: usize, to: usize| {
        let mut out = Vec::new();
        let mut j = from;
        loop {
            out.push(ring[j]);
            if j == to {
                break;
            }
            j = (j + 1) % n;
        }
        out
    };
    let positive = arc(enter, leave);
    let negative = arc(leave, enter);
    (positive.len() >= 3 && negative.len() >= 3).then_some((positive, negative))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rings_split_at_two_transitions() {
        // A square 0..3 crossed by a line through new vertices 4 (on 0–1) and
        // 5 (on 2–3): 0 and 3 negative, 1 and 2 positive.
        let ring: Vec<VertexId> = [0, 4, 1, 2, 5, 3].map(VertexId).to_vec();
        let class = |v: VertexId| match v.0 {
            0 | 3 => -1,
            1 | 2 => 1,
            _ => 0,
        };
        let Some((m, s)) = split_ring(&ring, &class) else {
            panic!("no split");
        };
        assert_eq!(m, [4, 1, 2, 5].map(VertexId).to_vec());
        assert_eq!(s, [5, 3, 0, 4].map(VertexId).to_vec());
        // Through a vertex on the line (1) and a new one (5).
        let ring: Vec<VertexId> = [0, 1, 2, 5, 3].map(VertexId).to_vec();
        let class = |v: VertexId| match v.0 {
            0 | 3 => -1,
            2 => 1,
            _ => 0,
        };
        let Some((m, s)) = split_ring(&ring, &class) else {
            panic!("no split");
        };
        assert_eq!(m, [1, 2, 5].map(VertexId).to_vec());
        assert_eq!(s, [5, 3, 0, 1].map(VertexId).to_vec());
        // A transition with no vertex on the line is not a split.
        let ring: Vec<VertexId> = [0, 1, 2, 3].map(VertexId).to_vec();
        let class = |v: VertexId| if v.0 < 2 { 1 } else { -1 };
        assert!(split_ring(&ring, &class).is_none());
    }
}

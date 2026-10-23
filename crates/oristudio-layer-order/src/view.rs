//! The input: a flat folded state as the layer order sees it. Faces are their
//! convex images in folded coordinates, edges are the creases between two
//! faces; no crease pattern, isometry or history is needed.
//!
//! # Frame
//!
//! Folded coordinates are the viewer's frame: the viewer is at +z looking
//! down, x right, y up (research §3.1). A face is *front-up* when it shows the
//! paper's front to that viewer (`det T = +1`).

use std::collections::BTreeMap;
use std::fmt;

use oristudio_geometry::convex;
use oristudio_geometry::tol::TOL;
use serde::{Deserialize, Serialize};

use crate::error::LayerOrderError;

/// The most faces a view takes. The problem, the checker and the painters
/// build tables over every pair of a view's faces (`table.rs`): about seven
/// bytes a pair at their peak, so `n` faces cost about `7n²` bytes however
/// few of them overlap, and a wasm heap never gives that memory back.
///
/// Measured through the built bridge in Node (`foldImportFaceCap.wasm.test.ts`),
/// importing an `n × n` grid of precreases: 4,096 faces opened in 1.2 s at
/// 122 MB, and pleated 64 deep in 1.9 s, landing at 203 MB; 10,000 faces took
/// 8.6 s and 700 MB, 19,600 took 68 s and 2.6 GB, and 25,600 ran out of
/// wasm32's 4 GB and trapped, which in the browser kills the worker.
pub const MAX_FACES: usize = 4096;

/// A face's identity. The caller chooses it; keeping it stable for faces an
/// operation did not touch is what lets [`crate::problem::ConstraintProblem`]
/// rebuild incrementally.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct FaceId(pub u32);

impl fmt::Display for FaceId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// One face of the folded state.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Face {
    pub id: FaceId,
    /// The face's image in folded coordinates: a convex ring of either
    /// orientation. The view stores it counter-clockwise.
    pub polygon: Vec<[f64; 2]>,
    /// Whether the face shows its front to the viewer.
    pub front_up: bool,
}

/// A folded crease's letter, front-relative: valley iff its front-up face
/// lies below the other (research §3.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Letter {
    Mountain,
    Valley,
}

/// What a crease between two faces is in this state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EdgeKind {
    /// Folded (a *taco*): both faces lie on one side of the crease. A given
    /// letter is checked against the order; `None` is a crease whose letter is
    /// still to be derived.
    Folded(Option<Letter>),
    /// Unfolded, a precrease included (a *tortilla*): the faces lie on either
    /// side.
    Flat,
}

/// A crease between two faces. Paper-boundary edges are not edges here: they
/// constrain nothing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Edge {
    pub faces: [FaceId; 2],
    /// The crease's image in folded coordinates.
    pub segment: [[f64; 2]; 2],
    pub kind: EdgeKind,
}

/// A validated folded state: every face convex and wider than [`TOL`], every
/// edge on the boundary of both its faces with the sides its kind says.
#[derive(Debug, Clone, PartialEq)]
pub struct FoldedView {
    faces: Vec<Face>,
    edges: Vec<Edge>,
    index: BTreeMap<FaceId, usize>,
    /// The same index as a table on the id, `u32::MAX` for no face; empty
    /// when the ids are too sparse for one. The problem and the checker look
    /// faces up per constraint and per cell, where the map's lookups showed.
    dense: Vec<u32>,
    boxes: Vec<[f64; 4]>,
    /// Per edge, whether each face lies left of `segment[0] → segment[1]`.
    left: Vec<[bool; 2]>,
}

impl FoldedView {
    /// Validate a state. Face polygons are normalised (counter-clockwise,
    /// near-duplicate points merged); everything else is kept as given, in
    /// order. More than [`MAX_FACES`] faces are refused before anything is
    /// built, so no table over the view's pairs is ever larger than that.
    pub fn new(faces: Vec<Face>, edges: Vec<Edge>) -> Result<FoldedView, LayerOrderError> {
        if faces.len() > MAX_FACES {
            return Err(LayerOrderError::TooManyFaces {
                face_count: faces.len(),
                limit: MAX_FACES,
            });
        }
        let mut index = BTreeMap::new();
        let mut checked = Vec::with_capacity(faces.len());
        for face in faces {
            if index.insert(face.id, checked.len()).is_some() {
                return Err(LayerOrderError::DuplicateFace(face.id));
            }
            if face.polygon.iter().flatten().any(|c| !c.is_finite()) {
                return Err(LayerOrderError::InvalidPolygon {
                    face: face.id,
                    reason: "a coordinate is not finite",
                });
            }
            let polygon = convex::normalize(&face.polygon);
            if polygon.len() < 3 {
                return Err(LayerOrderError::InvalidPolygon {
                    face: face.id,
                    reason: "fewer than three distinct points",
                });
            }
            if !convex::is_convex(&polygon, TOL) {
                return Err(LayerOrderError::NonConvexFace(face.id));
            }
            if convex::width(&polygon) <= TOL {
                return Err(LayerOrderError::DegenerateFace(face.id));
            }
            checked.push(Face { polygon, ..face });
        }
        let boxes = checked
            .iter()
            .map(|f| convex::bounding_box(&f.polygon))
            .collect();
        let mut left = Vec::with_capacity(edges.len());
        for (e, edge) in edges.iter().enumerate() {
            left.push(edge_sides(e, edge, &checked, &index)?);
        }
        Ok(FoldedView {
            dense: dense_index(&index),
            faces: checked,
            edges,
            index,
            boxes,
            left,
        })
    }

    pub fn faces(&self) -> &[Face] {
        &self.faces
    }

    pub fn edges(&self) -> &[Edge] {
        &self.edges
    }

    pub fn face(&self, id: FaceId) -> Option<&Face> {
        self.index_of(id).map(|i| &self.faces[i])
    }

    /// The face's position in [`FoldedView::faces`].
    pub fn index_of(&self, id: FaceId) -> Option<usize> {
        if self.dense.is_empty() {
            return self.index.get(&id).copied();
        }
        match self.dense.get(id.0 as usize) {
            Some(&p) if p != u32::MAX => Some(p as usize),
            _ => None,
        }
    }

    pub fn front_up(&self, id: FaceId) -> Option<bool> {
        self.face(id).map(|f| f.front_up)
    }

    pub(crate) fn bounding_box(&self, index: usize) -> &[f64; 4] {
        &self.boxes[index]
    }

    /// Whether each face of edge `e` lies left of its directed segment.
    pub(crate) fn edge_left(&self, e: usize) -> [bool; 2] {
        self.left[e]
    }
}

/// The index as a table on the id when the largest id is under eight per face
/// (the engine's ids grow by two per split; FOLD's are positions); empty
/// otherwise.
fn dense_index(index: &BTreeMap<FaceId, usize>) -> Vec<u32> {
    let Some((&FaceId(last), _)) = index.last_key_value() else {
        return Vec::new();
    };
    if last as usize >= 8 * index.len() + 64 {
        return Vec::new();
    }
    let mut dense = vec![u32::MAX; last as usize + 1];
    for (&FaceId(id), &p) in index {
        dense[id as usize] = p as u32;
    }
    dense
}

/// Validate one edge and find which side of it each face lies on.
fn edge_sides(
    e: usize,
    edge: &Edge,
    faces: &[Face],
    index: &BTreeMap<FaceId, usize>,
) -> Result<[bool; 2], LayerOrderError> {
    let [f, g] = edge.faces;
    if f == g {
        return Err(LayerOrderError::SelfEdge { edge: e, face: f });
    }
    let [a, b] = edge.segment;
    if a.iter().chain(&b).any(|c| !c.is_finite()) {
        return Err(LayerOrderError::DegenerateEdge {
            edge: e,
            reason: "a coordinate is not finite",
        });
    }
    if (b[0] - a[0]).hypot(b[1] - a[1]) <= TOL {
        return Err(LayerOrderError::DegenerateEdge {
            edge: e,
            reason: "no longer than the tolerance",
        });
    }
    let Some(plane) = convex::HalfPlane::left_of(a, b) else {
        return Err(LayerOrderError::DegenerateEdge {
            edge: e,
            reason: "no direction",
        });
    };
    let mut left = [false; 2];
    for (k, id) in [f, g].into_iter().enumerate() {
        let Some(&i) = index.get(&id) else {
            return Err(LayerOrderError::UnknownEdgeFace { edge: e, face: id });
        };
        let polygon = &faces[i].polygon;
        // Both ends on the face's boundary, and the face on one side.
        let on_boundary = |p| {
            convex::contains_point(polygon, p, -TOL) && !convex::contains_point(polygon, p, TOL)
        };
        let (lo, hi) = polygon
            .iter()
            .map(|&p| plane.signed_distance(p))
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), d| {
                (lo.min(d), hi.max(d))
            });
        left[k] = if lo >= -TOL && hi > TOL {
            true
        } else if hi <= TOL && lo < -TOL {
            false
        } else {
            return Err(LayerOrderError::EdgeOffFace { edge: e, face: id });
        };
        if !on_boundary(a) || !on_boundary(b) {
            return Err(LayerOrderError::EdgeOffFace { edge: e, face: id });
        }
    }
    let same_side = left[0] == left[1];
    match (edge.kind, same_side) {
        (EdgeKind::Folded(_), false) => Err(LayerOrderError::EdgeKindMismatch {
            edge: e,
            kind: "folded",
            sides: "opposite sides",
        }),
        (EdgeKind::Flat, true) => Err(LayerOrderError::EdgeKindMismatch {
            edge: e,
            kind: "flat",
            sides: "the same side",
        }),
        _ => Ok(left),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn face(id: u32, polygon: Vec<[f64; 2]>, front_up: bool) -> Face {
        Face {
            id: FaceId(id),
            polygon,
            front_up,
        }
    }

    fn square(x0: f64, x1: f64) -> Vec<[f64; 2]> {
        vec![[x0, 0.0], [x1, 0.0], [x1, 1.0], [x0, 1.0]]
    }

    fn edge(f: u32, g: u32, segment: [[f64; 2]; 2], kind: EdgeKind) -> Edge {
        Edge {
            faces: [FaceId(f), FaceId(g)],
            segment,
            kind,
        }
    }

    #[test]
    fn a_valley_fold_validates_and_normalises_its_polygons() {
        // The right half folded onto the left: its image is clockwise.
        let mut back = square(0.0, 0.5);
        back.reverse();
        let view = FoldedView::new(
            vec![face(0, square(0.0, 0.5), true), face(1, back, false)],
            vec![edge(
                0,
                1,
                [[0.5, 0.0], [0.5, 1.0]],
                EdgeKind::Folded(Some(Letter::Valley)),
            )],
        );
        let view = view.unwrap_or_else(|e| panic!("{e}"));
        assert!(
            view.faces()
                .iter()
                .all(|f| convex::signed_area(&f.polygon) > 0.0)
        );
        assert_eq!(view.index_of(FaceId(1)), Some(1));
        assert_eq!(view.front_up(FaceId(1)), Some(false));
        // Both images lie at x < 0.5, left of the upward crease.
        assert_eq!(view.edge_left(0), [true, true]);
    }

    #[test]
    fn malformed_faces_are_refused() {
        let refuse = |faces: Vec<Face>| FoldedView::new(faces, Vec::new()).err();
        assert_eq!(
            refuse(vec![
                face(3, square(0.0, 1.0), true),
                face(3, square(2.0, 3.0), true)
            ]),
            Some(LayerOrderError::DuplicateFace(FaceId(3)))
        );
        assert!(matches!(
            refuse(vec![face(
                0,
                vec![[0.0, 0.0], [1.0, 0.0], [1.0, 0.0]],
                true
            )]),
            Some(LayerOrderError::InvalidPolygon { .. })
        ));
        assert!(matches!(
            refuse(vec![face(
                0,
                vec![[0.0, 0.0], [f64::NAN, 0.0], [0.0, 1.0]],
                true
            )]),
            Some(LayerOrderError::InvalidPolygon { .. })
        ));
        let dent = vec![[0.0, 0.0], [1.0, 0.0], [0.5, 0.2], [1.0, 1.0], [0.0, 1.0]];
        assert_eq!(
            refuse(vec![face(0, dent, true)]),
            Some(LayerOrderError::NonConvexFace(FaceId(0)))
        );
        let sliver = vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1e-7], [0.0, 1e-7]];
        assert_eq!(
            refuse(vec![face(0, sliver, true)]),
            Some(LayerOrderError::DegenerateFace(FaceId(0)))
        );
    }

    #[test]
    fn a_view_takes_up_to_the_face_cap_and_no_more() {
        // A row of unit squares side by side: nothing overlaps, so only the
        // count can refuse it.
        let row = |n: usize| -> Vec<Face> {
            (0..n)
                .map(|k| face(k as u32, square(k as f64, k as f64 + 1.0), true))
                .collect()
        };
        assert!(FoldedView::new(row(MAX_FACES), Vec::new()).is_ok());
        assert_eq!(
            FoldedView::new(row(MAX_FACES + 1), Vec::new()).err(),
            Some(LayerOrderError::TooManyFaces {
                face_count: MAX_FACES + 1,
                limit: MAX_FACES
            })
        );
    }

    #[test]
    fn malformed_edges_are_refused() {
        let faces = || {
            vec![
                face(0, square(0.0, 0.5), true),
                face(1, square(0.5, 1.0), true),
            ]
        };
        let refuse = |edges: Vec<Edge>| FoldedView::new(faces(), edges).err();
        let mid = [[0.5, 0.0], [0.5, 1.0]];
        assert_eq!(
            refuse(vec![edge(0, 7, mid, EdgeKind::Flat)]),
            Some(LayerOrderError::UnknownEdgeFace {
                edge: 0,
                face: FaceId(7)
            })
        );
        assert_eq!(
            refuse(vec![edge(1, 1, mid, EdgeKind::Flat)]),
            Some(LayerOrderError::SelfEdge {
                edge: 0,
                face: FaceId(1)
            })
        );
        assert!(matches!(
            refuse(vec![edge(0, 1, [[0.5, 0.0], [0.5, 1e-7]], EdgeKind::Flat)]),
            Some(LayerOrderError::DegenerateEdge { .. })
        ));
        // Side by side, so the crease between them is flat, not folded.
        assert!(matches!(
            refuse(vec![edge(0, 1, mid, EdgeKind::Folded(None))]),
            Some(LayerOrderError::EdgeKindMismatch { .. })
        ));
        // A segment through the middle of a face is not on its boundary.
        assert_eq!(
            refuse(vec![edge(0, 1, [[0.25, 0.0], [0.25, 1.0]], EdgeKind::Flat)]),
            Some(LayerOrderError::EdgeOffFace {
                edge: 0,
                face: FaceId(0)
            })
        );
        // On the line of a face's edge but beyond it.
        assert_eq!(
            refuse(vec![edge(0, 1, [[0.5, 2.0], [0.5, 3.0]], EdgeKind::Flat)]),
            Some(LayerOrderError::EdgeOffFace {
                edge: 0,
                face: FaceId(0)
            })
        );
        assert!(FoldedView::new(faces(), vec![edge(0, 1, mid, EdgeKind::Flat)]).is_ok());
    }
}

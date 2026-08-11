//! The FOLD `foldedForm` frame for a placed 3D figure.
//!
//! **Ori Studio native.** See [`crate::folding3d`].
//!
//! # What crosses, and what deliberately does not
//!
//! A folded form is interchange, not a second render path: it carries the paper
//! and the layer relation and nothing about appearance. No camera, no colour, no
//! display style, and — decisively — **no `nonSelfIntersecting`**. The crossing
//! predicate this pipeline runs is sound but not complete, so a `Folded` verdict
//! means no crossing was *detected*; claiming the stronger property in
//! `frame_attributes` would put a guarantee we cannot make into a file other
//! tools read.
//!
//! # The frame does not inherit
//!
//! The plan asked for `frame_inherit: true`, and that would be wrong here for a
//! reason that only shows up once both sides are written down. Inheritance is
//! *per property*: an inheriting frame takes every array it does not restate
//! from its parent. The root frame this one is parented to carries
//! `edges_assignment`, `edges_foldAngle`, `faces_edges` and two namespaced
//! per-edge colour arrays, all numbered against the **whole document's**
//! `FoldGraph`. A 3D fold is walked over a **selection**, through a second
//! `FoldGraph` with its own vertex, edge and face numbering, so every one of
//! those arrays would be inherited under the wrong index. The frame therefore
//! restates its own geometry and sets `frame_inherit: false`; `frame_parent`
//! still names the pattern it was folded from, which is the part that carries
//! meaning.
//!
//! # One position per vertex, and where it comes from
//!
//! [`Placement3d::face_points`] is deliberately not a shared point array — each
//! face carries its own image of its own ring, because averaging the images is
//! the operation that destroys the evidence a loop gap is made of. FOLD has no
//! such freedom: `vertices_coords` is one position per vertex. So the export
//! **welds**, and it welds by *choosing* rather than averaging — the image given
//! by the lowest-indexed face carrying that vertex. Every emitted coordinate is
//! then a genuine placed position of some face rather than a mean of two, the
//! choice is deterministic, and the disagreement it papers over is exactly the
//! loop gap the admission gate already bounded.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::json;
use treemaker_fold::{Assignment, FoldDocument};

use crate::checks_spatial::{Vec3, dot};
use crate::folding3d::order::Fold3dOrdering;
use crate::folding3d::placement::Placement3d;
use crate::folding3d::planes::PlaneIndex;

/// Marks a frame this build wrote, so re-exporting regenerates it instead of
/// stacking a second copy beside it — and so a frame that came from anywhere
/// else is never touched.
pub const FOLDED_FORM_MARKER: &str = "oristudio:folded3d";

/// The current [`folded_form_frame`] layout.
pub const FOLDED_FORM_FRAME_SCHEMA_VERSION: u32 = 1;

/// How large a folded-form frame may get before the export declines to write
/// it, counted in emitted array elements (vertices + face-ring entries + face
/// orders).
///
/// A coarse safety valve, not a tuned threshold. Measured over the whole
/// admitted non-flat corpus the widest frame is **24,902** elements
/// (`origamisimulator.fold`, 2,637 faces: 2,374 vertices, 12,736 face orders),
/// so the cap carries about 40× headroom and
/// `corpus_folded_form_frames_stay_under_the_cap` is what keeps that true. At
/// the cap a pretty-printed frame is roughly 20 MB, which is the size a browser
/// tab should refuse rather than attempt.
///
/// Stated against emitted elements rather than against a face count, because
/// the term that can grow quadratically is `face_orders` — one entry per
/// coplanar overlapping face pair — and the face count does not bound it. On
/// the widest model above, face orders alone are half the frame.
pub const FOLDED_FORM_MAX_ELEMENTS: usize = 1_000_000;

/// What one folded-form frame cost, in the units [`FOLDED_FORM_MAX_ELEMENTS`]
/// is stated in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct FoldedFormSize {
    pub vertices: usize,
    pub face_ring_entries: usize,
    pub face_orders: usize,
}

impl FoldedFormSize {
    pub fn elements(&self) -> usize {
        self.vertices + self.face_ring_entries + self.face_orders
    }
}

/// A frame too large to write, and the size that made it so.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FoldedFormTooLarge {
    pub size: FoldedFormSize,
    pub cap: usize,
}

impl std::fmt::Display for FoldedFormTooLarge {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "folded-form frame needs {} elements, over the {} cap",
            self.size.elements(),
            self.cap
        )
    }
}

impl std::error::Error for FoldedFormTooLarge {}

/// Build the `foldedForm` frame for one placed solution.
///
/// `ordering` is `Option` because a figure still places when the layer solver
/// cannot answer — that is the third arm of the verdict, not a refusal. With
/// `None` the frame carries geometry and an empty `faceOrders`, which is what
/// "the paper is here and nothing is claimed about the stacking" looks like in
/// the FOLD vocabulary.
pub fn folded_form_frame(
    placement: &Placement3d,
    index: &PlaneIndex,
    ordering: Option<&Fold3dOrdering>,
    title: Option<String>,
) -> Result<FoldDocument, FoldedFormTooLarge> {
    folded_form_frame_with_cap(placement, index, ordering, title, FOLDED_FORM_MAX_ELEMENTS)
}

/// [`folded_form_frame`] with the cap supplied.
///
/// The cap exists for input the corpus does not contain, so the shipped one is
/// measured never to fire — which would leave the refusal arm untested if there
/// were no way to lower it. This is that way, and it is the *only* caller-facing
/// difference from the shipped path.
pub fn folded_form_frame_with_cap(
    placement: &Placement3d,
    index: &PlaneIndex,
    ordering: Option<&Fold3dOrdering>,
    title: Option<String>,
    cap: usize,
) -> Result<FoldDocument, FoldedFormTooLarge> {
    let weld = weld_vertices(placement);
    let face_orders = face_orders(placement, index, ordering);
    let size = FoldedFormSize {
        vertices: weld.coords.len(),
        face_ring_entries: placement.rings.iter().map(Vec::len).sum(),
        face_orders: face_orders.len(),
    };
    if size.elements() > cap {
        return Err(FoldedFormTooLarge { size, cap });
    }

    let edges = ring_edges(placement);
    let mut frame = FoldDocument::new(
        weld.coords.iter().map(|point| point.to_vec()).collect(),
        edges
            .iter()
            .map(|edge| [weld.dense[edge.ends.0], weld.dense[edge.ends.1]])
            .collect(),
    );
    frame.file_spec = None;
    frame.frame_title = title;
    frame.frame_classes = vec!["foldedForm".to_string()];
    frame.frame_parent = Some(0);
    // Not `true`: see the module docs — every per-edge array on the root is
    // numbered against a different `FoldGraph`.
    frame.frame_inherit = Some(false);
    frame.edges_assignment = edges.iter().map(|edge| edge.assignment).collect();
    frame.edges_fold_angle = edges.iter().map(|edge| edge.fold_degrees).collect();
    frame.faces_vertices = placement
        .rings
        .iter()
        .map(|ring| ring.iter().map(|&vertex| weld.dense[vertex]).collect())
        .collect();
    frame.face_orders = face_orders;
    frame
        .extra
        .insert("frame_attributes".to_string(), json!(["3D"]));
    frame.extra.insert(
        FOLDED_FORM_MARKER.to_string(),
        json!({
            "schema": FOLDED_FORM_FRAME_SCHEMA_VERSION,
            "case": ordering.map_or(1, |ordering| ordering.current_case),
            "undetermined_pairs": ordering.map_or(0, |ordering| ordering.undetermined.len()),
        }),
    );
    Ok(frame)
}

/// Whether a frame was written by [`folded_form_frame`].
///
/// Keyed on the marker rather than on `frame_classes` plus `frame_parent`: a
/// `foldedForm` frame parented to the root is exactly the shape another tool's
/// folded form has, and dropping one of those on a round trip would lose a
/// user's data to make room for ours.
pub fn is_ours(frame: &FoldDocument) -> bool {
    frame.extra.contains_key(FOLDED_FORM_MARKER)
}

/// The welded vertex table: the dense remap, and one position per kept vertex.
struct Weld {
    /// Indexed by arrangement vertex; meaningless for vertices no ring uses.
    dense: Vec<usize>,
    coords: Vec<[f64; 3]>,
}

/// One position per vertex, chosen from the lowest-indexed face that carries it.
///
/// A vertex no traced face reaches is **dropped** rather than given an invented
/// position, and the rings are renumbered around the gap. Measured over the
/// admitted corpus that never happens — a placement that traced at all covers
/// every arrangement point, and the two things that would produce a stray point
/// (a dangling crease, an unresolved arrangement) are refused before this runs,
/// by `FlatFoldability` and `FacesUnresolved` respectively. It is written this
/// way because the alternative on that branch is a ring naming `usize::MAX`, and
/// `corpus_folded_form_frames_stay_under_the_cap` is what keeps the "never"
/// honest.
fn weld_vertices(placement: &Placement3d) -> Weld {
    let mut position: Vec<Option<Vec3>> = vec![None; placement.points.len()];
    for (face, ring) in placement.rings.iter().enumerate() {
        let placed = &placement.face_points[face];
        for (slot, &vertex) in ring.iter().enumerate() {
            let Some(point) = placed.get(slot) else {
                continue;
            };
            if vertex < position.len() && position[vertex].is_none() {
                position[vertex] = Some(*point);
            }
        }
    }
    let mut dense = vec![usize::MAX; placement.points.len()];
    let mut coords = Vec::new();
    for (vertex, point) in position.iter().enumerate() {
        if let Some(point) = point {
            dense[vertex] = coords.len();
            coords.push(*point);
        }
    }
    Weld { dense, coords }
}

/// The worst distance between two faces' images of one shared vertex.
///
/// The quantity the weld chooses between, exposed so a test can hold it against
/// the loop gap the admission gate bounded rather than trusting the argument.
pub fn weld_residual(placement: &Placement3d) -> f64 {
    let mut first: Vec<Option<Vec3>> = vec![None; placement.points.len()];
    let mut worst = 0.0f64;
    for (face, ring) in placement.rings.iter().enumerate() {
        let placed = &placement.face_points[face];
        for (slot, &vertex) in ring.iter().enumerate() {
            let Some(point) = placed.get(slot) else {
                continue;
            };
            if vertex >= first.len() {
                continue;
            }
            match first[vertex] {
                None => first[vertex] = Some(*point),
                Some(seen) => {
                    let delta = [point[0] - seen[0], point[1] - seen[1], point[2] - seen[2]];
                    worst = worst.max(dot(delta, delta).sqrt());
                }
            }
        }
    }
    worst
}

struct RingEdge {
    /// Arrangement vertex indices, ascending.
    ends: (usize, usize),
    assignment: Assignment,
    fold_degrees: Option<f64>,
}

/// Every arrangement edge once, keyed on the vertex pair.
///
/// The same key [`crate::folding3d::model`] strokes edges on, so a crease drawn
/// as two collinear pieces is two edges in both, and the two never disagree
/// about how many edges the figure has.
fn ring_edges(placement: &Placement3d) -> Vec<RingEdge> {
    let mut faces_on: BTreeMap<(usize, usize), BTreeSet<usize>> = BTreeMap::new();
    for (face, ring) in placement.rings.iter().enumerate() {
        for slot in 0..ring.len() {
            let a = ring[slot];
            let b = ring[(slot + 1) % ring.len()];
            faces_on
                .entry((a.min(b), a.max(b)))
                .or_default()
                .insert(face);
        }
    }

    let mut line_of: BTreeMap<(usize, usize), usize> = BTreeMap::new();
    for line in 0..placement.segment_count() {
        if let Some((a, b)) = placement.line_vertex_ends(line) {
            line_of.entry((a.min(b), a.max(b))).or_insert(line);
        }
    }

    faces_on
        .into_iter()
        .map(|(ends, faces)| {
            let degrees = line_of
                .get(&ends)
                .and_then(|&line| placement.fold_angle_radians(line))
                .map(f64::to_degrees);
            let (assignment, fold_degrees) = match (faces.len(), degrees) {
                // One face means paper on one side only.
                (1, _) => (Assignment::Boundary, None),
                (_, Some(degrees)) if degrees < 0.0 => (Assignment::Mountain, Some(degrees)),
                (_, Some(degrees)) if degrees > 0.0 => (Assignment::Valley, Some(degrees)),
                (_, Some(degrees)) => (Assignment::Flat, Some(degrees)),
                // Paper on both sides with no fold angle. The admission gate
                // refuses these (`Fold3dRefusal::NonCreaseJoin`), so this arm is
                // reachable only from the ungated measurement path.
                (_, None) => (Assignment::Unassigned, None),
            };
            RingEdge {
                ends,
                assignment,
                fold_degrees,
            }
        })
        .collect()
}

/// `faceOrders` for one solution.
///
/// FOLD signs `[f, g, s]` against **g's** normal, while the solver signs against
/// the plane's `up`. The two agree exactly when `g`'s placed normal runs along
/// that `up`, which is what `facing` already answers — so `s = facing(lower)`,
/// and the winding the frame emits is `Placement3d::rings`, whose right-hand
/// normal *is* `face_normals`. Deriving the normal from anything else is how a
/// reversed stack ships looking entirely plausible.
///
/// Undecided pairs are emitted with `s = 0`, which the spec defines as "no order
/// specified" — the honest reading, and the only one that keeps the pair
/// present in the file at all.
fn face_orders(
    placement: &Placement3d,
    index: &PlaneIndex,
    ordering: Option<&Fold3dOrdering>,
) -> Vec<[i64; 3]> {
    let Some(ordering) = ordering else {
        return Vec::new();
    };
    let facing = |face: usize| -> i64 {
        let Some(&plane) = index.plane_of.get(face) else {
            return 0;
        };
        let (Some(normal), Some(plane)) =
            (placement.face_normals.get(face), index.planes.get(plane))
        else {
            return 0;
        };
        if dot(*normal, plane.up) >= 0.0 { 1 } else { -1 }
    };

    let mut orders: Vec<[i64; 3]> = ordering
        .relations
        .iter()
        .map(|relation| {
            [
                relation.upper_face as i64,
                relation.lower_face as i64,
                facing(relation.lower_face),
            ]
        })
        .collect();
    orders.extend(
        ordering
            .undetermined
            .iter()
            .map(|&(first, second)| [first as i64, second as i64, 0]),
    );
    orders
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::folding::HierarchyRelation;
    use crate::folding3d::admit::admit;
    use crate::folding3d::planes::plane_index;
    use crate::geometry::{LineColor, LineSegment, Point};

    fn square_with_diagonal_at(degrees: f64) -> Vec<LineSegment> {
        let corners = [
            Point::new(0.0, 0.0),
            Point::new(200.0, 0.0),
            Point::new(200.0, 200.0),
            Point::new(0.0, 200.0),
        ];
        let mut segments: Vec<LineSegment> = (0..4)
            .map(|index| {
                LineSegment::with_color(corners[index], corners[(index + 1) % 4], LineColor::Black0)
            })
            .collect();
        segments.push(
            LineSegment::with_color(corners[0], corners[2], LineColor::Red1)
                .with_fold_magnitude(crate::geometry::FoldMagnitude::from_degrees(degrees)),
        );
        segments
    }

    fn ordering_with(
        relations: Vec<(usize, usize)>,
        undetermined: Vec<(usize, usize)>,
    ) -> Fold3dOrdering {
        Fold3dOrdering {
            relations: relations
                .into_iter()
                .map(|(upper_face, lower_face)| HierarchyRelation {
                    upper_face,
                    lower_face,
                })
                .collect(),
            undetermined,
            component_sizes: Vec::new(),
            crossings: Vec::new(),
            crossing_count: 0,
            variables: Vec::new(),
            component_of: Vec::new(),
            couplings: 0,
            current_case: 1,
            discovered_cases: 1,
            has_next: false,
        }
    }

    /// Two faces across a 90° crease: the frame restates its own geometry, says
    /// it does not inherit, and declares itself three-dimensional.
    #[test]
    fn the_frame_is_self_describing_and_says_it_is_3d() {
        let segments = square_with_diagonal_at(90.0);
        let admission = admit(&segments, 1).expect("admitted");
        let index = plane_index(
            &admission.placement,
            crate::folding3d::Fold3dTolerances::DEFAULT,
        );
        let frame = folded_form_frame(&admission.placement, &index, None, Some("f".to_string()))
            .expect("under the cap");

        assert_eq!(frame.frame_classes, vec!["foldedForm".to_string()]);
        assert_eq!(frame.frame_parent, Some(0));
        assert_eq!(frame.frame_inherit, Some(false));
        assert_eq!(frame.extra["frame_attributes"], json!(["3D"]));
        assert!(is_ours(&frame));
        assert_eq!(frame.faces_vertices.len(), admission.placement.rings.len());
        assert!(!frame.vertices_coords.is_empty());
        assert!(
            frame.vertices_coords.iter().all(|coords| coords.len() == 3),
            "a folded form is three-dimensional"
        );
        assert!(!frame.edges_vertices.is_empty());
        assert_eq!(frame.edges_assignment.len(), frame.edges_vertices.len());
        assert_eq!(frame.edges_fold_angle.len(), frame.edges_vertices.len());
    }

    /// The crease carries its measured angle and the sheet's rim is boundary.
    #[test]
    fn the_crease_keeps_its_angle_and_the_rim_is_boundary() {
        let segments = square_with_diagonal_at(90.0);
        let admission = admit(&segments, 1).expect("admitted");
        let index = plane_index(
            &admission.placement,
            crate::folding3d::Fold3dTolerances::DEFAULT,
        );
        let frame =
            folded_form_frame(&admission.placement, &index, None, None).expect("under the cap");

        let creases: Vec<(Assignment, Option<f64>)> = frame
            .edges_assignment
            .iter()
            .zip(&frame.edges_fold_angle)
            .filter(|(assignment, _)| **assignment != Assignment::Boundary)
            .map(|(assignment, angle)| (*assignment, *angle))
            .collect();
        assert_eq!(creases.len(), 1, "one crease, four border edges");
        let (assignment, angle) = creases[0];
        assert!(matches!(
            assignment,
            Assignment::Mountain | Assignment::Valley
        ));
        assert!(
            (angle.expect("crease carries an angle").abs() - 90.0).abs() < 1e-9,
            "angle was {angle:?}"
        );
        assert_eq!(
            frame
                .edges_assignment
                .iter()
                .filter(|assignment| **assignment == Assignment::Boundary)
                .count(),
            4
        );
    }

    /// A figure whose layer solver could not answer writes the paper and claims
    /// no stacking, rather than inventing one.
    ///
    /// Reached through `ordering: None`, which is exactly what a session with no
    /// enumerator passes. No committed fixture reaches that verdict; the corpus
    /// one that does is `airplane.fold`, and
    /// `corpus_folded_form_frames_stay_under_the_cap` prints its zero.
    #[test]
    fn no_layer_order_writes_the_paper_and_no_face_orders() {
        let segments = square_with_diagonal_at(90.0);
        let admission = admit(&segments, 1).expect("admitted");
        let index = plane_index(
            &admission.placement,
            crate::folding3d::Fold3dTolerances::DEFAULT,
        );
        let frame =
            folded_form_frame(&admission.placement, &index, None, None).expect("under the cap");
        assert!(frame.face_orders.is_empty());
        assert!(!frame.faces_vertices.is_empty());
        assert!(!frame.vertices_coords.is_empty());
    }

    /// The sign is read off the **lower** face's facing, and flips with it.
    #[test]
    fn the_face_order_sign_follows_the_lower_faces_normal() {
        let segments = square_with_diagonal_at(180.0);
        let admission = admit(&segments, 1).expect("admitted");
        let index = plane_index(
            &admission.placement,
            crate::folding3d::Fold3dTolerances::DEFAULT,
        );
        let placement = &admission.placement;
        assert_eq!(placement.rings.len(), 2);

        let facing = |face: usize| {
            let plane = index.plane_of[face];
            if dot(placement.face_normals[face], index.planes[plane].up) >= 0.0 {
                1
            } else {
                -1
            }
        };

        for (upper, lower) in [(0usize, 1usize), (1, 0)] {
            let ordering = ordering_with(vec![(upper, lower)], Vec::new());
            let frame =
                folded_form_frame(placement, &index, Some(&ordering), None).expect("under the cap");
            assert_eq!(
                frame.face_orders,
                vec![[upper as i64, lower as i64, facing(lower)]]
            );
        }
        assert_ne!(
            facing(0),
            facing(1),
            "a 180° crease puts the two faces back to back, which is what makes \
             this test able to see a sign error"
        );
    }

    /// An undecided pair is present with `s = 0` rather than dropped or guessed.
    #[test]
    fn an_undecided_pair_is_written_with_no_order() {
        let segments = square_with_diagonal_at(180.0);
        let admission = admit(&segments, 1).expect("admitted");
        let index = plane_index(
            &admission.placement,
            crate::folding3d::Fold3dTolerances::DEFAULT,
        );
        let ordering = ordering_with(Vec::new(), vec![(0, 1)]);
        let frame = folded_form_frame(&admission.placement, &index, Some(&ordering), None)
            .expect("under the cap");
        assert_eq!(frame.face_orders, vec![[0, 1, 0]]);
    }

    /// A cyclic relation set survives verbatim: `faceOrders` is a bag of pairs,
    /// not an order, so nothing sorts it into a lie.
    #[test]
    fn a_cyclic_relation_set_is_written_as_it_stands() {
        let segments = square_with_diagonal_at(180.0);
        let admission = admit(&segments, 1).expect("admitted");
        let index = plane_index(
            &admission.placement,
            crate::folding3d::Fold3dTolerances::DEFAULT,
        );
        let ordering = ordering_with(vec![(0, 1), (1, 0)], Vec::new());
        let frame = folded_form_frame(&admission.placement, &index, Some(&ordering), None)
            .expect("under the cap");
        let pairs: Vec<(i64, i64)> = frame
            .face_orders
            .iter()
            .map(|order| (order[0], order[1]))
            .collect();
        assert_eq!(pairs, vec![(0, 1), (1, 0)]);
    }

    /// The cap refuses rather than writing a frame nothing can open, and it
    /// says how far over it was.
    #[test]
    fn the_cap_refuses_and_names_the_size() {
        let segments = square_with_diagonal_at(90.0);
        let admission = admit(&segments, 1).expect("admitted");
        let index = plane_index(
            &admission.placement,
            crate::folding3d::Fold3dTolerances::DEFAULT,
        );
        let error = folded_form_frame_with_cap(&admission.placement, &index, None, None, 3)
            .expect_err("a two-face figure is over a three-element cap");
        assert_eq!(error.cap, 3);
        assert!(error.size.elements() > 3);
        assert_eq!(error.size.vertices, 4, "a square has four corners");
        assert!(error.to_string().contains("over the 3 cap"), "{error}");
    }

    /// Every emitted coordinate is some face's own placed image, bit for bit.
    ///
    /// The **choosing** half of the weld rule needs a placement whose faces
    /// disagree at all, which a one-crease fixture never does: with no dual
    /// cycle the two images of a shared vertex are bit-identical, so choosing
    /// and averaging are the same operation here. That half is pinned in
    /// `folding3d_interchange.rs` against a fixture with a real loop.
    #[test]
    fn every_welded_vertex_is_a_real_placed_point() {
        let segments = square_with_diagonal_at(90.0);
        let admission = admit(&segments, 1).expect("admitted");
        let placement = &admission.placement;
        let index = plane_index(placement, crate::folding3d::Fold3dTolerances::DEFAULT);
        let frame = folded_form_frame(placement, &index, None, None).expect("under the cap");

        for coords in &frame.vertices_coords {
            let matched = placement.face_points.iter().any(|points| {
                points.iter().any(|point| {
                    point[0] == coords[0] && point[1] == coords[1] && point[2] == coords[2]
                })
            });
            assert!(matched, "welded vertex {coords:?} is not a placed point");
        }
        assert!(
            frame
                .faces_vertices
                .iter()
                .flatten()
                .chain(frame.edges_vertices.iter().flatten())
                .all(|&vertex| vertex < frame.vertices_coords.len()),
            "nothing may name a vertex the weld did not write"
        );
    }
}

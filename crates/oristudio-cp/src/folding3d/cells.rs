//! Where the layer stacks are: the arrangement cells of each plane.
//!
//! **Ori Studio native.** See [`crate::folding3d`].
//!
//! The census says *which pairs* of faces share paper. The ordering solver needs
//! more: the sets of faces that share paper **at one point**, because that is
//! what has to be totally ordered. Pairwise overlap does not give it — three thin
//! bars can overlap pairwise with no common point, which is the pinwheel, and a
//! cyclic order over them is legal. So the sets have to come from geometry.
//!
//! # The unit is the covering set, not the cell
//!
//! For a point `p` in a plane, write `S(p)` for the set of faces covering it. A
//! [`crate::folding::SubFace`] is a face-id set and nothing else, and the search
//! reads it as "these faces must be totally ordered". So what this file has to
//! produce is exactly the **maximal** `S(p)` over the plane:
//!
//! - Sound, because a maximal set is realised at a real point, so those faces
//!   really do all coincide there.
//! - Complete, because if `S ⊆ T` then a total order on `T` restricts to one on
//!   `S`.
//!
//! Dropping the non-maximal sets is therefore a **reduction and not a correctness
//! requirement** — keeping them would be sound and merely wasteful, which is what
//! the flat path's own `reduce_subface_set` is for too.
//!
//! Two disconnected regions with the same covering set are the same constraint,
//! so connectivity of the regions is irrelevant. That is what lets this skip a
//! true arrangement overlay.
//!
//! # Per connected component, which is what dodges the Euler gate
//!
//! [`FoldGraph::calculate_faces`] gates on `euler == 1` (with a `0.005 *
//! faces.len()` slack), and `V - E + F = 1` holds for a **connected** planar
//! subdivision. A plane's projected faces are frequently disconnected — two
//! separate stacks in one plane, or a tongue nested strictly inside another face
//! with no boundary contact — and then `euler == k > 1` and the whole plane's
//! arrangement is refused. Measured on elementary 3D forms, that rejected 4 of 6
//! multi-face plane patches.
//!
//! So the arrangement is built **per connected component of the split segment
//! set**. Each component is connected, so `euler == 1` by Euler's formula and
//! every one of its cells is simply connected — which also means `face_request`,
//! whose trace returns the moment it revisits a point and so structurally cannot
//! follow an annular cell, never meets one.
//!
//! Completeness survives the split, and the argument is worth writing down
//! because it is what makes the cheap version correct. A face `g` outside
//! component `K` cannot cross a cell `c` of `K`: if it did, `g`'s boundary would
//! cross `K`'s edges and `g` would be in `K`. So `g` either misses `c`, contains
//! `c` whole, or nests strictly inside `c` — and in the nested case `g`'s own
//! component produces cells inside `c`. Induct on nesting depth: take `p`
//! realising a maximal `S(p)`, and let `c` be the cell of the innermost
//! component containing it. Then `S` is constant across `c` except for faces
//! nested inside `c`, none of which contain `p`, so `S(inside_point(c)) ⊇ S(p)`
//! — and maximality forces equality. Every maximal covering set is therefore the
//! covering set of some sampled cell.
//!
//! # Two postconditions, because the argument above is only an argument
//!
//! Both are checked on every model, and both are stated against the census
//! rather than against areas — they are the two directions that matter:
//!
//! - **Every ordering variable has a home.** Each [`crate::folding3d::CoplanarPair`]
//!   must appear inside some subface, or the solver would leave it undetermined
//!   with nothing saying so.
//! - **Every subface pair is an ordering variable.** Two faces in one subface
//!   must overlap by the census's own bar, or the solver would impose an order on
//!   faces that do not share paper — which is how a cell decomposition that has
//!   silently produced overlapping cells reaches a wrong answer.
//!
//! The second is why cells below the census's area bar are dropped: a surviving
//! cell has area above the bar, and two faces both covering it overlap by at
//! least that much, so the check is a theorem rather than a hope. That coupling
//! between the two bars is not exercised by anything — no corpus model produces a
//! cell at or below the bar — so it is defence in depth for a case the census's
//! own empty band says should not arise.

use std::collections::{BTreeMap, BTreeSet};

use crate::fold_graph::{FoldGraph, root};
use crate::folding::{SubFace, prepare_subface_segments};
use crate::folding3d::Fold3dTolerances;
use crate::folding3d::census::Fold3dCensus;
use crate::folding3d::overlap::signed_area;
use crate::folding3d::planes::{PlaneId, PlaneIndex};
use crate::geometry::{LineColor, LineSegment, Point, Polygon, PolygonIntersection};

/// One arrangement cell of one plane, and the faces stacked over it.
#[derive(Debug, Clone, PartialEq)]
pub struct Cell {
    pub plane: PlaneId,
    /// The cell ring in the plane's `(u, v)` frame.
    pub ring: Vec<Point>,
    /// Global face indices covering the cell, ascending.
    pub faces: Vec<usize>,
    /// Cell area in paper units squared.
    pub area: f64,
}

/// Every plane's cells, and the subfaces the ordering solver consumes.
#[derive(Debug, Clone, PartialEq)]
pub struct CellIndex {
    pub cells: Vec<Cell>,
    /// Maximal covering sets, in **global** face ids, each ascending.
    ///
    /// Sets of one face are dropped: a lone face carries no ordering variable,
    /// and every consumer here is about pairs.
    pub subfaces: Vec<SubFace>,
    /// Which plane each subface belongs to, aligned with `subfaces`.
    pub subface_plane: Vec<PlaneId>,
    /// How many overlap groups the planes were cut into.
    pub groups: usize,
    /// How many connected components those groups were traced in.
    ///
    /// More components than groups means at least one group was **nested** — a
    /// face lying strictly inside another with no boundary contact — which is the
    /// case the second split exists for and the one the Euler gate closes on.
    pub components: usize,
    /// Cells dropped for sitting at or below the census's area bar.
    pub cells_below_bar: usize,
}

/// A cell decomposition that does not describe the census it was built from.
///
/// Both arms mean the arrangement and the overlap count disagree about which
/// faces share paper, and neither is recoverable by relaxing a tolerance: one
/// says an ordering variable has nowhere to be decided, the other says a stack
/// was invented over faces that never touch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CellError {
    /// The user stopped the fold. Never a statement about the model.
    Cancelled,
    /// Two faces the census calls overlapping are in no common subface.
    OverlapWithoutCell {
        plane: PlaneId,
        faces: (usize, usize),
    },
    /// Two faces sharing a subface are not an overlapping pair.
    CellWithoutOverlap {
        plane: PlaneId,
        faces: (usize, usize),
    },
    /// A connected overlap group's arrangement did not trace.
    ///
    /// The completeness argument in this module's docs rests on
    /// [`FoldGraph::calculate_faces`] returning *every* bounded cell of a
    /// connected component, and its Euler gate is what says whether it did. A
    /// group whose gate closes has an unknown number of missing cells, and a
    /// missing cell is a missing subface — which the pairwise postcondition
    /// below cannot always see, because a lost *triple* still leaves all three
    /// of its pairs housed elsewhere while dropping the transitivity that
    /// forbids a cycle over them. So it refuses rather than under-constrains.
    ArrangementRefused {
        plane: PlaneId,
        /// Lowest-indexed member of the group, so the refusal names a face.
        first_face: usize,
        faces: usize,
    },
}

impl From<crate::cancel::Cancelled> for CellError {
    fn from(_: crate::cancel::Cancelled) -> Self {
        Self::Cancelled
    }
}

impl CellError {
    /// Whether this is the user stopping rather than a statement about the model.
    ///
    /// Exists so the enums that wrap this one can delegate instead of matching
    /// `CellError::Cancelled` by hand: one predicate per question, and the
    /// hand-written version is what let a nested cancel be classified as a 3D
    /// failure and reach the user as an error toast.
    pub fn is_cancelled(&self) -> bool {
        matches!(self, Self::Cancelled)
    }
}

impl std::fmt::Display for CellError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Cancelled => write!(f, "the fold was cancelled"),
            Self::OverlapWithoutCell { plane, faces } => write!(
                f,
                "faces {} and {} overlap in plane {plane} but share no arrangement cell",
                faces.0, faces.1
            ),
            Self::CellWithoutOverlap { plane, faces } => write!(
                f,
                "faces {} and {} share a cell of plane {plane} but do not overlap",
                faces.0, faces.1
            ),
            Self::ArrangementRefused {
                plane,
                first_face,
                faces,
            } => write!(
                f,
                "the arrangement of {faces} overlapping faces in plane {plane} \
                 (from face {first_face}) did not trace"
            ),
        }
    }
}

/// Decompose every plane that carries an ordering variable into cells.
///
/// Planes with no overlapping pair are skipped outright: their faces are each
/// trivially their own cell and no stack exists to order.
pub fn cell_index(
    index: &PlaneIndex,
    census: &Fold3dCensus,
    span: f64,
    tolerances: Fold3dTolerances,
) -> Result<CellIndex, CellError> {
    let area_bar = tolerances.overlap_area_relative * span * span;

    let mut overlapping: BTreeSet<(usize, usize)> = BTreeSet::new();
    let mut planes_with_pairs: BTreeSet<PlaneId> = BTreeSet::new();
    for pair in &census.pairs {
        overlapping.insert(pair.faces);
        planes_with_pairs.insert(pair.plane);
    }

    let mut out = CellIndex {
        cells: Vec::new(),
        subfaces: Vec::new(),
        subface_plane: Vec::new(),
        groups: 0,
        components: 0,
        cells_below_bar: 0,
    };

    for (plane_id, group) in overlap_groups(census) {
        out.groups += 1;
        let polygons: BTreeMap<usize, Polygon> = group
            .iter()
            .map(|&face| (face, Polygon::new(index.projected[face].clone())))
            .collect();

        let mut segments = Vec::new();
        for &face in &group {
            let ring = &index.projected[face];
            for slot in 0..ring.len() {
                let a = ring[slot];
                let b = ring[(slot + 1) % ring.len()];
                segments.push(LineSegment::with_color(a, b, LineColor::Black0));
            }
        }
        let segments = prepare_subface_segments(&segments)?;

        let mut covering: BTreeSet<Vec<usize>> = BTreeSet::new();
        for component in connected_components(&segments) {
            out.components += 1;
            let graph = FoldGraph::from_segments(&component, true);
            if !graph.include_faces {
                return Err(CellError::ArrangementRefused {
                    plane: plane_id,
                    first_face: group[0],
                    faces: group.len(),
                });
            }
            for ring in &graph.faces {
                let points: Vec<Point> = ring
                    .iter()
                    .filter_map(|&point| graph.points.get(point).copied())
                    .collect();
                if points.len() < 3 {
                    continue;
                }
                let area = signed_area(&points).abs();
                if area <= area_bar {
                    out.cells_below_bar += 1;
                    continue;
                }
                let cell = Polygon::new(points.clone());
                let sample = cell.inside_point_find();
                let mut faces = Vec::new();
                for (&face, polygon) in &polygons {
                    if polygon.inside(sample) == PolygonIntersection::Inside {
                        faces.push(face);
                    }
                }
                if faces.len() > 1 {
                    covering.insert(faces.clone());
                }
                out.cells.push(Cell {
                    plane: plane_id,
                    ring: points,
                    faces,
                    area,
                });
            }
        }

        for faces in maximal(covering) {
            for i in 0..faces.len() {
                for j in (i + 1)..faces.len() {
                    let pair = (faces[i], faces[j]);
                    if !overlapping.contains(&pair) {
                        return Err(CellError::CellWithoutOverlap {
                            plane: plane_id,
                            faces: pair,
                        });
                    }
                }
            }
            out.subfaces.push(SubFace { face_ids: faces });
            out.subface_plane.push(plane_id);
        }
    }

    let mut homed: BTreeSet<(usize, usize)> = BTreeSet::new();
    for subface in &out.subfaces {
        for i in 0..subface.face_ids.len() {
            for j in (i + 1)..subface.face_ids.len() {
                homed.insert((subface.face_ids[i], subface.face_ids[j]));
            }
        }
    }
    for pair in &census.pairs {
        if !homed.contains(&pair.faces) {
            return Err(CellError::OverlapWithoutCell {
                plane: pair.plane,
                faces: pair.faces,
            });
        }
    }

    Ok(out)
}

/// Faces grouped by connectivity under the census's own overlap relation.
///
/// A maximal covering set is a set of mutually overlapping faces, so it lies
/// **entirely inside one group** and no group can contribute to another's. That
/// makes the split free of information loss, and it buys two things:
///
/// - Each arrangement is smaller, so the quadratic parts of the tracing cost
///   less.
/// - Faces whose footprints merely *touch* — the two triangles of a zigzag strip
///   meeting at one vertex — land in different groups. A single point where two
///   otherwise-disjoint regions meet is a pinch, and `r_point`'s smallest-angle
///   rule walks straight across one into the neighbouring region, so the trace
///   returns the outer boundary instead of the two cells and the Euler gate
///   closes on the whole plane. Measured on `spikes_large`, whose plane 0 is
///   eight triangles in exactly that arrangement.
///
/// Faces that overlap nothing are dropped: they carry no ordering variable.
/// Returned sorted by `(plane, lowest member)`, so the subface order downstream —
/// which the search's own priority pass reads — is a function of the model.
fn overlap_groups(census: &Fold3dCensus) -> Vec<(PlaneId, Vec<usize>)> {
    let mut parent: BTreeMap<usize, usize> = BTreeMap::new();
    let mut plane_of: BTreeMap<usize, PlaneId> = BTreeMap::new();
    for pair in &census.pairs {
        for face in [pair.faces.0, pair.faces.1] {
            parent.entry(face).or_insert(face);
            plane_of.insert(face, pair.plane);
        }
    }
    let mut nodes: Vec<usize> = parent.keys().copied().collect();
    nodes.sort_unstable();
    let slot: BTreeMap<usize, usize> = nodes
        .iter()
        .enumerate()
        .map(|(slot, &face)| (face, slot))
        .collect();
    let mut flat: Vec<usize> = (0..nodes.len()).collect();
    for pair in &census.pairs {
        let (a, b) = (
            root(&mut flat, slot[&pair.faces.0]),
            root(&mut flat, slot[&pair.faces.1]),
        );
        if a != b {
            flat[a.max(b)] = a.min(b);
        }
    }
    let mut groups: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for (index, &face) in nodes.iter().enumerate() {
        groups.entry(root(&mut flat, index)).or_default().push(face);
    }
    let mut out: Vec<(PlaneId, Vec<usize>)> = groups
        .into_values()
        .map(|faces| (plane_of[&faces[0]], faces))
        .collect();
    out.sort_by_key(|(plane, faces)| (*plane, faces[0]));
    out
}

/// Drop every set strictly contained in another, leaving the maximal ones.
///
/// Deterministic: the input is a `BTreeSet` of ascending id vectors and the
/// output keeps that order, so nothing downstream — the search's own subface
/// priority included — depends on a hash iteration.
///
/// Strict containment is the whole test, and no tie-break between equals is
/// needed: the input is a set, so no two members are equal, and two *distinct*
/// sets of the same size cannot contain one another. The naive "is contained in
/// some other set" filter is only wrong once equal sets are representable, which
/// the parameter type forbids.
fn maximal(sets: BTreeSet<Vec<usize>>) -> Vec<Vec<usize>> {
    let all: Vec<Vec<usize>> = sets.into_iter().collect();
    all.iter()
        .filter(|candidate| {
            !all.iter().any(|superset| {
                superset.len() > candidate.len()
                    && candidate.iter().all(|face| superset.contains(face))
            })
        })
        .cloned()
        .collect()
}

/// Split a segment set into groups that share no endpoint.
///
/// The endpoints are taken through [`FoldGraph::from_segments`]'s own vertex
/// merge rather than compared directly, so "shares an endpoint" means exactly
/// what the arrangement will think it means.
fn connected_components(segments: &[LineSegment]) -> Vec<Vec<LineSegment>> {
    let graph = FoldGraph::from_segments(segments, false);
    graph
        .line_components()
        .into_iter()
        .map(|component| {
            component
                .into_iter()
                .filter_map(|line| graph.segments.get(line).cloned())
                .collect()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maximal_keeps_only_the_containing_sets() {
        let mut sets = BTreeSet::new();
        sets.insert(vec![0, 1]);
        sets.insert(vec![0, 1, 2]);
        sets.insert(vec![1, 3]);
        sets.insert(vec![0, 2]);
        assert_eq!(maximal(sets), vec![vec![0, 1, 2], vec![1, 3]]);
    }

    /// Two different sets of the same size both survive, however much they
    /// overlap. This is the case a `>=` comparison collapses: it would let each
    /// delete the other and return nothing at all.
    #[test]
    fn maximal_keeps_both_of_two_equal_sized_sets() {
        let mut sets = BTreeSet::new();
        sets.insert(vec![4, 5]);
        sets.insert(vec![4, 6]);
        assert_eq!(maximal(sets), vec![vec![4, 5], vec![4, 6]]);
    }

    fn square(x: f64, y: f64, size: f64) -> Vec<LineSegment> {
        let corners = [
            Point::new(x, y),
            Point::new(x + size, y),
            Point::new(x + size, y + size),
            Point::new(x, y + size),
        ];
        (0..4)
            .map(|k| LineSegment::with_color(corners[k], corners[(k + 1) % 4], LineColor::Black0))
            .collect()
    }

    /// A nested pair traced whole closes the Euler gate; traced per component it
    /// does not.
    ///
    /// This is the failure the second split exists for, demonstrated rather than
    /// described: `V - E + F = 1` counts a *connected* subdivision, and two
    /// squares with no boundary contact are two. Measured, no corpus model needs
    /// it — nesting without boundary contact does not occur in 55 of 55 — so this
    /// is the only place the split is exercised, and saying so is better than
    /// letting a reader assume the corpus covers it.
    #[test]
    fn a_nested_pair_only_traces_once_it_is_split() {
        let mut both = square(0.0, 0.0, 100.0);
        both.extend(square(20.0, 20.0, 10.0));
        let both = prepare_subface_segments(&both).expect("not cancellable in a test");
        assert!(
            !FoldGraph::from_segments(&both, true).include_faces,
            "the nested pair was expected to close the Euler gate"
        );
        let parts = connected_components(&both);
        assert_eq!(parts.len(), 2);
        for part in parts {
            let graph = FoldGraph::from_segments(&part, true);
            assert!(graph.include_faces);
            assert_eq!(graph.faces.len(), 1);
        }
    }

    #[test]
    fn two_touching_squares_are_one_component_and_two_nested_are_two() {
        let mut crossing = square(0.0, 0.0, 10.0);
        crossing.extend(square(5.0, 5.0, 10.0));
        let crossing = prepare_subface_segments(&crossing).expect("not cancellable in a test");
        assert_eq!(connected_components(&crossing).len(), 1);

        let mut nested = square(0.0, 0.0, 100.0);
        nested.extend(square(20.0, 20.0, 10.0));
        let nested = prepare_subface_segments(&nested).expect("not cancellable in a test");
        assert_eq!(connected_components(&nested).len(), 2);
    }
}

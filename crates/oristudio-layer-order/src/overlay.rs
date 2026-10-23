//! The overlay of the face images into cells: convex regions, each lying in
//! one fixed set of faces. Transitivity is derived from it (three faces that
//! share a cell are stacked there, so their order cannot be cyclic), so the
//! checker and a completion search that both read these cells agree on it by
//! construction; it is also where Fold's display cells (`subfaces`) come from.
//!
//! # Construction
//!
//! Every cell has an *owner*, the face with the least id covering it, and a
//! face's cells are built from its own image and the images of the faces it
//! overlaps by more than [`TOL`] (its [pairs](Overlay::pairs)), nothing else:
//! the overlapping faces with smaller ids are carved out of it, in id order,
//! and what is left is cut by the overlapping faces with larger ids, in id
//! order, each joining the part inside it. Every cut is [`convex::carve`] at
//! `TOL`: nothing `TOL` wide or less is ever cut off, so every cell is wider
//! than `TOL`, and a face joins a cell only when it covers more than a sliver
//! of it. There is no global point merging, the step whose ε heuristic built
//! a wrong arrangement for 7% of the spike's states in Flat-Folder (research
//! §7).
//!
//! Cells are a cover of the faces up to the tolerance: two may overlap, or
//! leave a gap, by at most `TOL`. Cutting along whole edge lines splits more
//! finely than the arrangement would, so cells with equal face sets can sit
//! side by side, always within one owner.
//!
//! Because a face's cells depend on nothing beyond the faces it overlaps, and
//! on neither the view's face order nor the extent of the state,
//! [`Overlay::rebuild`] keeps every cell whose owner neither was touched nor
//! overlaps a touched face, before or after, and builds only the rest; the
//! result is the overlay [`Overlay::build`] makes of the same view.
//!
//! An earlier construction cut one box around the whole state by every face
//! in view order. It made nearly the same cells, but each cut ran across the
//! box along the face's whole edge lines, so a change anywhere moved cells
//! everywhere. Carving the uncovered part of each face out of the cells it
//! met cost 1.4 s against the box's 38 ms on a 315-face state. Carving whole
//! faces out of a face, as here, is cheaper than the box: a face inside one
//! with a smaller id (the common case in a stack) is gone after one
//! containment test, and a cell is carved only along the edges it crosses.
//! On the Fold perf example's states at 129–256 faces it takes 4 ms where the
//! box took 15.

use std::collections::{BTreeMap, BTreeSet};

use oristudio_geometry::convex::{self, Carve, MIN_EDGE};
use oristudio_geometry::tol::TOL;

use crate::order::FacePair;
use crate::shape::{Shape, carve_along, penetration_with};
use crate::table::IdSet;
use crate::view::{FaceId, FoldedView};

type Point = [f64; 2];

/// One cell of the overlay.
#[derive(Debug, Clone, PartialEq)]
pub struct Cell {
    /// Counter-clockwise and convex, wider than [`TOL`].
    pub polygon: Vec<[f64; 2]>,
    /// The faces covering it, ascending. The first is its owner.
    pub faces: Vec<FaceId>,
}

/// The cells of a view, with each face's cells.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Overlay {
    /// By owner, ascending; each owner's in the order its cuts made them.
    cells: Vec<Cell>,
    faces_cells: BTreeMap<FaceId, Vec<usize>>,
    /// Per cell, its faces' positions in the view, in `faces` order.
    positions: Vec<Vec<usize>>,
    /// The first cell of each face set that no other cell's set contains,
    /// ascending.
    maximal: Vec<usize>,
    /// The face pairs whose images overlap by more than [`TOL`], ascending.
    pairs: Vec<FacePair>,
}

impl Overlay {
    /// Overlay every face of the view. A face covers at least one cell
    /// unless every cell it overlaps meets it in a sliver;
    /// [`crate::ConstraintProblem`] then reports its overlaps as ambiguous.
    pub fn build(view: &FoldedView) -> Overlay {
        Overlay::build_from(view, &Shape::of_view(view))
    }

    /// [`Overlay::build`] over the view's shapes.
    pub(crate) fn build_from(view: &FoldedView, shapes: &[Shape<'_>]) -> Overlay {
        let n = shapes.len();
        let mut pairs = Vec::new();
        for i in 0..n {
            for j in i + 1..n {
                if let Some(pair) = overlapping(shapes, i, j) {
                    pairs.push(pair);
                }
            }
        }
        pairs.sort_unstable();
        Overlay::assemble(view, shapes, pairs, |_| None)
    }

    /// The overlay of `view`, a later state of this overlay's view, keeping
    /// the cells of every face that neither is in `touched` nor overlaps a
    /// face in it, in either view. Faces new to the view or gone from it
    /// count as touched.
    ///
    /// A face outside `touched` must have the same image in both views; the
    /// result then equals [`Overlay::build`] of `view`. (Kept cells are this
    /// overlay's: where an untouched image moved in its last bits, as the Fold
    /// engine's re-derived isometries can, so do they.)
    pub fn rebuild(&self, view: &FoldedView, touched: &BTreeSet<FaceId>) -> Overlay {
        self.rebuild_from(view, &Shape::of_view(view), &self.touched_in(view, touched))
    }

    /// `touched`, with the faces new to `view` and those gone from it.
    pub(crate) fn touched_in(
        &self,
        view: &FoldedView,
        touched: &BTreeSet<FaceId>,
    ) -> BTreeSet<FaceId> {
        let mut touched = touched.clone();
        touched.extend(
            view.faces()
                .iter()
                .map(|f| f.id)
                .filter(|f| !self.faces_cells.contains_key(f)),
        );
        touched.extend(
            self.faces_cells
                .keys()
                .filter(|&&f| view.index_of(f).is_none()),
        );
        touched
    }

    /// [`Overlay::rebuild`] over the view's shapes, with `touched` already
    /// holding the new and gone faces.
    pub(crate) fn rebuild_from(
        &self,
        view: &FoldedView,
        shapes: &[Shape<'_>],
        touched: &BTreeSet<FaceId>,
    ) -> Overlay {
        let n = shapes.len();
        let touched = IdSet::new(touched);
        let is_touched: Vec<bool> = shapes.iter().map(|s| touched.contains(s.id)).collect();
        // Untouched pairs keep their verdict; each touched face is tested
        // against every face, each pair once.
        let mut pairs: Vec<FacePair> = self
            .pairs
            .iter()
            .filter(|p| !touched.any(&p.faces()))
            .copied()
            .collect();
        for t in (0..n).filter(|&t| is_touched[t]) {
            for j in (0..n).filter(|&j| j != t && (!is_touched[j] || j > t)) {
                if let Some(pair) = overlapping(shapes, t.min(j), t.max(j)) {
                    pairs.push(pair);
                }
            }
        }
        pairs.sort_unstable();
        // A face keeps its cells unless it, or a face it overlaps now or
        // overlapped before, was touched.
        let mut dirty = is_touched;
        for pair in self.pairs.iter().chain(&pairs) {
            let [a, b] = pair.faces();
            for (x, y) in [(a, b), (b, a)] {
                if touched.contains(x)
                    && let Some(p) = view.index_of(y)
                {
                    dirty[p] = true;
                }
            }
        }
        Overlay::assemble(view, shapes, pairs, |p| {
            (!dirty[p]).then(|| self.owned(shapes[p].id))
        })
    }

    /// Index the cells of every owner, in id order. `kept(position)` gives a
    /// face's cells when they are kept; otherwise they are built.
    fn assemble<'k>(
        view: &FoldedView,
        shapes: &[Shape<'_>],
        pairs: Vec<FacePair>,
        kept: impl Fn(usize) -> Option<&'k [Cell]>,
    ) -> Overlay {
        let n = shapes.len();
        // Each face's overlapping faces in id order: the pairs are sorted by
        // their smaller face, so a face's partners with smaller ids all come
        // before those with larger ones.
        let mut partners: Vec<Vec<usize>> = vec![Vec::new(); n];
        for pair in &pairs {
            if let (Some(a), Some(b)) = (view.index_of(pair.lo()), view.index_of(pair.hi())) {
                partners[a].push(b);
                partners[b].push(a);
            }
        }
        let mut by_id: Vec<usize> = (0..n).collect();
        by_id.sort_unstable_by_key(|&p| shapes[p].id);

        let mut cells: Vec<Cell> = Vec::new();
        let mut positions: Vec<Vec<usize>> = Vec::new();
        let mut faces_cells: Vec<Vec<usize>> = vec![Vec::new(); n];
        let mut distinct = Vec::new();
        for &owner in &by_id {
            let first = cells.len();
            match kept(owner) {
                Some(old) => cells.extend_from_slice(old),
                None => cells.extend(owned_cells(shapes, owner, &partners[owner])),
            }
            let mut seen: BTreeSet<&[FaceId]> = BTreeSet::new();
            for (c, cell) in cells.iter().enumerate().skip(first) {
                if seen.insert(&cell.faces) {
                    distinct.push(c);
                }
                let at: Vec<usize> = cell
                    .faces
                    .iter()
                    .filter_map(|&f| view.index_of(f))
                    .collect();
                for &p in &at {
                    faces_cells[p].push(c);
                }
                positions.push(at);
            }
        }
        Overlay {
            faces_cells: view.faces().iter().map(|f| f.id).zip(faces_cells).collect(),
            maximal: maximal(&positions, &distinct, n),
            positions,
            cells,
            pairs,
        }
    }

    pub fn cells(&self) -> &[Cell] {
        &self.cells
    }

    /// The face pairs whose images overlap by more than [`TOL`]
    /// (separating-axis penetration), ascending: the layer order's variables.
    pub fn pairs(&self) -> &[FacePair] {
        &self.pairs
    }

    /// The cells a face covers, ascending; empty for a face not in the view.
    pub fn faces_cells(&self, face: FaceId) -> &[usize] {
        self.faces_cells.get(&face).map_or(&[], Vec::as_slice)
    }

    /// The faces other than `f` and `g` that share a cell with both: the
    /// third faces of their transitivity constraints.
    pub fn third_faces(&self, f: FaceId, g: FaceId) -> BTreeSet<FaceId> {
        let g_cells: BTreeSet<usize> = self.faces_cells(g).iter().copied().collect();
        self.faces_cells(f)
            .iter()
            .filter(|c| g_cells.contains(c))
            .flat_map(|&c| self.cells[c].faces.iter().copied())
            .filter(|&h| h != f && h != g)
            .collect()
    }

    /// Whether `f` and `g` share a cell.
    pub fn share_cell(&self, f: FaceId, g: FaceId) -> bool {
        let g_cells = self.faces_cells(g);
        self.faces_cells(f)
            .iter()
            .any(|c| g_cells.binary_search(c).is_ok())
    }

    /// Cell `c`'s faces as positions in the view it was built from.
    pub(crate) fn positions(&self, c: usize) -> &[usize] {
        &self.positions[c]
    }

    /// One cell per face set that no other cell's set contains: what a test
    /// over the pairs or triples of each cell's faces needs to visit, since
    /// a set's pairs and triples are those of any set containing it. On the
    /// engine's states at 129–256 faces that is a tenth of the work of
    /// visiting every distinct set.
    pub(crate) fn maximal_cells(&self) -> &[usize] {
        &self.maximal
    }

    /// The cells `owner` owns: a run, since cells are sorted by owner.
    fn owned(&self, owner: FaceId) -> &[Cell] {
        let start = self.cells.partition_point(|c| c.faces[0] < owner);
        let end = self.cells.partition_point(|c| c.faces[0] <= owner);
        &self.cells[start..end]
    }
}

/// Of the `distinct` cells (one per face set), those whose set no other
/// contains, ascending: largest first, each kept unless a kept one contains
/// it, by bitsets over view positions.
fn maximal(positions: &[Vec<usize>], distinct: &[usize], n: usize) -> Vec<usize> {
    let words = n.div_ceil(64);
    let bits = |c: usize| {
        let mut set = vec![0u64; words];
        for &p in &positions[c] {
            set[p / 64] |= 1 << (p % 64);
        }
        set
    };
    let mut by_size = distinct.to_vec();
    by_size.sort_by_key(|&c| std::cmp::Reverse(positions[c].len()));
    let mut kept: Vec<(usize, Vec<u64>)> = Vec::new();
    for c in by_size {
        let set = bits(c);
        let inside = |other: &Vec<u64>| set.iter().zip(other).all(|(s, o)| s & !o == 0);
        if !kept.iter().any(|(_, other)| inside(other)) {
            kept.push((c, set));
        }
    }
    let mut out: Vec<usize> = kept.into_iter().map(|(c, _)| c).collect();
    out.sort_unstable();
    out
}

/// The pair of view faces `i < j` if their images overlap by more than
/// [`TOL`].
fn overlapping(shapes: &[Shape<'_>], i: usize, j: usize) -> Option<FacePair> {
    let (a, b) = (&shapes[i], &shapes[j]);
    if !convex::boxes_overlap(&a.bbox, &b.bbox, 0.0) || a.penetration(b) <= TOL {
        return None;
    }
    FacePair::new(a.id, b.id)
}

/// A cell under construction.
struct Draft {
    polygon: Vec<Point>,
    bbox: [f64; 4],
    faces: Vec<FaceId>,
}

impl Draft {
    fn new(polygon: Vec<Point>, faces: Vec<FaceId>) -> Draft {
        Draft {
            bbox: convex::bounding_box(&polygon),
            polygon,
            faces,
        }
    }
}

/// How a face meets a cell.
enum Meet {
    /// Apart, touching, or meeting in a sliver at most.
    Apart,
    /// The cell lies inside the face: every vertex within [`MIN_EDGE`] of
    /// it, which is exactly when [`convex::carve`] leaves the cell whole.
    Inside,
    /// The face cuts the cell.
    Cut(Carve),
}

fn meet(cell: &Draft, face: &Shape<'_>) -> Meet {
    if !convex::boxes_overlap(&cell.bbox, &face.bbox, 0.0) {
        return Meet::Apart;
    }
    // The face's half of the separating-axis test, and which of its edges
    // the cell crosses (a bit each; past the 64th every edge is carved
    // along), from the face's cached planes.
    let (mut crossed, mut any) = (0u64, false);
    for (k, plane) in face.planes.iter().enumerate() {
        let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
        for &p in &cell.polygon {
            let d = plane.signed_distance(p);
            lo = lo.min(d);
            hi = hi.max(d);
        }
        if hi <= TOL {
            return Meet::Apart;
        }
        if lo < -MIN_EDGE {
            any = true;
            crossed |= 1u64.checked_shl(k as u32).unwrap_or(0);
        }
    }
    if !any {
        return Meet::Inside;
    }
    if penetration_with(&cell.polygon, face) <= TOL {
        return Meet::Apart;
    }
    let cutting = face
        .planes
        .iter()
        .enumerate()
        .filter(|&(k, _)| k >= 64 || crossed >> k & 1 == 1)
        .map(|(_, p)| p);
    match carve_along(&cell.polygon, cutting, TOL) {
        Some(carve) => Meet::Cut(carve),
        None => Meet::Apart,
    }
}

/// The cells `owner` owns, given the positions of the faces it overlaps in
/// id order.
fn owned_cells(shapes: &[Shape<'_>], owner: usize, partners: &[usize]) -> Vec<Cell> {
    let id = shapes[owner].id;
    let split = partners.partition_point(|&p| shapes[p].id < id);
    let (earlier, later) = partners.split_at(split);
    let mut cells = vec![Draft::new(shapes[owner].polygon.to_vec(), vec![id])];
    // Carve out what a face with a smaller id covers.
    let mut left = Vec::new();
    for &g in earlier {
        for cell in cells.drain(..) {
            match meet(&cell, &shapes[g]) {
                Meet::Apart => left.push(cell),
                Meet::Inside => {}
                Meet::Cut(carve) => {
                    left.extend(carve.outside.into_iter().map(|p| Draft::new(p, vec![id])))
                }
            }
        }
        std::mem::swap(&mut cells, &mut left);
        if cells.is_empty() {
            return Vec::new();
        }
    }
    // Cut by each face with a larger id; pieces outside it lie outside it,
    // so its loop need not visit them.
    for &h in later {
        let face = &shapes[h];
        for c in 0..cells.len() {
            match meet(&cells[c], face) {
                Meet::Apart => {}
                Meet::Inside => cells[c].faces.push(face.id),
                Meet::Cut(carve) => {
                    let faces = cells[c].faces.clone();
                    cells.extend(
                        carve
                            .outside
                            .into_iter()
                            .map(|p| Draft::new(p, faces.clone())),
                    );
                    cells[c].bbox = convex::bounding_box(&carve.inside);
                    cells[c].polygon = carve.inside;
                    cells[c].faces.push(face.id);
                }
            }
        }
    }
    cells
        .into_iter()
        .map(|d| Cell {
            polygon: d.polygon,
            faces: d.faces,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::view::Face;

    fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Vec<[f64; 2]> {
        vec![[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    }

    fn view_with_ids(polygons: Vec<(u32, Vec<[f64; 2]>)>) -> FoldedView {
        let faces = polygons
            .into_iter()
            .map(|(id, polygon)| Face {
                id: FaceId(id),
                polygon,
                front_up: true,
            })
            .collect();
        FoldedView::new(faces, Vec::new()).unwrap_or_else(|e| panic!("{e}"))
    }

    fn view(polygons: Vec<Vec<[f64; 2]>>) -> FoldedView {
        view_with_ids(
            polygons
                .into_iter()
                .enumerate()
                .map(|(i, p)| (i as u32, p))
                .collect(),
        )
    }

    fn ids(ids: &[u32]) -> Vec<FaceId> {
        ids.iter().map(|&i| FaceId(i)).collect()
    }

    /// Total cell area per face set.
    fn areas(overlay: &Overlay) -> BTreeMap<Vec<FaceId>, f64> {
        let mut out = BTreeMap::new();
        for cell in overlay.cells() {
            *out.entry(cell.faces.clone()).or_insert(0.0) += convex::signed_area(&cell.polygon);
        }
        out
    }

    fn assert_area(areas: &BTreeMap<Vec<FaceId>, f64>, faces: &[u32], area: f64) {
        let got = areas.get(&ids(faces)).copied().unwrap_or(0.0);
        assert!((got - area).abs() < 1e-12, "{faces:?}: {got} != {area}");
    }

    #[test]
    fn coincident_faces_share_one_cell() {
        let overlay = Overlay::build(&view(vec![rect(0.0, 0.0, 1.0, 1.0); 3]));
        assert_eq!(overlay.cells().len(), 1);
        assert_eq!(overlay.cells()[0].faces, ids(&[0, 1, 2]));
        assert_eq!(
            overlay.third_faces(FaceId(0), FaceId(2)),
            ids(&[1]).into_iter().collect()
        );
    }

    #[test]
    fn overlapping_squares_split_into_three_regions() {
        let overlay = Overlay::build(&view(vec![
            rect(0.0, 0.0, 2.0, 2.0),
            rect(1.0, 1.0, 3.0, 3.0),
        ]));
        let a = areas(&overlay);
        assert_area(&a, &[0], 3.0);
        assert_area(&a, &[1], 3.0);
        assert_area(&a, &[0, 1], 1.0);
        assert_eq!(a.len(), 3);
        assert!(overlay.share_cell(FaceId(0), FaceId(1)));
        assert_eq!(
            overlay.pairs(),
            &[FacePair::new(FaceId(0), FaceId(1)).unwrap_or_else(|| unreachable!())]
        );
        for cell in overlay.cells() {
            assert!(convex::is_convex(&cell.polygon, TOL));
            assert!(convex::width(&cell.polygon) > TOL);
        }
    }

    #[test]
    fn faces_that_only_touch_share_no_cell() {
        // Side by side, corner to corner, and overlapping by a sliver.
        let overlay = Overlay::build(&view(vec![
            rect(0.0, 0.0, 1.0, 1.0),
            rect(1.0, 0.0, 2.0, 1.0),
            rect(2.0, 1.0, 3.0, 2.0),
            rect(0.0, 1.0 - 1e-7, 1.0, 2.0),
        ]));
        for (f, g) in [(0, 1), (1, 2), (0, 3)] {
            assert!(!overlay.share_cell(FaceId(f), FaceId(g)), "{f} {g}");
        }
        assert_eq!(overlay.cells().len(), 4);
        assert!(overlay.pairs().is_empty());
    }

    #[test]
    fn a_stack_with_a_shifted_layer() {
        // Two coincident layers and a third covering half of them and more.
        let overlay = Overlay::build(&view(vec![
            rect(0.0, 0.0, 1.0, 1.0),
            rect(0.0, 0.0, 1.0, 1.0),
            rect(0.5, 0.0, 1.5, 1.0),
        ]));
        let a = areas(&overlay);
        assert_area(&a, &[0, 1], 0.5);
        assert_area(&a, &[0, 1, 2], 0.5);
        assert_area(&a, &[2], 0.5);
        assert_eq!(
            overlay.third_faces(FaceId(0), FaceId(2)),
            ids(&[1]).into_iter().collect()
        );
        assert!(overlay.faces_cells(FaceId(9)).is_empty());
    }

    fn odd_polygons() -> Vec<Vec<[f64; 2]>> {
        let tri = |cx: f64, cy: f64, r: f64, t: f64| -> Vec<[f64; 2]> {
            (0..3)
                .map(|k| {
                    let a = t + k as f64 * std::f64::consts::TAU / 3.0;
                    [cx + r * a.cos(), cy + r * a.sin()]
                })
                .collect()
        };
        vec![
            tri(0.0, 0.0, 1.0, 0.1),
            tri(0.3, 0.2, 0.8, 0.7),
            rect(-0.5, -0.4, 0.6, 0.3),
            tri(-0.2, 0.1, 0.6, 2.0),
            tri(0.0, 0.0, 1.0, 0.1),
            rect(0.9, 0.9, 1.4, 1.2),
        ]
    }

    #[test]
    fn cells_cover_each_face_once() {
        // Triangles and squares at odd angles: the cells of each face sum to
        // its area, no two cells overlap, and a cell's owner is its least
        // face.
        let v = view(odd_polygons());
        let overlay = Overlay::build(&v);
        for face in v.faces() {
            let total: f64 = overlay
                .faces_cells(face.id)
                .iter()
                .map(|&c| convex::signed_area(&overlay.cells()[c].polygon))
                .sum();
            let area = convex::signed_area(&face.polygon);
            assert!(
                (total - area).abs() < 1e-9,
                "face {}: {total} != {area}",
                face.id
            );
        }
        let cells = overlay.cells();
        for i in 0..cells.len() {
            assert!(cells[i].faces.is_sorted());
            assert!(i == 0 || cells[i - 1].faces[0] <= cells[i].faces[0]);
            for j in i + 1..cells.len() {
                assert!(
                    !convex::overlaps(&cells[i].polygon, &cells[j].polygon),
                    "{i} {j}"
                );
            }
        }
    }

    #[test]
    fn the_cells_do_not_depend_on_the_views_face_order() {
        let polygons = odd_polygons();
        let forward = view(polygons.clone());
        let backward = view_with_ids(
            polygons
                .into_iter()
                .enumerate()
                .rev()
                .map(|(i, p)| (i as u32, p))
                .collect(),
        );
        let (a, b) = (Overlay::build(&forward), Overlay::build(&backward));
        assert_eq!(a.cells(), b.cells());
        assert_eq!(a.pairs(), b.pairs());
        for face in forward.faces() {
            assert_eq!(a.faces_cells(face.id), b.faces_cells(face.id));
        }
    }

    #[test]
    fn a_rebuild_keeps_the_far_cells_and_equals_a_build() {
        // A row of stacks; the face over the last stack moves onto the first.
        let mut polygons: Vec<(u32, Vec<[f64; 2]>)> = (0..12)
            .map(|k| {
                let x = (k / 3) as f64 * 2.0;
                (k, rect(x, 0.0, x + 1.0 + 0.1 * (k % 3) as f64, 1.0))
            })
            .collect();
        let before = view_with_ids(polygons.clone());
        let old = Overlay::build(&before);
        polygons[11].1 = rect(0.2, 0.2, 0.8, 0.8);
        // Face 4 splits into 12 and 13.
        polygons.remove(4);
        polygons.push((12, rect(2.0, 0.0, 2.5, 1.0)));
        polygons.push((13, rect(2.5, 0.0, 3.1, 1.0)));
        let after = view_with_ids(polygons);
        let touched = BTreeSet::from([FaceId(11)]);
        let rebuilt = old.rebuild(&after, &touched);
        assert_eq!(rebuilt, Overlay::build(&after));
        // The third stack's cells were kept as they were.
        for owner in [6, 7, 8] {
            assert_eq!(rebuilt.owned(FaceId(owner)), old.owned(FaceId(owner)));
        }
        assert!(rebuilt.share_cell(FaceId(0), FaceId(11)));
        assert!(!rebuilt.share_cell(FaceId(9), FaceId(11)));
    }
}

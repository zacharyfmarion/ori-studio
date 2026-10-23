//! A flat folded state (plan D2, research §3): the crease pattern, convex
//! faces with their lineage, the pairwise layer order and the view, plus what
//! they determine — every face's isometry and image, checked.
//!
//! [`State::make`] is the only way to produce one: every state has passed the
//! gate (`state/gate.rs`), in order: structure (a view at a finite angle
//! among it); convex faces covering the sheet, every vertex on it and the
//! border along its sides; isometries from a rigid root, every vertex landing
//! in one place; hinge consistency; the folded image as the layer order sees
//! it; and the layer order through `oristudio-layer-order`'s checker. Each
//! refusal names what failed. Turning over and rotating change only the view,
//! which no other check depends on, so they keep the model they were given;
//! a partial precrease changes only the crease marks, which are checked on
//! their own (`crate::crease_marks`).

mod derive;
mod gate;

use std::collections::BTreeSet;
use std::fmt;
use std::sync::Arc;

use oristudio_geometry::{Line, convex};
use oristudio_layer_order::{CheckReport, ConstraintProblem, FoldedView, LayerOrder, check};

use crate::crease_marks::{self, CreaseMark};
use crate::isometry::Isometry;
use crate::numerics::TOL;
use crate::pattern::{Crease, CreaseKind, EdgeId, Face, FaceId, VertexId};
use crate::refusal::FoldRefusal;
use crate::sheet::Sheet;
use crate::view::{StartSide, View};

pub(crate) use derive::{Geometry, Topology, ring_position};
pub(crate) use gate::{BeforeOrder, before_order, folded_image, touched_scope};

type Point = [f64; 2];

/// Everything a state stores. [`State::make`] derives and checks the rest.
#[derive(Clone, PartialEq)]
pub struct StateParts {
    pub sheet: Sheet,
    /// Crease-pattern vertices in sheet coordinates; a vertex's id is its
    /// index.
    pub vertices: Vec<Point>,
    pub creases: Vec<Crease>,
    pub faces: Vec<Face>,
    /// The face whose isometry is given; every other one is derived from it.
    pub root: FaceId,
    pub root_isometry: Isometry,
    /// Absolute: `above(f, g)` is f nearer the viewer at +z of the model
    /// frame, on every pair of faces whose images overlap.
    pub order: LayerOrder,
    pub view: View,
    /// How many operations led here; the flat sheet is 0.
    pub step: u32,
    /// Partial creases (`crate::crease_marks`): beside the face graph, not
    /// in it.
    pub marks: Vec<CreaseMark>,
}

/// The derived `Debug`, except that no marks print nothing: a state without
/// crease marks prints exactly as it did before they existed, so the
/// campaign digests that hash this output (`tests/random.rs`,
/// `tests/compound_digest.rs`) still prove a change leaves results alone.
impl fmt::Debug for StateParts {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut s = f.debug_struct("StateParts");
        s.field("sheet", &self.sheet)
            .field("vertices", &self.vertices)
            .field("creases", &self.creases)
            .field("faces", &self.faces)
            .field("root", &self.root)
            .field("root_isometry", &self.root_isometry)
            .field("order", &self.order)
            .field("view", &self.view)
            .field("step", &self.step);
        if !self.marks.is_empty() {
            s.field("marks", &self.marks);
        }
        s.finish()
    }
}

/// What the gate derived, shared by the states that differ only in view.
#[derive(Debug)]
pub(crate) struct Derived {
    pub(crate) topology: Topology,
    pub(crate) geometry: Geometry,
    pub(crate) view: FoldedView,
    /// Shared with the [`crate::Unordered`] that built it, when one did.
    pub(crate) problem: Arc<ConstraintProblem>,
}

/// A validated flat folded state. Immutable: every operation returns a new
/// one.
#[derive(Debug, Clone)]
pub struct State {
    parts: StateParts,
    derived: Arc<Derived>,
}

impl State {
    /// The only constructor: derive the isometries and check everything
    /// (see the module docs). Faces and creases are put in id order first.
    pub fn make(parts: StateParts) -> Result<State, FoldRefusal> {
        State::make_with(parts, None, None)
    }

    /// [`State::make`] for a state an operation built from `previous`,
    /// touching the faces in `touched` (and any face `previous` does not
    /// have): the layer-order problem is rebuilt incrementally and its
    /// constraints are checked where a touched face is involved.
    pub(crate) fn make_after(
        parts: StateParts,
        previous: &State,
        touched: &BTreeSet<FaceId>,
    ) -> Result<State, FoldRefusal> {
        State::make_with(parts, Some((previous, touched)), None)
    }

    /// [`State::make`] with the problem already built for these parts' faces
    /// and images, as [`crate::Unordered`] builds it before the order is
    /// known: the problem does not read letters, so it is the one the gate
    /// would build, and is not built twice.
    pub(crate) fn make_with_problem(
        parts: StateParts,
        problem: Arc<ConstraintProblem>,
    ) -> Result<State, FoldRefusal> {
        State::make_with(parts, None, Some(problem))
    }

    /// [`State::make_after`] with the problem already rebuilt, as
    /// [`State::make_with_problem`].
    pub(crate) fn make_after_with(
        parts: StateParts,
        previous: &State,
        touched: &BTreeSet<FaceId>,
        problem: Arc<ConstraintProblem>,
    ) -> Result<State, FoldRefusal> {
        State::make_with(parts, Some((previous, touched)), Some(problem))
    }

    fn make_with(
        mut parts: StateParts,
        previous: Option<(&State, &BTreeSet<FaceId>)>,
        problem: Option<Arc<ConstraintProblem>>,
    ) -> Result<State, FoldRefusal> {
        parts.faces.sort_by_key(|f| f.id);
        parts.creases.sort_by_key(|c| c.id);
        let derived = gate::run(&parts, previous, problem)?;
        Ok(State {
            parts,
            derived: Arc::new(derived),
        })
    }

    /// The unfolded sheet, with `start` toward the viewer.
    pub fn flat(sheet: Sheet, start: StartSide) -> Result<State, FoldRefusal> {
        let n = sheet.outline().len();
        let vertices = sheet.outline().to_vec();
        let creases = (0..n)
            .map(|i| Crease {
                id: EdgeId(i as u32),
                vertices: [VertexId(i as u32), VertexId(((i + 1) % n) as u32)],
                kind: CreaseKind::Border,
                made_at: 0,
            })
            .collect();
        let face = Face {
            id: FaceId(0),
            ring: (0..n as u32).map(VertexId).collect(),
            parent: None,
            born: 0,
        };
        State::make(StateParts {
            sheet,
            vertices,
            creases,
            faces: vec![face],
            root: FaceId(0),
            root_isometry: Isometry::IDENTITY,
            order: LayerOrder::new(),
            view: View::starting(start),
            step: 0,
            marks: Vec::new(),
        })
    }

    /// The same model seen with another view.
    pub(crate) fn with_view(&self, view: View, step: u32) -> State {
        let mut parts = self.parts.clone();
        parts.view = view;
        parts.step = step;
        State {
            parts,
            derived: Arc::clone(&self.derived),
        }
    }

    /// The same model with other crease marks, as step `step`: a partial
    /// precrease. Marks are beside the face graph, so nothing the gate
    /// derived depends on them; they pass the gate's own check of them.
    pub(crate) fn with_marks(
        &self,
        marks: Vec<CreaseMark>,
        step: u32,
    ) -> Result<State, FoldRefusal> {
        let mut parts = self.parts.clone();
        parts.marks = marks;
        parts.step = step;
        crease_marks::check(&parts)?;
        Ok(State {
            parts,
            derived: Arc::clone(&self.derived),
        })
    }

    pub fn parts(&self) -> &StateParts {
        &self.parts
    }

    pub fn into_parts(self) -> StateParts {
        self.parts
    }

    pub fn sheet(&self) -> &Sheet {
        &self.parts.sheet
    }

    pub fn vertices(&self) -> &[Point] {
        &self.parts.vertices
    }

    /// In id order.
    pub fn creases(&self) -> &[Crease] {
        &self.parts.creases
    }

    /// In id order.
    pub fn faces(&self) -> &[Face] {
        &self.parts.faces
    }

    pub fn order(&self) -> &LayerOrder {
        &self.parts.order
    }

    pub fn view(&self) -> View {
        self.parts.view
    }

    pub fn step(&self) -> u32 {
        self.parts.step
    }

    pub fn root(&self) -> FaceId {
        self.parts.root
    }

    /// The largest disagreement between two images of one vertex.
    pub fn residual(&self) -> f64 {
        self.derived.geometry.residual
    }

    /// The layer order's view of this state: face images and creases.
    pub fn folded_view(&self) -> &FoldedView {
        &self.derived.view
    }

    /// The layer-order constraint problem, with its overlay into cells.
    pub fn problem(&self) -> &ConstraintProblem {
        &self.derived.problem
    }

    /// Check the order from scratch over the whole state, with a problem
    /// built anew: what tests and a debug command run.
    pub fn check_full(&self) -> CheckReport {
        check(&self.derived.view, &self.parts.order)
    }

    pub fn face(&self, id: FaceId) -> Option<&Face> {
        self.face_position(id).map(|f| &self.parts.faces[f])
    }

    pub fn crease(&self, id: EdgeId) -> Option<&Crease> {
        self.parts
            .creases
            .binary_search_by_key(&id, |c| c.id)
            .ok()
            .map(|k| &self.parts.creases[k])
    }

    /// The face's isometry, sheet to model frame.
    pub fn isometry(&self, id: FaceId) -> Option<Isometry> {
        self.face_position(id)
            .map(|f| self.derived.geometry.isometries[f])
    }

    /// The face's image in the model frame, counter-clockwise.
    pub fn face_image(&self, id: FaceId) -> Option<&[Point]> {
        self.face_position(id)
            .map(|f| self.derived.geometry.images[f].as_slice())
    }

    /// Whether the face shows its front at +z of the model frame.
    pub fn front_up(&self, id: FaceId) -> Option<bool> {
        self.isometry(id).map(|t| t.front_up())
    }

    /// The vertex's image in the model frame.
    pub fn vertex_image(&self, v: VertexId) -> Option<Point> {
        self.derived.geometry.vertex_images.get(v.index()).copied()
    }

    /// Whether `f` lies above `g` in the model frame; none when they do not
    /// overlap.
    pub fn above(&self, f: FaceId, g: FaceId) -> Option<bool> {
        self.parts.order.above(f, g)
    }

    /// Whether the viewer sees `f` above `g`.
    pub fn seen_above(&self, f: FaceId, g: FaceId) -> Option<bool> {
        self.above(f, g).map(|a| self.parts.view.seen_above(a))
    }

    /// Whether the viewer sees the face's front.
    pub fn seen_front_up(&self, id: FaceId) -> Option<bool> {
        self.front_up(id).map(|up| up != self.parts.view.flipped)
    }

    /// The face whose sheet polygon contains `p` by more than the tolerance;
    /// none off the sheet or on a crease.
    pub fn face_at(&self, p: Point) -> Option<FaceId> {
        let mut hits = (0..self.parts.faces.len())
            .filter(|&f| convex::contains_point(&self.sheet_polygon(f), p, TOL));
        let first = hits.next()?;
        hits.next().is_none().then_some(self.parts.faces[first].id)
    }

    /// The model-frame image of a sheet point inside a face.
    pub fn image_of(&self, p: Point) -> Option<Point> {
        let face = self.face_at(p)?;
        self.isometry(face).map(|t| t.apply(p))
    }

    /// The faces whose images contain the model-frame point `p` by more than
    /// the tolerance, top first (in the model frame). None when the order
    /// does not stack them strictly, which a valid state never does.
    pub fn stack_at(&self, p: Point) -> Option<Vec<FaceId>> {
        let faces: Vec<FaceId> = self
            .parts
            .faces
            .iter()
            .zip(&self.derived.geometry.images)
            .filter(|(_, image)| convex::contains_point(image, p, TOL))
            .map(|(face, _)| face.id)
            .collect();
        sort_top_first(&faces, &self.parts.order)
    }

    /// The crease whose sheet segment passes through `p`.
    pub fn crease_at(&self, p: Point) -> Option<&Crease> {
        self.parts.creases.iter().find(|c| {
            let [a, b] = c.vertices.map(|v| self.parts.vertices[v.index()]);
            let len = (b[0] - a[0]).hypot(b[1] - a[1]);
            let along = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / len;
            let off = ((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / len;
            off.abs() <= TOL && along > TOL && along < len - TOL
        })
    }

    /// The model-frame line a crease's image lies on: what refolding a
    /// precrease or unfolding a flap folds along.
    pub fn crease_line(&self, id: EdgeId) -> Option<Line> {
        let k = self
            .parts
            .creases
            .binary_search_by_key(&id, |c| c.id)
            .ok()?;
        let f = *self.derived.topology.crease_faces[k].first()?;
        let t = self.derived.geometry.isometries[f];
        let [a, b] = self.parts.creases[k]
            .vertices
            .map(|v| t.apply(self.parts.vertices[v.index()]));
        Line::from_points(a, b)
    }

    pub(crate) fn face_position(&self, id: FaceId) -> Option<usize> {
        self.parts.faces.binary_search_by_key(&id, |f| f.id).ok()
    }

    pub(crate) fn topology(&self) -> &Topology {
        &self.derived.topology
    }

    pub(crate) fn geometry(&self) -> &Geometry {
        &self.derived.geometry
    }

    /// The face's sheet polygon.
    pub(crate) fn sheet_polygon(&self, f: usize) -> Vec<Point> {
        self.parts.faces[f]
            .ring
            .iter()
            .map(|v| self.parts.vertices[v.index()])
            .collect()
    }

    /// The next free face and crease ids.
    pub(crate) fn next_ids(&self) -> (u32, u32) {
        let face = self.parts.faces.last().map_or(0, |f| f.id.0 + 1);
        let crease = self.parts.creases.last().map_or(0, |c| c.id.0 + 1);
        (face, crease)
    }
}

/// Faces that all overlap one another, top first: ranked by how many of the
/// others each lies above. None unless the ranks are 0, 1, …, n − 1 (a strict
/// total order), so an inconsistent order can never reach a sort.
pub(crate) fn sort_top_first(faces: &[FaceId], order: &LayerOrder) -> Option<Vec<FaceId>> {
    let n = faces.len();
    let mut ranked: Vec<(usize, FaceId)> = Vec::with_capacity(n);
    for &f in faces {
        let mut below = 0;
        for &g in faces {
            if f != g && order.above(f, g)? {
                below += 1;
            }
        }
        ranked.push((below, f));
    }
    ranked.sort_unstable_by(|a, b| b.cmp(a));
    ranked
        .iter()
        .enumerate()
        .all(|(i, &(below, _))| below == n - 1 - i)
        .then(|| ranked.into_iter().map(|(_, f)| f).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sheet::Sheet;

    #[test]
    fn the_flat_sheet_passes_the_gate() {
        for sheet in [
            Sheet::square(),
            Sheet::rectangle(1.0, 2f64.sqrt()).unwrap_or_else(|e| panic!("{e}")),
            Sheet::regular(6).unwrap_or_else(|e| panic!("{e}")),
        ] {
            let s = State::flat(sheet, StartSide::Front).unwrap_or_else(|e| panic!("{e}"));
            assert_eq!(s.faces().len(), 1);
            assert_eq!(s.residual(), 0.0);
            assert!(s.check_full().is_valid());
            assert_eq!(s.front_up(FaceId(0)), Some(true));
            assert_eq!(s.next_ids().0, 1);
        }
    }

    /// The square folded in half through every layer, across x and y in
    /// turn, until a fold is refused: each landed state's face count, and
    /// the refusal.
    fn halve_until_refused(folds: usize) -> (Vec<usize>, Option<FoldRefusal>) {
        use crate::fold::PlainFold;
        let mut state =
            State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"));
        let mut landed = Vec::new();
        for k in 0..folds {
            let images: Vec<Point> = (0..state.vertices().len())
                .filter_map(|v| state.vertex_image(VertexId(v as u32)))
                .collect();
            let [x0, y0, x1, y1] = convex::bounding_box(&images);
            let centre = [(x0 + x1) / 2.0, (y0 + y1) / 2.0];
            let across = if k % 2 == 0 { [0.0, 1.0] } else { [1.0, 0.0] };
            let line = Line::from_point_direction(centre, across)
                .unwrap_or_else(|| panic!("no line through {centre:?}"));
            let op = PlainFold::new(
                line,
                crate::refusal::Side::Positive,
                crate::view::Direction::Valley,
            );
            match state.fold(&op) {
                Ok(folded) => {
                    state = folded.state;
                    landed.push(state.faces().len());
                }
                Err(refused) => return (landed, Some(refused.refusal)),
            }
        }
        (landed, None)
    }

    #[test]
    fn a_fold_that_stacks_past_the_cap_is_refused_and_one_short_of_it_lands() {
        // 256 layers on one stack are 2,763,520 triples, under the cap; the
        // next fold doubles them to 512, over it. Their counts are the
        // state's own, so a replay of the fold is refused alike.
        let (landed, refused) = halve_until_refused(10);
        assert_eq!(landed, vec![2, 4, 8, 16, 32, 64, 128, 256]);
        let refused = refused.unwrap_or_else(|| panic!("the ninth fold landed"));
        assert_eq!(
            refused,
            FoldRefusal::StackedTooDeep {
                deepest: 512,
                triples: 512 * 511 * 510 / 6,
                limit: oristudio_layer_order::MAX_STACKED_TRIPLES,
            }
        );
        assert_eq!(refused.code(), "stacked_too_deep");
    }

    #[test]
    fn a_state_over_the_face_cap_is_refused_before_anything_else() {
        // The flat sheet's face, many times over: duplicate ids and faces
        // covering the sheet many times, which the gate would refuse anyway,
        // but the count is checked first, before a table is built.
        let flat = State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"));
        let at = oristudio_layer_order::MAX_FACES;
        let mut parts = flat.parts().clone();
        parts.faces = vec![parts.faces[0].clone(); at + 1];
        assert_eq!(
            State::make(parts.clone()).err(),
            Some(FoldRefusal::TooManyFaces {
                face_count: at + 1,
                limit: at
            })
        );
        assert_eq!(
            FoldRefusal::TooManyFaces {
                face_count: at + 1,
                limit: at
            }
            .code(),
            "too_many_faces"
        );
        // At the cap, the count lets it through to the gate's other checks.
        parts.faces.truncate(at);
        assert_eq!(
            State::make(parts).err().map(|r| r.code()),
            Some("duplicate_id")
        );
    }

    #[test]
    fn a_back_up_start_is_seen_from_behind() {
        let s = State::flat(Sheet::square(), StartSide::Back).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(s.front_up(FaceId(0)), Some(true));
        assert_eq!(s.seen_front_up(FaceId(0)), Some(false));
    }

    #[test]
    fn sheet_points_resolve_to_faces_and_creases() {
        let s = State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(s.face_at([0.5, 0.5]), Some(FaceId(0)));
        assert_eq!(s.face_at([1.0, 0.5]), None);
        assert_eq!(s.face_at([2.0, 0.5]), None);
        assert_eq!(
            s.crease_at([1.0, 0.5]).map(|c| c.kind),
            Some(CreaseKind::Border)
        );
        assert_eq!(s.image_of([0.25, 0.75]), Some([0.25, 0.75]));
        assert_eq!(s.stack_at([0.5, 0.5]), Some(vec![FaceId(0)]));
    }

    #[test]
    fn stacks_need_a_strict_order() {
        let (a, b, c) = (FaceId(0), FaceId(1), FaceId(2));
        let mut order = LayerOrder::new();
        for (upper, lower) in [(a, b), (b, c), (a, c)] {
            assert!(order.set_above(upper, lower).is_ok());
        }
        assert_eq!(sort_top_first(&[c, a, b], &order), Some(vec![a, b, c]));
        // A cycle has no stack.
        assert!(order.set_above(c, a).is_ok());
        assert_eq!(sort_top_first(&[a, b, c], &order), None);
        // Nor does a missing pair.
        assert_eq!(sort_top_first(&[a, FaceId(9)], &order), None);
    }
}

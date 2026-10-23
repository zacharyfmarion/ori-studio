//! The scene a painter draws a state from (plan D11, D12): a superset of the
//! kernel's folded paper scene, schema 3 (`oristudio_cp::folding::FoldedPaperScene`,
//! `OristudioCpFoldedPaperScene` in the web app), so the app's own painters
//! (`foldedFlatPaperScene`, `foldedSceneLocalGeometry`, `paperSceneToSvg`)
//! take it unchanged, plus the fields only Fold has.
//!
//! # The kernel's fields
//!
//! - `faces`: one per face, in face id order (a face's index here is its
//!   position in [`State::faces`]). `outline` is the face's folded image,
//!   `points` the sheet vertex each outline point is (an index into
//!   `sheet_points`, so the two faces of a crease name its ends alike),
//!   `front_up` whether the viewer sees the face's front, and `edges` the
//!   crease each side came from: `border`, `fold` (M or V) or `flat` (F, a
//!   precrease or an unfolded crease; the painters draw it in the aux pen).
//! - `subfaces`: the cells of `oristudio-layer-order`'s overlay (the same
//!   cells the checker derives transitivity from), each with every face
//!   covering it, top first as the viewer sees it. Cells with equal stacks can
//!   sit side by side: the overlay cuts along whole edge lines.
//! - `sheet_points`: the crease-pattern vertices in sheet coordinates.
//! - `sheet`: the sheet's longer side, 1 in the unit sheet frame.
//! - `aux_lines`: the crease marks (partial creases, `crate::crease_marks`),
//!   one line per face each crosses: the kernel's lines carried through the
//!   fold, which every painter draws cut to where their face is on top, as
//!   Edit's folded figure draws the auxiliary lines a mark becomes there
//!   (plan D10). Whole precreases are creases between faces, so they travel
//!   as `flat` edges instead. Empty without marks.
//!
//! # The view
//!
//! Every coordinate except `sheet_points` and `creases` is in the *scene
//! frame*: the model frame seen through the [`View`], `view.transform()`
//! applied (y-up, the turn-over mirroring x). This is how the kernel's scene
//! carries its rear pass (`Back1`): `flipped` is the turn-over, the picture
//! is mirrored, `front_up` is as seen, and every stack reads top-down for the
//! viewer, so it is the model frame's stack reversed. Outlines and subface
//! polygons are counter-clockwise in the scene frame, `points` following.
//!
//! # Fold's own fields
//!
//! - `face_transforms`: per face, its map from sheet coordinates to the scene
//!   (the view after the face's isometry): exact, never fitted.
//! - `view_transform`: model frame to scene; its inverse takes a picked scene
//!   point back to the model frame a stored line lives in (plan D6).
//! - `creases`: the crease pattern in sheet coordinates, with Fold's edge ids
//!   (what the crease-pattern pane hit-tests, plan D13), each crease's kind,
//!   its letter (folded, or remembered by an unfolded crease; front-relative)
//!   and the step that made it.
//! - `lineage`: per face, its id, the face it was split from and the step that
//!   made it.
//! - `crease_marks`: the crease marks in sheet coordinates (what the
//!   crease-pattern pane draws), each with its front-relative letter, the
//!   step that made it, and its parts per face in the scene frame with the
//!   letter as the viewer sees it there. Left out without marks, so every
//!   other scene serializes as before.

use oristudio_geometry::convex;
use oristudio_layer_order::OrderTable;
use serde::{Deserialize, Serialize};

use crate::isometry::Isometry;
use crate::pattern::{CreaseKind, EdgeId, FaceId, Letter, VertexId, opposite};
use crate::state::{State, sort_top_first};
use crate::view::View;

type Point = [f64; 2];

/// The kernel scene schema Fold's scene extends: 3, with per-face `points`
/// and `sheet_points`.
pub const SCENE_SCHEMA_VERSION: u32 = 3;

/// The version of Fold's own fields; bumped when they change shape.
pub const FOLD_SCENE_SCHEMA: u32 = 1;

/// A point as the kernel's scene writes one.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ScenePoint {
    pub x: f64,
    pub y: f64,
}

impl From<Point> for ScenePoint {
    fn from([x, y]: Point) -> ScenePoint {
        ScenePoint { x, y }
    }
}

impl From<ScenePoint> for Point {
    fn from(p: ScenePoint) -> Point {
        [p.x, p.y]
    }
}

/// One state's scene. Field names and shapes are the kernel's
/// `FoldedPaperScene` for every field it has.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FoldScene {
    /// [`SCENE_SCHEMA_VERSION`].
    pub schema_version: u32,
    /// Turned over: the picture is mirrored and stacks read from the model
    /// frame's bottom.
    pub flipped: bool,
    /// The unfolded sheet's longer side, in scene units.
    pub sheet: f64,
    /// In face id order.
    pub faces: Vec<SceneFace>,
    pub subfaces: Vec<SceneSubface>,
    /// The crease marks' parts, one per face each crosses (see the module
    /// docs); empty without marks.
    pub aux_lines: Vec<SceneAuxLine>,
    /// Sheet coordinates of every crease-pattern vertex, by vertex id.
    pub sheet_points: Vec<ScenePoint>,
    /// [`FOLD_SCENE_SCHEMA`].
    pub fold_schema: u32,
    pub view: View,
    /// Model frame to scene.
    pub view_transform: Isometry,
    /// Per face, sheet to scene.
    pub face_transforms: Vec<Isometry>,
    /// In edge id order.
    pub creases: Vec<SceneCrease>,
    /// Per face.
    pub lineage: Vec<FaceLineage>,
    /// The crease marks, in the state's order; left out when there are none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub crease_marks: Vec<SceneCreaseMark>,
}

/// A crease mark: a partial crease (`crate::crease_marks`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SceneCreaseMark {
    /// Its ends, in sheet coordinates.
    pub from: ScenePoint,
    pub to: ScenePoint,
    /// Front-relative, as stored.
    pub letter: Letter,
    pub made_at: u32,
    /// Its part on each face it crosses, in the scene frame: the same lines
    /// as its `aux_lines`.
    pub pieces: Vec<SceneMarkPiece>,
}

/// A crease mark's part on one face, in the scene frame.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SceneMarkPiece {
    /// An index into `faces`.
    pub face: usize,
    pub from: ScenePoint,
    pub to: ScenePoint,
    /// The letter as the viewer sees it on this face: the stored one where
    /// the face shows its front, the other where it shows its back.
    pub seen: Letter,
}

/// One face's folded image.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SceneFace {
    /// Counter-clockwise in the scene frame.
    pub outline: Vec<ScenePoint>,
    /// Per outline point, its sheet vertex (an index into `sheet_points`).
    pub points: Vec<usize>,
    /// The viewer sees the face's front.
    pub front_up: bool,
    /// One per consecutive outline pair, the last closing to the first.
    pub edges: Vec<SceneFaceEdge>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SceneFaceEdge {
    pub from: ScenePoint,
    pub to: ScenePoint,
    pub kind: SceneEdgeKind,
}

/// The kernel's edge kinds, from Fold's `B | M | V | F`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SceneEdgeKind {
    /// The paper's raw edge (B).
    Border,
    /// A folded crease (M or V).
    Fold,
    /// An unfolded crease (F).
    Flat,
}

impl From<CreaseKind> for SceneEdgeKind {
    fn from(kind: CreaseKind) -> SceneEdgeKind {
        match kind {
            CreaseKind::Border => SceneEdgeKind::Border,
            CreaseKind::Folded(_) => SceneEdgeKind::Fold,
            CreaseKind::Flat(_) => SceneEdgeKind::Flat,
        }
    }
}

/// One overlay cell and its stack.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SceneSubface {
    /// Counter-clockwise in the scene frame.
    pub polygon: Vec<ScenePoint>,
    /// Every face covering the cell, as indices into `faces`, top first as
    /// the viewer sees it.
    pub faces_top_to_bottom: Vec<usize>,
}

/// The kernel's carried auxiliary line, on one face, in the scene frame:
/// Fold's are crease marks' parts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SceneAuxLine {
    pub from: ScenePoint,
    pub to: ScenePoint,
    pub face: usize,
}

/// One crease-pattern edge, in sheet coordinates.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SceneCrease {
    pub id: EdgeId,
    pub vertices: [VertexId; 2],
    pub from: ScenePoint,
    pub to: ScenePoint,
    pub kind: SceneEdgeKind,
    /// Front-relative: the letter a folded crease has, or the one an unfolded
    /// crease remembers; none for the border.
    pub letter: Option<Letter>,
    pub made_at: u32,
}

/// Where a face came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct FaceLineage {
    pub id: FaceId,
    /// The face it was split from; none for the sheet's face.
    pub parent: Option<FaceId>,
    /// The step that made it.
    pub born: u32,
}

impl State {
    /// The state's scene (see the module docs).
    pub fn scene(&self) -> FoldScene {
        let view = self.view();
        let to_scene = view.transform();
        let geometry = self.geometry();
        let topology = self.topology();
        let vertices = self.vertices();
        let creases = self.creases();
        let scene = |p: Point| ScenePoint::from(to_scene.apply(p));

        let mut faces = Vec::with_capacity(self.faces().len());
        let mut face_transforms = Vec::with_capacity(self.faces().len());
        for (f, face) in self.faces().iter().enumerate() {
            let transform = to_scene.after(&geometry.isometries[f]);
            let mut ring = face.ring.clone();
            if !transform.front_up() {
                ring.reverse();
            }
            let outline: Vec<ScenePoint> = ring
                .iter()
                .map(|v| ScenePoint::from(transform.apply(vertices[v.index()])))
                .collect();
            let n = ring.len();
            let edges = (0..n)
                .map(|i| {
                    let kind = topology
                        .crease_between(ring[i], ring[(i + 1) % n])
                        .map_or(SceneEdgeKind::Border, |k| creases[k].kind.into());
                    SceneFaceEdge {
                        from: outline[i],
                        to: outline[(i + 1) % n],
                        kind,
                    }
                })
                .collect();
            faces.push(SceneFace {
                points: ring.iter().map(|v| v.index()).collect(),
                outline,
                front_up: transform.front_up(),
                edges,
            });
            face_transforms.push(transform);
        }

        // Every cell's stack ranks each pair of its faces: through a table,
        // not the order's map (a fifty-deep stack is 2,500 lookups).
        let table = OrderTable::new(self.folded_view(), self.order());
        let subfaces = self
            .problem()
            .overlay()
            .cells()
            .iter()
            .map(|cell| {
                let mut polygon: Vec<ScenePoint> = cell.polygon.iter().map(|&p| scene(p)).collect();
                let positions: Vec<usize> = cell
                    .faces
                    .iter()
                    .filter_map(|&id| self.face_position(id))
                    .collect();
                let mut stack = top_first_at(&table, &positions);
                if view.flipped {
                    polygon.reverse();
                    stack.reverse();
                }
                SceneSubface {
                    polygon,
                    faces_top_to_bottom: stack,
                }
            })
            .collect();

        // Each crease mark's part on each face it crosses, through that
        // face's transform: aux lines for every painter, pieces for the
        // marks.
        let mut aux_lines = Vec::new();
        let mut crease_marks: Vec<SceneCreaseMark> = self
            .crease_marks()
            .iter()
            .map(|m| SceneCreaseMark {
                from: m.a.into(),
                to: m.b.into(),
                letter: m.letter,
                made_at: m.made_at,
                pieces: Vec::new(),
            })
            .collect();
        for piece in self.mark_pieces() {
            let mark = &self.crease_marks()[piece.mark];
            let transform = &face_transforms[piece.face];
            let [u0, u1] = piece.span;
            let (from, to) = (
                ScenePoint::from(transform.apply(mark.at(u0))),
                ScenePoint::from(transform.apply(mark.at(u1))),
            );
            aux_lines.push(SceneAuxLine {
                from,
                to,
                face: piece.face,
            });
            crease_marks[piece.mark].pieces.push(SceneMarkPiece {
                face: piece.face,
                from,
                to,
                seen: if transform.front_up() {
                    mark.letter
                } else {
                    opposite(mark.letter)
                },
            });
        }

        let [x0, y0, x1, y1] = convex::bounding_box(self.sheet().outline());
        FoldScene {
            schema_version: SCENE_SCHEMA_VERSION,
            flipped: view.flipped,
            sheet: (x1 - x0).max(y1 - y0),
            faces,
            subfaces,
            aux_lines,
            sheet_points: vertices.iter().map(|&p| p.into()).collect(),
            fold_schema: FOLD_SCENE_SCHEMA,
            view,
            view_transform: to_scene,
            face_transforms,
            creases: creases
                .iter()
                .map(|c| SceneCrease {
                    id: c.id,
                    vertices: c.vertices,
                    from: vertices[c.vertices[0].index()].into(),
                    to: vertices[c.vertices[1].index()].into(),
                    kind: c.kind.into(),
                    letter: c.kind.letter(),
                    made_at: c.made_at,
                })
                .collect(),
            lineage: self
                .faces()
                .iter()
                .map(|f| FaceLineage {
                    id: f.id,
                    parent: f.parent,
                    born: f.born,
                })
                .collect(),
            crease_marks,
        }
    }
}

/// [`top_first`] on face positions, through the order's table: the same
/// stack, or the same ranking with ties by id when the order does not stack
/// the faces strictly (positions follow ids).
fn top_first_at(table: &OrderTable, positions: &[usize]) -> Vec<usize> {
    if let Some(stack) = table.top_first(positions) {
        return stack;
    }
    let mut ranked: Vec<(usize, usize)> = positions
        .iter()
        .map(|&i| {
            let below = positions
                .iter()
                .filter(|&&j| j != i && table.above(i, j) == Some(true))
                .count();
            (below, i)
        })
        .collect();
    ranked.sort_unstable_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    ranked.into_iter().map(|(_, i)| i).collect()
}

/// Faces that all overlap one another (one cell's, or one point's), top
/// first in the model frame.
///
/// A valid state orders them strictly: the gate checks every overlapping
/// pair and transitivity in every cell. Should a pair be missing all the
/// same, the faces are ranked by how many of the others each lies above,
/// ties by id, so a picture is still drawn rather than refused.
pub(crate) fn top_first(state: &State, faces: &[FaceId]) -> Vec<FaceId> {
    if let Some(stack) = sort_top_first(faces, state.order()) {
        return stack;
    }
    let mut ranked: Vec<(usize, FaceId)> = faces
        .iter()
        .map(|&f| {
            let below = faces
                .iter()
                .filter(|&&g| g != f && state.above(f, g) == Some(true))
                .count();
            (below, f)
        })
        .collect();
    ranked.sort_unstable_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    ranked.into_iter().map(|(_, f)| f).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fold::PlainFold;
    use crate::refusal::Side;
    use crate::sheet::Sheet;
    use crate::view::{Direction, StartSide};
    use oristudio_geometry::Line;

    fn book() -> State {
        let flat = State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"));
        let line = Line::new([1.0, 0.0], 0.5).unwrap_or_else(|| unreachable!());
        let op = PlainFold::new(line, Side::Positive, Direction::Valley);
        flat.fold(&op).unwrap_or_else(|e| panic!("{e}")).state
    }

    fn xy(p: ScenePoint) -> Point {
        p.into()
    }

    #[test]
    fn the_flat_sheet_is_one_face_and_one_cell() {
        let s = State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"));
        let scene = s.scene();
        assert_eq!(scene.schema_version, 3);
        assert!(!scene.flipped);
        assert_eq!(scene.sheet, 1.0);
        assert_eq!(scene.faces.len(), 1);
        assert_eq!(scene.faces[0].points, vec![0, 1, 2, 3]);
        assert!(scene.faces[0].front_up);
        assert!(
            scene.faces[0]
                .edges
                .iter()
                .all(|e| e.kind == SceneEdgeKind::Border)
        );
        assert_eq!(scene.subfaces.len(), 1);
        assert_eq!(scene.subfaces[0].faces_top_to_bottom, vec![0]);
        assert!(scene.aux_lines.is_empty());
        assert_eq!(scene.creases.len(), 4);
        assert!(scene.creases.iter().all(|c| c.letter.is_none()));
    }

    #[test]
    fn a_book_fold_stacks_the_moved_half_on_top() {
        let s = book();
        let scene = s.scene();
        assert_eq!(scene.faces.len(), 2);
        let right = s
            .face_at([0.75, 0.5])
            .and_then(|id| s.face_position(id))
            .unwrap_or_else(|| unreachable!());
        assert!(
            !scene.faces[right].front_up,
            "the moved half shows its back"
        );
        for sub in &scene.subfaces {
            assert_eq!(sub.faces_top_to_bottom[0], right);
        }
        // The moved half's outline is its image, counter-clockwise, and its
        // transform takes its sheet corners onto it.
        let face = &scene.faces[right];
        let outline: Vec<Point> = face.outline.iter().map(|&p| xy(p)).collect();
        assert!(convex::signed_area(&outline) > 0.0);
        for (p, &v) in face.outline.iter().zip(&face.points) {
            let mapped = scene.face_transforms[right].apply(xy(scene.sheet_points[v]));
            assert!((mapped[0] - p.x).abs() < 1e-12 && (mapped[1] - p.y).abs() < 1e-12);
        }
        assert!(face.edges.iter().any(|e| e.kind == SceneEdgeKind::Fold));
        let fold = scene
            .creases
            .iter()
            .find(|c| c.kind == SceneEdgeKind::Fold)
            .unwrap_or_else(|| unreachable!());
        assert_eq!(fold.letter, Some(Letter::Valley));
        assert_eq!(fold.made_at, 1);
        assert_eq!(scene.lineage[right].parent, Some(FaceId(0)));
        assert_eq!(scene.lineage[right].born, 1);
    }

    #[test]
    fn turning_over_mirrors_the_picture_and_reverses_every_stack() {
        let s = book();
        let (front, back) = (s.scene(), s.turn_over().scene());
        assert!(back.flipped);
        assert_eq!(front.subfaces.len(), back.subfaces.len());
        for (a, b) in front.subfaces.iter().zip(&back.subfaces) {
            let mut reversed = a.faces_top_to_bottom.clone();
            reversed.reverse();
            assert_eq!(b.faces_top_to_bottom, reversed);
            let polygon: Vec<Point> = b.polygon.iter().map(|&p| xy(p)).collect();
            assert!(convex::signed_area(&polygon) > 0.0);
        }
        for (a, b) in front.faces.iter().zip(&back.faces) {
            assert_eq!(a.front_up, !b.front_up);
            let outline: Vec<Point> = b.outline.iter().map(|&p| xy(p)).collect();
            assert!(convex::signed_area(&outline) > 0.0);
            // Mirrored: the same points with x negated, in reverse order.
            let mirrored: Vec<Point> = a.outline.iter().map(|p| [-p.x, p.y]).collect();
            for p in &outline {
                assert!(
                    mirrored
                        .iter()
                        .any(|q| (q[0] - p[0]).abs() < 1e-12 && (q[1] - p[1]).abs() < 1e-12)
                );
            }
        }
        // The crease pattern is the sheet's, whatever the view.
        assert_eq!(front.creases, back.creases);
        assert_eq!(front.sheet_points, back.sheet_points);
    }

    #[test]
    fn a_rotated_view_turns_the_picture_only() {
        let s = book();
        let quarter = std::f64::consts::FRAC_PI_2;
        let turned = s.rotate(quarter).scene();
        let plain = s.scene();
        for (a, b) in plain.faces.iter().zip(&turned.faces) {
            assert_eq!(a.front_up, b.front_up);
            assert_eq!(a.points, b.points);
            for (p, q) in a.outline.iter().zip(&b.outline) {
                // (x, y) turned a quarter is (−y, x).
                assert!((q.x + p.y).abs() < 1e-12 && (q.y - p.x).abs() < 1e-12);
            }
        }
        for (a, b) in plain.subfaces.iter().zip(&turned.subfaces) {
            assert_eq!(a.faces_top_to_bottom, b.faces_top_to_bottom);
        }
    }

    /// The scene stacks each cell through the order's table; the stacks are
    /// those [`top_first`] gives through the order itself, cell by cell.
    #[test]
    fn every_cell_stacks_as_the_order_does() {
        let x = |c: f64| Line::new([1.0, 0.0], c).unwrap_or_else(|| unreachable!());
        let y = |c: f64| Line::new([0.0, 1.0], c).unwrap_or_else(|| unreachable!());
        let diagonal = Line::from_points([0.0, 0.0], [1.0, 1.0]).unwrap_or_else(|| unreachable!());
        let mut state = book();
        let mut cells = 0;
        for op in [
            PlainFold::new(y(0.5), Side::Positive, Direction::Mountain),
            PlainFold::new(x(0.25), Side::Negative, Direction::Valley),
            PlainFold::new(diagonal, Side::Negative, Direction::Valley),
        ] {
            state = state.fold(&op).unwrap_or_else(|e| panic!("{e}")).state;
            for view in [state.clone(), state.turn_over()] {
                let scene = view.scene();
                let overlay = view.problem().overlay();
                assert_eq!(scene.subfaces.len(), overlay.cells().len());
                for (sub, cell) in scene.subfaces.iter().zip(overlay.cells()) {
                    let mut want: Vec<usize> = top_first(&view, &cell.faces)
                        .into_iter()
                        .filter_map(|id| view.face_position(id))
                        .collect();
                    if view.view().flipped {
                        want.reverse();
                    }
                    assert_eq!(sub.faces_top_to_bottom, want);
                    cells += usize::from(want.len() > 2);
                }
            }
        }
        // 8 when written, counting both views.
        assert!(cells >= 6, "only {cells} cells of three layers or more");
    }

    /// Where the order stacks nothing strictly, the table ranks as
    /// [`top_first`] does: by how many each lies above, ties by id.
    #[test]
    fn a_table_ranks_an_order_that_stacks_nothing() {
        use oristudio_layer_order::{Face as ViewFace, FoldedView, LayerOrder};
        let square = vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];
        let view = FoldedView::new(
            (0..4)
                .map(|id| ViewFace {
                    id: FaceId(id),
                    polygon: square.clone(),
                    front_up: true,
                })
                .collect(),
            Vec::new(),
        )
        .unwrap_or_else(|e| panic!("{e}"));
        let mut order = LayerOrder::new();
        // 0 > 1 > 2 > 0, and 3 above 1 only.
        for (upper, lower) in [(0, 1), (1, 2), (2, 0), (3, 1)] {
            assert!(order.set_above(FaceId(upper), FaceId(lower)).is_ok());
        }
        let table = OrderTable::new(&view, &order);
        // Each of 0, 1, 2 and 3 lies above one other: all tie, so by id.
        assert_eq!(top_first_at(&table, &[3, 2, 1, 0]), vec![0, 1, 2, 3]);
        // Without 2: 0 above 1, 3 above 1, 0 and 3 unrelated.
        assert_eq!(top_first_at(&table, &[1, 3, 0]), vec![0, 3, 1]);
    }

    #[test]
    fn a_missing_pair_still_ranks_a_stack() {
        let s = book();
        let ids: Vec<FaceId> = s.faces().iter().map(|f| f.id).collect();
        assert_eq!(top_first(&s, &ids).len(), 2);
        // Faces the order does not relate keep their id order.
        let unrelated = [FaceId(41), FaceId(40)];
        assert_eq!(top_first(&s, &unrelated), vec![FaceId(40), FaceId(41)]);
    }
}

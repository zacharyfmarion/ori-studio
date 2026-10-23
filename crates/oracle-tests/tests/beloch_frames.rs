//! Beloch's FOLD fixtures through `oristudio-layer-order`'s checker (plan D8,
//! "Beloch frames"; research `r2-beloch` §1).
//!
//! `tests/fixtures/beloch/` holds the 56 distinct fixture files Beloch (MIT,
//! Christopher Mühl; see its README) commits with frames worth checking. Each
//! is a folding sequence whose frames are flat folded states: faces in table
//! (folded) coordinates, each face's paper-to-table matrix
//! (`beloch:faces_matrix`), and the layer order as FOLD `faceOrders`. Every
//! frame with two faces or more must pass the checker with its own order, as
//! all 105 passed the vendored Flat-Folder solver in the research spike.
//!
//! The view is built from Beloch's own faces, so `faceOrders` need no mapping.
//! The spike rebuilt each frame's crease pattern for Flat-Folder and matched
//! Flat-Folder's faces back to Beloch's by paper centroid; with Beloch's faces
//! taken as they are, that match is the identity. What a frame does not state
//! is derived in paper coordinates, where its faces tile the sheet:
//!
//! - the creases: each stretch of boundary two faces share, flat where their
//!   matrices agree and folded where they differ;
//! - the letters, from the frame's `edges_faces` and `edges_assignment` where
//!   it has them. Older fixtures do not; their creases are folded with the
//!   letter left for the order to decide.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use oristudio_geometry::{TOL, convex};
use oristudio_layer_order::{
    CheckReport, ConstraintProblem, Edge, EdgeKind, Face, FaceId, FoldedView, LayerOrder, Letter,
    Scope, check_problem,
};
use serde_json::Value;

mod support;
use support::repo_root;

const FIXTURES: &str = "tests/fixtures/beloch";

type Point = [f64; 2];

/// `beloch:faces_matrix`, paper to table: `x' = a x + b y + tx` and
/// `y' = c x + d y + ty` for `[a, b, c, d, tx, ty]`.
type Matrix = [f64; 6];

fn apply(t: &Matrix, p: Point) -> Point {
    [
        t[0] * p[0] + t[1] * p[1] + t[4],
        t[2] * p[0] + t[3] * p[1] + t[5],
    ]
}

fn det(t: &Matrix) -> f64 {
    t[0] * t[3] - t[1] * t[2]
}

fn inverse(t: &Matrix) -> Matrix {
    let d = det(t);
    let (a, b, c, e) = (t[3] / d, -t[1] / d, -t[2] / d, t[0] / d);
    [a, b, c, e, -(a * t[4] + b * t[5]), -(c * t[4] + e * t[5])]
}

/// One face of a frame: its table polygon, its paper polygon and the matrix
/// between them.
struct FrameFace {
    table: Vec<Point>,
    paper: Vec<Point>,
    matrix: Matrix,
}

/// A frame with two faces or more, read into a view and an order.
struct Frame {
    label: String,
    view: FoldedView,
    problem: ConstraintProblem,
    order: LayerOrder,
    /// Whether the frame letters its creases through `edges_faces`.
    lettered: bool,
    /// Folded creases with a letter.
    letters: usize,
}

fn point(value: &Value) -> Option<Point> {
    Some([value.get(0)?.as_f64()?, value.get(1)?.as_f64()?])
}

fn indices(value: &Value) -> Option<Vec<usize>> {
    value
        .as_array()?
        .iter()
        .map(|v| v.as_u64().map(|v| v as usize))
        .collect()
}

/// The frame's faces, or none for a frame without matrices.
fn frame_faces(frame: &Value) -> Result<Option<Vec<FrameFace>>, String> {
    let Some(matrices) = frame.get("beloch:faces_matrix").and_then(Value::as_array) else {
        return Ok(None);
    };
    let table: Vec<Point> = frame["vertices_coords"]
        .as_array()
        .ok_or("no vertices_coords")?
        .iter()
        .map(point)
        .collect::<Option<_>>()
        .ok_or("a vertex is not a point")?;
    let rings: Vec<Vec<usize>> = frame["faces_vertices"]
        .as_array()
        .ok_or("no faces_vertices")?
        .iter()
        .map(indices)
        .collect::<Option<_>>()
        .ok_or("a face is not a vertex list")?;
    if matrices.len() != rings.len() {
        return Err(format!(
            "{} matrices for {} faces",
            matrices.len(),
            rings.len()
        ));
    }
    let mut faces = Vec::with_capacity(rings.len());
    for (ring, matrix) in rings.iter().zip(matrices) {
        let matrix: Vec<f64> = matrix
            .as_array()
            .and_then(|m| m.iter().map(Value::as_f64).collect())
            .ok_or("a matrix is not six numbers")?;
        let matrix: Matrix = matrix
            .try_into()
            .map_err(|_| "a matrix is not six numbers")?;
        if det(&matrix).abs() < 0.5 {
            return Err(format!("matrix {matrix:?} is not an isometry"));
        }
        let table: Vec<Point> = ring
            .iter()
            .map(|&v| table.get(v).copied())
            .collect::<Option<_>>()
            .ok_or("a face names a missing vertex")?;
        let back = inverse(&matrix);
        let paper = table.iter().map(|&p| apply(&back, p)).collect();
        faces.push(FrameFace {
            table,
            paper,
            matrix,
        });
    }
    Ok(Some(faces))
}

/// The letter each face pair's crease has in the frame, from `edges_faces`.
fn frame_letters(frame: &Value) -> Option<BTreeMap<(usize, usize), String>> {
    let edges_faces = frame.get("edges_faces")?.as_array()?;
    let assignments = frame.get("edges_assignment")?.as_array()?;
    let mut letters = BTreeMap::new();
    for (faces, assignment) in edges_faces.iter().zip(assignments) {
        if let (Some([f, g]), Some(assignment)) = (
            indices(faces)
                .as_deref()
                .and_then(|f| <[usize; 2]>::try_from(f).ok()),
            assignment.as_str(),
        ) {
            letters.insert((f.min(g), f.max(g)), assignment.to_string());
        }
    }
    Some(letters)
}

/// The stretch of boundary two faces share in paper coordinates, if any. Two
/// convex faces with disjoint interiors share at most one, on the line
/// between them; collinear vertices can cut it into pieces, which are joined.
fn shared_boundary(p: &[Point], q: &[Point]) -> Option<[Point; 2]> {
    let mut span: Option<(Point, Point, f64, f64)> = None;
    for k in 0..p.len() {
        let (a, b) = (p[k], p[(k + 1) % p.len()]);
        let len = (b[0] - a[0]).hypot(b[1] - a[1]);
        if len <= TOL {
            continue;
        }
        let u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        let off = |x: Point| (x[0] - a[0]) * u[1] - (x[1] - a[1]) * u[0];
        let along = |x: Point| (x[0] - a[0]) * u[0] + (x[1] - a[1]) * u[1];
        for m in 0..q.len() {
            let (c, e) = (q[m], q[(m + 1) % q.len()]);
            if off(c).abs() > TOL || off(e).abs() > TOL {
                continue;
            }
            let lo = along(c).min(along(e)).max(0.0);
            let hi = along(c).max(along(e)).min(len);
            if hi - lo <= TOL {
                continue;
            }
            // Measured along the first piece's line, so pieces join.
            let (origin, dir) = match span {
                Some((origin, dir, _, _)) => (origin, dir),
                None => (a, u),
            };
            let t = |x: Point| (x[0] - origin[0]) * dir[0] + (x[1] - origin[1]) * dir[1];
            let (s0, s1) = (
                t([a[0] + u[0] * lo, a[1] + u[1] * lo]),
                t([a[0] + u[0] * hi, a[1] + u[1] * hi]),
            );
            let (s0, s1) = (s0.min(s1), s0.max(s1));
            span = Some(match span {
                Some((o, d, lo, hi)) => (o, d, lo.min(s0), hi.max(s1)),
                None => (origin, dir, s0, s1),
            });
        }
    }
    span.map(|(o, d, lo, hi)| {
        [
            [o[0] + d[0] * lo, o[1] + d[1] * lo],
            [o[0] + d[0] * hi, o[1] + d[1] * hi],
        ]
    })
}

fn same_matrix(a: &Matrix, b: &Matrix) -> bool {
    a.iter().zip(b).all(|(x, y)| (x - y).abs() <= 1e-9)
}

fn read_frame(label: String, frame: &Value, faces: &[FrameFace]) -> Result<Frame, String> {
    let letters = frame_letters(frame);
    let mut edges = Vec::new();
    let mut lettered_edges = 0;
    for i in 0..faces.len() {
        for j in i + 1..faces.len() {
            let Some([a, b]) = shared_boundary(&faces[i].paper, &faces[j].paper) else {
                continue;
            };
            let letter = letters
                .as_ref()
                .and_then(|l| l.get(&(i, j)))
                .map(String::as_str);
            let kind = if same_matrix(&faces[i].matrix, &faces[j].matrix) {
                match letter {
                    Some("M" | "V") => {
                        return Err(format!("faces {i} and {j} lie flat across a {letter:?}"));
                    }
                    _ => EdgeKind::Flat,
                }
            } else {
                match letter {
                    Some("M") => EdgeKind::Folded(Some(Letter::Mountain)),
                    Some("V") => EdgeKind::Folded(Some(Letter::Valley)),
                    None | Some("U") => EdgeKind::Folded(None),
                    Some(other) => {
                        return Err(format!("faces {i} and {j} are folded across a {other:?}"));
                    }
                }
            };
            lettered_edges += usize::from(matches!(kind, EdgeKind::Folded(Some(_))));
            let t = &faces[i].matrix;
            edges.push(Edge {
                faces: [FaceId(i as u32), FaceId(j as u32)],
                segment: [apply(t, a), apply(t, b)],
                kind,
            });
        }
    }
    let view_faces = faces
        .iter()
        .enumerate()
        .map(|(i, face)| Face {
            id: FaceId(i as u32),
            polygon: face.table.clone(),
            front_up: det(&face.matrix) > 0.0,
        })
        .collect();
    let view = FoldedView::new(view_faces, edges).map_err(|e| e.to_string())?;
    let triples: Vec<[i64; 3]> = frame
        .get("faceOrders")
        .and_then(Value::as_array)
        .map(|orders| {
            orders
                .iter()
                .map(|t| [0, 1, 2].map(|k| t.get(k).and_then(Value::as_i64).unwrap_or(i64::MIN)))
                .collect()
        })
        .unwrap_or_default();
    let order = LayerOrder::from_fold_face_orders(&triples, &view).map_err(|e| e.to_string())?;
    Ok(Frame {
        label,
        problem: ConstraintProblem::build(&view),
        view,
        order,
        lettered: letters.is_some(),
        letters: lettered_edges,
    })
}

fn fixture_paths() -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = fs::read_dir(repo_root().join(FIXTURES))
        .unwrap_or_else(|e| panic!("{FIXTURES}: {e}"))
        .map(|entry| entry.unwrap_or_else(|e| panic!("{FIXTURES}: {e}")).path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "fold"))
        .collect();
    paths.sort();
    paths
}

/// Every frame of every fixture with two faces or more. Checks on the way that
/// each frame's faces cover the same paper area as the file's first frame:
/// the matrices pull every frame back onto one sheet.
fn frames() -> Vec<Frame> {
    let mut out = Vec::new();
    for path in fixture_paths() {
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let text = fs::read_to_string(&path).unwrap_or_else(|e| panic!("{name}: {e}"));
        let document: Value = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{name}: {e}"));
        let mut sheet_area = None;
        for (k, frame) in document["file_frames"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default()
            .iter()
            .enumerate()
        {
            let label = format!("{name}#{k}");
            let Some(faces) = frame_faces(frame).unwrap_or_else(|e| panic!("{label}: {e}")) else {
                continue;
            };
            let area: f64 = faces
                .iter()
                .map(|face| convex::signed_area(&face.paper).abs())
                .sum();
            let first = *sheet_area.get_or_insert(area);
            assert!(
                (area - first).abs() <= 1e-9 * first.max(1.0),
                "{label}: its faces cover {area} of paper, the first frame {first}"
            );
            if faces.len() >= 2 {
                out.push(
                    read_frame(label.clone(), frame, &faces)
                        .unwrap_or_else(|e| panic!("{label}: {e}")),
                );
            }
        }
    }
    out
}

impl Frame {
    fn check(&self, order: &LayerOrder) -> CheckReport {
        check_problem(&self.problem, &self.view, order, Scope::All)
            .unwrap_or_else(|e| panic!("{}: {e}", self.label))
    }
}

/// `order` with the pair of `lo` and `hi` the other way round.
fn flipped(order: &LayerOrder, lo: FaceId, hi: FaceId, lo_above: bool) -> LayerOrder {
    let mut flipped = order.clone();
    let (upper, lower) = if lo_above { (hi, lo) } else { (lo, hi) };
    flipped
        .set_above(upper, lower)
        .unwrap_or_else(|e| panic!("{e}"));
    flipped
}

#[test]
fn every_beloch_frame_passes_the_checker_with_its_own_order() {
    assert_eq!(fixture_paths().len(), 56, "the 56 distinct fixture files");
    let frames = frames();
    let pairs: usize = frames.iter().map(|frame| frame.order.len()).sum();
    let letters: usize = frames.iter().map(|frame| frame.letters).sum();
    // The research spike's counts (r2-beloch §1): 105 frames, 1,701 pairs,
    // and 311 creases whose letters can be checked.
    assert_eq!(frames.len(), 105);
    assert_eq!(pairs, 1_701);
    assert_eq!(letters, 311);

    let failures: Vec<String> = frames
        .iter()
        .filter_map(|frame| {
            let report = frame.check(&frame.order);
            (!report.is_valid()).then(|| format!("{}: {:?}", frame.label, report.violations))
        })
        .collect();
    assert!(failures.is_empty(), "{failures:#?}");
}

/// Negative control: every single-pair flip of a lettered frame's order is
/// refused. In a frame without letters a flip can be another valid order: in
/// ten 2- and 3-face frames of older fixtures, the one pair a lone fold makes
/// can lie either way, as the spike found with Flat-Folder.
#[test]
fn single_pair_flips_of_beloch_orders_are_refused() {
    let (mut tried, mut refused, mut unlettered_valid) = (0, 0, 0);
    let mut missed = Vec::new();
    for frame in frames() {
        for (pair, lo_above) in frame.order.pairs() {
            let Some(lo_above) = lo_above else {
                continue;
            };
            let flip = flipped(&frame.order, pair.lo(), pair.hi(), lo_above);
            tried += 1;
            if !frame.check(&flip).is_valid() {
                refused += 1;
            } else if frame.lettered {
                missed.push(format!("{} {pair}", frame.label));
            } else {
                unlettered_valid += 1;
            }
        }
    }
    assert!(
        missed.is_empty(),
        "flips accepted in lettered frames: {missed:#?}"
    );
    assert_eq!((tried, refused, unlettered_valid), (1_701, 1_691, 10));
}

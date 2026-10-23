//! Shared test helpers: states built by hand from sheet faces and isometries,
//! and FOLD crease patterns with `faceOrders` read into a view and an order.

#![allow(dead_code)]

use std::collections::{BTreeMap, VecDeque};

use oristudio_layer_order::{Edge, EdgeKind, Face, FaceId, FoldedView, LayerOrder, Letter};
use serde_json::Value;

pub type Point = [f64; 2];

/// An affine map `[a, b, c, d, e, f]`: `x' = a x + b y + c`, `y' = d x + e y + f`.
pub type Affine = [f64; 6];

pub const IDENTITY: Affine = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0];

pub fn apply(t: &Affine, p: Point) -> Point {
    [
        t[0] * p[0] + t[1] * p[1] + t[2],
        t[3] * p[0] + t[4] * p[1] + t[5],
    ]
}

/// `a ∘ b`: apply `b` first.
pub fn compose(a: &Affine, b: &Affine) -> Affine {
    [
        a[0] * b[0] + a[1] * b[3],
        a[0] * b[1] + a[1] * b[4],
        a[0] * b[2] + a[1] * b[5] + a[2],
        a[3] * b[0] + a[4] * b[3],
        a[3] * b[1] + a[4] * b[4],
        a[3] * b[2] + a[4] * b[5] + a[5],
    ]
}

pub fn det(t: &Affine) -> f64 {
    t[0] * t[4] - t[1] * t[3]
}

/// The reflection across the line through `p` and `q`.
pub fn reflection(p: Point, q: Point) -> Affine {
    let (dx, dy) = (q[0] - p[0], q[1] - p[1]);
    let len = dx.hypot(dy);
    let (nx, ny) = (-dy / len, dx / len);
    let c = nx * p[0] + ny * p[1];
    [
        1.0 - 2.0 * nx * nx,
        -2.0 * nx * ny,
        2.0 * c * nx,
        -2.0 * nx * ny,
        1.0 - 2.0 * ny * ny,
        2.0 * c * ny,
    ]
}

/// The reflection across the vertical line `x = c`.
pub fn reflect_x(c: f64) -> Affine {
    [-1.0, 0.0, 2.0 * c, 0.0, 1.0, 0.0]
}

/// The reflection across the horizontal line `y = c`.
pub fn reflect_y(c: f64) -> Affine {
    [1.0, 0.0, 0.0, 0.0, -1.0, 2.0 * c]
}

pub fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Vec<Point> {
    vec![[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
}

/// A state described as sheet faces and their isometries into the folded
/// frame: the folded images, orientations and crease segments follow.
#[derive(Default)]
pub struct Sheet {
    faces: Vec<(FaceId, Vec<Point>, Affine)>,
    edges: Vec<(FaceId, FaceId, [Point; 2], EdgeKind)>,
}

impl Sheet {
    pub fn face(mut self, id: u32, sheet: Vec<Point>, t: Affine) -> Sheet {
        self.faces.push((FaceId(id), sheet, t));
        self
    }

    /// A crease between two faces, given in sheet coordinates.
    pub fn edge(mut self, f: u32, g: u32, segment: [Point; 2], kind: EdgeKind) -> Sheet {
        self.edges.push((FaceId(f), FaceId(g), segment, kind));
        self
    }

    pub fn view(&self) -> FoldedView {
        let iso: BTreeMap<FaceId, Affine> = self.faces.iter().map(|(id, _, t)| (*id, *t)).collect();
        let faces = self
            .faces
            .iter()
            .map(|(id, sheet, t)| Face {
                id: *id,
                polygon: sheet.iter().map(|&p| apply(t, p)).collect(),
                front_up: det(t) > 0.0,
            })
            .collect();
        let edges = self
            .edges
            .iter()
            .map(|(f, g, [a, b], kind)| {
                let t = iso.get(f).copied().unwrap_or(IDENTITY);
                Edge {
                    faces: [*f, *g],
                    segment: [apply(&t, *a), apply(&t, *b)],
                    kind: *kind,
                }
            })
            .collect();
        FoldedView::new(faces, edges).unwrap_or_else(|e| panic!("{e}"))
    }
}

/// An order from `(upper, lower)` pairs.
pub fn order(pairs: &[(u32, u32)]) -> LayerOrder {
    let mut order = LayerOrder::new();
    for &(upper, lower) in pairs {
        order
            .set_above(FaceId(upper), FaceId(lower))
            .unwrap_or_else(|e| panic!("{e}"));
    }
    order
}

/// An order stacking faces bottom to top.
pub fn stack(bottom_to_top: &[u32]) -> LayerOrder {
    let mut pairs = Vec::new();
    for (i, &lower) in bottom_to_top.iter().enumerate() {
        for &upper in &bottom_to_top[i + 1..] {
            pairs.push((upper, lower));
        }
    }
    order(&pairs)
}

/// A FOLD crease pattern with its layer order, read into a view (face ids
/// are FOLD face indices) and an order.
pub struct FoldState {
    pub view: FoldedView,
    pub order: LayerOrder,
}

/// Read a FOLD crease pattern (`vertices_coords`, `edges_vertices`,
/// `edges_assignment`, `faces_vertices`, `faceOrders`). Face isometries come
/// from a breadth-first walk from face 0, reflecting across M, V and U
/// creases and keeping across F (research §3); the folded frame is face 0's.
pub fn read_fold(text: &str) -> Result<FoldState, String> {
    let doc: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let points: Vec<Point> = doc["vertices_coords"]
        .as_array()
        .ok_or("no vertices_coords")?
        .iter()
        .map(|p| {
            [
                p[0].as_f64().unwrap_or(f64::NAN),
                p[1].as_f64().unwrap_or(f64::NAN),
            ]
        })
        .collect();
    let edges_vertices: Vec<[usize; 2]> = doc["edges_vertices"]
        .as_array()
        .ok_or("no edges_vertices")?
        .iter()
        .map(|e| {
            [
                e[0].as_u64().unwrap_or(0) as usize,
                e[1].as_u64().unwrap_or(0) as usize,
            ]
        })
        .collect();
    let assignments: Vec<String> = doc["edges_assignment"]
        .as_array()
        .ok_or("no edges_assignment")?
        .iter()
        .map(|a| a.as_str().unwrap_or("U").to_string())
        .collect();
    let rings: Vec<Vec<usize>> = doc["faces_vertices"]
        .as_array()
        .ok_or("no faces_vertices")?
        .iter()
        .map(|r| {
            r.as_array()
                .map(|r| r.iter().map(|v| v.as_u64().unwrap_or(0) as usize).collect())
                .unwrap_or_default()
        })
        .collect();
    let face_orders: Vec<[i64; 3]> = doc["faceOrders"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|t| {
                    [
                        t[0].as_i64().unwrap_or(-1),
                        t[1].as_i64().unwrap_or(-1),
                        t[2].as_i64().unwrap_or(9),
                    ]
                })
                .collect()
        })
        .unwrap_or_default();

    let edge_of: BTreeMap<(usize, usize), usize> = edges_vertices
        .iter()
        .enumerate()
        .map(|(e, &[a, b])| ((a.min(b), a.max(b)), e))
        .collect();
    let mut edge_faces = vec![Vec::new(); edges_vertices.len()];
    for (f, ring) in rings.iter().enumerate() {
        for k in 0..ring.len() {
            let (a, b) = (ring[k], ring[(k + 1) % ring.len()]);
            let e = *edge_of
                .get(&(a.min(b), a.max(b)))
                .ok_or_else(|| format!("face {f} edge {a}-{b} is not an edge"))?;
            edge_faces[e].push(f);
        }
    }
    let bends = |e: usize| matches!(assignments[e].as_str(), "M" | "V" | "U");

    let mut iso: Vec<Option<Affine>> = vec![None; rings.len()];
    if !rings.is_empty() {
        iso[0] = Some(IDENTITY);
    }
    let mut queue = VecDeque::from([0usize]);
    let mut face_edges = vec![Vec::new(); rings.len()];
    for (e, faces) in edge_faces.iter().enumerate() {
        for &f in faces {
            face_edges[f].push(e);
        }
    }
    while let Some(f) = queue.pop_front() {
        let Some(t) = iso[f] else { continue };
        for &e in &face_edges[f] {
            for &g in &edge_faces[e] {
                if g == f || iso[g].is_some() {
                    continue;
                }
                let [a, b] = edges_vertices[e];
                iso[g] = Some(if bends(e) {
                    compose(&t, &reflection(points[a], points[b]))
                } else {
                    t
                });
                queue.push_back(g);
            }
        }
    }

    let mut faces = Vec::with_capacity(rings.len());
    for (f, ring) in rings.iter().enumerate() {
        let t = iso[f].ok_or_else(|| format!("face {f} is not connected"))?;
        faces.push(Face {
            id: FaceId(f as u32),
            polygon: ring.iter().map(|&v| apply(&t, points[v])).collect(),
            front_up: det(&t) > 0.0,
        });
    }
    let mut edges = Vec::new();
    for (e, adjacent) in edge_faces.iter().enumerate() {
        let &[f, g] = adjacent.as_slice() else {
            continue;
        };
        let kind = match assignments[e].as_str() {
            "M" => EdgeKind::Folded(Some(Letter::Mountain)),
            "V" => EdgeKind::Folded(Some(Letter::Valley)),
            "U" => EdgeKind::Folded(None),
            _ => EdgeKind::Flat,
        };
        let t = iso[f].unwrap_or(IDENTITY);
        let [a, b] = edges_vertices[e];
        edges.push(Edge {
            faces: [FaceId(f as u32), FaceId(g as u32)],
            segment: [apply(&t, points[a]), apply(&t, points[b])],
            kind,
        });
    }
    let view = FoldedView::new(faces, edges).map_err(|e| e.to_string())?;
    let order =
        LayerOrder::from_fold_face_orders(&face_orders, &view).map_err(|e| e.to_string())?;
    Ok(FoldState { view, order })
}

/// An order from FOLD triples on a view, panicking on malformed input.
pub fn order_from_triples(triples: &[[i64; 3]], view: &FoldedView) -> LayerOrder {
    LayerOrder::from_fold_face_orders(triples, view).unwrap_or_else(|e| panic!("{e}"))
}

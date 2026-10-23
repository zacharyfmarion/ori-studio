//! What a state's stored parts determine: which creases bound which faces,
//! and every face's isometry and image (research §3).
//!
//! The isometries are derived by a breadth-first walk from the root face,
//! which keeps the isometry it is given: crossing a folded crease reflects
//! across the crease's sheet line, crossing a flat one does not. They are then
//! *checked*: every vertex must land in one place through all its faces. They
//! are never averaged (Oriedita's `folded_points` averages, which hides an
//! inconsistent state; research §3).

use std::collections::{HashMap, VecDeque};

use oristudio_geometry::convex;

use crate::isometry::Isometry;
use crate::pattern::{CreaseKind, VertexId};
use crate::refusal::FoldRefusal;
use crate::state::StateParts;

type Point = [f64; 2];

/// Crease–face incidence.
#[derive(Debug, Clone)]
pub(crate) struct Topology {
    /// Crease position by its vertex pair, smaller id first.
    lookup: HashMap<(u32, u32), usize>,
    /// Per crease, the positions of the faces it bounds: one for a border,
    /// two otherwise.
    pub(crate) crease_faces: Vec<Vec<usize>>,
    /// Per face, aligned with its ring: entry `i` is the crease from vertex
    /// `i` to vertex `i + 1`.
    pub(crate) face_creases: Vec<Vec<usize>>,
}

impl Topology {
    pub(crate) fn build(parts: &StateParts) -> Result<Topology, FoldRefusal> {
        let nv = parts.vertices.len();
        let mut lookup = HashMap::with_capacity(parts.creases.len());
        for (k, crease) in parts.creases.iter().enumerate() {
            let [a, b] = crease.vertices;
            for v in [a, b] {
                if v.index() >= nv {
                    return Err(FoldRefusal::CreaseUnknownVertex {
                        edge: crease.id,
                        vertex: v,
                    });
                }
            }
            if lookup.insert(key(a, b), k).is_some() || a == b {
                return Err(FoldRefusal::DuplicateId {
                    what: "crease between one pair of vertices",
                    id: crease.id.0,
                });
            }
        }
        let mut crease_faces = vec![Vec::new(); parts.creases.len()];
        let mut face_creases = Vec::with_capacity(parts.faces.len());
        let mut used = vec![false; nv];
        for (f, face) in parts.faces.iter().enumerate() {
            let n = face.ring.len();
            if n < 3 {
                return Err(FoldRefusal::FaceTooSmall { face: face.id });
            }
            let mut ring_creases = Vec::with_capacity(n);
            for i in 0..n {
                let (a, b) = (face.ring[i], face.ring[(i + 1) % n]);
                if a.index() >= nv {
                    return Err(FoldRefusal::UnknownVertex {
                        face: face.id,
                        vertex: a,
                    });
                }
                used[a.index()] = true;
                let Some(&k) = lookup.get(&key(a, b)) else {
                    return Err(FoldRefusal::MissingCrease {
                        face: face.id,
                        vertices: [a, b],
                    });
                };
                crease_faces[k].push(f);
                ring_creases.push(k);
            }
            face_creases.push(ring_creases);
        }
        for (k, faces) in crease_faces.iter().enumerate() {
            let want = if parts.creases[k].kind == CreaseKind::Border {
                1
            } else {
                2
            };
            if faces.len() != want || (want == 2 && faces[0] == faces[1]) {
                return Err(FoldRefusal::CreaseFaceCount {
                    edge: parts.creases[k].id,
                    faces: faces.len(),
                });
            }
        }
        if let Some(v) = used.iter().position(|&u| !u) {
            return Err(FoldRefusal::UnusedVertex {
                vertex: VertexId(v as u32),
            });
        }
        Ok(Topology {
            lookup,
            crease_faces,
            face_creases,
        })
    }

    /// The crease joining two vertices.
    pub(crate) fn crease_between(&self, a: VertexId, b: VertexId) -> Option<usize> {
        self.lookup.get(&key(a, b)).copied()
    }

    /// The face across crease `k` from face `f`; none for a border.
    pub(crate) fn across(&self, k: usize, f: usize) -> Option<usize> {
        self.crease_faces[k].iter().copied().find(|&g| g != f)
    }
}

fn key(a: VertexId, b: VertexId) -> (u32, u32) {
    if a.0 < b.0 { (a.0, b.0) } else { (b.0, a.0) }
}

/// Every face's isometry and image, checked.
#[derive(Debug, Clone)]
pub(crate) struct Geometry {
    pub(crate) isometries: Vec<Isometry>,
    /// Per face, its image counter-clockwise: the ring's order for a front-up
    /// face, reversed for one that shows its back.
    pub(crate) images: Vec<Vec<Point>>,
    pub(crate) boxes: Vec<[f64; 4]>,
    /// One image per vertex, through the face the walk reached it by first
    /// (the one nearest the root).
    pub(crate) vertex_images: Vec<Point>,
    /// The largest disagreement between two images of one vertex.
    pub(crate) residual: f64,
}

impl Geometry {
    /// Walk from the face at position `root` with isometry `root_isometry`,
    /// then check that every vertex lands in one place within `tolerance`.
    pub(crate) fn derive(
        parts: &StateParts,
        topology: &Topology,
        root: usize,
        tolerance: f64,
    ) -> Result<Geometry, FoldRefusal> {
        let nf = parts.faces.len();
        let mut isometries: Vec<Option<Isometry>> = vec![None; nf];
        let mut visit = Vec::with_capacity(nf);
        isometries[root] = Some(parts.root_isometry);
        let mut queue = VecDeque::from([root]);
        while let Some(f) = queue.pop_front() {
            visit.push(f);
            let Some(t) = isometries[f] else {
                continue;
            };
            for &k in &topology.face_creases[f] {
                let Some(g) = topology.across(k, f) else {
                    continue;
                };
                if isometries[g].is_some() {
                    continue;
                }
                let crease = &parts.creases[k];
                isometries[g] = Some(if crease.kind.is_folded() {
                    let [a, b] = crease.vertices.map(|v| parts.vertices[v.index()]);
                    t.after(&reflection_through(a, b))
                } else {
                    t
                });
                queue.push_back(g);
            }
        }
        let mut done = Vec::with_capacity(nf);
        for (f, t) in isometries.into_iter().enumerate() {
            match t {
                Some(t) => done.push(t),
                None => {
                    return Err(FoldRefusal::UnreachedFace {
                        face: parts.faces[f].id,
                    });
                }
            }
        }
        let isometries = done;

        let mut vertex_images: Vec<Option<Point>> = vec![None; parts.vertices.len()];
        let mut worst: Option<(f64, VertexId, usize)> = None;
        for &f in &visit {
            for &v in &parts.faces[f].ring {
                let p = isometries[f].apply(parts.vertices[v.index()]);
                match vertex_images[v.index()] {
                    None => vertex_images[v.index()] = Some(p),
                    Some(q) => {
                        let d = (p[0] - q[0]).hypot(p[1] - q[1]);
                        if worst.is_none_or(|(w, _, _)| d > w) {
                            worst = Some((d, v, f));
                        }
                    }
                }
            }
        }
        let residual = worst.map_or(0.0, |(w, _, _)| w);
        if let Some((w, vertex, f)) = worst
            && (w > tolerance || w.is_nan())
        {
            return Err(FoldRefusal::Residual {
                vertex,
                face: parts.faces[f].id,
                residual: w,
            });
        }
        // Every vertex is on some face (the topology checked), so every one
        // has an image.
        let vertex_images = vertex_images
            .into_iter()
            .map(|p| p.unwrap_or([f64::NAN, f64::NAN]))
            .collect();

        let images: Vec<Vec<Point>> = parts
            .faces
            .iter()
            .zip(&isometries)
            .map(|(face, t)| {
                let mut image: Vec<Point> = face
                    .ring
                    .iter()
                    .map(|v| t.apply(parts.vertices[v.index()]))
                    .collect();
                if !t.front_up() {
                    image.reverse();
                }
                image
            })
            .collect();
        let boxes = images.iter().map(|p| convex::bounding_box(p)).collect();
        Ok(Geometry {
            isometries,
            images,
            boxes,
            vertex_images,
            residual,
        })
    }
}

/// The reflection across the line through `a` and `b`, two distinct points.
pub(crate) fn reflection_through(a: Point, b: Point) -> Isometry {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let len = dx.hypot(dy);
    let n = [-dy / len, dx / len];
    Isometry::reflection(n, n[0] * a[0] + n[1] * a[1])
}

/// The ring position an image position comes from (images of back-up faces
/// are reversed).
pub(crate) fn ring_position(image_position: usize, len: usize, front_up: bool) -> usize {
    if front_up {
        image_position
    } else {
        len - 1 - image_position
    }
}

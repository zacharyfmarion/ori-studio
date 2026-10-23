//! Score a rabbit-ear fan through coplanar subdivisions of a triangular layer.
//! Existing flat edges remain material boundaries, not separate paper layers.
//! The original scorer remains the path for a layer consisting of one face.

use std::collections::BTreeSet;

use oristudio_geometry::convex::{self, HalfPlane};

use super::fan::{Fan, FanScoring};
use super::pieces::Scoring;
use super::vertex::stack_toward;
use crate::fold::Seed;
use crate::numerics::{Band, MIN_FEATURE, TOL};
use crate::pattern::{Crease, CreaseKind, EdgeId, Face, FaceId, Letter, VertexId};
use crate::refusal::{FoldRefusal, NearMissCause, Refused};
use crate::state::State;
use crate::view::Direction;

type Point = [f64; 2];

fn distance(a: Point, b: Point) -> f64 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}

/// The selected triangular layers, each a connected set of flat faces. None
/// means the original single-face scorer/selection applies unchanged.
pub(crate) fn layers(
    state: &State,
    triangle: &[Point; 3],
    center: Point,
    seed: &Seed,
    direction: Direction,
) -> Result<Option<Vec<Vec<usize>>>, Refused> {
    let triangle = convex::normalize(triangle);
    let images = &state.geometry().images;
    let eligible: Vec<bool> = images
        .iter()
        .map(|poly| {
            poly.iter()
                .all(|&p| convex::contains_point(&triangle, p, -TOL))
        })
        .collect();
    let mut group_of = vec![None; images.len()];
    let mut groups = Vec::<Vec<usize>>::new();
    for first in 0..images.len() {
        if !eligible[first] || group_of[first].is_some() {
            continue;
        }
        let id = groups.len();
        let mut group = vec![first];
        group_of[first] = Some(id);
        let mut i = 0;
        while i < group.len() {
            let f = group[i];
            i += 1;
            for &k in &state.topology().face_creases[f] {
                if !matches!(state.creases()[k].kind, CreaseKind::Flat(_)) {
                    continue;
                }
                if let Some(g) = state.topology().across(k, f)
                    && eligible[g]
                    && group_of[g].is_none()
                {
                    group_of[g] = Some(id);
                    group.push(g);
                }
            }
        }
        groups.push(group);
    }
    // The center must lie strictly inside a logical layer, clear of every
    // boundary and folded hinge. Interior flat subdivisions may pass through it.
    let holds: Vec<bool> = groups
        .iter()
        .enumerate()
        .map(|(id, group)| {
            group
                .iter()
                .any(|&f| convex::contains_point(&images[f], center, -TOL))
                && group.iter().all(|&f| {
                    state.topology().face_creases[f].iter().all(|&k| {
                        if state
                            .topology()
                            .across(k, f)
                            .is_some_and(|g| group_of[g] == Some(id))
                        {
                            return true;
                        }
                        let [a, b] = state.creases()[k].vertices.map(|v| {
                            state.geometry().isometries[f].apply(state.vertices()[v.index()])
                        });
                        let d = [b[0] - a[0], b[1] - a[1]];
                        let t = (((center[0] - a[0]) * d[0] + (center[1] - a[1]) * d[1])
                            / (d[0] * d[0] + d[1] * d[1]))
                            .clamp(0.0, 1.0);
                        distance(center, [a[0] + t * d[0], a[1] + t * d[1]]) >= MIN_FEATURE / 2.0
                    })
                })
        })
        .collect();
    if !groups
        .iter()
        .enumerate()
        .any(|(g, fs)| holds[g] && fs.len() > 1)
    {
        return Ok(None);
    }
    // Sample just off the junction to read the order of actual layers, not
    // an arbitrary ordering of faces touching only at the center.
    let mut ordered = Vec::new();
    for i in 0..24 {
        let a = 0.137 + i as f64 * 2.399963229728653;
        let p = [
            center[0] + a.cos() * 8.0 * TOL,
            center[1] + a.sin() * 8.0 * TOL,
        ];
        let Some(stack) = stack_toward(state, p, direction) else {
            continue;
        };
        let ids: Vec<usize> = stack
            .into_iter()
            .filter_map(|f| group_of[f])
            .filter(|&g| holds[g])
            .collect();
        if ids.len() > ordered.len() {
            ordered = ids;
        }
    }
    ordered.dedup();
    let group_at = |p| -> Result<usize, Refused> {
        let f = state
            .face_at(p)
            .and_then(|id| state.face_position(id))
            .ok_or(FoldRefusal::WitnessNotInFace { point: p })?;
        group_of[f].filter(|g| ordered.contains(g)).ok_or_else(|| {
            FoldRefusal::FanCenter {
                faces: vec![state.faces()[f].id],
            }
            .into()
        })
    };
    let chosen = match seed {
        Seed::All => ordered.clone(),
        Seed::Depth { at, layers } => {
            let g = group_at(*at)?;
            let start = ordered
                .iter()
                .position(|&x| x == g)
                .ok_or(FoldRefusal::EmptySeed)?;
            ordered.iter().skip(start).take(*layers).copied().collect()
        }
        Seed::Flaps { at } => {
            let selected = at
                .iter()
                .map(|&p| group_at(p))
                .collect::<Result<BTreeSet<_>, _>>()?;
            ordered
                .iter()
                .filter(|g| selected.contains(g))
                .copied()
                .collect()
        }
    };
    if chosen.is_empty() {
        return Err(FoldRefusal::EmptySeed.into());
    }
    Ok(Some(
        chosen.into_iter().map(|g| groups[g].clone()).collect(),
    ))
}

fn edge(a: VertexId, b: VertexId) -> (u32, u32) {
    (a.0.min(b.0), a.0.max(b.0))
}
fn parameter(p: Point, a: Point, b: Point) -> Option<f64> {
    let d = [b[0] - a[0], b[1] - a[1]];
    let length = d[0].hypot(d[1]);
    if length <= TOL {
        return None;
    }
    let t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / (length * length);
    let q = [a[0] + t * d[0], a[1] + t * d[1]];
    (t >= -TOL / length && t <= 1.0 + TOL / length && distance(p, q) <= TOL)
        .then_some(t.clamp(0.0, 1.0))
}

/// Intersect existing faces with the four wedges. Shared sheet coordinates
/// reuse vertices; subdivided original creases retain their kind and history.
pub(crate) fn score(
    state: &State,
    fan: &Fan,
    groups: &[Vec<usize>],
) -> Result<FanScoring, Refused> {
    let parts = state.parts();
    let geometry = state.geometry();
    let step = state.step() + 1;
    let selected: BTreeSet<usize> = groups.iter().flatten().copied().collect();
    let mut vertices = parts.vertices.clone();
    let mut kept = Vec::new();
    let mut children = Vec::new();
    let (mut next_face, mut next_crease) = state.next_ids();
    let mut split = 0;
    for (f, face) in parts.faces.iter().enumerate() {
        if !selected.contains(&f) {
            kept.push((face.clone(), f, None));
            continue;
        }
        let transform = geometry.isometries[f];
        let inverse = transform.inverse();
        let image = convex::normalize(&geometry.images[f]);
        for &v in &face.ring {
            let p = transform.apply(parts.vertices[v.index()]);
            for ray in &fan.rays {
                let d = [p[0] - fan.center[0], p[1] - fan.center[1]];
                let off = ray[0] * d[1] - ray[1] * d[0];
                if ray[0] * d[0] + ray[1] * d[1] > 0.0 && Band::of(off) == Band::Near {
                    return Err(FoldRefusal::NearMiss {
                        vertex: v,
                        distance: off.abs(),
                        cause: NearMissCause::Band,
                    }
                    .into());
                }
            }
        }
        let mut pieces = Vec::new();
        for w in 0..fan.rays.len() {
            let ray = |j: usize| {
                [
                    fan.center[0] + fan.rays[j][0],
                    fan.center[1] + fan.rays[j][1],
                ]
            };
            let left = HalfPlane::left_of(fan.center, ray(w)).ok_or(FoldRefusal::FanNotFlat)?;
            let right = HalfPlane::left_of(fan.center, ray((w + 1) % fan.rays.len()))
                .ok_or(FoldRefusal::FanNotFlat)?
                .complement();
            let polygon =
                convex::split(&convex::split(&image, &left, TOL).inside, &right, TOL).inside;
            if polygon.is_empty() {
                continue;
            }
            let polygon = convex::normalize(
                &polygon
                    .into_iter()
                    .map(|p| inverse.apply(p))
                    .collect::<Vec<_>>(),
            );
            let width = convex::width(&polygon);
            if width < MIN_FEATURE / 2.0 {
                return Err(FoldRefusal::ThinPiece {
                    face: face.id,
                    width,
                }
                .into());
            }
            let mut ring = Vec::new();
            for p in polygon {
                let v = vertices
                    .iter()
                    .position(|&q| distance(p, q) <= TOL)
                    .unwrap_or_else(|| {
                        vertices.push(p);
                        vertices.len() - 1
                    });
                ring.push(VertexId(v as u32));
            }
            pieces.push((ring, w));
        }
        if pieces.len() == 1
            && pieces[0].0.len() == face.ring.len()
            && pieces[0].0.iter().all(|v| face.ring.contains(v))
        {
            kept.push((face.clone(), f, Some(pieces[0].1)));
        } else {
            split += 1;
            for (ring, w) in pieces {
                children.push((
                    Face {
                        id: FaceId(next_face),
                        ring,
                        parent: Some(face.id),
                        born: step,
                    },
                    f,
                    Some(w),
                ));
                next_face += 1;
            }
        }
    }
    let mut faces: Vec<_> = kept.into_iter().chain(children).collect();
    // A cut ending on an old edge also subdivides the neighbouring face's
    // ring. This preserves one shared edge graph without changing its motion.
    let mut kept_creases = Vec::new();
    let mut added = Vec::new();
    for crease in &parts.creases {
        let [a, b] = crease.vertices.map(|v| parts.vertices[v.index()]);
        let mut chain: Vec<_> = vertices
            .iter()
            .enumerate()
            .filter_map(|(v, &p)| parameter(p, a, b).map(|t| (t, VertexId(v as u32))))
            .collect();
        chain.sort_by(|x, y| x.0.total_cmp(&y.0));
        let ids: Vec<_> = chain.into_iter().map(|(_, v)| v).collect();
        if ids.len() == 2 {
            kept_creases.push(crease.clone());
            continue;
        }
        for pair in ids.windows(2) {
            let length = distance(vertices[pair[0].index()], vertices[pair[1].index()]);
            if length < MIN_FEATURE {
                return Err(FoldRefusal::ShortCrease {
                    vertices: [pair[0], pair[1]],
                    length,
                }
                .into());
            }
            added.push(Crease {
                id: EdgeId(next_crease),
                vertices: [pair[0], pair[1]],
                ..crease.clone()
            });
            next_crease += 1;
        }
    }
    for (face, _, _) in &mut faces {
        let mut ring = Vec::new();
        for (i, &a) in face.ring.iter().enumerate() {
            let b = face.ring[(i + 1) % face.ring.len()];
            ring.push(a);
            let mut interior: Vec<_> = vertices
                .iter()
                .enumerate()
                .filter_map(|(v, &p)| {
                    let id = VertexId(v as u32);
                    (id != a && id != b)
                        .then(|| {
                            parameter(p, vertices[a.index()], vertices[b.index()]).map(|t| (t, id))
                        })
                        .flatten()
                })
                .collect();
            interior.sort_by(|x, y| x.0.total_cmp(&y.0));
            ring.extend(interior.into_iter().map(|(_, id)| id));
        }
        face.ring = ring;
    }
    let mut known: BTreeSet<_> = kept_creases
        .iter()
        .chain(&added)
        .map(|c| edge(c.vertices[0], c.vertices[1]))
        .collect();
    let mut created = Vec::new();
    for (face, _, _) in &faces {
        for (i, &a) in face.ring.iter().enumerate() {
            let b = face.ring[(i + 1) % face.ring.len()];
            if !known.insert(edge(a, b)) {
                continue;
            }
            let length = distance(vertices[a.index()], vertices[b.index()]);
            if length < MIN_FEATURE {
                return Err(FoldRefusal::ShortCrease {
                    vertices: [a, b],
                    length,
                }
                .into());
            }
            created.push(EdgeId(next_crease));
            added.push(Crease {
                id: EdgeId(next_crease),
                vertices: [a, b],
                kind: CreaseKind::Folded(Letter::Valley),
                made_at: step,
            });
            next_crease += 1;
        }
    }
    Ok(FanScoring {
        wedge_of: faces.iter().map(|(_, _, w)| *w).collect(),
        scoring: Scoring {
            vertices,
            old: faces.iter().map(|(_, f, _)| *f).collect(),
            faces: faces.into_iter().map(|(f, _, _)| f).collect(),
            creases: kept_creases.into_iter().chain(added).collect(),
            created,
            split,
        },
    })
}

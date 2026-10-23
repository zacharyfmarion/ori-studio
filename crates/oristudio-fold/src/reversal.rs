//! Return to a known material pose while retaining physical crease history.
//! The target is validated; it supplies transforms and order, never face IDs
//! to copy into the new graph. Every result passes the full state gate.

use oristudio_geometry::convex;
use oristudio_layer_order::LayerOrder;
use serde::Serialize;
use thiserror::Error;

use crate::import::arrangement::{self, Kind, Placed};
use crate::numerics::TOL;
use crate::{Crease, CreaseKind, EdgeId, Face, FaceId, Letter, State, StateParts, VertexId};

type Point = [f64; 2];
const MAX_SEGMENTS: usize = 4096;
const MAX_FACES: usize = 4096;

#[derive(Debug, Error)]
pub enum ReturnRefusal {
    #[error("the return history and target must use the same sheet")]
    SheetMismatch,
    #[error("the material refinement exceeds the return work limit")]
    Limit,
    #[error("a refined face does not belong to exactly one target face")]
    Material,
    #[error("the target does not order overlapping material")]
    Order,
    #[error("the returned material does not match the target pose")]
    Pose,
    #[error(transparent)]
    Arrangement(#[from] crate::ImportRefusal),
    #[error(transparent)]
    State(#[from] crate::FoldRefusal),
}

impl ReturnRefusal {
    pub fn code(&self) -> &'static str {
        match self {
            Self::SheetMismatch => "return_sheet_mismatch",
            Self::Limit => "return_limit",
            Self::Material => "return_material",
            Self::Order => "return_order",
            Self::Pose => "return_pose",
            Self::Arrangement(_) => "return_arrangement",
            Self::State(_) => "return_invalid_state",
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ReturnReport {
    /// Output faces and their target material regions, for this result only.
    pub material: Vec<(FaceId, FaceId)>,
    pub retained_creases: usize,
    pub retained_marks: usize,
}

#[derive(Debug)]
pub struct Returned {
    pub state: State,
    pub report: ReturnReport,
}

#[derive(Clone)]
struct Segment {
    ends: [Point; 2],
    kind: CreaseKind,
    made_at: u32,
    revision: usize,
}

/// History is chronological, on one sheet: the states from the target, or from
/// the last CP replacement (Import CP) when that is later, through current.
/// Never a state before that replacement: it replaced the model, so its
/// creases are no longer on the paper, and passing them brings them back.
/// Current and target are always included; a target from before the
/// replacement supplies its own creases, which its pose is made of. No
/// document/worker identity enters this API.
pub fn restore_pose(
    current: &State,
    target: &State,
    history: &[&State],
) -> Result<Returned, ReturnRefusal> {
    let mut segments: Vec<Segment> = Vec::new();
    let mut marks = Vec::new();
    let mut revision = 0;
    // Target first ensures it is included for standalone callers; history
    // and current then supply the most recent remembered crease directions.
    for state in std::iter::once(target)
        .chain(history.iter().copied())
        .chain([current])
    {
        if state.sheet() != current.sheet() {
            return Err(ReturnRefusal::SheetMismatch);
        }
        revision += 1;
        for c in state.creases() {
            let ends = c.vertices.map(|v| state.vertices()[v.0 as usize]);
            if let Some(old) = segments
                .iter_mut()
                .find(|s| s.ends == ends || s.ends == [ends[1], ends[0]])
            {
                old.kind = c.kind;
                old.revision = revision;
                old.made_at = old.made_at.min(c.made_at);
            } else {
                segments.push(Segment {
                    ends,
                    kind: c.kind,
                    made_at: c.made_at,
                    revision,
                });
                if segments.len() > MAX_SEGMENTS {
                    return Err(ReturnRefusal::Limit);
                }
            }
        }
        marks = crate::crease_marks::add(&marks, state.crease_marks().to_vec());
        if marks.len() > MAX_SEGMENTS {
            return Err(ReturnRefusal::Limit);
        }
    }
    // All historical segments are flat for topology construction. Their
    // actual letters are restored below after intersections are split.
    let placed: Vec<_> = segments
        .iter()
        .enumerate()
        .map(|(i, s)| Placed {
            ends: s.ends,
            kind: if s.kind == CreaseKind::Border {
                Kind::Border
            } else {
                Kind::Flat(Letter::Valley)
            },
            segment: i,
        })
        .collect();
    let graph = arrangement::refine(&placed, current.sheet())?;
    if graph.faces.len() > MAX_FACES {
        return Err(ReturnRefusal::Limit);
    }
    let owners = graph
        .faces
        .iter()
        .map(|ring| {
            let polygon: Vec<_> = ring.iter().map(|&v| graph.vertices[v]).collect();
            owner(target, &polygon)
        })
        .collect::<Result<Vec<_>, _>>()?;

    let next_face = current
        .faces()
        .iter()
        .map(|f| f.id.0)
        .max()
        .unwrap_or(0)
        .checked_add(1)
        .ok_or(ReturnRefusal::Limit)?;
    let next_edge = current
        .creases()
        .iter()
        .map(|c| c.id.0)
        .max()
        .unwrap_or(0)
        .checked_add(1)
        .ok_or(ReturnRefusal::Limit)?;
    let step = current.step().checked_add(1).ok_or(ReturnRefusal::Limit)?;
    // Keep existing vertex identities even when the arrangement reorders them.
    let mut vertices = current.vertices().to_vec();
    let vertex_ids: Vec<_> = graph
        .vertices
        .iter()
        .map(|&p| {
            let i = vertices
                .iter()
                .position(|&q| distance(p, q) <= TOL)
                .unwrap_or_else(|| {
                    vertices.push(p);
                    vertices.len() - 1
                });
            VertexId(i as u32)
        })
        .collect();
    let faces: Vec<_> = graph
        .faces
        .iter()
        .enumerate()
        .map(|(i, ring)| {
            let polygon: Vec<_> = ring.iter().map(|&v| graph.vertices[v]).collect();
            Ok(Face {
                id: FaceId(
                    next_face
                        .checked_add(i as u32)
                        .ok_or(ReturnRefusal::Limit)?,
                ),
                ring: ring.iter().map(|&v| vertex_ids[v]).collect(),
                parent: Some(owner(current, &polygon)?),
                born: step,
            })
        })
        .collect::<Result<_, ReturnRefusal>>()?;
    let mut creases = Vec::new();
    for (i, e) in graph.edges.iter().enumerate() {
        let ends = e.ends.map(|v| graph.vertices[v]);
        let records: Vec<_> = segments.iter().filter(|s| covers(s.ends, ends)).collect();
        let record = records
            .iter()
            .max_by_key(|s| s.revision)
            .ok_or(ReturnRefusal::Material)?;
        let target_kind = target
            .creases()
            .iter()
            .find(|c| covers(c.vertices.map(|v| target.vertices()[v.0 as usize]), ends))
            .map(|c| c.kind);
        let kind = if e.kind == Kind::Border {
            CreaseKind::Border
        } else if let Some(kind @ CreaseKind::Folded(_)) = target_kind {
            kind
        } else {
            CreaseKind::Flat(record.kind.letter().ok_or(ReturnRefusal::Material)?)
        };
        creases.push(Crease {
            id: EdgeId(
                next_edge
                    .checked_add(i as u32)
                    .ok_or(ReturnRefusal::Limit)?,
            ),
            vertices: e.ends.map(|v| vertex_ids[v]),
            kind,
            made_at: records
                .iter()
                .map(|s| s.made_at)
                .min()
                .ok_or(ReturnRefusal::Material)?,
        });
    }
    marks = crate::crease_marks::carry(&marks, &vertices, &creases);
    let transforms = owners
        .iter()
        .map(|&f| target.isometry(f).ok_or(ReturnRefusal::Material))
        .collect::<Result<Vec<_>, _>>()?;
    let images: Vec<Vec<_>> = faces
        .iter()
        .zip(&transforms)
        .map(|(f, t)| {
            convex::normalize(
                &f.ring
                    .iter()
                    .map(|v| t.apply(vertices[v.0 as usize]))
                    .collect::<Vec<_>>(),
            )
        })
        .collect();
    let mut order = LayerOrder::new();
    for i in 0..faces.len() {
        for j in i + 1..faces.len() {
            if !convex::overlaps(&images[i], &images[j]) {
                continue;
            }
            let above = target
                .order()
                .above(owners[i], owners[j])
                .ok_or(ReturnRefusal::Order)?;
            let (a, b) = if above { (i, j) } else { (j, i) };
            order
                .set_above(faces[a].id, faces[b].id)
                .map_err(|_| ReturnRefusal::Order)?;
        }
    }
    let root = faces.first().ok_or(ReturnRefusal::Material)?.id;
    let root_isometry = *transforms.first().ok_or(ReturnRefusal::Material)?;
    let report = ReturnReport {
        material: faces.iter().zip(&owners).map(|(f, &o)| (f.id, o)).collect(),
        retained_creases: creases
            .iter()
            .filter(|c| c.kind != CreaseKind::Border)
            .count(),
        retained_marks: marks.len(),
    };
    let state = State::make(StateParts {
        sheet: current.sheet().clone(),
        vertices,
        faces,
        creases,
        root,
        root_isometry,
        order,
        view: target.view(),
        step,
        marks,
    })?;
    for (f, t) in state.faces().iter().zip(transforms) {
        let actual = state.isometry(f.id).ok_or(ReturnRefusal::Material)?;
        if actual.front_up() != t.front_up()
            || actual.distance_on(&t, f.ring.iter().map(|v| state.vertices()[v.0 as usize])) > TOL
        {
            return Err(ReturnRefusal::Pose);
        }
    }
    Ok(Returned { state, report })
}

fn owner(state: &State, polygon: &[Point]) -> Result<FaceId, ReturnRefusal> {
    let center = convex::centroid(polygon).ok_or(ReturnRefusal::Material)?;
    let mut found = None;
    for f in state.faces() {
        let p: Vec<_> = f
            .ring
            .iter()
            .map(|v| state.vertices()[v.0 as usize])
            .collect();
        if convex::contains_point(&p, center, 0.0)
            && polygon.iter().all(|&x| convex::contains_point(&p, x, -TOL))
        {
            if found.is_some() {
                return Err(ReturnRefusal::Material);
            }
            found = Some(f.id);
        }
    }
    found.ok_or(ReturnRefusal::Material)
}

fn covers([a, b]: [Point; 2], ends: [Point; 2]) -> bool {
    let length = distance(a, b);
    if length <= TOL {
        return false;
    }
    ends.iter().all(|p| {
        let x = p[0] - a[0];
        let y = p[1] - a[1];
        let dx = b[0] - a[0];
        let dy = b[1] - a[1];
        ((dx * y - dy * x) / length).abs() <= TOL
            && (x * dx + y * dy) / length >= -TOL
            && (x * dx + y * dy) / length <= length + TOL
    })
}

fn distance(a: Point, b: Point) -> f64 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}

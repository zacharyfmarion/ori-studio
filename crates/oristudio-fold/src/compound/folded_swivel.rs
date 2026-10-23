//! Flat swivel geometry shared by the swivel by its edge onto a line and the
//! swivel by its valley and mountain.
use crate::compound::Against;
use crate::compound::pieces::{Cut, score_cuts};
use crate::compound::swivel::{SwivelKind, SwivelWedge, dot, internal, sub};
use crate::compound::vertex::{Compiled, VertexFoldKind, cross, drop_empty, unit};
use crate::fold::line::Axis;
use crate::numerics::{Band, MIN_FEATURE, TOL};
use crate::pattern::{CreaseKind, FaceId, VertexId};
use crate::refusal::{FoldRefusal, NearMissCause, Refused, Side};
use crate::state::State;
use crate::view::Direction;
use oristudio_geometry::{Line, convex};
use std::collections::HashMap;
type Point = [f64; 2];

/// Three new crease rays around an existing folded edge. The old tip opens.
/// In the edge-to-line construction `counter == swivel`; a swivel by its
/// valley and mountain names `counter` and `second` and computes `swivel`
/// from them, which closes the same motions.
#[derive(Debug, Clone)]
pub(super) struct FoldFan {
    pub vertex: Point,
    pub fold_line: Line,
    pub fold_run: [Point; 2],
    pub run: Vec<usize>,
    pub faces: [usize; 2],
    pub opens: Point,
    pub stays: Point,
    pub swivel: Point,
    pub counter: Point,
    pub second: Point,
}
impl FoldFan {
    pub fn ids(&self, state: &State) -> Vec<FaceId> {
        self.faces.map(|f| state.faces()[f].id).to_vec()
    }
    pub fn swivel_line(&self) -> Result<Line, Refused> {
        self.line(self.swivel)
    }
    pub fn counter_line(&self) -> Result<Line, Refused> {
        self.line(self.counter)
    }
    pub fn second_line(&self) -> Result<Line, Refused> {
        self.line(self.second)
    }
    fn line(&self, direction: Point) -> Result<Line, Refused> {
        Line::from_point_direction(self.vertex, direction)
            .ok_or_else(|| internal("a swivel crease has no line"))
    }
}
/// The faces a crease runs through in one layer, from the vertex, and
/// where it leaves the last of them.
pub(super) struct RayRun {
    pub(super) faces: Vec<usize>,
    pub(super) end: Point,
}

/// A swivel on a folded edge compiled with one reading of its two layers.
pub(super) struct FoldCompiled {
    pub(super) compiled: Compiled,
    /// Per block of `compiled`, its wedge.
    pub(super) wedges: Vec<SwivelWedge>,
    /// The edge's layer and the other one, by position.
    pub(super) edge_layer: usize,
    pub(super) other_layer: usize,
    /// Where each crease leaves its layer: the edge layer's `s`, the other
    /// layer's `s`, its `s′`.
    pub(super) ends: [Point; 3],
    /// The stretch of the edge's line, past where it meets the target, that
    /// the wedge folding across `s` has a side along (`edge_reach`): the
    /// edge that swivels onto the target. None when it has none.
    pub(super) reach: Option<[f64; 2]>,
}

/// The subdivisions of one coplanar material layer. A folded attachment
/// remains a boundary even when its paper overlaps this layer.
pub(super) fn flat_region(state: &State, start: usize) -> Vec<bool> {
    let topology = state.topology();
    let mut region = vec![false; state.faces().len()];
    region[start] = true;
    let mut pending = vec![start];
    while let Some(f) = pending.pop() {
        for &k in &topology.face_creases[f] {
            if matches!(state.creases()[k].kind, CreaseKind::Flat(_))
                && let Some(g) = topology.across(k, f)
                && !region[g]
            {
                region[g] = true;
                pending.push(g);
            }
        }
    }
    region
}

/// The faces a crease from `from`, on the boundary of face `start`'s image,
/// runs through along the unit model direction `u`: `start`, then on across
/// every flat crease it leaves through, until it leaves through the paper's
/// raw edge or a boundary vertex. Internal flat-precrease vertices continue
/// into the same material layer. A crease it would leave through that is folded is
/// in its way (`fan_ray_blocked`, naming the paper across); a vertex it
/// passes within a near miss of is refused as the fan's are.
pub(super) fn ray_run(
    state: &State,
    start: usize,
    from: Point,
    u: Point,
) -> Result<RayRun, Refused> {
    let parts = state.parts();
    let topology = state.topology();
    let geometry = state.geometry();
    let region = flat_region(state, start);
    let next_face = |at: Point, previous: &[usize]| {
        let q = [
            at[0] + u[0] * MIN_FEATURE / 4.0,
            at[1] + u[1] * MIN_FEATURE / 4.0,
        ];
        (0..parts.faces.len()).find(|&f| {
            region[f]
                && !previous.contains(&f)
                && convex::contains_point(&geometry.images[f], q, -TOL)
        })
    };
    let mut f = next_face(from, &[]).ok_or_else(|| {
        Refused::from(FoldRefusal::FanCenter {
            faces: vec![parts.faces[start].id],
        })
    })?;
    let mut at = from;
    let mut faces = vec![f];
    for _ in 0..parts.faces.len() {
        let face = &parts.faces[f];
        let t = geometry.isometries[f];
        let inverse = t.inverse();
        let p = inverse.apply(at);
        let tip = inverse.apply([at[0] + u[0], at[1] + u[1]]);
        let v = sub(tip, p);
        let ring: Vec<Point> = face
            .ring
            .iter()
            .map(|w| parts.vertices[w.index()])
            .collect();
        let n = ring.len();
        let off = |q: Point| cross(v, sub(q, p));
        let ahead = |q: Point| dot(v, sub(q, p));
        // Through a ring vertex ahead, or across a side.
        let mut out: Option<(Option<usize>, usize, f64)> = None;
        for i in 0..n {
            let (a, b) = (ring[i], ring[(i + 1) % n]);
            let d = off(a);
            if ahead(a) > MIN_FEATURE / 2.0 {
                match Band::of(d) {
                    Band::On => {
                        out = Some((Some(i), i, 0.0));
                        break;
                    }
                    Band::Near => {
                        return Err(Refused::from(FoldRefusal::NearMiss {
                            vertex: face.ring[i],
                            distance: d.abs(),
                            cause: NearMissCause::Band,
                        }));
                    }
                    _ => {}
                }
            }
            let e = off(b);
            if (d > TOL && e < -TOL || d < -TOL && e > TOL) && out.is_none() {
                let s = d / (d - e);
                let x = [a[0] + s * (b[0] - a[0]), a[1] + s * (b[1] - a[1])];
                if ahead(x) > MIN_FEATURE / 2.0 {
                    out = Some((None, i, s));
                }
            }
        }
        let Some((through, i, s)) = out else {
            return Err(FoldRefusal::FanCenter {
                faces: vec![face.id],
            }
            .into());
        };
        let exit = match through {
            Some(i) => ring[i],
            None => {
                let (a, b) = (ring[i], ring[(i + 1) % n]);
                [a[0] + s * (b[0] - a[0]), a[1] + s * (b[1] - a[1])]
            }
        };
        let end = t.apply(exit);
        if through.is_some() {
            if let Some(g) = next_face(end, &faces) {
                faces.push(g);
                f = g;
                at = end;
                continue;
            }
            return Ok(RayRun { faces, end });
        }
        let k = topology.face_creases[f][i];
        match parts.creases[k].kind {
            CreaseKind::Border => return Ok(RayRun { faces, end }),
            CreaseKind::Folded(_) => {
                let across = topology.across(k, f).map_or(face.id, |g| parts.faces[g].id);
                return Err(FoldRefusal::FanRayBlocked {
                    faces: vec![across],
                }
                .into());
            }
            CreaseKind::Flat(_) => {
                let g = topology
                    .across(k, f)
                    .ok_or_else(|| internal("a flat crease with one face"))?;
                if faces.contains(&g) {
                    return Err(internal("a swivel crease runs back into its paper"));
                }
                faces.push(g);
                f = g;
                at = end;
            }
        }
    }
    Err(internal("a swivel crease runs on without end"))
}

/// A unit direction halfway between two at less than a half turn.
fn halfway(a: Point, b: Point) -> Option<Point> {
    unit([a[0] + b[0], a[1] + b[1]])
}

pub(super) fn compile(
    state: &State,
    built: &FoldFan,
    edge_layer: usize,
    direction: Direction,
    kind: SwivelKind,
) -> Result<FoldCompiled, Refused> {
    let [a, b] = built.faces;
    let other_layer = if edge_layer == a { b } else { a };
    let v = built.vertex;
    let s_edge = ray_run(state, edge_layer, v, built.swivel)?;
    let s_other = ray_run(state, other_layer, v, built.counter)?;
    let s_second = ray_run(state, other_layer, v, built.second)?;
    let nf = state.faces().len();
    let mask = |runs: &[&RayRun]| {
        let mut mask = vec![false; nf];
        for run in runs {
            for &f in &run.faces {
                mask[f] = true;
            }
        }
        mask
    };
    let s_line = built.swivel_line()?;
    let counter_line = built.counter_line()?;
    let second_line = built.second_line()?;
    // Coincident rays are one cut through both layers (the historical
    // edge-to-target construction). Scoring the same axis twice would
    // incorrectly try to split its already-created boundary again.
    let mut cuts = if cross(built.swivel, built.counter).abs() < 1e-12
        && dot(built.swivel, built.counter) > 0.0
    {
        vec![Cut {
            axis: Axis::new(&s_line, Side::Positive),
            faces: mask(&[&s_edge, &s_other]),
        }]
    } else {
        vec![
            Cut {
                axis: Axis::new(&s_line, Side::Positive),
                faces: mask(&[&s_edge]),
            },
            Cut {
                axis: Axis::new(&counter_line, Side::Positive),
                faces: mask(&[&s_other]),
            },
        ]
    };
    cuts.push(Cut {
        axis: Axis::new(&second_line, Side::Positive),
        faces: mask(&[&s_second]),
    });
    let scoring = score_cuts(state, &cuts)?;

    // The folded edge's half that opens: the pieces of the run's creases
    // past the vertex on the edge's side.
    let geometry = state.geometry();
    let topology = state.topology();
    let parent_sheet = state.vertices();
    let on_segment = |p: Point, a: Point, b: Point| {
        let length = (b[0] - a[0]).hypot(b[1] - a[1]);
        let t = dot(sub(p, a), sub(b, a)) / length;
        (cross(sub(b, a), sub(p, a)) / length).abs() <= TOL && t >= -TOL && t <= length + TOL
    };
    let opened: Vec<[VertexId; 2]> = scoring
        .creases
        .iter()
        .filter(|c| {
            let [p, q] = c.vertices.map(|w| scoring.vertices[w.index()]);
            built.run.iter().any(|&k| {
                let [ka, kb] = state.creases()[k].vertices.map(|w| parent_sheet[w.index()]);
                if !on_segment(p, ka, kb) || !on_segment(q, ka, kb) {
                    return false;
                }
                let Some(&g) = topology.crease_faces[k].first() else {
                    return false;
                };
                let mid = geometry.isometries[g].apply([(p[0] + q[0]) / 2.0, (p[1] + q[1]) / 2.0]);
                dot(sub(mid, v), built.opens) > MIN_FEATURE / 2.0
            })
        })
        .map(|c| c.vertices)
        .collect();
    let created: Vec<[VertexId; 2]> = scoring
        .creases
        .iter()
        .filter(|c| scoring.created.binary_search(&c.id).is_ok())
        .map(|c| c.vertices)
        .collect();
    let key = |e: [VertexId; 2]| (e[0].0.min(e[1].0), e[0].0.max(e[1].0));
    let mut cut: Vec<(u32, u32)> = created.iter().chain(&opened).map(|&e| key(e)).collect();
    // A ray may reuse a flat crease instead of splitting a face. It is a
    // boundary between moving wedges just as a newly scored crease is.
    for (run, direction) in [
        (&s_edge, built.swivel),
        (&s_other, built.counter),
        (&s_second, built.second),
    ] {
        for (p, face) in scoring.faces.iter().enumerate() {
            let old = scoring.old[p];
            if !run.faces.contains(&old) {
                continue;
            }
            let transform = geometry.isometries[old];
            for i in 0..face.ring.len() {
                let edge = [face.ring[i], face.ring[(i + 1) % face.ring.len()]];
                if edge.iter().all(|w| {
                    let at = transform.apply(scoring.vertices[w.index()]);
                    let rel = sub(at, v);
                    cross(direction, rel).abs() <= TOL
                        && dot(direction, rel) >= -TOL
                        && dot(direction, rel) <= dot(direction, sub(run.end, v)) + TOL
                }) {
                    cut.push(key(edge));
                }
            }
        }
    }

    // Paper joined across every crease but the new ones and the opened half.
    let count = scoring.faces.len();
    let mut sides: HashMap<(u32, u32), Vec<usize>> = HashMap::new();
    for (p, face) in scoring.faces.iter().enumerate() {
        let m = face.ring.len();
        for i in 0..m {
            sides
                .entry(key([face.ring[i], face.ring[(i + 1) % m]]))
                .or_default()
                .push(p);
        }
    }
    let mut parent: Vec<usize> = (0..count).collect();
    fn root(parent: &mut [usize], mut a: usize) -> usize {
        while parent[a] != a {
            parent[a] = parent[parent[a]];
            a = parent[a];
        }
        a
    }
    for (side, faces) in &sides {
        if let [p, q] = faces[..]
            && !cut.contains(side)
        {
            let (rp, rq) = (root(&mut parent, p), root(&mut parent, q));
            parent[rp.max(rq)] = rp.min(rq);
        }
    }
    let component: Vec<usize> = (0..count).map(|p| root(&mut parent, p)).collect();

    // Each wedge's piece at the vertex, by a point just inside it.
    let piece = |layer: usize, from: Point, to: Point| -> Result<usize, Refused> {
        let mid = halfway(from, to).ok_or_else(|| internal("a swivel wedge has no middle"))?;
        let step = MIN_FEATURE / 4.0;
        let q = [v[0] + step * mid[0], v[1] + step * mid[1]];
        let sheet = geometry.isometries[layer].inverse().apply(q);
        let region = flat_region(state, layer);
        (0..count)
            .find(|&p| {
                region[scoring.old[p]] && convex::contains_point(&scoring.polygon(p), sheet, -TOL)
            })
            .ok_or_else(|| internal("a swivel wedge has no paper at the vertex"))
    };
    let (opens, stays, swivel, second) = (built.opens, built.stays, built.swivel, built.second);
    let staying = component[piece(edge_layer, swivel, stays)?];
    let wedges = [
        (
            SwivelWedge::Near,
            component[piece(edge_layer, opens, swivel)?],
        ),
        (
            SwivelWedge::Turn,
            component[piece(other_layer, opens, built.counter)?],
        ),
        (
            SwivelWedge::Beyond,
            component[piece(other_layer, built.counter, second)?],
        ),
    ];
    let beyond_stays = component[piece(other_layer, second, stays)?];
    let ids = |set: Vec<usize>| -> Vec<FaceId> {
        let mut ids: Vec<FaceId> = set
            .into_iter()
            .map(|p| state.faces()[scoring.old[p]].id)
            .collect();
        ids.sort_unstable();
        ids.dedup();
        ids
    };
    // Paper joined to two wedges holds them together: no fold.
    let held = |c: usize| -> Refused {
        let cut_layers = [&s_edge, &s_other, &s_second];
        let holding: Vec<usize> = (0..count)
            .filter(|&p| {
                component[p] == c && !cut_layers.iter().any(|r| r.faces.contains(&scoring.old[p]))
            })
            .collect();
        let all: Vec<usize> = (0..count).filter(|&p| component[p] == c).collect();
        FoldRefusal::FanRayBlocked {
            faces: ids(if holding.is_empty() { all } else { holding }),
        }
        .into()
    };
    if beyond_stays != staying {
        return Err(internal("the paper that stays is in two parts"));
    }
    for (i, &(_, c)) in wedges.iter().enumerate() {
        if c == staying {
            return Err(held(c));
        }
        if wedges[..i].iter().any(|&(_, d)| d == c) {
            return Err(held(c));
        }
    }
    let mut block_of: Vec<Option<usize>> = (0..count)
        .map(|p| wedges.iter().position(|&(_, c)| c == component[p]))
        .collect();
    let opened_line = built.fold_line;
    let turns = vec![
        vec![(1, s_line)],
        vec![(0, opened_line), (1, s_line)],
        vec![(1, second_line)],
    ];
    let wedge_names: Vec<SwivelWedge> = wedges.iter().map(|&(w, _)| w).collect();
    let mut kept = Vec::new();
    for (b, &w) in wedge_names.iter().enumerate() {
        if block_of.contains(&Some(b)) {
            kept.push(w);
        }
    }
    let turns = drop_empty(&mut block_of, turns);
    // Direction places the swinging wedge against its own body, and the
    // strip against the body across its hinge. It does not place either
    // against an unrelated flap that it reaches over. Those relations are
    // choices for completion, while the pipeline still carries every pair
    // between stationary faces. The turn wedge follows the strip's side;
    // material continuity determines their order against each other.
    let toward = direction == Direction::Valley;
    // A flat precrease subdivides a material layer without changing which
    // body the hinge belongs to. Include its whole flat-connected region.
    let body = |layer| {
        flat_region(state, layer)
            .into_iter()
            .enumerate()
            .filter_map(|(face, belongs)| belongs.then_some(face))
            .collect::<Vec<_>>()
    };
    let edge_body = body(edge_layer);
    let other_body = body(other_layer);
    let against = Some(
        kept.iter()
            .enumerate()
            .map(|(block, &wedge)| match wedge {
                SwivelWedge::Near => Against {
                    block,
                    faces: edge_body.clone(),
                    above: toward,
                },
                SwivelWedge::Turn | SwivelWedge::Beyond => Against {
                    block,
                    faces: other_body.clone(),
                    above: if kind == SwivelKind::Open {
                        toward
                    } else {
                        !toward
                    },
                },
            })
            .collect(),
    );
    Ok(FoldCompiled {
        compiled: Compiled {
            kind: VertexFoldKind::Swivel,
            scoring,
            block_of,
            turns,
            vertices: vec![v],
            direction,
            extra: Vec::new(),
            against,
        },
        wedges: kept,
        edge_layer,
        other_layer,
        ends: [s_edge.end, s_other.end, s_second.end],
        reach: None,
    })
}

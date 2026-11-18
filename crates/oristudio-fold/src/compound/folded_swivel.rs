//! Flat swivel geometry shared by the swivel by its edge onto a line and the
//! swivel by its valley and mountain.
//!
//! # Two layers, or through the stack
//!
//! The swivel's rays start in the folded edge's two layers: `s` in the edge's
//! layer, `c` and `b` in the other. Round the vertex they split the half-plane
//! the paper lies in into sectors, and each layer moves by sector: the edge's
//! layer by `R_s` between the half of the folded edge that opens and `s` (the
//! near wedge), the other layer by `R_s ∘ R_h` up to `c` (the turning wedge)
//! and by `R_b` from `c` to `b` (the wedge beyond); the rest stays. Those are
//! the swivel's four motions.
//!
//! **Two layers first.** Each ray creases its own layer from the vertex to
//! the paper's edge or to a fold, and every other face moves with the paper
//! it is joined to ([`two_layers`]). Where that holds no two wedges together,
//! that is the swivel. The same reading takes two swivels made together
//! where they share a crease ([`two_layers_of`], `super::swivel_pair`).
//!
//! **Through the stack.** Where paper beyond the two layers joins two wedges
//! (or a wedge and the paper that stays), every face moves by one of the
//! four motions ([`assign`]): rigidly, as a flap carried by what it is hinged
//! to, or — where it lies across a ray — creased along that ray and moved by
//! sector like one of the two layers, the edge's (`s`) or the other's (`c`,
//! `b`), one group per sheet of paper. That is a tip folded behind the edge's
//! layer and hinged to it, a corner folded back where a ray meets a fold, a
//! layer covering the other one, a fold nested in the folded edge that opens
//! with it. Each face takes the first of those that agrees with its
//! neighbours: across every crease the two faces move alike (the crease keeps
//! its fold), or, where the crease lies along a ray of their group or the
//! opening half of the folded edge, by that line's reflection apart (it folds
//! or unfolds there) — material continuity, nothing else. What lands is still
//! checked like every compound fold (`super::pieces`), and each order a
//! choice offers is landed before it is offered ([`FoldCompiled::land`]).
//! A motion whose layers cannot be ordered flat is refused for want of an
//! order (`no_order`); where there is no such motion, or anything else stops
//! the stack reading, the swivel is refused as the two-layer reading was:
//! paper holds two wedges (`fan_ray_blocked`, naming that paper).
use crate::complete::CompletionLimits;
use crate::compound::motion::reflection;
use crate::compound::pieces::{Cut, Scoring, score_cuts};
use crate::compound::swivel::{SwivelKind, SwivelWedge, dot, internal, sub};
use crate::compound::vertex::{
    Compiled, VertexChoices, VertexFoldKind, VertexOutcome, angle_between, cross, drop_empty, unit,
};
use crate::compound::{Against, CompoundRefused};
use crate::fold::line::Axis;
use crate::isometry::Isometry;
use crate::numerics::{Band, MIN_FEATURE, TOL};
use crate::pattern::{CreaseKind, FaceId, VertexId};
use crate::refusal::{FoldRefusal, NearMissCause, Refused, Side};
use crate::state::State;
use crate::view::Direction;
use oristudio_geometry::{Line, convex};
use std::collections::{HashMap, VecDeque};
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
    /// The rays by index ([`S`], [`C`], [`B`]).
    fn rays(&self) -> [Point; 3] {
        [self.swivel, self.counter, self.second]
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
    /// Whether it folds through the stack rather than on its two layers.
    pub(super) stacked: bool,
}

impl FoldCompiled {
    /// Land it ([`Compiled::land`]); through the stack, each order a choice
    /// offers is landed before it is offered.
    pub(super) fn land(
        &self,
        state: &State,
        choices: &VertexChoices,
        limits: &CompletionLimits,
        other: impl FnOnce() -> Option<Compiled>,
    ) -> Result<VertexOutcome, CompoundRefused> {
        self.compiled
            .land_checked(state, choices, limits, other, self.stacked)
    }
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
/// raw edge, a boundary vertex or a fold. Internal flat-precrease vertices
/// continue into the same material layer. At a fold the layer ends, but the
/// crease does not: the paper folded back there lies along the same model
/// ray, and [`compile`] creases it too when it holds the wedges. A vertex it
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
            CreaseKind::Border | CreaseKind::Folded(_) => return Ok(RayRun { faces, end }),
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

/// The paper scored along the rays, and per scored face the wedge it moves
/// with (none for paper that stays).
type Blocks = (Scoring, Vec<Option<usize>>);

/// The rays by index: the edge layer's swivel crease `s`, the other layer's
/// `c` (its counter crease) and its hinge `b` (its second); and the half of
/// the folded edge that opens, `h`.
const S: usize = 0;
const C: usize = 1;
const B: usize = 2;
const H: usize = 3;
/// How paper moves round the vertex, by index: as one of the three wedges
/// (near, turn, beyond, the order of [`SwivelWedge`]'s blocks), or not.
const STAYS: usize = 3;

/// The motion one reflection across `line` from the motion `x`, where a
/// crease along it folds or unfolds: across `s` the near wedge's and the
/// paper that stays, across `c` the turning wedge's and the one beyond's,
/// across `b` the one beyond's and the paper that stays, across `h` the
/// near and the turning wedges'.
fn partner(x: usize, line: usize) -> Option<usize> {
    match (line, x) {
        (S, 0) => Some(STAYS),
        (S, STAYS) => Some(0),
        (C, 1) => Some(2),
        (C, 2) => Some(1),
        (B, 2) => Some(STAYS),
        (B, STAYS) => Some(2),
        (H, 0) => Some(1),
        (H, 1) => Some(0),
        _ => None,
    }
}

/// How one face moves.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode {
    /// All of it by one motion (by index).
    Rigid(usize),
    /// By sector like the edge's layer, creased along `s` where it crosses.
    Edge,
    /// By sector like the other layer, creased along `c` and `b`.
    Other,
}

/// The sectors round the vertex: angles from the half of the folded edge
/// that opens, toward the paper.
struct Sectors {
    vertex: Point,
    opens: Point,
    /// `+1` or `−1`: the turn from `opens` toward the paper.
    sign: f64,
    /// The angles of `s`, `c` and `b`.
    angles: [f64; 3],
}

impl Sectors {
    fn of(built: &FoldFan) -> Sectors {
        let sign = angle_between(built.opens, built.second).signum();
        Sectors {
            vertex: built.vertex,
            opens: built.opens,
            sign,
            angles: built
                .rays()
                .map(|u| (sign * angle_between(built.opens, u)).abs()),
        }
    }

    /// How a face in `mode` moves at the model point `p`.
    fn class(&self, mode: Mode, p: Point) -> usize {
        let theta = self.sign * angle_between(self.opens, sub(p, self.vertex));
        let inside = |hi: f64| theta > 0.0 && theta < hi;
        match mode {
            Mode::Rigid(x) => x,
            Mode::Edge if inside(self.angles[S]) => 0,
            Mode::Other if inside(self.angles[C]) => 1,
            Mode::Other if inside(self.angles[B]) => 2,
            Mode::Edge | Mode::Other => STAYS,
        }
    }
}

/// Where the line through `v` along the unit `u` crosses the inside of the
/// convex `ring`, or runs along one of its sides (a crease already there,
/// which the ray reuses), as distances along `u` from `v`; none when it only
/// touches it at a corner or misses it.
fn crossing(ring: &[Point], v: Point, u: Point) -> Option<[f64; 2]> {
    let n = ring.len();
    let off: Vec<f64> = ring.iter().map(|&p| cross(u, sub(p, v))).collect();
    let along = |p: Point| dot(u, sub(p, v));
    if !(off.iter().any(|&d| d > TOL) && off.iter().any(|&d| d < -TOL)) {
        let side = (0..n).find(|&i| off[i].abs() <= TOL && off[(i + 1) % n].abs() <= TOL)?;
        let [a, b] = [along(ring[side]), along(ring[(side + 1) % n])];
        return ((a - b).abs() > TOL).then_some([a.min(b), a.max(b)]);
    }
    let mut lo = f64::INFINITY;
    let mut hi = f64::NEG_INFINITY;
    for i in 0..n {
        let (a, b) = (ring[i], ring[(i + 1) % n]);
        let (da, db) = (off[i], off[(i + 1) % n]);
        let mut take = |p: Point| {
            let t = along(p);
            lo = lo.min(t);
            hi = hi.max(t);
        };
        if da.abs() <= TOL {
            take(a);
        }
        if da > TOL && db < -TOL || da < -TOL && db > TOL {
            let s = da / (da - db);
            take([a[0] + s * (b[0] - a[0]), a[1] + s * (b[1] - a[1])]);
        }
    }
    (hi - lo > TOL).then_some([lo, hi])
}

/// Whether the ray from `v` along `u` crosses the convex `ring` ahead of `v`
/// only: a crease from the vertex can run through it.
fn crossed_ahead(ring: &[Point], v: Point, u: Point) -> bool {
    crossing(ring, v, u).is_some_and(|[lo, hi]| lo >= -TOL && hi > MIN_FEATURE / 2.0)
}

/// One place along a crease where two faces must move alike, or one
/// reflection apart across `line`.
struct Probe {
    /// Points just inside each of the crease's two faces.
    at: [Point; 2],
    /// The rays and half folded edge the crease runs along there (two rays
    /// can coincide).
    lines: Vec<usize>,
    /// Whether the crease is one of the folded edge's own.
    edge: bool,
}

/// The probes of crease `k`: one per stretch of it between the places it
/// crosses a ray's line, each just inside both faces.
fn probes(state: &State, built: &FoldFan, k: usize, faces: [usize; 2]) -> Vec<Probe> {
    let v = built.vertex;
    let images = &state.geometry().images;
    let [a, b] = state.creases()[k]
        .vertices
        .map(|w| state.geometry().vertex_images[w.index()]);
    let d = sub(b, a);
    let length = d[0].hypot(d[1]);
    if length <= TOL {
        return Vec::new();
    }
    let n = [-d[1] / length, d[0] / length];
    let lines = [built.swivel, built.counter, built.second, built.opens];
    let mut cuts = vec![0.0, 1.0];
    for u in lines {
        let (da, db) = (cross(u, sub(a, v)), cross(u, sub(b, v)));
        if da * db < 0.0 {
            cuts.push(da / (da - db));
        }
    }
    cuts.sort_by(f64::total_cmp);
    let step = MIN_FEATURE / 4.0;
    let inward = |f: usize, m: Point| {
        let centre = convex::centroid(&images[f]).unwrap_or(m);
        let side = if dot(sub(centre, m), n) >= 0.0 {
            1.0
        } else {
            -1.0
        };
        [m[0] + side * step * n[0], m[1] + side * step * n[1]]
    };
    cuts.windows(2)
        .filter(|w| (w[1] - w[0]) * length > TOL)
        .map(|w| {
            let at = |t: f64| [a[0] + t * d[0], a[1] + t * d[1]];
            let (p, q) = (at(w[0]), at(w[1]));
            let m = at((w[0] + w[1]) / 2.0);
            let on = |u: Point| {
                [p, q].iter().all(|&x| {
                    let r = sub(x, v);
                    cross(u, r).abs() <= TOL && dot(u, r) >= -TOL
                })
            };
            Probe {
                at: faces.map(|f| inward(f, m)),
                lines: (0..4).filter(|&l| on(lines[l])).collect(),
                edge: built.run.contains(&k),
            }
        })
        .collect()
}

/// How every face moves (module docs): the edge's layer's run along `s` and
/// the other layer's along `c` and `b` by sector, and each other face the
/// first mode, in a breadth-first order from them, that agrees with every
/// neighbour it has been given, backtracking where none does. None when no
/// assignment is found; the faces where the search last failed.
fn assign(
    state: &State,
    built: &FoldFan,
    [edge_layer, other_layer]: [usize; 2],
    runs: &[RayRun; 3],
) -> Result<Vec<Mode>, Vec<usize>> {
    let nf = state.faces().len();
    let topology = state.topology();
    let images = &state.geometry().images;
    let sectors = Sectors::of(built);
    let v = built.vertex;
    let edge_region = flat_region(state, edge_layer);
    let other_region = flat_region(state, other_layer);
    // The faces each face meets, by the probes of the creases they share.
    let mut meets: Vec<Vec<(usize, Vec<Probe>)>> = (0..nf).map(|_| Vec::new()).collect();
    for k in 0..state.creases().len() {
        if let [f, g] = topology.crease_faces[k][..] {
            meets[f].push((g, probes(state, built, k, [f, g])));
            meets[g].push((f, probes(state, built, k, [g, f])));
        }
    }
    let mut fixed: Vec<Option<Mode>> = vec![None; nf];
    for &f in &runs[S].faces {
        fixed[f] = Some(Mode::Edge);
    }
    for &f in runs[C].faces.iter().chain(&runs[B].faces) {
        fixed[f] = Some(Mode::Other);
    }
    // Paper on the far side of the folded edge's line cannot move by sector.
    let beyond = |f: usize| {
        images[f].iter().any(|&p| {
            sectors.sign * angle_between(built.opens, sub(p, v)) < -TOL
                && cross(built.opens, sub(p, v)).abs() > TOL
        })
    };
    let rays = built.rays();
    let domain = |f: usize| -> Vec<Mode> {
        if let Some(mode) = fixed[f] {
            return vec![mode];
        }
        let mut modes: Vec<Mode> = (0..4).map(Mode::Rigid).collect();
        if !edge_region[f] && !other_region[f] && !beyond(f) {
            if crossed_ahead(&images[f], v, rays[S]) {
                modes.push(Mode::Edge);
            }
            if crossed_ahead(&images[f], v, rays[C]) || crossed_ahead(&images[f], v, rays[B]) {
                modes.push(Mode::Other);
            }
        }
        modes
    };
    // Breadth first from the runs.
    let mut order: Vec<usize> = Vec::new();
    let mut seen = vec![false; nf];
    let mut queue: VecDeque<usize> = (0..nf).filter(|&f| fixed[f].is_some()).collect();
    for &f in &queue {
        seen[f] = true;
    }
    while let Some(f) = queue.pop_front() {
        order.push(f);
        for &(g, _) in &meets[f] {
            if !seen[g] {
                seen[g] = true;
                queue.push_back(g);
            }
        }
    }
    order.extend((0..nf).filter(|&f| !seen[f]));
    // A flat region is one sheet of paper: it moves with one layer group.
    let mut region_of = vec![usize::MAX; nf];
    let mut regions: Vec<Vec<usize>> = Vec::new();
    for f in 0..nf {
        if region_of[f] == usize::MAX {
            let members: Vec<usize> = flat_region(state, f)
                .into_iter()
                .enumerate()
                .filter_map(|(g, belongs)| belongs.then_some(g))
                .collect();
            for &g in &members {
                region_of[g] = regions.len();
            }
            regions.push(members);
        }
    }
    // Whether face `f`, in `mode`, belongs to the edge's layer group (`edge`)
    // or the other's: by its sheet, or by a face of its sheet that moves by
    // sector.
    let in_group = |f: usize, mode: Mode, modes: &[Option<Mode>], edge: bool| {
        let (region, sector) = if edge {
            (&edge_region, Mode::Edge)
        } else {
            (&other_region, Mode::Other)
        };
        region[f]
            || mode == sector
            || regions[region_of[f]]
                .iter()
                .any(|&g| g != f && modes[g] == Some(sector))
    };
    // A crease along `s` folds only in paper of the edge's layer group, along
    // `c` or `b` only in the other's: never in a face of the other group.
    let creases_along = |line: usize, f: usize, mode: Mode, modes: &[Option<Mode>]| match line {
        S => !in_group(f, mode, modes, false),
        C | B => !in_group(f, mode, modes, true),
        _ => true,
    };
    // Between two faces of the two layers themselves a crease folds or
    // unfolds only where a ray's run reuses it, or along the folded edge's
    // own half that opens: as the two-layer reading has it.
    let in_layers = |f: usize| edge_region[f] || other_region[f];
    let toggles = |f: usize, g: usize, probe: &Probe, line: usize| {
        !(in_layers(f) && in_layers(g))
            || if line == H {
                probe.edge
            } else {
                fixed[f].is_some() || fixed[g].is_some()
            }
    };
    let agrees = |f: usize, mode: Mode, modes: &[Option<Mode>]| {
        let group_held = match mode {
            Mode::Edge => !in_group(f, mode, modes, false),
            Mode::Other => !in_group(f, mode, modes, true),
            Mode::Rigid(_) => true,
        };
        group_held
            && meets[f].iter().all(|(g, probes)| {
                let Some(other) = modes[*g] else {
                    return true;
                };
                probes.iter().all(|probe| {
                    let x = sectors.class(mode, probe.at[0]);
                    let y = sectors.class(other, probe.at[1]);
                    x == y
                        || probe.lines.iter().any(|&line| {
                            partner(x, line) == Some(y)
                                && toggles(f, *g, probe, line)
                                && creases_along(line, f, mode, modes)
                                && creases_along(line, *g, other, modes)
                        })
                })
            })
    };
    // Prefer moving with a neighbour, then creasing, then the rest.
    let preferred = |f: usize, modes: &[Option<Mode>]| -> Vec<Mode> {
        let mut seen: Vec<usize> = Vec::new();
        for (g, probes) in &meets[f] {
            if let Some(other) = modes[*g] {
                for probe in probes {
                    let y = sectors.class(other, probe.at[1]);
                    if !seen.contains(&y) {
                        seen.push(y);
                    }
                }
            }
        }
        let all = domain(f);
        let mut ordered: Vec<Mode> = seen
            .iter()
            .map(|&y| Mode::Rigid(y))
            .filter(|mode| all.contains(mode))
            .collect();
        for mode in [Mode::Edge, Mode::Other].into_iter().chain(all.clone()) {
            if all.contains(&mode) && !ordered.contains(&mode) {
                ordered.push(mode);
            }
        }
        ordered
    };
    let mut modes: Vec<Option<Mode>> = vec![None; nf];
    let mut choices: Vec<Vec<Mode>> = Vec::with_capacity(nf);
    let mut budget = 40 * nf + 1000;
    let mut deepest = 0;
    let mut failed: Vec<usize> = Vec::new();
    let mut i = 0;
    while i < order.len() {
        let f = order[i];
        if choices.len() == i {
            choices.push(preferred(f, &modes));
        }
        let next = loop {
            match choices[i].first().copied() {
                Some(mode) => {
                    choices[i].remove(0);
                    if agrees(f, mode, &modes) {
                        break Some(mode);
                    }
                }
                None => break None,
            }
        };
        match next {
            Some(mode) => {
                modes[f] = Some(mode);
                i += 1;
            }
            None => {
                if i >= deepest {
                    deepest = i;
                    failed = meets[f]
                        .iter()
                        .filter(|(g, _)| modes[*g].is_some())
                        .map(|(g, _)| *g)
                        .chain(std::iter::once(f))
                        .collect();
                }
                budget = budget.saturating_sub(1);
                if i == 0 || budget == 0 {
                    return Err(failed);
                }
                choices.truncate(i);
                i -= 1;
                modes[order[i]] = None;
            }
        }
    }
    Ok(modes
        .into_iter()
        .map(|m| m.unwrap_or(Mode::Rigid(STAYS)))
        .collect())
}

/// One swivel as the two-layer reading scores it: its fan, its folded
/// edge's two layers (the edge's, then the other), and its rays' runs.
pub(super) struct Layered<'a> {
    pub(super) fan: &'a FoldFan,
    pub(super) layers: [usize; 2],
    pub(super) runs: &'a [RayRun; 3],
}

/// The two-layer reading of several swivels made together: the scored
/// paper, each piece's block, and per block the swivels' wedges that move
/// as it, each `[swivel, wedge]` with the wedge by the index of
/// [`SwivelWedge`]'s blocks (near, turn, beyond).
pub(super) type Together = (Scoring, Vec<Option<usize>>, Vec<Vec<[usize; 2]>>);

/// The paper scored along the rays and each piece's block: the two-layer
/// reading, in which only the folded edge's two layers crease (each along
/// its own run) and every other face moves with the paper it is joined to
/// across every crease but the new ones, the ones a ray reuses and the half
/// of the folded edge that opens. None when paper joins two wedges, or a
/// wedge and the paper that stays: it holds them (module docs).
fn two_layers(
    state: &State,
    built: &FoldFan,
    layers: [usize; 2],
    runs: &[RayRun; 3],
) -> Result<Result<Blocks, Vec<FaceId>>, Refused> {
    let one = Layered {
        fan: built,
        layers,
        runs,
    };
    Ok(two_layers_of(state, &[one])?.map(|(scoring, block_of, _)| (scoring, block_of)))
}

/// A wedge's motion: near `R_s`, turn `R_s ∘ R_h`, beyond `R_b`.
fn wedge_motion(fan: &FoldFan, wedge: usize) -> Result<Isometry, Refused> {
    Ok(match wedge {
        0 => reflection(&fan.swivel_line()?),
        1 => reflection(&fan.swivel_line()?).after(&reflection(&fan.fold_line)),
        _ => reflection(&fan.second_line()?),
    })
}

/// [`two_layers`] for one or more swivels made together. Each swivel's rays
/// crease its own two layers; rays of two swivels along one line are one
/// crease, and the paper between them along it one wedge of both, which
/// moves as one where the two swivels move it alike. The paper that stays is
/// one part. None when paper joins two wedges that move differently, or a
/// wedge and the paper that stays: it holds them.
pub(super) fn two_layers_of(
    state: &State,
    swivels: &[Layered],
) -> Result<Result<Together, Vec<FaceId>>, Refused> {
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
    let mut cuts: Vec<Cut> = Vec::new();
    // Per cut, its line and the swivel that made it.
    let mut made: Vec<(Line, usize)> = Vec::new();
    for (i, one) in swivels.iter().enumerate() {
        let built = one.fan;
        let rays = built.rays();
        let s_line = built.swivel_line()?;
        let counter_line = built.counter_line()?;
        let second_line = built.second_line()?;
        let [s_edge, s_other, s_second] = one.runs;
        // Coincident rays are one cut through both layers (the historical
        // edge-to-target construction). Scoring the same axis twice would
        // incorrectly try to split its already-created boundary again.
        let own = if cross(rays[S], rays[C]).abs() < 1e-12 && dot(rays[S], rays[C]) > 0.0 {
            vec![
                (s_line, mask(&[s_edge, s_other])),
                (second_line, mask(&[s_second])),
            ]
        } else {
            vec![
                (s_line, mask(&[s_edge])),
                (counter_line, mask(&[s_other])),
                (second_line, mask(&[s_second])),
            ]
        };
        for (line, faces) in own {
            // So is a ray along another swivel's.
            let shared = made
                .iter()
                .position(|(other, by)| *by != i && other.approx_eq(&line));
            match shared {
                Some(k) => {
                    for (f, crossed) in faces.into_iter().enumerate() {
                        cuts[k].faces[f] |= crossed;
                    }
                }
                None => {
                    cuts.push(Cut {
                        axis: Axis::new(&line, Side::Positive),
                        faces,
                    });
                    made.push((line, i));
                }
            }
        }
    }
    let scoring = score_cuts(state, &cuts)?;

    // Each folded edge's half that opens: the pieces of its run's creases
    // past its vertex on the edge's side.
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
            swivels.iter().any(|one| {
                let built = one.fan;
                built.run.iter().any(|&k| {
                    let [ka, kb] = state.creases()[k].vertices.map(|w| parent_sheet[w.index()]);
                    if !on_segment(p, ka, kb) || !on_segment(q, ka, kb) {
                        return false;
                    }
                    let Some(&g) = topology.crease_faces[k].first() else {
                        return false;
                    };
                    let mid =
                        geometry.isometries[g].apply([(p[0] + q[0]) / 2.0, (p[1] + q[1]) / 2.0]);
                    dot(sub(mid, built.vertex), built.opens) > MIN_FEATURE / 2.0
                })
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
    for one in swivels {
        let v = one.fan.vertex;
        for (run, direction) in one.runs.iter().zip(one.fan.rays()) {
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

    // Each wedge's piece at its vertex, by a point just inside it.
    let piece = |v: Point, layer: usize, from: Point, to: Point| -> Result<usize, Refused> {
        let mid = unit([from[0] + to[0], from[1] + to[1]])
            .ok_or_else(|| internal("a swivel wedge has no middle"))?;
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
    // Per swivel, the part that stays at its vertex.
    let mut stays_at: Vec<usize> = Vec::new();
    let mut wedges: Vec<([usize; 2], usize, Isometry)> = Vec::new();
    for (i, one) in swivels.iter().enumerate() {
        let built = one.fan;
        let [edge_layer, other_layer] = one.layers;
        let v = built.vertex;
        let (opens, stays, swivel, second) = (built.opens, built.stays, built.swivel, built.second);
        let stays_here = component[piece(v, edge_layer, swivel, stays)?];
        let at = [
            piece(v, edge_layer, opens, swivel)?,
            piece(v, other_layer, opens, built.counter)?,
            piece(v, other_layer, built.counter, second)?,
        ];
        let beyond_stays = component[piece(v, other_layer, second, stays)?];
        if beyond_stays != stays_here {
            return Err(internal("the paper that stays is in two parts"));
        }
        stays_at.push(stays_here);
        for (w, p) in at.into_iter().enumerate() {
            wedges.push(([i, w], component[p], wedge_motion(built, w)?));
        }
    }
    let staying = *stays_at
        .first()
        .ok_or_else(|| internal("a swivel reading with no swivel"))?;
    // Paper joined to two wedges holds them together: named by the faces in
    // that part no ray creases, or all of it.
    let held = |c: usize| -> Vec<FaceId> {
        let creased = |f: usize| {
            swivels
                .iter()
                .any(|one| one.runs.iter().any(|r| r.faces.contains(&f)))
        };
        let part: Vec<usize> = (0..count).filter(|&p| component[p] == c).collect();
        let holding: Vec<usize> = part
            .iter()
            .copied()
            .filter(|&p| !creased(scoring.old[p]))
            .collect();
        let mut ids: Vec<FaceId> = (if holding.is_empty() { part } else { holding })
            .into_iter()
            .map(|p| state.faces()[scoring.old[p]].id)
            .collect();
        ids.sort_unstable();
        ids.dedup();
        ids
    };
    // Where two swivels' creases part the paper that stays at one vertex
    // from the paper that stays at the other, that paper is held between them.
    if let Some(&apart) = stays_at.iter().find(|&&c| c != staying) {
        return Ok(Err(held(apart)));
    }
    // Two wedges in one part move as one only where their motions are one:
    // a crease two swivels share, and the paper between them along it.
    let alike = |m: &Isometry, n: &Isometry| m.0.iter().zip(n.0).all(|(a, b)| (a - b).abs() <= TOL);
    let mut parts: Vec<usize> = Vec::new();
    let mut members: Vec<Vec<[usize; 2]>> = Vec::new();
    for (k, (wedge, c, motion)) in wedges.iter().enumerate() {
        let apart = wedges[..k]
            .iter()
            .any(|(_, d, other)| d == c && !alike(motion, other));
        if *c == staying || apart {
            return Ok(Err(held(*c)));
        }
        match parts.iter().position(|d| d == c) {
            Some(b) => members[b].push(*wedge),
            None => {
                parts.push(*c);
                members.push(vec![*wedge]);
            }
        }
    }
    let block_of = (0..count)
        .map(|p| parts.iter().position(|&c| c == component[p]))
        .collect();
    Ok(Ok((scoring, block_of, members)))
}

/// The swivel `built` compiled with `edge_layer` as the edge's layer: on its
/// two layers, or through the stack when paper holds them (module docs).
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
    let runs = [
        ray_run(state, edge_layer, v, built.swivel)?,
        ray_run(state, other_layer, v, built.counter)?,
        ray_run(state, other_layer, v, built.second)?,
    ];
    let layers = [edge_layer, other_layer];
    let ((scoring, block_of), stacked) = match two_layers(state, built, layers, &runs)? {
        Ok(blocks) => (blocks, false),
        // Through the stack, or refused as the two-layer reading is: what
        // holds its wedges, whatever stops the stack reading.
        Err(held) => match through_the_stack(state, built, layers, &runs) {
            Ok(blocks) => (blocks, true),
            Err(_) => return Err(FoldRefusal::FanRayBlocked { faces: held }.into()),
        },
    };
    let mut compiled = finish(
        state, built, layers, direction, kind, &runs, scoring, block_of,
    )?;
    compiled.stacked = stacked;
    Ok(compiled)
}

/// The paper scored along the rays through every face that moves by sector,
/// and each piece's block (module docs): what lands when the two-layer
/// reading is held.
fn through_the_stack(
    state: &State,
    built: &FoldFan,
    [edge_layer, other_layer]: [usize; 2],
    runs: &[RayRun; 3],
) -> Result<Blocks, Refused> {
    let v = built.vertex;
    let modes = assign(state, built, [edge_layer, other_layer], runs).map_err(|failed| {
        let mut faces: Vec<FaceId> = failed.into_iter().map(|f| state.faces()[f].id).collect();
        faces.sort_unstable();
        faces.dedup();
        Refused::from(FoldRefusal::FanRayBlocked { faces })
    })?;
    // Each ray creases its own layer's run and every other face that moves
    // by sector with that layer and lies across it.
    let images = &state.geometry().images;
    let rays = built.rays();
    let nf = state.faces().len();
    let mut cut_faces = [vec![false; nf], vec![false; nf], vec![false; nf]];
    for (r, run) in runs.iter().enumerate() {
        for &f in &run.faces {
            cut_faces[r][f] = true;
        }
    }
    for f in 0..nf {
        let family: &[usize] = match modes[f] {
            Mode::Edge => &[S],
            Mode::Other => &[C, B],
            Mode::Rigid(_) => &[],
        };
        // A face the ray only runs along the side of moves whole.
        for &r in family {
            if crossed_ahead(&images[f], v, rays[r])
                && images[f].iter().any(|&p| cross(rays[r], sub(p, v)) > TOL)
                && images[f].iter().any(|&p| cross(rays[r], sub(p, v)) < -TOL)
            {
                cut_faces[r][f] = true;
            }
        }
    }
    let s_line = built.swivel_line()?;
    let counter_line = built.counter_line()?;
    let second_line = built.second_line()?;
    let [s_faces, c_faces, b_faces] = cut_faces;
    // Coincident rays are one cut through both layers (the historical
    // edge-to-target construction). Scoring the same axis twice would
    // incorrectly try to split its already-created boundary again.
    let mut cuts = if cross(rays[S], rays[C]).abs() < 1e-12 && dot(rays[S], rays[C]) > 0.0 {
        vec![Cut {
            axis: Axis::new(&s_line, Side::Positive),
            faces: s_faces
                .iter()
                .zip(&c_faces)
                .map(|(a, b)| *a || *b)
                .collect(),
        }]
    } else {
        vec![
            Cut {
                axis: Axis::new(&s_line, Side::Positive),
                faces: s_faces,
            },
            Cut {
                axis: Axis::new(&counter_line, Side::Positive),
                faces: c_faces,
            },
        ]
    };
    cuts.push(Cut {
        axis: Axis::new(&second_line, Side::Positive),
        faces: b_faces,
    });
    let scoring: Scoring = score_cuts(state, &cuts)?;
    // Each piece moves as its face's mode says where it lies.
    let sectors = Sectors::of(built);
    let geometry = state.geometry();
    let block_of: Vec<Option<usize>> = (0..scoring.faces.len())
        .map(|p| {
            let old = scoring.old[p];
            let centre = convex::centroid(&scoring.polygon(p))
                .map(|c| geometry.isometries[old].apply(c))
                .unwrap_or(v);
            let class = sectors.class(modes[old], centre);
            (class != STAYS).then_some(class)
        })
        .collect();
    Ok((scoring, block_of))
}

/// The compiled fold from its scored paper and blocks: each block's turns,
/// and the direction's placements.
#[allow(clippy::too_many_arguments)]
fn finish(
    state: &State,
    built: &FoldFan,
    [edge_layer, other_layer]: [usize; 2],
    direction: Direction,
    kind: SwivelKind,
    runs: &[RayRun; 3],
    scoring: Scoring,
    mut block_of: Vec<Option<usize>>,
) -> Result<FoldCompiled, Refused> {
    let s_line = built.swivel_line()?;
    let second_line = built.second_line()?;
    let opened_line = built.fold_line;
    let turns = vec![
        vec![(1, s_line)],
        vec![(0, opened_line), (1, s_line)],
        vec![(1, second_line)],
    ];
    let wedge_names = [SwivelWedge::Near, SwivelWedge::Turn, SwivelWedge::Beyond];
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
            vertices: vec![built.vertex],
            direction,
            extra: Vec::new(),
            against,
        },
        wedges: kept,
        edge_layer,
        other_layer,
        ends: [runs[S].end, runs[C].end, runs[B].end],
        reach: None,
        stacked: false,
    })
}

/// Several swivels' two-layer reading compiled as one fold: each block
/// turns as the wedges that move as it, and is placed as [`finish`] places
/// each of them, against its own swivel's body across its hinge.
pub(super) fn finish_together(
    state: &State,
    swivels: &[Layered],
    kinds: &[SwivelKind],
    direction: Direction,
    (scoring, block_of, members): Together,
) -> Result<Compiled, Refused> {
    let toward = direction == Direction::Valley;
    let body = |layer| {
        flat_region(state, layer)
            .into_iter()
            .enumerate()
            .filter_map(|(face, belongs)| belongs.then_some(face))
            .collect::<Vec<_>>()
    };
    let mut turns = Vec::with_capacity(members.len());
    let mut against: Vec<Against> = Vec::new();
    for (block, wedges) in members.iter().enumerate() {
        let &[first, w] = wedges
            .first()
            .ok_or_else(|| internal("a swivel block with no wedge"))?;
        let fan = swivels[first].fan;
        turns.push(match w {
            0 => vec![(1, fan.swivel_line()?)],
            1 => vec![(0, fan.fold_line), (1, fan.swivel_line()?)],
            _ => vec![(1, fan.second_line()?)],
        });
        for &[i, w] in wedges {
            let [edge_layer, other_layer] = swivels[i].layers;
            let placed = if w == 0 {
                Against {
                    block,
                    faces: body(edge_layer),
                    above: toward,
                }
            } else {
                Against {
                    block,
                    faces: body(other_layer),
                    above: if kinds[i] == SwivelKind::Open {
                        toward
                    } else {
                        !toward
                    },
                }
            };
            if !against.contains(&placed) {
                against.push(placed);
            }
        }
    }
    Ok(Compiled {
        kind: VertexFoldKind::Swivel,
        scoring,
        block_of,
        turns,
        vertices: swivels.iter().map(|one| one.fan.vertex).collect(),
        direction,
        extra: Vec::new(),
        against: Some(against),
    })
}

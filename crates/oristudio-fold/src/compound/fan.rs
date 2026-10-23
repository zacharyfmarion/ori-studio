//! A fan of creases from one point inside the paper (research §5.3): the
//! rabbit ear's and the swivel's, a vertex fold of four rays through chosen
//! layers.
//!
//! - **Rays.** Three are given (the rabbit ear's to a triangle's corners,
//!   the swivel's toward points) and the fourth *emerges*: a flat vertex of
//!   four creases satisfies Kawasaki's theorem, which leaves at most one
//!   direction per gap between the three, a few candidates in all
//!   ([`kawasaki`]). A step stores the one it took as a direction; replay
//!   takes the nearest candidate, as an axiom's root is replayed.
//! - **Scoring.** Each chosen layer is one face containing the center
//!   strictly. It gets a new vertex at the center and is cut into wedges, one
//!   per pair of neighbouring rays; a ray leaves it through a vertex of its
//!   own or across a crease, which gets one new vertex at its sheet
//!   parameter, shared with the face across when that face is cut too. A ray
//!   that crosses into paper that is not cut would leave a vertex inside that
//!   paper's side: refused, naming it.
//! - **Motions.** The paper joined to the stayer, across every crease but
//!   the new ones, stays: the wedge it holds is the *anchor*. Each other
//!   wedge turns across the rays between it and the anchor, nearest the
//!   anchor outermost, every layer alike; with four rays, Kawasaki's theorem
//!   is what makes the two ways round the far wedge agree, and the gate
//!   checks it. Paper joined to two wedges at once cannot fold: refused,
//!   naming it (research §5.3: an emergent ray into a hinge to paper that
//!   stays left a residual of 0.586).
//! - **Letters.** A rabbit ear's three bisectors take the direction's letter
//!   and its fourth crease the other (Lang; Beloch's `flatten-rabbit-ear-*`,
//!   "`--ear` is mountain" for a valley ear), and a swivel, a rabbit ear on
//!   free hinges (Beloch's `swivel-rabbit`), the same. The direction seed
//!   gives the two creases beside the anchor its letter in every layer, so
//!   the fourth must be one of the far wedge's two rays — the *ridge* the
//!   ear's flap rises along — and is seeded as it ([`FanFold::compile`]);
//!   the direction alone leaves either far ray to rise (research §5.3), and
//!   only the fourth's rising is a rabbit ear. A fourth crease beside the
//!   paper that stays, or one the angles between the rays will not let rise
//!   alone ([`folds_with_letters`]), is refused.

use std::collections::{BTreeMap, HashMap};
use std::f64::consts::{PI, TAU};

use oristudio_geometry::{Line, convex};
use serde::Serialize;

use crate::complete::CompletionLimits;
use crate::compound::CompoundRefused;
use crate::compound::pieces::Scoring;
use crate::compound::vertex::{
    Compiled, VertexChoices, VertexFoldKind, VertexOutcome, angle_between, cross, drop_empty,
    stack_toward, unit,
};
use crate::fold::{ActionKind, FoldActionGeometry, FoldAnalysis, Seed, Snap, Within};
use crate::numerics::{Band, MIN_FEATURE, TOL};
use crate::pattern::{Crease, CreaseKind, EdgeId, Face, FaceId, Letter, VertexId};
use crate::refusal::{Fix, FoldRefusal, NearMissCause, Refused, Side};
use crate::state::State;
use crate::view::Direction;

type Point = [f64; 2];

/// A fan: its center and its rays, unit directions in the parent's model
/// frame, counter-clockwise.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Fan {
    pub(crate) center: Point,
    pub(crate) rays: Vec<Point>,
}

impl Fan {
    /// A fan of `rays` (any order) at `center`; none unless every ray has a
    /// direction and no two coincide.
    pub(crate) fn new(center: Point, rays: &[Point]) -> Option<Fan> {
        let mut rays: Vec<(f64, Point)> = rays
            .iter()
            .map(|&r| unit(r).map(|u| (angle_of(u), u)))
            .collect::<Option<_>>()?;
        rays.sort_by(|a, b| a.0.total_cmp(&b.0));
        let n = rays.len();
        if n < 2 || (0..n).any(|i| sector(rays[i].0, rays[(i + 1) % n].0) <= 1e-9) {
            return None;
        }
        Some(Fan {
            center,
            rays: rays.into_iter().map(|(_, u)| u).collect(),
        })
    }

    /// Ray `i`'s full line, through the center.
    pub(crate) fn line(&self, i: usize) -> Option<Line> {
        Line::from_point_direction(self.center, self.rays[i % self.rays.len()])
    }

    /// The wedge a model point lies in: wedge `w` runs counter-clockwise
    /// from ray `w` to ray `w + 1`.
    pub(crate) fn wedge_of(&self, p: Point) -> usize {
        let a = angle_of([p[0] - self.center[0], p[1] - self.center[1]]);
        let n = self.rays.len();
        (0..n)
            .find(|&w| {
                let start = angle_of(self.rays[w]);
                sector(start, a) < sector(start, angle_of(self.rays[(w + 1) % n]))
            })
            .unwrap_or(0)
    }

    /// The angle of each wedge, from ray `w` to ray `w + 1`.
    pub(crate) fn sectors(&self) -> Vec<f64> {
        let n = self.rays.len();
        (0..n)
            .map(|i| sector(angle_of(self.rays[i]), angle_of(self.rays[(i + 1) % n])))
            .collect()
    }

    /// The largest angle between neighbouring rays.
    pub(crate) fn widest(&self) -> f64 {
        self.sectors().into_iter().fold(0.0, f64::max)
    }
}

/// Whether a flat vertex folds with `letters` (one per crease, `true` for
/// one letter and `false` for the other): crease `i` runs between sector
/// `i − 1` and sector `i`, as a [`Fan`]'s rays bound its wedges. Hull's crimp
/// reduction: a sector no wider than either neighbour whose two creases
/// differ crimps away, its neighbours merging, until two creases of one
/// letter are left; a vertex folds with the letters exactly when some
/// sequence of crimps gets there (the big-little-big lemma is why a sector
/// narrower than both neighbours between two creases alike never folds).
pub(crate) fn folds_with_letters(sectors: &[f64], letters: &[bool]) -> bool {
    let n = sectors.len();
    if n != letters.len() || n < 2 {
        return false;
    }
    if n == 2 {
        return letters[0] == letters[1] && (sectors[0] - sectors[1]).abs() <= 1e-9;
    }
    (0..n).any(|i| {
        let (before, after) = ((i + n - 1) % n, (i + 1) % n);
        let narrowest = sectors[i] <= sectors[before] + 1e-9 && sectors[i] <= sectors[after] + 1e-9;
        if !narrowest || letters[i] == letters[after] {
            return false;
        }
        // Crimp creases i and i + 1 away: sectors i − 1, i and i + 1 become
        // one, between creases i − 1 and i + 2.
        let merged = sectors[before] - sectors[i] + sectors[after];
        let mut rest_sectors = Vec::with_capacity(n - 2);
        let mut rest_letters = Vec::with_capacity(n - 2);
        // Creases i + 2 round to i − 1, each with the sector after it: the
        // last's is the merged one.
        for k in 2..n {
            let c = (i + k) % n;
            rest_letters.push(letters[c]);
            rest_sectors.push(if k == n - 1 { merged } else { sectors[c] });
        }
        folds_with_letters(&rest_sectors, &rest_letters)
    })
}

/// The direction's angle in [0, 2π).
pub(crate) fn angle_of(v: Point) -> f64 {
    v[1].atan2(v[0]).rem_euclid(TAU)
}

/// The counter-clockwise angle from `from` to `to`, in [0, 2π).
fn sector(from: f64, to: f64) -> f64 {
    (to - from).rem_euclid(TAU)
}

/// The directions a fourth ray can take at a vertex of three so the four
/// fold flat (Kawasaki's theorem: with the four angles x₀ < x₁ < x₂ < x₃ in
/// order round the vertex, −x₀ + x₁ − x₂ + x₃ = π, the alternate sectors
/// summing to a half turn): at most one strictly inside each gap between
/// the three, so three at most.
pub(crate) fn kawasaki(rays: &[Point; 3]) -> Vec<Point> {
    let mut angles: Vec<f64> = rays.iter().map(|&r| angle_of(r)).collect();
    angles.sort_by(f64::total_cmp);
    let mut out = Vec::new();
    for gap in 0..3 {
        let lo = angles[gap];
        let hi = if gap < 2 {
            angles[gap + 1]
        } else {
            angles[0] + TAU
        };
        // The four in order, the new one in slot `gap + 1`.
        let sign = |slot: usize| if slot.is_multiple_of(2) { -1.0 } else { 1.0 };
        let others: f64 = (0..3)
            .map(|k| {
                let slot = if k <= gap { k } else { k + 1 };
                sign(slot) * angles[k]
            })
            .sum();
        let t = (PI - others) / sign(gap + 1);
        if t > lo + 1e-9 && t < hi - 1e-9 {
            out.push([t.cos(), t.sin()]);
        }
    }
    out
}

/// A fan's scoring, and each scored face's wedge.
pub(crate) struct FanScoring {
    pub(crate) scoring: Scoring,
    /// Per scored face, the wedge its paper is in; none for a face not cut.
    pub(crate) wedge_of: Vec<Option<usize>>,
}

/// Cut the faces at the positions `layers` (each containing the center
/// strictly) along the fan's rays, as the parent's next step.
pub(crate) fn score_fan(state: &State, fan: &Fan, layers: &[usize]) -> Result<FanScoring, Refused> {
    let parts = state.parts();
    let topology = state.topology();
    let geometry = state.geometry();
    let nf = parts.faces.len();
    let step = state.step() + 1;
    let (mut next_face, mut next_crease) = state.next_ids();
    let mut cut_face = vec![false; nf];
    for &f in layers {
        cut_face[f] = true;
    }
    let mut vertices = parts.vertices.clone();

    // Each cut face's center vertex and, per ray, where the ray leaves it:
    // through a ring vertex, or across a crease at a sheet parameter.
    enum Exit {
        Vertex(usize),
        Crease(usize, f64),
    }
    let mut centers: Vec<VertexId> = Vec::with_capacity(layers.len());
    let mut exits: Vec<Vec<(usize, Exit)>> = Vec::with_capacity(layers.len());
    // One new vertex per (crease, ray), shared by the faces either side.
    let mut crossings: BTreeMap<(usize, usize), (f64, VertexId)> = BTreeMap::new();
    for &f in layers {
        let face = &parts.faces[f];
        let t = geometry.isometries[f];
        let inverse = t.inverse();
        let center = inverse.apply(fan.center);
        let ring: Vec<Point> = face
            .ring
            .iter()
            .map(|v| parts.vertices[v.index()])
            .collect();
        if !convex::contains_point(&ring, center, MIN_FEATURE / 2.0) {
            return Err(FoldRefusal::FanCenter {
                faces: vec![face.id],
            }
            .into());
        }
        centers.push(VertexId(vertices.len() as u32));
        vertices.push(center);
        let n = ring.len();
        let mut face_exits = Vec::with_capacity(fan.rays.len());
        for (j, &ray) in fan.rays.iter().enumerate() {
            // The ray in the face's sheet frame.
            let tip = inverse.apply([fan.center[0] + ray[0], fan.center[1] + ray[1]]);
            let u = [tip[0] - center[0], tip[1] - center[1]];
            let off = |p: Point| cross(u, [p[0] - center[0], p[1] - center[1]]);
            let along = |p: Point| u[0] * (p[0] - center[0]) + u[1] * (p[1] - center[1]);
            let mut exit = None;
            for i in 0..n {
                let (a, b) = (ring[i], ring[(i + 1) % n]);
                let d = off(a);
                if along(a) > 0.0 {
                    match Band::of(d) {
                        Band::On => {
                            exit = Some(Exit::Vertex(i));
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
                if d > TOL && e < -TOL || d < -TOL && e > TOL {
                    let s = d / (d - e);
                    let x = [a[0] + s * (b[0] - a[0]), a[1] + s * (b[1] - a[1])];
                    if along(x) > 0.0 && exit.is_none() {
                        exit = Some(Exit::Crease(i, s));
                    }
                }
            }
            let exit = exit.ok_or(FoldRefusal::FanCenter {
                faces: vec![face.id],
            })?;
            if let Exit::Crease(i, s) = exit {
                let k = topology.face_creases[f][i];
                // The crease's own parameter, from its first vertex.
                let along_crease = if parts.creases[k].vertices[0] == face.ring[i] {
                    s
                } else {
                    1.0 - s
                };
                if let Some(g) = topology.across(k, f)
                    && !cut_face[g]
                {
                    return Err(FoldRefusal::FanRayBlocked {
                        faces: vec![parts.faces[g].id],
                    }
                    .into());
                }
                crossings.entry((k, j)).or_insert_with(|| {
                    let [p, q] = parts.creases[k].vertices.map(|v| parts.vertices[v.index()]);
                    let v = VertexId(vertices.len() as u32);
                    vertices.push([
                        p[0] + along_crease * (q[0] - p[0]),
                        p[1] + along_crease * (q[1] - p[1]),
                    ]);
                    (along_crease, v)
                });
            }
            face_exits.push((j, exit));
        }
        exits.push(face_exits);
    }

    // The cut creases' pieces, in order along each.
    let mut cut_at: HashMap<usize, Vec<(f64, VertexId)>> = HashMap::new();
    for (&(k, _), &(s, v)) in &crossings {
        cut_at.entry(k).or_default().push((s, v));
    }
    let mut kept_creases = Vec::with_capacity(parts.creases.len());
    let mut new_creases = Vec::new();
    for (k, crease) in parts.creases.iter().enumerate() {
        let Some(at) = cut_at.get_mut(&k) else {
            kept_creases.push(crease.clone());
            continue;
        };
        at.sort_by(|x, y| x.0.total_cmp(&y.0));
        let [a, b] = crease.vertices;
        let mut chain = vec![a];
        chain.extend(at.iter().map(|&(_, v)| v));
        chain.push(b);
        for pair in chain.windows(2) {
            let length = distance(vertices[pair[0].index()], vertices[pair[1].index()]);
            if length < MIN_FEATURE {
                return Err(FoldRefusal::ShortCrease {
                    vertices: [pair[0], pair[1]],
                    length,
                }
                .into());
            }
            new_creases.push(Crease {
                id: EdgeId(next_crease),
                vertices: [pair[0], pair[1]],
                ..crease.clone()
            });
            next_crease += 1;
        }
    }

    // Each cut face's wedges: from the center out along a ray, round the
    // ring counter-clockwise (in the sheet), back along the next ray.
    let mut kept_faces: Vec<(Face, usize)> = Vec::with_capacity(nf);
    let mut pieces: Vec<(Face, usize)> = Vec::new();
    let mut chords: Vec<[VertexId; 2]> = Vec::new();
    let mut layer_of = vec![None; nf];
    for (l, &f) in layers.iter().enumerate() {
        layer_of[f] = Some(l);
    }
    for (f, face) in parts.faces.iter().enumerate() {
        let Some(l) = layer_of[f] else {
            kept_faces.push((face.clone(), f));
            continue;
        };
        let n = face.ring.len();
        // Every exit as a vertex id and a position round the ring: a ring
        // vertex at its index, a crease crossing at its index plus its
        // parameter along the side (two rays may leave through one side).
        let mut around: Vec<(f64, VertexId, usize)> = exits[l]
            .iter()
            .map(|(j, exit)| match *exit {
                Exit::Vertex(i) => (i as f64, face.ring[i], *j),
                Exit::Crease(i, s) => {
                    let k = topology.face_creases[f][i];
                    let v = crossings.get(&(k, *j)).map_or(face.ring[i], |c| c.1);
                    (i as f64 + s, v, *j)
                }
            })
            .collect();
        around.sort_by(|a, b| a.0.total_cmp(&b.0));
        let center = centers[l];
        let m = around.len();
        for w in 0..m {
            let (from, v0, _) = around[w];
            let (to, v1, _) = around[(w + 1) % m];
            // The ring vertices strictly between the two exits, round the
            // ring (past its end for the last wedge).
            let first = from.floor() as usize + 1;
            let last = to.ceil() as usize + if w + 1 < m { 0 } else { n };
            let mut ring = vec![center, v0];
            ring.extend((first..last).map(|i| face.ring[i % n]));
            ring.push(v1);
            let polygon: Vec<Point> = ring.iter().map(|v| vertices[v.index()]).collect();
            if polygon.len() < 3 || !convex::is_convex(&polygon, TOL) {
                return Err(FoldRefusal::DegenerateSplit { face: face.id }.into());
            }
            let width = convex::width(&polygon);
            if width < MIN_FEATURE / 2.0 {
                return Err(FoldRefusal::ThinPiece {
                    face: face.id,
                    width,
                }
                .into());
            }
            pieces.push((
                Face {
                    id: FaceId(next_face),
                    ring,
                    parent: Some(face.id),
                    born: step,
                },
                f,
            ));
            next_face += 1;
        }
        // The chords: the center to each exit.
        for &(_, v, _) in &around {
            let length = distance(vertices[center.index()], vertices[v.index()]);
            if length < MIN_FEATURE {
                return Err(FoldRefusal::ShortCrease {
                    vertices: [center, v],
                    length,
                }
                .into());
            }
            chords.push([center, v]);
        }
    }
    let mut created = Vec::with_capacity(chords.len());
    for ends in chords {
        created.push(EdgeId(next_crease));
        new_creases.push(Crease {
            id: EdgeId(next_crease),
            vertices: ends,
            // Its letter is derived from the order.
            kind: CreaseKind::Folded(Letter::Valley),
            made_at: step,
        });
        next_crease += 1;
    }

    let split = layers.len();
    let faces: Vec<(Face, usize)> = kept_faces.into_iter().chain(pieces).collect();
    let scoring = Scoring {
        vertices,
        old: faces.iter().map(|(_, f)| *f).collect(),
        faces: faces.into_iter().map(|(face, _)| face).collect(),
        creases: kept_creases.into_iter().chain(new_creases).collect(),
        created,
        split,
    };
    let wedge_of = (0..scoring.faces.len())
        .map(|a| {
            if !cut_face[scoring.old[a]] {
                return None;
            }
            let centroid = convex::centroid(&scoring.polygon(a))?;
            let image: Point = geometry.isometries[scoring.old[a]].apply(centroid);
            Some(fan.wedge_of(image))
        })
        .collect();
    Ok(FanScoring { scoring, wedge_of })
}

fn distance(a: Point, b: Point) -> f64 {
    (b[0] - a[0]).hypot(b[1] - a[1])
}

/// A fan fold before it is compiled: what a rabbit ear or a swivel resolves
/// its inputs to.
#[derive(Debug, Clone)]
pub(crate) struct FanFold {
    pub(crate) patches: Option<Vec<Vec<usize>>>,
    pub(crate) kind: VertexFoldKind,
    pub(crate) fan: Fan,
    /// The layers the rays cut, by position, the first nearest the side the
    /// direction names.
    pub(crate) layers: Vec<usize>,
    /// A sheet point on paper that stays.
    pub(crate) stayer: Point,
    /// In the model frame.
    pub(crate) direction: Direction,
    /// The fourth ray, the emergent one, by ray index: the ear's ridge (see
    /// [`FanFold::compile`]).
    pub(crate) fourth: usize,
}

impl FanFold {
    /// The fold compiled: the layers cut, every piece in the block of its
    /// wedge, the anchor's staying, and each wedge's turns.
    ///
    /// The fourth ray rises as the ear's ridge (the module docs): it must be
    /// one of the far wedge's two rays, refused otherwise, and seeds them in
    /// every layer, which the direction alone leaves open (research §5.3:
    /// two orders, differing in which of the two rises): the far wedge lies
    /// over its neighbour across the fourth ray, toward the side the
    /// direction names, and under its other neighbour. The fourth's crease
    /// is then the one of each layer's four whose letter differs from the
    /// other three's, which take the direction's.
    pub(crate) fn compile(&self, state: &State) -> Result<Compiled, Refused> {
        let fan = &self.fan;
        let n = fan.rays.len();
        let FanScoring { scoring, wedge_of } = match &self.patches {
            Some(patches) => super::fan_precreased::score(state, fan, patches)?,
            None => score_fan(state, fan, &self.layers)?,
        };
        let count = scoring.faces.len();

        // Paper joined across every crease but the new ones.
        let created: Vec<[VertexId; 2]> = scoring
            .creases
            .iter()
            .filter(|c| scoring.created.binary_search(&c.id).is_ok())
            .map(|c| c.vertices)
            .collect();
        let mut sides: HashMap<(u32, u32), Vec<usize>> = HashMap::new();
        for (a, face) in scoring.faces.iter().enumerate() {
            let m = face.ring.len();
            for i in 0..m {
                let (p, q) = (face.ring[i].0, face.ring[(i + 1) % m].0);
                sides.entry((p.min(q), p.max(q))).or_default().push(a);
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
        for (&(p, q), faces) in &sides {
            let on_existing_ray = self.patches.is_some()
                && faces.len() == 2
                && wedge_of[faces[0]].is_some()
                && wedge_of[faces[1]].is_some()
                && wedge_of[faces[0]] != wedge_of[faces[1]];
            let chord = on_existing_ray
                || created
                    .iter()
                    .any(|c| (c[0].0.min(c[1].0), c[0].0.max(c[1].0)) == (p, q));
            if let [a, b] = faces[..]
                && !chord
            {
                let (ra, rb) = (root(&mut parent, a), root(&mut parent, b));
                parent[ra.max(rb)] = ra.min(rb);
            }
        }
        let component: Vec<usize> = (0..count).map(|a| root(&mut parent, a)).collect();
        let mut wedges: HashMap<usize, Vec<usize>> = HashMap::new();
        for a in 0..count {
            if let Some(w) = wedge_of[a] {
                let list = wedges.entry(component[a]).or_default();
                if !list.contains(&w) {
                    list.push(w);
                }
            }
        }
        // Paper joined to two wedges holds them together: no fold.
        let ids = |set: Vec<usize>| -> Vec<FaceId> {
            let mut ids: Vec<FaceId> = set
                .into_iter()
                .map(|a| state.faces()[scoring.old[a]].id)
                .collect();
            ids.sort_unstable();
            ids.dedup();
            ids
        };
        if let Some((&c, _)) = wedges.iter().find(|(_, w)| w.len() > 1) {
            let holding: Vec<usize> = (0..count)
                .filter(|&a| component[a] == c && wedge_of[a].is_none())
                .collect();
            let held: Vec<usize> = (0..count).filter(|&a| component[a] == c).collect();
            return Err(FoldRefusal::FanRayBlocked {
                faces: ids(if holding.is_empty() { held } else { holding }),
            }
            .into());
        }
        let stayer = (0..count)
            .find(|&a| convex::contains_point(&scoring.polygon(a), self.stayer, TOL))
            .ok_or(FoldRefusal::WitnessNotInFace { point: self.stayer })?;
        let Some(&[anchor]) = wedges.get(&component[stayer]).map(Vec::as_slice) else {
            return Err(FoldRefusal::FanStayerDetached { point: self.stayer }.into());
        };
        let mut block_of: Vec<Option<usize>> = (0..count)
            .map(|a| {
                let w = *wedges.get(&component[a])?.first()?;
                (w != anchor).then_some(w)
            })
            .collect();

        // Each wedge turns across the rays between it and the anchor, the
        // nearest outermost; the half of the fan each way round.
        let mut turns: Vec<Vec<(usize, Line)>> = vec![Vec::new(); n];
        let depth = n / 2;
        let line = |i: usize| {
            fan.line(i).ok_or(FoldRefusal::Internal {
                message: "a fan ray has no line".to_string(),
            })
        };
        for (w, turn) in turns.iter_mut().enumerate() {
            let d = (w + n - anchor) % n;
            if d == 0 {
                continue;
            }
            let rays: Vec<usize> = if d <= depth {
                (1..=d).rev().map(|k| (anchor + k) % n).collect()
            } else {
                (0..n - d).rev().map(|k| (anchor + n - k) % n).collect()
            };
            let first_stage = depth - rays.len();
            for (s, &i) in rays.iter().enumerate() {
                turn.push((first_stage + s, line(i)?));
            }
        }

        // The fourth ray is the ridge: one of the far wedge's two rays, and
        // the odd letter out of the four.
        let far = (anchor + 2) % n;
        if n != 4 || (self.fourth != far && self.fourth != (far + 1) % n) {
            return Err(FoldRefusal::FanFourthBesideStayer.into());
        }
        let odd: Vec<bool> = (0..n).map(|i| i == self.fourth).collect();
        if !folds_with_letters(&fan.sectors(), &odd) {
            return Err(FoldRefusal::FanFourthCannotRise.into());
        }
        let (over, under) = if self.fourth == far {
            ((far + n - 1) % n, (far + 1) % n)
        } else {
            ((far + 1) % n, (far + n - 1) % n)
        };
        let up = self.direction == Direction::Valley;
        let mut extra = Vec::with_capacity(2 * self.layers.len());
        let groups = self
            .patches
            .clone()
            .unwrap_or_else(|| self.layers.iter().map(|&f| vec![f]).collect());
        for group in groups {
            let pieces = |w| {
                (0..count)
                    .filter(|&a| group.contains(&scoring.old[a]) && wedge_of[a] == Some(w))
                    .collect::<Vec<_>>()
            };
            let (far_pieces, over_pieces, under_pieces) =
                (pieces(far), pieces(over), pieces(under));
            if far_pieces.is_empty() || over_pieces.is_empty() || under_pieces.is_empty() {
                return Err(FoldRefusal::Internal {
                    message: "a cut layer has no piece in a wedge".to_string(),
                }
                .into());
            }
            for &f in &far_pieces {
                for &o in &over_pieces {
                    extra.push(if up { [f, o] } else { [o, f] });
                }
                for &u in &under_pieces {
                    extra.push(if up { [u, f] } else { [f, u] });
                }
            }
        }
        let turns = drop_empty(&mut block_of, turns);
        Ok(Compiled {
            kind: self.kind,
            scoring,
            block_of,
            turns,
            vertices: vec![fan.center],
            direction: self.direction,
            extra,
            against: None,
        })
    }
}

/// The layers a fan cuts: every face whose image contains its center
/// (`All`), the run of `layers` of them
/// from the face holding a sheet point, away from the side the direction
/// names (`Depth`), or the faces holding sheet points (`Flaps`); the first
/// nearest that side. Refused when a named face does not contain the
/// center.
pub(crate) fn fan_layers(
    state: &State,
    center: Point,
    seed: &Seed,
    direction: Direction,
) -> Result<Vec<usize>, Refused> {
    let stack = stack_toward(state, center, direction).ok_or(FoldRefusal::Internal {
        message: "the layers at the fan's center do not stack".to_string(),
    })?;
    // A face whose image holds the center too near its edge is refused
    // when it is cut (`score_fan`), never skipped; a center on a crease
    // is in no face's image, and refused naming the faces it touches.
    let holding = stack;
    if holding.is_empty() {
        let images = &state.geometry().images;
        let touching: Vec<FaceId> = (0..state.faces().len())
            .filter(|&f| convex::contains_point(&images[f], center, -MIN_FEATURE))
            .map(|f| state.faces()[f].id)
            .collect();
        return Err(FoldRefusal::FanCenter { faces: touching }.into());
    }
    let face_of = |p: Point| -> Result<usize, Refused> {
        state
            .face_at(p)
            .and_then(|id| state.face_position(id))
            .ok_or(FoldRefusal::WitnessNotInFace { point: p }.into())
    };
    let not_at_center = |f: usize| -> Refused {
        FoldRefusal::FanCenter {
            faces: vec![state.faces()[f].id],
        }
        .into()
    };
    let layers = match seed {
        Seed::All => holding,
        Seed::Depth { at, layers } => {
            let f = face_of(*at)?;
            let i = holding
                .iter()
                .position(|&g| g == f)
                .ok_or_else(|| not_at_center(f))?;
            holding.into_iter().skip(i).take(*layers).collect()
        }
        Seed::Flaps { at } => {
            let mut chosen = Vec::with_capacity(at.len());
            for &p in at {
                let f = face_of(p)?;
                if !holding.contains(&f) {
                    return Err(not_at_center(f));
                }
                if !chosen.contains(&f) {
                    chosen.push(f);
                }
            }
            chosen.sort_by_key(|f| holding.iter().position(|g| g == f));
            chosen
        }
    };
    if layers.is_empty() {
        return Err(FoldRefusal::EmptySeed.into());
    }
    Ok(layers)
}

/// A fan fold's inputs, resolved to the parent's model frame: the rabbit
/// ear's and the swivel's.
#[derive(Debug, Clone)]
pub(crate) struct FanInput {
    pub(crate) triangle: Option<[Point; 3]>,
    pub(crate) kind: VertexFoldKind,
    pub(crate) center: Point,
    /// The three given rays' directions.
    pub(crate) given: [Point; 3],
    /// The emergent ray asked for: the nearest candidate is taken.
    pub(crate) emergent: Point,
    pub(crate) layers: Seed,
    pub(crate) stayer: Point,
    /// As the viewer sees it.
    pub(crate) direction: Direction,
}

/// A fan fold's rays and layers, before it lands: what a tool previews and
/// offers (the emergent candidates, research §5.3: three at most).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FanAnalysis {
    /// Where the creases meet, in the parent's model frame.
    pub center: Point,
    /// The three given rays' directions.
    pub given: Vec<Point>,
    /// Every direction the fourth ray can take, counter-clockwise from the x
    /// axis.
    pub candidates: Vec<Point>,
    /// The candidate the emergent ray asked for names.
    pub emergent: Option<usize>,
    /// The layers the creases cut: the parent's faces, the first nearest the
    /// side the direction names.
    pub layers: Vec<FaceId>,
}

struct FanLayers {
    faces: Vec<usize>,
    patches: Option<Vec<Vec<usize>>>,
}

impl FanInput {
    fn selected_layers(&self, state: &State, direction: Direction) -> Result<FanLayers, Refused> {
        if let Some(triangle) = &self.triangle
            && let Some(patches) = super::fan_precreased::layers(
                state,
                triangle,
                self.center,
                &self.layers,
                direction,
            )?
        {
            return Ok(FanLayers {
                faces: patches.iter().flatten().copied().collect(),
                patches: Some(patches),
            });
        }
        Ok(FanLayers {
            faces: fan_layers(state, self.center, &self.layers, direction)?,
            patches: None,
        })
    }

    pub(crate) fn analyse(&self, state: &State) -> Result<FanAnalysis, Refused> {
        let direction = state.view().model_direction(self.direction);
        let layers = self.selected_layers(state, direction)?.faces;
        let candidates = kawasaki(&self.given);
        Ok(FanAnalysis {
            center: self.center,
            given: self.given.to_vec(),
            emergent: nearest(&candidates, self.emergent),
            candidates,
            layers: layers.iter().map(|&f| state.faces()[f].id).collect(),
        })
    }

    /// The fold with the emergent candidate `k`, compiled.
    fn compile(
        &self,
        state: &State,
        candidates: &[Point],
        k: usize,
        direction: Direction,
    ) -> Result<Compiled, Refused> {
        self.compile_fan(state, candidates, k, direction)
            .map(|(_, compiled)| compiled)
    }

    /// [`FanInput::compile`], with its fan.
    pub(crate) fn compile_fan(
        &self,
        state: &State,
        candidates: &[Point],
        k: usize,
        direction: Direction,
    ) -> Result<(Fan, Compiled), Refused> {
        let mut rays = self.given.to_vec();
        rays.push(candidates[k]);
        let fan = Fan::new(self.center, &rays).ok_or(FoldRefusal::FanNotFlat)?;
        if fan.widest() >= PI - 1e-9 {
            return Err(FoldRefusal::FanNotFlat.into());
        }
        let fourth = nearest(&fan.rays, candidates[k]).ok_or(FoldRefusal::FanNotFlat)?;
        let FanLayers {
            faces: layers,
            patches,
        } = self.selected_layers(state, direction)?;
        let compiled = FanFold {
            patches,
            kind: self.kind,
            layers,
            fan: fan.clone(),
            stayer: self.stayer,
            direction,
            fourth,
        }
        .compile(state)?;
        Ok((fan, compiled))
    }

    /// The fold's picture on `state`, with `landed`'s cover at the arrow's
    /// head when it is given (see [`super::vertex`]): the crease the far
    /// wedge turns across last, as a ray from the center over the layers it
    /// cuts, and the arrow from the neighbour wedge that turns across it —
    /// carrying the far wedge — to where it lands. Refused as the fold is
    /// before it lands.
    pub(crate) fn action(
        &self,
        state: &State,
        landed: Option<&State>,
    ) -> Result<FoldActionGeometry, Refused> {
        let direction = state.view().model_direction(self.direction);
        let candidates = kawasaki(&self.given);
        let k = nearest(&candidates, self.emergent).ok_or(FoldRefusal::FanNotFlat)?;
        let (fan, compiled) = self.compile_fan(state, &candidates, k, direction)?;
        let no_picture = || -> Refused {
            FoldRefusal::Internal {
                message: "a fan fold turns no wedge to picture".to_string(),
            }
            .into()
        };
        let turns = &compiled.turns;
        // The far wedge, which turns most, and the crease it turns across
        // last: the one between the paper that stays and its neighbour.
        let far = (0..turns.len())
            .max_by_key(|&b| turns[b].len())
            .ok_or_else(no_picture)?;
        let &(_, line) = turns[far].last().ok_or_else(no_picture)?;
        let across = |b: usize| turns[b].last().is_some_and(|(_, l)| l.approx_eq(&line));
        let carried: Vec<usize> = (0..turns.len()).filter(|&b| across(b)).collect();
        let neighbour: Vec<usize> = carried
            .iter()
            .copied()
            .filter(|&b| turns[b].len() == 1)
            .collect();
        let toward = fan
            .rays
            .iter()
            .copied()
            .find(|r| line.distance_to_point([fan.center[0] + r[0], fan.center[1] + r[1]]) <= TOL)
            .ok_or_else(no_picture)?;
        let scoring = &compiled.scoring;
        let geometry = state.geometry();
        let pieces_of = |blocks: &[usize]| -> Vec<usize> {
            (0..scoring.faces.len())
                .filter(|&a| compiled.block_of[a].is_some_and(|b| blocks.contains(&b)))
                .collect()
        };
        // The neighbour's paper, where the grip goes: it turns across the
        // crease alone, where the far wedge on it turns twice.
        let reach: Vec<Vec<Point>> = pieces_of(if neighbour.is_empty() {
            &carried
        } else {
            &neighbour
        })
        .into_iter()
        .map(|a| {
            let isometry = geometry.isometries[scoring.old[a]];
            let image: Vec<Point> = scoring
                .polygon(a)
                .iter()
                .map(|&p| isometry.apply(p))
                .collect();
            convex::normalize(&image)
        })
        .collect();
        let side = reach
            .iter()
            .filter_map(|image| convex::centroid(image))
            .find_map(|c| Side::of_point(&line, c))
            .ok_or_else(no_picture)?;
        let mut moving: Vec<FaceId> = pieces_of(&carried)
            .into_iter()
            .map(|a| state.faces()[scoring.old[a]].id)
            .collect();
        moving.sort_unstable();
        moving.dedup();
        let analysis = FoldAnalysis {
            line,
            side,
            snap: Snap::NONE,
            direction,
            flaps: Vec::new(),
            picked: Vec::new(),
            added: Vec::new(),
            moving,
        };
        state.fold_action_within(
            &analysis,
            ActionKind::Fold,
            landed,
            Within {
                ray: Some((fan.center, toward)),
                reach: Some(&reach),
            },
        )
    }

    /// Land the fold. A refusal of the emergent ray asked for offers each
    /// other candidate that lands, and the other direction when it lands
    /// and no order fits this one.
    ///
    /// A stored order is replayed only when the fold leaves several: one it
    /// lands alone is the ear whatever a step stored. A rabbit ear stored
    /// before its fourth crease was seeded as the ridge kept a `ridge`, or
    /// an order, choosing between the two the direction left; the ridge is
    /// no longer read, and an order that chose a corner's crease to rise
    /// would conflict with the seed, so the ear the rule leaves is landed.
    pub(crate) fn land(
        &self,
        state: &State,
        choices: &VertexChoices,
        limits: &CompletionLimits,
    ) -> Result<VertexOutcome, CompoundRefused> {
        let direction = state.view().model_direction(self.direction);
        let candidates = kawasaki(&self.given);
        let k = nearest(&candidates, self.emergent)
            .ok_or(CompoundRefused::Refused(FoldRefusal::FanNotFlat.into()))?;
        match self.land_alone(state, choices, limits) {
            Err(CompoundRefused::Refused(mut refused)) if offers_fixes(&refused.refusal) => {
                for j in (0..candidates.len()).filter(|&j| j != k) {
                    if self
                        .compile(state, &candidates, j, direction)
                        .is_ok_and(|c| c.lands(state, limits))
                    {
                        refused.fixes.push(Fix::UseEmergent {
                            direction: candidates[j],
                        });
                    }
                }
                Err(CompoundRefused::Refused(refused))
            }
            other => other,
        }
    }

    /// [`FanInput::land`] without the other emergent candidates as fixes:
    /// the fold with this emergent ray, landed or refused (offering only
    /// the other direction). A swivel by its edge offers its own
    /// alternatives instead (`super::swivel`).
    pub(crate) fn land_alone(
        &self,
        state: &State,
        choices: &VertexChoices,
        limits: &CompletionLimits,
    ) -> Result<VertexOutcome, CompoundRefused> {
        let direction = state.view().model_direction(self.direction);
        let candidates = kawasaki(&self.given);
        let k = nearest(&candidates, self.emergent)
            .ok_or(CompoundRefused::Refused(FoldRefusal::FanNotFlat.into()))?;
        let other = || {
            self.compile(state, &candidates, k, direction.opposite())
                .ok()
        };
        self.compile(state, &candidates, k, direction)
            .map_err(CompoundRefused::Refused)
            .and_then(|compiled| {
                if choices.completion.is_none() {
                    return compiled.land(state, choices, limits, other);
                }
                match compiled.land(state, &VertexChoices::default(), limits, other) {
                    Ok(VertexOutcome::ChooseOrder(_)) => {
                        compiled.land(state, choices, limits, || None)
                    }
                    outcome => outcome,
                }
            })
    }

    /// Whether the fold lands with at least one order, its emergent ray as
    /// asked.
    pub(crate) fn lands(&self, state: &State, limits: &CompletionLimits) -> bool {
        let direction = state.view().model_direction(self.direction);
        let candidates = kawasaki(&self.given);
        nearest(&candidates, self.emergent).is_some_and(|k| {
            self.compile(state, &candidates, k, direction)
                .is_ok_and(|c| c.lands(state, limits))
        })
    }
}

/// Whether a fan fold's refusal is one an alternative might cure: not a
/// stayer or a seed that names no paper.
pub(crate) fn offers_fixes(refusal: &FoldRefusal) -> bool {
    !matches!(
        refusal,
        FoldRefusal::WitnessNotInFace { .. } | FoldRefusal::EmptySeed
    )
}

/// The candidate nearest `direction` (by angle) among `candidates`.
pub(crate) fn nearest(candidates: &[Point], direction: Point) -> Option<usize> {
    let d = unit(direction)?;
    (0..candidates.len()).min_by(|&a, &b| {
        let off = |k: usize| angle_between(candidates[k], d).abs();
        off(a).total_cmp(&off(b))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn degrees(v: Point) -> f64 {
        angle_of(v).to_degrees()
    }

    #[test]
    fn every_kawasaki_candidate_folds_flat() {
        // The swivel spike's vertex (0.5, 0.3) with rays toward (1, 0.6),
        // (0, 0.6) and (0.5, 0): its three candidates, as the spike found.
        let o = [0.5, 0.3];
        let toward = |p: Point| unit([p[0] - o[0], p[1] - o[1]]).unwrap_or_default();
        let given = [toward([1.0, 0.6]), toward([0.0, 0.6]), toward([0.5, 0.0])];
        let candidates = kawasaki(&given);
        let found: Vec<i64> = candidates
            .iter()
            .map(|&c| degrees(c).round() as i64)
            .collect();
        assert_eq!(found, vec![90, 208, 332]);
        for &c in &candidates {
            let mut angles: Vec<f64> = given.iter().chain([&c]).map(|&r| angle_of(r)).collect();
            angles.sort_by(f64::total_cmp);
            let alternate = (angles[1] - angles[0]) + (angles[3] - angles[2]);
            assert!((alternate - PI).abs() < 1e-12, "{alternate}");
        }
        // Three rays within a quarter turn leave one gap wider than a half
        // turn, and only it holds a candidate.
        let narrow = [[1.0, 0.0], [0.9, 0.3], [0.8, 0.5]].map(|r| unit(r).unwrap_or_default());
        assert_eq!(kawasaki(&narrow).len(), 1);
    }

    #[test]
    fn the_odd_crease_out_bounds_a_narrowest_angle() {
        let deg = |s: [f64; 4]| s.map(f64::to_radians);
        let odd = |k: usize| -> Vec<bool> { (0..4).map(|i| i == k).collect() };
        // The flat square's incenter ear (rays to c, a, the fourth, b):
        // 45° is the narrowest, between the fourth (crease 2) and b
        // (crease 3), so either can be the odd one, never a or c.
        let ear = deg([135.0, 67.5, 45.0, 112.5]);
        assert!(folds_with_letters(&ear, &odd(2)));
        assert!(folds_with_letters(&ear, &odd(3)));
        assert!(!folds_with_letters(&ear, &odd(0)));
        assert!(!folds_with_letters(&ear, &odd(1)));
        // Two narrowest angles side by side (the swivel spike's 90° ray):
        // the odd one is any of the three creases bounding them.
        let run = deg([59.0, 59.0, 121.0, 121.0]);
        for k in 0..3 {
            assert!(folds_with_letters(&run, &odd(k)), "{k}");
        }
        assert!(!folds_with_letters(&run, &odd(3)));
        // Four right angles fold with any one crease odd, and never with
        // two of each letter (Maekawa).
        let square = deg([90.0, 90.0, 90.0, 90.0]);
        for k in 0..4 {
            assert!(folds_with_letters(&square, &odd(k)));
        }
        assert!(!folds_with_letters(&square, &[true, true, false, false]));
        // The rays toward 0°, 270° and 300° with their fourth at 150°.
        let swivel = deg([150.0, 120.0, 30.0, 60.0]);
        assert!(!folds_with_letters(&swivel, &odd(1)));
        assert!(folds_with_letters(&swivel, &odd(2)));
    }

    #[test]
    fn wedges_run_counter_clockwise_from_each_ray() {
        let Some(fan) = Fan::new(
            [0.0, 0.0],
            &[[0.0, 1.0], [1.0, 0.0], [-1.0, 0.0], [0.0, -1.0]],
        ) else {
            panic!("no fan");
        };
        // Sorted from the x axis: 0°, 90°, 180°, 270°.
        assert_eq!(fan.rays[1], [0.0, 1.0]);
        assert_eq!(fan.wedge_of([1.0, 1.0]), 0);
        assert_eq!(fan.wedge_of([-1.0, 1.0]), 1);
        assert_eq!(fan.wedge_of([-1.0, -1.0]), 2);
        assert_eq!(fan.wedge_of([1.0, -1.0]), 3);
        assert!((fan.widest() - PI / 2.0).abs() < 1e-12);
        // Two rays in one direction are no fan.
        assert!(Fan::new([0.0, 0.0], &[[1.0, 0.0], [2.0, 0.0], [0.0, 1.0]]).is_none());
        assert_eq!(nearest(&fan.rays, [0.1, -1.0]), Some(3));
    }
}

//! Incremental against full, on random folded states: after every step of a
//! seeded random sequence, the problem rebuilt from the previous one over the
//! step's touched faces equals the problem built from scratch, overlay cells
//! included, bit for bit.
//!
//! The states come from a small folder written here, since the Fold engine
//! depends on this crate: a convex sheet folded along random lines, through
//! all layers or only one flap (a connected run of faces on the moving
//! side), every face the line crosses split in two with a crease between the
//! halves; now and then a face is dropped or a coincident copy added. Faces
//! that neither move nor split keep their ids and their images exactly, as
//! the rebuild's contract asks. No layer order is needed: the problem is
//! built from the images and creases alone.
//!
//! `incremental_matches_full_on_random_sequences` runs a modest campaign on
//! every `cargo test`; `incremental_campaign` (ignored) a larger one:
//! `cargo test -p oristudio-layer-order --release --test incremental -- --ignored`.

use std::collections::BTreeSet;

use oristudio_geometry::convex::{self, HalfPlane};
use oristudio_layer_order::{
    ConstraintKind, ConstraintProblem, Edge, EdgeKind, Face, FaceId, FoldedView, Overlay,
};

type Point = [f64; 2];

/// SplitMix64, so the campaign needs no dependency and replays exactly.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        ((z ^ (z >> 31)) >> 11) as f64 / (1u64 << 53) as f64
    }

    fn below(&mut self, n: usize) -> usize {
        ((self.next() * n as f64) as usize).min(n.saturating_sub(1))
    }

    fn chance(&mut self, p: f64) -> bool {
        self.next() < p
    }
}

/// How far a fold line keeps from every vertex, and how thin a split piece
/// may be: well clear of the tolerance, so every state the folder makes is a
/// valid view.
const CLEAR: f64 = 1e-3;

/// A state under construction: faces and creases, with the next free id.
#[derive(Clone)]
struct Model {
    faces: Vec<Face>,
    edges: Vec<Edge>,
    next_id: u32,
}

impl Model {
    fn sheet(rng: &mut Rng) -> Model {
        let polygon = match rng.below(3) {
            0 => vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
            1 => {
                let w = 0.4 + 0.6 * rng.next();
                vec![[0.0, 0.0], [w, 0.0], [w, 1.0], [0.0, 1.0]]
            }
            _ => {
                let n = 3 + rng.below(6);
                (0..n)
                    .map(|k| {
                        let a = k as f64 * std::f64::consts::TAU / n as f64 + 0.3;
                        [0.5 + 0.5 * a.cos(), 0.5 + 0.5 * a.sin()]
                    })
                    .collect()
            }
        };
        Model {
            faces: vec![Face {
                id: FaceId(0),
                polygon,
                front_up: true,
            }],
            edges: Vec::new(),
            next_id: 1,
        }
    }

    fn view(&self) -> Option<FoldedView> {
        FoldedView::new(self.faces.clone(), self.edges.clone()).ok()
    }

    fn bounding_box(&self) -> [f64; 4] {
        let points: Vec<Point> = self
            .faces
            .iter()
            .flat_map(|f| f.polygon.iter().copied())
            .collect();
        convex::bounding_box(&points)
    }
}

fn reflect(p: Point, line: &HalfPlane) -> Point {
    let d = line.signed_distance(p);
    let n = line.normal();
    [p[0] - 2.0 * d * n[0], p[1] - 2.0 * d * n[1]]
}

/// Which side of the line a point set lies on: 1 or -1, 0 when it crosses.
fn side(points: &[Point], line: &HalfPlane) -> i8 {
    let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
    for &p in points {
        let d = line.signed_distance(p);
        lo = lo.min(d);
        hi = hi.max(d);
    }
    if lo >= 0.0 {
        1
    } else if hi <= 0.0 {
        -1
    } else {
        0
    }
}

/// Fold along `line`, moving its positive side: every layer there, or only
/// the flap reached from one face there. The new model and the faces it
/// touched (moved or split); `None` when the line passes near a vertex or a
/// piece would be thin.
fn fold(model: &Model, line: &HalfPlane, flap: Option<usize>) -> Option<(Model, BTreeSet<FaceId>)> {
    let near = model
        .faces
        .iter()
        .flat_map(|f| &f.polygon)
        .any(|&p| line.signed_distance(p).abs() < CLEAR);
    if near {
        return None;
    }
    let mut next_id = model.next_id;
    // Per old face: its pieces as (face, side).
    let mut pieces: Vec<Vec<(Face, i8)>> = Vec::new();
    let mut chords: Vec<(FaceId, FaceId, [Point; 2])> = Vec::new();
    for face in &model.faces {
        let s = side(&face.polygon, line);
        if s != 0 {
            pieces.push(vec![(face.clone(), s)]);
            continue;
        }
        let cut = convex::split(&face.polygon, line, 0.0);
        if [&cut.inside, &cut.outside]
            .iter()
            .any(|p| p.len() < 3 || convex::width(p) < CLEAR)
        {
            return None;
        }
        let on_line: Vec<Point> = cut
            .inside
            .iter()
            .copied()
            .filter(|&p| line.signed_distance(p).abs() < 1e-12)
            .collect();
        let [a, b] = <[Point; 2]>::try_from(on_line).ok()?;
        let (plus, minus) = (FaceId(next_id), FaceId(next_id + 1));
        next_id += 2;
        chords.push((plus, minus, [a, b]));
        pieces.push(vec![
            (
                Face {
                    id: plus,
                    polygon: cut.inside,
                    front_up: face.front_up,
                },
                1,
            ),
            (
                Face {
                    id: minus,
                    polygon: cut.outside,
                    front_up: face.front_up,
                },
                -1,
            ),
        ]);
    }
    let index = |id: FaceId| model.faces.iter().position(|f| f.id == id);
    let piece_on = |f: usize, s: i8| pieces[f].iter().find(|(_, t)| *t == s).map(|(p, _)| p.id);

    // Creases: a crossing one is cut in two, each half joining the pieces on
    // its side.
    let mut edges: Vec<Edge> = Vec::new();
    for edge in &model.edges {
        let (f, g) = (index(edge.faces[0])?, index(edge.faces[1])?);
        let [p, q] = edge.segment;
        let (dp, dq) = (line.signed_distance(p), line.signed_distance(q));
        if dp * dq >= 0.0 {
            let s = if dp + dq > 0.0 { 1 } else { -1 };
            edges.push(Edge {
                faces: [piece_on(f, s)?, piece_on(g, s)?],
                ..edge.clone()
            });
            continue;
        }
        let t = dp / (dp - dq);
        let x = [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
        for (end, s) in [(p, dp.signum() as i8), (q, dq.signum() as i8)] {
            edges.push(Edge {
                faces: [piece_on(f, s)?, piece_on(g, s)?],
                segment: if end == p { [p, x] } else { [x, q] },
                kind: edge.kind,
            });
        }
    }
    let flat: Vec<(Face, i8)> = pieces.into_iter().flatten().collect();

    // Who moves: every positive piece, or the run of positive pieces joined
    // by creases to the one picked.
    let positive: Vec<usize> = (0..flat.len()).filter(|&i| flat[i].1 == 1).collect();
    if positive.is_empty() || positive.len() == flat.len() {
        return None;
    }
    let mut moving = vec![false; flat.len()];
    match flap {
        None => positive.iter().for_each(|&i| moving[i] = true),
        Some(pick) => {
            let at = |id: FaceId| flat.iter().position(|(f, _)| f.id == id);
            let mut stack = vec![positive[pick % positive.len()]];
            while let Some(i) = stack.pop() {
                if std::mem::replace(&mut moving[i], true) {
                    continue;
                }
                for e in &edges {
                    let (a, b) = (at(e.faces[0])?, at(e.faces[1])?);
                    for (x, y) in [(a, b), (b, a)] {
                        if x == i && flat[y].1 == 1 && !moving[y] {
                            stack.push(y);
                        }
                    }
                }
            }
        }
    }
    let moved: BTreeSet<FaceId> = (0..flat.len())
        .filter(|&i| moving[i])
        .map(|i| flat[i].0.id)
        .collect();

    let mut faces = Vec::with_capacity(flat.len());
    for (face, _) in flat {
        if moved.contains(&face.id) {
            // Reflected, and reversed to stay counter-clockwise.
            faces.push(Face {
                id: face.id,
                polygon: face
                    .polygon
                    .iter()
                    .rev()
                    .map(|&p| reflect(p, line))
                    .collect(),
                front_up: !face.front_up,
            });
        } else {
            faces.push(face);
        }
    }
    for edge in &mut edges {
        if edge.faces.iter().all(|f| moved.contains(f)) {
            edge.segment = edge.segment.map(|p| reflect(p, line));
        }
    }
    for (plus, minus, segment) in chords {
        // A chord whose positive half moved is now a fold; otherwise a
        // precrease.
        let kind = if moved.contains(&plus) {
            EdgeKind::Folded(None)
        } else {
            EdgeKind::Flat
        };
        edges.push(Edge {
            faces: [plus, minus],
            segment,
            kind,
        });
    }
    let touched: BTreeSet<FaceId> = moved
        .iter()
        .copied()
        .chain(faces.iter().map(|f| f.id).filter(|f| f.0 >= model.next_id))
        .collect();
    Some((
        Model {
            faces,
            edges,
            next_id,
        },
        touched,
    ))
}

/// A random line through the middle of the model.
fn random_line(model: &Model, rng: &mut Rng) -> Option<HalfPlane> {
    let [x0, y0, x1, y1] = model.bounding_box();
    let c = [
        x0 + (0.25 + 0.5 * rng.next()) * (x1 - x0),
        y0 + (0.25 + 0.5 * rng.next()) * (y1 - y0),
    ];
    // Now and then a sixteenth of a turn, so that creases line up.
    let a = if rng.chance(0.5) {
        rng.below(16) as f64 * std::f64::consts::PI / 16.0
    } else {
        rng.next() * std::f64::consts::PI
    };
    let normal = [-a.sin(), a.cos()];
    let normal = if rng.chance(0.5) {
        normal
    } else {
        [-normal[0], -normal[1]]
    };
    HalfPlane::new(normal, normal[0] * c[0] + normal[1] * c[1])
}

/// One step: a fold, or now and then a face dropped or a copy added.
fn step(model: &Model, rng: &mut Rng) -> Option<(Model, BTreeSet<FaceId>)> {
    let r = rng.next();
    if r < 0.06 && model.faces.len() > 2 {
        // Drop a face and its creases.
        let gone = model.faces[rng.below(model.faces.len())].id;
        let mut next = model.clone();
        next.faces.retain(|f| f.id != gone);
        next.edges.retain(|e| !e.faces.contains(&gone));
        return Some((next, BTreeSet::new()));
    }
    if r < 0.12 {
        // A coincident copy of a face, with no creases.
        let mut next = model.clone();
        let mut copy = model.faces[rng.below(model.faces.len())].clone();
        copy.id = FaceId(next.next_id);
        next.next_id += 1;
        next.faces.push(copy);
        return Some((next, BTreeSet::new()));
    }
    let line = random_line(model, rng)?;
    let flap = rng.chance(0.4).then(|| rng.below(1 << 16));
    fold(model, &line, flap)
}

/// Which parts of two problems differ, for a failure message.
fn difference(rebuilt: &ConstraintProblem, full: &ConstraintProblem) -> String {
    let mut parts = Vec::new();
    if rebuilt.variables() != full.variables() {
        parts.push("variables".to_string());
    }
    if rebuilt.constraints() != full.constraints() {
        let extra: Vec<_> = rebuilt
            .constraints()
            .iter()
            .filter(|c| !full.constraints().contains(c))
            .collect();
        let missing: Vec<_> = full
            .constraints()
            .iter()
            .filter(|c| !rebuilt.constraints().contains(c))
            .collect();
        parts.push(format!(
            "constraints (extra {extra:?}, missing {missing:?})"
        ));
    }
    if rebuilt.ambiguities() != full.ambiguities() {
        parts.push(format!(
            "ambiguities ({:?} against {:?})",
            rebuilt.ambiguities(),
            full.ambiguities()
        ));
    }
    if rebuilt.overlay() != full.overlay() {
        parts.push("overlay".to_string());
    }
    if parts.is_empty() {
        parts.push("buckets or bookkeeping".to_string());
    }
    parts.join("; ")
}

#[derive(Default)]
struct Seen {
    steps: usize,
    largest: usize,
    kinds: BTreeSet<ConstraintKind>,
    ambiguities: usize,
    kept_faces: usize,
}

/// Run `sequences` random sequences of up to `steps` steps, stopping a
/// sequence once it has more than `max_faces` faces.
fn campaign(seed: u64, sequences: u64, steps: usize, max_faces: usize) -> Seen {
    let mut seen = Seen::default();
    for s in 0..sequences {
        let mut rng = Rng(seed + s);
        let mut model = Model::sheet(&mut rng);
        let Some(view) = model.view() else {
            panic!("sequence {s}: the sheet is not a view");
        };
        let mut problem = ConstraintProblem::build(&view);
        let mut overlay = Overlay::build(&view);
        let mut tries = 0;
        let mut done = 0;
        while done < steps && tries < 4 * steps && model.faces.len() <= max_faces {
            tries += 1;
            let Some((next, touched)) = step(&model, &mut rng) else {
                continue;
            };
            let Some(next_view) = next.view() else {
                continue;
            };
            // Now and then the caller names more faces than it touched.
            let mut named = touched.clone();
            if rng.chance(0.3) {
                named.insert(next.faces[rng.below(next.faces.len())].id);
            }
            let full = ConstraintProblem::build(&next_view);
            let rebuilt = problem.rebuild(&next_view, &named);
            assert!(
                rebuilt == full,
                "sequence {s} step {done} ({} faces, touched {named:?}): {}",
                next.faces.len(),
                difference(&rebuilt, &full)
            );
            let full_overlay = Overlay::build(&next_view);
            let rebuilt_overlay = overlay.rebuild(&next_view, &named);
            assert!(
                rebuilt_overlay == full_overlay,
                "sequence {s} step {done}: overlay rebuild differs from build"
            );
            assert!(full_overlay == *full.overlay());
            seen.steps += 1;
            seen.largest = seen.largest.max(next.faces.len());
            seen.kinds
                .extend(full.constraints().iter().map(|c| c.kind()));
            seen.ambiguities += full.ambiguities().len();
            seen.kept_faces += next.faces.len() - touched.len().min(next.faces.len());
            (model, problem, overlay) = (next, rebuilt, rebuilt_overlay);
            done += 1;
        }
    }
    seen
}

#[test]
fn incremental_matches_full_on_random_sequences() {
    let seen = campaign(9100, 24, 9, 90);
    eprintln!(
        "{} steps, largest {} faces, {} ambiguities, {} kept faces",
        seen.steps, seen.largest, seen.ambiguities, seen.kept_faces
    );
    assert!(seen.steps >= 150, "only {} steps", seen.steps);
    assert!(seen.largest > 40, "largest state {} faces", seen.largest);
    assert_eq!(
        seen.kinds.len(),
        3,
        "constraint kinds seen: {:?}",
        seen.kinds
    );
    assert!(seen.kept_faces > 0);
}

#[test]
#[ignore = "larger campaign; run in release"]
fn incremental_campaign() {
    let seen = campaign(27_000, 200, 14, 300);
    eprintln!(
        "{} steps, largest {} faces, {} ambiguities, {} kept faces",
        seen.steps, seen.largest, seen.ambiguities, seen.kept_faces
    );
    assert!(seen.steps >= 1500, "only {} steps", seen.steps);
}

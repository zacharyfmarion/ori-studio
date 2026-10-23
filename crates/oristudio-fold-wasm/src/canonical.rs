//! A state spelled for its `fs1` fingerprint (plan D17): one key per fact,
//! none naming a face, vertex or crease by its number, which a replay is free
//! to change (research §10). The digest over the keys is TypeScript's
//! (`lib/keyDigest`, prefixed `fs1:` and taken over the keys sorted), so the
//! order here does not matter.
//!
//! | Key | Fact |
//! |---|---|
//! | `s:` | the sheet's outline |
//! | `c:` | a crease: its sheet end points, smaller first, and what it is (`B`, `M`, `V`, or `F` with the letter it remembers) |
//! | `o:` | an ordered pair of overlapping faces, by witnesses, as a FOLD `faceOrders` sign |
//! | `v:` | the view, as the display sees one face |
//! | `m:` | a crease mark (a partial crease): its sheet end points, smaller first, and its letter (`M` or `V`) |
//!
//! A state without crease marks has no `m:` key, so its keys, and its
//! `fs1`, are what they were before marks existed.
//!
//! - **Witnesses** are each face's sheet-polygon centroid: interior, and a
//!   function of the creases alone.
//! - **Pairs** are FOLD triples — `+` when the first face lies on the side the
//!   second's front faces — with the smaller witness first. A triple does not
//!   depend on which face is the root, so the key is the pair's physical
//!   stacking rather than a frame's.
//! - **The view** is the linear part of the display transform of the face
//!   with the smallest witness: the turn-overs and rotations as the viewer
//!   sees the paper, independent of how the model frame was reached.
//! - **Numbers** are integers in units of 1e-9 of the sheet, so the last bits
//!   of a sine (which differ between platforms) never change a key.

use oristudio_fold::{CreaseKind, FaceId, Letter, State};
use oristudio_geometry::convex;

type Point = [f64; 2];

/// Every key of `state`, in no particular order.
pub fn canonical_keys(state: &State) -> Vec<String> {
    let vertices = state.vertices();
    let mut keys = Vec::with_capacity(2 + state.creases().len() + state.order().len());
    keys.push(format!("s:{}", points(state.sheet().outline())));

    for crease in state.creases() {
        let [a, b] = crease.vertices.map(|v| point(vertices[v.0 as usize]));
        let (a, b) = if a <= b { (a, b) } else { (b, a) };
        let kind = match crease.kind {
            CreaseKind::Border => "B",
            CreaseKind::Folded(Letter::Mountain) => "M",
            CreaseKind::Folded(Letter::Valley) => "V",
            CreaseKind::Flat(Letter::Mountain) => "Fm",
            CreaseKind::Flat(Letter::Valley) => "Fv",
        };
        keys.push(format!("c:{a};{b}:{kind}"));
    }

    for mark in state.crease_marks() {
        let [a, b] = [point(mark.a), point(mark.b)];
        let (a, b) = if a <= b { (a, b) } else { (b, a) };
        let letter = match mark.letter {
            Letter::Mountain => "M",
            Letter::Valley => "V",
        };
        keys.push(format!("m:{a};{b}:{letter}"));
    }

    let witnesses: Vec<String> = state
        .faces()
        .iter()
        .map(|face| {
            let polygon: Vec<Point> = face.ring.iter().map(|v| vertices[v.0 as usize]).collect();
            let c = convex::centroid(&polygon).unwrap_or_else(|| average(&polygon));
            point(c)
        })
        .collect();
    let witness = |id: FaceId| -> Option<&String> {
        let k = state.faces().binary_search_by_key(&id, |f| f.id).ok()?;
        witnesses.get(k)
    };

    for (pair, _) in state.order().pairs() {
        let [lo, hi] = pair.faces();
        let (Some(wl), Some(wh)) = (witness(lo), witness(hi)) else {
            continue;
        };
        let ((f, wf), (g, wg)) = if wl <= wh {
            ((lo, wl), (hi, wh))
        } else {
            ((hi, wh), (lo, wl))
        };
        let sign = match (state.above(f, g), state.front_up(g)) {
            (Some(above), Some(front_up)) if above == front_up => "+",
            (Some(_), Some(_)) => "-",
            _ => "?",
        };
        keys.push(format!("o:{wf}|{wg}:{sign}"));
    }

    let reference = state
        .faces()
        .iter()
        .zip(&witnesses)
        .min_by(|a, b| a.1.cmp(b.1))
        .map(|(face, _)| face.id);
    if let Some(t) = reference.and_then(|f| state.isometry(f)) {
        let [a, b, _, d, e, _] = state.view().transform().after(&t).0;
        keys.push(format!(
            "v:{},{},{},{}",
            nanos(a),
            nanos(b),
            nanos(d),
            nanos(e)
        ));
    }
    keys
}

/// In range for any sheet coordinate or matrix entry, and `as` saturates.
fn nanos(x: f64) -> i64 {
    (x * 1e9).round() as i64
}

fn point(p: Point) -> String {
    format!("{},{}", nanos(p[0]), nanos(p[1]))
}

fn points(ps: &[Point]) -> String {
    ps.iter().map(|&p| point(p)).collect::<Vec<_>>().join(";")
}

fn average(ps: &[Point]) -> Point {
    let n = ps.len().max(1) as f64;
    let (x, y) = ps.iter().fold((0.0, 0.0), |(x, y), p| (x + p[0], y + p[1]));
    [x / n, y / n]
}

//! Shared test helpers: lines, sides, folds that must land, and lookups by
//! sheet point.

#![allow(dead_code)]

use oristudio_fold::{
    CreaseKind, Direction, FaceId, Folded, Letter, PlainFold, Refused, Seed, Side, State,
};
use oristudio_geometry::Line;

pub type Point = [f64; 2];

pub const V: CreaseKind = CreaseKind::Folded(Letter::Valley);
pub const M: CreaseKind = CreaseKind::Folded(Letter::Mountain);

/// The vertical line `x = c`.
pub fn x_eq(c: f64) -> Line {
    Line::new([1.0, 0.0], c).unwrap_or_else(|| unreachable!())
}

/// The horizontal line `y = c`.
pub fn y_eq(c: f64) -> Line {
    Line::new([0.0, 1.0], c).unwrap_or_else(|| unreachable!())
}

pub fn through(p: Point, q: Point) -> Line {
    Line::from_points(p, q).unwrap_or_else(|| panic!("{p:?} = {q:?}"))
}

/// The line through `p` at `degrees` from the x axis.
pub fn at_angle(p: Point, degrees: f64) -> Line {
    let t = degrees.to_radians();
    Line::from_point_direction(p, [t.cos(), t.sin()]).unwrap_or_else(|| unreachable!())
}

/// The side of `line` that the model-frame point `p` is on.
pub fn side(line: &Line, p: Point) -> Side {
    Side::of_point(line, p).unwrap_or_else(|| panic!("{p:?} is on the line"))
}

/// A fold of every layer on the side of `line` that `toward` lies on.
pub fn all(line: Line, toward: Point, direction: Direction) -> PlainFold {
    PlainFold::new(line, side(&line, toward), direction)
}

/// The top (valley) or bottom (mountain) `layers` at a sheet point.
pub fn depth(
    line: Line,
    toward: Point,
    direction: Direction,
    at: Point,
    layers: usize,
) -> PlainFold {
    all(line, toward, direction).with_seed(Seed::Depth { at, layers })
}

pub fn fold(state: &State, op: &PlainFold) -> Folded {
    state
        .fold(op)
        .unwrap_or_else(|e| panic!("refused: {e} ({:?}) fixes {:?}", e.refusal, e.fixes))
}

pub fn precrease(state: &State, op: &PlainFold) -> Folded {
    state
        .precrease(op)
        .unwrap_or_else(|e| panic!("refused: {e} ({:?}) fixes {:?}", e.refusal, e.fixes))
}

pub fn refused(state: &State, op: &PlainFold) -> Refused {
    match state.fold(op) {
        Ok(_) => panic!("{op:?} folded"),
        Err(e) => e,
    }
}

/// The face containing the sheet point.
pub fn face(state: &State, p: Point) -> FaceId {
    state
        .face_at(p)
        .unwrap_or_else(|| panic!("no face at {p:?}"))
}

/// The sheet point of the top layer (in the model frame) at the model-frame
/// point `p`: what a picker hands the engine as a seed.
pub fn top_sheet_point(state: &State, p: Point) -> Point {
    let stack = state
        .stack_at(p)
        .unwrap_or_else(|| panic!("no stack at {p:?}"));
    let top = *stack.first().unwrap_or_else(|| panic!("nothing at {p:?}"));
    let t = state.isometry(top).unwrap_or_default();
    t.inverse().apply(p)
}

/// The crease kinds made at `step`.
pub fn made_at(state: &State, step: u32) -> Vec<CreaseKind> {
    state
        .creases()
        .iter()
        .filter(|c| c.made_at == step)
        .map(|c| c.kind)
        .collect()
}

/// The kind of the crease through the sheet point.
pub fn kind_at(state: &State, p: Point) -> CreaseKind {
    state
        .crease_at(p)
        .unwrap_or_else(|| panic!("no crease at {p:?}"))
        .kind
}

pub fn above(state: &State, f: FaceId, g: FaceId) -> bool {
    state
        .above(f, g)
        .unwrap_or_else(|| panic!("{f} and {g} are not ordered"))
}

/// The full gate from scratch, and the checker with a problem built anew.
pub fn assert_valid(state: &State) {
    let report = state.check_full();
    assert!(report.is_valid(), "{:?}", report.violations);
    if let Err(e) = State::make(state.parts().clone()) {
        panic!("the full gate refuses a landed state: {e}");
    }
}

pub fn close(a: Point, b: Point) -> bool {
    (a[0] - b[0]).abs() < 1e-12 && (a[1] - b[1]).abs() < 1e-12
}

/// Whether `b` is `a` turned over in the model frame — the same steps folded
/// from a sheet started the other side up: the same faces (matched by their
/// witnesses) and creases, every letter and every pair of faces the other
/// way round.
pub fn mirrored(a: &State, b: &State) -> bool {
    let opposite = |letter: Letter| match letter {
        Letter::Mountain => Letter::Valley,
        Letter::Valley => Letter::Mountain,
    };
    let swap = |kind: CreaseKind| match kind {
        CreaseKind::Folded(letter) => CreaseKind::Folded(opposite(letter)),
        CreaseKind::Flat(letter) => CreaseKind::Flat(opposite(letter)),
        CreaseKind::Border => CreaseKind::Border,
    };
    let face = |p: Option<Point>| p.and_then(|p| b.face_at(p));
    a.faces().len() == b.faces().len()
        && a.creases().len() == b.creases().len()
        && a.creases().iter().all(|c| {
            let [p, q] = c.vertices.map(|v| a.vertices()[v.0 as usize]);
            let mid = [(p[0] + q[0]) / 2.0, (p[1] + q[1]) / 2.0];
            b.crease_at(mid).map(|d| d.kind) == Some(swap(c.kind))
        })
        && a.faces().iter().all(|f| {
            let Some(g) = face(a.face_witness(f.id)) else {
                return false;
            };
            a.faces().iter().all(|h| {
                let Some(k) = face(a.face_witness(h.id)) else {
                    return false;
                };
                a.above(f.id, h.id) == b.above(g, k).map(|above| !above)
            })
        })
}

/// The FOLD `faceOrders` sign rule: f lies on the side g's front normal
/// points to.
pub fn on_front_side(state: &State, f: FaceId, g: FaceId) -> bool {
    above(state, f, g) == state.front_up(g).unwrap_or_else(|| unreachable!())
}

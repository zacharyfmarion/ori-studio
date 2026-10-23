//! Paths of states for the kernel conversion and FOLD export tests: the
//! classic sequences replayed from their fixtures, a path whose every
//! coordinate is dyadic, and seeded random paths. The `sequences` example
//! times the classics through [`classics`].

#![allow(dead_code)]

use std::path::PathBuf;

pub use oristudio_fold::random::Rng;
use oristudio_fold::{Direction, PlainFold, Sheet, SheetShape, Side, StartSide, State, VertexId};
use oristudio_geometry::Line;
use serde::Deserialize;

type Point = [f64; 2];

/// The operations `tests/classics.rs` records.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case", tag = "op")]
pub enum Op {
    Fold { fold: PlainFold },
    Precrease { fold: PlainFold },
    TurnOver,
}

/// A classic sequence: its states, the flat sheet first, and the operation
/// that leads from each to the next.
pub struct Classic {
    pub name: String,
    pub path: Vec<State>,
    pub ops: Vec<Op>,
}

#[derive(Debug, Deserialize)]
struct Fixture {
    name: String,
    sheet: SheetShape,
    start: StartSide,
    /// Each operation with the outcome `classics.rs` checks; only the
    /// operations are needed here.
    steps: Vec<(Op, serde_json::Value)>,
}

fn flat(sheet: &SheetShape, start: StartSide) -> State {
    State::flat(Sheet::new(sheet).unwrap_or_else(|e| panic!("{e}")), start)
        .unwrap_or_else(|e| panic!("{e}"))
}

/// Every classic sequence as its path of states, the flat sheet first.
pub fn classic_paths() -> Vec<(String, Vec<State>)> {
    classics().into_iter().map(|c| (c.name, c.path)).collect()
}

/// Every classic sequence replayed from its fixture.
pub fn classics() -> Vec<Classic> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/classics");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    files.sort();
    let classics: Vec<Classic> = files
        .iter()
        .map(|file| {
            let text = std::fs::read_to_string(file).unwrap_or_default();
            let fixture: Fixture =
                serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", file.display()));
            let mut path = vec![flat(&fixture.sheet, fixture.start)];
            let mut ops = Vec::with_capacity(fixture.steps.len());
            for (op, _) in fixture.steps {
                let state = &path[path.len() - 1];
                let next = match &op {
                    Op::Fold { fold } => state.fold(fold).map(|f| f.state),
                    Op::Precrease { fold } => state.precrease(fold).map(|f| f.state),
                    Op::TurnOver => Ok(state.turn_over()),
                }
                .unwrap_or_else(|e| panic!("{}: {e}", fixture.name));
                path.push(next);
                ops.push(op);
            }
            Classic {
                name: fixture.name,
                path,
                ops,
            }
        })
        .collect();
    assert!(classics.len() >= 4, "only {} classics", classics.len());
    classics
}

fn line(n: Point, d: f64) -> Line {
    Line::new(n, d).unwrap_or_else(|| unreachable!())
}

fn must(state: &State, op: &PlainFold, precrease: bool) -> State {
    let landed = if precrease {
        state.precrease(op)
    } else {
        state.fold(op)
    };
    landed
        .unwrap_or_else(|e| panic!("refused: {e} ({:?})", e.refusal))
        .state
}

/// A square folded in half and in half again, its diagonal precreased
/// through the four layers and refolded, then turned over and rotated: every
/// vertex at a multiple of 1/2, so every kernel coordinate is a short decimal.
pub fn dyadic_path() -> Vec<State> {
    let mut path = vec![flat(&SheetShape::Square, StartSide::Front)];
    let push = |path: &mut Vec<State>, op: PlainFold, precrease: bool| {
        let next = must(&path[path.len() - 1], &op, precrease);
        path.push(next);
    };
    // x = 0.5, the right half over.
    push(
        &mut path,
        PlainFold::new(line([1.0, 0.0], 0.5), Side::Positive, Direction::Valley),
        false,
    );
    // y = 0.5, the top half down.
    push(
        &mut path,
        PlainFold::new(line([0.0, 1.0], 0.5), Side::Positive, Direction::Valley),
        false,
    );
    let s = 0.5_f64.sqrt();
    let diagonal = line([s, -s], 0.0);
    push(
        &mut path,
        PlainFold::new(diagonal, Side::Negative, Direction::Valley),
        true,
    );
    push(
        &mut path,
        PlainFold::new(diagonal, Side::Negative, Direction::Valley),
        false,
    );
    let turned = path[path.len() - 1].turn_over();
    path.push(turned);
    let rotated = path[path.len() - 1].rotate(std::f64::consts::FRAC_PI_2);
    path.push(rotated);
    path
}

/// The sheets random paths start from: square, tall and wide rectangles, and
/// regular polygons, wide (3, 5) and tall (6).
pub fn sheets() -> Vec<Sheet> {
    [
        Ok(Sheet::square()),
        Sheet::rectangle(1.0, 2f64.sqrt()),
        Sheet::rectangle(4.0, 3.0),
        Sheet::regular(3),
        Sheet::regular(5),
        Sheet::regular(6),
    ]
    .into_iter()
    .map(|s| s.unwrap_or_else(|e| panic!("{e}")))
    .collect()
}

/// A random fold line: through two vertex images, or through one at a
/// sixteenth of a turn or a random angle.
fn random_line(state: &State, rng: &mut Rng) -> Option<Line> {
    let n = state.vertices().len();
    let image = |rng: &mut Rng| state.vertex_image(VertexId(rng.below(n) as u32));
    let p = image(rng)?;
    if rng.chance(0.5) {
        let q = image(rng)?;
        ((p[0] - q[0]).hypot(p[1] - q[1]) > 1e-3)
            .then(|| Line::from_points(p, q))
            .flatten()
    } else {
        let angle = if rng.chance(0.6) {
            rng.below(16) as f64 * std::f64::consts::PI / 16.0
        } else {
            rng.next_f64() * std::f64::consts::PI
        };
        Line::from_point_direction(p, [angle.cos(), angle.sin()])
    }
}

/// A seeded random path of up to `steps` states after the flat sheet: folds
/// and precreases through all layers along random lines, refusals skipped,
/// with turn-overs and rotations among them.
pub fn random_path(rng: &mut Rng, sheet: Sheet, steps: usize) -> Vec<State> {
    let start = if rng.chance(0.5) {
        StartSide::Front
    } else {
        StartSide::Back
    };
    let mut path = vec![State::flat(sheet, start).unwrap_or_else(|e| panic!("{e}"))];
    for _ in 0..steps * 8 {
        if path.len() > steps {
            break;
        }
        let state = &path[path.len() - 1];
        let next = match rng.below(12) {
            0 => Some(state.turn_over()),
            1 => Some(state.rotate(rng.next_f64() * std::f64::consts::TAU)),
            _ => random_line(state, rng).and_then(|line| {
                let side = if rng.chance(0.5) {
                    Side::Positive
                } else {
                    Side::Negative
                };
                let direction = if rng.chance(0.5) {
                    Direction::Valley
                } else {
                    Direction::Mountain
                };
                let op = PlainFold::new(line, side, direction);
                let landed = if rng.chance(0.25) {
                    state.precrease(&op)
                } else {
                    state.fold(&op)
                };
                landed.ok().map(|f| f.state)
            }),
        };
        path.extend(next);
    }
    path
}

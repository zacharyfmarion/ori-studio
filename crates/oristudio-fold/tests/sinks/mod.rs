//! The sink spike's named cases (`r2-spike-sinks`, `exp1`–`exp7`): the
//! preliminary and waterbomb bases imported from the samples Fold ships
//! (`tests/fixtures/fold-samples` at the repository root), their sink lines
//! by depth and tilt, the fan point, and every state the cases land. Shared
//! by `tests/sink.rs` and `crates/oracle-tests`' `fold_sink_oracle` (through
//! `#[path]`), so the oracles verify exactly the states the engine's own
//! tests check.

#![allow(dead_code)]

use std::path::PathBuf;

use oristudio_fold::{
    CompletionLimits, CompoundRefused, CreasePatternInput, Direction, ImportKind, ImportSegment,
    ImportSpace, ImportTarget, ImportedPattern, Letter, PlainFold, Seed, Side, SinkChoices,
    SinkFold, SinkFolded, SinkKind, SinkOutcome, StartSide, State, Unsink, VertexId,
};
use oristudio_geometry::Line;
use serde_json::Value;

pub type Point = [f64; 2];

/// The point's tip (the sheet's centre) and where its axis meets the base:
/// a corner on the preliminary base, an edge's midpoint on the waterbomb.
pub const CENTRE: Point = [0.5, 0.5];
pub const PRELIMINARY_FOOT: Point = [0.0, 0.0];
pub const WATERBOMB_FOOT: Point = [0.0, 0.5];

/// A sample of `tests/fixtures/fold-samples`, imported to its one order. The
/// file's own coordinates, as the sheet's: the samples are drawn y-down, so
/// this is the bridge's import mirrored, which folds the same.
pub fn sample(name: &str) -> State {
    import_sample(name, false)
}

/// [`sample`] as the same steps fold it from a sheet started back up (the
/// Paper pane's Back up): each step's valley is the viewer's, so every
/// letter is the other one in the model frame and the stack is reversed,
/// seen turned over.
pub fn sample_turned_over(name: &str) -> State {
    import_sample(name, true)
}

fn import_sample(name: &str, turned: bool) -> State {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/fold-samples")
        .join(format!("{name}.fold"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let fold: Value = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{name}: {e}"));
    let point = |v: &Value| {
        [
            v[0].as_f64().unwrap_or(f64::NAN),
            v[1].as_f64().unwrap_or(f64::NAN),
        ]
    };
    let coords: Vec<Point> = fold["vertices_coords"]
        .as_array()
        .map(|a| a.iter().map(point).collect())
        .unwrap_or_default();
    let hints = &fold["oristudio:edges_fold_direction_hint"];
    let edges = fold["edges_vertices"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let segments = edges
        .iter()
        .enumerate()
        .map(|(e, edge)| {
            let end = |i: usize| coords[edge[i].as_u64().unwrap_or(0) as usize];
            let (mountain, valley) = if turned { ("V", "M") } else { ("M", "V") };
            let kind = match fold["edges_assignment"][e].as_str() {
                Some("B") => ImportKind::Border,
                Some(m) if m == mountain => ImportKind::Mountain,
                Some(v) if v == valley => ImportKind::Valley,
                _ => ImportKind::Unassigned {
                    hint: match (hints[e].as_u64(), turned) {
                        (Some(1), false) | (Some(2), true) => Some(Letter::Mountain),
                        (Some(2), false) | (Some(1), true) => Some(Letter::Valley),
                        _ => None,
                    },
                },
            };
            ImportSegment {
                from: end(0),
                to: end(1),
                kind,
            }
        })
        .collect();
    let pattern = ImportedPattern::new(
        &CreasePatternInput {
            space: ImportSpace::Sheet,
            segments,
        },
        ImportTarget::Empty {
            start: if turned {
                StartSide::Back
            } else {
                StartSide::Front
            },
        },
    )
    .unwrap_or_else(|e| panic!("{name}: {e}"));
    let completions = pattern
        .complete(&CompletionLimits::default())
        .unwrap_or_else(|e| panic!("{name}: {e}"));
    assert!(completions.is_unique(), "{name}: {:?}", completions.count());
    let order = completions
        .order(&vec![0; completions.components().len()])
        .unwrap_or_default();
    pattern
        .state(order)
        .unwrap_or_else(|e| panic!("{name}: {e}"))
}

pub fn preliminary() -> State {
    sample("preliminary-base")
}

pub fn waterbomb() -> State {
    sample("waterbomb-base")
}

/// The model-frame image of the crease-pattern vertex at a sheet point.
pub fn image_at(state: &State, at: Point) -> Point {
    let v = state
        .vertices()
        .iter()
        .position(|p| (p[0] - at[0]).abs() < 1e-12 && (p[1] - at[1]).abs() < 1e-12)
        .unwrap_or_else(|| panic!("no vertex at {at:?}"));
    state
        .vertex_image(VertexId(v as u32))
        .unwrap_or_else(|| panic!("no image of {at:?}"))
}

/// The sink line square to the point's axis, a fraction `f` of the way from
/// the tip to `foot`, turned by `tilt` degrees about where it crosses the
/// axis; and the side the tip is on.
pub fn sink_line(state: &State, foot: Point, f: f64, tilt: f64) -> (Line, Side) {
    let (a, b) = (image_at(state, CENTRE), image_at(state, foot));
    let at = [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])];
    let t = tilt.to_radians();
    let d = [b[0] - a[0], b[1] - a[1]];
    let n = [
        d[0] * t.cos() - d[1] * t.sin(),
        d[0] * t.sin() + d[1] * t.cos(),
    ];
    let line = Line::new(n, n[0] * at[0] + n[1] * at[1]).unwrap_or_else(|| unreachable!());
    let side = Side::of_point(&line, a).unwrap_or_else(|| unreachable!());
    (line, side)
}

/// A sink of the whole point along [`sink_line`].
pub fn sink_op(state: &State, foot: Point, f: f64, tilt: f64, kind: SinkKind) -> SinkFold {
    let (line, side) = sink_line(state, foot, f, tilt);
    SinkFold {
        line,
        side,
        anchor: Seed::All,
        kind,
    }
}

pub fn landed(outcome: Result<SinkOutcome, CompoundRefused>, what: &str) -> SinkFolded {
    match outcome {
        Ok(SinkOutcome::Landed(folded)) => *folded,
        Ok(SinkOutcome::ChoosePocket(point)) => {
            panic!("{what}: choose a pocket of {:?}", point.pockets)
        }
        Ok(SinkOutcome::ChooseOrder(choice)) => {
            panic!("{what}: choose an order of {:?}", choice.count())
        }
        Err(e) => panic!("{what}: {e} {e:?}"),
    }
}

/// Every closed sink of the point, one per pocket, each the one state its
/// pocket lands.
pub fn closed_sinks(state: &State, op: &SinkFold) -> Vec<SinkFolded> {
    let op = SinkFold {
        kind: SinkKind::Closed,
        ..op.clone()
    };
    let point = state.analyse_sink(&op).unwrap_or_else(|e| panic!("{e}"));
    point
        .pockets
        .iter()
        .map(|pocket| {
            let choices = SinkChoices {
                pocket: Some(pocket.stored.clone()),
                order: None,
            };
            landed(state.sink(&op, &choices), "closed")
        })
        .collect()
}

/// The samples are drawn y-down, the spike's sheet y-up: a sheet point of
/// one is the other's mirrored in y.
pub fn spike(p: Point) -> Point {
    [p[0], 1.0 - p[1]]
}

/// The spike's T1..T8 around the centre (`bases.mjs`): the centre and two
/// neighbours of k1 = (0, 0), m1 = (0, 0.5), k2 = (0, 1) and on round.
pub const SPOKES: [Point; 9] = [
    [0.0, 0.0],
    [0.0, 0.5],
    [0.0, 1.0],
    [0.5, 1.0],
    [1.0, 1.0],
    [1.0, 0.5],
    [1.0, 0.0],
    [0.5, 0.0],
    [0.0, 0.0],
];

/// The triangle T1..T8 holding a sample's sheet point.
pub fn triangle(p: Point) -> usize {
    let p = spike(p);
    let cross = |a: Point, b: Point| (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    (0..8)
        .find(|&k| {
            let (a, b) = (SPOKES[k], SPOKES[k + 1]);
            let s = [cross(CENTRE, a), cross(a, b), cross(b, CENTRE)];
            s.iter().all(|&x| x >= -1e-9) || s.iter().all(|&x| x <= 1e-9)
        })
        .map_or(0, |k| k + 1)
}

/// A sample's sheet point in T`k` (1-based) at `depth` of the point's axis
/// from the centre on the preliminary base: on the line from the centre to
/// the triangle's centroid, which is at half the axis.
pub fn in_triangle(k: usize, depth: f64) -> Point {
    let (a, b) = (SPOKES[k - 1], SPOKES[k]);
    let c = [
        (CENTRE[0] + a[0] + b[0]) / 3.0,
        (CENTRE[1] + a[1] + b[1]) / 3.0,
    ];
    let s = 2.0 * depth;
    spike([
        CENTRE[0] + s * (c[0] - CENTRE[0]),
        CENTRE[1] + s * (c[1] - CENTRE[1]),
    ])
}

/// The preliminary base folded in half along its axis: the spike's fan
/// point, eight layers hinged in turn on its two sides.
pub fn fan() -> State {
    let base = preliminary();
    let (a, b) = (image_at(&base, CENTRE), image_at(&base, PRELIMINARY_FOOT));
    let axis = Line::from_points(a, b).unwrap_or_else(|| unreachable!());
    let side = Side::of_point(&axis, image_at(&base, [0.0, 0.5])).unwrap_or_else(|| unreachable!());
    base.fold(&PlainFold::new(axis, side, Direction::Valley))
        .unwrap_or_else(|e| panic!("{e}"))
        .state
}

/// The unsink of a sink: the ring's line, the side the sunk tip lies on now,
/// and a sheet point of its first triangle's piece (`f` the sink's depth).
pub fn unsink_op(folded: &SinkFolded, f: f64) -> Unsink {
    Unsink {
        line: folded.report.line,
        side: folded.report.side.opposite(),
        anchor: Seed::Flaps {
            at: vec![in_triangle(1, f / 2.0)],
        },
    }
}

/// Every state the named cases land, labelled: open and closed sinks of
/// both bases at depths to past half the point, closed sinks under tilt,
/// the precreased ring, the second sink, the fan's seven pockets and the
/// unsinks back.
pub fn cases() -> Vec<(String, State)> {
    let mut out = Vec::new();
    let mut sinks = |label: &str, state: &State, op: &SinkFold, open: bool| {
        if open {
            let folded = landed(state.sink(op, &SinkChoices::default()), label);
            out.push((format!("{label} open"), folded.state));
        }
        for (k, folded) in closed_sinks(state, op).into_iter().enumerate() {
            out.push((format!("{label} closed {k}"), folded.state));
        }
    };
    let base = preliminary();
    for f in [0.05, 0.3, 0.49, 0.6, 0.8] {
        let op = sink_op(&base, PRELIMINARY_FOOT, f, 0.0, SinkKind::Open);
        sinks(&format!("preliminary f={f}"), &base, &op, true);
    }
    for tilt in [1.0, 15.0] {
        let op = sink_op(&base, PRELIMINARY_FOOT, 0.3, tilt, SinkKind::Open);
        sinks(&format!("preliminary tilt {tilt}"), &base, &op, false);
    }
    let bomb = waterbomb();
    for f in [0.2, 0.3, 0.45] {
        let op = sink_op(&bomb, WATERBOMB_FOOT, f, 0.0, SinkKind::Open);
        sinks(&format!("waterbomb f={f}"), &bomb, &op, true);
    }
    let fan = fan();
    let op = sink_op(&fan, PRELIMINARY_FOOT, 0.3, 0.0, SinkKind::Closed);
    sinks("fan", &fan, &op, false);
    // The precreased ring, the second sink and the unsinks.
    let f = 0.3;
    let (line, side) = sink_line(&base, PRELIMINARY_FOOT, f, 0.0);
    let precreased = base
        .precrease(&PlainFold::new(line, side, Direction::Valley))
        .unwrap_or_else(|e| panic!("{e}"))
        .state;
    let op = sink_op(&base, PRELIMINARY_FOOT, f, 0.0, SinkKind::Open);
    let ring = landed(precreased.sink(&op, &SinkChoices::default()), "precreased");
    out.push(("precreased ring open".to_string(), ring.state));
    let open = landed(base.sink(&op, &SinkChoices::default()), "open");
    let deeper = sink_op(&base, PRELIMINARY_FOOT, 0.4, 0.0, SinkKind::Open);
    let second = landed(open.state.sink(&deeper, &SinkChoices::default()), "second");
    out.push(("second open sink".to_string(), second.state));
    let mut sunk = vec![open];
    sunk.extend(closed_sinks(&base, &op));
    for folded in sunk {
        let back = landed(
            folded
                .state
                .unsink(&unsink_op(&folded, f), &SinkChoices::default()),
            "unsink",
        );
        out.push((format!("unsink of {:?}", folded.report.step), back.state));
    }
    out
}

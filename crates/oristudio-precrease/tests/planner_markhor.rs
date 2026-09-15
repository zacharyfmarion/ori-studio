//! The picks on a folded markhor, step by step.
//!
//! Zach folded markhor from the References workspace and came back with 26
//! steps that were hard, inaccurate or wrongly described
//! (`implementation-plans/precrease-legible-picks.md`). Each is pinned here
//! to the fold the plan settled on, found by its line rather than its step
//! number, so a later rule cannot silently undo this one. The design is a
//! real-world file that is not committed: `ORI_PRECREASE_MARKHOR` names it
//! (`markhor_feedback.fold`), and without it the test skips.

use std::f64::consts::FRAC_1_SQRT_2;

use oristudio_precrease::clock::default_clock;
use oristudio_precrease::direction::Side;
use oristudio_precrease::fixture_io::load_path;
use oristudio_precrease::line::Line;
use oristudio_precrease::planner::{Planner, PlannerOptions};
use oristudio_precrease::predicates::{Ref, Witness};
use oristudio_precrease::sequence::{Sequence, Step, StepKind};
use oristudio_precrease::sheet::{CornerName, EdgeSide};
use oristudio_precrease::{Direction, analyze};

/// What a step's card should present: the axiom, the face it is made from,
/// and the references it names — marks by where they are, creases by their
/// line, edges and corners by name — where Zach named them or the rule
/// determines them; `None`/empty where any fold of the kind will do.
struct Expect {
    /// Zach's step number in the feedback, for the message.
    item: u32,
    /// The fold's line: normal and offset.
    line: (f64, f64, f64),
    /// The kinds of fold that answer the item; empty for any.
    axioms: &'static [u8],
    side: Option<Side>,
    points: &'static [(f64, f64)],
    edges: &'static [EdgeSide],
    corners: &'static [CornerName],
    lines: &'static [(f64, f64, f64)],
    /// The pinned witness is one the folder can watch (R1).
    visible: bool,
}

const ANY: Expect = Expect {
    item: 0,
    line: (0.0, 0.0, 0.0),
    axioms: &[],
    side: None,
    points: &[],
    edges: &[],
    corners: &[],
    lines: &[],
    visible: true,
};

const EXPECTED: &[Expect] = &[
    // 21: a corner swung onto x = ¾ about the mark at (¾, ¾), not two
    // interior lines lined up under the paper.
    Expect {
        item: 21,
        line: (0.3827, 0.9239, 0.97992),
        axioms: &[5],
        points: &[(0.75, 0.75)],
        corners: &[CornerName::Ne],
        ..ANY
    },
    // 30: a crease 0.02 long; nothing great, but a fold the folder can watch.
    Expect {
        item: 30,
        line: (FRAC_1_SQRT_2, FRAC_1_SQRT_2, 1.00888),
        ..ANY
    },
    // 31, 32: the 45° crease folded onto itself at the crease's own end, or
    // an edge mark carried onto a crease perpendicular to it — a fold made
    // at the crease — over a pair three quarters of a sheet away.
    Expect {
        item: 31,
        line: (FRAC_1_SQRT_2, FRAC_1_SQRT_2, 0.98744),
        axioms: &[4, 7],
        ..ANY
    },
    Expect {
        item: 32,
        line: (FRAC_1_SQRT_2, FRAC_1_SQRT_2, 0.65533),
        axioms: &[6, 7],
        ..ANY
    },
    // 34: the crease through its two edge marks 0.91 apart — the accuracy
    // override — over two points a fifth apart.
    Expect {
        item: 34,
        line: (FRAC_1_SQRT_2, FRAC_1_SQRT_2, 0.45711),
        axioms: &[1],
        points: &[(0.0, 0.6464), (0.6464, 0.0)],
        ..ANY
    },
    // 36: a short crease joined between its own marks.
    Expect {
        item: 36,
        line: (0.0, 1.0, 0.82322),
        axioms: &[1],
        points: &[(0.4268, 0.8232), (0.5732, 0.8232)],
        ..ANY
    },
    // 37: Zach's suggestion — the top edge's midpoint onto the mark below it,
    // at the crease.
    Expect {
        item: 37,
        line: (0.0, 1.0, 0.91161),
        axioms: &[2],
        points: &[(0.5, 1.0), (0.5, 0.8232)],
        ..ANY
    },
    // 48: the top edge onto x = ⅜ — a bisection at the crease's end.
    Expect {
        item: 48,
        line: (FRAC_1_SQRT_2, FRAC_1_SQRT_2, 0.97227),
        axioms: &[3],
        edges: &[EdgeSide::Top],
        lines: &[(1.0, 0.0, 0.375)],
        ..ANY
    },
    // 56: a short crease between two creases, a fold the folder can watch.
    // (Pinching it as a mountain from the front was tried and undone: every
    // fold is a valley from the face it is made on.)
    Expect {
        item: 56,
        line: (0.3827, 0.9239, 0.72093),
        ..ANY
    },
    // 58: the left edge swung onto a mark, not two interior points.
    Expect {
        item: 58,
        line: (0.9239, 0.3827, 0.64167),
        axioms: &[5],
        edges: &[EdgeSide::Left],
        ..ANY
    },
    // 71: x = ½ onto the 45° crease, a bisection at (½, 1).
    Expect {
        item: 71,
        line: (0.9239, 0.3827, 0.84462),
        axioms: &[3],
        lines: &[(1.0, 0.0, 0.5)],
        ..ANY
    },
    // 73: a bisection at the left edge, not a fold onto a crease's end.
    Expect {
        item: 73,
        line: (0.9239, 0.3827, 0.38268),
        axioms: &[3],
        edges: &[EdgeSide::Left],
        ..ANY
    },
    // 81: two marks at the crease — its own end and one along the line —
    // not two 0.06 apart.
    Expect {
        item: 81,
        line: (0.3827, 0.9239, 0.62526),
        axioms: &[1],
        points: &[(0.25, 0.5732)],
        ..ANY
    },
    // 93: the crease between its own marks, or the right edge carried onto
    // a mark perpendicular to the diagonal — at the crease either way — not
    // a swing whose pivot grazes the landing line.
    Expect {
        item: 93,
        line: (FRAC_1_SQRT_2, -FRAC_1_SQRT_2, 0.5),
        axioms: &[1, 4, 7],
        ..ANY
    },
    // 103, 104: the top edge folded onto itself through the crease's start
    // point — Zach's ask — not two interior points, and not an edge mark
    // onto a mark that would first have to be pinched.
    Expect {
        item: 103,
        line: (1.0, 0.0, 0.28661),
        axioms: &[4],
        points: &[(0.2866, 0.9634)],
        edges: &[EdgeSide::Top],
        ..ANY
    },
    Expect {
        item: 104,
        line: (1.0, 0.0, 0.71339),
        axioms: &[4],
        points: &[(0.7134, 0.9634)],
        edges: &[EdgeSide::Top],
        ..ANY
    },
    // 122: the crease's own ends, 0.18 apart.
    Expect {
        item: 122,
        line: (FRAC_1_SQRT_2, FRAC_1_SQRT_2, 1.09727),
        axioms: &[1],
        points: &[(0.7134, 0.8384), (0.5884, 0.9634)],
        ..ANY
    },
    // 127, 129, 140, 142: bisections whose vertex is the crease's end.
    Expect {
        item: 127,
        line: (0.3827, 0.9239, 0.59724),
        axioms: &[3],
        ..ANY
    },
    Expect {
        item: 129,
        line: (0.3827, 0.9239, 0.38268),
        axioms: &[3],
        edges: &[EdgeSide::Bottom],
        ..ANY
    },
    // 136: the top edge's midpoint onto the mark below it — one alignment
    // on the centre line, which keeps the fold straight by itself.
    Expect {
        item: 136,
        line: (0.0, 1.0, 0.78661),
        axioms: &[2],
        points: &[(0.5, 1.0), (0.5, 0.5732)],
        ..ANY
    },
    Expect {
        item: 140,
        line: (0.3827, -0.9239, -0.21456),
        axioms: &[3],
        ..ANY
    },
    Expect {
        item: 142,
        line: (0.3827, -0.9239, 0.0),
        axioms: &[3],
        edges: &[EdgeSide::Bottom],
        ..ANY
    },
    // 146: the crease's own ends, 0.10 apart.
    Expect {
        item: 146,
        line: (FRAC_1_SQRT_2, -FRAC_1_SQRT_2, 0.42678),
        axioms: &[1],
        points: &[(0.9268, 0.3232), (1.0, 0.3964)],
        ..ANY
    },
    Expect {
        item: 147,
        line: (FRAC_1_SQRT_2, -FRAC_1_SQRT_2, 0.40533),
        axioms: &[1],
        points: &[(0.75, 0.1768), (0.7714, 0.1982)],
        ..ANY
    },
    // 157: from its top mark down to the next mark along the line — the
    // pattern's own lower end is on no crease yet, so the crease runs on to
    // where one is (the reach rule) and is joined mark to mark.
    Expect {
        item: 157,
        line: (0.9239, -0.3827, -0.08406),
        axioms: &[1],
        points: &[(0.1616, 0.6098)],
        ..ANY
    },
    // 158: two pieces of 0.19 and 0.38, made from the back as the mountain
    // it is; a corner brought onto a mark.
    Expect {
        item: 158,
        line: (0.9239, -0.3827, -0.05604),
        axioms: &[2, 3],
        side: Some(Side::Back),
        ..ANY
    },
    // 48 (second round): a crease folded onto itself whose other arm lay
    // wholly under the flap is not a fold the folder can watch; the right
    // edge swung onto a mark, or an edge mark carried onto a crease
    // perpendicular to the diagonal, at the crease, is.
    Expect {
        item: 48,
        line: (FRAC_1_SQRT_2, FRAC_1_SQRT_2, 1.02405),
        axioms: &[5, 7],
        ..ANY
    },
];

fn same_line(a: &Line, b: &Line) -> bool {
    let close = |x: f64, y: f64| (x - y).abs() <= 2e-4;
    (close(a.n[0], b.n[0]) && close(a.n[1], b.n[1]) && close(a.d, b.d))
        || (close(a.n[0], -b.n[0]) && close(a.n[1], -b.n[1]) && close(a.d, -b.d))
}

fn line_of(seq: &Sequence, r: &Ref) -> Option<Line> {
    let Ref::Line { id } = r else {
        return None;
    };
    let step = seq.lines.iter().find(|l| l.id == *id)?.step?;
    Some(seq.steps.iter().find(|s| s.id == step)?.line)
}

fn point_of(seq: &Sequence, r: &Ref) -> Option<[f64; 2]> {
    match r {
        Ref::Point { id } | Ref::Corner { id, .. } => {
            seq.points.iter().find(|p| p.id == *id).map(|p| p.p)
        }
        _ => None,
    }
}

fn describe(seq: &Sequence, w: &Witness) -> String {
    let inputs: Vec<String> = w
        .inputs
        .iter()
        .map(|r| match r {
            Ref::Edge { side, .. } => format!("edge {side:?}"),
            Ref::Corner { corner, .. } => format!("corner {corner:?}"),
            Ref::Point { .. } => point_of(seq, r)
                .map(|p| format!("({:.4},{:.4})", p[0], p[1]))
                .unwrap_or_else(|| "?".into()),
            Ref::Line { .. } => line_of(seq, r)
                .map(|l| format!("line n=({:.4},{:.4}) d={:.5}", l.n[0], l.n[1], l.d))
                .unwrap_or_else(|| "?".into()),
        })
        .collect();
    format!("O{} [{}]", w.axiom, inputs.join(", "))
}

fn check(seq: &Sequence, step: &Step, e: &Expect) -> Result<(), String> {
    let w = step
        .chosen
        .and_then(|c| step.witnesses.get(c))
        .ok_or_else(|| "no witness presented".to_string())?;
    let got = describe(seq, w);
    if !e.axioms.is_empty() && !e.axioms.contains(&w.axiom) {
        return Err(format!("expected one of O{:?}, got {got}", e.axioms));
    }
    if let Some(side) = e.side
        && step.side != side
    {
        return Err(format!(
            "expected the fold made from the {side:?}, got {:?} ({got}, {:?})",
            step.side, step.direction
        ));
    }
    if e.visible && !w.visible {
        return Err(format!("expected a fold the folder can watch, got {got}"));
    }
    if step.impractical {
        return Err(format!("presented as impractical: {got}"));
    }
    for &(x, y) in e.points {
        let found = w
            .inputs
            .iter()
            .filter_map(|r| point_of(seq, r))
            .any(|p| (p[0] - x).hypot(p[1] - y) <= 2e-4);
        if !found {
            return Err(format!("expected the mark ({x:.4},{y:.4}), got {got}"));
        }
    }
    for side in e.edges {
        if !w
            .inputs
            .iter()
            .any(|r| matches!(r, Ref::Edge { side: s, .. } if s == side))
        {
            return Err(format!("expected the {side:?} edge, got {got}"));
        }
    }
    for corner in e.corners {
        if !w
            .inputs
            .iter()
            .any(|r| matches!(r, Ref::Corner { corner: c, .. } if c == corner))
        {
            return Err(format!("expected the {corner:?} corner, got {got}"));
        }
    }
    for &(n0, n1, d) in e.lines {
        let want = Line::new([n0, n1], d).expect("line");
        if !w
            .inputs
            .iter()
            .filter_map(|r| line_of(seq, r))
            .any(|l| same_line(&l, &want))
        {
            return Err(format!(
                "expected the crease n=({n0:.4},{n1:.4}) d={d:.5}, got {got}"
            ));
        }
    }
    Ok(())
}

#[test]
fn markhor_feedback_picks_are_the_ones_zach_asked_for() {
    let Ok(path) = std::env::var("ORI_PRECREASE_MARKHOR") else {
        eprintln!("ORI_PRECREASE_MARKHOR is not set; skipping");
        return;
    };
    let cp = load_path(std::path::Path::new(&path), None).expect("load markhor");
    let analysis = analyze(
        &cp.segments,
        &cp.colors,
        Some([-200.0, -200.0, 200.0, 200.0]),
    )
    .expect("analyze");
    let opts = PlannerOptions {
        clock: default_clock(),
        ..PlannerOptions::default()
    };
    let mut planner = Planner::new(&analysis.components[0], opts);
    planner.plan_without_reference_finder().expect("plan");
    let seq = planner.sequence(false);
    assert_eq!(seq.steps.len(), 163, "markhor steps");
    assert_eq!(seq.totals.presses, 0, "markhor presses");
    assert!(
        seq.steps.iter().all(|s| !s.impractical),
        "every fold on this sheet has a practical construction"
    );
    assert!(
        seq.steps
            .iter()
            .all(|s| s.direction != Direction::Unassigned || s.kind != StepKind::Cp),
        "every CP step has a direction"
    );
    let mut failures = Vec::new();
    // 50 (second round): "fold through P and Q" is creased all the way to
    // both — every O1 step's crease covers both its marks.
    for step in seq.steps.iter().filter(|s| s.kind == StepKind::Cp) {
        let Some(w) = step.chosen.and_then(|c| step.witnesses.get(c)) else {
            continue;
        };
        if w.axiom != 1 {
            continue;
        }
        let runs: Vec<(f64, f64)> = step
            .made
            .iter()
            .map(|[a, b]| {
                let (u, v) = (step.line.parameter_of(*a), step.line.parameter_of(*b));
                (u.min(v), v.max(u))
            })
            .collect();
        for r in &w.inputs {
            let Some(p) = point_of(&seq, r) else {
                continue;
            };
            let t = step.line.parameter_of(p);
            if !runs.iter().any(|(u, v)| t >= u - 1e-6 && t <= v + 1e-6) {
                failures.push(format!(
                    "step {}: the crease {:?} does not reach its mark ({:.4},{:.4})",
                    step.id, step.made, p[0], p[1]
                ));
            }
        }
    }
    for e in EXPECTED {
        let want = Line::new([e.line.0, e.line.1], e.line.2).expect("line");
        let Some(step) = seq
            .steps
            .iter()
            .find(|s| s.kind == StepKind::Cp && same_line(&s.line, &want))
        else {
            failures.push(format!("item {}: no CP step folds its line", e.item));
            continue;
        };
        if let Err(why) = check(&seq, step, e) {
            failures.push(format!("item {} (step {}): {why}", e.item, step.id));
        }
    }
    assert!(failures.is_empty(), "\n{}", failures.join("\n"));
}

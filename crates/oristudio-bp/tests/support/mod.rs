//! Helpers for tests that replay upstream's contour specs and compare against
//! paths captured from `tools/bp-studio-oracle`.

// Each test binary compiles this module and uses a different subset of it.
#![allow(dead_code)]

use oristudio_bp::io::bps;
use oristudio_bp::io::cp::{LayoutGraphicsSnapshot, project_graphics_snapshot};
use oristudio_bp::model::{Point, Project};
use serde_json::json;
use std::collections::BTreeSet;

/// A project in upstream's test notation (`test/utils/tree.ts#parseTree`):
/// edges as `(n1,n2,length)`, flaps as `(id,x,y,width,height)`.
pub fn parse_tree(edges: &str, flaps: &str) -> Project {
    let edges = tuples(edges)
        .into_iter()
        .map(|[n1, n2, length]| json!({ "n1": n1, "n2": n2, "length": length }))
        .collect::<Vec<_>>();
    let ids = edges
        .iter()
        .flat_map(|edge| [edge["n1"].clone(), edge["n2"].clone()])
        .map(|id| id.as_i64().expect("integral node id"))
        .collect::<BTreeSet<_>>();
    let flaps = tuples(flaps)
        .into_iter()
        .map(|[id, x, y, width, height]| {
            json!({ "id": id, "x": x, "y": y, "width": width, "height": height })
        })
        .collect::<Vec<_>>();
    let project = json!({
        "version": "0.7",
        "design": {
            "title": "",
            "mode": "layout",
            "layout": {
                "sheet": { "type": "rect", "width": 128, "height": 128 },
                "flaps": flaps,
                "stretches": [],
            },
            "tree": {
                "sheet": { "type": "rect", "width": 20, "height": 20 },
                "nodes": ids
                    .into_iter()
                    .map(|id| json!({ "id": id, "x": 0, "y": 0, "name": "" }))
                    .collect::<Vec<_>>(),
                "edges": edges,
            },
        },
    });
    bps::load_project_str(&project.to_string()).expect("project loads")
}

pub fn graphics(project: &Project) -> LayoutGraphicsSnapshot {
    project_graphics_snapshot(project).expect("graphics snapshot")
}

/// The outer path of the one contour a graphics tag (`re90,94`, `f31`, …) has.
pub fn single_outer(snapshot: &LayoutGraphicsSnapshot, tag: &str) -> Vec<Point> {
    let entry = snapshot
        .node_graphics
        .iter()
        .chain(&snapshot.device_graphics)
        .find(|entry| entry.id == tag)
        .unwrap_or_else(|| panic!("no graphics for {tag}"));
    assert_eq!(entry.data.contours.len(), 1, "{tag} has one contour");
    entry.data.contours[0].outer.clone()
}

/// Assert a closed path against upstream's notation, e.g.
/// `"(71,127),(71,80),(238/3,80)"`. Rings may start at a different vertex of
/// the same cycle, which the oracle harness documents as harmless.
pub fn assert_ring(actual: &[Point], expected: &str) {
    let expected = parse_points(expected);
    let rotated = (0..actual.len()).find_map(|shift| {
        let ring = actual[shift..]
            .iter()
            .chain(&actual[..shift])
            .copied()
            .collect::<Vec<_>>();
        same_path(&ring, &expected).then_some(ring)
    });
    assert!(
        rotated.is_some(),
        "expected {}\n     got {}",
        format_path(&expected),
        format_path(actual)
    );
}

pub fn parse_points(text: &str) -> Vec<Point> {
    text.trim_matches(|c| c == '(' || c == ')')
        .split("),(")
        .map(|pair| {
            let (x, y) = pair.split_once(',').expect("coordinate pair");
            Point {
                x: parse_number(x),
                y: parse_number(y),
            }
        })
        .collect()
}

pub fn format_path(points: &[Point]) -> String {
    points
        .iter()
        .map(|point| format!("({},{})", point.x, point.y))
        .collect::<Vec<_>>()
        .join(",")
}

pub fn same_path(actual: &[Point], expected: &[Point]) -> bool {
    actual.len() == expected.len()
        && actual
            .iter()
            .zip(expected)
            .all(|(a, e)| (a.x - e.x).abs() < 1e-9 && (a.y - e.y).abs() < 1e-9)
}

fn parse_number(text: &str) -> f64 {
    match text.split_once('/') {
        Some((numerator, denominator)) => {
            numerator.parse::<f64>().expect("numerator")
                / denominator.parse::<f64>().expect("denominator")
        }
        None => text.parse().expect("number"),
    }
}

fn tuples<const N: usize>(text: &str) -> Vec<[i64; N]> {
    text.split("),")
        .filter(|part| !part.trim().is_empty())
        .map(|part| {
            let values = part
                .trim_matches(|c| c == '(' || c == ')' || c == ' ')
                .split(',')
                .map(|value| value.parse::<i64>().expect("integer"))
                .collect::<Vec<_>>();
            values.try_into().expect("tuple arity")
        })
        .collect()
}

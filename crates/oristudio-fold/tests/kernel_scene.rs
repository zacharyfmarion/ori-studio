//! Fold's scene against the kernel's (plan D12): every Fold scene reads as
//! the kernel's `FoldedPaperScene`, field for field, and the kernel's own
//! folded figure of the same crease pattern (Oriedita's estimate, through
//! `oristudio_cp::folding`) agrees with it from the front (`Front0`) and from
//! the back (`Back1`): the same faces up, and the same stacks as seen.
//!
//! The kernel folds folding colours only, so it merges faces across an
//! unfolded crease (research §7.2); faces are matched through a sheet point
//! inside each of Fold's faces, many to one.

mod support;

use std::collections::BTreeSet;

use oristudio_cp::folding::{
    FoldedFigureModel, FoldedFigureState, FoldedPaperScene, folded_figure_paper_scene_from_segments,
};
use oristudio_cp::geometry::{LineColor, LineSegment, Point as KernelPoint};
use oristudio_fold::{CreaseKind, Direction, FoldScene, Letter, Sheet, StartSide, State};
use oristudio_geometry::{Line, convex};
use serde_json::Value;
use support::*;

use Direction::Valley;

/// The kite base: precrease the diagonal, fold the two edges to it.
fn kite() -> State {
    let flat = State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"));
    let s = precrease(
        &flat,
        &all(through([0.0, 0.0], [1.0, 1.0]), [0.9, 0.1], Valley),
    )
    .state;
    let bottom: Line = through([0.0, 0.0], [1.0, 2f64.sqrt() - 1.0]);
    let left: Line = through([0.0, 0.0], [2f64.sqrt() - 1.0, 1.0]);
    let s = fold(&s, &all(bottom, [0.9, 0.05], Valley)).state;
    fold(&s, &all(left, [0.05, 0.9], Valley)).state
}

/// A strip folded in thirds as a Z: the right third valley over the middle,
/// the left third mountain under it.
fn zigzag() -> State {
    let strip = State::flat(
        Sheet::rectangle(1.0, 0.25).unwrap_or_else(|e| panic!("{e}")),
        StartSide::Front,
    )
    .unwrap_or_else(|e| panic!("{e}"));
    let s = fold(&strip, &all(x_eq(2.0 / 3.0), [0.9, 0.1], Valley)).state;
    fold(&s, &all(x_eq(1.0 / 3.0), [0.1, 0.1], Direction::Mountain)).state
}

/// The state's crease pattern in the kernel's colours (plan D10): B, M, V;
/// an unfolded crease is no folding line.
fn segments(state: &State) -> Vec<LineSegment> {
    state
        .creases()
        .iter()
        .filter_map(|c| {
            let color = match c.kind {
                CreaseKind::Border => LineColor::Black0,
                CreaseKind::Folded(Letter::Mountain) => LineColor::Red1,
                CreaseKind::Folded(Letter::Valley) => LineColor::Blue2,
                CreaseKind::Flat(_) => return None,
            };
            let [a, b] = c
                .vertices
                .map(|v| state.vertices()[v.0 as usize])
                .map(|p| KernelPoint::new(p[0], p[1]));
            Some(LineSegment::with_color(a, b, color))
        })
        .collect()
}

fn kernel_scene(
    segments: &[LineSegment],
    start: i32,
    state: FoldedFigureState,
) -> FoldedPaperScene {
    let model = FoldedFigureModel {
        state,
        ..FoldedFigureModel::default()
    };
    folded_figure_paper_scene_from_segments(segments, &[], start, &model)
        .unwrap_or_else(|e| panic!("{e:?}"))
        .unwrap_or_else(|| panic!("the kernel drew nothing"))
}

/// The kernel face whose sheet polygon holds the sheet point.
fn kernel_face_at(scene: &FoldedPaperScene, p: Point) -> usize {
    let hits: Vec<usize> = (0..scene.faces.len())
        .filter(|&f| {
            let ring: Vec<Point> = scene.faces[f]
                .points
                .iter()
                .map(|&i| [scene.sheet_points[i].x, scene.sheet_points[i].y])
                .collect();
            convex::contains_point(&convex::normalize(&ring), p, 1e-9)
        })
        .collect();
    assert_eq!(hits.len(), 1, "{p:?} is in kernel faces {hits:?}");
    hits[0]
}

/// A point inside one of Fold's faces, on the sheet.
fn inside(state: &State, f: usize) -> Point {
    let ring: Vec<Point> = state.faces()[f]
        .ring
        .iter()
        .map(|v| state.vertices()[v.0 as usize])
        .collect();
    convex::centroid(&ring).unwrap_or_else(|| unreachable!())
}

/// Every (upper, lower) pair of faces some subface stacks, as seen.
fn seen_pairs(stacks: impl Iterator<Item = Vec<usize>>) -> BTreeSet<(usize, usize)> {
    let mut out = BTreeSet::new();
    for stack in stacks {
        for i in 0..stack.len() {
            for j in i + 1..stack.len() {
                if stack[i] != stack[j] {
                    out.insert((stack[i], stack[j]));
                }
            }
        }
    }
    out
}

fn agrees_with_the_kernel(name: &str, state: &State) {
    let segments = segments(state);
    let probe = kernel_scene(&segments, 1, FoldedFigureState::Front0);
    // Start the kernel's walk at the face holding Fold's root, which is front
    // up in Fold's model frame: then the two agree on which side is the front.
    let root = state
        .faces()
        .iter()
        .position(|f| f.id == state.root())
        .unwrap_or_else(|| unreachable!());
    let start = kernel_face_at(&probe, inside(state, root)) as i32 + 1;
    let map: Vec<usize> = (0..state.faces().len())
        .map(|f| kernel_face_at(&probe, inside(state, f)))
        .collect();

    for (pass, ours) in [
        (FoldedFigureState::Front0, state.scene()),
        (FoldedFigureState::Back1, state.turn_over().scene()),
    ] {
        let kernel = kernel_scene(&segments, start, pass);
        assert_eq!(kernel.flipped, ours.flipped, "{name} {pass:?}");
        for (f, face) in ours.faces.iter().enumerate() {
            assert_eq!(
                face.front_up, kernel.faces[map[f]].front_up,
                "{name} {pass:?}: face {f} up"
            );
        }
        let theirs = seen_pairs(
            kernel
                .subfaces
                .iter()
                .map(|s| s.faces_top_to_bottom.clone()),
        );
        let mine = seen_pairs(
            ours.subfaces
                .iter()
                .map(|s| s.faces_top_to_bottom.iter().map(|&f| map[f]).collect()),
        );
        assert!(!theirs.is_empty(), "{name}: nothing stacked");
        assert_eq!(mine, theirs, "{name} {pass:?}: stacks as seen");
    }
}

#[test]
fn the_kite_base_agrees_with_the_kernel_front_and_back() {
    agrees_with_the_kernel("kite", &kite());
}

#[test]
fn a_zigzag_agrees_with_the_kernel_front_and_back() {
    let s = zigzag();
    assert_eq!(s.faces().len(), 3);
    agrees_with_the_kernel("zigzag", &s);
}

/// Serialised, a Fold scene is a kernel scene with more keys: the kernel's
/// type reads it, and writes back exactly the kernel's part of it.
#[test]
fn a_fold_scene_reads_as_a_kernel_scene() {
    for state in [kite(), kite().turn_over(), zigzag().rotate(0.4)] {
        let ours: FoldScene = state.scene();
        let json = serde_json::to_value(&ours).unwrap_or_default();
        let kernel: FoldedPaperScene = serde_json::from_value(json.clone())
            .unwrap_or_else(|e| panic!("the kernel cannot read a Fold scene: {e}"));
        let back = serde_json::to_value(&kernel).unwrap_or_default();
        let Value::Object(kernel_keys) = &back else {
            unreachable!()
        };
        for (key, value) in kernel_keys {
            assert_eq!(&json[key], value, "{key}");
        }
        assert_eq!(
            kernel_keys.len(),
            7,
            "the kernel's schema 3 has seven fields"
        );
    }
}

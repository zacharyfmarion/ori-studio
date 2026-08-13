//! The engine boundary for the 3D folded state.
//!
//! Nothing here re-tests placement, the census or the ordering — those have
//! their own suites. What this file pins is the contract a frontend builds
//! against: which command answers which handle, what a refusal looks like on
//! the wire, that the render model describes itself, and that solution *N* is
//! the same solution twice.

use oristudio_cp::folding::{EstimationOrder, FoldedFigureModel};
use oristudio_cp::folding3d::model::{
    FOLDED_3D_CELL_ATTR_STRIDE, FOLDED_3D_FACE_ATTR_STRIDE, FOLDED_3D_PLANE_FRAME_STRIDE,
};
use oristudio_cp::folding3d::wire::Fold3dVerdict;
use oristudio_cp::geometry::{FoldMagnitude, LineColor, LineSegment, Point};
use oristudio_cp::model::{has_non_classic_creases, has_non_classic_segments};
use oristudio_cp::session::{CpSession, Fold3dFoldResult};
use std::path::{Path, PathBuf};

mod common;

fn repo(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(relative)
}

fn load_fixture(session: &mut CpSession, name: &str) -> u32 {
    assert!(
        !common::is_external(name),
        "{name} is held outside the repository; use try_fold_3d"
    );
    let path = repo(&format!("tests/fixtures/fold-angle-3d/{name}.fold"));
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    session
        .load_fold(&raw, name)
        .unwrap_or_else(|error| panic!("load {name}: {error}"))
}

fn every_line(session: &CpSession, document: u32) -> Vec<usize> {
    let count = session
        .document_snapshot(document)
        .expect("document")
        .crease_pattern
        .line_segments
        .len();
    (1..=count).collect()
}

fn placed(result: Fold3dFoldResult) -> (u32, oristudio_cp::folding3d::Fold3dSnapshot) {
    match result {
        Fold3dFoldResult::Placed {
            handle, snapshot, ..
        } => (handle, *snapshot),
        Fold3dFoldResult::Refused { refusal } => {
            panic!("expected a placement, got {refusal:?}")
        }
    }
}

fn fold_3d(session: &mut CpSession, name: &str) -> Fold3dFoldResult {
    let document = load_fixture(session, name);
    fold_loaded(session, document, name)
}

/// Fold a fixture, or `None` when it is one of the third-party models held
/// outside the repository and the corpus is not configured. See
/// `tests/common/mod.rs`.
fn try_fold_3d(test: &str, session: &mut CpSession, name: &str) -> Option<Fold3dFoldResult> {
    let path = common::fixture_path(test, name)?;
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    let document = session
        .load_fold(&raw, name)
        .unwrap_or_else(|error| panic!("load {name}: {error}"));
    Some(fold_loaded(session, document, name))
}

fn fold_loaded(session: &mut CpSession, document: u32, name: &str) -> Fold3dFoldResult {
    let lines = every_line(session, document);
    session
        .folded_figure_fold_3d(document, &lines, 1, FoldedFigureModel::default())
        .unwrap_or_else(|error| panic!("fold {name} in 3D: {error}"))
}

/// A square sheet with one mountain crease down the middle: the smallest
/// document the **flat** folder answers, built here rather than taken from the
/// 3D fixtures because every one of those is either non-classic or (in
/// `box_90_unangled`'s case) not flat-foldable at all.
fn folded_in_half() -> Vec<LineSegment> {
    let corner = [
        Point::new(0.0, 0.0),
        Point::new(400.0, 0.0),
        Point::new(400.0, 400.0),
        Point::new(0.0, 400.0),
    ];
    let mut segments: Vec<LineSegment> = (0..4)
        .map(|slot| {
            LineSegment::with_color(corner[slot], corner[(slot + 1) % 4], LineColor::Black0)
        })
        .collect();
    segments.push(LineSegment::with_color(
        Point::new(200.0, 0.0),
        Point::new(200.0, 400.0),
        LineColor::Red1,
    ));
    segments
}

/// Every committed 3D fixture that admits, so a boundary regression shows up on
/// all of them rather than on whichever one a test happened to pick.
const ADMITTED: &[&str] = &[
    "hinge_90",
    "box_90",
    "spikes_small",
    "spikes_large",
    "penguin_freeform",
];

// --- routing -----------------------------------------------------------------

/// The routing predicate is the slice-taking one, and the two genuinely differ.
///
/// This *is* the bug the mirrored guards exist for: an all-classic selection
/// inside a mixed document must fold flat. Asking the document-wide question
/// there sends it to the 3D folder.
#[test]
fn the_two_non_classic_predicates_disagree_on_a_scoped_selection() {
    let classic = LineSegment::with_color(
        Point::new(0.0, 0.0),
        Point::new(100.0, 0.0),
        LineColor::Red1,
    );
    let mut angled = LineSegment::with_color(
        Point::new(0.0, 50.0),
        Point::new(100.0, 50.0),
        LineColor::Blue2,
    );
    angled.fold_magnitude = Some(FoldMagnitude::from_degrees(90.0).expect("90 degrees"));

    let model = oristudio_cp::model::CreasePatternModel {
        line_segments: vec![classic.clone(), angled],
        ..Default::default()
    };
    assert!(has_non_classic_creases(&model), "the document is mixed");
    assert!(
        !has_non_classic_segments(std::slice::from_ref(&classic)),
        "the classic half of a mixed document is not non-classic"
    );
}

/// A selection with no non-180 crease is refused by the 3D command, by code.
#[test]
fn an_all_classic_selection_is_refused_by_the_3d_command() {
    let mut session = CpSession::new();
    let document = load_fixture(&mut session, "box_90");
    let lines = every_line(&session, document);
    let classic: Vec<usize> = lines
        .iter()
        .copied()
        .filter(|&line| {
            let segments = &session
                .document_snapshot(document)
                .expect("document")
                .crease_pattern
                .line_segments;
            segments[line - 1].fold_magnitude.is_none()
        })
        .collect();
    assert!(!classic.is_empty(), "the fixture has classic creases");

    let error = session
        .folded_figure_fold_3d(document, &classic, 1, FoldedFigureModel::default())
        .expect_err("an all-classic selection is not a 3D fold");
    assert_eq!(error.code, "fold_is_flat");
}

/// And a selection carrying one is refused by the flat command, by code.
#[test]
fn a_non_classic_selection_is_refused_by_the_flat_command() {
    let mut session = CpSession::new();
    let document = load_fixture(&mut session, "box_90");
    let lines = every_line(&session, document);
    let error = session
        .folded_figure_fold_selected(
            document,
            &lines,
            1,
            EstimationOrder::Order5,
            FoldedFigureModel::default(),
        )
        .expect_err("a non-classic selection has no flat folded image");
    assert_eq!(error.code, "fold_needs_3d");
}

/// The guard reads the **post-fallback** segment set.
///
/// `folded_figure_fold_selected` silently widens a selection that resolves to
/// nothing into the whole document. Guarding the pre-fallback set would let a
/// drifted id list fold a mixed document flat and draw a plausible picture with
/// no error — so this passes ids that resolve to nothing and asserts the guard
/// still fires. Delete the guard's move past the fallback and this returns a
/// flat figure instead.
#[test]
fn the_flat_guard_survives_the_empty_selection_widening() {
    let mut session = CpSession::new();
    let document = load_fixture(&mut session, "box_90");
    let out_of_range = vec![100_000usize, 100_001];
    let error = session
        .folded_figure_fold_selected(
            document,
            &out_of_range,
            1,
            EstimationOrder::Order5,
            FoldedFigureModel::default(),
        )
        .expect_err("the widened document is still non-classic");
    assert_eq!(error.code, "fold_needs_3d");
}

/// The 3D command does **not** inherit that widening: an empty resolved
/// selection is a caller error, not a whole-document fold.
#[test]
fn the_3d_command_refuses_an_empty_resolved_selection() {
    let mut session = CpSession::new();
    let document = load_fixture(&mut session, "box_90");
    let error = session
        .folded_figure_fold_3d(document, &[100_000], 1, FoldedFigureModel::default())
        .expect_err("nothing was selected");
    assert_eq!(error.code, "invalid_input");
}

// --- one arena, two kinds ----------------------------------------------------

/// Every flat command on a spatial handle is a typed error, never an answer.
#[test]
fn flat_commands_on_a_spatial_handle_are_a_kind_mismatch() {
    let mut session = CpSession::new();
    let (handle, _) = placed(fold_3d(&mut session, "box_90"));

    let codes = [
        session.folded_figure_snapshot(handle).err(),
        session
            .folded_figure_render_snapshot(handle, None, Default::default())
            .err(),
        session
            .folded_figure_set_model(handle, FoldedFigureModel::default())
            .err(),
        session.folded_figure_duplicate(handle).err(),
        session.folded_figure_fold_another(handle).err(),
        session
            .folded_figure_fold_to_case(handle, 2, EstimationOrder::Order5)
            .err(),
    ];
    for error in codes {
        let error = error.expect("a flat command on a spatial figure must error");
        assert_eq!(error.code, "folded_figure_kind_mismatch");
    }
}

/// And the mirror, so the guard is not one-directional.
#[test]
fn spatial_commands_on_a_flat_handle_are_a_kind_mismatch() {
    let mut session = CpSession::new();
    let document = session.load_cp("", "flat").expect("empty document");
    session
        .insert_line_segments(document, &folded_in_half())
        .expect("insert");
    let lines = every_line(&session, document);
    let flat = session
        .folded_figure_fold_selected(
            document,
            &lines,
            1,
            EstimationOrder::Order5,
            FoldedFigureModel::default(),
        )
        .expect("an all-classic document folds flat")
        .handle;

    for error in [
        session.folded_figure_3d_fold_another(flat).err(),
        session.folded_figure_3d_duplicate(flat).err(),
    ] {
        let error = error.expect("a spatial command on a flat figure must error");
        assert_eq!(error.code, "folded_figure_kind_mismatch");
    }
}

/// One arena means one release path, and it releases both kinds.
#[test]
fn free_folded_figure_releases_a_spatial_handle() {
    let mut session = CpSession::new();
    let (handle, _) = placed(fold_3d(&mut session, "box_90"));
    session.free_folded_figure(handle).expect("release");
    let error = session
        .folded_figure_3d_fold_another(handle)
        .expect_err("the handle is gone");
    assert_eq!(error.code, "invalid_handle");
}

// --- refusals ----------------------------------------------------------------

/// A refusal is an `Ok` result with no handle, and it carries a code rather
/// than a sentence.
#[test]
fn a_refusal_is_a_result_with_a_code_and_no_handle() {
    let mut session = CpSession::new();
    let Some(result) = try_fold_3d(
        "a_refusal_is_a_result_with_a_code_and_no_handle",
        &mut session,
        "rabbit_unclosed",
    ) else {
        return;
    };
    let Fold3dFoldResult::Refused { refusal } = result else {
        panic!("rabbit_unclosed does not close and must refuse");
    };
    let json = serde_json::to_value(refusal).expect("serializes");
    assert_eq!(json["code"], "vertex_closure");
    assert!(json.get("handle").is_none(), "a refusal carries no handle");
}

/// A disconnected fold graph refuses too, and names both halves.
#[test]
fn a_disconnected_document_refuses_with_both_counts() {
    let mut session = CpSession::new();
    let Some(result) = try_fold_3d(
        "a_disconnected_document_refuses_with_both_counts",
        &mut session,
        "penguin_disconnected",
    ) else {
        return;
    };
    let Fold3dFoldResult::Refused { refusal } = result else {
        panic!("penguin_disconnected has two components and must refuse");
    };
    let json = serde_json::to_value(refusal).expect("serializes");
    assert_eq!(json["code"], "disconnected");
    assert_eq!(json["reached"], 103);
    assert_eq!(json["unreached"], 127);
}

// --- residuals ---------------------------------------------------------------

/// A verdict carries every residual the gate decided on, so a caller can
/// re-apply a different bar without re-running the fold.
///
/// `Fold3dTolerances::DEFAULT` is applied **in the kernel**, deliberately: the
/// right value depends on computed plane separation the user does not have. The
/// price of that is this — the numbers it was compared against have to come back
/// out, or the decision is unreviewable. So the test is not "the fields exist"
/// but "re-applying the shipped bar to the reported numbers reproduces the
/// shipped answer", for each of the three the gate actually decides on.
///
/// The `non_tree_edges` assertion is what stops the loop-gap half being
/// vacuous: a `0.0` gap over zero conditions certifies nothing, and every
/// admitted fixture would pass a loop-gap bar it never tested.
#[test]
fn an_admitted_verdict_carries_the_residual_of_every_bar_the_gate_applied() {
    let mut checked_a_real_loop = false;
    for name in ADMITTED {
        let mut session = CpSession::new();
        let Some(result) = try_fold_3d(
            "an_admitted_verdict_carries_the_residual_of_every_bar_the_gate_applied",
            &mut session,
            name,
        ) else {
            continue;
        };
        let (_, snapshot) = placed(result);
        let diagnostics = &snapshot.diagnostics;
        let tolerances = &diagnostics.tolerances;

        for (label, value) in [
            ("span", diagnostics.span),
            ("closure", diagnostics.worst_closure_residual_degrees),
            ("loop gap radians", diagnostics.loop_gap_radians),
            ("loop gap offset", diagnostics.loop_gap_offset_relative),
            ("vertex cycle", diagnostics.worst_vertex_cycle_radians),
            ("intra normal", diagnostics.worst_intra_normal_radians),
            ("intra offset", diagnostics.worst_intra_offset_relative),
        ] {
            assert!(
                value.is_finite(),
                "{name}: {label} residual is not a number ({value})"
            );
        }

        assert!(
            diagnostics.worst_closure_residual_degrees
                <= oristudio_cp::CLOSURE_RESIDUAL_BAR_DEGREES,
            "{name}: closure residual {} is above the bar the gate passed it on",
            diagnostics.worst_closure_residual_degrees
        );
        assert!(
            diagnostics.loop_gap_offset_relative <= tolerances.distance_relative,
            "{name}: loop gap {} of span is above the bar the gate passed it on",
            diagnostics.loop_gap_offset_relative
        );
        assert!(
            diagnostics.worst_intra_normal_radians <= tolerances.angle_radians
                && diagnostics.worst_intra_offset_relative <= tolerances.distance_relative,
            "{name}: an intra-plane residual is above the bar the partition passed it on"
        );
        assert_eq!(
            diagnostics.tolerance_alarms, 0,
            "{name}: a placed figure raised a partition alarm"
        );

        if diagnostics.loop_gap_non_tree_edges > 0 {
            checked_a_real_loop = true;
            assert!(
                diagnostics.vertex_cycles > 0,
                "{name}: {} non-tree edges but no elementary vertex cycle to localise them",
                diagnostics.loop_gap_non_tree_edges
            );
        }
    }
    assert!(
        checked_a_real_loop,
        "every fixture's dual graph is a tree, so the loop-gap residual is vacuous everywhere \
         and the assertion above tested nothing"
    );
}

// --- the render model --------------------------------------------------------

/// Every admitted fixture produces a model that describes itself, and every one
/// of its faces is drawn by some cell.
#[test]
fn every_admitted_fixture_produces_a_self_describing_render_model() {
    for name in ADMITTED {
        let mut session = CpSession::new();
        let Some(result) = try_fold_3d(
            "every_admitted_fixture_produces_a_self_describing_render_model",
            &mut session,
            name,
        ) else {
            continue;
        };
        let Fold3dFoldResult::Placed {
            snapshot, render, ..
        } = result
        else {
            panic!("{name} is an admitted fixture and must place");
        };
        render
            .validate()
            .unwrap_or_else(|error| panic!("{name}: {error}"));

        assert_eq!(
            render.face_attr.len(),
            render.face_count as usize * FOLDED_3D_FACE_ATTR_STRIDE,
            "{name}: face_attr stride"
        );
        assert_eq!(
            render.cell_attr.len(),
            render.cell_count as usize * FOLDED_3D_CELL_ATTR_STRIDE,
            "{name}: cell_attr stride"
        );
        assert_eq!(
            render.plane_frames.len(),
            render.plane_count as usize * FOLDED_3D_PLANE_FRAME_STRIDE,
            "{name}: plane_frames stride"
        );
        assert_eq!(
            render.cell_count as usize, snapshot.census.cell_count,
            "{name}: the snapshot and the render model must not drift"
        );
        assert_eq!(
            render.undetermined_cells as usize, snapshot.undetermined_cells,
            "{name}: undetermined cells"
        );

        // Every face is stacked somewhere. Without this a renderer drawing only
        // cells silently loses paper.
        let mut drawn = vec![false; render.face_count as usize];
        for &face in &render.cell_stack {
            drawn[face as usize] = true;
        }
        assert!(
            drawn.iter().all(|seen| *seen),
            "{name}: {} faces are in no cell stack",
            drawn.iter().filter(|seen| !**seen).count()
        );
    }
}

/// Cells are grouped by plane and ranked within it, so a renderer can walk them
/// in order without sorting.
#[test]
fn cells_are_grouped_by_plane_and_ranked_within_it() {
    let mut session = CpSession::new();
    let Fold3dFoldResult::Placed { render, .. } = fold_3d(&mut session, "spikes_large") else {
        panic!("spikes_large is admitted");
    };
    let mut previous_plane = -1i32;
    let mut expected_rank = 0i32;
    for cell in 0..render.cell_count as usize {
        let base = cell * FOLDED_3D_CELL_ATTR_STRIDE;
        let plane = render.cell_attr[base];
        let rank = render.cell_attr[base + 6];
        if plane != previous_plane {
            assert!(plane > previous_plane, "planes must be ascending");
            previous_plane = plane;
            expected_rank = 0;
        }
        assert_eq!(rank, expected_rank, "cell {cell} rank");
        expected_rank += 1;
    }
}

/// `up` is emitted, not re-derived: it is exactly the placed normal of the
/// plane's lowest-indexed member face.
///
/// A consumer that rebuilt it from its own seed would get a different chirality
/// and reversed stacks that look entirely plausible, so this pins the rule at
/// the boundary rather than leaving it in a doc comment.
#[test]
fn plane_up_is_the_placed_normal_of_its_lowest_face() {
    for name in ADMITTED {
        let mut session = CpSession::new();
        let Some(result) = try_fold_3d(
            "plane_up_is_the_placed_normal_of_its_lowest_face",
            &mut session,
            name,
        ) else {
            continue;
        };
        let Fold3dFoldResult::Placed {
            snapshot, render, ..
        } = result
        else {
            panic!("{name} is admitted");
        };
        let mut lowest: Vec<Option<usize>> = vec![None; render.plane_count as usize];
        for face in 0..render.face_count as usize {
            let plane = render.face_attr[face * FOLDED_3D_FACE_ATTR_STRIDE] as usize;
            if lowest[plane].is_none() {
                lowest[plane] = Some(face);
            }
        }
        for (plane, summary) in snapshot.planes.iter().enumerate() {
            let face = lowest[plane].expect("every plane has a member");
            let normal = [
                render.face_normals[face * 3],
                render.face_normals[face * 3 + 1],
                render.face_normals[face * 3 + 2],
            ];
            assert_eq!(summary.up, normal, "{name}: plane {plane} up");
            let frame = plane * FOLDED_3D_PLANE_FRAME_STRIDE;
            assert_eq!(
                &render.plane_frames[frame..frame + 3],
                &normal[..],
                "{name}: plane {plane} frame"
            );
        }
    }
}

/// The frame is right-handed, so counter-clockwise in `(u, v)` is the side the
/// paper's front faces. A left-handed one draws every stack mirrored.
#[test]
fn the_plane_frame_is_right_handed() {
    let mut session = CpSession::new();
    let Fold3dFoldResult::Placed { render, .. } = fold_3d(&mut session, "spikes_small") else {
        panic!("spikes_small is admitted");
    };
    for plane in 0..render.plane_count as usize {
        let base = plane * FOLDED_3D_PLANE_FRAME_STRIDE;
        let up = [
            render.plane_frames[base],
            render.plane_frames[base + 1],
            render.plane_frames[base + 2],
        ];
        let u = [
            render.plane_frames[base + 6],
            render.plane_frames[base + 7],
            render.plane_frames[base + 8],
        ];
        let v = [
            render.plane_frames[base + 9],
            render.plane_frames[base + 10],
            render.plane_frames[base + 11],
        ];
        let cross = [
            u[1] * v[2] - u[2] * v[1],
            u[2] * v[0] - u[0] * v[2],
            u[0] * v[1] - u[1] * v[0],
        ];
        for axis in 0..3 {
            assert!(
                (cross[axis] - up[axis]).abs() < 1e-12,
                "plane {plane} frame is not right-handed"
            );
        }
    }
}

/// Two folds of the same segments produce byte-identical geometry.
///
/// The clustering, the components and the search all walk containers that could
/// have been hash-ordered; if one ever is, an unchanged document reshuffles
/// visibly between refolds for no reason.
#[test]
fn a_refold_of_the_same_document_is_bit_identical() {
    for name in ADMITTED {
        let mut first = CpSession::new();
        let mut second = CpSession::new();
        const TEST: &str = "a_refold_of_the_same_document_is_bit_identical";
        let (Some(one), Some(two)) = (
            try_fold_3d(TEST, &mut first, name),
            try_fold_3d(TEST, &mut second, name),
        ) else {
            continue;
        };
        let Fold3dFoldResult::Placed {
            snapshot: a,
            render: model_a,
            ..
        } = one
        else {
            panic!("{name} is admitted");
        };
        let Fold3dFoldResult::Placed {
            snapshot: b,
            render: model_b,
            ..
        } = two
        else {
            panic!("{name} is admitted");
        };
        assert_eq!(model_a, model_b, "{name}: render model is not reproducible");
        assert_eq!(a, b, "{name}: snapshot is not reproducible");
    }
}

// --- the solution stream -----------------------------------------------------

/// The one committed fixture with more than one layer order.
///
/// Named, because every cycling assertion below is **vacuous on a
/// one-solution figure** and four of the five 3D fixtures are one — measured:
/// `hinge_90`, `box_90`, `spikes_small` and `spikes_large` have exactly one,
/// `penguin_freeform` has eight. A cycling test written against `box_90`
/// passes whatever the enumerator does, which is how the first draft of this
/// file survived a mutation that made the duplicate restart its stream.
const MULTI_SOLUTION: &str = "penguin_freeform";

/// One name for the whole cycling group, which stands or falls together on
/// whether `MULTI_SOLUTION` is reachable.
const TEST_MULTI_SOLUTION: &str = "the cycling suite (every test over MULTI_SOLUTION)";

/// Cycling reports the wrap explicitly, and the wrap repeats.
///
/// Two full laps: no existing test in the repo presses a fold stream past its
/// wrap, and a stream that only wraps once looks identical to one that works
/// until the user presses the button a third time.
#[test]
fn the_solution_stream_wraps_and_keeps_wrapping() {
    let mut session = CpSession::new();
    let Some(result) = try_fold_3d(TEST_MULTI_SOLUTION, &mut session, MULTI_SOLUTION) else {
        return;
    };
    let (handle, first) = placed(result);
    assert!(
        first.find_another_overlap_valid,
        "{MULTI_SOLUTION} must have more than one solution, or nothing below is tested"
    );

    let mut lap: Vec<usize> = vec![first.current_fold_case];
    let mut laps: Vec<Vec<usize>> = Vec::new();
    for _ in 0..64 {
        let step = session
            .folded_figure_3d_fold_another(handle)
            .expect("stepping a placed figure");
        if step.advanced {
            lap.push(step.snapshot.current_fold_case);
            continue;
        }
        assert_eq!(
            step.snapshot.current_fold_case, 1,
            "a wrap returns to solution 1"
        );
        laps.push(std::mem::replace(
            &mut lap,
            vec![step.snapshot.current_fold_case],
        ));
        if laps.len() == 2 {
            break;
        }
    }
    assert_eq!(laps.len(), 2, "the stream did not wrap twice in 64 presses");
    // A lap that visits one solution is a stream that is not moving, which the
    // wrap count alone cannot see.
    assert!(
        laps[0].len() > 1,
        "the first lap visited {} solutions",
        laps[0].len()
    );
    assert_eq!(
        laps[0], laps[1],
        "solution N is not the same solution twice"
    );
    assert_eq!(
        laps[0],
        (1..=laps[0].len()).collect::<Vec<usize>>(),
        "case numbers are 1-based and consecutive within a lap"
    );
}

/// The shape of a whole 3D stream matches the shape of a whole flat one, walked
/// side by side through the same session API.
///
/// The cycling UI is one verb over both kinds — `foldedFigureCycling` reads
/// `folded3d ?? snapshot` and both spell these fields the same way — so a
/// divergence here is a divergence the user sees. It labels the last press
/// "Back to first solution" off `find_another_overlap_valid`, and this is the
/// test that the two paths agree about when that is.
///
/// Three properties, in the order they can break:
///
/// 1. **Every press before the last advances.** No dead press: a press that
///    changes nothing and only flips the flag would be indistinguishable from a
///    figure that stopped responding.
/// 2. **The last solution reports no next.** Measured before this was fixed:
///    3D said `find_another_overlap_valid` on solution 8 of 8, because the
///    stream OR-ed its digits' *optimistic* per-component flags. The button
///    therefore read "Another solution" and then wrapped without warning.
/// 3. **One more press wraps to solution 1** rather than dead-ending, which is
///    the one place this path deliberately extends Oriedita.
///
/// The flat half is not decoration. Written as a bare assertion about 3D it
/// would pin whatever 3D happens to do; walked beside the flat stream it pins
/// that the two agree, which is the actual requirement.
#[test]
fn a_3d_stream_ends_the_way_a_flat_stream_ends() {
    #[derive(Debug, PartialEq, Eq)]
    struct Shape {
        /// `current_fold_case` at each solution, in order.
        cases: Vec<usize>,
        /// `find_another_overlap_valid` at the last solution.
        last_reports_next: bool,
        /// `current_fold_case` after one press past the end.
        after_wrap: usize,
    }

    // --- flat, on the Oriedita fixture with the most layer orders -------------
    let mut session = CpSession::new();
    let raw = std::fs::read_to_string(repo("tests/fixtures/oriedita/solution_sample_1.cp"))
        .expect("read solution_sample_1.cp");
    let document = session.load_cp(&raw, "flat").expect("load");
    let lines = every_line(&session, document);
    let flat_figure = session
        .folded_figure_fold_selected(
            document,
            &lines,
            1,
            EstimationOrder::Order5,
            FoldedFigureModel::default(),
        )
        .expect("fold flat");
    let mut snapshot = flat_figure.snapshot;
    let mut flat = Shape {
        cases: vec![snapshot.current_fold_case],
        last_reports_next: snapshot.find_another_overlap_valid,
        after_wrap: 0,
    };
    assert!(
        flat.last_reports_next,
        "the flat fixture must have more than one solution, or nothing here is tested"
    );
    while snapshot.find_another_overlap_valid {
        snapshot = session
            .folded_figure_fold_another(flat_figure.handle)
            .expect("step the flat stream");
        flat.cases.push(snapshot.current_fold_case);
        flat.last_reports_next = snapshot.find_another_overlap_valid;
        assert!(flat.cases.len() < 64, "the flat stream did not end");
    }
    flat.after_wrap = session
        .folded_figure_fold_another(flat_figure.handle)
        .expect("wrap the flat stream")
        .current_fold_case;

    // --- 3D, on the one committed multi-solution fixture ----------------------
    let mut session = CpSession::new();
    let Some(result) = try_fold_3d(TEST_MULTI_SOLUTION, &mut session, MULTI_SOLUTION) else {
        return;
    };
    let (handle, first) = placed(result);
    let mut spatial = Shape {
        cases: vec![first.current_fold_case],
        last_reports_next: first.find_another_overlap_valid,
        after_wrap: 0,
    };
    assert!(
        spatial.last_reports_next,
        "{MULTI_SOLUTION} must have more than one solution, or nothing here is tested"
    );
    while spatial.last_reports_next {
        let step = session
            .folded_figure_3d_fold_another(handle)
            .expect("step the 3D stream");
        assert!(
            step.advanced,
            "a press that reported a next solution wrapped instead of advancing"
        );
        spatial.cases.push(step.snapshot.current_fold_case);
        spatial.last_reports_next = step.snapshot.find_another_overlap_valid;
        assert!(spatial.cases.len() < 64, "the 3D stream did not end");
    }
    let wrap = session
        .folded_figure_3d_fold_another(handle)
        .expect("wrap the 3D stream");
    assert!(!wrap.advanced, "the press past the end is the wrap");
    spatial.after_wrap = wrap.snapshot.current_fold_case;

    // The two fixtures have different solution counts, so compare the shape
    // rather than the numbers: consecutive from 1, no next at the end, wrap to 1.
    for (label, shape) in [("flat", &flat), ("3D", &spatial)] {
        assert!(shape.cases.len() > 1, "{label}: a one-solution stream");
        assert_eq!(
            shape.cases,
            (1..=shape.cases.len()).collect::<Vec<usize>>(),
            "{label}: case numbers are not 1-based and consecutive"
        );
        assert!(
            !shape.last_reports_next,
            "{label}: the last solution claims another one follows"
        );
        assert_eq!(shape.after_wrap, 1, "{label}: the press past the end wraps");
    }
}

/// A one-solution figure wraps on every press rather than erroring.
///
/// Its own behaviour, not a degenerate case of the above: four of the five
/// committed 3D fixtures are one-solution, so it is what most users meet.
#[test]
fn a_single_solution_stream_wraps_on_every_press() {
    let mut session = CpSession::new();
    let (handle, first) = placed(fold_3d(&mut session, "box_90"));
    assert!(!first.find_another_overlap_valid);
    assert_eq!(first.discovered_fold_cases, 1);
    for _ in 0..3 {
        let step = session
            .folded_figure_3d_fold_another(handle)
            .expect("stepping a one-solution figure is not an error");
        assert!(!step.advanced);
        assert_eq!(step.snapshot.current_fold_case, 1);
    }
}

/// A duplicate starts on the solution the original was showing, then cycles
/// independently. A shared handle would break both halves.
#[test]
fn a_duplicate_starts_where_the_original_was_and_then_diverges() {
    let mut session = CpSession::new();
    let Some(result) = try_fold_3d(TEST_MULTI_SOLUTION, &mut session, MULTI_SOLUTION) else {
        return;
    };
    let (original, _) = placed(result);
    let advanced = session
        .folded_figure_3d_fold_another(original)
        .expect("step the original");
    assert!(
        advanced.advanced && advanced.snapshot.current_fold_case > 1,
        "the original must have moved, or the copy has nothing to match"
    );

    let (copy, copied) = placed(
        session
            .folded_figure_3d_duplicate(original)
            .expect("duplicate"),
    );
    assert_eq!(
        copied.current_fold_case, advanced.snapshot.current_fold_case,
        "the duplicate shows the solution the original was showing"
    );
    assert_ne!(copy, original, "the duplicate is its own handle");

    // Stepping the copy must not step the original — what a shared enumerator
    // would do — so the two land on the same case from the same state.
    let stepped = session
        .folded_figure_3d_fold_another(copy)
        .expect("step the copy");
    let original_now = session
        .folded_figure_3d_fold_another(original)
        .expect("step the original again");
    assert_eq!(
        stepped.snapshot.current_fold_case, original_now.snapshot.current_fold_case,
        "two independent streams from one state stay in step"
    );
}

// --- the verdict -------------------------------------------------------------

/// `Folded` is what an admitted, orderable fixture reports, and the verdict is
/// a code rather than a sentence.
#[test]
fn an_admitted_fixture_reports_a_verdict_code() {
    let mut session = CpSession::new();
    let (_, snapshot) = placed(fold_3d(&mut session, "spikes_small"));
    let json = serde_json::to_value(snapshot.verdict).expect("serializes");
    let verdict = json["verdict"].as_str().expect("a verdict tag");
    assert!(
        verdict.chars().all(|c| c.is_ascii_lowercase() || c == '_'),
        "`{verdict}` is not a snake_case code"
    );
    assert_eq!(snapshot.verdict, Fold3dVerdict::Folded);
    assert_eq!(snapshot.undetermined_pairs, 0);
}

/// The tolerances cross the bridge, because the frontend's coplanarity epsilon
/// must be the kernel's rather than its own.
#[test]
fn the_snapshot_carries_the_kernel_tolerances() {
    let mut session = CpSession::new();
    let (_, snapshot) = placed(fold_3d(&mut session, "box_90"));
    assert_eq!(snapshot.diagnostics.tolerances.angle_radians, 1e-7);
    assert_eq!(snapshot.diagnostics.tolerances.distance_relative, 1e-6);
    assert_eq!(snapshot.diagnostics.tolerances.overlap_area_relative, 1e-9);
    assert_eq!(
        snapshot.diagnostics.tolerance_alarms, 0,
        "a placed figure raised no alarm, or it would have refused"
    );
}

/// The census theorem survives the boundary, and the converse is not asserted.
#[test]
fn the_snapshot_census_keeps_its_theorem() {
    for name in ADMITTED {
        let mut session = CpSession::new();
        let Some(result) = try_fold_3d("the_snapshot_census_keeps_its_theorem", &mut session, name)
        else {
            continue;
        };
        let (_, snapshot) = placed(result);
        assert!(
            snapshot.census.overlapping_pair_count >= snapshot.census.full_fold_pairs,
            "{name}: census {} < full-fold pairs {}",
            snapshot.census.overlapping_pair_count,
            snapshot.census.full_fold_pairs
        );
        assert_eq!(
            snapshot.components.iter().sum::<usize>(),
            snapshot.census.overlapping_pair_count,
            "{name}: every ordering variable is in exactly one component"
        );
        assert!(
            snapshot
                .components
                .windows(2)
                .all(|pair| pair[0] >= pair[1]),
            "{name}: components must be descending"
        );
    }
}

/// `Folded` means *fully* ordered, and the boundary says so rather than
/// assuming it.
///
/// `verdict_of` chooses `Folded` from the absence of an ordering error and of
/// crossings; it never consults `ordering.undetermined`. That is right today
/// because a complete order is what the solver returns or it returns an error —
/// but nothing in the type system says so, and a regression would ship a figure
/// the projector annotates red in every undecided cell under a verdict chip that
/// says nothing at all. Honest in the picture, silent in the copy.
#[test]
fn a_folded_verdict_leaves_nothing_undetermined() {
    let mut checked = 0;
    for name in ADMITTED {
        let mut session = CpSession::new();
        let Some(result) = try_fold_3d(
            "a_folded_verdict_leaves_nothing_undetermined",
            &mut session,
            name,
        ) else {
            continue;
        };
        let Fold3dFoldResult::Placed {
            snapshot, render, ..
        } = result
        else {
            panic!("{name} is an admitted fixture and must place");
        };
        if snapshot.verdict != Fold3dVerdict::Folded {
            continue;
        }
        checked += 1;
        assert_eq!(
            snapshot.undetermined_pairs, 0,
            "{name}: `Folded` with {} undetermined pairs",
            snapshot.undetermined_pairs
        );
        assert_eq!(
            snapshot.undetermined_cells, 0,
            "{name}: `Folded` with {} undetermined cells",
            snapshot.undetermined_cells
        );
        assert_eq!(
            render.undetermined_cells, 0,
            "{name}: the render model disagrees with the snapshot"
        );
    }
    assert!(
        checked > 0,
        "no admitted fixture reached `Folded`, so this asserts nothing"
    );
}

/// The whole command surface is registered, in one place, in manifest order.
#[test]
fn the_three_new_commands_are_in_the_shared_manifest() {
    use oristudio_cp::session::CP_ENGINE_COMMANDS;
    for name in [
        "folded_figure_fold_3d",
        "folded_figure_3d_fold_another",
        "folded_figure_3d_duplicate",
    ] {
        assert!(
            CP_ENGINE_COMMANDS.contains(&name),
            "`{name}` is missing from CP_ENGINE_COMMANDS"
        );
    }
}

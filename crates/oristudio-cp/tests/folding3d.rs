//! The 3D admission gate, against the fixtures whose answers are recorded.
//!
//! This work has **no oracle**: Oriedita's creases are always ±180, so there is
//! no upstream implementation to diff against and every load-bearing claim has
//! to be an assertion about a file whose verdict is written down. The table
//! below is `tests/fixtures/fold-angle-3d/README.md`'s table, and the two must
//! not drift.

use oristudio_cp::CLOSURE_RESIDUAL_BAR_DEGREES;
use oristudio_cp::checks_spatial::Vec3;
use oristudio_cp::folding3d::{
    Fold3dOutcome, Fold3dRefusal, Fold3dTolerances, Placement3d, admit, admit_with, place_segments,
};
use oristudio_cp::geometry::{FoldMagnitude, LineColor, LineSegment, Point};
use oristudio_cp::io::fold::import_fold_document;
use oristudio_cp::model::CreasePatternModel;
use std::path::{Path, PathBuf};
use treemaker_fold::FoldDocument;

fn repo(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(relative)
}

fn read_model(relative: &str) -> CreasePatternModel {
    let path = repo(relative);
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    let document: FoldDocument = serde_json::from_str(&raw)
        .unwrap_or_else(|error| panic!("parse {}: {error}", path.display()));
    import_fold_document(&document)
        .unwrap_or_else(|error| panic!("import {}: {error:?}", path.display()))
}

fn fixture(name: &str) -> CreasePatternModel {
    read_model(&format!("tests/fixtures/fold-angle-3d/{name}.fold"))
}

/// Every committed 3D fixture, and what the gate must say about it.
///
/// `faces`, `spatial` and `non_tree` come from the README's table; the point of
/// repeating them here is that a change which alters the arrangement fails
/// loudly rather than quietly moving what the fixture demonstrates.
struct Expected {
    name: &'static str,
    faces: usize,
    spatial: usize,
    non_tree: usize,
    outcome: Fold3dOutcome,
}

const ADMITTED: [Expected; 5] = [
    Expected {
        name: "hinge_90",
        faces: 2,
        spatial: 0,
        // A tree dual graph: the loop gap has nothing to be a maximum over, and
        // this is the only fixture here with no placement self-check at all.
        non_tree: 0,
        outcome: Fold3dOutcome::Folded,
    },
    Expected {
        name: "box_90",
        faces: 11,
        spatial: 2,
        non_tree: 3,
        outcome: Fold3dOutcome::Folded,
    },
    Expected {
        name: "spikes_small",
        faces: 25,
        spatial: 8,
        non_tree: 12,
        outcome: Fold3dOutcome::Folded,
    },
    Expected {
        name: "spikes_large",
        faces: 214,
        spatial: 114,
        non_tree: 155,
        outcome: Fold3dOutcome::Folded,
    },
    Expected {
        name: "penguin_freeform",
        faces: 127,
        spatial: 36,
        non_tree: 71,
        outcome: Fold3dOutcome::Folded,
    },
];

#[test]
fn the_committed_fixtures_reach_their_recorded_verdicts() {
    for expected in &ADMITTED {
        let model = fixture(expected.name);
        let admission = admit(&model.line_segments, 1)
            .unwrap_or_else(|refusal| panic!("{}: {refusal}", expected.name));
        assert_eq!(
            admission.placement.rings.len(),
            expected.faces,
            "{}: face count",
            expected.name
        );
        assert_eq!(
            admission.diagnostics.spatial_vertices, expected.spatial,
            "{}: spatial vertices examined",
            expected.name
        );
        assert_eq!(
            admission.placement.loop_gap.non_tree_edges, expected.non_tree,
            "{}: independent dual cycles",
            expected.name
        );
        assert_eq!(admission.outcome(), expected.outcome, "{}", expected.name);
        assert!(
            admission.diagnostics.worst_closure_residual_degrees
                <= CLOSURE_RESIDUAL_BAR_DEGREES / 10.0,
            "{}: closes at {} degrees, too near the {CLOSURE_RESIDUAL_BAR_DEGREES} bar to \
             demonstrate anything",
            expected.name,
            admission.diagnostics.worst_closure_residual_degrees
        );
    }
}

/// The three refusals the fixture corpus was chosen to produce, each by a
/// different mechanism.
#[test]
fn the_refusing_fixtures_refuse_for_the_reason_they_were_chosen_for() {
    // Naturally authored, and the kernel calls it CLEAN: 0 flat violations, 53
    // spatial vertices all closing. Placement is the only thing that notices,
    // because the closure check is per vertex and never asks about
    // connectivity.
    let model = fixture("penguin_disconnected");
    match admit(&model.line_segments, 1) {
        Err(Fold3dRefusal::Disconnected { reached, unreached }) => {
            // Which component the walk starts in is a fact about the trace
            // order, not about the file; the two sizes are the README's.
            assert_eq!((reached, unreached), (103, 127));
        }
        other => panic!("penguin_disconnected: {other:?}"),
    }

    // Exactly one closure failure out of 32 spatial vertices — a near miss, so a
    // checker broken in almost any way would still pass it.
    let model = fixture("rabbit_unclosed");
    match admit(&model.line_segments, 1) {
        Err(Fold3dRefusal::VertexClosure {
            residual_degrees, ..
        }) => {
            assert!(
                (residual_degrees - 70.53).abs() < 0.01,
                "rabbit_unclosed closes to {residual_degrees} degrees, expected 70.53"
            );
        }
        other => panic!("rabbit_unclosed: {other:?}"),
    }

    // The matched all-classic control: the same box saved before its angles were
    // set. It carries two flat-foldability violations, so it is a negative for
    // the flat path too.
    let model = fixture("box_90_unangled");
    assert!(matches!(
        admit(&model.line_segments, 1),
        Err(Fold3dRefusal::FlatFoldability { .. })
    ));
}

/// Spherical simplicity shipped, so the 3D gate consumes it rather than
/// re-deriving it — and reports it rather than refusing, because the geometry is
/// computed and drawable.
#[test]
fn a_self_intersecting_vertex_is_named_rather_than_refused() {
    let model = read_model("tests/fixtures/fold-angle/self-intersecting-vertex.fold");
    let admission = admit(&model.line_segments, 1).expect("the placement is still computable");
    assert_eq!(admission.outcome(), Fold3dOutcome::LocalCrossing);
    assert_eq!(admission.diagnostics.local_crossings.len(), 1);

    let model = read_model("tests/fixtures/fold-angle/valid-waterbomb-vertex.fold");
    let admission = admit(&model.line_segments, 1).expect("admitted");
    assert_eq!(admission.outcome(), Fold3dOutcome::Folded);
    assert!(admission.diagnostics.local_crossings.is_empty());
}

/// Where the loop-gap bar sits, measured rather than asserted.
///
/// The bar is only defensible if there is an empty band around it. Every
/// admitted fixture must sit decades below and every geometric refusal decades
/// above, with the constant in between — and this is the test that fails if a
/// future fixture lands in the band.
#[test]
fn the_loop_gap_bar_sits_in_an_empty_band() {
    let bar = oristudio_cp::folding3d::Fold3dTolerances::DEFAULT.distance_relative;
    let mut worst_admitted = 0.0_f64;
    for expected in &ADMITTED {
        let model = fixture(expected.name);
        let admission = admit(&model.line_segments, 1).expect("admitted");
        worst_admitted =
            worst_admitted.max(admission.placement.loop_gap.offset / admission.placement.span);
    }
    assert!(
        worst_admitted * 1e3 < bar,
        "the worst admitted loop gap is {worst_admitted} of span, within three decades of the \
         {bar} bar"
    );

    // The refusals are measured through the placement rather than the gate,
    // because the gate stops at the first thing wrong and for these two that is
    // not the loop gap.
    for (name, floor) in [("rabbit_unclosed", 1e-2), ("box_90_unangled", 1e-1)] {
        let model = fixture(name);
        let placement = place_segments(&model.line_segments, 1).expect("placed");
        let relative = placement.loop_gap.offset / placement.span;
        assert!(
            relative > floor && relative > bar * 1e3,
            "{name} has a loop gap of {relative} of span, within three decades of the {bar} bar"
        );
    }
}

/// The placement is a property of the crease pattern, not of where the walk
/// started.
///
/// The bar is the model's **own loop gap**, not a fixed epsilon. Two roots reach
/// a face by different routes, so they can only disagree by what the routes
/// disagree about — measured, the ratio is 1.0 to 6.6 across the corpus, and on
/// `penguin_freeform` that is 1.8e-7 rather than machine precision because the
/// file's own coordinates carry a 7.9e-8 gap.
///
/// Paired with the dihedral round-trip below, because path independence is
/// **blind to a global sign flip**: negating every fold angle is the mirror
/// state, which is path-independent everywhere the original is.
#[test]
fn the_placement_is_independent_of_the_bfs_root() {
    for name in ["box_90", "spikes_small", "spikes_large", "penguin_freeform"] {
        let model = fixture(name);
        let reference = place_segments(&model.line_segments, 1).expect("placed");
        let anchor = reference.face_transforms[0].inverse();
        let faces = reference.rings.len();

        let mut worst = 0.0_f64;
        for root in 1..=faces {
            let placement = place_segments(&model.line_segments, root as i32).expect("placed");
            let rebase = placement.face_transforms[0].inverse();
            for face in 0..faces {
                for slot in 0..placement.rings[face].len() {
                    worst = worst.max(distance(
                        rebase.apply(placement.face_points[face][slot]),
                        anchor.apply(reference.face_points[face][slot]),
                    ));
                }
            }
        }
        let allowed = 8.0 * reference.loop_gap.offset + 1e-15 * reference.span;
        assert!(
            worst <= allowed,
            "{name}: roots disagree by {worst}, more than 8x the model's own loop gap of {}",
            reference.loop_gap.offset
        );
    }
}

/// Every placed pair of faces that meet across a crease must show the dihedral
/// the crease declares.
///
/// **Over the non-tree joins.** A tree join is exact by construction — the walk
/// built the child by rotating it that far — so measuring only those is a
/// tautology, and it was one until this test was made to fail on
/// `rabbit_unclosed`.
///
/// This is also the one check here that exercises a **general-angle** rotation
/// rather than a half-turn, which matters because of the wrap: `atan2` cannot
/// tell `+180` from `-180`, so a document of full folds validates nothing about
/// the sign convention.
#[test]
fn the_declared_fold_angles_come_back_out_of_the_placement() {
    for name in ["box_90", "spikes_small", "spikes_large", "penguin_freeform"] {
        let model = fixture(name);
        let placement = place_segments(&model.line_segments, 1).expect("placed");
        let (worst, general_angle_joins) = worst_dihedral_error(&model, &placement);
        assert!(
            general_angle_joins > 0,
            "{name} has no non-180 join off the spanning tree, so this validates nothing"
        );
        assert!(
            worst < 1e-6,
            "{name}: declared and measured fold angles differ by {worst} degrees over \
             {general_angle_joins} joins"
        );
    }
}

/// The same number, reached two independent ways.
///
/// `rabbit_unclosed`'s worst vertex closure residual is 70.53 degrees, computed
/// from a quaternion product at a vertex. Its worst declared-vs-measured
/// dihedral is the same figure, computed from placed face normals across a
/// non-tree join. Nothing connects the two but the geometry being right.
#[test]
fn the_unclosed_fixture_reports_the_same_error_from_both_directions() {
    let model = fixture("rabbit_unclosed");
    let Err(Fold3dRefusal::VertexClosure {
        residual_degrees, ..
    }) = admit(&model.line_segments, 1)
    else {
        panic!("rabbit_unclosed is supposed to fail closure");
    };
    let placement = place_segments(&model.line_segments, 1).expect("placed");
    let (worst_dihedral, _) = worst_dihedral_error(&model, &placement);
    assert!(
        (worst_dihedral - residual_degrees).abs() < 0.05,
        "closure says {residual_degrees} degrees and the dihedral round-trip says \
         {worst_dihedral}"
    );
}

/// Worst declared-vs-measured dihedral over the non-tree joins, in degrees, and
/// how many of those joins carry a genuinely non-180 angle.
fn worst_dihedral_error(model: &CreasePatternModel, placement: &Placement3d) -> (f64, usize) {
    let mut worst = 0.0_f64;
    let mut general = 0usize;
    for join in &placement.joins {
        if join.in_tree {
            continue;
        }
        let (parent, child) = join.faces;
        let declared = oristudio_cp::model::crease_fold_angle(&model.line_segments[join.line])
            .expect("a placed join carries a crease");
        let measured = placement
            .measured_dihedral(parent, child, join.line)
            .expect("both faces carry the crease")
            .to_degrees();
        // Wrapped, because `atan2` cannot tell +180 from -180 and the two are
        // the same half-turn.
        let mut error = measured - declared;
        while error > 180.0 {
            error -= 360.0;
        }
        while error <= -180.0 {
            error += 360.0;
        }
        if declared.abs() < 179.0 {
            general += 1;
        }
        worst = worst.max(error.abs());
    }
    (worst, general)
}

/// A crease saved one storage unit below a full fold must fold like a full fold.
///
/// The constraint *type* is discontinuous at 180 degrees, so an unsnapped
/// near-flat crease makes the 3D command disagree with the shipped flat `Fold`
/// on a nominally flat document — and it also routes the vertex to the wrong
/// checker, because `is_classic_crease` is an exact test.
#[test]
fn a_crease_one_storage_unit_short_of_flat_is_snapped_in_the_gates_own_copy() {
    let square = [
        Point::new(0.0, 0.0),
        Point::new(100.0, 0.0),
        Point::new(100.0, 100.0),
        Point::new(0.0, 100.0),
    ];
    let mut segments: Vec<LineSegment> = (0..4)
        .map(|k| LineSegment::with_color(square[k], square[(k + 1) % 4], LineColor::Black0))
        .collect();
    let mut diagonal = LineSegment::with_color(square[0], square[2], LineColor::Blue2);
    diagonal.fold_magnitude = FoldMagnitude::from_degrees(180.0 - 1e-7);
    segments.push(diagonal.clone());

    assert!(
        !oristudio_cp::model::is_classic_crease(&diagonal),
        "one storage unit short of 180 is not a classic crease"
    );
    let admission = admit(&segments, 1).expect("admitted");
    assert_eq!(admission.diagnostics.snapped_creases, 1);

    // The input is untouched: there is no variant of the snap that writes back.
    assert_eq!(segments[4].fold_magnitude, diagonal.fold_magnitude);

    // And the snapped state folds like a full fold: the two triangles land on
    // top of each other.
    let normals = &admission.placement.face_normals;
    assert!(
        (normals[0][2] * normals[1][2]
            + normals[0][1] * normals[1][1]
            + normals[0][0] * normals[1][0]
            + 1.0)
            .abs()
            < 1e-9,
        "the snapped crease did not fold flat: normals {normals:?}"
    );
}

fn distance(a: Vec3, b: Vec3) -> f64 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}

/// A drawn ring: four radial creases at 90 degrees around a square hole whose
/// edges are borders.
fn annulus_90() -> Vec<LineSegment> {
    let square = |r: f64| {
        [
            Point::new(-r, -r),
            Point::new(r, -r),
            Point::new(r, r),
            Point::new(-r, r),
        ]
    };
    let (outer, inner) = (square(100.0), square(40.0));
    let mut segments = Vec::new();
    for k in 0..4 {
        for ring in [outer, inner] {
            segments.push(LineSegment::with_color(
                ring[k],
                ring[(k + 1) % 4],
                LineColor::Black0,
            ));
        }
    }
    for k in 0..4 {
        segments.push(
            LineSegment::with_color(inner[k], outer[k], LineColor::Red1)
                .with_fold_magnitude(FoldMagnitude::from_degrees(90.0)),
        );
    }
    segments
}

/// The interior-cut refusal, through the gate, in the order the gate applies it.
///
/// Two claims, and the second is the one worth a test. The first is that a cut
/// drawn inside the sheet refuses at all. The second is that it refuses *here*,
/// before the placement — because the placement also declines this document, for
/// an unrelated reason (`NonCreaseJoin`, two faces meeting across a border), and
/// that refusal names a segment without saying the check above it examined
/// nothing. Reorder the gate and this test is what notices.
///
/// `InteriorCut` is the corpus's third most common verdict — 7 of 65 files —
/// which is why it is not left to an external corpus run to cover.
#[test]
fn a_cut_drawn_inside_the_sheet_is_refused_before_the_placement_is_attempted() {
    let segments = annulus_90();

    match admit(&segments, 1) {
        Err(Fold3dRefusal::InteriorCut { line, point }) => {
            assert_eq!(
                segments[line].color,
                LineColor::Black0,
                "the refusal has to name a border segment"
            );
            assert!(
                point.x.abs() <= 40.0 + 1e-9 && point.y.abs() <= 40.0 + 1e-9,
                "the named border is the inner square's, not the paper's edge: {point:?}"
            );
        }
        other => panic!("expected an interior cut, got {other:?}"),
    }

    // The placement's own verdict on the same document, so the ordering claim
    // above is about two refusals that both really fire.
    assert!(
        matches!(
            place_segments(&segments, 1),
            Err(Fold3dRefusal::NonCreaseJoin { .. })
        ),
        "the placement is supposed to decline this too, for its own reason"
    );
}

/// The loop-gap bar is a gate, not a report.
///
/// **No fixture reaches this and none is expected to**: on simply connected
/// paper a closed loop follows from per-vertex closure, and the coverage hole
/// that made the implication false — a border the closure check declines to look
/// at — is refused one step earlier by `InteriorCut`. So the gate is driven
/// directly, by moving the bar under a placement's own measured gap rather than
/// by authoring geometry that cannot exist. What this pins is that the
/// comparison happens, that it is relative to the span, and that it reports the
/// numbers the placement measured.
#[test]
fn the_loop_gap_refusal_fires_when_the_measured_gap_exceeds_the_bar() {
    let model = fixture("penguin_freeform");
    let admitted = admit(&model.line_segments, 1).expect("penguin_freeform is admitted by default");
    let relative = admitted.placement.loop_gap.offset / admitted.placement.span;
    assert!(
        relative > 0.0,
        "this fixture needs a non-zero gap for the bar to be moved under"
    );

    let tightened = Fold3dTolerances {
        distance_relative: relative / 2.0,
        ..Fold3dTolerances::DEFAULT
    };
    match admit_with(&model.line_segments, 1, tightened) {
        Err(Fold3dRefusal::LoopNotClosed {
            worst_edge,
            gap_offset,
            gap_radians,
        }) => {
            assert_eq!(
                gap_offset, admitted.placement.loop_gap.offset,
                "the refusal must carry the gap the placement measured"
            );
            assert_eq!(gap_radians, admitted.placement.loop_gap.rotation_radians);
            assert_eq!(worst_edge, admitted.placement.loop_gap.worst_edge);
        }
        other => panic!("expected the loop gap to gate, got {other:?}"),
    }

    // Relative to the span, not absolute: a bar just above the same ratio admits.
    let loosened = Fold3dTolerances {
        distance_relative: relative * 2.0,
        ..Fold3dTolerances::DEFAULT
    };
    assert!(admit_with(&model.line_segments, 1, loosened).is_ok());
}

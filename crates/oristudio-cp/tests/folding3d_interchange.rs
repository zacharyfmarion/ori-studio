//! `.fold` interchange for the 3D folded state.
//!
//! What this pins is the *file*, through the shipped command rather than the
//! builder: what a `foldedForm` frame says about itself, that a second export
//! does not stack a second copy, that a frame from another tool is never
//! disturbed, and that re-opening our own export lands on the crease pattern
//! rather than on the folded form.

use oristudio_cp::folding::FoldedFigureModel;
use oristudio_cp::folding3d::interchange::FOLDED_FORM_MARKER;
use oristudio_cp::geometry::{LineColor, LineSegment, Point};
use oristudio_cp::session::{CpSession, Fold3dFoldResult};
use serde_json::Value;
use std::path::{Path, PathBuf};

fn repo(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(relative)
}

/// A fixture handle, or `None` when it is one of the third-party models held
/// outside the repository and the corpus is not configured.
mod common;

fn try_load_fixture(test: &str, session: &mut CpSession, name: &str) -> Option<u32> {
    let path = common::fixture_path(test, name)?;
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    Some(
        session
            .load_fold(&raw, name)
            .unwrap_or_else(|error| panic!("load {name}: {error}")),
    )
}

fn load_fixture(session: &mut CpSession, name: &str) -> u32 {
    assert!(
        !common::is_external(name),
        "{name} is held outside the repository; use try_load_fixture"
    );
    let path = repo(&format!("tests/fixtures/fold-angle-3d/{name}.fold"));
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    session
        .load_fold(&raw, name)
        .unwrap_or_else(|error| panic!("load {name}: {error}"))
}

fn fold_3d(session: &mut CpSession, document: u32) -> u32 {
    let count = session
        .document_snapshot(document)
        .expect("document")
        .crease_pattern
        .line_segments
        .len();
    let lines: Vec<usize> = (1..=count).collect();
    match session
        .folded_figure_fold_3d(document, &lines, 1, FoldedFigureModel::default())
        .expect("fold in 3D")
    {
        Fold3dFoldResult::Placed { handle, .. } => handle,
        Fold3dFoldResult::Refused { refusal } => panic!("expected a placement, got {refusal:?}"),
    }
}

fn export(session: &CpSession, document: u32, folded: &[u32]) -> Value {
    let json = session
        .export_fold_file(document, folded)
        .expect("export fold file");
    serde_json::from_str(&json).expect("valid fold json")
}

/// The frame is self-describing, three-dimensional, and claims nothing it
/// cannot prove.
#[test]
fn the_exported_folded_form_frame_says_what_it_is() {
    let mut session = CpSession::default();
    let document = load_fixture(&mut session, "box_90");
    let folded = fold_3d(&mut session, document);
    let exported = export(&session, document, &[folded]);

    let frame = &exported["file_frames"][0];
    assert_eq!(frame["frame_classes"], serde_json::json!(["foldedForm"]));
    assert_eq!(frame["frame_attributes"], serde_json::json!(["3D"]));
    assert_eq!(frame["frame_parent"], 0);
    // Not `true`: the root's per-edge arrays are numbered against a different
    // `FoldGraph`, so inheriting them would attach the wrong assignment to
    // every edge. See `folding3d::interchange`.
    assert_eq!(frame["frame_inherit"], false);
    assert_eq!(frame["frame_title"], "Folded form");

    // The crossing predicate is sound but not complete, so no file this build
    // writes may claim the stronger property.
    let attributes = frame["frame_attributes"].as_array().expect("attributes");
    assert!(
        !attributes
            .iter()
            .any(|value| value == "nonSelfIntersecting" || value == "nonSelfTouching"),
        "a verdict of Folded means no crossing was detected, not that none exists"
    );

    let vertices = frame["vertices_coords"].as_array().expect("vertices");
    assert!(!vertices.is_empty());
    assert!(
        vertices
            .iter()
            .all(|coords| coords.as_array().is_some_and(|c| c.len() == 3)),
        "a folded form is three-dimensional"
    );
    assert!(
        vertices
            .iter()
            .any(|coords| coords[2].as_f64().is_some_and(|z| z.abs() > 1e-6)),
        "box_90 folds out of the paper plane, so some vertex must leave z = 0"
    );

    // The root is still the crease pattern, flat and untouched.
    assert!(
        exported["vertices_coords"]
            .as_array()
            .expect("root vertices")
            .iter()
            .all(|coords| coords.as_array().is_some_and(|c| c.len() == 2)),
        "the pattern the folded form was folded from stays two-dimensional"
    );
}

/// Every face is written, and `faceOrders` names only faces that exist.
#[test]
fn the_frame_writes_every_face_and_orders_only_real_ones() {
    let mut session = CpSession::default();
    let Some(document) = try_load_fixture(
        "the_frame_writes_every_face_and_orders_only_real_ones",
        &mut session,
        "penguin_freeform",
    ) else {
        return;
    };
    let folded = fold_3d(&mut session, document);
    let exported = export(&session, document, &[folded]);

    let frame = &exported["file_frames"][0];
    let faces = frame["faces_vertices"].as_array().expect("faces");
    let vertices = frame["vertices_coords"].as_array().expect("vertices");
    assert!(faces.len() > 100, "penguin_freeform has 127 faces");
    for face in faces {
        for vertex in face.as_array().expect("ring") {
            let index = vertex.as_u64().expect("vertex index") as usize;
            assert!(index < vertices.len(), "ring names missing vertex {index}");
        }
    }

    let orders = frame["faceOrders"].as_array().expect("faceOrders");
    assert!(!orders.is_empty(), "a stacked figure orders something");
    for order in orders {
        let entry = order.as_array().expect("triple");
        assert_eq!(entry.len(), 3);
        let f = entry[0].as_i64().expect("f");
        let g = entry[1].as_i64().expect("g");
        let s = entry[2].as_i64().expect("s");
        assert_ne!(f, g, "a face is not ordered against itself");
        assert!((f as usize) < faces.len() && (g as usize) < faces.len());
        assert!((-1..=1).contains(&s), "sign {s} is outside the spec");
    }
}

/// The weld **chooses** an image rather than averaging two.
///
/// `Placement3d::face_points` keeps one image of a vertex per face on purpose,
/// because averaging them is the operation that destroys the evidence a loop gap
/// is made of. FOLD allows one position, so the export has to pick — and picking
/// the lowest-indexed carrying face's image keeps every emitted coordinate a
/// genuine placed position rather than a mean of two.
///
/// The fixture has to have a dual cycle for this to say anything: without one,
/// two faces' images of a shared vertex are bit-identical and choosing and
/// averaging are the same operation. The guard below is what makes that
/// explicit rather than assumed.
#[test]
fn the_weld_chooses_the_lowest_faces_image_rather_than_averaging() {
    use oristudio_cp::folding3d::interchange::{folded_form_frame, weld_residual};
    use oristudio_cp::folding3d::planes::plane_index;
    use oristudio_cp::folding3d::{Fold3dTolerances, admit};
    use oristudio_cp::io::fold::import_fold_document;

    let raw = std::fs::read_to_string(repo("tests/fixtures/fold-angle-3d/box_90.fold"))
        .expect("read fixture");
    let model = import_fold_document(&serde_json::from_str(&raw).expect("fold json"))
        .expect("import fixture");
    let admission = admit(&model.line_segments, 1).expect("admitted");
    let placement = &admission.placement;

    assert!(
        weld_residual(placement) > 0.0,
        "box_90's faces agree exactly on every shared vertex, so this test \
         cannot tell choosing from averaging — pick a fixture with a dual cycle"
    );

    let index = plane_index(placement, Fold3dTolerances::DEFAULT);
    let frame = folded_form_frame(placement, &index, None, None).expect("under the cap");

    // Re-derive the rule independently: first face in ascending order wins.
    let mut expected: Vec<Option<[f64; 3]>> = vec![None; placement.points.len()];
    for (face, ring) in placement.rings.iter().enumerate() {
        for (slot, &vertex) in ring.iter().enumerate() {
            if expected[vertex].is_none() {
                expected[vertex] = Some(placement.face_points[face][slot]);
            }
        }
    }
    let expected: Vec<[f64; 3]> = expected.into_iter().flatten().collect();
    assert_eq!(expected.len(), frame.vertices_coords.len());
    for (written, chosen) in frame.vertices_coords.iter().zip(&expected) {
        // Bit equality, because "a real placed point" is the whole claim.
        assert_eq!(written.as_slice(), chosen.as_slice());
    }
}

/// Two figures, two frames, in the order they were named.
#[test]
fn two_figures_write_two_frames() {
    let mut session = CpSession::default();
    let document = load_fixture(&mut session, "hinge_90");
    let first = fold_3d(&mut session, document);
    let second = fold_3d(&mut session, document);
    let exported = export(&session, document, &[first, second]);

    let frames = exported["file_frames"].as_array().expect("frames");
    assert_eq!(frames.len(), 2);
    assert_eq!(frames[0]["frame_title"], "Folded form 1");
    assert_eq!(frames[1]["frame_title"], "Folded form 2");
}

/// Exporting twice regenerates our frame instead of stacking a second copy
/// beside it — the way a file grows a contradicting folded form on every save.
#[test]
fn a_second_export_regenerates_rather_than_accumulates() {
    let mut session = CpSession::default();
    let document = load_fixture(&mut session, "box_90");
    let folded = fold_3d(&mut session, document);

    let once = session
        .export_fold_file(document, &[folded])
        .expect("first export");
    let reopened = session.load_fold_file(&once).expect("reopen");
    let twice = export(&session, reopened, &[folded]);

    let frames = twice["file_frames"].as_array().expect("frames");
    assert_eq!(
        frames.len(),
        1,
        "one figure, one frame, however often saved"
    );
    assert!(frames[0].get(FOLDED_FORM_MARKER).is_some());
}

/// A `foldedForm` frame from another tool is preserved verbatim, even while we
/// write our own beside it.
///
/// Keyed on our marker rather than on `frame_classes`, because another tool's
/// folded form has exactly the same classes and parent — and dropping a user's
/// data to make room for ours is the worse trade.
#[test]
fn a_foreign_folded_form_frame_is_never_disturbed() {
    let input = r#"{
      "file_spec": 1.2,
      "frame_title": "crease pattern",
      "frame_classes": ["creasePattern"],
      "vertices_coords": [[0, 0], [400, 0], [400, 400], [0, 400], [0, 200], [400, 200]],
      "edges_vertices": [[0, 1], [1, 5], [5, 2], [2, 3], [3, 4], [4, 0], [4, 5]],
      "edges_assignment": ["B", "B", "B", "B", "B", "B", "M"],
      "edges_foldAngle": [null, null, null, null, null, null, -90],
      "file_frames": [{
        "frame_title": "someone else's fold",
        "frame_classes": ["foldedForm"],
        "frame_parent": 0,
        "frame_inherit": true,
        "vertices_coords": [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        "faces_vertices": [[0, 1, 2]],
        "faceOrders": [[0, 0, -1]],
        "theirCustomField": {"kept": true}
      }]
    }"#;

    let mut session = CpSession::default();
    let document = session.load_fold_file(input).expect("load");
    let folded = fold_3d(&mut session, document);
    let exported = export(&session, document, &[folded]);

    let frames = exported["file_frames"].as_array().expect("frames");
    assert_eq!(frames.len(), 2);
    assert_eq!(frames[0]["frame_title"], "someone else's fold");
    assert_eq!(
        frames[0]["theirCustomField"],
        serde_json::json!({"kept": true})
    );
    assert_eq!(frames[0]["faceOrders"], serde_json::json!([[0, 0, -1]]));
    assert!(frames[0].get(FOLDED_FORM_MARKER).is_none());
    assert!(frames[1].get(FOLDED_FORM_MARKER).is_some());

    // And a second save still leaves theirs alone while replacing ours.
    let again = export(&session, document, &[folded]);
    let frames = again["file_frames"].as_array().expect("frames");
    assert_eq!(frames.len(), 2);
    assert_eq!(frames[0]["frame_title"], "someone else's fold");
}

/// Round trip: our own export re-opens as the crease pattern it was folded
/// from, not as its own folded form.
///
/// This is the coherent half of the branch's decision to refuse importing a
/// folded-form frame. The refusal is about which *frame* describes a pattern —
/// and because the root of our file carries the pattern, the importer prefers it
/// outright and the refusal is never reached.
#[test]
fn our_own_export_reopens_as_the_crease_pattern() {
    let mut session = CpSession::default();
    let document = load_fixture(&mut session, "box_90");
    let before = session.document_summary(document).expect("summary");
    let folded = fold_3d(&mut session, document);
    let json = session
        .export_fold_file(document, &[folded])
        .expect("export");

    let reopened = session.load_fold_file(&json).expect("reopen");
    let after = session.document_summary(reopened).expect("summary");
    assert_eq!(after.line_segments, before.line_segments);

    let snapshot = session.document_snapshot(reopened).expect("snapshot");
    for segment in &snapshot.crease_pattern.line_segments {
        assert!(
            segment.a.x.is_finite() && segment.a.y.is_finite(),
            "the pattern, not the folded form, came back"
        );
    }
    // The folded form rode along unread, ready to be written out again.
    let exported = export(&session, reopened, &[]);
    assert!(
        exported["file_frames"].is_null(),
        "our frames are ours to regenerate; with no figure named, none is written"
    );
}

/// A flat handle is a typed mismatch, not a silently missing frame.
///
/// A flat figure has a folded form too, but it is the shipped wireframe rather
/// than this one — so quietly omitting it would look like an export that lost
/// data, which is the failure this whole feature is defined against.
#[test]
fn a_flat_figure_is_refused_rather_than_skipped() {
    // Split where the crease meets the edge. Unsplit, the arrangement does not
    // trace at all and the fold below returns a figure with no faces in it — see
    // `fold_faces_unresolved`, which is what caught this fixture.
    let ring = [
        ((0.0, 0.0), (200.0, 0.0)),
        ((200.0, 0.0), (400.0, 0.0)),
        ((400.0, 0.0), (400.0, 400.0)),
        ((400.0, 400.0), (200.0, 400.0)),
        ((200.0, 400.0), (0.0, 400.0)),
        ((0.0, 400.0), (0.0, 0.0)),
    ];
    let mut segments: Vec<LineSegment> = ring
        .iter()
        .map(|((ax, ay), (bx, by))| {
            LineSegment::with_color(
                Point::new(*ax, *ay),
                Point::new(*bx, *by),
                LineColor::Black0,
            )
        })
        .collect();
    segments.push(LineSegment::with_color(
        Point::new(200.0, 0.0),
        Point::new(200.0, 400.0),
        LineColor::Red1,
    ));

    let mut session = CpSession::default();
    let document = session.load_cp("", "flat").expect("empty document");
    session
        .insert_line_segments(document, &segments)
        .expect("insert");
    let lines: Vec<usize> = (1..=segments.len()).collect();
    let flat = session
        .folded_figure_fold_selected(
            document,
            &lines,
            1,
            oristudio_cp::folding::EstimationOrder::Order5,
            FoldedFigureModel::default(),
        )
        .expect("an all-classic document folds flat")
        .handle;

    let error = session
        .export_fold_file(document, &[flat])
        .expect_err("a flat figure has no 3D folded form");
    assert_eq!(error.code, "folded_figure_kind_mismatch");
}

//! `steer::LayerSource::from_oriedita` on crease patterns small enough to
//! read (`implementation-plans/layer-order-dialog.md`, row E4): Oriedita's
//! edge rule, its frame and sign, and the refusals v1 makes. The census over
//! real designs is `crates/oracle-tests/tests/layer_order_witness.rs`.

#![cfg(feature = "kernel")]

use oristudio_cp::folding::{
    FoldedRenderInputs, HierarchyRelation, initial_hierarchy_from_segments,
};
use oristudio_cp::session::{CpSession, FoldSource};
use oristudio_fold::complete::CompletionLimits;
use oristudio_fold::steer::{LayerSource, SourceRefusal};
use oristudio_fold::{FaceId, FixedPair};
use oristudio_layer_order::{EdgeKind, Letter};

/// The source a host would hand over for the whole sheet of a `.cp` text.
fn source_of_cp(text: &str) -> FoldSource {
    let mut session = CpSession::new();
    let document = session.load_cp(text, "").expect("load the sheet");
    let lines = session
        .document_summary(document)
        .expect("summary")
        .line_segments;
    let lines: Vec<usize> = (1..=lines).collect();
    session
        .fold_source_of_selection(document, &lines, 1)
        .expect("the selection's source")
}

/// A square of side 400 folded in half along x = 0, its crease of `.cp`
/// type `kind` (1 black, 2 mountain, 3 valley). The edges are split where the
/// crease meets them.
fn book(kind: u8) -> String {
    format!(
        "1 -200 -200 0 -200\n1 0 -200 200 -200\n1 200 -200 200 200\n\
         1 200 200 0 200\n1 0 200 -200 200\n1 -200 200 -200 -200\n\
         {kind} 0 -200 0 200\n"
    )
}

fn pairs(seeds: &[FixedPair]) -> Vec<(usize, usize)> {
    seeds
        .iter()
        .map(|s| (s.upper.0 as usize, s.lower.0 as usize))
        .collect()
}

fn oriedita_letters(source: &FoldSource) -> Vec<(usize, usize)> {
    initial_hierarchy_from_segments(&source.segments, source.starting_face_id)
        .expect("Oriedita's letters")
        .expect("faces")
        .relations
        .iter()
        .map(|r| (r.upper_face, r.lower_face))
        .collect()
}

/// Every line between two faces folds, a mountain if red and a valley
/// otherwise; the letters are Oriedita's initial hierarchy, relation for
/// relation.
#[test]
fn a_crease_of_any_colour_folds_with_oriedita_s_letter() {
    for (kind, letter) in [
        (2, Letter::Mountain),
        (3, Letter::Valley),
        (1, Letter::Valley),
    ] {
        let source = source_of_cp(&book(kind));
        let layer = LayerSource::from_oriedita(&source).unwrap_or_else(|e| panic!("{e}"));
        let view = layer.view();
        assert_eq!(view.faces().len(), 2, "type {kind}");
        assert_eq!(
            view.edges().len(),
            1,
            "type {kind}: only the crease is a fold"
        );
        assert_eq!(
            view.edges()[0].kind,
            EdgeKind::Folded(Some(letter)),
            "type {kind}"
        );
        assert_eq!(
            pairs(layer.letter_seeds()),
            oriedita_letters(&source),
            "type {kind}"
        );
        // The starting face (Oriedita's face 1, index 0) is front-up.
        assert_eq!(view.front_up(FaceId(0)), Some(true));
        assert_eq!(view.front_up(FaceId(1)), Some(false));
        // One overlapping pair, which Oriedita's one subface shares.
        assert_eq!(layer.problem().variables().len(), 1);
        assert_eq!(layer.subface_pairs(), 1);
        assert!(layer.fold_only_pairs().is_empty());
    }
}

/// The session's order goes back as Oriedita's relations, upper face first:
/// on a valley the starting face lies below; on a mountain, above.
#[test]
fn an_order_goes_back_in_oriedita_s_frame() {
    for (kind, upper_is_start) in [(2, true), (3, false), (1, false)] {
        let source = source_of_cp(&book(kind));
        let layer = LayerSource::from_oriedita(&source).unwrap_or_else(|e| panic!("{e}"));
        let session = layer
            .session(&CompletionLimits::default())
            .unwrap_or_else(|e| panic!("{e}"));
        let relations = layer.oriedita_relations(&session.first_order());
        let expected = if upper_is_start {
            HierarchyRelation {
                upper_face: 0,
                lower_face: 1,
            }
        } else {
            HierarchyRelation {
                upper_face: 1,
                lower_face: 0,
            }
        };
        assert_eq!(relations, vec![expected], "type {kind}");
    }
}

/// Faces are found again by a point of the paper, in crease-pattern
/// coordinates, and carry their area there.
#[test]
fn faces_are_found_by_paper_point_and_area() {
    let layer = LayerSource::from_oriedita(&source_of_cp(&book(3))).expect("source");
    let mut total = 0.0;
    for face in [FaceId(0), FaceId(1)] {
        let at = layer.paper_point(face).expect("a point");
        assert_eq!(layer.face_at_paper(at), Some(face));
        let area = layer.paper_area(face).expect("an area");
        assert!((area - 400.0 * 200.0).abs() < 1e-6, "{area}");
        total += area;
    }
    assert!((total - 400.0 * 400.0).abs() < 1e-6);
    // On the crease, and off the paper: no face.
    assert_eq!(layer.face_at_paper([0.0, 0.0]), None);
    assert_eq!(layer.face_at_paper([300.0, 0.0]), None);
    let frame = layer.frame();
    assert_eq!(frame.side, 400.0);
    assert_eq!(frame.to_sheet([-200.0, 200.0]), [0.0, 0.0]);
    assert_eq!(frame.to_sheet([200.0, -200.0]), [1.0, 1.0]);
}

/// A reflex corner of the paper with no crease into it makes a non-convex
/// face, which v1 refuses by name (decision D4).
#[test]
fn a_non_convex_face_is_refused_by_name() {
    // An L: the square without its quarter x > 0, y > 0 (y down), and a
    // valley across the bottom arm.
    let text = "1 -200 -200 0 -200\n1 0 -200 0 0\n1 0 0 200 0\n\
                1 200 0 200 100\n1 200 100 200 200\n1 200 200 -200 200\n\
                1 -200 200 -200 100\n1 -200 100 -200 -200\n\
                3 -200 100 200 100\n";
    let source = source_of_cp(text);
    let refusal = LayerSource::from_oriedita(&source).expect_err("an L is not convex");
    let SourceRefusal::NonConvexFace { face } = refusal else {
        panic!("{refusal:?}");
    };
    assert_eq!(refusal.code(), "source_non_convex_face");
    // The refused face is the L, six corners; the strip below it has four.
    let inputs = FoldedRenderInputs::from_segments(&source.segments, 1)
        .expect("the wireframe")
        .expect("faces");
    let rings = &inputs.wireframe().faces;
    assert_eq!(rings.len(), 2);
    assert_eq!(rings[face.0 as usize].len(), 6, "{rings:?}");
}

/// A face narrower than the tolerance (a pleat 3e-4 wide on a 400 sheet,
/// 7.5e-7 of it, which Oriedita's 2.5e-4 point tolerance still tells apart)
/// is a tolerance refusal, not an order.
#[test]
fn a_face_thinner_than_the_tolerance_is_refused() {
    let text = "1 -200 -200 0 -200\n1 0 -200 0.0003 -200\n1 0.0003 -200 200 -200\n\
                1 200 -200 200 200\n1 200 200 0.0003 200\n1 0.0003 200 0 200\n\
                1 0 200 -200 200\n1 -200 200 -200 -200\n\
                3 0 -200 0 200\n2 0.0003 -200 0.0003 200\n";
    let source = source_of_cp(text);
    let refusal = LayerSource::from_oriedita(&source).expect_err("a thin face");
    assert_eq!(refusal.code(), "source_tolerance", "{refusal:?}");
    let SourceRefusal::Tolerance { cause } = refusal else {
        panic!("{refusal:?}");
    };
    assert_eq!(cause.code(), "thin_face", "{cause:?}");
}

/// A source whose creases trace other faces than its digest names is
/// refused before anything is built.
#[test]
fn a_digest_that_does_not_name_the_faces_is_refused() {
    let mut source = source_of_cp(&book(3));
    source.digest = "0000000000000000".to_string();
    let refusal = LayerSource::from_oriedita(&source).expect_err("forged digest");
    assert_eq!(refusal.code(), "source_digest_mismatch");
}

/// The refusal codes are the wire's.
#[test]
fn refusal_codes_are_the_serialised_tags() {
    let mut source = source_of_cp(&book(3));
    source.digest = "0000000000000000".to_string();
    let refusal = LayerSource::from_oriedita(&source).expect_err("forged digest");
    let wire = serde_json::to_value(&refusal).expect("serialise");
    assert_eq!(wire["code"], refusal.code());
}

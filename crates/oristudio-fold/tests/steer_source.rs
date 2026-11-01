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
use oristudio_fold::steer::{LAYER_ORDER_MAX_STACKED_TRIPLES, LayerSource, SourceRefusal};
use oristudio_fold::{
    CreasePatternInput, FaceId, FixedPair, ImportKind, ImportRefusal, ImportSegment, ImportSpace,
    ImportTarget, ImportedPattern, StartSide,
};
use oristudio_layer_order::{EdgeKind, Letter, MAX_STACKED_TRIPLES};

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

/// `strips` vertical strips of a square of side 400 folded back and forth
/// along creases of alternating letters: every face on one stack, `strips`
/// deep. The edges are split where the creases meet them.
fn accordion_cp(strips: usize) -> String {
    let x = |k: usize| -200.0 + 400.0 * k as f64 / strips as f64;
    let mut text = String::from("1 200 -200 200 200\n1 -200 200 -200 -200\n");
    for k in 0..strips {
        text += &format!(
            "1 {} -200 {} -200\n1 {} 200 {} 200\n",
            x(k),
            x(k + 1),
            x(k),
            x(k + 1)
        );
    }
    for k in 1..strips {
        let kind = if k % 2 == 0 { 2 } else { 3 };
        text += &format!("{kind} {} -200 {} 200\n", x(k), x(k));
    }
    text
}

/// The same accordion on the unit square, as Fold's Import CP reads it.
fn accordion_input(strips: usize) -> CreasePatternInput {
    let segment = |from, to, kind| ImportSegment { from, to, kind };
    let corners = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];
    let mut segments: Vec<ImportSegment> = (0..4)
        .map(|i| segment(corners[i], corners[(i + 1) % 4], ImportKind::Border))
        .collect();
    for k in 1..strips {
        let at = k as f64 / strips as f64;
        let kind = if k % 2 == 0 {
            ImportKind::Mountain
        } else {
            ImportKind::Valley
        };
        segments.push(segment([at, 0.0], [at, 1.0], kind));
    }
    CreasePatternInput {
        space: ImportSpace::Sheet,
        segments,
    }
}

fn choose3(d: u64) -> u64 {
    d * (d - 1) * (d - 2) / 6
}

/// The fewest layers one stack needs to hold more than `cap` triples.
fn deepest_over(cap: u64) -> usize {
    (3..).find(|&d| choose3(d) > cap).unwrap_or(3) as usize
}

/// The dialog's cap while its deadlines were 30 s: 60 s ones take deeper
/// stacks than it.
const THIRTY_SECOND_CAP: u64 = 20_000_000;

/// The dialog takes stacks deeper than Fold's cap: accordions one layer past
/// the deepest stack Fold imports and one past the dialog's 30 s cap are the
/// dialog's to order, while Fold's Import CP still refuses the same patterns.
#[test]
fn a_stack_too_deep_for_fold_is_admitted_up_to_the_dialog_s_own_cap() {
    const { assert!(LAYER_ORDER_MAX_STACKED_TRIPLES > THIRTY_SECOND_CAP) };
    const { assert!(THIRTY_SECOND_CAP > MAX_STACKED_TRIPLES) };
    let depths = [
        deepest_over(MAX_STACKED_TRIPLES),
        deepest_over(THIRTY_SECOND_CAP),
    ];
    assert_eq!(depths, [418, 495]);
    for strips in depths {
        let triples = choose3(strips as u64);
        assert!(triples <= LAYER_ORDER_MAX_STACKED_TRIPLES, "{strips}");

        let layer = LayerSource::from_oriedita(&source_of_cp(&accordion_cp(strips)))
            .unwrap_or_else(|e| panic!("{strips}: {e}"));
        assert_eq!(layer.view().faces().len(), strips);
        let depth = layer.problem().stack_depth(layer.view());
        assert_eq!((depth.deepest, depth.triples), (strips, triples));

        let refusal = ImportedPattern::new(
            &accordion_input(strips),
            ImportTarget::Empty {
                start: StartSide::Front,
            },
        )
        .err();
        assert_eq!(
            refusal,
            Some(ImportRefusal::StackedTooDeep {
                deepest: strips,
                triples,
                limit: MAX_STACKED_TRIPLES,
            })
        );
    }
}

/// One layer past the deepest stack the dialog's cap takes is refused with
/// how deep it stacks, which the dialog's notice names.
#[test]
fn a_stack_over_the_dialog_s_cap_is_refused_with_its_depth() {
    let cap = LAYER_ORDER_MAX_STACKED_TRIPLES;
    let strips = deepest_over(cap);
    let triples = choose3(strips as u64);
    let refusal = LayerSource::from_oriedita(&source_of_cp(&accordion_cp(strips)))
        .expect_err("over the dialog's cap");
    assert_eq!(
        refusal,
        SourceRefusal::StackedTooDeep {
            deepest: strips,
            triples,
            limit: cap,
        }
    );
    let wire = serde_json::to_value(&refusal).expect("serialise");
    assert_eq!(
        wire,
        serde_json::json!({
            "code": "source_stacked_too_deep",
            "deepest": strips,
            "triples": triples,
            "limit": cap,
        })
    );
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

//! A document's auxiliary lines on a 3D figure: drawn on the paper, folded by
//! nothing, and asked for again whenever they change.

use oristudio_cp::folding::FoldedFigureModel;
use oristudio_cp::folding3d::model::{FOLDED_3D_FACE_ATTR_STRIDE, Folded3dRenderModel};
use oristudio_cp::geometry::{LineColor, LineSegment, Point};
use oristudio_cp::session::{CpSession, Fold3dFoldResult};
use std::path::Path;

fn load_hinge(session: &mut CpSession) -> u32 {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/fold-angle-3d/hinge_90.fold");
    let raw = std::fs::read_to_string(&path).expect("read hinge_90");
    session.load_fold(&raw, "hinge_90").expect("load hinge_90")
}

fn fold_3d(session: &mut CpSession, document: u32) -> (u32, Folded3dRenderModel) {
    match session
        .folded_figure_fold_3d(document, &[1, 2, 3, 4, 5], 1, FoldedFigureModel::default())
        .expect("fold in 3D")
    {
        Fold3dFoldResult::Placed { handle, render, .. } => (handle, *render),
        Fold3dFoldResult::Refused { refusal } => panic!("expected a placement, got {refusal:?}"),
    }
}

type Vec3 = [f64; 3];

fn piece(points: &[f64], index: usize) -> (Vec3, Vec3) {
    let p = &points[index * 6..index * 6 + 6];
    ([p[0], p[1], p[2]], [p[3], p[4], p[5]])
}

fn distance(a: Vec3, b: Vec3) -> f64 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}

/// How far `p` is off the plane of `face`'s own placed ring.
fn off_face(model: &Folded3dRenderModel, face: usize, p: Vec3) -> f64 {
    let start = model.face_attr[face * FOLDED_3D_FACE_ATTR_STRIDE + 1] as usize;
    let on = &model.ring_points[start * 3..start * 3 + 3];
    let n = &model.face_normals[face * 3..face * 3 + 3];
    ((p[0] - on[0]) * n[0] + (p[1] - on[1]) * n[1] + (p[2] - on[2]) * n[2]).abs()
}

/// A line across the hinge, drawn after the fold: a piece on each face, each
/// the length it has on the paper, lying on its face and meeting the other on
/// the hinge — the paper's picture, with nothing refolded.
#[test]
fn an_aux_line_drawn_after_the_fold_lands_on_both_faces() {
    let mut session = CpSession::default();
    let document = load_hinge(&mut session);
    let (figure, model) = fold_3d(&mut session, document);
    assert!(
        session
            .folded_figure_3d_aux_lines(figure, document)
            .expect("aux lines")
            .is_empty(),
        "the fixture has no aux line"
    );

    // Across the mountain diagonal y = -x, through its middle.
    let aux = LineSegment::with_color(
        Point::new(-200.0, 0.0),
        Point::new(200.0, 0.0),
        LineColor::Cyan3,
    );
    session
        .insert_line_segments(document, std::slice::from_ref(&aux))
        .expect("draw an aux line");
    let lines = session
        .folded_figure_3d_aux_lines(figure, document)
        .expect("aux lines");
    assert_eq!(lines.len(), 2, "{lines:?}");
    assert_ne!(lines.faces[0], lines.faces[1], "one piece per face");

    let (a0, b0) = piece(&lines.points, 0);
    let (a1, b1) = piece(&lines.points, 1);
    for (face, (a, b)) in [(lines.faces[0], (a0, b0)), (lines.faces[1], (a1, b1))] {
        assert!(
            (distance(a, b) - 200.0).abs() < 1e-9,
            "a rigid map keeps length"
        );
        for end in [a, b] {
            assert!(
                off_face(&model, face as usize, end) < 1e-9,
                "{end:?} is off its face"
            );
        }
    }
    // The two pieces meet where the line crosses the hinge.
    let meet = [a0, b0]
        .iter()
        .flat_map(|p| [a1, b1].map(|q| distance(*p, q)))
        .fold(f64::INFINITY, f64::min);
    assert!(meet < 1e-9, "the pieces part at the hinge by {meet}");
}

#[test]
fn a_flat_figure_or_a_missing_document_is_an_error() {
    let mut session = CpSession::default();
    let document = load_hinge(&mut session);
    let (figure, _) = fold_3d(&mut session, document);
    assert!(session.folded_figure_3d_aux_lines(figure, 99).is_err());
    assert!(session.folded_figure_3d_aux_lines(99, document).is_err());
}

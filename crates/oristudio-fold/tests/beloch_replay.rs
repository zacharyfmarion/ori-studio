//! Every Beloch fixture's final frame as a Fold state (`tests/beloch/`): its
//! own crease pattern through Import CP and its own `faceOrders` replayed by
//! witnesses. Each replays except `join-edge`, an L-shaped sheet, which Import
//! CP refuses by name. A replayed state is the frame: one face per frame
//! face, every face placed by one rigid motion of the frame's matrices, and
//! the frame's letters.

mod beloch;

use beloch::{Matrix, final_frame, fixtures, replay, to_table};
use oristudio_fold::import::UnsupportedShape;
use oristudio_fold::{ImportKind, ImportRefusal, Isometry};

type Point = [f64; 2];

/// The fixtures Import CP cannot take, with the refusal it gives.
const OUT_OF_SCOPE: [(&str, &str); 1] = [
    // An L-shaped sheet: a square or a rectangle is all V0 imports.
    ("join-edge", "import_shape_unsupported"),
];

fn close(a: Point, b: Point, tol: f64) -> bool {
    (a[0] - b[0]).abs() <= tol && (a[1] - b[1]).abs() <= tol
}

/// The model frame to the table, through one face: its matrix after the
/// inverse of its isometry and of the import's placement.
fn model_to_table(
    m: &Matrix,
    t: &Isometry,
    to_paper: impl Fn(Point) -> Point,
) -> impl Fn(Point) -> Point {
    let inverse = t.inverse();
    move |p| to_table(m, to_paper(inverse.apply(p)))
}

#[test]
fn every_beloch_final_frame_replays_through_import_cp() {
    let mut replayed = 0;
    for fixture in fixtures() {
        let name = fixture.name.as_str();
        let frame = final_frame(&fixture.document).unwrap_or_else(|e| panic!("{name}: {e}"));
        let expected = OUT_OF_SCOPE
            .iter()
            .find(|(n, _)| *n == name)
            .map(|(_, c)| *c);
        let result = replay(&frame);
        if let Some(code) = expected {
            match result {
                Err(refusal) => assert_eq!(refusal.code(), code, "{name}: {refusal}"),
                Ok(_) => panic!("{name} replays; take it off OUT_OF_SCOPE"),
            }
            continue;
        }
        let r = result.unwrap_or_else(|refusal| panic!("{name}: {refusal} ({})", refusal.code()));
        let state = &r.state;
        assert_eq!(
            state.faces().len(),
            frame.faces.len(),
            "{name}: one face per frame face"
        );

        // One rigid motion takes the model frame onto the table through every
        // face: the state folds the paper as the frame does. Compared at
        // three points, which fix an affine map.
        let probes = [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]];
        let mut first: Option<[Point; 3]> = None;
        for (k, (face, witness)) in frame.faces.iter().zip(&r.witnesses).enumerate() {
            let id = state
                .face_at(*witness)
                .unwrap_or_else(|| panic!("{name}: frame face {k} is no face"));
            let t = state.isometry(id).unwrap_or_else(|| unreachable!());
            let through = model_to_table(&face.matrix, &t, |p| r.imported.to_input(p));
            let images = probes.map(&through);
            match first {
                None => first = Some(images),
                Some(first) => assert!(
                    first.iter().zip(&images).all(|(a, b)| close(*a, *b, 1e-9)),
                    "{name}: frame face {k} is placed apart from the others"
                ),
            }
        }

        // The frame's letters: as many folded creases as the frame has
        // folded edges, the rest flat.
        let folded = frame
            .input
            .segments
            .iter()
            .filter(|s| matches!(s.kind, ImportKind::Mountain | ImportKind::Valley))
            .count();
        assert_eq!(
            state
                .creases()
                .iter()
                .filter(|c| c.kind.is_folded())
                .count(),
            folded,
            "{name}: folded creases"
        );
        replayed += 1;
    }
    assert_eq!(replayed, 55, "of 56 fixtures");
}

#[test]
fn the_l_shaped_sheet_is_refused_by_name() {
    let fixture = fixtures()
        .into_iter()
        .find(|f| f.name == "join-edge")
        .unwrap_or_else(|| panic!("no join-edge fixture"));
    let frame = final_frame(&fixture.document).unwrap_or_else(|e| panic!("{e}"));
    match replay(&frame) {
        Err(beloch::Refusal::Import(ImportRefusal::ShapeUnsupported {
            which: UnsupportedShape::Pattern { corners },
        })) => assert_eq!(corners.len(), 6, "{corners:?}"),
        Err(other) => panic!("{other}"),
        Ok(_) => panic!("an L-shaped sheet imported"),
    }
}

//! The FOLD export of a sequence path (plan D10, Phase 2 "FOLD export"): a
//! `diagrams` file whose root is the kernel's own FOLD of the final crease
//! pattern and whose step frames are flat folded forms, each checked against
//! the state it came from; the whole-file cap and its refusal; and Edit
//! keeping the step frames when it saves the file.

#![cfg(feature = "kernel")]

mod paths;

use oristudio_cp::folding3d::interchange::FOLDED_FORM_MAX_ELEMENTS;
use oristudio_cp::io::fold::{
    export_fold_document, export_fold_file_document_json, import_fold_file_document,
    import_fold_file_document_json, import_fold_file_json,
};
use oristudio_fold::fold_file::{
    FACES_MATRIX_KEY, FILE_CLASSES, FOLD_STEP_MARKER, export_fold_sequence_with_cap, is_step_frame,
    step_frame_size,
};
use oristudio_fold::{
    CreaseKind, Direction, FoldExportError, KernelFrame, Letter, PlainFold, Sheet, Side, StartSide,
    State, VertexId, export_fold_sequence, export_fold_sequence_json, fold_cp_to_model,
};
use oristudio_geometry::Line;
use paths::*;
use serde_json::{Value, json};
use treemaker_fold::{Assignment, FoldDocument};

type Point = [f64; 2];

fn export(path: &[State]) -> FoldDocument {
    export_fold_sequence(path, Some("Sequence")).unwrap_or_else(|e| panic!("{e}"))
}

/// Every path the checks run on: the classics, the dyadic path (which turns
/// over and rotates), and a few random paths.
fn export_paths() -> Vec<(String, Vec<State>)> {
    let mut paths = classic_paths();
    paths.push(("dyadic".to_string(), dyadic_path()));
    let mut rng = Rng::new(0xf01d);
    for (s, sheet) in sheets().into_iter().enumerate() {
        paths.push((format!("random sheet {s}"), random_path(&mut rng, sheet, 8)));
    }
    paths
}

fn coords(frame: &FoldDocument, v: usize) -> Point {
    let c = &frame.vertices_coords[v];
    [c[0], c[1]]
}

/// Twice the signed area of a face's ring in the frame's coordinates: its
/// right-hand normal is +z when positive.
fn winding(frame: &FoldDocument, face: usize) -> f64 {
    let ring = &frame.faces_vertices[face];
    (0..ring.len())
        .map(|i| {
            let (a, b) = (
                coords(frame, ring[i]),
                coords(frame, ring[(i + 1) % ring.len()]),
            );
            a[0] * b[1] - a[1] * b[0]
        })
        .sum()
}

fn matrices(frame: &FoldDocument) -> Vec<[f64; 6]> {
    frame.extra[FACES_MATRIX_KEY]
        .as_array()
        .unwrap_or_else(|| panic!("no matrices"))
        .iter()
        .map(|m| {
            let row: Vec<f64> = m
                .as_array()
                .unwrap_or_else(|| panic!("{m}"))
                .iter()
                .filter_map(Value::as_f64)
                .collect();
            row.try_into().unwrap_or_else(|r| panic!("{r:?}"))
        })
        .collect()
}

#[test]
fn a_path_exports_as_diagrams_over_the_kernels_crease_pattern() {
    for (name, path) in export_paths() {
        let doc = export(&path);
        let last = &path[path.len() - 1];
        assert_eq!(doc.extra["file_classes"], json!(FILE_CLASSES), "{name}");
        assert_eq!(doc.frame_classes, vec!["creasePattern".to_string()]);
        assert_eq!(doc.file_title.as_deref(), Some("Sequence"));
        assert_eq!(
            doc.file_frames.len(),
            path.len(),
            "{name}: one frame per state"
        );
        assert!(doc.file_frames.iter().all(is_step_frame));

        // The root is the kernel writer's FOLD of the final crease pattern.
        let kernel = export_fold_document(&fold_cp_to_model(last), Some("Sequence".to_string()));
        assert_eq!(doc.vertices_coords, kernel.vertices_coords, "{name}");
        assert_eq!(doc.edges_vertices, kernel.edges_vertices);
        assert_eq!(doc.edges_assignment, kernel.edges_assignment);
        assert_eq!(doc.edges_fold_angle, kernel.edges_fold_angle);
        assert_eq!(doc.faces_vertices, kernel.faces_vertices);
        assert_eq!(doc.faces_edges, kernel.faces_edges);
        for (key, value) in &kernel.extra {
            assert_eq!(doc.extra.get(key), Some(value), "{name}: {key}");
        }

        // And Edit opens it as the final crease pattern, to the bit.
        let opened = import_fold_file_document(&doc).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!(opened.crease_pattern, fold_cp_to_model(last), "{name}");
    }
}

#[test]
fn step_frames_are_the_states_flat_folded_forms() {
    for (name, path) in export_paths() {
        let doc = export(&path);
        for (state, frame) in path.iter().zip(&doc.file_frames) {
            let at = format!("{name} step {}", state.step());
            assert_eq!(frame.frame_classes, vec!["foldedForm".to_string()]);
            assert_eq!(frame.frame_parent, Some(0));
            assert_eq!(frame.frame_inherit, Some(false));
            let view = state.view();
            assert_eq!(
                frame.extra[FOLD_STEP_MARKER],
                json!({
                    "schema": 1,
                    "step": state.step(),
                    "view": { "flipped": view.flipped, "rotation": view.rotation },
                }),
                "{at}"
            );

            // Vertices at their images as the viewer sees them.
            assert_eq!(frame.vertices_coords.len(), state.vertices().len());
            for v in 0..state.vertices().len() {
                let image = state
                    .vertex_image(VertexId(v as u32))
                    .unwrap_or_else(|| panic!("{at}: v{v}"));
                assert_eq!(
                    coords(frame, v),
                    view.transform().apply(image),
                    "{at}: v{v}"
                );
            }

            // One edge per crease, F for an unfolded one.
            assert_eq!(frame.edges_vertices.len(), state.creases().len());
            for (k, crease) in state.creases().iter().enumerate() {
                let (assignment, angle) = match crease.kind {
                    CreaseKind::Border => (Assignment::Boundary, 0.0),
                    CreaseKind::Folded(Letter::Mountain) => (Assignment::Mountain, -180.0),
                    CreaseKind::Folded(Letter::Valley) => (Assignment::Valley, 180.0),
                    CreaseKind::Flat(_) => (Assignment::Flat, 0.0),
                };
                assert_eq!(
                    frame.edges_vertices[k],
                    crease.vertices.map(|v| v.0 as usize),
                    "{at}"
                );
                assert_eq!(frame.edges_assignment[k], assignment, "{at}: {}", crease.id);
                assert_eq!(
                    frame.edges_fold_angle[k],
                    Some(angle),
                    "{at}: {}",
                    crease.id
                );
            }

            // One face per face, its ring as the state stores it.
            let rings: Vec<Vec<usize>> = state
                .faces()
                .iter()
                .map(|f| f.ring.iter().map(|v| v.0 as usize).collect())
                .collect();
            assert_eq!(frame.faces_vertices, rings, "{at}");
            assert_eq!(
                step_frame_size(state).face_ring_entries,
                rings.iter().map(Vec::len).sum::<usize>()
            );
        }
    }
}

/// FOLD's rule, read off the file itself: `[f, g, s]` has `s = +1` exactly
/// when f lies on the side g's right-hand normal points to, the normal coming
/// from g's ring as the frame winds it.
#[test]
fn face_orders_follow_folds_convention() {
    let mut checked = 0;
    for (name, path) in export_paths() {
        let doc = export(&path);
        for (state, frame) in path.iter().zip(&doc.file_frames) {
            let faces = state.faces();
            assert_eq!(frame.face_orders.len(), state.order().len(), "{name}");
            for &[fi, gi, s] in &frame.face_orders {
                let (f, g) = (faces[fi as usize].id, faces[gi as usize].id);
                let normal_up = winding(frame, gi as usize) > 0.0;
                assert_eq!(
                    Some(normal_up),
                    state.seen_front_up(g),
                    "{name}: the ring winds by what the viewer sees"
                );
                let seen_above = state
                    .seen_above(f, g)
                    .unwrap_or_else(|| panic!("{name}: {f} and {g} are not ordered"));
                assert_eq!(s, if seen_above == normal_up { 1 } else { -1 }, "{name}");
                checked += 1;
            }
        }
    }
    assert!(checked > 500, "only {checked} triples");
}

/// The matrices take each face's sheet ring onto its folded ring; their
/// inverses are what a Beloch-style importer pulls the faces back with.
#[test]
fn faces_matrices_map_the_sheet_onto_the_frame() {
    for (name, path) in export_paths() {
        let doc = export(&path);
        for (state, frame) in path.iter().zip(&doc.file_frames) {
            let m = matrices(frame);
            assert_eq!(m.len(), state.faces().len());
            for (f, face) in state.faces().iter().enumerate() {
                let [m00, m01, m10, m11, tx, ty] = m[f];
                for v in &face.ring {
                    let p = state.vertices()[v.0 as usize];
                    let q = coords(frame, v.0 as usize);
                    let mapped = [m00 * p[0] + m01 * p[1] + tx, m10 * p[0] + m11 * p[1] + ty];
                    assert!(
                        (mapped[0] - q[0]).abs() < 1e-9 && (mapped[1] - q[1]).abs() < 1e-9,
                        "{name}: {v} maps to {mapped:?}, the frame has {q:?}"
                    );
                }
                let det = m00 * m11 - m01 * m10;
                assert!((det.abs() - 1.0).abs() < 1e-12, "{name}: an isometry");
                assert_eq!(det > 0.0, winding(frame, f) > 0.0, "{name}");
            }
        }
    }
}

/// The root and the step frames are mirror images (the module docs): a
/// precrease of the corner leaves the paper flat, so the root's crease
/// pattern and the last step frame picture the same paper. The kernel frame
/// takes every frame vertex onto a root vertex and each frame edge onto a
/// root edge, the root's faces wind clockwise, and the frame's
/// counter-clockwise.
#[test]
fn the_root_and_a_flat_step_frame_are_mirror_images() {
    let flat = State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"));
    let line = Line::from_points([0.5, 0.0], [0.0, 0.5]).unwrap_or_else(|| unreachable!());
    let side = Side::of_point(&line, [0.1, 0.1]).unwrap_or_else(|| unreachable!());
    let precreased = flat
        .precrease(&PlainFold::new(line, side, Direction::Valley))
        .unwrap_or_else(|e| panic!("{e}"))
        .state;
    let doc = export(&[flat, precreased.clone()]);
    let frame = &doc.file_frames[1];
    let kernel = KernelFrame::of(precreased.sheet());
    let root_vertex = |p: Point| {
        (0..doc.vertices_coords.len())
            .find(|&v| {
                let q = coords(&doc, v);
                (p[0] - q[0]).abs() < 1e-9 && (p[1] - q[1]).abs() < 1e-9
            })
            .unwrap_or_else(|| panic!("{p:?} is no root vertex"))
    };
    let mapped: Vec<usize> = (0..frame.vertices_coords.len())
        .map(|v| root_vertex(kernel.to_model(coords(frame, v))))
        .collect();
    assert_eq!(doc.vertices_coords.len(), frame.vertices_coords.len());
    for [a, b] in frame.edges_vertices.iter().map(|e| [e[0], e[1]]) {
        let (a, b) = (mapped[a], mapped[b]);
        assert!(
            doc.edges_vertices
                .iter()
                .any(|e| (e[0], e[1]) == (a, b) || (e[0], e[1]) == (b, a)),
            "no root edge {a}–{b}"
        );
    }
    // The y axis turns over between the two: sheet (0, 0) is the root's
    // lower left corner at (−200, 200).
    assert_eq!(kernel.to_model([0.0, 0.0]), [-200.0, 200.0]);
    assert_eq!(kernel.to_model([1.0, 1.0]), [200.0, -200.0]);
    assert_eq!(doc.faces_vertices.len(), frame.faces_vertices.len());
    for f in 0..doc.faces_vertices.len() {
        assert!(winding(&doc, f) < 0.0, "root face {f} winds clockwise");
        assert!(
            winding(frame, f) > 0.0,
            "frame face {f} winds counter-clockwise"
        );
    }
}

/// Turning over mirrors the frame and flips every face, and no triple or
/// letter changes; rotating turns the frame.
#[test]
fn turning_over_mirrors_a_frame_and_keeps_its_triples() {
    let path = dyadic_path();
    let doc = export(&path);
    let [folded, turned, rotated] = [4, 5, 6].map(|i| &doc.file_frames[i]);
    for v in 0..folded.vertices_coords.len() {
        let [x, y] = coords(folded, v);
        assert_eq!(coords(turned, v), [-x, y]);
        let [tx, ty] = coords(turned, v);
        let [rx, ry] = coords(rotated, v);
        assert!(
            (rx + ty).abs() < 1e-12 && (ry - tx).abs() < 1e-12,
            "a quarter turn"
        );
    }
    assert!(!folded.face_orders.is_empty());
    assert_eq!(turned.face_orders, folded.face_orders);
    assert_eq!(rotated.face_orders, folded.face_orders);
    assert_eq!(turned.edges_assignment, folded.edges_assignment);
    for (a, b) in matrices(folded).iter().zip(&matrices(turned)) {
        assert_eq!(a[0] * a[3] - a[1] * a[2], -(b[0] * b[3] - b[1] * b[2]));
    }
}

/// The cap is held against the whole file: every frame on its own is far
/// under the cap that refuses the file.
#[test]
fn the_whole_file_is_capped() {
    let mut rng = Rng::new(0xca9);
    let path = random_path(&mut rng, sheets()[0].clone(), 12);
    let doc = export(&path);
    let size = |f: &FoldDocument| {
        f.vertices_coords.len()
            + f.faces_vertices.iter().map(Vec::len).sum::<usize>()
            + f.face_orders.len()
    };
    let total = size(&doc) + doc.file_frames.iter().map(size).sum::<usize>();
    let widest = doc.file_frames.iter().map(size).max().unwrap_or(0);
    assert!(widest * 2 < total, "a path of more than one sizeable frame");
    for (state, frame) in path.iter().zip(&doc.file_frames) {
        assert_eq!(step_frame_size(state).elements(), size(frame));
    }

    assert!(export_fold_sequence_with_cap(&path, None, total).is_ok());
    match export_fold_sequence_with_cap(&path, None, total - 1) {
        Err(FoldExportError::TooLarge(e)) => {
            assert_eq!((e.size.elements(), e.cap), (total, total - 1));
            assert_eq!(
                e.size.face_orders,
                doc.file_frames
                    .iter()
                    .map(|f| f.face_orders.len())
                    .sum::<usize>()
            );
            let error = FoldExportError::TooLarge(e);
            assert_eq!(error.code(), "fold_export_too_large");
            assert!(error.to_string().contains("over the"), "{error}");
        }
        other => panic!("expected the cap to refuse, got {other:?}"),
    }
    assert!(total < FOLDED_FORM_MAX_ELEMENTS / 100);
}

#[test]
fn an_empty_path_is_refused() {
    match export_fold_sequence(&[], None) {
        Err(e @ FoldExportError::EmptyPath) => assert_eq!(e.code(), "fold_export_empty"),
        other => panic!("expected a refusal, got {other:?}"),
    }
}

/// Edit opens the text, and saving it again keeps every step frame and the
/// file's classes: it regenerates only the 3D writer's frames.
#[test]
fn edit_keeps_the_step_frames_when_it_saves() {
    let (_, path) = classic_paths()
        .into_iter()
        .find(|(name, _)| name == "kite-base")
        .unwrap_or_else(|| panic!("no kite-base fixture"));
    let text = export_fold_sequence_json(&path, Some("Kite")).unwrap_or_else(|e| panic!("{e}"));
    let written = import_fold_file_json(&text).unwrap_or_else(|e| panic!("{e}"));
    let document = import_fold_file_document_json(&text).unwrap_or_else(|e| panic!("{e}"));
    let saved = export_fold_file_document_json(&document).unwrap_or_else(|e| panic!("{e}"));
    let saved = import_fold_file_json(&saved).unwrap_or_else(|e| panic!("{e}"));

    assert_eq!(saved.extra.get("file_classes"), Some(&json!(FILE_CLASSES)));
    assert_eq!(saved.file_frames.len(), path.len());
    for (a, b) in written.file_frames.iter().zip(&saved.file_frames) {
        assert!(is_step_frame(b));
        assert_eq!(a.extra[FOLD_STEP_MARKER], b.extra[FOLD_STEP_MARKER]);
        assert_eq!(a.edges_vertices, b.edges_vertices);
        assert_eq!(a.edges_assignment, b.edges_assignment);
        assert_eq!(a.faces_vertices, b.faces_vertices);
        assert_eq!(a.face_orders, b.face_orders);
        // Text in and text out: the numbers agree to the parser's precision.
        for (p, q) in a.vertices_coords.iter().zip(&b.vertices_coords) {
            assert!((p[0] - q[0]).abs() < 1e-15 && (p[1] - q[1]).abs() < 1e-15);
        }
    }
}

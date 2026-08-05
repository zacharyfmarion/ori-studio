//! Importing FOLD files whose geometry is not on the root frame.
//!
//! `file_frames` is a `Vec<FoldDocument>`, so any field that is mandatory on the
//! root is mandatory on every embedded frame too. `vertices_coords` and
//! `edges_vertices` were the only two without `#[serde(default)]`, which made
//! two of the commonest real file layouts fail to deserialize — reported as a
//! serde "missing field" rather than as anything a user could act on.

use oristudio_cp::io::fold::import_fold_file_document_json;

/// Geometry shared by the cases: a square sheet with one diagonal mountain.
const GEOMETRY: &str = r#"
    "vertices_coords": [[0,0],[400,0],[400,400],[0,400]],
    "edges_vertices": [[0,1],[1,2],[2,3],[3,0],[0,2]],
    "edges_assignment": ["B","B","B","B","M"]
"#;

#[test]
fn imports_a_single_frame_document() {
    // Control: the layout that already worked.
    let text = format!("{{{GEOMETRY}}}");
    let document = import_fold_file_document_json(&text).expect("single-frame FOLD should import");
    assert_eq!(document.crease_pattern.line_segments.len(), 5);
}

#[test]
fn imports_geometry_carried_on_an_embedded_frame() {
    // The canonical multi-frame layout: metadata at the root, geometry in
    // `file_frames[0]`. This is what Rabbit Ear emits.
    let text = format!(
        r#"{{
            "file_spec": 1.1,
            "file_creator": "Rabbit Ear",
            "file_frames": [{{ "frame_classes": ["creasePattern"], {GEOMETRY} }}]
        }}"#
    );
    let document = import_fold_file_document_json(&text).expect("multi-frame FOLD should import");
    assert_eq!(document.crease_pattern.line_segments.len(), 5);
}

#[test]
fn imports_root_geometry_beside_a_frame_that_omits_its_own() {
    // Root geometry is valid and complete; a sibling folded-form frame inherits
    // its edges rather than restating them. Rejecting the whole file because a
    // *sibling* omitted a field is the worst version of this bug.
    let text = format!(
        r#"{{
            "file_spec": 1.1,
            {GEOMETRY},
            "file_frames": [{{
                "frame_classes": ["foldedForm"],
                "frame_parent": 0,
                "frame_inherit": true,
                "vertices_coords": [[0,0],[400,0],[400,400],[0,400]]
            }}]
        }}"#
    );
    let document = import_fold_file_document_json(&text).expect("root geometry should import");
    assert_eq!(document.crease_pattern.line_segments.len(), 5);
}

#[test]
fn rejects_a_document_with_no_usable_geometry_anywhere() {
    // Relaxing the serde requirement must not turn "no geometry at all" into a
    // silently empty document: it still has to be an error, just a meaningful
    // one rather than a missing-field message about a field the spec calls
    // optional.
    let text = r#"{ "file_spec": 1.1, "file_creator": "nothing here" }"#;
    let error = import_fold_file_document_json(text)
        .expect_err("a document with no geometry should be rejected");
    let message = error.to_string();
    assert!(
        !message.contains("missing field"),
        "should not surface a serde missing-field message, got: {message}"
    );
}

#[test]
fn round_trips_a_framed_document_through_export() {
    // `export_fold_file_document` preserves `file_frames` from the source, so a
    // document that imported must still import after a save.
    let text = format!(
        r#"{{
            "file_spec": 1.1,
            "file_frames": [{{ "frame_classes": ["creasePattern"], {GEOMETRY} }}]
        }}"#
    );
    let document = import_fold_file_document_json(&text).expect("import");
    let exported =
        oristudio_cp::io::fold::export_fold_file_document_json(&document).expect("export");
    let reimported = import_fold_file_document_json(&exported).expect("re-import");
    assert_eq!(
        reimported.crease_pattern.line_segments.len(),
        document.crease_pattern.line_segments.len()
    );
}

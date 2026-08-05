//! Frame-shape corpus for FOLD import.
//!
//! `file_frames` is a `Vec<FoldDocument>`, so every field mandatory on the root
//! is mandatory on each embedded frame too. `vertices_coords` and
//! `edges_vertices` were required, and the FOLD spec calls both only
//! "Recommended" — so ordinary files were rejected outright, most often because
//! a folded-form frame inherited its edges rather than restating them.
//!
//! These fixtures pin one file shape each, with an exact expected segment count
//! rather than a bare "it imported": a regression that silently produced an
//! *empty* document would otherwise pass. Every shape here was measured against
//! a real third-party corpus first (see `external corpus` below); the fixtures
//! are authored rather than vendored because real-user corpus files are not
//! committed to this repository (`tests/corpus/README.md`).

use oristudio_cp::io::fold::import_fold_file_document_json;
use std::path::{Path, PathBuf};

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/fold-frames")
}

fn import(name: &str) -> Result<usize, String> {
    let path = fixture_dir().join(name);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    import_fold_file_document_json(&text)
        .map(|document| document.crease_pattern.line_segments.len())
        .map_err(|error| error.to_string())
}

/// Every fixture that must import, and the segment count it must produce.
///
/// All of them describe the same square-plus-diagonal pattern, so they all
/// import to 5 segments; a shape that resolved to the wrong frame, or to no
/// frame, would not.
const EXPECTED: &[(&str, usize)] = &[
    ("sibling-frame-omits-edges.fold", 5),
    ("sibling-frame-omits-both.fold", 5),
    ("many-inheriting-frames.fold", 5),
    ("geometry-only-in-frame.fold", 5),
    ("nested-frame-inheritance.fold", 5),
];

#[test]
fn imports_every_supported_frame_shape() {
    for (name, expected) in EXPECTED {
        match import(name) {
            Ok(segments) => assert_eq!(segments, *expected, "{name} imported the wrong geometry"),
            Err(error) => panic!("{name} should import, got: {error}"),
        }
    }
}

/// Relaxing the serde requirement must not turn "no geometry" into a silently
/// empty document. These still fail — with a message about the document rather
/// than about a field the spec calls optional.
#[test]
fn rejects_documents_with_no_usable_geometry() {
    for name in ["no-geometry-anywhere.fold", "root-without-edges.fold"] {
        let error = import(name).expect_err("{name} should be rejected");
        assert!(
            !error.contains("missing field"),
            "{name} should not surface a serde missing-field message, got: {error}"
        );
    }
}

/// Scan an external corpus of real `.fold` files, reporting what imports.
///
/// Opt-in, matching the harnesses in `tests/corpus/README.md`: real-user and
/// third-party corpus files are not committed, so point this at a checkout.
///
///   FOLD_FRAME_CORPUS_DIR=/path/to/fold/files \
///     cargo test -p oristudio-cp --test fold_frame_corpus -- --nocapture
///
/// Reports rather than asserts: a corpus contains deliberately-invalid files
/// (abstract graphs, edge-less frames), so a failure count is information, not
/// a gate. The committed fixtures above are the gate.
#[test]
fn external_corpus_scan() {
    let Ok(dir) = std::env::var("FOLD_FRAME_CORPUS_DIR") else {
        return;
    };
    let mut paths: Vec<_> = std::fs::read_dir(&dir)
        .unwrap_or_else(|error| panic!("read {dir}: {error}"))
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "fold"))
        .collect();
    paths.sort();

    let mut imported = 0;
    let mut rejected = Vec::new();
    for path in &paths {
        let text = std::fs::read_to_string(path).expect("read corpus file");
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        match import_fold_file_document_json(&text) {
            Ok(document) => {
                imported += 1;
                println!(
                    "ok   {name:38} segments={}",
                    document.crease_pattern.line_segments.len()
                );
            }
            Err(error) => rejected.push((name, error.to_string())),
        }
    }
    println!(
        "\n{imported} imported, {} rejected, of {}",
        rejected.len(),
        paths.len()
    );
    for (name, error) in &rejected {
        println!("fail {name:38} {error}");
    }
}

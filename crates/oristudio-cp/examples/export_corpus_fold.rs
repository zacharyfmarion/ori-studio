//! Export corpus `.cp` files to FOLD JSON, for measuring share-card PNG sizes.
//!
//! The share preview is rendered by the browser (`canvas.toBlob`), so its byte size can
//! only be measured in a browser — but the crease patterns it renders live on disk as
//! `.cp`. This bridges the two: it emits one `.fold` per document plus an `index.json`
//! carrying the crease counts, which a browser harness then rasterizes.
//!
//! Usage:
//!   cargo run --release -p oristudio-cp --example export_corpus_fold -- <corpus-dir> <out-dir> [stride]
//!
//! `stride` samples every Nth document (default 1, i.e. all of them).

use std::path::{Path, PathBuf};

use oristudio_cp::io::cp::import_cp_str;
use oristudio_cp::io::fold::export_fold_json;

fn main() {
    let mut args = std::env::args().skip(1);
    let corpus = args.next().expect("usage: <corpus-dir> <out-dir> [stride]");
    let out = args.next().expect("usage: <corpus-dir> <out-dir> [stride]");
    let stride: usize = args
        .next()
        .map_or(1, |value| value.parse().unwrap_or(1))
        .max(1);

    let out_dir = PathBuf::from(&out);
    std::fs::create_dir_all(&out_dir).expect("create out dir");

    let mut files: Vec<PathBuf> = std::fs::read_dir(Path::new(&corpus))
        .expect("corpus dir")
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().is_some_and(|ext| ext == "cp"))
        .collect();
    files.sort();

    let mut index: Vec<String> = Vec::new();
    let mut exported = 0usize;

    for (position, path) in files.iter().enumerate() {
        if position % stride != 0 {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(path) else {
            continue;
        };
        let Ok(model) = import_cp_str(&text) else {
            continue;
        };
        if model.line_segments.is_empty() {
            continue;
        }
        let creases = model.line_segments.len();
        let Ok(json) = export_fold_json(&model, None) else {
            eprintln!("fold export failed: {}", path.display());
            continue;
        };

        let name = format!("{exported:04}.fold");
        std::fs::write(out_dir.join(&name), &json).expect("write fold");
        index.push(format!("{{\"file\":\"{name}\",\"creases\":{creases}}}"));
        exported += 1;
    }

    std::fs::write(out_dir.join("index.json"), format!("[{}]", index.join(",")))
        .expect("write index");
    println!("exported {exported} documents to {}", out_dir.display());
}

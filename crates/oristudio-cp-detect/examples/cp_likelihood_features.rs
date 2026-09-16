//! Features for the crease-pattern likelihood harness.
//!
//! Reads a JSONL manifest (`{"label": ..., "group": ..., "path": ...}` per
//! line — `build-manifest.py` and `synth-negatives.py` write one), extracts
//! `likelihood::CpLikelihoodFeatures` for every image with the same code the
//! product runs, and writes each row back with the features merged in plus
//! `ms`. `fit-model.py` fits the tree table on the result.
//!
//! Usage:
//!   cargo run --release -p oristudio-cp-detect --example cp_likelihood_features -- \
//!     --manifest manifest.jsonl --out features.jsonl

use std::io::{BufRead, BufWriter, Write};
use std::sync::atomic::{AtomicUsize, Ordering};

use oristudio_cp_detect::likelihood::extract_features;
use rayon::prelude::*;
use serde_json::{Map, Value};

fn main() {
    let mut args = std::env::args().skip(1);
    let mut manifest = None;
    let mut out = None;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--manifest" => manifest = args.next(),
            "--out" => out = args.next(),
            other => {
                eprintln!("unknown argument {other}");
                std::process::exit(2);
            }
        }
    }
    let (Some(manifest), Some(out)) = (manifest, out) else {
        eprintln!("usage: cp_likelihood_features --manifest <jsonl> --out <jsonl>");
        std::process::exit(2);
    };
    let rows: Vec<Map<String, Value>> =
        std::io::BufReader::new(std::fs::File::open(&manifest).expect("open manifest"))
            .lines()
            .map_while(Result::ok)
            .filter(|line| !line.trim().is_empty())
            .map(|line| serde_json::from_str(&line).expect("manifest row is a JSON object"))
            .collect();
    let done = AtomicUsize::new(0);
    let total = rows.len();
    let results: Vec<Map<String, Value>> = rows
        .into_par_iter()
        .map(|mut row| {
            let path = row
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned();
            let started = std::time::Instant::now();
            match image::open(&path) {
                Ok(img) => {
                    let rgba = img.to_rgba8();
                    let (w, h) = rgba.dimensions();
                    match extract_features(rgba.as_raw(), w, h) {
                        Ok(features) => {
                            if let Value::Object(map) =
                                serde_json::to_value(&features).expect("features serialize")
                            {
                                row.extend(map);
                            }
                            row.insert(
                                "ms".into(),
                                Value::from(started.elapsed().as_secs_f64() * 1000.0),
                            );
                        }
                        Err(error) => {
                            row.insert("error".into(), Value::from(error.to_string()));
                        }
                    }
                }
                Err(error) => {
                    row.insert("error".into(), Value::from(format!("decode: {error}")));
                }
            }
            let n = done.fetch_add(1, Ordering::Relaxed) + 1;
            if n.is_multiple_of(500) {
                eprintln!("{n}/{total}");
            }
            row
        })
        .collect();
    let mut writer = BufWriter::new(std::fs::File::create(&out).expect("create output"));
    for row in &results {
        serde_json::to_writer(&mut writer, row).expect("write row");
        writer.write_all(b"\n").expect("write row");
    }
    writer.flush().expect("flush");
    let errors = results
        .iter()
        .filter(|row| row.contains_key("error"))
        .count();
    eprintln!("wrote {} rows to {out} ({errors} errors)", results.len());
}

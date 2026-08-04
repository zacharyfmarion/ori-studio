//! Corpus benchmark for the share codec: real encode, real decode, real
//! foldability comparison.
//!
//! Usage: `cargo run --release -p oristudio-cp --example share_bench -- <corpus-dir>`
//!
//! Reports the payload size distribution in unpadded base64url characters, how
//! many documents fit each practical URL budget, and — the part that matters —
//! how many round-trip with their flat-foldability diagnostics unchanged.

use std::path::Path;
use std::time::Instant;

use oristudio_cp::CreasePatternDocument;
use oristudio_cp::checks_spatial::dispatched_camv;
use oristudio_cp::io::cp::import_cp_str;
use oristudio_cp::share::{ShareOptions, b64, decode_share, encode_share_reported};

struct Row {
    chars: usize,
    version: u8,
    creases: usize,
    ok: bool,
    fallback: bool,
    encode_ms: f64,
    decode_ms: f64,
}

fn percentile(sorted: &[usize], p: f64) -> usize {
    if sorted.is_empty() {
        return 0;
    }
    sorted[((sorted.len() - 1) as f64 * p).round() as usize]
}

fn main() {
    let dir = std::env::args().nth(1).expect("usage: <corpus-dir>");
    let mut files: Vec<_> = std::fs::read_dir(Path::new(&dir))
        .expect("corpus dir")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|e| e == "cp"))
        .collect();
    files.sort();

    // Size is what we are measuring; the encoder's own verification is a
    // separate concern and is exercised by leaving it on.
    let options = ShareOptions::default();
    let mut rows = Vec::new();
    let mut reasons: std::collections::BTreeMap<String, usize> = Default::default();

    for path in &files {
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
        let before = dispatched_camv(&model);
        let document = CreasePatternDocument {
            crease_pattern: model,
            ..Default::default()
        };

        let t0 = Instant::now();
        let Ok(report) = encode_share_reported(&document, options) else {
            eprintln!("encode failed: {}", path.display());
            continue;
        };
        let encode_ms = t0.elapsed().as_secs_f64() * 1e3;
        let payload = report.payload;
        if let Some(reason) = report.fallback_reason.clone() {
            *reasons.entry(reason).or_insert(0usize) += 1;
        }

        let t1 = Instant::now();
        let decoded = decode_share(&payload).expect("own output must decode");
        let decode_ms = t1.elapsed().as_secs_f64() * 1e3;

        let after = dispatched_camv(&decoded.document.crease_pattern);
        let ok = before.flat.len() == after.flat.len()
            && before.spatial.len() == after.spatial.len()
            && decoded.document.crease_pattern.line_segments.len() == creases;

        let fallback = report.used_fallback;
        let version = payload[4];

        rows.push(Row {
            chars: b64::encode(&payload).len(),
            version,
            creases,
            ok,
            fallback,
            encode_ms,
            decode_ms,
        });
    }

    let n = rows.len();
    let mut chars: Vec<usize> = rows.iter().map(|r| r.chars).collect();
    chars.sort_unstable();
    let ok = rows.iter().filter(|r| r.ok).count();
    let fallbacks = rows.iter().filter(|r| r.fallback).count();
    let total_creases: usize = rows.iter().map(|r| r.creases).sum();
    let total_bits: usize = rows.iter().map(|r| r.chars * 6).sum();

    println!("documents: {n}   creases: {total_creases}");
    println!(
        "diagnostics preserved: {ok}/{n} ({:.1}%)   RAW fallbacks: {fallbacks}",
        100.0 * ok as f64 / n as f64
    );
    for (reason, count) in &reasons {
        println!("  fallback reason: {count:>3}x  {reason}");
    }
    println!(
        "\nbase64url chars   p10 {}  p25 {}  p50 {}  p75 {}  p90 {}  p99 {}  max {}",
        percentile(&chars, 0.10),
        percentile(&chars, 0.25),
        percentile(&chars, 0.50),
        percentile(&chars, 0.75),
        percentile(&chars, 0.90),
        percentile(&chars, 0.99),
        chars.last().copied().unwrap_or(0),
    );
    let mut by_version: std::collections::BTreeMap<u8, usize> = Default::default();
    for r in &rows {
        *by_version.entry(r.version).or_default() += 1;
    }
    let picked: Vec<String> = by_version
        .iter()
        .map(|(v, n)| format!("v{v}: {n}"))
        .collect();
    println!(
        "grammar chosen (smallest framed payload wins)  {}",
        picked.join("   ")
    );
    println!(
        "bits per crease: {:.2}",
        total_bits as f64 / total_creases as f64
    );

    println!("\nfits budget (and diagnostics preserved):");
    for limit in [600usize, 998, 2000, 4000, 8000, 32000] {
        let fit = rows.iter().filter(|r| r.chars <= limit).count();
        let both = rows.iter().filter(|r| r.chars <= limit && r.ok).count();
        println!(
            "  <= {limit:>5} chars: {fit:>3}/{n} fit   {both:>3}/{n} ({:.1}%) fit AND correct",
            100.0 * both as f64 / n as f64
        );
    }

    let mut enc: Vec<usize> = rows.iter().map(|r| (r.encode_ms * 1e3) as usize).collect();
    let mut dec: Vec<usize> = rows.iter().map(|r| (r.decode_ms * 1e3) as usize).collect();
    enc.sort_unstable();
    dec.sort_unstable();
    println!(
        "\nencode ms  p50 {:.2}  p99 {:.2}  max {:.2}",
        percentile(&enc, 0.5) as f64 / 1e3,
        percentile(&enc, 0.99) as f64 / 1e3,
        *enc.last().unwrap_or(&0) as f64 / 1e3
    );
    println!(
        "decode ms  p50 {:.2}  p99 {:.2}  max {:.2}   <- this is the link-open cost",
        percentile(&dec, 0.5) as f64 / 1e3,
        percentile(&dec, 0.99) as f64 / 1e3,
        *dec.last().unwrap_or(&0) as f64 / 1e3
    );
}

//! What a per-segment fold-magnitude array costs the compact transport.
//!
//! Desktop already exhausts WKWebView memory on a 47MB / 52k-edge `.osf`, so the
//! regression needs a measured number rather than a guess. Run with:
//!   cargo test -p oristudio-cp --test spike_transport_cost -- --nocapture
use std::time::Instant;

use oristudio_cp::CreasePatternDocument;
use oristudio_cp::geometry::{LineColor, LineSegment};
use oristudio_cp::geometry_transport::{decode, encode};

/// Matches the largest real document we know hurts on desktop.
const SEGMENTS: usize = 52_000;

fn big_document() -> CreasePatternDocument {
    let mut doc = CreasePatternDocument::default();
    let mut segments = Vec::with_capacity(SEGMENTS);
    for i in 0..SEGMENTS {
        let t = i as f64;
        let color = if i % 2 == 0 {
            LineColor::Red1
        } else {
            LineColor::Blue2
        };
        segments.push(LineSegment::with_color(
            oristudio_cp::geometry::Point::new(t * 0.017, t * 0.031),
            oristudio_cp::geometry::Point::new(t * 0.017 + 1.0, t * 0.031 + 1.0),
            color,
        ));
    }
    doc.crease_pattern.line_segments = segments;
    doc
}

#[test]
fn measure_compact_transport_cost() {
    let doc = big_document();

    let start = Instant::now();
    let compact = encode(&doc);
    let encode_ms = start.elapsed().as_secs_f64() * 1e3;

    let start = Instant::now();
    let bytes = compact.to_bytes().expect("to_bytes");
    let to_bytes_ms = start.elapsed().as_secs_f64() * 1e3;

    let start = Instant::now();
    let restored =
        oristudio_cp::geometry_transport::CompactGeometry::from_bytes(&bytes).expect("from_bytes");
    let from_bytes_ms = start.elapsed().as_secs_f64() * 1e3;

    let start = Instant::now();
    let _ = decode(&restored).expect("decode");
    let decode_ms = start.elapsed().as_secs_f64() * 1e3;

    let n = SEGMENTS;
    let total = bytes.len();
    let per_segment = total as f64 / n as f64;

    // A `Vec<u32>` of magnitudes, one per segment, written like `seg_attr`.
    let magnitude_bytes = n * 4;
    let with_magnitudes = total + magnitude_bytes;

    println!("\n=== Spike C: compact transport cost ({n} segments) ===");
    println!(
        "baseline total          : {total:>12} bytes ({:.2} MB)",
        total as f64 / 1e6
    );
    println!("baseline per segment    : {per_segment:>12.1} bytes");
    println!("  seg_endpoints (4xf64) : {:>12} bytes/seg", 32);
    println!("  seg_attr      (4xi32) : {:>12} bytes/seg", 16);
    println!("  seg_custom_color(3xu8): {:>12} bytes/seg", 3);
    println!("+ fold magnitude (1xu32): {:>12} bytes/seg", 4);
    println!(
        "with magnitudes         : {with_magnitudes:>12} bytes ({:.2} MB)  = +{:.2}%",
        with_magnitudes as f64 / 1e6,
        100.0 * magnitude_bytes as f64 / total as f64
    );
    println!(
        "classic doc (array omitted): {:>9} bytes  = +{:.4}%  (4-byte header count only)",
        total + 4,
        100.0 * 4.0 / total as f64
    );
    println!("\ntiming (ms)");
    println!("  encode(doc -> compact): {encode_ms:>8.2}");
    println!("  to_bytes              : {to_bytes_ms:>8.2}");
    println!("  from_bytes            : {from_bytes_ms:>8.2}");
    println!("  decode(compact -> doc): {decode_ms:>8.2}");
    println!(
        "  round trip            : {:>8.2}",
        encode_ms + to_bytes_ms + from_bytes_ms + decode_ms
    );

    assert_eq!(per_segment.round() as i64, 51);
}

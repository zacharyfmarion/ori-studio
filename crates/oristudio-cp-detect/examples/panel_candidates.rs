//! Which square the auto-crop picked on an image, and what else it considered.
//!
//! Usage:
//!   cargo run --release -p oristudio-cp-detect --example panel_candidates -- <image>...

use oristudio_cp_detect::rectify::{Point, auto_rectify_rgba};

fn main() {
    for path in std::env::args().skip(1) {
        let source = image::open(&path).expect("open").to_rgba8();
        let (w, h) = source.dimensions();
        println!("=== {} ({w}x{h})", path.rsplit('/').next().unwrap_or(&path));
        let out = match auto_rectify_rgba(source.as_raw(), w, h, 1024) {
            Ok(out) => out,
            Err(error) => {
                println!("  error: {error}");
                continue;
            }
        };
        let report = out.report;
        // All four corners: a rotated panel is not described by two of them.
        println!(
            "  mode {}  confidence {:.3}  detected {}",
            report.mode,
            report.confidence,
            report
                .detected_source_quad
                .map(|quad| corners(quad.points()))
                .unwrap_or_else(|| "none".to_owned()),
        );
        // The chosen panel's own scores, which are the `raw` metrics.
        if let Some(raw) = report.metrics.get("raw") {
            let read = |key: &str| raw.get(key).and_then(|v| v.as_f64()).unwrap_or(0.0);
            println!(
                "  CHOSE angle {:>6.2}  area {:.3}  border {:.3} {}  square {:.3}  density {:.4}  ink {:.3}",
                read("angle_deg"),
                read("area_ratio"),
                read("border_score"),
                raw.get("border_sides").cloned().unwrap_or_default(),
                read("square_score"),
                read("edge_density"),
                read("ink_share"),
            );
        }
        for warning in &report.warnings {
            println!("  warning {}: {}", warning.code, warning.message);
        }
        if let Some(candidates) = report
            .metrics
            .get("raw")
            .and_then(|raw| raw.get("candidates"))
            .and_then(|v| v.as_array())
        {
            // The best-scoring candidate is what the finder used to pick; say
            // when the largest-square rule chose differently.
            let detected = report
                .detected_source_quad
                .map(|quad| corners(quad.points()));
            if let Some(top) = candidates.first() {
                let top_corners = top["corners"].as_array().map(|list| {
                    let read = |value: &serde_json::Value, idx: usize| {
                        value[idx].as_f64().unwrap_or(0.0) as f32
                    };
                    corners(std::array::from_fn(|idx| Point {
                        x: read(&list[idx], 0),
                        y: read(&list[idx], 1),
                    }))
                });
                if detected.is_some() && top_corners.is_some() && detected != top_corners {
                    println!(
                        "  CHANGED: best-scoring was {}",
                        top_corners.unwrap_or_default()
                    );
                }
            }
            for candidate in candidates {
                println!(
                    "  {:18} conf {:.3}  angle {:>6.2}  area {:.3}  border {:.3}  square {:.3}  density {:.4}  ink {:.3}  corners {}",
                    candidate["method"].as_str().unwrap_or("?"),
                    candidate["confidence"].as_f64().unwrap_or(0.0),
                    candidate["angle_deg"].as_f64().unwrap_or(0.0),
                    candidate["area_ratio"].as_f64().unwrap_or(0.0),
                    candidate["border_score"].as_f64().unwrap_or(0.0),
                    candidate["square_score"].as_f64().unwrap_or(0.0),
                    candidate["edge_density"].as_f64().unwrap_or(0.0),
                    candidate["ink_share"].as_f64().unwrap_or(0.0),
                    candidate["corners"],
                );
            }
        }
    }
}

fn corners(points: [Point; 4]) -> String {
    points
        .iter()
        .map(|point| format!("({:.0},{:.0})", point.x, point.y))
        .collect::<Vec<_>>()
        .join(" ")
}

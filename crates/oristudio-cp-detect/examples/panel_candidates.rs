//! Which square the auto-crop picked on an image, and what else it considered.
//!
//! Usage:
//!   cargo run --release -p oristudio-cp-detect --example panel_candidates -- <image>...

use oristudio_cp_detect::rectify::auto_rectify_rgba;

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
        println!(
            "  mode {}  confidence {:.3}  detected {:?}",
            report.mode,
            report.confidence,
            report.detected_source_quad.map(|q| {
                let p = q.points();
                [p[0].x, p[0].y, p[2].x, p[2].y]
            })
        );
        for warning in &report.warnings {
            println!("  warning {}: {}", warning.code, warning.message);
        }
        // The best-scoring candidate is what the finder used to pick; say when
        // the largest-square rule chose differently.
        if let Some(top) = report
            .metrics
            .get("raw")
            .and_then(|raw| raw.get("candidates"))
            .and_then(|v| v.as_array())
            .and_then(|list| list.first())
        {
            let detected = report.detected_source_quad.map(|q| {
                let p = q.points();
                [p[0].x, p[0].y, p[2].x, p[2].y]
            });
            let top_box = top["box"].as_array().map(|b| {
                [
                    b[0].as_f64().unwrap_or(0.0) as f32,
                    b[1].as_f64().unwrap_or(0.0) as f32,
                    b[2].as_f64().unwrap_or(0.0) as f32,
                    b[3].as_f64().unwrap_or(0.0) as f32,
                ]
            });
            if detected.is_some() && top_box.is_some() && detected != top_box {
                println!(
                    "  CHANGED: best-scoring was {:?}",
                    top_box.unwrap_or_default()
                );
            }
        }
        if let Some(candidates) = report
            .metrics
            .get("raw")
            .and_then(|raw| raw.get("candidates"))
            .and_then(|v| v.as_array())
        {
            for candidate in candidates {
                println!(
                    "  {:18} conf {:.3}  box {}  area {:.3}  border {:.3}  square {:.3}  density {:.4}",
                    candidate["method"].as_str().unwrap_or("?"),
                    candidate["confidence"].as_f64().unwrap_or(0.0),
                    candidate["box"],
                    candidate["area_ratio"].as_f64().unwrap_or(0.0),
                    candidate["border_score"].as_f64().unwrap_or(0.0),
                    candidate["square_score"].as_f64().unwrap_or(0.0),
                    candidate["edge_density"].as_f64().unwrap_or(0.0),
                );
            }
        }
    }
}

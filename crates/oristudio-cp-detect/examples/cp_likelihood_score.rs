//! Score images with the crease-pattern likelihood gate and show why.
//!
//! Usage:
//!   cargo run --release -p oristudio-cp-detect --example cp_likelihood_score -- <image>...

use oristudio_cp_detect::likelihood::{MODEL_FEATURES, crease_pattern_likelihood};

fn main() {
    for path in std::env::args().skip(1) {
        let img = match image::open(&path) {
            Ok(img) => img.to_rgba8(),
            Err(error) => {
                println!("=== {path}\n  decode error: {error}");
                continue;
            }
        };
        let (w, h) = img.dimensions();
        let started = std::time::Instant::now();
        let verdict = match crease_pattern_likelihood(img.as_raw(), w, h) {
            Ok(verdict) => verdict,
            Err(error) => {
                println!("=== {path}\n  error: {error}");
                continue;
            }
        };
        let ms = started.elapsed().as_secs_f64() * 1000.0;
        println!(
            "=== {path} ({w}x{h})\n  score {:.3}  likely {}  (threshold {:.2}, {ms:.1} ms)",
            verdict.score, verdict.likely, verdict.threshold
        );
        let vector = verdict.features.model_vector();
        for (name, value) in MODEL_FEATURES.iter().zip(vector) {
            println!("  {name:18} {value:.4}");
        }
    }
}

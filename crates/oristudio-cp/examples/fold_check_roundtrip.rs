//! Import a FOLD the way the editor opens it, run the flat-foldability check,
//! then export and import again and check once more: whether opening a file
//! the editor wrote changes what the check says.
//!
//! Usage:
//!   cargo run --release -p oristudio-cp --example fold_check_roundtrip -- <file.fold>...
use oristudio_cp::checks::{FlatFoldabilityRule, check_camv_task};
use oristudio_cp::io::fold::{export_fold_json, import_fold_json};
use oristudio_cp::model::CreasePatternModel;

fn summarize(label: &str, model: &CreasePatternModel) {
    let result = check_camv_task(model);
    let mut counts = [0usize; 5];
    for violation in &result.violations {
        let slot = match violation.rule {
            FlatFoldabilityRule::NumberOfFolds => 0,
            FlatFoldabilityRule::Angles => 1,
            FlatFoldabilityRule::Maekawa => 2,
            FlatFoldabilityRule::BigLittleBig => 3,
            FlatFoldabilityRule::None => 4,
        };
        counts[slot] += 1;
    }
    println!(
        "  {label:14} segments {:4} aux {:3}  violations: folds {} angles {} maekawa {} big-little-big {}",
        model.line_segments.len(),
        model.aux_line_segments.len(),
        counts[0],
        counts[1],
        counts[2],
        counts[3]
    );
}

fn main() {
    for path in std::env::args().skip(1) {
        let raw = std::fs::read_to_string(&path).expect("read");
        println!("== {path} ==");
        let model = match import_fold_json(&raw) {
            Ok(model) => model,
            Err(error) => {
                println!("  import failed: {error}");
                continue;
            }
        };
        summarize("imported", &model);
        let exported = export_fold_json(&model, None).expect("export");
        let again = import_fold_json(&exported).expect("re-import");
        summarize("re-imported", &again);
        // Did the round trip move anything? Compare segment endpoints in order.
        let mut worst = 0.0_f64;
        for (a, b) in model.line_segments.iter().zip(&again.line_segments) {
            for (p, q) in [(a.a, b.a), (a.b, b.b)] {
                worst = worst.max(((p.x - q.x).powi(2) + (p.y - q.y).powi(2)).sqrt());
            }
        }
        println!("  round trip moved endpoints by at most {worst:.3e} units");
    }
}

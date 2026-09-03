//! Is a pack's ground truth actually flat-foldable by our own checker?
//!
//! Selection criterion for any solver study: a sample is only usable if its
//! ground truth has zero CAMV violations. Otherwise a violation after the solve
//! cannot be blamed on the solve.
//!
//! Usage:
//!   cargo run --release -p oristudio-cp-compiler --example gt_camv_survey -- <pack-dir>...

use oristudio_cp::checks::{FlatFoldabilityRule, check_camv_task};

fn main() {
    for pack in std::env::args().skip(1) {
        let samples = std::path::Path::new(&pack).join("samples");
        let Ok(entries) = std::fs::read_dir(&samples) else {
            println!("{pack}: no samples/");
            continue;
        };
        let (mut total, mut clean, mut angle_only, mut blb_only, mut both) = (0, 0, 0, 0, 0);
        let mut worst: Vec<(usize, usize, String)> = Vec::new();
        for entry in entries.flatten() {
            let gt = entry.path().join("gt.fold");
            let Ok(text) = std::fs::read_to_string(&gt) else {
                continue;
            };
            let Ok(document) = oristudio_cp::io::fold::import_fold_file_document_json(&text) else {
                continue;
            };
            total += 1;
            let violations = check_camv_task(&document.crease_pattern).violations;
            let angles = violations
                .iter()
                .filter(|v| matches!(v.rule, FlatFoldabilityRule::Angles))
                .count();
            let blb = violations.len() - angles;
            match (angles > 0, blb > 0) {
                (false, false) => clean += 1,
                (true, false) => angle_only += 1,
                (false, true) => blb_only += 1,
                (true, true) => both += 1,
            }
            if !violations.is_empty() {
                worst.push((
                    angles,
                    blb,
                    entry
                        .file_name()
                        .to_string_lossy()
                        .chars()
                        .take(46)
                        .collect(),
                ));
            }
        }
        println!(
            "\n{}\n  {total} samples: {clean} CLEAN, {angle_only} angle-only, {blb_only} BLB-only, {both} both",
            pack.rsplit('/').next().unwrap_or(&pack)
        );
        worst.sort_by_key(|w| std::cmp::Reverse(w.0 + w.1));
        for (angles, blb, id) in worst.iter().take(5) {
            println!("    dirty: {id}  angle {angles}  BLB {blb}");
        }
    }
}

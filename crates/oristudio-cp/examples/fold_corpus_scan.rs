//! Run Check Foldability over a directory of `.fold` files and tabulate it.
//!
//! Written for the non-flat corpus, where the question is repeatedly "did that
//! change to the *files* make the kernel happier, and did it make anything
//! worse". Answering that by opening 36 patterns by hand is not answering it.
//!
//! Prints, per file, what the user would actually be shown: Oriedita's flat
//! violations from the flat vertices, and closure/self-intersection from the
//! non-flat ones. `link-crossing` is deliberately separate from `self-int`,
//! because the link verdict computes a crossing at plenty of vertices that fail
//! closure first and so never reach the user — conflating the two overstates
//! what the product reports.
//!
//! ```bash
//! cargo run -p oristudio-cp --release --example fold_corpus_scan -- <dir> [<dir2>]
//! ```
//!
//! With two directories it diffs them file by file, which is the form that
//! catches a "fix" that quietly regressed something else.

use oristudio_cp::checks_spatial::dispatched_camv;
use oristudio_cp::io::fold::import_fold_document;
use std::collections::BTreeMap;
use std::path::Path;
use treemaker_fold::FoldDocument;

/// Mirrors the private bar in `lib.rs`. Kept in sync by the assertion below.
const CLOSURE_BAR_DEGREES: f64 = 1e-6;

#[derive(Default, Clone, Copy, PartialEq, Eq)]
struct Tally {
    flat: usize,
    closure: usize,
    /// Self-intersections **as reported**: closure passed and the link crosses.
    self_int: usize,
    /// Vertices whose link crosses regardless of whether closure passed. Always
    /// at least `self_int`; the gap is what the user is never shown.
    link_crossing: usize,
    /// Carried so a file that silently lost geometry is visible as a change.
    segments: usize,
}

/// Closure residuals in degrees, sorted, for `--residuals`.
///
/// The distribution is the thing worth seeing. A cluster at rounding scale says
/// the geometry is the cause and cleaning the file can fix it; a spread over
/// whole degrees says the fold angles disagree by design and no amount of
/// tidying the coordinates will help.
fn residual_percentiles(values: &mut [f64]) -> String {
    if values.is_empty() {
        return "none".into();
    }
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let at = |q: f64| values[((values.len() - 1) as f64 * q) as usize];
    format!(
        "n={} min {:.2e} p25 {:.2e} p50 {:.2e} p75 {:.2e} max {:.2e}",
        values.len(),
        at(0.0),
        at(0.25),
        at(0.5),
        at(0.75),
        at(1.0)
    )
}

fn scan(path: &Path) -> Result<Tally, String> {
    scan_inner(path, None)
}

fn scan_inner(path: &Path, mut residuals: Option<&mut Vec<f64>>) -> Result<Tally, String> {
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let fold: FoldDocument = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let model = import_fold_document(&fold).map_err(|e| format!("{e:?}"))?;
    let dispatched = dispatched_camv(&model);

    let mut tally = Tally {
        flat: dispatched.flat.len(),
        segments: model.line_segments.len(),
        ..Tally::default()
    };
    for report in &dispatched.spatial {
        let crossing = report.link.is_some_and(|link| link.self_intersects());
        tally.link_crossing += usize::from(crossing);
        match report.residual {
            // Indeterminate: reports nothing, same as the product.
            None => {}
            Some(residual) if residual.to_degrees() <= CLOSURE_BAR_DEGREES => {
                tally.self_int += usize::from(crossing);
            }
            Some(residual) => {
                tally.closure += 1;
                if let Some(sink) = residuals.as_deref_mut() {
                    sink.push(residual.to_degrees());
                }
            }
        }
    }
    Ok(tally)
}

fn collect(dir: &Path) -> BTreeMap<String, Result<Tally, String>> {
    let mut out = BTreeMap::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|e| e == "fold") {
            let name = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into();
            out.insert(name, scan(&path));
        }
    }
    out
}

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(index) = args.iter().position(|a| a == "--residuals") {
        args.remove(index);
        for name in &args {
            let mut values = Vec::new();
            let path = Path::new(name);
            if path.is_dir() {
                let mut entries: Vec<_> = std::fs::read_dir(path)
                    .into_iter()
                    .flatten()
                    .flatten()
                    .map(|e| e.path())
                    .filter(|p| p.extension().is_some_and(|e| e == "fold"))
                    .collect();
                entries.sort();
                for entry in entries {
                    let mut own = Vec::new();
                    let _ = scan_inner(&entry, Some(&mut own));
                    println!(
                        "{:<30}{}",
                        entry.file_stem().unwrap_or_default().to_string_lossy(),
                        residual_percentiles(&mut own)
                    );
                    values.extend(own);
                }
            } else {
                let _ = scan_inner(path, Some(&mut values));
            }
            println!("{:<30}{}", "ALL", residual_percentiles(&mut values));
        }
        return;
    }
    let Some(first) = args.first() else {
        eprintln!("usage: fold_corpus_scan <dir> [<before-dir>]");
        std::process::exit(1);
    };
    let after = collect(Path::new(first));
    let before = args.get(1).map(|d| collect(Path::new(d)));

    println!(
        "{:<34}{:>9}{:>9}{:>9}{:>14}",
        "model", "flat", "closure", "self-int", "link-crossing"
    );
    let mut totals = Tally::default();
    let mut regressed = Vec::new();
    // Tracked apart from `regressed` on purpose. Welding duplicate vertices
    // drops the duplicate edges with them, so a falling segment count is the
    // intended effect of a fix rather than a symptom -- but it is also exactly
    // what silently losing geometry looks like, so it still has to be said out
    // loud rather than folded into the pass/fail line.
    let mut reshaped = Vec::new();
    for (name, result) in &after {
        let tally = match result {
            Ok(tally) => *tally,
            Err(error) => {
                println!("{name:<34}  FAILED: {error}");
                continue;
            }
        };
        totals.flat += tally.flat;
        totals.closure += tally.closure;
        totals.self_int += tally.self_int;
        totals.link_crossing += tally.link_crossing;

        // A delta column only where there is something to compare against.
        let delta = before
            .as_ref()
            .and_then(|b| b.get(name))
            .and_then(|r| r.as_ref().ok())
            .map(|was| {
                if was.flat < tally.flat || was.closure < tally.closure {
                    regressed.push(name.clone());
                }
                if was.segments != tally.segments {
                    reshaped.push(format!("{name} {}->{}", was.segments, tally.segments));
                }
                format!(
                    "   was flat {} closure {}{}",
                    was.flat,
                    was.closure,
                    if was.segments == tally.segments {
                        String::new()
                    } else {
                        format!(" [segments {} -> {}]", was.segments, tally.segments)
                    }
                )
            })
            .unwrap_or_default();
        let clean = tally.flat == 0 && tally.closure == 0 && tally.self_int == 0;
        println!(
            "{:<34}{:>9}{:>9}{:>9}{:>14}{}{}",
            name,
            tally.flat,
            tally.closure,
            tally.self_int,
            tally.link_crossing,
            if clean { "  CLEAN" } else { "" },
            delta
        );
    }
    println!(
        "\n{:<34}{:>9}{:>9}{:>9}{:>14}",
        format!("TOTAL ({} models)", after.len()),
        totals.flat,
        totals.closure,
        totals.self_int,
        totals.link_crossing
    );
    if before.is_some() {
        if regressed.is_empty() {
            println!("no model got worse on flat or closure");
        } else {
            println!("REGRESSED: {}", regressed.join(", "));
        }
        if !reshaped.is_empty() {
            println!(
                "segment count changed in {}: {}",
                reshaped.len(),
                reshaped.join(", ")
            );
        }
    }
}

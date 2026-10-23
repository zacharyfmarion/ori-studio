//! The Flat-Folder oracle's `verify` command (`tools/flat-folder-oracle`,
//! README "verify") on Fold states' FOLD step frames: the vendored JavaScript
//! builds its own arrangement of the frame's crease pattern, checks it and
//! rebuilds it at halved ε until it passes, then seeds the order into its own
//! constraints. It reads face indices as the FOLD file gives them.
//!
//! Gated on `FLATFOLDER_ORACLE` (the script's path, relative to the
//! repository root or absolute); the CI "Flat-Folder oracle parity" step sets
//! it.

use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;

use serde_json::Value;
use treemaker_fold::FoldDocument;

use crate::support::repo_root;

pub fn oracle() -> Option<PathBuf> {
    let Some(oracle) = env::var_os("FLATFOLDER_ORACLE").map(PathBuf::from) else {
        eprintln!("skipping Flat-Folder verify; set FLATFOLDER_ORACLE to enable");
        return None;
    };
    Some(if oracle.is_relative() {
        repo_root().join(oracle)
    } else {
        oracle
    })
}

/// One `verify` run: a step frame and an order on its faces.
pub struct Job {
    pub name: String,
    pub frame: FoldDocument,
    /// FOLD `faceOrders` by face position: the frame's own, or a flip.
    pub order: Vec<[i64; 3]>,
}

/// `verify` on each job, a few processes at a time; the records in input
/// order. Each frame is written under the test's temporary directory as
/// `<name>.fold`, and the order beside it as `<name>.order.json`: an empty
/// order is no key at all in the FOLD file, but still an order.
pub fn verify_all(oracle: &Path, jobs: &[Job]) -> Vec<Value> {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join("fold-oracle");
    std::fs::create_dir_all(&dir).unwrap_or_else(|e| panic!("{}: {e}", dir.display()));
    let records = Mutex::new(vec![Value::Null; jobs.len()]);
    let next = AtomicUsize::new(0);
    let workers = thread::available_parallelism().map_or(4, |n| n.get().min(8));
    thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| {
                loop {
                    let job = next.fetch_add(1, Ordering::Relaxed);
                    let Some(Job {
                        name,
                        frame,
                        order: triples,
                    }) = jobs.get(job)
                    else {
                        return;
                    };
                    let fold = dir.join(format!("{name}.fold"));
                    let order = dir.join(format!("{name}.order.json"));
                    for (path, text) in [
                        (&fold, serde_json::to_string(frame)),
                        (&order, serde_json::to_string(triples)),
                    ] {
                        let text = text.unwrap_or_else(|e| panic!("{name}: {e}"));
                        std::fs::write(path, text)
                            .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
                    }
                    let record = verify(oracle, &fold, &order);
                    if let Ok(mut records) = records.lock() {
                        records[job] = record;
                    }
                }
            });
        }
    });
    records.into_inner().unwrap_or_else(|e| e.into_inner())
}

fn verify(oracle: &Path, fold: &Path, order: &Path) -> Value {
    let output = Command::new(oracle)
        .current_dir(repo_root())
        .arg("verify")
        .arg(fold)
        .arg(order)
        .output()
        .unwrap_or_else(|err| panic!("failed to run {}: {err}", oracle.display()));
    assert!(
        output.status.success(),
        "verify failed for {}\nstderr:\n{}",
        fold.display(),
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout)
        .unwrap_or_else(|e| panic!("{}: verify printed no JSON: {e}", fold.display()))
}

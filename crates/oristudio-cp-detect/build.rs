//! Capture the git commit (and dirty state) this crate is built from, so binaries
//! can assert at startup that they match the working tree they are run against.
//! This guards the worktree/`target` footgun: each git worktree has its own
//! `target/`, so it is easy to rebuild in one worktree but execute a stale binary
//! from another. See `compare_exact_solve_benchmark`'s `--allow-stale`.

use std::process::Command;

fn main() {
    let commit = git(&["rev-parse", "HEAD"]).unwrap_or_default();
    let dirty = git(&["status", "--porcelain"])
        .map(|status| !status.trim().is_empty())
        .unwrap_or(false);
    println!("cargo:rustc-env=BUILD_GIT_COMMIT={commit}");
    println!("cargo:rustc-env=BUILD_GIT_DIRTY={dirty}");

    // Re-run when HEAD or the checked-out branch ref moves, so the embedded commit
    // stays current across commits/checkouts (resolved via `--git-path`, which is
    // worktree-aware: a worktree's `.git` is a file, not a directory).
    for path in ["HEAD", "index"] {
        if let Some(resolved) = git(&["rev-parse", "--git-path", path]) {
            println!("cargo:rerun-if-changed={}", resolved.trim());
        }
    }
    if let Some(resolved) = git(&["symbolic-ref", "-q", "HEAD"])
        .and_then(|refname| git(&["rev-parse", "--git-path", refname.trim()]))
    {
        println!("cargo:rerun-if-changed={}", resolved.trim());
    }
}

fn git(args: &[&str]) -> Option<String> {
    let output = Command::new("git").args(args).output().ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

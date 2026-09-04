//! Re-solve a saved FOLD and count the editor's own CAMV violations either side.
//!
//! The companion to `replay_attached_solve_input`, for the other half of "why
//! does this pattern still show errors": that one replays the graph a *region*
//! carries, this one starts from the geometry actually in the document. It
//! answers the question that separates "the solve stopped short" from "no
//! coordinates can satisfy this" — if a fresh solve clears the markers, the
//! pattern was always solvable and the shipped run just did not go far enough.
//!
//! The counts come from `oristudio_cp`'s own checker, so they are the numbers
//! the editor draws, not a second opinion. The rows sweep the polish settings,
//! because a difference between them says the polish is the lever and no
//! difference says it is not.
//!
//! Pull the FOLD out of an `.osf` first — it is
//! `workspace.creasePattern.creasePattern.foldProjection`.
//!
//! Usage:
//!   cargo run --release -p oristudio-cp-compiler \
//!     --example recheck_solved_fold -- <fold.json>
use oristudio_cp_compiler::{ExactSolveOptions, exactize_fold};
use treemaker_fold::FoldDocument;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args().nth(1).expect("usage: <fold.json>");
    let fold: FoldDocument = serde_json::from_slice(&std::fs::read(&path)?)?;
    for (label, opts) in [
        (
            "default (polish on, target 1e-6)",
            ExactSolveOptions::default(),
        ),
        (
            "polish off",
            ExactSolveOptions {
                polish: false,
                ..Default::default()
            },
        ),
        (
            "polish target 1e-9",
            ExactSolveOptions {
                polish_target_kawasaki_degrees: 1e-9,
                ..Default::default()
            },
        ),
        (
            "polish target 1e-9, 24 rounds",
            ExactSolveOptions {
                polish_target_kawasaki_degrees: 1e-9,
                polish_rounds: 24,
                ..Default::default()
            },
        ),
    ] {
        let out = exactize_fold(&fold, opts);
        println!(
            "{label:34} status={:?} camv {} -> {}  movement {:.3e}  {}",
            out.status,
            out.camv_violations_before,
            out.camv_violations_after,
            out.max_vertex_movement,
            out.fallback_reason.unwrap_or_default()
        );
    }
    Ok(())
}

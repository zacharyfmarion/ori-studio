//! Canonical topology diagnostics for a cached, source-only recognition input.
use oristudio_cp_compiler::{ExactSolveInput, analyze_candidate_topology};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args()
        .nth(1)
        .ok_or("usage: analyze_recognition INPUT_JSON")?;
    let input: ExactSolveInput = serde_json::from_str(&std::fs::read_to_string(path)?)?;
    println!(
        "{}",
        serde_json::to_string(&analyze_candidate_topology(&input))?
    );
    Ok(())
}

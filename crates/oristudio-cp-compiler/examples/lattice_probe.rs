//! What the lattice says about a FOLD answer: rebuild the exact-solve input
//! from the document (the solver gate's path), run the lattice's answer alone
//! (`solve_exact_on_lattice`) and print its round — the lattice read, the
//! snap, and why it was adopted or refused. One line per file.
//!
//!   cargo run --release -p oristudio-cp-compiler --example lattice_probe -- <file.fold>...
use oristudio_cp_compiler::{
    ExactSolveOptions, exact_solve_input_from_fold, solve_exact_on_lattice,
};

fn main() {
    for file in std::env::args().skip(1) {
        let text = match std::fs::read_to_string(&file) {
            Ok(text) => text,
            Err(error) => {
                println!("{file}\tread: {error}");
                continue;
            }
        };
        let fold: treemaker_fold::FoldDocument = match serde_json::from_str(&text) {
            Ok(fold) => fold,
            Err(error) => {
                println!("{file}\tparse: {error}");
                continue;
            }
        };
        let (input, _) = match exact_solve_input_from_fold(&fold) {
            Ok(rebuilt) => rebuilt,
            Err(error) => {
                println!("{file}\trebuild: {error}");
                continue;
            }
        };
        let started = std::time::Instant::now();
        let solved = solve_exact_on_lattice(&input, ExactSolveOptions::default());
        let report = &solved.movement_report;
        let round = report
            .pointer("/polish/lattice_round")
            .filter(|value| !value.is_null())
            .or_else(|| report.get("lattice_round"))
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        println!(
            "{file}\tvertices {} spans {}\tstatus {:?}\t{:.2}s\tlattice {}",
            input.vertices.len(),
            input.selected_spans.len(),
            solved.status,
            started.elapsed().as_secs_f64(),
            round
        );
    }
}

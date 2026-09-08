mod common;
use common::*;
use oristudio_precrease::sequence::StepKind;

/// Where a step's crease ACTUALLY starts and stops, after merging the touching
/// collinear pieces the pattern splits it into wherever its assignment changes.
#[test]
fn true_crease_runs() {
    let cp = load("/Users/zacharymarion/Documents/datasets/create-pattern-detector/real_benchmark/curated/markhor/truth.fold");
    let a = analyze_cp(&cp);
    let c = a.components.iter().find(|c| c.id == 0).expect("c0");
    let (_, seq) = plan_component(c, unbounded_options());
    let sheet = seq.sheet;
    let on_edge = |p: [f64; 2]| {
        p[0].abs() < 1e-9 || (p[0] - sheet.width).abs() < 1e-9
            || p[1].abs() < 1e-9 || (p[1] - sheet.height).abs() < 1e-9
    };
    for step in seq.steps.iter().take(6) {
        if step.kind != StepKind::Cp { continue }
        // Project every span onto the line's own direction and merge touching runs.
        let d = [-step.line.n[1], step.line.n[0]];
        let at = |p: [f64; 2]| p[0] * d[0] + p[1] * d[1];
        let mut runs: Vec<(f64, f64)> = step
            .cp_spans
            .iter()
            .map(|[p, q]| { let (u, v) = (at(*p), at(*q)); if u <= v { (u, v) } else { (v, u) } })
            .collect();
        runs.sort_by(|a, b| a.0.total_cmp(&b.0));
        let mut merged: Vec<(f64, f64)> = Vec::new();
        for r in runs {
            match merged.last_mut() {
                Some(last) if r.0 <= last.1 + 1e-9 => last.1 = last.1.max(r.1),
                _ => merged.push(r),
            }
        }
        let point = |t: f64| [step.line.d * step.line.n[0] + t * d[0], step.line.d * step.line.n[1] + t * d[1]];
        println!("step {}: {} spans -> {} continuous run(s)", step.id, step.cp_spans.len(), merged.len());
        for (u, v) in &merged {
            let (a, b) = (point(*u), point(*v));
            println!("   run ({:.4},{:.4}) -> ({:.4},{:.4})   ends on edge: {} / {}",
                a[0], a[1], b[0], b[1], on_edge(a), on_edge(b));
        }
    }
}

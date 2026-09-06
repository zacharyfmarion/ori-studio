//! Performance: a release-mode ceiling for the iguana component-0 closure
//! (plan: < 3 s), and measured numbers printed for the record (never
//! asserted): the full plan on that component and on every component of the
//! `.osf`. Run with `cargo test -p oristudio-precrease --release --test
//! planner_perf -- --nocapture`.

mod common;

use std::time::Instant;

use common::*;
use oristudio_precrease::planner::Planner;
use oristudio_precrease::sequence::StepKind;

#[test]
#[cfg_attr(debug_assertions, ignore = "release-mode ceiling; run with --release")]
fn iguana_component_0_closure_stays_under_three_seconds_in_release() {
    let cp = load("tests/fixtures/precrease/iguana-c0.fold");
    let analysis = analyze_cp(&cp);
    let component = analysis
        .components
        .iter()
        .max_by_key(|c| c.segment_indices.len())
        .expect("component");
    let started = Instant::now();
    let mut planner = Planner::new(component, unbounded_options());
    let outcome = planner.close(0.0).expect("close");
    let closure_s = started.elapsed().as_secs_f64();
    let closure = planner.closure_ref().expect("closure");
    println!(
        "iguana c0 closure: {} lines, folded {}, remaining {}, |P| {}, |L| {}, {:.3} s",
        component.merged_lines.len(),
        outcome.folded,
        outcome.remaining,
        closure.state().point_count(),
        closure.state().line_count(),
        closure_s
    );
    assert!(closure_s < 3.0, "closure took {closure_s:.3} s");

    // Measured, not asserted: the full plan.
    let started = Instant::now();
    planner.plan().expect("plan");
    let seq = planner.sequence(false);
    let aux = seq.steps.iter().filter(|s| s.kind == StepKind::Aux).count();
    println!(
        "iguana c0 plan: status {:?}, aux {aux} (visible {}), stuck events {}, |P| {}, {:.3} s, certification {}",
        seq.status,
        seq.totals.visible_aux,
        seq.diagnostics.stuck_events,
        seq.diagnostics.points,
        started.elapsed().as_secs_f64(),
        seq.certification
    );
}

#[test]
#[cfg_attr(
    debug_assertions,
    ignore = "measurement; run with --release --nocapture"
)]
fn every_iguana_component_is_measured() {
    let cp = load("tests/fixtures/simulation/iguana_24.osf");
    let analysis = analyze_cp(&cp);
    let mut total = 0.0;
    let mut peak = 0usize;
    for c in &analysis.components {
        let started = Instant::now();
        let mut planner = Planner::new(c, unbounded_options());
        planner.plan().expect("plan");
        let seq = planner.sequence(false);
        let secs = started.elapsed().as_secs_f64();
        total += secs;
        peak = peak.max(seq.diagnostics.points);
        println!(
            "component {:>2}: segs {:>5} lines {:>4} status {:?} aux {} visible {} stuck {} |P| {:>7} {:.3} s",
            c.id,
            c.segment_indices.len(),
            c.merged_lines.len(),
            seq.status,
            seq.totals.aux,
            seq.totals.visible_aux,
            seq.diagnostics.stuck_events,
            seq.diagnostics.points,
            secs
        );
    }
    println!("all components: {total:.3} s, peak |P| {peak}");
}

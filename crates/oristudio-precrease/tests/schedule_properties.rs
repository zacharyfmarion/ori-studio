//! Partial spans and both sheet faces are essential here: bare infinite lines
//! miss the physical-reference scheduling problem entirely.
mod common;
use common::Rng;
use oristudio_precrease::state::DEFAULT_POINT_CAP;
use oristudio_precrease::{
    Closure, Line, Sheet, Target,
    clock::{Deadline, frozen_clock},
    order, quality,
};

#[test]
fn finite_mixed_assignment_patterns_keep_coverage_and_never_regress_on_replay() {
    let sheet = Sheet::unit_square();
    let deadline = Deadline::unbounded(frozen_clock());
    for seed in 1..=48 {
        let mut rng = Rng(seed * 0x9e3779b9);
        let mut lines = Vec::new();
        for t in [0.5, 0.25, 0.75, 0.125, 0.375, 0.625, 0.875] {
            lines.push(Line::new([1., 0.], t).unwrap());
            lines.push(Line::new([0., 1.], t).unwrap());
        }
        lines.push(Line::from_points([0., 0.], [1., 1.]).unwrap());
        lines.push(Line::from_points([0., 1.], [1., 0.]).unwrap());
        let targets = lines
            .into_iter()
            .enumerate()
            .map(|(id, line)| {
                let (lo, hi) = sheet.clip_parameters(&line).unwrap();
                let (a, b) = if id < 2 {
                    (lo, hi)
                } else {
                    let start = rng.below(6) as f64 / 8.;
                    let end = start + (1 + rng.below(2)) as f64 / 8.;
                    (lo + (hi - lo) * start, lo + (hi - lo) * end)
                };
                let mountain = rng.below(2) == 0;
                Target::new(
                    line,
                    vec![id as u32 + 1],
                    vec![[line.point_at(a), line.point_at(b)]],
                    f64::from(mountain),
                    f64::from(!mountain),
                )
            })
            .collect();
        let mut c = Closure::new(sheet, targets, DEFAULT_POINT_CAP);
        c.close(&deadline).unwrap();
        assert!(c.is_complete(), "seed {seed}");
        let base = order::order_with(&c, false, true);
        let before = quality::evaluate(&c, &base);
        let improved = order::improve(&c, false, true, base, 32, &deadline);
        let after = quality::evaluate(&c, &improved);
        assert!(
            after.no_worse_than(&before),
            "seed {seed}: {before:?} -> {after:?}"
        );
        assert_eq!(after.missing_folds, 0);
        assert_eq!(after.duplicate_folds, 0);
        assert_eq!(after.uncovered, 0);
        assert_eq!(after.wrong_face, 0);
        let construction = order::construction::refine(
            &c,
            improved,
            order::construction::Options {
                max_evaluations: 1000,
                max_passes: 2,
                tradeoffs: true,
                single_alignment: true,
                witnesses_per_fold: 24,
            },
            &deadline,
        );
        let final_quality = quality::evaluate(&c, &construction.placed);
        assert!(
            final_quality.preserves_requirements(&after),
            "construction seed {seed}: {after:?} -> {final_quality:?}"
        );
        assert!(construction.stats.evaluations <= 1000);
        assert_eq!(final_quality.missing_targets, 0);
        if seed <= 4 {
            let teacher = order::rollout::improve(
                &c,
                construction.placed,
                order::rollout::Options {
                    trials: 6,
                    width: 2,
                    cleanup_evaluations: 50,
                },
                &deadline,
            );
            assert!(teacher.stats.trials <= 6);
            assert!(quality::evaluate(&c, &teacher.placed).preserves_requirements(&final_quality));
        }
    }
}

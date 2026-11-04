//! Compact weighted negative-gap penalties before allocating solver variables.
use crate::{
    SpreadError,
    prepare::{Row, Sample},
};
use std::collections::HashMap;

const COEFFICIENT_SCALE: f64 = 1e12;
// Includes the solver's accepted displacement-bound residual. A sample has at
// most 18 coefficients, so rounding changes its gap by at most about 2e-12.
const ACCEPTED_DISPLACEMENT: f64 = 0.220003;
const MAX_ROUNDING_GAP: f64 = 2e-12;
const MAX_SAMPLES: usize = 100_000;

#[derive(Default)]
pub(super) struct Crossings {
    pub samples: Vec<Sample>,
    /// Includes zero rows: dropping their mass would strengthen other penalties.
    pub total_weight: f64,
    pub rounding_gap_bound: f64,
}

#[derive(Default)]
pub(super) struct CrossingAccumulator {
    crossings: Crossings,
    index: HashMap<Vec<(usize, u64)>, usize>,
}

impl CrossingAccumulator {
    pub fn push(&mut self, mut sample: Sample) -> Result<(), SpreadError> {
        if !sample.weight.is_finite()
            || sample.weight <= 0.
            || sample.row.iter().any(|&(_, v)| !v.is_finite())
        {
            return Err(SpreadError::Invalid("spatial crossing sample".into()));
        }
        self.crossings.total_weight += sample.weight;
        let (row, error) = canonical_row(sample.row);
        self.crossings.rounding_gap_bound = self.crossings.rounding_gap_bound.max(error);
        if row.is_empty() {
            return Ok(());
        }
        let key: Vec<_> = row.iter().map(|&(id, v)| (id, v.to_bits())).collect();
        if let Some(&index) = self.index.get(&key) {
            self.crossings.samples[index].weight += sample.weight;
        } else {
            if self.crossings.samples.len() == MAX_SAMPLES {
                return Err(SpreadError::Limit("spatial compacted constraints"));
            }
            sample.row = row;
            self.index.insert(key, self.crossings.samples.len());
            self.crossings.samples.push(sample);
        }
        Ok(())
    }

    pub fn finish(self) -> Crossings {
        // Release the lookup and its keys before building the quadratic program.
        self.crossings
    }
}

fn canonical_row(row: Row) -> (Row, f64) {
    let mut rounded = Vec::with_capacity(row.len());
    let mut error = 0.;
    for &(id, value) in &row {
        let v = (value * COEFFICIENT_SCALE).round() / COEFFICIENT_SCALE;
        error += (value - v).abs() * ACCEPTED_DISPLACEMENT;
        // Ill-conditioned geometry can produce large coefficients. Preserve the
        // exact row if rounding cannot honor the error bound (or overflows).
        if !v.is_finite() || error > MAX_ROUNDING_GAP {
            return (row, 0.);
        }
        if v != 0. {
            rounded.push((id, v));
        }
    }
    (rounded, error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::prepare::value;

    fn penalty(samples: &[Sample], d: &[f64]) -> f64 {
        samples
            .iter()
            .map(|s| s.weight * (-value(&s.row, d)).max(0.).powi(2))
            .sum()
    }

    #[test]
    fn identical_penalties_combine_weights_and_preserve_zero_row_mass() {
        let mut accumulator = CrossingAccumulator::default();
        let raw = vec![
            Sample {
                row: vec![(0, 0.25), (1, -0.5)],
                weight: 2.,
            },
            Sample {
                row: vec![(0, 0.25), (1, -0.5)],
                weight: 5.,
            },
            Sample {
                row: vec![(0, -0.25), (1, 0.5)],
                weight: 3.,
            },
            Sample {
                row: vec![],
                weight: 11.,
            },
        ];
        for s in &raw {
            accumulator
                .push(Sample {
                    row: s.row.clone(),
                    weight: s.weight,
                })
                .unwrap();
        }
        let compact = accumulator.finish();
        assert_eq!(compact.samples.len(), 2);
        assert_eq!(compact.total_weight, 21.);
        assert_eq!(compact.samples[0].weight, 7.);
        assert_eq!(compact.rounding_gap_bound, 0.);
        for x in -20..=20 {
            let d = [f64::from(x) / 100., 0.13];
            assert!((penalty(&raw, &d) - penalty(&compact.samples, &d)).abs() < 1e-15);
        }
    }

    #[test]
    fn rounded_rows_merge_without_welding_material_ids_or_flipping_order() {
        let mut accumulator = CrossingAccumulator::default();
        for row in [
            vec![(0, 1.), (1, -1.)],
            vec![(0, 1. + 1e-14), (1, -1. - 1e-14)],
            vec![(0, 1.), (2, -1.)],
            vec![(0, -1.), (1, 1.)],
        ] {
            accumulator.push(Sample { row, weight: 1. }).unwrap();
        }
        let compact = accumulator.finish();
        assert_eq!(compact.samples.len(), 3);
        assert_eq!(compact.samples[0].weight, 2.);
        assert!(compact.rounding_gap_bound > 0.);
        assert!(compact.rounding_gap_bound <= MAX_ROUNDING_GAP);
    }

    #[test]
    fn deterministic_random_rows_obey_the_gap_bound_including_grid_boundaries() {
        let mut seed = 17_u64;
        for _ in 0..1_000 {
            let mut random = || {
                seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
                (seed >> 32) as f64 / u32::MAX as f64
            };
            let row: Row = (0..18).map(|id| (id, 2. * random() - 1.)).collect();
            let d: Vec<_> = (0..18)
                .map(|_| (2. * random() - 1.) * ACCEPTED_DISPLACEMENT)
                .collect();
            let (rounded, error) = canonical_row(row.clone());
            assert!(error <= MAX_ROUNDING_GAP);
            assert!((value(&row, &d) - value(&rounded, &d)).abs() <= error + 1e-15);
        }
        for v in [-1.5e-12, -0.5e-12, 0., 0.5e-12, 1.5e-12] {
            let (rounded, error) = canonical_row(vec![(0, v)]);
            assert!((v - value(&rounded, &[1.])).abs() * ACCEPTED_DISPLACEMENT <= error);
        }
        let original = vec![(0, f64::MAX)];
        let (row, error) = canonical_row(original.clone());
        assert_eq!(row, original);
        assert_eq!(error, 0.);
    }

    #[test]
    fn budget_counts_retained_rows_and_does_not_ignore_distinct_rows() {
        let mut accumulator = CrossingAccumulator::default();
        for _ in 0..=MAX_SAMPLES {
            accumulator
                .push(Sample {
                    row: vec![(0, 1.)],
                    weight: 1.,
                })
                .unwrap();
        }
        assert_eq!(accumulator.crossings.samples.len(), 1);
        for id in 1..MAX_SAMPLES {
            accumulator
                .push(Sample {
                    row: vec![(id, 1.)],
                    weight: 1.,
                })
                .unwrap();
        }
        assert!(matches!(
            accumulator.push(Sample {
                row: vec![(MAX_SAMPLES, 1.)],
                weight: 1.
            }),
            Err(SpreadError::Limit("spatial compacted constraints"))
        ));
    }

    #[test]
    fn quadratic_slack_does_not_need_a_separate_nonnegative_constraint() {
        // For both gap signs, the minimum over s >= -gap is max(0, -gap).
        for gap in [-1_f64, -0.25, 0., 0.25, 1.] {
            let optimum = (-gap).max(0_f64);
            for i in 0..=200 {
                let feasible_slack = -gap + f64::from(i) / 100.;
                assert!(feasible_slack.powi(2) + 1e-15 >= optimum.powi(2));
            }
        }
    }
}

//! Port of Oriedita's `origami.folding.permutation.combination` package.
//!
//! This is the accelerator that solves "excess permutation": the case where
//! [`ChainPermutationGenerator`] still has an enormous number of permutations
//! left after the transitivity guides, but almost none of them would survive the
//! equivalence-condition checks. Rather than keep generating permutations and
//! rejecting them, `CombinationGenerator` turns the equivalence conditions into
//! [`Constraint`]s, searches those directly (with the swapping algorithm), and
//! feeds each solution back to the permutation generator as extra guides.
//!
//! `SubFace.possible_overlapping_search` switches to it once the generator has
//! produced more than 2000 permutations.

use super::additional_estimation::ItalianoClosure;
use super::permutation::{ChainPermutationGenerator, PermutationError, SwappingAlgorithm};
use super::{EquivalenceCondition, FaceOrder, HierarchyTable};
use std::collections::HashMap;

/// Upstream's `InferenceFailureException` out of the `CombinationGenerator`
/// constructor: the subface's already-known stacking relations contradict each
/// other, so no combination exists. The two local face indices are upstream's
/// exception payload; `possible_overlapping_search` catches it and reports "no
/// possible overlap" without inspecting them.
///
/// An enum rather than a bare payload struct because the constructor is also a
/// checkpoint, and its caller absorbs `Err` into `Ok(false)` — "no stacking of
/// this subface exists". A cancel reaching that arm would be reported as an
/// algorithmic verdict, so the two outcomes have to be distinguishable at the
/// type level rather than by convention.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum CombinationInferenceFailure {
    Contradiction { upper: usize, lower: usize },
    Cancelled,
}

impl From<crate::cancel::Cancelled> for CombinationInferenceFailure {
    fn from(_: crate::cancel::Cancelled) -> Self {
        Self::Cancelled
    }
}

/// Which equivalence condition a [`Constraint`] came from, and therefore which
/// stacking combinations it allows. Port of `TernaryConstraint` and
/// `QuaternaryConstraint`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ConstraintKind {
    /// Two possible combinations: a-b-d, or b-d-a. `b` and `d` are sorted.
    Ternary { a: usize, b: usize, d: usize },
    Quaternary {
        a: usize,
        b: usize,
        c: usize,
        d: usize,
    },
}

/// Port of `Constraint`: an equivalence condition plus which of its stacking
/// combinations are still available.
///
/// All indices are 1-based *local* face indices within the subface, matching
/// upstream's `faceIdMapArray` values.
#[derive(Debug, Clone)]
struct Constraint {
    kind: ConstraintKind,
    /// `Constraint.getChecks()`. Constant per constraint, so built once here
    /// instead of allocated on each call.
    checks: Vec<(usize, usize)>,
    /// `Constraint.optionValid`, sized by the kind's option count.
    option_valid: Vec<bool>,
    /// `Constraint.state`: 0 before any option is chosen, else the 1-based
    /// option in force.
    state: usize,
}

impl Constraint {
    fn ternary(a: usize, b: usize, d: usize) -> Self {
        Self {
            kind: ConstraintKind::Ternary { a, b, d },
            checks: vec![(a, b), (d, a)],
            option_valid: vec![false; 2],
            state: 0,
        }
    }

    fn quaternary(a: usize, b: usize, c: usize, d: usize) -> Self {
        Self {
            kind: ConstraintKind::Quaternary { a, b, c, d },
            checks: vec![(b, c), (a, c), (d, b), (c, a), (b, d), (d, a)],
            option_valid: vec![false; 4],
            state: 0,
        }
    }

    /// Go to the next combination. Port of `Constraint.next`.
    fn next(&mut self) -> bool {
        for i in self.state..self.option_valid.len() {
            if self.option_valid[i] {
                self.state = i + 1;
                return true;
            }
        }
        false
    }

    fn reset(&mut self) {
        self.state = 0;
    }

    /// Port of `Constraint.nextIfReset`: re-derive which options are still open,
    /// keep the current one if it survived, otherwise advance.
    fn next_if_reset(&mut self, ia: &ItalianoClosure) -> bool {
        self.rules(ia);
        if self.state != 0 && self.option_valid[self.state - 1] {
            return true;
        }
        self.next()
    }

    /// Port of `Constraint.optionRemain`.
    fn option_remain(&self) -> usize {
        self.option_valid[self.state..]
            .iter()
            .filter(|valid| **valid)
            .count()
    }

    /// Port of `Constraint.isDeadEnd`: no option is open at all, at any state.
    fn is_dead_end(&self) -> bool {
        !self.option_valid.iter().any(|valid| *valid)
    }

    /// Port of `TernaryConstraint.write` / `QuaternaryConstraint.write`: commit
    /// the chosen combination's stacking relations to the closure.
    fn write(&self, ia: &mut ItalianoClosure) {
        match self.kind {
            ConstraintKind::Ternary { a, b, d } => match self.state {
                1 => ia.add(a, b),
                2 => ia.add(d, a),
                _ => {}
            },
            ConstraintKind::Quaternary { a, b, c, d } => match self.state {
                1 => ia.add(b, c),
                2 => {
                    ia.add(a, c);
                    ia.add(d, b);
                }
                3 => {
                    ia.add(c, a);
                    ia.add(b, d);
                }
                4 => ia.add(d, a),
                _ => {}
            },
        }
    }

    /// Port of `TernaryConstraint.rules` / `QuaternaryConstraint.rules`: an
    /// option stays open while the closure has not established the opposite of
    /// every relation it would write.
    fn rules(&mut self, ia: &ItalianoClosure) {
        let open = |upper: usize, lower: usize| ia.order_of(upper, lower) != Some(FaceOrder::Below);
        match self.kind {
            ConstraintKind::Ternary { a, b, d } => {
                self.option_valid[0] = open(a, b);
                self.option_valid[1] = open(d, a);
            }
            ConstraintKind::Quaternary { a, b, c, d } => {
                self.option_valid[0] = open(b, c);
                self.option_valid[1] = open(a, c) && open(d, b);
                self.option_valid[2] = open(c, a) && open(b, d);
                self.option_valid[3] = open(d, a);
            }
        }
    }
}

/// Port of `CombinationGenerator`.
#[derive(Debug, Clone)]
pub(super) struct CombinationGenerator {
    /// Stable storage for the constraints. Upstream swaps elements of its
    /// `Constraint[]` directly and keys the swapping algorithm's `visited` set by
    /// object identity; here the constraints stay put, `order` holds the
    /// positions, and the index into this vector is the identity.
    constraints: Vec<Constraint>,
    /// Which constraint is searched at each depth: depth `i` (1-based, as
    /// upstream) is `constraints[order[i - 1]]`. That 0-based-storage,
    /// 1-based-position layout is what [`SwappingAlgorithm`] reorders.
    order: Vec<usize>,
    ia: ItalianoClosure,
    swapper: SwappingAlgorithm,
    face_id_count: usize,
    /// Upstream keeps this as an int rather than a flag "to help debugging".
    count: usize,
}

impl CombinationGenerator {
    /// Port of the `CombinationGenerator` constructor.
    ///
    /// `triple`/`quadruple` are the subface's own equivalence conditions in
    /// upstream's order (`SubFace.getEquivalenceConditions` /
    /// `getUEquivalenceConditions`), still in global face ids.
    pub(super) fn new(
        face_ids: &[usize],
        face_id_map: &HashMap<usize, usize>,
        triple: &[EquivalenceCondition],
        quadruple: &[EquivalenceCondition],
        table: &HierarchyTable,
    ) -> Result<Self, CombinationInferenceFailure> {
        let face_id_count = face_ids.len();
        let mut ia = ItalianoClosure::new_reduction(face_id_count);
        for i in 1..=face_id_count {
            for j in (i + 1)..=face_id_count {
                let added = match table.get(face_ids[i - 1], face_ids[j - 1]) {
                    Some(FaceOrder::Above) => ia.try_add(i, j),
                    Some(FaceOrder::Below) => ia.try_add(j, i),
                    None => true,
                };
                if !added {
                    return Err(CombinationInferenceFailure::Contradiction { upper: i, lower: j });
                }
            }
        }
        ia.save();

        // `faceIdMapArray[...]`, which is 0 for a face outside this subface. The
        // conditions were already filtered by `fast_contains` when the guide map
        // was built, so that cannot happen here.
        let local = |face_id: usize| face_id_map.get(&face_id).copied().unwrap_or(0);

        let mut constraints = Vec::with_capacity(triple.len() + quadruple.len());
        for ec in triple {
            constraints.push(Constraint::ternary(local(ec.a), local(ec.b), local(ec.d)));
        }
        for ec in quadruple {
            constraints.push(Constraint::quaternary(
                local(ec.a),
                local(ec.b),
                local(ec.c),
                local(ec.d),
            ));
        }

        let order = (0..constraints.len()).collect();
        Ok(Self {
            constraints,
            order,
            ia,
            swapper: SwappingAlgorithm::default(),
            face_id_count,
            count: 0,
        })
    }

    /// The constraint searched at 1-based depth `i`, or `None` past the end.
    fn at(&self, depth: usize) -> Option<usize> {
        self.order.get(depth.checked_sub(1)?).copied()
    }

    /// Port of `CombinationGenerator.process`: advance to the next valid
    /// combination of all constraints, or report that there is none left.
    pub(super) fn process(&mut self) -> bool {
        // Swap only while finding the first combination; after that the sequence
        // has to stay fixed, or we get the same combination again and again.
        let swap = self.count == 0;
        let mut deepest = 0usize;
        // Upstream's `constraints.length`, its array being 1-based.
        let end = self.constraints.len() + 1;

        if self.count != 0 && !self.backtrack(end) {
            return false;
        }
        self.count += 1;
        loop {
            let mut depth = 0usize;
            let mut dead_end = false;
            self.ia.restore();
            for i in 1..end {
                if i > deepest {
                    deepest = i;
                }
                self.ia.set_depth(i);
                let Some(index) = self.at(i) else { continue };
                if !self.constraints[index].next_if_reset(&self.ia) {
                    depth = i;
                    if swap {
                        self.swapper.record(i);
                    } else {
                        dead_end = self.constraints[index].is_dead_end();
                    }
                    break;
                }
                self.constraints[index].write(&mut self.ia);
            }
            if depth == 0 {
                return true;
            }

            // Make sure to reset to the deepest depth.
            self.reset_range(depth, deepest);
            deepest = depth;

            if !dead_end && !self.backtrack(depth) {
                return false;
            }

            if swap {
                self.swapper.process(&mut self.order, end - 1, &mut |_| {});
            } else if dead_end {
                // On a dead-end we can skip straight back to the last constraint
                // that conflicts with this one.
                let conflict = self.find_conflict(depth);
                if !self.backtrack(conflict + 1) {
                    return false;
                }
            }
        }
    }

    /// Port of `CombinationGenerator.findConflict`.
    fn find_conflict(&mut self, depth: usize) -> usize {
        let result = self.conflicting_depth(depth);
        self.reset_range(result + 1, depth);
        result
    }

    /// Port of `Constraint.findConflict` for the constraint at `depth`. It reads
    /// the other constraints, so it lives here rather than on [`Constraint`].
    ///
    /// The checks are `(upper, lower)` pairs the constraint would write, and the
    /// relation that closes one off is the *opposite* one — hence the swapped
    /// arguments to `depth_of`.
    fn conflicting_depth(&self, depth: usize) -> usize {
        let Some(constraint) = self.at(depth).map(|index| &self.constraints[index]) else {
            return 0;
        };
        let mut result = 0usize;
        let mut backup = 0usize;
        for &(upper, lower) in &constraint.checks {
            let h = self.ia.depth_of(lower, upper);
            if h == 0 || h >= depth {
                continue;
            }
            let Some(other) = self.at(h).map(|index| &self.constraints[index]) else {
                continue;
            };
            if other.option_remain() > 0 {
                result = result.max(h);
            } else {
                backup = backup.max(h);
            }
        }
        if result == 0 { backup } else { result }
    }

    /// Port of `CombinationGenerator.backtrack`.
    fn backtrack(&mut self, depth: usize) -> bool {
        for i in (1..depth).rev() {
            let Some(index) = self.at(i) else { continue };
            if self.constraints[index].next() {
                return true;
            }
            self.constraints[index].reset();
        }
        false
    }

    fn reset_range(&mut self, from: usize, to: usize) {
        for i in from..=to {
            if let Some(index) = self.at(i) {
                self.constraints[index].reset();
            }
        }
    }

    /// Port of `CombinationGenerator.addGuideAndCheck`: hand the current
    /// combination's transitive reduction to the permutation generator as
    /// guides, and report the first digit its current permutation violates (0 if
    /// the permutation already satisfies all of them).
    pub(super) fn add_guide_and_check(
        &self,
        generator: &mut ChainPermutationGenerator,
    ) -> Result<usize, PermutationError> {
        let mut min = self.face_id_count + 1;
        for entry in self.ia.reduction() {
            let upper = (entry >> 16) as usize;
            let lower = (entry & super::additional_estimation::CHANGE_MASK) as usize;
            let upper_position = generator.locate(upper).unwrap_or(0);
            let lower_position = generator.locate(lower).unwrap_or(0);
            if upper_position > lower_position {
                min = min.min(lower_position);
            }
            generator.add_guide(upper, lower)?;
        }
        Ok(if min > self.face_id_count { 0 } else { min })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::folding::{HierarchyRelation, InitialHierarchy};

    fn table(faces_total: usize, relations: &[(usize, usize)]) -> HierarchyTable {
        HierarchyTable::from_initial(&InitialHierarchy {
            faces_total,
            relations: relations
                .iter()
                .map(|(upper_face, lower_face)| HierarchyRelation {
                    upper_face: *upper_face,
                    lower_face: *lower_face,
                })
                .collect(),
        })
    }

    fn face_id_map(face_ids: &[usize]) -> HashMap<usize, usize> {
        face_ids
            .iter()
            .enumerate()
            .map(|(index, face_id)| (*face_id, index + 1))
            .collect()
    }

    fn condition(a: usize, b: usize, c: usize, d: usize) -> EquivalenceCondition {
        EquivalenceCondition { a, b, c, d }
    }

    /// With no constraints at all, upstream yields exactly one (empty)
    /// combination and then reports exhaustion.
    #[test]
    fn no_constraints_yields_one_combination() {
        let face_ids = [0usize, 1, 2];
        let mut generator = CombinationGenerator::new(
            &face_ids,
            &face_id_map(&face_ids),
            &[],
            &[],
            &table(3, &[(0, 1)]),
        )
        .expect("consistent hierarchy");
        assert!(generator.process());
        assert!(!generator.process());
    }

    /// A subface whose known relations already cycle is upstream's
    /// `InferenceFailureException` out of the constructor.
    #[test]
    fn contradictory_hierarchy_fails_construction() {
        let face_ids = [0usize, 1, 2];
        // 0 > 1 > 2 plus 2 > 0 has no consistent stacking.
        let mut cyclic = table(3, &[(0, 1), (1, 2)]);
        cyclic.set_above(2, 0);
        let failure =
            CombinationGenerator::new(&face_ids, &face_id_map(&face_ids), &[], &[], &cyclic)
                .expect_err("cyclic hierarchy should fail inference");
        // The local pair the seeding loop was on when it found the cycle, which
        // is upstream's `InferenceFailureException(i, j)` payload.
        assert_eq!(
            failure,
            CombinationInferenceFailure::Contradiction { upper: 2, lower: 3 }
        );
    }

    /// A ternary constraint has two combinations, so the generator produces two
    /// solutions and then stops.
    #[test]
    fn ternary_constraint_enumerates_both_combinations() {
        let face_ids = [0usize, 1, 2];
        let conditions = [condition(0, 1, 0, 2)];
        let mut generator = CombinationGenerator::new(
            &face_ids,
            &face_id_map(&face_ids),
            &conditions,
            &[],
            &table(3, &[]),
        )
        .expect("consistent hierarchy");

        assert!(generator.process());
        // a-b-d: face 0 above face 1.
        assert_eq!(generator.ia.order_of(1, 2), Some(FaceOrder::Above));
        assert!(generator.process());
        // b-d-a: face 2 above face 0.
        assert_eq!(generator.ia.order_of(3, 1), Some(FaceOrder::Above));
        assert!(!generator.process());
    }

    /// A ternary constraint whose first option the hierarchy has already ruled
    /// out only offers its second.
    #[test]
    fn ternary_constraint_skips_closed_option() {
        let face_ids = [0usize, 1, 2];
        let conditions = [condition(0, 1, 0, 2)];
        // 1 > 0 closes option a-b-d, which would need 0 > 1.
        let mut generator = CombinationGenerator::new(
            &face_ids,
            &face_id_map(&face_ids),
            &conditions,
            &[],
            &table(3, &[(1, 0)]),
        )
        .expect("consistent hierarchy");

        assert!(generator.process());
        assert_eq!(generator.ia.order_of(3, 1), Some(FaceOrder::Above));
        assert!(!generator.process());
    }

    /// The reduction handed to the permutation generator drops edges implied by
    /// transitivity: 1 > 2 > 3 must not also emit 1 > 3.
    #[test]
    fn reduction_drops_transitive_edges() {
        let face_ids = [0usize, 1, 2];
        let generator = CombinationGenerator::new(
            &face_ids,
            &face_id_map(&face_ids),
            &[],
            &[],
            &table(3, &[(0, 1), (1, 2), (0, 2)]),
        )
        .expect("consistent hierarchy");

        let mut edges = generator
            .ia
            .reduction()
            .into_iter()
            .map(|entry| ((entry >> 16) as usize, (entry & 0xFFFF) as usize))
            .collect::<Vec<_>>();
        edges.sort_unstable();
        assert_eq!(edges, vec![(1, 2), (2, 3)]);
    }
}

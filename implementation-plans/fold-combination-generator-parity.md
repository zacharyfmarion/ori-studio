# Fold CombinationGenerator Parity

## Goal

Port Oriedita's `CombinationGenerator` accelerator into the Rust folding port, so
layer ordering stops refusing on complex crease patterns.

`crates/oristudio-cp/src/folding/permutation.rs` ported
`SubFace.possible_overlapping_search()` without the accelerator, and returned a
typed `SubFaceSearchError::CombinationGeneratorRequired` at the point upstream
switches algorithms:

```java
// SubFace.java
if (permutationGenerator.getCount() > 2000 && cg == null) {
    cg = new CombinationGenerator(this, faceIdMapArray, hierarchyList);
    if (runCombinationGenerator() == 0) return 0;
}
```

2000 is upstream's own switch point, not a cap. Past it the permutation generator
still has an enormous space left but almost nothing in it survives the
equivalence-condition checks, so upstream stops enumerating permutations and
searches the conditions directly. We stopped instead, and the caller reported
"no layer order".

## Approach

Port the four pieces the accelerator needs. `EquivalenceCondition` and the
Italiano closure base already existed (the latter from
`fold-additional-estimation-italiano-parity.md`).

| Upstream | Rust |
| --- | --- |
| `TraceableItalianoAlgorithm` | `ItalianoClosure` in traceable mode: `set_depth` / `depth_of` / `order_of`, and `restore` clearing the history |
| `ReductionItalianoAlgorithm` | `ItalianoClosure::reduction` |
| `SwappingAlgorithm<T>` | `SwappingAlgorithm`, split out of the existing `SubFaceSwapper` |
| `Constraint` + `TernaryConstraint` + `QuaternaryConstraint` | `Constraint` + `ConstraintKind` in `folding/combination.rs` |
| `CombinationGenerator` | `CombinationGenerator` in `folding/combination.rs` |

Notes on the two places the Rust shape differs from the Java, neither of them a
behavioural divergence:

- **Closure mode instead of subclasses.** Upstream's `Reactive` and
  `Traceable`/`Reduction` are sibling subclasses of one base and no instance is
  ever both. A `ClosureMode` field selects which `meld` override runs, which
  keeps the base single-copy and — more importantly — keeps the reactive change
  list from growing without bound during the combination search, which never
  drains it.
- **Positions, not element moves.** Upstream's swapping algorithm reorders the
  `Constraint[]` itself and keys `visited` by object identity. The Rust
  constraints stay put and an `order` vector holds the positions, so the index
  into the constraint vector *is* the identity. That is the same shape
  `WorkerOverlapEnumerator` already uses for subfaces, and it is what lets the
  same `SwappingAlgorithm` drive both.

## Affected Areas

- `crates/oristudio-cp/src/folding/combination.rs` (new)
- `crates/oristudio-cp/src/folding/additional_estimation.rs`
- `crates/oristudio-cp/src/folding/permutation.rs`
- `crates/oristudio-cp/src/folding.rs`
- `crates/oristudio-cp/tests/oriedita_folding_oracle.rs`
- `PORTING.md`

## Measurement

Measured on subfaces built to cross the switch point, `--release`, on the
subface search and on layer ordering over a set containing one such subface.
Before is the refusal, restored temporarily for the measurement.

| Case | Before | After |
| --- | --- | --- |
| Unstackable, 9 faces | refused at 2001 permutations, 0.63ms | `found=false`, 2001 permutations, 0.60ms |
| One stacking left, 9 faces | refused at 2001 permutations, 0.63ms | `found=true`, 2002 permutations, 0.60ms |
| One stacking left, 12 faces | refused at 2001 permutations, 0.80ms | `found=true`, 2002 permutations, 0.81ms |
| Layer ordering, one hard subface of 12 | refused, 0.83ms | answered, 0.83ms |

The wall-clock is unchanged to within noise, because essentially all of it is
the 2000 permutations spent *reaching* the switch; the accelerator then settles
the subface in microseconds. The refusal was not buying time, it was discarding
an answer that costs almost nothing to compute.

Nothing in the repository's flat fixtures crosses 2000, which is why the
existing folding oracle suite is unchanged by this work.

## Checklist

- [x] Read the vendored Java before writing (`CombinationGenerator`,
      `Constraint`, `TernaryConstraint`, `QuaternaryConstraint`, `SubFace`,
      `SwappingAlgorithm`, the Italiano family)
- [x] Port `TraceableItalianoAlgorithm` and `ReductionItalianoAlgorithm`
- [x] Split the generic `SwappingAlgorithm` out of `SubFaceSwapper`
- [x] Port `Constraint` / `TernaryConstraint` / `QuaternaryConstraint`
- [x] Port `CombinationGenerator`
- [x] Wire it into `SubFacePermutationSearch` (`next`, `clearTempGuide`,
      `resetPermutationGenerator`, `getPermutationCount`, and the
      penetration-check skip) and delete the refusal
- [x] Oracle cases above the switch point, both outcomes, plus a quaternary
      constraint
- [x] Fixed-seed differential sweep against the oracle
- [x] Unit tests that pin the accelerator without Java
- [x] Measure before/after
- [x] Record in `PORTING.md`

# TreeMaker 22.5-degree synthesis spike

This research crate tests two prerequisites for a target-conditioned 22.5-degree
crease-pattern solver without changing TreeMaker 5.0.1 behavior.

1. A labeled metric tree can be expanded into signed positions on a common
   folded axis while retaining the identity and connectivity of overlapping
   flaps.
2. A tree extracted from a generated candidate can be compared with the target
   by graph correspondence and normalized edge lengths, rather than by a
   spectral nearest-neighbor score.

The crate deliberately stops at the folded representation. It does **not** show
that every axial schedule can be unfolded into a non-self-intersecting square
crease pattern, nor does it solve mountain-valley assignment or layer order.
Those are the next and most important risks.

## Findings represented by the spike

- Every finite metric tree admits signed axial schedules: after choosing a root,
  each child edge may extend in either axial direction.
- Axial position alone is insufficient to identify a tree vertex. Distinct
  junctions can occupy the same axial coordinate and must remain separate by
  physical paper connectivity.
- One folded component per target edge plus explicit endpoint junctions retains
  enough information to recover the labeled metric tree exactly.
- Scale-normalized edge comparison gives a deterministic acceptance test for a
  generated candidate. Labels can be required when flap identity matters, or
  omitted for topology-only exploration.

## Next experiment

Connect this acceptance oracle to a bounded 22.5-degree candidate generator.
For each candidate, reject remaining Kawasaki errors, extract folded components
and junction connectivity, then call `match_metric_trees`. Successful small
examples would validate target-conditioned generate-and-test; repeated failures
would motivate moving component labels and junction constraints into SAT.

# Precrease presentation pass: minutes to seconds, same plan

## Goal

A folding sequence for a mid-size crease pattern took minutes. Knight
(`test_files/references/knight.osf`: 3,662 segments, one sheet, 558 merged
lines, a 48-grid, closes entirely from the bare sheet with no stuck event and
no ReferenceFinder query) planned in **125 s** in the browser. Make it
seconds without changing the plan that comes out.

## What was slow, measured

Native release on knight, before this change (`bench_planner`):

| phase | time |
| --- | --- |
| `Planner::new` + `close` to the fixpoint | 0.65 s |
| stuck search / ReferenceFinder | 0 (complete from the bare sheet) |
| **`Planner::sequence(false)`** | **46.8 s** |

Everything the plan budgets — the 30 s total, the 4 s per stuck event —
covers the closure loop. `sequence()` is the presentation pass and sits
outside it, and `useReferencesBreakdown.planComponent` calls it **twice** per
sheet (plain and landmarks-first), so a 47 s pass is 95 s native and, at the
wasm factor measured here (~1.3×), the 125 s the app showed. The toast text
("the first search builds a table") is the generic long-run message; no
ReferenceFinder table was being built.

Inside one `sequence(false)` (47.4 s, from temporary counters):

- `settle_grid` runs a full `order_with` to look for presses that landed on
  the grid — 18.4 s — finds none, returns, and `sequence` runs the same
  `order_with` again from scratch: 18.7 s.
- `order::optimize` spends its whole 10 s refinement budget (deadline-bound,
  as designed).
- Under `order_with`: `place_with → sight → candidates → all_witnesses_for_card
  → full_facts_on → scan_landers_on` was 31.9 s over 1,552 calls: **367 M
  inner iterations**. `scan_landers_on` reflects every state line across the
  target (556 images), intersects each image with every other line (556), and
  probes the point grid at each crossing — O(|L|²) per fold, O(|L|³) per
  pass. On a lattice design 56 % of those probes land on a state point (a
  reflected lattice line runs through lattice points), each distinct lander
  is rediscovered ~15 times — once per line through it — and every
  rediscovery re-ran the distance, reflection and `point_mark_exists` tests
  before the `seen` check. The 256-lander cap filled in 87 % of calls after
  scanning only **11 %** of the lines, and the loop ran to the end anyway.
- `witness_cost` (`repair`, `presses_for_lines`) cloned the whole `Creased`
  paper — three `Vec<Vec<_>>` of 556 entries, ~600 allocations — for each of
  the ~389 witnesses priced per fold: 5.2 s.
- `witnesses_on_capped` asked `point_mark_exists` inside `sort_by_key`
  closures, once per comparison rather than once per point: 4.3 s.

## Approach

Only changes whose output is provably the same as before, in this order:

1. **`scan_landers_on` stops when nothing more can be kept.**
   `Facts::push_lander_within` refuses every push once `landers.len() >= max`,
   and every push on `m₁` once that line has `per_line` landers, so leaving
   the loops at those points changes nothing. The `seen` test moves ahead of
   the per-pair predicates (none of them depend on the crossing `m` the pair
   was met through), and the point-grid probe fills a reused buffer
   (`PointGrid::within_into`, same `(distance, id)` order) instead of
   allocating a `Vec` per crossing. 31.9 s → 3.4 s, 367 M → 52 M iterations,
   identical landers.
2. **`settle_grid` hands back the ordering it computed** when it found no
   press to extend — the closure is untouched, so `sequence` would compute
   the same `Vec<Placed>` again. `Option<Vec<Placed>>`; `None` when a pass
   pressed a grid line after its last ordering, or there is no grid.
3. **`repair` and `presses_for_lines` price on a `Cow<Creased>`**: the paper
   is copied the moment a press is recorded, not before. Reads before the
   first write see the same paper the clone would have been.
4. **`Creased` keeps one `Rc<LineMarks>` per line** (`runs`, `pinches`,
   `pinchable` together), so a copy of the paper is one allocation and a
   reference count per line, and a copy that then records a press copies only
   that line (`Rc::make_mut`). The fields were private and every mutation
   goes through the `impl`, so the change is contained in `marks.rs`.
5. **`witnesses_on_capped` computes each point's mark key once** (a memo over
   the three lists) and sorts by precomputed keys with the same stable order.

Not changed, deliberately — each would change the plan or is a product call:

- The 10 s `sequence_budget_ms` per `sequence()` call. It still earns its
  keep on knight (presses 10 → 8, extra crease 10.1 → 6.1 sheet-widths, and
  not saturated at 10 s), but it is a fixed 20 s of wall clock per sheet in
  the app; halving it or computing the landmarks-first order lazily is a
  policy decision.
- The 4 s stuck-event budget: designs that hit it (helioprion, five events)
  get a wall-clock-dependent closure, so their plans differ between runs of
  the *same* code. The equivalence check below freezes the clock for them.
- The lander caps themselves and the scan order they cut by.

## Affected Areas

- `crates/oristudio-precrease/src/predicates.rs` — `scan_landers_on`,
  `witnesses_on_capped`, `sort_stably_by`.
- `crates/oristudio-precrease/src/marks.rs` — `Creased` representation.
- `crates/oristudio-precrease/src/order.rs` — `repair`, `presses_for_lines`.
- `crates/oristudio-precrease/src/planner.rs` — `settle_grid`, `sequence`.
- `crates/oristudio-precrease/src/state.rs`, `pointgrid.rs` — buffer probes.
- `crates/oristudio-precrease/examples/bench_planner.rs` — `seq_ms` column and
  `--sequence-budget-ms`, so the presentation pass is measured on its own.

## Results

Native release, knight, `sequence(false)` / `sequence(true)`:

| | before | after |
| --- | --- | --- |
| refinement budget 0 | 45.6 s / 48.9 s | 3.4 s / 3.7 s |
| refinement budget 10 s (shipping) | 46.8 s / (not measured quiet) | 13.3 s / 14.5 s |

Both builds timed back to back on a loaded machine (two other planner runs
in flight): 155 s → 29.5 s for the whole `close` + both `sequence` calls.

Browser (Chromium, wasm), knight, `referencesPlan.durationMs`, same plan
(469 steps, 8 turn-overs, reach 6.12): **125.4 s → 34.5 s**, of which 20 s
is the two refinement budgets.

Equivalence: `sequence(false)` and `sequence(true)` dumped as JSON for 57
designs (15 fixtures, 42 curated corpus designs) plus knight, before and
after, with the refinement budget off. Under the real clock the only plans
that moved were designs whose stuck search hits its 4 s budget
(`diagnostics.budget_hit`), which move between two runs of the *same* build
too; with a frozen clock and a bounded root-candidate cap (`--max-candidates
40`, no depth-3 deepening), so that the stuck search is deterministic for
both builds, every dump is identical apart from `diagnostics.elapsed_ms`.
Crate tests: 272 pass; `precreasePlan.wasm.test.ts` passes against the
rebuilt bridge.

## Checklist

- [x] Measure where a 47 s `sequence()` goes (temporary counters, `sample`).
- [x] `scan_landers_on`: exit at the caps, `seen` first, buffer probes.
- [x] `settle_grid` returns its ordering when the closure did not change.
- [x] `Cow<Creased>` in `repair` / `presses_for_lines`.
- [x] `Creased` as per-line `Rc` records.
- [x] Mark keys once in `witnesses_on_capped`.
- [x] Before/after plan equivalence over fixtures, corpus and knight.
- [x] `bench_planner` shows `seq_ms`.
- [ ] Decide the refinement budget and the landmarks-first laziness (product).
- [ ] Follow-ups if still wanted: memoize `tier1_facts` per line across the
      pass (state-only, ~0.8 s of the remaining 3.4 s); `twin_in_queue` and
      `repick_to_vouch` each re-run `candidates` for lines already sighted.

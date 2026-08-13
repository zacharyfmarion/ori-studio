# Fold Cancellation

## Goal

Let the user stop an in-progress fold, and have it stop **in well under a
second**.

That second clause is the whole difficulty. Folds run for minutes and, on the
largest crease patterns users bring, reportedly up to an hour. A cancel that
lands "eventually" is indistinguishable from the hang it is meant to escape, so
the design constraint is not "add a cancel path" — it is **no single stretch of
kernel computation may exceed ~100 ms without asking whether it should stop**.

Everything below follows from that. Parity with Oriedita is the floor, not the
target: upstream's own cancellation is not sub-second on a large model (see
[Parity](#parity-with-oriedita-and-where-we-exceed-it)), and its granularity
criterion is stated out loud at
`third_party/oriedita/origami/src/main/java/origami/crease_pattern/PointSet.java:424`
— *"No need for InterruptedException here since this algorithm is now way too
fast even for Ryujin"* — which is a judgement about the hardest known model, not
a latency bound.

## Root cause

There is no cancel today, and three independent layers each independently
prevent one.

**1. Nothing to press.** `apps/web/src/components/GlobalToasts.tsx:55` says it
outright: *"No cancel affordance: the toast reports, it does not offer a way
out."* `apps/web/src/keyboard/shortcuts.ts:176` carries `haltAction: 'ESCAPE'`,
but that entry sits under the `-- Upstream reference --` header and is read only
by `defaultChordForCpAction` (shortcuts.ts:399) to derive a chord for a CP action
whose `upstreamAction` matches. No such action exists, so the line is inert by
construction. It is documentation, not a binding.

**2. Nothing could receive it.** On web the whole fold is one synchronous wasm
call inside the shared CP worker (`apps/web/src/workers/oristudioCpWorker.ts:214`
→ `folded_figure_fold` → `with_session_mut` → `folding_estimated`). The worker's
event loop is blocked, so a Comlink `postMessage` sits unread in the queue. On
desktop `apps/tauri/src-tauri/src/cp_engine.rs:42` `run()` locks
`CpEngine = Arc<Mutex<CpSession>>` for the fold's entire duration, and all 40
registered CP commands go through `run()` — so a cancel command routed the normal
way would block on the mutex held by the fold it is trying to stop.

**3. The kernel would ignore it.** Oriedita has 32 `Thread.interrupted()`
checkpoints across `FoldedFigure`, `FoldedFigure_Configurator`, `WireFrame_Worker`,
`AdditionalEstimationAlgorithm`, `SubFace`, `ChainPermutationGenerator`,
`CombinationGenerator`, `PointSet`, `PointLineMap` and `IntersectDivide`. Our port
dropped all of them: `rg -i 'cancel|abort|interrupt|AtomicBool' crates/oristudio-cp/src`
returns six hits, every one of them prose in a doc comment.

## What actually takes the time

Reproduced on this machine with the repo's own harness, on the only committed
fixture that folds non-trivially:

```
$ cargo run -q -p oristudio-cp --release --features fold-profiling \
    --example fold_profile -- tests/fixtures/oriedita/failing_global_flat_fold.ori

  [fold-phase] fold graph built:              0.4ms
  [fold-phase] subface graph built:           0.4ms
  [fold-phase] subface config done:           0.4ms
  [fold-phase] equivalence conditions built:  3.8ms      <-- 72% of Order4
  [fold-phase] removeMode reduced conditions: 0.2ms
[iter 0] Order4: 5.3ms   [iter 0] Order5: 5.1ms   TOTAL: 12.2ms
```

### Measured at scale

`slow_tiling_fold.osf` (19 652 segments) now provides the slow input this plan
was missing. Native release, `--max-order 4` (setup only — Order5 on this file
runs for over an hour and would drown the signal), **after** the
`line_face_border` fix below:

```
Order1 0.0ms   Order2 1248.6ms   Order3 2268.7ms   Order4 22877.1ms
  [fold-phase] fold graph built:                26.2ms
  [fold-phase] subface graph built:           1498.1ms
  [fold-phase] subface config done:            752.7ms
  [fold-phase] equivalence conditions built: 19343.5ms   <-- 85% of Order4
  [fold-phase] removeMode reduced conditions:  433.8ms
  [fold-phase] worker enumerator built:        822.5ms
TOTAL (Order1-4): 26394.4ms
```

So the plan's load-bearing claim holds, and holds *after* the obvious
asymptotic fix: **equivalence-condition generation is 85 % of setup**, and the
layer-ordering search is not where a long fold spends its time. Tier-1 site 1
(`folding.rs:4252`) stays the first checkpoint that matters.

The earlier `slow_fold_iguana.ori` figures quoted from
`fold-additional-estimation-italiano-parity.md:19-21,62` are consistent with
this and are no longer load-bearing; that file is not on this machine.

A third stage, invisible on both of those models, was measured separately by
a review pass, on native release, M-series, calling
`prepare_subface_segments` on N×N orthogonal grids:

| N | `prepare_subface_segments` | of which `divide_intersections` |
|---|---|---|
| 20 | 3.6 ms | 3.4 ms |
| 40 | 56.3 ms | 54.8 ms |
| 60 | 284.1 ms | 278.1 ms |
| 80 | 888.9 ms | 873.2 ms |

Clean n², ~98% inside `divide_intersections`, and it runs **twice** per fold
(`folding.rs:1502` for Order 3 via `:1725`, `folding.rs:2518` for Order 4). At
N=80 that is 9× over the bar, per call. On a sixty-minute model it is seconds to
minutes of dead time. This is a Phase-1 re-measurement item, but the shape is not
in doubt: the loop is a dynamic O(n²) pair scan (`arrangement.rs:26-37`).

Three consequences, and they are the load-bearing facts of this plan:

- **Checkpointing the search loop alone is useless.** `permutation.rs:509` is the
  only per-iteration hook in the fold today (`fold_profiling::bump_outer_iter()`
  at `permutation.rs:510`). On the one measured slow model it ticks **once per
  580 ms** — 6× over budget — and it covers none of the 88%.
- **The first checkpoint has to go inside condition generation**, at
  `crates/oristudio-cp/src/folding.rs:4252`, the
  `for second_line in line_tree.collect_potential_collision(first_line)` loop.
- **`divide_intersections` must become fallible.** It is the worst single
  uninterruptible stretch measured anywhere in this plan, and no caller loop is
  coarse enough to substitute for it. That decision costs a two-line diff in two
  test files; see [the adjudication](#adjudicating-the-token-threading-strategy).

> **Adjudicated.** `risk-and-scope` cited `folded-figure-feedback-and-failures.md`
> claiming the *additional-estimation closure* dominates; `hot-path` measured
> *equivalence-condition generation*. Both live inside `overlap_enumerator_from_segments`
> (`folding.rs:2499`), i.e. Order4 setup, so the stage is not in dispute. The
> function is, and only one side has a number. I reproduced the shape above
> (72% on the small fixture) and take `hot-path`'s. Ranking beyond that is
> re-derivable from `fold_profile` and should be re-checked once a genuinely slow
> file is in hand.

### `line_face_border` — done first, and it did not change the answer

This plan originally deferred it. It was done first instead, because it was the
one thing that could have invalidated the checkpoint ranking.
`graph.line_face_border` was a linear scan over every face, called per inner
iteration of the condition loops (`folding.rs:4210`, `:4243`, `:4253`), making
generation `O(lines x candidates x faces)`. Upstream never paid it:
`PointSet.findLineInFaceBorder` (`PointSet.java:454-490`) precomputes both arrays
once, walking only the faces incident to each line's `begin` point, and reads
them back at `:494`. The port keeps the point→face incidence `calculate_faces`
already builds and discards (`fold_graph.rs:231`), so the index is free.

| Input | Before | After | |
| --- | --- | --- | --- |
| 563-CP `cpoogle` corpus, aggregate | 360.7 s | 73.5 s | **4.91x** |
| ...of which ≥1600 segments (n=30) | 216.9 s | 32.9 s | **6.59x** |
| ...400–800 segments (n=82) | 25.3 s | 9.6 s | 2.64x |
| ...<200 segments (n=196) | 1.73 s | 1.32 s | 1.31x |
| Best single file | 13.3 s | 0.69 s | **19.2x** |
| `slow_tiling_fold.osf` conditions phase | >37 min, killed unfinished | 19.3 s | **>115x** |

Eight corpus patterns that could not fold inside a 20 s budget now fold, the
slowest in 7.5 s. Correctness: the harness fingerprint (`cases`, `relations`,
FNV hash of the sorted hierarchy) is **identical on all 539 files that folded in
both passes** — zero mismatches — and the folding and render oracles pass.

The cost is real but small: 22 of 539 files got slower, worst case 43.9 ms, and
**56.8 ms total added across the whole corpus**. Below ~200 segments the index
does not pay for itself; the crossover is well under the size at which anyone
would want to cancel.

The ranking is unchanged: condition generation is still 85 % of setup on the
tiling file *after* the fix, so every tier-1 site below stands.

## Responsiveness budget

The bar is **no uninterrupted stretch > 100 ms**. Sites below are ranked by
contribution. "Body" is the cost of one iteration of the named loop; "stride" is
how many iterations pass between polls; "gap" is body × stride.

Sources: **[M]** measured by the `hot-path` investigation on `slow_fold_iguana.ori`
(850 faces, max 250 faces/subface); **[D]** derived from those measurements and the
loop's own complexity; **[A]** assumption to be replaced by a measurement in
Phase 1.

### Tier 1 — required to meet the bar

"Err" is the error type the `?` at that site unwinds through — the column exists
because getting it wrong is how a cancel becomes a fabricated contradiction (see
[Errors](#errors)). "Shape" is `?` unless noted.

| # | Site | Loop | Body | Stride | Gap | Err | Oriedita |
|---|---|---|---|---|---|---|---|
| 1 | `folding.rs:4252` | `for second_line in …collect_potential_collision` | ~5.8 µs [M] | 1 | 6 µs | *latch* | `Configurator.java:458` |
| 2 | `folding.rs:4220` | `for face_index in face_tree.collect_rectangle` | ~20–50 ns [D] | 256 | ~10 µs | *latch* | `Configurator.java:416` |
| 3 | `additional_estimation.rs:578` | `while s < self.count` (per-subface transitivity) | 0.1–5 ms [M] | 1 | ≤5 ms | `AdditionalEstimationError` | `AEA.java:99` |
| 4 | `additional_estimation.rs:607` / `:614` | `for &ec in triple` / `quadruple` (46 784 / 92 454 conds [M]) | 5–15 ns [D] | 1024 | ~10 µs | `AdditionalEstimationError` | `AEA.java:115` / `:130` |
| 5 | `permutation.rs:862` | `while changed != 0` (one permutation tested) | 0.4–60 µs [M] | 64 | ≤4 ms | `SubFaceSearchError` | above `ChainPermutationGenerator.java:165` |
| 6 | `permutation.rs:902`, `combination.rs:261` | accelerator `loop` | ≤15 ms [D] | 1 | ≤15 ms | `PermutationError` / `CombinationInferenceFailure` | `CombinationGenerator.java:120` |
| 7 | `permutation.rs:611` | `loop` head in `run_final_additional_estimation` | one full fixpoint pass [D] | 1 | bounded by 7b/7c | `FinalAdditionalEstimationFailure` | — |
| 7b | `permutation.rs:613` / `:620` | `for condition in &conditions.triple` / `quadruple` | 5–15 ns [D] | 1024 | ~10 µs | `FinalAdditionalEstimationFailure` | — |
| 7c | `permutation.rs:653` | `for upper` in `infer_final_subface_transitivity` | ~60 µs at k=250 [D] | 1 | 60 µs | `FinalAdditionalEstimationFailure` | — |
| 8 | `permutation.rs:439` | `for subface_index` in `from_ordered_subfaces` (`set_guide_map`) | ~10 ms [M] | 1 | ~10 ms | `WorkerOverlapSearchError` | `SubFace.java:389` |
| 9 | `folding.rs:4112` | `for (line_index, line) in graph.lines` in `initial_hierarchy_from_graph` | one `line_face_border` = O(F·k) [D] | 1 | ~15 µs | `InitialHierarchyError` | — |
| 10 | `fold_graph.rs:193` | `for face in &current_round` (BFS round) | F·k² ≈ 14 µs [D] | 1 | 14 µs | `FoldGraphError` | finer than `WireFrame_Worker.java:168` |
| 11 | `folding.rs:4331` | `for subface in &subface_graph.faces` in `configure_subfaces` | ~25 µs [D] | 1 | 25 µs | *new* `Result<_, Cancelled>` | `Configurator.java:126` |
| 12 | `arrangement.rs:27` | `while i < model.line_segments.len()` in `divide_intersections` | n pair tests [D] | 1 | 30 µs @ n=1k | `Cancelled` (**signature change**) | `IntersectDivide.java:26` |
| 13 | `folding.rs:4786` | the two `remove_line_segment_set_duplicates` passes (private fn — no oracle impact) | O(n²) [D] | 256 | ~10 µs | `Cancelled` | — |
| 14 | `folding.rs:1941` | `folding_estimate_to_case` batch loop | one whole search | 1 | — † | `FoldingEstimateError` | — |
| 15 | `folding.rs` `folding_estimated` stages 01/02/02col/03/04/05 | between stages | one stage | 1 | — † | `FoldingEstimateError` | `FoldedFigure.java:148,164,179,207,230,261` |

† Sites 14 and 15 are **backstops, not bounds**: each covers a coarse boundary
whose interior is already covered by finer sites. They cost nothing and they are
what makes the parity accounting complete; they are not what meets the 100 ms
bar.

Site 9 was demoted to tier 2 in an earlier draft. It is promoted because it calls
the same `line_face_border` full-face scan the [Aside](#what-actually-takes-the-time)
identifies as the ~88% asymptotic regression, once per line, twice per Order 4
(`folding.rs:2515`, `:4163`). Leaving it conditional risks shipping a multi-second
uninterruptible stretch on exactly the models this feature exists for. While
there, check the sibling scans at `folding.rs:1565` and `:1592`/`:1602` for
fold-reachability and tier them the same way.

**Worst bounded gap: ~15 ms** (site 6), against a 100 ms bar. Sites 3, 6, 8 and
12 are the ones with real headroom risk on a model much larger than the iguana,
and they are exactly the four the Phase-1 instrumentation must confirm. Site 12's
30 µs row is the gap *given* the signature change; without it the whole stage is
one 873 ms block (measured at N=80).

### Tier 2 — add if Phase 1 measurement says they are hot

`folding.rs:4745`, `folding.rs:4556`, `fold_graph.rs:84`, `permutation.rs:979` /
`:1015` / `:1023` (≙ `SubFace.java:429`/`:439`/`:445`),
`additional_estimation.rs:418`, `combination.rs:199`, and `permutation.rs:509` /
`:1189` as backstops.

### Sites that cannot be subdivided, or are not worth it

Poll **immediately before entering**, so a cancelled fold never pays the cost:

| Site | Why | Cost |
|---|---|---|
| `folding.rs:4468` `HierarchyTable::from_initial` | `vec![CELL_NONE; faces_total²]` — one zeroing allocation | 0.7 MB @ F=850 [M]; 25 MB @ F=5 000 [D]. On wasm32 `usize` is 32-bit, so F > 65 536 saturates `saturating_mul` and cannot allocate at all — a pre-existing ceiling. |
| `folding.rs:4569` `relations.sort_by_key` | a sort has no resumable boundary | 120 825 relations @ F=850 [M] |
| `fold_graph.rs:142` `folded_points` | `pub(crate)`, infallible, six call sites in `folding.rs` and `folding3d/` | O(points·faces-per-point); [D] ~40 ms at 10 k points. Poll before each of the six calls. **Phase-1 gate:** if a measured `folded_points` exceeds 50 ms, make it fallible and checkpoint its outer loop. |
| `quad_tree.rs:188` `add_item` recursion | unbounded recursion, not a loop | fast in practice; a stack overflow here is unrecoverable regardless of cancellation. Worth a depth guard — separately. |

### Declined

`prioritize_subfaces` (`permutation.rs:291`) was tier-1 site 9 in an earlier
draft, at a tabulated 40 µs. It is `pub`, infallible, and asserted infallibly at
`tests/oriedita_folding_oracle.rs:762` and `tests/folding.rs:383`, and it is
called **once**, from `from_ordered_subfaces` (`permutation.rs:418`) — which is
already covered by site 8. 40 µs against a 100 ms bar does not buy a public API
break. Dropped.

### Overhead

A poll is a thread-local `Cell<u32>` read and, when a token is bound, one
`Atomics.load` across the wasm→JS boundary. The `transport` investigation
measured, hand-encoding a minimal wasm module on Node 22.14 / V8 / M1 Max:
**3.88 ns** for a bare nullary import, **10.06 ns** when the import performs
`Atomics.load` on a `SharedArrayBuffer`.

**That is not the shim that will run, and the plan does not lean on it.** The
real binding is `js_sys::Atomics::load`, which returns `Result<i32, JsValue>` and
is therefore `catch`-annotated: wasm-bindgen generates a JS closure with a
try/catch that writes a discriminant plus payload back into linear memory.
Plausibly several times the benchmarked cost. At the tabulated strides even a
200 ns poll stays under a few percent everywhere, so the budget survives — but
the claim here is **"under 1% of a fold", not "under 0.1%"**, until Phase 1
measures the real `cp_set_cancel_buffer` path in Chrome and Safari rather than a
hand-encoded module. If it lands high, the fallback is to widen the *bridge*
(cache the loaded value for a short poll window inside `SabCancel`) rather than
widen every kernel stride, because a stride change moves the latency bound and a
bridge cache does not.

## Approach

Four independent pieces, in dependency order: a kernel signal, a state-integrity
transaction, two transports, one affordance.

### 1. The kernel signal

New module `crates/oristudio-cp/src/cancel.rs`. Nothing in it is feature-gated —
this ships.

```rust
//! Cooperative cancellation for the fold.
//!
//! Upstream uses `Thread.interrupted()`, which *consumes* the flag. That is a
//! defect there: `FoldedFigure_Worker.java:216` calls `SubFace.setGuideMap` on
//! the search thread, and `SubFace.java:389/429/439/445` return on the
//! interrupt — so a cancel landing in the guide map is swallowed, the map is
//! left half-built, and the search continues. We expose only `check`, never a
//! taking variant, so that failure mode is unrepresentable.

use std::cell::{Cell, RefCell};
use std::num::NonZeroU32;
use std::sync::Arc;

/// The run the user has most recently asked to stop, or 0 for "none".
///
/// **Exact match, not a watermark.** An earlier draft compared
/// `cancelled_through() >= run_id`, which cancels every concurrently-live run
/// with a *lower* id — a user's Stop would silently kill an in-flight 3D
/// rehydrate — and made `run_id = 0` cancelled from birth. Exact match makes
/// both unrepresentable. See [Run ids](#run-ids).
#[cfg(all(feature = "parallel", not(target_arch = "wasm32")))]
pub trait CancelSource: Send + Sync {
    fn cancelled_run(&self) -> u32;
}

/// Same trait without the thread bounds: only the native rayon bridge moves a
/// source across threads, and requiring `Send + Sync` unconditionally would
/// force two `unsafe impl`s in the wasm bridge to satisfy a bound nothing on
/// that target uses.
#[cfg(not(all(feature = "parallel", not(target_arch = "wasm32"))))]
pub trait CancelSource {
    fn cancelled_run(&self) -> u32;
}

/// The fold was stopped by the user. Deliberately its own type: it is not an
/// algorithmic outcome and must never be conflated with a contradiction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cancelled;

/// Non-zero by construction, so there is no "default" run and no `Default` impl
/// to forget. `RunId::BACKGROUND` is `u32::MAX`, reserved for work the user
/// cannot address (the 3D rehydrate, the export-dialog fold); bridges never
/// issue it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RunId(NonZeroU32);

impl RunId {
    pub const BACKGROUND: RunId = RunId(NonZeroU32::MAX);
    pub fn new(value: u32) -> Option<Self> { NonZeroU32::new(value).map(Self) }
    pub fn get(self) -> u32 { self.0.get() }
}

#[derive(Clone)]
pub struct CancelHandle {
    source: Arc<dyn CancelSource>,
    run_id: RunId,
}

impl CancelHandle {
    pub fn new(source: Arc<dyn CancelSource>, run_id: RunId) -> Self {
        Self { source, run_id }
    }
}

thread_local! {
    // Split so the hot path is a scalar read with no move and no window in
    // which a reentrant `check()` would observe "not bound". (The wasm source
    // calls into JS, so reentrancy is not hypothetical.) 0 means unbound.
    static RUN_ID: Cell<u32> = const { Cell::new(0) };
    // `RefCell`, not `Cell::take`: shared borrows nest, and the only
    // `borrow_mut` is in `bind`/`Drop`, which never call `check`.
    static SOURCE: RefCell<Option<Arc<dyn CancelSource>>> = const { RefCell::new(None) };
}

/// The one call every checkpoint makes. One `Cell` read when nothing is bound,
/// which is every oracle test and every existing caller.
#[inline]
pub fn check() -> Result<(), Cancelled> {
    let run_id = RUN_ID.get();
    if run_id == 0 {
        return Ok(());
    }
    SOURCE.with(|slot| match slot.borrow().as_ref() {
        Some(source) if source.cancelled_run() == run_id => Err(Cancelled),
        _ => Ok(()),
    })
}

/// Install a binding for as long as the guard lives, restoring whatever was
/// bound before. RAII rather than a bare setter, so no entry point can leak a
/// binding into a later fold and no nested fold can orphan one.
///
/// `bind(None)` is also the way a `pub` operation states "a plain call of this
/// is never cancellable" — see `divide_intersections`.
#[must_use = "the binding ends immediately if the guard is dropped"]
pub struct CancelGuard(Option<CancelHandle>);

pub fn bind(handle: Option<CancelHandle>) -> CancelGuard { /* swap both slots */ }

impl Drop for CancelGuard {
    fn drop(&mut self) { /* restore both slots */ }
}

/// The binding on *this* thread, so it can be carried across a thread boundary.
/// The only legitimate reader outside `check`; see `flat_map_conditions`.
pub fn current() -> Option<CancelHandle> { /* … */ }
```

#### Run ids

| Property | How |
|---|---|
| A cancel for run N never touches run M ≠ N | exact match in `check()` |
| An unbound / defaulted call is **inert**, not cancelled | `RUN_ID == 0` short-circuits to `Ok`; `RunId` is `NonZeroU32` with no `Default` |
| Background work is uncancellable by the user | `RunId::BACKGROUND` = `u32::MAX`; `beginFoldRun` never returns it |
| A stale cancel cannot kill the next fold | ids are never reused (a monotone `u32` counter per client) |
| Only one cancellable fold executes at a time | the CP worker is single-threaded and the desktop `CpSession` mutex serialises; a second Fold queues behind the first. One "most recently cancelled" slot therefore suffices, and a queued run cancelled before it starts still unwinds on its first checkpoint. |

For the two sites whose loop bodies are tens of nanoseconds:

```rust
/// Poll every `1 << $bits` iterations. Only for bodies too cheap to pay a
/// boundary crossing each time — anything over ~1 µs calls `check()?` flat.
macro_rules! check_every {
    ($counter:ident, $bits:expr) => {{
        $counter = $counter.wrapping_add(1);
        if $counter & ((1u32 << $bits) - 1) == 0 {
            $crate::cancel::check()?;
        }
    }};
}
```

**The rayon bridge.** `folding.rs:4285` `flat_map_conditions` runs the dominant
phase across rayon's pool under the `parallel` feature, which
`apps/tauri/src-tauri/Cargo.toml:14` enables. Rayon workers do not inherit
thread-locals. Rather than give the kernel two ways to read the signal, one
function bridges it and every closure body stays identical to the sequential
path:

```rust
#[cfg(all(feature = "parallel", not(target_arch = "wasm32")))]
fn flat_map_conditions<F>(range: std::ops::Range<usize>, f: F) -> Vec<EquivalenceCondition>
where
    F: Fn(usize) -> Vec<EquivalenceCondition> + Sync + Send,
{
    use rayon::prelude::*;
    // The ONE place a cancel binding crosses a thread boundary. Captured here,
    // on the thread that owns it; re-installed per item on whichever worker
    // runs it. `flat_map_iter` cannot short-circuit, so a cancelled closure
    // returns a partial Vec and the CALLER discards the whole collect — see the
    // `check()?` immediately after each call site.
    let handle = crate::cancel::current();
    range
        .into_par_iter()
        .flat_map_iter(|index| {
            let _bound = crate::cancel::bind(handle.clone());
            f(index)
        })
        .collect()
}
```

**The closures return `Vec<EquivalenceCondition>`, not `Result`** (`F: Fn(usize)
-> Vec<EquivalenceCondition>`, `folding.rs:4286-4292`), so `check()?` does not
typecheck inside them. A poll at the *top* of the closure would be one poll per
`line_index` — the entire `collect_potential_collision` sweep, which is the
skewed part of the distribution and the site carrying most of a long fold. That
is the coarse checkpointing this plan exists to reject. The shape is therefore a
**monotone latch plus `break`**, at the tabulated stride:

```rust
let quadruple_conditions =
    flat_map_conditions(0..graph.lines.len().saturating_sub(1), |first_line| {
        let mut out = Vec::new();
        /* … unchanged prologue … */
        for second_line in line_tree.collect_potential_collision(first_line) {
            // Partial `out` is safe here — and ONLY here — because the caller
            // discards the whole collect: nothing clears the signal during a
            // run, so the `check()?` after the collect below is guaranteed to
            // see it and unwind. Never copy this shape to a site whose partial
            // result is returned.
            if crate::cancel::check().is_err() {
                break;
            }
            /* … unchanged body … */
        }
        out
    });
crate::cancel::check()?;   // a cancelled condition set is never returned
```

Site 2 (`folding.rs:4220`, `for face_index in face_tree.collect_rectangle`) takes
the same shape with `check_every!(counter, 8)` and a `break` on trip.

This is the one place in the kernel where a checkpoint breaks with a partial
result; R1's mitigation is worded to say so rather than to claim it never
happens. Phase 1's `max_check_gap_ms` must report this loop's own maximum before
the strides are committed.

Ordering is preserved either way, which is what keeps the parallel and
sequential outputs byte-identical (the claim `folding.rs:4204` already depends
on).

#### Errors

A single top-level `FoldingEstimateError::Cancelled` variant **does not work**,
and assuming it would was the plan's most dangerous error. `From<FoldingEstimateError>
for EngineError` (`session.rs:250-274`) classifies by *nested cause*, and it has
a wildcard: `WorkerOverlapSearchError::AdditionalEstimation(_) => "fold_contradiction"`.
A `check()?` in `AdditionalEstimation::run_transitivity` (tier-1 site 3, the
largest tabulated body) must convert into `AdditionalEstimationError` to satisfy
`?`, so it arrives inside that wildcard and the user who pressed Stop is told
their crease pattern is unfoldable. Site 9 unwinds through `InitialHierarchyError`
→ `FoldSetupError` → `setup_code` → `"fold_same_parity"`; site 10 through
`FoldGraphError` → `"fold_disconnected"`, a code `PORTING.md:63-78` pins as a
documented divergence. Each is the R1 "worse than the hang" failure reintroduced
through the type system instead of through a `break`.

**Every error type on the checkpointed call graph gains a `Cancelled` variant**,
with `From<Cancelled>` at each level:

| Enum | Today | Route to `EngineError` |
|---|---|---|
| `Cancelled` (`cancel.rs`) | new | — |
| `FoldGraphError` (`fold_graph.rs:42`) | `DisconnectedFaces` only | → `FoldSetupError::FoldGraph` → `setup_code` |
| `InitialHierarchyError` (`folding.rs:106`) | `SameParityAdjacentFaces` | → `FoldSetupError::InitialHierarchy` → `setup_code` |
| `FoldSetupError` (`folding.rs:120`) | two arms | → `setup_code`, which is exhaustive and returns `&'static str` |
| `PermutationError` (`permutation.rs:16`) | `InvalidDigit` | → `SubFaceSearchError::Permutation` |
| `SubFaceSearchError` (`permutation.rs:28`) | `Permutation` | → `WorkerOverlapSearchError::SubFace` |
| `CombinationInferenceFailure` (`combination.rs:196`) | struct | **absorbed** — see below |
| `AdditionalEstimationError` (`folding.rs:1292`) | `Setup`, `Contradiction` | **absorbed** — see below |
| `FinalAdditionalEstimationFailure` (`permutation.rs:633`) | struct | **absorbed** — see below |
| `WorkerOverlapSearchError` (`permutation.rs:216`) | four arms, `Copy` | → `FoldingEstimateError::WorkerOverlap` |
| `FoldingEstimateError` (`folding.rs:1225`) | `Setup`, `WorkerOverlap` | `From<…> for EngineError` |
| `Fold3dOrderError` (`folding3d/order.rs:84`) | five arms | hand-built `EngineError` — see 3D below |
| `Fold3dSessionError` (`session.rs:52`) | — | hand-built `EngineError` — see 3D below |

Two mechanisms, neither of them a rule anyone has to remember:

```rust
// 1. Cancellation is a PRE-classification short-circuit, not a cause among causes.
impl From<FoldingEstimateError> for EngineError {
    fn from(error: FoldingEstimateError) -> Self {
        if error.is_cancelled() {
            return Self::new("fold_cancelled", format!("{error:?}"));
        }
        let code = match &error { /* … as today, but see 2 … */ };
        Self::new(code, format!("{error:?}"))
    }
}

// 2. `is_cancelled` recurses through the nesting. One predicate; no call site
//    pattern-matches by hand (AGENTS.md > one predicate per question).
//    Setup(FoldGraph(Cancelled)), WorkerOverlap(AdditionalEstimation(Cancelled)), …
```

and **the `AdditionalEstimation(_)` wildcard at `session.rs:268` is replaced with
explicit arms**, so a future variant fails to compile rather than inheriting
`"fold_contradiction"`.

#### The three absorbers

This is the part a checkpoint map alone misses. Three sites on the search path
swallow `Err` unconditionally, so **six** tier-1 checkpoints (3, 4, 6, 7, 7b,
7c) would be *dead* — and one of them would turn a cancel into a fabricated
algorithmic answer:

| Absorber | Swallows | Consequence today | Fix |
|---|---|---|---|
| `permutation.rs:1240` `if success.is_err() { *realtime_additional_estimation = false; return Ok(RetryWithoutRealtimeAdditionalEstimation) }` | `AdditionalEstimationError` from `run_realtime_additional_estimation` / `run_fast_…` (`:1220-1236`) | sites 3 and 4 — the per-outer-iteration checkpoints for the whole layer-ordering search — are lost **and** the AEA is permanently disabled | match `Cancelled` first and propagate, before the domain handling |
| `permutation.rs:522-557` `if let Err(failure) = run_final_additional_estimation(..)` → recover, `continue` | `FinalAdditionalEstimationFailure` | sites 7 / 7b / 7c lost; the search continues | same |
| `permutation.rs:885` `Err(_) => return Ok(false)` on `CombinationGenerator::new` | `CombinationInferenceFailure` | `Ok(false)` means "**no stacking of this subface exists**" — a cancel becomes a wrong algorithmic result, exactly the R1 class | same |

This is also, precisely, the Oriedita defect this plan claims to have made
unrepresentable (a cancel swallowed while the search continues). Making the
signal non-consuming closes it in `check()`; closing it end-to-end needs these
three arms too.

#### 3D

V1 **does** cancel 3D. Not because 3D folds are the motivating case, but because
site 10 and the `folded_points` pre-poll are in `fold_graph.rs`, and site 12 is
reached through `prepare_subface_segments`, all of which the 3D path shares via
`folding3d/cells.rs:81,230`, `admit.rs:12` and `placement.rs:47` — so 3D folds become
cancellable whether or not we intend it, and making shared checkpoints
selectively inert is more machinery than doing it properly. That obliges three
things the earlier draft omitted:

- **Both hand-built sites get a cancel branch.** `folded_figure_fold_3d`
  (`session.rs:1005`) and `folded_figure_3d_fold_another` (`:1013-1015`) build
  `EngineError::new("fold_3d_failed", …)` directly and never touch
  `From<FoldingEstimateError>`. Without the branch a cancelled 3D fold reaches
  the frontend as `fold_3d_failed` and `isFoldCancellation` misses it.
- **`Fold3dSession` joins the transaction.** `advance` (`folding3d/session.rs:252-264`)
  mutates `self.enumerator` and *then* recomputes `self.render`; a cancel between
  the two leaves the figure drawing a stacking the enumerator has moved past and
  the next `advance()` skips a solution. It derives `Clone`
  (`folding3d/session.rs:89`, which `folded_figure_3d_duplicate` already
  depends on), so the same wrapper applies.
- **`tests/non_flat_corpus.rs:747-755` is an expected diff.** Its match over
  `Fold3dOrderError` has five arms and no wildcard, so the new variant breaks it.
  It is not an oracle file; the diff is one arm.

`EngineError { code, message }` (`session.rs:90`) is serialised verbatim by
`engine_error_to_js` (`oristudio-cp-wasm/src/lib.rs:411`) and returned as the
Tauri command's `Err` type, and `normalizeError`
(`apps/web/src/workers/oristudioCpWorker.ts:100`) passes anything with a string
`code` straight through. So `{ code: 'fold_cancelled' }` reaches the store on
both platforms with zero new plumbing, and gets an `isFoldCancellation`
predicate mirroring `isOptimizerCancellation`
(`apps/web/src/store/workspaceStore/oristudioBpRuntime.ts:238`).

### 2. State integrity

> **Invariant.** A cancelled fold leaves the folded-figure session **exactly as
> it was before the call** — no partial solution, no advanced enumerator, no new
> handle, no stale case counter.

This is not optional politeness. Three commit sequences in the search tear
badly, and all three fail *silently*:

| Site | Tear | Symptom |
|---|---|---|
| `permutation.rs:534` → `:538` → `:543` | `valid_count += 1`, then `order.swap`, then `set_guide_map` | a subface counted "valid" whose generator was never initialised: `current_ordering()` returns empty, it constrains nothing, and the next search reports `found: true` on a stacking it never checked |
| `permutation.rs:1012-1013` `set_guide_map` | clears `triple_conditions` / `quadruple_conditions` before refilling, then `generator.initialize()` | a subface that has *forgotten* constraints — physically invalid solutions |
| `folding.rs:1858` → `:1864` → `:1866` | `discovered_fold_cases += 1`, then `worker.next(…)`, then `estimate.overlap = Some(..)` | solution 4 returned twice as "case 5"; or the figure drawing solution N labelled N+1, because `folded_figure_render_snapshot_from_session` (`folding.rs:2065`) renders from `estimate.overlap` |

Upstream survives all three only because it throws the figure away
(`FoldingEstimateTask.java:44-49` → `estimated_initialize()`). Copying its
`return`-style checkpoints **without** copying the discard would be unsound.

We can do better, cheaply, because `FoldingEstimateSession` already derives
`Clone` (`folding.rs:1231`) — `folded_figure_duplicate` (`session.rs:929`)
depends on it. So the invariant is enforced by one wrapper, at one seam, rather
than by making each commit sequence atomic or by trusting callers:

```rust
impl FoldingEstimateSession {
    /// Every public fold entry point on this type routes through here.
    ///
    /// The search mutates `entries`, `order` and `valid_count` in place and has
    /// three commit sequences that tear (`permutation.rs:534-543`,
    /// `permutation.rs:959-1030`, `folding.rs:1858-1866`). Rather than making
    /// each atomic, the whole call is a transaction.
    ///
    /// The snapshot is NARROW by default, and that is not an optimisation —
    /// it is the shipping configuration. Both bridges bind unconditionally, so
    /// `current().is_none()` is false for every production fold, and a full
    /// `self.clone()` would transiently double `worker.hierarchy.relations`
    /// (120 825 at F=850) and `worker.conditions` (46 784 + 92 454 conditions
    /// of four `usize` each) on the `fold_another` CLICK path — on a platform
    /// with a recorded WKWebView OOM on large crease patterns.
    ///
    /// `FoldingEstimateSession` has four fields (`folding.rs:1231`). The search
    /// mutates exactly `estimate` and the enumerator's `entries` / `order` /
    /// `valid_count`; `segments` and `starting_face_id` are never written, and
    /// `hierarchy` / `conditions` are read-only throughout
    /// `possible_overlapping_search`.
    fn transactional<T>(
        &mut self,
        f: impl FnOnce(&mut Self) -> Result<T, FoldingEstimateError>,
    ) -> Result<T, FoldingEstimateError> {
        if crate::cancel::current().is_none() {
            return f(self);   // oracle tests and any unbound caller
        }
        let restore = self.snapshot_mutable();  // estimate + entries/order/valid_count
        let outcome = f(self);
        if matches!(&outcome, Err(error) if error.is_cancelled()) {
            self.restore_mutable(restore);
        }
        outcome
    }
}
```

Phase 3 measures **peak RSS**, not only wall time: the risk here is memory, not
microseconds. A full `self.clone()` remains the fallback if `snapshot_mutable`
turns out to miss a mutated field, and the test that would catch that is the
"cancelled `fold_another` leaves the session byte-identical" assertion already in
Phase 3. `Fold3dSession` gets the same wrapper, for the `advance` tear described
under [3D](#3d).

**Nesting is prevented by construction, not by a rule.** The public methods
(`folding_estimated`, `restart`, `fold_another`, `folding_estimate_to_case`,
`folding_estimate_save_batch`) become thin wrappers calling `transactional`
around a private `*_inner`; the inner variants call each other. `restart`
(`folding.rs:1829`) calls `folding_estimated` today and would otherwise
double-snapshot; after the split it calls `folding_estimated_inner` and cannot.
`folding_estimate_to_case` (`folding.rs:1941`) is a *loop* of searches and needs
the outer transaction, which is exactly what it gets.

The **first** fold needs none of this — `fold_segments` (`session.rs:882-885`)
builds the session as a stack local and only calls `store_folded` **after**
`folding_estimated(order)?` returns `Ok`, so a cancel returns before any handle
is minted and the session is dropped. And no fold path takes `&mut` on the
document: `folded_figure_fold` (`session.rs:834-838`) clones `line_segments` off
an immutable borrow. **A cancelled fold cannot touch the user's crease pattern**,
on any path. That single fact is what makes aggressive checkpointing safe to
ship.

> **Adjudicated.** `kernel-api` proposed Oriedita's semantics — reset the session
> to `Step0` / `NotAttempted` and throw the partial away. `state-integrity`
> proposed snapshot-and-restore. I take snapshot-and-restore: it is strictly
> better for the user (a cancelled *find-another* keeps the solution already on
> screen, which upstream structurally cannot do), it is cheaper to reason about
> than N atomic commit sequences, and Oriedita's behaviour remains available as a
> *user* verb, because `restart()` (`folding.rs:1829`) already is that reset.
> The one thing not established is the snapshot's **memory** cost on a very large
> model — see [Risks](#risks-and-mitigations) R3, and note that it is paid on
> every *successful* production fold, not only on cancelled ones.

### 3. Transports — one seam, two implementations

**Cancellability is a property of the resolved engine client, not of the page.**
This is the single easiest thing to get wrong here, and getting it wrong ships
Stop permanently disabled on the platform where it works best:

- **Web** must be a synchronous main-thread `Atomics.store` on a
  `SharedArrayBuffer`. It cannot be a method on `OristudioCpWorkerApi`: that is a
  Comlink `Remote`, every access is proxied, and the worker's event loop is
  blocked by the fold, so the message would sit in the queue behind the thing it
  is meant to stop. (So the obvious fix — "put `cancelFold` on the engine-client
  interface where every other CP capability lives" — is right in substance and
  wrong in form: the *predicate* comes from the transport, the *web
  implementation* cannot be a client method.)
- **Desktop** has no worker, no `SharedArrayBuffer` and no `view` at all:
  `connectEngine('oristudio-cp')` returns `createOristudioCpNativeClient()` with
  `worker: null` (`engineHost.ts:63-71`). Cancel is `invoke('cp_fold_cancel')`.
- Production Tauri serves over the custom protocol with **no COOP/COEP** —
  `tauri.conf.json` has `"security": { "csp": null }` and no `headers` block — so
  `crossOriginIsolated` is **false** there. A predicate reading
  `SharedArrayBuffer && crossOriginIsolated` therefore disables Stop in the
  packaged desktop app.
- `npm run dev:desktop` loads `devUrl: http://localhost:5173`, and the vite dev
  server *does* set both headers. **`dev:desktop` is not a valid witness** for
  this feature; Phase 6 must verify in a `tauri build` package.

So `foldCancellation.ts` exposes a transport-dispatching pair, and the UI's
"can this be stopped" predicate comes from it:

```ts
export function foldCancellationAvailable(): boolean {
  if (isDesktopRuntime()) return true;                       // native command
  return typeof SharedArrayBuffer === 'function'             // jsdom leaves
    && globalThis.crossOriginIsolated === true;              // this undefined
}

export function cancelFoldRun(runId: number): void {
  if (isDesktopRuntime()) { void invoke('cp_fold_cancel', { runId }); return; }
  if (view) Atomics.store(view, SLOT_CANCELLED_RUN, runId);
}
```

### 3a. Web transport

The app is cross-origin isolated on every browser entry path — `apps/web/public/_headers`
for static assets, `apps/web/vite.config.ts` for dev and preview, and
`apps/web/functions/s/[[shareId]].ts:82` re-asserting both headers because
Cloudflare Pages does not apply `_headers` to Function responses.
`scripts/share-smoke.mjs:141` already fails the deploy if that regresses. So
`SharedArrayBuffer` is available, and its existing guard doubles as the
regression gate for this feature's new dependency on it.

It **is** a new dependency. I re-verified the tracked artifact: the memory
section of `apps/web/src/generated/oristudio-cp-wasm/oristudio_cp_wasm_bg.wasm`
reads `count 1 flags 0x0` — the shared bit is clear, and memory is exported
rather than imported. The CP engine runs fine today without isolation, so the
comments at `apps/web/functions/s/[[shareId]].ts:85` and
`scripts/share-smoke.mjs:17,145` claiming the wasm engine cannot boot without it
are **wrong**, and the feature must degrade rather than assume.

Main thread:

```ts
// apps/web/src/store/workspaceStore/foldCancellation.ts
const SLOT_CANCELLED_RUN = 0;   // exact id, not a watermark; slots 1-3 spare

const BACKGROUND_RUN_ID = 0xffff_ffff;   // RunId::BACKGROUND; never issued below
let view: Int32Array | null = null;
let nextRunId = 1;

export function foldCancellationBuffer(): SharedArrayBuffer | null { /* … */ }

/** Never returns 0 (inert in the kernel) or BACKGROUND_RUN_ID. */
export function beginFoldRun(): number {
  return nextRunId++;
}
```

`cancelFoldRun` is synchronous on the main thread with no `await` and no Comlink
hop — that is the entire point. `Atomics.store` of the **exact** id, not a
watermark: `cancelled_run == run_id` in the kernel means a Stop cannot reach
another live run, and `0` (unbound) matches nothing.

**Install the buffer in the connector, not at the call site.** The earlier draft
said "once per client via the memoised `getOristudioCpClient()`
(`oristudioCpRuntime.ts:64`)" — but that function is a one-line pass-through to
`connectEngine('oristudio-cp')`; the memoisation is `engineHost`'s `live` map, and
every runtime operation calls it. Installing there costs a Comlink round-trip per
engine call and has no "this client is new" signal. Worse, the follow-on claim
that a respawn after `announceLoss` re-installs it is **false**: the respawn path
is `drop(id)` then a fresh `CONNECTORS['oristudio-cp']()`, and `connectEngine` has
no post-connect hook, so a worker that dies mid-session comes back with no buffer
and Stop silently no-ops with the button still enabled. The install therefore goes
**inside the `oristudio-cp` connector** (`engineHost.ts:63-77`), which runs exactly
once per live client and automatically on respawn, and is a no-op on the native
branch. Comlink preserves message order, so a fire-and-forget `setCancelBuffer`
lands before any fold. `runId` becomes a parameter on the fold methods.

Bridge (`crates/oristudio-cp-wasm/src/lib.rs` — `js-sys` is already a dependency
there, and deliberately **not** a dependency of `oristudio-cp`):

```rust
struct SabCancel(Int32Array);   // no `unsafe impl` — see the cfg'd supertrait

impl CancelSource for SabCancel {
    fn cancelled_run(&self) -> u32 {
        // `Atomics.load` rather than a plain index read: the main thread's
        // `Atomics.store` is what we must observe, and this states that
        // explicitly rather than relying on typed-array read coherence.
        js_sys::Atomics::load(self.0.as_ref(), 0)
            .map(|v| v as u32)
            .unwrap_or(0)   // 0 matches no live run — a failed read is INERT
    }
}

#[wasm_bindgen]
pub fn cp_set_cancel_buffer(view: Int32Array) { /* store in a thread_local */ }

/// Wrap every fold entry point. Two bind sites in the whole codebase, both in
/// bridges, both auditable at a glance. A `run_id` of 0 binds nothing.
fn with_fold<T>(
    run_id: u32,
    f: impl FnOnce(&mut CpSession) -> Result<T, EngineError>,
) -> Result<T, JsValue> {
    let handle = RunId::new(run_id)
        .zip(cancel_source())
        .map(|(run_id, source)| CancelHandle::new(source, run_id));
    let _bound = oristudio_cp::cancel::bind(handle);
    with_session_mut(f)
}
```

### 3b. Desktop transport

The flag must live **outside** the session mutex, and the cancel command must
never call `run()`:

```rust
// apps/tauri/src-tauri/src/cp_engine.rs

/// Cancellation state lives beside the engine, not inside it. `run()` holds the
/// `CpSession` mutex for the whole fold (cp_engine.rs:42), so a cancel routed
/// through `run()` would queue behind the fold it is trying to stop.
#[derive(Default)]
pub struct FoldCancel(AtomicU32);

impl CancelSource for FoldCancel {
    fn cancelled_run(&self) -> u32 {
        self.0.load(Ordering::Relaxed)
    }
}

pub type FoldCancelState = Arc<FoldCancel>;

/// Synchronous and lock-free on purpose. Not `async`, not `run(...)`.
///
/// `store`, not `fetch_max`: exact-id matching, so cancelling the visible run
/// cannot collaterally kill a lower-id background rehydrate.
#[tauri::command]
pub fn cp_fold_cancel(state: State<'_, FoldCancelState>, run_id: u32) {
    state.0.store(run_id, Ordering::Relaxed);
}

/// `run()` with a cancel binding installed on the blocking thread.
async fn run_cancellable<T, F>(
    state: State<'_, CpEngine>,
    cancel: State<'_, FoldCancelState>,
    run_id: u32,
    f: F,
) -> Result<T, EngineError>
where
    F: FnOnce(&mut CpSession) -> Result<T, EngineError> + Send + 'static,
    T: Send + 'static,
{
    let engine = Arc::clone(state.inner());
    let source: Arc<dyn CancelSource> = Arc::clone(cancel.inner());
    tauri::async_runtime::spawn_blocking(move || {
        // Bound for the whole closure, including the rayon regions it enters.
        let _bound = oristudio_cp::cancel::bind(Some(CancelHandle::new(source, run_id)));
        let mut session = engine
            .lock()
            .map_err(|_| EngineError::new("engine_poisoned", "CP engine state is unavailable"))?;
        f(&mut session)
    })
    .await
    .map_err(|_| EngineError::new("engine_task", "CP engine task did not complete"))?
}
```

`.manage(FoldCancelState::default())` goes beside `.manage(cp_engine::new_state())`
at `apps/tauri/src-tauri/src/lib.rs:82`.

**Why the cancel command cannot be delayed by the fold:** it is *synchronous*, so
Tauri never routes it through `spawn_blocking` at all, and it therefore cannot
queue behind the ~40 CP commands parked on `engine.lock()` for the fold's
duration. (An earlier draft attributed this to "a 512-thread blocking pool
(`tauri/src/async_runtime.rs:223`)". That line is `default_runtime()` calling
`TokioRuntime::new()`; 512 is tokio's `max_blocking_threads` default and is
stated nowhere near it. The number is right and the conclusion holds, but the
reason above is the actual one. `tauri/src/ipc/mod.rs:324-329`
`respond_async → async_runtime::spawn` is correctly cited.)

**Six commands must actually change**, and nothing forces it: `run_cancellable`
can be added and never called — it compiles, `cargo test --workspace` passes,
`npm run check:desktop` passes, the parity test passes, and desktop cancel
silently does nothing forever. That is R2's failure mode with no compile-time
gate, so the checklist names all six explicitly and backs them with a test
asserting no fold command body calls `run(`:
`cp_folded_figure_fold` (`cp_engine.rs:345`), `_fold_selected` (`:364`),
`_fold_another` (`:429`), `_fold_to_case` (`:440`), `_fold_3d` (`:453`),
`_3d_fold_another` (`:472`).

**`cp_fold_cancel` does not go in `CP_ENGINE_COMMANDS`.** That constant lives in
the kernel crate (`session.rs:44`) and documents itself as the session-command
manifest — "Each name maps to a `CpSession` operation" — and every entry routes
through `run()` and takes the mutex. `cp_fold_cancel`'s entire design point is
that it does neither, and it has no wasm twin (the web transport is
`Atomics.store`, deliberately not a command). Adding it would put a name the
kernel has no concept of into the kernel and break the one invariant a future
reader would consult when asking why a command deadlocked behind a fold — and
`folding3d_boundary.rs:930` asserts membership against the same list, so the
drift propagates. It is registered **only** in `generate_handler!`
(`lib.rs:91`), and `native_commands_match_the_shared_manifest`
(`cp_engine.rs:558-569`) filters it out with a comment naming it as the
deliberate exception.

The hour-long lockout of *every other* CP command behind that mutex is a real,
separate defect; cancellation makes it survivable and does not fix it.

### 4. The affordance

Upstream gives the halt **two permanent buttons** — `TopToolbar.java:233` beside
the Fold button and `FoldingTab.java:538` — plus `hotkey.properties:95
haltAction=ESCAPE` registered on the root pane's `WHEN_IN_FOCUSED_WINDOW` input
map (`ButtonServiceImpl.java:495-545`), suppressed only while a `JTextComponent`
has focus. There is no menu item. A running fold is announced by a red canvas
overlay (`CanvasUI.java:306-311`) whose text literally tells the user which
button to press.

So the floor is a *persistent* control, not a transient one. Ours:

- **Short band (0.5 – 10 s):** the existing delayed toast
  (`GlobalToasts.tsx`, `createDelayedProgress`) gains a **Stop** action. Note
  `App.tsx:177` sets `closeButton` globally, so today a user can dismiss the only
  indicator of a 60-minute run — verify Stop and the X do not fight for the same
  corner.
- **Long band (> 10 s):** escalate to a persistent, non-dismissible element. The
  10 s threshold is a guess; the new `elapsed_ms_bucket` property is what will
  replace it with data.
- **Escape** joins the **existing** ladder, at its top. Not a new binding.

That last point matters and is a trap: `viewport.cancel`
(`shortcuts.ts:288`) claims Escape and `CreasePatternPanel.tsx:2661` returns
`true` **unconditionally**, and `viewport` precedes every other scope in
`shortcutRuntime.ts:117`. A new `escape` definition in `crease-pattern` or
`global` scope would therefore be permanently dead — and neither
`duplicateDefaultChords` (keyed `${scope}:${chord}`, `shortcuts.ts:446`) nor
`findShortcutConflict` (`shortcutScopesOverlap` returns false when either side is
`global`, `shortcuts.ts:546`) would report it. `shortcuts.ts:217` already warns
about exactly this class of failure. The halt joins `cancelActiveCpInput`
(`CreasePatternPanel.tsx:2578`), which makes it focus-independent for free —
**above** that callback's first statement, `if (!editableCp) return;`. Placed
below it the halt is dead whenever the panel shows a non-editable crease pattern,
which a long fold can perfectly well be running in; placed above it, the guard's
meaning is unchanged for every other rung. A store test covers Escape stopping a
fold while the active document is not editable.

Modal precedence already works: every modal listens on `window` in capture with
`stopPropagation`, and `appKeyboard.ts:56` listens on `document` in capture,
which fires strictly later. Three *bubble*-phase Escape consumers
(`MenuBar.tsx:139`, `CanvasObjectOverlay.tsx:160`,
`CreasePatternWebglCanvas.tsx:3096`) will fire **in addition** — benign, since a
fold already cleared the crease selection, but stated rather than discovered.

**On cancel the UI must not show an error.** The flat catch at
`creasePatternSlice.ts:2220` converts the loading draft into a permanently
*errored* figure and writes `error:`, which `GlobalToasts.tsx:44` turns into
`toast.error`. Neither `discardFoldedFigureDraft` (`:866`) nor
`restorePreviousFigure` (`:883`) can be reused — both unconditionally write that
envelope. Quiet variants are needed. Upstream agrees: `FoldingEstimateTask.java:48`
logs to tinylog, whose release config (`build/tinylog.release.properties`) is
`writer=file`, so a halted Oriedita says nothing on screen at all. Silence is the
floor; we show *"Folding stopped"*.

## Why not X

| Rejected | Why |
|---|---|
| **A disposable fold worker** (what BP's optimizer does, `oristudioBpRuntime.ts:138`) | The fold's *output* is a live in-memory search session, not data. `FoldingEstimateSession` (`folding.rs:1231`) is `Clone` but not `Serialize`; `folded_figure_fold_another` (`session.rs:936`) and `fold_to_case` (`:950`) mutate it in place; `export_fold_file` needs the document and the folded figures in **one** session. There is no adopt path in Rust or in the frontend — `folded3dRehydrate.ts` re-runs the fold and seeks. |
| **`resetEngine('oristudio-cp')`** (`engineHost.ts:169`) | Terminates the worker that *owns the document* (`thread_local! SESSION`, `oristudio-cp-wasm/src/lib.rs:23`). Destroys the user's crease pattern. It has no production callers, and this feature must not become its first. |
| **`Worker.terminate()` as the cancel** | `bp-optimizer-cancellation.md` measured a Comlink promise still `PENDING` 6 s after cancelling a 2.6 s run: terminate fires no event and rejects nothing. A cooperative cancel makes the wasm call *return*, so the promise settles naturally and the `finally` in `withFoldInFlight` (`creasePatternSlice.ts:902`) cannot leak. |
| **Building the CP wasm with `+atomics` + shared memory** | Needs nightly plus `-Z build-std`; CI installs `dtolnay/rust-toolchain@stable` (`ci.yml:31`). Worse, the module's memory becomes *imported* and must be constructed as `new WebAssembly.Memory({shared:true})`, which **throws** without cross-origin isolation — converting today's graceful degradation into a hard boot failure. Saves ~6 ns per poll. Documented here so it is not re-litigated. |
| **Explicit token parameter through the kernel** | ~140 signatures on the fold path and ~175 call sites across `crates/oristudio-cp/tests` and `examples`, including `oriedita_folding_oracle.rs`. See the adjudication below. |
| **A time budget / `Deadline`** (the pattern in unmerged `e8cb04b8`) | Wrong semantics — this is a user stop, not a timeout — and it needs a clock inside `oristudio-cp`, which today has no `js-sys` dependency. Its *run-id stamping* idea is adopted; its clock is not. |
| **Checkpointing only the outer search loop** (`permutation.rs:509`) | 580 ms per tick on the one measured slow model, and covers none of the 88% setup phase. |
| **Copying Oriedita's 32 sites verbatim** | Four sizeable stretches upstream has no check in at all: `WireFrame_Worker.folding()`'s per-point loop (`WireFrame_Worker.java:101-110`), `PointSet.calculateFaces()` (deliberately, `PointSet.java:424`), `Check4`'s per-vertex work (`Check4.java:58-143` declares `throws InterruptedException` and contains zero checks), and the `hierarchyList.restore()` table copy at the head of each outer iteration (`FoldedFigure_Worker.java:144`). Plus `HierarchyList_configure` calls `System.gc()` twice (`Configurator.java:313,324`). |

### Adjudicating the token-threading strategy

Three options, and this deserves the argument because the winner has a real
smell.

**First, separate the two axes, because an earlier draft conflated them.**
"Threading a token" and "making a function fallible" are different costs.
Option B removes the token *parameter*; it does **not** remove the
`Result`-ification, because `check()?` still requires every enclosing function to
return a `Result`. Three tier-1 sites sit in functions that are infallible today:

| Site | Function | Today | After |
|---|---|---|---|
| 11 | `configure_subfaces` (`folding.rs:4326`) | `-> SubFaceConfiguration`, private | `-> Result<SubFaceConfiguration, Cancelled>`; caller in `folding_estimated` absorbs with `?` |
| 12 | `divide_intersections` (`arrangement.rs:25`) | `pub`, `-> ()` | `-> Result<(), Cancelled>`; **two test call sites change** |
| 12 | `prepare_subface_segments` (`folding.rs:1382`) | `pub`, `-> Vec<LineSegment>` | `-> Result<Vec<LineSegment>, Cancelled>`; 8 callers in `folding.rs`, 4 in `folding3d/cells.rs`, **two test call sites** |

`CombinationGenerator::process` (`combination.rs:249`) is a separate trap and is
**not** made fallible: it returns `bool` where `false` means "no combinations
left", so a cancelled early `false` is a silent wrong answer — the R1 class. Its
checkpoint lives in its caller `run_combination_generator` (`permutation.rs:902`,
tier-1 site 6), which already returns `Result<usize, PermutationError>`.

So the honest cost of B is **~5 kernel signatures and 4 test call sites**,
against A's ~140 signatures and ~175 call sites. B still wins by a wide margin —
but it wins on volume, not on "the oracle is untouched", and R1's gate is
restated accordingly: **the oracle *assertions* are unchanged; the only permitted
test-file diff is a mechanical `?`/`expect` at a call site**, enumerated here and
reviewed line by line:

- `tests/oriedita_operations_oracle.rs:143`, `tests/operations.rs:127` —
  `divide_intersections(&mut model);` → `.expect("no token bound in tests")`
- `tests/oriedita_folding_oracle.rs:71`, `tests/folding.rs:184` —
  `prepare_subface_segments(&segments)` → same
- `tests/non_flat_corpus.rs:747-755` — one new `Fold3dOrderError::Cancelled` arm

Nothing else in those files moves, and no assertion changes. `prioritize_subfaces`
(`tests/oriedita_folding_oracle.rs:762`, `tests/folding.rs:383`) stays infallible
— see [Declined](#declined).

**C — a field on `CpSession`** (`transport`'s suggestion). Fails outright:
`divide_intersections` (`arrangement.rs:25`), `prioritize_subfaces`
(`permutation.rs:263`) and `equivalence_condition_candidates_from_parts`
(`folding.rs:4156`) are free functions that never see a `CpSession`. It would
cover the entry points and none of the hot loops.

**A — an explicit parameter.** Honest, self-documenting, no ambient state. It
costs ~140 kernel signatures and ~175 test/example call sites, against B's ~5 and
4. Both edit the oracle files; A edits every call site in them, B edits four
lines. That is the whole difference, and it is enough.

**B — a thread-local binding with an RAII guard.** Chosen.

**Its strongest objection, stated plainly: this is implicit global state.** A
function's signature no longer tells you it can be stopped from outside, and a
`?` in the middle of the fold no longer has a visible source. That is a real
cost and I am not going to pretend otherwise. Four things make it the right
trade anyway:

1. **The oracle's assertions stay untouched**, and its diff is four enumerated
   mechanical lines rather than every call site — the cleanest available
   demonstration that no ported behaviour moved.
2. **The failure is still visible in the type system where it matters.** The
   functions on the fold path already return
   `Result<_, WorkerOverlapSearchError>`. Adding a `Cancelled` variant means a
   caller can see and handle it; only the *source* of the signal is ambient.
3. **The precedent is this exact code.** `fold_profiling.rs` uses
   `thread_local!` counters on the live search path, and the wasm bridge's whole
   `CpSession` is a `thread_local!` (`oristudio-cp-wasm/src/lib.rs:23`). Rust
   runs each `#[test]` on its own thread, so a thread-local token is naturally
   test-isolated — the usual objection to globals does not land here.
4. **The two genuine risks are closed by mechanism, not discipline.** A leaked
   binding cancelling a later fold is closed by the RAII guard restoring the
   previous value (including `None`) and by `bind` being the only way to set. An
   entry point *forgetting* to bind is closed by a table-driven test that
   iterates every fold entry point with a token that fires on the first poll and
   asserts `Err(Cancelled)` — that is Phase 2's regression gate, and it is the
   one thing that would otherwise rot.

The one place B needs care is the rayon boundary, and the answer above —
`flat_map_conditions` as the single documented bridge — means the kernel still
has exactly **one** way to read the signal. Two would have been the smell.

> Note the CI hazard this creates: `cargo tree` confirms the folding oracle,
> which CI runs as `cargo test -p oristudio-cp` (`ci.yml:199-208`), builds
> **without** the `parallel` feature, while `cargo test --workspace` builds
> **with** it. A cancel that silently no-ops under rayon would pass every oracle.
> Phase 2's tests must run under both.

## Parity with Oriedita, and where we exceed it

**What parity gives us:** the checkpoint *placement* map. Below is the full
accounting of upstream's 32 (`rg -c 'Thread\.interrupted\(\)' third_party/oriedita`
= 32), because Phase 6 writes "the 32 sites are accounted for" into `PORTING.md`
and an unmapped gap written as an all-clear is worse than no line at all:

| Upstream file | # | Our counterpart |
|---|---|---|
| `FoldedFigure_Configurator.java` | 10 | tier-1 sites 8, 10, 11; tier-1 sites 1, 2 (`:416`/`:458`); tier 2 (`:510` declined — see [Declined](#declined)); `:137` collapses into `:126` (sequential port) |
| `FoldedFigure.java` | 6 | **tier-1 site 15** — the stage boundaries of `folding_estimated` (`:148,164,179,207,230,261`), one-to-one with our stage sequence |
| `SubFace.java` | 4 | tier-1 site 8 (`:389`); tier 2 `permutation.rs:979`/`:1015`/`:1023` |
| `AdditionalEstimationAlgorithm.java` | 3 | tier-1 sites 3, 4 |
| `WireFrame_Worker.java` | 3 | tier-1 site 10 (`:168`); the other two are in `folding()`, where upstream has **no** check in the per-point loop — we poll before `folded_points` instead |
| `ChainPermutationGenerator.java` | 1 | tier-1 site 5 (deliberately one level *above* `:165` — see the `next_core` trap) |
| `CombinationGenerator.java` | 1 | tier-1 site 6 |
| `FoldedFigure_Worker.java` | 1 | tier 2 `permutation.rs:509` (`:134`) |
| `IntersectDivide.java` | 1 | tier-1 site 12 |
| `PointLineMap.java` | 1 | **declined** — `PointLineMap` has no port on the fold path; the equivalent work is inside `fold_graph.rs`, covered by site 10 |
| `PointSet.java` | 1 | **declined by upstream too** (`:424`, "way too fast even for Ryujin"); our equivalent is `calculate_faces`, tier 2 `fold_graph.rs:84` |

It also gives us the affordance shape (persistent Stop + window-wide
Escape), and the fact that starting a new fold while one runs silently cancels
the old one (`SingleTaskExecutorServiceImpl.java:32-38` calls `stopTask()` first)
— which we can match without a dialog.

**Where we deliberately exceed it, and why:**

1. **More checkpoints than 32, and finer.** Upstream's criterion is
   `PointSet.java:424` — "fast enough even for Ryujin". Ours is a latency bound.
   Sites 7/7b/7c, 9 and 13 in the tier-1 table have no upstream counterpart, and
   sites 10 and 11 sit one level finer than upstream's (upstream needs
   `Configurator.java:126` **and** `:137` only because `:137` merely stops
   *submitting* executor tasks; a sequential port needs one).
2. **The signal is not consumed by reading.** `Thread.interrupted()` clears the
   flag. `FoldedFigure_Worker.java:216` calls `SubFace.setGuideMap` on the search
   thread, and `SubFace.java:389/429/439/445` `return` on the interrupt — so a
   cancel landing there is swallowed, the guide map is half-built, and the search
   continues with corrupted guides. The user's Escape is silently lost. Reading
   an atomic does not consume it, and we expose no taking variant.
3. **A cancelled fold does not destroy the figure.** Upstream catches and calls
   `estimated_initialize()` unconditionally
   (`FoldingEstimateTask.java:44-49` → `FoldedFigure.java:58-72`), which sets
   `displayStyle = NONE_0` and leaves an empty, still-selectable entry in
   `foldedFiguresList` whose only on-screen text ends up being
   `"     Computation time N msec."`. Cancelling a *find-another* therefore
   throws away solutions already found. Our restartable enumeration (already a
   documented divergence in `PORTING.md:29-40`) separates the shown case from the
   search state, so the transaction wrapper restores both.
4. **The user is told.** Upstream's halt is silent in release builds.

Also note upstream's `return`-vs-`throw` split (8 sites return, 24 throw) is not
sloppiness — a `java.util.concurrent` pool lambda cannot throw a checked
exception, and `Configurator.java` opens four `newWorkStealingPool`s. Our port is
sequential, so all 32 collapse to one `check()?` shape and the distinction
disappears rather than needing a decision.

`PORTING.md` needs two new bullets in the `## Oriedita (oristudio-cp*)`
deliberate-divergences list (points 1-3 above), plus a line in
**Folding search coverage** naming the checkpoints as ported-and-extended, so a
future `upstream-drift` sweep knows the 32 sites are accounted for.

## Measuring the latency claim

**No committed fixture reproduces a slow fold, and I could not find one on this
machine.** The largest committed candidate,
`tests/fixtures/oriedita/failing_global_flat_fold.ori`, folds in 12.2 ms. Of the
two external files in the perf directory referenced by prior work, I ran both:
`lots_of_small.ori` (4 180 segments) bails after 37 ms with zero faces, and
`perf_harder.ori` (52 224 segments) panics at `fold_profile.rs:54` with
`DisconnectedFaces { reached: 224, unreached: 28448 }`. `slow_fold_iguana.ori`,
the file every prior measurement is quoted against, is not present.

**Superseded in part.** Two slow inputs now exist outside the repo:
`slow_tiling_fold.osf` (19 652 segments; Order1–4 in 26.4 s, Order5 over an hour)
and the 563-file `cpoogle` corpus, of which 30 files exceed 1 600 segments.
`fold_profile` reads `.ori`, `.osf` and `.cp`, takes `--max-order N` to bound a
run, and `--csv` to emit one row per file for corpus diffing. So the claim can
now be validated **locally**, on a real hour-scale model.

It still **cannot be validated in CI**: none of those inputs is committed, and
the largest committed fixture folds in 12.2 ms. That residue is what Phase 1
must close:

- Extend `fold_profiling.rs` with a **max-gap recorder**: `cancel::check()`
  (under the `fold-profiling` feature only) stamps `Instant::now()` and keeps the
  running maximum of the interval since the previous check. `fold_profile` prints
  `max_check_gap_ms` at the end. This turns "under 100 ms" from an assertion into
  a printed number, on whatever file is to hand.
- Get a slow input. Two options, and **(b) is cheaper and has no licensing
  question**: (a) commit a redistributable large CP under
  `tests/fixtures/oriedita/`; (b) add a synthetic generator to `fold_profile.rs`
  (a dense Miura or box-pleat N×N grid) so size can be dialled up on demand.
  Either way, record in this file which input was used and what
  `max_check_gap_ms` was.
- **Measure `max_check_gap_ms` in the browser too, not only natively.** The
  100 ms bar is a *browser* bar, but `fold_profile` is native-only and is the one
  build that has rayon: `folding.rs:4285` is
  `#[cfg(all(feature = "parallel", not(target_arch = "wasm32")))]`, so the web
  fold takes the **sequential** `flat_map_conditions` branch, on a target
  typically 2–5× slower per operation. Measuring on the fastest, most-parallel
  configuration and applying the number to the slowest, least-parallel one is how
  a site that reads 40 ms natively lands well over the bar in Safari. Either add
  a dev-only wasm export returning `max_check_gap_ms` after a fold and run it in
  Chrome and Safari, **or** adopt an explicit derating factor and shrink the
  native target to ≤25 ms. Record the native number both with and without
  `--features parallel`, since sequential is what ships to web.
- Re-measure the wasm→JS poll cost **in a browser**, not in Node, and through the
  real `cp_set_cancel_buffer` export rather than a hand-encoded module — the real
  binding is `catch`-annotated (see [Overhead](#overhead)). The 3.88 / 10.06 ns
  figures are V8 on a hand-encoded module; Safari/JSC is unmeasured.
- **Re-measure `prepare_subface_segments` / `divide_intersections`** on the
  synthetic grid, and record the site-12 row against a real number rather than
  the borrowed 20/40/60/80 series.

Two open questions the measurement should also answer, because they decide
whether the tier-1 set is complete: what does a genuinely 60-minute fold spend
its time on (the one measured slow model is 88% *setup* and its search finishes
in one outer iteration — a combinatorially hard model would have the opposite
profile), and what is the largest plausible `faces_total` (it sets the
`HierarchyTable::from_initial` cost, which no checkpoint can subdivide).

## Risks and mitigations

| # | Risk | Evidence it is real | Mitigation |
|---|---|---|---|
| R1 | A checkpoint changes a fold's result | `PORTING.md:63-78` records a previous `break` in `getFacePositions` producing an unfolded slab reported as `Ok` — *"worse than the hang"* | Checkpoints are pure reads that continue or unwind via `?`. **Two shapes are exceptions and both are bounded:** (a) sites 1 and 2 `break` with a partial `Vec` inside a `flat_map_conditions` closure, safe only because the caller discards the whole collect at the post-collect `check()?`; (b) the three [absorbers](#the-three-absorbers) must match `Cancelled` *first*, or a cancel becomes `Ok(false)` = "no stacking exists". **Fingerprint gate:** a cancel never produces `found: false`, `Ok(false)`, or a partial `Vec` that reaches a caller. Token defaults to unbound (`RUN_ID == 0`), so every existing caller is bit-identical. Test gate: the oracle *assertions* unchanged with only the four enumerated mechanical call-site edits, plus a fingerprint test folding a fixture with a token bound-but-never-fired and asserting the same `hier_hash` as the unbound run (the `FINGERPRINT:` line `fold_profile` already prints). |
| R2 | The cancel silently no-ops on desktop only | The folding oracle builds **without** `parallel`; the Tauri crate builds **with** it (`cargo tree` verified). Rayon workers do not inherit thread-locals. | `flat_map_conditions` is the one bridge, with its own test. Every cancellation test runs twice: `cargo test -p oristudio-cp` and `cargo test -p oristudio-cp --features parallel`. |
| R3 | The transaction snapshot is too expensive on a large model — **on the hot path, not just on cancel** | Both bridges bind unconditionally, so `transactional`'s short-circuit never fires in a shipped build: the snapshot is paid on **every** successful `folding_estimated`, `fold_another` (a per-click operation) and `folding_estimate_to_case`. A full `self.clone()` would transiently double `hierarchy.relations` (120 825 @ F=850) and `conditions` (46 784 + 92 454 × 4 `usize`) — on a platform with a recorded WKWebView OOM on large CPs. | Narrow snapshot is the **default**, not a fallback: `estimate` + `entries` / `order` / `valid_count` only. Phase 3 measures **peak RSS**, not only wall time — the risk here is memory. Full clone stays available if a mutated field is missed; the byte-identical-after-cancel test is what would catch that. |
| R4 | A stale cancel kills the next fold, **or a live one kills a sibling** | On desktop a "clear the flag" command would go through `run()` and block on the fold's mutex. Separately, the watermark this plan originally used (`cancelled_through >= run_id`, `fetch_max`) cancels every live run with a *lower* id — a user Stop would silently abandon an in-flight 3D rehydrate (`creasePatternSlice.ts:2950`, catch → `abandon(handle)`, `outcome: 'refused'`, no message) — and made `run_id = 0` cancelled from birth. | Exact-id match (`cancelled_run == run_id`), `store` not `fetch_max`, `RunId(NonZeroU32)` with no `Default`, `RunId::BACKGROUND = u32::MAX` for work the user cannot address. No clearing anywhere, and ids are never reused, so there is no ordering to get wrong on either platform. Tests: an entry point invoked with no run id runs to completion; cancelling a foreground fold leaves a concurrent rehydrate untouched. |
| R5 | The stale `.wasm` trap | `apps/web/src/generated/` is blanket-ignored (`.gitignore:10`) and `oristudio-cp-wasm/` is force-added; nothing in CI rebuilds or diffs it, and lint/typecheck/vitest all pass over a stale artifact | The new `cp_set_cancel_buffer` export changes the `.js`/`.d.ts` glue too, so this one would at least fail typecheck — do not rely on that. Explicit checklist step: rebuild and `git add -f`. |
| R6 | Desktop cancel silently does nothing | Three independent ways: (a) `generate_handler!` (`lib.rs:91`) has **no** test behind it and `cp_fold_cancel` is deliberately outside the parity manifest, so a miss compiles and fails at runtime with "command not found"; (b) `run_cancellable` can be added and never called by the six fold commands — every check stays green; (c) a page-level `SharedArrayBuffer && crossOriginIsolated` predicate disables Stop in the **packaged** app, and `dev:desktop` cannot show it because vite sets the headers | (a) checklist item, verified in a packaged build; (b) name all six commands in the checklist plus a test asserting no fold command body calls `run(`; (c) `foldCancellationAvailable()` branches on `isDesktopRuntime()` first. **`npm run dev:desktop` is not a valid witness for any of this** — verify in `tauri build`. |
| R7 | Cancel reported as an error toast | `GlobalToasts.tsx:44` turns any `state.error` into `toast.error`; `creasePatternSlice.ts:2220` writes it | `isFoldCancellation` consulted in every catch, quiet discard/restore helpers, and a store test asserting `state.error` is null and the previous figure entry is unchanged after a cancel. |
| R8 | A cancelled fold leaves a no-op undo entry and a dirty project | `runFoldedFigureAction` (`useFoldedFigures.ts:267`) commits the gesture in a `finally`; `pushOverlayHistoryEntry` (`creasePatternSlice.ts:534-575`) pushes unconditionally and sets `dirty: true` with no comparison | Pre-existing for *failed* folds too; cancellation makes it routine. Either guard `pushOverlayHistoryEntry` against an unchanged figure list (broader, fixes more) or let the fold action report cancellation back. Decide in Phase 5. |
| R9 | Fold cancellation unavailable without cross-origin isolation | Verified: the CP wasm does **not** use shared memory today (`flags 0x0`), so the engine runs fine un-isolated and this is a genuinely new dependency | Derive the predicate from the resolved **transport**, not the page: desktop → always available; worker client → `SharedArrayBuffer` + `crossOriginIsolated`. In the browser-and-un-isolated case, render Stop disabled with a reason rather than a button that does nothing. |
| R10 | `CreasePatternPanel.tsx` line cap | `apps/web/eslint.config.js:142` caps it at 2752; the Escape ladder lives at `:2578`/`:2661` | Per AGENTS.md, two legitimate answers: put the binding in `cp-workspace/folded/useFoldCancellation.ts` beside `useFoldedFigures`, or raise the cap with a written reason. **Not** legitimate: a `CreasePatternPanelParts.tsx`. |
| R11 | A worker respawn leaves cancellation dead with the button still enabled | `connectEngine` has no post-connect hook; `announceLoss` → `drop(id)` → a fresh `CONNECTORS['oristudio-cp']()` | Install the buffer **inside the connector** (`engineHost.ts:63-77`), so it runs exactly once per live client and automatically on respawn. Test: a simulated worker loss + reconnect leaves cancellation working. |

## Code-quality traps

- **Do not make `next_core` fallible.** `permutation.rs:1484`'s
  `while cur_index < self.num_digits` is where upstream checkpoints
  (`ChainPermutationGenerator.java:165`), but a mid-loop return leaves
  `PairGuide::score` elevated for the confirmed prefix while the next call
  retracts from `num_digits` downwards (`permutation.rs:1487-1501`), driving
  `score` below truth so `is_not_ready` lies. The transaction wrapper would
  restore it, but the loop is bounded by one subface's face count (tens) and
  needs no checkpoint. `permutation.rs:862` already bounds that stretch to
  ~60 µs. *This is where `kernel-api` and `state-integrity` disagreed; I take
  `state-integrity`, on the cost/benefit rather than the corruption argument.*
- **Do not checkpoint the Step4 assignment block** (`folding.rs:1735-1740`).
  Every other stage in `folding_estimated` assigns `estimation_step` and
  `display_style` **after** its computation returns, so aborting inside a stage
  automatically leaves a coherent earlier stage. That block writes `self.worker`
  plus five `estimate` fields with no intervening call, and it is the one place
  a check would create a tear the transaction has to clean up. Upstream agrees:
  `FoldedFigure.java:230`, the stage-04 checkpoint, sits **after** the equivalent
  assignments, not inside them — which is also why tier-1 site 15 is *between*
  stages and never within one.
- **`ChainPermutationGenerator::reset`** (`permutation.rs:1424`) calls
  `next_core(1)` purely for its side effect. If anything on that chain becomes
  fallible, a short-circuit leaves the generator half-initialised. Another reason
  to leave that chain infallible.
- **Do not make `prioritize_subfaces` fallible** (`permutation.rs:263`). Public,
  in two test files, 40 µs, and called once from a site already covered — see
  [Declined](#declined). `prepare_subface_segments` and `divide_intersections`
  **do** become fallible, deliberately and with an enumerated four-line test
  diff; that is the one exception and it is argued in
  [the adjudication](#adjudicating-the-token-threading-strategy).
- **Do not make `CombinationGenerator::process` fallible** (`combination.rs:249`).
  It returns `bool` where `false` means "no combinations left"; a cancelled
  `false` is a fabricated algorithmic result. Checkpoint its caller
  (`permutation.rs:902`), which already returns a `Result`.
- **Do not add `?` to a call whose `Err` is absorbed** without first fixing the
  absorber. Three exist (`permutation.rs:1240`, `:522-557`, `:885`); a checkpoint
  behind one is dead code that reads as coverage.
- **One predicate per question.** `isFoldCancellation` mirrors
  `isOptimizerCancellation`; do not hand-match `error.code === 'fold_cancelled'`
  in each catch.
- **No `keydown` listener on the panel.** `eslint.config.js:266-275` bans it, and
  `CreasePatternPanel.tsx` is on the legacy-exception list at `:283` — which is a
  reason not to add to it, not permission.
- **Analytics: `'cancelled'` is taken.** `apps/web/src/analytics/events.ts:98`
  already means "the user declined the CAMV warning dialog", with two live call
  sites (`creasePatternSlice.ts:1921` and the 3D refusal branch). Merging a
  200 ms dialog decline with a 40-minute give-up destroys the only signal this
  feature exists to produce. Add a distinct `'halted'` verdict.
  `DURATION_MS_BUCKETS` (`events.ts:277`) tops out at 10 s, so every interesting
  halt lands in one bucket — add a fold-specific ladder
  (`[1000, 5000, 15000, 60000, 300000, 900000, 3600000]`) and put
  `elapsed_ms_bucket` on `fold completed` for **every** verdict, since "how long
  do people tolerate" is only answerable against "how long folds take". Bucketed
  numbers only, never raw geometry or counts.
- **i18n: no `errors:` key.** A halt must not enter `humanizeError`
  (`toastMessages.ts:29`). Strings go in `toasts` and `panels`
  (`toasts:global.foldStop`, `toasts:global.foldStopped`,
  `panels:creasePattern.stopFolding` — upstream's own label is
  `name.properties:90 haltAction=Stop Folding Calculation`). All nine locales in
  the same PR, or `i18n:check` fails.
- **Prefer a refactor to a paragraph comment.** The reset body inside
  `restart()` (`folding.rs:1829-1843`) should become a named `fn clear(&mut self)`
  rather than growing a comment explaining why the cancel path looks like it.

## Phases

Each phase is independently shippable and independently verifiable.

### Phase 1 — Instrumentation and a slow input *(no behaviour change)*

Add `max_check_gap_ms` to `fold_profiling.rs` and print it from `fold_profile`.
Add a synthetic dense-grid generator to `fold_profile.rs` so fold size can be
dialled up without a committed corpus file. Measure the current phase split and
the per-site iteration costs on the largest input available, and **write the
numbers into this file**, replacing the `[D]`/`[A]` rows in the budget table.
Separately, measure the wasm→JS poll cost in a real browser.

*Verify:* `cargo test --workspace`; `fold_profile` output pasted into this plan.

### Phase 2 — The kernel signal, unbound *(no behaviour change)*

`crates/oristudio-cp/src/cancel.rs`; `Cancelled` on **every** enum in the
[error taxonomy](#errors); the three [absorber](#the-three-absorbers) fixes; the
`is_cancelled()` short-circuit in `From<FoldingEstimateError> for EngineError`
and at the two hand-built `fold_3d_failed` sites; all tier-1 checkpoints; the
`flat_map_conditions` bridge and the two closure latches. Nothing binds a token
yet.

*Verify:* the oracle *assertions* unchanged with only the four enumerated
mechanical call-site edits; a fingerprint test asserting identical `hier_hash`
with a bound-but-never-fired token; a test that a cancel fired at **each** tier-1
site surfaces `EngineError.code == "fold_cancelled"` — including from inside the
SEARCH phase, not only at setup; the same tests under `--features parallel`; an
overhead delta from `fold_profile --loop N` before/after; a `CountingCancel` unit
test on
`permutation.rs:2045` `an_unstackable_subface_is_settled_by_the_accelerator`
(the only in-repo case that crosses `COMBINATION_GENERATOR_THRESHOLD` and so the
only one that reaches `CombinationGenerator::process`) asserting
(a) `permutation_count() == 2001` with a huge N, and (b) `Err(Cancelled)` with
`permutation_count() < 2001` at N = 50.

### Phase 3 — The transaction *(no behaviour change)*

`transactional` (narrow snapshot) plus the public/`_inner` split on
`FoldingEstimateSession`, and the same wrapper on `Fold3dSession::advance`.
Measure wall time **and peak RSS**.

*Verify:* a session-level test that a cancelled `fold_another` leaves
`discovered_fold_cases`, `current_fold_case`, `estimate.overlap` and the
enumerator identical to before the call; the same for a cancelled
`folding_estimate_to_case` and a cancelled `Fold3dSession::advance` (enumerator
and `render` in step); oracle unchanged.

### Phase 4 — Transports

Web: `foldCancellation.ts` (transport-dispatching), the buffer install in the
`oristudio-cp` connector, `cp_set_cancel_buffer` + `with_fold` in the bridge, run
ids on the five fold wrappers and on `CreaseExportFoldRuntime`. Desktop:
`FoldCancel`, `cp_fold_cancel`, `run_cancellable` **called by all six fold
commands**, `.manage`, `generate_handler!`. Correct the two false COI comments
(`functions/s/[[shareId]].ts:85`, `share-smoke.mjs:17,145`).

*Verify:* a vitest that a `SharedArrayBuffer` survives a Comlink `postMessage`
untouched and a main-thread write is visible in the worker (this is unexercised
today and the whole web path depends on it); a vitest that a simulated worker
loss + reconnect leaves cancellation working; a Rust test that no fold command
body calls `run(`; `cargo test --workspace`; `npm run check:desktop`; wasm
rebuild and stage.

### Phase 5 — Store and affordance

Turn `oristudioCpFoldsInFlight` (`creasePatternSlice.ts:902`, one reader) into a
**map** of live runs keyed by `runId`, each `{ kind, startedAt }` — a bare
counter cannot name what to cancel or time it, and a *single* record cannot
represent the >1 case the counter was written for (seven wrapped call sites at
`:1940, :2116, :2286, :2323, :2401, :2720, :2791`, plus the unwrapped rehydrate).
Quiet discard/restore helpers. The cancel branch
before the generic catch. Toast Stop action, persistent long-run element, the
Escape rung at the top of `cancelActiveCpInput`. Restore the scoped crease
selection on cancel (upstream drops it at dispatch —
`FoldAction.foldCreasePattern` calls `unselect_all` immediately — so keeping it
is strictly better and the ids are already in hand at
`creasePatternSlice.ts:1810`). Analytics `'halted'` verdict, fold duration
ladder, nine locales.

*Verify:* `lint:web`, `i18n:check`, `typecheck:web`, `test:web`; store tests for
the counter returning to 0 and `state.error` staying null; browser checklist.

### Phase 6 — `PORTING.md`, and the remaining surfaces

The two divergence bullets and the Folding-search-coverage line. Then decide (see
[Out of scope](#out-of-scope)) whether the export-dialog fold, the 3D rehydrate
and the background CAMV refresh come in now or later.

## Out of scope

- **The `line_face_border` linear scan** (`fold_graph.rs:120`). The single
  highest-value perf fix and probably ~88% of a long fold, but it is a
  behaviour-preserving change to a parity-sensitive path and needs its own oracle
  run. File it; do not merge it here. Doing it first would be defensible and
  would change which checkpoints are load-bearing — that is a scheduling call for
  the author, not a design one.
- **The desktop `Arc<Mutex<CpSession>>`-for-the-whole-fold design.** Every other
  CP command still queues behind a running fold for its full duration.
  Cancellation makes that survivable; it does not fix it. Separate, larger.
- **`infer_final_subface_transitivity`** (`permutation.rs:638`) still contains
  the full O(S·k³) rescan the Italiano port was written to remove, where upstream
  uses the incremental AEA (`FoldedFigure_Worker.java:199-201`). A porting finding
  worth its own issue; if it is replaced, tier-1 site 7c disappears. **Its being
  skippable is exactly why 7c cannot carry the loop on its own:** it
  `.skip(completed_subfaces)`, so when `valid_count` covers every reduced subface
  it iterates **zero** times, leaving `run_final_additional_estimation`'s
  unbounded `loop` (`permutation.rs:610-630`) sweeping 46 784 + 92 454 conditions
  per pass with nothing polled. Sites 7 (loop head) and 7b (the two sweeps) are
  the real coverage; 7c is a bonus.
- **The CAMV check.** Upstream's `HaltAction` stops *two* executors
  (`HaltAction.java:26-29`), but the one it stops is `CheckCAMVTask` — the
  debounced background recompute, whose analogue is
  `scheduleOristudioCamvRefresh` (`projectSlice.ts:2412`) — **not** the pre-fold
  check. Upstream's pre-fold `Check4.apply` runs synchronously on the EDT inside
  `FoldAction.actionPerformed` and `HaltAction` cannot reach it. Ours
  (`creasePatternSlice.ts:1873`) is hundreds of milliseconds at worst on very
  large CPs, so it does not need cancelling — it needs to be **inside** the
  indicator window, which today it is not. Move `createDelayedProgress.start()`
  to cover the whole action. Record the narrowing in `PORTING.md`.
- **The 3D rehydrate** (`creasePatternSlice.ts:2950`). Deliberately unindicated,
  already bounded by `FOLDED_3D_REPLAY_STEP_LIMIT = 32`, and its catch already
  calls `abandon(handle)` correctly — so it is safe against a cancel that
  *throws*. It passes `RunId::BACKGROUND`, which the exact-id match makes
  unaddressable by the user's Stop. That is a **Phase 4** obligation, not a later
  one: it runs real kernel folds on the shared CP worker, so leaving its run id
  unspecified is what created the collateral-cancel hazard in R4.
- **The export-dialog fold** (`CreaseExportDialog.tsx:190`) has its own private
  `cancelled` flag that is only an unmount guard — closing the dialog mid-fold
  leaves the worker blocked with no indicator. Giving it a real Stop is out of
  scope. It is **not** a separate slice for run-id purposes, though:
  `foldSegmentForExport` calls `runtime.fold(...)` / `runtime.foldToCase(...)`
  (`lib/creaseExportFold.ts:260,267`) and `projectSlice.ts:518` wires
  `CreaseExportFoldRuntime` straight to `foldOristudioCpDocument` /
  `foldOristudioCpFigureToCase` — the same wrappers that gain `runId`. It
  therefore **must** pass `RunId::BACKGROUND` explicitly, and
  `CreaseExportFoldRuntime` plus its test fakes are in Affected Areas.
- **A menu entry for the halt.** Upstream has none. If one is added later, record
  the outcome on `fold completed` only — a `MENU_ACTION_ID` dispatch is already
  auto-captured at `handleMenuAction` (`commands/menuActions.ts`) and a
  hand-placed press event would double-count.

## Affected Areas

**Rust kernel** — `crates/oristudio-cp/src/cancel.rs` (new);
`folding.rs` (checkpoints, `flat_map_conditions`, the closure latches, the error
enums, `transactional`, the `_inner` split, `clear`, `prepare_subface_segments`);
`folding/permutation.rs` (checkpoints **and the three absorbers**);
`folding/additional_estimation.rs`; `folding/combination.rs`;
`folding3d/order.rs`; `folding3d/session.rs` (`advance` transaction);
`fold_graph.rs`; `operations/arrangement.rs` (`divide_intersections` signature);
`session.rs` (error mapping incl. the two hand-built `fold_3d_failed` sites;
**not** `CP_ENGINE_COMMANDS`); `fold_profiling.rs`; `examples/fold_profile.rs`.

**Rust tests (enumerated, mechanical)** — `tests/oriedita_operations_oracle.rs:143`,
`tests/operations.rs:127`, `tests/oriedita_folding_oracle.rs:71`,
`tests/folding.rs:184` (one `?`/`expect` each); `tests/non_flat_corpus.rs:747-755`
(one match arm).

**Bridges** — `crates/oristudio-cp-wasm/src/lib.rs`;
`apps/tauri/src-tauri/src/cp_engine.rs`; `apps/tauri/src-tauri/src/lib.rs`.

**Web** — `apps/web/src/store/workspaceStore/foldCancellation.ts` (new);
`engines/engineHost.ts` (buffer install in the connector);
`oristudioCpRuntime.ts` (five fold wrappers gain `runId`: `:401`, `:445`, `:452`,
`:474`, `:486` — `:438`/`:493` are clones, not searches);
`lib/creaseExportFold.ts` + `CreaseExportFoldRuntime` + its test fakes;
`slices/projectSlice.ts:518`; `slices/creasePatternSlice.ts`;
`workers/oristudioCpWorker.ts`; `engine/oristudioCpNativeClient.ts`;
`components/GlobalToasts.tsx`; `components/panels/CreasePatternPanel.tsx`;
`cp-workspace/folded/useFoldCancellation.ts` (new);
`cp-workspace/folded/useFoldedFigures.ts`; `analytics/events.ts`;
`public/locales/*/toasts.json`, `*/panels.json`;
`apps/web/functions/s/[[shareId]].ts` and `scripts/share-smoke.mjs` (comment
corrections only).

**Generated, tracked** — `apps/web/src/generated/oristudio-cp-wasm/`.

**Docs** — `PORTING.md`; this file.

## Checklist

**Phase 1 — instrumentation**

- [ ] Add a max-inter-checkpoint-gap recorder to
      `crates/oristudio-cp/src/fold_profiling.rs`, feature-gated as the rest of
      that module is, and print `max_check_gap_ms` from `fold_profile`
- [ ] Add a synthetic dense-grid generator to
      `crates/oristudio-cp/examples/fold_profile.rs` (`--grid N`) so a slow fold
      can be produced without a corpus file
- [ ] Measure and record in this file: phase split, per-site iteration costs,
      `max_check_gap_ms`, and which input was used
- [ ] Record `max_check_gap_ms` **with and without `--features parallel`** — the
      sequential path is what ships to web (`folding.rs:4285` cfg)
- [ ] Report the max gap for the site-1 `collect_potential_collision` loop
      **specifically**, before committing to the latch stride
- [ ] Measure `prepare_subface_segments` / `divide_intersections` on the grid and
      replace the borrowed 20/40/60/80 numbers
- [ ] Measure `folded_points`; if any call exceeds 50 ms, promote it to tier 1
- [ ] Either add a dev-only wasm export returning `max_check_gap_ms` and run it in
      Chrome and Safari, **or** record an explicit derating factor and shrink the
      native target to ≤25 ms
- [ ] Measure the wasm→JS poll cost in Chrome **and** Safari through the real
      `cp_set_cancel_buffer` export, not a hand-encoded module; record both
- [ ] `cargo fmt --check && cargo test --workspace --all-targets`

**Phase 2 — kernel signal**

- [ ] Add `crates/oristudio-cp/src/cancel.rs` (`CancelSource` with the cfg'd
      `Send + Sync` supertrait, `Cancelled`, `RunId(NonZeroU32)` + `BACKGROUND`,
      `CancelHandle`, split `RUN_ID`/`SOURCE` thread-locals, `check`,
      `bind`/`CancelGuard`, `current`, `check_every!`) — **no `unsafe impl`
      anywhere**, and `RUN_ID == 0` must be inert
- [ ] Add `Cancelled` + `From<Cancelled>` to **every** enum in the
      [error taxonomy](#errors): `FoldGraphError`, `InitialHierarchyError`,
      `FoldSetupError`, `PermutationError`, `SubFaceSearchError`,
      `CombinationInferenceFailure`, `AdditionalEstimationError`,
      `FinalAdditionalEstimationFailure`, `WorkerOverlapSearchError`,
      `FoldingEstimateError`, `Fold3dOrderError`, `Fold3dSessionError`
- [ ] Add a **recursive** `is_cancelled()` and make `From<FoldingEstimateError>
      for EngineError` (`session.rs:250`) test it **before** the `code` match
- [ ] Replace the wildcard `WorkerOverlapSearchError::AdditionalEstimation(_) =>
      "fold_contradiction"` (`session.rs:268`) with explicit arms, so a future
      variant fails to compile
- [ ] Add the `fold_cancelled` branch at **both** hand-built
      `EngineError::new("fold_3d_failed", …)` sites (`session.rs:1005`, `:1013-1015`)
- [ ] Fix the three absorbers to match `Cancelled` first and propagate:
      `permutation.rs:1240`, `:522-557`, `:885`
- [ ] Land tier-1 checkpoints 1-15 from the budget table, strides as tabulated;
      sites 1 and 2 use the **latch + `break`** form, not a closure-top poll
- [ ] Make `divide_intersections` (`arrangement.rs:25`) and
      `prepare_subface_segments` (`folding.rs:1382`) fallible; update the 12
      kernel callers and the four enumerated test call sites
- [ ] Rewrite `flat_map_conditions` (`folding.rs:4285`) as the single thread
      bridge; add the post-collect `check()?` at `folding.rs:4207` and `:4239`
- [ ] Poll immediately before `HierarchyTable::from_initial` (`folding.rs:4468`),
      before `into_initial_hierarchy` (`folding.rs:4553`), and before each of the
      six `folded_points` calls
- [ ] Unit test: `CountingCancel` over
      `permutation.rs:2045 an_unstackable_subface_is_settled_by_the_accelerator`
      — inert at large N, `Err(Cancelled)` with `permutation_count() < 2001` at
      N = 50
- [ ] Test: a token firing on the Nth check inside the **search** phase (not
      setup) reaches the top as `Err(Cancelled)` and never as `found: false` or
      `Ok(false)`
- [ ] Test: `EngineError.code == "fold_cancelled"` for a cancel fired at each
      tier-1 site, not only at the entry point
- [ ] Test: an entry point invoked with **no** run id (0) runs to completion
- [ ] Fingerprint test: same `hier_hash` with a bound-but-never-fired token as
      with none
- [ ] Confirm the only test-file diff is the four mechanical `?`/`expect` edits
      (`oriedita_operations_oracle.rs:143`, `operations.rs:127`,
      `oriedita_folding_oracle.rs:71`, `folding.rs:184`) plus one
      `Fold3dOrderError::Cancelled` arm in `non_flat_corpus.rs:747-755`, and that
      **no assertion changes**
- [ ] `cargo test -p oristudio-cp` **and** `cargo test -p oristudio-cp --features parallel`
- [ ] Overhead check: `cargo run -p oristudio-cp --release --features fold-profiling
      --example fold_profile -- <input> --loop 5` before vs after; record the delta
- [ ] Oracle: build `tools/oriedita-oracle/build_geometry_oracle.sh`, export the
      five `ORIEDITA_*` vars per `.github/workflows/ci.yml:191-208`, run
      `cargo test -p oristudio-cp --test oriedita_folding_oracle`

**Phase 3 — transaction**

- [ ] Split `FoldingEstimateSession`'s public fold methods into public wrappers
      + private `*_inner`, with `transactional` on the wrappers only
- [ ] Implement `snapshot_mutable` / `restore_mutable` (`estimate` + `entries` /
      `order` / `valid_count`) as the **default** snapshot — not a fallback
- [ ] Apply the same transaction to `Fold3dSession::advance`
      (`folding3d/session.rs:252-264`), which mutates the enumerator and then
      recomputes `render`
- [ ] Extract the reset body of `restart()` (`folding.rs:1829-1843`) as
      `fn clear(&mut self)`
- [ ] Tests: cancelled `fold_another`, cancelled `folding_estimate_to_case`, and
      cancelled `Fold3dSession::advance` leave the session byte-identical
      (`discovered_fold_cases`, `current_fold_case`, `estimate.overlap`,
      enumerator state, `render`)
- [ ] Measure wall time **and peak RSS** for the snapshot on the largest input;
      escalate to a full `self.clone()` only if a mutated field is missed
- [ ] `cargo test --workspace --all-targets && cargo test --workspace --doc`

**Phase 4 — transports**

- [ ] `apps/web/src/store/workspaceStore/foldCancellation.ts` with
      `foldCancellationAvailable()` (**branches on `isDesktopRuntime()` first**),
      `foldCancellationBuffer`, `beginFoldRun` (never 0, never `BACKGROUND`), and
      a transport-dispatching `cancelFoldRun` (web: `Atomics.store` of the exact
      id; desktop: `invoke('cp_fold_cancel', { runId })`)
- [ ] Add `setCancelBuffer` to `OristudioCpWorkerApi` and install it **inside the
      `oristudio-cp` connector** (`engineHost.ts:63-77`), not at a call site; no-op
      on the native client. `cancelFoldRun` is **not** a Comlink method — the
      worker loop is blocked
- [ ] Add `runId` to the **five** fold runtime wrappers
      (`oristudioCpRuntime.ts:401`, `:445`, `:452`, `:474`, `:486`); `:438`/`:493`
      are clones and take none
- [ ] Add `runId` to `CreaseExportFoldRuntime` (`lib/creaseExportFold.ts:27-41`),
      its wiring (`projectSlice.ts:518`) and its test fakes; the export dialog
      passes `RunId::BACKGROUND`
- [ ] Give the 3D rehydrate (`creasePatternSlice.ts:2950`) `RunId::BACKGROUND`
- [ ] `cp_set_cancel_buffer` + `SabCancel` + `with_fold` in
      `crates/oristudio-cp-wasm/src/lib.rs`; wrap every fold entry point
- [ ] `FoldCancel` / `FoldCancelState` / `cp_fold_cancel` / `run_cancellable` in
      `apps/tauri/src-tauri/src/cp_engine.rs`; `cp_fold_cancel` is **synchronous**,
      uses `store` not `fetch_max`, and never calls `run()`
- [ ] Convert **all six** fold commands to `run_cancellable` with a `run_id`:
      `cp_folded_figure_fold` (`:345`), `_fold_selected` (`:364`), `_fold_another`
      (`:429`), `_fold_to_case` (`:440`), `_fold_3d` (`:453`), `_3d_fold_another`
      (`:472`) — and add a test asserting no fold command body calls `run(`
- [ ] `.manage(FoldCancelState::default())` in `apps/tauri/src-tauri/src/lib.rs:82`
- [ ] Register `cp_fold_cancel` **only** in `generate_handler!` (`lib.rs:91`).
      Do **not** add it to `CP_ENGINE_COMMANDS` or `NATIVE_CP_COMMAND_NAMES`;
      filter it in `native_commands_match_the_shared_manifest`
      (`cp_engine.rs:558-569`) with a comment naming the exception
- [ ] Vitest: a `SharedArrayBuffer` posted to a worker via Comlink survives
      structured clone and a main-thread `Atomics.store` is visible inside it
- [ ] Vitest: a simulated worker loss + reconnect leaves cancellation working
- [ ] Test: cancelling a foreground fold leaves a concurrent `BACKGROUND` run
      untouched
- [ ] Correct the two false COI comments
      (`apps/web/functions/s/[[shareId]].ts:85`, `scripts/share-smoke.mjs:17,145`)
- [ ] `npm --workspace @treemaker/web run build:oristudio-cp-wasm`
- [ ] `git add -f apps/web/src/generated/oristudio-cp-wasm/` — the directory is
      blanket-ignored and nothing in CI rebuilds or diffs it
- [ ] `cargo test --workspace --all-targets && npm run check:desktop`

**Phase 5 — store and affordance**

- [ ] Replace `oristudioCpFoldsInFlight` with a **map** of live runs keyed by
      `runId`, each `{ kind, startedAt }` (`creasePatternSlice.ts:902`,
      `types.ts:648`, `GlobalToasts.tsx:28`) — a single record cannot represent
      the >1 case the counter was written for
- [ ] Add `isFoldCancellation` beside `isOptimizerCancellation`
      (`oristudioBpRuntime.ts:238`)
- [ ] Add quiet `discardFoldedFigureDraftQuietly` / `restorePreviousFigureQuietly`
      (or a `notify` flag) — the existing helpers at `creasePatternSlice.ts:866`
      and `:883` unconditionally write the error envelope
- [ ] Add the cancel branch **before** the generic catch at
      `creasePatternSlice.ts:2220`: remove the draft, restore
      `previousActiveId` (captured at `:1927`), refresh selection markers, write
      neither `oristudioCpError` nor `error`
- [ ] Restore the scoped crease selection on cancel (ids at
      `creasePatternSlice.ts:1810-1815`)
- [ ] Move `createDelayedProgress.start()` so it covers the pre-fold CAMV check
      (`creasePatternSlice.ts:1873`), not just `withFoldInFlight`
- [ ] Add the toast Stop action and the persistent long-run element; confirm the
      Stop action and sonner's global `closeButton` (`App.tsx:177`) do not fight
- [ ] Add the halt to `cancelActiveCpInput` (`CreasePatternPanel.tsx:2578`)
      **above** its `if (!editableCp) return;` first statement — **not** a new
      `escape` shortcut definition, which `viewport.cancel` (`shortcuts.ts:288` /
      `CreasePatternPanel.tsx:2661`) would silently swallow
- [ ] Store test: Escape stops a fold while the active document is **not**
      editable
- [ ] Put the binding in `cp-workspace/folded/useFoldCancellation.ts`, or raise
      the `CreasePatternPanel.tsx` cap in `apps/web/eslint.config.js:142` with a
      written reason in the PR
- [ ] Add the `'halted'` `FoldVerdict` and a fold-specific duration ladder to
      `apps/web/src/analytics/events.ts`; put `elapsed_ms_bucket` on
      `fold completed` for every verdict
- [ ] Add `toasts:global.foldStop`, `toasts:global.foldStopped`,
      `panels:creasePattern.stopFolding`; run `i18n:extract`, translate all nine
      locales, `i18n:stamp`, `i18n:check`. **No `errors:` key.**
- [ ] Store tests: counter returns to 0 after a cancel; `state.error` stays null;
      the previous figure entry is unchanged
- [ ] Decide R8 (no-op undo entry / dirty flag on a cancelled fold)
- [ ] `npm run lint:web && npm run i18n:check && npm run typecheck:web && npm run test:web`

**Phase 6 — docs and close-out**

- [ ] `PORTING.md`: two divergence bullets in `## Oriedita (oristudio-cp*)`
      (finer-than-upstream checkpoints that do not consume themselves; a
      cancelled fold does not destroy the figure) plus a Folding-search-coverage
      line reproducing the [32-site accounting table](#parity-with-oriedita-and-where-we-exceed-it),
      **including the two deliberately-unmapped sites** (`PointLineMap.java:39`,
      `PointSet.java:424`) — a bare "all 32 accounted for" would convert a gap
      into a false all-clear for the next `upstream-drift` sweep
- [ ] `PORTING.md`: note that `FoldGraphError` now carries `Cancelled` alongside
      `DisconnectedFaces`, so the pinned `fold_disconnected` contract is
      "disconnected **or** cancelled, distinguished by `is_cancelled()` before
      classification"
- [ ] `PORTING.md`: record the CAMV narrowing (we cancel the fold, not the
      background CAMV recompute, in V1)
- [ ] Update the budget table in this file with Phase 1's measured numbers
- [ ] File the two out-of-scope findings as issues:
      `FoldGraph::line_face_border` linear scan;
      `infer_final_subface_transitivity` O(S·k³) rescan
- [ ] Browser checklist for the author: cancel a long fold in the browser and in
      a **packaged** desktop build (`tauri build` — `npm run dev:desktop` is not a
      valid witness: its `devUrl` is vite, which sets COOP/COEP that the packaged
      custom protocol does not). Confirm the figure is unchanged, no error toast
      appears, Escape works from a floating toolbar and from a text editor (it
      should be eaten by the editor), Stop is **enabled** on packaged desktop, a
      second fold starts cleanly afterwards, and `cp_fold_cancel` actually fires
      (not merely that it is registered)
- [ ] Open a draft PR against `main`

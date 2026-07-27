# Folded-Figure Solution Navigation and Toolbar Polish

## Goal

Clear the issues found while testing the folded-figure contextual bar — and fix
the one underneath them properly rather than designing around it.

Fold-case navigation is currently **forward-only**: you can step to the next
layer-ordering solution but never back to an earlier one. Every awkward
behaviour below is a symptom of that. Oriedita has the same limitation, but it
is an artefact of how the enumerator was written, not a property of the fold —
and the data needed to fix it is already computed and then discarded.

## Known issues

| # | Issue | Root cause | Where |
| --- | --- | --- | --- |
| 1 | Case input does nothing when you ask for an earlier case | `folding_estimate_to_case` loops `while objective > discovered_fold_cases` | `crates/oristudio-cp/src/folding.rs:1697` |
| 2 | "Another solution" dead-ends at the last solution | same | `foldedFigureActions.ts` |
| 3 | Case input has a redundant ▸ button; no Enter-to-commit | UI | `CreasePatternPanel.tsx:895` |
| 4 | Viewport toolbar still carries a global "Another solution" | superseded by the contextual bar | `CreasePatternPanel.tsx:3665` |
| 5 | Export dropdown reserved an empty check column | check slot rendered for non-exclusive groups | **fixed** |
| 6 | Flip icon read as "mirror the shape" | `FlipHorizontal2` | **fixed** |
| 7 | Figure list showed `stale` badges | no live code sets `status: 'stale'` any more — see below | to verify |

Issue 7: after Phase B of the toolbar work, nothing in the running code assigns
`status: 'stale'` (`grep` finds zero assignments outside the `.osf` loader, which
maps a half-written `loading` figure to `stale`). The most likely explanation for
the badges is Vite HMR: the Zustand store is created once at import, so an edited
slice module does not replace the closures the live store already captured, and
the pre-edit `staleGeneratedFoldedFigures` keeps running. **Confirm with a hard
reload before treating this as a bug.** If it survives a reload, it is real and
needs its own investigation.

## The architectural finding

`FoldingEstimateSession` drives a `WorkerOverlapEnumerator`, a forward-only
stream: `possible_overlapping_search` advances internal search state and
`discovered_fold_cases` only ever increments. Nothing retains a solution once the
search has moved past it, so "case 14" is unreachable from case 28 — the number
names a moment in an enumeration, not an addressable thing.

But a solution turns out to be **fully described by data we already have**.
`folded_figure_render_snapshot_from_session` (`folding.rs:1824`) draws a case from
exactly one input:

```rust
let precomputed_hierarchy = session.estimate().overlap
    .as_ref().filter(|overlap| overlap.found)
    .map(|overlap| &overlap.hierarchy);
```

`estimate.overlap` is a `WorkerOverlapSearch`, which is `Clone`. So each
discovered case *is* a clonable value that the renderer can consume directly. We
compute it, render from it, and then overwrite it on the next search.

**So the fix is to remember, not to re-search.** Keep each discovered
`WorkerOverlapSearch` in a `Vec` on the session; going back to case N becomes
"set `estimate.overlap` to `discovered[N-1]` and re-render". Cases beyond what
has been discovered still enumerate forward exactly as today.

This is additive and parity-safe in the strict sense that matters: the search
algorithm, the solutions it yields, and the order it yields them in are all
untouched. The only change is that results stop being thrown away. That is the
kind of divergence from upstream worth taking — Oriedita's forward-only
navigation is an omission, not a behaviour anyone depends on.

### The conflation that has to go with it

`discovered_fold_cases` currently means two things at once: *how many solutions
we have found* and *which one is on screen*. They coincide only because the only
way to move is forward. Backwards navigation makes them different numbers, so
they have to become different fields — this is why issue 1 cannot be fixed in the
UI alone.

## Approach

### Phase 1 — Make discovered solutions addressable (Rust)

1. `FoldingEstimateSession` grows a **bounded** cache of discovered solutions
   (see "Memory" below — not a plain `Vec` that grows forever), populated in
   `run_folding_estimated_05` whenever `overlap.found`.
2. Split the counter on `FoldingEstimate`:
   - `discovered_fold_cases` — how many have been found (unchanged meaning).
   - `current_fold_case` — 1-based index of the one being shown (new).
   Every existing read of `discovered_fold_cases`-as-current moves to
   `current_fold_case`.
3. `folding_estimate_to_case(objective)` gains three paths, in cost order:
   - **cached** → restore `estimate.overlap`, set `current_fold_case`, return.
   - **ahead of the frontier** → enumerate forward as today, caching as it goes.
   - **behind the frontier but evicted** → restart the session and fast-forward.
     Slow, rare, and the reason the cache can never be load-bearing.
4. `fold_another` at the end of the enumeration wraps to case 1, which is pinned
   in the cache, so the wrap is instant and never triggers a replay.
5. Tests: sequence of solutions is byte-identical to today for a
   forward-only walk; going back to case N re-renders the same snapshot that
   case N produced on the way out; wrap returns to case 1. Run the Oriedita
   folding oracle to confirm the enumeration itself is unchanged.
6. `PORTING.md`: record the divergence — memoized enumeration, same algorithm,
   plus the reason (upstream cannot navigate backwards; we can, and the data
   costs nothing to keep).

### Memory: the cache must be bounded, and must never be load-bearing

Measured on `tests/fixtures/oriedita/solution_sample_1.cp` (21 faces, 15
solutions): a solution's `InitialHierarchy` holds **76 relations ≈ 1.2 KB**, at
roughly 36% of the maximum `F(F−1)/2` pair density. Note the *dense*
`faces_total²` `HierarchyTable` is an internal working structure built per
search — it is not what a solution carries — so the per-solution cost is the
sparse relation list. Extrapolating that density at 16 bytes per relation:

| Faces | Relations | Bytes/solution |
| --- | --- | --- |
| 21 (measured) | 76 | 1.2 KB |
| 100 | ~1,800 | ~29 KB |
| 1,000 | ~180,000 | ~2.9 MB |
| 2,000 | ~720,000 | ~11.5 MB |

Per-solution cost is O(F²), and solution *count* is combinatorial — a pattern
with many independent flaps has effectively unbounded valid orderings. That is
exactly why the enumerator is a lazy stream, and caching it wholesale would
throw away the property that makes it viable. **An unbounded cache is not an
option.**

So the design has one load-bearing invariant:

> **The cache is a pure optimization. Navigation must be correct without it.**

Reaching case N is always expressible as *restart the session and enumerate
forward N times* — deterministic, since the enumeration order is fixed. The
cache only decides whether that is instant or slow, never whether it works. That
frees us to evict on any policy we like without risking correctness, and it is
what keeps a 2,000-face pattern from being a memory hazard.

Concretely:

- Bound the cache **per figure** (a document can hold many figures), with a
  small cap — on the order of 32–64 recent solutions.
- **Always pin case 1.** It is one entry, it makes the wrap-around instant, and
  it is the most likely destination.
- Evict least-recently-visited; on a miss, restart-and-fast-forward.
- Consider a byte budget rather than an entry count, since entry size varies by
  three orders of magnitude across patterns. A count-based cap sized for a
  21-face model is 32 KB; the same cap on a 2,000-face model is 350 MB.

Phase 1 must **measure the replay cost** (session restart plus N searches) on a
dense pattern before settling the cap — if replay is cheap, the cache can be
small; if it is expensive, checkpointing every M cases bounds the fast-forward
to M steps. Related history: folding a large CP was a multi-minute operation
before the Italiano incremental-closure port, so restart cost is not assumed
negligible.

### Phase 2 — Case navigation UI (web)

1. Case input commits on **Enter** and on blur; drop the ▸ button
   (`CreasePatternPanel.tsx:910`).
2. The input and the "Current N" hint read `current_fold_case`, not the
   discovered count — today they show the count, which is why the field
   disagrees with what is on screen after any backwards attempt.
3. Remove the standalone "Another solution" button from the viewport toolbar
   (issue 4). The contextual bar owns the verb per figure; the toolbar copy acts
   on "the active figure", which after a fold is a *fallback* to the most recent
   one.
4. Wasm bridge + TS types carry `current_fold_case`. `.osf` round-trip is
   additive: an older file has no `current_fold_case`, so default it to
   `discovered_fold_cases` (which is what it meant before the split).

### Phase 3 — Contextual-bar wrap-around (web)

Replace the interim wrap with the real one: at the last solution the button
becomes "Back to first solution" and calls the case-1 restore — instant, and it
keeps the figure's placement, style and model because nothing is re-folded.

The interim implementation (wrap = re-fold from the recorded source region,
because that lands on case 1) is **not being committed**; it costs a full fold
per lap and needs the provenance a legacy figure lacks. Phase 1 makes it
unnecessary.

### Phase 4 — Verification and cleanup

1. Confirm issue 7 against a hard reload; investigate only if it survives.
2. Decide whether the figure list should show a derived "out of date" badge now
   that staleness is computed rather than stamped — the contextual bar surfaces
   Refold, but the list currently surfaces nothing.
3. i18n for new/changed strings across 8 locales; `i18n:check`.
4. Full validation: `cargo fmt --check`, `cargo clippy`, `cargo test --workspace`,
   the folding oracle, plus web `tsc` / `vitest` / `eslint` / `build:web`.

## Affected Areas

- `crates/oristudio-cp/src/folding.rs` — session cache, counter split,
  `folding_estimate_to_case`, `fold_another`
- `crates/oristudio-cp/tests/folding.rs`, `tests/oriedita_folding_oracle.rs`
- `crates/oristudio-cp-wasm/src/` — expose `current_fold_case`
- `apps/web/src/engine/oristudioCpTypes.ts` — snapshot field
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — case input, toolbar
  button removal
- `apps/web/src/cp-workspace/foldedFigureActions.ts` — wrap via case 1
- `apps/web/src/lib/nativeProjectFile.ts` — additive round-trip
- `PORTING.md` — the documented divergence

## Risks

- **Parity.** The whole argument rests on the enumeration being untouched. The
  oracle test is the gate; if memoizing perturbs the search in any way, stop.
- **Memory.** Measured at ~1.2 KB/solution for 21 faces but O(F²) — ~2.9 MB at
  1,000 faces — against a combinatorial solution count. Handled by bounding the
  cache and keeping it non-load-bearing; the residual risk is a count-based cap
  that is far too generous for a dense pattern, which a byte budget avoids.
- **Replay cost.** A cache miss restarts the fold. Unmeasured, and folding a
  large CP was historically expensive; Phase 1 measures it, and checkpointing
  bounds it if needed.
- **`.osf` compatibility.** The counter split changes the meaning of a persisted
  field's neighbours; the loader must default `current_fold_case` rather than
  assume it.
- **Scope.** This is the first Rust change in this line of work — it is a
  separate PR from the toolbar, which is already green.

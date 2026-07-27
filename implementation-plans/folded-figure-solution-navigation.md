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

1. `FoldingEstimateSession` grows `discovered: Vec<WorkerOverlapSearch>`, pushed
   in `run_folding_estimated_05` whenever `overlap.found`.
2. Split the counter on `FoldingEstimate`:
   - `discovered_fold_cases` — how many have been found (unchanged meaning).
   - `current_fold_case` — 1-based index of the one being shown (new).
   Every existing read of `discovered_fold_cases`-as-current moves to
   `current_fold_case`.
3. `folding_estimate_to_case(objective)`:
   - `objective <= discovered.len()` → restore `estimate.overlap` from the cache,
     set `current_fold_case`, return. No search.
   - `objective > discovered.len()` → enumerate forward as today, appending.
4. `fold_another` at the end of the enumeration wraps to case 1 via the same
   restore path (instant, no re-fold).
5. Tests: sequence of solutions is byte-identical to today for a
   forward-only walk; going back to case N re-renders the same snapshot that
   case N produced on the way out; wrap returns to case 1. Run the Oriedita
   folding oracle to confirm the enumeration itself is unchanged.
6. `PORTING.md`: record the divergence — memoized enumeration, same algorithm,
   plus the reason (upstream cannot navigate backwards; we can, and the data
   costs nothing to keep).

**Memory.** One `InitialHierarchy` per discovered case. Fine for the tens of
cases a person steps through; a pattern with thousands of solutions that someone
enumerates exhaustively is the case to watch. Measure a hierarchy's real size on
a dense CP before deciding whether a cap is needed; if it is, cap the cache and
fall back to restart-and-fast-forward for evicted cases (correct, just slower).

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
- **Hierarchy size.** Unmeasured. Phase 1 measures before committing to an
  unbounded cache.
- **`.osf` compatibility.** The counter split changes the meaning of a persisted
  field's neighbours; the loader must default `current_fold_case` rather than
  assume it.
- **Scope.** This is the first Rust change in this line of work — it is a
  separate PR from the toolbar, which is already green.

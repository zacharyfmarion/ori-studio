# References: persist the workspace across save and reopen

## Goal

Reopening a project shows the References workspace as it was saved: the same
plan, the same six settings, the same mode, sheet, Landmarks first, active card
and chosen ways — without replanning.

Today none of it survives. The plan lives in a one-slot module side table
(`referencesResults.ts`) and everything else in the store slice whose type says
"Never persisted" (`ReferencesSlice`). The revision key is
`${loadSerial}:${creaseFingerprint}` (`useReferencesView.ts`), so even a reopen
in the same session is a new revision: Sequence mode replans
(`useReferencesAutoPlan`) and clears the chosen ways. That was an explicit
design; the user has now asked for persistence.

Replanning is not a substitute. The measurements behind this plan
(Phase 0 of the Diagram workspace, 2026-10-02; the write-up lives outside the
repo) found:

- **Plans are not reproducible.** The planner (`crates/oristudio-precrease`)
  has three wall-clock budgets — the 4 s stuck search, the 1.5 s `improve` cap
  in `order.rs`, the 10 s refinement. Under a virtual clock every input is
  byte-identical; under the real one iguana_24's sheet 15 changes run to run on
  one Mac, and 3–6 of its 31 sheets change on emulated 2–8× slower machines.
- **Settings change plans a lot**, and reset to their defaults on reload:
  Merge symmetric steps off renumbers 9 of 10 crane sheets; Precrease grid off
  takes iguana-c0 from 22 cards to 88.
- **Steps carry document-global crease ids** (`cp_line_ids`). Deleting one
  crease in another sheet shifts every id in an otherwise identical plan, so an
  order-independent per-sheet fingerprint would accept a cache that highlights
  the wrong creases.
- **Sizes.** Crane (11 sheets) is 932 KB of compact JSON — 3.3 MB if nested as
  pretty JSON in a 931 KB `.osf` — and 134 KB as gzip + base64, 91 KB keeping
  only `witnesses[chosen]`. iguana_24 (31 sheets) is 1.80 MB gzip + base64
  against a 3.5 MB file. Witness lists are 46–65% of the bytes, and the web
  reads only `witnesses[chosen]`.

## Approach

Two records with different lifetimes, both typed and validated `.osf` fields
(`apps/web/docs/superset-features.md` §2). Neither needs a schema bump: both
are additive, and an older build drops both on read (its literal never names
them), which costs it a replan and nothing else.

### 1. Reader state — `creasePattern.viewState.references` (< 1 KB)

What the reader chose, owned by the user, never invalidated by a planner
change:

```ts
interface ReferencesReaderStateV1 {
  v: 1;
  settings: ReferencesSettings; // all six
  mode: 'find' | 'sequence';
  sheet: { bounds: SheetBounds } | null; // geometric, never a component id
  landmarksFirst: boolean;
  activeCard: { index: number; line: PrecreasePlanLine | null } | null;
}
```

- **The sheet is located by its bounds** (the outline's box in model space),
  because a component id is an index into an analysis that is recomputed on
  every revision. Resolved against the frames analysis when it lands; a sheet
  no longer there falls back to today's default.
- **The active card is located by its line** `{n, d}`; the index is only a
  hint, used to choose between cards on the same line (a fold and its presses)
  and to place a turn-over or the finished card, which have no line. On the
  cached plan both agree; on a replan the line finds the card if it is still
  there, and the first card otherwise.
- **Restored at load**, into the store, with a small `referencesRestore`
  record (the load serial, plus the sheet and card still to be resolved). The
  "a new document lands in Find" rule in `useReferencesMode` defers to it: a
  file that says Sequence opens in Sequence.
- **A file without it changes nothing** — the session's settings stay as
  they are, exactly as today.

### 2. Plan cache — `artifacts.references` (derived, disposable)

```ts
interface ReferencesPlanCacheV1 {
  v: 1;
  /** One per planned sheet, most recently viewed first, capped at 1 MiB of payload. */
  entries: {
    key: ReferencesPlanCacheKey;
    /** The reader's chosen ways, by the plan's own line id. */
    ways: Record<string, string>;
    /** base64(gzip(JSON.stringify({ result, plain, hoisted, durationMs }))) */
    payload: string;
  }[];
}

interface ReferencesPlanCacheKey {
  planner: string; // `oristudio-precrease@<version>+wire<N>`
  settings: { precreaseGrid; gridWhereNeeded; allowDanglingFolds; mergeSymmetricSteps };
  sheet: { bounds: SheetBounds; fingerprint: string };
}
```

- **Beside `artifacts.fold`**, in the file's derived-data slot, with the same
  `{ documentId, value }` wrapper. `validateArtifacts` drops keys it does not
  know, so an older build discards the cache harmlessly. Both writers emit it —
  the CP-only one and the multi-design one, which today writes
  `artifacts: {}` (so `artifacts.fold` never reaches a bundled file; nothing
  reads it back either, which is out of scope here).
- **Any key mismatch discards the entry and the sheet replans. Nothing is
  migrated.** Each kind of change hits a different part of the key: a CP edit
  or an edit elsewhere that renumbers creases changes the fingerprint, a new
  build changes `planner`, a settings change re-plans as it does today.
- **The fingerprint is index-sensitive and needs no analysis.** It hashes,
  for every segment inside the sheet's bounds (widened slightly), the
  segment's document index, its endpoints' exact bits and its colour — exactly
  what `precreaseInputFromTransport` hands the planner. Inside-the-box can
  only over-include (a neighbour on a shared edge, an unassigned segment), and
  over-including only discards more often. Not needing the frames analysis is
  what lets a save drop entries the saved geometry can never match.
- **`planner`** is the workspace version (the crate's `version.workspace`,
  which is the app's) plus `REFERENCES_PLAN_WIRE_VERSION`, bumped by hand when
  the `PrecreaseSequence` shape changes in a way an older cache cannot be read
  as. Deliberately not the commit: the web deploys on every merge to `main`,
  and a key that moved with each deploy would replan every reopen — the thing
  this plan exists to stop. A planner improvement therefore reaches a saved
  plan at the next release, not the next deploy.
- **The record's own duration rides along** (`durationMs`), so a restored
  plan reports what its run took, not a number made up on restore.
- **Trimmed before encoding.** `diagnostics.elapsed_ms` is zeroed (it is the
  only field that makes identical plans differ byte for byte) and each step
  keeps only `witnesses[chosen]`, with `chosen` rewritten to 0. `ways` keep
  their own witnesses. `result.sequence` is the plain order and is not stored
  twice; `model` is derived and recomputed on restore through the worker's
  `rfToModelMany`, as a fresh plan's is.
- **Encoded when the plan lands**, off the critical path (fflate is lazy-loaded,
  as `paperExport/zipPages.ts` does); a save awaits anything still encoding.
  Chosen ways live beside the payload, so switching a way never re-encodes.
- **Capped** at 1 MiB of payload: entries are kept most recently viewed first
  until the next would pass the cap. An entry larger than the cap on its own is
  not persisted (the plan still shows; reopening replans it).
- **The key is a small exported value** (`ReferencesPlanCacheKey`,
  `referencesPlanCacheKeyId`) and every planned sheet carries its own
  (`ReferencesPlanComponent.cacheKey`), so the Diagram workspace's
  References-step provenance can record which plan a step came from, beside
  the chosen way's `waySignature`.

### 3. Restore

`useReferencesAutoPlan` asks for `open` rather than `run`: `open` looks the
sheet up in the cache and, on a match, decodes the entry, maps its geometry
into model space and installs it as the plan — no planner run. Otherwise it
runs, as today. Recompute and a settings change still call `run`, which always
replans. Either way the first plan to land after a reopen takes the restored
active card and, from the cache, the chosen ways.

Switching back to a sheet already planned in this session is served from the
same cache, so it no longer replans either. That needed one change to
`useReferencesAutoPlan`: it refuses to *run* a (revision, sheet) pair twice —
its loop guard — and so never reached the cache for a sheet it had already
planned. An attempted pair now shows its cached plan (`showCached`), and still
never runs again; a lookup cannot loop, since a hit is a plan on screen and a
miss changes nothing.

The cache lookup is synchronous, so a sheet with nothing cached starts its run
in the same tick as before; only a hit goes async (unpack, map into model
space).

### Analytics

`references plan restored` with `outcome` (`hit` / `planner_changed` /
`settings_changed` / `sheet_changed`), fired once per lookup that found an
entry for the sheet. Whether the cache earns its bytes, and why it misses.

### Not in scope

- **Making plans reproducible at the source**: replace the planner's
  wall-clock budgets with budgets counted in units of work. The virtual-clock
  runs show nothing else in the planner is nondeterministic. That would make
  this cache only a speed-up; it is a planner change and needs its own plan.
- Persisting a Find-mode pick or ReferenceFinder's candidates.
- Registering References in the superset-feature export-loss registry: it is
  view state and derived data, not content any export could carry.

## Affected Areas

- `apps/web/src/cp-workspace/references/referencesPlanCache.ts` — key,
  fingerprint, trim, codec (new).
- `apps/web/src/cp-workspace/references/referencesPlanCacheStore.ts` — the
  document's cache side table (new).
- `apps/web/src/cp-workspace/references/referencesReaderState.ts` — the
  reader-state record, sheet and card locators (new).
- `apps/web/src/cp-workspace/references/referencesFile.ts` — `.osf`
  validators for both records (new).
- `useReferencesBreakdown.ts`, `useReferencesWays.ts`, `useReferencesMode.ts`,
  `referencesResults.ts`, `referencesSheets.ts`, `ReferencesPanel.tsx`.
- `store/workspaceStore/slices/referencesSlice.ts`, `types.ts`,
  `slices/projectSlice.ts` (save and load).
- `lib/nativeProjectFile.ts`.
- `analytics/events.ts`, `docs/analytics.md`.

## Checklist

- [x] Plan cache key, fingerprint, trim and codec, with unit tests
- [x] Cache side table: remember, ways, lookup, cap, prune, save, install
- [x] Reader state: record, sheet and card locators, with unit tests
- [x] `.osf`: typed fields, validators, both writers, round-trip tests
- [x] Store: `referencesRestore`, restore at load, reader state at save
- [x] `useReferencesMode` defers to a restored mode
- [x] Breakdown: `open` (restore or run), cache key on each planned sheet,
      restored card and ways
- [x] Ways written through to the cache
- [x] Auto-plan shows a cached plan for a pair it will not run again
- [x] Analytics event and docs
- [x] Lint, typecheck, tests (Node 22, web workspace)
- [x] Browser: save a planned crane, reopen, same plan without a planner run

## Verified in the browser (crane.osf, 11 sheets, 2026-10-02)

- Planned sheet 8 with Merge symmetric steps off and Landmarks first on,
  chose way 3 of 4 on card 14, saved (931,368 → 952,623 bytes; the sheet's
  payload is 18,496 chars). A second save wrote identical artifacts.
- Reloaded the page and opened the saved file: settings, mode, Landmarks first,
  sheet, card 14 and the chosen way all came back; both presentation orders
  matched the saved plan step for step; the run status never went to
  `running`. The plan was on screen 427 ms after entering References (mounting
  and the frames analysis included), against 778 ms to plan this small sheet.
- Sheet 8 → sheet 10 (planned, 1.6 s) → sheet 8: served from the cache in
  135 ms with its way, no run.
- Deleting crease 13 (sheet 1, numbered before sheets 8 and 10) and saving
  dropped both plans from the file; undo and save wrote both back with their
  original fingerprints.
- A file whose payload this build cannot read (an earlier wire shape) opened,
  restored the reader state, and replanned the sheet.

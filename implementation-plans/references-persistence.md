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
  /** One per planned sheet, most recently viewed first, capped at 20 MiB of payload. */
  entries: {
    key: ReferencesPlanCacheKey;
    /** The reader's chosen ways, by the plan's own line id. */
    ways: Record<string, string>;
    /** base64(gzip(JSON.stringify({ result, plain, hoisted, durationMs }))) */
    payload: string;
  }[];
}

interface ReferencesPlanCacheKey {
  planner: string; // `oristudio-precrease/plan<REFERENCES_PLAN_VERSION>`
  settings: { precreaseGrid; gridWhereNeeded; allowDanglingFolds; mergeSymmetricSteps };
  sheet: { bounds: SheetBounds; frame: PrecreaseFrame; fingerprint: string }; // `ps1:<64-bit>`
}
```

- **Beside `artifacts.fold`**, in the file's derived-data slot, with the same
  `{ documentId, value }` wrapper. `validateArtifacts` drops keys it does not
  know, so an older build discards the cache harmlessly. Both writers emit it —
  the CP-only one and the multi-design one, which today writes
  `artifacts: {}` (so `artifacts.fold` never reaches a bundled file; nothing
  reads it back either, which is out of scope here).
- **Any key mismatch replans the sheet. Nothing is migrated.** Each kind of
  change hits a different part of the key: a CP edit, or an edit elsewhere
  that renumbers creases, changes the fingerprint; different planner code
  changes `planner`; a settings change re-plans as it does today.
- **The fingerprint is index-sensitive and needs no analysis.** For every
  crease of the planner's own input (`precreaseInputFromTransport`, so it
  covers exactly what the planner is handed — a field added to
  `PrecreaseInput` does not compile until it is covered) that reaches into
  the sheet's box padded by 4e-3 of its side — twice the planner's
  `SNAP_RADIUS`, which is how far past a nearly rectangular border the
  planner still counts a crease as the sheet's — it takes the crease's
  document index, endpoints and colour, through the same 64-bit digest the
  folded-figure fingerprint uses (`lib/keyDigest.ts`). Unlike that one it is
  not sorted-and-order-free: a plan names creases by document index, so a
  renumbering must miss. Over-including only ever costs a replan. Not needing
  the frames analysis is what lets a save drop entries the saved geometry
  can never match.
- **The frame is part of the sheet's identity.** A plan's coordinates are
  mapped through the sheet's frame on restore, and two sheets can share a box
  (a square and the diamond on its edge midpoints) but never a frame. Slots
  are box + frame.
- **A document whose sheets overlap is never cached.** Which sheet owns a
  crease in the overlap follows the numbering of creases anywhere in the
  document, so no one sheet's fingerprint can vouch for its plan.
- **`planner` is a plan version, bumped by hand** (`REFERENCES_PLAN_VERSION`),
  when a plan saved before would now be read wrong: a field renamed, removed
  or changed in meaning; a convention its numbers rely on (frames, line
  normalisation, which segments are the sheet's); what a plan is *for*, such
  that an old one would now tell the reader something untrue; this cache's
  envelope. Not for a refactor, a speed-up or a better plan — an older plan of
  the same creases is still a true plan of them. A missed bump fails safe for
  anything that would break: the payload check and the restore's rehearsal
  catch a plan this build cannot read or draw, drop it, and replan.

  Considered and rejected: a build-time digest of the planner's source files
  (briefly in this PR). It moved on every edit to those files — a comment, a
  refactor — discarding saved plans for nothing, and it depended on a list of
  paths that a moved folder would silently break. The app version: every
  release would discard every saved plan. A golden test that fails when the
  planner's output on the fixtures changes, prompting a bump: kept in reserve
  if missed bumps turn out to matter; every output-changing planner PR would
  pay for it.
- **Every setting is classified once** (`referencesSettingsFields.ts`, checked
  against `ReferencesSettings` field for field): a new setting does not
  compile until it says whether it changes the plan, and from then on it is
  in the key and in the reader state.
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
- **Capped** at 20 MiB of payload (raised from 1 MiB after measuring: a
  54-sheet iguana project with all 50 plannable sheets planned holds 2.6 MB
  of plans, so 1 MiB kept only 32 of them), least recently viewed first out: the first
  entry that does not fit ends the list, so a plan the reader looked at is
  never dropped to keep an older, smaller one. An entry larger than the cap on
  its own is not persisted (the plan still shows; reopening replans it).
- **Another build's plan is kept.** A miss leaves the entry; a save keeps an
  entry from another planner while its creases are unchanged (or when its
  fingerprint is another algorithm's, for that build to judge), so a file
  passed between the desktop release and the web app keeps each one's plan.
  This build's replan of the sheet takes the slot.
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

### When a format changes

What happens when a file saved by one build is opened by another:

| What changed | What the reader sees |
| --- | --- |
| A change that makes old plans read wrong (see the bump rule) | Bump `REFERENCES_PLAN_VERSION`: the sheet replans. Settings, mode, sheet and card (by its line) come back; chosen ways do not, since they named the old plan's ids. |
| A refactor, a speed-up, a better planner | Nothing: saved plans keep showing as they were saved. |
| A payload damaged, edited, or unreadable despite a matching key | `decodeCachedPlan` checks every step field the panel reads without a fallback, and the restore rehearses the strip and every card before installing; either failing forgets the entry and replans, and nothing is written back. |
| A new plan-affecting setting | Does not compile until classified; once it is, old entries lack it and fail validation (replan). |
| The reader-state record | Additive fields are optional; a `v: 2` must keep reading `v: 1` — it is the user's, never dropped for being old. |
| The kernel's numbering, colours or endpoints | The fingerprint misses: replan. It cannot falsely match, since it covers the planner's whole input over a padded box. |
| The frames analysis (corners move within tolerance) | The reader's sheet is still found (box within `SNAP_RADIUS`, frame as tie-break); the cache misses only if the planner changed too, which it then did. |
| A pre-feature build re-saves the file | Both records are dropped (an older reader never names them); the next open plans as before. Accepted, as `superset-features.md` §2 describes. |

Saving never fails over References: the reader state and the cache are
computed inside a `try`, and a plan that cannot be read for the card leaves
the card out.

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

## Format-change hardening (2026-10-03)

An audit traced eight format-change scenarios against the first version of
this cache (one tracer and two refuting verifiers each). What it found, and
what changed:

- **High:** the key moved only with the release, so a planner change merged
  between releases (it has happened) was a hit; a stale shape could crash the
  panel on every visit, and `referencesReaderStateFor` could make every
  `.osf` save throw. → a documented bump rule for the plan version; deep
  payload check; restore rehearsal of every card; forget on failure; save
  guarded. (A source digest was tried first and withdrawn: see `planner`
  above.)
- **Medium:** the fingerprint's 1e-6 slack missed creases the planner counts
  as the sheet's (reproduced with the real planner); identical-box sheets
  shared a slot; overlap ownership; a restored card crossing into another
  document; new settings compiling outside the key. → 4e-3 pad over the
  planner's input; frame in the key; overlapping documents uncached;
  `takeReferencesRestoredCard(loadSerial)`; the settings table.
- **Low:** LRU order, `±(n, d)` lines, a looser box for the reader's sheet,
  other builds' entries kept.

- [x] Plan version in the key, with its bump rule
- [x] Fingerprint over the planner input, padded, through `keyDigest`
- [x] Frame in the key; overlapping documents uncached
- [x] Deep payload validation, checked against real planner output
- [x] Restore rehearsal, forget on failure, save never throws
- [x] Restored card bound to its document; settings table
- [x] Browser: same build hits; another build's plan replans with the
      reader state; a damaged payload replans and is not written back

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
